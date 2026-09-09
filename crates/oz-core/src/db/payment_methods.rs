//! Local payment methods (regional slice 6).
//!
//! Owns `local_payment_methods` (`20260924_local_payment_methods.sql`): the
//! market's payment-rail surface — which rails exist, what they are called,
//! whether the site offers them — owned by the legal entity with
//! per-location overrides.
//!
//! Two deliberate separations, both tested:
//!
//! * **Tier separation.** `supports_qris` is a TIER capability (license-
//!   server feature grants / entitlements caps DTO). This module never
//!   imports an entitlement, no entitlement code reads these rows, and the
//!   read model carries no tier field — "the plan includes QRIS" and "this
//!   site offers QRIS" are different facts (todo-global-saas-2.md:2579: the
//!   pre-design state conflated them). Pinned from both directions by
//!   `payment_settings_carry_no_tier_answer` and
//!   `tier_capability_is_not_inferable_from_payment_settings`.
//! * **Credential separation.** The `parameters` JSON bag is per-rail
//!   MARKET metadata (e.g. display hints); it must NEVER carry gateway
//!   credentials — `payment_gateways` owns provider credentials and
//!   integration secrets. A rail can be market-enabled with no gateway
//!   configured. The write path rejects credential-shaped keys outright
//!   (belt-and-suspenders documentation-as-test, per the slice-6 ruling).
//!
//! Inheritance: the legal-entity row is the market default for a rail; a
//! location row overrides that rail — including `is_enabled = false`,
//! because "not offered at this site" is a FACT, not the absence of one
//! (a location disable survives an entity re-enable until the location row
//! itself is cleared, pinned by `location_disable_survives_entity_reenable`).
//!
//! RLS posture: tenant_id stamped from birth, RLS_EXEMPT like slice 5
//! (desktop-local writes; parent legal_entities still exempt).

use crate::error::CoreError;
use rusqlite::OptionalExtension;
use rusqlite::params;
use serde::Serialize;

/// Credential-shaped parameter keys the write path rejects outright.
const FORBIDDEN_PARAMETER_FRAGMENTS: &[&str] = &[
    "credential",
    "secret",
    "api_key",
    "apikey",
    "token",
    "password",
    "private_key",
];

/// Validate that a parameters JSON bag carries no credential-shaped keys.
///
/// The bag is per-rail MARKET metadata; gateway credentials belong to
/// `payment_gateways`, never here. Fails closed: unparseable JSON is also
/// rejected (a malformed bag could smuggle a credential past a JSON-aware
/// reviewer).
fn validate_parameters_bag(raw: &str) -> Result<(), CoreError> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|err| CoreError::Validation {
            field: "parameters".into(),
            message: format!("parameters must be a JSON object: {err}"),
        })?;
    let serde_json::Value::Object(map) = &value else {
        return Err(CoreError::Validation {
            field: "parameters".into(),
            message: "parameters must be a JSON object".into(),
        });
    };
    for key in map.keys() {
        let lower = key.to_ascii_lowercase();
        for fragment in FORBIDDEN_PARAMETER_FRAGMENTS {
            if lower.contains(fragment) {
                return Err(CoreError::Validation {
                    field: "parameters".into(),
                    message: format!(
                        "parameter key {key:?} looks like a gateway credential — payment_gateways owns credentials, not the market rail surface"
                    ),
                });
            }
        }
    }
    Ok(())
}

/// One effective payment rail for a location, with its provenance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectivePaymentRail {
    /// Stable rail code (e.g. `qris`, `va-bca`, `ewallet-ovo`).
    pub rail_code: String,
    /// Display label.
    pub label: String,
    /// Whether the site offers the rail.
    pub is_enabled: bool,
    /// Who answered: the market default (legal entity) or the site
    /// (location) override.
    pub scope: crate::regional::ConfigScope,
    /// Per-rail market metadata (JSON object). Never credentials.
    pub parameters: String,
}

impl crate::db::Store<'_> {
    /// Replace the full rail set for one scope (a legal entity's market
    /// default list, or a location's override list) — the card's whole-list
    /// write, transactional.
    ///
    /// Rails absent from `rails` are DELETED for the scope (the card edits
    /// the whole list, so removal is expressed by omission). Every rail is
    /// validated before the transaction opens: rail code and label non-
    /// empty, parameters a credential-free JSON object.
    #[allow(clippy::too_many_arguments)]
    pub fn replace_local_payment_methods(
        &self,
        scope_type: &str,
        scope_id: &str,
        rails: &[NewPaymentRail],
        now: &str,
    ) -> Result<(), CoreError> {
        if scope_type != "legal_entity" && scope_type != "location" {
            return Err(CoreError::Validation {
                field: "scope_type".into(),
                message: format!("scope_type must be legal_entity or location; got {scope_type:?}"),
            });
        }
        for rail in rails {
            if rail.rail_code.trim().is_empty() {
                return Err(CoreError::Validation {
                    field: "rail_code".into(),
                    message: "rail_code must not be blank".into(),
                });
            }
            if rail.label.trim().is_empty() {
                return Err(CoreError::Validation {
                    field: "label".into(),
                    message: "label must not be blank".into(),
                });
            }
            validate_parameters_bag(&rail.parameters)?;
        }
        let mut seen = std::collections::HashSet::new();
        for rail in rails {
            if !seen.insert(rail.rail_code.to_ascii_lowercase()) {
                return Err(CoreError::Validation {
                    field: "rail_code".into(),
                    message: format!(
                        "duplicate rail_code in the submitted set: {:?}",
                        rail.rail_code
                    ),
                });
            }
        }

        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM local_payment_methods WHERE scope_type = ?1 AND scope_id = ?2",
            params![scope_type, scope_id],
        )?;
        for rail in rails {
            tx.execute(
                "INSERT INTO local_payment_methods
                     (id, tenant_id, scope_type, scope_id, rail_code, label,
                      is_enabled, parameters, created_at, updated_at)
                 VALUES (?1, 'default', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                params![
                    uuid::Uuid::now_v7().to_string(),
                    scope_type,
                    scope_id,
                    rail.rail_code.trim(),
                    rail.label.trim(),
                    rail.is_enabled,
                    rail.parameters,
                    now,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// The effective rail surface for one location: start from the linked
    /// legal entity's market rows (the rails the market knows), then let
    /// the location's own rows override per rail — including an explicit
    /// disable, because "not offered at this site" is a fact. Rails the
    /// entity knows nothing about but the location declares are site-local
    /// rails and pass through with location provenance.
    ///
    /// An unlinked or unknown location answers an empty list — no market,
    /// no rails, no invented defaults.
    pub fn local_payment_methods_for_location(
        &self,
        location_id: &str,
    ) -> Result<Vec<EffectivePaymentRail>, CoreError> {
        let entity_id: Option<String> = self
            .conn
            .query_row(
                "SELECT legal_entity_id FROM locations WHERE id = ?1",
                params![location_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()? // no such row → no location at all
            .flatten(); // NULL link → location exists, entity does not
        let Some(entity_id) = entity_id else {
            return Ok(Vec::new());
        };

        let load =
            |scope_type: &str, scope_id: &str| -> Result<Vec<EffectivePaymentRail>, CoreError> {
                let mut stmt = self.conn.prepare(
                    "SELECT rail_code, label, is_enabled, parameters
                 FROM local_payment_methods
                 WHERE scope_type = ?1 AND scope_id = ?2
                 ORDER BY label, rail_code",
                )?;
                let rows = stmt
                    .query_map(params![scope_type, scope_id], |row| {
                        Ok(EffectivePaymentRail {
                            rail_code: row.get(0)?,
                            label: row.get(1)?,
                            is_enabled: row.get::<_, i64>(2)? != 0,
                            scope: if scope_type == "legal_entity" {
                                crate::regional::ConfigScope::LegalEntity
                            } else {
                                crate::regional::ConfigScope::Location
                            },
                            parameters: row.get(3)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            };

        let entity_rows = load("legal_entity", &entity_id)?;
        let location_rows = load("location", location_id)?;

        // Entity rows are the market defaults; location rows win per rail.
        let mut by_rail: std::collections::HashMap<String, EffectivePaymentRail> = entity_rows
            .into_iter()
            .map(|rail| (rail.rail_code.clone(), rail))
            .collect();
        for rail in location_rows {
            by_rail.insert(rail.rail_code.clone(), rail);
        }
        let mut effective: Vec<EffectivePaymentRail> = by_rail.into_values().collect();
        effective.sort_by(|a, b| a.label.cmp(&b.label).then(a.rail_code.cmp(&b.rail_code)));
        Ok(effective)
    }
}

/// One rail in a replace-set submission.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewPaymentRail {
    /// Stable rail code (UNIQUE within the submission and the scope).
    pub rail_code: String,
    /// Display label.
    pub label: String,
    /// Whether the rail is offered at this scope.
    pub is_enabled: bool,
    /// Per-rail market metadata (JSON object). Never credentials.
    pub parameters: String,
}

#[cfg(test)]
#[path = "payment_methods_tests.rs"]
mod tests;
