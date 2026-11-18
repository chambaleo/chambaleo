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

## JOA feed (manual validation only)

The optional Job Opportunities API adapter is separate from the Clara/Kavak importer. It uses `https://api.jobopportunitiesapi.org/v1/jobs`, the server-only `JOA_API_KEY`, and JOA's documented `country=MX`, `status=live`, and `source_type=ats,career_site` filters. It never requests descriptions, salaries, contact details, or logos. The employer's HTTPS `apply_url` and a date explicitly marked `published` are retained.

The official [Terms](https://jobopportunitiesapi.org/terms), last updated 16 November 2026 and checked 18 November 2026, allow commercial storage and display on every plan. They require a visible linked credit, **“Data: Job Opportunities API”**. Official [API docs](https://jobopportunitiesapi.org/docs), [job endpoint](https://jobopportunitiesapi.org/docs/endpoints/jobs), [pagination](https://jobopportunitiesapi.org/docs/api/pagination), and [record meter](https://jobopportunitiesapi.org/docs/account/record-meter) were checked on 18 November 2026. The public [country coverage snapshot](https://api.jobopportunitiesapi.org/public/coverage/countries) showed 16,679 live Mexico rows on that date; that is not Chambaleo's verified eligible or unique count.

JOA's free Explore plan has 1,000 records per UTC month and no delta feed. An initial load or subsequent full refresh of 420 jobs can therefore fit once in a month, but a daily 420-row refresh cannot. The free closure and withdrawal ID feeds are unmetered; they can deactivate jobs but do not deliver changed job rows. Growth and higher plans include the metered `/v1/changes` feed for incremental creates/updates and retractions. Do not schedule JOA full pulls or writes on the free plan. The adapter checks remaining records without returning job rows and caps each fetch/change poll at 420 records (or the smaller remaining allowance). The exact eligible/valid/unique count is only for the rows fetched; counting the entire Mexico corpus would exceed the free plan.

`JOA_API_KEY` is a GitHub Actions repository secret; it is only injected into the server-side manual validation step and is never placed in client code or committed. Run **Actions → Chambaleo Job Bot → Run workflow**, leave `write` unchecked, and select `joa_dry_run` to validate at most 420 records. This does not write to Supabase. Review the run's fetched, Mexico, valid, duplicate, unique, and quota counts before any import. The existing scheduled Clara/Kavak workflow is unchanged; JOA has no scheduled job or automatic writes.

Before any JOA write, apply [the posted-date SQL prerequisite](./scripts/ai-job-bot/add-posted-at.sql) in Supabase; it adds only `posted_at` to `public.external_vacancies`. Then run a fresh dry-run, review the output and remaining quota, and only then run `node scripts/ai-job-bot/import.mjs --write --target 420 --max-records 420` with the server-side API and Supabase secrets configured. That initial write creates an ignored local `scripts/ai-job-bot/joa-state.json` with the feed cursors. Persist that state file privately between syncs. On any plan, an expiration/withdrawal check is available with `node scripts/ai-job-bot/import.mjs --expire --write`; on Growth or higher, metered incremental updates use `node scripts/ai-job-bot/import.mjs --changes --write --max-records 420`. Both commands default to dry-run. Do not treat this as a daily refresh promise: the free plan cannot reliably deliver daily edits, and the current Actions workflow does not persist the cursor file or run JOA writes. Confirm JOA's current plan and allowance in its dashboard before each fetch.

## Site deployment

The importer workflow does not build or deploy the site. Deploy the site separately through the existing Cloudflare deployment process (or `npm run build:vinext` followed by `npm run deploy:vinext` when deploying from this checkout).
