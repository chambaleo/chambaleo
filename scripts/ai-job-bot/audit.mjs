import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { listPendingSources } from "./import.mjs";

async function main() {
  const sources = JSON.parse(await readFile(new URL("./sources.json", import.meta.url), "utf8"));
  const pending = await listPendingSources(sources);
  const latest = new Map();
  try {
    const auditLog = await readFile(new URL("./audit.jsonl", import.meta.url), "utf8");
    for (const line of auditLog.split("\n").filter(Boolean)) {
      try {
        const entry = JSON.parse(line);
        if (entry.source_key) latest.set(entry.source_key, entry);
      } catch {
        // Ignore an incomplete final line.
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.log(`Pending or disabled sources: ${pending.length}`);
  for (const source of pending) {
    const slug = source.company.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const sync = latest.get(`ai-job-bot:${slug}:${source.ats}`);
    console.log(
      `- ${source.company} | ATS: ${source.ats} | permission: ${source.permission || "unknown"} | enabled: ${source.enabled === true} | URL: ${source.sourceUrl || "not provided"} | authorization: ${source.authorizationRecord ? "documented" : "not provided"} | last success: ${sync?.last_successful_sync || "never"} | fetched: ${sync?.fetched_count || 0} | Mexico: ${sync?.mexico_count || 0} | unique: ${sync?.unique_count || 0} | errors: ${sync?.errors?.join("; ") || "none"}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
