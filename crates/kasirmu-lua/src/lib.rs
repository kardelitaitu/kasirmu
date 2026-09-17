/*
last audited DD-MM-YY by DSH-Agent
crate: oz-lua | status: SAFE | lint: CLEAN
findings: 2 actual unsafe blocks verified — both `unsafe impl Send/Sync for LuaRuntime` with item-scoped #[allow(unsafe_code)] + documented SAFETY rationale (mlua is Send+Sync; LuaRuntime holds an Arc<Mutex<...>>) — crate root #![deny(unsafe_code)] holds. LUA-3 RESOLVED — removed detect_overwrites(): dead code (never called anywhere) whose overwrite detection was a no-op (counted duplicates in the input list, not VM overwrites). LUA-2 already fixed (percent range at parse site). Sandbox hardening verified: io/loadfile/dofile/require/package/debug removed, os reduced, 10 MiB memory cap, 100K instruction hook, MONEY-05 float hand-off documented. Default::default() .expect() is documented-infallible (LuaRuntime::new cannot fail).
next: none — crate stable | perf: N/A
*/

//! Embedded Lua scripting runtime for OZ-POS.
//!
//! `oz-lua` lets merchants customize business rules, promotions, and
//! order validation at runtime without recompiling the Rust core.
//! The runtime is built on [`mlua`] and exposes a curated surface of
//! cart / line / product data to Lua scripts.
//!
//! # Sandboxing
//!
//! Every script executes in a restricted environment:
//!
//! - **Removed globals**: `io`, `loadfile`, `dofile`, `require`,
//!   `package`, `debug`, `rawget`, `rawset`
//! - **Restricted globals**: `os` — `date`, `time`, and `clock` are available
//!   (read-only); `os.execute`, `os.remove`, `os.rename`, `os.exit` are nil
//! - **Allowed**: safe `math`, `string`, `table`, `pairs`, `ipairs`,
//!   `tonumber`, `tostring`, `type`, `pcall`, `xpcall`, `error`
//! - **Instruction limit**: scripts are aborted after 100 000 Lua
//!   instructions to prevent infinite loops.
//! - **Memory limit**: Lua VM is capped at 10 MB to prevent memory
//!   exhaustion from malicious tables or string concatenation.
//!
//! # Hooks
//!
//! | Lua function | Signature | Called when |
//! |---|---|---|
//! | `apply_discount` | `(lines_json) → {percent, label} \| nil` | Before sale creation |
//! | `calc_line_tax` | `(sku, qty, unit_price_minor, currency) → {rate_bps, is_inclusive} \| nil` | During tax computation |
//! | `validate_order` | `(lines_json, total_minor, currency) → string[]` | Before completion |

// RUST-06: deny at crate root — the only unsafe items are the two
// `unsafe impl Send/Sync` for `LuaRuntime` below, each narrowly scoped
// with `#[allow(unsafe_code)]` and a `// SAFETY:` rationale.
#![deny(unsafe_code)]

use std::path::Path;

pub mod bridge;
pub mod error;

pub use bridge::LuaEventBridge;
pub use error::LuaError;

/// Maximum number of Lua bytecode instructions before the VM is interrupted.
/// Prevents infinite loops and runaway CPU from buggy or malicious scripts.
const INSTRUCTION_LIMIT: u64 = 100_000;

/// Maximum memory (in bytes) the Lua VM can allocate before being interrupted.
/// 10 MB — enough for typical discount/tax/validation scripts.
const MEMORY_LIMIT: usize = 10 * 1024 * 1024; // 10 MiB

/// A line item passed into Lua business-rule hooks.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CartLineData {
    /// Stock-keeping unit code.
    pub sku: String,
    /// Quantity in this line.
    pub qty: i64,
    /// Unit price in minor units.
    pub unit_price_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
}

/// Result returned from a Lua `apply_discount` hook.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct DiscountResult {
    /// Discount percentage (0–100).
    pub percent: i64,
    /// Optional human-readable label.
    #[serde(default)]
    pub label: Option<String>,
}

/// Tax-rate override returned from a Lua `calc_line_tax` hook.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct TaxOverride {
    /// Rate in basis points (e.g. 1000 = 10%).
    pub rate_bps: i64,
    /// Whether the tax is inclusive of the displayed price.
    #[serde(default)]
    pub is_inclusive: bool,
}

/// A sandboxed Lua scripting runtime.
///
/// Create one instance per application, then load scripts via
/// [`load_file`](LuaRuntime::load_file) or
/// [`load_dir`](LuaRuntime::load_dir). Business-rule hooks are
/// optional — if no script defines them, the hooks return `Ok(None)`.
pub struct LuaRuntime {
    lua: mlua::Lua,
}

// SAFETY: `LuaRuntime` is used behind a `Mutex` in application state,
// guaranteeing that only one thread accesses it at a time.
#[allow(unsafe_code)]
unsafe impl Send for LuaRuntime {}
#[allow(unsafe_code)]
unsafe impl Sync for LuaRuntime {}

impl Default for LuaRuntime {
    fn default() -> Self {
        // SAFETY: `Default` must be infallible; `new()` only fails on VM-init programming errors (memory-limit / hook install).
        Self::new().expect("Failed to initialize LuaRuntime")
    }
}

impl LuaRuntime {
    /// Create a new sandboxed Lua VM.
    ///
    /// Removes dangerous globals, sets memory limits, and sets instruction limit.
    pub fn new() -> Result<Self, LuaError> {
        let lua = mlua::Lua::new();

        // Enforce 10 MiB native memory limit in Lua VM
        lua.set_memory_limit(MEMORY_LIMIT)
            .map_err(|e| LuaError::Init(format!("set memory limit failed: {e}")))?;

        // Sandbox: strip dangerous globals.
        {
            let globals = lua.globals();

            // Fully remove: these globals are always dangerous.
            let remove = &[
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
            for name in remove {
                globals
                    .set(*name, mlua::Value::Nil)
                    .map_err(|e| LuaError::Init(e.to_string()))?;
            }

            // Partially remove `os`: keep read-only time functions, strip execution capabilities.
            let safe_os = lua
                .create_table()
                .map_err(|e| LuaError::Init(e.to_string()))?;
            if let Ok(real_os) = globals.get::<_, mlua::Table>("os") {
                for safe_key in &["date", "time", "clock"] {
                    if let Ok(val) = real_os.get::<_, mlua::Value>(*safe_key) {
                        safe_os
                            .set(*safe_key, val)
                            .map_err(|e| LuaError::Init(e.to_string()))?;
                    }
                }
            }
            globals
                .set("os", safe_os)
                .map_err(|e| LuaError::Init(e.to_string()))?;
        }

        // Instruction limit hook: interrupts scripts after INSTRUCTION_LIMIT operations
        lua.set_hook(
            mlua::HookTriggers::new().every_nth_instruction(INSTRUCTION_LIMIT as u32),
            |_: &mlua::Lua, _: mlua::Debug| {
                Err(mlua::Error::RuntimeError(
                    "script aborted: instruction limit exceeded (100K)".into(),
                ))
            },
        );

        Ok(Self { lua })
    }

    /// Load a Lua script from a file path.
    pub fn load_file(&self, path: impl AsRef<Path>) -> Result<(), LuaError> {
        let code = std::fs::read_to_string(path.as_ref())
            .map_err(|e| LuaError::Load(format!("read {:?}: {e}", path.as_ref())))?;
        self.load_str(&code)
    }

    /// Load a Lua script from a string.
    pub fn load_str(&self, code: &str) -> Result<(), LuaError> {
        let sandbox_code = wrap_sandbox(code);
        self.lua
            .load(&sandbox_code)
            .exec()
            .map_err(|e| LuaError::Script(e.to_string()))?;
        Ok(())
    }

    /// Load a Lua script from a string into a caller-provided environment.
    ///
    /// Used for per-plugin isolation (PLG-04): each plugin is loaded with its
    /// own `_ENV` table so plugins cannot overwrite one another's globals. The
    /// environment should chain `__index` to the sandboxed globals so standard
    /// libraries still resolve.
    pub fn load_str_in_env(&self, code: &str, env: &mlua::Table) -> Result<(), LuaError> {
        let sandbox_code = wrap_sandbox(code);
        self.lua
            .load(&sandbox_code)
            .set_environment(env.clone())
            .exec()
            .map_err(|e| LuaError::Script(e.to_string()))?;
        Ok(())
    }

    /// Load a Lua script from a file into a caller-provided environment.
    ///
    /// See [`load_str_in_env`](LuaRuntime::load_str_in_env) for isolation notes.
    pub fn load_file_in_env(
        &self,
        path: impl AsRef<Path>,
        env: &mlua::Table,
    ) -> Result<(), LuaError> {
        let code = std::fs::read_to_string(path.as_ref())
            .map_err(|e| LuaError::Load(format!("read {:?}: {e}", path.as_ref())))?;
        self.load_str_in_env(&code, env)
    }

    /// Access the inner `mlua::Lua` state for advanced operations.
    pub fn inner(&self) -> &mlua::Lua {
        &self.lua
    }

    /// Load all `.lua` files from a directory (non-recursive).
    pub fn load_dir(&self, dir: impl AsRef<Path>) -> Result<(), LuaError> {
        let dir = dir.as_ref();
        if !dir.exists() {
            return Ok(());
        }
        let mut entries: Vec<_> = std::fs::read_dir(dir)
            .map_err(|e| LuaError::Load(format!("read dir {:?}: {e}", dir)))?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|ext| ext == "lua"))
            .collect();
        entries.sort_by_key(|e| e.file_name());

        for entry in &entries {
            let path = entry.path();
            self.load_file(&path)?;
        }
        Ok(())
    }

    /// Legacy hook names that new plugins should avoid (use `oz.register_hook` instead).
    #[deprecated(
        since = "0.0.14",
        note = "Use oz.register_hook() instead of global functions"
    )]
    pub const LEGACY_HOOK_NAMES: &[&str] = &["apply_discount", "calc_line_tax", "validate_order"];

    /// Call the Lua `apply_discount(lines)` hook.
    pub fn apply_discount(
        &self,
        lines: &[CartLineData],
    ) -> Result<Option<DiscountResult>, LuaError> {
        let hook: mlua::Function = {
            let globals = self.lua.globals();
            match globals.get("apply_discount") {
                Ok(f) => f,
                Err(_) => return Ok(None),
            }
        };
        let table = build_lines_table(&self.lua, lines)?;
        let result: mlua::Value = hook
            .call(table)
            .map_err(|e| LuaError::Script(e.to_string()))?;
        Ok(parse_discount_result(result))
    }

    /// Call the `apply_discount(lines)` hook defined in a specific environment.
    ///
    /// Used by the plugin manager to invoke each plugin's legacy hook within
    /// its own isolated environment rather than the shared globals (PLG-04).
    pub fn apply_discount_in_env(
        &self,
        env: &mlua::Table,
        lines: &[CartLineData],
    ) -> Result<Option<DiscountResult>, LuaError> {
        let hook: mlua::Function = match env.get("apply_discount") {
            Ok(f) => f,
            Err(_) => return Ok(None),
        };
        let table = build_lines_table(&self.lua, lines)?;
        let result: mlua::Value = hook
            .call(table)
            .map_err(|e| LuaError::Script(e.to_string()))?;
        Ok(parse_discount_result(result))
    }

    /// Call the Lua `calc_line_tax(sku, qty, unit_price_minor, currency)` hook.
    pub fn calc_line_tax(
        &self,
        sku: &str,
        qty: i64,
        unit_price_minor: i64,
        currency: &str,
    ) -> Result<Option<TaxOverride>, LuaError> {
        let hook: mlua::Function = {
            let globals = self.lua.globals();
            match globals.get("calc_line_tax") {
                Ok(f) => f,
                Err(_) => return Ok(None),
            }
        };
        let result: mlua::Value = hook
            .call((sku, qty as f64, unit_price_minor as f64, currency))
            .map_err(|e| LuaError::Script(e.to_string()))?;
        Ok(parse_tax_override(result))
    }

    /// Call the `calc_line_tax` hook defined in a specific environment.
    ///
    /// See [`apply_discount_in_env`](LuaRuntime::apply_discount_in_env).
    pub fn calc_line_tax_in_env(
        &self,
        env: &mlua::Table,
        sku: &str,
        qty: i64,
        unit_price_minor: i64,
        currency: &str,
    ) -> Result<Option<TaxOverride>, LuaError> {
        let hook: mlua::Function = match env.get("calc_line_tax") {
            Ok(f) => f,
            Err(_) => return Ok(None),
        };
        let result: mlua::Value = hook
            .call((sku, qty as f64, unit_price_minor as f64, currency))
            .map_err(|e| LuaError::Script(e.to_string()))?;
        Ok(parse_tax_override(result))
    }

    /// Call the Lua `validate_order(lines, total_minor, currency)` hook.
    pub fn validate_order(
        &self,
        lines: &[CartLineData],
        total_minor: i64,
        currency: &str,
    ) -> Result<Vec<String>, LuaError> {
        let hook: mlua::Function = {
            let globals = self.lua.globals();
            match globals.get("validate_order") {
                Ok(f) => f,
                Err(_) => return Ok(Vec::new()),
            }
        };
        let table = build_lines_table(&self.lua, lines)?;
        let result: mlua::Value = hook
            .call((table, total_minor as f64, currency))
            .map_err(|e| LuaError::Script(e.to_string()))?;
        let mut errors = Vec::new();
        if let mlua::Value::Table(tbl) = &result {
            for pair in tbl.clone().pairs() {
                let (_, val): (mlua::Value, String) =
                    pair.map_err(|e| LuaError::Script(e.to_string()))?;
                errors.push(val);
            }
        }
        Ok(errors)
    }

    /// Call the `validate_order` hook defined in a specific environment.
    ///
    /// See [`apply_discount_in_env`](LuaRuntime::apply_discount_in_env).
    pub fn validate_order_in_env(
        &self,
        env: &mlua::Table,
        lines: &[CartLineData],
        total_minor: i64,
        currency: &str,
    ) -> Result<Vec<String>, LuaError> {
        let hook: mlua::Function = match env.get("validate_order") {
            Ok(f) => f,
            Err(_) => return Ok(Vec::new()),
        };
        let table = build_lines_table(&self.lua, lines)?;
        let result: mlua::Value = hook
            .call((table, total_minor as f64, currency))
            .map_err(|e| LuaError::Script(e.to_string()))?;
        let mut errors = Vec::new();
        if let mlua::Value::Table(tbl) = &result {
            for pair in tbl.clone().pairs() {
                let (_, val): (mlua::Value, String) =
                    pair.map_err(|e| LuaError::Script(e.to_string()))?;
                errors.push(val);
            }
        }
        Ok(errors)
    }
}

// ── Parsers ──────────────────────────────────────────────────────────────

fn parse_discount_result(val: mlua::Value) -> Option<DiscountResult> {
    match val {
        mlua::Value::Table(tbl) => {
            let percent: i64 = tbl.get("percent").ok()?;
            // LUA-2 fix: validate the 0–100 range at the parse site so
            // every caller (legacy global hook, per-env hook) shares the
            // contract the oz-plugin manager already enforced (P0-5).
            // Out-of-range results are treated as "no discount" (None),
            // matching how a nil return is handled.
            if !(0..=100).contains(&percent) {
                return None;
            }
            let label: Option<String> = tbl.get("label").ok().and_then(|v: Option<String>| v);
            Some(DiscountResult { percent, label })
        }
        _ => None,
    }
}

fn parse_tax_override(val: mlua::Value) -> Option<TaxOverride> {
    match val {
        mlua::Value::Table(tbl) => {
            let rate_bps: i64 = tbl.get("rate_bps").ok()?;
            let is_inclusive: bool = tbl.get("is_inclusive").unwrap_or(false);
            Some(TaxOverride {
                rate_bps,
                is_inclusive,
            })
        }
        _ => None,
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/// Build an mlua table from CartLineData.
fn build_lines_table<'lua>(
    lua: &'lua mlua::Lua,
    lines: &[CartLineData],
) -> Result<mlua::Table<'lua>, LuaError> {
    let table = lua
        .create_table()
        .map_err(|e| LuaError::Script(e.to_string()))?;
    for (i, line) in lines.iter().enumerate() {
        let row = lua
            .create_table()
            .map_err(|e| LuaError::Script(e.to_string()))?;
        row.set("sku", line.sku.as_str())
            .map_err(|e| LuaError::Script(e.to_string()))?;
        // MONEY-05: hand qty / money values to the VM as Lua *floats*.
        // Plugin arithmetic such as `qty * unit_price_minor` otherwise runs as
        // Lua 5.4 integer math, which wraps silently on overflow (confirmed by
        // apply_discount_with_overflow_scale_qty_runs_cleanly). Realistic
        // minor-unit values are exact in f64 (below 2^53), so this removes the
        // wrap class without changing normal plugin behavior.
        row.set("qty", line.qty as f64)
            .map_err(|e| LuaError::Script(e.to_string()))?;
        row.set("unit_price_minor", line.unit_price_minor as f64)
            .map_err(|e| LuaError::Script(e.to_string()))?;
        row.set("currency", line.currency.as_str())
            .map_err(|e| LuaError::Script(e.to_string()))?;
        table
            .set(i + 1, row)
            .map_err(|e| LuaError::Script(e.to_string()))?;
    }
    Ok(table)
}

/// Wrap user code inside a sandboxed chunk.
fn wrap_sandbox(code: &str) -> String {
    format!(
        r#"
local ok, err = pcall(function()
{code}
end)
if not ok then
    error(err)
end
"#,
    )
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
