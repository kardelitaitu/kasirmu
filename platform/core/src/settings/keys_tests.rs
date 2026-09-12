//! Unit tests for the secret-key predicate family in keys.rs: the trim +
//! ASCII-case-fold normalisation contract, the near-miss spellings it closes,
//! and the boundaries it must not cross (the smtp_config exception stays out
//! of the predicate; ordinary keys stay admitted). Sibling of `keys.rs` per
//! the repo test-layout rule.

use super::*;

/// The near-miss spellings of one marker row that the old exact match
/// admitted: uppercase, whitespace-wrapped (spaces, tab, trailing newline),
/// mixed case, and a padded uppercase compound. The settings table is a TEXT
/// PRIMARY KEY under BINARY collation, so every one of these is a distinct
/// row a case- and whitespace-exact guard let through both directions.
fn near_miss_variants(marker: &str) -> Vec<String> {
    let mixed: String = marker
        .chars()
        .enumerate()
        .map(|(i, c)| {
            if i % 2 == 0 {
                c.to_ascii_uppercase()
            } else {
                c
            }
        })
        .collect();
    vec![
        marker.to_ascii_uppercase(),
        format!("  {marker}  "),
        format!("\t{marker}\n"),
        mixed,
        format!("  {}", marker.to_ascii_uppercase()),
    ]
}

/// Control on the fixture itself: the marker tables must be non-empty or the
/// loops below pass vacuously and prove nothing.
#[test]
fn the_marker_tables_are_non_empty() {
    assert!(!SECRET_KEY_DENY_LIST.is_empty(), "deny list lost its rows");
    assert!(
        !NON_EXPORTABLE_DEVICE_KEYS.is_empty(),
        "device list lost its rows"
    );
}

/// Every deny-list credential row is refused exactly as spelled.
#[test]
fn every_deny_list_marker_is_refused_as_spelled() {
    for marker in SECRET_KEY_DENY_LIST {
        assert!(
            is_secret_setting_key(marker),
            "{marker} must be refused as spelled"
        );
    }
}

/// The hole this normalisation closes: near-miss spellings of every
/// credential row — the distinct rows the exact match admitted on both the
/// write funnel and the raw get_setting read-back — are refused by both
/// predicates.
#[test]
fn near_miss_spellings_of_credential_rows_are_refused() {
    for marker in SECRET_KEY_DENY_LIST {
        for variant in near_miss_variants(marker) {
            assert!(
                is_secret_setting_key(&variant),
                "near-miss {variant:?} of {marker} must be refused"
            );
            assert!(
                is_non_exportable_setting_key(&variant),
                "near-miss {variant:?} of {marker} must never leave the backend"
            );
        }
    }
}

/// The device-bound half of the marker rows refuses near-miss spellings on
/// the egress predicate too — the fold covers the device list, not just the
/// deny list.
#[test]
fn device_keys_refuse_near_miss_spellings_on_egress() {
    for key in NON_EXPORTABLE_DEVICE_KEYS {
        assert!(
            is_non_exportable_setting_key(key),
            "{key} must be non-exportable as spelled"
        );
        for variant in near_miss_variants(key) {
            assert!(
                is_non_exportable_setting_key(&variant),
                "near-miss {variant:?} of device key {key} must be refused"
            );
        }
    }
}

/// The exception cannot be widened by casing: `smtp_config` stays FLAGGED by
/// this predicate in every variant, so no spelling of it slips past the raw
/// get_setting read refusal. The one admission it gets lives beside the
/// tracked-funnel refusal in raw.rs, not here — folding it into this
/// predicate would turn the exception into a read-lane bypass.
#[test]
fn smtp_config_stays_flagged_in_every_variant_so_the_exception_cannot_widen() {
    assert!(
        is_secret_setting_key(SMTP_CONFIG),
        "smtp_config is deny-listed; the exception is the funnel's, not the predicate's"
    );
    for variant in near_miss_variants(SMTP_CONFIG) {
        assert!(
            is_secret_setting_key(&variant),
            "{variant:?} must stay flagged — a predicate-level exception would be a bypass"
        );
    }
}

/// The predicate normalisation must not have broken the one cleartext key
/// the tracked funnel legitimately writes: the canonical `smtp_config` (both
/// shells merge their password JSON before it) is still admitted by the
/// funnel's own exception.
#[test]
fn the_tracked_funnel_still_admits_the_canonical_smtp_exception() {
    assert!(
        crate::settings::Settings::cleartext_credential_refusal(SMTP_CONFIG).is_none(),
        "smtp_config is the one deny-listed key the tracked funnel still writes"
    );
}

/// The refusal-only suite's blind spot, closed: a normalisation bug that
/// refuses EVERYTHING would otherwise pass. Ordinary keys — exact,
/// uppercase, mixed-case, whitespace-padded — stay admitted on both
/// predicates.
#[test]
fn ordinary_keys_are_still_admitted_under_normalisation() {
    let ordinary = [
        STORE_NAME,
        DEFAULT_CURRENCY,
        SYNC_SERVER_URL,
        SYNC_ENABLED,
        UI_LOCALE,
    ];
    for key in ordinary {
        assert!(!is_secret_setting_key(key), "{key} is not a credential");
        assert!(
            !is_non_exportable_setting_key(key),
            "{key} may leave the backend"
        );
    }
    for sloppy in [
        "  STORE.NAME  ",
        "Store.Name",
        "\tstore.name\n",
        "sync_enabled ",
    ] {
        assert!(
            !is_secret_setting_key(sloppy),
            "sloppy ordinary key {sloppy:?} must not become a refusal"
        );
        assert!(
            !is_non_exportable_setting_key(sloppy),
            "sloppy ordinary key {sloppy:?} must still be exportable"
        );
    }
}
