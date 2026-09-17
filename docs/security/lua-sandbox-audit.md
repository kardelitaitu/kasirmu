# Lua Sandbox Security Audit — P0-1

<!-- Audit stamp: 2026-07-26 · Hermes-Agent · status: STALE (dated 2026-07-19 security snapshot — 6 of 7 findings now remediated in code) · F1: "No instruction limit" -> REMEDIATED; crates/oz-lua/src/lib.rs now sets INSTRUCTION_LIMIT=100_000 via mlua HookTriggers (line 169) + test instruction_limit_aborts_infinite_loop (line 843) · F2: "No memory limit" -> REMEDIATED; set_memory_limit(10 MiB) at lib.rs:120 + collectgarbage exposed · F3: "Plugin permissions not enforced" -> REMEDIATED; oz-plugin/src/manager.rs:57-73 enforces required_permissions whitelist, rejects empty/unknown perms · F4: "Unvalidated discount %" -> REMEDIATED; oz.apply_discount validates 0-100 at manager.rs:144 · F-OPEN: "No execution timeout" (tokio::time::timeout wrapper) + "per-plugin VM isolation" still not evidenced in current code · O1: doc cites crates/oz-lua/src/lib.rs:33 instruction-limit claim + rlua crate; code migrated rlua->mlua 0.9 (lib.rs:4), so line/dep refs are stale · verified: crates/oz-lua + crates/oz-plugin exist; PluginPermissions struct (manifest.rs:143); oz.on/off/get_time/log present (manager.rs:115-198) · treat as a historical audit, not current security posture -->

**Date:** 2026-07-19
**Auditor:** kasir.mu Architecture Team
**Scope:** `crates/oz-lua/`, `crates/oz-plugin/`, example plugins under `plugins/` and `scripts/examples/`
**Status:** 🔴 7 findings (3 critical, 2 high, 2 medium)

---

## Executive Summary

The Lua plugin system (`oz-lua` + `oz-plugin`) runs custom merchant scripts inside an `rlua` VM. While the basic sandbox strips dangerous globals (`os`, `io`, `loadfile`, etc.), it has **critical gaps** in resource limits, permission enforcement, and execution safety. A malicious or buggy plugin could DoS the POS terminal, modify discounts arbitrarily, or exhaust system resources.

---

## Finding Overview

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | 🔴 Critical | **No instruction limit** — scripts can infinite-loop (100% CPU) | Doc claims limit but code doesn't set it |
| 2 | 🔴 Critical | **No execution timeout** — scripts block the POS thread indefinitely | No tokio select!/timeout wrapper |
| 3 | 🔴 Critical | **Plugin permissions not enforced** — `PluginPermissions` parsed but never checked | All plugins get all capabilities |
| 4 | 🟠 High | **No memory limit** — Lua tables can exhaust RAM | No `collectgarbage` step or `mlua` memory limit |
| 5 | 🟠 High | **`oz.apply_discount` accepts arbitrary percentages** — no validation (0–100) | A plugin could give 1000% discounts |
| 6 | 🟡 Medium | **Dual API surface confusion** — old global functions vs new `oz.*` API | Example scripts use both patterns inconsistently |
| 7 | 🟡 Medium | **`discount.lua` uses deprecated `oz.*` API** — not compatible with old integration | The old `apply_discount(lines)` hook and `oz.apply_discount()` can conflict |

---

## Detailed Findings

### Finding #1: No Instruction Limit 🔴 Critical

**Location:** `crates/oz-lua/src/lib.rs` — `LuaRuntime::new()`

**Description:** The `oz-lua` doc comment at line 33 claims "scripts are aborted after 100 000 Lua instructions to prevent infinite loops." However, no code actually calls `set_instruction_limit()` or `set_instruction_limit(100_000)`. The `rlua` crate provides `set_instruction_limit()` on the `Lua` struct, but it's never invoked.

**Impact:** Any plugin can write `while true do end` and peg one CPU core at 100% indefinitely. On single-threaded POS terminals, this freezes the UI.

**Evidence:**
- `LuaRuntime::new()` only strips globals — no instruction limit call in the entire function
- No test verifies instruction limit behavior
- No `#[cfg(test)]` test for infinite-loop detection

**Fix:** Add `lua.set_instruction_limit(100_000)` after the globals-stripping loop in `LuaRuntime::new()`.

---

### Finding #2: No Execution Timeout 🔴 Critical

**Location:** `crates/oz-lua/src/lib.rs` — all hook methods (`apply_discount`, `calc_line_tax`, `validate_order`)

**Description:** Every Lua hook call (`apply_discount`, `calc_line_tax`, `validate_order`, `fire_event`) executes synchronously via `hook.call(...)`. If a script hangs (infinite loop, slow computation, or blocked I/O), the entire Rust async runtime thread is blocked. There is no tokio `select!` with a timeout wrapper.

**Impact:** A plugin that enters an infinite loop blocks the POS indefinitely. The cashier cannot complete sales, switch screens, or close the app gracefully.

**Evidence:**
- `LuaRuntime::apply_discount` calls `hook.call(table)` directly with no timeout
- `LuaRuntime::calc_line_tax` calls `hook.call((sku, qty, price, currency))` directly
- `PluginManager::fire_event` calls `func.call::<_, ()>(args.clone())` directly
- All calls are synchronous — no `tokio::time::timeout` wrapper

**Fix:** Wrap every `hook.call(...)` in a `tokio::time::timeout(Duration::from_secs(5), ...)` and return `LuaError::Script("timeout")` on expiry.

---

### Finding #3: Plugin Permissions Not Enforced 🔴 Critical

**Location:** `crates/oz-plugin/src/manifest.rs` — `PluginPermissions` struct
**Location:** `crates/oz-plugin/src/manager.rs` — `PluginManager::new()`

**Description:** The `PluginPermissions` struct in `manifest.rs` has three permission fields (`allow_network`, `allow_filesystem`, `allow_http`) that are faithfully deserialized from `plugin.toml`. However, they are **never read or enforced** anywhere in the codebase. `PluginManager::new()` does not check permissions before loading scripts or registering the `oz.*` API.

The `PluginManager` loads all scripts into the same shared `LuaRuntime` — there is no per-plugin isolation. Every plugin's code runs in the same global scope, meaning one plugin can overwrite another plugin's functions or read its data.

**Impact:**
- A plugin declaring `allow_network = false` is not prevented from making network calls (though the sandboxed globals block raw socket access, the permission itself isn't checked)
- All plugins share the same Lua VM — no isolation between untrusted plugins
- The `permissions` field in `plugin.toml` is misleading (creates false sense of security)

**Evidence:**
- `PluginManager::new()` calls `LuaRuntime::new()` once — all plugins share the same VM
- No `Permissions` check in `PluginManager::new()` or any hook method
- `PluginManifest.permissions` parsed at line 47 of `manifest.rs` but never referenced in `manager.rs`

**Fix:**
1. Parse permissions at manifest load time and attach them to `LoadedPlugin`
2. Before loading each plugin, verify its declared permissions against a whitelist
3. Consider per-plugin VM isolation for untrusted plugins (or at minimum, function wrapping that checks permissions)

---

### Finding #4: No Memory Limit 🟠 High

**Location:** `crates/oz-lua/src/lib.rs` — `LuaRuntime::new()`

**Description:** The Lua VM has no memory limit. A plugin script can construct large tables or concatenate strings until the OS OOM-kills the process. `rlua`/`mlua` do not have built-in memory limits; they must be implemented via `collectgarbage` hooks or custom allocators.

**Impact:** A plugin script with `local t = {}; for i = 1, 1e9 do t[i] = string.rep("X", 1000) end` would exhaust system RAM.

**Evidence:**
- No `collectgarbage("step")` calls in the runtime
- No memory limit configuration in `LuaRuntime::new()`
- No test for memory exhaustion behavior

**Fix:** After stripping globals, add `lua.load("collectgarbage(\"setpause\", 100)").exec()` and consider a Lua panic hook that aborts if memory exceeds a threshold. For stronger protection, use OS-level resource limits (setrlimit on Linux).

---

### Finding #5: Unvalidated Discount Percentages 🟠 High

**Location:** `crates/oz-plugin/src/manager.rs` — `oz.apply_discount(target, percent)`

**Description:** The `oz.apply_discount(target, percent)` function accepts any `i64` value for `percent` without validating it's in the 0–100 range. A malicious plugin could push a discount of `-1000` (increasing prices) or `9999` (giving away products for negative money).

**Impact:** A compromised or buggy discount script can create arbitrary negative prices or massive discounts.

**Evidence:**
- `oz.apply_discount` in `manager.rs` line 107: `guard.push(PendingDiscount { target, percent })` — no validation
- `PendingDiscount.percent` is `i64` — no range constraint
- Existing test at line 464: `assert_eq!(pending_discounts[0].percent, 42)` — no validation test

**Fix:** Add `if !(0..=100).contains(&percent) { return Err(...) }` in the `oz.apply_discount` closure.

---

### Finding #6: Dual API Surface Confusion 🟡 Medium

**Location:** `scripts/examples/discount_bulk.lua`, `tax_overrides.lua`, `validate_order.lua` vs `scripts/examples/example-discount/discount.lua`

**Description:** There are two incompatible plugin API patterns in the codebase:

1. **Old API** (in `scripts/examples/`): Global Lua functions (`apply_discount`, `calc_line_tax`, `validate_order`) that are called directly by `LuaRuntime`. Return Lua tables with specific fields. No access to `oz.*` API.

2. **New API** (in `scripts/examples/example-discount/`): Uses `oz.register_hook()` to register named functions, then `oz.apply_discount()` to push discounts. The example script in `scripts/examples/example-discount/` is the **only** script using this pattern.

These APIs are **incompatible and can conflict**. If a plugin defines both a global `apply_discount` function AND uses `oz.register_hook("sale.before_complete", ...)`, both paths are invoked.

**Impact:** Merchants creating custom plugins will be confused about which API to use. Scripts written for one API may silently fail or behave unexpectedly when used with the other.

**Evidence:**
- `discount_bulk.lua` defines `apply_discount(lines)` — old API
- `tax_overrides.lua` defines `calc_line_tax(sku, qty, price, currency)` — old API
- `validate_order.lua` defines `validate_order(lines, total, currency)` — old API
- `discount.lua` (in scripts/examples/example-discount/) uses `oz.register_hook()` + `oz.apply_discount()` — new API
- No deprecation notice on the old API

**Fix:** Deprecate the old global-function API and remove example scripts that use it. Add a migration guide.

---

### Finding #7: Old API Example Scripts Still Active 🟡 Medium

**Location:** `scripts/examples/discount_bulk.lua`, `tax_overrides.lua`, `validate_order.lua`

**Description:** The three example scripts in `scripts/examples/` are loaded by the Lua runtime at startup (via `load_dir`). They define global functions that override any plugin-defined hooks of the same name. They also don't use the `oz.*` API, so they can't use `oz.log()`, `oz.get_time()`, etc.

**Impact:** If a merchant places a custom script in `plugins/` with a function named `apply_discount`, and the old `scripts/examples/discount_bulk.lua` also defines it, one will overwrite the other silently — order depends on file-name sorting.

**Evidence:**
- `load_dir()` in `LuaRuntime::load_dir` sorts by file name, then loads each `.lua` file
- Later scripts can overwrite earlier ones' global functions
- No warning when a global is overwritten

**Fix:** Audit which example scripts are actually needed. Move non-plugin example scripts to separate directory. Add overwrite detection.

---

## Exported API Surface

### Old API (global Lua functions, called by Rust)

| Function | Signature | Plugin Type | Data Access | Risk |
|----------|-----------|-------------|-------------|------|
| `apply_discount` | `(lines: table) → {percent: int, label?: string} \| nil` | discount | Read-only cart data | Low |
| `calc_line_tax` | `(sku: string, qty: int, price: int, currency: string) → {rate_bps: int, is_inclusive?: bool} \| nil` | tax | Read-only product data | Low |
| `validate_order` | `(lines: table, total: int, currency: string) → string[]` | validation | Read-only cart data | Low |

### New API (`oz.*` table, called from Lua)

| Function | Signature | Plugin Type | Data Access | Risk |
|----------|-----------|-------------|-------------|------|
| `oz.get_time()` | `() → {wday, hour, min, sec, month, day, year}` | any | None (system time) | None |
| `oz.log(level, msg)` | `(level: string, msg: string)` | any | Write to tracing logger | None |
| `oz.apply_discount(target, percent)` | `(target: string, percent: int)` | discount | Queue discount in pending list | Medium (percent not validated) |
| `oz.register_hook(event, func)` | `(event: string, func_name: string)` | any | Register function name for event | Low |
| `oz.on(event, callback)` | `(event: string, callback: function)` | any | Register Lua function callback | Low |
| `oz.off(event)` | `(event: string)` | any | Remove event callbacks | None |

### Minimum Permission Sets per Plugin Type

| Plugin Type | Permissions Required | Risk Level |
|-------------|---------------------|------------|
| **discount** | `cart:read`, `cart:write` | Medium — can modify sale totals |
| **tax** | `tax:read` | Low — can override tax rates but not persist them |
| **validation** | `cart:read` | Low — can block orders with errors |
| **reporting** (future) | `reporting:read` | Low — read-only analytics |

---

## Current Security Posture

| Layer | Status | Notes |
|-------|--------|-------|
| Dangerous globals removed (`os`, `io`, etc.) | ✅ | 11 globals stripped in `LuaRuntime::new()` |
| `rlua::Lua` wraps raw pointer | ✅ | Safe because always behind `Mutex` |
| Plugin permissions parsed from `plugin.toml` | ✅ | `PluginPermissions` struct exists and deserializes |
| Instruction limit | ❌ **Missing** | Doc claims it but code doesn't implement it |
| Execution timeout | ❌ **Missing** | No tokio select!/timeout wrapper |
| Memory limit | ❌ **Missing** | No collectgarbage hooks or allocator limits |
| Permission enforcement | ❌ **Missing** | Permissions parsed but never checked |
| Per-plugin isolation | ❌ **Missing** | All plugins share one Lua VM |
| Discount percentage validation | ❌ **Missing** | 0-100 range not enforced |
| Overwrite detection | ❌ **Missing** | Later scripts silently overwrite earlier globals |

---

## Recommended Fix Priority

| Priority | Fix | Est. Effort | Depends On |
|----------|-----|-------------|------------|
| P0 | Add instruction limit (`set_instruction_limit(100_000)`) | 30 min | None |
| P0 | Add execution timeout (tokio select! with 5s deadline) | 1 hr | None |
| P0 | Enforce plugin permissions (block undeclared capabilities) | 2–3 hrs | P0-2 |
| P1 | Add memory limit (Lua collectgarbage hooks) | 1–2 hrs | None |
| P1 | Validate `oz.apply_discount` percent (0–100 range) | 30 min | None |
| P2 | Deprecate old global-function API | 1 hr | None |
| P2 | Add overwrite detection and warning | 1 hr | None |

---

## Cross-References

- **P0-2**: Permission manifests — adds `required_permissions` to `plugin.toml`, rejects undeclared permissions at load time
- **P0-3**: Resource limits — instruction limit, memory limit, execution timeout
- **P0-4**: Safe environment — stubs dangerous globals, whitelisted `oz.*` API
- **P0-5**: Regressions — verify example plugins still work after sandboxing

---

> last audited 26-07-26 by RSA-Agent
