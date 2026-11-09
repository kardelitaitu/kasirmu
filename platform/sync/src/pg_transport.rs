//! PostgreSQL Transport — writes offline queue items directly to a remote
//! PostgreSQL database via `tokio-postgres`.
/*
last audited 25-07-26 by RSA-Agent (platform-sync slice F: pg_transport deep read)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: exemplary — every query tenant-scoped via SET LOCAL oz.tenant_id GUC inside a transaction plus WHERE tenant_id (FORCEd-RLS safe); NO vector stamping here, BY DESIGN (see the module note 'Vector stamping'); fully parameterized static SQL; commit failure surfaces as Err (documented fix: a swallowed commit previously reported Accepted locally while the remote never received the items); tenant mismatch rejected per item; TLS via rustls native roots with sslmode Require; redacted Debug; composite (created_at,id) cursor with cursor-from-kept-row truncation (RUST-07); anchor-expiry MIN query tenant-scoped inside the tx; users snapshot query excludes pin_hash (SYNC-06 PG parity); synced_at decoded as Option avoiding first-row panic
next: none | perf: deadpool pool max 5 with bounded timeouts
*/
//!
//! This transport bypasses the HTTP sync server and writes directly to a
//! cloud PostgreSQL database (AWS RDS, Azure Database for PostgreSQL, etc.).
//!
//! # Vector stamping
//!
//! This path does NOT stamp payloads with `_vector`/`_terminal`, and that is
//! deliberate, not an omission. `_vector` is consumed by exactly one reader:
//! the cloud HTTP push handler (`apps/cloud-server/src/sync_store.rs`), which
//! runs `extract_vector` before inserting a pushed item. A direct-PG push
//! never passes through that handler — it inserts into the remote
//! `offline_queue` table, and the peer pulls the row and applies it locally
//! through `SyncQueue::apply_remote_atomic_full` (the shared resolution path).
//! A vector would have no reader here.
//!
//! The transport still carries terminal identity, but on a different
//! channel: `with_terminal_id` sets `origin_terminal_id` on the inserted row,
//! and the pull excludes the sender's own rows. That column is the identity
//! this path uses; `_vector` is the identity the HTTP path uses. Do not
//! "fix" the missing stamp by adding one — it would be dead metadata.
//!
//! # Push batching (O-H20)
//!
//! `push_items` batches: it issues ONE multi-row `INSERT ... VALUES (...)`
//! per [`PG_INSERT_CHUNK_ROWS`] rows instead of one INSERT per item, all
//! inside the same tenant transaction, so a 5,000-item drain is 5 round
//! trips rather than 5,000. A statement text this path was not written with
//! costs two round trips instead of one: `tokio-postgres` sends `Parse`,
//! waits for `ParseComplete`, then sends `Bind`+`Execute`+`Sync` — the
//! driver has no multi-message flush. That is still 2 per CHUNK, not 2 per
//! item, but do not describe the prepared-statement path in this file as a
//! single round trip without first changing how the driver is driven.

use deadpool_postgres::Pool;
use kasirmu_core::offline::{OfflineQueueItem, OfflineQueueStatus};
use tokio_postgres::{NoTls, types::ToSql};

use crate::SyncError;

/// Transport that writes offline queue items to a remote PostgreSQL database.
///
/// Every query is scoped to the transport's `tenant_id` (set at construction):
/// a `WHERE tenant_id = $` clause in the SQL and a `SET LOCAL oz.tenant_id`
/// GUC in a transaction. This ensures tenants are isolated even when the
/// transport connects to a shared multi-tenant database.
pub struct PgTransport {
    pool: Pool,
    tenant_id: String,
    /// C3 S5: this install's own terminal identity, when paired. Pulls
    /// exclude rows carrying it, so a terminal is never handed back its own
    /// pushes. `None` (an unpaired install, or a caller that never sets it)
    /// leaves the pull unfiltered — exactly today's behaviour.
    terminal_id: Option<String>,
}

/// Maximum rows returned per pull page (mirrors the HTTP server's 500).
/// The transport fetches one extra row (501) to detect whether more pages
/// exist (P-3 pagination).
const PG_PULL_PAGE_SIZE: usize = 500;
const PG_PULL_FETCH_LIMIT: i64 = 501;

/// One column of the push INSERT, in insertion order.
///
/// Each row binds exactly the [`PushColumn::BIND`] columns, in tuple order,
/// so the emitted placeholder numbers and the bind list are derived from
/// this ONE list and cannot disagree — see [`pg_insert_sql`].
#[derive(Clone, Copy)]
enum PushColumn {
    /// `id`, bound.
    Id,
    /// `action`, bound.
    Action,
    /// `payload`, bound.
    Payload,
    /// `status` — a LITERAL (`'pending'`), never bound: the local queue
    /// status is not the remote column's value.
    Status,
    /// `retry_count`, bound.
    RetryCount,
    /// `last_error`, bound.
    LastError,
    /// `tenant_id`, bound.
    TenantId,
    /// `origin_terminal_id`, bound.
    OriginTerminalId,
}

impl PushColumn {
    /// Columns in tuple order — the INSERT column list, verbatim.
    const ALL: [Self; 8] = [
        Self::Id,
        Self::Action,
        Self::Payload,
        Self::Status,
        Self::RetryCount,
        Self::LastError,
        Self::TenantId,
        Self::OriginTerminalId,
    ];

    /// The literal text this slot stands for when it is NOT bound.
    ///
    /// Only [`Self::Status`] has one; every other column is emitted as the
    /// placeholder the caller numbers.
    const fn literal(self) -> &'static str {
        match self {
            Self::Status => "'pending'",
            Self::Id => "",
            Self::Action => "",
            Self::Payload => "",
            Self::RetryCount => "",
            Self::LastError => "",
            Self::TenantId => "",
            Self::OriginTerminalId => "",
        }
    }

    /// Whether this column takes a bind parameter.
    const fn is_bound(self) -> bool {
        !matches!(self, Self::Status)
    }

    /// The number of bound columns per row — 7 of the 8 tuple slots.
    const BINDS_PER_ROW: usize = 7;
}

/// PostgreSQL's hard cap on bind parameters in a single statement
/// (wire protocol `Int16` parameter count).
const PG_MAX_BIND_PARAMS: usize = 65_535;

/// A chunk must stay inside [`PG_MAX_BIND_PARAMS`] — checked at compile
/// time, so a future bump of [`PG_INSERT_CHUNK_ROWS`] cannot silently push
/// the statement past the protocol limit.
const _: () = assert!(PG_INSERT_CHUNK_ROWS * PushColumn::BINDS_PER_ROW < PG_MAX_BIND_PARAMS);

/// Rows per multi-row push INSERT (O-H20).
///
/// 1,000 × 7 binds = 7,000 parameters — roughly a tenth of
/// [`PG_MAX_BIND_PARAMS`], so even an item whose payload is tens of
/// kilobytes stays far from the ~65,535 parameters and the 1 GiB
/// statement ceiling. 1,000 also keeps the per-statement tuple list small
/// enough that PostgreSQL's parse time stays flat, which a ~9,000-row
/// chunk (the raw parameter cap) does not. So a 5,000-item drain is **5**
/// round trips instead of 5,000.
const PG_INSERT_CHUNK_ROWS: usize = 1_000;

/// Sentinel an item's outcome slot carries between admission and its
/// chunk's result. Never observable: every slot is overwritten before
/// `push_items` returns (a test pins that).
const PG_INSERT_OUTCOME_PLACEHOLDER: &str = "pg insert outcome unresolved";

/// The push INSERT header: every column the per-item INSERT named, in the
/// same order, plus the `VALUES` keyword the tuples follow.
const PG_INSERT_HEAD: &str = "INSERT INTO offline_queue (id, action, payload, status, retry_count, last_error, tenant_id, origin_terminal_id)\n     VALUES ";

/// The push INSERT trailer: the upsert the per-item INSERT carried,
/// unchanged — a duplicate id is accepted without overwriting the row.
const PG_INSERT_TAIL: &str = "\n     ON CONFLICT (id) DO NOTHING";

/// Classify whether a pull's durable anchor predates the retained remote data.
fn classify_anchor_expiry(
    since: Option<&str>,
    cursor: Option<&str>,
    oldest_available: Option<&str>,
) -> Option<SyncError> {
    if cursor.is_none()
        && let (Some(since), Some(oldest_available)) = (since, oldest_available)
        && since < oldest_available
    {
        return Some(SyncError::AnchorExpired {
            oldest_available: Some(oldest_available.to_owned()),
        });
    }

    None
}

/// Decode a `"created_at|id"` composite pull cursor into its parts.
///
/// A malformed or missing cursor yields `(None, None)` — the caller then
/// starts from `since` (or the beginning on first sync), mirroring the
/// HTTP server's `splitn(2, '|')` decoding.
fn decode_pull_cursor(cursor: Option<&str>) -> (Option<String>, Option<String>) {
    match cursor {
        Some(c) => {
            let parts: Vec<&str> = c.splitn(2, '|').collect();
            if parts.len() == 2 {
                (Some(parts[0].to_owned()), Some(parts[1].to_owned()))
            } else {
                (None, None)
            }
        }
        None => (None, None),
    }
}

/// Build the SQL for a pull page.
///
/// Anchoring on `created_at` (not `synced_at`) means rows whose remote
/// `synced_at` is never stamped still advance the durable anchor. The
/// cursor branch carries the composite `(created_at, id)` tiebreak — so
/// rows sharing the anchor's exact timestamp are never skipped — matching
/// the HTTP server's paginated pull semantics.
///
/// The cursor-without-since variant OMITS the `created_at >=` clause:
/// PostgreSQL would reject an empty string cast to `timestamptz`
/// (`invalid input syntax`), and a cursor alone already encodes the exact
/// resume point. (The HTTP server tolerates `''` because SQLite compares
/// text; PG does not.)
///
/// C3 S5: every arm also excludes rows this terminal itself pushed. The
/// clause is an ADDITION to the WHERE list only — the anchor, the cursor
/// tiebreak, `ORDER BY` and `LIMIT` keep their exact semantics — and it is
/// spelled as an "is the bound value NULL" disjunct so all four arms stay
/// static SQL: a transport with no terminal identity (an unpaired install)
/// binds SQL NULL, the first disjunct is true, and the pull is
/// byte-identical to the unfiltered one. A NULL origin always matches — an
/// unstamped or legacy row is "unknown origin", never "mine".
fn build_pull_sql(since: Option<&str>, cursor: Option<&str>) -> &'static str {
    match (since, cursor) {
        (None, Some(_)) => {
            "SELECT id, action, payload, status, retry_count, last_error,\n\n                tenant_id, created_at::TEXT, synced_at::TEXT, origin_terminal_id, sale_id\n\n         FROM offline_queue\n\n         WHERE tenant_id = $1\n\n           AND (created_at > $2 OR (created_at = $2 AND id > $3))\n\n           AND ($4::text IS NULL OR origin_terminal_id IS NULL OR origin_terminal_id <> $4)\n\n         ORDER BY created_at ASC, id ASC\n\n         LIMIT $5"
        }
        (Some(_), Some(_)) => {
            "SELECT id, action, payload, status, retry_count, last_error,\n\n                tenant_id, created_at::TEXT, synced_at::TEXT, origin_terminal_id, sale_id\n\n         FROM offline_queue\n\n         WHERE tenant_id = $1\n\n           AND created_at >= $2\n\n           AND (created_at > $3 OR (created_at = $3 AND id > $4))\n\n           AND ($5::text IS NULL OR origin_terminal_id IS NULL OR origin_terminal_id <> $5)\n\n         ORDER BY created_at ASC, id ASC\n\n         LIMIT $6"
        }
        (Some(_), None) => {
            "SELECT id, action, payload, status, retry_count, last_error,\n\n                tenant_id, created_at::TEXT, synced_at::TEXT, origin_terminal_id, sale_id\n\n         FROM offline_queue\n\n         WHERE tenant_id = $1\n\n           AND created_at >= $2\n\n           AND ($3::text IS NULL OR origin_terminal_id IS NULL OR origin_terminal_id <> $3)\n\n         ORDER BY created_at ASC, id ASC\n\n         LIMIT $4"
        }
        (None, None) => {
            "SELECT id, action, payload, status, retry_count, last_error,\n\n                tenant_id, created_at::TEXT, synced_at::TEXT, origin_terminal_id, sale_id\n\n         FROM offline_queue\n\n         WHERE tenant_id = $1\n\n           AND ($2::text IS NULL OR origin_terminal_id IS NULL OR origin_terminal_id <> $2)\n\n         ORDER BY created_at ASC, id ASC\n\n         LIMIT $3"
        }
    }
}

/// Truncate a fetched page to [`PG_PULL_PAGE_SIZE`] rows and derive the
/// composite `"created_at|id"` next cursor from the last KEPT row.
///
/// Returns `None` when the page was not full (no more pages). The cursor
/// must come from the last kept row — never the dropped overflow row — so
/// a follow-up page resumes exactly after the kept boundary (RUST-07).
fn derive_next_cursor(items: &mut Vec<OfflineQueueItem>) -> Option<String> {
    if items.len() > PG_PULL_PAGE_SIZE {
        items.truncate(PG_PULL_PAGE_SIZE);
        items
            .last()
            .map(|last| format!("{}|{}", last.created_at, last.id))
    } else {
        None
    }
}

/// Build the multi-row push INSERT for `bind_count` bind parameters.
///
/// The column list, tuple order and placeholder numbers all come from
/// [`PushColumn::ALL`], and `bind_count` must equal
/// `rows * PushColumn::BINDS_PER_ROW` — the function REFUSES to build a
/// statement whose placeholder count differs from the bind count it was
/// asked for, which is the check that keeps the builder and
/// [`pg_insert_params`] locked together.
///
/// # Placeholder numbering
///
/// Placeholders are CONTIGUOUS across the whole statement, `$1..$n`, because
/// the PostgreSQL wire protocol numbers parameters globally and a driver
/// binds the N-th parameter to `$N`. [`PushColumn::Status`] is a literal,
/// not a parameter, so it consumes no number: a four-row chunk is
/// `$1..$28`, not `$1..$32` with holes.
///
/// The shipped per-item INSERT punched exactly such a hole: its tuple was
/// `($1, $2, $3, <pending literal>, $4, $5, $6, $7)` while its bind slice
/// carried 7 values, so slot 5 (`retry_count`) received slot 4's value
/// (`last_error`) and the last parameter was never bound at all. The
/// numbering is therefore recomputed here from the column spec rather than
/// copied from that statement.
///
/// Every chunk of the same length yields the *same* string, which is what
/// lets PostgreSQL prepare it once and bind it once per chunk.
fn pg_insert_sql(bind_count: usize) -> String {
    let rows = bind_count / PushColumn::BINDS_PER_ROW;
    assert_eq!(
        bind_count % PushColumn::BINDS_PER_ROW,
        0,
        "bind_count {bind_count} is not a whole number of rows"
    );
    let mut sql = String::from(PG_INSERT_HEAD);
    // The next placeholder number to emit; 1-based, contiguous.
    let mut next_bind = 1usize;
    for row in 0..rows {
        if row > 0 {
            sql.push(',');
        }
        sql.push_str("\n            (");
        for (slot, column) in PushColumn::ALL.iter().enumerate() {
            if slot > 0 {
                sql.push_str(", ");
            }
            // EXACTLY ONE place advances the counter, and only for a bound
            // column: a literal consumes no parameter number, so the
            // numbers stay contiguous across the whole statement.
            if column.is_bound() {
                sql.push_str(&format!("${next_bind}"));
                next_bind += 1;
            } else {
                sql.push_str(column.literal());
            }
        }
        sql.push(')');
    }
    sql.push_str(PG_INSERT_TAIL);
    // INVARIANTS, enforced here rather than only in a test, because a
    // statement whose placeholder count differs from its bind count does
    // not fail loudly — it binds the wrong value into the wrong column,
    // silently, which in a sync queue is data corruption.
    //
    // 1. The running counter advanced exactly once per bound column.
    // 2. The last placeholder is the last bind the caller will pass.
    assert_eq!(
        next_bind - 1,
        rows * PushColumn::BINDS_PER_ROW,
        "the statement emits a different number of placeholders than binds"
    );
    assert_eq!(
        next_bind - 1,
        bind_count,
        "placeholder count disagrees with the requested bind count"
    );
    sql
}

/// Collect the bind values for one chunk, in the placeholder order
/// [`pg_insert_sql`] emitted.
///
/// Exactly [`PushColumn::BINDS_PER_ROW`] values per item, in tuple order,
/// skipping [`PushColumn::Status`] (a literal, never bound). `chunk` holds
/// indices into `items` in queue order; every value is borrowed straight out
/// of the item — nothing is computed per chunk.
fn pg_insert_params<'a>(
    items: &'a [OfflineQueueItem],
    chunk: &[usize],
) -> Vec<&'a (dyn ToSql + Sync)> {
    let mut params: Vec<&'a (dyn ToSql + Sync)> =
        Vec::with_capacity(chunk.len() * PushColumn::BINDS_PER_ROW);
    for &index in chunk {
        let item = &items[index];
        params.extend([
            &item.id as &(dyn ToSql + Sync),
            &item.action,
            &item.payload,
            &item.retry_count,
            &item.last_error,
            &item.tenant_id,
            &item.origin_terminal_id,
        ]);
    }
    // The bind list and the statement must agree on width; `pg_insert_sql`
    // asserts the same invariant from its side.
    assert_eq!(
        params.len(),
        chunk.len() * PushColumn::BINDS_PER_ROW,
        "bind count must be rows x binds-per-row"
    );
    params
}

impl std::fmt::Debug for PgTransport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PgTransport").finish_non_exhaustive()
    }
}

impl PgTransport {
    /// Create a new PostgreSQL transport from connection parameters (NoTls).
    ///
    /// `tenant_id` scopes every pull/snapshot/push query so the transport
    /// is safe to point at a shared multi-tenant database.
    ///
    /// Connection uses plaintext TCP (no TLS). For a TLS-required connection
    /// use [`Self::new_with_tls`] with `require_tls: true`.
    pub fn new(
        host: &str,
        port: u16,
        dbname: &str,
        user: &str,
        password: &str,
        tenant_id: &str,
    ) -> Result<Self, SyncError> {
        Self::new_with_tls(host, port, dbname, user, password, tenant_id, false)
    }

    /// Create a PostgreSQL transport with optional TLS enforcement.
    ///
    /// When `require_tls` is `true`, the transport refuses to connect unless
    /// the server offers an encrypted session (`sslmode=require`). The
    /// connector uses rustls with the platform's native certificate roots
    /// (matching the cloud server's `DbPool::connect_postgres`).
    ///
    /// When `false`, the connection uses plaintext TCP (`NoTls`), matching
    /// the historical behaviour of [`Self::new`].
    pub fn new_with_tls(
        host: &str,
        port: u16,
        dbname: &str,
        user: &str,
        password: &str,
        tenant_id: &str,
        require_tls: bool,
    ) -> Result<Self, SyncError> {
        let mut config = tokio_postgres::Config::new();
        config.host(host);
        config.port(port);
        config.dbname(dbname);
        config.user(user);
        config.password(password);

        let pool = if require_tls {
            // Build a rustls connector with native certificate roots.
            config.ssl_mode(tokio_postgres::config::SslMode::Require);
            let mut roots = rustls::RootCertStore::empty();
            let native = rustls_native_certs::load_native_certs();
            for cert in native.certs {
                roots
                    .add(cert)
                    .map_err(|e| SyncError::Transport(format!("failed to add root cert: {e}")))?;
            }
            let tls_config = rustls::ClientConfig::builder()
                .with_root_certificates(roots)
                .with_no_client_auth();
            let tls = tokio_postgres_rustls::MakeRustlsConnect::new(tls_config);
            let manager = deadpool_postgres::Manager::new(config, tls);
            deadpool_postgres::Pool::builder(manager)
                .runtime(deadpool_postgres::Runtime::Tokio1)
                .max_size(5)
                .wait_timeout(Some(std::time::Duration::from_secs(5)))
                .create_timeout(Some(std::time::Duration::from_secs(10)))
                .recycle_timeout(Some(std::time::Duration::from_secs(5)))
                .build()
                .map_err(|e| SyncError::Transport(format!("failed to create pg pool: {e}")))?
        } else {
            let manager = deadpool_postgres::Manager::new(config, NoTls);
            deadpool_postgres::Pool::builder(manager)
                .runtime(deadpool_postgres::Runtime::Tokio1)
                .max_size(5)
                .wait_timeout(Some(std::time::Duration::from_secs(5)))
                .create_timeout(Some(std::time::Duration::from_secs(10)))
                .recycle_timeout(Some(std::time::Duration::from_secs(5)))
                .build()
                .map_err(|e| SyncError::Transport(format!("failed to create pg pool: {e}")))?
        };

        Ok(Self {
            pool,
            tenant_id: tenant_id.to_owned(),
            terminal_id: None,
        })
    }

    /// Build a transport from a full `postgres://` URL (tests only).
    #[cfg(test)]
    fn new_raw(url: &str, tenant_id: &str) -> Result<Self, SyncError> {
        let config = url
            .parse::<tokio_postgres::Config>()
            .map_err(|e| SyncError::Transport(format!("invalid pg url: {e}")))?;
        let manager = deadpool_postgres::Manager::new(config, NoTls);
        let pool = deadpool_postgres::Pool::builder(manager)
            .build()
            .map_err(|e| SyncError::Transport(format!("failed to create pg pool: {e}")))?;
        Ok(Self {
            pool,
            tenant_id: tenant_id.to_owned(),
            terminal_id: None,
        })
    }

    /// Declare this install's own terminal identity (C3 S5).
    ///
    /// A builder rather than a constructor parameter so
    /// [`Self::new`]/[`Self::new_with_tls`] keep their arity — a caller
    /// that never sets it keeps the unfiltered pull.
    ///
    /// `None` (the default, and what an unpaired install passes) means no
    /// filter at all: every tenant row in the pull window is returned, and
    /// the client-side self-origin skip remains the only guard. A NULL
    /// origin in the row is never treated as this terminal.
    #[must_use]
    pub fn with_terminal_id(mut self, terminal_id: Option<String>) -> Self {
        self.terminal_id = terminal_id;
        self
    }

    /// Push pending items to the remote PostgreSQL database.
    ///
    /// Writes each item to an `offline_queue` table in the remote PG database.
    /// The write runs in a transaction scoped to the transport's tenant
    /// (`SET LOCAL oz.tenant_id`), so a shared RLS-protected database
    /// accepts the insert and the item's tenant is enforced by the policy.
    pub async fn push_items(
        &self,
        items: &[OfflineQueueItem],
    ) -> Result<Vec<super::transport::PushOutcome>, SyncError> {
        let mut client = self
            .pool
            .get()
            .await
            .map_err(|e| SyncError::Transport(format!("pg connection failed: {e}")))?;

        // Mirror the cloud schema's column surface so this transport can
        // target a server-managed database (CREATE IF NOT EXISTS is a no-op
        // when the table already exists with the server's shape).
        client
            .batch_execute(
                "CREATE TABLE IF NOT EXISTS offline_queue (
                    id TEXT PRIMARY KEY,
                    action TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    retry_count BIGINT NOT NULL DEFAULT 0,
                    last_error TEXT,
                    created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),
                    synced_at TEXT,
                    tenant_id TEXT NOT NULL DEFAULT 'default',
                    priority BIGINT NOT NULL DEFAULT 1,
                    origin_terminal_id TEXT
                )",
            )
            .await
            .map_err(|e| SyncError::Transport(format!("pg create table failed: {e}")))?;

        let tenant = self.tenant_id.clone();
        let tx = client
            .transaction()
            .await
            .map_err(|e| SyncError::Transport(format!("pg begin failed: {e}")))?;
        tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
            .await
            .map_err(|e| SyncError::Transport(format!("pg set tenant failed: {e}")))?;

        // O-H20: one multi-row INSERT per CHUNK, not one per item. The
        // tenant check stays per item (it is a local comparison, not a round
        // trip); the survivors are inserted in queue order, so outcome slot
        // i still answers for `items[i]`.
        let mut outcomes = Vec::with_capacity(items.len());
        let mut accepted: Vec<usize> = Vec::with_capacity(items.len());

        for (index, item) in items.iter().enumerate() {
            // The pushed item's tenant is authoritative; the GUC above must
            // match it or the RLS WITH CHECK rejects the write.
            if item.tenant_id != tenant {
                outcomes.push(super::transport::PushOutcome::Rejected {
                    reason: format!(
                        "item tenant {} != transport tenant {tenant}",
                        item.tenant_id
                    ),
                });
                continue;
            }
            // Placeholder until the chunk that carries this item reports
            // back; every slot is overwritten before the function returns.
            outcomes.push(super::transport::PushOutcome::Rejected {
                reason: PG_INSERT_OUTCOME_PLACEHOLDER.to_owned(),
            });
            accepted.push(index);
        }

        for chunk in accepted.chunks(PG_INSERT_CHUNK_ROWS) {
            // Same shape as the per-item INSERT, widened to one `($n, ...)`
            // tuple per chunk row. `status` stays the literal
            // `'pending'` (not a bind) and the upsert stays
            // `ON CONFLICT (id) DO NOTHING`: a duplicate id is accepted
            // without overwriting the existing row, exactly as before.
            let params = pg_insert_params(items, chunk);
            let sql = pg_insert_sql(params.len());
            let result = tx.execute(&sql, &params).await;
            drop(params);

            match result {
                Ok(_) => {
                    for &index in chunk {
                        outcomes[index] = super::transport::PushOutcome::Accepted;
                    }
                }
                Err(e) => {
                    for &index in chunk {
                        outcomes[index] = super::transport::PushOutcome::Rejected {
                            reason: format!("pg insert failed: {e}"),
                        };
                    }
                }
            }
        }

        // Commit: applies the inserts and resets the LOCAL GUC. A failed
        // COMMIT must surface as `Err` — swallowing it (the previous `let
        // _ =`) let every item report `Accepted` while the remote never
        // received them, and the daemon would then mark them `synced`
        // locally: offline items silently lost.
        tx.commit()
            .await
            .map_err(|e| SyncError::Transport(format!("pg commit failed: {e}")))?;

        Ok(outcomes)
    }

    /// Fetch the authoritative reference-data snapshot from PostgreSQL.
    ///
    /// PostgreSQL sync uses a dedicated database rather than the HTTP
    /// snapshot endpoint, so the same typed snapshot contract is assembled
    /// from the remote reference tables. Credential verifier material is
    /// deliberately excluded from the users query.
    pub async fn fetch_snapshot(
        &self,
    ) -> Result<super::transport::SyncSnapshotResponse, SyncError> {
        let mut client = self
            .pool
            .get()
            .await
            .map_err(|e| SyncError::Transport(format!("pg connection failed: {e}")))?;

        // RLS: scope the whole snapshot to the tenant (GUC + WHERE), so a
        // shared multi-tenant database never leaks another tenant's
        // reference data. LOCAL resets when the tx drops.
        let tenant = self.tenant_id.clone();
        let tx = client
            .transaction()
            .await
            .map_err(|e| SyncError::Transport(format!("pg begin failed: {e}")))?;
        tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
            .await
            .map_err(|e| SyncError::Transport(format!("pg set tenant failed: {e}")))?;

        let products = tx
            .query(
                "SELECT id, sku, name, price_minor, currency, category_id, barcode,
                        created_at::TEXT, updated_at::TEXT, price_updated_at::TEXT,
                        (track_serial::TEXT IN ('1', 't', 'true')) AS track_serial,
                        store_id,
                        brand, rack_location, notes, unit,
                        (is_active::TEXT IN ('1', 't', 'true')) AS is_active
                 FROM products
                 WHERE tenant_id = $1
                 ORDER BY sku ASC",
                &[&tenant],
            )
            .await
            .map_err(|e| SyncError::Transport(format!("pg snapshot products query failed: {e}")))?
            .into_iter()
            .map(|row| super::transport::SnapshotProduct {
                id: row.get("id"),
                sku: row.get("sku"),
                name: row.get("name"),
                price_minor: row.get("price_minor"),
                currency: row.get("currency"),
                category_id: row.get("category_id"),
                barcode: row.get("barcode"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                price_updated_at: row.get("price_updated_at"),
                track_serial: row.get("track_serial"),
                store_id: row.get("store_id"),
                brand: row.get("brand"),
                rack_location: row.get("rack_location"),
                notes: row.get("notes"),
                unit: row.get("unit"),
                is_active: row.get("is_active"),
            })
            .collect();

        // The scope and validity-window columns are selected here because a
        // scoped rate that travels WITHOUT its scope lands as NULL at the
        // branch, and NULL scope IS the tenant-global answer — one location's
        // rate would then price every location. Absence is not neutral in this
        // table.
        let tax_rates = tx
            .query(
                "SELECT id, name, rate_bps,
                        (is_default::TEXT IN ('1', 't', 'true')) AS is_default,
                        (is_inclusive::TEXT IN ('1', 't', 'true')) AS is_inclusive,
                        created_at::TEXT, updated_at::TEXT,
                        legal_entity_id, location_id,
                        effective_from, effective_to,
                        rounding_mode
                 FROM tax_rates
                 WHERE tenant_id = $1
                 ORDER BY id ASC",
                &[&tenant],
            )
            .await
            .map_err(|e| SyncError::Transport(format!("pg snapshot tax rates query failed: {e}")))?
            .into_iter()
            .map(|row| super::transport::SnapshotTaxRate {
                id: row.get("id"),
                name: row.get("name"),
                rate_bps: row.get("rate_bps"),
                is_default: row.get("is_default"),
                is_inclusive: row.get("is_inclusive"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                legal_entity_id: row.get("legal_entity_id"),
                location_id: row.get("location_id"),
                effective_from: row.get("effective_from"),
                effective_to: row.get("effective_to"),
                // Option-read so a NULL from any hub state lands as the ''
                // sentinel rather than an error.
                rounding_mode: row
                    .get::<_, Option<String>>("rounding_mode")
                    .unwrap_or_default(),
            })
            .collect();

        let users = tx
            .query(
                "SELECT id, username, display_name, role_id,
                        (is_active::TEXT IN ('1', 't', 'true')) AS is_active,
                        created_at::TEXT, updated_at::TEXT
                 FROM users
                 WHERE tenant_id = $1
                 ORDER BY username ASC",
                &[&tenant],
            )
            .await
            .map_err(|e| SyncError::Transport(format!("pg snapshot users query failed: {e}")))?
            .into_iter()
            .map(|row| super::transport::SnapshotUser {
                id: row.get("id"),
                username: row.get("username"),
                display_name: row.get("display_name"),
                role_id: row.get("role_id"),
                is_active: row.get("is_active"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect();

        // Transaction drops here (read-only) → GUC resets on the pooled
        // connection.
        Ok(super::transport::SyncSnapshotResponse {
            version: super::transport::SNAPSHOT_SCHEMA_VERSION,
            products,
            tax_rates,
            users,
        })
    }

    /// Pull updates from the remote PostgreSQL database.
    ///
    /// Returns up to `PG_PULL_PAGE_SIZE` items ordered by
    /// `(created_at, id)` — the composite cursor key — so rows sharing an
    /// exact `created_at` timestamp are never skipped. The `since` anchor
    /// filters on `created_at` (not `synced_at`), so rows whose remote
    /// `synced_at` is never stamped still advance the durable anchor.
    ///
    /// When more pages exist, `next_cursor` carries a `"created_at|id"`
    /// composite cursor that the caller passes back on the next call.
    ///
    /// C3 S5: rows this transport's own [`Self::with_terminal_id`] identity
    /// originated are excluded, so a terminal is never handed back its own
    /// pushes. With no identity set the filter is inert and the row set is
    /// byte-identical to the unfiltered pull.
    pub async fn pull_updates(
        &self,
        since: Option<&str>,
        cursor: Option<&str>,
    ) -> Result<super::transport::PullResponse, SyncError> {
        let mut client = self
            .pool
            .get()
            .await
            .map_err(|e| SyncError::Transport(format!("pg connection failed: {e}")))?;

        let (cursor_ts, cursor_id) = decode_pull_cursor(cursor);
        let limit = PG_PULL_FETCH_LIMIT;
        let tenant = self.tenant_id.clone();
        // C3 S5: this install's own identity, or NULL when unpaired — the
        // pull then returns every tenant row exactly as it does today.
        let origin = self.terminal_id.clone();

        // RLS: scope the read to the tenant GUC too (covers a shared DB with
        // FORCEd RLS where the WHERE clause alone is not enough — the policy
        // filters on the GUC). LOCAL resets when the tx drops.
        let tx = client
            .transaction()
            .await
            .map_err(|e| SyncError::Transport(format!("pg begin failed: {e}")))?;
        tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
            .await
            .map_err(|e| SyncError::Transport(format!("pg set tenant failed: {e}")))?;

        // Mirror the HTTP server's P-1 retention contract. A cursor already
        // identifies an exact resume point, so only the first page checks
        // whether the durable anchor predates the oldest retained row. The
        // MIN is tenant-scoped AND runs inside the tenant transaction: a
        // bare-client query would see zero rows under FORCEd RLS (the
        // `oz.tenant_id` GUC is only set in the tx) and the expiry guard
        // would silently no-op.
        if since.is_some() && cursor.is_none() {
            let oldest_available: Option<String> = tx
                .query_one(
                    "SELECT MIN(created_at)::TEXT FROM offline_queue WHERE tenant_id = $1",
                    &[&tenant],
                )
                .await
                .map_err(|e| SyncError::Transport(format!("pg anchor query failed: {e}")))?
                .try_get(0)
                .map_err(|e| SyncError::Transport(format!("pg anchor decode failed: {e}")))?;
            if let Some(error) = classify_anchor_expiry(since, cursor, oldest_available.as_deref())
            {
                return Err(error);
            }
        }

        let rows = if let (Some(ts), Some(cid)) = (&cursor_ts, &cursor_id) {
            if let Some(since) = since {
                // Cursor + since: bind the tenant, lower bound plus the
                // composite (created_at, id) tiebreak.
                tx.query(
                    build_pull_sql(Some(since), cursor),
                    &[&tenant, &since, ts, cid, &origin, &limit],
                )
                .await
                .map_err(|e| SyncError::Transport(format!("pg query failed: {e}")))?
            } else {
                // Cursor without since: the SQL omits the `created_at >=`
                // clause (PG rejects an empty-string cast to timestamptz),
                // so bind only the tenant + 3-placeholder tiebreak + limit.
                tx.query(
                    build_pull_sql(None, cursor),
                    &[&tenant, ts, cid, &origin, &limit],
                )
                .await
                .map_err(|e| SyncError::Transport(format!("pg query failed: {e}")))?
            }
        } else if let Some(since) = since {
            tx.query(
                build_pull_sql(Some(since), None),
                &[&tenant, &since, &origin, &limit],
            )
            .await
            .map_err(|e| SyncError::Transport(format!("pg query failed: {e}")))?
        } else {
            tx.query(build_pull_sql(None, None), &[&tenant, &origin, &limit])
                .await
                .map_err(|e| SyncError::Transport(format!("pg query failed: {e}")))?
        };

        let mut items: Vec<OfflineQueueItem> = rows
            .iter()
            .map(|row| {
                let status_str: String = row.get("status");
                let status = match status_str.as_str() {
                    "synced" => OfflineQueueStatus::Synced,
                    "failed" => OfflineQueueStatus::Failed,
                    _ => OfflineQueueStatus::Pending,
                };
                OfflineQueueItem {
                    id: row.get("id"),
                    action: row.get("action"),
                    payload: row.get("payload"),
                    status,
                    retry_count: row.get("retry_count"),
                    last_error: row.get("last_error"),
                    created_at: row.get::<_, String>("created_at"),
                    // A remote row this terminal pushed as `pending` has a
                    // NULL synced_at until the remote stamps it; decoding as
                    // Option (not String) avoids a panic on that first row.
                    synced_at: row.get::<_, Option<String>>("synced_at"),
                    tenant_id: row.get("tenant_id"),
                    priority: kasirmu_core::offline::SyncPriority::Normal,
                    // NULL stays NULL: "unknown origin", never a default.
                    origin_terminal_id: row.get("origin_terminal_id"),
                    sale_id: row.get("sale_id"),
                }
            })
            .collect();

        let next_cursor = derive_next_cursor(&mut items);

        Ok(super::transport::PullResponse { items, next_cursor })
    }
}

#[cfg(test)]
#[path = "pg_transport_tests.rs"]
mod tests;
