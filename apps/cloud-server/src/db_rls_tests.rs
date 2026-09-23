//! Unit tests for the tenant-isolation (RLS) posture decision.
//!
//! Checklist item C7, detection half. These exercise the PURE decision only —
//! 'RlsPosture::from_facts' over hand-built 'RlsFacts' — so they run with no
//! PostgreSQL, no connection and no schema. The database half ('rls_facts')
//! and its wiring are covered by code review: this environment has no
//! PostgreSQL, so no executed check reaches them.

use super::*;

/// The number of protected tenant tables the generated schema creates a
/// 'tenant_isolation' policy for.
/// ('crates/kasirmu-core/migrations/20260813_init.pg.sql', RLS_TABLES.)
const EXPECTED_TOTAL: u32 = 34;

fn facts(role: &str, is_superuser: bool, forced: u32, total: u32) -> RlsFacts {
    RlsFacts {
        role: role.to_string(),
        is_superuser,
        forced_tables: forced,
        protected_tables: total,
    }
}

/// A superuser bypasses row-level security even where FORCE is set, so a
/// fully-FORCEd schema still reads as bypassed.
#[test]
fn superuser_is_reported_as_bypassed_even_when_every_table_is_forced() {
    let posture = RlsPosture::from_facts(&facts("postgres", true, EXPECTED_TOTAL, EXPECTED_TOTAL));
    assert_eq!(
        posture,
        RlsPosture::BypassedBySuperuser {
            tables: EXPECTED_TOTAL
        }
    );
    assert!(!posture.is_enforced());
    assert_eq!(posture.as_str(), "bypassed_by_superuser");

    let message = posture.message("postgres");
    assert!(
        message.contains("postgres"),
        "the message must name the role: {message}"
    );
    assert!(
        message.contains("superuser"),
        "the message must say why: {message}"
    );
}

/// The shipped shape: the role owns the tables and FORCE was never applied.
#[test]
fn owner_without_force_is_reported_as_bypassed() {
    let posture = RlsPosture::from_facts(&facts("kasirmu", false, 0, EXPECTED_TOTAL));
    assert_eq!(
        posture,
        RlsPosture::BypassedByOwnerRole {
            total: EXPECTED_TOTAL
        }
    );
    assert!(!posture.is_enforced());
    assert_eq!(posture.as_str(), "bypassed_by_owner_role");

    let message = posture.message("kasirmu");
    assert!(message.contains("kasirmu"), "{message}");
    assert!(
        message.contains("FORCE ROW LEVEL SECURITY"),
        "the message must name the missing mechanism: {message}"
    );
    assert!(
        message.contains(&EXPECTED_TOTAL.to_string()),
        "the message must carry the count: {message}"
    );
}

/// A half-finished cutover: some tables forced, some not.
#[test]
fn partially_forced_is_reported_with_both_counts() {
    let posture = RlsPosture::from_facts(&facts("kasirmu", false, 12, EXPECTED_TOTAL));
    assert_eq!(
        posture,
        RlsPosture::PartiallyEnforced {
            forced: 12,
            total: EXPECTED_TOTAL
        }
    );
    assert!(!posture.is_enforced());
    assert_eq!(posture.as_str(), "partially_enforced");

    let message = posture.message("kasirmu");
    assert!(message.contains("12"), "{message}");
    assert!(message.contains("34"), "{message}");
    assert!(
        message.contains("22"),
        "the message must state the remaining count: {message}"
    );
}

/// The post-cutover shape: a non-superuser role with every table FORCEd.
#[test]
fn fully_forced_non_superuser_is_enforced() {
    let posture = RlsPosture::from_facts(&facts("oz_app", false, EXPECTED_TOTAL, EXPECTED_TOTAL));
    assert_eq!(
        posture,
        RlsPosture::Enforced {
            tables: EXPECTED_TOTAL
        }
    );
    assert!(posture.is_enforced());
    assert_eq!(posture.as_str(), "enforced");

    let message = posture.message("oz_app");
    assert!(message.contains("oz_app"), "{message}");
    assert!(message.contains("ENFORCED"), "{message}");
}

/// Nothing to enforce — the schema was never applied to this database, or the
/// server is pointed at the wrong one. Reported as its own verdict rather than
/// as a failure, because it is not a bypass.
#[test]
fn no_protected_tables_is_its_own_verdict() {
    let posture = RlsPosture::from_facts(&facts("kasirmu", false, 0, 0));
    assert_eq!(posture, RlsPosture::NoProtectedTables);
    assert!(!posture.is_enforced());
    assert_eq!(posture.as_str(), "no_protected_tables");
}

/// A superuser on a database with no protected tables: "nothing to enforce"
/// describes the schema, so it wins — there is no bypass to report.
#[test]
fn no_protected_tables_outranks_the_superuser_verdict() {
    assert_eq!(
        RlsPosture::from_facts(&facts("postgres", true, 0, 0)),
        RlsPosture::NoProtectedTables
    );
}

/// 'is_enforced' is the only verdict the boot path treats as good news.
#[test]
fn is_enforced_is_true_for_exactly_one_verdict() {
    let all = [
        RlsPosture::NoProtectedTables,
        RlsPosture::Enforced { tables: 34 },
        RlsPosture::BypassedBySuperuser { tables: 34 },
        RlsPosture::BypassedByOwnerRole { total: 34 },
        RlsPosture::PartiallyEnforced {
            forced: 1,
            total: 34,
        },
    ];
    let enforced: Vec<&'static str> = all
        .iter()
        .filter(|p| p.is_enforced())
        .map(|p| p.as_str())
        .collect();
    assert_eq!(enforced, vec!["enforced"]);
}

/// The verdict ids are a published surface (/health), so they are pinned.
#[test]
fn verdict_ids_are_stable() {
    assert_eq!(
        RlsPosture::NoProtectedTables.as_str(),
        "no_protected_tables"
    );
    assert_eq!(RlsPosture::Enforced { tables: 1 }.as_str(), "enforced");
    assert_eq!(
        RlsPosture::BypassedBySuperuser { tables: 1 }.as_str(),
        "bypassed_by_superuser"
    );
    assert_eq!(
        RlsPosture::BypassedByOwnerRole { total: 1 }.as_str(),
        "bypassed_by_owner_role"
    );
    assert_eq!(
        RlsPosture::PartiallyEnforced {
            forced: 1,
            total: 2
        }
        .as_str(),
        "partially_enforced"
    );
}

/// Forced > total cannot happen against a real catalog, but the decision must
/// not read it as "partially enforced" if it ever does.
#[test]
fn forced_above_total_still_reads_as_enforced() {
    assert_eq!(
        RlsPosture::from_facts(&facts("oz_app", false, 40, EXPECTED_TOTAL)),
        RlsPosture::Enforced {
            tables: EXPECTED_TOTAL
        }
    );
}
