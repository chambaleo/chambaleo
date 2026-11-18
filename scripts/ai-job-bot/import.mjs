import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getJobBotDatabase } from "../job-bot/supabase.mjs";
import { createAdapters, fetchJoaChanges, fetchJoaExitFeeds } from "./adapters.mjs";

const SOURCES_PATH = new URL("./sources.json", import.meta.url);
const DEFAULT_AUDIT_PATH = new URL("./audit.jsonl", import.meta.url);
const DEFAULT_STATE_PATH = new URL("./joa-state.json", import.meta.url);
const DEFAULT_TARGET = 420;
const OVERALL_TARGET = 500;
const JOA_SOURCE = "jobopportunitiesapi:joa";
const JOA_ATTRIBUTION = {
  text: "Data: Job Opportunities API",
  url: "https://jobopportunitiesapi.org",
};
const MEXICO_LOCATION = /\b(?:mexico|cdmx|ciudad de mexico|mexico city|guadalajara|monterrey|jalisco|nuevo leon|queretaro|puebla|toluca|tijuana|merida|yucatan|oaxaca|chihuahua|guanajuato|san luis potosi|aguascalientes|morelia|michoacan|hermosillo|sonora|saltillo|coahuila|veracruz|tabasco|chiapas|durango|zacatecas|campeche|colima|nayarit|sinaloa|tamaulipas|tlaxcala|hidalgo|guerrero|baja california(?: sur)?|quintana roo|estado de mexico)\b/i;
const REMOTE = /\b(?:remote|remoto|remota|telecommute|teletrabajo)\b/i;
const HYBRID = /\b(?:hybrid|hibrido|hibrida)\b/i;
const SOURCE_PREFIX = "ai-job-bot:";

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function isMexicoLocation(location) {
  return MEXICO_LOCATION.test(normalizeText(location));
}

export function isHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function hasAuthorizationEvidence(source) {
  if (source.ats === "joa") {
    const record = source.authorizationRecord;
    return Boolean(
      record &&
        typeof record === "object" &&
        record.type === "commercial-terms" &&
        record.termsUrl === "https://jobopportunitiesapi.org/terms" &&
        record.termsLastUpdated === "2026-11-16" &&
        record.verifiedAt === "2026-11-18" &&
        record.commercialDisplay === true &&
        record.storage === true &&
        record.attribution?.text === JOA_ATTRIBUTION.text &&
        record.attribution?.url === JOA_ATTRIBUTION.url,
    );
  }
  const record = source.authorizationRecord;
  if (typeof record === "string" && record.trim()) return true;
  if (!record || typeof record !== "object") return false;
  if (isHttpsUrl(record.permissionUrl)) return true;
  return typeof record.writtenApproval === "string" && record.writtenApproval.trim().length > 0;
}

export function isSourceAuthorized(source) {
  return Boolean(
    source &&
      source.enabled === true &&
      source.permission === "approved" &&
      typeof source.company === "string" &&
      source.company.trim() &&
      isHttpsUrl(source.sourceUrl) &&
      ["ashby", "greenhouse", "lever", "joa"].includes(source.ats) &&
      hasAuthorizationEvidence(source),
  );
}

function getAuthorizationRecord(source) {
  const record = source.authorizationRecord;
  if (typeof record === "string") return record;
  if (!record || typeof record !== "object") return null;
  return record.permissionUrl || record.writtenApproval || null;
}

function getSourceKey(source) {
  const slug = source.company.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${SOURCE_PREFIX}${slug}:${source.ats}`;
}

function canonicalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ["gh_src", "lever-source", "source", "ref", "referrer"].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${url.pathname}${url.search}`;
}

function getWorkMode(title, location, workplaceType = "") {
  const text = `${title || ""} ${location || ""} ${workplaceType || ""}`;
  if (REMOTE.test(text)) return "Remoto";
  if (HYBRID.test(text)) return "Híbrido";
  if (/\b(?:on[- ]?site|onsite|presencial)\b/i.test(text)) return "Presencial";
  return null;
}

function parseDate(value, milliseconds = false) {
  if (value == null || value === "") return null;
  const date = new Date(milliseconds ? Number(value) : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function shortDescription(value) {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 500) : null;
}

function getJobFields(source, job) {
  if (!job || (typeof job.id !== "string" && typeof job.id !== "number") || !String(job.id).trim()) {
    throw new Error(`${source.company}: job is missing a valid source ID`);
  }
  if (typeof job.title !== "string" || !job.title.trim()) {
    throw new Error(`${source.company}: job is missing a valid title`);
  }

  let location = "";
  let workplaceType = "";
  let applicationUrl;
  let postedAt;
  let description;
  if (source.ats === "joa") {
    if (job.status !== "live" || job.country !== "MX") return null;
    location = typeof job.location === "string" && job.location.trim()
      ? job.location.trim()
      : typeof job.city === "string" && job.city.trim()
        ? job.city.trim()
        : "México";
    workplaceType = job.field_sources?.remote === "published" ? job.remote || "" : "";
    applicationUrl = job.apply_url;
    postedAt = job.field_sources?.posted_at === "published" ? parseDate(job.posted_at) : null;
  } else if (source.ats === "greenhouse") {
    const locations = [
      job.location?.name,
      ...(Array.isArray(job.offices) ? job.offices.flatMap((office) => [office?.name, office?.location]) : []),
    ].filter((value) => typeof value === "string" && value.trim());
    location = locations.join(" · ");
    applicationUrl = job.absolute_url;
    postedAt = parseDate(job.updated_at || job.created_at);
    description = job.content;
  } else if (source.ats === "lever") {
    location = job.categories?.location || "";
    workplaceType = job.workplaceType || "";
    applicationUrl = job.hostedUrl || job.applyUrl;
    postedAt = parseDate(job.createdAt, true);
    description = job.descriptionPlain || job.description;
  } else {
    location = job.location || (Array.isArray(job.locations) ? job.locations.map((item) => item?.name).filter(Boolean).join(" · ") : "");
    workplaceType = job.workplaceType || "";
    applicationUrl = job.applyUrl || job.jobUrl;
    postedAt = parseDate(job.publishedAt);
    description = job.descriptionPlain || job.description;
  }

  return {
    id: String(job.id).trim(),
    title: job.title.trim(),
    location: typeof location === "string" ? location.trim() : "",
    workplaceType: typeof workplaceType === "string" ? workplaceType : "",
    applicationUrl,
    postedAt,
    shortDescription: source.rights?.shortDescription === true ? shortDescription(description) : null,
  };
}

function normalizeJob(source, job) {
  if (source.ats === "joa") {
    const fields = getJobFields(source, job);
    if (!fields) return { status: "outside-mexico" };
    if (!fields.id || !fields.title || !fields.location) {
      return { status: "invalid-job", error: "JOA job is missing its ID, title, or location" };
    }
    if (!isHttpsUrl(fields.applicationUrl)) {
      return { status: "invalid-url", error: `Invalid HTTPS application URL for JOA job ${fields.id}` };
    }
    return {
      status: "accepted",
      job: {
        source: JOA_SOURCE,
        external_job_id: fields.id,
        company_name: typeof job.company === "string" ? job.company.trim() : "",
        job_title: fields.title,
        location: fields.location,
        work_mode: fields.workplaceType === "remote" ? "Remoto"
          : fields.workplaceType === "hybrid" ? "Híbrido"
            : fields.workplaceType === "on_site" ? "Presencial" : null,
        application_url: fields.applicationUrl,
        posted_at: fields.postedAt,
      },
    };
  }
  const fields = getJobFields(source, job);
  if (!isMexicoLocation(fields.location)) return { status: "outside-mexico" };
  if (!isHttpsUrl(fields.applicationUrl)) {
    return { status: "invalid-url", error: `Invalid HTTPS application URL for job ${fields.id}` };
  }
  return {
    status: "accepted",
    job: {
      source: getSourceKey(source),
      external_job_id: fields.id,
      company_name: source.company.trim(),
      job_title: fields.title,
      location: fields.location,
      work_mode: getWorkMode(fields.title, fields.location, fields.workplaceType),
      application_url: fields.applicationUrl,
      posted_at: fields.postedAt,
      short_description: fields.shortDescription,
    },
  };
}

function deduplicateJobs(results) {
  const seenUrls = new Set();
  const seenContent = new Set();
  for (const result of results) {
    result.uniqueCount = 0;
    result.jobs = result.jobs.filter((job) => {
      const urlKey = canonicalizeUrl(job.application_url);
      const contentKey = `${job.company_name.toLowerCase()}|${job.job_title.toLowerCase()}|${job.location.toLowerCase()}`;
      if (seenUrls.has(urlKey) || seenContent.has(contentKey)) return false;
      seenUrls.add(urlKey);
      seenContent.add(contentKey);
      result.uniqueCount += 1;
      return true;
    });
  }
  return results;
}

async function readAllRows(database, table, columns, configure = (query) => query) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await configure(database.from(table).select(columns))
      .range(offset, offset + 999);
    if (error) throw new Error(`Could not read existing ${table} rows: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function readExistingVacancies(database) {
  const now = new Date().toISOString();
  const [external, manual] = await Promise.all([
    readAllRows(database, "external_vacancies", "id,source,external_job_id,application_url", (query) => query.eq("is_active", true)),
    readAllRows(database, "vacancies", "id,application_method,application_value,status,expires_at", (query) =>
      query.eq("status", "approved").or(`expires_at.is.null,expires_at.gt.${now}`),
    ),
  ]);
  const urls = new Set();
  const urlOwners = new Map();
  const ids = new Set();
  const existingKeys = new Set();
  for (const row of external) {
    const owner = row.source === JOA_SOURCE && row.external_job_id
      ? `joa:${row.external_job_id}`
      : `external:${row.source}:${row.external_job_id || row.id}`;
    if (row.source === JOA_SOURCE && row.external_job_id) ids.add(String(row.external_job_id));
    if (isHttpsUrl(row.application_url)) {
      const url = canonicalizeUrl(row.application_url);
      urls.add(url);
      existingKeys.add(`url:${url}`);
      if (!urlOwners.has(url)) urlOwners.set(url, new Set());
      urlOwners.get(url).add(owner);
    } else {
      existingKeys.add(`external:${row.source}:${row.external_job_id || row.id}`);
    }
  }
  for (const row of manual) {
    if (row.application_method === "external_url" && isHttpsUrl(row.application_value)) {
      const url = canonicalizeUrl(row.application_value);
      urls.add(url);
      existingKeys.add(`url:${url}`);
      if (!urlOwners.has(url)) urlOwners.set(url, new Set());
      urlOwners.get(url).add(`manual:${row.id}`);
    } else {
      existingKeys.add(`manual:${row.id}`);
    }
  }
  return {
    externalCount: external.length,
    manualCount: manual.length,
    uniqueCount: existingKeys.size,
    urls,
    urlOwners,
    ids,
  };
}

function deduplicateAgainstExisting(jobs, existing, updatingIds = new Set()) {
  if (!existing) return jobs;
  const seenIds = new Set(existing.ids);
  return jobs.filter((job) => {
    const url = canonicalizeUrl(job.application_url);
    const sameIdOwner = `joa:${job.external_job_id}`;
    const isUrlDuplicate = [...(existing.urlOwners.get(url) || [])]
      .some((owner) => owner !== sameIdOwner || !updatingIds.has(job.external_job_id));
    if (isUrlDuplicate || (job.source === JOA_SOURCE && seenIds.has(job.external_job_id) && !updatingIds.has(job.external_job_id))) return false;
    seenIds.add(job.external_job_id);
    return true;
  });
}

async function readSources(path = SOURCES_PATH) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("sources.json must contain an array");
  return parsed;
}

async function readPreviousAudit(auditPath) {
  try {
    const content = await readFile(auditPath, "utf8");
    const latest = new Map();
    for (const line of content.split("\n").filter(Boolean)) {
      try {
        const item = JSON.parse(line);
        if (item.source_key) latest.set(item.source_key, item);
      } catch {
        // Ignore an incomplete final audit line; earlier records remain usable.
      }
    }
    return latest;
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
}

async function readSyncState(statePath) {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (
      typeof state?.expired_since !== "string" ||
      typeof state?.withdrawn_since !== "string" ||
      !state.expired_since ||
      !state.withdrawn_since
    ) {
      throw new Error("JOA state file must contain expired_since and withdrawn_since cursors");
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeSyncState(statePath, state) {
  const path = fileURLToPath(statePath);
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function writeJobs(database, jobs) {
  for (let offset = 0; offset < jobs.length; offset += 100) {
    const batch = jobs.slice(offset, offset + 100).map((job) => {
      return { ...job, is_active: true, last_seen_at: new Date().toISOString() };
    });
    const { error } = await database.from("external_vacancies").upsert(batch, {
      onConflict: "source,external_job_id",
    });
    if (error) throw new Error(error.message || "Supabase upsert failed");
  }
}

function auditRecord(source, previous, result, timestamp) {
  const successful = !result.error;
  return {
    timestamp,
    source_key: getSourceKey(source),
    company: source.company,
    source_url: source.sourceUrl || null,
    ats: source.ats,
    permission_status: source.permission || "unknown",
    enabled: source.enabled === true,
    authorization_record: getAuthorizationRecord(source),
    last_successful_sync: successful ? timestamp : previous?.last_successful_sync || null,
    fetched_count: result.fetchedCount || 0,
    mexico_count: result.mexicoCount || 0,
    valid_count: result.validCount || 0,
    unique_count: result.uniqueCount || 0,
    quota: result.quota || null,
    errors: result.error ? [result.error] : result.errors || [],
    status: result.status,
  };
}

export async function runSync({
  sources,
  fetchImpl = fetch,
  adapters = createAdapters(fetchImpl),
  write = false,
  database,
  auditPath = DEFAULT_AUDIT_PATH,
  statePath = DEFAULT_STATE_PATH,
  target = DEFAULT_TARGET,
  maxRecords = target,
} = {}) {
  const configuredSources = sources || (await readSources());
  if (!Number.isInteger(target) || target < 1) throw new Error("Target must be a positive integer");
  if (!Number.isInteger(maxRecords) || maxRecords < 1) throw new Error("Maximum JOA records must be a positive integer");
  const syncStartedAt = new Date().toISOString();
  const priorState = await readSyncState(statePath);
  const previousAudit = await readPreviousAudit(auditPath);
  const results = [];
  let existing = null;
  const hasDatabaseCredentials = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (database || write || hasDatabaseCredentials) {
    try {
      if (!database) database = getJobBotDatabase();
      existing = await readExistingVacancies(database);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Existing-vacancy read failed: ${message}`);
      if (configuredSources.some((source) => source.ats === "joa" && isSourceAuthorized(source))) {
        throw new Error(`Cannot safely deduplicate JOA jobs: ${message}`);
      }
      if (write) throw error;
    }
  }

  for (const source of configuredSources) {
    if (!isSourceAuthorized(source)) {
      results.push({ source, status: "blocked", error: "Source is not approved, enabled, and documented for authorized access", fetchedCount: 0, mexicoCount: 0, uniqueCount: 0, jobs: [] });
      continue;
    }
    try {
      const adapter = adapters[source.ats];
      if (!adapter || typeof adapter.fetch !== "function") throw new Error(`No adapter registered for ATS ${source.ats}`);
      const fetched = await adapter.fetch(source, source.ats === "joa" ? { maxRecords } : undefined);
      const fetchedJobs = source.ats === "joa" ? fetched?.jobs : fetched;
      if (!Array.isArray(fetchedJobs)) throw new Error("Adapter returned an invalid jobs collection");
      const jobs = [];
      let mexicoCount = 0;
      const errors = [];
      for (const fetchedJob of fetchedJobs) {
        const isJoaMexicoJob = source.ats === "joa" &&
          fetchedJob?.country === "MX" &&
          fetchedJob?.status === "live";
        if (isJoaMexicoJob) mexicoCount += 1;
        try {
          const normalized = normalizeJob(source, fetchedJob);
          if (normalized.status === "outside-mexico") continue;
          if (!isJoaMexicoJob) mexicoCount += 1;
          if (normalized.status === "invalid-url" || normalized.status === "invalid-job") {
            errors.push(normalized.error);
            continue;
          }
          if (!normalized.job.company_name) {
            errors.push(`JOA job ${normalized.job.external_job_id} is missing its employer name`);
            continue;
          }
          jobs.push(normalized.job);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      const uniqueJobs = deduplicateAgainstExisting(jobs, source.ats === "joa" ? existing : null);
      results.push({
        source,
        status: fetched?.quota?.capped ? "capped" : "success",
        fetchedCount: fetchedJobs.length,
        mexicoCount,
        validCount: jobs.length,
        uniqueCount: 0,
        existingDuplicates: jobs.length - uniqueJobs.length,
        errors,
        quota: fetched?.quota || null,
        jobs: uniqueJobs,
      });
    } catch (error) {
      results.push({
        source,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        fetchedCount: 0,
        mexicoCount: 0,
        uniqueCount: 0,
        jobs: [],
      });
    }
  }

  deduplicateJobs(results);
  if (write) {
    try {
      if (!database) database = getJobBotDatabase();
      for (const result of results) {
        if (result.status !== "success" && result.status !== "capped") continue;
        try {
          await writeJobs(database, result.jobs);
        } catch (error) {
          result.error = error instanceof Error ? error.message : String(error);
          result.status = "write-failed";
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const result of results) {
        if (result.status === "success") {
          result.error = message;
          result.status = "write-failed";
        }
      }
    }
  }

  const timestamp = new Date().toISOString();
  const audit = results.map((result) =>
    auditRecord(result.source, previousAudit.get(getSourceKey(result.source)), result, timestamp),
  );
  await appendFile(auditPath, `${audit.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  if (
    write &&
    !results.some((item) => item.source.ats === "joa" && item.status === "write-failed") &&
    results.some((item) => item.source.ats === "joa" && ["success", "capped"].includes(item.status))
  ) {
    const cursor = priorState?.expired_since || syncStartedAt;
    await writeSyncState(statePath, {
      expired_since: cursor,
      withdrawn_since: priorState?.withdrawn_since || syncStartedAt,
      changes_since: priorState?.changes_since || syncStartedAt,
      seeded_at: priorState?.seeded_at || syncStartedAt,
    });
  }

  const uniqueCount = results.reduce((sum, item) => sum + item.uniqueCount, 0);
  console.log(`AI Job Bot: ${uniqueCount}/${target} additional active unique-job target`);
  if (existing) {
    console.log(`Existing active jobs read-only: ${existing.externalCount} external + ${existing.manualCount} manual listings; ${existing.uniqueCount} unique by URL/record ID.`);
    const projectedTotal = existing.uniqueCount + uniqueCount;
    console.log(`Projected active unique total: ${projectedTotal}/${OVERALL_TARGET}; ${Math.max(0, OVERALL_TARGET - projectedTotal)} short of the overall goal (based only on fetched candidates).`);
  } else if (configuredSources.some((source) => source.ats === "joa" && isSourceAuthorized(source))) {
    console.log("Existing-vacancy deduplication and the 500-job total: unverified (Supabase read credentials not configured).");
  }
  for (const item of audit) {
    const quotaText = item.quota
      ? `; record budget=${item.quota.budget}, remaining before fetch=${item.quota.remaining}, Mexico estimate=${item.quota.estimatedRows ?? "unknown"}, matching total=${item.quota.totalEstimate ?? "unknown"} (${item.quota.totalEstimateStatus || "no estimate"})`
      : "";
    console.log(`- ${item.company} (${item.ats}): ${item.status}; fetched=${item.fetched_count}, Mexico=${item.mexico_count}, valid=${item.valid_count ?? 0}, unique=${item.unique_count}${quotaText}${item.errors.length ? `; errors=${item.errors.join("; ")}` : ""}`);
  }
  if (!write) console.log("DRY RUN: Supabase was not modified. Review counts and use --write explicitly to upsert permitted jobs.");
  else if (results.some((item) => item.status === "write-failed")) console.log("Supabase upsert-only run finished with write errors.");
  else console.log("Supabase write phase completed; unsuccessful sources were skipped.");
  return { results, audit, uniqueCount, target };
}

async function deactivateJobs(database, ids) {
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { error } = await database
      .from("external_vacancies")
      .update({ is_active: false })
      .eq("source", JOA_SOURCE)
      .eq("is_active", true)
      .in("external_job_id", ids.slice(offset, offset + 100));
    if (error) throw new Error(`Could not deactivate expired JOA jobs: ${error.message}`);
  }
}

export async function runExpirationSync({
  fetchImpl = fetch,
  database,
  write = false,
  since,
  statePath = DEFAULT_STATE_PATH,
  auditPath = DEFAULT_AUDIT_PATH,
  pageSize = 1000,
} = {}) {
  const priorState = await readSyncState(statePath);
  const firstCursor = priorState?.expired_since || since;
  const secondCursor = priorState?.withdrawn_since || since;
  if (!firstCursor || !secondCursor) {
    throw new Error("No JOA exit-feed cursors found. Use --since RFC3339 on the first expiration sync.");
  }
  const feeds = await fetchJoaExitFeeds(fetchImpl, {
    expiredSince: firstCursor,
    withdrawnSince: secondCursor,
    limit: pageSize,
  });
  const ids = [...new Set([...feeds.expired.ids, ...feeds.withdrawn.ids])];
  if (write) {
    if (!database) database = getJobBotDatabase();
    await deactivateJobs(database, ids);
    await writeSyncState(statePath, {
      expired_since: feeds.expired.nextSince,
      withdrawn_since: feeds.withdrawn.nextSince,
      changes_since: priorState?.changes_since || since,
      seeded_at: priorState?.seeded_at || since || new Date().toISOString(),
    });
  }

  const result = {
    expiredCount: feeds.expired.ids.length,
    withdrawnCount: feeds.withdrawn.ids.length,
    uniqueExitCount: ids.length,
    status: write ? "written" : "dry-run",
  };
  await appendFile(auditPath, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    source_key: getSourceKey({ company: "Job Opportunities API", ats: "joa" }),
    status: result.status,
    expired_count: result.expiredCount,
    withdrawn_count: result.withdrawnCount,
    unique_exit_count: result.uniqueExitCount,
    expired_cursor: feeds.expired.nextSince,
    withdrawn_cursor: feeds.withdrawn.nextSince,
  })}\n`, "utf8");
  console.log(`JOA expiration check: ${result.expiredCount} closed + ${result.withdrawnCount} withdrawn IDs; ${result.uniqueExitCount} unique.`);
  console.log("The provider documents these ID-only feeds as zero-record calls.");
  if (!write) console.log("DRY RUN: no Supabase changes and no cursor advancement; use --write explicitly after review.");
  return result;
}

export async function runChangeSync({
  fetchImpl = fetch,
  database,
  write = false,
  since,
  maxRecords = DEFAULT_TARGET,
  statePath = DEFAULT_STATE_PATH,
  auditPath = DEFAULT_AUDIT_PATH,
} = {}) {
  const priorState = await readSyncState(statePath);
  const cursor = priorState?.changes_since || since;
  if (!cursor) throw new Error("No JOA changes cursor found. Complete an initial --write seed first, or use --since RFC3339.");
  const fetched = await fetchJoaChanges(fetchImpl, { since: cursor, maxRecords });
  const source = { company: "Job Opportunities API", ats: "joa" };
  const jobs = [];
  const exitIds = new Set();
  const errors = [];
  for (const item of fetched.changes) {
    const id = typeof item?.job?.id === "string" ? item.job.id : null;
    if (!id) throw new Error("JOA changes feed returned an event without a job id");
    if (item.change !== "created" && item.change !== "updated") {
      exitIds.add(id);
      continue;
    }
    try {
      const normalized = normalizeJob(source, item.job);
      if (normalized.status !== "accepted") {
        exitIds.add(id);
        if (normalized.error) errors.push(normalized.error);
        continue;
      }
      if (!normalized.job.company_name) {
        exitIds.add(id);
        errors.push(`JOA job ${id} is missing its employer name`);
        continue;
      }
      jobs.push(normalized.job);
    } catch (error) {
      exitIds.add(id);
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const seenJobIds = new Set();
  const seenUrls = new Set();
  const seenContent = new Set();
  const deduplicatedJobs = jobs.filter((job) => {
    if (seenJobIds.has(job.external_job_id)) return false;
    seenJobIds.add(job.external_job_id);
    const url = canonicalizeUrl(job.application_url);
    const content = `${job.company_name.toLowerCase()}|${job.job_title.toLowerCase()}|${job.location.toLowerCase()}`;
    if (seenUrls.has(url) || seenContent.has(content)) {
      exitIds.add(job.external_job_id);
      return false;
    }
    seenUrls.add(url);
    seenContent.add(content);
    return true;
  });

  const dbConfigured = Boolean(database || (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY));
  let existing = null;
  if (write || dbConfigured) {
    if (!database) database = getJobBotDatabase();
    existing = await readExistingVacancies(database);
  }
  const updatingIds = new Set(deduplicatedJobs.map((job) => job.external_job_id));
  const uniqueJobs = deduplicateAgainstExisting(deduplicatedJobs, existing, updatingIds);
  const duplicateIds = new Set(
    deduplicatedJobs.filter((job) => !uniqueJobs.includes(job)).map((job) => job.external_job_id),
  );
  for (const id of duplicateIds) exitIds.add(id);

  if (write) {
    if (!database) database = getJobBotDatabase();
    await writeJobs(database, uniqueJobs);
    await deactivateJobs(database, [...exitIds]);
    await writeSyncState(statePath, {
      expired_since: priorState?.expired_since || cursor,
      withdrawn_since: priorState?.withdrawn_since || cursor,
      changes_since: fetched.nextSince,
      seeded_at: priorState?.seeded_at || since || cursor,
    });
  }

  const result = {
    received: fetched.changes.length,
    eligible: jobs.length,
    unique: uniqueJobs.length,
    retracted: exitIds.size,
    quota: fetched.quota,
    errors,
    status: write ? "written" : "dry-run",
  };
  await appendFile(auditPath, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    source_key: getSourceKey(source),
    status: result.status,
    changes_received: result.received,
    eligible_count: result.eligible,
    unique_count: result.unique,
    retracted_count: result.retracted,
    quota: result.quota,
    errors: result.errors,
    changes_cursor: fetched.nextSince,
  })}\n`, "utf8");
  console.log(`JOA incremental sync: ${result.received} events; ${result.eligible} eligible, ${result.unique} unique upserts, ${result.retracted} retractions; records budget=${result.quota.budget}, remaining before fetch=${result.quota.remaining}.`);
  if (!write) console.log("DRY RUN: no Supabase changes and no cursor advancement; use --write explicitly after review.");
  return result;
}

export async function listPendingSources(sources) {
  const configuredSources = sources || (await readSources());
  return configuredSources.filter((source) => source.permission !== "approved" || source.enabled !== true);
}

function parseArgs(args) {
  let write = false;
  let expire = false;
  let changes = false;
  let since;
  let target = DEFAULT_TARGET;
  let maxRecords = DEFAULT_TARGET;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--write") write = true;
    else if (args[index] === "--dry-run") write = false;
    else if (args[index] === "--expire") expire = true;
    else if (args[index] === "--changes") changes = true;
    else if (args[index] === "--since" && args[index + 1]) since = args[++index];
    else if (args[index] === "--target" && /^\d+$/.test(args[index + 1] || "")) {
      target = Number(args[++index]);
      if (maxRecords === DEFAULT_TARGET) maxRecords = target;
    } else if (args[index] === "--max-records" && /^\d+$/.test(args[index + 1] || "")) {
      maxRecords = Number(args[++index]);
    } else {
      throw new Error("Usage: node scripts/ai-job-bot/import.mjs [--dry-run | --write] [--target N] [--max-records N] [--expire | --changes [--since RFC3339]]");
    }
  }
  if (target < 1 || maxRecords < 1) throw new Error("--target and --max-records must be positive integers");
  if ((expire && changes) || (since && !expire && !changes)) {
    throw new Error("--since requires exactly one of --expire or --changes");
  }
  return { write, expire, changes, since, target, maxRecords };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const run = options.expire
      ? runExpirationSync(options)
      : options.changes
        ? runChangeSync(options)
        : runSync(options);
    run.catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
