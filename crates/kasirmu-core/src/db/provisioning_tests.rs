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
    conn.execute_batch("INSERT INTO locations (id, name) VALUES ('loc-1', 'Main');")
        .unwrap();
    // users.role_id is a real FK to roles(id), so the role must exist first.
    conn.execute_batch("INSERT INTO roles (id, name) VALUES ('owner', 'Owner');")
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
    assert_eq!(
        s.first_run_state("dev-001").unwrap(),
        FirstRunState::Unprovisioned
    );
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
    assert!(
        !rec.provisioned_at.is_empty(),
        "the column default must be read back"
    );
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
    assert_eq!(
        again.location_id, first.location_id,
        "a replay must return the stored row, not the offered one"
    );
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
    let linked = s
        .link_provisioning("dev-001", "tenant-abc", "cred-1")
        .unwrap();
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
    s.link_provisioning("dev-001", "tenant-abc", "cred-1")
        .unwrap();
    let err = s.link_provisioning("dev-001", "tenant-OTHER", "cred-1");
    assert!(err.is_err(), "reassignment must be refused");
    let still = s.get_provisioning("dev-001").unwrap().unwrap();
    assert_eq!(still.tenant_id.as_deref(), Some("tenant-abc"));
}

#[test]
fn linking_an_unprovisioned_terminal_is_a_validation_error() {
    let conn = fresh();
    let s = store(&conn);
    assert!(
        s.link_provisioning("dev-missing", "tenant-abc", "cred-1")
            .is_err()
    );
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
    assert!(
        err.is_err(),
        "a linked row without tenant_id/device_id must be refused"
    );
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
    assert_eq!(
        ProvisioningMode::parse("local").unwrap(),
        ProvisioningMode::Local
    );
    assert_eq!(
        ProvisioningMode::parse("linked").unwrap(),
        ProvisioningMode::Linked
    );
    assert!(
        ProvisioningMode::parse("LOCAL").is_err(),
        "the stored form is lowercase"
    );
    assert!(ProvisioningMode::parse("").is_err());
}
// ── provision_device: the one transaction (ADR #56 §2.2) ─────────

fn args_for(terminal_id: &str) -> ProvisionDeviceArgs {
    ProvisionDeviceArgs {
        terminal_id: terminal_id.to_owned(),
        location_name: "Sunset Cafe".to_owned(),
        currency: "IDR".to_owned(),
        timezone: "Asia/Jakarta".to_owned(),
        owner_username: "Owner".to_owned(),
        owner_display_name: "  Adi  ".to_owned(),
        owner_pin: "1234".to_owned(),
        preset: "cafe".to_owned(),
        features: vec!["cash-payment".to_owned(), "barcode-scanning".to_owned()],
        location_kind: LocationKind::Restaurant,
        mode: ProvisioningMode::Local,
        tenant_id: None,
        device_credential_id: None,
    }
}

#[test]
fn provisioning_a_terminal_end_to_end_leaves_a_working_terminal() {
    // §2.3's requirement stated as a test: onboarding must END at a working
    // terminal, not at a configured one. So the assertions are about what a
    // till needs to open — a location, an owner who can log in, a preset, a
    // currency, and workspaces to route into.
    let conn = fresh();
    let out = provision_device(&conn, &args_for("dev-001")).unwrap();
    assert!(out.created);

    // The marker, and the derived state that reads from it.
    assert!(store(&conn).is_provisioned("dev-001").unwrap());
    assert_eq!(out.record.mode, ProvisioningMode::Local);
    // A local install has no licence-server tenant (§2.4).
    assert_eq!(out.record.tenant_id, None);
    assert_eq!(out.record.home_region, "global");

    // The location, and the workspaces that reference it (they are one step).
    let location: String = conn
        .query_row(
            "SELECT name FROM locations WHERE id = ?1",
            rusqlite::params![out.location_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(location, "Sunset Cafe");
    let kinds: Vec<String> = conn
        .prepare("SELECT type_key FROM workspace_instances WHERE location_id = ?1")
        .unwrap()
        .query_map(rusqlite::params![out.location_id], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert!(
        kinds.contains(&"restaurant-pos".to_string()),
        "a restaurant needs its POS: {kinds:?}"
    );
    assert!(
        kinds.contains(&"kds".to_string()),
        "a restaurant needs a kitchen display: {kinds:?}"
    );

    // The owner exists, is the OWNER role, and the username was normalised.
    let (username, display): (String, String) = conn
        .query_row(
            "SELECT username, display_name FROM users WHERE id = ?1",
            rusqlite::params![out.owner_user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(username, "owner", "the username is lowercased on write");
    assert_eq!(display, "Adi", "the display name is trimmed");
    let role: String = conn
        .query_row(
            "SELECT role_id FROM users WHERE id = ?1",
            rusqlite::params![out.owner_user_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(role, crate::builtin_roles::OWNER);

    // The settings a till reads on boot.
    assert_eq!(
        crate::Settings::get(&conn, platform_core::settings::keys::STORE_PRESET).unwrap(),
        Some("cafe".to_string())
    );
    assert_eq!(
        crate::Settings::get_default_currency(&conn).unwrap(),
        Some("IDR".to_string())
    );
}

#[test]
fn provisioning_creates_no_waiting_store_fiction_for_the_next_terminal() {
    // Two devices on one store DB provision independently. The first must not
    // leave the second pre-provisioned, and neither may see the other's rows.
    let conn = fresh();
    let first = provision_device(&conn, &args_for("dev-001")).unwrap();
    assert!(store(&conn).is_provisioned("dev-001").unwrap());
    assert!(!store(&conn).is_provisioned("dev-002").unwrap());

    // A distinct owner: usernames are UNIQUE, so a second terminal either
    // belongs to a different merchant or names a different staff member. The
    // test is about the location rows, not about permitting duplicate users.
    let mut second_args = args_for("dev-002");
    second_args.owner_username = "second-owner".to_owned();
    let second = provision_device(&conn, &second_args).unwrap();
    assert_ne!(
        first.location_id, second.location_id,
        "each terminal gets its own location"
    );
    // Two provisioned locations exist. Asserted relative to the fixture rather
    // than as an absolute count, because the baseline migration still seeds a
    // 'Default Store' row until §2.6's removal lands with it.
    let provisioned: i64 = conn
        .query_row("SELECT COUNT(*) FROM provisioning", [], |r| r.get(0))
        .unwrap();
    assert_eq!(provisioned, 2);
}

#[test]
fn re_provisioning_the_same_device_is_a_replay_not_a_second_terminal() {
    // §2.2 step 1: the guard runs BEFORE any write, so a retry after a crash
    // or a lost response is free and cannot mint a second owner or location.
    let conn = fresh();
    let first = provision_device(&conn, &args_for("dev-001")).unwrap();
    assert!(first.created);

    let mut second = args_for("dev-001");
    second.location_name = "A Different Name".to_owned();
    second.owner_username = "someone-else".to_owned();
    let replay = provision_device(&conn, &second).unwrap();
    assert!(!replay.created, "a replay must report created=false");
    assert_eq!(replay.location_id, first.location_id);
    assert_eq!(replay.owner_user_id, first.owner_user_id);

    // Nothing was duplicated — proven per terminal, not against an absolute
    // count, so the assertion survives the baseline migration's own rows.
    let provisioned: i64 = conn
        .query_row("SELECT COUNT(*) FROM provisioning", [], |r| r.get(0))
        .unwrap();
    assert_eq!(provisioned, 1, "a replay must not add a provisioning row");
    let owners: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM users WHERE username = 'owner'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(owners, 1, "a replay must not add an owner");
    let locs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM locations WHERE id = ?1",
            rusqlite::params![first.location_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(locs, 1);
}

#[test]
fn a_failed_provision_rolls_back_everything_including_the_marker() {
    // The all-or-nothing property §2.1 relies on: there is no state in which
    // a location or an owner exists but the marker does not, because the
    // marker is written last inside the same transaction.
    let conn = fresh();
    let mut bad = args_for("dev-001");
    // A PIN below the minimum is refused by validation...
    bad.owner_pin = "1".to_owned();
    assert!(provision_device(&conn, &bad).is_err());

    // ...and nothing was written, so the terminal is still unprovisioned and
    // the store DB has no half-built rows a retry would collide with.
    assert!(!store(&conn).is_provisioned("dev-001").unwrap());
    // Measured against a fresh DB, not against zero: the baseline migration
    // still seeds its own rows until §2.6's removal ships alongside the
    // workspaces it is coupled to. Comparing to `fresh()` is what makes this
    // an assertion about THIS call rather than about the seed.
    let baseline = fresh();
    for table in ["locations", "users", "workspace_instances"] {
        let after: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        let before: i64 = baseline
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            after, before,
            "{table} must be untouched after a rejected provision"
        );
    }
}

#[test]
fn a_linked_provision_requires_its_tenant_and_credential() {
    // The schema CHECK enforces this too; the validation exists so the caller
    // gets a field-named error instead of a constraint violation.
    let conn = fresh();
    let mut linked = args_for("dev-linked");
    linked.mode = ProvisioningMode::Linked;
    assert!(
        provision_device(&conn, &linked).is_err(),
        "linked without a tenant must be refused"
    );

    linked.tenant_id = Some("tenant-abc".to_owned());
    assert!(
        provision_device(&conn, &linked).is_err(),
        "linked without a credential must be refused"
    );

    linked.device_credential_id = Some("cred-1".to_owned());
    let out = provision_device(&conn, &linked).unwrap();
    assert_eq!(out.record.mode, ProvisioningMode::Linked);
    assert_eq!(out.record.tenant_id.as_deref(), Some("tenant-abc"));
    assert_eq!(out.record.device_id.as_deref(), Some("cred-1"));
}

#[test]
fn provisioning_a_local_terminal_names_no_licence_server_tenant() {
    // §2.4's local tier must not pretend to be linked. The stored tenant is
    // NULL, NOT the local literal 'default' — the two are different
    // namespaces and §2.1 forbids comparing them.
    let conn = fresh();
    let out = provision_device(&conn, &args_for("dev-local")).unwrap();
    assert_eq!(out.record.tenant_id, None);
    assert_eq!(out.record.device_id, None);
    assert_eq!(out.record.mode, ProvisioningMode::Local);
}

/// A LINKED provision must stamp the SUPPLIED tenant onto the location row.
///
/// `locations` is RLS-covered, so a row left at the column DEFAULT is
/// invisible to the tenant that owns it — and the cloud quota detector counts
/// locations per tenant, so a paying tenant would score 0 locations. The
/// source is `args.tenant_id`, the caller's own claim: the same value this
/// transaction already writes into the peer `provisioning` row.
#[test]
fn a_linked_provision_stamps_the_supplied_tenant_on_the_location_row() {
    let conn = fresh();
    let mut linked = args_for("dev-tenant");
    linked.mode = ProvisioningMode::Linked;
    linked.tenant_id = Some("tenant-abc".to_owned());
    linked.device_credential_id = Some("cred-1".to_owned());

    let out = provision_device(&conn, &linked).unwrap();

    let stored: String = conn
        .query_row(
            "SELECT tenant_id FROM locations WHERE id = ?1",
            rusqlite::params![out.location_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_ne!(
        stored, "default",
        "a linked location must not sit on the single-tenant column DEFAULT"
    );
    assert_eq!(
        stored, "tenant-abc",
        "the location carries the tenant the caller supplied"
    );
    // One source, one tenant: the marker row and the location row agree.
    assert_eq!(out.record.tenant_id.as_deref(), Some(stored.as_str()));
}

/// A LOCAL provision has no licence-server tenant, so the column is OMITTED
/// and the schema's own NOT NULL DEFAULT 'default' supplies it — the declared
/// single-tenant value, not a literal this code writes. The row must still be
/// created: omitting a column is not a way to lose the location.
#[test]
fn a_local_provision_omits_the_tenant_column_and_the_row_still_lands() {
    let conn = fresh();
    let out = provision_device(&conn, &args_for("dev-local-tenant")).unwrap();
    assert!(out.created);

    let stored: String = conn
        .query_row(
            "SELECT tenant_id FROM locations WHERE id = ?1",
            rusqlite::params![out.location_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        stored, "default",
        "the schema's declared single-tenant default supplies the value"
    );
    // The local marker still carries NO tenant — the two namespaces stay
    // distinct (§2.1), which is what makes the location's 'default' the
    // column's declared value rather than a claim about a licence tenant.
    assert_eq!(out.record.tenant_id, None);
}

#[test]
fn location_kind_selects_the_workspace_topology() {
    // A shop must not get a kitchen display. This is the one axis where the
    // two kinds differ in topology rather than features (§2.3 step 3).
    let conn = fresh();
    let mut retail = args_for("dev-shop");
    retail.location_kind = LocationKind::Retail;
    let out = provision_device(&conn, &retail).unwrap();
    let kinds: Vec<String> = conn
        .prepare("SELECT type_key FROM workspace_instances WHERE location_id = ?1")
        .unwrap()
        .query_map(rusqlite::params![out.location_id], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert!(
        kinds.contains(&"store-pos".to_string()),
        "a shop needs its POS: {kinds:?}"
    );
    assert!(
        !kinds.contains(&"kds".to_string()),
        "a shop must not get a kitchen display: {kinds:?}"
    );
}

// ── The timezone is validated on the WRITE path (C6b) ────────────

#[test]
fn a_valid_location_timezone_is_accepted_and_stored_verbatim() {
    // The accepted value reaches the column unchanged: this is a rejection,
    // never a silent normalisation, so what the operator chose is what a
    // report resolves against later.
    let conn = fresh();
    let out = provision_device(&conn, &args_for("dev-tz-ok")).unwrap();
    let stored: String = conn
        .query_row(
            "SELECT timezone FROM locations WHERE id = ?1",
            rusqlite::params![out.location_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, "Asia/Jakarta");
}

#[test]
fn utc_is_still_accepted_as_the_legacy_column_default() {
    // UTC is the column default for un-migrated rows and the reporting path
    // resolves it for real (is_known_zone), so it stays accepted here exactly
    // as the regional write path accepts it.
    let conn = fresh();
    let mut args = args_for("dev-tz-utc");
    args.timezone = "UTC".to_owned();
    assert!(provision_device(&conn, &args).is_ok());
}

#[test]
fn an_unsupported_timezone_is_rejected_and_names_the_accepted_values() {
    // The defect C6b closes: the write path validated nothing, so a value the
    // reporting path cannot resolve was stored verbatim and the store silently
    // reported in UTC (timezone::offset_for_zone falls back on any other name).
    // Asia/Pontianak is in the list on purpose: it IS resolvable by the
    // reporting path but is NOT in the write boundary's closed set, so it
    // proves this reuses the bridge's set rather than a wider one.
    let conn = fresh();
    for bad in [
        "Europe/London",
        "Asia/Pontianak",
        "WIB",
        "UTC+7",
        "nonsense",
        "",
    ] {
        let mut args = args_for("dev-tz-bad");
        args.timezone = bad.to_owned();
        let err = provision_device(&conn, &args)
            .expect_err("an unsupported timezone must be refused, not stored");
        match err {
            CoreError::Validation { field, message } => {
                assert_eq!(field, "timezone", "the error must name the field");
                for accepted in ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "UTC"] {
                    assert!(
                        message.contains(accepted),
                        "the message must name {accepted}: {message}"
                    );
                }
                assert!(
                    message.contains(bad),
                    "the message must echo the rejected value {bad:?}: {message}"
                );
            }
            other => panic!("expected a timezone validation error, got {other:?}"),
        }
        // Rejected BEFORE the transaction, so no half-built terminal survives.
        assert!(!store(&conn).is_provisioned("dev-tz-bad").unwrap());
    }
}

#[test]
fn location_kind_round_trips_and_rejects_unknown_values() {
    assert_eq!(LocationKind::Retail.as_str(), "retail");
    assert_eq!(LocationKind::Restaurant.as_str(), "restaurant");
    assert_eq!(LocationKind::parse("retail").unwrap(), LocationKind::Retail);
    assert!(
        LocationKind::parse("cafe").is_err(),
        "a preset is not a topology kind"
    );
    assert!(LocationKind::parse("").is_err());
}
