//! Tests for [`super::SettingsClockStore`] and [`super::InMemoryClockStore`].

use rusqlite::{Connection, params};

use super::{CLOCK_KEY, ClockStore, InMemoryClockStore, SettingsClockStore, parse_counter};

/// A migrated in-memory database, so the `settings` table exists.
fn migrated_connection() -> Connection {
    let mut conn = Connection::open_in_memory().expect("in-memory db");
    kasirmu_core::migrations::run(&mut conn).expect("migrations must apply");
    conn
}

#[test]
fn in_memory_store_starts_at_zero_and_round_trips() {
    let store = InMemoryClockStore::default();
    assert_eq!(store.load_counter().expect("load"), 0);

    store.save_counter(12).expect("save");
    assert_eq!(store.load_counter().expect("load"), 12);

    store.save_counter(13).expect("save");
    assert_eq!(store.load_counter().expect("load"), 13);
}

#[test]
fn in_memory_store_can_be_seeded() {
    let store = InMemoryClockStore::new(99);
    assert_eq!(store.load_counter().expect("load"), 99);
}

#[test]
fn parse_counter_accepts_a_plain_or_padded_number() {
    assert_eq!(parse_counter("0").expect("parse"), 0);
    assert_eq!(parse_counter("42").expect("parse"), 42);
    assert_eq!(parse_counter("  42  ").expect("parse"), 42);
}

#[test]
fn parse_counter_rejects_corruption_instead_of_returning_zero() {
    // Returning 0 here would restart the clock and order this terminal's next
    // mutation before mutations it has already observed.
    assert!(parse_counter("").is_err());
    assert!(parse_counter("not-a-number").is_err());
    assert!(parse_counter("-1").is_err());
    assert!(parse_counter("12.5").is_err());
}

#[test]
fn settings_store_persists_across_a_transaction_boundary() {
    let mut conn = migrated_connection();

    {
        let tx = conn.transaction().expect("tx");
        let store = SettingsClockStore::new(&tx);
        assert_eq!(
            store.load_counter().expect("load"),
            0,
            "a missing key must read as 0, not as an error"
        );
        store.save_counter(7).expect("save");
        tx.commit().expect("commit");
    }

    // Reopen a transaction: the value must have survived the commit.
    let tx = conn.transaction().expect("tx");
    let store = SettingsClockStore::new(&tx);
    assert_eq!(store.load_counter().expect("load"), 7);
}

#[test]
fn settings_store_never_regresses() {
    let mut conn = migrated_connection();
    let tx = conn.transaction().expect("tx");
    let store = SettingsClockStore::new(&tx);

    store.save_counter(10).expect("save");
    store.save_counter(4).expect("save");
    assert_eq!(store.load_counter().expect("load"), 4);

    store.save_counter(11).expect("save");
    assert_eq!(store.load_counter().expect("load"), 11);
}

#[test]
fn settings_store_loads_a_full_clock() {
    let mut conn = migrated_connection();
    let tx = conn.transaction().expect("tx");
    let store = SettingsClockStore::new(&tx);

    store.save_counter(3).expect("save");

    let clock = store.load_clock("terminal-9").expect("load clock");
    assert_eq!(clock.counter(), 3);
    assert_eq!(clock.terminal_id(), "terminal-9");
}

#[test]
fn settings_store_reports_a_corrupt_value_as_an_error() {
    let mut conn = migrated_connection();
    {
        let tx = conn.transaction().expect("tx");
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![CLOCK_KEY, "garbage"],
        )
        .expect("seed corrupt value");
        tx.commit().expect("commit");
    }

    let tx = conn.transaction().expect("tx");
    let store = SettingsClockStore::new(&tx);
    assert!(
        store.load_counter().is_err(),
        "a corrupt stored counter must surface, not silently reset"
    );
}
