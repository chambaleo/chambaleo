import { pathToFileURL } from "node:url";
import { getJobBotDatabase } from "../job-bot/supabase.mjs";
import {
  deactivateJobs,
  deduplicateJobs,
  deduplicateAgainstExisting,
  isSourceAuthorized,
  normalizeJob,
  readExistingVacancies,
  readSources,
  writeJobs,
} from "./import.mjs";
import { createAdapters, fetchJoaExitFeeds } from "./adapters.mjs";
import { getUtcQuotaMonth, readJoaSyncState, writeJoaSyncState } from "./sync-state.mjs";

const SOURCE_KEY = "jobopportunitiesapi:joa";
const MONTHLY_LIMIT = 1000;
const RESERVE = 100;
const DEFAULT_DAILY_MAX = 10;
const RECOVERY_DAILY_MAX = 50;
const ACTIVE_MINIMUM = 300;
const ACTIVE_MAXIMUM = 500;

function getCurrentState(prior, now) {
  const timestamp = now.toISOString();
  const quotaMonth = getUtcQuotaMonth(now);
  const sameMonth = prior?.quota_month === quotaMonth;
  return {
    listing_since: prior?.listing_since || timestamp,
    listing_cursor: prior?.listing_cursor || null,
    expired_since: prior?.expired_since || timestamp,
    withdrawn_since: prior?.withdrawn_since || timestamp,
    quota_month: quotaMonth,
    quota_used: sameMonth ? prior.quota_used : 0,
    last_successful_run: prior?.last_successful_run || null,
  };
}

function validateState(state) {
  if (!Number.isInteger(state.quota_used) || state.quota_used < 0 || state.quota_used > MONTHLY_LIMIT) {
    throw new Error("Stored JOA monthly quota usage is invalid");
  }
}

export async function runDailyJoaSync({
  database,
  fetchImpl = fetch,
  write = false,
  now = new Date(),
  sources,
} = {}) {
  const startedAt = now.toISOString();
  if (!database) database = getJobBotDatabase();
  const source = (sources || await readSources()).find((item) => item.ats === "joa");
  if (!isSourceAuthorized(source)) throw new Error("JOA source is not approved and authorized");

  const prior = await readJoaSyncState(database);
  const state = getCurrentState(prior, now);
  validateState(state);
  if (write) await writeJoaSyncState(database, state);

  const feeds = await fetchJoaExitFeeds(fetchImpl, {
    expiredSince: state.expired_since,
    withdrawnSince: state.withdrawn_since,
  });
  const exitIds = [...new Set([...feeds.expired.ids, ...feeds.withdrawn.ids])];

  const existing = await readExistingVacancies(database);
  const activeCount = existing.uniqueCount;
  const requestedMax = activeCount >= ACTIVE_MAXIMUM
    ? 0
    : activeCount < ACTIVE_MINIMUM
      ? RECOVERY_DAILY_MAX
      : DEFAULT_DAILY_MAX;
  let fetched = {
    jobs: [],
    nextCursor: state.listing_cursor,
    hasMore: false,
    quota: { remaining: null, budget: 0, fetched: 0, recordsCharged: 0, capped: false },
  };

  if (requestedMax > 0) {
    fetched = await createAdapters(fetchImpl).joa.fetch(source, {
      listedAfter: state.listing_since,
      cursor: state.listing_cursor,
      maxRecords: requestedMax,
      fallbackMaxRecords: DEFAULT_DAILY_MAX,
      quotaUsed: state.quota_used,
      monthlyLimit: MONTHLY_LIMIT,
      reserve: RESERVE,
    });
  }

  const normalized = [];
  for (const job of fetched.jobs) {
    const result = normalizeJob(source, job);
    if (result.status === "accepted" && result.job.company_name) normalized.push(result.job);
  }
  const eligible = normalized.length;
  const [withinBatch] = deduplicateJobs([{ jobs: normalized }]);
  const uniqueJobs = deduplicateAgainstExisting(withinBatch.jobs, existing);
  const uniqueCount = uniqueJobs.length;

  if (write && fetched.quota.remaining !== null) {
    const providerUsage = fetched.quota.unlimited
      ? 0
      : Math.max(0, MONTHLY_LIMIT - fetched.quota.remaining);
    state.quota_used = Math.min(
      MONTHLY_LIMIT,
      Math.max(state.quota_used, providerUsage) + fetched.quota.recordsCharged,
    );
    await writeJoaSyncState(database, state);
  } else if (write && fetched.quota.recordsCharged > 0) {
    state.quota_used = Math.min(MONTHLY_LIMIT, state.quota_used + fetched.quota.recordsCharged);
    await writeJoaSyncState(database, state);
  }

  if (write) {
    await writeJobs(database, uniqueJobs);
    await deactivateJobs(database, exitIds);
    state.expired_since = feeds.expired.nextSince;
    state.withdrawn_since = feeds.withdrawn.nextSince;
    if (fetched.quota.budget > 0) {
      state.listing_since = fetched.hasMore ? state.listing_since : startedAt;
      state.listing_cursor = fetched.hasMore ? fetched.nextCursor : null;
    }
    state.last_successful_run = new Date().toISOString();
    await writeJoaSyncState(database, state);
  }

  const result = {
    status: write ? "written" : "dry-run",
    activeBefore: activeCount,
    expiredCount: feeds.expired.ids.length,
    withdrawnCount: feeds.withdrawn.ids.length,
    fetched: fetched.jobs.length,
    eligible,
    unique: uniqueCount,
    duplicateCount: eligible - uniqueCount,
    quota: fetched.quota,
    nextCursor: fetched.nextCursor,
    hasMore: fetched.hasMore,
    lastSuccessfulRun: state.last_successful_run,
  };
  console.log(
    `JOA ${result.status}: active=${activeCount}, received=${result.fetched}, unique=${result.unique}, ` +
    `exit IDs=${exitIds.length}, record budget=${fetched.quota.budget}, ` +
    `remaining before listing fetch=${fetched.quota.remaining ?? "not checked"}.`,
  );
  if (!write) console.log("DRY RUN: no JOA rows, cursors, or quota state were written to Supabase.");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const write = process.argv.slice(2).includes("--write");
  const invalid = process.argv.slice(2).filter((argument) => !["--write", "--dry-run"].includes(argument));
  if (invalid.length) {
    console.error("Usage: node scripts/ai-job-bot/daily.mjs [--dry-run | --write]");
    process.exitCode = 2;
  } else {
    runDailyJoaSync({ write }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
