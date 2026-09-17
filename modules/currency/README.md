<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (1 finding repaired) · F1: added CUR-11 exchange-rate methods to the repository list — list_latest_exchange_rates() (bounded latest-per-pair, repository.rs:84) and list_exchange_rates_for_pair() (repository.rs:121) · carried from 2026-07-25: CurrencyModule implements foundation::contracts::Module; CurrencyRepository migrated from kasirmu-core (R2 Phase 1-6); Platform error variant for settings delegation -->

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

The module implements `foundation::contracts::Module` and follows the standard lifecycle:

1. **`on_load`** — Validates configuration
2. **`on_start`** — Prepares for currency operations
3. **`on_stop`** — Cleans up resources

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
- `list_exchange_rates()` — Returns all exchange rates
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

```rust
pub enum CurrencyError {
    #[from] Db(rusqlite::Error),
    Validation { field: String, message: String },
    NotFound { entity: &'static str, id: String },
    #[from] Platform(platform_core::PlatformError),
}
```

Conversion from `CurrencyError` to `CoreError` is provided via `From<CurrencyError> for CoreError`.

### Deprecated kasirmu-core Wrappers

The original 15 delegating Store methods in `kasirmu-core` are marked `#[deprecated]` and direct callers to use `CurrencyRepository` directly. Tests retain `#[allow(deprecated)]` for backward compatibility.

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

> last audited 31-08-26 by docs-auditor
