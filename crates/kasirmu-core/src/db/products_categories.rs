//! Category CRUD.
//!
//! Key functions: `list_categories`, `create_category`,
//! `update_category`, `delete_category`, `delete_category_with_unlink`
//! (unlinks products before delete), `get_category`.
//!
//! Invariants: category names are unique per tenant; deletes either
//! refuse when products reference the category or unlink first via the
//! explicit `delete_category_with_unlink` API.
use super::*;
use crate::Category;

// ── Category CRUD ─────────────────────────────────────────────────────

impl Store<'_> {
    /// List all categories, ordered by name.
    pub fn list_categories(&self) -> Result<Vec<Category>, CoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, colour, icon FROM categories ORDER BY name")?;
        let rows = stmt.query_map([], |row| {
            Ok(Category {
                id: row.get("id")?,
                name: row.get("name")?,
                colour: row.get("colour")?,
                icon: row.get("icon")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Insert a new category.
    pub fn create_category(
        &self,
        id: &str,
        name: &str,
        colour: &str,
        icon: &str,
    ) -> Result<Category, CoreError> {
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "category name must not be empty".into(),
            });
        }

        let result = self.conn.execute(
            "INSERT INTO categories (id, name, colour, icon) VALUES (?1, ?2, ?3, ?4)",
            params![id, name.trim(), colour, icon],
        );

        match result {
            Err(rusqlite::Error::SqliteFailure(e, _))
                if e.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                return Err(CoreError::Conflict {
                    entity: "category",
                    field: "name",
                });
            }
            Err(e) => return Err(e.into()),
            Ok(_) => {}
        }

        Ok(Category::new(id, name, colour, icon))
    }

    /// Update an existing category's name, colour, and icon.
    ///
    /// Returns [`CoreError::NotFound`] if no category with `id` exists.
    pub fn update_category(
        &self,
        id: &str,
        name: &str,
        colour: &str,
        icon: &str,
    ) -> Result<Category, CoreError> {
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "category name must not be empty".into(),
            });
        }

        let rows = self.conn.execute(
            "UPDATE categories SET name = ?1, colour = ?2, icon = ?3 WHERE id = ?4",
            params![name.trim(), colour, icon, id],
        )?;

        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "category",
                id: id.to_owned(),
            });
        }

        Ok(Category::new(id, name, colour, icon))
    }

    /// Delete a category by id.
    pub fn delete_category(&self, id: &str) -> Result<(), CoreError> {
        let rows = self
            .conn
            .execute("DELETE FROM categories WHERE id = ?1", params![id])?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "category",
                id: id.to_owned(),
            });
        }
        Ok(())
    }

    /// Delete a category, explicitly unlinking its products first (CAT-02).
    ///
    /// The relationship policy is made explicit in one transaction: products
    /// referencing this category are set to `category_id = NULL`, then the
    /// category row is deleted. Returns the number of products that were
    /// unlinked so the UI can show the consequence — replacing the implicit
    /// FK-dependent behavior of [`Store::delete_category`] for the
    /// management screen.
    pub fn delete_category_with_unlink(&self, id: &str) -> Result<i64, CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let unlinked = tx.execute(
            "UPDATE products SET category_id = NULL WHERE category_id = ?1",
            params![id],
        )?;
        let deleted = tx.execute("DELETE FROM categories WHERE id = ?1", params![id])?;
        if deleted == 0 {
            return Err(CoreError::NotFound {
                entity: "category",
                id: id.to_owned(),
            });
        }
        tx.commit()?;
        Ok(unlinked as i64)
    }

    /// Look up a category by id.
    pub fn get_category(&self, id: &str) -> Result<Option<Category>, CoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, colour, icon FROM categories WHERE id = ?1")?;
        let result = stmt.query_row(params![id], |row| {
            Ok(Category {
                id: row.get("id")?,
                name: row.get("name")?,
                colour: row.get("colour")?,
                icon: row.get("icon")?,
            })
        });
        match result {
            Ok(c) => Ok(Some(c)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
}
