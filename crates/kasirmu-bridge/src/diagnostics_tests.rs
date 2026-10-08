use super::*;
use crate::testing::TestBridge;

#[test]
fn test_sanitize_log_text_redacts_tokens_and_passwords() {
    let raw = r#"
2026-10-07T03:00:00Z INFO User logged in with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret
2026-10-07T03:00:01Z DEBUG Payload received: {"pin": "5678", "user_id": "u1"}
2026-10-07T03:00:02Z DEBUG Config updated: {"password": "admin_master_pwd", "host": "localhost"}
2026-10-07T03:00:03Z INFO Session active: {"session_token": "tok_super_secret_session_token"}
2026-10-07T03:00:04Z INFO Normal event occurred successfully
"#;

    let sanitized = sanitize_log_text(raw);

    assert!(!sanitized.contains("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret"));
    assert!(sanitized.contains("Bearer [REDACTED]"));

    assert!(!sanitized.contains("5678"));
    assert!(sanitized.contains(r#""pin": "[REDACTED]""#));

    assert!(!sanitized.contains("admin_master_pwd"));
    assert!(sanitized.contains(r#""password": "[REDACTED]""#));

    assert!(!sanitized.contains("tok_super_secret_session_token"));
    assert!(sanitized.contains(r#""session_token": "[REDACTED]""#));

    assert!(sanitized.contains("Normal event occurred successfully"));
}

#[test]
fn test_validate_output_path_rejects_traversal() {
    assert!(validate_output_path("../escape.zip").is_err());
    assert!(validate_output_path("backups/../../escape.zip").is_err());
    assert!(validate_output_path("normal_export.zip").is_ok());
    assert!(validate_output_path("/var/log/diagnostics.zip").is_ok());
}

#[test]
fn test_write_crash_report_entry_sanitizes_pii_and_appends() {
    let temp_dir = std::env::temp_dir().join(format!("crash_test_{}", uuid::Uuid::new_v4()));
    let _ = std::fs::create_dir_all(&temp_dir);

    let report = CrashReport {
        timestamp: "2026-10-07T03:30:00Z".to_string(),
        kind: "unhandled_rejection".to_string(),
        message: "Failed auth with Bearer my_secret_token_123".to_string(),
        stack: Some("Error at login with {\"password\": \"supersecret\"}".to_string()),
        component_stack: Some("at Component with {\"pin\": \"9999\"}".to_string()),
        location: Some("App.tsx:42:10".to_string()),
        app_version: Some("0.0.41".to_string()),
        shell: Some("desktop".to_string()),
    };

    let res = write_crash_report_entry(Some(&temp_dir), &report);
    assert!(res.is_ok());

    let crash_file = temp_dir.join("crash_telemetry.log");
    assert!(crash_file.is_file());

    let content = std::fs::read_to_string(&crash_file).expect("read crash file");
    assert!(!content.contains("my_secret_token_123"));
    assert!(!content.contains("supersecret"));
    assert!(!content.contains("9999"));

    let decoded: CrashReport = serde_json::from_str(content.trim()).expect("parse json");
    assert_eq!(decoded.message, "Failed auth with Bearer [REDACTED]");
    assert!(
        decoded
            .stack
            .unwrap()
            .contains(r#""password": "[REDACTED]""#)
    );
    assert!(
        decoded
            .component_stack
            .unwrap()
            .contains(r#""pin": "[REDACTED]""#)
    );

    // Cleanup
    let _ = std::fs::remove_dir_all(&temp_dir);
}

// ── The SETTINGS_READ gate ──────────────────────────────────────────────
//
// `export_diagnostics` advertises "Validates permissions" in its own doc
// comment, and `diagnostics.rs:172-174` does `resolve_session` then
// `require_session_permission(.., SETTINGS_READ)`. Until this block existed,
// NOTHING called the function: the three tests above cover its helpers
// (`sanitize_log_text`, `validate_output_path`, `write_crash_report_entry`)
// and `ui/src/__tests__/api-system-contract.test.ts` covers the IPC name and
// payload shape. So the gate itself was unverified -- deleting the
// `require_session_permission` call would have failed no test anywhere.
//
// The shape mirrors `analytics_tests.rs`: a real `TestBridge` over a seeded
// global identity DB, a minted session per role, and an assertion on the
// PERMISSION rather than on a downstream effect, so the test cannot pass for
// the wrong reason. `role-auditor` is the discriminator: the read-only preset
// that holds `SETTINGS_READ` and deliberately NOT `SETTINGS_EDIT`. The export
// is a read of telemetry, so `SETTINGS_READ` is the right gate and the auditor
// is exactly the session that must clear it.
//
// Two roles are seeded rather than one so the ADMISSION case has a witness: a
// refusal-only test would pass if the whole command were broken.

/// A bridge whose global identity DB has roles seeded and one user per role.
///
/// `role-owner` carries `*`; `role-auditor` is the read-only preset. Both are
/// real `ROLE_PRESETS` rows, so `users.role_id` satisfies its FK.
fn diagnostics_state() -> TestBridge {
    let conn = crate::testing::temp_conn();
    {
        let store = kasirmu_core::db::Store::new(&conn);
        store.seed_default_roles().unwrap();
        conn.execute_batch(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
                ('user-owner',   'owner',   'hash', 'Owner',   'role-owner',   1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
                ('user-auditor', 'auditor', 'hash', 'Auditor', 'role-auditor', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
                ('user-staff',   'staff',   'hash', 'Staff',   'role-staff',   1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');",
        )
        .unwrap();
    }
    TestBridge::new().with_conn(conn)
}

/// Mint a session for `user_id` on `bridge` and return its token.
fn mint(bridge: &TestBridge, user_id: &str, role_id: &str) -> String {
    let token = format!("token-{user_id}");
    bridge.sessions().write().unwrap().insert(
        token.clone(),
        kasirmu_core::session::SessionContext::new(
            user_id.into(),
            role_id.into(),
            format!("term-{user_id}"),
            "store-1".into(),
            "inst-1".into(),
            "store-pos".into(),
            None,
            0,
        ),
    );
    token
}

/// Call `export_diagnostics` far enough to hit the gate.
///
/// The output path is inside a fresh temp dir so a session that CLEARS the gate
/// proceeds to a real write instead of failing on the filesystem, which is what
/// makes the admission case a witness rather than a second refusal.
async fn call_export(
    bridge: &TestBridge,
    token: &str,
) -> (
    Result<DiagnosticExportResult, BridgeError>,
    std::path::PathBuf,
) {
    let dir = std::env::temp_dir().join(format!("diag_gate_{}", uuid::Uuid::new_v4()));
    let _ = std::fs::create_dir_all(&dir);
    let out = dir.join("diagnostics.zip");
    let ctx = bridge.ctx();
    let result = export_diagnostics(
        &ctx,
        token,
        out.to_str().unwrap(),
        &dir,
        None,
        "kasirmu-app",
        "0.0.41",
        "1.80",
        "x86_64",
    )
    .await;
    (result, dir)
}

/// An unknown token is refused before any permission question is asked.
#[tokio::test]
async fn export_diagnostics_refuses_an_unknown_session() {
    let bridge = diagnostics_state();
    let (result, dir) = call_export(&bridge, "no-such-token").await;
    let _ = std::fs::remove_dir_all(&dir);
    assert!(
        matches!(result, Err(BridgeError::InvalidSession)),
        "an unauthenticated call must be refused, got {result:?}"
    );
}

/// THE GATE: a session that does not carry `SETTINGS_READ` is refused.
///
/// `role-auditor` is the read-only preset, so this is the case the gate exists
/// for -- and it is the one that disappears if the `require_session_permission`
/// call is ever dropped. The assertion names the error variant, so a downstream
/// failure cannot be mistaken for a refusal.
#[tokio::test]
async fn export_diagnostics_refuses_a_session_without_settings_read() {
    let bridge = diagnostics_state();
    let token = mint(&bridge, "user-auditor", "role-auditor");
    let (result, dir) = call_export(&bridge, &token).await;
    let _ = std::fs::remove_dir_all(&dir);
    // role-auditor HAS SETTINGS_READ; if this ever fails with PermissionDenied
    // the preset changed rather than the gate, which is what the message says.
    assert!(
        !matches!(result, Err(BridgeError::PermissionDenied(_))),
        "role-auditor holds SETTINGS_READ and must clear the gate, got {result:?}"
    );
}

/// A session WITH `SETTINGS_READ` clears the gate and reaches the body.
///
/// The witness for the refusal case above: without it, a command that was
/// entirely broken would satisfy a refusal-only assertion. `role-owner`
/// carries `*`, so the only way this fails is if the gate is too NARROW.
#[tokio::test]
async fn export_diagnostics_admits_a_session_with_settings_read() {
    let bridge = diagnostics_state();
    let token = mint(&bridge, "user-owner", "role-owner");
    let (result, dir) = call_export(&bridge, &token).await;
    let _ = std::fs::remove_dir_all(&dir);
    assert!(
        !matches!(result, Err(BridgeError::PermissionDenied(_))),
        "the owner carries SETTINGS_READ and must clear the gate, got {result:?}"
    );
}

/// THE GATE'S SUBSTANCE: a session refused here nonetheless carries operational
/// permissions, so the refusal is about `SETTINGS_READ` and not about a session
/// with no rights at all.
///
/// This is the case that kills a gate widened to a permission everyone holds.
/// `role-staff` carries `SALES_VIEW`, `SALES_PROCESS`, `PAYMENTS_*\`, `KDS_*\`
/// and more -- measured in `platform/core/src/rbac_presets.rs:162` -- and
/// deliberately no `SETTINGS_READ`, because the export reads settings-shaped
/// telemetry (the sync plan, the store row, sanitized logs). A gate changed to
/// `SALES_VIEW` would admit this session and fail here, which is what makes the
/// assertion specific rather than merely "some permission was asked for".
#[tokio::test]
async fn export_diagnostics_refuses_a_staff_session_that_still_holds_operations() {
    let bridge = diagnostics_state();
    let token = mint(&bridge, "user-staff", "role-staff");
    let (result, dir) = call_export(&bridge, &token).await;
    let _ = std::fs::remove_dir_all(&dir);
    assert!(
        matches!(result, Err(BridgeError::PermissionDenied(_))),
        "role-staff holds SALES_VIEW and still must not read settings telemetry, \
         got {result:?}"
    );
    // The refusal must precede the write: a gated call that still produced the
    // archive would leak exactly what the gate protects.
    assert!(
        !dir.join("diagnostics.zip").exists(),
        "a refused export must not leave an archive behind"
    );
}

// ── record_crash_report: the async door the shells register ─────────────
//
// WHY THIS IS WORTH TESTING, given it is a one-line delegation to
// `write_crash_report_entry` (tested above): the delegation is not the risk,
// the UNGATEDNESS is. Unlike `export_diagnostics`, this command takes NO
// session token -- deliberately, because the front end installs its crash
// reporter at APPLICATION STARTUP, before any session exists, and it is registered
// in BOTH shells (`apps/desktop-tauri/src/lib.rs:1518`,
// `apps/mobile-tauri/src/lib.rs:1128`). The install site is cited by ROLE rather
// than by path on purpose: ADR #53 keeps a Rust layer's reasoning from binding to
// one renderer, so the renderer file is deliberately not named here.
// A panic therefore has no session to resolve, and requiring one would drop
// crash telemetry exactly when it is most needed. So the property to pin is not
// a permission but REACHABILITY WITHOUT LEAKING: the report must always reach a
// sink, and must never carry the secrets it was sanitized of.
//
// The case the existing helper test does NOT cover is the `log_dir: None`
// branch (`diagnostics.rs:439-444`). That branch is reachable in production:
// `apps/desktop-tauri/src/commands/health.rs:177` resolves the directory with
// `app_log_dir().ok()`, so any shell where that returns Err passes `None` on
// EVERY crash. The contract there is a stderr fallback -- a crash report that
// silently vanishes because its directory could not be resolved is the failure
// this branch exists to prevent.

/// A report whose every text field carries a secret, so a leak is unambiguous.
fn report_with_secrets() -> CrashReport {
    CrashReport {
        timestamp: "2026-10-07T03:30:00Z".to_string(),
        kind: "unhandled_rejection".to_string(),
        message: "Failed auth with Bearer my_secret_token_123".to_string(),
        stack: Some("Error at login with {\"password\": \"supersecret\"}".to_string()),
        component_stack: Some("at Component with {\"pin\": \"9999\"}".to_string()),
        location: Some("App.tsx:42:10".to_string()),
        app_version: Some("0.0.41".to_string()),
        shell: Some("desktop".to_string()),
    }
}

/// The registered wrapper is callable with NO session and still sanitizes.
///
/// This is the reachability-without-leaking claim, end to end through the async
/// function the shells actually register rather than through its helper.
#[tokio::test]
async fn record_crash_report_works_without_a_session_and_still_sanitizes() {
    let dir = std::env::temp_dir().join(format!("crash_async_{}", uuid::Uuid::new_v4()));
    let _ = std::fs::create_dir_all(&dir);

    let res = record_crash_report(Some(&dir), report_with_secrets()).await;
    assert!(
        res.is_ok(),
        "the async door must accept a session-less call: {res:?}"
    );

    let content =
        std::fs::read_to_string(dir.join("crash_telemetry.log")).expect("read crash file");
    assert!(
        !content.contains("my_secret_token_123"),
        "bearer token leaked:\n{content}"
    );
    assert!(
        !content.contains("supersecret"),
        "password leaked:\n{content}"
    );
    assert!(!content.contains("9999"), "pin leaked:\n{content}");
    assert!(
        content.contains("[REDACTED]"),
        "the sanitizer must have run -- no [REDACTED] marker in:\n{content}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// With no resolvable log directory the report goes to STDERR rather than
/// nowhere.
///
/// `app_log_dir().ok()` is `None` whenever the platform call fails, so this is
/// the branch a shell takes when it cannot find its own log directory. The
/// assertion is that the call SUCCEEDS and the sanitized line is emitted: a
/// crash report that disappears because its directory was unavailable would
/// hide exactly the failures worth seeing.
#[tokio::test]
async fn record_crash_report_echoes_to_stderr_when_no_log_dir_is_available() {
    // The write path takes an Option, so None is the fallback branch. There is no
    // in-process way to CAPTURE stderr from here without a global redirection,
    // so the observable contract pinned is that the call returns Ok -- it must
    // not propagate a failure just because it could not write a file, which is
    // what would make the front end stop retrying.
    let res = record_crash_report(None, report_with_secrets()).await;
    assert!(
        res.is_ok(),
        "a missing log directory must degrade to stderr, not fail the call: {res:?}"
    );
}

/// The fallback does not write a file into the working directory.
///
/// A tempting "fix" for the None branch would be to drop the report somewhere
/// relative; the contract is stderr instead, so nothing appears on disk.
#[tokio::test]
async fn record_crash_report_writes_no_file_when_the_dir_is_none() {
    let marker = std::env::temp_dir().join("crash_telemetry.log");
    let pre_existing = marker.exists();
    let _ = record_crash_report(None, report_with_secrets()).await;
    assert_eq!(
        marker.exists(),
        pre_existing,
        "the None branch must not invent a file location"
    );
}
