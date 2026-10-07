use super::*;
use std::path::PathBuf;

// ── Helpers ────────────────────────────────────────────────────────

/// Create a temp plugin directory with `plugin.toml` and `script.lua`,
/// declaring the given `required_permissions`.
/// Returns (TempDir, plugins_root_dir) — the TempDir must be kept alive.
///
/// Also writes a `plugin-grants.json` approving exactly the declared
/// permissions. The operator grant gate (C2) refuses a plugin whose
/// permissions were never approved, so a fixture that declared permissions
/// without granting them would now fail to load — and every test here is about
/// hook behaviour, not about the gate. The gate itself, including the refusal
/// case, is tested in `grants_tests.rs`.
fn create_plugin_dir(
    name: &str,
    lua_content: &str,
    perms: &[&str],
) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let plugin_dir = dir.path().join(name);
    std::fs::create_dir(&plugin_dir).unwrap();

    let perms_list = perms
        .iter()
        .map(|p| format!("\"{p}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let manifest = format!(
        "[plugin]\nname = \"{name}\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = [\"script.lua\"]\n\n[permissions]\nrequired_permissions = [{perms_list}]\n"
    );
    std::fs::write(plugin_dir.join("plugin.toml"), manifest).unwrap();
    std::fs::write(plugin_dir.join("script.lua"), lua_content).unwrap();

    // Approve exactly what the manifest declares (see the doc comment above).
    std::fs::write(
        dir.path().join(crate::grants::GRANTS_FILE_NAME),
        format!("{{\"schema_version\":1,\"grants\":{{\"{name}\":[{perms_list}]}}}}"),
    )
    .unwrap();

    let plugins_root = dir.path().to_path_buf();
    (dir, plugins_root)
}

/// Approve the declared permissions of EVERY plugin directory under
/// `plugins_root`, writing one `plugin-grants.json`.
///
/// Scans the directory rather than taking a plugin name, so a multi-plugin
/// fixture is approved in one call and the file is built once — no merge, no
/// chance of a later call withdrawing an earlier approval.
fn grant_all_declared(plugins_root: &std::path::Path) {
    let mut map = serde_json::Map::new();
    for entry in std::fs::read_dir(plugins_root).unwrap() {
        let entry = entry.unwrap();
        let manifest_path = entry.path().join("plugin.toml");
        let Ok(manifest) = std::fs::read_to_string(&manifest_path) else {
            continue;
        };
        let name = manifest
            .lines()
            .find_map(|l| l.trim().strip_prefix("name = "))
            .map(|v| v.trim().trim_matches('"').to_string());
        let Some(name) = name else { continue };

        // The `required_permissions` array may span MANY lines (the
        // all-permission-types fixture does), so take everything from the key
        // to the closing bracket rather than assuming one line.
        let perms: Vec<serde_json::Value> = manifest
            .split("required_permissions")
            .nth(1)
            .and_then(|rest| rest.split('[').nth(1))
            .and_then(|rest| rest.split(']').next())
            .unwrap_or("")
            .split(',')
            .map(|s| s.trim().trim_matches('"').to_string())
            .filter(|s| !s.is_empty())
            .map(serde_json::Value::String)
            .collect();

        map.insert(name, serde_json::Value::Array(perms));
    }
    let doc = serde_json::json!({ "schema_version": 1, "grants": map });
    std::fs::write(
        plugins_root.join(crate::grants::GRANTS_FILE_NAME),
        serde_json::to_string_pretty(&doc).unwrap(),
    )
    .unwrap();
}

/// Helper to build a single `CartLineData`.
fn line(sku: &str, qty: i64, unit_price_minor: i64, currency: &str) -> CartLineData {
    CartLineData {
        sku: sku.into(),
        qty,
        unit_price_minor,
        currency: currency.into(),
    }
}

// ── PendingDiscount tests (existing) ───────────────────────────────

#[test]
fn pending_discount_new() {
    let d = PendingDiscount {
        target: "COFFEE".into(),
        percent: 10,
    };
    assert_eq!(d.target, "COFFEE");
    assert_eq!(d.percent, 10);
}

#[test]
fn pending_discount_debug() {
    let d = PendingDiscount {
        target: "COFFEE".into(),
        percent: 10,
    };
    let debug = format!("{d:?}");
    assert!(debug.contains("COFFEE"));
    assert!(debug.contains("10"));
}

#[test]
fn pending_discount_clone() {
    let d = PendingDiscount {
        target: "TEA".into(),
        percent: 25,
    };
    let cloned = d.clone();
    assert_eq!(d.target, cloned.target);
    assert_eq!(d.percent, cloned.percent);
}

#[test]
fn pending_discount_zero_percent() {
    let d = PendingDiscount {
        target: "ITEM".into(),
        percent: 0,
    };
    assert_eq!(d.percent, 0);
}

#[test]
fn pending_discount_large_percent() {
    let d = PendingDiscount {
        target: "ITEM".into(),
        percent: 100,
    };
    assert_eq!(d.percent, 100);
}

// ── PluginManager::new() tests ─────────────────────────────────────

// ── Permission enforcement tests ─────────────────────────────────

#[test]
fn plugin_without_permissions_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let plugin_dir = dir.path().join("no-perms");
    std::fs::create_dir(&plugin_dir).unwrap();
    // No [permissions] section at all — should be rejected.
    std::fs::write(
        plugin_dir.join("plugin.toml"),
        "[plugin]\nname = \"no-perms\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = []\n",
    )
    .unwrap();
    let result = PluginManager::new(dir.path());
    assert!(
        result.is_err(),
        "plugin without permissions should be rejected"
    );
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("required_permissions") || err.contains("no-perms"),
        "error should mention missing permissions, got: {err}"
    );
}

#[test]
fn plugin_with_cart_read_permission_succeeds() {
    let (_dir, plugins_root) = create_plugin_dir("cart-only", "", &["cart:read"]);
    // create_plugin_dir already includes required_permissions = ["cart:read"]
    let mgr = PluginManager::new(&plugins_root).unwrap();
    assert!(mgr.drain_pending_discounts().is_empty());
}

#[test]
fn multiple_plugins_with_valid_permissions_all_load() {
    let dir = tempfile::tempdir().unwrap();
    for (i, name) in ["plug-a", "plug-b"].iter().enumerate() {
        let plugin_dir = dir.path().join(name);
        std::fs::create_dir(&plugin_dir).unwrap();
        std::fs::write(
            plugin_dir.join("plugin.toml"),
            format!(
                r#"[plugin]
name = "{name}"
version = "1.0.0"

[capabilities]
scripts = []

[permissions]
required_permissions = ["cart:read"]
"#
            ),
        )
        .unwrap();
        let _ = i; // suppress warning
    }
    // Approve both plugins' declared permissions (C2 grant gate).
    grant_all_declared(dir.path());
    let mgr = PluginManager::new(dir.path()).unwrap();
    assert!(mgr.drain_pending_discounts().is_empty());
}

#[test]
fn plugin_with_unknown_permission_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let plugin_dir = dir.path().join("unknown-perm");
    std::fs::create_dir(&plugin_dir).unwrap();
    std::fs::write(
        plugin_dir.join("plugin.toml"),
        r#"[plugin]
name = "unknown-perm"
version = "1.0.0"

[permissions]
required_permissions = ["cart:read", "super:admin"]
"#,
    )
    .unwrap();
    // "super:admin" is unrecognised — PLG-08 rejects unknown permissions
    // with an actionable diagnostic instead of silently dropping them.
    let err = PluginManager::new(dir.path()).unwrap_err();
    assert!(
        err.to_string().contains("unknown permission"),
        "expected actionable rejection, got: {err}"
    );
    assert!(err.to_string().contains("super:admin"));
}

#[test]
fn plugin_with_all_permission_types_is_accepted() {
    let dir = tempfile::tempdir().unwrap();
    let plugin_dir = dir.path().join("all-perms");
    std::fs::create_dir(&plugin_dir).unwrap();
    std::fs::write(
        plugin_dir.join("plugin.toml"),
        r#"[plugin]
name = "all-perms"
version = "1.0.0"

[permissions]
required_permissions = [
    "cart:read",
    "cart:write",
    "tax:read",
    "inventory:read",
    "inventory:write",
    "reporting:read",
    "system:time",
    "log:write",
]
"#,
    )
    .unwrap();
    grant_all_declared(dir.path());
    let mgr = PluginManager::new(dir.path()).unwrap();
    assert!(mgr.drain_pending_discounts().is_empty());
}

#[test]
fn permission_display_format() {
    use crate::manifest::Permission;
    assert_eq!(Permission::CartRead.to_string(), "cart:read");
    assert_eq!(Permission::CartWrite.to_string(), "cart:write");
    assert_eq!(Permission::TaxRead.to_string(), "tax:read");
    assert_eq!(Permission::InventoryRead.to_string(), "inventory:read");
    assert_eq!(Permission::InventoryWrite.to_string(), "inventory:write");
    assert_eq!(Permission::ReportingRead.to_string(), "reporting:read");
    assert_eq!(Permission::SystemTime.to_string(), "system:time");
    assert_eq!(Permission::LogWrite.to_string(), "log:write");
}

// ── Existing tests ────────────────────────────────────────────────

#[test]
fn plugin_manager_new_with_empty_dir() {
    let dir = tempfile::tempdir().unwrap();
    let mgr = PluginManager::new(dir.path()).unwrap();
    assert!(mgr.drain_pending_discounts().is_empty());
}

#[test]
fn plugin_manager_new_with_nonexistent_dir() {
    let mgr = PluginManager::new(Path::new("/nonexistent/plugin/dir")).unwrap();
    assert!(mgr.drain_pending_discounts().is_empty());
}

#[test]
fn plugin_manager_new_with_empty_script() {
    let (_dir, plugins_root) = create_plugin_dir("empty-plugin", "", &["cart:read"]);
    let mgr = PluginManager::new(&plugins_root).unwrap();
    assert!(mgr.drain_pending_discounts().is_empty());
}

#[test]
fn plugin_manager_new_with_hook_registration_and_no_side_effects() {
    let lua = r#"
function my_hook(sale)
    -- no-op hook
end
oz.register_hook("sale.before_complete", "my_hook")
"#;
    let (_dir, plugins_root) = create_plugin_dir("hook-plugin", lua, &["cart:read"]);
    let mgr = PluginManager::new(&plugins_root).unwrap();
    // Hook was registered but not fired — no discounts pushed
    assert!(mgr.drain_pending_discounts().is_empty());
}

#[test]
fn plugin_manager_new_with_top_level_discount_push() {
    let lua = r#"
oz.apply_discount("cart", 10)
oz.apply_discount("line:SKU123", 20)
"#;
    let (_dir, plugins_root) = create_plugin_dir("discount-plugin", lua, &["cart:write"]);
    let mgr = PluginManager::new(&plugins_root).unwrap();
    let discounts = mgr.drain_pending_discounts();
    assert_eq!(discounts.len(), 2);
    assert_eq!(discounts[0].target, "cart");
    assert_eq!(discounts[0].percent, 10);
    assert_eq!(discounts[1].target, "line:SKU123");
    assert_eq!(discounts[1].percent, 20);
}

#[test]
fn plugin_manager_new_with_invalid_lua_syntax() {
    let lua = "function broken(syntax";
    let (_dir, plugins_root) = create_plugin_dir("broken-plugin", lua, &["cart:read"]);
    let result = PluginManager::new(&plugins_root);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("Lua") || err.contains("script"),
        "expected Lua error, got: {err}"
    );
}

#[test]
fn plugin_manager_new_with_real_example_discount_plugin() {
    // Use the real example-discount plugin from the workspace.
    //
    // The path is the PLUGIN directory, not `scripts/examples`: the operator
    // grant file (C2) is resolved inside the directory handed to
    // `PluginManager::new`, so pointing at the parent would look for a grants
    // file that has no business existing there.
    let plugins_dir =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../scripts/examples/example-discount");
    let mgr = PluginManager::new(&plugins_dir).unwrap();
    // The example-discount registers a hook, no top-level discount push.
    let discounts = mgr.drain_pending_discounts();
    assert!(discounts.is_empty());
}

#[test]
fn real_example_plugin_hook_executes_without_error() {
    // Regression test for P0-5: verify the real example-discount
    // plugin's hook fires without crashing or errors.
    // The plugin applies a 10% discount on Tuesdays (wday == 3),
    // so the discount may or may not be created depending on the
    // current day — this test verifies the hook machinery works.
    let plugins_dir =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../scripts/examples/example-discount");
    let mgr = PluginManager::new(&plugins_dir).unwrap();

    let lines = [line("TEST", 1, 1000, "USD")];
    let result = mgr.fire_sale_before_complete(&lines, 1000, "USD", "user-1");
    assert!(result.is_ok(), "hook should execute without error");

    // Hook may or may not push a discount (depends on day of week),
    // but drain must succeed without panic.
    let _ = mgr.drain_pending_discounts();
}

// ── drain_pending_discounts tests ──────────────────────────────────

#[test]
fn drain_pending_discounts_empty_after_fresh_init() {
    let dir = tempfile::tempdir().unwrap();
    let mgr = PluginManager::new(dir.path()).unwrap();
    assert!(mgr.drain_pending_discounts().is_empty());
}

#[test]
fn drain_pending_discounts_drains_after_top_level_push() {
    let lua = r#"
oz.apply_discount("cart", 5)
oz.apply_discount("cart", 15)
oz.apply_discount("line:A", 25)
"#;
    let (_dir, plugins_root) = create_plugin_dir("multi-discount", lua, &["cart:write"]);
    let mgr = PluginManager::new(&plugins_root).unwrap();

    let discounts = mgr.drain_pending_discounts();
    assert_eq!(discounts.len(), 3);

    // Second drain is empty (already drained)
    assert!(mgr.drain_pending_discounts().is_empty());
}

#[test]
fn drain_pending_discounts_after_hook_fire() {
    let lua = r#"
function my_hook(sale)
    oz.apply_discount("cart", 15)
end
oz.register_hook("sale.before_complete", "my_hook")
"#;
    let (_dir, plugins_root) =
        create_plugin_dir("hook-discount", lua, &["cart:read", "cart:write"]);
    let mgr = PluginManager::new(&plugins_root).unwrap();

    // Fire the hook — it should push a discount
    let lines = [line("ITEM", 1, 1000, "USD")];
    mgr.fire_sale_before_complete(&lines, 1000, "USD", "user-1")
        .unwrap();

    let discounts = mgr.drain_pending_discounts();
    assert_eq!(discounts.len(), 1);
    assert_eq!(discounts[0].target, "cart");
    assert_eq!(discounts[0].percent, 15);
}

// ── fire_sale_before_complete tests ────────────────────────────────

#[test]
fn fire_sale_before_complete_no_hooks() {
    let dir = tempfile::tempdir().unwrap();
    let mgr = PluginManager::new(dir.path()).unwrap();

    let result = mgr.fire_sale_before_complete(&[], 0, "USD", "anon");
    assert!(result.is_ok());
    assert!(mgr.drain_pending_discounts().is_empty());
}

#[test]
fn fire_sale_before_complete_with_hook_discounts() {
    let lua = r#"
function on_sale(sale)
    if sale.total_minor >= 5000 then
        oz.apply_discount("cart", 10)
    end
end
oz.register_hook("sale.before_complete", "on_sale")
"#;
    let (_dir, plugins_root) =
        create_plugin_dir("threshold-hook", lua, &["cart:read", "cart:write"]);
    let mgr = PluginManager::new(&plugins_root).unwrap();

    // Below threshold — no discount
    mgr.fire_sale_before_complete(&[line("CHEAP", 1, 100, "IDR")], 100, "IDR", "user-1")
        .unwrap();
    assert!(mgr.drain_pending_discounts().is_empty());

    // Above threshold — discount should fire
    mgr.fire_sale_before_complete(
        &[line("EXPENSIVE", 1, 10000, "IDR")],
        10000,
        "IDR",
        "user-1",
    )
    .unwrap();
    let discounts = mgr.drain_pending_discounts();
    assert_eq!(discounts.len(), 1);
    assert_eq!(discounts[0].percent, 10);
}

#[test]
fn fire_sale_before_complete_with_multiple_lines() {
    let lua = r#"
function count_lines(sale)
    local count = 0
    for i = 1, #sale.lines do
        count = count + 1
    end
    oz.apply_discount("cart", count * 5)
end
oz.register_hook("sale.before_complete", "count_lines")
"#;
    let (_dir, plugins_root) = create_plugin_dir("count-hook", lua, &["cart:read", "cart:write"]);
    let mgr = PluginManager::new(&plugins_root).unwrap();

    mgr.fire_sale_before_complete(
        &[
            line("A", 1, 500, "USD"),
            line("B", 2, 300, "USD"),
            line("C", 1, 1000, "USD"),
        ],
        2100,
        "USD",
        "user-1",
    )
    .unwrap();

    let discounts = mgr.drain_pending_discounts();
    assert_eq!(discounts.len(), 1);
    // 3 lines × 5 = 15
    assert_eq!(discounts[0].percent, 15);
}

/// MONEY-05: the sale table hands qty / unit_price_minor / total_minor to
/// the VM as Lua floats, so plugin `qty * unit_price_minor` arithmetic
/// cannot silently integer-wrap. Pinned with overflow-scale input — before
/// the float conversion this hook's total wrapped negative and the
/// discount never fired.
#[test]
fn fire_sale_before_complete_overflow_scale_money_uses_float_semantics() {
    let lua = r#"
function on_sale(sale)
    local total = 0
    for i = 1, #sale.lines do
        total = total + sale.lines[i].qty * sale.lines[i].unit_price_minor
    end
    if total > 0 then
        oz.apply_discount("cart", 5)
    end
end
oz.register_hook("sale.before_complete", "on_sale")
"#;
    let (_dir, plugins_root) = create_plugin_dir("scale-hook", lua, &["cart:read", "cart:write"]);
    let mgr = PluginManager::new(&plugins_root).unwrap();

    mgr.fire_sale_before_complete(
        &[line("HUGE", i64::MAX / 2, i64::MAX / 2, "USD")],
        i64::MAX / 2,
        "USD",
        "user-1",
    )
    .unwrap();

    let discounts = mgr.drain_pending_discounts();
    assert_eq!(
        discounts.len(),
        1,
        "float total is positive — the hook must fire, not wrap"
    );
    assert_eq!(discounts[0].percent, 5);
}

#[test]
fn fire_sale_before_complete_preserves_sale_fields() {
    let lua = r#"
function check_sale(sale)
    -- Verify fields then push a discount to signal success
    if sale.total_minor == 5000 and sale.currency == "IDR" and sale.user_id == "cashier-1" then
        oz.apply_discount("cart", 1)
    end
end
oz.register_hook("sale.before_complete", "check_sale")
"#;
    let (_dir, plugins_root) = create_plugin_dir("fields-hook", lua, &["cart:read", "cart:write"]);
    let mgr = PluginManager::new(&plugins_root).unwrap();

    mgr.fire_sale_before_complete(&[line("ITEM", 2, 2500, "IDR")], 5000, "IDR", "cashier-1")
        .unwrap();

    let discounts = mgr.drain_pending_discounts();
    assert_eq!(discounts.len(), 1, "hook should verify sale fields");
}

#[test]
fn fire_sale_before_complete_multiple_hooks_same_event() {
    let lua = r#"
function hook_a(sale)
    oz.apply_discount("cart", 5)
end
function hook_b(sale)
    oz.apply_discount("cart", 10)
end
oz.register_hook("sale.before_complete", "hook_a")
oz.register_hook("sale.before_complete", "hook_b")
"#;
    let (_dir, plugins_root) = create_plugin_dir("multi-hook", lua, &["cart:read", "cart:write"]);
    let mgr = PluginManager::new(&plugins_root).unwrap();

    mgr.fire_sale_before_complete(&[line("X", 1, 100, "USD")], 100, "USD", "u1")
        .unwrap();

    let discounts = mgr.drain_pending_discounts();
    assert_eq!(discounts.len(), 2, "both hooks should fire");
    assert_eq!(discounts[0].percent, 5);
    assert_eq!(discounts[1].percent, 10);
}

// ── Delegation method tests ────────────────────────────────────────

#[test]
fn validate_order_returns_empty_when_no_hook() {
    let dir = tempfile::tempdir().unwrap();
    let mgr = PluginManager::new(dir.path()).unwrap();
    let errors = mgr.validate_order(&[], 0, "USD").unwrap();
    assert!(errors.is_empty());
}

#[test]
fn apply_discount_returns_none_when_no_hook() {
    let dir = tempfile::tempdir().unwrap();
    let mgr = PluginManager::new(dir.path()).unwrap();
    let result = mgr.apply_discount(&[]).unwrap();
    assert!(result.is_none());
}

#[test]
fn calc_line_tax_returns_none_when_no_hook() {
    let dir = tempfile::tempdir().unwrap();
    let mgr = PluginManager::new(dir.path()).unwrap();
    let result = mgr.calc_line_tax("SKU", 1, 100, "USD").unwrap();
    assert!(result.is_none());
}

#[test]
fn validate_order_with_non_empty_lines_no_hook() {
    let dir = tempfile::tempdir().unwrap();
    let mgr = PluginManager::new(dir.path()).unwrap();
    let lines = [line("A", 1, 500, "IDR"), line("B", 2, 250, "IDR")];
    let errors = mgr.validate_order(&lines, 1000, "IDR").unwrap();
    assert!(errors.is_empty());
}

#[test]
fn apply_discount_with_non_empty_lines_no_hook() {
    let dir = tempfile::tempdir().unwrap();
    let mgr = PluginManager::new(dir.path()).unwrap();
    let lines = [line("A", 3, 500, "USD")];
    let result = mgr.apply_discount(&lines).unwrap();
    assert!(result.is_none());
}

// ── fire_event tests ───────────────────────────────────────────────

#[test]
fn fire_event_unregistered_event_is_noop() {
    let dir = tempfile::tempdir().unwrap();
    let mgr = PluginManager::new(dir.path()).unwrap();

    let _lua = mgr.runtime.inner();
    let value = mlua::Value::Nil;
    let result = mgr.fire_event("some.event.never_registered", value);
    assert!(result.is_ok());
    assert!(mgr.drain_pending_discounts().is_empty());
}

#[test]
fn fire_event_with_registered_hook_executes() {
    let lua_script = r#"
function custom_hook(arg)
    oz.apply_discount("custom", 42)
end
oz.register_hook("custom.event", "custom_hook")
"#;
    let (_dir, plugins_root) =
        create_plugin_dir("custom-event", lua_script, &["cart:read", "cart:write"]);
    let mgr = PluginManager::new(&plugins_root).unwrap();

    let lua = mgr.runtime.inner();
    let value = lua.create_table().unwrap();
    mgr.fire_event("custom.event", mlua::Value::Table(value))
        .unwrap();

    let discounts = mgr.drain_pending_discounts();
    assert_eq!(discounts.len(), 1);
    assert_eq!(discounts[0].target, "custom");
    assert_eq!(discounts[0].percent, 42);
}

#[test]
fn fire_event_registered_but_function_missing_is_ok() {
    let lua_script = r#"
-- Register a hook but don't define the function — manager should warn + continue
oz.register_hook("missing.event", "no_such_function")
"#;
    let (_dir, plugins_root) = create_plugin_dir("missing-func", lua_script, &["cart:read"]);
    let mgr = PluginManager::new(&plugins_root).unwrap();

    let _lua = mgr.runtime.inner();
    let value = mlua::Value::Nil;
    let result = mgr.fire_event("missing.event", value);
    // Should not panic; the missing function is logged and skipped.
    assert!(result.is_ok());
}

// ── PLG-03: per-binding capability gating ─────────────────────────

#[test]
fn binding_apply_discount_denied_without_cart_write() {
    // A cart:read-only plugin must NOT be able to call oz.apply_discount.
    // The binding is absent from its gated oz table, so the top-level call
    // fails at script load time and the manager rejects the plugin.
    let lua = "oz.apply_discount(\"cart\", 10)";
    let (_dir, plugins_root) = create_plugin_dir("no-cart-write", lua, &["cart:read"]);
    let result = PluginManager::new(&plugins_root);
    assert!(
        result.is_err(),
        "cart:read-only plugin calling oz.apply_discount must be rejected"
    );
}

#[test]
fn binding_apply_discount_allowed_with_cart_write() {
    let lua = "oz.apply_discount(\"cart\", 10)";
    let (_dir, plugins_root) = create_plugin_dir("with-cart-write", lua, &["cart:write"]);
    let mgr = PluginManager::new(&plugins_root).unwrap();
    let discounts = mgr.drain_pending_discounts();
    assert_eq!(discounts.len(), 1);
    assert_eq!(discounts[0].percent, 10);
}

#[test]
fn binding_get_time_denied_without_system_time() {
    let lua = "local t = oz.get_time()";
    let (_dir, plugins_root) = create_plugin_dir("no-system-time", lua, &["cart:read"]);
    assert!(
        PluginManager::new(&plugins_root).is_err(),
        "oz.get_time must be denied without system:time"
    );
}

#[test]
fn binding_log_denied_without_log_write() {
    let lua = "oz.log(\"info\", \"hi\")";
    let (_dir, plugins_root) = create_plugin_dir("no-log-write", lua, &["cart:read"]);
    assert!(
        PluginManager::new(&plugins_root).is_err(),
        "oz.log must be denied without log:write"
    );
}

#[test]
fn binding_register_hook_denied_without_cart_read() {
    let lua = "oz.register_hook(\"sale.before_complete\", \"h\")";
    let (_dir, plugins_root) = create_plugin_dir("no-cart-read", lua, &["system:time"]);
    assert!(
        PluginManager::new(&plugins_root).is_err(),
        "oz.register_hook must be denied without cart:read"
    );
}

// ── PLG-04: per-plugin environment isolation ──────────────────────

/// Helper: write two plugins with the SAME global function name but
/// different behavior, each registering it for `sale.before_complete`.
fn create_isolation_pair(dir: &std::path::Path) {
    for (subdir, name, percent, target) in [
        ("plug-a", "plug-a", 5, "from-a"),
        ("plug-b", "plug-b", 10, "from-b"),
    ] {
        let plugin_dir = dir.join(subdir);
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(
                plugin_dir.join("plugin.toml"),
                format!(
                    "[plugin]\nname = \"{name}\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = [\"script.lua\"]\n\n[permissions]\nrequired_permissions = [\"cart:read\", \"cart:write\"]\n"
                ),
            )
            .unwrap();
        std::fs::write(
                plugin_dir.join("script.lua"),
                format!(
                    "function shared_name(sale)\n    oz.apply_discount(\"{target}\", {percent})\nend\noz.register_hook(\"sale.before_complete\", \"shared_name\")\n"
                ),
            )
            .unwrap();
    }
}

#[test]
fn cross_plugin_globals_do_not_overwrite() {
    // Both plugins define `shared_name`; with a single global namespace
    // the second load would overwrite the first. Isolated envs must keep
    // each plugin's function intact, so firing runs BOTH hooks.
    let dir = tempfile::tempdir().unwrap();
    create_isolation_pair(dir.path());
    grant_all_declared(dir.path());
    let mgr = PluginManager::new(dir.path()).unwrap();

    mgr.fire_sale_before_complete(&[line("X", 1, 1000, "USD")], 1000, "USD", "u1")
        .unwrap();

    let discounts = mgr.drain_pending_discounts();
    assert_eq!(discounts.len(), 2, "both isolated hooks must fire");
    let mut targets: Vec<&str> = discounts.iter().map(|d| d.target.as_str()).collect();
    targets.sort();
    assert_eq!(targets, vec!["from-a", "from-b"]);
}

#[test]
fn duplicate_plugin_ids_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    for sub in ["a", "b"] {
        let plugin_dir = dir.path().join(sub);
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(
                plugin_dir.join("plugin.toml"),
                "[plugin]\nname = \"dup\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = []\n\n[permissions]\nrequired_permissions = [\"cart:read\"]\n",
            )
            .unwrap();
    }
    let result = PluginManager::new(dir.path());
    assert!(result.is_err(), "duplicate plugin ids must be rejected");
    let err = result.unwrap_err().to_string();
    assert!(err.contains("duplicate plugin id"), "got: {err}");
}

#[test]
fn hook_order_is_deterministic_by_plugin_id() {
    // Plugins load in id-sorted order (PLG-04), so hook execution order is
    // reproducible even though the temp dir iteration order is arbitrary.
    let dir = tempfile::tempdir().unwrap();
    for (subdir, name, target) in [
        ("zebra", "zebra", "from-zebra"),
        ("alpha", "alpha", "from-alpha"),
    ] {
        let plugin_dir = dir.path().join(subdir);
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(
                plugin_dir.join("plugin.toml"),
                format!(
                    "[plugin]\nname = \"{name}\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = [\"script.lua\"]\n\n[permissions]\nrequired_permissions = [\"cart:read\", \"cart:write\"]\n"
                ),
            )
            .unwrap();
        std::fs::write(
                plugin_dir.join("script.lua"),
                format!(
                    "function h(sale)\n    oz.apply_discount(\"{target}\", 1)\nend\noz.register_hook(\"sale.before_complete\", \"h\")\n"
                ),
            )
            .unwrap();
    }

    grant_all_declared(dir.path());
    let mgr = PluginManager::new(dir.path()).unwrap();
    mgr.fire_sale_before_complete(&[line("X", 1, 1000, "USD")], 1000, "USD", "u1")
        .unwrap();
    let discounts = mgr.drain_pending_discounts();
    assert_eq!(
        discounts
            .iter()
            .map(|d| d.target.as_str())
            .collect::<Vec<_>>(),
        vec!["from-alpha", "from-zebra"],
        "hooks must fire in id-sorted plugin order"
    );
}

#[test]
fn legacy_validate_order_aggregates_per_plugin() {
    // Two plugins each define a legacy global `validate_order`; the manager
    // must consult each plugin's own env and aggregate both error sets.
    let dir = tempfile::tempdir().unwrap();
    for (subdir, name, msg) in [
        ("one", "one", "error-from-one"),
        ("two", "two", "error-from-two"),
    ] {
        let plugin_dir = dir.path().join(subdir);
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(
                plugin_dir.join("plugin.toml"),
                format!(
                    "[plugin]\nname = \"{name}\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = [\"script.lua\"]\n\n[permissions]\nrequired_permissions = [\"cart:read\"]\n"
                ),
            )
            .unwrap();
        std::fs::write(
                plugin_dir.join("script.lua"),
                format!(
                    "function validate_order(lines, total_minor, currency)\n    return {{\"{msg}\"}}\nend\n"
                ),
            )
            .unwrap();
    }

    grant_all_declared(dir.path());
    let mgr = PluginManager::new(dir.path()).unwrap();
    let errors = mgr.validate_order(&[], 0, "USD").unwrap();
    assert_eq!(errors.len(), 2);
    assert!(errors.contains(&"error-from-one".to_string()));
    assert!(errors.contains(&"error-from-two".to_string()));
}

#[test]
fn aggregate_plugin_memory_limit_exceeded_protects_vm() {
    // Phase 6 governance: the shared Lua VM enforces MEMORY_LIMIT (10 MiB)
    // across ALL loaded plugins collectively.
    // Plugin A allocates a large string (~6 MiB). Plugin B attempts another ~6 MiB.
    // The aggregate allocation must hit the 10 MiB ceiling and fail safely.
    let dir = tempfile::tempdir().unwrap();

    let plugin_a = dir.path().join("plugin-a");
    std::fs::create_dir_all(&plugin_a).unwrap();
    std::fs::write(
        plugin_a.join("plugin.toml"),
        "[plugin]\nname = \"plugin-a\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = [\"script.lua\"]\n\n[permissions]\nrequired_permissions = [\"cart:read\"]\n",
    ).unwrap();
    std::fs::write(
        plugin_a.join("script.lua"),
        "t_a = string.rep('A', 6 * 1024 * 1024)\n",
    ).unwrap();

    let plugin_b = dir.path().join("plugin-b");
    std::fs::create_dir_all(&plugin_b).unwrap();
    std::fs::write(
        plugin_b.join("plugin.toml"),
        "[plugin]\nname = \"plugin-b\"\nversion = \"1.0.0\"\n\n[capabilities]\nscripts = [\"script.lua\"]\n\n[permissions]\nrequired_permissions = [\"cart:read\"]\n",
    ).unwrap();
    std::fs::write(
        plugin_b.join("script.lua"),
        "t_b = string.rep('B', 6 * 1024 * 1024)\n",
    ).unwrap();

    grant_all_declared(dir.path());
    let result = PluginManager::new(dir.path());
    assert!(
        result.is_err(),
        "aggregate memory allocations across multiple plugins exceeding 10 MiB must be rejected"
    );
    let err_msg = result.err().unwrap().to_string();
    assert!(
        err_msg.to_lowercase().contains("memory") || err_msg.to_lowercase().contains("not enough memory"),
        "expected memory exhaustion error, got: {err_msg}"
    );
}

#[test]
fn runaway_hook_aborts_without_hanging_pos() {
    // Phase 6 governance: a plugin hook with an infinite loop or runaway computation
    // must be interrupted by the VM instruction limit (100K) and fail gracefully.
    let (_dir, root) = create_plugin_dir(
        "runaway-hook-plugin",
        "function on_sale(sale)\n    while true do end\nend\noz.register_hook('sale.before_complete', 'on_sale')\n",
        &["cart:read"],
    );
    let mgr = PluginManager::new(&root).unwrap();
    let res = mgr.fire_sale_before_complete(&[line("ITEM-1", 1, 1000, "USD")], 1000, "USD", "user_1");
    assert!(res.is_err(), "runaway hook must be interrupted");
    let err_msg = res.unwrap_err().to_string();
    assert!(
        err_msg.contains("instruction limit exceeded"),
        "expected instruction limit error, got: {err_msg}"
    );
}

#[test]
fn plugin_reload_cleans_up_old_vm_and_memory() {
    // Phase 6 governance: replacing PluginManager cleanly drops previous VMs,
    // environments, and registry keys without memory leakage.
    let (_dir, root) = create_plugin_dir(
        "reload-test-plugin",
        "function on_sale(sale)\n    oz.apply_discount('cart', 5)\nend\noz.register_hook('sale.before_complete', 'on_sale')\n",
        &["cart:read", "cart:write"],
    );
    {
        let mgr1 = PluginManager::new(&root).unwrap();
        mgr1.fire_sale_before_complete(&[line("ITEM-1", 1, 1000, "USD")], 1000, "USD", "user_1")
            .unwrap();
        let discounts = mgr1.drain_pending_discounts();
        assert_eq!(discounts.len(), 1);
    }
    // Previous manager dropped cleanly; now create second manager
    let mgr2 = PluginManager::new(&root).unwrap();
    mgr2.fire_sale_before_complete(&[line("ITEM-1", 1, 1000, "USD")], 1000, "USD", "user_1")
        .unwrap();
    let discounts = mgr2.drain_pending_discounts();
    assert_eq!(discounts.len(), 1);
}

#[test]
fn unregistered_or_disabled_plugin_hook_is_skipped() {
    // Phase 6 governance: if a hook registration references a plugin id that is not
    // among loaded plugins (e.g. disabled plugin), fire_event must skip it cleanly.
    let (_dir, root) = create_plugin_dir(
        "active-plugin",
        "function on_sale(sale)\n    oz.apply_discount('cart', 10)\nend\noz.register_hook('sale.before_complete', 'on_sale')\n",
        &["cart:read", "cart:write"],
    );
    let mgr = PluginManager::new(&root).unwrap();
    // Inject a hook belonging to an unregistered/disabled plugin
    if let Ok(mut hooks) = mgr.hook_names.lock() {
        hooks.entry("sale.before_complete".to_string()).or_default().push(HookRef {
            plugin_id: "disabled-plugin-id".to_string(),
            func_name: "ghost_function".to_string(),
        });
    }
    // fire_sale_before_complete should succeed, skipping the disabled hook and executing the active one
    let res = mgr.fire_sale_before_complete(&[line("ITEM-1", 1, 1000, "USD")], 1000, "USD", "user_1");
    assert!(res.is_ok(), "event dispatch must skip hooks from unlisted/disabled plugins");
    let discounts = mgr.drain_pending_discounts();
    assert_eq!(discounts.len(), 1);
    assert_eq!(discounts[0].percent, 10);
}

