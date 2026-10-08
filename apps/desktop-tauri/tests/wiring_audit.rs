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
    let mut end = None;
    for (i, ch) in rest.chars().enumerate() {
        match ch {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(i);
                    break;
                }
            }
            _ => {}
        }
    }
    // AN UNCLOSED BLOCK MUST NOT READ AS "NO COMMANDS". A missing `]` used to leave
    // `end` at 0, so the slice was empty and every duplicate assertion below passed
    // vacuously -- a guard that fails OPEN and reports the wiring as clean. Panicking
    // here is the right direction: this parser runs only over a lib.rs the developer
    // is editing, so a malformed block is an editing mistake to surface, never a
    // production input to tolerate.
    let end = end.unwrap_or_else(|| {
        panic!(
            "unterminated `generate_handler![` block: no matching `]` was found, so the              command list cannot be read and this audit would pass without examining anything"
        )
    });

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
            // STRIP THE TRAILING COMMENT BEFORE THE COMMA. Doing it the other way round
            // (`trim_end_matches(',')` first) leaves the comment attached to the path
            // -- `commands::a::b, // note` stayed as `commands::a::b, // note` -- and
            // then two entries for the SAME command compare unequal in the HashSet,
            // so a duplicate that panics Tauri at runtime is reported as clean.
            // Measured: duplicating `commands::audit::list_audit_log_scoped` with a
            // trailing comment on the second line kept this audit GREEN, while the
            // same duplicate without the comment was caught.
            let line = match trimmed.find("//") {
                Some(i) => &trimmed[..i],
                None => trimmed,
            };
            // TRIM FIRST, THEN THE COMMA. Slicing at `//` leaves the space that
            // preceded it -- `"commands::a::b, "` from `"commands::a::b, // note"` --
            // so `trim_end_matches(',')` sees a string ending in a SPACE and removes
            // nothing, and the comma survives into the path. Order matters, and the
            // first version of this fix got it wrong; the test above caught it.
            let path = line.trim().trim_end_matches(',').trim();
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
    let src =
        fs::read_to_string(&lib_rs).unwrap_or_else(|e| panic!("failed to read {lib_rs:?}: {e}"));

    let commands = extract_handler_commands(&src);
    assert!(
        !commands.is_empty(),
        "no generate_handler commands found in {lib_rs:?}"
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
        "Duplicate command(s) found in desktop-tauri generate_handler!: {duplicates:?}. \
         Tauri v2 panics at runtime when the same command path appears twice."
    );
}

#[test]
fn tablet_client_no_duplicate_handler_commands() {
    let lib_rs = find_lib_rs("../mobile-tauri");
    let src =
        fs::read_to_string(&lib_rs).unwrap_or_else(|e| panic!("failed to read {lib_rs:?}: {e}"));

    let commands = extract_handler_commands(&src);
    assert!(
        !commands.is_empty(),
        "no generate_handler commands found in {lib_rs:?}"
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
        "Duplicate command(s) found in mobile-tauri generate_handler!: {duplicates:?}. \
         Tauri v2 panics at runtime when the same command path appears twice."
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

// ── extract_handler_commands: the parser's own contract ────────────────
//
// WHY THESE EXIST. Every assertion in this file compares a HashSet against the
// paths this parser returns, so a parser that returns the WRONG STRINGS makes
// the audit pass while the wiring is broken. The duplicate checks guard against a
// Tauri v2 runtime panic, and the two defects below were both proven by
// measurement before being fixed -- neither was reachable from the current lib.rs,
// which is exactly why nothing had caught them.

/// A trailing line-comment on a command entry must not become part of the path.
///
/// PROVEN FALSE NEGATIVE, not a hypothetical. Duplicating
/// `commands::audit::list_audit_log_scoped` in the real `lib.rs` was CAUGHT when
/// both lines were bare, and MISSED when the second carried a `// note`: the old
/// order (`trim_end_matches(',')` then nothing) left the comment glued to the path,
/// so the HashSet held two different strings for one command. A duplicate in
/// `generate_handler!` panics the app at startup, so a missed one is a shipped
/// crash that this audit was supposed to prevent.
#[test]
fn extract_strips_a_trailing_comment_from_a_command_entry() {
    let src = "generate_handler![\n    commands::a::b, // note\n    commands::c::d, // other\n]\n";
    assert_eq!(
        extract_handler_commands(src),
        vec!["commands::a::b".to_string(), "commands::c::d".to_string()],
        "a trailing comment must not be part of the path"
    );
}

/// Two entries for the SAME command differ only by comment -- still a duplicate.
///
/// This is the shape the fix exists for, stated as the user-visible consequence
/// rather than as a parsing detail: the HashSet must see ONE path, not two.
#[test]
fn extract_yields_one_path_for_a_duplicate_carrying_a_comment() {
    let src = "generate_handler![\n    commands::a::b,\n    commands::a::b, // dup\n]\n";
    let cmds = extract_handler_commands(src);
    assert_eq!(cmds.len(), 2, "both entries must be read: {cmds:?}");
    let unique: HashSet<&String> = cmds.iter().collect();
    assert_eq!(
        unique.len(),
        1,
        "the two entries name one command, so the duplicate set must collapse them: {cmds:?}"
    );
}

/// A whole-line comment inside the block contributes nothing.
#[test]
fn extract_ignores_comment_lines_inside_the_block() {
    let src =
        "generate_handler![\n    // a comment about commands::nope::x\n    commands::a::b,\n]\n";
    assert_eq!(
        extract_handler_commands(src),
        vec!["commands::a::b".to_string()],
        "a commented path is not a registration"
    );
}

/// Nested brackets are skipped, so a bracket in an inner macro does not end the block.
#[test]
fn extract_handles_a_nested_bracket_in_the_block() {
    let src = "generate_handler![\n    commands::a::b,\n    inner![x],\n    commands::c::d,\n]\n";
    assert_eq!(
        extract_handler_commands(src),
        vec!["commands::a::b".to_string(), "commands::c::d".to_string()],
        "the nested bracket must not truncate the block"
    );
}

/// An UNTERMINATED block panics rather than reading as an empty command list.
///
/// The old behaviour left the slice empty, so every duplicate assertion passed
/// without examining anything -- the guard reported clean wiring for a lib.rs it
/// had not read. Failing loudly is the only safe direction: the alternative is an
/// audit that cannot distinguish "no duplicates" from "could not parse".
#[test]
#[should_panic(expected = "unterminated")]
fn extract_panics_on_an_unterminated_block() {
    let _ = extract_handler_commands("generate_handler![\n    commands::a::b,\n");
}

/// No `generate_handler![` at all yields no commands -- which is why the CALLERS
/// assert the list is non-empty, and why this case is stated explicitly here.
#[test]
fn extract_returns_nothing_when_the_macro_is_absent() {
    assert!(extract_handler_commands("fn main() {}\n").is_empty());
}
