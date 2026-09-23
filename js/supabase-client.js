/*
 * supabase-client.js — thin persistence layer over the three append-only /
 * tracked-issue tables described in MM_Dashboard's hvac_aurora_tables.sql:
 *   public.hvac_aurora_checklist_log    — append-only, one row per status/reading change.
 *   public.hvac_aurora_findings         — one row per tracked issue.
 *   public.hvac_aurora_finding_updates  — append-only, immutable updates within a finding.
 *
 * Exposed as a small async API on window.ChecklistStore. Loaded after the
 * supabase-js CDN script and before app.js, which is the only consumer of
 * this file.
 *
 * NOTE ON THE KEY BELOW: this is the Supabase "anon" / publishable key, which
 * is DESIGNED to be shipped in client-side code — it is not a secret. Access
 * control for these tables is enforced entirely by Postgres Row Level
 * Security policies (see MM_Dashboard's hvac_aurora_tables.sql), which the
 * tool owner has deliberately left fully open to the anon role for
 * select/insert/update/delete, since this is a no-login internal tool. Do
 * not treat this key as a leak, and never put a "service_role" key in this
 * file (or anywhere client-side) — that key bypasses RLS entirely.
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

  // MM_Dashboard's own Supabase project — moved off Aurora's original
  // separate standalone project (tlclamhggixfhqhsobgq.supabase.co) per
  // Jacob, consolidating onto existing infrastructure, same as Goodyear's
  // real deployment (MM_Dashboard/hvac-goodyear/) did before this. Aurora's
  // rows live here under the hvac_aurora_ prefixed tables/functions below,
  // so they can never collide with either MM_Dashboard's own ~15 tables or
  // Goodyear's already-live hvac_goodyear_ ones. Aurora's real history
  // (896 checklist_log / 31 findings / 108 finding_updates rows as of
  // 2026-09-22) was migrated into these tables via a one-time
  // hvac_aurora_data_migration.sql run — see MM_Dashboard's own repo.
  const SUPABASE_URL = "https://jwdxzbusibvffqtacrib.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_s8RaqMOBJx5PTL_FAErKUQ_0e5x4xLJ";

  const TABLE_LOG = "hvac_aurora_checklist_log";
  const TABLE_FINDINGS = "hvac_aurora_findings";
  const TABLE_FINDING_UPDATES = "hvac_aurora_finding_updates";
  const TABLE_SHIFT_REPORTS = "hvac_aurora_shift_reports";
  const SHIFT_REPORT_PHOTOS_BUCKET = "hvac-aurora-shift-report-photos";

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

  // ------------------------------------------------------- actor attribution
  // The `actor` (checklist_log / finding_updates), `opened_by` (findings), and
  // `is_vendor` (finding_updates) columns were each added after this table
  // already existed (see supabase/schema.sql) and may not have been migrated
  // onto the live project yet at the moment a client loads this file.
  // PostgREST HARD-ERRORS an insert that references a column the table
  // doesn't have (it does not silently drop unknown keys), so every write
  // below that includes one of these columns retries once, with that column
  // stripped, if-and-only-if the failure looks like exactly that "unknown
  // column" case FOR THIS SPECIFIC COLUMN. This keeps every write succeeding
  // (with that one piece of data simply absent) whether or not the migration
  // has landed yet, instead of every checklist save starting to fail the
  // moment a feature like this ships.
  //
  // columnName must actually appear in the error text — a bare 42703/PGRST204
  // code is NOT enough on its own to identify WHICH column is missing.
  // createFinding/addFindingUpdate below check two DIFFERENT optional columns
  // in sequence against the same failed insert's error; a code-only match
  // would say "yes" to both checks for a single-column failure, incorrectly
  // stripping a column that was never actually the problem (verified: this
  // silently dropped `actor` on every finding_updates write while only
  // `is_vendor` was actually missing, before this comment/fix).
  function isMissingColumnError(error, columnName) {
    if (!error) return false;
    const haystack = [error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
    if (haystack.indexOf(columnName.toLowerCase()) === -1) return false;
    return error.code === "42703" || error.code === "PGRST204" ||
      haystack.indexOf("column") !== -1 || haystack.indexOf("schema cache") !== -1;
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
  async function appendLogEntry(checkpointId, itemKey, status, oilLevel, notes, actor) {
    const failure = initFailure();
    if (failure) return failure;

    const payload = {
      checkpoint_id: checkpointId,
      item_key: itemKey,
      status: status || null,
      oil_level: oilLevel || null,
      notes: notes || "",
      actor: actor || null
    };
    let { data, error } = await client.from(TABLE_LOG).insert(payload).select();
    if (error && isMissingColumnError(error, "actor")) {
      delete payload.actor;
      ({ data, error } = await client.from(TABLE_LOG).insert(payload).select());
    }
    if (error) throw error;
    return data && data[0];
  }

  // Updates ONLY notes (+ actor) on an already-existing checklist_log row —
  // used when a note is saved right after the status/oil-level click that
  // just inserted that same row, so one atomic "I checked this, here's a
  // note" action produces exactly one row instead of two. Deliberately never
  // touches created_at (the original check's timestamp must stay put) or
  // status/oil_level (those belong to the original insert only — see
  // js/app.js's pendingRowId tracking in buildCheckRow/buildSubRow for the
  // insert-vs-update decision). Requires the "Allow anon update" RLS policy
  // on checklist_log (see supabase/schema.sql) — if that policy (or this
  // function) isn't live on the project yet, this simply rejects like any
  // other failed write, and callers fall back exactly like every other
  // ChecklistStore call site already does (surface the inline save-error
  // note; never silently swallow).
  async function updateLogEntryNotes(rowId, notes, actor) {
    const failure = initFailure();
    if (failure) return failure;

    const payload = { notes: notes || "", actor: actor || null };
    let { data, error } = await client.from(TABLE_LOG).update(payload).eq("id", rowId).select();
    if (error && isMissingColumnError(error, "actor")) {
      delete payload.actor;
      ({ data, error } = await client.from(TABLE_LOG).update(payload).eq("id", rowId).select());
    }
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
  async function createFinding(checkpointId, itemKey, status, message, actor, isVendor) {
    const failure = initFailure();
    if (failure) return failure;

    const nowIso = new Date().toISOString();
    const findingPayload = {
      checkpoint_id: checkpointId,
      item_key: itemKey,
      status: status,
      resolved_at: status === "resolved" ? nowIso : null,
      opened_by: actor || null
    };
    let { data: findingRows, error: findingError } = await client.from(TABLE_FINDINGS).insert(findingPayload).select();
    if (findingError && isMissingColumnError(findingError, "opened_by")) {
      delete findingPayload.opened_by;
      ({ data: findingRows, error: findingError } = await client.from(TABLE_FINDINGS).insert(findingPayload).select());
    }
    if (findingError) throw findingError;
    const finding = findingRows && findingRows[0];
    if (!finding) throw new Error("createFinding: insert returned no row");

    const updatePayload = { finding_id: finding.id, status: status, message: message, actor: actor || null, is_vendor: !!isVendor };
    let { data: updateRows, error: updateError } = await client.from(TABLE_FINDING_UPDATES).insert(updatePayload).select();
    if (updateError && isMissingColumnError(updateError, "actor")) {
      delete updatePayload.actor;
      ({ data: updateRows, error: updateError } = await client.from(TABLE_FINDING_UPDATES).insert(updatePayload).select());
    }
    if (updateError && isMissingColumnError(updateError, "is_vendor")) {
      delete updatePayload.is_vendor;
      ({ data: updateRows, error: updateError } = await client.from(TABLE_FINDING_UPDATES).insert(updatePayload).select());
    }
    if (updateError) throw updateError;

    return { finding: finding, update: updateRows && updateRows[0] };
  }

  // Appends an update to an EXISTING finding and updates that finding's own
  // status (and resolved_at, when the new status is "resolved"). Never
  // creates a duplicate finding. isNoChange flags an End of Shift Report
  // update that says nothing changed (see js/app.js's shift-report module) —
  // stored as its own column rather than inferred from the message text, so
  // a consecutive-no-change streak can be computed reliably.
  async function addFindingUpdate(findingId, status, message, actor, isVendor, isNoChange) {
    const failure = initFailure();
    if (failure) return failure;

    const updatePayload = {
      finding_id: findingId, status: status, message: message, actor: actor || null,
      is_vendor: !!isVendor, is_no_change: !!isNoChange
    };
    let { data: updateRows, error: updateError } = await client.from(TABLE_FINDING_UPDATES).insert(updatePayload).select();
    if (updateError && isMissingColumnError(updateError, "actor")) {
      delete updatePayload.actor;
      ({ data: updateRows, error: updateError } = await client.from(TABLE_FINDING_UPDATES).insert(updatePayload).select());
    }
    if (updateError && isMissingColumnError(updateError, "is_vendor")) {
      delete updatePayload.is_vendor;
      ({ data: updateRows, error: updateError } = await client.from(TABLE_FINDING_UPDATES).insert(updatePayload).select());
    }
    if (updateError && isMissingColumnError(updateError, "is_no_change")) {
      delete updatePayload.is_no_change;
      ({ data: updateRows, error: updateError } = await client.from(TABLE_FINDING_UPDATES).insert(updatePayload).select());
    }
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

  // ------------------------------------------------------ password protection
  // Thin wrappers over the 5 RPC functions defined in supabase/schema.sql
  // (hvac_aurora_list_protected_user_names / hvac_aurora_verify_user_password /
  // hvac_aurora_verify_master_password / hvac_aurora_set_user_password /
  // hvac_aurora_remove_user_password) — an extra deterrent layer on top of
  // the "attribution, not authentication" identity gate. Passwords are
  // bcrypt-hashed server-side (see MM_Dashboard's hvac_aurora_tables.sql)
  // and never leave the database; these functions only ever return
  // true/false or the set of protected names, never a hash.
  //
  // Same error contract as everything else in this file: every function
  // below returns a Promise that REJECTS on any failure — including the RPC
  // not existing yet because this migration hasn't landed on the live
  // project. Callers in js/app.js treat a rejected listProtectedUserNames()
  // as "nothing is protected yet" (empty set) rather than crashing, exactly
  // like this app's existing load-error-banner pattern for a missing table.

  async function listProtectedUserNames() {
    const failure = initFailure();
    if (failure) return failure;

    const { data, error } = await client.rpc("hvac_aurora_list_protected_user_names");
    if (error) throw error;
    return data || [];
  }

  async function verifyUserPassword(userName, password) {
    const failure = initFailure();
    if (failure) return failure;

    const { data, error } = await client.rpc("hvac_aurora_verify_user_password", { p_user_name: userName, p_password: password });
    if (error) throw error;
    return !!data;
  }

  async function verifyMasterPassword(password) {
    const failure = initFailure();
    if (failure) return failure;

    const { data, error } = await client.rpc("hvac_aurora_verify_master_password", { p_password: password });
    if (error) throw error;
    return !!data;
  }

  // Returns false (no change made) if p_master_password doesn't match — never
  // throws for a wrong master password, only for an actual connection/RPC
  // failure.
  async function setUserPassword(masterPassword, userName, newPassword) {
    const failure = initFailure();
    if (failure) return failure;

    const { data, error } = await client.rpc("hvac_aurora_set_user_password", {
      p_master_password: masterPassword,
      p_user_name: userName,
      p_new_password: newPassword
    });
    if (error) throw error;
    return !!data;
  }

  async function removeUserPassword(masterPassword, userName) {
    const failure = initFailure();
    if (failure) return failure;

    const { data, error } = await client.rpc("hvac_aurora_remove_user_password", {
      p_master_password: masterPassword,
      p_user_name: userName
    });
    if (error) throw error;
    return !!data;
  }

  // ------------------------------------------------------------ shift_reports
  // Persistence for the End of Shift Report header button (see js/app.js's
  // shift-report module). One row per submitted report — the checklist
  // completion tally + its justification + any attached photos. The
  // findings side of the report is just ordinary finding_updates rows (see
  // addFindingUpdate's isNoChange param above), not stored here.

  async function createShiftReport(payload) {
    const failure = initFailure();
    if (failure) return failure;

    const { data, error } = await client.from(TABLE_SHIFT_REPORTS).insert(payload).select();
    if (error) throw error;
    return data && data[0];
  }

  // Uploads one already-picked File to the shift-report-photos bucket at
  // `path` and returns its public URL. Bucket is public (see
  // supabase/shift_report_photos_storage.sql) so no signed URL is needed —
  // once the upload succeeds, getPublicUrl is a pure string join, not a
  // network call.
  async function uploadShiftReportPhoto(path, file) {
    const failure = initFailure();
    if (failure) return failure;

    const { error } = await client.storage.from(SHIFT_REPORT_PHOTOS_BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false
    });
    if (error) throw error;
    return client.storage.from(SHIFT_REPORT_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  // ------------------------------------------------ MM Dashboard linked login
  // For the identity-gate cards that pair to a real MM_Dashboard account (see
  // MM_DASHBOARD_LINKED_EMAILS in js/app.js) — uses this SAME client/project
  // (Aurora's tables and MM_Dashboard's real Supabase Auth now live in the
  // same project) to run the actual signInWithPassword() check MM_Dashboard's
  // own login.html uses, so a password change there takes effect here with
  // zero sync step. The real session this creates is used ONLY to verify the
  // password (and MFA, if enrolled) at the moment of picking an identity —
  // js/app.js signs it back out immediately after, on both success and
  // failure, so nothing persists on this shared device. Aurora's own
  // CURRENT_IDENTITY (memory-only, resets on reload) is what actually tracks
  // "who's acting now" afterward, exactly as for every other identity.
  //
  // Deliberately does NOT fail open on any step — a network hiccup here
  // denies the sign-in rather than silently letting it through, unlike the
  // MFA-status checks in MM_Dashboard's own auth.js (which fail open because
  // they sit on top of an already-passed password check; there is no
  // "already passed" state to fall back on here).

  async function signInMmDashboardAccount(email, password) {
    const failure = initFailure();
    if (failure) return failure;

    const { data, error } = await client.auth.signInWithPassword({ email: email, password: password });
    if (error) throw error;
    return data;
  }

  // {factorId} if the just-created session still needs an MFA challenge
  // (assurance level stuck below what the account's enrolled factor
  // requires), else null (no MFA enrolled, or already satisfied).
  async function getMmDashboardPendingMfaChallenge() {
    const { data: aal, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !aal || aal.currentLevel === aal.nextLevel) return null;
    const { data: factorsData } = await client.auth.mfa.listFactors();
    const factor = (factorsData && factorsData.totp || []).find(function (f) { return f.status === "verified"; });
    return factor ? { factorId: factor.id } : null;
  }

  async function verifyMmDashboardMfaCode(factorId, code) {
    try {
      const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: factorId });
      if (challengeError) return false;
      const { error: verifyError } = await client.auth.mfa.verify({ factorId: factorId, challengeId: challenge.id, code: code });
      return !verifyError;
    } catch (e) {
      return false;
    }
  }

  // Always safe to call, even with no real session active.
  async function signOutMmDashboardAccount() {
    try { await client.auth.signOut(); } catch (e) { /* nothing to do */ }
  }

  // ---------------------------------------------------------------- bulk load

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

  window.ChecklistStore = {
    loadAll: loadAll,
    loadLog: loadLog,
    appendLogEntry: appendLogEntry,
    updateLogEntryNotes: updateLogEntryNotes,
    loadFindings: loadFindings,
    loadFindingUpdates: loadFindingUpdates,
    createFinding: createFinding,
    addFindingUpdate: addFindingUpdate,
    listProtectedUserNames: listProtectedUserNames,
    verifyUserPassword: verifyUserPassword,
    verifyMasterPassword: verifyMasterPassword,
    setUserPassword: setUserPassword,
    removeUserPassword: removeUserPassword,
    createShiftReport: createShiftReport,
    uploadShiftReportPhoto: uploadShiftReportPhoto,
    signInMmDashboardAccount: signInMmDashboardAccount,
    getMmDashboardPendingMfaChallenge: getMmDashboardPendingMfaChallenge,
    verifyMmDashboardMfaCode: verifyMmDashboardMfaCode,
    signOutMmDashboardAccount: signOutMmDashboardAccount
  };
})();
