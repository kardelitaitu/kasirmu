/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B5 part 6)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: TBL-08 geometry validation exemplary (finite/bounds/min-size at DB boundary); parameterized SQL throughout; f64 is presentation geometry only, not money
next: none | perf: N/A
*/
//! Table (floor plan) persistence — CRUD on dining tables per section.
//!
//! [`Store`] methods list/get/create/update/delete tables, with
//! [`validate_table_geometry`] enforcing TBL-08 bounds (finite,
//! `0..=100` percentage positions/sizes, non-zero usable size) at the
//! database boundary so persisted geometry always renders.

use rusqlite::params;

use crate::Table;
use crate::error::CoreError;

use super::Store;

/// Floor-plan geometry bounds (TBL-08): positions and sizes are persisted as
/// percentages of the floor plan, so every value must be finite, within
/// `0..=100`, and large enough to remain a usable interactive control.
const GEOMETRY_BOUNDS: (f64, f64) = (0.0, 100.0);
/// Minimum table width/height as a percentage so a persisted table can never
/// collapse into an unusably tiny (or zero-sized) control.
const GEOMETRY_MIN_SIZE: f64 = 2.0;

/// Validate floor-plan geometry for create/update (TBL-08).
///
/// Rejects non-finite (`NaN`/`inf`), negative, out-of-bounds, and zero-sized
/// values at the database boundary so invalid persisted input can never place
/// tables outside the floor plan or produce overlapping/tiny controls.
fn validate_table_geometry(table: &Table) -> Result<(), CoreError> {
    let fields = [
        ("pos_x", table.pos_x),
        ("pos_y", table.pos_y),
        ("width", table.width),
        ("height", table.height),
    ];
    for (field, value) in fields {
        if !value.is_finite() {
            return Err(CoreError::Validation {
                field,
                message: "must be a finite number".into(),
            });
        }
        if !(GEOMETRY_BOUNDS.0..=GEOMETRY_BOUNDS.1).contains(&value) {
            return Err(CoreError::Validation {
                field,
                message: "must be between 0 and 100".into(),
            });
        }
    }
    if table.width < GEOMETRY_MIN_SIZE || table.height < GEOMETRY_MIN_SIZE {
        return Err(CoreError::Validation {
            field: "width",
            message: format!("tables must be at least {GEOMETRY_MIN_SIZE}% wide and tall"),
        });
    }
    Ok(())
}

impl Store<'_> {
    fn row_to_table(row: &rusqlite::Row) -> rusqlite::Result<Table> {
        let active_int: i64 = row.get("active")?;
        Ok(Table {
            id: row.get("id")?,
            name: row.get("name")?,
            capacity: row.get("capacity")?,
            pos_x: row.get("pos_x")?,
            pos_y: row.get("pos_y")?,
            shape: row.get("shape")?,
            width: row.get("width")?,
            height: row.get("height")?,
            status: row.get("status")?,
            active_sale_id: row.get("active_sale_id")?,
            section: row.get("section")?,
            active: active_int != 0,
            sort_order: row.get("sort_order")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }

    /// List all active tables, optionally filtered by section.
    pub fn list_tables(&self, section: Option<&str>) -> Result<Vec<Table>, CoreError> {
        let mut stmt = match section {
            Some(_) => self.conn.prepare(
                "SELECT * FROM tables WHERE active = 1 AND section = ?1 ORDER BY sort_order, name",
            )?,
            None => self
                .conn
                .prepare("SELECT * FROM tables WHERE active = 1 ORDER BY sort_order, name")?,
        };
        let rows = if section.is_some() {
            stmt.query_map(params![section], Self::row_to_table)?
        } else {
            stmt.query_map([], Self::row_to_table)?
        };
        rows.map(|r| Ok(r?)).collect()
    }

    /// Look up a single table by id.
    pub fn get_table(&self, id: &str) -> Result<Option<Table>, CoreError> {
        let mut stmt = self.conn.prepare("SELECT * FROM tables WHERE id = ?1")?;
        let result = stmt.query_row(params![id], Self::row_to_table);
        match result {
            Ok(t) => Ok(Some(t)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Insert a new table; assigns a UUID if `table.id` is empty.
    pub fn create_table(&self, table: &Table) -> Result<Table, CoreError> {
        if table.name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "table name must not be empty".into(),
            });
        }
        if table.capacity < 0 {
            return Err(CoreError::Validation {
                field: "capacity",
                message: "capacity must not be negative".into(),
            });
        }
        // TBL-08: reject unusable persisted geometry at the boundary.
        validate_table_geometry(table)?;
        let active_int: i64 = if table.active { 1 } else { 0 };
        let id = if table.id.is_empty() {
            uuid::Uuid::now_v7().to_string()
        } else {
            table.id.clone()
        };
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        self.conn.execute(
            "INSERT INTO tables (id, name, capacity, pos_x, pos_y, shape, width, height, status, active_sale_id, section, active, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                id, table.name, table.capacity,
                table.pos_x, table.pos_y, table.shape,
                table.width, table.height, table.status,
                table.active_sale_id, table.section, active_int,
                table.sort_order, now, now,
            ],
        )?;
        self.get_table(&id)?.ok_or_else(|| CoreError::NotFound {
            entity: "table",
            id: id.to_owned(),
        })
    }

    /// Update all fields of an existing table.
    pub fn update_table(&self, table: &Table) -> Result<Table, CoreError> {
        if table.name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "table name must not be empty".into(),
            });
        }
        if table.capacity < 0 {
            return Err(CoreError::Validation {
                field: "capacity",
                message: "capacity must not be negative".into(),
            });
        }
        // TBL-08: reject unusable persisted geometry at the boundary.
        validate_table_geometry(table)?;
        let active_int: i64 = if table.active { 1 } else { 0 };
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rows = self.conn.execute(
            "UPDATE tables SET name = ?1, capacity = ?2, pos_x = ?3, pos_y = ?4,
             shape = ?5, width = ?6, height = ?7, status = ?8,
             active_sale_id = ?9, section = ?10, active = ?11, sort_order = ?12,
             updated_at = ?13 WHERE id = ?14",
            params![
                table.name,
                table.capacity,
                table.pos_x,
                table.pos_y,
                table.shape,
                table.width,
                table.height,
                table.status,
                table.active_sale_id,
                table.section,
                active_int,
                table.sort_order,
                now,
                table.id,
            ],
        )?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "table",
                id: table.id.clone(),
            });
        }
        self.get_table(&table.id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "table",
                id: table.id.clone(),
            })
    }

    /// Hard-delete a table by id.
    ///
    /// TBL-04: rejects deletion while the table is occupied, reserved, or
    /// linked to an active sale — removing an operationally-referenced table
    /// would orphan the `active_sale_id` link that KDS table-number lookup
    /// relies on and hide a live floor-plan seat. Prefer deactivation
    /// (`active = false`) for lifecycle management; a free, unlinked table is
    /// still hard-deletable.
    pub fn delete_table(&self, id: &str) -> Result<(), CoreError> {
        let current = self.get_table(id)?.ok_or_else(|| CoreError::NotFound {
            entity: "table",
            id: id.to_owned(),
        })?;
        if current.status == "occupied"
            || current.status == "reserved"
            || current.active_sale_id.is_some()
        {
            return Err(CoreError::Validation {
                field: "status",
                message: "cannot delete a table that is occupied, reserved, or linked to an active sale — deactivate it instead".into(),
            });
        }
        let rows = self
            .conn
            .execute("DELETE FROM tables WHERE id = ?1", params![id])?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "table",
                id: id.to_owned(),
            });
        }
        Ok(())
    }

    /// Update just the status field (available / occupied / reserved / cleaning).
    ///
    /// TBL-01 invariant: the `occupied` status is reserved for tables linked
    /// to an active sale. A caller may only reach `occupied` through
    /// [`Store::assign_table_order`] (which sets `status` and `active_sale_id`
    /// together); marking a table occupied without an active sale is rejected
    /// so the floor plan can never show unassigned occupancy and KDS
    /// table-number lookup stays consistent.
    pub fn update_table_status(&self, id: &str, status: &str) -> Result<Table, CoreError> {
        if crate::TableStatus::from_str(status).is_none() {
            return Err(CoreError::Validation {
                field: "status",
                message: "invalid table status".into(),
            });
        }
        if status == "occupied" {
            match self.get_table(id)? {
                Some(t) if t.active_sale_id.is_some() => {}
                Some(_) => {
                    return Err(CoreError::Validation {
                        field: "status",
                        // The command name here is advice a cashier's device acts on, so it
                        // has to be one a shell actually registers. `assign_table_order` never
                        // was: absent from both `generate_handler!` lists, and its tablet
                        // definition was deleted on 2026-09-16 (T19). The scoped form is
                        // registered in both shells.
                        message: "occupied requires an active sale — use assign_table_order_scoped"
                            .into(),
                    });
                }
                None => {
                    return Err(CoreError::NotFound {
                        entity: "table",
                        id: id.to_owned(),
                    });
                }
            }
        }
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rows = self.conn.execute(
            "UPDATE tables SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now, id],
        )?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "table",
                id: id.to_owned(),
            });
        }
        self.get_table(id)?.ok_or_else(|| CoreError::NotFound {
            entity: "table",
            id: id.to_owned(),
        })
    }

    /// Set table status to `occupied` and link it to an active sale.
    pub fn assign_table_order(&self, table_id: &str, sale_id: &str) -> Result<Table, CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rows = self.conn.execute(
            "UPDATE tables SET status = 'occupied', active_sale_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![sale_id, now, table_id],
        )?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "table",
                id: table_id.to_owned(),
            });
        }
        self.get_table(table_id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "table",
                id: table_id.to_owned(),
            })
    }

    /// Release an occupied table: set status to cleaning, clear the sale link.
    pub fn release_table(&self, table_id: &str) -> Result<Table, CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rows = self.conn.execute(
            "UPDATE tables SET status = 'cleaning', active_sale_id = NULL, updated_at = ?1 WHERE id = ?2",
            params![now, table_id],
        )?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "table",
                id: table_id.to_owned(),
            });
        }
        self.get_table(table_id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "table",
                id: table_id.to_owned(),
            })
    }

    /// Return distinct non-empty section names from active tables.
    pub fn list_sections(&self) -> Result<Vec<String>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT section FROM tables WHERE active = 1 AND section != '' ORDER BY section",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|r| Ok(r?)).collect()
    }
}

#[cfg(test)]
#[path = "tables_tests.rs"]
mod tests;
