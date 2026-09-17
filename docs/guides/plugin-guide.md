<!-- Audit stamp: 2026-07-31 · Buffy-Agent · status: SYNCED (PLG-10 parity rewrite) · verified against crates/kasirmu-plugin (manager.rs, manifest.rs, loader.rs, package.rs) and crates/kasirmu-lua (lib.rs, bridge.rs) · corrected: oz table surface (get_time/log/apply_discount/register_hook/on/off only), mandatory required_permissions + manifest validation (kebab-case name, strict SemVer, unknown-permission rejection), register_hook(string) signature, per-plugin env isolation, HAL traits table (no NfcReader), kasirmu-cli commands (no run-script/validate-plugins), sandbox limits (100k instr / 10 MiB) · RE-AUDITED 31-08 by docs-auditor: re-verified limits against crates/kasirmu-lua (INSTRUCTION_LIMIT=100_000 at lib.rs:53, 10 MiB via set_memory_limit) — accurate; PLG-11 (cbe01ace) hardened the internal SQL validator (ensure_no_quoted_identifiers) but that API is Rust-side (manager namespace setup), not a plugin Lua global, so no guide change needed; aligned '10 MB' -> '10 MiB' to match the kasirmu-lua README + the actual 10*1024*1024 constant; normalized the non-standard 3-line footer to the single-line standard -->

# kasir.mu Plugin System

Plugins extend kasir.mu with custom business logic, hardware drivers,
and integrations — all without modifying the core codebase.

## Plugin Manifest (`plugin.toml`)

Every plugin is a directory containing a `plugin.toml` manifest. The manifest
is **validated at load time** (PLG-08): invalid manifests fail loudly with an
actionable error and the plugin is not loaded.

```toml
[plugin]
name = "my-custom-discount"   # kebab-case: lowercase letters/digits/hyphens, 1-64 chars
version = "1.0.0"             # strict SemVer (e.g. "1.2.3-beta.1")
description = "A custom discount rule for Tuesday afternoons"
author = "My Company"
license = "MIT"

[capabilities]
# Scripts that the plugin provides (paths must stay inside the plugin dir)
scripts = ["discount.lua", "validation.lua"]

# Hooks the plugin listens to (informational; lowercase/digits/dot/underscore/hyphen)
hooks = ["sale.before_complete"]

[permissions]
# REQUIRED: at least one permission must be declared, and every permission
# must be recognised — unknown permissions reject the plugin.
required_permissions = ["cart:read", "cart:write", "system:time", "log:write"]
```

### Available permissions

| Permission | Grants the `oz` binding |
|------------|--------------------------|
| `cart:read` | `oz.register_hook`, `oz.on`, `oz.off` |
| `cart:write` | `oz.apply_discount` |
| `tax:read` | *(reserved — tax-rate read access)* |
| `inventory:read` | *(reserved — stock read access)* |
| `inventory:write` | *(reserved — stock adjustment)* |
| `reporting:read` | *(reserved — reporting/analytics access)* |
| `system:time` | `oz.get_time` |
| `log:write` | `oz.log` |

Bindings whose permission is not granted simply do not exist in the plugin's
`oz` table, so an unapproved call fails fast in the sandbox.

## Plugin Directory Structure

```
plugins/
  my-custom-discount/
    plugin.toml
    discount.lua
    validation.lua
  my-receipt-printer/
    plugin.toml
    printer.lua
```

## Discovery

Plugins are loaded from the `plugins/` directory at startup:

1. kasir.mu scans `plugins/` (relative to the app data directory)
2. Each subdirectory with a `plugin.toml` is loaded; manifest schema violations
   fail loudly instead of silently skipping
3. Each plugin's Lua scripts load into **its own isolated environment** — plugin
   globals never leak between plugins or into the shared namespace
4. Scripts can register hooks by calling `oz.register_hook(name, function_name)`
5. Plugin IDs must be unique; duplicate IDs are rejected

## Sandbox

Lua scripts run in a hardened sandbox:

- **No filesystem or network access**: `os.execute`, `os.remove`, `os.rename`,
  and `os.exit` are `nil`; read-only `os.date`/`os.time`/`os.clock` remain
- **Instruction limit**: scripts abort after 100 000 Lua instructions
  (prevents infinite loops)
- **Memory limit**: the Lua VM is capped at 10 MiB (prevents memory exhaustion)
- **Isolated environments**: each plugin loads into its own `_ENV`, with `_G`
  pointed at that environment — a plugin writing `_G.foo = ...` cannot affect
  any other plugin

## `oz` Global Table

Only the following bindings are implemented. Each is capability-gated by the
plugin's declared permissions (see above).

| Function | Permission | Description |
|----------|------------|-------------|
| `oz.log(level, message)` | `log:write` | Log a message (`level`: "info", "warn", "error", "debug") |
| `oz.get_time()` | `system:time` | Current time table: `wday`, `hour`, `min`, `sec`, `month`, `day`, `year` |
| `oz.apply_discount(target, percent)` | `cart:write` | Queue a discount: `"cart"` or `"line:<SKU>"`; `percent` must be 0–100 |
| `oz.register_hook(event, function_name)` | `cart:read` | Register a hook by **function name** (string), resolved in this plugin's environment |
| `oz.on(event, callback)` | `cart:read` | Register an inline callback function |
| `oz.off(event)` | `cart:read` | Unsubscribe this plugin's callbacks for an event (a plugin can only ever remove its own) |

### Legacy top-level hooks

In addition to `oz.register_hook`, the runtime still recognises these
**top-level functions** defined in a plugin script (each resolved in the
plugin's own environment):

| Lua function | Signature | Called when |
|---|---|---|
| `apply_discount` | `(lines_json) → {percent, label} \| nil` | Before sale creation |
| `calc_line_tax` | `(sku, qty, unit_price_minor, currency) → {rate_bps, is_inclusive} \| nil` | During tax computation |
| `validate_order` | `(lines_json, total_minor, currency) → string[]` | Before completion |

> **Money & quantity values are Lua numbers (floats).** The runtime hands
> `qty`, `unit_price_minor`, and `total_minor` to every hook as Lua numbers
> (floats), not integers. Lua 5.4 executes `qty * unit_price_minor` in
> **integer** arithmetic when both operands are integers — and integer
> overflow wraps silently. The float hand-off (MONEY-05) removes that wrap
> class: realistic minor-unit values are exact in f64 (below 2^53), so
> normal plugin math and comparisons (`total_minor >= 5000`, `qty == 2`)
> behave identically. Only values above 2^53 lose exactness, and integer-only
> Lua operations (e.g. bitwise `qty & 1`) error on floats — avoid them in
> plugin scripts.

## Example: Custom Discount

```lua
-- plugins/tuesday-discount/discount.lua
function apply_tuesday_discount(sale)
  local now = oz.get_time()
  if now.wday == 3 then  -- Tuesday
    oz.log("info", "Tuesday 10% discount applied")
    oz.apply_discount("cart", 10)  -- 10% off entire cart
  end
end

-- register_hook takes the function NAME as a string
oz.register_hook("sale.before_complete", "apply_tuesday_discount")
```

Requires `required_permissions = ["cart:read", "cart:write", "system:time", "log:write"]`
in `plugin.toml` (see `plugins/example-discount/` for a complete example).

## HAL Driver API Surface

Third-party hardware drivers implement the traits defined in `crates/kasirmu-hal/`.

### Available Driver Traits

`crates/kasirmu-hal/src/traits/` declares **seven** public traits. This table listed four
until 08-09-26 — the two device traits that shipped later (weight scale, EDC payment
terminal) were never added, even though both have a mock driver in
`crates/kasirmu-hal/src/drivers/mock.rs` (`MockWeightScale`, `MockEdcTerminal`) and a real
one (`drivers/scale.rs`, `drivers/edc/`), which is what the "v1.0" heading concealed.

| Trait | Where | Description |
|-------|-------|-------------|
| `BarcodeScanner` | `kasirmu-hal` | Connect, poll for scans, cancel pending reads |
| `ReceiptPrinter` | `kasirmu-hal` | Print receipts, barcodes, QR codes, cash drawer kick |
| `CashDrawer` | `kasirmu-hal` | Open drawer, detect drawer state |
| `CustomerDisplay` | `kasirmu-hal` | Show/hide messages, update totals |
| `WeightScale` | `traits/weight_scale.rs:26` | USB HID weight scale; a reading carries a `stable` flag so the caller can wait for the item to settle |
| `EdcTerminal` | `traits/edc.rs:76` | Card-present payment terminal. `authorize` and `capture` are **separate** because a terminal can hold a funds authorisation without taking the money; `sale` covers the common case in one call |
| `ProtocolCodec` | `drivers/edc/protocol/mod.rs:61` | **PLANNED — do not implement against it.** Encodes/decodes a vendor-specific EDC protocol, and every method currently returns `HalError::Unsupported` until a real vendor protocol lands |

### Implementing a Custom Driver

See `crates/kasirmu-hal/examples/custom_barcode_scanner.rs` for a complete,
tested example of implementing the `BarcodeScanner` trait for custom hardware.

Key requirements:
1. Implement the trait methods (`connect`, `poll`, `cancel`, `device_info`)
2. Return `kasirmu_hal::HalError` for all error paths

> **Note:** Native driver loading from `plugin.toml` is not yet wired into the
> Lua runtime. Drivers are implemented in Rust against the `kasirmu-hal` traits; the
> `capabilities.drivers` manifest field is currently informational.

## Security

- Lua scripts run in a sandbox with no filesystem or network access
- CPU time and memory are limited (100 000 instructions / 10 MiB)
- Each plugin loads into its own isolated environment; hooks are owner-tagged
- Plugins can only ever unsubscribe their own hooks/callbacks
- Manifests are validated: kebab-case plugin IDs, strict SemVer, recognised
  permissions only, unique IDs, and script paths confined to the plugin
  directory (no `..`, absolute paths, or symlink escapes)
- `.kasirpkg` archives are parsed with path-traversal and zip-bomb protections

## Creating a Plugin

1. Create a directory in `plugins/`
2. Write your `plugin.toml` (including at least one `required_permissions`)
3. Write your Lua scripts
4. Restart kasir.mu to load the plugin
5. Check the logs for any load errors

## Testing Plugins

The `kasirmu-plugin` crate includes an integration test that loads the real
`plugins/example-discount` plugin end-to-end:

```bash
cargo test -p kasirmu-plugin --lib
```

## Troubleshooting

| Symptom | Likely Cause |
|---------|-------------|
| Plugin not loaded, "invalid manifest" | Missing/invalid `plugin.toml`; unknown permission; bad name or version format |
| Plugin not loaded, "unsafe script path" | A declared script escapes the plugin directory |
| Plugin not loaded, "duplicate plugin id" | Two plugins declare the same `plugin.name` |
| Lua errors on startup | Syntax error in script — check logs |
| `attempt to call a nil value` on `oz.*` | The plugin lacks the permission for that binding |
| Hook not firing | `oz.register_hook` needs `cart:read`; check the event name and function name |

> last audited 31-08-26 by docs-auditor

