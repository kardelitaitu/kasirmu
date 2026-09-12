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

/// DECISION PIN — the asymmetry between the folded deny list and the
/// exactly-matched exception. This is a security decision, not an accident of
/// implementation, and it is what the two halves below are here to keep apart.
///
/// Folded half: `keys::is_secret_setting_key` trims and ASCII-case-folds the
/// candidate, so `STRIPE.API_KEY` and `"stripe.api_key "` are refused by the
/// funnel where a case- and whitespace-exact match used to admit them — the
/// settings table is TEXT under BINARY collation, so those are distinct rows
/// that used to read straight back over IPC.
///
/// Exact half: the exception is compared against the RAW key, so no variant of
/// `smtp_config` inherits it — `SMTP_CONFIG`, `"smtp_config "` and
/// `" Smtp_Config"` are refused like any other credential. Folding the
/// exception the same way would hand back the exact bypass the fold just
/// closed, because an exception to a security guard is the narrowest thing in
/// the guard. The cost is that a hand-written variant of the legitimate key is
/// refused rather than admitted: a support annoyance, not a hole, and a
/// theoretical one — both shells write that key from code as an exact constant.
///
/// The other edge of the pair — the legitimate key in exact form IS admitted
/// through this funnel — is already pinned by
/// `set_tracked_exception_still_writes_smtp_config` above, and is not restated
/// here — nor are the in-tx and batch forms of the same admission.
#[test]
fn decision_pin_the_credential_exception_is_matched_exactly() {
    let conn = fresh_with_delta();
    // Every spelling below IS on the deny list once the candidate is folded;
    // none of them is the exception, because the exception is matched raw.
    let near_misses = [
        "SMTP_CONFIG",    // the exception, uppercased
        "smtp_config ",   // the exception, padded
        " Smtp_Config",   // both at once
        "STRIPE.API_KEY", // another deny-listed key
        "stripe.api_key ",
    ];
    for key in near_misses {
        assert!(
            keys::is_secret_setting_key(key),
            "the folded predicate must flag {key:?}, or this case proves nothing"
        );
        let msg = Settings::cleartext_credential_refusal(key).unwrap_or_else(|| {
            panic!("{key:?} must be refused: it is deny-listed but is not the exact exception")
        });
        assert!(
            msg.contains(key),
            "the refusal must name the key as handed to it, got: {msg}"
        );
        let err = Settings::set_tracked(&conn, key, "leaked-credential-value", "term-a")
            .expect_err("a near-miss of a deny-listed key must be refused, not written");
        assert!(
            !err.to_string().contains("leaked-credential-value"),
            "the refusal must never echo the value, got: {err}"
        );
        assert_eq!(
            Settings::get(&conn, key).unwrap(),
            None,
            "a refusal must not write the row for {key:?}"
        );
        assert_eq!(
            Settings::get_version(&conn, key, "term-a").unwrap(),
            None,
            "a refusal must not write a delta for {key:?}"
        );
    }
    // The exception key is still FLAGGED by the predicate in every casing — it
    // is only the funnel's byte-exact comparison that lets the one spelling
    // through, so casing can never widen the exception from either side.
    assert!(
        keys::is_secret_setting_key("SMTP_CONFIG"),
        "the folded predicate must keep flagging the exception key too"
    );
}

/// The bare face refuses BEFORE it opens its transaction: a caller that is
/// already inside one and asks `set_tracked` with a deny-listed key gets the
/// refusal — the same words the in-tx form raises — and never the rusqlite
/// "cannot start a transaction within a transaction" error, whose exact
/// wording rusqlite 0.31 does not guarantee. Until 12-09-26 the begin came
/// first, so an in-transaction caller got the nested-BEGIN failure instead
/// of the refusal; this test pins the order. Only the refusal face is
/// pinned — the nested-BEGIN error itself is unspecified in rusqlite 0.31,
/// so its presence is asserted by absence of the refusal, never by wording.
#[test]
fn set_tracked_refuses_before_it_begins_when_a_transaction_is_already_open() {
    let conn = fresh_with_delta();
    // The caller's own transaction, held open across the bare call.
    let held = conn.unchecked_transaction().unwrap();
    let err = Settings::set_tracked(&conn, keys::STRIPE_API_KEY, "sk_live_leaked", "term-a")
        .expect_err("a deny-listed credential must be refused even inside a transaction");
    let msg = err.to_string();
    assert!(
        msg.contains(keys::STRIPE_API_KEY),
        "the caller must see the refusal, which names the key, got: {msg}"
    );
    assert!(
        !msg.contains("sk_live_leaked"),
        "the refusal must never echo the value, got: {msg}"
    );
    assert!(
        !msg.contains("within a transaction"),
        "the nested-BEGIN error must not be the answer a caller gets, got: {msg}"
    );
    // The refusal must have changed nothing: commit the caller's
    // transaction ANYWAY, so a write that had already landed would show.
    held.commit().unwrap();
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

/// Near-miss spellings that ONLY the manager arm of the ingest boolean can
/// refuse: the trimmed-and-folded form of each is neither on
/// `SECRET_KEY_DENY_LIST` nor `NON_EXPORTABLE_DEVICE_KEYS` (asserted in the
/// lanes below), so a refusal here is the lifecycle-manager prefix rule doing
/// the work — not the credential arm happening to reach the same answer.
/// Before this commit the two halves of one `||` disagreed: the credential
/// arm folded, the prefix arm `starts_with`-matched raw, so these spellings
/// walked through both untrusted lanes.
fn manager_prefix_only_near_misses() -> Vec<&'static str> {
    vec![
        "LAN_SERVER.BIND",       // the whole manager key uppercased
        "Local_api.enabled",     // mixed case, a non-credential manager key
        "\tlan_server.bind\n",   // tab + newline padding, lowercase
        "  LOCAL_API.ENABLED  ", // padded AND folded
    ]
}

/// Lane 1 of the two untrusted lanes: `.ozpkg` ingest must refuse a variant
/// spelling of a manager-owned key, not only the exact lowercase one.
#[test]
fn portable_package_ingest_refuses_a_variant_spelling_of_a_manager_key() {
    let conn = fresh();
    for key in manager_prefix_only_near_misses() {
        assert!(
            is_manager_owned_key(key),
            "the prefix rule must fold {key:?}"
        );
        assert!(
            !keys::is_non_exportable_setting_key(key),
            "{key:?} must be refused by the MANAGER arm, not the credential arm"
        );
        assert!(
            !IngestPolicy::PortablePackage.admits(key),
            "PortablePackage must refuse the variant {key:?}"
        );
        let written = Settings::set_with_policy(
            &conn,
            key,
            "from-foreign-package",
            IngestPolicy::PortablePackage,
        )
        .unwrap();
        assert!(!written, "PortablePackage must skip {key:?}, not store it");
        assert_eq!(
            Settings::get(&conn, key).unwrap(),
            None,
            "a refused variant must not create the {key:?} row"
        );
    }
    for key in manager_prefix_only_near_misses() {
        assert!(
            IngestPolicy::TrustedLocal.admits(key),
            "TrustedLocal must not filter {key:?}"
        );
    }
}

/// Lane 2: remote-sync ingest refuses the same variant spellings. Asserted
/// separately because the two untrusted lanes reach the shared `||` through
/// different accessors — sync via `set_with_policy` in
/// `platform/sync/src/queue.rs`, the package lane via `load_exportable` /
/// `set_batch_with_policy`. No transport, no network: driven through `admits`
/// and the funnelled accessor, which is what the lane itself calls.
#[test]
fn remote_sync_ingest_refuses_a_variant_spelling_of_a_manager_key() {
    let conn = fresh();
    for key in manager_prefix_only_near_misses() {
        assert!(
            !IngestPolicy::RemoteSync.admits(key),
            "RemoteSync must refuse the variant {key:?}"
        );
        let written =
            Settings::set_with_policy(&conn, key, "from-sync-server", IngestPolicy::RemoteSync)
                .unwrap();
        assert!(!written, "RemoteSync must skip {key:?}, not store it");
        assert_eq!(
            Settings::get(&conn, key).unwrap(),
            None,
            "a refused variant must not create the {key:?} row"
        );
    }
    // The fold refuses the incoming near-miss write; it does not reconcile or
    // rewrite the real lowercase row.
    Settings::set(&conn, keys::LAN_SERVER_BIND, "127.0.0.1").unwrap();
    let written = Settings::set_with_policy(
        &conn,
        "LAN_SERVER.BIND",
        "0.0.0.0",
        IngestPolicy::RemoteSync,
    )
    .unwrap();
    assert!(!written, "the variant write must be refused");
    assert_eq!(
        Settings::get(&conn, keys::LAN_SERVER_BIND)
            .unwrap()
            .as_deref(),
        Some("127.0.0.1"),
        "a refusal must not rewrite the real row"
    );
}

/// The other side of the fold, and the side that matters more: an ordinary
/// lowercase manager-owned key is STILL manager-owned. The exclusion exists
/// because a bulk write of `local_api.enabled` desyncs the Local API server
/// behind its back and `lan_server.bind` widens a listener with no PSK
/// change — a fold that quietly admitted manager keys through ingest would be
/// a real bug wearing a cleanup's clothes.
#[test]
fn an_ordinary_lowercase_manager_key_is_still_admitted_by_the_manager_door_and_refused_at_ingest() {
    for key in [
        keys::LOCAL_API_SECRET,
        "local_api.enabled",
        keys::LAN_SERVER_BIND,
        keys::LAN_SERVER_PSK,
        "lan_server.enabled",
    ] {
        assert!(
            is_manager_owned_key(key),
            "{key} is manager-owned and must stay so under the fold"
        );
        for policy in [IngestPolicy::PortablePackage, IngestPolicy::RemoteSync] {
            assert!(
                !policy.admits(key),
                "{:?} must refuse the manager key {key}",
                policy
            );
        }
        assert!(
            IngestPolicy::TrustedLocal.admits(key),
            "TrustedLocal must admit {key}: it is the lane that owns it"
        );
    }
    // And the fold did not over-reach: ordinary keys stay non-manager and
    // still travel on both untrusted lanes, exact or sloppy.
    //
    // The third leg is the trim-and-fold leg, and its EXAMPLE moved here on
    // 13-09-26 - from "  sync_enabled\t" to "  ui.locale\t" - when
    // sync_enabled went onto keys::PEER_NAMED_HAZARD_KEYS. The leg is the thing
    // under test (normalisation must not widen a refusal into a name nobody
    // listed), and sync_enabled had only ever been the exemplar somebody picked
    // before there was a reason to pick it. Deleting the leg to dodge the
    // collision would have removed the only proof that the fold leaves ordinary
    // names alone; the assertion is unchanged, the example is what was wrong.
    //
    // Why ui.locale is safe to pin as ordinary: it is a declared key
    // (keys::UI_LOCALE), it sits on neither SECRET_KEY_DENY_LIST nor
    // NON_EXPORTABLE_DEVICE_KEYS, it matches no manager prefix family, and it is
    // one of the names ordinary operation replicates - a remote that stopped
    // applying it would break the Settings page for every tenant, which is the
    // property that keeps this leg from being quietly edited away later.
    for key in [keys::STORE_NAME, "STORE.NAME", "  ui.locale\t"] {
        assert!(!is_manager_owned_key(key), "{key:?} is not manager-owned");
        assert!(
            IngestPolicy::PortablePackage.admits(key) && IngestPolicy::RemoteSync.admits(key),
            "an ordinary key must still travel on both untrusted lanes: {key:?}"
        );
    }
    // And the fold cuts the other way too, which is the half that matters now
    // that a third list exists: a hazard name arriving sloppy must still be
    // REFUSED. Trimming and case-folding are one shared step
    // (keys::normalised_candidate), so the RemoteSync arm cannot be walked past
    // by padding a name - the spelling the exclusion lists see is the spelling
    // every lane sees.
    for key in ["  sync_enabled\t", "  SYNC_ENABLED  ", "\tPg_Sync.Host\n"] {
        assert!(
            !IngestPolicy::RemoteSync.admits(key),
            "{key:?} is a peer-named hazard in sloppy clothing and must still be refused"
        );
        assert!(
            IngestPolicy::PortablePackage.admits(key),
            "{key:?} must still ride in a package: the hazard refusal belongs to one lane"
        );
    }
}

// ── DRIFT PIN — the prefix literals inside `is_manager_owned_key` against ──
// the constants that spell the manager's real keys ────────────────────────

/// A DRIFT PIN, not a behaviour test. The behaviour already has owners in this
/// file (`manager_owned_prefixes_follow_the_policy` and
/// `an_ordinary_lowercase_manager_key_is_still_admitted_by_the_manager_door_and_refused_at_ingest`),
/// both of which mix constants with hand-written literals in one list, so a
/// failure there says "a policy answer changed". This one names ONLY the
/// constants, so a red run can mean exactly one thing: the two prefix literals
/// inside [`is_manager_owned_key`] and the `keys::` constants have stopped
/// agreeing.
///
/// It goes red in BOTH directions of a rename, and the two directions are not
/// equal:
///
/// * Rename a CONSTANT (`keys::LAN_SERVER_PSK` → `"lan.psk"`) and the literals
///   stop matching what the manager actually writes, so the predicate answers
///   `false` for a live manager key. Both untrusted ingest lanes then ADMIT it,
///   and `managed_key_owner` (`crates/oz-bridge/src/settings.rs:99`) answers
///   `None` for it too — the write carries neither a refusal nor a label. A
///   WIDENED admission, and a silent one: the failure mode this subsystem has
///   been treating as unforgivable all night.
/// * Retype the LITERALS and the predicate over-claims instead: an ordinary row
///   refused where it should travel, and a generic label where a real owner
///   belongs. Still a bug, merely the survivable direction — the negative leg
///   below is what sees it.
///
/// Why a pin and not a unification: the bridge already DERIVES its prefixes
/// from these same constants (`family_prefix(LOCAL_API_SECRET)`), so what can
/// drift is literal-against-constant, and one assertion is red on either move
/// without any production line changing. Folding the two literals into an
/// owner table would be a policy rewrite, not a drift fix.
///
/// Every constant platform-core names inside these two families IS
/// manager-owned, so none is excused here: `LOCAL_API_SECRET`,
/// `LAN_SERVER_PSK`, `LAN_SERVER_BIND`. It names no others —
/// `local_api.enabled`, `local_api.port` and `local_api.store_id` are spelled
/// only in `crates/oz-local-api/src/lib.rs`, because platform-core must not
/// depend on that crate (`keys.rs:215-218`: `LOCAL_API_SECRET` is its declared
/// mirror). Those four are pinned from the side that CAN see both halves, in
/// that crate's own suite; no dependency edge was added to make this file
/// reach them.
#[test]
fn drift_pin_manager_prefix_literals_still_match_the_key_constants() {
    for key in [
        keys::LOCAL_API_SECRET,
        keys::LAN_SERVER_PSK,
        keys::LAN_SERVER_BIND,
    ] {
        assert!(
            is_manager_owned_key(key),
            "{key:?} is a manager-owned settings key but is_manager_owned_key no longer recognises it: the prefix literal in raw.rs and the constant that spells the manager key have drifted apart, so both untrusted ingest lanes now ADMIT it and the label lookup answers None. Move one to meet the other; do not delete this assertion."
        );
    }
    // The survivable direction, still worth seeing: a literal shortened to a
    // stem, or dropped to an empty prefix, claims ordinary rows too — and
    // ordinary rows travelling on both untrusted lanes is what the rest of this
    // suite assumes.
    for key in [keys::STORE_NAME, keys::SMTP_CONFIG, keys::SYNC_SERVER_URL] {
        assert!(
            !is_manager_owned_key(key),
            "{key:?} belongs to the generic settings surface, not to a lifecycle manager: the prefix rule has widened past the two families it owns."
        );
    }
}
