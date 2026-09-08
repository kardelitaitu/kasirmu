use super::*;

fn layer(
    scope: ConfigScope,
    locale: Option<&str>,
    timezone: Option<&str>,
    currency: Option<&str>,
    country: Option<&str>,
) -> RegionalLayer {
    RegionalLayer {
        scope,
        locale: locale.map(str::to_owned),
        timezone: timezone.map(str::to_owned),
        currency: currency.map(str::to_owned),
        country_code: country.map(str::to_owned),
    }
}

#[test]
fn empty_chain_returns_the_documented_defaults() {
    // The defaults are the pre-regional column defaults, so a tenant that
    // configures nothing resolves to what it means today — the slice cannot
    // change an existing store's numbers by existing.
    let cfg = RegionalConfig::resolve(
        "loc-1",
        None,
        &[layer(ConfigScope::Location, None, None, None, None)],
    );
    assert_eq!(cfg.locale.value, DEFAULT_LOCALE);
    assert_eq!(cfg.timezone.value, DEFAULT_TIMEZONE);
    assert_eq!(cfg.currency.value, DEFAULT_CURRENCY);
    assert_eq!(cfg.locale.scope, ConfigScope::BuiltIn);
    assert_eq!(cfg.currency.scope, ConfigScope::BuiltIn);
    assert!(cfg.is_unconfigured());
}

#[test]
fn narrowest_layer_wins_per_axis() {
    let cfg = RegionalConfig::resolve(
        "loc-1",
        Some("ent-1".into()),
        &[
            layer(
                ConfigScope::Location,
                Some("id-ID"),
                Some("+07:00"),
                Some("IDR"),
                None,
            ),
            layer(
                ConfigScope::LegalEntity,
                Some("en-GB"),
                Some("UTC"),
                Some("GBP"),
                Some("GB"),
            ),
            layer(
                ConfigScope::Organization,
                Some("ja-JP"),
                None,
                Some("JPY"),
                None,
            ),
        ],
    );
    assert_eq!(cfg.locale.value, "id-ID");
    assert_eq!(cfg.timezone.value, "+07:00");
    assert_eq!(cfg.currency.value, "IDR");
    assert_eq!(cfg.locale.scope, ConfigScope::Location);
    assert_eq!(cfg.legal_entity_id.as_deref(), Some("ent-1"));
}

#[test]
fn provenance_is_per_axis_not_per_config() {
    // A location that overrides only the currency still inherits the locale
    // from the entity. One scope field on RegionalConfig could not express
    // this, which is why each axis carries its own.
    let cfg = RegionalConfig::resolve(
        "loc-1",
        Some("ent-1".into()),
        &[
            layer(ConfigScope::Location, None, None, Some("SGD"), None),
            layer(
                ConfigScope::LegalEntity,
                Some("en-SG"),
                Some("+08:00"),
                Some("SGD"),
                Some("SG"),
            ),
        ],
    );
    assert_eq!(cfg.currency.scope, ConfigScope::Location);
    assert_eq!(cfg.locale.scope, ConfigScope::LegalEntity);
    assert_eq!(cfg.timezone.scope, ConfigScope::LegalEntity);
    assert_eq!(cfg.locale.value, "en-SG");
    assert!(!cfg.is_unconfigured());
}

#[test]
fn blank_values_inherit_rather_than_win() {
    // The schema stores "not set" as '' on NOT NULL columns. A whitespace-only
    // value must not become the effective locale.
    let cfg = RegionalConfig::resolve(
        "loc-1",
        None,
        &[
            layer(ConfigScope::Location, Some("   "), Some(""), None, None),
            layer(ConfigScope::LegalEntity, Some("id-ID"), None, None, None),
        ],
    );
    assert_eq!(cfg.locale.value, "id-ID");
    assert_eq!(cfg.locale.scope, ConfigScope::LegalEntity);
    assert_eq!(cfg.timezone.value, DEFAULT_TIMEZONE);
    assert_eq!(cfg.timezone.scope, ConfigScope::BuiltIn);
}

#[test]
fn blank_constructor_trims_the_value_it_keeps() {
    let l = RegionalLayer::blank(ConfigScope::Location, " id-ID ", "", "SGD", "  ");
    assert_eq!(l.locale.as_deref(), Some("id-ID"));
    assert_eq!(l.timezone, None);
    assert_eq!(l.currency.as_deref(), Some("SGD"));
    assert_eq!(l.country_code, None);
}

#[test]
fn organization_layer_drops_blank_optionals() {
    // Some("") from the settings table is "row exists, value empty" — it must
    // not shadow the built-in default.
    let l = RegionalLayer::organization(Some(String::new()), Some("VND".into()));
    assert_eq!(l.locale, None);
    assert_eq!(l.currency.as_deref(), Some("VND"));
    assert_eq!(l.scope, ConfigScope::Organization);
    // The organization level has no timezone key today; inventing one here
    // would silently claim a scope that no writer populates.
    assert_eq!(l.timezone, None);
}

#[test]
fn country_code_is_the_first_layer_that_declares_a_market() {
    let cfg = RegionalConfig::resolve(
        "loc-1",
        None,
        &[
            layer(ConfigScope::Location, None, None, None, None),
            layer(ConfigScope::LegalEntity, None, None, None, Some("ID")),
        ],
    );
    assert_eq!(cfg.country_code.as_deref(), Some("ID"));
}

#[test]
fn absent_market_stays_absent() {
    // No built-in market: guessing one would apply a country's fiscal
    // expectations to a tenant that never chose it.
    let cfg = RegionalConfig::resolve(
        "loc-1",
        None,
        &[layer(ConfigScope::Location, None, None, None, None)],
    );
    assert_eq!(cfg.country_code, None);
}

#[test]
fn language_is_a_projection_of_locale() {
    let mut cfg = RegionalConfig::resolve(
        "loc-1",
        None,
        &[layer(
            ConfigScope::Location,
            Some("id-ID"),
            None,
            None,
            None,
        )],
    );
    assert_eq!(cfg.language(), "id");
    cfg.locale = RegionalValue::new("EN-us", ConfigScope::Location);
    assert_eq!(cfg.language(), "en");
    // A bare language tag has no subtag to split; the whole value is the
    // language, and the accessor must not return empty for it.
    cfg.locale = RegionalValue::new("id", ConfigScope::Location);
    assert_eq!(cfg.language(), "id");
}

#[test]
fn blank_legal_entity_id_is_not_an_entity_link() {
    // legal_entity_id is nullable in the schema, but a blank string from an
    // older writer must not surface as Some("") to an authorization check.
    let cfg = RegionalConfig::resolve(
        "loc-1",
        Some("".into()),
        &[layer(ConfigScope::Location, None, None, None, None)],
    );
    assert_eq!(cfg.legal_entity_id, None);
}

#[test]
#[should_panic(expected = "regional resolution needs at least one layer")]
fn empty_layer_list_is_a_programming_error() {
    RegionalConfig::resolve("loc-1", None, &[]);
}

#[test]
fn scope_wire_names_are_stable() {
    // Slice 2 puts these on the wire; a rename there is a breaking change, so
    // the spelling is pinned here first.
    assert_eq!(ConfigScope::Location.as_str(), "location");
    assert_eq!(ConfigScope::LegalEntity.as_str(), "legal_entity");
    assert_eq!(ConfigScope::Organization.as_str(), "organization");
    assert_eq!(ConfigScope::BuiltIn.as_str(), "built_in");
    assert_eq!(
        serde_json::to_string(&ConfigScope::LegalEntity).unwrap(),
        "\"legal_entity\""
    );
}
