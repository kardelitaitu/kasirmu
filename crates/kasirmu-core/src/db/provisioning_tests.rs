use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

/// Seed the two referenced rows (a location and a user), because
/// `provisioning` carries real foreign keys: a row naming a location that
/// does not exist is refused by SQLite, which is the point of the FK.
fn seed_refs(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO locations (id, name) VALUES ('loc-1', 'Main');"
    )
    .unwrap();
    // users.role_id is a real FK to roles(id), so the role must exist first.
    conn.execute_batch(
        "INSERT INTO roles (id, name) VALUES ('owner', 'Owner');"
    )
    .unwrap();
    conn.execute_batch(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id) VALUES ('user-1', 'owner', 'x', 'Owner', 'owner');"
    )
    .unwrap();
}

fn seeded() -> Connection {
    let conn = fresh();
    seed_refs(&conn);
    conn
}

fn a_record(terminal_id: &str) -> ProvisioningRecord {
    ProvisioningRecord {
        terminal_id: terminal_id.to_owned(),
        tenant_id: None,
        location_id: Some("loc-1".to_owned()),
        owner_user_id: Some("user-1".to_owned()),
        device_id: None,
        mode: ProvisioningMode::Local,
        home_region: "global".to_owned(),
        provisioned_at: String::new(),
    }
}

// ── The derived state (§2.1) ─────────────────────────────────────

#[test]
fn a_fresh_db_has_no_provisioning_rows() {
    // The whole point of §2.1: a fresh install must report UNPROVISIONED, not
    // a pre-seeded 'setup complete'. The migration seeds no provisioning row,
    // and no boolean can be read that would forge one.
    let conn = fresh();
    let s = store(&conn);
    assert!(!s.is_provisioned("dev-001").unwrap());
    assert_eq!(s.first_run_state("dev-001").unwrap(), FirstRunState::Unprovisioned);
}

#[test]
fn provisioning_a_terminal_derives_the_provisioned_state() {
    let conn = seeded();
    let s = store(&conn);
    let (rec, created) = s.provision_terminal(&a_record("dev-001")).unwrap();
    assert!(created, "a first provision must report created");
    assert_eq!(rec.terminal_id, "dev-001");
    assert_eq!(rec.mode, ProvisioningMode::Local);
    assert_eq!(rec.home_region, "global");
    assert!(!rec.provisioned_at.is_empty(), "the column default must be read back");
    assert!(s.is_provisioned("dev-001").unwrap());
    assert!(matches!(
        s.first_run_state("dev-001").unwrap(),
        FirstRunState::Provisioned(_)
    ));
}

#[test]
fn provisioning_is_keyed_per_terminal_not_per_install() {
    // §5 Q4: a tablet can be replaced independently of the store, so the gate
    // is a per-device question. Provisioning one device must leave its
    // neighbour unprovisioned.
    let conn = seeded();
    let s = store(&conn);
    s.provision_terminal(&a_record("dev-001")).unwrap();
    assert!(s.is_provisioned("dev-001").unwrap());
    assert!(!s.is_provisioned("dev-002").unwrap());
}

// ── Idempotency (§2.2 step 1) ────────────────────────────────────

#[test]
fn re_provisioning_returns_the_existing_row_and_reports_not_created() {
    // The retry path: a crash, a lost Android IPC response, or a re-polled
    // pairing claim must not mint a second terminal or overwrite the first.
    let conn = seeded();
    let s = store(&conn);
    let (first, created) = s.provision_terminal(&a_record("dev-001")).unwrap();
    assert!(created);

    let mut second = a_record("dev-001");
    second.location_id = Some("loc-DIFFERENT".to_owned());
    second.home_region = "eu".to_owned();
    let (again, created2) = s.provision_terminal(&second).unwrap();
    assert!(!created2, "a replay must not report created");
    assert_eq!(again.location_id, first.location_id,
        "a replay must return the stored row, not the offered one");
    assert_eq!(again.home_region, first.home_region);

    // And only one row exists — the guard is a read, so this is the proof.
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM provisioning", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

// ── The linked upgrade (§2.4) ────────────────────────────────────

#[test]
fn linking_promotes_a_local_terminal_to_linked() {
    let conn = seeded();
    let s = store(&conn);
    s.provision_terminal(&a_record("dev-001")).unwrap();
    let linked = s.link_provisioning("dev-001", "tenant-abc", "cred-1").unwrap();
    assert_eq!(linked.mode, ProvisioningMode::Linked);
    assert_eq!(linked.tenant_id.as_deref(), Some("tenant-abc"));
    assert_eq!(linked.device_id.as_deref(), Some("cred-1"));
}

#[test]
fn linking_refuses_to_reassign_a_device_to_another_tenant() {
    // A device that already belongs to a merchant must not be silently moved
    // to a different one — that would take a tenant's till and give it away.
    let conn = seeded();
    let s = store(&conn);
    s.provision_terminal(&a_record("dev-001")).unwrap();
    s.link_provisioning("dev-001", "tenant-abc", "cred-1").unwrap();
    let err = s.link_provisioning("dev-001", "tenant-OTHER", "cred-1");
    assert!(err.is_err(), "reassignment must be refused");
    let still = s.get_provisioning("dev-001").unwrap().unwrap();
    assert_eq!(still.tenant_id.as_deref(), Some("tenant-abc"));
}

#[test]
fn linking_an_unprovisioned_terminal_is_a_validation_error() {
    let conn = fresh();
    let s = store(&conn);
    assert!(s.link_provisioning("dev-missing", "tenant-abc", "cred-1").is_err());
}

// ── Residency (§2.1) ─────────────────────────────────────────────

#[test]
fn the_home_region_mirror_is_updatable_and_defaults_to_global() {
    let conn = seeded();
    let s = store(&conn);
    let (rec, _) = s.provision_terminal(&a_record("dev-001")).unwrap();
    assert_eq!(rec.home_region, "global");
    s.set_provisioning_home_region("dev-001", "eu").unwrap();
    let after = s.get_provisioning("dev-001").unwrap().unwrap();
    assert_eq!(after.home_region, "eu");
}

#[test]
fn updating_the_region_of_an_unprovisioned_terminal_is_refused() {
    // The mirror belongs to a row; writing it for a terminal that has none
    // would create a region fact with no provisioning to attach to.
    let conn = fresh();
    let s = store(&conn);
    assert!(s.set_provisioning_home_region("dev-missing", "eu").is_err());
}

// ── The schema's own constraints ─────────────────────────────────

#[test]
fn the_mode_check_rejects_an_unknown_mode() {
    // The CHECK is the backstop for a row written by a future path that
    // bypasses ProvisioningMode::parse.
    let conn = fresh();
    let err = conn.execute(
        "INSERT INTO provisioning (terminal_id, mode) VALUES ('dev-x', 'sideways')",
        [],
    );
    assert!(err.is_err(), "an unknown mode must not be storable");
}

#[test]
fn a_linked_row_must_carry_its_tenant_and_device() {
    // §2.1's coherence rule, enforced in the schema: a linked install that
    // names no tenant is a row that cannot be routed anywhere.
    let conn = fresh();
    let err = conn.execute(
        "INSERT INTO provisioning (terminal_id, mode) VALUES ('dev-y', 'linked')",
        [],
    );
    assert!(err.is_err(), "a linked row without tenant_id/device_id must be refused");
    // The same insert with both columns set is accepted, so the constraint
    // refuses the incoherent case rather than the mode.
    conn.execute(
        "INSERT INTO provisioning (terminal_id, mode, tenant_id, device_id) VALUES ('dev-z', 'linked', 't-1', 'c-1')",
        [],
    )
    .unwrap();
}

#[test]
fn a_local_row_may_omit_tenant_and_device() {
    // The other half: local provisioning writes no licence-server id, and the
    // constraint must not demand one (§2.4).
    let conn = fresh();
    conn.execute(
        "INSERT INTO provisioning (terminal_id, mode) VALUES ('dev-local', 'local')",
        [],
    )
    .unwrap();
}

// ── Mode parsing ─────────────────────────────────────────────────

#[test]
fn provisioning_mode_round_trips_and_rejects_unknown_values() {
    assert_eq!(ProvisioningMode::Local.as_str(), "local");
    assert_eq!(ProvisioningMode::Linked.as_str(), "linked");
    assert_eq!(ProvisioningMode::parse("local").unwrap(), ProvisioningMode::Local);
    assert_eq!(ProvisioningMode::parse("linked").unwrap(), ProvisioningMode::Linked);
    assert!(ProvisioningMode::parse("LOCAL").is_err(), "the stored form is lowercase");
    assert!(ProvisioningMode::parse("").is_err());
}