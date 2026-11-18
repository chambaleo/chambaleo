# Chambaleo Job Bot

Imports Mexico-only job postings from Clara's Greenhouse board and Kavak's Lever board into `public.external_vacancies`. The importer does not fetch logos or photos. Its default mode is a dry run; only `--write` modifies Supabase.

## GitHub Secrets

In the repository, open **Settings → Secrets and variables → Actions → New repository secret** and add:

- `SUPABASE_URL`: the Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the project's service-role key. Keep it as an Actions secret; never use a `NEXT_PUBLIC_` variable or expose it in client code.

The existing 09:00 UTC schedule and its Clara/Kavak write behavior are unchanged. To run that importer manually, use **Actions → Chambaleo Job Bot → Run workflow** and inspect its dry-run step before selecting the `write` option.

## Local verification and import

Use Node.js 24 and install dependencies with `npm ci`. Run the safe default dry-run:

```sh
node scripts/job-bot/import.mjs
```

For an intentional local write, provide `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your shell environment and run:

```sh
node scripts/job-bot/import.mjs --write
```

After a write, use **Supabase → Table Editor → `public.external_vacancies`** to verify the source keys (`greenhouse:clara`, `lever:kavak`), active status, Mexico location, and HTTPS application links. Then check the deployed `GET /api/vacantes` response and open one external listing by its row UUID with `GET /api/vacantes?id=<uuid>`. Only jobs missing from a complete successful source fetch should become inactive. Keep RLS enabled and do not add anonymous access policies; the site reads this table server-side.

## JOA daily sync (AI Job Bot v3)

The JOA sync extends the existing AI Job Bot integration and runs as an independent daily GitHub Actions job. It does not change Clara's daily importer; a JOA error cannot prevent that job from running. Sync timestamps, the `listed_after` pagination cursor, the UTC-month quota counter, the expired/withdrawn feed cursors, and the last successful run are stored in Supabase, not in the Actions workspace.

The sync checks JOA's current monthly records remaining before requesting listings. It reserves 100 records and defaults to at most 10 JOA rows daily. It may raise the daily maximum to 50 only when all active unique Chambaleo vacancies are below 300 and the allowance supports that increase; it pauses new imports at 500 active unique vacancies. It requests only live Mexico listings newer than its persisted `listed_after` timestamp, deduplicates by source ID and application URL against existing active vacancies, and polls the free `/v1/jobs/expired` and `/v1/jobs/withdrawn` ID feeds daily. It does not use `/v1/changes` or other Growth-only endpoints. JOA listings retain the site's linked **“Data: Job Opportunities API”** attribution.

Before enabling the JOA Actions job, apply the separate [Supabase v3 state migration](./supabase/migrations/20261118_ai_job_bot_v3_sync_state.sql) and configure `JOA_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` as GitHub Actions secrets. The state table has RLS enabled and grants access only to `service_role`. The first run starts its listing cursor at that run's timestamp; it does not fetch a historical JOA snapshot. The Actions workflow does not deploy the site or apply migrations.

Run the focused mocked tests with `node --test tests/ai-job-bot.test.js`. A manual `joa_dry_run` dispatch performs read-only API requests and does not change Supabase rows or sync state. The scheduled job is the only workflow path that writes JOA data.

## Site deployment

The importer workflow does not build or deploy the site. Deploy the site separately through the existing Cloudflare deployment process (or `npm run build:vinext` followed by `npm run deploy:vinext` when deploying from this checkout).
