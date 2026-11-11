import { requireAdmin, sendMethodNotAllowed } from "../../../lib/supabaseServer";

const STATUSES = ["pending", "approved", "rejected", "expired"];
const ACTIONS = ["approve", "reject", "vip", "renew"];
const RENEWAL_DAYS = 60;

function expiryFromNow() {
  return new Date(Date.now() + RENEWAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function sortBySubmissionDate(rows) {
  return rows.sort((a, b) => {
    const dateA = new Date(a.created_at || a.submitted_at || 0).getTime();
    const dateB = new Date(b.created_at || b.submitted_at || 0).getTime();
    return dateB - dateA;
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "PATCH") return sendMethodNotAllowed(res, ["GET", "PATCH"]);
  const supabase = await requireAdmin(req, res);
  if (!supabase) return;

  if (req.method === "GET") {
    const status = req.query.status;
    if (status && !STATUSES.includes(status)) return res.status(400).json({ error: "El filtro de estado no es válido." });
    const { data, error } = await supabase.from("vacancies").select("*").limit(1000);
    if (error) return res.status(503).json({ error: "No se pudieron cargar las vacantes. Inténtalo de nuevo." });
    const rows = sortBySubmissionDate(data || []);
    return res.status(200).json(status ? rows.filter((row) => row.status === status) : rows);
  }

  const { id, action, isVip } = req.body || {};
  if ((typeof id !== "string" && typeof id !== "number") || !ACTIONS.includes(action)) {
    return res.status(400).json({ error: "La acción o la vacante no son válidas." });
  }

  let changes;
  if (action === "approve") {
    changes = { status: "approved", published_at: new Date().toISOString(), expires_at: expiryFromNow() };
  } else if (action === "reject") {
    changes = { status: "rejected" };
  } else if (action === "vip") {
    if (typeof isVip !== "boolean") return res.status(400).json({ error: "Indica si la vacante debe ser VIP." });
    changes = { is_vip: isVip };
  } else {
    const { data: current, error: readError } = await supabase.from("vacancies").select("id,status,published_at").eq("id", id).maybeSingle();
    if (readError) return res.status(503).json({ error: "No se pudo consultar la vacante para renovarla." });
    if (!current) return res.status(404).json({ error: "La vacante ya no existe." });
    if (current.status !== "expired") return res.status(409).json({ error: "Sólo se pueden renovar vacantes vencidas." });
    changes = {
      status: "approved",
      published_at: new Date().toISOString(),
      expires_at: expiryFromNow(),
    };
  }

  const { data, error } = await supabase.from("vacancies").update(changes).eq("id", id).select("id,status,is_vip,published_at,expires_at").maybeSingle();
  if (error) return res.status(503).json({ error: "No se pudo actualizar la vacante. Inténtalo de nuevo." });
  if (!data) return res.status(404).json({ error: "La vacante ya no existe." });
  return res.status(200).json(data);
}