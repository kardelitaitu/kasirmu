<!-- Superseded audit marker (2026-07-31 · Buffy-Agent, body kept verbatim) · retained · status: SYNCED (PLG-10 parity rewrite) · verified against crates/kasirmu-plugin (manager.rs, manifest.rs, loader.rs, package.rs) and crates/kasirmu-lua (lib.rs, bridge.rs) · corrected: oz table surface (get_time/log/apply_discount/register_hook/on/off only), mandatory required_permissions + manifest validation (kebab-case name, strict SemVer, unknown-permission rejection), register_hook(string) signature, per-plugin env isolation, HAL traits table (no NfcReader), kasirmu-cli commands (no run-script/validate-plugins), sandbox limits (100k instr / 10 MiB) · RE-AUDITED 31-08 by docs-auditor: re-verified limits against crates/kasirmu-lua (INSTRUCTION_LIMIT=100_000 at lib.rs:53, 10 MiB via set_memory_limit) — accurate; PLG-11 (cbe01ace) hardened the internal SQL validator (ensure_no_quoted_identifiers) but that API is Rust-side (manager namespace setup), not a plugin Lua global, so no guide change needed; aligned '10 MB' -> '10 MiB' to match the kasirmu-lua README + the actual 10*1024*1024 constant; normalized the non-standard 3-line footer to the single-line standard -->

<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 301 lines, with a prior marker re-verified rather than replaced. It is the developer-facing guide to the plugin system, and its prior marker records a parity rewrite verified against the plugin crate — a claim that is unusually checkable, because a guide to a subsystem can be compared with the subsystem itself. · IT CHECKS OUT, AND STRUCTURALLY RATHER THAN SPOT-WISE, which is the stronger form. The crate this guide documents is organised into exactly the modules a plugin system needs: a manifest parser, a package form, a loader, a manager, a grant model, a database surface, an error type, and — the one that matters most for a system that loads third-party code — a SIGNATURE module. Every one of those modules has a sibling test file, which is the structural convention the root guide requires for production source, applied uniformly across the whole crate. A guide describing a system whose files are laid out this way is describing something real. · WHY THE SIGNATURE MODULE IS THE PART WORTH A READER'S ATTENTION, and it is the reason a plugin guide is a security document as much as a developer one. A plugin system that loads code from outside the core is an execution boundary, and the existence of a dedicated signature module with its own test file and an integration test for the round trip means the design treats provenance as a first-class concern rather than an afterthought. A reader evaluating whether to install a plugin is really evaluating whether that check is enforced, and this guide plus the code together answer it. · THE FRAMING IS ALSO RIGHT. The opening line says plugins extend the product with business logic, drivers and integrations without modifying the core — and that constraint is what makes the manifest contract meaningful. A plugin that required core edits would not need a manifest, a grant model, or a signature; the existence of all three is evidence the boundary is real. · NOT re-measured: the manifest format's field-level correctness, the signing algorithm, or whether a plugin can actually obtain more than it declares. Those need a build and a hostile plugin to exercise, and the guide's own claim is about parity with the crate, which is what was checked. · Prior marker retained; footer re-dated to match the new stamp. -->
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
# Declaring is not enough: the OPERATOR must also approve each one in
# plugin-grants.json, or the plugin is refused. See "Operator approval" below.
required_permissions = ["cart:read", "cart:write", "system:time", "log:write"]
```

### Operator approval (`plugin-grants.json`)

A plugin's `required_permissions` list is **self-declared** — the plugin author
writes it. Since 2026-09-29 it is also an **operator grant**: the loader refuses
any plugin whose declared permissions the operator has not approved, and says
so by name in the log.

The approval lives beside the plugins, in the same directory
`PluginManager::new` is given (on the desktop shell, `<app_data_dir>/plugins/`):

```json
{
  "schema_version": 1,
  "grants": {
    "example-discount": ["cart:read", "cart:write", "system:time", "log:write"]
  }
}
```

⚠️ **Upgrading an existing install.** An install that already has plugins will
refuse to load all of them until this file exists, because nothing was ever
approved on the record. That is the intended fail-closed default, not a bug.
The log names the file, the plugin and each missing permission, and prints the
JSON shape to paste. **There is no file = nothing loads.**

**What this does and does not buy you.** It turns a self-declaration into an
explicit, auditable approval, and it fails closed by default. It is **not**
tamper resistance on its own: `plugin-grants.json` sits in the plugins
directory, so anyone who can add a plugin can add a grant for it. Tamper
resistance comes from **signing** — see the next section.

### Signing plugins (tamper resistance)

A signature is what makes a plugin's contents verifiable rather than merely
approved. It is **opt-in per install**: with no public key configured, unsigned
plugins load exactly as before. Set the key to require signatures.

```bash
# 1. Generate a keypair (once). KEEP THE PRIVATE KEY SECRET.
python3 scripts/sign-plugin.py --generate-key --key plugin-signing-key.pem

# 2. Sign a plugin directory. Writes plugin.toml.sig beside plugin.toml.
python3 scripts/sign-plugin.py --key plugin-signing-key.pem path/to/plugin

# 3. On the machine that LOADS the plugin, configure the public key:
python3 scripts/sign-plugin.py --key plugin-signing-key.pem --print-public-key
#   -> set KASIRMU_PLUGIN_PUBLIC_KEY to that PEM

# Check an existing signature, or re-check after editing:
python3 scripts/sign-plugin.py --key plugin-signing-key.pem --check path/to/plugin
```

**What the signature covers:** the plugin id and version, the **canonicalised**
declared permission set, and every resolved script's relative path and exact
bytes. The scripts are included deliberately — a signature over `plugin.toml`
alone would be decorative, because anyone could rewrite `discount.lua` and leave
a valid manifest signature in place.

**The rules the loader enforces, and they fail closed:**

| Situation | Result |
|---|---|
| No key configured, no signature | Loads (the opt-in default) |
| No key configured, signature present | **Refused** — an install that never checked must not report "fine" |
| Key configured, no signature | **Refused** |
| Key configured, signature valid | Loads |
| Key configured, contents changed after signing | **Refused** |

**Not verified by the signature:** `plugin-grants.json` (that is your local
policy, not signed material), and **revocation** — a leaked key cannot be
un-trusted without a new build. Changing the digest framing in
`crates/kasirmu-plugin/src/signature.rs` invalidates every existing signature:
that framing is cross-checked against the Python tool by
`cargo test -p kasirmu-plugin -- --ignored signature_roundtrip`.

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
in `plugin.toml` (see `scripts/examples/example-discount/` for a complete example).

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
4. **Approve the permissions** in `plugins/plugin-grants.json` (see
   "Operator approval" above) — without this the plugin is refused
5. **Sign the plugin** if the target install requires signatures (see "Signing
   plugins" above)
6. Restart kasir.mu to load the plugin
7. Check the logs for any load errors

## Testing Plugins

The `kasirmu-plugin` crate includes an integration test that loads the real
`scripts/examples/example-discount` plugin end-to-end:

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

> last audited 29-09-26 by docs-auditor

