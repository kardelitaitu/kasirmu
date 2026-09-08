//! Regional-configuration reads — resolve a location's effective market facts.
//!
//! Slice 1 of the regional-configuration item (todo-global-saas-2.md,
//! "Regional configuration — design"). Read-only by decision: the write path
//! needs a UI and a settings-scope ruling, and the location row is a
//! full-overwrite surface (update_location_profile_scoped takes every mutable
//! field and TopologyScreen.tsx hand-lists them), so a regional column must
//! never ride that path. This module reads the three scopes, assembles the
//! inheritance chain, and hands the resolution to the pure
//! [`RegionalConfig::resolve`].

use rusqlite::params;

use super::Store;
use crate::CoreError;
use crate::regional::{ConfigScope, RegionalConfig, RegionalLayer};
use crate::settings::{Settings, keys};

/// The organization-level locale key, as written by the Settings → General
/// language selector (`ui/src/features/settings/sections/GeneralSection.tsx`).
///
/// Until this module read it, nothing in the repo did: the selector persisted
/// the locale and no reader ever consulted it, which is why the organization
/// layer of the locale chain was empty by omission rather than by design.
const ORG_LOCALE_KEY: &str = keys::UI_LOCALE;

impl Store<'_> {
    /// Resolve the effective regional configuration for one location.
    ///
    /// Walks Location → Legal Entity → Organization (the `settings` table) and
    /// lets [`RegionalConfig::resolve`] apply the built-in fallback, so the
    /// precedence rule lives in exactly one place.
    ///
    /// The legal-entity layer is read **tenant-filtered**: an entity row
    /// belonging to a different tenant contributes nothing, even if
    /// `locations.legal_entity_id` points at it. Falling through to the
    /// organization level is fail-closed for configuration — a tenant gets
    /// less-specific answers, never another tenant's currency.
    ///
    /// Returns [`CoreError::NotFound`] when the location does not exist; an
    /// unknown location has no honest answer, and inventing defaults would make
    /// a typo'd id look like a configured store.
    pub fn regional_config_for_location(
        &self,
        location_id: &str,
    ) -> Result<RegionalConfig, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT currency, timezone, locale, legal_entity_id, tenant_id
             FROM locations WHERE id = ?1",
        )?;
        let row = stmt
            .query_row(params![location_id], |row| {
                Ok((
                    row.get::<_, String>("currency")?,
                    row.get::<_, String>("timezone")?,
                    row.get::<_, String>("locale")?,
                    row.get::<_, Option<String>>("legal_entity_id")?,
                    row.get::<_, String>("tenant_id")?,
                ))
            })
            .map_err(|err| match err {
                // Only "no such row" is NotFound. A real database error
                // (a malformed row, an i/o failure) propagates unchanged —
                // collapsing every error into NotFound would make a broken
                // schema look like a missing location, and the caller would
                // retry the wrong thing.
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "location",
                    id: location_id.to_owned(),
                },
                other => CoreError::Db(other),
            })?;
        let (loc_currency, loc_timezone, loc_locale, legal_entity_id, tenant_id) = row;

        let entity_layer = match legal_entity_id.as_deref() {
            Some(entity_id) => {
                let mut estmt = self.conn.prepare(
                    "SELECT locale, timezone, currency, country_code
                     FROM legal_entities WHERE id = ?1 AND tenant_id = ?2",
                )?;
                let entity = estmt
                    .query_row(params![entity_id, tenant_id], |row| {
                        Ok((
                            row.get::<_, String>("locale")?,
                            row.get::<_, String>("timezone")?,
                            row.get::<_, String>("currency")?,
                            row.get::<_, String>("country_code")?,
                        ))
                    })
                    .ok();
                entity.map(|(locale, timezone, currency, country_code)| {
                    RegionalLayer::blank(
                        ConfigScope::LegalEntity,
                        &locale,
                        &timezone,
                        &currency,
                        &country_code,
                    )
                })
            }
            None => None,
        };

        let org_layer = RegionalLayer::organization(
            Settings::get(self.conn, ORG_LOCALE_KEY)?,
            Settings::get_default_currency(self.conn)?,
        );

        let mut layers = vec![RegionalLayer::blank(
            ConfigScope::Location,
            &loc_locale,
            &loc_timezone,
            &loc_currency,
            "",
        )];
        layers.extend(entity_layer);
        layers.push(org_layer);
        Ok(RegionalConfig::resolve(
            location_id,
            legal_entity_id,
            &layers,
        ))
    }

    /// Resolve the regional configuration for the primary location.
    ///
    /// `Ok(None)` when the deployment has no primary location — the same
    /// "not seeded yet" state every other primary-location reader handles, and
    /// callers must not read a regional default into that gap.
    pub fn primary_regional_config(&self) -> Result<Option<RegionalConfig>, CoreError> {
        let id: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM locations WHERE is_primary = 1 LIMIT 1",
                [],
                |row| row.get(0),
            )
            .ok();
        match id {
            Some(id) => self.regional_config_for_location(&id).map(Some),
            None => Ok(None),
        }
    }
}

#[cfg(test)]
#[path = "regional_tests.rs"]
mod tests;
