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

    /// Write the regional configuration for one location and return the
    /// freshly resolved effective config (read-after-write, same connection).
    ///
    /// Slice 3 of the regional-configuration item — the counterpart of
    /// `Store::regional_config_for_location`. Write shape follows the
    /// design's structural facts:
    ///
    /// - **Location rows + the linked entity's country anchor, nothing
    ///   else.** The design's structural fact #2 records that the location
    ///   row is a full-overwrite surface and that regional columns must
    ///   therefore never ride the general location update; this is the
    ///   dedicated regional write path. Locale/timezone/currency stay on the
    ///   location row; the only entity write is the country anchor, because
    ///   `locations` has no country column and the read resolver takes
    ///   `country_code` from the entity layer — clearing it here would
    ///   make the card unable to set what it displays.
    /// - **Full-overwrite semantics, blank = inherit.** Every axis value is
    ///   validated and canonicalised by
    ///   `regional::validate_regional_axis_value` at this core boundary —
    ///   the design's "validation lives in core, not React" rule — then
    ///   written through one transaction (the repository-level convention:
    ///   all writes run inside a transaction). Blank clears the column so
    ///   the chain falls through to the next scope.
    /// - The read-back is the same connection's view, so the caller sees
    ///   exactly what committed, including the entity/org layers the write
    ///   did not touch.
    ///
    /// Returns `CoreError::NotFound` when the location does not exist (an
    /// unknown location has no honest answer) and `CoreError::Validation`
    /// for any axis that fails the ADR #48 contract (timezone: the three
    /// Indonesian IANA presets or the legacy `UTC` sentinel; currency:
    /// ISO-4217 alpha-3, uppercased; locale: BCP-47 shape; country:
    /// ISO-3166 alpha-2, uppercased).
    pub fn update_regional_config_for_location(
        &self,
        location_id: &str,
        locale: &str,
        timezone: &str,
        currency: &str,
        country_code: &str,
    ) -> Result<crate::regional::RegionalConfig, CoreError> {
        let locale = crate::regional::validate_regional_axis_value("locale", locale)?;
        let timezone = crate::regional::validate_regional_axis_value("timezone", timezone)?;
        let currency = crate::regional::validate_regional_axis_value("currency", currency)?;
        let country_code = crate::regional::validate_regional_axis_value("country", country_code)?;
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let tx = self.conn.unchecked_transaction()?;
        let updated = tx.execute(
            "UPDATE locations
             SET locale = ?1, timezone = ?2, currency = ?3, updated_at = ?4
             WHERE id = ?5",
            params![locale, timezone, currency, now, location_id],
        )?;
        if updated == 0 {
            return Err(CoreError::NotFound {
                entity: "location",
                id: location_id.to_owned(),
            });
        }
        if !country_code.is_empty() {
            // The country anchor lives on the legal entity (the only layer
            // that carries it today); the location layer has no column for
            // it, so a location write that sets one propagates it to the
            // linked entity — untouched rows and NULL links stay untouched.
            let linked: Option<String> = tx
                .query_row(
                    "SELECT legal_entity_id FROM locations WHERE id = ?1",
                    params![location_id],
                    |row| row.get(0),
                )
                .map_err(|err| match err {
                    rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                        entity: "location",
                        id: location_id.to_owned(),
                    },
                    other => CoreError::Db(other),
                })?;
            if let Some(entity_id) = linked {
                // Tenant-filtered, mirroring the read walk's fail-closed
                // posture: the entity id is read from this location's row on
                // this connection, and the UPDATE re-checks the location's
                // tenant_id so a cross-tenant id cannot be written to.
                let n = tx.execute(
                    "UPDATE legal_entities
                     SET country_code = ?1, updated_at = ?2
                     WHERE id = ?3
                       AND tenant_id = (SELECT tenant_id FROM locations WHERE id = ?4)",
                    params![country_code, now, entity_id, location_id],
                )?;
                debug_assert!(n <= 1);
            }
        }
        tx.commit()?;
        self.regional_config_for_location(location_id)
    }
}

#[cfg(test)]
#[path = "regional_tests.rs"]
mod tests;
