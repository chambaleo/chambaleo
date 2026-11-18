import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdapters, fetchJoaChanges, fetchJoaExitFeeds } from "../scripts/ai-job-bot/adapters.mjs";
import { isMexicoLocation, isSourceAuthorized, runChangeSync, runSync } from "../scripts/ai-job-bot/import.mjs";
import { toPublicVacancy } from "../lib/vacancyData.js";

const approvedSource = {
  company: "Job Opportunities API",
  ats: "joa",
  sourceUrl: "https://api.jobopportunitiesapi.org/v1/jobs",
  permission: "approved",
  enabled: true,
  authorizationRecord: {
    type: "commercial-terms",
    termsUrl: "https://jobopportunitiesapi.org/terms",
    termsLastUpdated: "2026-11-16",
    verifiedAt: "2026-11-18",
    commercialDisplay: true,
    storage: true,
    attribution: {
      text: "Data: Job Opportunities API",
      url: "https://jobopportunitiesapi.org",
    },
  },
};

function job(id, overrides = {}) {
  return {
    id,
    title: `Engineer ${id}`,
    company: "Example",
    country: "MX",
    city: "Ciudad de México",
    status: "live",
    apply_url: `https://jobs.example/apply/${id}`,
    posted_at: "2026-11-17T12:00:00.000Z",
    remote: "hybrid",
    field_sources: { posted_at: "published", remote: "published" },
    ...overrides,
  };
}

function response(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] || null },
    async json() { return body; },
  };
}

async function withAudit(testFn) {
  const directory = await mkdtemp(join(tmpdir(), "ai-job-bot-"));
  try {
    await testFn(join(directory, "audit.jsonl"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function withJoaKey(testFn) {
  const previous = process.env.JOA_API_KEY;
  process.env.JOA_API_KEY = "test-key-not-a-real-credential";
  try {
    await testFn();
  } finally {
    if (previous === undefined) delete process.env.JOA_API_KEY;
    else process.env.JOA_API_KEY = previous;
  }
}

function readOnlyDatabase(tables = {}) {
  const writes = [];
  return {
    writes,
    from(table) {
      let rows = tables[table] || [];
      const query = {
        select() { return query; },
        eq(field, value) { rows = rows.filter((row) => row[field] === value); return query; },
        or() { return query; },
        range(start, end) {
          return Promise.resolve({ data: rows.slice(start, end + 1), error: null });
        },
        upsert(batch) { writes.push({ table, batch }); return Promise.resolve({ error: null }); },
      };
      return query;
    },
  };
}

test("authorization requires the verified commercial terms and exact required attribution", () => {
  assert.equal(isSourceAuthorized(approvedSource), true);
  assert.equal(isSourceAuthorized({ ...approvedSource, enabled: false }), false);
  assert.equal(isSourceAuthorized({ ...approvedSource, permission: "pending" }), false);
  assert.equal(isSourceAuthorized({
    ...approvedSource,
    authorizationRecord: { ...approvedSource.authorizationRecord, commercialDisplay: false },
  }), false);
  assert.equal(isSourceAuthorized({
    ...approvedSource,
    authorizationRecord: {
      ...approvedSource.authorizationRecord,
      attribution: { text: "Credit", url: "https://example.test" },
    },
  }), false);
  const employerSource = {
    company: "Employer",
    ats: "greenhouse",
    sourceUrl: "https://boards.greenhouse.io/employer",
    permission: "approved",
    enabled: true,
    authorizationRecord: { writtenApproval: "email approval" },
  };
  assert.equal(isSourceAuthorized(employerSource), true);
  assert.equal(isSourceAuthorized({ ...employerSource, ats: "unsupported" }), false);
});

test("Mexico filter recognizes Mexico-specific location names and excludes generic remote", () => {
  assert.equal(isMexicoLocation("Ciudad de México · Híbrido"), true);
  assert.equal(isMexicoLocation("Remote - Mexico"), true);
  assert.equal(isMexicoLocation("Remote - Latin America"), false);
});

test("JOA pagination sends the bearer key, passes opaque cursors, and honors the record budget", async () => {
  await withJoaKey(async () => {
    const calls = [];
    const fetchImpl = async (input, options) => {
      const url = new URL(input);
      calls.push({ url, options });
      if (url.pathname === "/v1/me/export-estimate") {
        return response({ estimated_rows: 16679, remaining_this_month: 1000, remaining_unlimited: false });
      }
      if (!url.searchParams.has("cursor")) {
        return response({
          data: [job("1"), job("2")],
          next_cursor: "opaque|cursor",
          has_more: true,
          total_estimate: 16679,
          total_estimate_status: "at_least",
        });
      }
      return response({ data: [job("3")], next_cursor: null, has_more: false });
    };

    const result = await createAdapters(fetchImpl).joa.fetch(approvedSource, { maxRecords: 3 });
    assert.equal(result.jobs.length, 3);
    assert.equal(result.quota.fetched, 3);
    assert.equal(result.quota.capped, false);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(({ options }) => options.headers.Authorization === "Bearer test-key-not-a-real-credential"));
    const pages = calls.filter(({ url }) => url.pathname === "/v1/jobs");
    assert.ok(pages.every(({ url }) => url.searchParams.get("country") === "MX"));
    assert.ok(pages.every(({ url }) => url.searchParams.get("status") === "live"));
    assert.ok(pages.every(({ url }) => url.searchParams.get("source_type") === "ats,career_site"));
    assert.equal(pages[0].url.searchParams.get("limit"), "3");
    assert.equal(pages[1].url.searchParams.get("cursor"), "opaque|cursor");
  });
});

test("JOA adapter caps to remaining monthly records and reports incomplete pagination", async () => {
  await withJoaKey(async () => {
    const urls = [];
    const fetchImpl = async (input) => {
      const url = new URL(input);
      urls.push(url);
      if (url.pathname.endsWith("export-estimate")) {
        return response({ estimated_rows: 16679, remaining_this_month: 2, remaining_unlimited: false });
      }
      return response({
        data: [job("1"), job("2")],
        next_cursor: "next",
        has_more: true,
        total_estimate: 16679,
        total_estimate_status: "at_least",
      });
    };
    const result = await createAdapters(fetchImpl).joa.fetch(approvedSource, { maxRecords: 420 });
    assert.equal(result.jobs.length, 2);
    assert.equal(result.quota.budget, 2);
    assert.equal(result.quota.capped, true);
    assert.equal(urls.filter((url) => url.pathname === "/v1/jobs").length, 1);
    assert.equal(urls.at(-1).searchParams.get("limit"), "2");
  });
});

test("JOA adapter requires the server-side key and surfaces quota exhaustion without retry", async () => {
  const previous = process.env.JOA_API_KEY;
  delete process.env.JOA_API_KEY;
  try {
    let calls = 0;
    await assert.rejects(
      createAdapters(async () => { calls += 1; }).joa.fetch(approvedSource),
      /JOA_API_KEY is not set/,
    );
    assert.equal(calls, 0);
  } finally {
    if (previous !== undefined) process.env.JOA_API_KEY = previous;
  }

  await withJoaKey(async () => {
    let jobsCalls = 0;
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith("export-estimate")) {
        return response({ estimated_rows: 500, remaining_this_month: 500, remaining_unlimited: false });
      }
      jobsCalls += 1;
      return response({ error: "record_quota_exhausted" }, 402);
    };
    await assert.rejects(
      createAdapters(fetchImpl).joa.fetch(approvedSource, { maxRecords: 1 }),
      /HTTP 402 record_quota_exhausted.*quota exhausted/,
    );
    assert.equal(jobsCalls, 1);
  });
});

test("JOA incremental changes are cursor-paged and capped by monthly records", async () => {
  await withJoaKey(async () => {
    const calls = [];
    const fetchImpl = async (input) => {
      const url = new URL(input);
      calls.push(url);
      if (url.pathname.endsWith("export-estimate")) {
        return response({ estimated_rows: 16679, remaining_this_month: 1000, remaining_unlimited: false });
      }
      if (url.searchParams.get("since") === "initial-time") {
        return response({
          data: [{ change: "created", job: job("1") }, { change: "updated", job: job("2") }, { change: "delisted", job: { id: "3" } }],
          count: 3,
          next_since: "change|cursor",
        });
      }
      return response({
        data: [{ change: "withdrawn", job: { id: "4" } }],
        count: 1,
        next_since: "latest|cursor",
      });
    };
    const result = await fetchJoaChanges(fetchImpl, { since: "initial-time", maxRecords: 6, pageSize: 3 });
    assert.equal(result.changes.length, 4);
    assert.equal(result.nextSince, "latest|cursor");
    assert.equal(result.quota.capped, false);
    const pages = calls.filter((url) => url.pathname === "/v1/changes");
    assert.equal(pages.length, 2);
    assert.ok(pages.every((url) => url.searchParams.get("country") === "MX"));
    assert.equal(pages[1].searchParams.get("since"), "change|cursor");
    assert.equal(pages[0].searchParams.get("limit"), "3");
  });
});

test("JOA expiration and withdrawal ID feeds use their documented pagination and country filters", async () => {
  await withJoaKey(async () => {
    const calls = [];
    const fetchImpl = async (input) => {
      const url = new URL(input);
      calls.push(url);
      const kind = url.pathname.endsWith("/expired") ? "expired" : "withdrawn";
      const cursor = url.searchParams.get("since");
      if (kind === "expired" && cursor === "expired-start") {
        return response({ data: [{ id: "1" }, { id: "2" }], count: 2, next_since: "expired|cursor" });
      }
      if (kind === "expired") {
        return response({ data: [{ id: "3" }], count: 1, next_since: "expired|latest" });
      }
      return response({ data: [], count: 0, next_since: cursor });
    };
    const result = await fetchJoaExitFeeds(fetchImpl, {
      expiredSince: "expired-start",
      withdrawnSince: "withdrawn-start",
      limit: 2,
    });
    assert.deepEqual(result.expired.ids, ["1", "2", "3"]);
    assert.deepEqual(result.withdrawn.ids, []);
    assert.equal(calls.find((url) => url.pathname.endsWith("/expired")).searchParams.has("country"), false);
    assert.equal(calls.find((url) => url.pathname.endsWith("/withdrawn")).searchParams.get("country"), "MX");
    assert.equal(calls.filter((url) => url.pathname.endsWith("/expired")).length, 2);
    await assert.rejects(
      fetchJoaExitFeeds(async () => response({ data: [{ id: "inconsistent" }], count: 0, next_since: "next" }), {
        expiredSince: "expired-start",
        withdrawnSince: "withdrawn-start",
        limit: 2,
      }),
      /count did not match its page/,
    );
  });
});

test("dry-run strictly filters JOA live Mexico rows and deduplicates existing application URLs", async () => {
  await withAudit(async (auditPath) => {
    const existing = readOnlyDatabase({
      external_vacancies: [{
        source: "legacy:source",
        external_job_id: "old",
        application_url: "https://jobs.example/apply/duplicate?utm_source=old",
        is_active: true,
      }],
      vacancies: [],
    });
    const result = await runSync({
      sources: [approvedSource],
      adapters: {
        joa: {
          async fetch() {
            return {
              jobs: [
                job("1"),
                job("duplicate-in-feed", { apply_url: "https://jobs.example/apply/1?utm_campaign=new" }),
                job("duplicate", { apply_url: "https://jobs.example/apply/duplicate?utm_source=new" }),
                job("closed", { status: "closed" }),
                job("wrong-country", { country: "US" }),
                job("bad-url", { apply_url: "http://jobs.example/apply/bad" }),
              ],
              quota: { budget: 420, remaining: 1000, estimatedRows: 16679, capped: false },
            };
          },
        },
      },
      auditPath,
      database: existing,
      target: 420,
      maxRecords: 420,
    });
    assert.equal(result.results[0].mexicoCount, 4);
    assert.equal(result.results[0].validCount, 3);
    assert.equal(result.uniqueCount, 1);
    assert.equal(result.results[0].jobs[0].external_job_id, "1");
    assert.equal(result.results[0].jobs[0].posted_at, "2026-11-17T12:00:00.000Z");
    assert.equal(result.results[0].jobs[0].work_mode, "Híbrido");
    assert.equal(Object.hasOwn(result.results[0].jobs[0], "description"), false);
    assert.equal(Object.hasOwn(result.results[0].jobs[0], "salary_min"), false);
    assert.equal(existing.writes.length, 0);
    assert.equal(result.audit[0].unique_count, 1);
    assert.equal(result.audit[0].quota.remaining, 1000);
  });
});

test("missing or unpublished original dates are not fabricated", async () => {
  await withAudit(async (auditPath) => {
    const result = await runSync({
      sources: [approvedSource],
      adapters: {
        joa: {
          async fetch() {
            return { jobs: [job("1", { posted_at: "2026-11-17", field_sources: { posted_at: "inferred" } })], quota: {} };
          },
        },
      },
      auditPath,
    });
    assert.equal(result.results[0].jobs[0].posted_at, null);
  });
});

test("failed sources are audited and never written", async () => {
  await withAudit(async (auditPath) => {
    const database = readOnlyDatabase({ external_vacancies: [], vacancies: [] });
    const result = await runSync({
      sources: [approvedSource],
      adapters: { joa: { async fetch() { throw new Error("feed unavailable"); } } },
      auditPath,
      write: true,
      database,
    });
    const lines = (await readFile(auditPath, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(result.results[0].status, "failed");
    assert.equal(lines.at(-1).status, "failed");
    assert.equal(database.writes.length, 0);
  });
});

test("JOA incremental dry-run previews updates and retractions without writing or advancing state", async () => {
  await withAudit(async (auditPath) => {
    const directory = await mkdtemp(join(tmpdir(), "ai-job-state-"));
    const statePath = join(directory, "state.json");
    await writeFile(statePath, JSON.stringify({
      seeded_at: "2026-11-01T00:00:00.000Z",
      expired_since: "expired|cursor",
      withdrawn_since: "withdrawn|cursor",
      changes_since: "changes|cursor",
    }));
    try {
      await withJoaKey(async () => {
        const database = readOnlyDatabase({ external_vacancies: [], vacancies: [] });
        const result = await runChangeSync({
          database,
          auditPath,
          statePath,
          fetchImpl: async (input) => {
            const url = new URL(input);
            if (url.pathname.endsWith("export-estimate")) {
              return response({ estimated_rows: 500, remaining_this_month: 100, remaining_unlimited: false });
            }
            return response({
              data: [
                { change: "created", job: job("new-job") },
                { change: "withdrawn", job: { id: "removed-job" } },
              ],
              count: 2,
              next_since: "later|cursor",
            });
          },
        });
        assert.equal(result.received, 2);
        assert.equal(result.unique, 1);
        assert.equal(result.retracted, 1);
        assert.equal(result.quota.fetched, 2);
        assert.equal(database.writes.length, 0);
        assert.equal(JSON.parse(await readFile(statePath, "utf8")).changes_since, "changes|cursor");
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test("JOA public mapping includes required attribution and never implies an unstated salary", () => {
  const vacancy = toPublicVacancy({
    source: "jobopportunitiesapi:joa",
    id: "joa-id",
    company_name: "Example",
    job_title: "Engineer",
    application_method: "external_url",
    application_value: "https://jobs.example/apply/1",
  });
  assert.deepEqual(vacancy.dataAttribution, {
    text: "Data: Job Opportunities API",
    url: "https://jobopportunitiesapi.org",
  });
  assert.equal(vacancy.salary, "No indicado por la fuente");
  assert.equal(vacancy.posted, "Fecha no indicada");
  assert.equal(vacancy.description, "");
});
