//! Tests for `oz rekey`.
//!
//! # Why the rotation case lives in this binary, and what that costs
//!
//! `kasirmu_crypto::set_install_key` is a process-global `OnceLock`: the first
//! call wins for the whole process and cannot be undone. A test that drives it
//! therefore has to be alone with it, which is why the crypto crate keeps its
//! equivalent in `tests/at_rest_key_lifecycle.rs` — a separate process.
//!
//! `rotate_at_rest_rows` is `pub(crate)`, so it cannot be reached from an
//! integration test. It runs here instead, in the lib test binary, under one
//! stated precondition: **exactly one test in this binary installs an install
//! key** (`the_sweep_re_encrypts_every_shape_under_the_installed_key`, which
//! asserts the install actually won). That is safe today because every other use
//! of `kasirmu_core::crypto` in this crate is a derivation-agnostic round trip —
//! `encrypt_*` followed by its own `decrypt_*` — so which key is selected cannot
//! change any of their outcomes. A future test that hard-codes a derivation, or
//! asserts a value does NOT decrypt, would break that and must move out.
//!
//! # What is NOT covered here, and where it is covered instead
//!
//! The two-key half of a rotation — a row sealed under the PARKED key reading
//! while the sweep runs — needs a row written under a key that is not the install
//! key, and there is no public way to encrypt under the previous slot
//! (`portable_key` deliberately never consults it, hazard H1). It is pinned at
//! the layers that can express it:
//!
//! - `kasirmu-crypto` `a_previous_install_key_is_a_read_candidate_and_never_a_writer`
//!   — the parked key is a read candidate and never a writer;
//! - `kasirmu-security` `an_interrupted_rotation_leaves_both_keys_resolvable` —
//!   after a crash between promote and sweep, a boot still reads both keys.

use super::*;
use rusqlite::{Connection, params};

use kasirmu_core::crypto::{
    AtRestFamily, decrypt_lan_psk, decrypt_local_api_secret, decrypt_profile_field,
    decrypt_sync_api_key, encrypt_lan_psk, encrypt_local_api_secret, encrypt_profile_field,
    encrypt_smtp_at_rest, encrypt_sync_api_key, set_install_key,
};
use kasirmu_core::settings::keys;

fn fresh_db() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

fn set_setting(conn: &Connection, key: &str, value: &str) {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .expect("insert a settings row");
}

fn read_setting(conn: &Connection, key: &str) -> String {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .expect("read a settings row")
}

/// Insert a user row. `roles` is seeded first because `fresh_db` turns
/// `foreign_keys` ON, so `users.role_id` is a real foreign key.
fn add_user(conn: &Connection, id: &str, national_id: Option<&str>, pay: Option<&str>) {
    conn.execute(
        "INSERT OR IGNORE INTO roles (id, name) VALUES ('role-test', 'test-role')",
        [],
    )
    .expect("seed the test role");
    conn.execute(
        "INSERT INTO users \
         (id, username, pin_hash, display_name, role_id, national_id, monthly_take_home_minor) \
         VALUES (?1, ?1, 'x', 'Test User', 'role-test', ?2, ?3)",
        params![id, national_id, pay],
    )
    .expect("insert a user row");
}

fn read_profile(conn: &Connection, user_id: &str, column: &str) -> Option<String> {
    conn.query_row(
        // `column` is a test constant, never caller input.
        &format!("SELECT {column} FROM users WHERE id = ?1"),
        params![user_id],
        |row| row.get(0),
    )
    .expect("read a profile column")
}

// ── The family mapping ───────────────────────────────────────────────────────

/// The six whole-row families map, and nothing else does.
///
/// `smtp_config` is the case worth pinning: it IS install-key-derived, but its
/// value is a JSON blob rather than a whole-row ciphertext, so mapping it here
/// would hand the sweep a blob to decrypt as if it were a sealed value.
#[test]
fn settings_family_maps_exactly_the_six_whole_row_families() {
    for (key, family) in [
        (keys::SYNC_API_KEY, AtRestFamily::SyncApiKey),
        (keys::SYNC_TERMINAL_SECRET, AtRestFamily::SyncTerminalSecret),
        (keys::PG_SYNC_PASSWORD, AtRestFamily::PgSyncPassword),
        (keys::RATE_SYNC_API_KEY, AtRestFamily::RateApiKey),
        (keys::LAN_SERVER_PSK, AtRestFamily::LanPsk),
        (keys::LOCAL_API_SECRET, AtRestFamily::LocalApiSecret),
    ] {
        assert_eq!(settings_family(key), Some(family), "{key} must map");
    }

    for key in [
        keys::SMTP_CONFIG,
        keys::LICENSE_API_KEY,
        keys::STORE_NAME,
        "sync.auth_token",
        "smtp_config:tenant-a",
    ] {
        assert_eq!(
            settings_family(key),
            None,
            "{key} must not be treated as a whole-row family"
        );
    }
}

/// A family key stored under a variant spelling is still the family's row.
///
/// Skipping it would strand it: the sweep would leave it under the outgoing key,
/// and it would become unreadable the moment that key was retired. The settings
/// table is BINARY-collated, so `SYNC_API_KEY` and `" sync_api_key "` are
/// distinct rows that an exact compare walks straight past.
#[test]
fn family_lookup_folds_case_and_whitespace_so_a_variant_row_is_not_walked_past() {
    assert_eq!(
        settings_family("SYNC_API_KEY"),
        Some(AtRestFamily::SyncApiKey)
    );
    assert_eq!(
        settings_family("  sync_api_key  "),
        Some(AtRestFamily::SyncApiKey)
    );
    assert!(is_smtp_config_key("SMTP_CONFIG"));
    assert!(is_smtp_config_key(" smtp_config "));
    // A scoped suffix is NOT folded: `credential_base` is suffix-blind by
    // decision, so a scoped name resolves to no family and is left alone rather
    // than guessed at.
    assert_eq!(settings_family("sync_api_key:tenant-a"), None);
}

// ── The SMTP blob ────────────────────────────────────────────────────────────

/// Only a non-empty string member counts as a sealed password.
#[test]
fn smtp_password_field_reads_only_a_non_empty_string_member() {
    let cases = [
        (r#"{"password":"s3cret","host":"mail"}"#, Some("s3cret")),
        (r#"{"host":"mail"}"#, None),
        (r#"{"password":""}"#, None),
        (r#"{"password":null}"#, None),
        (r#"{"password":123}"#, None),
        ("not json at all", None),
        ("[1,2,3]", None),
        ("\"a bare string\"", None),
    ];
    for (blob, expected) in cases {
        assert_eq!(
            smtp_password_field(blob).as_deref(),
            expected,
            "blob = {blob}"
        );
    }
}

/// Rewriting the password must not disturb its siblings.
///
/// `smtp_config` is one row holding several settings, only one of which is
/// sealed. A rewrite that lost `host` would silently break a working mailbox.
#[test]
fn rebuild_smtp_blob_replaces_only_the_password_member() {
    let rebuilt = rebuild_smtp_blob(
        r#"{"host":"mail.example","port":587,"username":"ops","password":"old"}"#,
        "new",
    )
    .expect("the blob rebuilds");
    let parsed: serde_json::Value =
        serde_json::from_str(&rebuilt).expect("the rebuilt blob is JSON");
    assert_eq!(
        parsed.get("password").and_then(serde_json::Value::as_str),
        Some("new")
    );
    assert_eq!(
        parsed.get("host").and_then(serde_json::Value::as_str),
        Some("mail.example")
    );
    assert_eq!(
        parsed.get("port").and_then(serde_json::Value::as_i64),
        Some(587)
    );
    assert_eq!(
        parsed.get("username").and_then(serde_json::Value::as_str),
        Some("ops")
    );
}

// ── The walk: which rows are in scope ────────────────────────────────────────

/// The whole point of the three shapes: every install-key-derived row is found,
/// and nothing else is.
#[test]
fn the_walk_finds_every_shape_and_leaves_unrelated_keys_alone() {
    let conn = fresh_db();
    for key in [
        keys::SYNC_API_KEY,
        keys::SYNC_TERMINAL_SECRET,
        keys::PG_SYNC_PASSWORD,
        keys::RATE_SYNC_API_KEY,
        keys::LAN_SERVER_PSK,
        keys::LOCAL_API_SECRET,
    ] {
        set_setting(&conn, key, "a-whole-row-value");
    }
    set_setting(
        &conn,
        keys::SMTP_CONFIG,
        r#"{"host":"mail","password":"a-sealed-password"}"#,
    );
    // Out of scope, and must not be walked: a machine-bound family whose key
    // material is the installation fingerprint, and a plain non-credential key.
    set_setting(&conn, keys::LICENSE_API_KEY, "machine-bound");
    set_setting(&conn, keys::STORE_NAME, "Kafe Lima");
    // u-1 carries both sealed columns; u-2 carries neither.
    add_user(&conn, "u-1", Some("sealed-id"), Some("sealed-pay"));
    add_user(&conn, "u-2", None, Some(""));

    let mut seen: Vec<SweepTarget> = Vec::new();
    let tally = walk_at_rest_rows(&conn, |target, _| {
        seen.push(target.clone());
        Ok(VisitOutcome::Skip)
    })
    .expect("the walk runs");

    assert_eq!(tally.settings_rows, 6, "the six whole-row settings keys");
    assert_eq!(tally.smtp_rows, 1, "the smtp_config password field");
    assert_eq!(
        tally.profile_rows, 2,
        "u-1's two columns only: u-2's are NULL and empty"
    );
    assert_eq!(tally.total_rows(), 9);
    assert_eq!(seen.len(), 9);

    assert!(
        !seen.iter().any(|target| matches!(
            target,
            SweepTarget::SettingsValue { key, .. } if key == keys::LICENSE_API_KEY
        )),
        "a machine-bound row must not be walked: its ciphertext does not change \
         meaning when the install key rotates"
    );
    assert!(
        !seen.iter().any(|target| matches!(
            target,
            SweepTarget::SettingsValue { key, .. } if key == keys::STORE_NAME
        )),
        "a non-credential settings key must not be walked"
    );
    assert!(
        !seen
            .iter()
            .any(|target| matches!(target, SweepTarget::ProfileColumn { user_id, .. } if user_id == "u-2")),
        "a NULL or empty profile column carries nothing sealed"
    );
}

/// A `smtp_config` row with no password member is not in scope.
///
/// It cannot depend on the outgoing key, so counting it would inflate the
/// operator's picture of what a rotation risks.
#[test]
fn a_smtp_config_row_with_no_password_field_is_not_in_scope() {
    let conn = fresh_db();
    set_setting(
        &conn,
        keys::SMTP_CONFIG,
        r#"{"host":"mail","username":"ops"}"#,
    );

    let tally = walk_at_rest_rows(&conn, |_, _| Ok(VisitOutcome::Skip)).expect("the walk runs");
    assert_eq!(tally.smtp_rows, 0);
    assert_eq!(tally.total_rows(), 0);
}

/// The store guard refuses a database that is not a store.
#[test]
fn require_rekey_database_refuses_a_database_that_is_not_a_store() {
    let empty = Connection::open_in_memory().expect("an empty in-memory db");
    let err = require_rekey_database(&empty).expect_err("an empty db is not a store");
    assert!(
        err.to_string().contains(SETTINGS_TABLE),
        "the refusal names the missing table, got: {err}"
    );

    let store = fresh_db();
    require_rekey_database(&store).expect("a migrated store passes");
}

// ── The rotation ─────────────────────────────────────────────────────────────

/// The slice's gate, first half: a store holding rows under the LEGACY
/// derivation and rows under an install key rekeys, and every row reads back.
///
/// This is the ONLY test in this binary that installs an install key, and the
/// install is first-call-wins for the process — so the `assert!` on it is the
/// precondition check, not decoration. See the module docstring.
#[test]
fn the_sweep_re_encrypts_every_shape_under_the_installed_key() {
    let conn = fresh_db();

    // 1. Rows written BEFORE any install key exists — sealed under whichever
    //    derivation a process with no install key selects. This is what every
    //    row on an install predating the per-install key looks like.
    let legacy_sync = encrypt_sync_api_key("legacy-sync").expect("encrypt pre-install");
    let legacy_local = encrypt_local_api_secret("legacy-local").expect("encrypt pre-install");
    let legacy_smtp = encrypt_smtp_at_rest("legacy-smtp").expect("encrypt pre-install");
    let legacy_id = encrypt_profile_field("123456789").expect("encrypt pre-install");
    let legacy_pay = encrypt_profile_field("5000000").expect("encrypt pre-install");
    set_setting(&conn, keys::SYNC_API_KEY, &legacy_sync);
    set_setting(&conn, keys::LOCAL_API_SECRET, &legacy_local);
    set_setting(
        &conn,
        keys::SMTP_CONFIG,
        &format!(r#"{{"host":"mail","password":"{legacy_smtp}"}}"#),
    );
    add_user(&conn, "u-1", Some(&legacy_id), Some(&legacy_pay));

    // 2. Install the key. This is what the boot path does, and it is what makes
    //    the rows above "pre-install".
    assert!(
        set_install_key([0x5A; 32]),
        "this test must be the only install-key setter in this binary"
    );

    // 3. A row written AFTER the install: already under the current key, and the
    //    sweep must still re-encrypt it rather than walk past it.
    let current_lan = encrypt_lan_psk("current-lan").expect("encrypt post-install");
    set_setting(&conn, keys::LAN_SERVER_PSK, &current_lan);

    // 4. Rotate.
    let outcome = rotate_at_rest_rows(&conn).expect("the sweep runs and verifies");

    assert_eq!(outcome.swept.settings_rows, 3, "sync, local_api, lan");
    assert_eq!(outcome.swept.smtp_rows, 1);
    assert_eq!(outcome.swept.profile_rows, 2);
    assert_eq!(
        outcome.swept.rewritten, 6,
        "every in-scope row is rewritten, including the one already under the \
         current key"
    );
    assert_eq!(outcome.swept.unreadable, 0);
    assert_eq!(
        outcome.verified.not_under_current, 0,
        "every row must open under the new key alone, or the outgoing key cannot \
         be retired"
    );

    // 5. The pre-install rows actually MOVED — a sweep that reported success
    //    while leaving them under the old derivation is the failure this asserts
    //    against.
    assert_ne!(
        read_setting(&conn, keys::SYNC_API_KEY),
        legacy_sync,
        "a legacy row must have been re-encrypted"
    );
    assert_ne!(read_setting(&conn, keys::LOCAL_API_SECRET), legacy_local);

    // 6. And they still hold the same plaintext, read back through the public
    //    readers — a re-encryption that lost the value is worse than none.
    assert_eq!(
        decrypt_sync_api_key(&read_setting(&conn, keys::SYNC_API_KEY)).expect("read back"),
        "legacy-sync"
    );
    assert_eq!(
        decrypt_local_api_secret(&read_setting(&conn, keys::LOCAL_API_SECRET)).expect("read back"),
        "legacy-local"
    );
    assert_eq!(
        decrypt_lan_psk(&read_setting(&conn, keys::LAN_SERVER_PSK)).expect("read back"),
        "current-lan"
    );
    let smtp = read_setting(&conn, keys::SMTP_CONFIG);
    assert_eq!(
        smtp_password_field(&smtp)
            .and_then(|pwd| kasirmu_core::crypto::decrypt_smtp_at_rest(&pwd).ok())
            .as_deref(),
        Some("legacy-smtp"),
        "the SMTP password field survives with its siblings intact"
    );
    assert_eq!(
        decrypt_profile_field(&read_profile(&conn, "u-1", "national_id").expect("present"))
            .expect("read back"),
        "123456789"
    );
    assert_eq!(
        decrypt_profile_field(
            &read_profile(&conn, "u-1", "monthly_take_home_minor").expect("present")
        )
        .expect("read back"),
        "5000000"
    );

    // 7. `national_id_hash` is not a sealed value and must be untouched by a
    //    rotation; here it was never set, and it must still be NULL rather than
    //    having been filled in with ciphertext.
    assert_eq!(read_profile(&conn, "u-1", "national_id_hash"), None);
}

/// A row no candidate key can open is left byte-identical, reported, and does
/// NOT block the sweep.
///
/// The temptation is to treat it as a failure. That would make a rotation
/// impossible on any store that already holds one damaged row, while the row
/// itself is unaffected either way: it was unopenable before the rotation and
/// retiring the outgoing key cannot make it more so. Both the sweep and the
/// verification reach it through the same `sealed_value` gate, so their counts
/// agree and the equality check passes.
///
/// Order-independent by construction: the fixture is ciphertext-shaped but
/// decrypts under no derivation, so it does not matter whether the install key
/// has been set by the time this runs.
#[test]
fn an_unopenable_row_is_left_byte_identical_and_does_not_block_the_sweep() {
    let conn = fresh_db();
    // Valid base64 of 48 bytes, so it passes the crate's ciphertext shape test,
    // and it is not a real envelope — no candidate key opens it.
    let damaged = "A".repeat(64);
    set_setting(&conn, keys::SYNC_API_KEY, &damaged);

    let outcome = rotate_at_rest_rows(&conn).expect("a damaged row must not abort the sweep");

    assert_eq!(outcome.swept.settings_rows, 1);
    assert_eq!(outcome.swept.rewritten, 0);
    assert_eq!(
        outcome.swept.unreadable, 1,
        "the sweep reports the row it could not read"
    );
    assert_eq!(
        outcome.verified.not_under_current, 1,
        "and the verification counts the same row, so the two agree"
    );
    assert_eq!(
        read_setting(&conn, keys::SYNC_API_KEY),
        damaged,
        "an unopenable row is left exactly as it was: destroying it would be worse \
         than leaving it, because a key restore could still read it"
    );
}
