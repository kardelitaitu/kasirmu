//! Tests for the generated table-ownership map.
//!
//! The map is generated from `modules/ownership.json`; these tests pin the
//! invariants the runtime namespace check (Phase 2) relies on, so a hand-edit
//! of the generated file or a bad source edit cannot silently change the
//! governance verdict.

use super::{TABLE_OWNERS, owner_of};

#[test]
fn every_module_appears_exactly_once() {
    let mut ids: Vec<&str> = TABLE_OWNERS.iter().map(|(id, _)| *id).collect();
    let before = ids.len();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(before, ids.len(), "a module id appears more than once");
}

#[test]
fn no_table_is_claimed_by_two_modules() {
    let mut seen: Vec<&str> = Vec::new();
    for (module, tables) in TABLE_OWNERS {
        for table in *tables {
            assert!(
                !seen.contains(table),
                "table {table} is claimed by more than one module (second: {module})"
            );
            seen.push(table);
        }
    }
}

#[test]
fn table_names_are_bare_lowercase_identifiers() {
    for (_, tables) in TABLE_OWNERS {
        for table in *tables {
            assert!(
                table
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
                "table name {table} is not a bare lowercase identifier"
            );
        }
    }
}

#[test]
fn reporting_owns_no_tables() {
    let reporting = TABLE_OWNERS
        .iter()
        .find(|(id, _)| *id == "reporting")
        .expect("reporting must appear in the map");
    assert!(
        reporting.1.is_empty(),
        "reporting owns no tables (it reads through the facade)"
    );
}

#[test]
fn owner_of_resolves_known_tables() {
    assert_eq!(owner_of("sales"), Some("sales"));
    assert_eq!(owner_of("sale_lines"), Some("sales"));
    assert_eq!(owner_of("products"), Some("inventory"));
    assert_eq!(owner_of("gift_cards"), Some("giftcards"));
    assert_eq!(owner_of("users"), Some("staff"));
}

#[test]
fn owner_of_fails_closed_on_unknown_table() {
    // A table the map does not know is a governance gap, not permission.
    assert_eq!(owner_of("not_a_real_table"), None);
    assert_eq!(owner_of(""), None);
}

#[test]
fn owner_of_covers_every_declared_table() {
    for (module, tables) in TABLE_OWNERS {
        for table in *tables {
            assert_eq!(
                owner_of(table),
                Some(*module),
                "owner_of({table}) should be {module}"
            );
        }
    }
}
