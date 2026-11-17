import { createClient } from '@supabase/supabase-js';

export function getJobBotDatabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  const parsed = new URL(url.trim());
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
    throw new Error("Invalid Supabase project URL");
  }
  if (!["/", "/rest/v1", "/rest/v1/"].includes(parsed.pathname)) {
    throw new Error("Unexpected Supabase URL path: " + parsed.pathname);
  }
  return createClient(parsed.origin, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
