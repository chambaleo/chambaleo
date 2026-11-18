ALTER TABLE public.external_vacancies
ADD COLUMN IF NOT EXISTS posted_at timestamptz;
