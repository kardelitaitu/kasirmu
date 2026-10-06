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

// ── The id generator's cross-device guarantee ────────────────────

/// The fallback that keeps two devices from agreeing on an id.
///
/// `new_id` documents that "two devices provisioning against one store DB cannot
/// collide", and that rests ENTIRELY on its clock field: two processes each start
/// their `seq` at 0, so their ids differ only by `nanos`. The old
/// `.map_or(0, |d| d.as_nanos())` therefore did not merely weaken the guarantee —
/// under a pre-epoch clock BOTH devices wrote `nanos = 0` and their first ids
/// collided exactly.
///
/// The clock cannot be moved from a test, so this pins the FALLBACK the failure
/// branch uses. That is the discriminating property, and it does not depend on the
/// branch being reachable: a constant here would restore the collision the fix
/// removes, whether or not the clock ever fails. VERIFIED: returning `0` makes
/// this test fail (`left: 0, right: 0`).
#[test]
fn the_clock_failure_fallback_is_not_a_constant() {
    // Two independent draws must differ. A constant fallback — 0, or any fixed
    // value — makes this fail, which is exactly the old behaviour.
    let a = random_u128();
    let b = random_u128();
    assert_ne!(
        a, b,
        "the fallback must differ between calls, or two devices share a prefix and collide"
    );

    // And it must be usable as the id's field at full width: a value that could
    // not fill `{nanos:032x}` would shorten every id this branch produces.
    assert!(
        format!("{a:032x}").len() == 32,
        "the fallback must render to the same 32-hex width as `as_nanos()`"
    );
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
        tax_preset: None,
        seed_sample_products: None,
    }
}

#[test]
fn provisioning_with_tax_preset_ppn11_and_sample_products_seeds_starter_catalog() {
    let conn = fresh();
    let mut args = args_for("dev-starter-01");
    args.tax_preset = Some("ppn11".to_owned());
    args.seed_sample_products = Some(true);

    let out = provision_device(&conn, &args).unwrap();
    assert!(out.created);

    // Verify tax_rates contains default PPN 11%
    let (tax_name, tax_bps, is_def): (String, i64, i64) = conn
        .query_row(
            "SELECT name, rate_bps, is_default FROM tax_rates WHERE is_default = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(tax_name, "PPN 11%");
    assert_eq!(tax_bps, 1100);
    assert_eq!(is_def, 1);

    // Verify exactly 5 sample products seeded
    let count: i64 = conn
        .query_row("SELECT count(*) FROM products", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 5, "must seed exactly 5 starter products");

    // Verify inventory rows seeded with positive stock for each product
    let inv_count: i64 = conn
        .query_row("SELECT count(*) FROM inventory WHERE qty > 0", [], |r| r.get(0))
        .unwrap();
    assert_eq!(inv_count, 5, "all 5 products must have initial inventory");
}

#[test]
fn provisioning_with_tax_preset_ppn11_service5() {
    let conn = fresh();
    let mut args = args_for("dev-starter-02");
    args.tax_preset = Some("ppn11_service5".to_owned());

    provision_device(&conn, &args).unwrap();

    let count: i64 = conn
        .query_row("SELECT count(*) FROM tax_rates", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 2, "must seed PPN 11% and Service Charge 5%");
}

#[test]
fn provisioning_with_tax_preset_tax_free() {
    let conn = fresh();
    let mut args = args_for("dev-starter-03");
    args.tax_preset = Some("tax_free".to_owned());

    provision_device(&conn, &args).unwrap();

    let (tax_name, tax_bps): (String, i64) = conn
        .query_row(
            "SELECT name, rate_bps FROM tax_rates WHERE is_default = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(tax_name, "Non-PKP (0%)");
    assert_eq!(tax_bps, 0);
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

/// `provision_device` must leave the install LICENSED, not merely configured.
///
/// ADR #56 §2.4 makes `local` a supported permanent Free tier, and §2.6 moved the
/// `BOOTSTRAP_FREE` seed out of the schema and into this function's transaction.
/// It wrote the location and the workspaces but never the subscription, so a
/// provisioned terminal reached the capabilities read with no entitlement row —
/// that read fails closed, projects `state: 'unavailable'`, and `unavailable` is
/// not in `WorkspaceHome.toolLock`'s open set (`active`/`grace`/`loading`), so the
/// FIRST gate rejects every tool before the tier check is reached. The visible
/// result was a home screen of 17 locked cards reading "Subscription inactive".
///
/// The row is therefore part of "a working terminal", the standard the test above
/// asserts §2.3 requires. Pinning it here keeps the write at its SOURCE, so the
/// startup reconcile that repairs installs provisioned before it existed stays a
/// repair rather than becoming the only writer.
#[test]
fn provisioning_writes_the_bootstrap_subscription_the_local_tier_needs() {
    let conn = fresh();
    provision_device(&conn, &args_for("dev-001")).unwrap();

    // tenant_id defaults to "default" when args carry none, which is the tenant
    // the capabilities read and the reconcile's own default both use.
    let (tier, status, signature): (String, String, String) = conn
        .query_row(
            "SELECT tier_key, status, signature FROM tenant_subscription WHERE tenant_id = 'default'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("a provisioned local terminal must have its bootstrap subscription row");

    // Free and ACTIVE: `active` is what the fail-closed validity gate admits, and
    // Free is the tier §2.4 says a `local` terminal permanently holds.
    assert_eq!(tier, "free");
    assert_eq!(status, "active");
    // The sentinel the schema used to seed, kept so the row is recognisable as the
    // bootstrap rather than a server grant — which is why the reconcile's guard 2
    // refuses to touch a PRESENT row.
    assert_eq!(signature, "BOOTSTRAP_FREE");
}

/// `provision_device` writes its location to the GLOBAL db and leaves the store db alone.
///
/// This is the fact that makes the read-repair in
/// `kasirmu-bridge::workspaces::list_workspaces` fail in production. The repair copies
/// global `workspace_instances` rows into `store-<id>.sqlite`, but that table's
/// `location_id` is `REFERENCES locations(id)`
/// (`20260813_init.sql:986-988`, after `20260906_rename_store_to_location.sql:14` renamed
/// the target table) — and nothing in production ever writes a `locations` row into a
/// store db. `create_location_profile` has no caller outside tests.
///
/// So when the repair inserts into the store db, its foreign key has no target, SQLite
/// raises `FOREIGN KEY constraint failed`, and the repair's `let _ =` discards it. The
/// rows are returned to the caller and never cached. Asserted here, at the provisioning
/// end, so the premise is pinned where it is created rather than only where it bites.
#[test]
fn provisioning_writes_its_location_to_the_global_db_not_a_store_db() {
    // `fresh()` is the global identity database — the one the bridge hands to
    // `provision_device` (`kasirmu-bridge/src/setup.rs:370`, `ctx.lock_global()`).
    let conn = fresh();
    let out = provision_device(&conn, &args_for("dev-001")).unwrap();

    // The location exists HERE, with the id the result names.
    let name: String = conn
        .query_row(
            "SELECT name FROM locations WHERE id = ?1",
            rusqlite::params![out.location_id],
            |r| r.get(0),
        )
        .expect("provisioning writes the location into this db");
    assert_eq!(name, "Sunset Cafe");

    // And this db is the only one in play: `provision_device` takes one connection and
    // opens no store file, which is why a store db for the same location starts empty.
    // The repair's FK therefore has no target unless something else provisions it —
    // and per the module comment above, nothing in production does.
    let instances: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workspace_instances WHERE location_id = ?1",
            rusqlite::params![out.location_id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        instances > 0,
        "provisioning writes the workspaces HERE too — which is the split-brain: the"
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

/// A linked provision must write NO subscription row, and today it writes one.
///
/// The invariant, first, because that is what this asserts: a linked install's
/// entitlement is the server's grant, so `provision_device` must leave
/// `tenant_subscription` empty. It currently does not. Step 5b keys the row on
/// `args.tenant_id`, so a linked install writes `tenant-abc`; but the
/// capabilities read looks for
/// `'default'` alone (`entitlements.rs`: "no tenant_subscription row for
/// 'default' — failing closed"), and so does the reconcile's existence check
/// (`migrations.rs`). The two never meet, so a linked terminal that just wrote
/// its own subscription row still reads `Ok(None)`, fails closed, projects
/// `state: 'unavailable'`, and locks every tool.
///
/// The deeper defect is not the tenant key but the MISSING GUARD. The write
/// does not ask `args.mode` at all, while the reconcile for the same row does:
/// `migrations.rs` writes only when `EXISTS(... provisioning.mode = 'local')`,
/// and its guard-1 doc explains why a linked install must be left alone —
/// "A `linked` install's entitlement is the server's grant, and a missing row
/// there is an anomaly that must keep failing closed — writing Free would also
/// risk pre-empting the real grant." Step 5b's own comment invokes the same
/// premise ("`local` is a supported permanent Free tier") and then applies it
/// in every mode. So a linked install gets a local `BOOTSTRAP_FREE` grant where
/// the design says the server's grant belongs, under a tenant no tablet reader
/// consults.
///
/// Reachable through the shipping first-run flow: `ProvisioningFlow.tsx`
/// initialises `provisionMode` to `'linked'` and sends the account's
/// `tenantId`. The fix is one guard — write only for `ProvisioningMode::Local`,
/// mirroring the reconcile — which also settles the tenant question, because a
/// `local` install's tenant is `None` and therefore `"default"`.
///
/// `#[ignore]`d on purpose, in this repo's characterisation idiom (see
/// `products_stock_adjust_tests.rs`: a test ignored "as a CHARACTERISATION of
/// the loss", later un-ignored and inverted when its fix landed). It asserts
/// the INVARIANT the pending Step 5b breaks rather than the row it currently
/// writes, so it needs no edit when the guard lands — only the `#[ignore]`
/// comes off. Ignored rather than live because it fails today, and a red build
/// is no gift to whoever is editing `provisioning.rs`.
///
/// The invariant is the reconcile's, not this test's invention:
/// `migrations_tests.rs`'s `reconcile_leaves_a_linked_install_to_the_server_grant`
/// asserts it for the other entry point — "a linked install's entitlement is the
/// server's, and a missing grant must keep failing closed". The two run through
/// different functions, so neither test covers the other; this closes that.
///
/// Full analysis, and the one-line guard that settles it:
/// `todo-tablet-provisioned-workspaces-invisible-to-picker.md` (rounds 17-21).
#[test]
fn a_linked_provision_leaves_no_bootstrap_subscription_row() {
    let conn = fresh();
    let mut linked = args_for("dev-linked");
    linked.mode = ProvisioningMode::Linked;
    linked.tenant_id = Some("tenant-abc".to_owned());
    linked.device_credential_id = Some("cred-1".to_owned());
    provision_device(&conn, &linked).unwrap();

    // Step 5b currently writes one, under the linked tenant. The reconcile
    // refuses to write one at all for the same install — it writes only when
    // `EXISTS(... provisioning.mode = 'local')` — so the two entry points
    // disagree, and the design is the reconcile's: a linked install's
    // entitlement is the server's grant, and writing Free risks pre-empting it.
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM tenant_subscription", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        rows, 0,
        "a linked install's entitlement is the server's, and a missing grant must keep \
         failing closed — provision_device must not write a local BOOTSTRAP_FREE row"
    );
}

/// What a LINKED install's entitlement reads as once Step 5b stopped writing.
///
/// Pinned as a CHARACTERISATION of the state, not as an endorsement of it.
/// Step 5b is now `Local`-only (`c22fb6421`), and every other writer is gated
/// the same way — `migrations::ensure_bootstrap_subscription` returns early
/// unless `provisioning.mode = 'local'`, and the shell's startup reconcile only
/// copies a row that already exists, so it writes nothing against an empty
/// table. A linked provision therefore ends with **no** `tenant_subscription`
/// row, `entitlements.rs`'s provisioning-tenant fallback finds nothing either,
/// and the install reads `Unavailable` — which is outside
/// `WorkspaceHome.toolLock`'s open set (`active`/`grace`/`loading`), so every
/// tool locks.
///
/// That IS the design's answer: a linked install's entitlement is the server's
/// grant, and a missing grant must fail closed. It is reachable in practice
/// only where the licence gate did not run first — which a **debug** build
/// allows, because `get_license_status` reports `Valid`/`free` with no payload
/// and so satisfies `bootAllowed` without any activation. A release build
/// routes through `LicenseActivationScreen` first, and activation writes tenant
/// `default` via `INSERT OR REPLACE` (`license.rs:177`), so the row exists by
/// the time provisioning runs.
///
/// Recorded because nothing pinned it: the only linked-side test was the
/// negative one above. **If ownership rules that the linked flow must end at a
/// usable terminal, this is the test to invert** — do not delete it, and do not
/// "fix" it by widening Step 5b, which would re-break
/// `a_linked_provision_leaves_no_bootstrap_subscription_row`.
#[test]
fn a_linked_provision_with_no_server_grant_reads_unavailable() {
    let conn = fresh();
    let mut linked = args_for("dev-linked");
    linked.mode = ProvisioningMode::Linked;
    linked.tenant_id = Some("tenant-abc".to_owned());
    linked.device_credential_id = Some("cred-1".to_owned());
    provision_device(&conn, &linked).unwrap();

    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM tenant_subscription", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 0, "a linked provision writes no subscription row");

    let s = store(&conn);
    let ent = crate::entitlements::build_entitlements(
        &s,
        crate::availability::UsageCounts::default(),
        false,
    );
    assert!(
        !ent.loaded,
        "no row exists to load, so `loaded` must stay false"
    );
    assert_eq!(
        ent.state,
        crate::subscription::SubscriptionLifecycleState::Unavailable
    );
    assert_eq!(ent.tier, crate::SubscriptionTier::Free);
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

// ── MSL-43: the currency is validated on the write path too ──────

/// The sibling of the C6b timezone fix, which closed the same gap one field
/// over and left this one open.
///
/// `validate_provision_args` checks the timezone against the accepted set and
/// documents why ("a free-text IANA name outside it resolves to UTC through the
/// reporting path's fallback arm … which would silently report a Jakarta store
/// in UTC"). `currency` is written by the same function into `locations.currency`
/// AND into the store-wide `Settings::set_default_currency`, and is checked
/// nowhere — not here, not in the bridge, not in the shell.
///
/// The field is documented as "ISO-4217 currency" on both the core args and the
/// wire DTO, so the contract was stated and simply not enforced.
#[test]
fn an_unsupported_currency_is_rejected_and_names_the_field() {
    let conn = fresh();
    for bad in ["", " ", "US", "USDD", "12A", "us dollars"] {
        let mut args = args_for("dev-cur-bad");
        args.currency = bad.to_owned();
        let err = provision_device(&conn, &args)
            .expect_err("a malformed currency must be refused, not stored");
        match err {
            CoreError::Validation { field, .. } => {
                assert_eq!(field, "currency", "the error must name the field");
            }
            other => panic!("expected a currency validation error, got {other:?}"),
        }
        // Rejected BEFORE the transaction, so no half-built terminal survives —
        // and crucially no store-wide default currency was set.
        assert!(!store(&conn).is_provisioned("dev-cur-bad").unwrap());
        assert_eq!(
            crate::Settings::get_default_currency(&conn)
                .unwrap()
                .as_deref(),
            None,
            "a refused provision must not have set the store default currency"
        );
    }
}

/// A valid code is stored verbatim and reaches the store setting, so the fix
/// rejects only what the parser rejects.
#[test]
fn a_valid_currency_reaches_the_location_and_the_store_default() {
    let conn = fresh();
    let mut args = args_for("dev-cur-ok");
    args.currency = "IDR".to_owned();
    let out = provision_device(&conn, &args).unwrap();

    let stored: String = conn
        .query_row(
            "SELECT currency FROM locations WHERE id = ?1",
            rusqlite::params![out.location_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, "IDR");
    assert_eq!(
        crate::Settings::get_default_currency(&conn)
            .unwrap()
            .as_deref(),
        Some("IDR")
    );
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
