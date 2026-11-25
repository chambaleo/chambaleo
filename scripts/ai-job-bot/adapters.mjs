const ATS_HOSTS = {
  ashby: "jobs.ashbyhq.com",
  greenhouse: "boards.greenhouse.io",
  lever: "jobs.lever.co",
};

const JOA_API = "https://api.jobopportunitiesapi.org";
const JOA_MAX_PAGE_SIZE = 200;

function getBoardName(source) {
  const expectedHost = ATS_HOSTS[source.ats];
  if (!expectedHost) throw new Error("Unsupported ATS: " + source.ats);

  let url;
  try {
    url = new URL(source.sourceUrl);
  } catch {
    throw new Error("Source URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== expectedHost ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Source URL must be an HTTPS " + expectedHost + " board URL");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 1) throw new Error("Source URL must identify one ATS board");
  return parts[0];
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  try {
    return await response.json();
  } catch {
    throw new Error("Invalid JSON response");
  }
}

async function getJoaJson(fetchImpl, url, key) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + key,
      },
    });

    if (response.ok) {
      try {
        return {
          body: await response.json(),
          headers: response.headers,
        };
      } catch {
        throw new Error("JOA API returned invalid JSON");
      }
    }

    let detail = "";
    let payload = {};

    try {
      payload = await response.json();
      detail = String(payload?.error || payload?.message || "");
    } catch {}

    const retryAfter = response.headers?.get?.("Retry-After");

    if (response.status === 429 && attempt < 3) {
      const seconds = Number(retryAfter);
      const date = retryAfter ? Date.parse(retryAfter) : NaN;
      const match = detail.match(/retry\s+after\s+(\d+)\s*s/i);

      let delay = 35 * (attempt + 1);

      if (retryAfter && Number.isFinite(seconds)) {
        delay = seconds + 3;
      } else if (Number.isFinite(date)) {
        delay = Math.ceil((date - Date.now()) / 1000) + 3;
      } else if (match) {
        delay = Number(match[1]) + 3;
      }

      // Do not retry earlier than the provider explicitly permits.
      // A long Retry-After should defer the sync, not tie up GitHub Actions.
      if (delay > 180) {
        throw new Error(
          "JOA API HTTP 429: retry after " + Math.ceil(delay) +
          "s exceeds the safe 180s retry window; stopping this sync without advancing cursors"
        );
      }
      delay = Math.max(2, delay);

      console.log(
        "JOA HTTP 429: waiting " + delay +
        "s before retry " + (attempt + 1) + "/3"
      );

      await new Promise(
        resolve => setTimeout(resolve, delay * 1000)
      );
      continue;
    }

    throw new Error(
      "JOA API HTTP " + response.status +
      (detail ? " " + detail : "") +
      (response.status === 402 ? " quota exhausted" : "") +
      (retryAfter ? "; retry after " + retryAfter : "")
    );
  }
}

function assertJoaSource(source) {
  if (source.ats !== "joa" || source.sourceUrl !== JOA_API + "/v1/jobs") {
    throw new Error("JOA source URL or adapter type is invalid");
  }
}

async function getJoaEstimate(fetchImpl, key) {
  const url = new URL(JOA_API + "/v1/me/export-estimate");
  url.searchParams.set("country", "MX");
  url.searchParams.set("source_type", "ats,career_site");
  const { body: estimate } = await getJoaJson(fetchImpl, url, key);
  if (!Number.isInteger(estimate?.remaining_this_month) || estimate.remaining_this_month < -1) {
    throw new Error("JOA API returned an invalid monthly records estimate");
  }
  if (estimate.remaining_this_month === -1 && estimate.remaining_unlimited !== true) {
    throw new Error("JOA API did not identify an unlimited monthly allowance");
  }
  return {
    estimatedRows: Number.isInteger(estimate.estimated_rows) ? estimate.estimated_rows : null,
    remaining: estimate.remaining_this_month,
    unlimited: estimate.remaining_unlimited === true,
  };
}

async function fetchJoaExitFeed(fetchImpl, kind, initialSince, key, limit) {
  const ids = new Set();
  let since = initialSince;
  for (;;) {
    const url = new URL(JOA_API + "/v1/jobs/" + kind);
    if (kind === "withdrawn") url.searchParams.set("country", "MX");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("since", since);
    const { body: page } = await getJoaJson(fetchImpl, url, key);
    if (!Array.isArray(page?.data) || !Number.isInteger(page.count) || typeof page.next_since !== "string") {
      throw new Error("JOA " + kind + " feed returned an invalid page");
    }
    if (page.count !== page.data.length || page.data.length > limit) {
      throw new Error("JOA " + kind + " feed count did not match its page");
    }
    for (const row of page.data) {
      if (typeof row?.id !== "string" || !row.id.trim()) {
        throw new Error("JOA " + kind + " feed returned an invalid job id");
      }
      ids.add(row.id);
    }
    if (page.count < limit) return { ids: [...ids], nextSince: page.next_since };
    if (page.next_since === since) throw new Error("JOA " + kind + " feed repeated its pagination cursor");
    since = page.next_since;
  }
}

export async function fetchJoaExitFeeds(fetchImpl = fetch, {
  expiredSince,
  withdrawnSince,
  limit = 1000,
} = {}) {
  const key = process.env.JOA_API_KEY;
  if (typeof key !== "string" || !key.trim()) {
    throw new Error("JOA_API_KEY is not set; configure it as a server-side environment secret");
  }
  if (typeof expiredSince !== "string" || !expiredSince || typeof withdrawnSince !== "string" || !withdrawnSince) {
    throw new Error("Both persisted JOA expiration cursors are required");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
    throw new Error("JOA expiration page size must be from 1 to 10000");
  }
  const expired = await fetchJoaExitFeed(fetchImpl, "expired", expiredSince, key.trim(), limit);
  const withdrawn = await fetchJoaExitFeed(fetchImpl, "withdrawn", withdrawnSince, key.trim(), limit);
  return { expired, withdrawn };
}

export function calculateJoaBudget({
  maxRecords,
  remaining,
  unlimited = false,
  quotaUsed = 0,
  monthlyLimit = 1000,
  reserve = 100,
}) {
  for (const [label, value] of Object.entries({ maxRecords, quotaUsed, monthlyLimit, reserve })) {
    if (!Number.isInteger(value) || value < 0) throw new Error("JOA " + label + " must be a non-negative integer");
  }
  if (maxRecords < 1 || monthlyLimit < 1 || reserve >= monthlyLimit) {
    throw new Error("JOA record limits are invalid");
  }
  if (!unlimited && (!Number.isInteger(remaining) || remaining < 0)) {
    throw new Error("JOA remaining monthly records are invalid");
  }
  const reportedRemaining = unlimited ? monthlyLimit : remaining;
  const locallyAvailable = Math.max(0, monthlyLimit - quotaUsed);
  const remainingAfterReserve = Math.max(0, Math.min(reportedRemaining, locallyAvailable) - reserve);
  return Math.min(maxRecords, remainingAfterReserve);
}

async function fetchJoaJobs(fetchImpl, source, {
  listedAfter,
  cursor = null,
  maxRecords = 10,
  quotaUsed = 0,
  monthlyLimit = 1000,
  reserve = 100,
} = {}) {
  assertJoaSource(source);
  const key = process.env.JOA_API_KEY;
  if (typeof key !== "string" || !key.trim()) {
    throw new Error("JOA_API_KEY is not set; configure it as a server-side environment secret");
  }
  if (typeof listedAfter !== "string" || !listedAfter || Number.isNaN(Date.parse(listedAfter))) {
    throw new Error("A persisted JOA listed_after timestamp is required");
  }
  const estimate = await getJoaEstimate(fetchImpl, key.trim());
  const safeBudget = calculateJoaBudget({
    maxRecords: monthlyLimit,
    remaining: estimate.remaining,
    unlimited: estimate.unlimited,
    quotaUsed,
    monthlyLimit,
    reserve,
  });
  const budget = Math.min(maxRecords, safeBudget);
  const jobs = [];
  let nextCursor = cursor;
  let hasMore = true;
  let recordsCharged = 0;

  while (jobs.length < budget) {
    const pageSize = Math.min(JOA_MAX_PAGE_SIZE, budget - jobs.length);
    const url = new URL(JOA_API + "/v1/jobs");
    url.searchParams.set("country", "MX");
    url.searchParams.set("status", "live");
    url.searchParams.set("source_type", "ats,career_site");
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("listed_after", listedAfter);
    if (nextCursor) url.searchParams.set("cursor", nextCursor);

    const { body: page, headers } = await getJoaJson(fetchImpl, url, key.trim());
    if (!Array.isArray(page?.data) || typeof page.has_more !== "boolean") {
      throw new Error("JOA API returned an invalid jobs page");
    }
    if (page.data.length > pageSize) throw new Error("JOA API exceeded the requested page size");
    const chargedHeader = headers?.get?.("X-JOA-Records-Charged");
    const charged = chargedHeader === null || chargedHeader === undefined ? null : Number(chargedHeader);
    recordsCharged += Number.isInteger(charged) && charged >= 0 ? charged : page.data.length;
    hasMore = page.has_more;
    for (const job of page.data) {
      if (!job || typeof job.id !== "string" || !job.id.trim()) {
        throw new Error("JOA API returned a job without a valid id");
      }
      jobs.push(job);
    }
    if (!page.has_more) break;
    if (typeof page.next_cursor !== "string" || !page.next_cursor) {
      throw new Error("JOA API indicated more jobs without a next_cursor");
    }
    if (page.next_cursor === nextCursor) throw new Error("JOA API repeated its pagination cursor");
    nextCursor = page.next_cursor;
  }

  return {
    jobs,
    nextCursor: hasMore ? nextCursor : null,
    hasMore,
    quota: {
      ...estimate,
      budget,
      fetched: jobs.length,
      recordsCharged,
      capped: hasMore,
    },
  };
}

function validateJobs(jobs, company) {
  if (!Array.isArray(jobs)) throw new Error(company + ": invalid jobs response");
  return jobs;
}

function greenhouseAdapter(fetchImpl) {
  return {
    async fetch(source) {
      const board = getBoardName(source);
      const data = await getJson(
        fetchImpl,
        "https://boards-api.greenhouse.io/v1/boards/" + encodeURIComponent(board) + "/jobs",
      );
      return validateJobs(data?.jobs, source.company);
    },
  };
}

function leverAdapter(fetchImpl) {
  return {
    async fetch(source) {
      const board = getBoardName(source);
      const jobs = [];
      const ids = new Set();
      for (let offset = 0; ; ) {
        const url = new URL("https://api.lever.co/v0/postings/" + encodeURIComponent(board));
        url.searchParams.set("mode", "json");
        url.searchParams.set("limit", "100");
        url.searchParams.set("skip", String(offset));
        const page = validateJobs(await getJson(fetchImpl, url), source.company);
        for (const job of page) {
          if (job?.id == null || ids.has(String(job.id))) {
            throw new Error(source.company + ": missing or repeated Lever job ID");
          }
          ids.add(String(job.id));
        }
        jobs.push(...page);
        if (page.length < 100) return jobs;
        offset += page.length;
      }
    },
  };
}

function ashbyAdapter(fetchImpl) {
  return {
    async fetch(source) {
      const board = getBoardName(source);
      const url = "https://api.ashbyhq.com/posting-api/job-board/" + encodeURIComponent(board) + "?includeCompensation=false";
      const data = await getJson(fetchImpl, url);
      return validateJobs(data?.jobs, source.company);
    },
  };
}

export function createAdapters(fetchImpl = fetch) {
  return {
    ashby: ashbyAdapter(fetchImpl),
    greenhouse: greenhouseAdapter(fetchImpl),
    lever: leverAdapter(fetchImpl),
    joa: {
      async fetch(source, options) {
        return fetchJoaJobs(fetchImpl, source, options);
      },
    },
  };
}

export function getBoardNameForSource(source) {
  return getBoardName(source);
}

export { fetchJoaJobs };
