//! Unit tests for the branding DTOs and logo-path validation (test
//! relocation: moved out of `apps/desktop-tauri/src/commands/branding_tests.rs`).
//!
//! Mounted at the foot of `branding.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves `BrandSettingsDto` and `ALLOWED_LOGO_EXTENSIONS`
//! from the bridge module directly. The dialog-backed `pick_logo_file`
//! commands stay desktop-side (parked tauri-plugin-dialog seam) and carry
//! no unit tests of their own.

use super::*;

use crate::testing::{TestBridge, temp_conn};
use kasirmu_core::session::SessionContext;

#[test]
fn brand_settings_debug() {
    let s = BrandSettingsDto {
        primary_colour: "#10b981".into(),
        logo_path: Some("/assets/logo.png".into()),
        store_name: "My Shop".into(),
    };
    let debug = format!("{s:?}");
    assert!(debug.contains("#10b981"));
    assert!(debug.contains("logo.png"));
    assert!(debug.contains("My Shop"));
}

#[test]
fn brand_settings_serialize() {
    let s = BrandSettingsDto {
        primary_colour: "#ff0000".into(),
        logo_path: Some("/logo.svg".into()),
        store_name: "OZ MART".into(),
    };
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(json["primary_colour"], "#ff0000");
    assert_eq!(json["logo_path"], "/logo.svg");
    assert_eq!(json["store_name"], "OZ MART");
}

#[test]
fn brand_settings_no_logo_path() {
    let s = BrandSettingsDto {
        primary_colour: "#000000".into(),
        logo_path: None,
        store_name: "Store".into(),
    };
    let json = serde_json::to_value(&s).unwrap();
    assert!(json["logo_path"].is_null());
}

#[test]
fn brand_settings_deserialize_no_logo() {
    let json = r##"{"primary_colour":"#abcdef","logo_path":null,"store_name":"Test"}"##;
    let s: BrandSettingsDto = serde_json::from_str(json).unwrap();
    assert_eq!(s.primary_colour, "#abcdef");
    assert!(s.logo_path.is_none());
    assert_eq!(s.store_name, "Test");
}

#[test]
fn validate_logo_empty_path_is_allowed() {
    // Empty path means "clear the logo" — always allowed.
    assert!(validate_logo_path_inner("").unwrap().is_empty());
}

/// Inline helper that bypasses the AppHandle requirement for unit tests.
fn validate_logo_path_inner(path: &str) -> Result<String, BridgeError> {
    if path.is_empty() {
        return Ok(String::new());
    }
    // Check extension even without app_data_dir validation.
    let p = Path::new(path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !ALLOWED_LOGO_EXTENSIONS.contains(&ext.as_str()) {
        return Err(BridgeError::Invalid(format!(
            "logo file type '.{ext}' is not allowed"
        )));
    }
    // Skip canonicalization in unit tests — it requires a real filesystem.
    Ok(path.to_string())
}

// ── Scoped write/read targeting ─────────────────────────────────

fn seed_owner(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

/// Headless scoped bridge: the caller's connection becomes the GLOBAL identity
/// db, the harness supplies the per-store manager, and the session is seeded.
fn scoped_bridge(
    conn: rusqlite::Connection,
    token: &str,
    user_id: &str,
    role_id: &str,
    store_id: &str,
) -> TestBridge {
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions().write().unwrap().insert(
        token.into(),
        SessionContext::new(
            user_id.into(),
            role_id.into(),
            "terminal-1".into(),
            store_id.into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    tb
}

/// A logo the operator picks through Settings must be readable back through the
/// same scoped door that renders it.
///
/// `set_brand_logo_path_scoped` used to open the session's store database (via
/// `resolve_scope`) and then **discard** it, writing the GLOBAL identity db
/// instead — while its reader `get_brand_settings_scoped`, its two sibling
/// setters (`set_brand_primary_colour_scoped` / `set_brand_store_name_scoped`)
/// and the tablet's own copy all use the session store. The picked logo was
/// therefore write-only on desktop: it vanished the moment the renderer read it
/// back, and nothing said so.
#[tokio::test]
async fn scoped_brand_logo_round_trips_through_the_store_db() {
    let conn = temp_conn();
    seed_owner(&conn);
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    let ctx = tb.ctx();

    set_brand_logo_path_scoped(&ctx, "/logo.png", "tok", None)
        .await
        .unwrap();

    // The write must land where the scoped reader reads.
    let settings = get_brand_settings_scoped(&ctx, "tok").await.unwrap();
    assert_eq!(
        settings.logo_path.as_deref(),
        Some("/logo.png"),
        "a logo written through the scoped setter must be read back by the scoped reader"
    );

    // And it must NOT have gone into the global identity db, where no branding
    // reader looks for it.
    {
        let global = ctx.lock_global().await;
        assert!(
            Settings::get_brand_logo_path(&global).unwrap().is_none(),
            "the scoped logo write must not be stranded in the global identity db"
        );
    }
}

#[test]
fn validate_logo_rejects_disallowed_extension() {
    let err = validate_logo_path_inner("/etc/passwd").unwrap_err();
    let msg = format!("{err}");
    assert!(
        msg.contains("not allowed"),
        "expected 'not allowed', got: {msg}"
    );
}

#[test]
fn validate_logo_allows_png() {
    let result = validate_logo_path_inner("/tmp/logo.png");
    assert!(result.is_ok(), "png extension should be allowed");
}

#[test]
fn validate_logo_allows_svg() {
    let result = validate_logo_path_inner("/tmp/logo.svg");
    assert!(result.is_ok(), "svg extension should be allowed");
}

// ── validate_logo_path: the REAL function, on a real filesystem ─────────
//
// WHY THESE EXIST. Everything above exercises `validate_logo_path_inner`, a
// hand-written LINE-BY-LINE REPLICA that deliberately skips canonicalisation
// ("Skip canonicalization in unit tests — it requires a real filesystem"). The
// replica is not the production rule: `validate_logo_path` also asserts the
// resolved path is INSIDE the app data directory, and that containment check —
// the one that stops a traversal out of the data dir — is not reachable through
// the replica at all. MEASURED: deleting the whole containment block from
// `branding.rs` left this file's 10 tests GREEN, so a security check could be
// removed with nothing objecting.
//
// These use `tempfile` to satisfy the canonicalisation the real function needs,
// and call the REAL `validate_logo_path` — the replica stays for the cheap
// extension cases, but nothing here depends on it.

/// Write a file inside `dir` and return its path as a string.
fn file_in(dir: &std::path::Path, name: &str) -> String {
    let p = dir.join(name);
    std::fs::write(&p, b"x").expect("write fixture file");
    p.to_str().expect("utf-8 path").to_string()
}

/// A path INSIDE the app data dir with an allowed extension is accepted.
#[test]
fn validate_logo_path_accepts_a_file_inside_app_data() {
    let app_data = tempfile::tempdir().expect("temp dir");
    let logo = file_in(app_data.path(), "logo.png");
    let ok = validate_logo_path(&Ok(app_data.path().to_path_buf()), &logo)
        .expect("a png inside app data must be accepted");
    assert!(ok.ends_with("logo.png"), "returns the canonical path: {ok}");
}

/// THE CONTAINMENT CHECK: a path OUTSIDE app data is refused even when the
/// extension is allowed.
///
/// This is the case the replica cannot express, and the reason the deletion
/// above went unnoticed. An allowed `.png` outside the data directory must still
/// be rejected — otherwise the extension list becomes the only control, and any
/// readable image on the host is a valid "logo".
#[test]
fn validate_logo_path_refuses_a_path_outside_app_data() {
    let app_data = tempfile::tempdir().expect("app data dir");
    let elsewhere = tempfile::tempdir().expect("another dir");
    let logo = file_in(elsewhere.path(), "logo.png");
    let err = validate_logo_path(&Ok(app_data.path().to_path_buf()), &logo)
        .expect_err("a png OUTSIDE app data must be refused");
    let msg = format!("{err}");
    assert!(
        msg.contains("inside the application data directory"),
        "the refusal must name containment, not the extension: {msg}"
    );
}

/// A traversal that RESOLVES out of app data is refused after canonicalisation.
///
/// `..` is the shape the canonicalisation step exists for: a naive string prefix
/// check would see the app-data prefix and pass. The sibling directory is reached
/// through the traversal, so only the post-canonicalisation comparison catches it.
#[test]
fn validate_logo_path_refuses_a_traversal_out_of_app_data() {
    let root = tempfile::tempdir().expect("root");
    let app_data = root.path().join("appdata");
    let evil = root.path().join("evil");
    std::fs::create_dir_all(&app_data).expect("mkdir appdata");
    std::fs::create_dir_all(&evil).expect("mkdir evil");
    std::fs::write(evil.join("logo.png"), b"x").expect("write evil file");

    let traversal = app_data.join("..").join("evil").join("logo.png");
    let err = validate_logo_path(&Ok(app_data.clone()), traversal.to_str().expect("utf-8"))
        .expect_err("a traversal resolving outside app data must be refused");
    assert!(
        format!("{err}").contains("inside the application data directory"),
        "expected a containment refusal, got: {err}"
    );
}

/// An allowed extension inside app data still passes, and a disallowed one inside
/// app data is refused — both through the REAL function.
#[test]
fn validate_logo_path_extension_rules_hold_through_the_real_function() {
    let app_data = tempfile::tempdir().expect("temp dir");
    let good = file_in(app_data.path(), "logo.svg");
    assert!(validate_logo_path(&Ok(app_data.path().to_path_buf()), &good).is_ok());

    let bad = file_in(app_data.path(), "payload.exe");
    let err = validate_logo_path(&Ok(app_data.path().to_path_buf()), &bad)
        .expect_err("an .exe must be refused");
    assert!(
        format!("{err}").contains("not allowed"),
        "expected an extension refusal, got: {err}"
    );
}

/// An empty path clears the logo and needs no filesystem.
#[test]
fn validate_logo_path_allows_the_empty_clear_path() {
    let app_data = tempfile::tempdir().expect("temp dir");
    let ok = validate_logo_path(&Ok(app_data.path().to_path_buf()), "").expect("empty clears");
    assert!(ok.is_empty());
}
