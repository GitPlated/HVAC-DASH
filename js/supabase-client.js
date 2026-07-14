/*
 * supabase-client.js — thin persistence layer over the three append-only /
 * tracked-issue tables described in supabase/schema.sql:
 *   public.checklist_log    — append-only, one row per status/reading change.
 *   public.findings         — one row per tracked issue.
 *   public.finding_updates  — append-only, immutable updates within a finding.
 *
 * Exposed as a small async API on window.ChecklistStore. Loaded after the
 * supabase-js CDN script and before app.js, which is the only consumer of
 * this file.
 *
 * NOTE ON THE KEY BELOW: this is the Supabase "anon" / publishable key, which
 * is DESIGNED to be shipped in client-side code — it is not a secret. Access
 * control for these tables is enforced entirely by Postgres Row Level
 * Security policies (see supabase/schema.sql), which the tool owner has
 * deliberately left fully open to the anon role for select/insert/update/
 * delete, since this is a no-login internal tool. Do not treat this key as a
 * leak, and never put a "service_role" key in this file (or anywhere
 * client-side) — that key bypasses RLS entirely.
 *
 * Error handling contract: every function below returns a Promise that
 * REJECTS (throws, if awaited) on any failure — network error, missing
 * table (e.g. the new schema hasn't been applied to the project yet), RLS
 * misconfiguration, or supabase-js itself failing to load. There is no
 * "error object" return shape; callers should use try/catch or .catch().
 * Nothing here throws synchronously.
 */

(function () {
  "use strict";

  const SUPABASE_URL = "https://tlclamhggixfhqhsobgq.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_m6afe_yHDVNh6yUpGhc3Uw_d_sLFz2W";

  const TABLE_LOG = "checklist_log";
  const TABLE_FINDINGS = "findings";
  const TABLE_FINDING_UPDATES = "finding_updates";

  let client = null;
  let initError = null;

  try {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error(
        "supabase-js failed to load (window.supabase is missing) — check the CDN <script> tag in index.html and network connectivity."
      );
    }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    initError = e;
  }

  // If client setup failed, every store method rejects with the same error
  // instead of throwing synchronously (e.g. "Cannot read properties of
  // undefined") — keeps every call site's try/catch or .catch() working.
  function initFailure() {
    return initError ? Promise.reject(initError) : null;
  }

  // ------------------------------------------------------------ checklist_log

  async function loadLog() {
    const failure = initFailure();
    if (failure) return failure;

    const { data, error } = await client.from(TABLE_LOG).select("*");
    if (error) throw error;
    return data || [];
  }

  // Plain insert — never an upsert. Every status change or reading is a new
  // row. Returns the inserted row (with its real id/created_at) so callers
  // can append it to their local history without a re-fetch.
  async function appendLogEntry(checkpointId, itemKey, status, oilLevel, notes) {
    const failure = initFailure();
    if (failure) return failure;

    const { data, error } = await client
      .from(TABLE_LOG)
      .insert({
        checkpoint_id: checkpointId,
        item_key: itemKey,
        status: status || null,
        oil_level: oilLevel || null,
        notes: notes || ""
      })
      .select();
    if (error) throw error;
    return data && data[0];
  }

  // -------------------------------------------------------------- findings

  async function loadFindings() {
    const failure = initFailure();
    if (failure) return failure;

    const { data, error } = await client.from(TABLE_FINDINGS).select("*");
    if (error) throw error;
    return data || [];
  }

  async function loadFindingUpdates() {
    const failure = initFailure();
    if (failure) return failure;

    const { data, error } = await client.from(TABLE_FINDING_UPDATES).select("*");
    if (error) throw error;
    return data || [];
  }

  // Opens a brand-new finding + its first update. Use only when no
  // unresolved finding already exists for this checkpoint+item — callers are
  // responsible for that check (see getItemFindingInfo in app.js).
  async function createFinding(checkpointId, itemKey, status, message) {
    const failure = initFailure();
    if (failure) return failure;

    const nowIso = new Date().toISOString();
    const { data: findingRows, error: findingError } = await client
      .from(TABLE_FINDINGS)
      .insert({
        checkpoint_id: checkpointId,
        item_key: itemKey,
        status: status,
        resolved_at: status === "resolved" ? nowIso : null
      })
      .select();
    if (findingError) throw findingError;
    const finding = findingRows && findingRows[0];
    if (!finding) throw new Error("createFinding: insert returned no row");

    const { data: updateRows, error: updateError } = await client
      .from(TABLE_FINDING_UPDATES)
      .insert({ finding_id: finding.id, status: status, message: message })
      .select();
    if (updateError) throw updateError;

    return { finding: finding, update: updateRows && updateRows[0] };
  }

  // Appends an update to an EXISTING finding and updates that finding's own
  // status (and resolved_at, when the new status is "resolved"). Never
  // creates a duplicate finding.
  async function addFindingUpdate(findingId, status, message) {
    const failure = initFailure();
    if (failure) return failure;

    const { data: updateRows, error: updateError } = await client
      .from(TABLE_FINDING_UPDATES)
      .insert({ finding_id: findingId, status: status, message: message })
      .select();
    if (updateError) throw updateError;

    const nowIso = new Date().toISOString();
    const { data: findingRows, error: findingError } = await client
      .from(TABLE_FINDINGS)
      .update({ status: status, resolved_at: status === "resolved" ? nowIso : null })
      .eq("id", findingId)
      .select();
    if (findingError) throw findingError;

    return { finding: findingRows && findingRows[0], update: updateRows && updateRows[0] };
  }

  // ---------------------------------------------------------- bulk load / reset

  // One-shot load of everything the app needs on startup — three parallel
  // queries (not a per-item round trip). Callers derive "current" status
  // client-side from the latest checklist_log row per (checkpoint_id,
  // item_key), and current finding state from findings + finding_updates.
  async function loadAll() {
    const failure = initFailure();
    if (failure) return failure;

    const [log, findings, findingUpdates] = await Promise.all([
      loadLog(),
      loadFindings(),
      loadFindingUpdates()
    ]);
    return { log: log, findings: findings, findingUpdates: findingUpdates };
  }

  async function resetAll() {
    const failure = initFailure();
    if (failure) return failure;

    // PostgREST/supabase-js require some filter on delete. finding_updates
    // and findings use a bigint identity id (always >= 1), so "not equal to
    // -1" matches every row. checklist_log has no numeric id column exposed
    // here, so "checkpoint_id not equal to empty string" matches every row
    // (checkpoint_id is "not null" and every real id in js/data.js is
    // non-empty). Delete children before parents even though finding_updates
    // also cascades from findings, so a partial failure never leaves orphaned
    // rows depending on cascade timing.
    const { error: e1 } = await client.from(TABLE_FINDING_UPDATES).delete().neq("id", -1);
    if (e1) throw e1;
    const { error: e2 } = await client.from(TABLE_FINDINGS).delete().neq("id", -1);
    if (e2) throw e2;
    const { error: e3 } = await client.from(TABLE_LOG).delete().neq("checkpoint_id", "");
    if (e3) throw e3;
  }

  window.ChecklistStore = {
    loadAll: loadAll,
    loadLog: loadLog,
    appendLogEntry: appendLogEntry,
    loadFindings: loadFindings,
    loadFindingUpdates: loadFindingUpdates,
    createFinding: createFinding,
    addFindingUpdate: addFindingUpdate,
    resetAll: resetAll
  };
})();
