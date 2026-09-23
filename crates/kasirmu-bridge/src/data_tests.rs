//! Relocated data-command tests (Wave-F test relocation: moved out of
//! `apps/desktop-tauri/src/commands/data_tests.rs`).
//!
//! Mounted at the foot of `data.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the eight wire DTOs, `exportable_settings_rows`
//! and the two batch quota gates exactly as the desktop sibling module did
//! (its `AppError` adapters were thin wrappers over these bridge fns). No
//! context or harness is needed: every case is a pure DTO/serde check or a
//! direct `&Store` gate drive. The two typed quota refusals rename
//! `AppError::Core` to `BridgeError::Core` 1:1 — the gate now returns
//! `BridgeError` natively and the asserted message texts are unchanged.

use super::*;

// ── The bypass is LOUD: backup_ungated_no_session ─────────────────────────

/*
 * A thread-scoped capturing subscriber, hand-rolled because kasirmu-bridge depends on
 * tracing only. set_default installs on the CURRENT thread and restores on drop,
 * and every test builds its own Capture, so two tests in this file cannot steal
 * each other records: there is no global to install, no try_init, and no
 * second-test-wins silent skip. The span methods are inert, only events matter.
 *
 * Assertions are on FIELD NAMES and VALUES, never the message string: a message is
 * prose that can say anything while a structured event says nothing.
 */
use std::sync::{Arc, Mutex};

/// One captured event: its ordered field name/value pairs.
type CapturedFields = Vec<(String, String)>;
/// Everything one `Capture` has recorded, in event order. The shared cell is
/// structural, not stylistic: `Subscriber::event` takes `&self` while pushing
/// (so the log needs interior mutability), and `install()` clones the capture
/// into the dispatcher (so the clone has to write to the same log the test
/// reads back).
type CaptureLog = Arc<Mutex<Vec<CapturedFields>>>;

#[derive(Debug, Clone, Default)]
struct Capture(CaptureLog);

#[derive(Debug, Clone, PartialEq, Eq)]
struct Fields(Vec<(String, String)>);

const EVENT_KEY: &str = "event";
const BACKUP_EVENT: &str = "backup_ungated_no_session";
const OPERATION_KEY: &str = "operation";
const PERMISSION_KEY: &str = "skipped_permission";
const PAYLOAD_NAMES: &[&str] = &[
    "value",
    "path",
    "db_path",
    "backup_path",
    "output",
    "token",
    "session_token",
];

impl Capture {
    fn drain(&self) -> Vec<Fields> {
        let mut g = self.0.lock().unwrap();
        g.drain(..).map(Fields).collect()
    }
    fn install(&self) -> tracing::subscriber::DefaultGuard {
        tracing::subscriber::set_default(self.clone())
    }
}

impl Fields {
    fn get(&self, key: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
    fn flat(&self) -> String {
        self.0
            .iter()
            .map(|(k, v)| k.to_string() + "=" + v)
            .collect::<Vec<_>>()
            .join(" | ")
    }
    fn backup_event(&self) -> bool {
        self.get(EVENT_KEY) == Some(BACKUP_EVENT)
    }
}

impl tracing::Subscriber for Capture {
    fn enabled(&self, _m: &tracing::Metadata) -> bool {
        true
    }
    fn event(&self, ev: &tracing::Event) {
        struct V(Vec<(String, String)>);
        impl tracing::field::Visit for V {
            fn record_str(&mut self, f: &tracing::field::Field, val: &str) {
                self.0.push((f.name().to_string(), val.to_string()));
            }
            fn record_debug(&mut self, f: &tracing::field::Field, val: &dyn std::fmt::Debug) {
                self.0.push((f.name().to_string(), format!("{:?}", val)));
            }
        }
        let mut v = V(Vec::new());
        ev.record(&mut v);
        self.0.lock().unwrap().push(v.0);
    }
    fn new_span(&self, _s: &tracing::span::Attributes) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }
    fn record(&self, _i: &tracing::span::Id, _v: &tracing::span::Record) {}
    fn record_follows_from(&self, _i: &tracing::span::Id, _f: &tracing::span::Id) {}
    fn enter(&self, _i: &tracing::span::Id) {}
    fn exit(&self, _i: &tracing::span::Id) {}
}

fn temp_store_path(tag: &str) -> std::path::PathBuf {
    // Unique per CALL, not just per process: `tag + pid` gave every
    // `ungated`-tagged test in one binary the same `store.db`, so a second one
    // would have read the first one's backup file (precedent: `unique_store_dir`
    // in inventory_tests.rs, which carries nanos for the same reason).
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!(
        "kasirmu-bridge-{}-{}-{}",
        tag,
        std::process::id(),
        nanos
    ));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir.join("store.db")
}

fn assert_event_shape(ev: &Fields, expected_operation: &str, dir: &std::path::Path) {
    assert_eq!(
        ev.get(EVENT_KEY),
        Some(BACKUP_EVENT),
        "asserted on the event field, not the message: {}",
        ev.flat()
    );
    assert_eq!(
        ev.get(OPERATION_KEY),
        Some(expected_operation),
        "the event must name the operation that fired: {}",
        ev.flat()
    );
    assert_eq!(
        ev.get(PERMISSION_KEY),
        Some(permissions::DATA_EXPORT),
        "the event must name the permission actually skipped, from the constant: {}",
        ev.flat()
    );
    for (k, v) in &ev.0 {
        assert!(
            !PAYLOAD_NAMES.contains(&k.as_str()),
            "field {} is payload-shaped; this event must be pastable into a ticket, so it carries none",
            k
        );
        assert!(
            !v.contains("store.db")
                && !v.contains(".db")
                && !dir.to_string_lossy().is_empty()
                && !v.contains(&dir.to_string_lossy().to_string()),
            "field {} carries a filesystem path or backup file name: {}",
            k,
            v
        );
    }
}

#[tokio::test]
async fn ungated_get_backup_status_emits_exactly_one_event() {
    let db = temp_store_path("ungated");
    let capture = Capture::default();
    {
        let _guard = capture.install();
        get_backup_status(&db).await.expect("read backup status");
    }
    let all = capture.drain();
    assert!(
        !all.is_empty(),
        "the capture recorded NOTHING, so the subscriber is not installed and a count of zero would be meaningless rather than a proof"
    );
    let hits: Vec<&Fields> = all.iter().filter(|f| f.backup_event()).collect();
    assert_eq!(
        hits.len(),
        1,
        "one ungated call must emit exactly one event; records were {:?}",
        all.iter().map(Fields::flat).collect::<Vec<_>>()
    );
    assert_event_shape(hits[0], "get_backup_status", db.parent().unwrap());
}

/*
 * The leg that needed the helper. Before TestBridge::token_granting existed, a
 * scoped call from this file failed authorization and returned BEFORE reaching
 * backup_status_direct, so it emitted nothing no matter how the delegate was
 * written: the assertion below would have passed on broken code. Now the call is
 * PROVEN to have reached the delegate by asserting it returned Ok, and the same
 * test first emits one ungated event through the very same capture, so a zero here
 * means the gated path is silent, not that the trap was never sprung.
 */
#[tokio::test]
async fn scoped_get_backup_status_emits_zero_events_after_passing_the_check() {
    use crate::testing::TestBridge;
    let db = temp_store_path("scoped");
    let bridge = TestBridge::new();
    let token = bridge.token_granting(permissions::DATA_EXPORT).await;
    let capture = Capture::default();

    let liveness = {
        let _guard = capture.install();
        get_backup_status(&db).await.expect("ungated warm-up");
        capture.drain().iter().filter(|f| f.backup_event()).count()
    };
    assert_eq!(
        liveness, 1,
        "the capture must see the event on the ungated path before a zero on the gated path means anything"
    );

    {
        let _guard = capture.install();
        let ctx = bridge.ctx();
        get_backup_status_scoped(&ctx, &token, &db)
            .await
            .expect("the seeded grant must SATISFY the check, not skip it");
    }
    let after = capture.drain();
    let hits: Vec<&Fields> = after.iter().filter(|f| f.backup_event()).collect();
    assert_eq!(
        hits.len(),
        0,
        "a call that presented a session and passed DATA_EXPORT must NOT be reported as ungated; saw {:?}",
        after.iter().map(Fields::flat).collect::<Vec<_>>()
    );
}

// ── Settings export redaction (review MED-2) ────────────────────────

#[test]
fn export_drops_secret_and_managed_keys() {
    let rows = vec![
        ("store.name".into(), "Toko OZ".into()),
        ("local_api.secret".into(), "deadbeef".into()),
        ("local_api.enabled".into(), "1".into()),
        ("smtp_config".into(), r#"{"password":"hunter2"}"#.into()),
        ("lan_server.psk".into(), "psk".into()),
        // C-2 typo regression: the stored key is UNDERSCORED, while the deny
        // list carried only the dotted "sync.terminal_secret", so the terminal
        // secret rode out in every .kasirpkg. The device-bound identity keys are
        // export-barred too (they fingerprint this install), even though they
        // stay readable through get_setting.
        ("sync_terminal_secret".into(), "enc:v1:ciphertext".into()),
        ("sync_terminal_id".into(), "term-42".into()),
        ("machine_id".into(), "MACHINE-FP".into()),
    ];
    let out = exportable_settings_rows(rows);
    let keys: Vec<&str> = out.iter().map(|v| v["key"].as_str().unwrap()).collect();
    assert_eq!(keys, ["store.name"], "only portable keys may be exported");
}

// ── BackupStatus ────────────────────────────────────────────────────

#[test]
fn backup_status_debug() {
    let bs = BackupStatus {
        last_backup: Some("2025-01-01 12:00:00".into()),
        last_backup_size: Some("1.5 MB".into()),
    };
    let d = format!("{bs:?}");
    assert!(d.contains("2025-01-01"));
}

#[test]
fn backup_status_serialize() {
    let bs = BackupStatus {
        last_backup: None,
        last_backup_size: None,
    };
    let json = serde_json::to_value(&bs).unwrap();
    assert!(
        !json.as_object().unwrap().contains_key("db_path"),
        "db_path must not be exposed in the DTO (M-7)"
    );
    assert!(json["last_backup"].is_null());
}

// ── BackupResult ────────────────────────────────────────────────────

#[test]
fn backup_result_debug() {
    let br = BackupResult {
        path: "/backups/oz.backup.db".into(),
        size_bytes: 1024,
    };
    let d = format!("{br:?}");
    assert!(d.contains("1024"));
}

#[test]
fn backup_result_serialize() {
    let br = BackupResult {
        path: "/b/test.bak".into(),
        size_bytes: 2048,
    };
    let json = serde_json::to_value(&br).unwrap();
    assert_eq!(json["size_bytes"], 2048);
}

// ── ExportDataArgs ──────────────────────────────────────────────────

#[test]
fn export_data_args_deserialize() {
    let json = r#"{"types":["products","categories"],"password":"secret","output_path":"/out/export.kasirpkg"}"#;
    let args: ExportDataArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.types, vec!["products", "categories"]);
    assert_eq!(args.password, "secret");
    assert_eq!(args.date_from, None);
    assert_eq!(args.date_to, None);
}

#[test]
fn export_data_args_debug() {
    let args = ExportDataArgs {
        types: vec!["all".into()],
        password: "pw".into(),
        output_path: "/o".into(),
        date_from: None,
        date_to: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("all"));
}

// ── ExportDataResult ────────────────────────────────────────────────

#[test]
fn export_data_result_debug() {
    let result = ExportDataResult {
        path: "/out/export.kasirpkg".into(),
        size_bytes: 512,
        types: vec!["products".into(), "sales".into()],
    };
    let d = format!("{result:?}");
    assert!(d.contains("sales"));
}

#[test]
fn export_data_result_serialize() {
    let result = ExportDataResult {
        path: "/o/e.kasirpkg".into(),
        size_bytes: 256,
        types: vec![],
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["size_bytes"], 256);
    assert!(json["types"].as_array().unwrap().is_empty());
}

// ── ImportPreviewArgs ───────────────────────────────────────────────

#[test]
fn import_preview_args_deserialize() {
    let json = r#"{"file_path":"/data/import.kasirpkg","password":"pw123"}"#;
    let args: ImportPreviewArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.file_path, "/data/import.kasirpkg");
    assert_eq!(args.password, "pw123");
}

#[test]
fn import_preview_args_debug() {
    let args = ImportPreviewArgs {
        file_path: "/f".into(),
        password: "p".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("/f"));
}

// ── ImportPreviewResult ─────────────────────────────────────────────

#[test]
fn import_preview_result_debug() {
    let result = ImportPreviewResult {
        store_name: "My Store".into(),
        app_version: "0.0.28".into(),
        created_at: "2025-01-01".into(),
        types: vec!["products".into()],
        product_count: 50,
        category_count: 5,
        sale_count: Some(100),
        customer_count: Some(20),
        user_count: Some(3),
        setting_count: None,
    };
    let d = format!("{result:?}");
    assert!(d.contains("My Store"));
    assert!(d.contains("50"));
}

#[test]
fn import_preview_result_serialize() {
    let result = ImportPreviewResult {
        store_name: "S".into(),
        app_version: "1.0".into(),
        created_at: "2025-01-01".into(),
        types: vec![],
        product_count: 0,
        category_count: 0,
        sale_count: None,
        customer_count: None,
        user_count: None,
        setting_count: None,
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["store_name"], "S");
    assert!(json["sale_count"].is_null());
}

// ── ImportDataArgs ──────────────────────────────────────────────────

#[test]
fn import_data_args_deserialize() {
    let json = r#"{"file_path":"/data/import.kasirpkg","password":"pw"}"#;
    let args: ImportDataArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.file_path, "/data/import.kasirpkg");
}

#[test]
fn import_data_args_debug() {
    let args = ImportDataArgs {
        file_path: "/f".into(),
        password: "x".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("/f"));
}

// ── ImportDataResult ────────────────────────────────────────────────

#[test]
fn import_data_result_debug() {
    let result = ImportDataResult {
        products_imported: 10,
        categories_imported: 3,
        sales_imported: 50,
        customers_imported: 5,
        users_imported: 2,
        settings_imported: 1,
    };
    let d = format!("{result:?}");
    assert!(d.contains("50"));
}

#[test]
fn import_data_result_serialize() {
    let result = ImportDataResult {
        products_imported: 0,
        categories_imported: 0,
        sales_imported: 0,
        customers_imported: 0,
        users_imported: 0,
        settings_imported: 0,
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["products_imported"], 0);
    assert_eq!(json["settings_imported"], 0);
}

// ── The session-free export twin (ADR #58 §4a Q-A option 3) ─────────

/// The twin exports with NO session presented.
///
/// This is the whole point of the command, so it is asserted directly rather
/// than inferred: no token is passed, and the call must still produce a
/// readable package. Once ADR #58 §2.5 refuses sessions on a revoked tenant,
/// every session-gated export path becomes unreachable — this is the one that
/// has to keep working, or §2.6's data promise has no mechanism behind it.
#[tokio::test]
async fn export_without_session_produces_a_package_and_no_session_is_needed() {
    use crate::testing::TestBridge;
    let bridge = TestBridge::new();
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("orphan.oze");

    let result = export_data_without_session(
        &bridge.ctx(),
        ExportDataArgs {
            output_path: out.to_string_lossy().into_owned(),
            password: "pw".into(),
            types: vec!["settings".into()],
            date_from: None,
            date_to: None,
        },
    )
    .await
    .expect("the ungated twin must export with no session");

    assert!(result.size_bytes > 0, "the package must carry bytes");
    assert_eq!(result.types, vec!["settings".to_string()]);
    assert!(out.exists(), "the file must be written");
}

/// The twin is READ-ONLY: `import_preview` and `import_data` stay gated.
///
/// ADR #58 §4a Q-A binds this explicitly — "The export twin must be read-only.
/// `import_preview` / `import_data` mutate and stay session-gated." A future
/// refactor that routes an import through the ungated body would turn a data
/// hostage into a write primitive, so the property is pinned rather than
/// commented.
#[tokio::test]
async fn the_ungated_twin_has_no_import_counterpart() {
    // The ungated surface is exactly one function. If a second is ever added,
    // this count changes and the author is forced to justify it here.
    let source = include_str!("data.rs");
    let ungated = source.matches("pub async fn ").count();
    assert!(
        ungated >= 2,
        "sanity: the module exposes gated and ungated entry points"
    );
    assert!(
        source.contains("pub async fn export_data_without_session("),
        "the twin must exist under the name ADR #58 §4a Q-A names"
    );
    assert!(
        !source.contains("import_data_without_session"),
        "ADR #58 §4a Q-A: the twin is read-only, so no ungated IMPORT may exist"
    );
    assert!(
        !source.contains("import_preview_without_session"),
        "ADR #58 §4a Q-A: the twin is read-only, so no ungated IMPORT may exist"
    );
}

// ── W4-S2: import batch quota gate ──────────────────────────────────

fn fresh_conn() -> rusqlite::Connection {
    crate::testing::temp_conn()
}

/// One importable product row as `payload.products` carries them (a
/// serialized `kasirmu_core::Product`), keyed by SKU.
fn product_value(sku: &str) -> serde_json::Value {
    let product = kasirmu_core::Product::new(
        sku,
        format!("Product {sku}"),
        kasirmu_core::Money {
            minor_units: 100,
            currency: kasirmu_core::Currency(*b"USD"),
        },
    );
    serde_json::to_value(&product).unwrap()
}

/// Seed `n` catalog rows with SKUs `seed-0..n-1` via the same table the
/// gate's existence probe reads.
fn seed_catalog(conn: &rusqlite::Connection, n: i64) {
    for i in 0..n {
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency) VALUES (?1, ?2, ?3, 100, 'USD')",
            rusqlite::params![format!("p-{i}"), format!("seed-{i}"), format!("Seed {i}")],
        )
        .unwrap();
    }
}

fn catalog_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))
        .unwrap()
}

#[test]
fn import_gate_counts_only_unseen_skus() {
    // Batch arithmetic: existing-SKU rows are updates/merges, not new
    // creations — only rows whose SKU is NOT in the catalog count toward
    // the quota.
    let conn = fresh_conn();
    seed_catalog(&conn, 2); // seed-0, seed-1 present
    let store = Store::new(&conn);
    let payload = vec![
        product_value("seed-0"), // update, not counted
        product_value("new-1"),  // new
        product_value("new-2"),  // new
    ];
    let counted = gate_import_product_batch(&store, &payload).unwrap();
    assert_eq!(counted, 2, "existing SKU must not count as a creation");
    assert_eq!(catalog_count(&conn), 2, "the gate itself never writes rows");
}

#[test]
fn import_gate_rejects_at_cap_and_writes_nothing() {
    // Fail-closed tier (no subscription row -> Free, cap 200): 199 present
    // + 3 new = 202 > 200. The refusal happens BEFORE the transaction
    // opens, so nothing is partially imported.
    let conn = fresh_conn();
    conn.execute("DELETE FROM tenant_subscription", []).unwrap();
    seed_catalog(&conn, 199);
    let store = Store::new(&conn);
    let payload = vec![
        product_value("new-1"),
        product_value("new-2"),
        product_value("new-3"),
    ];
    let err = gate_import_product_batch(&store, &payload).unwrap_err();
    match err {
        BridgeError::Core { message, .. } => {
            assert!(message.contains("maximum 200 products"), "got: {message}");
            assert!(message.contains("currently have 199"), "got: {message}");
        }
        other => panic!("expected typed quota refusal, got {other:?}"),
    }
    assert_eq!(
        catalog_count(&conn),
        199,
        "a refused import must not write anything"
    );
}

#[test]
fn import_gate_proceeds_under_cap_and_pins_the_boundary() {
    let conn = fresh_conn();
    conn.execute("DELETE FROM tenant_subscription", []).unwrap();
    seed_catalog(&conn, 2);
    let store = Store::new(&conn);
    // 2 + 2 new = 4, well under the Free cap of 200.
    let counted =
        gate_import_product_batch(&store, &[product_value("new-1"), product_value("new-2")])
            .unwrap();
    assert_eq!(counted, 2);
    // Simulate the import loop's inserts, then pin the exact edge: a batch
    // landing exactly ON the cap (196 more = 200) is the last allowed one;
    // one more row over it is refused.
    seed_catalog(&conn, 0);
    for i in 0..2 {
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency) VALUES (?1, ?2, ?3, 100, 'USD')",
            rusqlite::params![format!("imp-{i}"), format!("new-{}", i + 1), "Imported"],
        )
        .unwrap();
    }
    let edge: Vec<_> = (0..196)
        .map(|i| product_value(&format!("bulk-{i}")))
        .collect();
    gate_import_product_batch(&store, &edge).unwrap(); // 200 == limit: allowed
    // The gate only counts; the caller inserts. Materialize the approved
    // batch exactly as the import loop would, THEN ask again.
    for v in edge.iter() {
        let p: kasirmu_core::Product = serde_json::from_value(v.clone()).unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency) VALUES (?1, ?2, ?3, 100, 'USD')",
            rusqlite::params![p.id, p.sku.to_string(), p.name],
        )
        .unwrap();
    }
    assert_eq!(catalog_count(&conn), 200);
    let over = vec![product_value("bulk-over")];
    assert!(
        gate_import_product_batch(&store, &over).is_err(),
        "200 + 1 must refuse"
    );
}

// ── W6-A / S2.1: users-arm batch gate (Staff dimension) ─────────────

/// One importable user row as `payload.users` carries them (a serialized
/// `kasirmu_core::User`), keyed by the row id.
fn user_value(id: &str, username: &str) -> serde_json::Value {
    let mut user = kasirmu_core::User::new(username, "", username, "role-staff");
    user.id = id.into();
    serde_json::to_value(&user).unwrap()
}

/// Seed `n` ACTIVE staff users (the rows `count_staff_users` consults) with
/// ids `u-seed-0..n-1`.
fn seed_staff(conn: &rusqlite::Connection, store: &Store<'_>, n: i64) {
    store.seed_default_roles().unwrap();
    for i in 0..n {
        conn.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES (?1, ?2, 'h', ?3, 'role-staff', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
            rusqlite::params![format!("u-seed-{i}"), format!("seed-{i}"), format!("Seed {i}")],
        )
        .unwrap();
    }
}

fn staff_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM users WHERE is_active = 1", [], |r| {
        r.get(0)
    })
    .unwrap()
}

#[test]
fn import_gate_users_counts_only_unseen_ids() {
    // Batch arithmetic mirrors the product gate: existing ids are updates,
    // not creations — only unseen ids count toward the staff quota. The
    // seed row is INACTIVE (0 active staff) so the batch stays under the
    // Free staff cap of 1: 0 + 1 new = allowed.
    let conn = fresh_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('u-seed-0', 'seed-0', 'h', 'Seed 0', 'role-staff', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let payload = vec![
        user_value("u-seed-0", "seed-0"), // update, not counted
        user_value("u-new-1", "new-1"),   // new — the only counted row
    ];
    let counted = gate_import_user_batch(&store, &payload).unwrap();
    assert_eq!(counted, 1, "existing id must not count as a creation");
    assert_eq!(staff_count(&conn), 0, "the gate itself never writes rows");
}

#[test]
fn import_gate_users_rejects_at_cap_and_writes_nothing() {
    // Fail-closed tier (subscription row deleted -> Free, staff cap 1):
    // 1 active staff present + 1 new = 2 > 1. The refusal happens BEFORE
    // the transaction opens, so nothing is partially imported.
    let conn = fresh_conn();
    let store = Store::new(&conn);
    conn.execute("DELETE FROM tenant_subscription", []).unwrap();
    seed_staff(&conn, &store, 1);
    let payload = vec![user_value("u-new-1", "new-1")];
    let err = gate_import_user_batch(&store, &payload).unwrap_err();
    match err {
        BridgeError::Core { message, .. } => {
            assert!(message.contains("maximum 1 staff users"), "got: {message}");
            assert!(message.contains("currently have 1"), "got: {message}");
        }
        other => panic!("expected typed quota refusal, got {other:?}"),
    }
    assert_eq!(
        staff_count(&conn),
        1,
        "a refused import must not write anything"
    );
}

// ── C8 slice S3: the restore request surface ────────────────────────

/// A scratch directory removed when the guard drops.
///
/// The restore surface is filesystem-shaped — generations, a request file — so
/// unlike the rest of this module its cases cannot run over an in-memory
/// connection. Same shape as `recovery.rs`'s `Scratch`.
struct RestoreScratch(std::path::PathBuf);

impl RestoreScratch {
    fn new(label: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "kasirmu-bridge-restore-{label}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        Self(dir)
    }

    fn live(&self) -> std::path::PathBuf {
        self.0.join("store.db")
    }

    /// A migrated, file-backed database at `path` carrying `store.name`.
    fn write_db(&self, path: &std::path::Path, store_name: &str) {
        let mut conn = rusqlite::Connection::open(path).expect("open scratch db");
        kasirmu_core::migrations::run(&mut conn).expect("migrate scratch db");
        Store::new(&conn)
            .set_store_name(store_name)
            .expect("set the store name");
    }

    /// The current backup generation (`<db>.backup.db`) for the live path.
    fn generation0(&self) -> std::path::PathBuf {
        let mut path = self.live();
        path.set_extension("backup.db");
        path
    }
}

impl Drop for RestoreScratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A grant-bearing context, plus its token, for one `SETTINGS_EDIT` call.
async fn settings_editor() -> (crate::testing::TestBridge, String) {
    use crate::testing::TestBridge;
    let bridge = TestBridge::new();
    let token = bridge.token_granting(permissions::SETTINGS_EDIT).await;
    (bridge, token)
}

#[tokio::test]
async fn restore_prepare_refuses_a_corrupt_candidate_even_with_the_right_name() {
    let scratch = RestoreScratch::new("corrupt");
    let live = scratch.live();
    scratch.write_db(&live, "Kopi Senja");
    // The generation the operator would pick: present, and NOT a database.
    std::fs::write(
        scratch.generation0(),
        b"not a sqlite database, deliberately",
    )
    .expect("write the corrupt generation");

    let (bridge, token) = settings_editor().await;
    let err = restore_prepare(
        &bridge.ctx(),
        &token,
        &live,
        RestorePrepareArgs {
            candidate_path: scratch.generation0().display().to_string(),
            // The RIGHT name: the refusal must come from validation, not
            // from the confirmation.
            confirm_store_name: "Kopi Senja".into(),
        },
    )
    .await
    .expect_err("a corrupt candidate must not produce a request");
    match err {
        BridgeError::Core { message, .. } => assert!(
            message.contains("refusing"),
            "the refusal must be the validator\'s own: {message}"
        ),
        other => panic!("expected the typed validation refusal, got {other:?}"),
    }
    assert!(
        !restore_request_file(&live).exists(),
        "no request file may be written for a corrupt candidate"
    );
    assert!(
        !restore_status(&live).await.unwrap().pending,
        "status must agree that nothing is pending"
    );
}

#[tokio::test]
async fn restore_prepare_refuses_a_wrong_store_name_and_writes_no_request() {
    let scratch = RestoreScratch::new("wrongname");
    let live = scratch.live();
    scratch.write_db(&live, "Live Store");
    // A perfectly valid candidate that carries a DIFFERENT store name.
    scratch.write_db(&scratch.generation0(), "Kopi Senja");

    let (bridge, token) = settings_editor().await;
    let err = restore_prepare(
        &bridge.ctx(),
        &token,
        &live,
        RestorePrepareArgs {
            candidate_path: scratch.generation0().display().to_string(),
            // The LIVE store's name, which is the wrong answer: the candidate
            // is what is being confirmed.
            confirm_store_name: "Live Store".into(),
        },
    )
    .await
    .expect_err("a wrong store name must be refused");
    match err {
        BridgeError::Invalid(message) => assert!(
            !message.contains("Kopi Senja"),
            "the refusal must not hand back the answer it is checking for: {message}"
        ),
        other => panic!("expected a typed invalid-request refusal, got {other:?}"),
    }
    assert!(
        !restore_request_file(&live).exists(),
        "a refused confirmation must write no request file"
    );
}

#[tokio::test]
async fn restore_prepare_writes_a_request_naming_the_candidate() {
    let scratch = RestoreScratch::new("valid");
    let live = scratch.live();
    scratch.write_db(&live, "Live Store");
    scratch.write_db(&scratch.generation0(), "Kopi Senja");

    let (bridge, token) = settings_editor().await;
    let result = restore_prepare(
        &bridge.ctx(),
        &token,
        &live,
        RestorePrepareArgs {
            candidate_path: scratch.generation0().display().to_string(),
            confirm_store_name: "Kopi Senja".into(),
        },
    )
    .await
    .expect("a valid candidate with the right name must prepare a request");
    assert_eq!(result.verdict, "Acceptable");
    assert!(result.requested_at.contains('T'), "an ISO-8601 stamp");

    // The file on disk is what the boot path reads: assert its CONTENT, not
    // just the DTO.
    let raw = std::fs::read_to_string(restore_request_file(&live)).expect("request file exists");
    let parsed: serde_json::Value = serde_json::from_str(&raw).expect("request file is JSON");
    assert_eq!(
        parsed["candidate_path"].as_str().unwrap(),
        scratch.generation0().display().to_string(),
        "the request must name the candidate that was chosen"
    );
    assert_eq!(parsed["verdict"], "Acceptable");
    assert_eq!(parsed["confirmed_store_name"], "Kopi Senja");
    assert!(parsed["requested_at"].as_str().unwrap().contains('T'));

    // And status reports it back.
    let status = restore_status(&live).await.unwrap();
    assert!(status.pending);
    assert_eq!(
        status.candidate_path.as_deref(),
        Some(scratch.generation0().display().to_string().as_str())
    );
    assert_eq!(status.verdict.as_deref(), Some("Acceptable"));
    assert!(status.error.is_none());
}

// ── C8 slice S4a follow-up: the on-disk contract the BOOT CONSUMER reads ──
//
// apps/desktop-tauri/src/recovery.rs::consume_pending_restore reads the file
// this module writes and enforces three things on it, each from its OWN copy
// of the rule: the file name (it carries a second `.restore-request.json`
// constant, because `RESTORE_REQUEST_SUFFIX` here is private), the
// `candidate_path` key of its own `#[derive(Deserialize)]` struct, and that
// the path named is absolute with no `..` segment. Two copies of a rule agree
// only by inspection until something asserts them against each other, so the
// cases below assert the CONSUMER's literals against what the writer actually
// put on disk. They deliberately never build their expectation from
// `RESTORE_REQUEST_SUFFIX`: a fixture derived from the writer moves with the
// writer and would pin nothing.

/// The suffix `recovery.rs` appends — a LITERAL, on purpose, not
/// `RESTORE_REQUEST_SUFFIX`. If the writer's constant is renamed and this file
/// is updated to match in the same commit, the consumer is still looking for
/// the old name; this literal is what fails then.
const CONSUMER_REQUEST_SUFFIX: &str = ".restore-request.json";

/// The file name `recovery.rs` looks for beside a live database.
fn consumer_request_file(live: &std::path::Path) -> std::path::PathBuf {
    let name = live.file_name().unwrap().to_string_lossy().into_owned();
    live.with_file_name(format!("{name}{CONSUMER_REQUEST_SUFFIX}"))
}

/// The names in a directory, sorted; empty when it cannot be read.
fn dir_entries(dir: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// Drive the REAL `restore_prepare` against a scratch directory and return the
/// scratch (kept alive), the result DTO, and the file's parsed JSON.
async fn prepared_request(label: &str) -> (RestoreScratch, RestorePrepareResult, serde_json::Value) {
    let scratch = RestoreScratch::new(label);
    let live = scratch.live();
    scratch.write_db(&live, "Live Store");
    scratch.write_db(&scratch.generation0(), "Kopi Senja");

    let (bridge, token) = settings_editor().await;
    let result = restore_prepare(
        &bridge.ctx(),
        &token,
        &live,
        RestorePrepareArgs {
            candidate_path: scratch.generation0().display().to_string(),
            confirm_store_name: "Kopi Senja".into(),
        },
    )
    .await
    .expect("a valid candidate with the right name must prepare a request");

    let raw = std::fs::read_to_string(consumer_request_file(&live)).expect(
        "restore_prepare must have written the file the boot consumer derives from its own suffix",
    );
    let parsed = serde_json::from_str(&raw).expect("the request file must be JSON");
    (scratch, result, parsed)
}

/// (1) The name written beside a database is the exact name the consumer looks
/// for — asserted as a literal, and as the ONLY file carrying that suffix.
#[tokio::test]
async fn restore_prepare_writes_the_exact_file_name_the_boot_consumer_reads() {
    let (scratch, result, _) = prepared_request("contract-name").await;
    let live = scratch.live();
    let expected = consumer_request_file(&live);

    assert!(
        expected.is_file(),
        "restore_prepare must write exactly '{}'; the directory holds {:?}",
        expected.display(),
        dir_entries(&scratch.0)
    );
    // Exactly one file under the consumer's suffix: a second derivation in the
    // writer would leave the consumer reading the wrong one of the two.
    let requests: Vec<String> = dir_entries(&scratch.0)
        .into_iter()
        .filter(|name| name.ends_with(CONSUMER_REQUEST_SUFFIX))
        .collect();
    assert_eq!(
        requests,
        vec![expected.file_name().unwrap().to_string_lossy().into_owned()],
        "exactly one request file, under the consumer's own suffix"
    );
    // The DTO that tells the caller where the request went names that same file.
    assert_eq!(std::path::Path::new(&result.request_path), expected);
}

/// (2) The JSON carries the one key the consumer's `Deserialize` struct reads.
#[tokio::test]
async fn restore_request_json_carries_the_candidate_path_key_the_boot_consumer_deserializes() {
    let (scratch, _, parsed) = prepared_request("contract-key").await;
    let object = parsed
        .as_object()
        .expect("the request file must be a JSON object");
    assert!(
        object.contains_key("candidate_path"),
        "recovery.rs's RestoreRequest reads `candidate_path`; without that key the boot \
         deserialization fails and a restore an operator believes is queued is never \
         consumed. Keys present: {:?}",
        object.keys().collect::<Vec<_>>()
    );
    assert_eq!(
        object["candidate_path"].as_str().unwrap(),
        scratch.generation0().display().to_string(),
        "the key the consumer reads must name the candidate that was chosen"
    );
}

/// (3) The recorded candidate path is absolute and carries no `..` — the two
/// rules `read_candidate_path` refuses on, each with its own error string.
#[tokio::test]
async fn restore_request_records_an_absolute_candidate_path_without_a_parent_segment() {
    let (scratch, _, parsed) = prepared_request("contract-path").await;
    let recorded = parsed["candidate_path"]
        .as_str()
        .expect("candidate_path is a string");
    let candidate = Path::new(recorded);

    assert!(
        candidate.is_absolute(),
        "recovery.rs refuses a relative candidate path rather than resolving it against \
         the working directory; the request names '{recorded}'"
    );
    assert!(
        !candidate
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir)),
        "recovery.rs refuses a candidate path containing '..'; the request names '{recorded}'"
    );
    assert_eq!(recorded, scratch.generation0().display().to_string());
}

#[tokio::test]
async fn list_restore_candidates_reports_a_corrupt_generation_as_corrupt() {
    let scratch = RestoreScratch::new("list");
    let live = scratch.live();
    scratch.write_db(&live, "Kopi Senja");
    // Generation 0: good. Generation 1: present but unusable — the operator
    // has to SEE it and read why, not find it missing from the list.
    scratch.write_db(&scratch.generation0(), "Kopi Senja");
    let generation1 = {
        let mut path = scratch.generation0();
        path.set_extension("1.db");
        path
    };
    std::fs::write(&generation1, b"truncated by a full disk, deliberately")
        .expect("write the corrupt generation 1");

    let listed = list_restore_candidates(&live).await.unwrap();
    assert_eq!(listed.generations_examined, BACKUP_GENERATIONS);
    assert_eq!(
        listed.candidates.len(),
        2,
        "the corrupt generation must be LISTED, not omitted"
    );
    let corrupt = listed
        .candidates
        .iter()
        .find(|c| c.generation == 1)
        .expect("generation 1 must appear even though it is unusable");
    assert_eq!(corrupt.verdict, "Corrupt");
    assert!(!corrupt.restorable);
    assert!(
        corrupt.reason.contains("integrity_check") || corrupt.reason.contains("cannot open"),
        "the reason must say WHY it is unusable: {}",
        corrupt.reason
    );
    let current = listed
        .candidates
        .iter()
        .find(|c| c.generation == 0)
        .expect("the current generation");
    assert_eq!(current.verdict, "Acceptable");
    assert!(current.restorable);
    assert!(current.size_bytes > 0);
    // Newest generation first.
    assert_eq!(listed.candidates[0].generation, 1);
}

#[tokio::test]
async fn list_restore_candidates_is_empty_when_no_backup_exists() {
    let scratch = RestoreScratch::new("nobackup");
    let live = scratch.live();
    scratch.write_db(&live, "Kopi Senja");
    let listed = list_restore_candidates(&live).await.unwrap();
    assert!(listed.candidates.is_empty());
    assert_eq!(listed.generations_examined, BACKUP_GENERATIONS);
    assert!(!restore_status(&live).await.unwrap().pending);
}

#[tokio::test]
async fn restore_prepare_requires_the_settings_edit_permission() {
    use crate::testing::TestBridge;
    let scratch = RestoreScratch::new("gated");
    let live = scratch.live();
    scratch.write_db(&live, "Kopi Senja");
    scratch.write_db(&scratch.generation0(), "Kopi Senja");

    // A token that grants DATA_EXPORT but NOT SETTINGS_EDIT: the backup
    // permission must not be enough to request a restore.
    let bridge = TestBridge::new();
    let token = bridge.token_granting(permissions::DATA_EXPORT).await;
    let err = restore_prepare(
        &bridge.ctx(),
        &token,
        &live,
        RestorePrepareArgs {
            candidate_path: scratch.generation0().display().to_string(),
            confirm_store_name: "Kopi Senja".into(),
        },
    )
    .await
    .expect_err("DATA_EXPORT must not authorize a restore request");
    assert!(
        matches!(err, BridgeError::PermissionDenied(_)),
        "expected a permission denial, got {err:?}"
    );
    assert!(!restore_request_file(&live).exists());
}

#[tokio::test]
async fn restore_prepare_rejects_a_candidate_path_with_traversal() {
    let scratch = RestoreScratch::new("traversal");
    let live = scratch.live();
    scratch.write_db(&live, "Kopi Senja");
    let (bridge, token) = settings_editor().await;
    let err = restore_prepare(
        &bridge.ctx(),
        &token,
        &live,
        RestorePrepareArgs {
            candidate_path: "../outside.db".into(),
            confirm_store_name: "Kopi Senja".into(),
        },
    )
    .await
    .expect_err("C-1 must reject a traversing candidate path");
    assert!(err.to_string().contains("path traversal"), "got: {err}");
    assert!(!restore_request_file(&live).exists());
}

/// The request file beside the live database (the writer's own naming rule).
fn restore_request_file(live: &std::path::Path) -> std::path::PathBuf {
    let name = live.file_name().unwrap().to_string_lossy().into_owned();
    live.with_file_name(format!("{name}{RESTORE_REQUEST_SUFFIX}"))
}

#[test]
fn import_gate_users_proceeds_under_cap_and_pins_the_boundary() {
    // Free staff cap 1: zero active staff -> 1 new user is exactly at the
    // cap (allowed); materialize it, then the next new id must refuse.
    let conn = fresh_conn();
    let store = Store::new(&conn);
    conn.execute("DELETE FROM tenant_subscription", []).unwrap();
    seed_staff(&conn, &store, 0);
    let first = vec![user_value("u-new-1", "new-1")];
    let counted = gate_import_user_batch(&store, &first).unwrap();
    assert_eq!(counted, 1, "0 + 1 == cap 1 is allowed");
    // Materialize the approved row exactly as the import loop would.
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('u-new-1', 'new-1', 'h', 'Imported', 'role-staff', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let over = vec![user_value("u-new-2", "new-2")];
    assert!(
        gate_import_user_batch(&store, &over).is_err(),
        "1 + 1 over the Free staff cap must refuse"
    );
}
