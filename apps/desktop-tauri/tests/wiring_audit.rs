//! Tauri v2 wiring audit — exposes duplicate command registrations
//! in the `generate_handler!` macro that would cause a runtime panic.
//!
//! This test also protects the Staff security boundary: legacy unscoped
//! staff commands must not be registered after audit-open-findings remediation.
//! Tauri v2 panics at runtime when duplicate command paths appear in the macro.
//!
//! This test parses the `lib.rs` source and asserts no duplicate entries
//! exist, preventing future regressions.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

/// Extract all command paths from the `generate_handler![...]` block
/// in a lib.rs file. Returns them in order of appearance.
fn extract_handler_commands(src: &str) -> Vec<String> {
    let start_marker = "generate_handler![";
    let start = match src.find(start_marker) {
        Some(idx) => idx + start_marker.len(),
        None => return Vec::new(),
    };

    // Find the matching closing `]` by counting brackets.
    let rest = &src[start..];
    let mut depth = 1;
    let mut end = 0;
    for (i, ch) in rest.chars().enumerate() {
        match ch {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    end = i;
                    break;
                }
            }
            _ => {}
        }
    }

    let block = &rest[..end];

    // Each line in the block is either a command path (e.g. `commands::staff::list_staff,`)
    // or a comment. Extract command paths by looking for lines containing `commands::`.
    block
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.starts_with("//") || trimmed.is_empty() {
                return None;
            }
            // Remove trailing comma and whitespace
            let path = trimmed.trim_end_matches(',').trim();
            if path.starts_with("commands::") {
                Some(path.to_string())
            } else {
                None
            }
        })
        .collect()
}

fn find_lib_rs(app_dir: &str) -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let candidates = [
        PathBuf::from(manifest_dir).join(app_dir).join("src/lib.rs"),
        PathBuf::from(manifest_dir)
            .join("..")
            .join(app_dir)
            .join("src/lib.rs"),
    ];
    for c in &candidates {
        if c.exists() {
            return c.clone();
        }
    }
    candidates[0].clone()
}

#[test]
fn desktop_client_no_duplicate_handler_commands() {
    let lib_rs = find_lib_rs(".");
    let src = fs::read_to_string(&lib_rs)
        .unwrap_or_else(|e| panic!("failed to read {:?}: {}", lib_rs, e));

    let commands = extract_handler_commands(&src);
    assert!(
        !commands.is_empty(),
        "no generate_handler commands found in {:?}",
        lib_rs
    );

    let mut seen = HashSet::new();
    let mut duplicates = Vec::new();
    for cmd in &commands {
        if !seen.insert(cmd.clone()) {
            duplicates.push(cmd.clone());
        }
    }

    assert!(
        duplicates.is_empty(),
        "Duplicate command(s) found in desktop-tauri generate_handler!: {:?}. \
         Tauri v2 panics at runtime when the same command path appears twice.",
        duplicates
    );
}

#[test]
fn tablet_client_no_duplicate_handler_commands() {
    let lib_rs = find_lib_rs("../mobile-tauri");
    let src = fs::read_to_string(&lib_rs)
        .unwrap_or_else(|e| panic!("failed to read {:?}: {}", lib_rs, e));

    let commands = extract_handler_commands(&src);
    assert!(
        !commands.is_empty(),
        "no generate_handler commands found in {:?}",
        lib_rs
    );

    let mut seen = HashSet::new();
    let mut duplicates = Vec::new();
    for cmd in &commands {
        if !seen.insert(cmd.clone()) {
            duplicates.push(cmd.clone());
        }
    }

    assert!(
        duplicates.is_empty(),
        "Duplicate command(s) found in mobile-tauri generate_handler!: {:?}. \
         Tauri v2 panics at runtime when the same command path appears twice.",
        duplicates
    );
}

/// Verify that scoped inventory-transfer commands are registered on desktop
/// and legacy unscoped transfer commands are no longer exposed through IPC.
#[test]
fn desktop_client_stock_transfer_commands_use_scoped_boundary() {
    let lib_rs = find_lib_rs(".");
    let src = fs::read_to_string(&lib_rs).expect("failed to read lib.rs");
    let commands = extract_handler_commands(&src);

    for scoped in [
        "commands::stock_transfers::create_stock_transfer_scoped",
        "commands::stock_transfers::get_stock_transfer_scoped",
        "commands::stock_transfers::list_stock_transfers_scoped",
        "commands::stock_transfers::list_in_transit_transfers_scoped",
        "commands::stock_transfers::get_stock_transfer_lines_scoped",
        "commands::stock_transfers::add_stock_transfer_line_scoped",
        "commands::stock_transfers::remove_stock_transfer_line_scoped",
        "commands::stock_transfers::send_stock_transfer_scoped",
        "commands::stock_transfers::receive_stock_transfer_scoped",
        "commands::stock_transfers::cancel_stock_transfer_scoped",
    ] {
        assert!(
            commands.iter().any(|command| command == scoped),
            "desktop client must register scoped transfer command: {scoped}"
        );
    }
    for legacy in [
        "commands::stock_transfers::create_stock_transfer",
        "commands::stock_transfers::get_stock_transfer",
        "commands::stock_transfers::list_stock_transfers",
        "commands::stock_transfers::get_stock_transfer_lines",
        "commands::stock_transfers::add_stock_transfer_line",
        "commands::stock_transfers::remove_stock_transfer_line",
        "commands::stock_transfers::send_stock_transfer",
        "commands::stock_transfers::receive_stock_transfer",
        "commands::stock_transfers::cancel_stock_transfer",
    ] {
        assert!(
            !commands.iter().any(|command| command == legacy),
            "legacy unscoped transfer command must not be registered: {legacy}"
        );
    }
}

/// Verify that the scoped Staff command is registered and the disabled
/// legacy unscoped Staff command is not exposed through IPC.
#[test]
fn desktop_client_staff_commands_use_scoped_boundary() {
    let lib_rs = find_lib_rs(".");
    let src = fs::read_to_string(&lib_rs).expect("failed to read lib.rs");

    let commands = extract_handler_commands(&src);

    assert!(
        commands.contains(&"commands::staff::list_staff_scoped".to_string()),
        "scoped Staff listing must remain registered"
    );
    for legacy in [
        "commands::staff::list_staff",
        "commands::staff::list_roles",
        "commands::staff::create_staff",
        "commands::staff::update_staff",
        // These workspace-assignment commands accepted raw caller IDs and
        // are replaced by session-scoped variants. General pre-session
        // workspace discovery commands remain registered intentionally.
        "commands::workspaces::list_all_workspaces",
        "commands::workspaces::set_user_workspace_instances",
        "commands::workspaces::get_user_workspace_instances",
    ] {
        assert!(
            !commands.iter().any(|command| command == legacy),
            "legacy unscoped Staff command must not be registered: {legacy}"
        );
    }
}

/// Verify tablet exposes the same scoped transfer boundary as desktop.
#[test]
fn tablet_client_stock_transfer_commands_use_scoped_boundary() {
    let lib_rs = find_lib_rs("../mobile-tauri");
    let src = fs::read_to_string(&lib_rs).expect("failed to read tablet lib.rs");
    let commands = extract_handler_commands(&src);

    for scoped in [
        "commands::stock_transfers::create_stock_transfer_scoped",
        "commands::stock_transfers::get_stock_transfer_scoped",
        "commands::stock_transfers::list_stock_transfers_scoped",
        "commands::stock_transfers::list_in_transit_transfers_scoped",
        "commands::stock_transfers::get_stock_transfer_lines_scoped",
        "commands::stock_transfers::add_stock_transfer_line_scoped",
        "commands::stock_transfers::remove_stock_transfer_line_scoped",
        "commands::stock_transfers::send_stock_transfer_scoped",
        "commands::stock_transfers::receive_stock_transfer_scoped",
        "commands::stock_transfers::cancel_stock_transfer_scoped",
    ] {
        assert!(
            commands.iter().any(|command| command == scoped),
            "tablet client must register scoped transfer command: {scoped}"
        );
    }
    for legacy in [
        "commands::stock_transfers::create_stock_transfer",
        "commands::stock_transfers::get_stock_transfer",
        "commands::stock_transfers::list_stock_transfers",
        "commands::stock_transfers::get_stock_transfer_lines",
        "commands::stock_transfers::add_stock_transfer_line",
        "commands::stock_transfers::remove_stock_transfer_line",
        "commands::stock_transfers::send_stock_transfer",
        "commands::stock_transfers::receive_stock_transfer",
        "commands::stock_transfers::cancel_stock_transfer",
    ] {
        assert!(
            !commands.iter().any(|command| command == legacy),
            "tablet client must not register legacy transfer command: {legacy}"
        );
    }
}

/// Verify the tablet client exposes only session-scoped Staff commands too.
#[test]
fn tablet_client_staff_commands_use_scoped_boundary() {
    let lib_rs = find_lib_rs("../mobile-tauri");
    let src = fs::read_to_string(&lib_rs).expect("failed to read tablet lib.rs");
    let commands = extract_handler_commands(&src);

    for scoped in [
        "commands::staff::list_staff_scoped",
        "commands::staff::list_roles_scoped",
        "commands::staff::create_staff_scoped",
        "commands::staff::update_staff_scoped",
    ] {
        assert!(
            commands.iter().any(|command| command == scoped),
            "tablet client must register scoped Staff command: {scoped}"
        );
    }
    for legacy in [
        "commands::staff::list_staff",
        "commands::staff::list_roles",
        "commands::staff::create_staff",
        "commands::staff::update_staff",
        // The tablet client has never exposed the legacy workspace assignment
        // surface; keep this assertion so a future registration cannot bypass
        // the session-scoped boundary established for desktop.
        "commands::workspaces::list_all_workspaces",
        "commands::workspaces::set_user_workspace_instances",
        "commands::workspaces::get_user_workspace_instances",
    ] {
        assert!(
            !commands.iter().any(|command| command == legacy),
            "tablet client must not register legacy unscoped command: {legacy}"
        );
    }
}
