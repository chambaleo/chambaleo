import { createClient } from "@supabase/supabase-js";
import { env } from "cloudflare:workers";

const supabaseUrl = () => env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = () => env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function clientOptions() {
  return { auth: { autoRefreshToken: false, persistSession: false } };
}

export function getSupabaseAdmin() {
  const url = supabaseUrl();
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falta configurar Supabase en el servidor.");
  return createClient(url, key, clientOptions());
}

export async function requireAdmin(req, res) {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Inicia sesión para continuar." });
    return null;
  }

  try {
    const url = supabaseUrl();
    const key = anonKey();
    if (!url || !key) throw new Error("Falta configurar Supabase en el servidor.");
    const authClient = createClient(url, key, clientOptions());
    const { data, error } = await authClient.auth.getUser(token);
    if (error || data.user?.app_metadata?.role !== "admin") {
      res.status(403).json({ error: "No tienes permiso para administrar vacantes." });
      return null;
    }
    return getSupabaseAdmin();
  } catch (error) {
    if (error.message === "Falta configurar Supabase en el servidor.") {
      res.status(503).json({ error: error.message });
    } else {
      res.status(401).json({ error: "La sesión no es válida. Inicia sesión de nuevo." });
    }
    return null;
  }
}

export function sendMethodNotAllowed(res, methods) {
  res.setHeader("Allow", methods.join(", "));
  res.status(405).json({ error: "Método no permitido." });
}