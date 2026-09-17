//! Unit tests for the branding DTOs and logo-path validation (test
//! relocation: moved out of `apps/desktop-tauri/src/commands/branding_tests.rs`).
//!
//! Mounted at the foot of `branding.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves `BrandSettingsDto` and `ALLOWED_LOGO_EXTENSIONS`
//! from the bridge module directly. The dialog-backed `pick_logo_file`
//! commands stay desktop-side (parked tauri-plugin-dialog seam) and carry
//! no unit tests of their own.

use super::*;
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

#[test]
fn validate_logo_empty_path_is_allowed_duplicate() {
    assert!(validate_logo_path_inner("").is_ok());
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
