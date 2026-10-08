//! Unit tests for the tenant-isolation (RLS) posture decision.
//!
//! Checklist item C7, detection half. These exercise the PURE decision only —
//! 'RlsPosture::from_facts' over hand-built 'RlsFacts' — so they run with no
//! PostgreSQL, no connection and no schema. The database half ('rls_facts')
//! and its wiring are covered by code review: this environment has no
//! PostgreSQL, so no executed check reaches them.

use super::*;

/// A REPRESENTATIVE protected-table count for the pure-decision fixtures below.
///
/// This is NOT a claim about the schema, and the earlier version of this comment
/// was wrong for saying so: it read "the number of protected tenant tables the
/// generated schema creates a 'tenant_isolation' policy for
/// (init.pg.sql, RLS_TABLES)", but **measured, that list holds 29** — the
/// generated FOREACH array in `20260813_init.pg.sql` enables RLS and creates
/// `tenant_isolation` for exactly 29 tables, and `scripts/generate-pg-migration.py`'s
/// `RLS_TABLES` is the same 29. Nor is 34 the count of tables carrying a
/// `tenant_id` column (33 of 104 `CREATE TABLE` statements).
///
/// Nothing in this file compares it to a live count, so the value only has to be
/// a plausible total — every assertion here drives `RlsPosture::from_facts` with
/// it as a FIXTURE. The live comparison lives in `db_tests.rs`, whose query
/// (`db.rs` `RLS_FACTS_SQL`) derives the real number from `pg_policies`
/// deliberately, "rather than from a Rust constant, so it follows the generated
/// schema instead of drifting away from it".
///
/// Kept at 34 rather than changed to 29: DO NOT introduce a false link between
/// this fixture and the schema by making them agree, which is what the stale
/// comment invited. Say what it is instead.
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
/// The generator's curated RLS list is the one this file's provenance note cites.
///
/// WHY THIS EXISTS. `EXPECTED_TOTAL`'s doc claimed the constant came from the generated
/// schema's `RLS_TABLES`, while that list measures **29** and the constant is 34 — a
/// provenance claim nothing checked, in the file a reader consults to learn how many
/// tables are protected. The number itself is a fixture and stayed 34; what was wrong
/// was the CLAIM about where it comes from, the same class of drift the sibling
/// `rls-cutover.sql` fix addressed (a count written down with nothing comparing it to
/// the list it names).
///
/// Runs WITHOUT PostgreSQL: it reads the GENERATOR, not a database, so it holds on any
/// machine — which is the point, since the pg-gated tests cannot run without a cluster.
#[test]
fn rls_table_reference_count_is_pinned_against_the_generator_list() {
    const GENERATOR: &str = include_str!("../../../scripts/generate-pg-migration.py");

    let start = GENERATOR
        .find("RLS_TABLES = [")
        .expect("the generator must keep its curated RLS_TABLES list");
    let rest = &GENERATOR[start..];
    let end = rest.find(']').expect("RLS_TABLES must be closed");
    let body = &rest[..end];

    // One quoted name per line; the list is curated and hand-formatted, so this counts
    // what a reader sees rather than trying to parse Python.
    let listed = body
        .lines()
        .filter(|line| line.trim().starts_with('"'))
        .count();

    assert!(
        listed >= 20,
        "expected the curated RLS_TABLES to hold the tenant tables; parsed {listed} — if the \
         generator reformatted the list, fix THIS parse rather than the list"
    );

    // PINNED. Adding or removing a table from the protected set is a security decision,
    // so it must be deliberate: this fails on either direction and names the new count,
    // so the reviewer sees which table moved rather than a silently different number.
    assert_eq!(
        listed, 29,
        "the protected tenant-table set changed size. That is a security decision, not a \
         refactor: confirm the new table has policies AND a tenant_id, update the cutover \
         scripts to match, then update this literal deliberately."
    );
}

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
