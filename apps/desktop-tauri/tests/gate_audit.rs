//! Pinned gated-command census (ADR #35 D3 / spec 0047).
//!
//! Every Tauri command module in both clients is enumerated here with its
//! permission-gate census: how many `require_permission_for_user` /
//! `require_permission_for_session` calls the module makes, and which
//! permission constants flow into the gate. The list is explicit and
//! reviewed — adding a command module, or changing any gate call, requires
//! updating this pin. That diff is the review signal the spec's "pinned
//! gated-command set" calls for.
//!
//! The test also asserts:
//! - every permission key used at a gate call site is a *registered* key
//!   (the 0046 registry inventory), so an unregistered key can never reach
//!   the gate from a live command, and
//! - no raw string-literal permission (e.g. `"sales:typo"`) is passed to a
//!   gate call — unregistered literal typos are fail-closed (denied) by the
//!   gate, but they would break the command, so they are pinned out of
//!   existence.
//!
//! Scope: the *path a client actually executes*, not one directory. The
//! desktop shell's `src/commands` and the tablet shell's are walked with the
//! `authz.rs` wrapper names, and - because Wave A-E lifted the desktop
//! command bodies into `crates/kasirmu-bridge/src` (the shell files are shims that
//! build a `BridgeCtx` and forward) - the bridge is walked too, with its own
//! wrapper names, merged into the desktop table by module stem. A stem that
//! exists in both is summed; a stem that exists in only one is pinned as
//! found. So `analytics` still reads 2 after the move, because its two gate
//! calls moved rather than vanished - and a gate that is dropped instead of
//! moved still trips the pin.
//!
//! Test-module blocks are stripped before census. The gate itself is
//! `kasirmu_core::db::Store::require_permission`; the wrappers in each root's helper
//! module (`authz.rs` in the shells, `ctx.rs` in the bridge) are the only
//! entry points, so a module with zero gate calls is ungated by construction
//! (its census is pinned as `0, &[]`).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Pinned census — desktop client.
// Shell gate calls plus the gate calls in `crates/kasirmu-bridge/src`, which the shell
// forwards to. Generated from the current source; update deliberately,
// never silently.
//
// `currencies` and `exchange_rates` read 0 because their bodies were folded
// into the bridge's single `currency` module, which pins 7 - exactly the
// 2 + 5 they used to carry. The count moved; it did not disappear.
// ---------------------------------------------------------------------------
static PINNED_DESKTOP: &[(&str, usize, &[&str])] = &[
    ("analytics", 2, &["ANALYTICS_VIEW"]),
    ("audit", 7, &["AUDIT_EXPORT", "AUDIT_VIEW"]),
    ("auth", 1, &["OPERATOR_IMPERSONATE"]),
    // Pinned at their measured shape (the test compares through a BTreeMap, so the
    // row order is not load-bearing): avatars gained a STAFF_UPDATE gate and
    // desktop_link gates nothing yet, both without a census update.
    ("avatars", 1, &["STAFF_UPDATE"]),
    ("desktop_link", 0, &[]),
    ("branding", 5, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("browser", 0, &[]),
    // Pinned at its measured shape, the same call the comment above records:
    // `build_integrity.rs` gates nothing yet, and the census walks every
    // non-skipped .rs in the directory, so an added module is a row.
    ("build_integrity", 0, &[]),
    (
        "bundles",
        6,
        &[
            "PRODUCTS_CREATE",
            "PRODUCTS_DELETE",
            "PRODUCTS_READ",
            "PRODUCTS_UPDATE",
        ],
    ),
    (
        "categories",
        4,
        &[
            "PRODUCTS_CREATE",
            "PRODUCTS_DELETE",
            "PRODUCTS_READ",
            "PRODUCTS_UPDATE",
        ],
    ),
    ("currencies", 0, &[]),
    ("currency", 7, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "customers",
        10,
        &[
            "CUSTOMERS_CREATE",
            "CUSTOMERS_DELETE",
            "CUSTOMERS_EDIT",
            "CUSTOMERS_VIEW",
        ],
    ),
    // Re-pinned 2026-09-23 (was 6): 9b551e76b added the restore-candidate
    // gate require_session_permission(..., SETTINGS_EDIT) in
    // kasirmu-bridge/src/data.rs and did not bump this row. The key was
    // already pinned, so only the count moved.
    //
    // Re-pinned for C8 S5a (7 -> 10, keys gain SETTINGS_READ): the three restore
    // IPC commands are now registered in apps/desktop-tauri/src/lib.rs and gated
    // in apps/desktop-tauri/src/commands/data.rs. `restore_prepare` requires
    // SETTINGS_EDIT (it writes <db>.restore-request.json, the file the boot
    // consumer promotes); `list_restore_candidates` and `restore_status` require
    // SETTINGS_READ — the read half of the same family, so seeing that a restore
    // is pending does not confer the right to request one.
    //
    // Note for the next reader: the bridge's own `restore_prepare` enforces
    // SETTINGS_EDIT as well (kasirmu-bridge/src/data.rs:1159), and the two reads
    // take no token there by design. So the wrapper gate is NOT independently
    // observable at runtime — removing it still denies a session without the
    // permission, via the bridge. THIS ROW is what makes the wrapper gate
    // load-bearing: drop it and the count falls to 9 and this pin goes red.
    (
        "data",
        10,
        &["DATA_EXPORT", "SETTINGS_EDIT", "SETTINGS_READ"],
    ),
    ("edc", 3, &["SALES_PROCESS", "SALES_REFUND", "SALES_VOID"]),
    ("email", 3, &["REPORTS_SCHEDULE", "SETTINGS_EDIT"]),
    ("exchange_rates", 0, &[]),
    ("features", 2, &["SETTINGS_EDIT"]),
    ("fiscal", 5, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "gift_cards",
        8,
        &["GIFTCARDS_ISSUE", "GIFTCARDS_MANAGE", "GIFTCARDS_REDEEM"],
    ),
    ("hardware", 1, &["PAYMENTS_CASH"]),
    ("health", 0, &[]),
    ("history", 5, &["REPORTS_EXPORT", "SALES_VIEW"]),
    (
        "inventory",
        25,
        &[
            "INVENTORY_LOCATIONS_MANAGE",
            "INVENTORY_VIEW",
            "SALES_PROCESS",
        ],
    ),
    ("inventory_counts", 10, &["INVENTORY_COUNT"]),
    ("kds", 9, &["KDS_UPDATE", "KDS_VIEW"]),
    ("kds_device", 6, &["KDS_UPDATE", "KDS_VIEW"]),
    ("kds_routing", 3, &["KDS_UPDATE", "KDS_VIEW"]),
    ("legal_entities", 4, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("license", 3, &["SETTINGS_EDIT"]),
    ("local_api", 6, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("local_payment", 3, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("locations", 13, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "loyalty",
        8,
        &[
            "LOYALTY_EARN",
            "LOYALTY_MANAGE",
            "LOYALTY_REDEEM",
            "LOYALTY_VIEW",
        ],
    ),
    ("memo", 5, &["MEMO_STOP", "MEMO_WRITE"]),
    ("offline", 4, &["SYNC_MANAGE"]),
    (
        "payables",
        4,
        &[
            "PAYABLES_CREATE",
            "PAYABLES_SETTLE",
            "PAYABLES_VIEW",
            "PAYABLES_WRITEOFF",
        ],
    ),
    ("picker", 0, &[]),
    ("picker_ticket", 0, &[]),
    ("plugins", 0, &[]),
    // Re-pinned 2026-09-23 (was 17): 1b7bd2466 added the plugin-discount
    // gate require_session_permission(..., SALES_DISCOUNT) in
    // kasirmu-bridge/src/pos.rs and did not bump this row. The key was
    // already pinned, so only the count moved. The tablet row below stays at
    // 17: its census scans apps/mobile-tauri only, not the bridge.
    (
        "pos",
        18,
        &["SALES_DISCOUNT", "SALES_OVERRIDE_PRICE", "SALES_PROCESS"],
    ),
    (
        "product_variants",
        5,
        &[
            "PRODUCTS_CREATE",
            "PRODUCTS_DELETE",
            "PRODUCTS_READ",
            "PRODUCTS_UPDATE",
        ],
    ),
    (
        "products",
        10,
        &[
            "INVENTORY_ADJUST",
            "PRODUCTS_CREATE",
            "PRODUCTS_DELETE",
            "PRODUCTS_EDIT_COST",
            "PRODUCTS_READ",
            "PRODUCTS_UPDATE",
        ],
    ),
    ("products_images", 3, &["PRODUCTS_READ", "PRODUCTS_UPDATE"]),
    (
        "promotions",
        4,
        &[
            "PROMOTIONS_APPLY",
            "PROMOTIONS_CREATE",
            "PROMOTIONS_DELETE",
            "PROMOTIONS_EDIT",
        ],
    ),
    ("purchasing", 10, &["PURCHASING_MANAGE", "PURCHASING_VIEW"]),
    // The QRIS auto-rail command gates with SALES_PROCESS (3d50b3ac5/903b30a71);
    // row added at the round-14 review, count measured from source.
    ("qris_auto", 1, &["SALES_PROCESS"]),
    ("receipt_format", 5, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("refunds", 3, &["SALES_PROCESS", "SALES_REFUND"]),
    ("regional", 4, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    // The measured debt ledger is a .rs under src/commands, so the census walks it. It
    // names no gate and no permission (6c574ee07 landed it): that is a row to record,
    // not a file to skip - adding the stem to `skip` would stop ever looking at it.
    ("registration_gate_debt.generated", 0, &[]),
    ("reports", 1, &["REPORTS_EXPORT", "REPORTS_VIEW"]),
    ("scale", 0, &[]),
    ("security", 2, &["SECURITY_MANAGE"]),
    (
        "settings",
        15,
        &["SALES_VIEW", "SETTINGS_EDIT", "SETTINGS_READ"],
    ),
    ("setup", 1, &["STAFF_MANAGE_ROLES"]),
    (
        "shifts",
        6,
        &[
            "PAYMENTS_CASH",
            "SHIFTS_CLOSE",
            "SHIFTS_OPEN",
            "SHIFTS_VIEW_ANY",
        ],
    ),
    // Re-pinned 22-09-26 for the staff/role trash: five scoped commands moved this
    // stem from (11, four keys) to (16, six). Three of the calls are
    // `require_permission_for_user(.., STAFF_DELETE)` on delete/restore/list-trash,
    // two are `require_session_permission(.., STAFF_MANAGE_ROLES)` on the role trash,
    // and STAFF_DELETE is a new key for this row. STAFF_READ_IDENTITY was already
    // measured in the bridge's `update_staff_scoped` (the caller-aware profile
    // write) and had never been added here — this pass absorbs it rather than
    // leaving a known-stale row beside the edited one.
    (
        "staff",
        16,
        &[
            "STAFF_CREATE",
            "STAFF_DELETE",
            "STAFF_MANAGE_ROLES",
            "STAFF_READ",
            "STAFF_READ_IDENTITY",
            "STAFF_UPDATE",
        ],
    ),
    ("stock_transfers", 10, &["INVENTORY_TRANSFER"]),
    (
        "subscription",
        3,
        &[
            "ANALYTICS_VIEW",
            "INVENTORY_LOCATIONS_MANAGE",
            "LOYALTY_VIEW",
            "REPORTS_VIEW",
            "SALES_PROCESS",
            "SALES_VIEW",
            "SETTINGS_READ",
            "STAFF_CREATE",
            "SYNC_MANAGE",
            "TOPOLOGY_WRITE",
        ],
    ),
    ("sync", 12, &["SYNC_MANAGE"]),
    (
        "tables",
        6,
        &[
            "TABLES_ASSIGN",
            "TABLES_CLOSE",
            "TABLES_CREATE",
            "TABLES_DELETE",
            "TABLES_EDIT",
        ],
    ),
    ("tax", 8, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "terminals",
        17,
        &[
            "TERMINALS_DELETE",
            "TERMINALS_EDIT",
            "TERMINALS_READ",
            "TERMINALS_REGISTER",
        ],
    ),
    ("topology", 6, &["AUDIT_VIEW", "TOPOLOGY_WRITE"]),
    ("void", 1, &["SALES_VOID"]),
    (
        "workspaces",
        8,
        &["STAFF_READ", "STAFF_UPDATE", "WORKSPACES_SWITCH"],
    ),
];

// ---------------------------------------------------------------------------
// Pinned census — tablet client.
// ---------------------------------------------------------------------------
static PINNED_TABLET: &[(&str, usize, &[&str])] = &[
    ("analytics", 0, &[]),
    ("audit", 0, &[]),
    ("auth", 1, &["OPERATOR_IMPERSONATE"]),
    ("avatars", 0, &[]),
    ("branding", 0, &[]),
    // ADR #36/#37/#38 opener browser plugin: no permission-gated commands.
    ("browser", 0, &[]),
    ("bundles", 0, &[]),
    (
        "categories",
        1,
        &["PRODUCTS_CREATE", "PRODUCTS_DELETE", "PRODUCTS_UPDATE"],
    ),
    ("currencies", 3, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "customers",
        1,
        &[
            "CUSTOMERS_CREATE",
            "CUSTOMERS_DELETE",
            "CUSTOMERS_EDIT",
            "CUSTOMERS_VIEW",
        ],
    ),
    // Pinned at their measured (0 calls, no keys), same call as setting-
    // up a module: the census walks every non-skipped .rs in the commands
    // dir, so an added module is a row even when it gates nothing.
    ("data", 0, &[]),
    ("desktop_link", 0, &[]),
    ("exchange_rates", 5, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("features", 2, &["SETTINGS_EDIT"]),
    ("fiscal", 0, &[]),
    ("gift_cards", 0, &[]),
    ("hardware", 0, &[]),
    ("health", 0, &[]),
    // Re-pinned 13-09-26: 3a15dafe8 put a real permission check in the five
    // scoped history twins. Counted at apps/mobile-tauri/src/commands/history.rs
    // lines 297, 340 (SALES_VIEW) and 380, 404, 428 (REPORTS_EXPORT), using the
    // SHELL_GATES vocabulary this census applies. history_tests.rs is skipped by
    // stem, so 268198aba contributes nothing to this row.
    ("history", 5, &["REPORTS_EXPORT", "SALES_VIEW"]),
    ("inventory_counts", 1, &["INVENTORY_COUNT"]),
    ("kds", 1, &["KDS_UPDATE"]),
    ("legal_entities", 0, &[]),
    // Both walk into the census ungated and unpinned: the tablet's license.rs and
    // locations.rs hold no permission-gated command of their own (the bodies gate in
    // kasirmu-bridge), and the census walks every non-skipped .rs in the directory.
    ("license", 0, &[]),
    ("locations", 0, &[]),
    ("local_payment", 1, &["SETTINGS_EDIT"]),
    ("loyalty", 0, &[]),
    ("memo", 0, &[]),
    ("offline", 3, &["SYNC_MANAGE"]),
    ("picker_ticket", 0, &[]),
    (
        "pos",
        17,
        &["SALES_DISCOUNT", "SALES_OVERRIDE_PRICE", "SALES_PROCESS"],
    ),
    (
        "product_variants",
        2,
        &["PRODUCTS_CREATE", "PRODUCTS_UPDATE"],
    ),
    (
        "products",
        5,
        &[
            "PRODUCTS_CREATE",
            "PRODUCTS_DELETE",
            "PRODUCTS_EDIT_COST",
            "PRODUCTS_UPDATE",
        ],
    ),
    ("products_images", 0, &[]),
    (
        "promotions",
        4,
        &[
            "PROMOTIONS_APPLY",
            "PROMOTIONS_CREATE",
            "PROMOTIONS_DELETE",
            "PROMOTIONS_EDIT",
        ],
    ),
    ("purchasing", 0, &[]),
    // Tablet mirrors the QRIS auto-rail landing with two gated calls; same
    // key, reviewed at the round-14 census repair.
    ("qris_auto", 2, &["SALES_PROCESS"]),
    ("receipt_format", 2, &["SETTINGS_EDIT"]),
    ("refunds", 3, &["SALES_PROCESS", "SALES_REFUND"]),
    ("regional", 2, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    // Same as the desktop leg: the tablet ledger landed in 3c793f8e3 and the census
    // walks every non-skipped .rs in the commands dir. Pinned at its measured
    // (0 calls, no keys) rather than skipped out of existence.
    ("registration_gate_debt.generated", 0, &[]),
    ("reports", 0, &[]),
    ("scale", 0, &[]),
    (
        "settings",
        15,
        &["SALES_VIEW", "SETTINGS_EDIT", "SETTINGS_READ"],
    ),
    ("setup", 0, &[]),
    // STAFF_READ_IDENTITY joined this row at 22-09-26: the tablet's shim measures it
    // without the count moving, because the census counts CALLS and the key set is
    // collected per call. Pinned at the measured pair rather than trimmed.
    ("staff", 1, &["STAFF_READ_IDENTITY", "STAFF_UPDATE"]),
    ("stock_transfers", 0, &[]),
    (
        "subscription",
        3,
        &[
            "ANALYTICS_VIEW",
            "INVENTORY_LOCATIONS_MANAGE",
            "LOYALTY_VIEW",
            "REPORTS_VIEW",
            "SALES_PROCESS",
            "SALES_VIEW",
            "SETTINGS_READ",
            "STAFF_CREATE",
            "SYNC_MANAGE",
            "TOPOLOGY_WRITE",
        ],
    ),
    ("sync", 9, &["SYNC_MANAGE"]),
    (
        "tables",
        6,
        &[
            "TABLES_ASSIGN",
            "TABLES_CLOSE",
            "TABLES_CREATE",
            "TABLES_DELETE",
            "TABLES_EDIT",
        ],
    ),
    ("tax", 1, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("testing", 0, &[]),
    (
        "terminals",
        10,
        &[
            "TERMINALS_DELETE",
            "TERMINALS_EDIT",
            "TERMINALS_READ",
            "TERMINALS_REGISTER",
        ],
    ),
    ("void", 1, &["SALES_VOID"]),
    ("workspaces", 0, &[]),
];

/// Remove every `#[cfg(test)] { ... }` block from a source file, wherever it
/// appears (some modules interleave production commands after their tests).
fn strip_test_blocks(src: &str) -> String {
    const MARKER: &str = "#[cfg(test)]";
    let mut out = String::new();
    let mut rest = src;
    while let Some(idx) = rest.find(MARKER) {
        out.push_str(&rest[..idx]);
        let mut j = idx + MARKER.len();
        let bytes = rest.as_bytes();
        while j < bytes.len() && (bytes[j] as char).is_whitespace() {
            j += 1;
        }
        if j < bytes.len() && bytes[j] == b'{' {
            let mut depth = 0usize;
            let mut k = j;
            while k < bytes.len() {
                match bytes[k] {
                    b'{' => depth += 1,
                    b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            k += 1;
                            break;
                        }
                    }
                    _ => {}
                }
                k += 1;
            }
            rest = &rest[k.min(rest.len())..];
        } else {
            rest = &rest[idx + MARKER.len()..];
        }
    }
    out.push_str(rest);
    out
}

/// Is this line *defining* a gate wrapper rather than calling one?
///
/// A client shell keeps its wrappers in `authz.rs` (skipped wholesale), but
/// `kasirmu-bridge` defines its thin wrappers inside the same module that calls
/// them, so the definition line has to be told apart from a call site.
fn is_wrapper_definition(line: &str) -> bool {
    let mut rest = line;
    while let Some(i) = rest.find("fn require_") {
        // `fn require_x(` at the start of the remainder, or preceded only by
        // qualifiers (`pub`, `async`, `unsafe`, visibility), is a definition.
        let before = line[..i].trim_end();
        if before.is_empty()
            || before.ends_with("fn")
            || before.ends_with("async")
            || before.ends_with("unsafe")
            || before.ends_with("pub")
            || before.ends_with("crate")
            || before.ends_with("super")
            || before.ends_with("pub(crate)")
            || before.ends_with("pub(super)")
        {
            return true;
        }
        rest = &rest[i + 3..];
    }
    false
}

/// Gate entry points counted in a client shell's `src/commands`: the
/// `authz.rs` wrappers. `authz.rs` itself is skipped, so a hit is always a
/// command asking the gate.
const SHELL_GATES: &[&str] = &[
    "require_permission_for_user(",
    "require_permission_for_session(",
];

/// Gate entry points counted in `crates/kasirmu-bridge/src`. The extraction that
/// moved the command bodies out of the desktop shell moved the gates with
/// them, and renamed them: `BridgeCtx::require_session_permission` and
/// `BridgeCtx::require_permission_for_user` are the bridge's equivalents of
/// the shell's `authz.rs` wrappers, `ctx.rs` (skipped, like `authz.rs`) is
/// where they reach `Store::require_permission`, and each bridge module keeps
/// its own thin wrapper (`require_inventory_permission` and friends) that
/// commands call. A line that *defines* a wrapper is not a call site, so
/// definition lines are skipped; a command that calls the store gate
/// directly is counted by the `.require_permission(&` form, which never
/// matches a wrapper body (those pass the bare `user_id` parameter).
const BRIDGE_GATES: &[&str] = &[
    "require_session_permission(",
    "require_permission_for_user(",
    "require_permission_for_session(",
    "require_user_permission_scoped(",
    "require_permission_for_session_resource(",
    "require_session_resource_permission(",
    "require_inventory_permission(",
    "require_inventory_count_permission(",
    "require_customer_permission(",
    "require_category_permission(",
    "require_tax_permission(",
    "require_loyalty_permission(",
    "require_audit_permission(",
    ".require_permission(&",
];

// `require_audit_tier(` (bridge audit/auth, tablet audit) is deliberately not
// counted in either vocabulary: it is a subscription-tier/plan check on the
// entitlement read model, not a permission gate — it never consults the 0046
// registry, so it stays out of this census. Enumerating `require_` names and
// adding it to the lists above would reach the opposite conclusion.

/// The gate census for one module: `(gate_call_count, sorted_keys)`.
///
/// Mirrors the generator that produced the pins: comments and `use` lines
/// are skipped, inline `//` comments are cut, every call start named in
/// `gates` is counted, and every `permissions::KEY` token is collected.
fn census(src: &str, gates: &[&str]) -> (usize, Vec<String>) {
    let mut calls = 0usize;
    let mut keys = std::collections::BTreeSet::new();
    for raw in src.lines() {
        let trimmed = raw.trim_start();
        if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with("use ") {
            continue;
        }
        let line = match trimmed.find("//") {
            Some(i) => &trimmed[..i],
            None => trimmed,
        };
        if !is_wrapper_definition(line) {
            for gate in gates {
                calls += line.matches(gate).count();
            }
        }
        let mut rest = line;
        while let Some(i) = rest.find("permissions::") {
            let after = &rest[i + "permissions::".len()..];
            let name: String = after
                .chars()
                .take_while(|c| c.is_ascii_uppercase() || *c == '_')
                .collect();
            if !name.is_empty() {
                keys.insert(name);
            }
            rest = after;
        }
    }
    (calls, keys.into_iter().collect())
}

/// Raw string-literal permissions passed to a gate call named in `gates` (e.g.
/// `"sales:typo"`). The gate denies these fail-closed, but a live command
/// would break, so they are pinned out of existence.
fn raw_permission_literals(src: &str, gates: &[&str]) -> Vec<String> {
    let mut bad = Vec::new();
    for raw in src.lines() {
        let trimmed = raw.trim_start();
        if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with("use ") {
            continue;
        }
        if !gates.iter().any(|g| trimmed.contains(*g)) {
            continue;
        }
        let mut rest = trimmed;
        while let Some(q) = rest.find('"') {
            rest = &rest[q + 1..];
            if let Some(end) = rest.find('"') {
                let s = &rest[..end];
                if s.contains(':') {
                    bad.push(s.to_string());
                }
                rest = &rest[end + 1..];
            } else {
                break;
            }
        }
    }
    bad
}

/// Census one module: `.rs` files are counted directly; a subdirectory
/// (split modules like `topology/`) is aggregated under its directory name
/// so the pin tracks the *module's* permission surface wherever its files
/// live. `calls` sums across files; `keys` unions.
fn census_file(path: &Path, gates: &[&str]) -> (usize, Vec<String>) {
    let src = fs::read_to_string(path).expect("read command file");
    let stripped = strip_test_blocks(&src);
    let raw = raw_permission_literals(&stripped, gates);
    let label = path.to_string_lossy().into_owned();
    assert!(
        raw.is_empty(),
        "{label} passes raw string-literal permissions to the gate: {raw:?}"
    );
    census(&stripped, gates)
}

fn census_dir(dir: &Path, gates: &[&str], skip: &[&str]) -> BTreeMap<String, (usize, Vec<String>)> {
    let mut out: BTreeMap<String, (usize, Vec<String>)> = BTreeMap::new();
    for entry in fs::read_dir(dir).expect("read commands dir") {
        let entry = entry.expect("dir entry");
        let path = entry.path();
        let file_type = entry.file_type().expect("dir entry type");
        let stem = path
            .file_stem()
            .expect("file stem")
            .to_string_lossy()
            .into_owned();
        if file_type.is_dir() {
            let (dir_calls, dir_keys) = census_dir(&path, gates, skip)
                .into_values()
                .reduce(|a, b| {
                    (a.0 + b.0, {
                        let mut keys = a.1;
                        keys.extend(b.1);
                        keys.sort();
                        keys.dedup();
                        keys
                    })
                })
                .unwrap_or((0, Vec::new()));
            // A split module can keep a same-named root file (e.g. the thin
            // `topology.rs` beside `topology/`): sum it in rather than let
            // read_dir order decide which entry wins.
            match out.get_mut(&stem) {
                Some((calls, keys)) => {
                    *calls += dir_calls;
                    keys.extend(dir_keys);
                    keys.sort();
                    keys.dedup();
                }
                None => {
                    out.insert(stem, (dir_calls, dir_keys));
                }
            }
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        // Skip split test files and excluded modules.
        if stem == "authz"
            || stem == "mod"
            || stem.ends_with("_tests")
            || skip.contains(&stem.as_str())
        {
            continue;
        }
        let (file_calls, file_keys) = census_file(&path, gates);
        match out.get_mut(&stem) {
            Some((calls, keys)) => {
                *calls += file_calls;
                keys.extend(file_keys);
                keys.sort();
                keys.dedup();
            }
            None => {
                out.insert(stem, (file_calls, file_keys));
            }
        }
    }
    out
}

/// One census root: a directory plus the gate vocabulary that applies there.
struct Root<'a> {
    dir: PathBuf,
    gates: &'a [&'a str],
    /// Non-command support files to skip (the crate's `authz.rs` equivalent).
    skip: &'a [&'a str],
}

/// Compare the merged two-root census against the pin, and report EVERY
/// drifted row in one failure.
///
/// A pinned census is only worth what it shows when it breaks: an assertion
/// that panics on the first mismatch turns a fifty-row drift into a one-row
/// report and queues the rest behind repeated reruns. Count drift, key-set
/// drift, a pinned row with no module on disk, and a gating module missing
/// from the pin are all collected first, then reported together as one table.
fn assert_pin(roots: &[Root], pinned: &[(&str, usize, &[&str])]) {
    let mut actual: BTreeMap<String, (usize, Vec<String>)> = BTreeMap::new();
    for root in roots {
        for (stem, (calls, keys)) in census_dir(&root.dir, root.gates, root.skip) {
            match actual.get_mut(&stem) {
                Some((c, k)) => {
                    *c += calls;
                    k.extend(keys);
                    k.sort();
                    k.dedup();
                }
                None => {
                    actual.insert(stem, (calls, keys));
                }
            }
        }
    }

    // Collect every mismatch before reporting — the full table is the review
    // signal; the first row alone is a queue.
    let mut rows: Vec<String> = Vec::new();
    for (stem, exp_calls, exp_keys) in pinned {
        let Some((got_calls, got_keys)) = actual.get(*stem) else {
            rows.push(format!(
                "{stem:<20} absent   pinned, but no module on disk (pin: {exp_calls} gate calls, keys {exp_keys:?})"
            ));
            continue;
        };
        if *exp_calls != *got_calls {
            rows.push(format!(
                "{stem:<20} count    pin {exp_calls}, source {got_calls}"
            ));
        }
        let got: Vec<&str> = got_keys.iter().map(String::as_str).collect();
        if *exp_keys != &got[..] {
            rows.push(format!(
                "{stem:<20} keys     pin {exp_keys:?}, source {got:?}"
            ));
        }
    }
    for stem in actual.keys() {
        if !pinned.iter().any(|(s, _, _)| s == stem) {
            let (calls, keys) = &actual[stem];
            rows.push(format!(
                "{stem:<20} unpinned gates permissions on disk but is NOT in the pinned \
                 census (source: {calls} gate calls, keys {keys:?})"
            ));
        }
    }

    assert!(
        rows.is_empty(),
        "gate-census drift: {} of {} pinned rows disagree. Update every pin deliberately — \
         the full set is the review signal.\n  {:<20} {}\n{}",
        rows.len(),
        pinned.len(),
        "module",
        "drift",
        rows.into_iter()
            .map(|r| format!("  {r}"))
            .collect::<Vec<_>>()
            .join("\n"),
    );
}

#[test]
fn desktop_command_census_matches_pin() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // The desktop path is the shell *plus* the crate the shell delegates to:
    // Wave A-E moved the command bodies (and their gate calls) into
    // `kasirmu-bridge`, so the shell alone no longer measures anything.
    assert_pin(
        &[
            Root {
                dir: manifest.join("src/commands"),
                gates: SHELL_GATES,
                skip: &[],
            },
            Root {
                dir: manifest.join("../../crates/kasirmu-bridge/src"),
                gates: BRIDGE_GATES,
                skip: &["ctx", "lib", "error", "testing"],
            },
        ],
        PINNED_DESKTOP,
    );
}

#[test]
fn tablet_command_census_matches_pin() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // Tablet still owns its command bodies, so its shell is the whole path.
    assert_pin(
        &[Root {
            dir: manifest.join("../mobile-tauri/src/commands"),
            gates: SHELL_GATES,
            skip: &[],
        }],
        PINNED_TABLET,
    );
}

/// Resolve a census constant *name* to its permission *value*.
///
/// The census extracts constant names (`permissions::AUDIT_EXPORT`), while
/// the registry keyed by values (`"audit:export"`). Resolving through the
/// real constants keeps this honest: renaming a constant breaks the match
/// arm here, forcing the census to be updated deliberately.
fn permission_value(name: &str) -> &'static str {
    use kasirmu_core::permissions as p;
    match name {
        "ANALYTICS_VIEW" => p::ANALYTICS_VIEW,
        "AUDIT_EXPORT" => p::AUDIT_EXPORT,
        "AUDIT_VIEW" => p::AUDIT_VIEW,
        "CUSTOMERS_CREATE" => p::CUSTOMERS_CREATE,
        "CUSTOMERS_DELETE" => p::CUSTOMERS_DELETE,
        "CUSTOMERS_EDIT" => p::CUSTOMERS_EDIT,
        "CUSTOMERS_VIEW" => p::CUSTOMERS_VIEW,
        "DATA_EXPORT" => p::DATA_EXPORT,
        "GIFTCARDS_ISSUE" => p::GIFTCARDS_ISSUE,
        "GIFTCARDS_MANAGE" => p::GIFTCARDS_MANAGE,
        "GIFTCARDS_REDEEM" => p::GIFTCARDS_REDEEM,
        "INVENTORY_ADJUST" => p::INVENTORY_ADJUST,
        "INVENTORY_COUNT" => p::INVENTORY_COUNT,
        "INVENTORY_LOCATIONS_MANAGE" => p::INVENTORY_LOCATIONS_MANAGE,
        "INVENTORY_TRANSFER" => p::INVENTORY_TRANSFER,
        "INVENTORY_VIEW" => p::INVENTORY_VIEW,
        "KDS_UPDATE" => p::KDS_UPDATE,
        "KDS_VIEW" => p::KDS_VIEW,
        "LOYALTY_EARN" => p::LOYALTY_EARN,
        "LOYALTY_MANAGE" => p::LOYALTY_MANAGE,
        "LOYALTY_REDEEM" => p::LOYALTY_REDEEM,
        "LOYALTY_VIEW" => p::LOYALTY_VIEW,
        "MEMO_STOP" => p::MEMO_STOP,
        "MEMO_WRITE" => p::MEMO_WRITE,
        "OPERATOR_IMPERSONATE" => p::OPERATOR_IMPERSONATE,
        "PAYABLES_CREATE" => p::PAYABLES_CREATE,
        "PAYABLES_SETTLE" => p::PAYABLES_SETTLE,
        "PAYABLES_VIEW" => p::PAYABLES_VIEW,
        "PAYABLES_WRITEOFF" => p::PAYABLES_WRITEOFF,
        "PAYMENTS_CASH" => p::PAYMENTS_CASH,
        "PRODUCTS_CREATE" => p::PRODUCTS_CREATE,
        "PRODUCTS_DELETE" => p::PRODUCTS_DELETE,
        "PRODUCTS_EDIT_COST" => p::PRODUCTS_EDIT_COST,
        "PRODUCTS_READ" => p::PRODUCTS_READ,
        "PRODUCTS_UPDATE" => p::PRODUCTS_UPDATE,
        "PROMOTIONS_APPLY" => p::PROMOTIONS_APPLY,
        "PROMOTIONS_CREATE" => p::PROMOTIONS_CREATE,
        "PROMOTIONS_DELETE" => p::PROMOTIONS_DELETE,
        "PROMOTIONS_EDIT" => p::PROMOTIONS_EDIT,
        "PURCHASING_MANAGE" => p::PURCHASING_MANAGE,
        "PURCHASING_VIEW" => p::PURCHASING_VIEW,
        "REPORTS_EXPORT" => p::REPORTS_EXPORT,
        "REPORTS_SCHEDULE" => p::REPORTS_SCHEDULE,
        "REPORTS_VIEW" => p::REPORTS_VIEW,
        "SALES_DISCOUNT" => p::SALES_DISCOUNT,
        "SALES_OVERRIDE_PRICE" => p::SALES_OVERRIDE_PRICE,
        "SALES_PROCESS" => p::SALES_PROCESS,
        "SALES_REFUND" => p::SALES_REFUND,
        "SALES_VIEW" => p::SALES_VIEW,
        "SALES_VOID" => p::SALES_VOID,
        "SECURITY_MANAGE" => p::SECURITY_MANAGE,
        "SETTINGS_EDIT" => p::SETTINGS_EDIT,
        "SETTINGS_READ" => p::SETTINGS_READ,
        "SHIFTS_CLOSE" => p::SHIFTS_CLOSE,
        "SHIFTS_OPEN" => p::SHIFTS_OPEN,
        "SHIFTS_VIEW_ANY" => p::SHIFTS_VIEW_ANY,
        "STAFF_CREATE" => p::STAFF_CREATE,
        // Resolved through the real constant on purpose: the trash's delete/restore
        // commands gate on it, so a rename has to break this arm rather than quietly
        // unpin the key.
        "STAFF_DELETE" => p::STAFF_DELETE,
        "STAFF_MANAGE_ROLES" => p::STAFF_MANAGE_ROLES,
        "STAFF_READ" => p::STAFF_READ,
        // Measured in the bridge's caller-aware profile write; it had never been
        // resolved here, so the key set was carrying a name nothing could check.
        "STAFF_READ_IDENTITY" => p::STAFF_READ_IDENTITY,
        "STAFF_UPDATE" => p::STAFF_UPDATE,
        "SYNC_MANAGE" => p::SYNC_MANAGE,
        "TABLES_ASSIGN" => p::TABLES_ASSIGN,
        "TABLES_CLOSE" => p::TABLES_CLOSE,
        "TABLES_CREATE" => p::TABLES_CREATE,
        "TABLES_DELETE" => p::TABLES_DELETE,
        "TABLES_EDIT" => p::TABLES_EDIT,
        "TOPOLOGY_WRITE" => p::TOPOLOGY_WRITE,
        "TERMINALS_DELETE" => p::TERMINALS_DELETE,
        "TERMINALS_EDIT" => p::TERMINALS_EDIT,
        "TERMINALS_READ" => p::TERMINALS_READ,
        "TERMINALS_REGISTER" => p::TERMINALS_REGISTER,
        "WORKSPACES_SWITCH" => p::WORKSPACES_SWITCH,
        other => panic!(
            "census key `{other}` has no resolve arm — add it to permission_value() \
             deliberately, referencing the real constant"
        ),
    }
}

/// Every permission key used at a gate call site must be registered in the
/// 0046 registry — the same registry the gate's deny-by-default consults. An
/// unregistered key at a live call site would fail closed for every role,
/// including the `*` owner, silently breaking the command.
#[test]
fn all_gated_permission_keys_are_registered() {
    for (_, _, keys) in PINNED_DESKTOP.iter().chain(PINNED_TABLET) {
        for key in *keys {
            let value = permission_value(key);
            assert!(
                platform_core::permission_registry::is_registered(value),
                "permission `{value}` (from census key `{key}`) is used at a gate call site \
                 but is not in the 0046 registry — the gate denies it for every role"
            );
        }
    }
}
