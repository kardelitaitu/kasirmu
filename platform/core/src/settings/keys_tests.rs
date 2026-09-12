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
/// One fold, shared. `raw::is_manager_owned_key` calls THIS function rather
/// than writing a second normalisation, so the credential arm and the
/// lifecycle-manager prefix arm of the ingest boolean cannot answer a near-miss
/// spelling differently. Pinned on the helper itself — trim, then ASCII case
/// fold — because the prefix rule is folded only while this stays the single
/// definition of it.
#[test]
fn the_shared_fold_is_trim_then_ascii_case_fold() {
    assert_eq!(normalised_candidate("  STRIPE.API_KEY  "), "stripe.api_key");
    assert_eq!(
        normalised_candidate("\tLan_Server.Bind\n"),
        "lan_server.bind"
    );
    assert_eq!(normalised_candidate("store.name"), "store.name");
}

/// The correction to the comment that used to sit on `normalised_candidate`:
/// it claimed an ASCII-only rule, but the trim half is `str::trim`, which is
/// Unicode `White_Space`-aware — so U+00A0 (NO-BREAK SPACE) and U+2028 (LINE
/// SEPARATOR) around a candidate DO strip, even though SQLite's BINARY
/// collation treats them as ordinary key bytes. Asserted in both directions
/// because that asymmetry is exactly what makes it harmless: the over-strip can
/// only widen a REFUSAL (a padded credential folds onto a lowercase ASCII
/// marker), never widen an admission (an ordinary key that loses Unicode
/// padding matches no marker either way).
#[test]
fn the_trim_half_of_the_fold_is_unicode_whitespace_aware() {
    const NBSP: char = '\u{00A0}';
    const LINE_SEP: char = '\u{2028}';
    for (name, pad) in [("U+00A0", NBSP), ("U+2028", LINE_SEP)] {
        let credential = format!("{pad}{STRIPE_API_KEY}{pad}");
        assert!(
            is_secret_setting_key(&credential),
            "{name} around a credential still folds to the deny-listed spelling"
        );
        assert!(
            is_non_exportable_setting_key(&credential),
            "{name} around a credential must not make it exportable"
        );
        let device = format!("{pad}{MACHINE_ID}");
        assert!(
            is_non_exportable_setting_key(&device),
            "{name} around a device key must not make it exportable"
        );
        let ordinary = format!("{pad}{STORE_NAME}");
        assert!(
            !is_secret_setting_key(&ordinary) && !is_non_exportable_setting_key(&ordinary),
            "{name} around an ordinary key must not turn it into a refusal"
        );
    }
    // The prefix arm reuses this fold, so it over-strips the same way — again
    // in the refusing direction only.
    let manager = format!("{NBSP}LAN_SERVER.BIND");
    assert!(
        crate::settings::is_manager_owned_key(&manager),
        "a NBSP-wrapped manager key folds through the same helper and refuses"
    );
}

// ── credential_base: the identity contract (contract-first) ────

/// The comparison `credential_base` replaced, written out here on purpose:
/// parity is pinned against the OLD expression, not against a re-statement of
/// the new one — a helper that calls the function under test cannot catch the
/// function under test moving.
fn legacy_whole_key_equality(key: &str) -> bool {
    SECRET_KEY_DENY_LIST.contains(&normalised_candidate(key).as_str())
}

/// The suffix spellings a real install can hold. `{base}:{tenant}` is what
/// `scoped_setting_key` in `crates/oz-api/src/pg.rs` emits, so a desktop
/// install with the loopback API can copy its own bare SMTP secret into the
/// store-suffixed row through the keep-on-blank merge.
fn suffixed_variants(marker: &str) -> Vec<String> {
    vec![
        format!("{marker}:tenant-a"),
        format!("{marker}:0"),
        format!("{marker}.extra"),
    ]
}

/// Parity pin: `credential_base` answers for exactly the names the whole-key
/// equality used to answer for — and reports the CANONICAL list entry rather
/// than the spelling handed in, which is the whole point of an identity
/// function. Walks the deny list, so it carries its own floor: a shrunken or
/// emptied list would make both sides agree vacuously.
#[test]
fn credential_base_resolves_the_same_names_the_whole_key_equality_matched() {
    assert!(
        SECRET_KEY_DENY_LIST.len() >= 10,
        "deny list has {} entries; a parity sweep over a near-empty list proves nothing",
        SECRET_KEY_DENY_LIST.len()
    );

    for marker in SECRET_KEY_DENY_LIST {
        assert_eq!(
            credential_base(marker),
            Some(*marker),
            "identity must resolve the declared spelling of {marker}"
        );
        // Fold spellings: the trim + ASCII-case fold already admitted these and
        // must keep admitting them, resolving to the SAME canonical entry.
        for variant in near_miss_variants(marker) {
            assert_eq!(
                credential_base(&variant).is_some(),
                legacy_whole_key_equality(&variant),
                "verdict moved for near-miss spelling {variant:?} of {marker}"
            );
            assert_eq!(
                credential_base(&variant),
                Some(*marker),
                "near-miss {variant:?} must resolve to the base, not to itself"
            );
        }
    }

    // The None side: names that denote no credential. `sync.terminal_id` is on
    // the DEVICE list, not the credential list, so its None here is what keeps
    // identity from quietly absorbing the export-only half of the rule.
    for other in [
        "",
        "store.name",
        "smtp",
        "smtp_config_",
        "x_smtp_config",
        SYNC_TERMINAL_ID,
        "local_api",
    ] {
        assert_eq!(
            credential_base(other),
            None,
            "{other:?} denotes no credential and must not resolve"
        );
        assert_eq!(
            credential_base(other).is_some(),
            legacy_whole_key_equality(other),
            "None-side verdict moved for {other:?}"
        );
    }
}

/// KNOWN BLIND SPOT, pinned deliberately and by name. The suffix-blind
/// identity resolution does not recognise the `{base}:{tenant}` spelling of a
/// credential, so today a suffixed row is refused by NOTHING: not on read, not
/// on the portable-package egress path, not on replication — asserted below
/// through the two predicates that carry those verdicts, not merely claimed.
///
/// This test is INVERTED when the suffix arm lands, never deleted: flip every
/// `is_none`/`is_false` to `Some(base)`/`true`. A test that silently passes
/// after the flip is worse than no test at all, because it would erase the
/// only executable record that the blind spot was a decision and not an
/// oversight.
#[test]
fn decision_pin_credential_base_is_suffix_blind() {
    assert!(
        SECRET_KEY_DENY_LIST.len() >= 10,
        "deny list has {} entries; this pin is meaningless without rows to suffix",
        SECRET_KEY_DENY_LIST.len()
    );

    for marker in SECRET_KEY_DENY_LIST {
        for suffixed in suffixed_variants(marker) {
            assert_eq!(
                credential_base(&suffixed),
                None,
                "suffix-blind today: {suffixed:?} must NOT resolve — if this now \
                    returns Some, the suffix arm landed and this test must be \
                    INVERTED, not deleted"
            );
            // The same verdict the read surface reaches for today: the row is
            // not refused on read and not withheld from a portable package.
            assert!(
                !is_secret_setting_key(&suffixed),
                "read gate widened for {suffixed:?}"
            );
            assert!(
                !is_non_exportable_setting_key(&suffixed),
                "egress gate widened for {suffixed:?}"
            );
        }
    }
}
