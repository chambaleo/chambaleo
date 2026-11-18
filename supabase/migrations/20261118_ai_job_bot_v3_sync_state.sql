CREATE TABLE IF NOT EXISTS public.ai_job_bot_sync_state (
  id text PRIMARY KEY CHECK (id = 'joa'),
  listing_since timestamptz,
  listing_cursor text,
  expired_since text NOT NULL,
  withdrawn_since text NOT NULL,
  quota_month date NOT NULL,
  quota_used integer NOT NULL DEFAULT 0 CHECK (quota_used BETWEEN 0 AND 1000),
  last_successful_run timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_job_bot_sync_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_job_bot_sync_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_job_bot_sync_state TO service_role;
