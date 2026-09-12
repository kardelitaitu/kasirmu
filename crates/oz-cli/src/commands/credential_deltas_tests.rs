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
