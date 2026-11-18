const STATE_TABLE = "ai_job_bot_sync_state";
const STATE_ID = "joa";

export function getUtcQuotaMonth(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

export async function readJoaSyncState(database) {
  const { data, error } = await database
    .from(STATE_TABLE)
    .select("*")
    .eq("id", STATE_ID)
    .maybeSingle();
  if (error) throw new Error(`Could not read JOA sync state: ${error.message}`);
  return data || null;
}

export async function writeJoaSyncState(database, state) {
  const { error } = await database.from(STATE_TABLE).upsert({
    id: STATE_ID,
    listing_since: state.listing_since,
    listing_cursor: state.listing_cursor,
    expired_since: state.expired_since,
    withdrawn_since: state.withdrawn_since,
    quota_month: state.quota_month,
    quota_used: state.quota_used,
    last_successful_run: state.last_successful_run,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (error) throw new Error(`Could not persist JOA sync state: ${error.message}`);
}
