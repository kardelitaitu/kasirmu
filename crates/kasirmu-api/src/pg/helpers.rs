//! Shared Postgres prologue helpers for the `pg` data layer.
//!
//! These are the small, domain-agnostic pieces every domain module in `pg` is
//! built from: the `BIGINT`-as-boolean reader, the unique/FK violation probes,
//! the RFC 3339 timestamp formatter, the currency decoder, the per-tenant
//! snapshot-version bump, and the `IN (…)` chunking arithmetic with the
//! constants that bound it.
//!
//! They live in one module — rather than inside any single domain section —
//! because memos, products, tax rates, exchange rates and users all call them.
//! Keeping them here lets a domain section be lifted into its own file without
//! dragging the prologue along with it.
//!
//! Invariants: the `PG_IN_CHUNK` / `PG_LEAD_PARAMS` / `PG_MAX_PARAMS` relation is
//! pinned by the compile-time assert in `pg.rs`; `now_rfc3339` emits the same
//! format the SQLite path writes; the violation probes answer `false` for a
//! non-database error instead of panicking.

use tokio_postgres::error::SqlState;

use kasirmu_core::Currency;

use super::PgError;

/// Default inventory location UUID (must match the port schema's default).
pub(super) const CANONICAL_DEFAULT_LOCATION_UUID: &str = "01926b3a-0000-7000-8000-000000000001";

/// The PostgreSQL ceiling on parameters per statement: **65 535**.
///
/// Where it comes from: the extended query protocol carries the parameter count of
/// both the `Parse` and the `Bind` message as an `Int16`, and the server rejects
/// anything above `INT16_MAX` with `too many parameters specified in bind
/// message`. It is a wire-format limit, NOT a GUC — no server setting raises it,
/// so unlike SQLite's `SQLITE_MAX_VARIABLE_NUMBER` (32 766 on the bundled 3.4x,
/// 999 on pre-3.32 builds) the ceiling is identical on every supported server.
pub(super) const PG_MAX_PARAMS: usize = 65_535;

/// Parameters a chunked `IN` statement binds BESIDES the chunk itself — the
/// leading `$1` tenant id in [`list_missing_hashes`]. Placeholder numbering
/// starts at `1 + PG_LEAD_PARAMS`, so the ceiling check has to count them too.
pub(super) const PG_LEAD_PARAMS: usize = 1;

/// How many values one data-driven `IN (…)` list in this module may bind at a
/// time.
///
/// Both data-driven lists here — [`attach_product_images`]'s product ids and
/// [`list_missing_hashes`]'s candidate hashes — bind ONE PARAMETER PER VALUE, and
/// their length comes from DATA (a tenant's whole catalog on
/// `GET /api/v1/products`, a caller-supplied `?hashes=a,b,c` on
/// `GET /api/v1/images:missing`), not from a fixed schema. Above [`PG_MAX_PARAMS`]
/// the statement stops executing: the handler answers 500, or — where the caller
/// keeps an empty-set fallback (`unwrap_or_default()`) — answers the empty set
/// after a `tracing::warn` naming the failed operation and the error. No caller
/// here swallows the failure silently any more: an empty answer is ambiguous
/// between "genuinely empty" and "lookup failed", and the warning is how the two
/// are told apart (see the `list_missing_hashes` callers in routes/images.rs and
/// routes/products.rs).
/// 10 000 keeps a 6.5x margin under the ceiling and stays small enough that one
/// chunk is a single round trip.
///
/// This is a CHUNK SIZE, never a threshold that switches the filter off: a long
/// list is read in MORE chunks, not in an unscoped sweep that would return rows
/// outside the tenant or the whole table.
pub(super) const PG_IN_CHUNK: usize = 10_000;

/// Build the `$start .. $start+len-1` placeholder list for one `IN (…)` chunk.
///
/// Pure, so the chunk arithmetic — numbering, contiguity, no overlap between
/// chunks — is testable without a live Postgres. See
/// `pg_in_chunking_survives_a_list_longer_than_the_chunk`.
pub(super) fn pg_placeholders(start: usize, len: usize) -> String {
    (start..start + len)
        .map(|i| format!("${i}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Read a `BIGINT` boolean-ish column as `bool` (0 → false, else true).
pub(super) fn pg_bool(row: &tokio_postgres::Row, column: &str) -> Result<bool, PgError> {
    let v: i64 = row
        .try_get(column)
        .map_err(|e| PgError::Db(e.to_string()))?;
    Ok(v != 0)
}

/// Check whether a Postgres error is a unique-constraint violation.
pub(super) fn is_unique_violation(e: &tokio_postgres::Error) -> bool {
    e.as_db_error()
        .map(|d| d.code() == &SqlState::UNIQUE_VIOLATION)
        .unwrap_or(false)
}

/// Check whether a Postgres error is a foreign-key violation.
pub(super) fn is_fk_violation(e: &tokio_postgres::Error) -> bool {
    e.as_db_error()
        .map(|d| d.code() == &SqlState::FOREIGN_KEY_VIOLATION)
        .unwrap_or(false)
}

/// Current UTC timestamp in the same format the SQLite path uses.
pub(super) fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Bump the per-tenant snapshot version counter (ADR #43 D2).
///
/// Call inside the SAME transaction as the reference-data write (product,
/// tax rate, user). The snapshot handler reads this counter instead of
/// running a 3-table COUNT + MAX(updated_at) stamp query on every cache
/// miss, so a bump here makes the next snapshot revalidation see the
/// change (near-instant propagation) at the cost of one PK upsert.
pub(super) async fn bump_snapshot_version(
    tx: &tokio_postgres::Transaction<'_>,
    tenant_id: &str,
) -> Result<(), PgError> {
    let now = now_rfc3339();
    tx.execute(
        "INSERT INTO snapshot_versions (tenant_id, version, updated_at) VALUES ($1, 1, $2)
         ON CONFLICT (tenant_id) DO UPDATE SET version = snapshot_versions.version + 1, updated_at = EXCLUDED.updated_at",
        &[&tenant_id, &now],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    Ok(())
}

/// Decode a currency's raw bytes into the `String` the PG columns store.
pub(super) fn currency_str(currency: &Currency) -> Result<String, PgError> {
    std::str::from_utf8(&currency.0)
        .map(str::to_owned)
        .map_err(|e| PgError::Validation(format!("invalid UTF-8 in currency bytes: {e}")))
}
