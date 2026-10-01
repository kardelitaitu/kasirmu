//! Payment gateway configuration CRUD.
//!
//! Owns `payment_gateways` (`20260825_payment_infra.sql`): per-store gateway
//! credentials and configuration so runtime payment processors (Stripe, Midtrans, etc.)
//! can initialize with secure credentials separate from market tender rails in `local_payment_methods`.
//!
//! All sensitive configuration data in `config_json` is encrypted at rest using
//! `kasirmu_crypto::encrypt_payment_gateway_config` and decrypted transparently on read.
//!
//! Main types:
//! - [`PaymentGatewayConfig`]: The persisted gateway row with decrypted configuration.
//! - [`UpsertPaymentGateway`]: Input payload for creating or updating a gateway.
//!
//! Invariants:
//! - Gateway names are case-insensitive and normalized to lowercase.
//! - `config_json` must be a valid JSON object.
//! - Raw configuration stored in SQLite is encrypted with `PAYMENT_GATEWAY_AT_REST_DOMAIN`.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::Store;
use crate::error::CoreError;

/// A payment gateway configuration row (from `payment_gateways`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentGatewayConfig {
    /// UUID v7.
    pub id: String,
    /// RLS tenant scope.
    pub tenant_id: String,
    /// Gateway name: "stripe", "square", "midtrans", "paddle".
    pub name: String,
    /// Whether the gateway is enabled.
    pub is_active: bool,
    /// Gateway-specific configuration JSON (decrypted in memory).
    pub config_json: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 update timestamp.
    pub updated_at: String,
}

/// Input payload to create or update a payment gateway configuration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertPaymentGateway {
    /// Gateway name: "stripe", "midtrans", etc.
    pub name: String,
    /// Whether the gateway is enabled.
    pub is_active: bool,
    /// Plaintext JSON object containing gateway keys/config.
    pub config_json: String,
}

fn validate_gateway_input(input: &UpsertPaymentGateway) -> Result<(String, String), CoreError> {
    let name = input.name.trim().to_ascii_lowercase();
    if name.is_empty() {
        return Err(CoreError::Validation {
            field: "name",
            message: "gateway name must not be blank".into(),
        });
    }
    if name.chars().count() > 64 {
        return Err(CoreError::Validation {
            field: "name",
            message: "gateway name must be 64 characters or fewer".into(),
        });
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(CoreError::Validation {
            field: "name",
            message:
                "gateway name may only contain alphanumeric characters, hyphens, and underscores"
                    .into(),
        });
    }

    let config_raw = input.config_json.trim();
    let config_str = if config_raw.is_empty() {
        "{}"
    } else {
        config_raw
    };
    let parsed: serde_json::Value =
        serde_json::from_str(config_str).map_err(|err| CoreError::Validation {
            field: "config_json",
            message: format!("config_json must be valid JSON: {err}"),
        })?;
    if !parsed.is_object() {
        return Err(CoreError::Validation {
            field: "config_json",
            message: "config_json must be a JSON object".into(),
        });
    }

    Ok((name, config_str.to_string()))
}

fn decrypt_row(
    id: String,
    tenant_id: String,
    name: String,
    is_active: bool,
    raw_config: String,
    created_at: String,
    updated_at: String,
) -> Result<PaymentGatewayConfig, CoreError> {
    let config_json =
        kasirmu_crypto::decrypt_payment_gateway_config(&raw_config).map_err(|err| {
            CoreError::Internal(format!(
                "failed to decrypt payment gateway config for {name}: {err}"
            ))
        })?;
    Ok(PaymentGatewayConfig {
        id,
        tenant_id,
        name,
        is_active,
        config_json,
        created_at,
        updated_at,
    })
}

impl Store<'_> {
    /// Upsert a payment gateway configuration for a tenant.
    ///
    /// Validates `name` and `config_json`, encrypts `config_json` at rest via
    /// `kasirmu-crypto`, and performs an atomic upsert inside a transaction.
    pub fn upsert_payment_gateway(
        &self,
        tenant_id: &str,
        input: &UpsertPaymentGateway,
        now: &str,
    ) -> Result<PaymentGatewayConfig, CoreError> {
        let (name, validated_config) = validate_gateway_input(input)?;
        let encrypted_config = kasirmu_crypto::encrypt_payment_gateway_config(&validated_config)
            .map_err(|err| {
                CoreError::Internal(format!("failed to encrypt payment gateway config: {err}"))
            })?;
        let id = uuid::Uuid::now_v7().to_string();

        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO payment_gateways (id, tenant_id, name, is_active, config_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT (tenant_id, name) DO UPDATE SET
                 is_active = excluded.is_active,
                 config_json = excluded.config_json,
                 updated_at = excluded.updated_at",
            params![
                id,
                tenant_id,
                name,
                i64::from(input.is_active),
                encrypted_config,
                now,
            ],
        )?;
        tx.commit()?;

        self.get_payment_gateway(tenant_id, &name)?.ok_or_else(|| {
            CoreError::Internal(format!("payment gateway {name} vanished after upsert"))
        })
    }

    /// Load a single gateway configuration by name for a tenant.
    pub fn get_payment_gateway(
        &self,
        tenant_id: &str,
        name: &str,
    ) -> Result<Option<PaymentGatewayConfig>, CoreError> {
        let norm_name = name.trim().to_ascii_lowercase();
        let mut stmt = self.conn.prepare(
            "SELECT id, tenant_id, name, is_active, config_json, created_at, updated_at
             FROM payment_gateways
             WHERE tenant_id = ?1 AND name = ?2",
        )?;
        let mut rows = stmt.query(params![tenant_id, norm_name])?;
        if let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let tenant: String = row.get(1)?;
            let row_name: String = row.get(2)?;
            let active_int: i64 = row.get(3)?;
            let raw_config: String = row.get(4)?;
            let created_at: String = row.get(5)?;
            let updated_at: String = row.get(6)?;
            let config = decrypt_row(
                id,
                tenant,
                row_name,
                active_int != 0,
                raw_config,
                created_at,
                updated_at,
            )?;
            Ok(Some(config))
        } else {
            Ok(None)
        }
    }

    /// List all payment gateways configured for a tenant.
    pub fn list_payment_gateways(
        &self,
        tenant_id: &str,
    ) -> Result<Vec<PaymentGatewayConfig>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, tenant_id, name, is_active, config_json, created_at, updated_at
             FROM payment_gateways
             WHERE tenant_id = ?1
             ORDER BY name ASC",
        )?;
        let rows = stmt.query_map(params![tenant_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;

        let mut results = Vec::new();
        for item in rows {
            let (id, tenant, name, active_int, raw_config, created_at, updated_at) = item?;
            results.push(decrypt_row(
                id,
                tenant,
                name,
                active_int != 0,
                raw_config,
                created_at,
                updated_at,
            )?);
        }
        Ok(results)
    }

    /// List active payment gateways configured for a tenant.
    pub fn list_active_payment_gateways(
        &self,
        tenant_id: &str,
    ) -> Result<Vec<PaymentGatewayConfig>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, tenant_id, name, is_active, config_json, created_at, updated_at
             FROM payment_gateways
             WHERE tenant_id = ?1 AND is_active = 1
             ORDER BY name ASC",
        )?;
        let rows = stmt.query_map(params![tenant_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;

        let mut results = Vec::new();
        for item in rows {
            let (id, tenant, name, active_int, raw_config, created_at, updated_at) = item?;
            results.push(decrypt_row(
                id,
                tenant,
                name,
                active_int != 0,
                raw_config,
                created_at,
                updated_at,
            )?);
        }
        Ok(results)
    }

    /// Delete a payment gateway configuration by name for a tenant.
    pub fn delete_payment_gateway(&self, tenant_id: &str, name: &str) -> Result<bool, CoreError> {
        let norm_name = name.trim().to_ascii_lowercase();
        let tx = self.conn.unchecked_transaction()?;
        let affected = tx.execute(
            "DELETE FROM payment_gateways WHERE tenant_id = ?1 AND name = ?2",
            params![tenant_id, norm_name],
        )?;
        tx.commit()?;
        Ok(affected > 0)
    }
}

/// Legacy stub for backward compatibility.
pub fn upsert_gateway(_store: &Store<'_>) -> Result<(), CoreError> {
    Err(CoreError::Internal(
        "upsert_gateway — deprecated stub, use store.upsert_payment_gateway".into(),
    ))
}

/// Legacy stub for backward compatibility.
pub fn list_active_gateways(store: &Store<'_>) -> Result<Vec<PaymentGatewayConfig>, CoreError> {
    store.list_active_payment_gateways("default")
}

/// Legacy stub for backward compatibility.
pub fn get_gateway(_store: &Store<'_>) -> Result<Option<PaymentGatewayConfig>, CoreError> {
    Err(CoreError::Internal(
        "get_gateway — deprecated stub, use store.get_payment_gateway".into(),
    ))
}

#[cfg(test)]
#[path = "payment_gateways_tests.rs"]
mod tests;
