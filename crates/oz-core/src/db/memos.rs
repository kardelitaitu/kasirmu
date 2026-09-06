//! Tenant-scoped Memo repository — the persistence behind the memo
//! lifecycle (Phase 2 P1).
//!
//! Owns the `memos`, `memo_revisions`, and `memo_recipients` tables. Every
//! read/write is tenant-scoped (`WHERE tenant_id = ?`). The repository
//! enforces DATA invariants (valid state transitions, non-blank content,
//! immutable revisions); AUTHORIZATION (the "author or higher role" early-stop
//! rule via [`crate::memo::may_stop`]) is enforced by the scoped IPC command
//! that holds the session role, mirroring how the rest of the store layer
//! separates persistence from permission.
//!
//! Publish is the one multi-table write: it flips `draft → published`, stamps
//! `published_at`/`expires_at` (expiry derived by the domain model), snapshots
//! revision 1 into `memo_revisions`, and fans out one `pending` recipient row
//! per target terminal (all terminals for an Organization Memo, the location's
//! bound terminals for a Location Memo). It runs in a single transaction so a
//! crash cannot leave a published memo without its revision or recipients.

use rusqlite::{OptionalExtension, params};

use crate::memo::{Memo, MemoDuration, MemoStatus, NewMemo};
use crate::{CoreError, Store};

/// Current UTC time in the schema's canonical ISO-8601 millisecond form.
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
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
    /// revision are assigned here; the caller supplies content + scope.
    pub fn create_memo_draft(&self, new: &NewMemo) -> Result<Memo, CoreError> {
        validate_new_memo(new)?;
        let id = uuid::Uuid::now_v7().to_string();
        let now = now_iso();
        let location_id = new
            .location_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        self.conn.execute(
            "INSERT INTO memos
                (id, tenant_id, location_id, author_user_id, author_role, title, body,
                 status, duration, revision, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'draft', ?8, 1, ?9, ?9)",
            params![
                id,
                new.tenant_id,
                location_id,
                new.author_user_id,
                new.author_role,
                new.title.trim(),
                new.body.trim(),
                new.duration.as_str(),
                now,
            ],
        )?;
        self.get_memo(&new.tenant_id, &id)
            .transpose()
            .ok_or_else(|| CoreError::Internal("memo vanished after insert".into()))?
    }

    /// Fetch one memo scoped to its tenant.
    pub fn get_memo(&self, tenant_id: &str, memo_id: &str) -> Result<Option<Memo>, CoreError> {
        self.conn
            .query_row(
                "SELECT id, tenant_id, location_id, author_user_id, author_role, title, body,
                        status, duration, revision, published_at, expires_at, stopped_at,
                        stopped_by, created_at, updated_at
                 FROM memos WHERE tenant_id = ?1 AND id = ?2",
                params![tenant_id, memo_id],
                Self::row_to_memo,
            )
            .optional()
            .map_err(CoreError::from)
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
        // Fan out one pending recipient per target terminal.
        let terminal_ids: Vec<String> = match memo.location_id.as_deref() {
            // Location Memo: terminals bound to that location.
            Some(loc) => {
                let mut s = tx
                    .prepare("SELECT id FROM terminals WHERE bound_location_id = ?1 ORDER BY id")?;
                s.query_map(params![loc], |r| r.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?
            }
            // Organization Memo: every registered terminal.
            None => {
                let mut s = tx.prepare("SELECT id FROM terminals ORDER BY id")?;
                s.query_map([], |r| r.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?
            }
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

    /// Early-stop a published memo: `published → stopped`. Records who and
    /// when. Authorization (author-or-higher) is the caller's gate; this
    /// enforces only that the memo is currently published.
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

    /// Map a `memos` row to the domain struct, failing closed on an unknown
    /// status/duration (the CHECK constraints make this unreachable unless the
    /// DB is corrupted).
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
        Ok(Memo {
            id: row.get("id")?,
            tenant_id: row.get("tenant_id")?,
            location_id: row.get("location_id")?,
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
