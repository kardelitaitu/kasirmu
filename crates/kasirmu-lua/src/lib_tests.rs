use super::*;

fn runtime() -> LuaRuntime {
    LuaRuntime::new().expect("Lua VM init")
}

#[test]
fn new_creates_sandboxed_vm() {
    let lua = runtime();
    let globals = lua.lua.globals();
    let os_val: mlua::Value = globals.get("os").unwrap();
    assert!(
        matches!(os_val, mlua::Value::Table(_)),
        "os should be a restricted table"
    );
    let os_tbl: mlua::Table = globals.get("os").unwrap();
    let has_date: mlua::Value = os_tbl.get("date").unwrap();
    assert!(
        matches!(has_date, mlua::Value::Function(_)),
        "os.date should exist"
    );
    let has_time: mlua::Value = os_tbl.get("time").unwrap();
    assert!(
        matches!(has_time, mlua::Value::Function(_)),
        "os.time should exist"
    );
    let execute: mlua::Value = os_tbl.get("execute").unwrap();
    assert!(
        matches!(execute, mlua::Value::Nil),
        "os.execute should be nil"
    );
    let remove: mlua::Value = os_tbl.get("remove").unwrap();
    assert!(
        matches!(remove, mlua::Value::Nil),
        "os.remove should be nil"
    );

    let io: mlua::Value = globals.get("io").unwrap();
    assert!(matches!(io, mlua::Value::Nil), "io should be removed");
    let loadfile: mlua::Value = globals.get("loadfile").unwrap();
    assert!(
        matches!(loadfile, mlua::Value::Nil),
        "loadfile should be removed"
    );
    let math: mlua::Value = globals.get("math").unwrap();
    assert!(matches!(math, mlua::Value::Table(_)), "math should exist");
    let string: mlua::Value = globals.get("string").unwrap();
    assert!(
        matches!(string, mlua::Value::Table(_)),
        "string should exist"
    );
}

#[test]
fn load_str_defines_global_function() {
    let lua = runtime();
    lua.load_str("function apply_discount(_) return nil end")
        .unwrap();
    let globals = lua.lua.globals();
    let hook: mlua::Value = globals.get("apply_discount").unwrap();
    assert!(matches!(hook, mlua::Value::Function(_)));
}

#[test]
fn apply_discount_returns_nil_when_no_hook() {
    let lua = runtime();
    let lines = vec![];
    let result = lua.apply_discount(&lines).unwrap();
    assert!(result.is_none());
}

#[test]
fn apply_discount_uses_lines_table() {
    let lua = runtime();
    lua.load_str(
        r#"
function apply_discount(lines)
    local total = 0
    for i = 1, #lines do
        total = total + lines[i].qty * lines[i].unit_price_minor
    end
    if total > 1000 then
        return { percent = 10, label = "Bulk" }
    end
    return nil
end
"#,
    )
    .unwrap();

    let lines = vec![CartLineData {
        sku: "COFFEE".into(),
        qty: 5,
        unit_price_minor: 500,
        currency: "USD".into(),
    }];
    let result = lua.apply_discount(&lines).unwrap();
    let d = result.expect("should get discount for >1000");
    assert_eq!(d.percent, 10);
    assert_eq!(d.label.as_deref(), Some("Bulk"));
}

#[test]
fn apply_discount_returns_nil_for_small_orders() {
    let lua = runtime();
    lua.load_str(
        r#"
function apply_discount(lines)
    local total = 0
    for i = 1, #lines do
        total = total + lines[i].qty * lines[i].unit_price_minor
    end
    if total > 1000 then
        return { percent = 5, label = "Bulk" }
    end
    return nil
end
"#,
    )
    .unwrap();

    let lines = vec![CartLineData {
        sku: "CHEAP".into(),
        qty: 1,
        unit_price_minor: 200,
        currency: "USD".into(),
    }];
    let result = lua.apply_discount(&lines).unwrap();
    assert!(result.is_none());
}

/// MONEY-05 evidence pin: the MONEY-03 journal flagged `qty *
/// unit_price_minor` inside plugin discount scripts (lib.rs 577/608) as
/// the same unchecked-multiply class. Those lines are plugin-authored Lua
/// test scripts, not host code: `build_lines_table` hands the i64s to the
/// VM and mlua (default `Lua::new()`) evaluates plugin arithmetic as Lua
/// numbers (f64), where i64 overflow cannot occur — worst case is f64
/// precision loss above 2^53. This test pins that the host passes
/// overflow-scale values through cleanly: the hook runs, returns a
/// discount decision, and the host never wraps an integer.
#[test]
fn apply_discount_with_overflow_scale_qty_runs_cleanly() {
    let lua = runtime();
    lua.load_str(
        r#"
function apply_discount(lines)
    local total = 0
    for i = 1, #lines do
        total = total + lines[i].qty * lines[i].unit_price_minor
    end
    if total > 0 then
        return { percent = 5, label = "Scale" }
    end
    return nil
end
"#,
    )
    .unwrap();

    let lines = vec![CartLineData {
        sku: "HUGE".into(),
        qty: i64::MAX / 2,
        unit_price_minor: i64::MAX / 2,
        currency: "USD".into(),
    }];
    let result = lua.apply_discount(&lines).unwrap();
    let d = result.expect("f64 total is positive — the hook must run, not wrap");
    assert_eq!(d.percent, 5);
}

#[test]
fn calc_line_tax_returns_override() {
    let lua = runtime();
    lua.load_str(
        r#"
function calc_line_tax(sku, qty, unit_price_minor, currency)
    if sku == "CIGARETTES" then
        return { rate_bps = 2000, is_inclusive = true }
    end
    return nil
end
"#,
    )
    .unwrap();

    let result = lua.calc_line_tax("CIGARETTES", 1, 1000, "USD").unwrap();
    let tax = result.expect("cigarettes should have override");
    assert_eq!(tax.rate_bps, 2000);
    assert!(tax.is_inclusive);

    let result = lua.calc_line_tax("COFFEE", 1, 350, "USD").unwrap();
    assert!(result.is_none());
}

#[test]
fn calc_line_tax_no_hook() {
    let lua = runtime();
    let result = lua.calc_line_tax("ANY", 1, 100, "USD").unwrap();
    assert!(result.is_none());
}

#[test]
fn validate_order_returns_errors() {
    let lua = runtime();
    lua.load_str(
        r#"
function validate_order(lines, total_minor, currency)
    local errors = {}
    for i = 1, #lines do
        if lines[i].qty > 10 then
            table.insert(errors, lines[i].sku .. ": quantity exceeds 10")
        end
    end
    return errors
end
"#,
    )
    .unwrap();

    let lines = vec![
        CartLineData {
            sku: "COFFEE".into(),
            qty: 20,
            unit_price_minor: 350,
            currency: "USD".into(),
        },
        CartLineData {
            sku: "TEA".into(),
            qty: 2,
            unit_price_minor: 250,
            currency: "USD".into(),
        },
    ];
    let errors = lua.validate_order(&lines, 7500, "USD").unwrap();
    assert_eq!(errors.len(), 1);
    assert!(errors[0].contains("COFFEE"));
}

#[test]
fn validate_order_no_hook() {
    let lua = runtime();
    let errors = lua.validate_order(&[], 0, "USD").unwrap();
    assert!(errors.is_empty());
}

#[test]
fn sandbox_allows_os_date_but_blocks_execute() {
    let lua = runtime();
    let date_ok = lua.load_str(r#"local d = os.date("!*t"); assert(type(d) == "table")"#);
    assert!(
        date_ok.is_ok(),
        "os.date should be available: {:?}",
        date_ok
    );
    let time_ok = lua.load_str(r#"local t = os.time(); assert(type(t) == "number")"#);
    assert!(time_ok.is_ok(), "os.time should be available");
    let exec_blocked = lua.load_str(r#"os.execute("echo hacked")"#);
    assert!(exec_blocked.is_err());
}

#[test]
fn sandbox_blocks_io_open() {
    let lua = runtime();
    let result = lua.load_str(r#"io.open("/etc/passwd")"#);
    assert!(result.is_err());
}

#[test]
fn sandbox_blocks_dofile() {
    let lua = runtime();
    let result = lua.load_str(r#"dofile("script.lua")"#);
    assert!(result.is_err());
}

#[test]
fn script_syntax_error_is_caught() {
    let lua = runtime();
    let result = lua.load_str("function broken(");
    assert!(result.is_err());
}

#[test]
fn load_file_missing_path_is_error() {
    let lua = runtime();
    let result = lua.load_file("/nonexistent/script.lua");
    assert!(result.is_err());
}

#[test]
fn load_dir_skips_missing_dir() {
    let lua = runtime();
    let result = lua.load_dir("/nonexistent/scripts");
    assert!(result.is_ok());
}

#[test]
fn discount_result_serde_roundtrip() {
    let json = r#"{"percent": 15, "label": "Senior"}"#;
    let dr: DiscountResult = serde_json::from_str(json).unwrap();
    assert_eq!(dr.percent, 15);
    assert_eq!(dr.label.as_deref(), Some("Senior"));
}

#[test]
fn tax_override_serde_roundtrip() {
    let json = r#"{"rate_bps": 1000, "is_inclusive": true}"#;
    let to: TaxOverride = serde_json::from_str(json).unwrap();
    assert_eq!(to.rate_bps, 1000);
    assert!(to.is_inclusive);
}

#[test]
fn multiple_scripts_can_be_loaded() {
    let lua = runtime();
    lua.load_str("function apply_discount(_) return { percent = 5, label = \"First\" } end")
        .unwrap();
    lua.load_str(
        "function calc_line_tax(_, _, _, _) return { rate_bps = 800, is_inclusive = false } end",
    )
    .unwrap();
    lua.load_str("function validate_order(_, _, _) return {} end")
        .unwrap();

    let lines = vec![CartLineData {
        sku: "X".into(),
        qty: 1,
        unit_price_minor: 100,
        currency: "USD".into(),
    }];
    assert!(lua.apply_discount(&lines).unwrap().is_some());
    assert!(lua.calc_line_tax("X", 1, 100, "USD").unwrap().is_some());
    assert!(lua.validate_order(&lines, 100, "USD").unwrap().is_empty());
}

#[test]
fn dangerous_globals_are_nil_or_restricted() {
    let lua = runtime();
    let globals = lua.lua.globals();
    let os_val: mlua::Value = globals.get("os").unwrap();
    assert!(
        matches!(os_val, mlua::Value::Table(_)),
        "os should be restricted table"
    );
    let os_tbl: mlua::Table = globals.get("os").unwrap();
    let execute: mlua::Value = os_tbl.get("execute").unwrap();
    assert!(
        matches!(execute, mlua::Value::Nil),
        "os.execute should be nil"
    );

    let nil_globals = [
        "io",
        "loadfile",
        "dofile",
        "require",
        "package",
        "debug",
        "rawget",
        "rawset",
        "rawequal",
        "rawlen",
        "collectgarbage",
        "module",
        "load",
    ];
    for name in &nil_globals {
        let val: mlua::Value = globals.get(*name).unwrap();
        assert!(
            matches!(val, mlua::Value::Nil),
            "dangerous global '{name}' should be nil"
        );
    }
}

#[test]
fn safe_globals_still_work() {
    let lua = runtime();
    lua.load_str(
        r#"
local pi = math.pi
assert(pi > 3.14)

local greeting = string.upper("hello")
assert(greeting == "HELLO")

local t = { 1, 2, 3 }
table.insert(t, 4)
assert(#t == 4)

local count = 0
for _, _ in pairs(t) do count = count + 1 end
assert(count == 4)

assert(tonumber("42") == 42)
assert(tostring(42) == "42")

assert(type("hello") == "string")

local ok, val = pcall(function() return 1 + 1 end)
assert(ok and val == 2)

local ok2 = pcall(function() error("test") end)
assert(not ok2, "pcall should catch error")
"#,
    )
    .unwrap();
}

#[test]
fn sandbox_blocks_require() {
    let lua = runtime();
    let result = lua.load_str(r#"require("socket")"#);
    assert!(result.is_err());
}

#[test]
fn sandbox_blocks_package_access() {
    let lua = runtime();
    let result = lua.load_str(r#"package.path = "/evil/?.lua""#);
    assert!(result.is_err());
}

#[test]
fn sandbox_blocks_load() {
    let lua = runtime();
    let result = lua.load_str(r#"load("return 1")()"#);
    assert!(result.is_err());
}

#[test]
fn sandbox_blocks_rawget() {
    let lua = runtime();
    let result = lua.load_str(r#"rawget(_G, "os")"#);
    assert!(result.is_err());
}

#[test]
fn sandbox_blocks_rawset() {
    let lua = runtime();
    let result = lua.load_str(r#"rawset(_G, "os", {})"#);
    assert!(result.is_err());
}

#[test]
fn sandbox_blocks_collectgarbage() {
    let lua = runtime();
    let result = lua.load_str(r#"collectgarbage("collect")"#);
    assert!(result.is_err());
}

#[test]
fn sandbox_blocks_debug_access() {
    let lua = runtime();
    let result = lua.load_str(r#"debug.sethook()"#);
    assert!(result.is_err());
}

#[test]
fn sandbox_blocks_module() {
    let lua = runtime();
    let result = lua.load_str(r#"module("evil")"#);
    assert!(result.is_err());
}

#[test]
fn malicious_script_multi_vector_attack_blocked() {
    let lua = runtime();
    let result = lua.load_str(
        r#"
pcall(function() os.execute("rm -rf /") end)
pcall(function() io.open("/etc/passwd") end)
pcall(function() dofile("/tmp/evil.lua") end)
pcall(function() require("socket") end)
pcall(function() loadfile("/tmp/evil.luac") end)
pcall(function() load("return 1") end)
pcall(function() debug.sethook() end)
pcall(function() rawget(_G, "os") end)
pcall(function() rawset(_G, "os", {}) end)
pcall(function() module("evil") end)
pcall(function() collectgarbage("collect") end)
"#,
    );
    assert!(
        result.is_ok(),
        "malicious multi-vector script should load safely: {}",
        result.unwrap_err()
    );
}

#[test]
fn instruction_limit_aborts_infinite_loop() {
    let lua = runtime();
    let result = lua.load_str("while true do end");
    assert!(
        result.is_err(),
        "infinite loop should be aborted by instruction limit"
    );
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("instruction")
            || err.contains("interrupted")
            || err.contains("timeout")
            || err.contains("limit"),
        "error should mention instruction limit, got: {err}"
    );
}

#[test]
fn instruction_limit_allows_normal_scripts() {
    let lua = runtime();
    lua.load_str(
        r#"
function factorial(n)
    if n <= 1 then return 1 end
    return n * factorial(n - 1)
end

result = factorial(10)
"#,
    )
    .unwrap();
    let result: i64 = lua
        .inner()
        .globals()
        .get::<_, mlua::Value>("result")
        .ok()
        .and_then(|v| match v {
            mlua::Value::Integer(i) => Some(i),
            _ => None,
        })
        .unwrap_or(0);
    assert_eq!(result, 3628800, "factorial(10) should compute correctly");
}

#[test]
fn real_example_discount_bulk_works_in_sandbox() {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/examples");
    let path = base.join("discount_bulk.lua");
    let lua = runtime();
    lua.load_file(&path).unwrap();

    let lines = vec![CartLineData {
        sku: "ITEM".into(),
        qty: 10,
        unit_price_minor: 100,
        currency: "USD".into(),
    }];
    let result = lua.apply_discount(&lines).unwrap();
    let d = result.expect("10+ items should get 10% discount");
    assert_eq!(d.percent, 10);
    assert_eq!(d.label.as_deref(), Some("Bulk 10+"));

    let lines = vec![CartLineData {
        sku: "ITEM".into(),
        qty: 6,
        unit_price_minor: 1000,
        currency: "USD".into(),
    }];
    let result = lua.apply_discount(&lines).unwrap();
    let d = result.expect("total > 5000 should get 5% discount");
    assert_eq!(d.percent, 5);
    assert_eq!(d.label.as_deref(), Some("Volume"));

    let lines = vec![CartLineData {
        sku: "CHEAP".into(),
        qty: 1,
        unit_price_minor: 100,
        currency: "USD".into(),
    }];
    let result = lua.apply_discount(&lines).unwrap();
    assert!(result.is_none());
}

#[test]
fn real_example_tax_overrides_works_in_sandbox() {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/examples");
    let path = base.join("tax_overrides.lua");
    let lua = runtime();
    lua.load_file(&path).unwrap();

    let tax = lua
        .calc_line_tax("CIG-001", 1, 1000, "USD")
        .unwrap()
        .expect("CIG prefix should get tax override");
    assert_eq!(tax.rate_bps, 2000);
    assert!(tax.is_inclusive);

    let tax = lua
        .calc_line_tax("TOB-001", 1, 500, "USD")
        .unwrap()
        .expect("TOB prefix should get tax override");
    assert_eq!(tax.rate_bps, 2000);

    let tax = lua
        .calc_line_tax("MILK-001", 1, 200, "USD")
        .unwrap()
        .expect("MILK prefix should get 0% VAT");
    assert_eq!(tax.rate_bps, 0);
    assert!(!tax.is_inclusive);

    let tax = lua
        .calc_line_tax("FOOD-001", 1, 500, "USD")
        .unwrap()
        .expect("FOOD- prefix should get 8% GST");
    assert_eq!(tax.rate_bps, 800);

    let result = lua.calc_line_tax("COFFEE", 1, 350, "USD").unwrap();
    assert!(result.is_none());
}

#[test]
fn real_example_validate_order_works_in_sandbox() {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/examples");
    let path = base.join("validate_order.lua");
    let lua = runtime();
    lua.load_file(&path).unwrap();

    let lines = vec![CartLineData {
        sku: "ITEM".into(),
        qty: 100,
        unit_price_minor: 100,
        currency: "USD".into(),
    }];
    let errors = lua.validate_order(&lines, 10000, "USD").unwrap();
    assert_eq!(errors.len(), 1);
    assert!(errors[0].contains("ITEM"));
    assert!(errors[0].contains("50"));

    let lines = vec![CartLineData {
        sku: "BEER-001".into(),
        qty: 6,
        unit_price_minor: 500,
        currency: "USD".into(),
    }];
    let errors = lua.validate_order(&lines, 3000, "USD").unwrap();
    assert_eq!(errors.len(), 1);
    assert!(errors[0].contains("age"));

    let lines = vec![
        CartLineData {
            sku: "SKU123".into(),
            qty: 1,
            unit_price_minor: 100,
            currency: "USD".into(),
        },
        CartLineData {
            sku: "SKU123".into(),
            qty: 2,
            unit_price_minor: 100,
            currency: "USD".into(),
        },
    ];
    let errors = lua.validate_order(&lines, 300, "USD").unwrap();
    assert_eq!(errors.len(), 1);
    assert!(errors[0].contains("duplicate"));

    let lines = vec![CartLineData {
        sku: "COFFEE".into(),
        qty: 2,
        unit_price_minor: 350,
        currency: "USD".into(),
    }];
    let errors = lua.validate_order(&lines, 700, "USD").unwrap();
    assert!(errors.is_empty());
}

/// The fuzz-target sandbox contract, pinned here so the harness and
/// the crate can never drift apart again (fuzz crash 20260811-041231:
/// the target asserted `os` was nil, but the sandbox deliberately
/// keeps a restricted os table — the assert panicked on every input,
/// minimized to the 4-byte `loca`). The contract the fuzz target now
/// checks after loading malicious input:
///   - `os` → restricted table: date/time/clock present, no
///     execute/remove/rename/exit;
///   - everything else in the dangerous list → nil;
///   - the VM stays recoverable (apply_discount returns Ok).
#[test]
fn sandbox_contract_survives_the_fuzz_crash_input() {
    let lua = LuaRuntime::new().unwrap();
    // The exact crash input: a 4-byte truncated Lua keyword. Loading it
    // is a syntax error (handled), never a panic or abort.
    assert!(lua.load_str("loca").is_err());

    let globals = lua.inner().globals();

    let os_val: mlua::Value = globals.get("os").unwrap();
    let os_table = match os_val {
        mlua::Value::Table(t) => t,
        _ => panic!("os must be the restricted table after malicious input"),
    };
    for safe_key in ["date", "time", "clock"] {
        assert!(
            !matches!(
                os_table.get::<_, mlua::Value>(safe_key).unwrap(),
                mlua::Value::Nil
            ),
            "restricted os.{safe_key} should survive malicious input"
        );
    }
    for dangerous_key in ["execute", "remove", "rename", "exit"] {
        assert!(
            matches!(
                os_table.get::<_, mlua::Value>(dangerous_key).unwrap(),
                mlua::Value::Nil
            ),
            "os.{dangerous_key} should be nil after malicious input"
        );
    }

    for name in [
        "io",
        "loadfile",
        "dofile",
        "require",
        "package",
        "debug",
        "rawget",
        "rawset",
        "rawequal",
        "rawlen",
        "collectgarbage",
        "module",
        "load",
    ] {
        assert!(
            matches!(
                globals.get::<_, mlua::Value>(name).unwrap(),
                mlua::Value::Nil
            ),
            "dangerous global '{name}' should be nil after malicious input"
        );
    }

    // The VM must stay recoverable after the failed load.
    let lines = [CartLineData {
        sku: "loca".to_string(),
        qty: 1,
        unit_price_minor: 100,
        currency: "USD".to_string(),
    }];
    assert!(lua.apply_discount(&lines).is_ok());
}

/// LUA-2 fix: the parse-site contract treats out-of-range percent values
/// as "no discount" (None) — the same range the oz-plugin manager
/// enforced (P0-5), now shared by the legacy global-hook and per-env
/// hook paths.
#[test]
fn apply_discount_out_of_range_percent_treated_as_no_discount() {
    let lua = runtime();
    for pct in [-5i64, 101, 1000] {
        lua.load_str(&format!(
            "function apply_discount(_) return {{ percent = {pct}, label = \"x\" }} end"
        ))
        .unwrap();
        let lines = vec![CartLineData {
            sku: "ANY".into(),
            qty: 1,
            unit_price_minor: 500,
            currency: "USD".into(),
        }];
        let result = lua.apply_discount(&lines).unwrap();
        assert!(result.is_none(), "percent {pct} must yield None");
    }
}

#[test]
fn apply_discount_boundary_percents_are_accepted() {
    let lua = runtime();
    for pct in [0i64, 100] {
        lua.load_str(&format!(
            "function apply_discount(_) return {{ percent = {pct}, label = \"edge\" }} end"
        ))
        .unwrap();
        let lines = vec![CartLineData {
            sku: "ANY".into(),
            qty: 1,
            unit_price_minor: 500,
            currency: "USD".into(),
        }];
        let result = lua.apply_discount(&lines).unwrap();
        assert_eq!(result.unwrap().percent, pct);
    }
}
