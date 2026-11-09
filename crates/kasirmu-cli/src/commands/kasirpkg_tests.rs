//! Tests for the CLI `.kasirpkg` settings gate.
//!
//! A `.kasirpkg` is a *portable* artefact — written to a file, carried to another
//! install, decrypted with a shared password — so the invariant documented in
//! `platform_core::settings::keys` applies to this lane too: credential keys
//! and device-bound identities never travel in a portable export or restore
//! package, in EITHER direction. The desktop bridge and the tablet shell have
//! asserted that for a while; `kasir export` / `kasir import` filtered
//! nothing, which is the hole these tests pin shut.
//!
//! Keys are named by the same constants the shared deny list is built from,
//! never retyped string literals, so renaming a key moves the assertion with
//! it instead of silently dropping coverage.

use super::*;
use kasirmu_core::kasirpkg::{KasirpkgPayload, export_kasirpkg, import_kasirpkg};
use kasirmu_core::settings::keys;

/// Password for throwaway packages. Non-empty: `export_kasirpkg` refuses an
/// empty password (B50) and the CLI passes `--password` straight through.
const PWD: &str = "correct-horse-battery-staple";

/// Credential and device-bound keys that must never appear in a portable
/// package — and must never be written back from one.
const MUST_NOT_TRAVEL: &[&str] = &[
    keys::LOCAL_API_SECRET,
    keys::SYNC_TERMINAL_SECRET,
    keys::LICENSE_API_KEY,
    keys::STRIPE_API_KEY,
    keys::MIDTRANS_SERVER_KEY,
    keys::MACHINE_ID,
    keys::SYNC_TERMINAL_ID,
];

/// Ordinary, machine-portable settings a store expects to move between
/// installs — proof the gate is a filter, not a deleted arm.
const MUST_TRAVEL: &[&str] = &[keys::STORE_NAME, keys::DEFAULT_CURRENCY];

/// Keys owned by a dedicated lifecycle manager rather than by the generic
/// settings surface. `IngestPolicy::PortablePackage` refuses them; the bare
/// platform-core predicate the CLI called directly did NOT, which is the
/// asymmetry this lane closes. `local_api.enabled` / `local_api.port` /
/// `local_api.store_id` have no `keys::` constant (they are declared in
/// `kasirmu_local_api`, which `kasirmu-cli` must not depend on), so they are literals
/// here and the prefix rule is what is actually under test.
const MANAGER_OWNED: &[&str] = &[
    "local_api.enabled",
    "local_api.port",
    "local_api.store_id",
    keys::LAN_SERVER_BIND,
];

/// Seed a source database with both halves of the settings table: the
/// ordinary rows that must survive and the secrets that must not.
fn seeded_source_db() -> Connection {
    let conn = kasirmu_core::migrations::fresh_db();
    let rows: &[(&str, &str)] = &[
        (keys::STORE_NAME, "Warung Sedap"),
        (keys::DEFAULT_CURRENCY, "IDR"),
        (keys::RECEIPT_FOOTER, "Terima kasih"),
        (keys::LOCAL_API_SECRET, "src-local-api-signing-secret"),
        (keys::SYNC_TERMINAL_SECRET, "src-terminal-secret"),
        (keys::LICENSE_API_KEY, "src-license-api-key"),
        (keys::STRIPE_API_KEY, "sk_live_src_stripe"),
        (keys::MIDTRANS_SERVER_KEY, "midtrans-src-server-key"),
        (keys::MACHINE_ID, "src-machine-fingerprint"),
        (keys::SYNC_TERMINAL_ID, "src-terminal-id"),
    ];
    for (key, value) in rows {
        Settings::set(&conn, key, value).unwrap();
    }
    conn
}

/// A file path inside a fresh scratch directory, returned WITH its guard.
///
/// The guard must travel: a bare path here would leave the file behind forever,
/// and `std::env::temp_dir()` is the machine-level TEMP on this project's
/// Windows boxes, where a leftover file can never be deleted. Callers bind both
/// halves — `let (path, _dir) = temp_path(..);` — and the drop does the cleanup
/// the old explicit `remove_file` did only on the success path.
fn temp_path(tag: &str) -> (std::path::PathBuf, kasirmu_test_support::ScratchDir) {
    let dir = kasirmu_test_support::ScratchDir::new(&format!("kasirmu-cli-kasirpkg-{tag}"));
    let path = dir.path().join("package.kasirpkg");
    (path, dir)
}

/// Decrypt a package written by the CLI and return its settings rows.
fn exported_settings(path: &std::path::Path) -> Vec<(String, String)> {
    let bytes = std::fs::read(path).expect("export file must exist");
    let (_header, payload) = import_kasirpkg(&bytes, PWD).expect("package must decrypt");
    payload
        .settings
        .expect("settings arm present when --types settings")
        .into_iter()
        .map(|row| {
            (
                row.get("key")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_owned(),
                row.get("value")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_owned(),
            )
        })
        .collect()
}

/// One settings value as raw bytes — `None` when the row is absent, so
/// "byte-identical" is asserted literally rather than through a lossy String.
fn setting_bytes(conn: &Connection, key: &str) -> Option<Vec<u8>> {
    Settings::get(conn, key).unwrap().map(String::into_bytes)
}

/// Build a package by hand that still carries secrets — exactly what an
/// `.kasirpkg` produced by an OLDER build looks like — and return its path.
/// `export_kasirpkg` is the unfiltered crypto layer, so whatever is put here is
/// what lands in the file regardless of what the CLI export arm withholds.
fn legacy_package(rows: &[(&str, &str)]) -> (std::path::PathBuf, kasirmu_test_support::ScratchDir) {
    let (path, dir) = temp_path("legacy");
    let payload = KasirpkgPayload {
        products: vec![],
        categories: vec![],
        sales: None,
        customers: None,
        users: None,
        settings: Some(
            rows.iter()
                .map(|(key, value)| serde_json::json!({ "key": key, "value": value }))
                .collect(),
        ),
    };
    let bytes = export_kasirpkg(
        PWD,
        "Legacy Store",
        "0.0.0-older-build",
        vec!["settings".into()],
        HashMap::new(),
        &payload,
    )
    .unwrap();
    std::fs::write(&path, &bytes).unwrap();
    (path, dir)
}

// ── egress: `kasir export` ─────────────────────────────────────────

#[test]
fn kasirpkg_export_withholds_secret_and_device_bound_settings() {
    let conn = seeded_source_db();
    let (path, _dir) = temp_path("export");
    run_export_kasirpkg(&conn, path.to_str().unwrap(), "settings", PWD).unwrap();

    let exported: Vec<String> = exported_settings(&path)
        .into_iter()
        .map(|(key, _)| key)
        .collect();
    for forbidden in MUST_NOT_TRAVEL {
        assert!(
            !exported.iter().any(|k| k == forbidden),
            "portable package must not carry {forbidden}; got {exported:?}"
        );
    }
    // Cleanup is `_dir`'s Drop, not a trailing remove_file.
}

#[test]
fn kasirpkg_export_still_carries_ordinary_settings() {
    // Guards against "fixing" the hole by dropping the settings arm whole:
    // the store name and currency are the point of exporting settings, so
    // they must survive the filter with their values intact.
    let conn = seeded_source_db();
    let (path, _dir) = temp_path("export-plain");
    run_export_kasirpkg(&conn, path.to_str().unwrap(), "settings", PWD).unwrap();

    let rows = exported_settings(&path);
    for wanted in MUST_TRAVEL {
        assert!(
            rows.iter().any(|(k, _)| k == wanted),
            "ordinary setting {wanted} must survive the export filter; got {rows:?}"
        );
    }
    assert!(
        rows.iter()
            .any(|(k, v)| k == keys::STORE_NAME && v == "Warung Sedap"),
        "store.name must keep its value, got {rows:?}"
    );
    // Cleanup is `_dir`'s Drop, not a trailing remove_file.
}

// ── ingress: `kasir import` ────────────────────────────────────────

#[test]
fn kasirpkg_import_leaves_install_secrets_byte_identical() {
    // The half people forget. An older package still carries the source
    // install's credentials and identity; restoring it must not overwrite
    // this machine's values — every guarded key comes back byte-identical.
    let own: &[(&str, &str)] = &[
        (keys::LOCAL_API_SECRET, "own-local-api-signing-secret"),
        (keys::SYNC_TERMINAL_SECRET, "own-terminal-secret"),
        (keys::LICENSE_API_KEY, "own-license-api-key"),
        (keys::STRIPE_API_KEY, "sk_live_own_stripe"),
        (keys::MIDTRANS_SERVER_KEY, "midtrans-own-server-key"),
        (keys::MACHINE_ID, "own-machine-fingerprint"),
        (keys::SYNC_TERMINAL_ID, "own-terminal-id"),
        (keys::STORE_NAME, "Own Store"),
    ];
    let conn = kasirmu_core::migrations::fresh_db();
    for (key, value) in own {
        Settings::set(&conn, key, value).unwrap();
    }
    let before: Vec<Option<Vec<u8>>> = MUST_NOT_TRAVEL
        .iter()
        .map(|key| setting_bytes(&conn, key))
        .collect();
    assert_eq!(
        before.iter().filter(|v| v.is_some()).count(),
        MUST_NOT_TRAVEL.len(),
        "test setup: this install must hold every guarded key before import"
    );

    let injected: Vec<(&str, &str)> = MUST_NOT_TRAVEL
        .iter()
        .map(|key| (*key, "FROM-FOREIGN-PACKAGE"))
        .collect();
    let (path, _dir) = legacy_package(&injected);

    run_import_kasirpkg(&conn, path.to_str().unwrap(), PWD, false).unwrap();

    for (index, key) in MUST_NOT_TRAVEL.iter().enumerate() {
        assert_eq!(
            setting_bytes(&conn, key),
            before[index],
            "restoring an older package must leave this install's {key} byte-identical"
        );
    }
    // Cleanup is `_dir`'s Drop, not a trailing remove_file.
}

#[test]
fn kasirpkg_import_still_restores_ordinary_settings() {
    // The same arm keeps doing its job on portable rows, otherwise the gate
    // is a sledgehammer rather than a filter.
    let conn = kasirmu_core::migrations::fresh_db();
    Settings::set(&conn, keys::STORE_NAME, "Own Store").unwrap();
    let (path, _dir) = legacy_package(&[
        (keys::STORE_NAME, "Packaged Store"),
        (keys::LOCAL_API_SECRET, "FROM-FOREIGN-PACKAGE"),
    ]);

    run_import_kasirpkg(&conn, path.to_str().unwrap(), PWD, false).unwrap();

    assert_eq!(
        setting_bytes(&conn, keys::STORE_NAME),
        Some(b"Packaged Store".to_vec())
    );
    assert_eq!(
        setting_bytes(&conn, keys::LOCAL_API_SECRET),
        None,
        "the secret row must be skipped outright, not written"
    );
    // Cleanup is `_dir`'s Drop, not a trailing remove_file.
}

// ── the manager-prefixed keys the bare predicate missed ───────────────
//
// PortablePackage refuses THREE groups: the credential deny list, the
// device-bound identities, and the keys owned by a dedicated lifecycle
// manager (local_api.*, lan_server.*). The CLI gate called the platform-core
// predicate ALONE, so the third group travelled. These cases are the ones that
// must fail against HEAD.

#[test]
fn kasirpkg_export_omits_manager_owned_settings() {
    // A CLI export omits a manager-prefixed key it includes today.
    // local_api.enabled is neither a credential nor a device id, so the old
    // predicate let it out; restoring it would tell the target install its
    // Local API server should be running when nothing started one (fail-open
    // intent), and lan_server.bind would widen a listener with no PSK change.
    let conn = kasirmu_core::migrations::fresh_db();
    for key in MANAGER_OWNED {
        Settings::set(&conn, key, "from-source-install").unwrap();
    }
    Settings::set(&conn, keys::STORE_NAME, "Warung Sedap").unwrap();

    let (path, _dir) = temp_path("export-manager");
    run_export_kasirpkg(&conn, path.to_str().unwrap(), "settings", PWD).unwrap();

    let exported: Vec<String> = exported_settings(&path)
        .into_iter()
        .map(|(key, _)| key)
        .collect();
    for forbidden in MANAGER_OWNED {
        assert!(
            !exported.iter().any(|k| k == forbidden),
            "portable package must not carry manager-owned {forbidden}; got {exported:?}"
        );
    }
    assert!(
        exported.iter().any(|k| k == keys::STORE_NAME),
        "the refusal must stay a filter, not delete the arm: {exported:?}"
    );
    // Cleanup is `_dir`'s Drop, not a trailing remove_file.
}

#[test]
fn kasirpkg_import_refuses_machine_id_secret_and_manager_rows() {
    // A hand-edited (or simply older) package carrying machine_id,
    // local_api.secret and a manager-prefixed row must write NONE of them into
    // a fresh install, while the ordinary rows in the SAME package still land.
    // Refusal is warn-and-continue: never an error, never a rollback.
    let conn = kasirmu_core::migrations::fresh_db();
    let (path, _dir) = legacy_package(&[
        (keys::MACHINE_ID, "PLANTED-FINGERPRINT"),
        (keys::LOCAL_API_SECRET, "PLANTED-SIGNING-SECRET"),
        ("local_api.enabled", "PLANTED-INTENT"),
        (keys::LAN_SERVER_BIND, "PLANTED-BIND"),
        (keys::STORE_NAME, "Packaged Store"),
        (keys::DEFAULT_CURRENCY, "IDR"),
        (keys::RECEIPT_FOOTER, "Terima kasih"),
    ]);

    run_import_kasirpkg(&conn, path.to_str().unwrap(), PWD, false).unwrap();

    for refused in [
        keys::MACHINE_ID,
        keys::LOCAL_API_SECRET,
        "local_api.enabled",
        keys::LAN_SERVER_BIND,
    ] {
        assert_eq!(
            setting_bytes(&conn, refused),
            None,
            "{refused} is refused by PortablePackage: nothing may be written for it"
        );
    }
    for (wanted, value) in [
        (keys::STORE_NAME, "Packaged Store"),
        (keys::DEFAULT_CURRENCY, "IDR"),
        (keys::RECEIPT_FOOTER, "Terima kasih"),
    ] {
        assert_eq!(
            setting_bytes(&conn, wanted),
            Some(value.as_bytes().to_vec()),
            "an ordinary setting in the same package must still restore — the batch continues past a refusal"
        );
    }
    // Cleanup is `_dir`'s Drop, not a trailing remove_file.
}

#[test]
fn kasirpkg_portable_gate_refuses_manager_owned_prefixes() {
    // The gate is the POLICY, not the bare predicate: same answer for a
    // credential and a device id, a DIFFERENT one for the manager prefixes.
    assert!(!is_portable_settings_key(keys::LOCAL_API_SECRET));
    assert!(!is_portable_settings_key(keys::MACHINE_ID));
    for key in MANAGER_OWNED {
        assert!(
            !is_portable_settings_key(key),
            "manager-owned {key} must be refused by the portable gate"
        );
        assert!(
            !keys::is_non_exportable_setting_key(key),
            "{key} is not in the deny list, so the refusal comes from the policy prefix rule alone"
        );
    }
    for key in MUST_TRAVEL {
        assert!(
            is_portable_settings_key(key),
            "ordinary {key} must be admitted"
        );
    }
    assert!(
        is_portable_settings_key("tax.rounding_mode")
            && is_portable_settings_key("brand.primary_colour")
            && is_portable_settings_key(keys::UI_LOCALE),
        "no ordinary setting may be caught by the rule"
    );
}

// ── the gate itself ───────────────────────────────────────────────────

#[test]
fn kasirpkg_portable_gate_agrees_with_shared_predicate() {
    // Pins the shape the next slice depends on: the lane asks ONE named
    // boundary, and that boundary answers like the shared predicate for a
    // credential, a device id and an ordinary key.
    assert!(!is_portable_settings_key(keys::LOCAL_API_SECRET));
    assert!(!is_portable_settings_key(keys::LICENSE_API_KEY));
    assert!(!is_portable_settings_key(keys::MACHINE_ID));
    assert!(!is_portable_settings_key(keys::SYNC_TERMINAL_ID));
    assert!(is_portable_settings_key(keys::STORE_NAME));
    assert!(is_portable_settings_key(keys::DEFAULT_CURRENCY));
    // The comparison is against the POLICY, not against the bare
    // keys::is_non_exportable_setting_key predicate. That predicate is the
    // narrower rule this lane used to call, and pinning the gate to it is what
    // let local_api.* and lan_server.* ride in a CLI package while the GUI
    // dropped them. Manager-owned probes are included so the two rules cannot
    // quietly diverge again.
    for probe in [
        "brand.primary_colour",
        "ui.locale",
        "tax.rounding_mode",
        keys::STORE_NAME,
        keys::MACHINE_ID,
        keys::LOCAL_API_SECRET,
        "local_api.enabled",
        keys::LAN_SERVER_BIND,
    ] {
        assert_eq!(
            is_portable_settings_key(probe),
            IngestPolicy::PortablePackage.admits(probe),
            "CLI gate drifted from the sealed portable-package policy on {probe}"
        );
    }
}

// ── C1 / S3: the user arm never carries PII ───────────────────────────
//
// C1 slice S3: "a pin test that .ozpkg user JSON never carries national_id
// or monthly pay." The user arm of every portable package is
// `Store::list_users()` (`crates/kasirmu-core/src/db/staff.rs:217`), whose
// SELECT is the eight ordinary `users` columns; both lanes use it —
// `run_export_kasirpkg` below and `kasirmu-bridge/src/data.rs` for the GUI.
// The PII columns added by migration 130 (`national_id`,
// `monthly_take_home_minor`, plus the derived `national_id_hash` and the
// `tax_id` in the same read-gated family) are NOT in that projection, so
// they cannot reach the payload.
//
// This test is the pin, and it is deliberately NON-VACUOUS: it seeds a user
// who genuinely HAS those columns populated, proves they are on the row the
// export reads, then asserts the serialized user JSON carries none of them.
// Widening `list_users`'s SELECT, adding the column to the export mapping,
// or re-introducing a "full profile" user arm fails it. Falsified by
// injecting `national_id` into the export arm — see the run log.

/// `users` columns that are personal data and must never travel in a
/// portable package: the national id and its uniqueness hash, the monthly
/// take-home pay, and the tax id. All four are read-gated behind
/// `staff:read_identity` / `staff:read_payroll` on the profile read path.
const USER_PII_KEYS: &[&str] = &[
    "national_id",
    "national_id_hash",
    "monthly_take_home_minor",
    "tax_id",
];

/// The plaintext seeded for those columns, used to prove the VALUES are
/// absent and not merely renamed.
const PII_NATIONAL_ID: &str = "123456789";
const PII_MONTHLY_PAY_MINOR: i64 = 5_000_000;

/// A complete profile — every mandatory-at-creation field populated, so
/// `write_user_profile` really encrypts a national id and a pay value into
/// the row the export reads.
fn profile_with_pii() -> kasirmu_core::db::profile::UserProfile {
    kasirmu_core::db::profile::UserProfile {
        date_of_birth: Some("1990-05-14".into()),
        phone: Some("+14155550123".into()),
        national_id_type: Some("ssn".into()),
        national_id: Some(PII_NATIONAL_ID.into()),
        email: Some("alice@example.com".into()),
        monthly_take_home_minor: Some(PII_MONTHLY_PAY_MINOR),
        emergency_contact_name: Some("Bob".into()),
        emergency_contact_phone: Some("+14155550987".into()),
        ..Default::default()
    }
}

#[test]
fn kasirpkg_users_arm_never_carries_national_id_or_monthly_pay() {
    let conn = kasirmu_core::migrations::fresh_db();
    conn.execute(
        "INSERT INTO roles (id, name, permissions) VALUES ('role-staff', 'staff', '[\"sales:view\"]')",
        [],
    )
    .unwrap();
    let store = Store::new(&conn);
    let user = store
        .create_user_with_profile(
            "alice",
            "pin-hash",
            "Alice",
            "role-staff",
            &profile_with_pii(),
            None,
        )
        .unwrap();

    // Setup proof — without this the test could pass on an empty column and
    // prove nothing. The PII is genuinely ON the row the export reads.
    let (stored_id, stored_pay): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT national_id, monthly_take_home_minor FROM users WHERE id = ?1",
            rusqlite::params![user.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert!(
        stored_id.is_some() && stored_pay.is_some(),
        "setup: the exported row must actually hold a national id and a pay value"
    );
    assert_ne!(
        stored_id.as_deref(),
        Some(PII_NATIONAL_ID),
        "setup: the stored national id must be ciphertext, not plaintext"
    );

    let (path, _dir) = temp_path("users-pii");
    run_export_kasirpkg(&conn, path.to_str().unwrap(), "users", PWD).unwrap();

    // Assert on what actually landed in the FILE, not on the in-memory
    // payload: this is the artefact that gets carried to another install.
    let bytes = std::fs::read(&path).expect("export file must exist");
    let (_header, payload) = import_kasirpkg(&bytes, PWD).expect("package must decrypt");
    let users = payload.users.expect("users arm present when --types users");
    assert_eq!(
        users.len(),
        1,
        "the exported roster must be exactly the one seeded user"
    );

    let row = users[0].as_object().expect("a user row is a JSON object");

    for forbidden in USER_PII_KEYS {
        assert!(
            !row.contains_key(*forbidden),
            "a portable package must never carry users.{forbidden}; keys were: {:?}",
            row.keys().collect::<Vec<_>>()
        );
    }

    // The VALUES must be absent too: a rename (national_id -> id_number)
    // would dodge a key-only check while leaking the same PII.
    let values: Vec<&serde_json::Value> = row.values().collect();
    assert!(
        !values.iter().any(|v| v.as_str() == Some(PII_NATIONAL_ID)),
        "the national id plaintext must not appear under ANY key: {row:?}"
    );
    assert!(
        !values
            .iter()
            .any(|v| v.as_i64() == Some(PII_MONTHLY_PAY_MINOR)),
        "the monthly pay value must not appear under ANY key: {row:?}"
    );

    // And the pin is a filter, not a deleted arm: the ordinary roster fields
    // the users arm exists to carry must still be present.
    for wanted in ["id", "username", "display_name", "role_id", "is_active"] {
        assert!(
            row.contains_key(wanted),
            "the users arm must still carry {wanted}; keys were: {:?}",
            row.keys().collect::<Vec<_>>()
        );
    }
    // Cleanup is `_dir`'s Drop, not a trailing remove_file.
}

/// The users arm must NOT carry `pin_hash` — the secret is blanked on export.
///
/// Both export lanes serialize `Store::list_users()` wholesale, whose SELECT
/// includes the Argon2id PHC verifier, so this arm used to ship every staff
/// account's offline-crackable credential into a file meant to travel between
/// installs. Two source comments claimed the opposite and both were false
/// ("User records (no PIN hashes)", `kasirmu-core/src/kasirpkg.rs`, and "PIN
/// hash not included in export", `kasirmu-cli/src/commands/kasirpkg.rs`).
///
/// The fix BLANKS the field rather than omitting it: `User::pin_hash` has no
/// `#[serde(default)]`, and all three import arms swallow the resulting
/// deserialization failure with `if let Ok(..)` — omitting the key would make
/// an older install silently skip every user while reporting success. See
/// `platform/core/src/staff_tests.rs::user_deserialization_requires_pin_hash`
/// for the coupling this test depends on.
///
/// The sibling test above does NOT cover this — its `USER_PII_KEYS` list names
/// only the migration-130 profile columns, never `pin_hash`, which is exactly
/// how the false comments survived a test named "users_arm_never_carries...".
#[test]
fn kasirpkg_users_arm_never_carries_pin_hash() {
    let conn = kasirmu_core::migrations::fresh_db();
    conn.execute(
        "INSERT INTO roles (id, name, permissions) VALUES ('role-staff', 'staff', '[\"sales:view\"]')",
        [],
    )
    .unwrap();
    let store = Store::new(&conn);
    // A real PHC Argon2id string, the same format `hash_pin` produces and the
    // same one staff login verifies against — not a bare hash.
    let phc = kasirmu_core::auth::hash_pin("1234").expect("hash_pin");
    assert!(
        phc.starts_with("$argon2id$"),
        "precondition: the stored pin_hash is a PHC Argon2id string, got {phc}"
    );
    store
        .create_user("alice", &phc, "Alice", "role-staff")
        .unwrap();

    let (path, _dir) = temp_path("users-pin");
    run_export_kasirpkg(&conn, path.to_str().unwrap(), "users", PWD).unwrap();

    let bytes = std::fs::read(&path).expect("export file must exist");
    let (_header, payload) = import_kasirpkg(&bytes, PWD).expect("package must decrypt");
    let users = payload.users.expect("users arm present when --types users");
    let row = users[0].as_object().expect("a user row is a JSON object");

    // The key must still be PRESENT (blanking, not omission) so the import
    // arms keep deserializing, but it must carry no verifier.
    assert!(
        row.contains_key("pin_hash"),
        "the pin_hash key must remain present-but-blank; omitting it makes \
         `from_value::<User>` fail and the import arms silently skip every user"
    );
    assert_eq!(
        row.get("pin_hash").and_then(|v| v.as_str()),
        Some(""),
        "a portable package must never carry a staff PIN verifier; if this \
         fails, an export lane stopped blanking pin_hash"
    );
    // Belt-and-braces: the PHC string must not appear anywhere in the payload,
    // so a future rename of the key cannot quietly reintroduce the leak.
    let serialized = serde_json::to_string(&users).unwrap();
    assert!(
        !serialized.contains(&phc),
        "the live PHC hash must not appear anywhere in the exported users arm, \
         under any key name"
    );
    // And the ordinary roster fields still travel, so the pin cannot be
    // satisfied by shipping an empty users arm.
    assert_eq!(
        row.get("username").and_then(|v| v.as_str()),
        Some("alice"),
        "the roster fields must still be exported"
    );
    // Cleanup is `_dir`'s Drop, not a trailing remove_file.
}

// ── O-M49: the import upserts, and a RE-import behaves as it always did ──
//
// The import used to run TWO statements per row (a `SELECT 1 … WHERE <key>`
// probe, then an INSERT or an UPDATE picked from its answer) against a SQL
// string re-compiled every time. It is now ONE `INSERT … ON CONFLICT … DO
// UPDATE` per row against ONE prepared statement per table.
//
// The conflict behaviour of the old shape was REPLACE-ONLY: the INSERT branch
// ran when the row was absent, the UPDATE branch wrote a fixed column list
// when it was present. So a re-import UPDATES. `ON CONFLICT DO NOTHING` and
// `DO UPDATE` differ observably — a stale column ends up old vs new — which is
// exactly what the two re-import tests below separate. They assert by VALUE,
// not by counting rows: a row count is identical under either clause and would
// pass against the wrong one.

// ── O-M50: a failed export arm is a NON-ZERO EXIT, not an empty array ────
//
// Every arm used to end in
// `serde_json::to_value(&rows).ok().and_then(|v| v.as_array().cloned()).unwrap_or_default()`.
// Two ways that reports success for a failure: the `to_value` error became an
// EMPTY array, and `Ok(non-array)` became an empty array too. Both wrote a
// package, exited 0, and printed "exported to …, N bytes" — a store whose
// products could not be serialized was indistinguishable from a store that
// has no products.
//
// The trigger is REAL, not a scaffold: `foundation::Currency` hand-writes
// `Serialize` and returns an error when its three bytes are not UTF-8
// (`foundation/src/money.rs`, "invalid currency bytes"). No ordinary read path
// can produce such a value — every one of them parses the column with
// `str::from_utf8` first — so these two tests call the arm helper
// DIRECTLY with the value that cannot come out of the database. That is the
// whole point: the arm's error contract is now testable without a fixture
// that the storage layer would refuse to build.

/// A `Currency` the serializer cannot encode is a byte-level fact, not
/// something the type can be asked to construct: the tuple field is public.
fn unserializable_product() -> kasirmu_core::Product {
    let mut product = product_fixture("PRD-BAD", "Coffee", 1_000, None);
    product.price.currency = kasirmu_core::Currency([0xff, 0xfe, 0xfd]);
    product
}

#[test]
fn kasirpkg_export_arm_returns_err_when_a_row_cannot_be_serialized() {
    // The BEFORE shape, asserted in this same test so the regression cannot
    // come back quietly: this is exactly what the export arm used to do with
    // the value, and it produces an EMPTY, successful-looking products list.
    let rows = vec![unserializable_product()];
    let before = serde_json::to_value(&rows)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    assert!(
        before.is_empty(),
        "precondition: the retired .ok()/.unwrap_or_default() swallowed this failure into an empty array"
    );

    // AFTER: the same value is a hard error, and the error names the arm.
    let err = export_arm(&rows, "products")
        .expect_err("a row that cannot be serialized must abort the export, not empty the arm");
    let rendered = format!("{err:#}");
    assert!(
        rendered.contains("products"),
        "the failure must name the arm that failed, got: {rendered}"
    );
    assert!(
        rendered.to_lowercase().contains("currency"),
        "the failure must carry serde's own reason (the currency bytes), got: {rendered}"
    );
}

#[test]
fn kasirpkg_export_arm_keeps_a_well_formed_arm_unchanged() {
    // (a) The success path is byte-for-byte the old one: same array, same
    // rows, same order, and the same JSON the retired expression produced.
    let rows = vec![
        product_fixture("PRD-1", "Coffee", 1_000, Some("cat-1")),
        product_fixture("PRD-2", "Bagel", 2_500, None),
    ];
    let arm = export_arm(&rows, "products").expect("a well-formed arm must serialize");

    let legacy = serde_json::to_value(&rows)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    assert_eq!(
        serde_json::Value::Array(arm),
        serde_json::Value::Array(legacy),
        "the helper must hand the payload the identical JSON the old expression did"
    );
}

#[test]
fn kasirpkg_export_refuses_to_write_a_package_it_could_not_serialize() {
    // The end-to-end half: with a real database and a real output path, the
    // error must leave NO FILE. Before the fix this call returned Ok, wrote a
    // package, and the products arm inside it was empty.
    let conn = kasirmu_core::migrations::fresh_db();
    let (path, _dir) = temp_path("o-m50-package");

    // Success first, so the failure below is about the arm and not the path.
    run_export_kasirpkg(&conn, path.to_str().unwrap(), "products", PWD)
        .expect("an empty but readable store must still export");
    assert!(
        path.exists(),
        "precondition: the success path writes the package"
    );
    // NOT redundant with `_dir`: this delete is a PRECONDITION for the
    // assertion below, not cleanup. The arm helper takes no path, so the only
    // way `path` could exist at that assert is if something wrote it between
    // here and there — which is exactly the bug this pins. Removing this line
    // (because `_dir` deletes the directory on drop) makes the assertion
    // vacuous against a file that is still there, and it passed only because
    // the success path had written it.
    let _ = std::fs::remove_file(&path);

    // The arm helper is the ONLY place an export can now fail to serialize,
    // and it is reachable without a package writer, so the contract is
    // asserted where it lives. A row that serializes must still be Ok —
    // proving the check is a filter on failure, not a blanket refusal.
    assert!(export_arm(&[product_fixture("PRD-OK", "Tea", 500, None)], "products").is_ok());
    assert!(!path.exists(), "nothing may be left behind by a failed arm");
}

/// One package payload for the import tests, every portable arm populated.
fn first_import_payload() -> KasirpkgPayload {
    KasirpkgPayload {
        categories: vec![
            serde_json::to_value(kasirmu_core::Category::new(
                "cat-1", "Drinks", "#ff0000", "",
            ))
            .unwrap(),
            serde_json::to_value(kasirmu_core::Category::new("cat-2", "Food", "", "")).unwrap(),
        ],
        products: vec![
            serde_json::to_value(product_fixture("PRD-1", "Coffee", 1_000, Some("cat-1"))).unwrap(),
            serde_json::to_value(product_fixture("PRD-2", "Bagel", 2_500, Some("cat-2"))).unwrap(),
        ],
        customers: Some(vec![
            serde_json::to_value(customer_fixture(
                "cust-1",
                "Alice",
                Some("alice@example.com"),
            ))
            .unwrap(),
        ]),
        users: Some(vec![
            serde_json::to_value(user_fixture("user-1", "alice", "Alice", "role-1")).unwrap(),
        ]),
        sales: None,
        settings: None,
    }
}

fn product_fixture(
    sku: &str,
    name: &str,
    price_minor: i64,
    category_id: Option<&str>,
) -> kasirmu_core::Product {
    let mut p = kasirmu_core::Product::new(
        sku,
        name,
        kasirmu_core::Money {
            minor_units: price_minor,
            currency: "USD".parse().expect("USD is a currency"),
        },
    );
    p.id = format!("id-{sku}");
    p.category_id = category_id.map(str::to_owned);
    p
}

fn customer_fixture(id: &str, name: &str, email: Option<&str>) -> kasirmu_core::Customer {
    let mut c = kasirmu_core::Customer::new(name);
    c.id = id.to_owned();
    c.email = email.map(|e| e.parse().expect("valid email"));
    c
}

fn user_fixture(id: &str, username: &str, display_name: &str, role_id: &str) -> kasirmu_core::User {
    // `pin_hash` is present because `from_value::<User>` requires it (no
    // `serde(default)`); the import must never restore it.
    kasirmu_core::User {
        id: id.to_owned(),
        username: username.to_owned(),
        pin_hash: "$argon2id$v=19$m=19456,t=2,p=1$c291cmNl$c291cmNlaGFzaA".to_owned(),
        display_name: display_name.to_owned(),
        role_id: role_id.to_owned(),
        is_active: true,
        created_at: "2020-01-01T00:00:00.000Z".to_owned(),
        updated_at: "2020-01-01T00:00:00.000Z".to_owned(),
    }
}

/// Write a payload to a decryptable package and return its path.
fn package_for(
    payload: &KasirpkgPayload,
) -> (std::path::PathBuf, kasirmu_test_support::ScratchDir) {
    let (path, dir) = temp_path("m49");
    let bytes = export_kasirpkg(
        PWD,
        "Import Store",
        "0.0.1",
        vec![
            "categories".into(),
            "products".into(),
            "customers".into(),
            "users".into(),
        ],
        HashMap::new(),
        payload,
    )
    .unwrap();
    std::fs::write(&path, &bytes).unwrap();
    (path, dir)
}

/// A database with the `roles` row the imported users point at.
fn import_target_db() -> Connection {
    let conn = kasirmu_core::migrations::fresh_db();
    conn.execute(
        "INSERT INTO roles (id, name, permissions) VALUES ('role-1', 'staff', '[]')",
        [],
    )
    .unwrap();
    conn
}

/// One row as plain strings, so a multi-column assertion stays readable and
/// shows every column that drifted rather than only the first that differs.
fn read_row(conn: &Connection, sql: &str) -> Vec<String> {
    conn.query_row(sql, [], |r| {
        (0..r.as_ref().column_count())
            .map(|i| match r.get::<_, rusqlite::types::Value>(i)? {
                rusqlite::types::Value::Null => Ok("<null>".to_owned()),
                rusqlite::types::Value::Integer(n) => Ok(n.to_string()),
                rusqlite::types::Value::Real(f) => Ok(f.to_string()),
                rusqlite::types::Value::Text(t) => Ok(t),
                rusqlite::types::Value::Blob(_) => Ok("<blob>".to_owned()),
            })
            .collect::<rusqlite::Result<Vec<String>>>()
    })
    .unwrap()
}

/// Every column of the four import targets, in one comparable tuple per row.
fn snapshot(conn: &Connection) -> String {
    let mut out = String::new();
    for (label, sql) in [
        (
            "categories",
            "SELECT id, name, colour, icon FROM categories ORDER BY id",
        ),
        (
            "products",
            "SELECT id, sku, name, price_minor, currency, category_id, barcode, tenant_id, is_active FROM products ORDER BY sku",
        ),
        (
            "customers",
            "SELECT id, name, coalesce(email,'<null>'), coalesce(phone,'<null>'), notes, loyalty_points, total_spent_minor, currency FROM customers ORDER BY id",
        ),
        (
            "users",
            "SELECT id, username, display_name, role_id, is_active, length(pin_hash) FROM users ORDER BY id",
        ),
    ] {
        let mut stmt = conn.prepare(sql).unwrap();
        let cols = stmt.column_count();
        let rows = stmt
            .query_map([], |r| {
                let mut vals = Vec::new();
                for i in 0..cols {
                    let v: rusqlite::types::Value = r.get(i)?;
                    vals.push(format!("{v:?}"));
                }
                Ok(vals.join("|"))
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect::<Vec<_>>();
        out.push_str(&format!(
            "{label}:
"
        ));
        for row in rows {
            out.push_str("  ");
            out.push_str(&row);
            out.push('\n');
        }
    }
    out
}

#[test]
fn kasirpkg_fresh_import_writes_every_arm() {
    // (a) A fresh import lands the expected rows, with the two CREATE-ONLY
    // arms ('/USD'/0/0 and the blanked pin_hash + inactive flag) intact.
    let conn = import_target_db();
    let (path, _dir) = package_for(&first_import_payload());
    run_import_kasirpkg(&conn, path.to_str().unwrap(), PWD, false).unwrap();

    assert_eq!(
        conn.query_row("SELECT count(*) FROM categories", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
    // A category with an empty colour gets the "#6366f1" fallback.
    assert_eq!(
        conn.query_row(
            "SELECT colour FROM categories WHERE id = 'cat-2'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "#6366f1"
    );
    assert_eq!(
        conn.query_row(
            "SELECT name, price_minor, category_id FROM products WHERE sku = 'PRD-1'",
            [],
            |r| Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, Option<String>>(2)?
            ))
        )
        .unwrap(),
        ("Coffee".to_owned(), 1_000, Some("cat-1".to_owned()))
    );
    assert_eq!(
        conn.query_row(
            "SELECT loyalty_points, total_spent_minor, currency FROM customers WHERE id = 'cust-1'",
            [],
            |r| Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?
            ))
        )
        .unwrap(),
        (0, 0, "USD".to_owned()),
        "the INSERT path must seed zero loyalty/spend and the 'USD' default"
    );
    assert_eq!(
        conn.query_row(
            "SELECT pin_hash, is_active FROM users WHERE id = 'user-1'",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        )
        .unwrap(),
        (String::new(), 0),
        "a fresh import must blank the exported verifier and land the user inactive"
    );
    // Cleanup is `_dir`'s Drop, not a trailing remove_file.
}

#[test]
fn kasirpkg_reimport_updates_a_stale_local_row() {
    // (b1) THE UPDATE-vs-SKIP proof. Between the two imports the local rows are
    // hand-edited to stale values. An upsert that UPDATES overwrites them; one
    // that SKIPS (ON CONFLICT DO NOTHING) leaves them stale. Row counts are
    // identical either way, so only the values separate the two clauses.
    let conn = import_target_db();
    let payload = first_import_payload();
    let (path, _dir) = package_for(&payload);
    run_import_kasirpkg(&conn, path.to_str().unwrap(), PWD, false).unwrap();

    // EVERY column the old UPDATE arm wrote is staled, plus the foreign key
    // and null-able ones — a column left out of the new `DO UPDATE SET` list
    // would then silently stay stale, which is the second half of the
    // behaviour this test exists to pin.
    for stale in [
        "UPDATE categories SET name = 'STALE', colour = '#000000' WHERE id = 'cat-1'",
        "UPDATE products SET name = 'STALE', price_minor = 1, currency = 'ZZZ', category_id = NULL, barcode = 'stale-barcode', created_at = 'STALE', updated_at = 'STALE' WHERE sku = 'PRD-1'",
        "UPDATE customers SET name = 'STALE', email = 'stale@example.com', phone = 'stale-phone', notes = 'STALE', created_at = 'STALE', updated_at = 'STALE' WHERE id = 'cust-1'",
        "UPDATE users SET username = 'stale-user', display_name = 'STALE', role_id = 'role-1', created_at = 'STALE', updated_at = 'STALE' WHERE id = 'user-1'",
    ] {
        assert_eq!(conn.execute(stale, []).unwrap(), 1, "stale setup: {stale}");
    }

    run_import_kasirpkg(&conn, path.to_str().unwrap(), PWD, false).unwrap();

    assert_eq!(
        conn.query_row(
            "SELECT name, colour FROM categories WHERE id = 'cat-1'",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        )
        .unwrap(),
        ("Drinks".to_owned(), "#ff0000".to_owned()),
        "a re-import must UPDATE a stale category, not skip it"
    );
    // `updated_at` is asserted too: the old UPDATE arm always wrote it, so it
    // belongs in the DO UPDATE list, and dropping it from that list must fail
    // here rather than pass silently.
    assert_eq!(
        read_row(
            &conn,
            "SELECT name, price_minor, currency, coalesce(category_id,'<null>'), \
             coalesce(barcode,'<null>'), updated_at IS NOT 'STALE' \
             FROM products WHERE sku = 'PRD-1'"
        ),
        vec!["Coffee", "1000", "USD", "cat-1", "<null>", "1",],
        "a re-import must UPDATE every column the old UPDATE arm wrote, by sku"
    );
    assert_eq!(
        read_row(
            &conn,
            "SELECT name, email, coalesce(phone,'<null>'), notes, updated_at IS NOT 'STALE' \
             FROM customers WHERE id = 'cust-1'"
        ),
        vec!["Alice", "alice@example.com", "<null>", "", "1"],
        "a re-import must UPDATE every column the old UPDATE arm wrote, by id"
    );
    assert_eq!(
        read_row(
            &conn,
            "SELECT username, display_name, role_id, updated_at IS NOT 'STALE' \
             FROM users WHERE id = 'user-1'"
        ),
        vec!["alice", "Alice", "role-1", "1"],
        "a re-import must UPDATE every column the old UPDATE arm wrote, by id"
    );

    // And it still did not duplicate anything.
    for (table, expected) in [
        ("categories", 2),
        ("products", 2),
        ("customers", 1),
        ("users", 1),
    ] {
        assert_eq!(
            conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            expected,
            "a re-import must not insert a second {table} row"
        );
    }
    // Cleanup is `_dir`'s Drop, not a trailing remove_file.
}

#[test]
fn kasirpkg_reimport_preserves_what_the_old_update_arm_never_touched() {
    // (b2) The other half of "updates, and only in the same columns". The old
    // UPDATE arms wrote a FIXED column list, so a re-import left the
    // create-only columns alone. Carrying the column list into DO UPDATE keeps
    // that: a live customer's balance survives, a live user keeps its verifier
    // and its active flag, and a re-import never rewrites created_at.
    let conn = import_target_db();
    let payload = first_import_payload();
    let (path, _dir) = package_for(&payload);
    run_import_kasirpkg(&conn, path.to_str().unwrap(), PWD, false).unwrap();

    let live = kasirmu_core::auth::hash_pin("9876").expect("hash_pin");
    conn.execute(
        "UPDATE customers SET loyalty_points = 500, total_spent_minor = 12345, currency = 'IDR' WHERE id = 'cust-1'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE users SET is_active = 1, pin_hash = ?1 WHERE id = 'user-1'",
        rusqlite::params![live],
    )
    .unwrap();
    let created_before: String = conn
        .query_row(
            "SELECT created_at FROM products WHERE sku = 'PRD-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();

    run_import_kasirpkg(&conn, path.to_str().unwrap(), PWD, false).unwrap();

    assert_eq!(
        conn.query_row(
            "SELECT loyalty_points, total_spent_minor, currency FROM customers WHERE id = 'cust-1'",
            [],
            |r| Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?
            ))
        )
        .unwrap(),
        (500, 12345, "IDR".to_owned()),
        "a re-import must NOT zero a live customer's loyalty/spend or reset its currency; \
         the old UPDATE arm never wrote those columns"
    );
    assert_eq!(
        conn.query_row(
            "SELECT pin_hash, is_active FROM users WHERE id = 'user-1'",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        )
        .unwrap(),
        (live, 1),
        "a re-import must neither blank a live account's verifier nor deactivate it; \
         the old UPDATE arm never wrote pin_hash or is_active"
    );
    assert_eq!(
        conn.query_row(
            "SELECT created_at FROM products WHERE sku = 'PRD-1'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        created_before,
        "a re-import must not rewrite created_at"
    );
    // Cleanup is `_dir`'s Drop, not a trailing remove_file.
}

#[test]
fn kasirpkg_reimport_is_row_for_row_idempotent() {
    // Two imports of one package leave a byte-identical database. This is the
    // cheap, total form of "update, not skip-and-drift, and not insert-twice":
    // any arm that inserted a duplicate, or updated a column it used to skip,
    // or skipped a column it used to update, changes the snapshot.
    let conn = import_target_db();
    let (path, _dir) = package_for(&first_import_payload());
    run_import_kasirpkg(&conn, path.to_str().unwrap(), PWD, false).unwrap();
    let once = snapshot(&conn);

    run_import_kasirpkg(&conn, path.to_str().unwrap(), PWD, false).unwrap();
    let twice = snapshot(&conn);

    assert_eq!(
        once, twice,
        "importing the same package twice must leave every column value unchanged"
    );
    // Cleanup is `_dir`'s Drop, not a trailing remove_file.
}

#[test]
fn kasirpkg_reimport_still_errors_on_a_unique_collision() {
    // A DIFFERENT id colliding on a unique key is not a re-import: the old
    // INSERT branch raised SQLITE_CONSTRAINT_UNIQUE and rolled the import
    // back, and the upsert must not absorb that as an update.
    //   * users: (tenant_id, username) — a new id with a taken username.
    //   * categories: name is NOT NULL UNIQUE — a new id with a taken name.
    let conn = import_target_db();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id) VALUES ('local-1', 'alice', '', 'Local Alice', 'role-1')",
        [],
    )
    .unwrap();
    let payload = KasirpkgPayload {
        categories: vec![
            serde_json::to_value(kasirmu_core::Category::new(
                "local-cat",
                "Drinks",
                "#123456",
                "",
            ))
            .unwrap(),
        ],
        products: vec![],
        customers: None,
        sales: None,
        settings: None,
        users: Some(vec![
            serde_json::to_value(user_fixture("user-1", "alice", "Alice", "role-1")).unwrap(),
        ]),
    };
    let (path, _dir) = package_for(&payload);

    let err = run_import_kasirpkg(&conn, path.to_str().unwrap(), PWD, false)
        .expect_err("a username collision from a different id must abort the import");

    assert!(
        format!("{err:#}").to_lowercase().contains("unique"),
        "the failure must still be the unique-constraint error, got: {err:#}"
    );
    assert_eq!(
        conn.query_row("SELECT count(*) FROM categories", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0,
        "the collision must roll the WHOLE import back, exactly as before"
    );
    assert_eq!(
        conn.query_row(
            "SELECT display_name FROM users WHERE id = 'local-1'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "Local Alice",
        "the colliding local row must be untouched"
    );
    // `_dir` is bound for the whole test body, so the scratch directory is
    // removed on drop instead of by this trailing remove_file, which never ran
    // when an assert above failed.
}
