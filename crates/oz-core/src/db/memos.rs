//! Tenant-scoped Memo repository — the persistence behind the memo
//! lifecycle (Phase 2 P1).
//!
//! Owns the `memos`, `memo_locations`, `memo_revisions`, and `memo_recipients`
//! tables. Every read/write is tenant-scoped (`WHERE tenant_id = ?`). The
//! repository enforces DATA invariants (valid state transitions, non-blank
//! content, immutable revisions); AUTHORIZATION (the early-stop rule ruled
//! 2026-09-07: the AUTHOR may always stop their own memo, otherwise the actor
//! must hold `memo:stop`) is enforced by the scoped IPC command that holds
//! the session, mirroring how the rest of the store layer separates
//! persistence from permission.
//!
//! Targeting: a memo carries zero or more `memo_locations` rows. Zero rows ⇒
//! Organization Memo (every terminal of the tenant); one or more ⇒ Location
//! Memo for exactly those locations. Publish is the one multi-table write: it
//! flips `draft → published`, stamps `published_at`/`expires_at` (expiry
//! derived by the domain model), snapshots revision 1 into `memo_revisions`,
//! and fans out one `pending` recipient row per target terminal. It runs in a
//! single transaction so a crash cannot leave a published memo without its
//! revision or recipients.

use rusqlite::{OptionalExtension, params};

use crate::memo::{ActiveMemo, DeliveryStatus, Memo, MemoDuration, MemoStatus, NewMemo};
use crate::{CoreError, Store};

/// Current UTC time in the schema's canonical ISO-8601 millisecond form.
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Normalize the caller-supplied targeting set: trim each id, drop blanks,
/// dedupe preserving first-occurrence order. An empty result is an
/// Organization Memo — the empty set is the organization-wide audience.
fn normalize_location_ids(ids: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for id in ids {
        let trimmed = id.trim();
        if !trimmed.is_empty() && seen.insert(trimmed.to_owned()) {
            out.push(trimmed.to_owned());
        }
    }
    out
}

/// Validate draft content before it can be persisted.
fn validate_new_memo(new: &NewMemo) -> Result<(), CoreError> {
    if new.tenant_id.trim().is_empty() {
        return Err(CoreError::Validation {
            field: "tenant_id",
            message: "must not be empty".into(),
        });
    }
    if new.author_user_id.trim().is_empty() {
        return Err(CoreError::Validation {
            field: "author_user_id",
            message: "must not be empty".into(),
        });
    }
    if new.title.trim().is_empty() {
        return Err(CoreError::Validation {
            field: "title",
            message: "must not be empty".into(),
        });
    }
    if new.body.trim().is_empty() {
        return Err(CoreError::Validation {
            field: "body",
            message: "must not be empty".into(),
        });
    }
    Ok(())
}

impl Store<'_> {
    /// Create a memo in the `draft` state. The id, timestamps, status, and
    /// revision are assigned here; the caller supplies content + scope. The
    /// targeting set is normalized (trimmed, deduped) before the rows are
    /// written; an unknown location id fails the foreign key.
    pub fn create_memo_draft(&self, new: &NewMemo) -> Result<Memo, CoreError> {
        validate_new_memo(new)?;
        let location_ids = normalize_location_ids(&new.location_ids);
        let id = uuid::Uuid::now_v7().to_string();
        let now = now_iso();
        // One transaction so a draft can never exist without its targeting
        // rows (or vice versa — a memo_locations row whose memo vanished).
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO memos
                (id, tenant_id, author_user_id, author_role, title, body,
                 status, duration, revision, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, 1, ?8, ?8)",
            params![
                id,
                new.tenant_id,
                new.author_user_id,
                new.author_role,
                new.title.trim(),
                new.body.trim(),
                new.duration.as_str(),
                now,
            ],
        )?;
        for location_id in &location_ids {
            tx.execute(
                "INSERT INTO memo_locations (memo_id, location_id, tenant_id)
                 VALUES (?1, ?2, ?3)",
                params![id, location_id, new.tenant_id],
            )?;
        }
        tx.commit()?;
        self.get_memo(&new.tenant_id, &id)
            .transpose()
            .ok_or_else(|| CoreError::Internal("memo vanished after insert".into()))?
    }

    /// Fetch one memo scoped to its tenant.
    pub fn get_memo(&self, tenant_id: &str, memo_id: &str) -> Result<Option<Memo>, CoreError> {
        self.conn
            .query_row(
                "SELECT m.id, m.tenant_id, m.author_user_id, m.author_role, m.title, m.body,
                        m.status, m.duration, m.revision, m.published_at, m.expires_at,
                        m.stopped_at, m.stopped_by, m.created_at, m.updated_at,
                        (SELECT GROUP_CONCAT(ml.location_id, ',')
                         FROM memo_locations ml WHERE ml.memo_id = m.id) AS location_ids_csv
                 FROM memos m WHERE m.tenant_id = ?1 AND m.id = ?2",
                params![tenant_id, memo_id],
                Self::row_to_memo,
            )
            .optional()
            .map_err(CoreError::from)
    }

    /// List every memo authored by a given user within a tenant, newest first —
    /// the management read behind an author's "my Memos" view (drafts,
    /// published, and terminal states alike, so they can see and act on their
    /// own history). Deliberately filters on *authorship*, not on the
    /// location/org authority a scoped "manage all Memos" view would require —
    /// that broader view waits for Phase 1 scoped authorization.
    pub fn list_memos_authored_by(
        &self,
        tenant_id: &str,
        author_user_id: &str,
    ) -> Result<Vec<Memo>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT m.id, m.tenant_id, m.author_user_id, m.author_role, m.title, m.body,
                    m.status, m.duration, m.revision, m.published_at, m.expires_at,
                    m.stopped_at, m.stopped_by, m.created_at, m.updated_at,
                    (SELECT GROUP_CONCAT(ml.location_id, ',')
                     FROM memo_locations ml WHERE ml.memo_id = m.id) AS location_ids_csv
             FROM memos m WHERE m.tenant_id = ?1 AND m.author_user_id = ?2
             ORDER BY m.created_at DESC",
        )?;
        let rows = stmt.query_map(params![tenant_id, author_user_id], Self::row_to_memo)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Publish a draft: `draft → published`, stamp expiry, snapshot revision 1,
    /// and fan out pending recipients. Idempotent-safe: publishing an already
    /// published memo is rejected (only a draft may be published).
    pub fn publish_memo(&self, tenant_id: &str, memo_id: &str) -> Result<Memo, CoreError> {
        let memo = self
            .get_memo(tenant_id, memo_id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "memo",
                id: memo_id.into(),
            })?;
        if !MemoStatus::can_transition(memo.status, MemoStatus::Published) {
            return Err(CoreError::Validation {
                field: "status",
                message: format!("cannot publish a memo in state '{}'", memo.status.as_str()),
            });
        }
        let published_at = now_iso();
        let published_dt = chrono::DateTime::parse_from_rfc3339(&published_at)
            .map_err(|e| CoreError::Internal(format!("bad publish timestamp: {e}")))?
            .with_timezone(&chrono::Utc);
        let expires_at = memo
            .duration
            .expires_at(published_dt)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE memos
             SET status = 'published', published_at = ?2, expires_at = ?3, updated_at = ?3
             WHERE tenant_id = ?1 AND id = ?4 AND status = 'draft'",
            params![tenant_id, published_at, expires_at, memo_id],
        )?;
        // Snapshot the immutable revision 1 (title/body as published).
        tx.execute(
            "INSERT INTO memo_revisions
                (id, memo_id, tenant_id, revision, title, body, published_at, published_by)
             VALUES (?1, ?2, ?7, 1, ?3, ?4, ?5, ?6)",
            params![
                uuid::Uuid::now_v7().to_string(),
                memo_id,
                memo.title,
                memo.body,
                published_at,
                memo.author_user_id,
                tenant_id,
            ],
        )?;
        // Fan out one pending recipient per target terminal. Both branches
        // filter on `terminals.tenant_id` (20260912_terminals_tenant.sql) so a
        // fan-out can never cross a tenant boundary; the subquery's tenant
        // predicate is defense-in-depth: it yields an empty (leak-free) set if
        // a targeting row ever pointed at another tenant's location.
        let terminal_ids: Vec<String> = if memo.location_ids.is_empty() {
            // Organization Memo (empty targeting set): every terminal owned by
            // the memo's tenant.
            let mut s = tx.prepare("SELECT id FROM terminals WHERE tenant_id = ?1 ORDER BY id")?;
            s.query_map(params![tenant_id], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            // Location Memo: the memo's tenant's terminals bound to ANY of the
            // targeted locations.
            let mut s = tx.prepare(
                "SELECT id FROM terminals
                 WHERE tenant_id = ?1
                   AND bound_location_id IN (SELECT location_id FROM memo_locations
                                             WHERE memo_id = ?2 AND tenant_id = ?1)
                 ORDER BY id",
            )?;
            s.query_map(params![tenant_id, memo_id], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        };
        for terminal_id in &terminal_ids {
            tx.execute(
                "INSERT INTO memo_recipients (id, memo_id, tenant_id, terminal_id, delivery_status)
                 VALUES (?1, ?2, ?4, ?3, 'pending')
                 ON CONFLICT (memo_id, terminal_id) DO NOTHING",
                params![
                    uuid::Uuid::now_v7().to_string(),
                    memo_id,
                    terminal_id,
                    tenant_id,
                ],
            )?;
        }
        tx.commit()?;
        self.get_memo(tenant_id, memo_id)?
            .ok_or_else(|| CoreError::Internal("memo vanished after publish".into()))
    }

    /// Correct a published memo. Content is immutable, so a correction does
    /// NOT edit in place: it inserts a NEW immutable `memo_revisions` row and
    /// bumps `memos.revision`; prior revision rows are never mutated (the
    /// spec's "published content is immutable; corrections create a new
    /// revision"). The memo stays `published`, and its `published_at` /
    /// `expires_at` are left untouched — a correction fixes the text, it does
    /// not extend the memo's life. Authorization (author-or-higher) is the
    /// caller's gate; this enforces only that the memo is published and the
    /// new content is non-blank.
    pub fn revise_memo(
        &self,
        tenant_id: &str,
        memo_id: &str,
        actor_user_id: &str,
        title: &str,
        body: &str,
    ) -> Result<Memo, CoreError> {
        if title.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "title",
                message: "must not be empty".into(),
            });
        }
        if body.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "body",
                message: "must not be empty".into(),
            });
        }
        let memo = self
            .get_memo(tenant_id, memo_id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "memo",
                id: memo_id.into(),
            })?;
        if memo.status != MemoStatus::Published {
            return Err(CoreError::Validation {
                field: "status",
                message: format!(
                    "can only revise a published memo, not '{}'",
                    memo.status.as_str()
                ),
            });
        }
        let now = now_iso();
        let new_revision = memo.revision + 1;
        let tx = self.conn.unchecked_transaction()?;
        // Re-check the guard inside the UPDATE and read the affected-row count:
        // the memo could have left `published` between the read above and this
        // statement — the expiry sweep daemon transitions `published → expired`
        // on a timer. If the predicate matched 0 rows, the memo is no longer
        // published, so we must NOT write a revision it never had (that would
        // corrupt the audit trail the feature exists to keep). Returning before
        // `tx.commit()` rolls the whole transaction back, so the INSERT below
        // never runs. Mirrors `mark_delivered`'s `changed == 0` handling.
        let changed = tx.execute(
            "UPDATE memos
             SET title = ?2, body = ?3, revision = ?4, updated_at = ?5
             WHERE tenant_id = ?1 AND id = ?6 AND status = 'published'",
            params![tenant_id, title, body, new_revision, now, memo_id],
        )?;
        if changed == 0 {
            return Err(CoreError::Validation {
                field: "status",
                message: "memo is no longer published (expired or stopped); cannot revise".into(),
            });
        }
        tx.execute(
            "INSERT INTO memo_revisions
                (id, memo_id, tenant_id, revision, title, body, published_at, published_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                uuid::Uuid::now_v7().to_string(),
                memo_id,
                tenant_id,
                new_revision,
                title,
                body,
                now,
                actor_user_id,
            ],
        )?;
        tx.commit()?;
        self.get_memo(tenant_id, memo_id)?
            .ok_or_else(|| CoreError::Internal("memo vanished after revise".into()))
    }

    /// Early-stop a published memo: `published → stopped`. Records who and
    /// when. Authorization (the author, or a `memo:stop` holder — 2026-09-07
    /// A2 ruling) is the caller's gate; this enforces only that the memo is
    /// currently published.
    pub fn stop_memo(
        &self,
        tenant_id: &str,
        memo_id: &str,
        actor_user_id: &str,
    ) -> Result<Memo, CoreError> {
        let memo = self
            .get_memo(tenant_id, memo_id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "memo",
                id: memo_id.into(),
            })?;
        if !MemoStatus::can_transition(memo.status, MemoStatus::Stopped) {
            return Err(CoreError::Validation {
                field: "status",
                message: format!("cannot stop a memo in state '{}'", memo.status.as_str()),
            });
        }
        let now = now_iso();
        self.conn.execute(
            "UPDATE memos
             SET status = 'stopped', stopped_at = ?2, stopped_by = ?3, updated_at = ?2
             WHERE tenant_id = ?1 AND id = ?4 AND status = 'published'",
            params![tenant_id, now, actor_user_id, memo_id],
        )?;
        self.get_memo(tenant_id, memo_id)?
            .ok_or_else(|| CoreError::Internal("memo vanished after stop".into()))
    }

    /// List the memos a given terminal should currently display, each paired
    /// with that terminal's delivery state.
    ///
    /// "Active" = the memo is `published`, not past its `expires_at` (defensive
    /// against an un-swept row), and this terminal is a recipient. Ordering
    /// stacks Location Memos above Organization Memos (the spec's display
    /// rule): an Organization memo has no targeting rows so `EXISTS` is false
    /// (0) and sorts second under `DESC`; a Location memo has rows (1) and
    /// sorts first. Within each tier, newest-published first.
    pub fn list_active_for_terminal(
        &self,
        tenant_id: &str,
        terminal_id: &str,
        now: &str,
    ) -> Result<Vec<ActiveMemo>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT m.*, r.delivery_status AS recipient_status,
                    (SELECT GROUP_CONCAT(ml.location_id, ',')
                     FROM memo_locations ml WHERE ml.memo_id = m.id) AS location_ids_csv
             FROM memos m
             JOIN memo_recipients r ON r.memo_id = m.id
             WHERE m.tenant_id = ?1 AND r.tenant_id = ?1 AND r.terminal_id = ?2
               AND m.status = 'published'
               AND (m.expires_at IS NULL OR m.expires_at > ?3)
             ORDER BY (EXISTS (SELECT 1 FROM memo_locations ml WHERE ml.memo_id = m.id)) DESC,
                      m.published_at DESC",
        )?;
        let rows = stmt.query_map(params![tenant_id, terminal_id, now], |row| {
            let memo = Self::row_to_memo(row)?;
            let ds_str: String = row.get("recipient_status")?;
            let delivery_status = DeliveryStatus::parse(&ds_str).ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(crate::memo::ParseError(ds_str.clone())),
                )
            })?;
            Ok(ActiveMemo {
                memo,
                delivery_status,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Record that a terminal received a memo: `pending → delivered`.
    /// Idempotent — an already-delivered/acknowledged recipient is a no-op
    /// success; an unknown recipient is `NotFound`.
    pub fn mark_recipient_delivered(
        &self,
        tenant_id: &str,
        memo_id: &str,
        terminal_id: &str,
    ) -> Result<(), CoreError> {
        let now = now_iso();
        let changed = self.conn.execute(
            "UPDATE memo_recipients
             SET delivery_status = 'delivered', delivered_at = ?4
             WHERE tenant_id = ?1 AND memo_id = ?2 AND terminal_id = ?3
               AND delivery_status = 'pending'",
            params![tenant_id, memo_id, terminal_id, now],
        )?;
        if changed == 0 {
            self.require_recipient(tenant_id, memo_id, terminal_id)?;
        }
        Ok(())
    }

    /// Record a user's acknowledgement: `pending|delivered → acknowledged`. An
    /// ack proves delivery, so `delivered_at` is backfilled if absent.
    /// Idempotent — an already-acknowledged recipient is a no-op success; an
    /// unknown recipient is `NotFound`.
    pub fn acknowledge_memo(
        &self,
        tenant_id: &str,
        memo_id: &str,
        terminal_id: &str,
        user_id: &str,
    ) -> Result<(), CoreError> {
        let now = now_iso();
        let changed = self.conn.execute(
            "UPDATE memo_recipients
             SET delivery_status = 'acknowledged',
                 delivered_at = COALESCE(delivered_at, ?4),
                 acknowledged_at = ?4,
                 acknowledged_by = ?5
             WHERE tenant_id = ?1 AND memo_id = ?2 AND terminal_id = ?3
               AND delivery_status IN ('pending', 'delivered')",
            params![tenant_id, memo_id, terminal_id, now, user_id],
        )?;
        if changed == 0 {
            self.require_recipient(tenant_id, memo_id, terminal_id)?;
        }
        Ok(())
    }

    /// Sweep published memos whose `expires_at` has passed to `expired`.
    /// Returns the number swept. Runs the domain's `Published → Expired`
    /// transition in bulk; safe to call repeatedly (idempotent).
    pub fn sweep_expired(&self, tenant_id: &str, now: &str) -> Result<usize, CoreError> {
        let swept = self.conn.execute(
            "UPDATE memos
             SET status = 'expired', updated_at = ?2
             WHERE tenant_id = ?1 AND status = 'published'
               AND expires_at IS NOT NULL AND expires_at <= ?2",
            params![tenant_id, now],
        )?;
        Ok(swept)
    }

    /// Sweep every tenant's past-due published memos to `expired`. This is the
    /// background maintenance variant the expiry daemon calls on the whole
    /// database; unlike a user-facing read it legitimately spans tenants (the
    /// system tidying its own rows), so it carries no `tenant_id` filter.
    /// Returns the number swept; idempotent.
    pub fn sweep_all_expired(&self, now: &str) -> Result<usize, CoreError> {
        let swept = self.conn.execute(
            "UPDATE memos
             SET status = 'expired', updated_at = ?1
             WHERE status = 'published'
               AND expires_at IS NOT NULL AND expires_at <= ?1",
            params![now],
        )?;
        Ok(swept)
    }

    /// Error if no such recipient exists for this tenant/memo/terminal; Ok if
    /// it exists (used to distinguish a no-op idempotent update from a genuine
    /// missing row).
    fn require_recipient(
        &self,
        tenant_id: &str,
        memo_id: &str,
        terminal_id: &str,
    ) -> Result<(), CoreError> {
        let exists: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM memo_recipients
             WHERE tenant_id = ?1 AND memo_id = ?2 AND terminal_id = ?3",
            params![tenant_id, memo_id, terminal_id],
            |r| r.get(0),
        )?;
        if exists == 0 {
            return Err(CoreError::NotFound {
                entity: "memo_recipient",
                id: format!("{memo_id}/{terminal_id}"),
            });
        }
        Ok(())
    }

    /// Map a `memos` row to the domain struct, failing closed on an unknown
    /// status/duration (the CHECK constraints make this unreachable unless the
    /// DB is corrupted). `location_ids_csv` is the GROUP_CONCAT subquery over
    /// `memo_locations` — `NULL` for an Organization Memo (no targeting rows),
    /// a comma-joined list otherwise (location ids are UUIDs, so ',' cannot
    /// appear inside one).
    fn row_to_memo(row: &rusqlite::Row<'_>) -> rusqlite::Result<Memo> {
        let status_str: String = row.get("status")?;
        let duration_str: String = row.get("duration")?;
        let status = MemoStatus::parse(&status_str).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(crate::memo::ParseError(status_str.clone())),
            )
        })?;
        let duration = duration_str.parse::<MemoDuration>().map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(crate::memo::ParseError(duration_str.clone())),
            )
        })?;
        let location_ids_csv: Option<String> = row.get("location_ids_csv")?;
        let location_ids = location_ids_csv
            .map(|csv| {
                csv.split(',')
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Ok(Memo {
            id: row.get("id")?,
            tenant_id: row.get("tenant_id")?,
            location_ids,
            author_user_id: row.get("author_user_id")?,
            author_role: row.get("author_role")?,
            title: row.get("title")?,
            body: row.get("body")?,
            status,
            duration,
            revision: row.get("revision")?,
            published_at: row.get("published_at")?,
            expires_at: row.get("expires_at")?,
            stopped_at: row.get("stopped_at")?,
            stopped_by: row.get("stopped_by")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

#[cfg(test)]
#[path = "memos_tests.rs"]
mod tests;
