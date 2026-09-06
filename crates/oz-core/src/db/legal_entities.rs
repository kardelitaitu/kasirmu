//! Tenant-scoped Legal Entity CRUD and Location assignment.
//!
//! Legal Entities sit between an Organization/Tenant and its Locations. Every
//! lookup includes the tenant key, and assignment verifies both sides inside a
//! single transaction so a Location cannot be moved to another tenant's
//! entity through this repository.

use rusqlite::{OptionalExtension, params};

use crate::{CoreError, LegalEntity, UpdateLegalEntity};

use super::Store;

fn validate_entity_fields(tenant_id: &str, name: &str, status: &str) -> Result<(), CoreError> {
    if tenant_id.trim().is_empty() {
        return Err(CoreError::Validation {
            field: "tenant_id",
            message: "must not be empty".into(),
        });
    }
    if name.trim().is_empty() {
        return Err(CoreError::Validation {
            field: "name",
            message: "must not be empty".into(),
        });
    }
    if !matches!(status, "active" | "inactive") {
        return Err(CoreError::Validation {
            field: "status",
            message: "must be 'active' or 'inactive'".into(),
        });
    }
    Ok(())
}

impl Store<'_> {
    /// List Legal Entities owned by one Organization/Tenant.
    pub fn list_legal_entities(&self, tenant_id: &str) -> Result<Vec<LegalEntity>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, tenant_id, name, legal_name, registration_number, tax_id,
                    status, created_at, updated_at
             FROM legal_entities
             WHERE tenant_id = ?1
             ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![tenant_id], Self::row_to_legal_entity)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Get one Legal Entity when it belongs to the requested tenant.
    pub fn get_legal_entity(
        &self,
        tenant_id: &str,
        id: &str,
    ) -> Result<Option<LegalEntity>, CoreError> {
        self.conn
            .query_row(
                "SELECT id, tenant_id, name, legal_name, registration_number, tax_id,
                        status, created_at, updated_at
                 FROM legal_entities
                 WHERE tenant_id = ?1 AND id = ?2",
                params![tenant_id, id],
                Self::row_to_legal_entity,
            )
            .optional()
            .map_err(CoreError::from)
    }

    /// Create a Legal Entity with caller-supplied identity and timestamps.
    pub fn create_legal_entity(&self, entity: &LegalEntity) -> Result<LegalEntity, CoreError> {
        validate_entity_fields(&entity.tenant_id, &entity.name, &entity.status)?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO legal_entities
                (id, tenant_id, name, legal_name, registration_number, tax_id,
                 status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                entity.id,
                entity.tenant_id,
                entity.name,
                entity.legal_name,
                entity.registration_number,
                entity.tax_id,
                entity.status,
                entity.created_at,
                entity.updated_at,
            ],
        )?;
        tx.commit()?;
        Ok(entity.clone())
    }

    /// Update mutable Legal Entity identity fields within one tenant.
    pub fn update_legal_entity(
        &self,
        tenant_id: &str,
        id: &str,
        update: &UpdateLegalEntity,
    ) -> Result<LegalEntity, CoreError> {
        validate_entity_fields(tenant_id, &update.name, &update.status)?;
        let tx = self.conn.unchecked_transaction()?;
        let affected = tx.execute(
            "UPDATE legal_entities
             SET name = ?1, legal_name = ?2, registration_number = ?3,
                 tax_id = ?4, status = ?5,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE tenant_id = ?6 AND id = ?7",
            params![
                update.name,
                update.legal_name,
                update.registration_number,
                update.tax_id,
                update.status,
                tenant_id,
                id
            ],
        )?;
        if affected == 0 {
            tx.rollback()?;
            return Err(CoreError::NotFound {
                entity: "legal_entity",
                id: id.to_owned(),
            });
        }
        tx.commit()?;
        self.get_legal_entity(tenant_id, id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "legal_entity",
                id: id.to_owned(),
            })
    }

    /// Assign a Location to an entity after verifying both belong to a tenant.
    pub fn assign_location_to_legal_entity(
        &self,
        tenant_id: &str,
        location_id: &str,
        legal_entity_id: &str,
    ) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let entity_exists: bool = tx.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM legal_entities WHERE id = ?1 AND tenant_id = ?2
             )",
            params![legal_entity_id, tenant_id],
            |row| row.get(0),
        )?;
        if !entity_exists {
            tx.rollback()?;
            return Err(CoreError::NotFound {
                entity: "legal_entity",
                id: legal_entity_id.to_owned(),
            });
        }

        let affected = tx.execute(
            "UPDATE locations
             SET legal_entity_id = ?1
             WHERE id = ?2 AND tenant_id = ?3",
            params![legal_entity_id, location_id, tenant_id],
        )?;
        if affected == 0 {
            tx.rollback()?;
            return Err(CoreError::NotFound {
                entity: "location",
                id: location_id.to_owned(),
            });
        }
        tx.commit()?;
        Ok(())
    }

    fn row_to_legal_entity(row: &rusqlite::Row<'_>) -> rusqlite::Result<LegalEntity> {
        Ok(LegalEntity {
            id: row.get("id")?,
            tenant_id: row.get("tenant_id")?,
            name: row.get("name")?,
            legal_name: row.get("legal_name")?,
            registration_number: row.get("registration_number")?,
            tax_id: row.get("tax_id")?,
            status: row.get("status")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

#[cfg(test)]
#[path = "legal_entities_tests.rs"]
mod tests;
