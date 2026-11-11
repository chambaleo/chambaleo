import { env } from "cloudflare:workers";
import { sendMethodNotAllowed } from "../../../lib/supabaseServer";

export default function handler(req, res) {
  if (req.method !== "GET") return sendMethodNotAllowed(res, ["GET"]);
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return res.status(503).json({ error: "La autenticación no está configurada." });
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ url, anonKey });
}