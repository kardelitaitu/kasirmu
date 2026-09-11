//! Tests for the sealed ingest policy and the funnelled settings accessors.
//!
//! These prove the CONTRACT, not any lane's behaviour: no production call site
//! uses `set_with_policy` / `set_batch_with_policy` / `load_exportable` yet, so
//! the questions here are only (a) does a refusal refuse, (b) is it the POLICY
//! doing the filtering rather than the predicate alone, and (c) does the
//! unfiltered `load_all` still see every row, which is what keeps feature
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
/// policies and admitted locally. The desktop bridge already refuses them via
/// its own `is_managed_key`, so converting that lane is outcome-neutral; the
/// CLI and sync lanes do NOT refuse them today, so converting THOSE changes
/// their outcome — see the doc comment on [`is_manager_owned_key`].
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
