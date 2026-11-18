const ATS_HOSTS = {
  ashby: "jobs.ashbyhq.com",
  greenhouse: "boards.greenhouse.io",
  lever: "jobs.lever.co",
};

const JOA_API = "https://api.jobopportunitiesapi.org";
const JOA_MAX_PAGE_SIZE = 200;

function getBoardName(source) {
  const expectedHost = ATS_HOSTS[source.ats];
  if (!expectedHost) throw new Error(`Unsupported ATS: ${source.ats}`);

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
    throw new Error(`Source URL must be an HTTPS ${expectedHost} board URL`);
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
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error("Invalid JSON response");
  }
}

async function getJoaJson(fetchImpl, url, key) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.error || body?.message || "";
    } catch {
      // The HTTP status remains useful when the provider returns no JSON body.
    }
    const retryAfter = response.headers?.get?.("Retry-After");
    const quota = response.status === 402 ? " (monthly record quota exhausted)" : "";
    const retry = retryAfter ? `; retry after ${retryAfter}s` : "";
    throw new Error(`JOA API HTTP ${response.status}${detail ? ` ${detail}` : ""}${quota}${retry}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("JOA API returned invalid JSON");
  }
}

function assertJoaSource(source) {
  if (source.ats !== "joa" || source.sourceUrl !== `${JOA_API}/v1/jobs`) {
    throw new Error("JOA source URL or adapter type is invalid");
  }
}

async function getJoaEstimate(fetchImpl, key) {
  const url = new URL(`${JOA_API}/v1/me/export-estimate`);
  url.searchParams.set("country", "MX");
  url.searchParams.set("source_type", "ats,career_site");
  const estimate = await getJoaJson(fetchImpl, url, key);
  if (!Number.isInteger(estimate?.remaining_this_month) || estimate.remaining_this_month < -1) {
    throw new Error("JOA API returned an invalid monthly records estimate");
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
    const url = new URL(`${JOA_API}/v1/jobs/${kind}`);
    if (kind === "withdrawn") url.searchParams.set("country", "MX");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("since", since);
    const page = await getJoaJson(fetchImpl, url, key);
    if (!Array.isArray(page?.data) || !Number.isInteger(page.count) || typeof page.next_since !== "string") {
      throw new Error(`JOA ${kind} feed returned an invalid page`);
    }
    if (page.count !== page.data.length || page.data.length > limit) {
      throw new Error(`JOA ${kind} feed count did not match its page`);
    }
    for (const row of page.data) {
      if (typeof row?.id !== "string" || !row.id.trim()) {
        throw new Error(`JOA ${kind} feed returned an invalid job id`);
      }
      ids.add(row.id);
    }
    if (page.count < limit) return { ids: [...ids], nextSince: page.next_since };
    if (page.next_since === since) throw new Error(`JOA ${kind} feed repeated its pagination cursor`);
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
  const [expired, withdrawn] = await Promise.all([
    fetchJoaExitFeed(fetchImpl, "expired", expiredSince, key.trim(), limit),
    fetchJoaExitFeed(fetchImpl, "withdrawn", withdrawnSince, key.trim(), limit),
  ]);
  return { expired, withdrawn };
}

export async function fetchJoaChanges(fetchImpl = fetch, { since, maxRecords = 420, pageSize = 500 } = {}) {
  const key = process.env.JOA_API_KEY;
  if (typeof key !== "string" || !key.trim()) {
    throw new Error("JOA_API_KEY is not set; configure it as a server-side environment secret");
  }
  if (typeof since !== "string" || !since) throw new Error("A persisted JOA changes cursor is required");
  if (!Number.isInteger(maxRecords) || maxRecords < 1) throw new Error("JOA record budget must be a positive integer");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 5000) {
    throw new Error("JOA changes page size must be from 1 to 5000");
  }

  const estimate = await getJoaEstimate(fetchImpl, key.trim());
  const budget = estimate.unlimited ? maxRecords : Math.min(maxRecords, estimate.remaining);
  const changes = [];
  let nextSince = since;
  let hasMore = budget === 0;
  while (changes.length < budget) {
    const limit = Math.min(pageSize, budget - changes.length);
    const url = new URL(`${JOA_API}/v1/changes`);
    url.searchParams.set("country", "MX");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("since", nextSince);
    const page = await getJoaJson(fetchImpl, url, key.trim());
    if (!Array.isArray(page?.data) || !Number.isInteger(page.count) || typeof page.next_since !== "string") {
      throw new Error("JOA changes feed returned an invalid page");
    }
    if (page.count !== page.data.length || page.data.length > limit) {
      throw new Error("JOA changes feed count did not match its page");
    }
    if (page.count > 0 && page.next_since === nextSince) {
      throw new Error("JOA changes feed repeated its pagination cursor");
    }
    changes.push(...page.data);
    nextSince = page.next_since;
    hasMore = page.count === limit;
    if (!hasMore) break;
  }
  return {
    changes,
    nextSince,
    quota: { ...estimate, budget, fetched: changes.length, capped: hasMore },
  };
}

async function fetchJoaJobs(fetchImpl, source, { maxRecords = 420 } = {}) {
  assertJoaSource(source);
  const key = process.env.JOA_API_KEY;
  if (typeof key !== "string" || !key.trim()) {
    throw new Error("JOA_API_KEY is not set; configure it as a server-side environment secret");
  }
  if (!Number.isInteger(maxRecords) || maxRecords < 1) {
    throw new Error("JOA record budget must be a positive integer");
  }
  const estimate = await getJoaEstimate(fetchImpl, key.trim());
  const budget = estimate.unlimited ? maxRecords : Math.min(maxRecords, estimate.remaining);
  const jobs = [];
  let cursor = null;
  let hasMore = true;
  let totalEstimate = null;
  let totalEstimateStatus = null;

  while (jobs.length < budget) {
    const pageSize = Math.min(JOA_MAX_PAGE_SIZE, budget - jobs.length);
    const url = new URL(`${JOA_API}/v1/jobs`);
    url.searchParams.set("country", "MX");
    url.searchParams.set("status", "live");
    url.searchParams.set("source_type", "ats,career_site");
    url.searchParams.set("limit", String(pageSize));
    if (cursor) url.searchParams.set("cursor", cursor);
    else url.searchParams.set("include_total", "true");

    const page = await getJoaJson(fetchImpl, url, key.trim());
    if (!Array.isArray(page?.data) || typeof page.has_more !== "boolean") {
      throw new Error("JOA API returned an invalid jobs page");
    }
    if (page.data.length > pageSize) throw new Error("JOA API exceeded the requested page size");
    if (cursor === null) {
      totalEstimate = Number.isInteger(page.total_estimate) ? page.total_estimate : null;
      totalEstimateStatus = page.total_estimate_status || null;
    }
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
    if (page.next_cursor === cursor) throw new Error("JOA API repeated its pagination cursor");
    cursor = page.next_cursor;
  }

  return {
    jobs,
    quota: {
      ...estimate,
      budget,
      fetched: jobs.length,
      capped: hasMore,
      totalEstimate,
      totalEstimateStatus,
    },
  };
}

function validateJobs(jobs, company) {
  if (!Array.isArray(jobs)) throw new Error(`${company}: invalid jobs response`);
  return jobs;
}

function greenhouseAdapter(fetchImpl) {
  return {
    async fetch(source) {
      const board = getBoardName(source);
      const data = await getJson(
        fetchImpl,
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`,
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
        const url = new URL(`https://api.lever.co/v0/postings/${encodeURIComponent(board)}`);
        url.searchParams.set("mode", "json");
        url.searchParams.set("limit", "100");
        url.searchParams.set("skip", String(offset));
        const page = validateJobs(await getJson(fetchImpl, url), source.company);
        for (const job of page) {
          if (job?.id == null || ids.has(String(job.id))) {
            throw new Error(`${source.company}: missing or repeated Lever job ID`);
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
      const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=false`;
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
