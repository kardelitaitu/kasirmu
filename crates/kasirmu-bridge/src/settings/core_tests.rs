//! Tests for the store-settings builder's thousands-separator passthrough.
//!
//! `currency.thousands_separator` is a stored setting with working accessors in core
//! (`crates/kasirmu-core/src/settings.rs:659`) that the printer has honoured since D6
//! through `ReceiptConfig.grouping` (`kasirmu-hal/src/drivers/receipt.rs:193`). Nothing
//! exposed it to the front end, so the only formatter a customer-facing screen could call
//! (`formatMoney`, grouped by locale) could not agree with the paper.
//!
//! `StoreSettingsDto.thousands_separator` closes that gap. These cases pin the shape of
//! the passthrough -- normalised, and absent rather than empty -- because a DTO field a
//! consumer cannot trust is the same defect with an extra hop.

use super::core::run_get_store_settings;
use crate::testing::temp_conn;
use kasirmu_core::settings::Settings;

fn set_sep(conn: &rusqlite::Connection, value: &str) {
    Settings::set_currency_thousands_separator(conn, value).expect("set separator");
}

#[test]
fn store_settings_reports_the_seeded_default() {
    // NOT a None case, and that was the first draft's error: the setting is
    // SEEDED, not absent on a fresh DB. `crates/kasirmu-core`'s own
    // `currency_thousands_separator_default_is_comma` (tests/integration/settings.rs:787)
    // pins the default to "comma", so the DTO carries Some("comma") for a store
    // nobody ever configured.
    //
    // That matters to a consumer in the opposite direction from the draft it
    // replaces: "comma" is a REAL value here, not a stand-in for unset, so a
    // caller must not treat Some as "the operator chose this".
    let conn = temp_conn();
    let dto = run_get_store_settings(&conn).expect("store settings");
    assert_eq!(dto.thousands_separator.as_deref(), Some("comma"));
}

#[test]
fn store_settings_reports_the_configured_separator_verbatim() {
    let conn = temp_conn();
    set_sep(&conn, "dot");
    let dto = run_get_store_settings(&conn).expect("store settings");
    assert_eq!(dto.thousands_separator.as_deref(), Some("dot"));
}

#[test]
fn store_settings_normalises_case_and_surrounding_whitespace() {
    // The vocabulary is lowercase by contract, but a hand-edited row or an older
    // writer could leave " Dot ". A consumer should not have to normalise.
    let conn = temp_conn();
    set_sep(&conn, "  DOT ");
    let dto = run_get_store_settings(&conn).expect("store settings");
    assert_eq!(
        dto.thousands_separator.as_deref(),
        Some("dot"),
        "the DTO must hand the consumer a value it can match against the vocabulary"
    );
}

#[test]
fn store_settings_treats_an_empty_string_as_unset() {
    // The bridge's own grouping resolution filters an empty value before parsing
    // (hardware.rs:431), so "" means "not configured" throughout this codebase.
    let conn = temp_conn();
    set_sep(&conn, "");
    let dto = run_get_store_settings(&conn).expect("store settings");
    assert_eq!(dto.thousands_separator, None);
}
