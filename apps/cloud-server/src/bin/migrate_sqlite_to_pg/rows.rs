//! Cell/row model plus SQLite and Postgres row I/O for the migration bin.
//!
//! The normalized `Cell`/`Row` pair that makes checksums identical on both
//! drivers, the `WildcardNull` binder, the FNV-1a fold, and the four row
//! movers (`sqlite_columns`, `read_sqlite_rows`, `insert_pg_batch`,
//! `read_pg_rows`/`decode_pg_cell`). Split from the bin's monolith on
//! 13-09-26; behaviour unchanged.

use bytes::BytesMut;
use deadpool_postgres::Pool;
use rusqlite::Connection;
use tokio_postgres::types::{IsNull, ToSql, Type};
/// Normalized value for cross-database checksumming.
#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

/// One row of normalized cells plus the raw bytes used for the PG insert.
pub struct Row {
    pub cells: Vec<Cell>,
}

impl Row {
    /// Checksum fragment: a stable textual encoding of every cell, folded
    /// into the table checksum via FNV-1a (identical on both sides).
    pub fn checksum_fragment(&self) -> String {
        let mut out = String::new();
        for cell in &self.cells {
            match cell {
                Cell::Null => out.push_str("\\N;"),
                Cell::Int(i) => {
                    out.push_str("i:");
                    out.push_str(&i.to_string());
                    out.push(';');
                }
                Cell::Real(f) => {
                    out.push_str("r:");
                    // Canonical formatting: always emit a decimal point so
                    // the string is identical across drivers.
                    out.push_str(&format!("{f:.6}"));
                    out.push(';');
                }
                Cell::Text(t) => {
                    out.push_str("t:");
                    out.push_str(t);
                    out.push(';');
                }
                Cell::Blob(b) => {
                    out.push_str("b:");
                    for byte in b {
                        out.push_str(&format!("{byte:02x}"));
                    }
                    out.push(';');
                }
            }
        }
        out
    }
}

/// A NULL that binds to any Postgres parameter type.
///
/// `Option<i64>::accepts` is false for a TEXT-typed parameter, so the
/// previous typed-null binding made any row with a NULL in a TEXT column
/// (e.g. a NULL `category_id` on `products`) fail with "error serializing
/// parameter N" before reaching the server.
#[derive(Debug)]
pub struct WildcardNull;

impl ToSql for WildcardNull {
    fn to_sql(
        &self,
        _ty: &Type,
        _out: &mut BytesMut,
    ) -> Result<IsNull, Box<dyn std::error::Error + Sync + Send>> {
        Ok(IsNull::Yes)
    }

    fn accepts(_ty: &Type) -> bool {
        true
    }

    fn to_sql_checked(
        &self,
        ty: &Type,
        out: &mut BytesMut,
    ) -> Result<IsNull, Box<dyn std::error::Error + Sync + Send>> {
        self.to_sql(ty, out)
    }
}

/// FNV-1a 64-bit hash over a string.
pub fn fnv1a(s: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in s.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Column list of a SQLite table (in table order).
pub fn sqlite_columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info(\"{table}\")"))
        .map_err(|e| format!("PRAGMA table_info({table}): {e}"))?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| format!("read {table} columns: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("read {table} column: {e}"))?);
    }
    Ok(out)
}

/// Read every row of a SQLite table as normalized cells.
pub fn read_sqlite_rows(conn: &Connection, table: &str) -> Result<Vec<Row>, String> {
    let sql = format!("SELECT * FROM \"{table}\"");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("prepare {table}: {e}"))?;
    let col_count = stmt.column_count();
    let rows = stmt
        .query_map([], |r| {
            let mut cells = Vec::with_capacity(col_count);
            for i in 0..col_count {
                let v = r
                    .get_ref(i)
                    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
                cells.push(match v {
                    rusqlite::types::ValueRef::Null => Cell::Null,
                    rusqlite::types::ValueRef::Integer(i) => Cell::Int(i),
                    rusqlite::types::ValueRef::Real(f) => Cell::Real(f),
                    rusqlite::types::ValueRef::Text(t) => {
                        Cell::Text(String::from_utf8_lossy(t).into_owned())
                    }
                    rusqlite::types::ValueRef::Blob(b) => Cell::Blob(b.to_vec()),
                });
            }
            Ok(Row { cells })
        })
        .map_err(|e| format!("query {table}: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("read {table} row: {e}"))?);
    }
    Ok(out)
}

/// Insert a batch of rows into Postgres with `ON CONFLICT DO NOTHING`,
/// as ONE multi-row `VALUES` statement inside the caller's transaction.
///
/// Multi-row VALUES cuts the cutover cost from one round-trip + fsync per
/// row (each `execute` previously autocommitted) to one round-trip per
/// batch; wrapping each table in a single transaction makes the copy
/// atomic per table — a mid-table failure rolls the whole table back, so
/// a re-run never sees half-copied state.
///
/// Every cell binds with its natural type; NULLs bind as a wildcard null (a
/// typed int8 null fails client-side with "error serializing parameter N"
/// when Postgres infers a TEXT parameter, e.g. a NULL `category_id` on
/// products).
///
/// **Column alignment**: the source rows (`read_sqlite_rows`) contain ALL
/// SQLite columns, but `columns` is the *shared* subset present in both
/// SQLite and Postgres.  When a migration adds a column to SQLite without
/// the PG schema being regenerated (or vice versa), the sets diverge.
/// This function projects each row's cells to only the columns in
/// `columns` by looking up their position in the full SQLite column list.
pub async fn insert_pg_batch(
    tx: &tokio_postgres::Transaction<'_>,
    table: &str,
    columns: &[String],
    sqlite_columns: &[String],
    rows: &[Row],
) -> Result<(), String> {
    if rows.is_empty() {
        return Ok(());
    }
    let col_count = columns.len();
    let col_list = columns
        .iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>()
        .join(", ");
    // Build a column-position lookup: for each column in `columns`,
    // find its index in the full sqlite_columns list.
    //
    // This was `.expect("every pg_cols column must exist in sqlite_columns")`,
    // which panicked on a genuinely reachable condition: the two schemas drifting
    // apart. A panic here aborted the migration with no indication of WHICH
    // column, and the gate's own rule is that a recoverable failure must return
    // rather than unwind. The function already returns `Result<(), String>`, so
    // naming the column costs nothing.
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

    // One placeholder group per row: ($1..$N), ($N+1..$2N), …
    let value_groups = (0..rows.len())
        .map(|r| {
            let base = r * col_count;
            format!(
                "({})",
                (1..=col_count)
                    .map(|c| format!("${}", base + c))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "INSERT INTO \"{table}\" ({col_list}) VALUES {value_groups} ON CONFLICT DO NOTHING"
    );

    let params: Vec<Box<dyn ToSql + Sync>> = rows
        .iter()
        .flat_map(|row| col_indices.iter().map(|&idx| &row.cells[idx]))
        .map(|cell| -> Box<dyn ToSql + Sync> {
            match cell {
                Cell::Null => Box::new(WildcardNull),
                Cell::Int(i) => Box::new(*i),
                Cell::Real(f) => Box::new(*f),
                Cell::Text(t) => Box::new(t.clone()),
                Cell::Blob(b) => Box::new(b.clone()),
            }
        })
        .collect();
    let param_refs: Vec<&(dyn ToSql + Sync)> = params.iter().map(|p| p.as_ref()).collect();
    tx.execute(&sql, &param_refs)
        .await
        .map_err(|e| format!("insert into {table}: {e}"))?;
    Ok(())
}

/// Decode one Postgres cell as a normalized [`Cell`] by probing the runtime
/// type in the same order `read_sqlite_rows` emits them (int → real → text →
/// blob). Extracted from the read loop so the type-sniffing chain is a
/// flat, independently testable function.
pub fn decode_pg_cell(
    row: &tokio_postgres::Row,
    i: usize,
    col: &str,
    table: &str,
) -> Result<Cell, String> {
    if let Ok(Some(i)) = row.try_get::<_, Option<i64>>(i) {
        return Ok(Cell::Int(i));
    }
    if row.try_get::<_, Option<i64>>(i).is_ok() {
        return Ok(Cell::Null);
    }
    if let Ok(Some(f)) = row.try_get::<_, Option<f64>>(i) {
        return Ok(Cell::Real(f));
    }
    if row.try_get::<_, Option<f64>>(i).is_ok() {
        return Ok(Cell::Null);
    }
    if let Ok(Some(t)) = row.try_get::<_, Option<String>>(i) {
        return Ok(Cell::Text(t));
    }
    if row.try_get::<_, Option<String>>(i).is_ok() {
        return Ok(Cell::Null);
    }
    if let Ok(Some(b)) = row.try_get::<_, Option<Vec<u8>>>(i) {
        return Ok(Cell::Blob(b));
    }
    if row.try_get::<_, Option<Vec<u8>>>(i).is_ok() {
        return Ok(Cell::Null);
    }
    // Every probe failed — the value has a type none of the four probes can
    // decode (e.g. an array or a custom domain). Surface the raw driver error.
    Err(format!(
        "decode {table}.{col}: {}",
        row.try_get::<_, Option<Vec<u8>>>(i)
            .err()
            .map(|e| e.to_string())
            .unwrap_or_else(|| "unrecognized value type".to_string())
    ))
}

/// Read every row of a Postgres table (same column order) as normalized
/// cells — mirrors [`read_sqlite_rows`] so checksums compare directly.
pub async fn read_pg_rows(
    pool: &Pool,
    table: &str,
    columns: &[String],
) -> Result<Vec<Row>, String> {
    let col_list = columns
        .iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("SELECT {col_list} FROM \"{table}\" ORDER BY 1");
    let client = pool.get().await.map_err(|e| e.to_string())?;
    let rows = client
        .query(&sql, &[])
        .await
        .map_err(|e| format!("read {table}: {e}"))?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let mut cells = Vec::with_capacity(columns.len());
        for (i, col) in columns.iter().enumerate() {
            cells.push(decode_pg_cell(&row, i, col, table)?);
        }
        out.push(Row { cells });
    }
    Ok(out)
}
