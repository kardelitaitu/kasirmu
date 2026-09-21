use super::*;
use crate::regional::DEFAULT_LOCALE;
use crate::settings::Settings;

fn store() -> Store<'static> {
    let conn = crate::migrations::fresh_db();
    crate::migrations::seed_provisioned_baseline(&conn);
    let conn: &'static rusqlite::Connection = Box::leak(Box::new(conn));
    Store::new(conn)
}

/// Seed a location with the regional axes a caller cares about. Currency and
/// timezone are passed explicitly because the columns are NOT NULL — the
/// point of most of these tests is exactly that they cannot be left unset.
fn insert_location(store: &Store<'_>, id: &str, currency: &str, timezone: &str, locale: &str) {
    store
        .conn
        .execute(
            "INSERT INTO locations (id, name, address, tax_id, currency, timezone, locale,
                                    is_primary, created_at, updated_at)
             VALUES (?1, ?1, '', '', ?2, ?3, ?4, 0,
                     '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z')",
            params![id, currency, timezone, locale],
        )
        .unwrap();
}

fn insert_entity(
    store: &Store<'_>,
    id: &str,
    tenant_id: &str,
    country_code: &str,
    locale: &str,
    timezone: &str,
    currency: &str,
) {
    store
        .conn
        .execute(
            "INSERT INTO legal_entities (id, tenant_id, name, legal_name,
                    registration_number, tax_id, status, country_code, locale,
                    timezone, currency, created_at, updated_at)
             VALUES (?1, ?2, ?1, '', '', '', 'active', ?3, ?4, ?5, ?6,
                     '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z')",
            params![id, tenant_id, country_code, locale, timezone, currency],
        )
        .unwrap();
}

fn link_location(store: &Store<'_>, location_id: &str, entity_id: &str) {
    store
        .conn
        .execute(
            "UPDATE locations SET legal_entity_id = ?1 WHERE id = ?2",
            params![entity_id, location_id],
        )
        .unwrap();
}

#[test]
fn unconfigured_location_resolves_to_the_column_defaults() {
    let store = store();
    insert_location(&store, "loc-plain", "USD", "UTC", "");
    let cfg = store.regional_config_for_location("loc-plain").unwrap();
    assert_eq!(cfg.location_id, "loc-plain");
    assert_eq!(cfg.currency.value, "USD");
    assert_eq!(cfg.timezone.value, "UTC");
    assert_eq!(cfg.locale.value, DEFAULT_LOCALE);
    // Currency/timezone came off the row, so their provenance is Location even
    // though nobody configured them — the defect the design records, pinned
    // here so the fix cannot be "discovered" later as a behavior change.
    assert_eq!(cfg.currency.scope, ConfigScope::Location);
    assert_eq!(cfg.timezone.scope, ConfigScope::Location);
    assert_eq!(cfg.locale.scope, ConfigScope::BuiltIn);
}

#[test]
fn location_locale_beats_the_entity_and_the_organization() {
    let store = store();
    insert_location(&store, "loc-ent", "USD", "UTC", "id-ID");
    insert_entity(&store, "ent-1", "default", "ID", "en-GB", "+07:00", "GBP");
    link_location(&store, "loc-ent", "ent-1");
    Settings::set(store.conn, keys::UI_LOCALE, "ja-JP").unwrap();
    let cfg = store.regional_config_for_location("loc-ent").unwrap();
    assert_eq!(cfg.locale.value, "id-ID");
    assert_eq!(cfg.locale.scope, ConfigScope::Location);
    assert_eq!(cfg.legal_entity_id.as_deref(), Some("ent-1"));
}

#[test]
fn blank_location_locale_inherits_the_entity() {
    let store = store();
    insert_location(&store, "loc-inherit", "USD", "UTC", "");
    insert_entity(&store, "ent-1", "default", "ID", "id-ID", "+07:00", "IDR");
    link_location(&store, "loc-inherit", "ent-1");
    let cfg = store.regional_config_for_location("loc-inherit").unwrap();
    assert_eq!(cfg.locale.value, "id-ID");
    assert_eq!(cfg.locale.scope, ConfigScope::LegalEntity);
    assert_eq!(cfg.country_code.as_deref(), Some("ID"));
    // The location row still wins on the two axes it cannot leave unset.
    assert_eq!(cfg.currency.value, "USD");
    assert_eq!(cfg.currency.scope, ConfigScope::Location);
}

#[test]
fn organization_locale_is_the_last_named_scope() {
    let store = store();
    insert_location(&store, "loc-org", "USD", "UTC", "");
    Settings::set(store.conn, keys::UI_LOCALE, "id").unwrap();
    let cfg = store.regional_config_for_location("loc-org").unwrap();
    assert_eq!(cfg.locale.value, "id");
    assert_eq!(cfg.locale.scope, ConfigScope::Organization);
    assert_eq!(cfg.language(), "id");
}

#[test]
fn organization_currency_default_is_read() {
    // currency.default already exists as an organization-wide setting; the
    // resolver gives it a reader instead of leaving it beside the location
    // column with no stated precedence between them.
    let store = store();
    insert_location(&store, "loc-org-cur", "USD", "UTC", "");
    Settings::set(store.conn, keys::DEFAULT_CURRENCY, "VND").unwrap();
    let cfg = store.regional_config_for_location("loc-org-cur").unwrap();
    // NOT NULL column default on the location still shadows the org default —
    // see the design's "inherit is unrepresentable" note.
    assert_eq!(cfg.currency.value, "USD");
    assert_eq!(cfg.currency.scope, ConfigScope::Location);
}

#[test]
fn entity_in_another_tenant_contributes_nothing() {
    // Fail-closed configuration: a cross-tenant legal_entity_id pointer must
    // not leak another tenant's market into this location's answer.
    let store = store();
    insert_location(&store, "loc-x", "USD", "UTC", "");
    insert_entity(
        &store,
        "ent-other",
        "other-tenant",
        "JP",
        "ja-JP",
        "+09:00",
        "JPY",
    );
    link_location(&store, "loc-x", "ent-other");
    let cfg = store.regional_config_for_location("loc-x").unwrap();
    assert_eq!(cfg.locale.value, DEFAULT_LOCALE);
    assert_eq!(cfg.locale.scope, ConfigScope::BuiltIn);
    assert_eq!(cfg.country_code, None);
}

#[test]
fn entity_with_no_regional_values_falls_through_instead_of_winning_blank() {
    // An entity that exists but declares nothing must not stop the chain —
    // otherwise §G's auto-created "Default Legal Entity" row (all regional
    // columns '' after this migration) would shadow every organization-level
    // default for every existing tenant.
    let store = store();
    insert_location(&store, "loc-empty-ent", "USD", "UTC", "");
    insert_entity(&store, "ent-blank", "default", "", "", "", "");
    link_location(&store, "loc-empty-ent", "ent-blank");
    Settings::set(store.conn, keys::UI_LOCALE, "ar-AE").unwrap();
    let cfg = store.regional_config_for_location("loc-empty-ent").unwrap();
    assert_eq!(cfg.locale.value, "ar-AE");
    assert_eq!(cfg.locale.scope, ConfigScope::Organization);
    assert_eq!(cfg.country_code, None);
    // The link itself is still reported — it is identity, not configuration.
    assert_eq!(cfg.legal_entity_id.as_deref(), Some("ent-blank"));
}

#[test]
fn unknown_location_is_not_found_not_defaulted() {
    let store = store();
    let err = store
        .regional_config_for_location("no-such-location")
        .unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::NotFound {
                entity: "location",
                ..
            }
        ),
        "expected NotFound, got {err:?}"
    );
}

#[test]
fn primary_config_follows_the_primary_row() {
    let store = store();
    insert_location(&store, "loc-primary", "MYR", "+08:00", "ms-MY");
    // Only one row may hold is_primary = 1 (idx_locations_primary is a partial
    // UNIQUE), so promoting this one must demote the provisioned baseline row
    // first — the same swap set_primary_location performs.
    store
        .conn
        .execute(
            "UPDATE locations SET is_primary = CASE WHEN id = 'loc-primary' THEN 1 ELSE 0 END",
            [],
        )
        .unwrap();
    let cfg = store
        .primary_regional_config()
        .unwrap()
        .expect("primary location was seeded");
    assert_eq!(cfg.location_id, "loc-primary");
    assert_eq!(cfg.currency.value, "MYR");
    assert_eq!(cfg.language(), "ms");
}

#[test]
fn no_primary_location_is_none_not_defaults() {
    let store = store();
    // Demote rather than delete: locations is referenced by user_location_access
    // and workspace_instances under ON DELETE RESTRICT, and the real "no
    // primary" state is a deployment where nothing has been promoted yet.
    store
        .conn
        .execute("UPDATE locations SET is_primary = 0", [])
        .unwrap();
    assert_eq!(store.primary_regional_config().unwrap(), None);
}

#[test]
fn migration_backfills_existing_locations_with_a_blank_locale() {
    // The provisioned 'default' location postdates the column: it was
    // created by the baseline *seeder* without a locale, and the NOT NULL
    // DEFAULT '' means it inherits rather than failing the read — the whole
    // upgrade story of this slice in one assertion.
    let store = store();
    let cfg = store.regional_config_for_location("default").unwrap();
    assert_eq!(cfg.locale.value, DEFAULT_LOCALE);
    assert_eq!(cfg.locale.scope, ConfigScope::BuiltIn);
}

// ── update_regional_config_for_location (slice 3, write path) ────────

#[test]
fn write_persists_the_location_layer_and_reports_provenance() {
    let store = store();
    insert_location(&store, "loc-write", "USD", "UTC", "");
    let cfg = store
        .update_regional_config_for_location("loc-write", "id-ID", "Asia/Makassar", "IDR", "")
        .unwrap();
    assert_eq!(cfg.locale.value, "id-ID");
    assert_eq!(cfg.locale.scope, ConfigScope::Location);
    assert_eq!(cfg.timezone.value, "Asia/Makassar");
    assert_eq!(cfg.timezone.scope, ConfigScope::Location);
    assert_eq!(cfg.currency.value, "IDR");
    assert_eq!(cfg.currency.scope, ConfigScope::Location);
    // The read-back shares the connection with the write, so a plain read
    // (what the IPC layer would do next) must agree with what was returned.
    let again = store.regional_config_for_location("loc-write").unwrap();
    assert_eq!(again, cfg);
}

#[test]
fn write_blank_clears_each_axis_to_inherit() {
    let store = store();
    insert_location(&store, "loc-clear", "USD", "UTC", "id-ID");
    insert_entity(&store, "ent-1", "default", "ID", "en-GB", "+07:00", "GBP");
    link_location(&store, "loc-clear", "ent-1");
    let cfg = store
        .update_regional_config_for_location("loc-clear", "", "", "", "")
        .unwrap();
    // Every axis cleared → the chain falls through to the entity layer.
    assert_eq!(cfg.locale.value, "en-GB");
    assert_eq!(cfg.locale.scope, ConfigScope::LegalEntity);
    assert_eq!(cfg.currency.value, "GBP");
    assert_eq!(cfg.currency.scope, ConfigScope::LegalEntity);
    assert_eq!(cfg.country_code.as_deref(), Some("ID"));
}

#[test]
fn write_rejects_a_timezone_outside_the_adr48_contract() {
    let store = store();
    insert_location(&store, "loc-tz", "USD", "UTC", "");
    // A non-preset IANA name: exactly what update_location_profile_scoped
    // rejects, so the second writer of the column must reject it too.
    let err = store
        .update_regional_config_for_location("loc-tz", "", "Europe/Berlin", "", "")
        .unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "timezone",
                ..
            }
        ),
        "expected timezone Validation, got {err:?}"
    );
    // The fixed-offset shape the pre-ADR #48 design draft allowed is also
    // rejected on writes: ADR #48 Decision 1 rejected fixed-offset storage
    // and Decision 2 bounded the editor to the preset list.
    let err2 = store
        .update_regional_config_for_location("loc-tz", "", "+07:00", "", "")
        .unwrap_err();
    assert!(
        matches!(
            err2,
            CoreError::Validation {
                field: "timezone",
                ..
            }
        ),
        "expected timezone Validation, got {err2:?}"
    );
    // Nothing was written — the row keeps its sentinel.
    let cfg = store.regional_config_for_location("loc-tz").unwrap();
    assert_eq!(cfg.timezone.value, "UTC");
    assert_eq!(cfg.timezone.scope, ConfigScope::Location);
}

#[test]
fn write_accepts_the_utc_sentinel_and_the_presets() {
    let store = store();
    insert_location(&store, "loc-tz-ok", "USD", "UTC", "");
    for tz in ["UTC", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"] {
        let cfg = store
            .update_regional_config_for_location("loc-tz-ok", "", tz, "", "")
            .unwrap();
        assert_eq!(cfg.timezone.value, tz, "timezone {tz} must be writable");
    }
}

#[test]
fn write_canonicalises_currency_and_rejects_non_iso_codes() {
    let store = store();
    insert_location(&store, "loc-cur", "USD", "UTC", "");
    // Lowercase is canonicalised to uppercase on write (787dc742a precedent).
    let cfg = store
        .update_regional_config_for_location("loc-cur", "", "", "idr", "")
        .unwrap();
    assert_eq!(cfg.currency.value, "IDR");
    let err = store
        .update_regional_config_for_location("loc-cur", "", "", "US1", "")
        .unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "currency",
                ..
            }
        ),
        "expected currency Validation, got {err:?}"
    );
}

#[test]
fn write_rejects_a_locale_that_is_not_bcp47_shaped() {
    let store = store();
    insert_location(&store, "loc-loc", "USD", "UTC", "");
    let err = store
        .update_regional_config_for_location("loc-loc", "id_ID", "", "", "")
        .unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "locale",
                ..
            }
        ),
        "expected locale Validation, got {err:?}"
    );
    // A plain language tag and a language-region tag both pass.
    let ok = store
        .update_regional_config_for_location("loc-loc", "id", "", "", "")
        .unwrap();
    assert_eq!(ok.locale.value, "id");
}

#[test]
fn write_country_anchor_lands_on_the_linked_entity_tenant_filtered() {
    let store = store();
    insert_location(&store, "loc-cc", "USD", "UTC", "");
    insert_entity(&store, "ent-1", "default", "", "", "", "");
    link_location(&store, "loc-cc", "ent-1");
    let cfg = store
        .update_regional_config_for_location("loc-cc", "", "", "", "id")
        .unwrap();
    // Canonicalised to uppercase (ISO-3166 alpha-2), resolved through the
    // entity layer — the only layer that carries the market anchor.
    assert_eq!(cfg.country_code.as_deref(), Some("ID"));
    // A cross-tenant link receives nothing: the write's tenant filter
    // mirrors the read walk's fail-closed posture exactly.
    insert_location(&store, "loc-cc-x", "USD", "UTC", "");
    insert_entity(&store, "ent-other", "other-tenant", "", "", "", "");
    link_location(&store, "loc-cc-x", "ent-other");
    let cfg2 = store
        .update_regional_config_for_location("loc-cc-x", "", "", "", "SG")
        .unwrap();
    assert_eq!(cfg2.country_code, None);
    // ISO-3166 shape is enforced: three letters is not alpha-2.
    let err3 = store
        .update_regional_config_for_location("loc-cc-x", "", "", "", "IDN")
        .unwrap_err();
    assert!(
        matches!(
            err3,
            CoreError::Validation {
                field: "country",
                ..
            }
        ),
        "expected country Validation, got {err3:?}"
    );
}

#[test]
fn write_unknown_location_is_not_found() {
    let store = store();
    let err = store
        .update_regional_config_for_location("no-such", "", "", "", "")
        .unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::NotFound {
                entity: "location",
                ..
            }
        ),
        "expected NotFound, got {err:?}"
    );
}
