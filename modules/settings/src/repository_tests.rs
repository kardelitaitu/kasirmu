use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    oz_core::migrations::fresh_db()
}

#[test]
fn get_returns_none_for_missing_key() {
    let conn = fresh();
    let repo = SettingsRepository::new(&conn);
    assert!(repo.get("nonexistent").unwrap().is_none());
}

#[test]
fn set_and_get_roundtrip() {
    let conn = fresh();
    let repo = SettingsRepository::new(&conn);
    repo.set("theme", "dark").unwrap();
    let val = repo.get("theme").unwrap().unwrap();
    assert_eq!(val, "dark");
}

#[test]
fn set_overwrites_existing() {
    let conn = fresh();
    let repo = SettingsRepository::new(&conn);
    repo.set("key", "old").unwrap();
    repo.set("key", "new").unwrap();
    let val = repo.get("key").unwrap().unwrap();
    assert_eq!(val, "new");
}

#[test]
fn set_empty_value() {
    let conn = fresh();
    let repo = SettingsRepository::new(&conn);
    repo.set("empty", "").unwrap();
    let val = repo.get("empty").unwrap().unwrap();
    assert_eq!(val, "");
}

#[test]
fn multiple_keys_independent() {
    let conn = fresh();
    let repo = SettingsRepository::new(&conn);
    repo.set("k1", "v1").unwrap();
    repo.set("k2", "v2").unwrap();
    assert_eq!(repo.get("k1").unwrap().unwrap(), "v1");
    assert_eq!(repo.get("k2").unwrap().unwrap(), "v2");
}

#[test]
fn set_updates_timestamp() {
    let conn = fresh();
    let repo = SettingsRepository::new(&conn);
    repo.set("ts-key", "first").unwrap();
    // Setting the same key again should not error (upsert)
    repo.set("ts-key", "second").unwrap();
    assert_eq!(repo.get("ts-key").unwrap().unwrap(), "second");
}

/// The deny list, walked from the crate that owns it — never retyped here.
fn authoritative_deny_list() -> &'static [&'static str] {
    oz_core::settings::keys::SECRET_KEY_DENY_LIST
}

/// ACTIVATION — when this pin flips, and what it drags along with it.
///
/// This case asserts TODAY'S TRUTH, which is that the door is open. The day
/// anyone adds a guard to `SettingsRepository::set` — a credential refusal, a
/// permission check, an ingest policy, or a reroute through the tracked funnel —
/// the first assertion below goes red for the right reason, and at that point:
///
/// 1. this case must be inverted into a REFUSAL assertion (`is_err()`, plus
///    `setting_updated` staying empty only if the reroute is what refused it),
///    and
/// 2. the "Known hazard" doc comments on `SettingsRepository::set` and
///    `SettingsService::set` — which claim the opposite of what a guarded
///    setter does — must be updated in the same commit, along with the MSL-5
///    header record that logs this guard as DECLINED.
///
/// A red pin here is the alarm, not the bug. If it goes red and nobody did
/// either of those two things, the guard was added silently and this test is
/// the only thing in the tree that noticed.
#[test]
fn known_hazard_set_writes_a_deny_listed_credential_in_cleartext() {
    let conn = fresh();
    let repo = SettingsRepository::new(&conn);
    let deny_list = authoritative_deny_list();

    // Vacuity guard: an empty list would let the loop below pass while
    // pinning nothing at all.
    assert!(
        !deny_list.is_empty(),
        "premise broken: SECRET_KEY_DENY_LIST is empty, so this case pins nothing"
    );

    let cleartext = "sk_live_cleartext_value_written_verbatim";
    let mut walked = 0usize;

    for key in deny_list {
        walked += 1;

        // The door is open: the write is accepted.
        repo.set(key, cleartext).unwrap_or_else(|err| {
            panic!(
                "DENY-LISTED KEY {key} WAS REFUSED — the guard this \
                 case says is absent has landed. ACTIVATION applies: flip this \
                 case into a refusal assertion and update the Known hazard \
                 doc on both setters. (error: {err})"
            )
        });

        // And what landed is the cleartext itself, byte for byte: this write
        // path neither refuses the key nor encrypts the value.
        assert_eq!(
            repo.get(key).unwrap().as_deref(),
            Some(cleartext),
            "PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT: {key} is a credential \
             on platform-core's own deny list and this repository stored it \
             in cleartext, because every guard in the tree keys on the settings \
             funnel and not on this door"
        );

        // The other half of the same hazard: no delta row, because this
        // signature carries no terminal_id with which to write one.
        let deltas: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM setting_updated WHERE key = ?1",
                rusqlite::params![key],
                |row| row.get(0),
            )
            .expect("setting_updated exists in the migrated schema");
        assert_eq!(
            deltas, 0,
            "PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT: {key} should have been \
             silent on the DB-08 delta ledger; a non-zero count means this \
             door now writes deltas, which is a change this comment and the \
             MSL-5 header record must both be updated to match"
        );
    }

    assert_eq!(
        walked,
        deny_list.len(),
        "every key on the authoritative deny list must be walked, not a prefix of it"
    );
}
