# Chambaleo Job Bot

Imports Mexico-only job postings from Clara's Greenhouse board and Kavak's Lever board into `public.external_vacancies`. The importer does not fetch logos or photos. Its default mode is a dry run; only `--write` modifies Supabase.

## GitHub Secrets

In the repository, open **Settings → Secrets and variables → Actions → New repository secret** and add:

- `SUPABASE_URL`: the Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the project's service-role key. Keep it as an Actions secret; never use a `NEXT_PUBLIC_` variable or expose it in client code.

The daily 09:00 UTC workflow only validates sources. To write manually, run **Actions → Chambaleo Job Bot → Run workflow**, inspect the dry-run step, and select the `write` option. Writes are otherwise disabled.

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

## Site deployment

The importer workflow does not build or deploy the site. Deploy the site separately through the existing Cloudflare deployment process (or `npm run build:vinext` followed by `npm run deploy:vinext` when deploying from this checkout).
