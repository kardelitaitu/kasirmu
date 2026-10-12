# kasirmu-lua

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 2 minor) · First re-audit since 2026-07-24. MAJOR: the scripts path was wrong — the page said scripts live in scripts/ loaded via load_dir(), but the tree holds ZERO .lua files directly in scripts/; the seven examples are under scripts/examples/ (plus a nested example-discount/ form), and LuaRuntime::load_dir(dir) TAKES THE DIRECTORY AS AN ARGUMENT and sorts by name before loading — it does not default to a path. In production the caller is kasirmu-plugin's PluginManager, which loads a plugin's scripts through its manifest rather than from a fixed tree. MINOR 1: the hook-signature table named lines_table where the crate's own module doc (src/lib.rs:35-37) says lines_json, and it omitted the unit_price_minor spelling and the call site of each hook. MINOR 2: coroutine is a removed global per the crate doc (src/lib.rs:20-21, removed because hooks run per-thread and a coroutine would escape the instruction limit) and the README's nil list omitted it. VERIFIED UNCHANGED: mlua 0.9 with lua54+vendored+send matches the workspace dependency (Cargo.toml:168); the 10 MiB memory cap and 100,000-instruction hook are the crate's own constants (src/lib.rs:54,58); the three hooks are the real LEGACY_HOOK_NAMES set (src/lib.rs:275); the sandbox removal list matches src/lib.rs:19-25. The 2026-07-24 stamp's mlua-0.9 claim is still correct and is preserved below as the original evidence. NOT re-measured: the sandbox's runtime effectiveness against a hostile script, and the plugin-manifest loading path end to end. · Superseded 2026-07-24 body follows as plain quoted text:

Audit stamp: 2026-07-24 · Antigravity · status: ACCURATE · Migrated to mlua 0.9 (Lua 5.4 vendored). Memory limit (10 MiB) natively enforced via set_memory_limit. -->

Embedded Lua scripting runtime for kasir.mu — lets merchants customize business
rules, promotions, and order validation at runtime without recompiling the core.

## Status

**Stable.** The runtime is built on `mlua` (Lua 5.4 vendored) with a sandboxed environment that
strips dangerous globals (`io`, `loadfile`, process `os` functions, etc.) and exposes three hooks:

| Hook | Signature | Purpose |
|------|-----------|---------|
| `apply_discount` | `(lines_json) → {percent, label} \| nil` | Return a % discount or nil — called before sale creation |
| `calc_line_tax` | `(sku, qty, unit_price_minor, currency) → {rate_bps, is_inclusive} \| nil` | Override tax rate per line — called during tax computation |
| `validate_order` | `(lines_json, total_minor, currency) → string[]` | Return validation errors — called before completion |

Example scripts live in `scripts/examples/` (seven of them: `discount_bulk.lua`, `tax_overrides.lua`,
`validate_order.lua`, `buy_x_get_y.lua`, `happy_hour.lua`, `loyalty_bonus.lua`, `min_order.lua`), plus a
nested `scripts/examples/example-discount/` form.

`LuaRuntime::load_dir(dir)` takes the directory as an argument and sorts by file name before loading each
`.lua` file — it does not default to a path, so the caller names the directory. In production the caller
is `kasirmu-plugin`'s `PluginManager`, which loads a plugin's scripts through its manifest rather than
from a fixed tree.

## Example

```lua
function apply_discount(lines)
    local total = 0
    for i = 1, #lines do
        total = total + lines[i].qty * lines[i].unit_price_minor
    end
    if total > 5000 then
        return { percent = 5, label = "Volume discount" }
    end
    return nil
end
```

## Sandboxing & Limits

- Native memory limit enforced at **10 MiB** via `lua.set_memory_limit`.
- Instruction limit enforced at **100,000 instructions** via `lua.set_hook`.
- Dangerous globals (`io`, `loadfile`, `dofile`, `require`, `package`, `debug`, `rawget`, `rawset`, `collectgarbage`, `module`, `load`) are **nil** — and so is `coroutine`, removed because hooks run per-thread and a coroutine would escape the instruction limit.
- Restricted `os` table retains read-only time access (`os.date`, `os.time`, `os.clock`) while stripping execution capabilities.
- Safe libraries preserved: `math`, `string`, `table`, `pairs`, `ipairs`, `tonumber`, `tostring`, `type`, `pcall`, `xpcall`, `error`.

## Tests

```bash
cargo test -p kasirmu-lua
```

> last audited 11-10-26 by docs-auditor
