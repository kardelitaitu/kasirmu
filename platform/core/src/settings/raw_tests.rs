//! Tests for the sealed ingest policy and the funnelled settings accessors.
//!
//! These prove the CONTRACT, not any lane's behaviour. Two of the three
//! funnelled accessors do have production callers now — `set_with_policy` from
//! sync ingest (`platform/sync/src/queue.rs:531` and `:702`, RemoteSync) and
//! from the bridge restore door (`crates/oz-bridge/src/data.rs:704`,
//! PortablePackage), and `load_exportable` from the bridge export door
//! (`data.rs:401`) — while `set_batch_with_policy` still has none, because the
//! CLI `.ozpkg` lane asks the policy directly and has no platform-core
//! dependency edge. Each of those lanes pins its own behaviour in its own
//! suite, so the questions here are only (a) does a refusal refuse, (b) is it
//! the POLICY doing the filtering rather than the predicate alone, and (c) does
//! the unfiltered `load_all` still see every row, which is what keeps feature
//! pruning alive. Helpers come from `settings::test_helpers::fresh`, the same
//! in-memory `settings` table the rest of this module's tests use.

use super::*;
use crate::settings::keys;
use crate::settings::test_helpers::fresh;

/// A refusal refuses: `RemoteSync` must not write a deny-listed key, and the
/// row that was already there must survive untouched.
#[test]
fn remote_sync_refusal_writes_nothing_and_keeps_the_existing_value() {
    let conn = fresh();
    Settings::set(&conn, keys::MACHINE_ID, "own-machine-fingerprint").unwrap();

    let written = Settings::set_with_policy(
        &conn,
        keys::MACHINE_ID,
        "from-foreign-source",
        IngestPolicy::RemoteSync,
    )
    .unwrap();
    assert!(
        !written,
        "RemoteSync must refuse machine_id, the device-bound KDF factor"
    );
    assert_eq!(
        Settings::get(&conn, keys::MACHINE_ID).unwrap().as_deref(),
        Some("own-machine-fingerprint"),
        "a refusal must leave the pre-existing value byte-identical"
    );
}

/// The same key under the same predicate, admitted: it is the POLICY that
/// filters, not the predicate. Without this pair the first test could be
/// satisfied by an accessor that refuses everything.
#[test]
fn trusted_local_admits_the_key_the_other_policies_refuse() {
    let conn = fresh();
    let written = Settings::set_with_policy(
        &conn,
        keys::MACHINE_ID,
        "minted-locally",
        IngestPolicy::TrustedLocal,
    )
    .unwrap();
    assert!(written, "TrustedLocal is the lane that owns these keys");
    assert_eq!(
        Settings::get(&conn, keys::MACHINE_ID).unwrap().as_deref(),
        Some("minted-locally")
    );
    // And the two untrusted policies refuse that very key on the same row.
    for policy in [IngestPolicy::PortablePackage, IngestPolicy::RemoteSync] {
        let refused = Settings::set_with_policy(&conn, keys::MACHINE_ID, "x", policy).unwrap();
        assert!(!refused, "{:?} must refuse machine_id", policy);
        assert_eq!(
            Settings::get(&conn, keys::MACHINE_ID).unwrap().as_deref(),
            Some("minted-locally"),
            "the refusal must not have touched the value"
        );
    }
}

/// `load_exportable` is a strict subset of `load_all`, and `load_all` is
/// UNCHANGED. The second half is the load-bearing one: `load_all` is also the
/// internal accessor behind `load_features` / `prune_stale_features`, so if
/// anyone ever "simplifies" the two functions together, feature pruning starts
/// reading a filtered table and this assertion is what catches it.
#[test]
fn load_exportable_is_a_strict_subset_and_load_all_still_sees_everything() {
    let conn = fresh();
    Settings::set(&conn, keys::STORE_NAME, "Warung Sedap").unwrap();
    let guarded: Vec<&str> = keys::SECRET_KEY_DENY_LIST
        .iter()
        .chain(keys::NON_EXPORTABLE_DEVICE_KEYS.iter())
        .copied()
        .collect();
    assert!(!guarded.is_empty(), "the shared lists must be populated");
    for key in &guarded {
        Settings::set(&conn, key, "value").unwrap();
    }

    let all = Settings::load_all(&conn).unwrap();
    let portable = Settings::load_exportable(&conn).unwrap();

    // load_all: every row, guarded ones included — the internal accessor is
    // not an egress surface.
    assert_eq!(
        all.len(),
        guarded.len() + 1,
        "load_all must return every row"
    );
    for key in &guarded {
        assert!(all.iter().any(|(k, _)| k == key), "load_all lost {key}");
    }
    // load_exportable: the ordinary row survives, nothing guarded travels.
    assert_eq!(portable.len(), 1, "only the ordinary row may be exported");
    assert_eq!(portable[0].0, keys::STORE_NAME);
    assert_eq!(portable[0].1, "Warung Sedap", "and it keeps its value");
    for key in &guarded {
        assert!(
            !portable.iter().any(|(k, _)| k == key),
            "load_exportable leaked {key}"
        );
    }
    assert!(portable.len() < all.len(), "strict subset");
}

/// Warn-and-continue at batch scale: a mixed batch under a filtering policy
/// returns `Ok(())`, writes the permitted rows, and skips the refused ones —
/// no abort, no error, no counter.
#[test]
fn set_batch_with_policy_writes_permitted_rows_and_skips_refused_ones() {
    let conn = fresh();
    Settings::set(&conn, keys::LOCAL_API_SECRET, "own-secret").unwrap();
    let rows: Vec<(String, String)> = [
        (keys::STORE_NAME, "Packaged Store"),
        (keys::DEFAULT_CURRENCY, "IDR"),
        (keys::LOCAL_API_SECRET, "from-package"),
        (keys::SYNC_TERMINAL_SECRET, "from-package"),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();

    let tx = conn.unchecked_transaction().unwrap();
    Settings::set_batch_with_policy(&tx, &rows, IngestPolicy::PortablePackage).unwrap();
    tx.commit().unwrap();

    assert_eq!(
        Settings::get(&conn, keys::STORE_NAME).unwrap().as_deref(),
        Some("Packaged Store")
    );
    assert_eq!(
        Settings::get(&conn, keys::DEFAULT_CURRENCY)
            .unwrap()
            .as_deref(),
        Some("IDR")
    );
    assert_eq!(
        Settings::get(&conn, keys::LOCAL_API_SECRET)
            .unwrap()
            .as_deref(),
        Some("own-secret"),
        "the refused row must not have been written"
    );
    assert_eq!(
        Settings::get(&conn, keys::SYNC_TERMINAL_SECRET)
            .unwrap()
            .as_deref(),
        None,
        "a refused key must not be created either"
    );
}

/// The asymmetry this policy deliberately encodes: the lifecycle-manager
/// prefixes (`local_api.*`, `lan_server.*`) are refused by the untrusted
/// policies and admitted locally.
///
/// Every lane asks the ONE predicate now, which is what this test pins:
/// `Settings::load_exportable` and both ingest arms reach it through
/// [`IngestPolicyKind::admits`] (so the GUI export, the CLI `.ozpkg` gate in
/// `crates/oz-cli/src/commands/ozpkg.rs` and sync ingest in
/// `platform/sync/src/queue.rs` all refuse it), the tablet write funnel calls
/// `is_manager_owned_key` directly, and the desktop bridge refuses through its
/// `managed_key_owner` in `crates/oz-bridge/src/settings.rs` — which adds only
/// the owner label the refusal message shows and keeps no prefix of its own.
/// No lane carries a prefix list, so a third manager-owned prefix joins this
/// predicate and refuses everywhere at once. There is no bridge-local
/// `is_managed_key` to grep for: it was the duplicate, and it is deleted.
#[test]
fn manager_owned_prefixes_follow_the_policy() {
    for key in ["local_api.enabled", "lan_server.bind", "local_api.secret"] {
        assert!(is_manager_owned_key(key), "{key} is manager-owned");
        assert!(!is_manager_owned_key(keys::STORE_NAME), "store.name is not");
        assert!(
            !IngestPolicy::PortablePackage.admits(key),
            "PortablePackage must refuse {key}"
        );
        assert!(
            !IngestPolicy::RemoteSync.admits(key),
            "RemoteSync must refuse {key}"
        );
        assert!(
            IngestPolicy::TrustedLocal.admits(key),
            "TrustedLocal must admit {key} — the managers write these themselves"
        );
    }
}

// ── Cleartext-credential refusal at the tracked funnel ───────────────────

/// The write face of the credential deny list: `set_tracked` — the one door
/// all three renderer-reachable funnels (desktop bridge single write, desktop
/// bridge batch, tablet set_setting) pass through — refuses every key on
/// [`keys::SECRET_KEY_DENY_LIST`] with an ERROR (not the ingest policy's
/// warn-and-skip), names the key in the message and never the value, and
/// writes nothing. Iterating the live list (minus the named exception) means
/// a deny-list key another worker registers is covered here the moment it
/// lands — that composition is intended, not a conflict.
#[test]
fn set_tracked_refuses_every_deny_listed_credential_as_an_error() {
    let conn = fresh();
    assert!(
        !keys::SECRET_KEY_DENY_LIST.is_empty(),
        "the shared deny list must be populated"
    );
    let mut refused = 0usize;
    for key in keys::SECRET_KEY_DENY_LIST {
        if *key == keys::SMTP_CONFIG {
            continue; // the one funnel-written exception, proven below
        }
        let err = Settings::set_tracked(&conn, key, "leaked-credential-value", "term-a")
            .expect_err("a deny-listed credential must be refused with an error");
        let msg = err.to_string();
        assert!(
            msg.contains(key),
            "the refusal must name the key, got: {msg}"
        );
        assert!(
            !msg.contains("leaked-credential-value"),
            "the refusal must never echo the value (log-lane leak), got: {msg}"
        );
        assert_eq!(
            Settings::get(&conn, key).unwrap(),
            None,
            "a refusal must not write the row"
        );
        refused += 1;
    }
    // A floor, not an exact count: the list grows, it does not shrink.
    assert!(
        refused >= 16,
        "the refusal must cover the real deny list, refused {refused}"
    );
}

/// Positive control for the refusal above: an ordinary key still writes
/// through the tracked funnel, so the guard cannot be satisfied by an
/// accessor that refuses everything.
#[test]
fn set_tracked_still_writes_ordinary_keys() {
    let conn = fresh();
    Settings::set_tracked(&conn, keys::STORE_NAME, "Warung Sedap", "term-a").unwrap();
    assert_eq!(
        Settings::get(&conn, keys::STORE_NAME).unwrap().as_deref(),
        Some("Warung Sedap")
    );
}

/// The named exception: `smtp_config` is deny-listed but legitimately
/// funnel-written — both shells merge its password JSON upstream and then
/// write the merged blob through the tracked path so the ADR #22 delta still
/// records the change — so the refusal must except it by name.
#[test]
fn set_tracked_exception_still_writes_smtp_config() {
    let conn = fresh();
    Settings::set_tracked(&conn, keys::SMTP_CONFIG, "{\"password\":\"pw\"}", "term-a").unwrap();
    assert_eq!(
        Settings::get(&conn, keys::SMTP_CONFIG).unwrap().as_deref(),
        Some("{\"password\":\"pw\"}")
    );
}

/// The batch door gets the same check: one deny-listed row aborts the whole
/// batch BEFORE any write (all-or-nothing, matching the bridge's
/// `run_set_settings_batch` guard), so `set_batch_tracked` cannot become
/// the new front door — the gap the census found once already.
#[test]
fn set_batch_tracked_refuses_a_deny_listed_row_before_any_write() {
    let conn = fresh();
    let rows: Vec<(String, String)> = vec![
        (keys::STORE_NAME.to_string(), "ok".to_string()),
        (
            keys::STRIPE_API_KEY.to_string(),
            "sk_live_leaked".to_string(),
        ),
    ];
    let err = Settings::set_batch_tracked(&conn, &rows, "term-a")
        .expect_err("a batch containing a deny-listed credential must be refused");
    let msg = err.to_string();
    assert!(
        msg.contains(keys::STRIPE_API_KEY),
        "the refusal must name the offending key, got: {msg}"
    );
    assert!(
        !msg.contains("sk_live_leaked"),
        "the refusal must never echo the value, got: {msg}"
    );
    assert_eq!(
        Settings::get(&conn, keys::STORE_NAME).unwrap(),
        None,
        "the refusal must happen before any row is written"
    );
    assert_eq!(
        Settings::get(&conn, keys::STRIPE_API_KEY).unwrap(),
        None,
        "the offending row must not be written either"
    );
}

// ── The in-transaction form: the canonical body the batch door calls ──────

/// A `settings` + `setting_updated` pair, the shape `set_tracked_in_tx` needs.
/// `test_helpers::fresh` gives the value table only, which is exactly right
/// for the delta-loss test below and wrong for the delta-written ones.
fn fresh_with_delta() -> rusqlite::Connection {
    let conn = fresh();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS setting_updated (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            key         TEXT    NOT NULL,
            value       TEXT    NOT NULL,
            terminal_id TEXT    NOT NULL DEFAULT 'unknown',
            version     INTEGER NOT NULL,
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );",
    )
    .unwrap();
    conn
}

/// The whole point of the in-tx form: it runs inside a transaction the caller
/// already owns. `set_tracked` cannot do this — it opens its own
/// `unchecked_transaction`, and the second BEGIN fails. If the extracted body
/// ever grows a transaction of its own, this test is the one that says so.
#[test]
fn set_tracked_in_tx_writes_value_and_delta_inside_the_callers_transaction() {
    let conn = fresh_with_delta();
    let tx = conn.unchecked_transaction().unwrap();
    Settings::set_tracked_in_tx(&tx, keys::STORE_NAME, "Warung Sedap", "term-a").unwrap();
    tx.commit().unwrap();
    assert_eq!(
        Settings::get(&conn, keys::STORE_NAME).unwrap().as_deref(),
        Some("Warung Sedap"),
        "the value write joined the caller's transaction"
    );
    assert_eq!(
        Settings::get_version(&conn, keys::STORE_NAME, "term-a").unwrap(),
        Some(1),
        "the delta write joined it too — ADR #22 owes one row per tracked write"
    );
}

/// The refusal is OWNED by the body, not by the wrapper: the in-tx form
/// refuses a deny-listed credential with the same error, naming the key and
/// never the value, and it does so without nesting a BEGIN.
#[test]
fn set_tracked_in_tx_refuses_a_deny_listed_credential_in_the_callers_transaction() {
    let conn = fresh_with_delta();
    let tx = conn.unchecked_transaction().unwrap();
    let err = Settings::set_tracked_in_tx(&tx, keys::STRIPE_API_KEY, "sk_live_leaked", "term-a")
        .expect_err("the in-tx form must carry the refusal, not just the wrapper");
    let msg = err.to_string();
    assert!(
        msg.contains(keys::STRIPE_API_KEY),
        "names the key, got: {msg}"
    );
    assert!(
        !msg.contains("sk_live_leaked"),
        "never echoes the value, got: {msg}"
    );
    // Commit ANYWAY: a rollback would hide a write that had already landed.
    tx.commit().unwrap();
    assert_eq!(
        Settings::get(&conn, keys::STRIPE_API_KEY).unwrap(),
        None,
        "a refusal must not write the row"
    );
    assert_eq!(
        Settings::get_version(&conn, keys::STRIPE_API_KEY, "term-a").unwrap(),
        None,
        "a refusal must not write a delta either"
    );
}

/// The named exception survives the extraction: the in-tx form must still
/// write `smtp_config`, or the email-report card's Save button breaks again
/// in the batch lane that now calls this door.
#[test]
fn set_tracked_in_tx_admits_the_smtp_exception() {
    let conn = fresh_with_delta();
    let tx = conn.unchecked_transaction().unwrap();
    Settings::set_tracked_in_tx(&tx, keys::SMTP_CONFIG, "{\"password\":\"pw\"}", "term-a").unwrap();
    tx.commit().unwrap();
    assert_eq!(
        Settings::get(&conn, keys::SMTP_CONFIG).unwrap().as_deref(),
        Some("{\"password\":\"pw\"}")
    );
    assert_eq!(
        Settings::get_version(&conn, keys::SMTP_CONFIG, "term-a").unwrap(),
        Some(1)
    );
}

/// Delta loss stays NON-FATAL in the in-tx form: no `setting_updated` table,
/// so the delta write fails, and the value write must still land and the
/// caller's transaction must still commit. This is the same contract
/// `set_tracked` has always had; the extraction must not move it.
#[test]
fn set_tracked_in_tx_delta_loss_is_non_fatal_and_the_value_stands() {
    let conn = fresh(); // settings only — every delta write here fails
    let tx = conn.unchecked_transaction().unwrap();
    Settings::set_tracked_in_tx(&tx, keys::STORE_NAME, "No Ledger", "term-a")
        .expect("a lost delta must not fail the tracked write");
    tx.commit().unwrap();
    assert_eq!(
        Settings::get(&conn, keys::STORE_NAME).unwrap().as_deref(),
        Some("No Ledger")
    );
}

/// The batch pre-flight and the per-row door must not be able to disagree:
/// this pins the public QUESTION against the live deny list, the named
/// exception and an ordinary key, which is the exact triple a lane would
/// otherwise restate. It is the drift the bridge's copied predicate was.
#[test]
fn cleartext_credential_refusal_agrees_with_the_tracked_door() {
    assert!(
        !keys::SECRET_KEY_DENY_LIST.is_empty(),
        "the shared deny list must be populated"
    );
    for key in keys::SECRET_KEY_DENY_LIST {
        let refused = Settings::cleartext_credential_refusal(key);
        if *key == keys::SMTP_CONFIG {
            assert!(refused.is_none(), "{key} is the named exception");
            continue;
        }
        let msg = refused.unwrap_or_else(|| format!("{key} must be refused"));
        assert!(msg.contains(key), "the refusal names the key: {msg}");
        // The question takes no value argument at all, so a value CANNOT
        // appear; what is checkable is that the message is the fixed clause
        // and nothing else — no interpolated payload riding along.
        assert_eq!(
            msg,
            format!(
                "{key} holds a credential — the tracked settings funnel refuses to store it in cleartext"
            ),
            "the refusal is the fixed clause, named by key and nothing more"
        );
    }
    assert!(
        Settings::cleartext_credential_refusal(keys::STORE_NAME).is_none(),
        "an ordinary key is admissible"
    );
}

/// The batch door still admits the `smtp_config` exception and ordinary
/// keys — a mixed batch without a credential writes every row.
#[test]
fn set_batch_tracked_admits_the_smtp_exception_and_ordinary_keys() {
    let conn = fresh();
    let rows: Vec<(String, String)> = vec![
        (keys::STORE_NAME.to_string(), "ok".to_string()),
        (
            keys::SMTP_CONFIG.to_string(),
            "{\"password\":\"pw\"}".to_string(),
        ),
    ];
    Settings::set_batch_tracked(&conn, &rows, "term-a").unwrap();
    assert_eq!(
        Settings::get(&conn, keys::SMTP_CONFIG).unwrap().as_deref(),
        Some("{\"password\":\"pw\"}")
    );
    assert_eq!(
        Settings::get(&conn, keys::STORE_NAME).unwrap().as_deref(),
        Some("ok")
    );
}
