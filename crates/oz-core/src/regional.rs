//! Regional configuration — the market facts a Location trades under, and the
//! scope chain that resolves them.
//!
//! Slice 1 of the Phase 2 "Implement regional configuration" item; the design
//! and the axis-by-axis scope map live in todo-global-saas-2.md
//! ("Regional configuration — design"). This slice covers the three axes that
//! already have a storage home — locale, timezone, currency. Fiscalization,
//! numbering, receipt format and local payment settings join the same chain in
//! later slices; tax regime is deliberately absent (the adjacent "separate
//! business tax configuration from application defaults" item owns it).
//!
//! # Resolution order
//!
//! RegionalConfig::resolve walks narrowest-first — Location → Legal Entity →
//! Organization → built-in default — and takes the first value that is not
//! blank. Blank ("" after trimming) means "not set at this scope", the same
//! convention legal_entities.legal_name already uses in the schema, so no NULL
//! sentinel is invented. An unset chain bottoms out at DEFAULT_LOCALE /
//! DEFAULT_TIMEZONE / DEFAULT_CURRENCY, which are the values the pre-regional
//! schema hard-coded into its column defaults — so a tenant that configures
//! nothing resolves to exactly what it means today.
//!
//! Every axis carries its own ConfigScope provenance rather than the config
//! carrying one scope: a location may override the currency while inheriting
//! the locale, and "which level answered" is the thing a settings screen and
//! the diagnostics surface both need.
//!
//! # What this module does NOT resolve
//!
//! locations.currency and locations.timezone are NOT NULL with hard column
//! defaults, so a location row always carries a value and the entity and
//! organization levels can never win for those two axes. That is the
//! "inherit is unrepresentable" defect the design records; it needs a table
//! rebuild, not a resolver change, and it is why this slice is read-only.

use serde::{Deserialize, Serialize};

/// Built-in locale used when no scope in the chain sets one. Matches the
/// pre-regional behaviour, where the UI negotiated purely from the browser.
pub const DEFAULT_LOCALE: &str = "en-US";
/// Built-in timezone used when no scope sets one. Matches the
/// locations.timezone column default.
pub const DEFAULT_TIMEZONE: &str = "UTC";
/// The three Indonesian IANA timezones the slice-4 regional editor offers
/// (ADR #48, Decision 2). Indonesia spans exactly these zones and observes no
/// DST, so this is the complete, closed set the editor presents - a native
/// dropdown of three options, no free-text entry, no search box.
pub const LOCATION_TIMEZONES: &[&str] = &["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"];
/// Whether tz is one of the three preset Indonesian location timezones.
///
/// This is the authoritative enumerable set the slice-4 editor validates
/// against at the regional write boundary. The UTC column default is *not* a
/// preset: it is the legacy unset sentinel for un-migrated rows and is accepted
/// separately by the write path, so an unrelated field edit can still save on a
/// location that has not yet had its timezone set.
#[must_use]
pub fn is_preset_location_timezone(tz: &str) -> bool {
    LOCATION_TIMEZONES.contains(&tz)
}
/// Built-in ISO-4217 currency code used when no scope sets one. Matches the
/// locations.currency column default.
pub const DEFAULT_CURRENCY: &str = "USD";

/// The hierarchy level that supplied a resolved regional value.
///
/// Ordered narrowest-first; BuiltIn means no scope carried a value and the
/// resolver fell back to the documented default. Serialized as snake_case so
/// the IPC DTOs of later slices reuse these names verbatim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigScope {
    /// The location's own row.
    Location,
    /// The legal entity that owns the location.
    LegalEntity,
    /// Organization-wide defaults (the settings key-value table).
    Organization,
    /// Nothing was configured; the built-in default applies.
    BuiltIn,
}

impl ConfigScope {
    /// Stable wire name, mirroring the serde representation.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Location => "location",
            Self::LegalEntity => "legal_entity",
            Self::Organization => "organization",
            Self::BuiltIn => "built_in",
        }
    }
}

/// One resolved regional axis: the effective value and who answered for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegionalValue {
    /// The effective value.
    pub value: String,
    /// The scope that supplied [`Self::value`].
    pub scope: ConfigScope,
}

impl RegionalValue {
    /// Wrap a value with its provenance.
    pub fn new(value: impl Into<String>, scope: ConfigScope) -> Self {
        Self {
            value: value.into(),
            scope,
        }
    }
}

/// One level of the inheritance chain, as stored at that scope.
///
/// None and blank both mean "not set here" — [`RegionalLayer::blank`] is the
/// constructor that applies the schema's blank-means-inherit convention, so
/// callers never have to decide whether "   " counts as a value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegionalLayer {
    /// Which scope this layer came from.
    pub scope: ConfigScope,
    /// BCP-47 language tag, if set here.
    pub locale: Option<String>,
    /// Timezone (a fixed UTC offset or an IANA name — see
    /// [`RegionalConfig::timezone`] for the contract question), if set here.
    pub timezone: Option<String>,
    /// ISO-4217 currency code, if set here.
    pub currency: Option<String>,
    /// ISO-3166 alpha-2 market code, if set here. Only the legal-entity layer
    /// populates this today; keeping it per-layer means a later location-level
    /// market override needs no new type.
    pub country_code: Option<String>,
}

impl RegionalLayer {
    /// A layer read straight from NOT NULL / DEFAULT '' schema columns, where
    /// blank means "inherit".
    pub fn blank(
        scope: ConfigScope,
        locale: &str,
        timezone: &str,
        currency: &str,
        country_code: &str,
    ) -> Self {
        Self {
            scope,
            locale: blank_to_none(locale),
            timezone: blank_to_none(timezone),
            currency: blank_to_none(currency),
            country_code: blank_to_none(country_code),
        }
    }

    /// A layer for the organization scope, whose values come from the settings
    /// key-value table and are therefore already optional.
    pub fn organization(locale: Option<String>, currency: Option<String>) -> Self {
        Self {
            scope: ConfigScope::Organization,
            locale: locale.and_then(|v| blank_to_none(&v)),
            timezone: None,
            currency: currency.and_then(|v| blank_to_none(&v)),
            country_code: None,
        }
    }
}

/// Trim and map blank to None — the single place the "blank means inherit"
/// convention is applied.
fn blank_to_none(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
    }
}

/// The effective regional configuration for one location.
///
/// Built by [`RegionalConfig::resolve`] (pure) or
/// [`crate::Store::regional_config_for_location`] (against the database).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegionalConfig {
    /// The location this was resolved for.
    pub location_id: String,
    /// The legal entity owning the location, when the link is populated.
    pub legal_entity_id: Option<String>,
    /// ISO-3166 alpha-2 market code, or None when no entity declares one.
    ///
    /// Optional by design: unlike locale/timezone/currency there is no
    /// defensible built-in market, and guessing one would silently apply a
    /// country's fiscal expectations to a tenant that never chose it.
    pub country_code: Option<String>,
    /// Effective BCP-47 locale with its provenance.
    pub locale: RegionalValue,
    /// Effective timezone with its provenance.
    ///
    /// The value is whatever the winning scope stored. The reporting contract
    /// (db/reports.rs, REP-03) is a fixed UTC offset — +HH:MM / -HH:MM / UTC —
    /// and IANA names fall back to UTC there, while
    /// LocationProfile::timezone documents IANA names. The resolver reports the
    /// stored string rather than picking a side; the design records the
    /// contradiction as needing a ruling.
    pub timezone: RegionalValue,
    /// Effective ISO-4217 currency code with its provenance.
    pub currency: RegionalValue,
}

impl RegionalConfig {
    /// Resolve the chain, narrowest layer first.
    ///
    /// Each axis independently takes the first non-blank value it finds, so
    /// mixed provenance (location currency, entity locale) is the normal case,
    /// not an edge case. location_id and legal_entity_id are supplied by the
    /// caller because they are identity, not configuration — reading them is
    /// the repository's job.
    ///
    /// # Panics
    ///
    /// If layers is empty. That would silently produce a defaults-only config
    /// and is a programming error, not a data state.
    pub fn resolve(
        location_id: impl Into<String>,
        legal_entity_id: Option<String>,
        layers: &[RegionalLayer],
    ) -> Self {
        assert!(
            !layers.is_empty(),
            "regional resolution needs at least one layer"
        );
        let country_code = layers.iter().find_map(|layer| layer.country_code.clone());
        Self {
            location_id: location_id.into(),
            legal_entity_id: legal_entity_id.and_then(|id| blank_to_none(&id)),
            country_code,
            locale: pick(layers, |layer| layer.locale.clone(), DEFAULT_LOCALE),
            timezone: pick(layers, |layer| layer.timezone.clone(), DEFAULT_TIMEZONE),
            currency: pick(layers, |layer| layer.currency.clone(), DEFAULT_CURRENCY),
        }
    }

    /// The primary language subtag of the effective locale ("en-US" → "en"),
    /// lowercased.
    ///
    /// Language is a projection of locale, not a second stored fact: the item
    /// names both axes, and giving each its own column is how they drift apart.
    /// A locale with no "-" returns the whole tag, which is already a language.
    pub fn language(&self) -> String {
        self.locale
            .value
            .split('-')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase()
    }

    /// Whether every axis answered from the built-in defaults, i.e. nothing in
    /// this tenant's hierarchy has been configured regionally yet.
    pub fn is_unconfigured(&self) -> bool {
        self.locale.scope == ConfigScope::BuiltIn
            && self.timezone.scope == ConfigScope::BuiltIn
            && self.currency.scope == ConfigScope::BuiltIn
            && self.country_code.is_none()
    }
}

/// First non-blank axis value across the chain, with the scope that answered.
///
/// The blank check is repeated here rather than trusted from the layer
/// constructors: `RegionalLayer`'s fields are public, so a caller that builds
/// one directly (the tests do, and so will the IPC mapping in Slice 2) can put
/// `Some("   ")` in a field. "Blank means inherit" is the contract of the
/// whole chain, not of one constructor.
fn pick(
    layers: &[RegionalLayer],
    get: fn(&RegionalLayer) -> Option<String>,
    default: &str,
) -> RegionalValue {
    for layer in layers {
        if let Some(value) = get(layer).and_then(|v| blank_to_none(&v)) {
            return RegionalValue::new(value, layer.scope);
        }
    }
    RegionalValue::new(default, ConfigScope::BuiltIn)
}

#[cfg(test)]
#[path = "regional_tests.rs"]
mod tests;
