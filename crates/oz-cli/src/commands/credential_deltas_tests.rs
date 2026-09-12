//! Tests for `oz credential-deltas`.
//!
//! The one that decides whether this command is safe to ship is
//! `purge_restarts_the_version_sequence_and_the_tracked_writer_tolerates_it`:
//! deleting a key's rows restarts its version at 1, so the command is only
//! defensible if the production writer still succeeds afterwards and
//! allocates from one.

use super::*;
use rusqlite::Connection;

use oz_core::settings::Settings;
use oz_core::settings::keys::{
    SECRET_KEY_DENY_LIST, SMTP_CONFIG, STORE_NAME, STRIPE_API_KEY, SYNC_API_KEY,
    is_secret_setting_key,
};

fn fresh_db() -> Connection {
    oz_core::migrations::fresh_db()
}

fn delta_row_count(conn: &Connection, key: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM setting_updated WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    )
    .unwrap()
}

fn total_ledger_rows(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM setting_updated", [], |row| row.get(0))
        .unwrap()
}

/// THE deciding test: after the purge, a tracked write for the same key must
/// still succeed and allocate a version from one. `smtp_config` is the only
/// deny-listed key the tracked funnel still writes in production (the
/// cleartext-credential exception), so this is the real lane, not a
/// synthetic one.
#[test]
fn purge_restarts_the_version_sequence_and_the_tracked_writer_tolerates_it() {
    let conn = fresh_db();
    for _ in 0..3 {
        Settings::set_tracked(&conn, SMTP_CONFIG, "smtp-blob-1", "term-1").unwrap();
    }
    assert_eq!(
        Settings::get_version(&conn, SMTP_CONFIG, "term-1").unwrap(),
        Some(3),
        "precondition: three deltas, latest version 3"
    );

    let deleted = purge_credential_deltas(&conn).unwrap();
    assert_eq!(
        total_rows(&deleted),
        3,
        "the purge must report the rows it deleted"
    );
    assert_eq!(
        Settings::get_version(&conn, SMTP_CONFIG, "term-1").unwrap(),
        None,
        "the key's ledger must be empty after the purge"
    );

    // The writer must tolerate the restarted sequence.
    Settings::set_tracked(&conn, SMTP_CONFIG, "smtp-blob-2", "term-1")
        .expect("a tracked write after the purge must still succeed");
    assert_eq!(
        Settings::get_version(&conn, SMTP_CONFIG, "term-1").unwrap(),
        Some(1),
        "the version sequence restarts at one"
    );
    assert_eq!(
        delta_row_count(&conn, SMTP_CONFIG),
        1,
        "exactly one fresh delta row exists after the post-purge write"
    );
    assert_eq!(
        Settings::get(&conn, SMTP_CONFIG).unwrap().as_deref(),
        Some("smtp-blob-2"),
        "the live settings row is untouched by the purge and updated by the write"
    );
}

/// A second terminal for the same key also restarts cleanly, and the UNIQUE
/// index on (key, terminal_id, version) does not reject the new sequence.
#[test]
fn purge_restarts_every_terminal_pair_independently() {
    let conn = fresh_db();
    for term in ["term-a", "term-b"] {
        for _ in 0..2 {
            Settings::set_tracked(&conn, SMTP_CONFIG, "blob", term).unwrap();
        }
    }
    assert_eq!(total_ledger_rows(&conn), 4);
    purge_credential_deltas(&conn).unwrap();
    assert_eq!(total_ledger_rows(&conn), 0);
    for term in ["term-a", "term-b"] {
        Settings::set_tracked(&conn, SMTP_CONFIG, "blob", term).unwrap();
        assert_eq!(
            Settings::get_version(&conn, SMTP_CONFIG, term).unwrap(),
            Some(1),
            "{term} restarts at one"
        );
    }
}

/// Matching is by key name against the imported deny list: an ordinary key's
/// rows survive, a deny-listed key's rows are the only ones counted.
#[test]
fn scan_and_purge_touch_only_deny_listed_keys() {
    let conn = fresh_db();
    Settings::set_tracked(&conn, STORE_NAME, "Outlet Kopi", "term-1").unwrap();
    Settings::set_tracked(&conn, STORE_NAME, "Outlet Teh", "term-1").unwrap();
    Settings::write_delta(&conn, SYNC_API_KEY, "plaintext-looking-value", "term-1").unwrap();

    let found = scan_credential_deltas(&conn).unwrap();
    assert_eq!(
        found,
        vec![(SYNC_API_KEY, 1usize)],
        "only the deny-listed key is reported"
    );
    for (key, _) in &found {
        assert!(
            is_secret_setting_key(key),
            "reported key {key} must satisfy the shared predicate"
        );
    }

    let deleted = purge_credential_deltas(&conn).unwrap();
    assert_eq!(total_rows(&deleted), 1);
    assert_eq!(delta_row_count(&conn, SYNC_API_KEY), 0);
    assert_eq!(
        delta_row_count(&conn, STORE_NAME),
        2,
        "non-credential ledger rows are out of scope and must survive"
    );
    assert_eq!(
        Settings::get(&conn, STORE_NAME).unwrap().as_deref(),
        Some("Outlet Teh"),
        "the live settings table is never touched"
    );
}

/// A bare invocation must not delete: the confirmation flag is the only
/// write door.
#[test]
fn bare_invocation_reports_and_deletes_nothing() {
    let conn = fresh_db();
    Settings::write_delta(&conn, SYNC_API_KEY, "v", "term-1").unwrap();

    run_credential_deltas(&conn, &CredentialDeltasArgs { confirm: false }).unwrap();

    assert_eq!(
        delta_row_count(&conn, SYNC_API_KEY),
        1,
        "without --confirm nothing may be deleted"
    );
}

/// The confirmation path deletes in one transaction and reports per key.
#[test]
fn confirm_invocation_deletes_and_reports_per_key_counts() {
    let conn = fresh_db();
    for _ in 0..2 {
        Settings::write_delta(&conn, SYNC_API_KEY, "v", "term-1").unwrap();
    }
    Settings::write_delta(&conn, SMTP_CONFIG, "v", "term-1").unwrap();

    run_credential_deltas(&conn, &CredentialDeltasArgs { confirm: true }).unwrap();

    assert_eq!(total_ledger_rows(&conn), 0);
    assert!(conn.is_autocommit(), "the purge transaction must be closed");
}

/// No value is ever echoed: not by the per-key lines, not by the help text,
/// not by the notices.
#[test]
fn no_value_is_ever_printed_or_carried_in_the_output_text() {
    let secret = "SHOULD-NEVER-APPEAR-44-chars-base64-lookalike";
    let conn = fresh_db();
    Settings::write_delta(&conn, SYNC_API_KEY, secret, "term-1").unwrap();

    let found = scan_credential_deltas(&conn).unwrap();
    let lines = format_delta_counts(&found);
    assert_eq!(lines.len(), 1);
    assert!(lines[0].contains(SYNC_API_KEY), "the key name is printed");
    for text in [
        &lines[0],
        SAFETY_BASIS,
        RESTART_WARNING,
        HYGIENE_NOT_REMEDIATION,
        HELP_HEAD,
        HELP_SCOPE,
        LONG_HELP.as_str(),
    ] {
        assert!(
            !text.contains(secret),
            "a ledger value must never reach the output"
        );
    }
    run_credential_deltas(&conn, &CredentialDeltasArgs { confirm: true }).unwrap();
    assert_eq!(total_ledger_rows(&conn), 0);
}

/// THE CRITICAL TEST: the ledger `key` column is bare TEXT under BINARY
/// collation, so a row written as `STRIPE.API_KEY` or `stripe.api_key ` is a
/// distinct row that the deny-list constant matches neither by an SQL
/// comparison nor by a hand-written `deny_key == key.as_str()`. The shared
/// predicate `is_secret_setting_key` DOES match it — so until the tool asks
/// the predicate, it reports zero for exactly the rows that carry cleartext.
#[test]
fn scan_and_purge_reach_variant_spellings_of_a_deny_listed_key() {
    let conn = fresh_db();
    // Two near-miss spellings of one deny-listed key, plus a non-credential
    // row that must survive both passes.
    Settings::write_delta(&conn, "STRIPE.API_KEY", "cleartext-upper", "term-1").unwrap();
    Settings::write_delta(&conn, "stripe.api_key ", "cleartext-padded", "term-1").unwrap();
    Settings::write_delta(&conn, STORE_NAME, "Outlet Kopi", "term-1").unwrap();
    // Fixture repair (was missing, so the "live settings row is untouched"
    // assertion below was vacuous — `write_delta` writes ONLY the ledger, never
    // the `settings` table): seed the live row so "untouched" can be observed.
    Settings::set(&conn, STORE_NAME, "Outlet Kopi").unwrap();
    for key in ["STRIPE.API_KEY", "stripe.api_key "] {
        assert!(
            is_secret_setting_key(key),
            "precondition: the shared predicate must see {key:?}"
        );
    }
    assert_eq!(
        delta_row_count(&conn, STRIPE_API_KEY),
        0,
        "precondition: no row is stored under the exact deny-list spelling"
    );

    let found = scan_credential_deltas(&conn).unwrap();
    assert_eq!(
        total_rows(&found),
        2,
        "the scan must count both variant spellings, got {found:?}"
    );
    assert_eq!(
        delta_row_count(&conn, STORE_NAME),
        1,
        "the scan must not have touched the non-credential row"
    );

    let deleted = purge_credential_deltas(&conn).unwrap();
    assert_eq!(
        total_rows(&deleted),
        2,
        "the delete must remove both variant spellings, got {deleted:?}"
    );
    assert_eq!(delta_row_count(&conn, "STRIPE.API_KEY"), 0);
    assert_eq!(delta_row_count(&conn, "stripe.api_key "), 0);
    assert_eq!(
        delta_row_count(&conn, STORE_NAME),
        1,
        "a non-credential ledger row survives the purge"
    );
    assert_eq!(
        Settings::get(&conn, STORE_NAME).unwrap().as_deref(),
        Some("Outlet Kopi"),
        "the live settings row is untouched"
    );
}

/// The same hole on the operator path: a bare invocation must not print
/// "nothing to delete" while two cleartext credential rows sit in the table.
#[test]
fn a_bare_scan_reports_variant_spellings_instead_of_zero() {
    let conn = fresh_db();
    Settings::write_delta(&conn, "STRIPE.API_KEY", "cleartext-upper", "term-1").unwrap();
    Settings::write_delta(&conn, "stripe.api_key ", "cleartext-padded", "term-1").unwrap();
    Settings::write_delta(&conn, STORE_NAME, "Outlet Kopi", "term-1").unwrap();

    run_credential_deltas(&conn, &CredentialDeltasArgs { confirm: false }).unwrap();
    let found = scan_credential_deltas(&conn).unwrap();
    assert_eq!(
        total_rows(&found),
        2,
        "the reported count is the thing that can lie"
    );
    assert_eq!(
        total_ledger_rows(&conn),
        3,
        "a bare invocation deletes nothing, variant spellings included"
    );
}

/// The pair can never drift again: one run counts a variant spelling AND
/// deletes it, and the two numbers are the same number. This replaces
/// `delete_path_warning_fires_only_on_a_non_zero_count_and_names_the_lag`,
/// which existed only to warn that the delete lagged the count — the delete now
/// routes through the same shared predicate, so that warning would have been
/// false, and a test asserting a false thing is worse than no test.
#[test]
fn a_counted_variant_spelling_is_deleted_in_the_same_run() {
    let conn = fresh_db();
    // Two variant spellings of one deny-listed key, plus a non-credential row
    // that must survive both passes.
    Settings::write_delta(&conn, "STRIPE.API_KEY", "cleartext-upper", "term-1").unwrap();
    Settings::write_delta(&conn, "stripe.api_key ", "cleartext-padded", "term-1").unwrap();
    Settings::write_delta(&conn, STORE_NAME, "Outlet Kopi", "term-1").unwrap();

    let found = scan_credential_deltas(&conn).unwrap();
    assert_eq!(
        found,
        vec![(STRIPE_API_KEY, 2usize)],
        "both spellings fold onto the one canonical key for reporting"
    );

    let deleted = purge_credential_deltas(&conn).unwrap();
    assert_eq!(
        total_rows(&deleted),
        total_rows(&found),
        "the delete must remove exactly what the count counted"
    );
    assert_eq!(
        deleted, found,
        "same keys, same per-key counts — the pair cannot drift apart silently"
    );
    assert_eq!(delta_row_count(&conn, "STRIPE.API_KEY"), 0);
    assert_eq!(delta_row_count(&conn, "stripe.api_key "), 0);
    assert_eq!(
        delta_row_count(&conn, STORE_NAME),
        1,
        "a non-credential ledger row is neither counted nor deleted"
    );
    assert_eq!(
        total_rows(&scan_credential_deltas(&conn).unwrap()),
        0,
        "re-scanning after the purge finds nothing left to delete"
    );
}

/// The command must key off the shared constant, not a local copy: every
/// entry of the imported list is a delete candidate.
#[test]
fn every_deny_listed_key_is_a_delete_candidate() {
    let conn = fresh_db();
    for key in SECRET_KEY_DENY_LIST {
        Settings::write_delta(&conn, key, "v", "term-1").unwrap();
    }
    let found = scan_credential_deltas(&conn).unwrap();
    assert_eq!(
        found.len(),
        SECRET_KEY_DENY_LIST.len(),
        "the scan must see every deny-listed key"
    );
    let deleted = purge_credential_deltas(&conn).unwrap();
    assert_eq!(total_rows(&deleted), SECRET_KEY_DENY_LIST.len());
    assert_eq!(total_ledger_rows(&conn), 0);
}

// -- The live settings census (report-only, never deletable) -----------------

/// A sentinel that no production writer would ever store: if it shows up in the
/// rendered report, a value leaked.
const CENSUS_SENTINEL: &str = "CENSUS-SENTINEL-never-print-44-chars-lookalike";

/// The census answers the question the ledger never could: how many credential
/// rows sit in the table the app actually reads.
#[test]
fn settings_census_counts_a_live_cleartext_row_by_key_and_form() {
    let conn = fresh_db();
    Settings::set(&conn, STRIPE_API_KEY, CENSUS_SENTINEL).unwrap();
    Settings::set(&conn, STORE_NAME, "Outlet Kopi").unwrap();

    let rows = scan_credential_settings(&conn).unwrap();
    assert_eq!(
        total_settings_rows(&rows),
        1,
        "only the deny-listed key is censused, got {rows:?}"
    );
    assert_eq!(rows[0].key, STRIPE_API_KEY);
    assert_eq!(
        total_cleartext_rows(&rows),
        1,
        "a key with no crypto family cannot have sealed this row, so it is cleartext"
    );
    let lines = format_setting_counts(&rows);
    assert_eq!(lines.len(), 1);
    assert!(
        lines[0].contains(STRIPE_API_KEY) && lines[0].contains("form ="),
        "the line names the key and carries a form column: {}",
        lines[0]
    );
    for text in &lines {
        assert!(
            !text.contains(CENSUS_SENTINEL),
            "the census printed a value: {text}"
        );
    }
}

/// THE CONSERVATISM ASSERTION: a live settings row for a deny-listed key is
/// REPORTED and NOT DELETED even under --confirm, while the ledger rows for the
/// same key do go. Without this, the census reads as a dry run for a purge of
/// the table the app is running on.
#[test]
fn confirm_deletes_the_ledger_rows_and_leaves_every_settings_row_alone() {
    let conn = fresh_db();
    for key in [STRIPE_API_KEY, SYNC_API_KEY] {
        Settings::set(&conn, key, CENSUS_SENTINEL).unwrap();
        Settings::write_delta(&conn, key, CENSUS_SENTINEL, "term-1").unwrap();
    }
    assert_eq!(
        total_settings_rows(&scan_credential_settings(&conn).unwrap()),
        2,
        "precondition: both live rows are reported"
    );

    run_credential_deltas(&conn, &CredentialDeltasArgs { confirm: true }).unwrap();

    for key in [STRIPE_API_KEY, SYNC_API_KEY] {
        assert_eq!(
            Settings::get(&conn, key).unwrap().as_deref(),
            Some(CENSUS_SENTINEL),
            "--confirm must not delete or blank the live settings row for {key}"
        );
        assert_eq!(
            delta_row_count(&conn, key),
            0,
            "the ledger row for {key} is the only thing this command may delete"
        );
    }
    assert_eq!(
        total_settings_rows(&scan_credential_settings(&conn).unwrap()),
        2,
        "the settings census is unchanged by the purge"
    );
}

/// The form column is the point, so it must disagree when the data does: an
/// encrypted row reads encrypted, a legacy plaintext row on a sealed key reads
/// LEGACY-PLAINTEXT, and a hand-authored value that merely LOOKS like
/// ciphertext reads INVALID instead of being resolved into the cleartext
/// headline. Printing the ambiguity is required behaviour.
#[test]
fn the_form_column_separates_encrypted_from_legacy_plaintext_from_ambiguous() {
    let conn = fresh_db();
    Settings::set_sync_api_key(&conn, "sealed-sync-key").unwrap();
    let rows = scan_credential_settings(&conn).unwrap();
    assert_eq!(
        rows[0].forms,
        vec![(StoredForm::Encrypted, 1)],
        "a row the family authenticates reads encrypted, got {rows:?}"
    );
    assert_eq!(total_cleartext_rows(&rows), 0);

    Settings::set(&conn, SYNC_API_KEY, "legacy-plaintext-before-2026-08-29").unwrap();
    let rows = scan_credential_settings(&conn).unwrap();
    assert_eq!(
        total_cleartext_rows(&rows),
        1,
        "the legacy row on a sealed key is the cleartext this census exists to count: {rows:?}"
    );

    let decoy = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    Settings::set(&conn, SYNC_API_KEY, decoy).unwrap();
    let rows = scan_credential_settings(&conn).unwrap();
    assert_eq!(
        rows[0].forms,
        vec![(StoredForm::Invalid, 1)],
        "ciphertext-shaped but undecryptable must read INVALID, never cleartext: {rows:?}"
    );
    assert_eq!(
        total_cleartext_rows(&rows),
        0,
        "the ambiguous row is NOT resolved into the cleartext headline"
    );
    assert!(
        !format_setting_counts(&rows)[0].contains(decoy),
        "the ambiguity is printed as a label, never as the value"
    );
}

/// A mistyped --db is created EMPTY by Connection::open, so the old behaviour
/// was a confident zero about a file that did not exist a moment ago. The run
/// now refuses before it can reassure anyone, and names the path.
#[test]
fn a_database_with_no_settings_table_is_refused_naming_the_path() {
    let dir = std::env::temp_dir().join(format!("oz-census-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("ghost.db");
    let _ = std::fs::remove_file(&path);
    let conn = Connection::open(&path).unwrap();

    let err = require_store_database(&conn).expect_err("an empty database must be refused");
    let msg = err.to_string();
    assert!(
        msg.contains("ghost.db") && msg.contains(SETTINGS_TABLE),
        "the refusal must name the path and the missing table, got: {msg}"
    );
    assert!(
        msg.contains("oz backup"),
        "the refusal must name the way to take a copy, got: {msg}"
    );

    let run_err = run_credential_deltas(&conn, &CredentialDeltasArgs { confirm: true })
        .expect_err("the command must refuse the empty database too");
    assert!(
        run_err.to_string().contains("ghost.db"),
        "the operator must see which path was refused: {run_err}"
    );
    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

/// The two populations stay apart in the text as well as in the code, and the
/// stale count pair must not come back.
#[test]
fn the_report_keeps_ledger_and_settings_totals_apart_and_says_why() {
    let conn = fresh_db();
    Settings::set(&conn, STRIPE_API_KEY, CENSUS_SENTINEL).unwrap();
    for _ in 0..3 {
        Settings::write_delta(&conn, STRIPE_API_KEY, CENSUS_SENTINEL, "term-1").unwrap();
    }

    let ledger = total_rows(&scan_credential_deltas(&conn).unwrap());
    let settings = total_settings_rows(&scan_credential_settings(&conn).unwrap());
    assert_eq!(
        (ledger, settings),
        (3, 1),
        "three historical rows and one row in use: one key, two different questions"
    );
    for text in [
        LEDGER_TOTAL_IS_NOT_A_MACHINE_COUNT,
        SETTINGS_REPORT_ONLY,
        HELP_BYTES_NOT_CONTENT,
        LEGACY_PLAINTEXT_NOTE,
        LONG_HELP.as_str(),
    ] {
        assert!(
            !text.contains(CENSUS_SENTINEL),
            "no notice may carry a stored value"
        );
    }
    assert!(
        HELP_BYTES_NOT_CONTENT.contains("journal_mode=WAL")
            && HELP_BYTES_NOT_CONTENT.contains("oz backup"),
        "the byte-level caveat must name the pragma and the copy command"
    );
    assert!(
        SETTINGS_REPORT_ONLY.contains("smtp_config")
            && SETTINGS_REPORT_ONLY.to_lowercase().contains("inert"),
        "the report-only line must say WHY settings is never purged"
    );
    assert!(
        !HYGIENE_NOT_REMEDIATION.contains("fourteen")
            && !HYGIENE_NOT_REMEDIATION.contains("nine of"),
        "the rotted count pair must not come back"
    );
}

// -- The first line of defence: refuse a path it would have to create -------

/// THE case that separates the fix from the decoration: the refusal must name
/// the path AND the file must not exist afterwards. Asserting only the message
/// would pass with the ghost database still being written, which is the whole
/// bug. Measured before this guard existed: a mistyped --db left a real file
/// behind and the run reported confident zeroes about it.
#[test]
fn a_missing_db_path_is_refused_and_NOT_created() {
    let dir = std::env::temp_dir().join(format!("oz-cd-missing-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("mistyped.db");
    let _ = std::fs::remove_file(&path);
    assert!(!path.exists(), "precondition: the path must not exist");

    let err = crate::commands::open_store_for_credential_deltas(&path.to_string_lossy())
        .expect_err("a path that does not exist must be refused, not opened");
    let msg = err.to_string();
    assert!(
        msg.contains("mistyped.db"),
        "the refusal must name the path: {msg}"
    );
    assert!(
        msg.contains("would have to create"),
        "the refusal must say the create is the reason: {msg}"
    );
    assert!(
        msg.contains("oz backup"),
        "the refusal must name the way to inspect a live store safely: {msg}"
    );
    assert!(
        msg.contains("Nothing was created"),
        "and what it did not do: {msg}"
    );

    // The load-bearing half: absence, not wording.
    assert!(
        !path.exists(),
        "the refused call must NOT have created {path:?}"
    );
    for sidecar in ["mistyped.db-wal", "mistyped.db-shm"] {
        assert!(
            !dir.join(sidecar).exists(),
            "no sidecar may be created beside a refused path: {sidecar}"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// The two guards are different failures and must read differently: a file that
/// EXISTS but holds no settings table is refused by the second line of defence,
/// which must not claim the file was missing, and the first must not claim a
/// missing table.
#[test]
fn an_existing_file_with_no_tables_is_refused_by_the_second_guard_not_the_first() {
    let dir = std::env::temp_dir().join(format!("oz-cd-empty-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("hollow.db");
    let _ = std::fs::remove_file(&path);
    // Make the file EXIST, as a valid empty database: this is exactly the ghost
    // Connection::open leaves behind for a mistyped --db, so the PATH guard cannot
    // be what refuses it here.
    Connection::open(&path)
        .unwrap()
        .execute_batch("PRAGMA user_version = 1;")
        .unwrap();

    let opened = crate::commands::open_store_for_credential_deltas(&path.to_string_lossy());
    assert!(
        opened.is_ok(),
        "an existing path must pass the create-guard and be opened: {opened:?}"
    );
    let conn = opened.unwrap();
    let err = require_store_database(&conn).expect_err("a hollow file is not a store");
    let msg = err.to_string();
    assert!(
        msg.contains("hollow.db"),
        "the second refusal names the path: {msg}"
    );
    assert!(
        msg.contains(SETTINGS_TABLE),
        "and says WHICH failure this is: a missing table, not a missing file: {msg}"
    );
    assert!(
        !msg.contains("would have to create"),
        "the table-guard must not impersonate the path-guard: {msg}"
    );
    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}
// -- The machine-bound blind spot: listed, not tested -----------------------

/// license.api_key is encrypted with the MACHINE-BOUND api_key family
/// (crates/oz-bridge/src/license.rs:151 passes the installation machine id into
/// encrypt_api_key), so a portable-only classifier labelled the row CLEARTEXT
/// with the note that no family can seal it — false, and it landed inside the
/// cleartext headline, over-stating exposure on exactly the credential a real
/// install is most likely to hold. Such a row is now listed and NOT tested: a
/// tool that reads the fingerprint to decrypt credentials is a worse instrument
/// than one that under-claims.
#[test]
fn a_machine_bound_row_is_listed_as_untested_and_never_counted_cleartext() {
    use oz_core::settings::keys::LICENSE_API_KEY;
    let conn = fresh_db();
    let sealed =
        oz_core::crypto::encrypt_api_key("license-key-never-printed", "machine-fp-demo").unwrap();
    Settings::set(&conn, LICENSE_API_KEY, &sealed).unwrap();

    let rows = scan_credential_settings(&conn).unwrap();
    assert_eq!(rows.len(), 1, "license.api_key is deny-listed: {rows:?}");
    assert_eq!(rows[0].key, LICENSE_API_KEY);
    assert_eq!(
        rows[0].forms,
        vec![(StoredForm::MachineBoundUntested, 1)],
        "a machine-bound row must be UNTESTED, not INVALID or cleartext: {rows:?}"
    );
    assert_eq!(
        total_cleartext_rows(&rows),
        0,
        "the whole point: a machine-bound row must never reach the cleartext headline"
    );
    assert_eq!(total_untested_rows(&rows), 1);
    assert_eq!(total_excluded_rows(&rows), 1);
    let line = &format_setting_counts(&rows)[0];
    assert!(
        line.contains(LICENSE_API_KEY) && line.contains("UNTESTED-BY-THIS-TOOL"),
        "the row is still LISTED, with its form: {line}"
    );
    assert!(
        !line.contains(&sealed) && !line.contains("license-key-never-printed"),
        "and listing it must not print the value or its ciphertext: {line}"
    );
}

/// The other half of the same blindness, and the half that keeps the first test
/// honest: a genuinely plaintext license.api_key row — legal on an install
/// predating the sealing, and the case license.rs:121 handles by falling back to
/// legacy plaintext — is reported EXACTLY the same way. Telling those two rows
/// apart needs the fingerprint, so the tool does not claim either, and the
/// control proves that is a machine-bound rule rather than a blanket refusal.
#[test]
fn a_plaintext_machine_bound_row_reads_the_same_because_the_tool_cannot_tell() {
    use oz_core::settings::keys::LICENSE_API_KEY;
    let conn = fresh_db();
    Settings::set(&conn, LICENSE_API_KEY, "sk_live_handed_in_cleartext").unwrap();

    let rows = scan_credential_settings(&conn).unwrap();
    assert_eq!(
        rows[0].forms,
        vec![(StoredForm::MachineBoundUntested, 1)],
        "plaintext on a machine-bound key must not be reported as proof: {rows:?}"
    );
    assert_eq!(
        total_cleartext_rows(&rows),
        0,
        "untested is not cleartext, and the headline under-claims on purpose"
    );
    assert_eq!(total_untested_rows(&rows), 1);

    // Control: a key with NO family anywhere is still claimed cleartext, so the
    // exclusion above is the machine-bound rule and not the tool refusing to say
    // anything at all.
    Settings::set(&conn, STRIPE_API_KEY, "sk_live_handed_in_cleartext").unwrap();
    let rows = scan_credential_settings(&conn).unwrap();
    assert_eq!(
        total_cleartext_rows(&rows),
        1,
        "stripe.api_key has no family in any lane, so its cleartext IS claimable"
    );
    assert_eq!(
        total_untested_rows(&rows),
        1,
        "and only the machine-bound row is excluded"
    );
}

/// The report has to say the excluded count is not zero and what exclusion
/// means, or two totals with a gap between them read as a rounding difference.
#[test]
fn the_report_states_what_an_excluded_row_means() {
    assert!(
        EXCLUDED_ROWS_NOTE.contains("NON-ZERO excluded count is the normal case"),
        "the note must say a non-zero exclusion is expected, not clean"
    );
    assert!(
        EXCLUDED_ROWS_NOTE.contains("saying it cannot tell")
            && EXCLUDED_ROWS_NOTE.contains("NOT the same as saying it is sealed"),
        "and it must say what excluded means: {EXCLUDED_ROWS_NOTE}"
    );
    assert!(
        LONG_HELP.as_str().contains("REPORTED AND NOT PURGED"),
        "the help text carries the same report-only promise the run prints"
    );
}
