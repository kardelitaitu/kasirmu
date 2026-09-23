//! Audit Log — append-only immutable entries, plus the tier retention
//! sweep (`sweep_audit_retention`) that deletes rows past the tenant's
//! window through the trigger carve-out migration 20260920.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B5 finale)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: exemplary AUD-02..09 implementation — AUD-06 redaction (20 sensitive keys, byte-preserving fast path) + truncation with marker; keyset pagination (created_at,id) with clamped pages; export bound 100k; review checkpoint + audit event in one tx; schema immutability triggers back the append-only claim; day histogram substr() is UTC (COR-21 family, trivial)
next: none | perf: SQL-computed counts per AUD-02/03
*/

use crate::AuditEntry;
use crate::error::CoreError;

use super::Store;

/// Keys whose values are considered secrets and are redacted before an audit
/// `details` payload is persisted (AUD-06). Match is case-insensitive.
const SENSITIVE_DETAIL_KEYS: &[&str] = &[
    "password",
    "passwd",
    "pwd",
    "secret",
    "token",
    "auth_token",
    "access_token",
    "refresh_token",
    "api_key",
    "apikey",
    "client_secret",
    "pin",
    "cvv",
    "cvc",
    "card_number",
    "cardnumber",
    "pan",
    "session_token",
    "authorization",
    "private_key",
];

/// Marker substituted for redacted secret values (AUD-06).
const REDACTED_MARKER: &str = "[REDACTED]";

/// Maximum persisted length (in chars) for an audit `details` payload
/// (AUD-06). Oversized payloads are truncated with an explicit marker.
const MAX_DETAIL_LEN: usize = 4000;

/// Maximum number of rows returned by a server-side audit export (AUD-09).
/// Guards memory/response size while still covering full incident and
/// retention windows.
pub const MAX_AUDIT_EXPORT_ROWS: u64 = 100_000;

/// True when any key in the JSON tree matches a sensitive key name
/// (case-insensitive). Used to decide whether re-serialisation is needed.
fn has_sensitive_key(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(map) => map.iter().any(|(k, v)| {
            SENSITIVE_DETAIL_KEYS
                .iter()
                .any(|s| k.eq_ignore_ascii_case(s))
                || has_sensitive_key(v)
        }),
        serde_json::Value::Array(items) => items.iter().any(has_sensitive_key),
        _ => false,
    }
}

/// Redact sensitive keys (case-insensitive) from a JSON value tree.
fn redact_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut out = serde_json::Map::with_capacity(map.len());
            for (k, v) in map {
                if SENSITIVE_DETAIL_KEYS
                    .iter()
                    .any(|s| k.eq_ignore_ascii_case(s))
                {
                    out.insert(k.clone(), serde_json::Value::String(REDACTED_MARKER.into()));
                } else {
                    out.insert(k.clone(), redact_value(v));
                }
            }
            serde_json::Value::Object(out)
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(redact_value).collect())
        }
        other => other.clone(),
    }
}

/// Truncate an oversized details payload, appending an explicit marker so a
/// reader knows the record was summarised (AUD-06).
fn truncate_details(details: &str) -> String {
    if details.chars().count() <= MAX_DETAIL_LEN {
        details.to_string()
    } else {
        let mut truncated: String = details.chars().take(MAX_DETAIL_LEN).collect();
        truncated.push_str("…[truncated]");
        truncated
    }
}

/// Apply the AUD-06 policy: redact secret keys in JSON details, then cap the
/// payload size.
///
/// When no sensitive key is present the original string is returned verbatim
/// (preserving exact bytes — serde only re-serialises when a redaction is
/// actually needed). Non-JSON strings are only truncated.
fn sanitize_details(details: &str) -> String {
    let redacted = match serde_json::from_str::<serde_json::Value>(details) {
        Ok(value) if has_sensitive_key(&value) => {
            serde_json::to_string(&redact_value(&value)).unwrap_or_else(|_| details.to_string())
        }
        _ => details.to_string(),
    };
    truncate_details(&redacted)
}

/// Shared WHERE-clause construction for every audit reader: the paged
/// listing, the AUD-09 export and the security-event export
/// ([`Store::list_audit_entries_export_filtered`]). One builder so the
/// filters cannot drift apart — the old export duplicated the outcome/
/// query clauses by hand, which is exactly how a third reader would
/// inherit a fourth copy.
///
/// Clause order (and therefore parameter order): outcome, query, actions,
/// actor, created_after, created_before, keyset cursor. `actions` keeps
/// the page builder's fail-closed rule: an EMPTY allow-list matches
/// nothing — a caller that forgets to populate it must not be rewarded
/// with every audit row. `actor_user_id` is an EXACT audit_log.user_id
/// match (journal D84 ruling 2): 'system' resolves the SYSTEM_ACTOR rows
/// naturally because that is the literal column value, and no LIKE
/// fuzzing is added — username-in-details guessing would be dishonest
/// precision. `created_after`/`created_before` arrive already normalized
/// to fixed-width ISO strings from the caller; the comparison is a plain
/// string >= / < (lexicographic == chronological on fixed width), with
/// `after` INCLUSIVE and `before` EXCLUSIVE (journal D84 ruling 3).
fn build_audit_where(
    outcome: Option<&str>,
    query: Option<&str>,
    actions: Option<&[&str]>,
    actor_user_id: Option<&str>,
    created_after: Option<&str>,
    created_before: Option<&str>,
    cursor: Option<(&str, &str)>,
) -> (String, Vec<Box<dyn rusqlite::ToSql>>, usize) {
    let mut where_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    let mut idx = 1usize;

    if let Some(outcome) = outcome {
        let trimmed = outcome.trim();
        if !trimmed.is_empty() {
            where_clauses.push(format!("outcome = ?{idx}"));
            params.push(Box::new(trimmed.to_string()));
            idx += 1;
        }
    }

    if let Some(query) = query {
        let trimmed = query.trim();
        if !trimmed.is_empty() {
            // Escape LIKE wildcards so literal % or _ in the query does not
            // broaden the match (mirrors `search_customers`).
            let escaped = trimmed
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_");
            let pattern = format!("%{escaped}%");
            where_clauses.push(format!(
                "(action LIKE ?{idx} ESCAPE '\\' OR COALESCE(target_type, '') LIKE ?{idx} ESCAPE '\\' \
                 OR COALESCE(target_id, '') LIKE ?{idx} ESCAPE '\\' OR user_id LIKE ?{idx} ESCAPE '\\')"
            ));
            params.push(Box::new(pattern));
            idx += 1;
        }
    }

    if let Some(actions) = actions {
        if actions.is_empty() {
            where_clauses.push("1 = 0".to_string());
        } else {
            let placeholders: Vec<String> = actions
                .iter()
                .map(|_| {
                    let p = format!("?{idx}");
                    idx += 1;
                    p
                })
                .collect();
            where_clauses.push(format!("action IN ({})", placeholders.join(", ")));
            for action in actions {
                params.push(Box::new(action.to_string()));
            }
        }
    }

    if let Some(actor) = actor_user_id {
        let trimmed = actor.trim();
        if !trimmed.is_empty() {
            where_clauses.push(format!("user_id = ?{idx}"));
            params.push(Box::new(trimmed.to_string()));
            idx += 1;
        }
    }

    if let Some(after) = created_after {
        let trimmed = after.trim();
        if !trimmed.is_empty() {
            where_clauses.push(format!("created_at >= ?{idx}"));
            params.push(Box::new(trimmed.to_string()));
            idx += 1;
        }
    }

    if let Some(before) = created_before {
        let trimmed = before.trim();
        if !trimmed.is_empty() {
            where_clauses.push(format!("created_at < ?{idx}"));
            params.push(Box::new(trimmed.to_string()));
            idx += 1;
        }
    }

    if let Some((ct, id)) = cursor {
        where_clauses.push(format!(
            "(created_at < ?{idx} OR (created_at = ?{idx} AND id < ?{}))",
            idx + 1
        ));
        params.push(Box::new(ct.to_string()));
        params.push(Box::new(id.to_string()));
        idx += 2;
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };
    (where_sql, params, idx)
}

/// The single INSERT body shared by BOTH writer states ([`Store::log_audit`]
/// in autocommit and inside a caller's transaction, and
/// [`Store::log_audit_in_tx`]).
///
/// One body, on purpose: a second non-redacting copy of this statement would
/// leak the secret keys AUD-06 exists to catch, and the two writers would then
/// disagree about what an audit row may contain. Redaction happens HERE, before
/// the statement, so neither writer can bypass it.
fn insert_audit(conn: &rusqlite::Connection, entry: &AuditEntry) -> Result<(), CoreError> {
    let details = sanitize_details(&entry.details);
    conn.execute(
        "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            entry.id, entry.user_id, entry.action,
            entry.target_type, entry.target_id,
            details, entry.outcome, entry.created_at,
        ],
    )?;
    Ok(())
}

impl Store<'_> {
    /// The settings-table key the retention sweep sets while it deletes
    /// expired rows (migration 20260920's trigger carve-out). The
    /// `audit_log_immutable_delete` trigger raises UNLESS this key exists,
    /// and the sweep only ever holds it inside its own transaction, so a
    /// DELETE issued outside a live sweep still aborts.
    pub const SWEEP_MARKER_KEY: &'static str = "audit.retention_sweep_active";

    /// Tier audit retention sweep (todo-global-saas-2.md P1 "audit baseline
    /// and retention schedule").
    ///
    /// Deletes every `audit_log` row whose `created_at` is older than the
    /// tenant tier's window, measured from the event timestamp. The window
    /// comes from `SubscriptionTier::audit_retention_days` (via the
    /// `Entitlements` read model); `None` means the tier has no retention
    /// entitlement (Free keeps no tenant-facing audit logs) and every row
    /// is purged.
    ///
    /// All work runs in ONE transaction: the sweep marker is inserted,
    /// expired rows are deleted, the marker is cleared, the transaction
    /// commits. The carve-out trigger (migration 20260920) permits DELETE
    /// only while the marker row exists, so the exemption is never visible
    /// outside a live sweep — a crash rolls the marker back together with
    /// the deletes, and any other connection's DELETE still aborts. The
    /// UPDATE trigger stays unconditionally immutable: no anonymization
    /// path exists; deletion IS the implemented retention policy.
    ///
    /// The cutoff is computed HERE, in Rust, and passed as an RFC3339
    /// string — the memo sweep's 2026-09-07 ruling: RFC3339-vs-RFC3339
    /// keeps the comparison in one format (SQLite's `datetime()` emits a
    /// space-separated form that mis-sorts against `…T…Z`). `now` must be
    /// RFC3339 with a `T` separator, matching what `AuditEntry::new`
    /// persists.
    ///
    /// The negative-window fast path skips the marker entirely, so a
    /// sweep with nothing to do never opens a transaction. Returns the
    /// number of rows deleted (0 = nothing expired); idempotent.
    ///
    /// Callers must resolve the tier fail-closed (missing/tampered row →
    /// skip the sweep): this method cannot distinguish "the caller checked
    /// and the tier is Free" from "the caller did not check", and a purge
    /// triggered by a tampered row would be irreversible.
    pub fn sweep_audit_retention(
        &self,
        tier: &crate::subscription::SubscriptionTier,
        now: &str,
    ) -> Result<usize, CoreError> {
        match tier.audit_retention_days() {
            // Free (and the legacy perpetual license): no tenant-facing
            // audit logs — purge everything.
            None => self.sweep_audit_retention_all(),
            Some(window_days) => {
                let cutoff = chrono::DateTime::parse_from_rfc3339(now)
                    .map_err(|e| {
                        CoreError::Internal(format!(
                            "audit retention sweep: bad `now` timestamp: {e}"
                        ))
                    })?
                    .with_timezone(&chrono::Utc)
                    - chrono::Duration::days(window_days);
                let cutoff_str = cutoff.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

                // Fast path: nothing expired, no transaction, no marker.
                let expired: i64 = self.conn.query_row(
                    "SELECT COUNT(*) FROM audit_log WHERE created_at < ?1",
                    rusqlite::params![cutoff_str],
                    |row| row.get(0),
                )?;
                if expired == 0 {
                    return Ok(0);
                }

                let tx = self.conn.unchecked_transaction()?;
                tx.execute(
                    "INSERT INTO settings (key, value) VALUES (?1, '1')
                     ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                    rusqlite::params![Self::SWEEP_MARKER_KEY],
                )?;
                let deleted = tx.execute(
                    "DELETE FROM audit_log WHERE created_at < ?1",
                    rusqlite::params![cutoff_str],
                )?;
                tx.execute(
                    "DELETE FROM settings WHERE key = ?1",
                    rusqlite::params![Self::SWEEP_MARKER_KEY],
                )?;
                tx.commit()?;
                Ok(deleted)
            }
        }
    }

    /// Purge EVERY audit row (the Free branch of
    /// [`Self::sweep_audit_retention`]). Same one-transaction marker
    /// discipline; the count query is the fast path here.
    fn sweep_audit_retention_all(&self) -> Result<usize, CoreError> {
        let total: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM audit_log", [], |row| row.get(0))?;
        if total == 0 {
            return Ok(0);
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO settings (key, value) VALUES (?1, '1')
             ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            rusqlite::params![Self::SWEEP_MARKER_KEY],
        )?;
        let deleted = tx.execute("DELETE FROM audit_log", [])?;
        tx.execute(
            "DELETE FROM settings WHERE key = ?1",
            rusqlite::params![Self::SWEEP_MARKER_KEY],
        )?;
        tx.commit()?;
        Ok(deleted)
    }

    /// Insert a new audit log entry (append-only).
    ///
    /// AUD-06: the `details` payload is sanitised before persistence — secret
    /// keys are redacted and oversized payloads are truncated — so tokens,
    /// PINs, and customer data written by upstream callers never reach the
    /// audit table verbatim.
    ///
    /// # Transaction behaviour (deliberate, not incidental)
    ///
    /// SQLite has no nested `BEGIN`, so an unconditional
    /// `unchecked_transaction()` here would fail for EVERY caller that already
    /// holds one — `void_sale`, `update_staff_scoped` via
    /// `record_security_event`, and the tablet staff door all do. This method
    /// therefore branches on `is_autocommit()`:
    ///
    /// * in autocommit it OWNS a transaction — opens one, writes, commits;
    /// * inside a caller's transaction it JOINS it and writes nothing outside
    ///   it.
    ///
    /// That join is a compliance semantic rather than an accident: an action
    /// whose transaction rolls back did not happen, and an audit row for it
    /// would be a phantom — a record of an event that never occurred, which is
    /// worse than a missing one. The cost is the mirror image: for an
    /// in-transaction caller the row is NOT durable when this returns. The
    /// caller must commit, and a caller that needs a row to survive its OWN
    /// rollback must write it on its own connection after committing, or use
    /// [`Store::log_audit_in_tx`] where the same join is the point.
    pub fn log_audit(&self, entry: &AuditEntry) -> Result<(), CoreError> {
        if self.conn.is_autocommit() {
            let tx = self.conn.unchecked_transaction()?;
            insert_audit(&tx, entry)?;
            tx.commit()?;
            Ok(())
        } else {
            insert_audit(self.conn, entry)
        }
    }

    /// Insert a new audit log entry inside a CALLER-OWNED transaction.
    ///
    /// The in-transaction twin of log_audit: a settlement door (or the
    /// event handler that follows it) writes the audit row in the SAME
    /// transaction as the rows it describes, so the entry commits or dies
    /// with them — closing the commit-then-publish window where the
    /// standalone writer on a separate connection loses the row to a
    /// crash between commit and publish. The refunds path already does
    /// exactly this by hand ("write audit log inside the same
    /// transaction"); this is the shared primitive that convention
    /// implies, not a new pattern.
    ///
    /// The audit_log immutability triggers do not interfere: they are
    /// DELETE- and UPDATE-scoped only (20260813_init.sql:1046-1058, as
    /// replaced for the retention carve-out by 20260920) and no INSERT
    /// trigger exists on the table, so an in-transaction INSERT passes.
    ///
    /// AUD-06 holds for this second writer too: details runs through
    /// sanitize_details before persistence. A writer that skipped the
    /// redaction would leak secret keys the standalone writer would have
    /// caught — a non-redacting second writer is worse than none.
    ///
    /// Associated function, not a method, on purpose: the caller's
    /// transaction may live on a different connection than any Store
    /// handle in scope (handler connection vs settlement connection), so
    /// touching self.conn here would be a lie. Same shape as
    /// enqueue_offline_in_tx.
    pub fn log_audit_in_tx(
        tx: &rusqlite::Transaction<'_>,
        entry: &AuditEntry,
    ) -> Result<(), CoreError> {
        insert_audit(tx, entry)
    }

    /// True when an audit_log row already exists for action + target_id,
    /// regardless of outcome — status is deliberately irrelevant: to a
    /// "has this sale's audit row been written?" guard, a failure-outcome
    /// row and a success one are the same fact.
    ///
    /// The existence probe behind the settlement doors' idempotent audit
    /// write: probe INSIDE the caller's transaction, then call
    /// log_audit_in_tx when it answers false, so the check and the insert
    /// see the same snapshot and two writers racing one sale cannot both
    /// pass (SQLite serialises write transactions).
    ///
    /// Takes a Connection reference so both states are reachable with one
    /// function: rusqlite::Transaction derefs to Connection, so handing
    /// it a tx reads the uncommitted transaction state (the guard's use)
    /// and handing it a bare connection reads committed state. Plain
    /// equality on real columns — action carries idx_audit_log_action and
    /// target_id sits on idx_audit_log_target — no LIKE fuzzing, no
    /// substring scan.
    pub fn has_audit_row_for(
        conn: &rusqlite::Connection,
        action: &str,
        target_id: &str,
    ) -> Result<bool, CoreError> {
        let found: i64 = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM audit_log WHERE action = ?1 AND target_id = ?2)",
            rusqlite::params![action, target_id],
            |row| row.get(0),
        )?;
        Ok(found != 0)
    }

    /// List audit log entries in reverse chronological order.
    pub fn list_audit_entries(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<AuditEntry>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, action, target_type, target_id, details, outcome, created_at
             FROM audit_log ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(rusqlite::params![limit, offset], |row| {
            Ok(AuditEntry {
                id: row.get("id")?,
                user_id: row.get("user_id")?,
                action: row.get("action")?,
                target_type: row.get("target_type")?,
                target_id: row.get("target_id")?,
                details: row.get("details")?,
                outcome: row.get("outcome")?,
                created_at: row.get("created_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// List audit log entries with server-side filters and keyset pagination.
    ///
    /// AUD-02/AUD-03: filtering and review counts are computed in the database
    /// (not over a loaded page), and paging uses a stable `(created_at, id)`
    /// cursor so new rows inserted between requests cannot shift the page
    /// boundary. Returns `(items, total_matching, has_more)`. The page size is
    /// clamped to `[1, 200]` and one extra row is fetched to compute `has_more`
    /// without an offset race.
    pub fn list_audit_entries_filtered(
        &self,
        outcome: Option<&str>,
        query: Option<&str>,
        before_created_at: Option<&str>,
        before_id: Option<&str>,
        limit: u64,
    ) -> Result<(Vec<AuditEntry>, u64, bool), CoreError> {
        self.list_audit_entries_page(outcome, query, before_created_at, before_id, limit, None)
    }

    /// The page machinery behind [`Self::list_audit_entries_filtered`], with
    /// one extra restriction: when `actions` is `Some`, only rows whose
    /// `action` appears in that set are considered.
    ///
    /// Kept as a single implementation rather than a second copy of the query
    /// so the LIKE-escaping and the `(created_at, id)` keyset contract cannot
    /// drift between the general audit page and the security-events page
    /// ([`Store::list_security_events`](Self::list_security_events)) that
    /// shares it. An EMPTY `actions` slice matches nothing rather than
    /// falling through to an unfiltered dump — a caller that forgets to
    /// populate its allow-list must not be rewarded with every audit row.
    pub(crate) fn list_audit_entries_page(
        &self,
        outcome: Option<&str>,
        query: Option<&str>,
        before_created_at: Option<&str>,
        before_id: Option<&str>,
        limit: u64,
        actions: Option<&[&'static str]>,
    ) -> Result<(Vec<AuditEntry>, u64, bool), CoreError> {
        let bounded = limit.clamp(1, 200);

        let cursor = before_created_at.zip(before_id);
        let (where_sql, mut params, idx) =
            build_audit_where(outcome, query, actions, None, None, None, cursor);

        // Total matching rows (before the cursor) — powers the server-side
        // "X of Y" count and the unreviewed badge.
        let total: u64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM audit_log{where_sql}"),
            rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
            |row| row.get(0),
        )?;

        // Fetch one extra row to determine whether another page exists.
        params.push(Box::new(bounded + 1));
        let mut stmt = self.conn.prepare(&format!(
            "SELECT id, user_id, action, target_type, target_id, details, outcome, created_at
             FROM audit_log{where_sql} ORDER BY created_at DESC, id DESC LIMIT ?{idx}"
        ))?;
        let mut rows = stmt.query(rusqlite::params_from_iter(
            params.iter().map(|p| p.as_ref()),
        ))?;
        let mut items: Vec<AuditEntry> = Vec::new();
        while let Some(row) = rows.next()? {
            items.push(AuditEntry {
                id: row.get("id")?,
                user_id: row.get("user_id")?,
                action: row.get("action")?,
                target_type: row.get("target_type")?,
                target_id: row.get("target_id")?,
                details: row.get("details")?,
                outcome: row.get("outcome")?,
                created_at: row.get("created_at")?,
            });
            if items.len() as u64 > bounded {
                break;
            }
        }
        let has_more = items.len() as u64 > bounded;
        if has_more {
            items.truncate(bounded as usize);
        }
        Ok((items, total, has_more))
    }

    /// Return ALL audit entries matching the optional filters (AUD-09).
    ///
    /// Unlike [`Self::list_audit_entries_filtered`] (which clamps pages to
    /// 200 rows), this returns every matching row in deterministic
    /// newest-first `(created_at, id)` order for a server-side export
    /// snapshot, bounded by [`MAX_AUDIT_EXPORT_ROWS`] so a runaway table
    /// cannot exhaust memory. Shares the exact outcome/query WHERE
    /// construction of the filtered listing (no keyset cursor — an export
    /// is a full snapshot, not a paged continuation).
    pub fn list_audit_entries_export(
        &self,
        outcome: Option<&str>,
        query: Option<&str>,
    ) -> Result<Vec<AuditEntry>, CoreError> {
        let (where_sql, mut params, idx) =
            build_audit_where(outcome, query, None, None, None, None, None);

        params.push(Box::new(MAX_AUDIT_EXPORT_ROWS));
        let mut stmt = self.conn.prepare(&format!(
            "SELECT id, user_id, action, target_type, target_id, details, outcome, created_at
             FROM audit_log{where_sql} ORDER BY created_at DESC, id DESC LIMIT ?{idx}"
        ))?;
        let mut rows = stmt.query(rusqlite::params_from_iter(
            params.iter().map(|p| p.as_ref()),
        ))?;
        let mut items: Vec<AuditEntry> = Vec::new();
        while let Some(row) = rows.next()? {
            items.push(AuditEntry {
                id: row.get("id")?,
                user_id: row.get("user_id")?,
                action: row.get("action")?,
                target_type: row.get("target_type")?,
                target_id: row.get("target_id")?,
                details: row.get("details")?,
                outcome: row.get("outcome")?,
                created_at: row.get("created_at")?,
            });
        }
        Ok(items)
    }

    /// Return EVERY audit entry matching the security-event export filters
    /// (owner ruling D61-7, journal D84): an actions allow-list, an exact
    /// actor, and fixed-width ISO date bounds — for the security-event CSV
    /// export. The SECURITY_ACTIONS allowlist itself stays in
    /// audit_security.rs; this reader takes the already-restricted list and
    /// fails closed on an empty one (the shared WHERE builder's rule).
    ///
    /// Reuses the paged listing's WHERE construction via
    /// [`build_audit_where`] — no third copy of the filter logic — and
    /// caps at [`MAX_AUDIT_EXPORT_ROWS`] exactly like AUD-09. Newest-first
    /// `(created_at, id)` order, same deterministic snapshot shape.
    pub fn list_audit_entries_export_filtered(
        &self,
        actions: Option<&[&str]>,
        actor_user_id: Option<&str>,
        created_after: Option<String>,
        created_before: Option<String>,
        outcome: Option<String>,
        query: Option<String>,
    ) -> Result<Vec<AuditEntry>, CoreError> {
        let (where_sql, mut params, idx) = build_audit_where(
            outcome.as_deref(),
            query.as_deref(),
            actions,
            actor_user_id,
            created_after.as_deref(),
            created_before.as_deref(),
            None,
        );

        params.push(Box::new(MAX_AUDIT_EXPORT_ROWS));
        let mut stmt = self.conn.prepare(&format!(
            "SELECT id, user_id, action, target_type, target_id, details, outcome, created_at
             FROM audit_log{where_sql} ORDER BY created_at DESC, id DESC LIMIT ?{idx}"
        ))?;
        let mut rows = stmt.query(rusqlite::params_from_iter(
            params.iter().map(|p| p.as_ref()),
        ))?;
        let mut items: Vec<AuditEntry> = Vec::new();
        while let Some(row) = rows.next()? {
            items.push(AuditEntry {
                id: row.get("id")?,
                user_id: row.get("user_id")?,
                action: row.get("action")?,
                target_type: row.get("target_type")?,
                target_id: row.get("target_id")?,
                details: row.get("details")?,
                outcome: row.get("outcome")?,
                created_at: row.get("created_at")?,
            });
        }
        Ok(items)
    }

    // ── Review checkpoints (AUD-04) ────────────────────────────────

    /// Persist a server-side review checkpoint and emit the matching
    /// `audit.review` audit event in one transaction (AUD-04).
    pub fn save_review_checkpoint(
        &self,
        cp: &crate::AuditReviewCheckpoint,
    ) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO audit_review_checkpoints
             (id, store_id, reviewer_user_id, reviewed_at,
              reviewed_through_created_at, reviewed_through_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                cp.id,
                cp.store_id,
                cp.reviewer_user_id,
                cp.reviewed_at,
                cp.reviewed_through_created_at,
                cp.reviewed_through_id,
            ],
        )?;
        // The review action itself is an audit event (append-only).
        let details = serde_json::json!({
            "reviewed_through_created_at": cp.reviewed_through_created_at,
            "reviewed_through_id": cp.reviewed_through_id,
        })
        .to_string();
        let event = crate::AuditEntry::new(
            &cp.reviewer_user_id,
            "audit.review",
            Some("audit_review_checkpoint"),
            Some(&cp.id),
            Some(details),
            "success",
        );
        tx.execute(
            "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                event.id, event.user_id, event.action,
                event.target_type, event.target_id,
                event.details, event.outcome, event.created_at,
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Most recent review checkpoint for this store (newest first).
    pub fn latest_review_checkpoint(
        &self,
    ) -> Result<Option<crate::AuditReviewCheckpoint>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, store_id, reviewer_user_id, reviewed_at,
                    reviewed_through_created_at, reviewed_through_id
             FROM audit_review_checkpoints
             ORDER BY reviewed_at DESC, id DESC LIMIT 1",
        )?;
        let mut rows = stmt.query_map([], |row| {
            Ok(crate::AuditReviewCheckpoint {
                id: row.get(0)?,
                store_id: row.get(1)?,
                reviewer_user_id: row.get(2)?,
                reviewed_at: row.get(3)?,
                reviewed_through_created_at: row.get(4)?,
                reviewed_through_id: row.get(5)?,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    /// Count audit entries created strictly after a timestamp. Powers the
    /// server-side unreviewed badge (AUD-02/AUD-04) over the full table,
    /// independent of the currently loaded page.
    pub fn count_audit_entries_after(&self, created_at: &str) -> Result<u64, CoreError> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE created_at > ?1",
            rusqlite::params![created_at],
            |row| row.get(0),
        )?;
        Ok(n.max(0) as u64)
    }

    /// Aggregate audit metrics for the analytics-style summary strip.
    ///
    /// Returns total entries, success/failure counts, and a per-day event
    /// histogram over the trailing `days` window (each `created_at` ISO
    /// date truncated to `YYYY-MM-DD`). All counts are computed in SQL over
    /// the full table, not over a loaded page.
    #[allow(clippy::type_complexity)]
    pub fn audit_summary(
        &self,
        days: u64,
    ) -> Result<(u64, u64, u64, Vec<(String, u64)>), CoreError> {
        let total: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM audit_log", [], |row| row.get(0))?;

        let success: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE outcome = 'success'",
            [],
            |row| row.get(0),
        )?;

        let failures: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE outcome = 'failure'",
            [],
            |row| row.get(0),
        )?;

        // Day histogram over the trailing window: bucket by the leading
        // 10 chars of the ISO-8601 created_at (the date portion).
        let mut stmt = self.conn.prepare(
            "SELECT substr(created_at, 1, 10) AS day, COUNT(*)
             FROM audit_log
             WHERE created_at >= ?1
             GROUP BY day ORDER BY day",
        )?;
        let cutoff = chrono::Utc::now() - chrono::Duration::days(days as i64);
        let rows = stmt
            .query_map(
                rusqlite::params![cutoff.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u64)),
            )?
            .collect::<Result<Vec<_>, _>>()?;

        Ok((
            total.max(0) as u64,
            success.max(0) as u64,
            failures.max(0) as u64,
            rows,
        ))
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "audit_tests.rs"]
mod tests;
