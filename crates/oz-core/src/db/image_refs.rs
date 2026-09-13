//! Cloud image content spine — refcount maintenance, missing-hash computation,
//! GC, and push-queue management (spec 0046b §3.7, §3.6).
//!
//! `image_refs` tracks per-tenant hash refcounts so `GET /api/v1/images/{hash}`
//! can verify the requesting tenant actually references the hash (closing
//! cross-tenant fetch). `missing_hashes` drives the server-side nudge that
//! tells the desktop which hashes the cloud still needs.
//! `image_push_queue` persists pending desktop→cloud uploads.

use super::Store;
use crate::error::CoreError;

/// The smallest SQLite ceiling this module must keep working on:
/// `SQLITE_MAX_VARIABLE_NUMBER` is 32 766 on the bundled rusqlite
/// 3.4x engine but **999** on any pre-3.32 build, so a data-driven statement
/// has to fit under 999 to be portable across the engines this crate ships on.
const SQLITE_MAX_VARIABLES: usize = 999;

/// Parameters a chunked `IN` statement binds BESIDES the chunk — the
/// leading `?1` tenant id in `Store::missing_hashes`.
/// Placeholder numbering starts at `1 + IMAGE_REFS_LEAD_PARAMS`, so
/// the ceiling check counts them too.
const IMAGE_REFS_LEAD_PARAMS: usize = 1;

/// How many values one data-driven `IN (…)` list in this module may
/// bind at a time.
///
/// `Store::missing_hashes`'s candidate hashes bind ONE PARAMETER PER
/// HASH, and the list length comes from DATA — every distinct image hash in a
/// tenant's catalog on `GET /api/v1/products` (its
/// `list_products` has no LIMIT), or a caller-supplied
/// `?hashes=a,b,c` on `GET /api/v1/images:missing` — not
/// from a fixed schema. Above the SQLite ceiling
/// ([`SQLITE_MAX_VARIABLES`]) the statement stops executing: the
/// handler answers 500, or — where the caller swallows the error with
/// `unwrap_or_default()` — silently answers the empty set. 900 plus
/// the lead parameter stays under even the historical 999 ceiling; see
/// `missing_hashes_survives_a_list_longer_than_the_chunk`.
///
/// This is a CHUNK SIZE, never a threshold that switches the filter off: a
/// long list is read in MORE chunks, not in an unscoped sweep that would
/// return rows outside the tenant or the whole table.
const IMAGE_REFS_IN_CHUNK: usize = 900;

/// Pin the invariant at COMPILE time: a chunk plus the leading parameters it
/// also binds must stay under the smallest supported ceiling, or the chunking
/// is itself the bug. A `const` assert fails every build, not only a
/// test run someone remembers.
const _: () = assert!(
    IMAGE_REFS_IN_CHUNK + IMAGE_REFS_LEAD_PARAMS < SQLITE_MAX_VARIABLES,
    "IMAGE_REFS_IN_CHUNK must stay below SQLite's 999-variables-per-statement ceiling (pre-3.32 builds)"
);

// ── Image refs (cloud content spine) ─────────────────────────────────

impl Store<'_> {
    /// Increment the refcount for `(tenant_id, hash)`, recording `bytes` on
    /// first insert. Idempotent when the (tenant, hash) pair already exists
    /// (refcount simply increases).
    pub fn ref_image(&self, tenant_id: &str, hash: &str, bytes: i64) -> Result<(), CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        self.conn.execute(
            "INSERT INTO image_refs (tenant_id, hash, refcount, bytes, updated_at)
             VALUES (?1, ?2, 1, ?3, ?4)
             ON CONFLICT(tenant_id, hash) DO UPDATE SET
                 refcount = refcount + 1,
                 bytes = excluded.bytes,
                 updated_at = excluded.updated_at",
            rusqlite::params![tenant_id, hash, bytes, now],
        )?;
        Ok(())
    }

    /// Decrement the refcount for `(tenant_id, hash)`.
    ///
    /// If the refcount reaches zero the row is kept for the grace window
    /// (cloud GC sweeps refcount=0 rows older than the configured grace).
    /// Returns the number of rows affected (0 means the pair did not exist).
    pub fn unref_image(&self, tenant_id: &str, hash: &str) -> Result<usize, CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let affected = self.conn.execute(
            "UPDATE image_refs SET refcount = MAX(refcount - 1, 0), updated_at = ?1
             WHERE tenant_id = ?2 AND hash = ?3",
            rusqlite::params![now, tenant_id, hash],
        )?;
        Ok(affected)
    }

    /// Check whether a tenant has an active reference to `hash`.
    pub fn image_ref_exists(&self, tenant_id: &str, hash: &str) -> Result<bool, CoreError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM image_refs WHERE tenant_id = ?1 AND hash = ?2 AND refcount > 0",
            rusqlite::params![tenant_id, hash],
            |r| r.get(0),
        )?;
        Ok(count > 0)
    }

    /// Given a list of candidate hashes, return the subset that the tenant
    /// does NOT have an active reference for (set-difference: candidates -
    /// present). Used by the server to compute `missing_hashes` on the
    /// catalog snapshot response.
    ///
    /// The candidate list is data-driven and unbounded (see
    /// [`IMAGE_REFS_IN_CHUNK`]), so it is read in chunks inside ONE
    /// transaction: each chunk rebuilds its placeholders and argument vector
    /// and feeds the same `present` set, and the result is projected
    /// at the end in the CALLER'S candidate order. The statement never ordered
    /// or deduplicated rows (no `ORDER BY`, no `DISTINCT` —
    /// the single-statement version had neither), so chunking changes no
    /// result shape: a hash duplicated in the input still flows through
    /// duplicated, exactly as before; both real callers dedup upstream.
    pub fn missing_hashes<'a>(
        &self,
        tenant_id: &str,
        candidates: &[&'a str],
    ) -> Result<Vec<&'a str>, CoreError> {
        if candidates.is_empty() {
            return Ok(vec![]);
        }
        use std::collections::HashSet;
        // ONE transaction around the whole chunk loop: every chunk reads the
        // same snapshot, so a concurrent ref/unref between chunks cannot split
        // the answer.
        let tx = self.conn.unchecked_transaction()?;
        // THE CHUNK LOOP, and the ACCUMULATOR the chunks feed. Chunks are
        // DISJOINT by hash and this query is a pure filter, so the union of
        // the per-chunk hits is exactly the set one query over the whole list
        // returns — there is no fallback to a tenant-wide statement when the
        // list is long; that would be the hole the filter exists to close.
        let mut present: HashSet<String> = HashSet::new();
        for chunk in candidates.chunks(IMAGE_REFS_IN_CHUNK) {
            let placeholders: Vec<String> = (1..=chunk.len())
                .map(|i| format!("?{}", i + IMAGE_REFS_LEAD_PARAMS)) // ?1 = tenant_id, ?2.. = hashes
                .collect();
            let sql = format!(
                "SELECT hash FROM image_refs WHERE tenant_id = ?1 AND hash IN ({}) AND refcount > 0",
                placeholders.join(", ")
            );
            let mut stmt = tx.prepare(&sql)?;
            let mut param_refs: Vec<&dyn rusqlite::types::ToSql> =
                Vec::with_capacity(chunk.len() + IMAGE_REFS_LEAD_PARAMS);
            param_refs.push(&tenant_id as &dyn rusqlite::types::ToSql);
            for c in chunk {
                param_refs.push(c);
            }
            let rows: Vec<String> = stmt
                .query_map(param_refs.as_slice(), |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            present.extend(rows);
        }
        tx.commit()?;
        Ok(candidates
            .iter()
            .filter(|c| !present.contains(**c))
            .copied()
            .collect())
    }

    /// Sweep rows where refcount = 0 and updated_at is older than
    /// `grace_secs`. Returns the deleted hashes so the caller can remove
    /// the corresponding files.
    pub fn gc_images(&self, tenant_id: &str, grace_secs: i64) -> Result<Vec<String>, CoreError> {
        let cutoff = format!("-{grace_secs} seconds");
        let mut stmt = self.conn.prepare(
            "DELETE FROM image_refs
             WHERE tenant_id = ?1 AND refcount = 0
               AND datetime(updated_at) <= datetime('now', ?2)
             RETURNING hash",
        )?;
        let hashes: Vec<String> = stmt
            .query_map(rusqlite::params![tenant_id, cutoff], |r| r.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(hashes)
    }

    /// Sum of `bytes` for all active refs (refcount > 0) for the tenant.
    /// Used for the 4 GB soft-alert metric (§3.7).
    pub fn image_bytes_used(&self, tenant_id: &str) -> Result<i64, CoreError> {
        self.conn
            .query_row(
                "SELECT COALESCE(SUM(bytes), 0) FROM image_refs WHERE tenant_id = ?1 AND refcount > 0",
                rusqlite::params![tenant_id],
                |r| r.get(0),
            )
            .map_err(CoreError::from)
    }

    // ── Push queue management (desktop) ───────────────────────────────

    /// Enqueue a hash for upload. Idempotent: if the hash is already in the
    /// queue, the existing row is kept (no-op).
    pub fn enqueue_image_push(&self, hash: &str, size_bytes: i64) -> Result<(), CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        self.conn.execute(
            "INSERT OR IGNORE INTO image_push_queue (hash, size_bytes, next_attempt_at, enqueued_at)
             VALUES (?1, ?2, ?3, ?3)",
            rusqlite::params![hash, size_bytes, now],
        )?;
        Ok(())
    }

    /// Peek the next batch of up to `limit` images ready for upload (rows
    /// whose `next_attempt_at` is due). Returns (hash, size_bytes, attempts).
    pub fn peek_push_batch(&self, limit: usize) -> Result<Vec<(String, i64, i32)>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT hash, size_bytes, attempts FROM image_push_queue
             WHERE datetime(next_attempt_at) <= datetime('now')
             ORDER BY next_attempt_at ASC, enqueued_at ASC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![limit as i64], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Record a push attempt for a hash. On success the row is deleted; on
    /// failure the attempt counter is bumped and `next_attempt_at` is set
    /// with AWS full-jitter backoff: delay = uniform(0, min(30 min, 60 s *
    /// 2^attempts)). After 8 attempts the entry is dead-lettered (deleted).
    pub fn mark_push_attempt(&self, hash: &str, success: bool) -> Result<(), CoreError> {
        use rand::Rng;
        if success {
            self.conn.execute(
                "DELETE FROM image_push_queue WHERE hash = ?1",
                rusqlite::params![hash],
            )?;
            return Ok(());
        }
        // Fetch current attempts
        let (attempts,): (i32,) = self
            .conn
            .query_row(
                "SELECT attempts FROM image_push_queue WHERE hash = ?1",
                rusqlite::params![hash],
                |r| Ok((r.get(0)?,)),
            )
            .unwrap_or((0,));
        let next_attempt = attempts + 1;
        if next_attempt > 8 {
            // Dead-letter after 8 attempts — delete and return
            self.conn.execute(
                "DELETE FROM image_push_queue WHERE hash = ?1",
                rusqlite::params![hash],
            )?;
            return Ok(());
        }
        // AWS full-jitter: delay = uniform(0, min(30 min, 60 s * 2^attempts))
        let max_base = 60_i64 * 2_i64.pow(attempts as u32);
        let limit = max_base.min(1800); // 30 minutes in seconds
        let delay_secs: i64 = rand::thread_rng().gen_range(0..=limit);
        let next_at = format!("+{delay_secs} seconds");
        self.conn.execute(
            "UPDATE image_push_queue
             SET attempts = ?1, next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?2)
             WHERE hash = ?3",
            rusqlite::params![next_attempt, next_at, hash],
        )?;
        Ok(())
    }

    /// Delete a dead-lettered (or manually cleared) push entry.
    pub fn clear_push_entry(&self, hash: &str) -> Result<(), CoreError> {
        self.conn.execute(
            "DELETE FROM image_push_queue WHERE hash = ?1",
            rusqlite::params![hash],
        )?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "image_refs_tests.rs"]
mod tests;
