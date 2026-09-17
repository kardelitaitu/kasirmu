//! Regional configuration — the market facts a Location trades under, and the
//! scope chain that resolves them.
//!
//! Slice 1 of the Phase 2 "Implement regional configuration" item; the design
//! and the axis-by-axis scope map live in todo-global-saas-2.md
//! ("Regional configuration — design"). This slice covers the three axes that
//! already have a storage home — locale, timezone, currency. Fiscalization,
//! numbering, receipt format and local payment settings join the same chain in
//! later slices; tax regime joins as a DERIVED seam
//! ([`RegionalConfig::tax_regime`]) rather than a stored axis — it composes
//! the entity market anchor with the landed tax resolver's winning row, so
//! the two configurations cannot drift into two stored truths.
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

use crate::db::tax::TaxRateScope;
use crate::tax_rate::{RoundingMode, TaxRate};

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
/// Whether `tag` is a shape-valid BCP-47 locale for the regional write
/// path: a 2–3 letter primary language subtag plus optional `-`-separated
/// alphanumeric subtags (script 4 letters, region 2 letters or 3 digits,
/// variants 5–8 alphanumerics — the shape check accepts any 2–8 so it does
/// not silently reject a valid tag this deployment has never seen). BCP-47
/// is case-insensitive; the value is stored as supplied.
#[must_use]
pub fn is_valid_bcp47_locale(tag: &str) -> bool {
    let mut segments = tag.split('-');
    let language = segments.next().unwrap_or("");
    let lang = language.as_bytes();
    if !(lang.len() == 2 || lang.len() == 3) || !lang.iter().all(|b| b.is_ascii_alphabetic()) {
        return false;
    }
    segments.all(|segment| {
        let n = segment.len();
        (2..=8).contains(&n) && segment.bytes().all(|b| b.is_ascii_alphanumeric())
    })
}

/// Whether `code` is a shape-valid ISO-3166 alpha-2 country code: exactly
/// two ASCII letters. Case-insensitive per the standard; callers
/// canonicalise to uppercase before storing.
#[must_use]
pub fn is_valid_iso3166_alpha2(code: &str) -> bool {
    let b = code.as_bytes();
    b.len() == 2 && b.iter().all(|byte| byte.is_ascii_alphabetic())
}

/// Validate and canonicalise one regional axis value at the write boundary.
///
/// This is the single place the design's "validate at the core boundary, not
/// in the renderer" rule lives: blank means *inherit* and stays blank, everything
/// else must be valid before it may reach a column.
///
/// - `locale`: shape-valid BCP-47 ([`is_valid_bcp47_locale`]).
/// - `timezone`: the ADR #48 contract, identical to
///   `update_location_profile_scoped` — exactly the three Indonesian
///   IANA presets ([`is_preset_location_timezone`]) or the legacy `UTC`
///   column-default sentinel. Free-text IANA names and fixed offsets are
///   rejected here exactly as they are there: Decision 2 bounds the write
///   to the enumerable set so the resolver can never inherit an
///   unparseable string (Decision 1 rejected fixed-offset storage).
/// - `currency`: ISO-4217 alpha-3 via the `Currency` parser — the same
///   validation `create_exchange_rate` applies — canonicalised to
///   uppercase (787dc742a).
/// - `country`: shape-valid ISO-3166 alpha-2 ([`is_valid_iso3166_alpha2`]),
///   canonicalised to uppercase.
///
/// Returns the canonical value to store ("" for inherit). The error message
/// names the axis and the rule; the command layer maps
/// `CoreError::Validation` onto the typed wire error unchanged.
pub fn validate_regional_axis_value(
    axis: &'static str,
    raw: &str,
) -> Result<String, crate::CoreError> {
    let value = raw.trim();
    if value.is_empty() {
        // Blank means "not set, inherit" — the schema's own convention.
        return Ok(String::new());
    }
    let ok = match axis {
        "locale" => is_valid_bcp47_locale(value).then(|| value.to_owned()),
        "timezone" => (is_preset_location_timezone(value) || value.eq_ignore_ascii_case("UTC"))
            .then(|| value.to_owned()),
        "currency" => value.parse::<crate::Currency>().ok().map(|c| c.to_string()),
        "country" => is_valid_iso3166_alpha2(value).then(|| value.to_ascii_uppercase()),
        other => {
            return Err(crate::CoreError::Validation {
                field: axis,
                message: format!("unknown regional axis: {other}"),
            });
        }
    };
    ok.ok_or_else(|| crate::CoreError::Validation {
        field: axis,
        message: format!("{axis} must be valid (blank = inherit); got {value:?}"),
    })
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

    /// Derive the location's tax regime (todo-global-saas-2.md regional
    /// axis, D1 row): the market the location trades under — this config's
    /// entity `country_code` — plus the winning tax-rate row and the tier
    /// that supplied it, with provenance.
    ///
    /// `resolved` triples the read-only outputs of the landed tax
    /// resolver: the winner of
    /// `Store::resolve_tax_rate_for_location`, that row's scope from
    /// `Store::tax_rate_scope`, and the row's statutory rounding directive
    /// from `Store::list_tax_rate_rounding_modes` (`None` = `''`, the
    /// store preference applies). The resolver returns the row alone, and
    /// the tier it won is exactly the provenance a diagnostics surface
    /// needs; pairing them is the caller's one-line job, because
    /// re-deriving the tier inside this method would need a second query
    /// this pure type must not make. `None` means the resolver found no
    /// active rate covering the location at the query date — the regime
    /// still carries the market, with no rate attached.
    ///
    /// Derived, never stored: the regional migration deliberately refused
    /// to share a column with tax, so the two configurations cannot drift.
    pub fn tax_regime(
        &self,
        resolved: Option<(&TaxRate, &TaxRateScope, Option<RoundingMode>)>,
    ) -> TaxRegime {
        let rate = resolved.map(|(rate, scope, rounding)| TaxRegimeRate {
            rate_id: rate.id.clone(),
            rate_name: rate.name.clone(),
            rate_bps: rate.rate_bps,
            rounding,
            scope: match scope {
                TaxRateScope::Location(_) => TaxRegimeScope::Location,
                TaxRateScope::LegalEntity(_) => TaxRegimeScope::LegalEntity,
                TaxRateScope::Global => TaxRegimeScope::Global,
            },
        });
        TaxRegime {
            country_code: self.country_code.clone(),
            rate,
        }
    }
}

/// The derived tax regime for one location: the market it trades under and
/// the tax rate the resolver currently picks, with the provenance of the
/// rate. Composed by [`RegionalConfig::tax_regime`] from the landed
/// regional chain and the landed tax resolver — never stored, so it cannot
/// drift from either source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaxRegime {
    /// ISO-3166 alpha-2 market code the location trades under, from the
    /// legal-entity layer of the regional chain. `None` when no entity
    /// declares a market — the same honesty rule as
    /// [`RegionalConfig::country_code`]: guessing a country would silently
    /// apply its fiscal expectations to a tenant that never chose one.
    pub country_code: Option<String>,
    /// The winning tax rate and where it came from. `None` when no active
    /// rate resolves for the location at the query date.
    pub rate: Option<TaxRegimeRate>,
}

/// The resolver's winning rate, with the provenance a consumer needs to say
/// WHY that rate applies: which tier of the resolver walk supplied it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaxRegimeRate {
    /// The winning rate's id — the reference a consumer re-reads or links to.
    pub rate_id: String,
    /// The winning rate's display name.
    pub rate_name: String,
    /// The winning rate in basis points (825 = 8.25%).
    pub rate_bps: i64,
    /// The statutory rounding directive the winning row carries — `None`
    /// when the row says `''`, i.e. the store preference applies. Read by
    /// the caller through `Store::list_tax_rate_rounding_modes`, the same
    /// column the sale compute path consults, so a provenance surface and
    /// the computation can never disagree about what the row says. E1-7:
    /// the provenance badge consumes this (E1-8).
    pub rounding: Option<RoundingMode>,
    /// Which tier of the resolver walk supplied this row.
    pub scope: TaxRegimeScope,
}

/// Which scope tier of the tax resolver supplied the winning rate.
///
/// Mirrors `db::tax::TaxRateScope` tier-for-tier (Location outranks
/// LegalEntity outranks Global) without embedding it: the db enum is a
/// write-side shape that also names the owning id, while this one is the
/// provenance answer a regime carries. Serialized snake_case like
/// [`ConfigScope`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaxRegimeScope {
    /// The location's own scoped row won.
    Location,
    /// The legal entity's scoped row won.
    LegalEntity,
    /// The tenant-global row won.
    Global,
}

impl TaxRegimeScope {
    /// Stable wire name, mirroring the serde representation.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Location => "location",
            Self::LegalEntity => "legal_entity",
            Self::Global => "global",
        }
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
