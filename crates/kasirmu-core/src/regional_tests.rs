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

#[test]
fn preset_location_timezones_are_recognized() {
    assert!(is_preset_location_timezone("Asia/Jakarta"));
    assert!(is_preset_location_timezone("Asia/Makassar"));
    assert!(is_preset_location_timezone("Asia/Jayapura"));
}

#[test]
fn non_preset_location_timezones_are_rejected() {
    // UTC is the legacy column default, not a preset.
    assert!(!is_preset_location_timezone("UTC"));
    assert!(!is_preset_location_timezone("Europe/Berlin"));
    assert!(!is_preset_location_timezone(""));
    // IANA names are case-sensitive.
    assert!(!is_preset_location_timezone("asia/jakarta"));
}

// -- tax_regime derivation seam (regional axis, D1 row) ---------------

fn rate(id: &str, name: &str, bps: i64) -> crate::tax_rate::TaxRate {
    crate::tax_rate::TaxRate {
        id: id.into(),
        name: name.into(),
        rate_bps: bps,
        is_default: false,
        is_inclusive: false,
        created_at: "2026-09-26T00:00:00.000Z".into(),
        updated_at: "2026-09-26T00:00:00.000Z".into(),
    }
}

#[test]
fn tax_regime_without_a_resolved_rate_still_carries_the_market() {
    let cfg = RegionalConfig::resolve(
        "loc-1",
        Some("ent-1".into()),
        &[layer(
            ConfigScope::LegalEntity,
            None,
            None,
            None,
            Some("ID"),
        )],
    );
    let regime = cfg.tax_regime(None);
    assert_eq!(
        regime.country_code.as_deref(),
        Some("ID"),
        "the market anchor survives even with no resolvable rate"
    );
    assert!(
        regime.rate.is_none(),
        "no active rate covering the location means no rate, never a guess"
    );
}

#[test]
fn tax_regime_maps_every_resolver_tier_to_its_provenance() {
    let cfg = RegionalConfig::resolve(
        "loc-1",
        Some("ent-1".into()),
        &[layer(
            ConfigScope::LegalEntity,
            None,
            None,
            None,
            Some("ID"),
        )],
    );
    let r = rate("rate-1", "PBJT", 1100);
    use crate::db::tax::TaxRateScope;
    for (scope, expected) in [
        (
            TaxRateScope::Location("loc-1".into()),
            TaxRegimeScope::Location,
        ),
        (
            TaxRateScope::LegalEntity("ent-1".into()),
            TaxRegimeScope::LegalEntity,
        ),
        (TaxRateScope::Global, TaxRegimeScope::Global),
    ] {
        let regime = cfg.tax_regime(Some((&r, &scope, None)));
        let got = regime.rate.expect("a resolved rate must carry one");
        assert_eq!(got.scope, expected);
        assert_eq!(got.rate_id, "rate-1");
        assert_eq!(got.rate_name, "PBJT");
        assert_eq!(got.rate_bps, 1100, "basis points pass through unchanged");
        assert_eq!(regime.country_code.as_deref(), Some("ID"));
    }
}

fn regime_seed(conn: &rusqlite::Connection) {
    conn.execute(
        "INSERT INTO legal_entities (id, tenant_id, name, legal_name, country_code)
         VALUES ('ent-1', 'default', 'Entity One', 'Entity One', 'ID')",
        [],
    )
    .unwrap();
    // A distinct id: fresh_db already seeds the 'default' primary location,
    // so the fixture must not collide with it.
    conn.execute(
        "INSERT INTO locations (id, name, tenant_id, legal_entity_id)
         VALUES ('loc-main', 'Main', 'default', 'ent-1')",
        [],
    )
    .unwrap();
}

fn insert_rate(
    conn: &rusqlite::Connection,
    id: &str,
    entity: Option<&str>,
    location: Option<&str>,
    is_default: bool,
) {
    conn.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, tenant_id, is_active, legal_entity_id, location_id)
         VALUES (?1, ?2, 1100, ?3, 0, 'default', 1, ?4, ?5)",
        rusqlite::params![id, format!("Rate {id}"), is_default as i32, entity, location],
    )
    .unwrap();
}

#[test]
fn tax_regime_carries_the_statutory_rounding_directive() {
    // E1-7: the provenance surface exposes the row's statutory directive so
    // the badge (E1-8) and the compute path agree without a second read.
    let cfg = RegionalConfig::resolve(
        "loc-1",
        Some("ent-1".into()),
        &[layer(
            ConfigScope::LegalEntity,
            None,
            None,
            None,
            Some("ID"),
        )],
    );
    let r = rate("rate-1", "PBJT", 1100);
    use crate::db::tax::TaxRateScope;
    let regime = cfg.tax_regime(Some((
        &r,
        &TaxRateScope::Location("loc-1".into()),
        Some(crate::tax_rate::RoundingMode::Truncate),
    )));
    let got = regime.rate.expect("a resolved rate must carry one");
    assert_eq!(
        got.rounding,
        Some(crate::tax_rate::RoundingMode::Truncate),
        "a statutory directive rides the regime"
    );

    // '' = no directive: the preference applies, nothing statutory to show.
    let plain = cfg.tax_regime(Some((&r, &TaxRateScope::Global, None)));
    assert_eq!(plain.rate.as_ref().unwrap().rounding, None);
}

#[test]
fn tax_regime_derivation_matches_the_landed_resolver_end_to_end() {
    // The whole point of the seam: the regime the pure type derives is the
    // regime the STORE resolver actually answers, tier for tier. Location
    // outranks entity outranks global, exactly as
    // Store::resolve_tax_rate_for_location walks them.
    let conn = crate::migrations::fresh_db();
    regime_seed(&conn);
    insert_rate(&conn, "rate-g", None, None, true);
    insert_rate(&conn, "rate-e", Some("ent-1"), None, false);
    insert_rate(&conn, "rate-l", None, Some("loc-main"), false);
    let store = crate::db::Store::new(&conn);

    let win = |store: &crate::db::Store| {
        let won = store
            .resolve_tax_rate_for_location("loc-main", Some("ent-1"), "2026-09-26")
            .unwrap()
            .expect("a live rate must resolve");
        let scope = store
            .tax_rate_scope(&won.id)
            .unwrap()
            .expect("winner carries a scope");
        RegionalConfig::resolve(
            "default",
            Some("ent-1".into()),
            &[layer(
                ConfigScope::LegalEntity,
                None,
                None,
                None,
                Some("ID"),
            )],
        )
        .tax_regime(Some((&won, &scope, None)))
    };

    let regime = win(&store);
    assert_eq!(
        regime.rate.as_ref().unwrap().rate_id,
        "rate-l",
        "the location-scoped row wins while it is active"
    );
    assert_eq!(
        regime.rate.as_ref().unwrap().scope,
        TaxRegimeScope::Location
    );
    assert_eq!(regime.country_code.as_deref(), Some("ID"));

    // Deactivate the location row: the entity tier takes over.
    conn.execute("UPDATE tax_rates SET is_active = 0 WHERE id = 'rate-l'", [])
        .unwrap();
    let regime = win(&store);
    assert_eq!(regime.rate.as_ref().unwrap().rate_id, "rate-e");
    assert_eq!(
        regime.rate.as_ref().unwrap().scope,
        TaxRegimeScope::LegalEntity
    );

    // Deactivate the entity row too: the tenant-global default answers.
    conn.execute("UPDATE tax_rates SET is_active = 0 WHERE id = 'rate-e'", [])
        .unwrap();
    let regime = win(&store);
    assert_eq!(regime.rate.as_ref().unwrap().rate_id, "rate-g");
    assert_eq!(regime.rate.as_ref().unwrap().scope, TaxRegimeScope::Global);

    // And with nothing active, the market stays and the rate drops out.
    conn.execute("UPDATE tax_rates SET is_active = 0 WHERE id = 'rate-g'", [])
        .unwrap();
    let none = store
        .resolve_tax_rate_for_location("loc-main", Some("ent-1"), "2026-09-26")
        .unwrap();
    assert!(none.is_none());
}
// ── RegionCode: the closed residency vocabulary (ADR #59 §Q2) ──────────

#[test]
fn region_code_round_trips_its_only_member() {
    // `global` is the entire launch set (ADR #59 §Q6), so this pins the
    // vocabulary's one legal value and the fact that it is lowercase on both
    // the stored and the wire form.
    assert_eq!(RegionCode::parse("global").unwrap(), RegionCode::Global);
    assert_eq!(RegionCode::Global.as_str(), "global");
    assert_eq!(RegionCode::Global.to_string(), "global");
    assert_eq!(DEFAULT_REGION, RegionCode::Global);
    assert_eq!(RegionCode::ALL, &[RegionCode::Global]);
}

#[test]
fn region_code_parse_is_case_and_whitespace_insensitive() {
    // One region must not acquire two spellings — the routing bug ADR #59
    // §Q2 option A warns about. Case and stray whitespace are folded, not
    // rejected, because they are the same region.
    for raw in ["global", "GLOBAL", "Global", "  global  "] {
        assert_eq!(RegionCode::parse(raw).unwrap(), RegionCode::Global, "{raw:?}");
    }
}

#[test]
fn region_code_parse_rejects_anything_outside_the_closed_set() {
    // The set is closed: an unvalidated string must never open a second
    // region implicitly. A country code is specifically NOT a region here —
    // that is the market axis, and collapsing the two is what §2.2 forbids.
    for raw in ["", "  ", "eu", "us", "ID", "asia", "global-2"] {
        assert!(RegionCode::parse(raw).is_err(), "{raw:?} must be rejected");
    }
}
