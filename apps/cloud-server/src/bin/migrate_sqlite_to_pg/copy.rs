//! Copy-and-verify driver for the migration bin: per-table batched copy
//! followed by row-count + content-checksum verification, FK-topological
//! ordering resolved through `super::schema`.
//! Split from the bin's monolith on 13-09-26; behaviour unchanged.

use deadpool_postgres::Pool;
use rusqlite::Connection;

use super::rows::{Row, fnv1a, insert_pg_batch, read_pg_rows, read_sqlite_rows, sqlite_columns};
use super::schema::{pg_fk_edges, topo_sort};
/// Verify one table after copying: re-read the Postgres rows and compare row
/// count + content checksum against the source. Prints the per-table status
/// line and returns `true` when verification passed.
///
/// `count_ok` tolerates `pg >= src` (a concurrent writer may legitimately
/// add a row mid-migration; `ON CONFLICT DO NOTHING` never removes rows).
/// `checksum_ok` requires exact equality, so a concurrent writer surfaces
/// as `CHECKSUM-DIFF` — a false alarm, not a silent pass — and the run
/// should be repeated once writers are quiesced.
async fn verify_table(
    pool: &Pool,
    table: &str,
    columns: &[String],
    sqlite_columns: &[String],
    src_rows: &[Row],
) -> Result<bool, String> {
    let pg_rows = read_pg_rows(pool, table, columns).await?;
    // Project source rows to shared columns so checksums compare the same
    // set of columns as PG (the source may have extra columns from newer
    // migrations that the PG schema hasn't caught up with yet).
    let col_indices: Vec<usize> = match columns
        .iter()
        .map(|c| {
            sqlite_columns.iter().position(|sc| sc == c).ok_or_else(|| {
                format!("table {table}: pg column '{c}' is not present in the sqlite table")
            })
        })
        .collect::<Result<Vec<usize>, String>>()
    {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let src_checksum: u64 = src_rows
        .iter()
        .map(|r| {
            let projected = Row {
                cells: col_indices
                    .iter()
                    .map(|&idx| r.cells[idx].clone())
                    .collect(),
            };
            fnv1a(&projected.checksum_fragment())
        })
        .fold(0u64, |acc, h| acc ^ h);
    let pg_checksum: u64 = pg_rows
        .iter()
        .map(|r| fnv1a(&r.checksum_fragment()))
        .fold(0u64, |acc, h| acc ^ h);

    let count_ok = pg_rows.len() >= src_rows.len();
    let checksum_ok = src_checksum == pg_checksum;
    let status = if count_ok && checksum_ok {
        "OK"
    } else if count_ok {
        "CHECKSUM-DIFF"
    } else {
        "COUNT-DIFF"
    };
    println!(
        "  {table:<24} src={:<6} pg={:<6} checksum={:<20} {status}",
        src_rows.len(),
        pg_rows.len(),
        format!("{src_checksum:016x}"),
    );
    Ok(status == "OK")
}

/// Copy the given tables from SQLite to Postgres (FK-topological order) and
/// verify every table by row count + content checksum. Returns
/// `(rows copied, tables processed, failed tables)`.
pub async fn copy_and_verify(
    pool: &Pool,
    conn: &Connection,
    tables: &[String],
    batch: usize,
    dry_run: bool,
) -> Result<(usize, usize, usize), String> {
    let edges = pg_fk_edges(pool).await?;
    let order = topo_sort(tables, &edges);
    if !dry_run {
        println!("tables: {} (FK-ordered)", order.len());
    }

    let mut total_copied = 0usize;
    let mut failures = 0usize;

    for table in &order {
        // Skip tables absent on either side.
        let sqlite_cols = match sqlite_columns(conn, table) {
            Ok(c) if !c.is_empty() => c,
            Ok(_) => {
                println!("  {table:<24} skipped (empty on source)");
                continue;
            }
            Err(_) => {
                println!("  {table:<24} skipped (missing on source)");
                continue;
            }
        };
        let pg_cols: Vec<String> = {
            let client = pool.get().await.map_err(|e| e.to_string())?;
            let col_list = sqlite_cols
                .iter()
                .map(|c| format!("'{c}'"))
                .collect::<Vec<_>>()
                .join(", ");
            match client
                .query(
                    &format!(
                        "SELECT column_name FROM information_schema.columns \
                         WHERE table_name = $1 AND column_name IN ({col_list}) ORDER BY ordinal_position"
                    ),
                    &[&table.as_str()],
                )
                .await
            {
                Ok(rows) => rows.iter().map(|r| r.get::<_, String>(0)).collect(),
                Err(_) => {
                    println!("  {table:<24} skipped (missing on target)");
                    continue;
                }
            }
        };
        if pg_cols.is_empty() {
            println!("  {table:<24} skipped (no shared columns)");
            continue;
        }

        // 4. Read source rows.
        let src_rows = read_sqlite_rows(conn, table)?;

        // 5. Write (unless dry-run), in batches, inside ONE transaction per
        // table so a mid-table failure rolls the whole table back (a re-run
        // never sees half-copied state; `ON CONFLICT DO NOTHING` still makes
        // re-runs safe against rows already synced).
        if !dry_run {
            let mut client = pool.get().await.map_err(|e| e.to_string())?;
            let tx = client
                .transaction()
                .await
                .map_err(|e| format!("begin tx for {table}: {e}"))?;
            for chunk in src_rows.chunks(batch) {
                insert_pg_batch(&tx, table, &pg_cols, &sqlite_cols, chunk).await?;
            }
            tx.commit()
                .await
                .map_err(|e| format!("commit {table}: {e}"))?;
        }
        total_copied += src_rows.len();

        // 6. Verify: row count + checksum on both sides.
        if !verify_table(pool, table, &pg_cols, &sqlite_cols, &src_rows).await? {
            failures += 1;
        }
    }

    Ok((total_copied, order.len(), failures))
}
