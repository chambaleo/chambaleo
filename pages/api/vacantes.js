import { getSupabaseAdmin, sendMethodNotAllowed } from "../../lib/supabaseServer";
import { COMPANY_LOGOS_BUCKET, validateCompanyLogo } from "../../lib/companyLogo";
import { isUnexpired, toPublicVacancy } from "../../lib/vacancyData";
import { validateVacancySubmission } from "../../lib/vacancyValidation";

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 5;
const submissionsByIp = new Map();

export const config = { api: { bodyParser: { sizeLimit: "2mb" } } };

async function toPublicVacancyWithLogo(supabase, row) {
  const path = row.company_logo_url;
  if (typeof path !== "string" || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(path)) {
    return toPublicVacancy(row);
  }
  const { data, error } = await supabase.storage.from(COMPANY_LOGOS_BUCKET).createSignedUrl(path, 3600);
  return toPublicVacancy(row, error ? null : data?.signedUrl || null);
}

function getClientIp(req) {
  return req.headers["cf-connecting-ip"] || req.socket?.remoteAddress || "desconocida";
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function consumeSubmission(ip) {
  const now = Date.now();
  const recent = (submissionsByIp.get(ip) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  submissionsByIp.set(ip, recent);
  if (submissionsByIp.size > 2000) {
    for (const [key, timestamps] of submissionsByIp) {
      if (!timestamps.some((timestamp) => now - timestamp < RATE_WINDOW_MS)) submissionsByIp.delete(key);
    }
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const supabase = getSupabaseAdmin();
      const now = new Date().toISOString();
      let query = supabase.from("vacancies").select("*").eq("status", "approved").or(`expires_at.is.null,expires_at.gt.${now}`);
      if (req.query.id) query = query.eq("id", req.query.id).limit(1);
      else query = query.order("is_vip", { ascending: false }).order("published_at", { ascending: false });
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data || []).filter((row) => isUnexpired(row));
      if (req.query.id && rows.length === 0) return res.status(404).json({ error: "Esta vacante ya no está disponible." });
      const vacancies = await Promise.all(rows.map((row) => toPublicVacancyWithLogo(supabase, row)));
      return res.status(200).json(req.query.id ? vacancies[0] : vacancies);
    } catch {
      return res.status(503).json({ error: "No fue posible cargar las vacantes en este momento." });
    }
  }

  if (req.method !== "POST") return sendMethodNotAllowed(res, ["GET", "POST"]);
  if (!isSameOrigin(req)) return res.status(403).json({ error: "No se pudo validar el origen de la solicitud." });
  if (!consumeSubmission(getClientIp(req))) {
    return res.status(429).json({ error: "Alcanzaste el límite de envíos. Inténtalo de nuevo más tarde." });
  }

  const logo = validateCompanyLogo(req.body?.company_logo);
  if (logo.error) return res.status(400).json({ error: "Revisa el logotipo seleccionado.", fields: { company_logo: logo.error } });

  const { data: vacancy, errors } = validateVacancySubmission(req.body);
  if (errors) return res.status(400).json({ error: "Revisa los campos marcados.", fields: errors });

  try {
    const supabase = getSupabaseAdmin();
    let uploadedPath = null;
    let logoError = null;
    if (logo.data) {
      try {
        const { data: bucket, error: bucketError } = await supabase.storage.getBucket(COMPANY_LOGOS_BUCKET);
        if (bucketError || !bucket || bucket.public) throw new Error("Bucket privado no disponible.");
        const path = `${crypto.randomUUID()}.${logo.extension}`;
        const { data: uploaded, error: uploadError } = await supabase.storage
          .from(COMPANY_LOGOS_BUCKET)
          .upload(path, logo.data, { contentType: logo.mimeType, cacheControl: "3600", upsert: false });
        if (uploadError || !uploaded?.path) throw new Error("No se pudo cargar el archivo.");
        uploadedPath = uploaded.path;
        vacancy.company_logo_url = uploadedPath;
      } catch {
        logoError = "No se pudo guardar el logotipo. La vacante se enviará sin él.";
      }
    }
    const { data, error } = await supabase.from("vacancies").insert(vacancy).select("id").single();
    if (error) {
      if (uploadedPath) await supabase.storage.from(COMPANY_LOGOS_BUCKET).remove([uploadedPath]);
      throw error;
    }
    return res.status(201).json({ id: data.id, message: "Recibimos tu vacante. Nuestro equipo la revisará antes de publicarla.", logoError });
  } catch {
    return res.status(503).json({ error: "No pudimos recibir tu vacante en este momento. Inténtalo más tarde." });
  }
}