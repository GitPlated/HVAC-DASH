/*
 * supabase-client.js — thin persistence layer over the public.checklist_entries
 * table (see supabase/schema.sql), exposed as a small async API on
 * window.ChecklistStore. Loaded after the supabase-js CDN script and before
 * app.js, which is the only consumer of this file.
 *
 * NOTE ON THE KEY BELOW: this is the Supabase "anon" / publishable key, which
 * is DESIGNED to be shipped in client-side code — it is not a secret. Access
 * control for this table is enforced entirely by Postgres Row Level Security
 * policies (see supabase/schema.sql), which the tool owner has deliberately
 * left fully open to the anon role for select/insert/update/delete, since
 * this is a no-login internal tool. Do not treat this key as a leak, and
 * never put a "service_role" key in this file (or anywhere client-side) —
 * that key bypasses RLS entirely.
 *
 * Error handling contract: every function below returns a Promise that
 * REJECTS (throws, if awaited) on any failure — network error, missing
 * table, RLS misconfiguration, or supabase-js itself failing to load. There
 * is no "error object" return shape; callers should use try/catch or
 * .catch(). Nothing here throws synchronously.
 */

(function () {
  "use strict";

  const SUPABASE_URL = "https://tlclamhggixfhqhsobgq.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_m6afe_yHDVNh6yUpGhc3Uw_d_sLFz2W";
  const TABLE = "checklist_entries";

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

  async function loadAll() {
    const failure = initFailure();
    if (failure) return failure;

    const { data, error } = await client.from(TABLE).select("*");
    if (error) throw error;
    return data || [];
  }

  async function saveGroupItem(checkpointId, itemKey, status, notes) {
    const failure = initFailure();
    if (failure) return failure;

    const { error } = await client.from(TABLE).upsert(
      {
        checkpoint_id: checkpointId,
        item_key: itemKey,
        status: status,
        oil_level: null,
        notes: notes || "",
        updated_at: new Date().toISOString()
      },
      { onConflict: "checkpoint_id,item_key" }
    );
    if (error) throw error;
  }

  async function saveSubsection(checkpointId, designation, oilLevel, notes) {
    const failure = initFailure();
    if (failure) return failure;

    const { error } = await client.from(TABLE).upsert(
      {
        checkpoint_id: checkpointId,
        item_key: "sub:" + designation,
        status: null,
        oil_level: oilLevel || null,
        notes: notes || "",
        updated_at: new Date().toISOString()
      },
      { onConflict: "checkpoint_id,item_key" }
    );
    if (error) throw error;
  }

  async function resetAll() {
    const failure = initFailure();
    if (failure) return failure;

    // PostgREST/supabase-js require some filter on delete; checkpoint_id is
    // "not null" and every real id in js/data.js is non-empty, so "not equal
    // to empty string" matches every row without needing a magic sentinel.
    const { error } = await client.from(TABLE).delete().neq("checkpoint_id", "");
    if (error) throw error;
  }

  window.ChecklistStore = {
    loadAll: loadAll,
    saveGroupItem: saveGroupItem,
    saveSubsection: saveSubsection,
    resetAll: resetAll
  };
})();
