//! Window visibility lifecycle test — verifies the desktop client's
//! window-creation configuration that the show-after-restore pattern
//! in `lib.rs` depends on.
//!
//! The desktop app starts with `visible: false` in tauri.conf.json to
//! prevent an initial position flash while `window-state` restores the
//! previous position/size. After setup completes, `lib.rs` calls
//! `app.get_webview_window("main")?.show()`. This test verifies the
//! config contract that the lib.rs code relies on.

use std::fs;
use std::path::PathBuf;

/// The window label used in tauri.conf.json and lib.rs setup.
const MAIN_WINDOW_LABEL: &str = "main";

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

#[test]
fn tauri_conf_main_window_starts_hidden() {
    let conf_path = manifest_dir().join("tauri.conf.json");
    let raw = fs::read_to_string(&conf_path)
        .unwrap_or_else(|e| panic!("failed to read {:?}: {}", conf_path, e));

    let parsed: serde_json::Value =
        serde_json::from_str(&raw).expect("tauri.conf.json should be valid JSON");

    let windows = parsed["app"]["windows"]
        .as_array()
        .expect("app.windows should be an array");
    assert!(
        !windows.is_empty(),
        "should have at least one window defined"
    );

    let main_window = &windows[0];
    assert_eq!(
        main_window["label"].as_str(),
        Some(MAIN_WINDOW_LABEL),
        "main window label must be '{MAIN_WINDOW_LABEL}' — \
         lib.rs calls get_webview_window(\"{MAIN_WINDOW_LABEL}\")?.show()"
    );
    assert_eq!(
        main_window["visible"].as_bool(),
        Some(false),
        "main window must start with visible: false to prevent \
         initial position flash during window-state restore"
    );
}

#[test]
fn lib_rs_shows_main_window_after_setup() {
    // Verify the lib.rs source contains the show-after-restore pattern.
    // This guards against accidental removal during refactoring.
    // The pattern is: app.get_webview_window("main")?.show()
    let lib_path = manifest_dir().join("src/lib.rs");
    let src = fs::read_to_string(&lib_path)
        .unwrap_or_else(|e| panic!("failed to read {:?}: {}", lib_path, e));

    assert!(
        src.contains("get_webview_window(\"main\")"),
        "lib.rs must call get_webview_window(\"main\") to find the window"
    );

    // The .show() call must appear AFTER app.manage(state) so window-state
    // can restore position/size before the window becomes visible.
    let manage_pos = src
        .find("app.manage(state)")
        .expect("lib.rs must contain app.manage(state)");
    let show_pos = src
        .find("get_webview_window(\"main\")")
        .expect("lib.rs must contain get_webview_window");

    assert!(
        show_pos > manage_pos,
        "get_webview_window.show() must be called after app.manage(state) — \
         window-state needs managed state for position/size restore before show"
    );
}
