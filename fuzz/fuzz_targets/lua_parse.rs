//! Fuzz target for Lua script sandbox — feeds arbitrary byte sequences
//! to `LuaRuntime::load_str()` and verifies the sandbox contains all
//! attacks without panicking or crashing the process.
//!
//! The sandbox strips dangerous globals (io, loadfile, dofile, require,
//! package, debug, raw*, etc.) and enforces a 100K VM-op instruction limit
//! and a 10 MiB memory limit. This fuzz target ensures no combination of
//! bytes can bypass the sandbox or cause a panic.
//!
//! NOTE: `os` is the ONE exception to the nil rule — `LuaRuntime`
//! deliberately keeps a RESTRICTED os table (date/time/clock only,
//! read-only) for scripts that need the clock. A plain nil assert on `os`
//! panics on every input (fuzz crash 20260811-041231, minimized to the
//! 4-byte input `loca`; the same stale assert bit this copy of the target
//! until round 171). The post-load check below asserts the real contract:
//! os is either nil or the restricted table, and every other dangerous
//! global is nil.
//
// # Safety
//
// This fuzz target is `no_main` and compiled only with cargo-fuzz.
// It does not use `unsafe` directly.
//
// oz-lua migrated from rlua to mlua 0.9 (vendored Lua 5.4); the sandbox
// checks below use `mlua::Value` types. `LuaRuntime` is used behind a
// Mutex in production; fuzzing is single-threaded, so no concurrency
// concerns apply.

#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Only fuzz valid UTF-8 strings (Lua source is text).
    if let Ok(s) = std::str::from_utf8(data) {
        // Create a fresh sandboxed Lua VM per input.
        let lua = match kasirmu_lua::LuaRuntime::new() {
            Ok(lua) => lua,
            Err(_) => return, // VM init failure is not a bug we're testing for
        };

        // Load the arbitrary string as Lua code. The sandbox must:
        // - Not panic/crash on any UTF-8 input
        // - Block dangerous globals (io, loadfile, dofile, require, etc.)
        // - Keep only the restricted os table (date/time/clock, read-only)
        // - Abort infinite loops via 100K instruction limit
        let _ = lua.load_str(s);

        // Test that the sandbox is still intact after loading potentially
        // malicious code. Only check if input is short enough to have
        // loaded successfully and not exceeded the instruction limit.
        //
        // The contract (pinned in oz-lua as
        // `sandbox_contract_survives_the_fuzz_crash_input`):
        //   - os       → restricted table: date/time/clock present,
        //                execute/remove/rename/exit nil (or nil itself)
        //   - everything else below → nil
        if s.len() < 500 {
            let globals = lua.inner().globals();
            let os_val: mlua::Value = globals.get("os").unwrap_or(mlua::Value::Nil);
            match &os_val {
                mlua::Value::Table(t) => {
                    for safe_key in &["date", "time", "clock"] {
                        let v: mlua::Value = t.get(*safe_key).unwrap_or(mlua::Value::Nil);
                        assert!(
                            !matches!(v, mlua::Value::Nil),
                            "restricted os.{safe_key} should survive malicious input"
                        );
                    }
                    for dangerous_key in &["execute", "remove", "rename", "exit"] {
                        let v: mlua::Value = t.get(*dangerous_key).unwrap_or(mlua::Value::Nil);
                        assert!(
                            matches!(v, mlua::Value::Nil),
                            "os.{dangerous_key} should be nil after malicious input"
                        );
                    }
                }
                _ => assert!(
                    matches!(os_val, mlua::Value::Nil),
                    "os should be a restricted table or nil after malicious input"
                ),
            }

            let dangerous = [
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
            for name in &dangerous {
                let val: mlua::Value = match globals.get(*name) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                assert!(
                    matches!(val, mlua::Value::Nil),
                    "dangerous global '{name}' should be nil after malicious input"
                );
            }
        }

        // Also fuzz the apply_discount hook with the current sandbox state.
        // Even if load_str failed, the VM should be in a recoverable state.
        let lines = kasirmu_lua::CartLineData {
            sku: s.chars().take(50).collect(),
            qty: 1,
            unit_price_minor: 100,
            currency: "USD".to_string(),
        };
        let _ = lua.apply_discount(&[lines]);
    }

    // Non-UTF-8 bytes should be handled by `std::str::from_utf8`
    // returning Err — we simply skip them. No crash should occur.
});
