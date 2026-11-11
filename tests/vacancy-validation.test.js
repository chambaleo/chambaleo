import test from "node:test";
import assert from "node:assert/strict";
import { MAX_COMPANY_LOGO_BYTES, validateCompanyLogo } from "../lib/companyLogo.js";
import { isUnexpired, toPublicVacancy } from "../lib/vacancyData.js";
import { validateVacancySubmission } from "../lib/vacancyValidation.js";

function validSubmission(overrides = {}) {
  return {
    company_name: "Empresa MX",
    company_email: "contacto@empresa.mx",
    company_phone: "",
    job_title: "Analista",
    category: "Finanzas",
    city: "Ciudad de México",
    state: "CDMX",
    work_mode: "Presencial",
    employment_type: "Tiempo completo",
    experience_level: "Junior",
    vacancy_count: "1",
    salary_min: "",
    salary_max: "",
    salary_period: "Mensual",
    salary_negotiable: false,
    description: "Descripción del puesto",
    responsibilities: "Analizar información",
    requirements: "Manejo de hojas de cálculo",
    benefits: "",
    application_method: "email",
    application_value: "talento@empresa.mx",
    consent_accepted: true,
    ...overrides,
  };
}

test("submission always starts pending and cannot assign VIP or publication dates", () => {
  const result = validateVacancySubmission(validSubmission({
    status: "approved",
    is_vip: true,
    published_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2027-01-01T00:00:00.000Z",
  }));

  assert.equal(result.errors, undefined);
  assert.equal(result.data.status, "pending");
  assert.equal(result.data.is_vip, false);
  assert.equal(result.data.company_logo_url, null);
  assert.equal("published_at" in result.data, false);
  assert.equal("expires_at" in result.data, false);
});

test("submission rejects invalid consent, contact method, and salary range", () => {
  const result = validateVacancySubmission(validSubmission({
    consent_accepted: false,
    application_method: "external_url",
    application_value: "http://empresa.mx/postular",
    salary_min: "50000",
    salary_max: "40000",
  }));

  assert.equal(result.data, undefined);
  assert.ok(result.errors.consent_accepted);
  assert.ok(result.errors.application_value);
  assert.ok(result.errors.salary_max);
});

test("public vacancy view omits private contact and renders absent salary correctly", () => {
  const result = toPublicVacancy({
    id: "vacante-1",
    company_name: "Empresa MX",
    job_title: "Analista",
    company_email: "privado@empresa.mx",
    salary_min: null,
    salary_max: null,
    salary_negotiable: false,
    is_vip: true,
  });

  assert.equal(result.salary, "A convenir");
  assert.equal(result.featured, true);
  assert.equal("company_email" in result, false);
});

test("only vacancies without an expiry or with a future expiry are active", () => {
  const now = Date.parse("2026-11-11T12:00:00.000Z");
  assert.equal(isUnexpired({ expires_at: null }, now), true);
  assert.equal(isUnexpired({ expires_at: "2026-11-12T12:00:00.000Z" }, now), true);
  assert.equal(isUnexpired({ expires_at: "2026-11-10T12:00:00.000Z" }, now), false);
});

test("logo validation rejects files larger than 1,000,000 bytes with the Spanish message", () => {
  const bytes = Buffer.alloc(MAX_COMPANY_LOGO_BYTES + 1);
  const result = validateCompanyLogo({ mimeType: "image/png", data: bytes.toString("base64") });

  assert.equal(result.error, "El logotipo no puede superar 1 MB.");
});

test("logo validation checks the actual image signature against the declared MIME type", () => {
  const png = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png[11] = 13;
  Buffer.from("IHDR").copy(png, 12);
  png[19] = 1;
  png[23] = 1;
  const mismatch = validateCompanyLogo({ mimeType: "image/jpeg", data: png.toString("base64") });
  const valid = validateCompanyLogo({ mimeType: "image/png", data: png.toString("base64") });

  assert.equal(mismatch.error, "El contenido del logotipo no coincide con su formato.");
  assert.equal(valid.mimeType, "image/png");
});

test("logo validation accepts JPEG and WEBP signatures only when their containers are coherent", () => {
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]);
  const webp = Buffer.alloc(20);
  Buffer.from("RIFF").copy(webp, 0);
  webp.writeUInt32LE(webp.length - 8, 4);
  Buffer.from("WEBPVP8 ").copy(webp, 8);
  webp.writeUInt32LE(0, 16);
  const validJpeg = validateCompanyLogo({ mimeType: "image/jpeg", data: jpeg.toString("base64") });
  const validWebp = validateCompanyLogo({ mimeType: "image/webp", data: webp.toString("base64") });

  assert.equal(validJpeg.mimeType, "image/jpeg");
  assert.equal(validWebp.mimeType, "image/webp");
  assert.ok(validateCompanyLogo({ mimeType: "image/webp", data: Buffer.from("RIFFfakeWEBP").toString("base64") }).error);
});

test("public vacancy view exposes only the signed logo URL", () => {
  const result = toPublicVacancy({ id: "vacante-1", company_logo_url: "opaque-storage-path.png" }, "https://storage.example/signed");

  assert.equal(result.logoUrl, "https://storage.example/signed");
});