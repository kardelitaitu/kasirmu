<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 2 minor) · Full re-audit; the 2026-10-08 and 2026-08-31 stamps are merged at the bottom as original evidence. · MAJOR: the §Deprecated kasirmu-core Wrappers section claimed the 15 delegating Store methods were still present and marked #[deprecated]. They were DELETED on 2026-09-28 (ADR-61 / C26): crates/kasirmu-core/src/db/settings.rs carries no exchange-rate methods at all (its own header records "the fifteen deprecated currency shims counted here are deleted, and kasirmu-core no longer depends on modules-currency"). The section now says retired and names CurrencyRepository as the public API the notes pointed at. · MINOR 1: the §Error Handling Rust block attributed the taxonomy to this crate; CurrencyError moved to platform-core on the same date and is re-exported here (modules/currency/src/error.rs is a one-line pub use). The block was also missing the Platform variant's actual declaration and cited a From<CurrencyError> for CoreError that reads platform_core::CurrencyError (crates/kasirmu-core/src/error.rs:194), so both were corrected in place. · MINOR 2: the Exchange-Rate Methods list omitted list_exchange_rates_bounded(limit), which list_exchange_rates() delegates to (bounded 500 default, clamped 1–1000, O-M62); added. · VERIFIED UNCHANGED: modules/currency/manifest.json (id/name/version/dependencies/permissions/capabilities), the three lifecycle-stub descriptions against modules/currency/src/lib.rs log strings, CurrencyRepository's struct shape and all 17 listed methods, the settings delegation to platform_core::settings::Settings, and the registration snippet. · Repaired against branch 0.0.41 at ea89612c3. -->
<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim as original evidence:
Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (1 finding) · Supersedes the 2026-07-22 marker below, kept verbatim. Repaired: the §Lifecycle section described the three hooks as performing work ("Validates configuration", "Prepares for currency operations", "Cleans up resources"). Verified against modules/currency/src/lib.rs: each hook is a STUB — it logs a message and returns Ok(()) — with "In future phases, this will:" comments naming what is planned. The section now says so, matching the correction modules/sales/README.md already carries. The 2026-07-22 stamp's other claims (manifest, permissions, owned paths) were re-verified and still hold. · Repaired against branch 0.0.41.
Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (1 finding repaired) · F1: added CUR-11 exchange-rate methods to the repository list — list_latest_exchange_rates() (bounded latest-per-pair, repository.rs:84) and list_exchange_rates_for_pair() (repository.rs:121) · carried from 2026-07-25: CurrencyModule implements foundation::contracts::Module; CurrencyRepository migrated from kasirmu-core (R2 Phase 1-6); Platform error variant for settings delegation
-->

# Currency/Exchange Module

**Status:** Production (R2 Complete)

## Overview

The Currency/Exchange module manages currencies and exchange rates. It provides the ISO-4217 currency table, default currency configuration, exchange rate CRUD, and currency-format settings (symbol position, decimal/thousands separators) for multi-currency transactions.

## Module Info

| Field        | Value                        |
|--------------|------------------------------|
| ID           | `currency`                   |
| Version      | `1.0.0`                      |
| Dependencies | `[]`                         |
| Permissions  | `currency:view`, `currency:edit` |

## Lifecycle

The module implements `foundation::contracts::Module`. **Its lifecycle hooks are currently stubs** — each logs a message and returns `Ok(())`; none touches the database, cache or event bus yet (`modules/currency/src/lib.rs`):

1. **`on_load`** — logs "validating configuration" (a future phase will validate exchange-rate configuration)
2. **`on_start`** — logs "ready for currency operations" (a future phase will initialize the exchange-rate cache)
3. **`on_stop`** — logs "cleaning up" (a future phase will flush the exchange-rate cache)

## Registration

Registered with the kernel during application setup:

```rust
use modules_currency::CurrencyModule;
use platform_kernel::Kernel;

let mut kernel = Kernel::new();
kernel.register(Box::new(CurrencyModule::new()))?;
kernel.load_all()?;
kernel.start_all()?;
```

## Repository

`CurrencyRepository` provides typed database access for all currency operations:

```rust
pub struct CurrencyRepository<'a> {
    conn: &'a Connection,
}
```

### Exchange-Rate Methods
- `list_exchange_rates()` — Returns all exchange rates (bounded by `DEFAULT_MAX_EXCHANGE_RATES` = 500, O-M62)
- `list_exchange_rates_bounded(limit)` — Same, with an explicit upper bound (clamped 1–1000)
- `list_latest_exchange_rates()` — Latest rate per currency pair (CUR-11 bounded latest-per-pair API)
- `list_exchange_rates_for_pair(from, to)` — Rate rows for a single currency pair
- `create_exchange_rate()` — Insert a new rate
- `upsert_exchange_rate()` — Insert or update by currency pair
- `delete_exchange_rate()` — Remove by ID

### Currency-List Methods
- `list_currencies()` — Returns all ISO-4217 currencies (`Vec<CurrencyDto>`)

### Currency-Format Settings Methods
- `get_default_currency()` / `set_default_currency(code)`
- `get_currency_format()` / `set_currency_format(fmt)` — `"symbol"` or `"code"`
- `get_currency_symbol_position()` / `set_currency_symbol_position(pos)` — `"prefix"` or `"suffix"`
- `get_currency_decimal_separator()` / `set_currency_decimal_separator(sep)` — `"dot"` or `"comma"`
- `get_currency_thousands_separator()` / `set_currency_thousands_separator(sep)` — `"comma"`, `"dot"`, `"space"`, or `"none"`

All settings methods delegate to `platform_core::settings::Settings` and convert errors via the `Platform` variant on `CurrencyError`.

### Error Handling

The taxonomy lives in `platform-core` (ADR-61 / C26, 2026-09-28) so that `kasirmu-core` can name it without depending on this module; this crate re-exports it, so `modules_currency::CurrencyError` still resolves (`modules/currency/src/error.rs`):

```rust
pub enum CurrencyError {
    Db(#[from] rusqlite::Error),
    Platform(#[from] platform_core::PlatformError),
    Validation { field: &'static str, message: String },
    NotFound { entity: &'static str, id: String },
}
```

Conversion to `CoreError` is provided via `From<platform_core::CurrencyError> for CoreError` (`crates/kasirmu-core/src/error.rs:194`).

### Deprecated kasirmu-core Wrappers

**Retired 2026-09-28 (ADR-61 / C26).** The original delegating `Store` methods in `kasirmu-core` have been deleted — `crates/kasirmu-core/src/db/settings.rs` no longer carries exchange-rate methods, and `kasirmu-core` no longer depends on `modules-currency`. `CurrencyRepository` is the public API those deprecation notes pointed callers at.

## Manifest

```json
{
  "id": "currency",
  "name": "Currency/Exchange",
  "version": "1.0.0",
  "dependencies": [],
  "permissions": ["currency:view", "currency:edit"]
}
```

> last audited 11-10-26 by docs-auditor
