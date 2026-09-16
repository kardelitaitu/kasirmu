//! Phase 1.4 migration tool — copy the cloud server's live data from the
//! SQLite database to Postgres, then verify row counts + checksums.
//!
//! The old single-node cloud server kept its data in a SQLite file
//! (`OZ_DB_PATH`, default `kasir.db`). Phase 1 moved the cloud branch onto
//! Postgres; this binary performs the cutover copy for the surface the cloud
//! server actually reads/writes:
//!
//! - sync function: `offline_queue`, `tenant_plans`
//! - REST / snapshots: `products`, `categories`, `tax_rates`, `users`,
//!   `roles`, `assignments`, `sales`, `sale_lines`, `refunds`, `payments`,
//!   `sync_terminals`, `settings`
//! - webhooks: `processed_webhooks`, `stripe_customers`
//!
//! # Memory envelope
//!
//! Every table is read **entirely into memory** (`Vec<Row>`) for both the
//! source and the verification read-back. A production `sales` table with,
//! say, 1M rows × ~15 columns ≲ 250 MB on the heap — acceptable for a
//! one-shot tool on a dedicated host but worth sizing before cutover.
//! There is no streaming / LIMIT-OFFSET paging: the checksum fold requires
//! the full set.
//!
//! # Verification
//!
//! Every table is verified by row count + FNV-1a content checksum. The
//! count tolerates `pg >= src` so a concurrent writer does not cause a
//! spurious failure (the `ON CONFLICT DO NOTHING` insert never removes
//! rows). The checksum requires exact XOR equality, so a concurrent writer
//! that adds a row mid-verify surfaces as `CHECKSUM-DIFF` — a **false
//! alarm**, not a silent pass. If the final output shows `CHECKSUM-DIFF`
//! on any table, quiesce writers and re-run to confirm.
//!
//! # Usage
//!
//! ```text
//! cargo run -p oz-cloud-server --bin migrate_sqlite_to_pg \
//!     --sqlite kasir.db --pg postgres://postgres:postgres@localhost:5432/postgres
//! ```
//!
//! Environment fallbacks: `OZ_DB_PATH` for `--sqlite`, `DATABASE_URL` for
//! `--pg`. The destination schema is applied first (idempotent `PG_INIT`),
//! rows are copied with `ON CONFLICT DO NOTHING` (so re-runs are safe and
//! never clobber rows already synced to Postgres), and every table is
//! verified by row count plus a content checksum computed identically on
//! both sides.
//!
//! # FK-safe copy order
//!
//! The copy order is derived at runtime from Postgres's `pg_constraint`
//! metadata (topological sort of the FK graph), so custom `--tables` lists
//! are ordered correctly too. Tables with no FK edges keep their configured
//! relative order.
//!
//! # Decomposition (13-09-26)
//!
//! The 1,222-line bin split along its real seams: `rows` (cell model +
//! row I/O), `schema` (connect + FK ordering), `copy` (copy-and-verify
//! driver), with the unit tests relocated to the sibling
//! `migrate_sqlite_to_pg_tests.rs`. This file keeps the CLI (args, `main`,
//! `run`) and the table default list — no migration logic lives here.

use std::env;
use std::path::PathBuf;

use rusqlite::Connection;

/// Default copy surface — the tables the cloud server reads/writes on the
/// Postgres branch (superset so custom `--tables` is only ever a
/// restriction). Ordered for readability; the real order comes from the FK
/// topological sort.
const DEFAULT_TABLES: &[&str] = &[
    "offline_queue",
    "tenant_plans",
    "products",
    "categories",
    "tax_rates",
    "users",
    "roles",
    "assignments",
    "sales",
    "sale_lines",
    "refunds",
    "payments",
    "sync_terminals",
    "processed_webhooks",
    "stripe_customers",
    "settings",
];

mod copy;
mod rows;
mod schema;

use copy::copy_and_verify;
use schema::connect_postgres;

struct Args {
    sqlite: PathBuf,
    pg: String,
    tables: Vec<String>,
    batch: usize,
    dry_run: bool,
}

const USAGE: &str = "\
migrate_sqlite_to_pg — copy the cloud server's SQLite DB to Postgres and verify

USAGE:
    migrate_sqlite_to_pg [OPTIONS]

OPTIONS:
    --sqlite <path>    SQLite database file (default: $OZ_DB_PATH or 'kasir.db')
    --pg <url>         Postgres connection URL (default: $DATABASE_URL)
    --tables <list>    Comma-separated table list (default: the full copy surface)
    --batch <n>        Rows per INSERT batch (default: 500)
    --dry-run          Verify connectivity and table metadata without writing
    --help             Show this help and exit

The destination schema (PG_INIT) is applied first; rows are copied with
ON CONFLICT DO NOTHING so re-runs are safe. Every table is verified by
row count + content checksum. See the module docs for the memory envelope
and CHECKSUM-DIFF semantics.";

fn parse_args() -> Result<Option<Args>, String> {
    let mut sqlite = env::var("OZ_DB_PATH").unwrap_or_else(|_| "kasir.db".into());
    let mut pg: Option<String> = env::var("DATABASE_URL").ok();
    let mut tables: Vec<String> = DEFAULT_TABLES.iter().map(|s| s.to_string()).collect();
    let mut batch = 500usize;
    let mut dry_run = false;

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => return Ok(None),
            "--sqlite" => sqlite = args.next().ok_or("--sqlite needs a path")?,
            "--pg" => pg = Some(args.next().ok_or("--pg needs a URL")?),
            "--tables" => {
                let list = args.next().ok_or("--tables needs a comma list")?;
                tables = list.split(',').map(|s| s.trim().to_string()).collect();
            }
            "--batch" => {
                batch = args
                    .next()
                    .ok_or("--batch needs a number")?
                    .parse()
                    .map_err(|_| "invalid --batch")?;
            }
            "--dry-run" => dry_run = true,
            other => return Err(format!("unknown argument: {other}\n\n{USAGE}")),
        }
    }
    let pg = pg.ok_or("DATABASE_URL must be set or --pg provided")?;
    Ok(Some(Args {
        sqlite: PathBuf::from(sqlite),
        pg,
        tables,
        batch,
        dry_run,
    }))
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("migration failed: {e}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let args = match parse_args()? {
        Some(a) => a,
        None => {
            println!("{USAGE}");
            return Ok(());
        }
    };

    // 1. Open the SQLite source (the old cloud DB).
    if !args.sqlite.exists() {
        return Err(format!("SQLite DB not found: {}", args.sqlite.display()));
    }
    let conn = Connection::open(&args.sqlite).map_err(|e| format!("open sqlite: {e}"))?;

    // 2. Connect to Postgres; applying PG_INIT is idempotent.
    let pool = connect_postgres(&args.pg).await?;

    // 3. Resolve the copy order (FK-safe) and per-table columns.
    println!("source: {}", args.sqlite.display());
    println!("target: postgres (schema applied via PG_INIT)");
    if args.dry_run {
        println!("dry-run: verifying only (no writes)\n");
    }

    let (total_copied, order_len, failures) =
        copy_and_verify(&pool, &conn, &args.tables, args.batch, args.dry_run).await?;

    println!(
        "\n{} rows copied across {} tables ({} failures)",
        total_copied, order_len, failures
    );
    if failures > 0 {
        return Err(format!("{failures} table(s) failed verification"));
    }
    Ok(())
}
#[cfg(test)]
pub(crate) use rows::{Cell, fnv1a, read_pg_rows, read_sqlite_rows, sqlite_columns};
#[cfg(test)]
pub(crate) use schema::topo_sort;

#[cfg(test)]
#[path = "migrate_sqlite_to_pg_tests.rs"]
mod tests;
