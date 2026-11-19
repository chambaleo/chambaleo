import { getJobBotDatabase } from "./supabase.mjs";
import { pathToFileURL } from "node:url";

export const SOURCES = [
  { source: "greenhouse:clara", platform: "greenhouse", companyName: "Clara", board: "clara" },
  // Kavak temporarily disabled: Lever API failed
];

const MEXICO_LOCATION = /\b(?:mexico|cdmx|ciudad de mexico|mexico city|guadalajara|monterrey|jalisco|nuevo leon|queretaro|puebla|toluca|tijuana|merida|yucatan|oaxaca|chihuahua|guanajuato|san luis potosi|aguascalientes|morelia|michoacan|hermosillo|sonora|saltillo|coahuila|veracruz|tabasco|chiapas|durango|zacatecas|campeche|colima|nayarit|sinaloa|tamaulipas|tlaxcala|hidalgo|guerrero|baja california(?: sur)?|quintana roo|estado de mexico)\b/i;
const REMOTE = /\b(?:remote|remoto|remota|telecommute|teletrabajo)\b/i;
const HYBRID = /\b(?:hybrid|hibrido|hibrida)\b/i;
const PAGE_SIZE = 1000;

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function isMexicoLocation(location) {
  return MEXICO_LOCATION.test(normalizeText(location));
}

export function isHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function getWorkMode(title, location, workplaceType = "") {
  const text = `${title || ""} ${location || ""} ${workplaceType || ""}`;
  if (REMOTE.test(text)) return "Remoto";
  if (HYBRID.test(text)) return "Híbrido";
  if (/\b(?:on[- ]?site|onsite|presencial)\b/i.test(text)) return "Presencial";
  return null;
}

function jobId(value, source) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${source}: publicación sin identificador válido`);
  }
  const id = String(value).trim();
  if (!id) throw new Error(`${source}: publicación sin identificador válido`);
  return id;
}

function validateJobCollection(jobs, source) {
  if (!Array.isArray(jobs)) throw new Error(`${source}: respuesta de empleos inválida`);
  const ids = new Set();
  for (const job of jobs) {
    if (!job || typeof job.title !== "string" || !job.title.trim()) {
      throw new Error(`${source}: publicación sin título válido`);
    }
    const id = jobId(job.id, source);
    if (ids.has(id)) throw new Error(`${source}: identificador duplicado ${id}`);
    ids.add(id);
  }
  return jobs;
}

async function getJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error("respuesta JSON inválida");
  }
}

function normalizeJob(source, job, location, workplaceType, applicationUrl) {
  if (!isMexicoLocation(location)) return null;
  if (!isHttpsUrl(applicationUrl)) {
    throw new Error(`${source.source}: enlace HTTPS inválido para publicación ${job.id}`);
  }
  return {
    source: source.source,
    external_job_id: String(job.id),
    company_name: source.companyName,
    job_title: job.title.trim(),
    description: source.platform === "greenhouse" && typeof job.content === "string"
      ? job.content
          .replace(/<\/?(?:p|div|li|br|h[1-6])\b[^>]*>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;/gi, '"')
          .replace(/&#39;|&apos;/gi, "'")
          .replace(/[ \t]+/g, " ")
          .replace(/\n\s*\n+/g, "\n\n")
          .trim() || null
      : null,
    location: location.trim() || null,
    work_mode: getWorkMode(job.title, location, workplaceType),
    application_url: applicationUrl
  };
}

async function fetchSource(source) {
  let jobs;
  if (source.platform === "greenhouse") {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board)}/jobs?content=true`;
    const data = await getJson(url);
    jobs = validateJobCollection(data?.jobs, source.source);
    if (!Number.isInteger(data.meta?.total) || data.meta.total !== jobs.length) {
      throw new Error(`${source.source}: respuesta incompleta (total declarado no coincide)`);
    }
  } else if (source.platform === "lever") {
    jobs = [];
    const seenIds = new Set();
    for (let offset = 0; ; ) {
      const url = new URL(`https://api.lever.co/v0/postings/${encodeURIComponent(source.board)}`);
      url.searchParams.set("mode", "json");
      url.searchParams.set("limit", "100");
      url.searchParams.set("skip", String(offset));
      const page = validateJobCollection(await getJson(url), source.source);
      for (const job of page) {
        const id = String(job.id);
        if (seenIds.has(id)) throw new Error(`${source.source}: paginación repetida para identificador ${id}`);
        seenIds.add(id);
      }
      jobs.push(...page);
      if (page.length < 100) break;
      offset += page.length;
    }
  } else {
    throw new Error(`${source.source}: plataforma no soportada`);
  }

  const normalized = [];
  for (const job of jobs) {
    let location;
    let workplaceType = "";
    let applicationUrl;
    if (source.platform === "greenhouse") {
      const locationNames = [
        job.location?.name,
        ...(Array.isArray(job.offices) ? job.offices.flatMap((office) => [office?.name, office?.location]) : [])
      ].filter((value) => typeof value === "string" && value.trim());
      location = locationNames.join(" · ");
      applicationUrl = job.absolute_url;
    } else {
      location = job.categories?.location || "";
      workplaceType = job.workplaceType || "";
      applicationUrl = job.hostedUrl || job.applyUrl;
    }
    const row = normalizeJob(source, job, location, workplaceType, applicationUrl);
    if (row) normalized.push(row);
  }
  return { source, jobs: normalized, total: jobs.length };
}

async function fetchAllSources(sources) {
  const results = await Promise.allSettled(sources.map(fetchSource));
  const failed = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return [];
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.error(`${sources[index].source}: ${reason}`);
    return [sources[index].source];
  });
  if (failed.length) {
    throw new Error(`Falló la descarga completa de ${failed.join(", ")}; no se modificó Supabase.`);
  }
  return results.map((result) => result.value);
}

async function readAllSourceIds(database, source) {
  const ids = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await database
      .from("external_vacancies")
      .select("external_job_id")
      .eq("source", source)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`${source}: no se pudieron consultar vacantes existentes: ${error.message}`);
    ids.push(...(data || []).map((row) => row.external_job_id));
    if (!data || data.length < PAGE_SIZE) return ids;
  }
}

async function writeSource(database, { source, jobs }) {
  let upserted = 0;
  for (let offset = 0; offset < jobs.length; offset += 100) {
    const { data, error } = await database
      .from("external_vacancies")
      .upsert(jobs.slice(offset, offset + 100).map((job) => ({ ...job, is_active: true, last_seen_at: new Date().toISOString() })), {
        onConflict: "source,external_job_id"
      })
      .select("external_job_id");
    if (error) throw new Error(`${source.source}: no se pudieron guardar vacantes: ${error.message}`);
    upserted += data?.length || 0;
  }

  const fetchedIds = new Set(jobs.map((job) => job.external_job_id));
  const existingIds = await readAllSourceIds(database, source.source);
  const staleIds = existingIds.filter((id) => !fetchedIds.has(id));
  let deactivated = 0;
  for (let offset = 0; offset < staleIds.length; offset += 100) {
    const batch = staleIds.slice(offset, offset + 100);
    const { data, error } = await database
      .from("external_vacancies")
      .update({ is_active: false })
      .eq("source", source.source)
      .eq("is_active", true)
      .in("external_job_id", batch)
      .select("external_job_id");
    if (error) throw new Error(`${source.source}: no se pudieron desactivar vacantes obsoletas: ${error.message}`);
    deactivated += data?.length || 0;
  }
  return { upserted, deactivated };
}

export async function runImporter({ write = false, sources = SOURCES } = {}) {
  const fetched = await fetchAllSources(sources);
  const total = fetched.reduce((sum, item) => sum + item.jobs.length, 0);
  console.log("Descarga completa:");
  for (const item of fetched) {
    console.log(`- ${item.source}: ${item.total} recibidas, ${item.jobs.length} vacantes en México`);
  }
  console.log(`Total México: ${total}`);

  if (!write) {
    console.log("DRY RUN: no se modificó Supabase. Usa --write para guardar.");
    return;
  }

  const database = getJobBotDatabase();
  let upserted = 0;
  let deactivated = 0;
  for (const item of fetched) {
    const result = await writeSource(database, item);
    upserted += result.upserted;
    deactivated += result.deactivated;
    console.log(`- ${item.source}: ${result.upserted} guardadas/reactivadas, ${result.deactivated} desactivadas`);
  }
  console.log(`Escritura completada: ${upserted} vacantes guardadas/reactivadas, ${deactivated} desactivadas.`);
}

const args = process.argv.slice(2);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (args.some((arg) => !["--write", "--dry-run"].includes(arg)) || (args.includes("--write") && args.includes("--dry-run"))) {
    console.error("Uso: node scripts/job-bot/import.mjs [--dry-run | --write]");
    process.exitCode = 2;
  } else {
    runImporter({ write: args.includes("--write") }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
