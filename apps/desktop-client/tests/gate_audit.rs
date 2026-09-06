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
//! Scope: `src/commands/*.rs`, excluding the `authz.rs` helper module and
//! `mod.rs`. Test-module blocks are stripped before census. The gate itself
//! is `oz_core::db::Store::require_permission`; the client wrappers in
//! `authz.rs` are the only entry points, so a module with zero gate calls is
//! ungated by construction (its census is pinned as `0, &[]`).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Pinned census — desktop client.
// Generated from the current source; update deliberately, never silently.
// ---------------------------------------------------------------------------
static PINNED_DESKTOP: &[(&str, usize, &[&str])] = &[
    ("analytics", 2, &["ANALYTICS_VIEW"]),
    ("audit", 1, &["AUDIT_EXPORT", "AUDIT_VIEW"]),
    ("auth", 0, &[]),
    ("branding", 5, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    // ADR #36/#37/#38 opener browser plugin: no permission-gated commands.
    ("browser", 0, &[]),
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
        2,
        &[
            "PRODUCTS_CREATE",
            "PRODUCTS_DELETE",
            "PRODUCTS_READ",
            "PRODUCTS_UPDATE",
        ],
    ),
    ("currencies", 2, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "customers",
        5,
        &[
            "CUSTOMERS_CREATE",
            "CUSTOMERS_DELETE",
            "CUSTOMERS_EDIT",
            "CUSTOMERS_VIEW",
        ],
    ),
    ("data", 5, &["DATA_EXPORT", "SETTINGS_EDIT"]),
    ("edc", 3, &["SALES_PROCESS", "SALES_REFUND", "SALES_VOID"]),
    ("email", 3, &["REPORTS_SCHEDULE", "SETTINGS_EDIT"]),
    ("exchange_rates", 5, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("features", 2, &["SETTINGS_EDIT"]),
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
        1,
        &[
            "INVENTORY_LOCATIONS_MANAGE",
            "INVENTORY_VIEW",
            "SALES_PROCESS",
        ],
    ),
    ("inventory_counts", 1, &["INVENTORY_COUNT"]),
    ("kds", 9, &["KDS_UPDATE", "KDS_VIEW"]),
    ("kds_device", 6, &["KDS_UPDATE", "KDS_VIEW"]),
    ("kds_routing", 1, &["KDS_VIEW"]),
    ("license", 3, &["SETTINGS_EDIT"]),
    ("local_api", 6, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "loyalty",
        1,
        &[
            "LOYALTY_EARN",
            "LOYALTY_MANAGE",
            "LOYALTY_REDEEM",
            "LOYALTY_VIEW",
        ],
    ),
    ("offline", 4, &["SYNC_MANAGE"]),
    ("picker_ticket", 0, &[]),
    ("plugins", 0, &[]),
    (
        "pos",
        15,
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
    ("refunds", 3, &["SALES_PROCESS", "SALES_REFUND"]),
    ("reports", 1, &["REPORTS_EXPORT", "REPORTS_VIEW"]),
    ("scale", 0, &[]),
    ("security", 2, &["SECURITY_MANAGE"]),
    (
        "settings",
        14,
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
    (
        "staff",
        6,
        &[
            "STAFF_CREATE",
            "STAFF_MANAGE_ROLES",
            "STAFF_READ",
            "STAFF_UPDATE",
        ],
    ),
    ("stock_transfers", 1, &["INVENTORY_TRANSFER"]),
    ("locations", 7, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("subscription", 0, &[]),
    ("sync", 10, &["SYNC_MANAGE"]),
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
    ("topology", 3, &["STAFF_UPDATE"]),
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
    ("analytics", 2, &["ANALYTICS_VIEW"]),
    ("audit", 1, &["AUDIT_EXPORT", "AUDIT_VIEW"]),
    ("auth", 0, &[]),
    ("branding", 0, &[]),
    // ADR #36/#37/#38 opener browser plugin: no permission-gated commands.
    ("browser", 0, &[]),
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
        1,
        &["PRODUCTS_CREATE", "PRODUCTS_DELETE", "PRODUCTS_UPDATE"],
    ),
    ("currencies", 3, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "customers",
        4,
        &[
            "CUSTOMERS_CREATE",
            "CUSTOMERS_DELETE",
            "CUSTOMERS_EDIT",
            "CUSTOMERS_VIEW",
        ],
    ),
    ("exchange_rates", 5, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("features", 2, &["SETTINGS_EDIT"]),
    (
        "gift_cards",
        8,
        &["GIFTCARDS_ISSUE", "GIFTCARDS_MANAGE", "GIFTCARDS_REDEEM"],
    ),
    ("hardware", 0, &[]),
    ("health", 0, &[]),
    ("history", 0, &[]),
    ("inventory_counts", 1, &["INVENTORY_COUNT"]),
    ("kds", 5, &["KDS_UPDATE", "KDS_VIEW"]),
    (
        "loyalty",
        1,
        &[
            "LOYALTY_EARN",
            "LOYALTY_MANAGE",
            "LOYALTY_REDEEM",
            "LOYALTY_VIEW",
        ],
    ),
    ("offline", 4, &["SYNC_MANAGE"]),
    ("picker_ticket", 0, &[]),
    (
        "pos",
        19,
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
            "PRODUCTS_CREATE",
            "PRODUCTS_DELETE",
            "PRODUCTS_EDIT_COST",
            "PRODUCTS_UPDATE",
        ],
    ),
    (
        "promotions",
        8,
        &[
            "PROMOTIONS_APPLY",
            "PROMOTIONS_CREATE",
            "PROMOTIONS_DELETE",
            "PROMOTIONS_EDIT",
        ],
    ),
    ("purchasing", 10, &["PURCHASING_MANAGE", "PURCHASING_VIEW"]),
    ("refunds", 3, &["SALES_PROCESS", "SALES_REFUND"]),
    ("reports", 1, &["REPORTS_EXPORT", "REPORTS_VIEW"]),
    ("scale", 0, &[]),
    ("settings", 12, &["SETTINGS_EDIT"]),
    ("setup", 0, &[]),
    (
        "staff",
        6,
        &[
            "STAFF_CREATE",
            "STAFF_MANAGE_ROLES",
            "STAFF_READ",
            "STAFF_UPDATE",
        ],
    ),
    ("stock_transfers", 1, &["INVENTORY_TRANSFER"]),
    ("subscription", 0, &[]),
    ("sync", 7, &["SYNC_MANAGE"]),
    (
        "tables",
        12,
        &[
            "TABLES_ASSIGN",
            "TABLES_CLOSE",
            "TABLES_CREATE",
            "TABLES_DELETE",
            "TABLES_EDIT",
        ],
    ),
    ("tax", 1, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "terminals",
        12,
        &["TERMINALS_DELETE", "TERMINALS_EDIT", "TERMINALS_REGISTER"],
    ),
    ("void", 2, &["SALES_VOID"]),
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

/// The gate census for one module: `(gate_call_count, sorted_keys)`.
///
/// Mirrors the generator that produced the pins: comments and `use` lines
/// are skipped, inline `//` comments are cut, `require_permission_for_user(`
/// / `require_permission_for_session(` call starts are counted, and every
/// `permissions::KEY` token is collected.
fn census(src: &str) -> (usize, Vec<String>) {
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
        calls += line.matches("require_permission_for_user(").count()
            + line.matches("require_permission_for_session(").count();
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

/// Raw string-literal permissions passed to a gate call (e.g.
/// `"sales:typo"`). The gate denies these fail-closed, but a live command
/// would break, so they are pinned out of existence.
fn raw_permission_literals(src: &str) -> Vec<String> {
    let mut bad = Vec::new();
    for raw in src.lines() {
        let trimmed = raw.trim_start();
        if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with("use ") {
            continue;
        }
        if !trimmed.contains("require_permission_for_") {
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
fn census_file(path: &Path) -> (usize, Vec<String>) {
    let src = fs::read_to_string(path).expect("read command file");
    let stripped = strip_test_blocks(&src);
    let raw = raw_permission_literals(&stripped);
    let label = path.to_string_lossy().into_owned();
    assert!(
        raw.is_empty(),
        "{label} passes raw string-literal permissions to the gate: {raw:?}"
    );
    census(&stripped)
}

fn census_dir(dir: &Path) -> BTreeMap<String, (usize, Vec<String>)> {
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
            let (dir_calls, dir_keys) = census_dir(&path)
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
        if stem == "authz" || stem == "mod" || stem.ends_with("_tests") {
            continue;
        }
        let (file_calls, file_keys) = census_file(&path);
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

fn assert_pin(dir: &Path, pinned: &[(&str, usize, &[&str])]) {
    let actual = census_dir(dir);

    for (stem, exp_calls, exp_keys) in pinned {
        let (got_calls, got_keys) = actual
            .get(*stem)
            .unwrap_or_else(|| panic!("module `{stem}` is pinned but not found on disk"));
        assert_eq!(
            *exp_calls, *got_calls,
            "`{stem}.rs` gate-call count drifted: pin says {exp_calls}, source has {got_calls}. \
             Update the pin deliberately — a changed gate call is the review signal."
        );
        let got: Vec<&str> = got_keys.iter().map(String::as_str).collect();
        assert_eq!(
            *exp_keys,
            &got[..],
            "`{stem}.rs` permission surface drifted from the pin. \
             Update the pin deliberately."
        );
    }

    for stem in actual.keys() {
        assert!(
            pinned.iter().any(|(s, _, _)| s == stem),
            "module `{stem}` gates permissions but is NOT in the pinned census. \
             Every permission-sensitive command must be reviewed and pinned."
        );
    }
}

#[test]
fn desktop_command_census_matches_pin() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/commands");
    assert_pin(&dir, PINNED_DESKTOP);
}

#[test]
fn tablet_command_census_matches_pin() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tablet-client/src/commands");
    assert_pin(&dir, PINNED_TABLET);
}

/// Resolve a census constant *name* to its permission *value*.
///
/// The census extracts constant names (`permissions::AUDIT_EXPORT`), while
/// the registry keyed by values (`"audit:export"`). Resolving through the
/// real constants keeps this honest: renaming a constant breaks the match
/// arm here, forcing the census to be updated deliberately.
fn permission_value(name: &str) -> &'static str {
    use oz_core::permissions as p;
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
        "STAFF_MANAGE_ROLES" => p::STAFF_MANAGE_ROLES,
        "STAFF_READ" => p::STAFF_READ,
        "STAFF_UPDATE" => p::STAFF_UPDATE,
        "SYNC_MANAGE" => p::SYNC_MANAGE,
        "TABLES_ASSIGN" => p::TABLES_ASSIGN,
        "TABLES_CLOSE" => p::TABLES_CLOSE,
        "TABLES_CREATE" => p::TABLES_CREATE,
        "TABLES_DELETE" => p::TABLES_DELETE,
        "TABLES_EDIT" => p::TABLES_EDIT,
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
