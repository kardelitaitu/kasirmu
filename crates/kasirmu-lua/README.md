# oz-lua

<!-- Audit stamp: 2026-07-24 · Antigravity · status: ACCURATE · Migrated to mlua 0.9 (Lua 5.4 vendored). Memory limit (10 MiB) natively enforced via set_memory_limit. -->

Embedded Lua scripting runtime for OZ-POS — lets merchants customize business
rules, promotions, and order validation at runtime without recompiling the core.

## Status

**Stable.** The runtime is built on `mlua` (Lua 5.4 vendored) with a sandboxed environment that
strips dangerous globals (`io`, `loadfile`, process `os` functions, etc.) and exposes three hooks:

| Hook | Signature | Purpose |
|------|-----------|---------|
| `apply_discount` | `(lines_table) → {percent, label} \| nil` | Return a % discount or nil |
| `calc_line_tax` | `(sku, qty, unit_price, currency) → {rate_bps, is_inclusive} \| nil` | Override tax rate per line |
| `validate_order` | `(lines_table, total_minor, currency) → string[]` | Return validation errors |

Scripts live in `scripts/` and are loaded at startup via `load_dir()`.

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
- Dangerous globals (`io`, `loadfile`, `dofile`, `require`, `package`, `debug`, `rawget`, `rawset`, `collectgarbage`, `module`, `load`) are **nil**.
- Restricted `os` table retains read-only time access (`os.date`, `os.time`, `os.clock`) while stripping execution capabilities.
- Safe libraries preserved: `math`, `string`, `table`, `pairs`, `ipairs`, `tonumber`, `tostring`, `type`, `pcall`, `xpcall`, `error`.

## Tests

```bash
cargo test -p oz-lua
```

> last audited 24-07-26 by Antigravity
