# kasirmu-core

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (12 findings) · SUPERSEDES the 2026-08-31 stamp, whose fix is carried forward: it added the missing promotion_engine row (PROMO-3 discount engine, compute_discount / compute_discount_unscoped). · RECONCILED the module table against src/*.rs: 67 rows, 0 dead, 2 modules deliberately unlisted (lib, features_proptests). Repaired: store_profile -> location_profile (the store→location rename, 10260a035 + c9d0ec95f on 2026-09-06), and 10 modules that exist and were absent from the crate's own README — availability, downgrade, entitlements, legal_entity, memo, payable, regional, service_health, sync_auth, sync_pull. Two of those absences matter more than a missing row: entitlements.rs is now the single read model where tier, quota, add-on grant and the dev Free→Premium upgrade resolve (the consolidation landed 2026-09-08 in 1b3e71798), and downgrade.rs holds the QuotaDimension enum that docs/guides/subscription-tiers.md documents enforcement for. A reader learning the crate from its README would not find either. -->

Domain models, SQLite persistence, and migrations for OZ-POS. Every other crate builds on types defined here.

## Public modules (66 — `grep -c '^pub mod ' crates/kasirmu-core/src/lib.rs`, measured 2026-09-14)

| Module | Key types |
|--------|-----------|
| `audit` | `AuditEntry` — structured audit log |
| `auth` | `StaffSession`, token generation |
| `availability` | Feature-availability verdicts — *why* a feature is unavailable, not just whether |
| `cache` | In-memory cache helpers |
| `cart` | `Cart`, `CartLine` — in-memory sale state machine |
| `cash_payout` | Cash payout types |
| `category` | `Category` — product categories |
| `config_validator` | Config validation helpers |
| `crypto` | Cryptographic helpers |
| `customer` | `Customer` — customer records |
| `db` | `Store` — all CRUD methods (products, sales, customers, staff, tax_rates, audit, features, currencies, exchange_rates, held_carts, barcode lookup) |
| `downgrade` | Downgrade assessment — which existing resources exceed a lower tier’s quota |
| `entitlements` | Entitlements read model — the single place tier, quota, add-on grant and the dev Free→Premium upgrade resolve (see docs/guides/subscription-tiers.md) |
| `error` | `CoreError` — `thiserror`-based, `#[non_exhaustive]` |
| `events` | Domain event types |
| `export` | Export helpers |
| `features` | Feature flag types |
| `gift_card` | Gift card types |
| `inventory` | Stock adjustment types |
| `inventory_transaction` | Inventory transaction types |
| `kds` | Kitchen Display System types |
| `legal_entity` | Legal Entity domain type for the Organization/Tenant hierarchy |
| `license_verification` | License verification types |
| `location_resolver` | Location resolution |
| `loyalty` | Loyalty points types |
| `memo` | Memo domain model — schema-independent logic behind the Memo feature |
| `migrations` | `run(&mut Connection)` — applies pending SQL from `migrations/` (date-prefixed, consolidated from 131 sequential migrations 2026-08-14) |
| `money` | `Money(i64, Currency)`, `Currency` (ISO-4217 newtype) |
| `offline` | Offline queue types |
| `ozpkg` | Package metadata types |
| `payable` | Accounts Payable (Hutang / Beli Tempo) domain model |
| `payment` | Payment transaction types |
| `popularity` | Product popularity index |
| `product` | `Product`, `ProductDto` — SKU, price, barcode, stock, tax links |
| `product_bundle` | Product bundle types |
| `product_variant` | Product variant types |
| `promotion` | Promotion types |
| `promotion_engine` | PROMO-3 discount engine — `compute_discount`, `compute_discount_unscoped` |
| `purchase_order` | Purchase order types |
| `rate_limiter` | Rate limiter |
| `recipe` | Recipe types |
| `refund` | Refund types |
| `regional` | Regional configuration — the market facts a Location trades under |
| `sale` | `Sale`, `SaleLine`, `SaleStatus`, `SaleSummary` |
| `sale_deduction` | Sale deduction logic |
| `service_health` | Service health contracts — what a status means and what differs from healthy |
| `session` | Session types |
| `settings` | Key-value settings accessors (receipt config, store info, currency) |
| `shift` | Staff shift types |
| `sku` | `Sku` newtype — validated stock-keeping unit |
| `stock_count` | Stock count types |
| `stock_transfer` | Stock transfer types |
| `location_profile` | Location-profile domain type (was `store_profile` before the store→location rename) |
| `subscription` | Subscription types |
| `supplier` | Supplier types |
| `sync` | Sync types |
| `sync_auth` | Cloud sync auth surface — token requests and tenant plan lookups |
| `sync_client` | Sync client types |
| `sync_pull` | Cloud sync pull — snapshot fetch and local upsert |
| `table` | Restaurant table types |
| `tax_rate` | `TaxRate` — name, rate in basis points, is_default |
| `terminal` | POS terminal registration types |
| `terminal_override` | Terminal feature override types |
| `terminal_profile` | Terminal profile types |
| `timezone` | Business-date resolution in a location's IANA timezone — `business_date_in_zone()`; unknown or empty zone falls back to UTC (ADR #48 Decision 3) |
| `topology` | Topology types |
| `user` | `User`, `Role` — staff identity and permissions |
| `user_preferences` | User preference types |

**How to read the two counts (live, 2026-09-14).** The heading counts top-level `pub mod` declarations in `src/lib.rs`, which is what its command reproduces. The table above has **68** rows — `grep -cE '^\| [^A-Z]' crates/kasirmu-core/README.md` = 68 (data rows only; the `| Module | Key types |` header and the `|---|` rule do not match it). The numbers differ by exactly 2, and cfg-gating is **not** the reason: no `pub mod` in `lib.rs` carries a `#[cfg` attribute — `grep -B1 '^pub mod ' crates/kasirmu-core/src/lib.rs | grep -c '#\[cfg'` = 0 — and the file's single `#[cfg` (`grep -c '#\[cfg' crates/kasirmu-core/src/lib.rs` = 1, at `lib.rs:189`) gates a `pub use`, not a module. The 2 extra rows are `sync_auth` and `sync_pull`, which have no `pub mod` line in `lib.rs` at all. They are declared inside `sync_client.rs` — `grep -c '^mod sync_' crates/kasirmu-core/src/sync_client.rs` = 2 (`:250`, `:255`, each preceded by `#[path]`) — and glob-re-exported there — `grep -c '^pub use sync_' crates/kasirmu-core/src/sync_client.rs` = 2 (`:252`, `:257`). Their **items** are therefore public as `kasirmu_core::sync_client::*`, while the two module **names** are not public paths; they keep a row because the items are usable, and they are absent from the 66 by construction, not by omission.

The reverse gap was real and is fixed here: `timezone` is a `pub mod` (`lib.rs:156`) that had **no** row until 2026-09-14; its row is described from that module's own `//!` header. The retired heading value, 57, agreed with neither side — not with the crate (66) and not with this page's own table (67 rows before the `timezone` row). The 2026-09-08 audit stamp above records "67 rows, 0 dead" and is left exactly as written: it is a point-in-time record, superseded by the live counts in these two paragraphs rather than rewritten by them.

## Money

```rust
use kasirmu_core::{Money, Currency};

let usd = Currency::from_str("USD").unwrap();
let price = Money::from_major(12, usd);
let total = price.checked_add(Money::from_major(5, usd)).unwrap();
assert_eq!(total.minor_units, 1700);
```

## Store (SQLite)

All DB access goes through `Store` methods in `db.rs`. Every write runs inside a `rusqlite` transaction.

Key methods: `create_product`, `list_products`, `update_product`, `delete_product`, `lookup_product_with_details_by_barcode`, `list_sales`, `get_sale`, `create_sale`, `complete_sale_deduction`, `complete_sale_with_resolved_shortfalls`, `hold_cart`, `list_held_carts`, `get_held_cart`, `delete_held_cart`, `set_cart_discount`, `export_daily_summary`, `export_sales_by_hour`, staff CRUD, customer CRUD, category CRUD, tax rate CRUD, feature flags, currencies, exchange rates (`list_exchange_rates`, `create_exchange_rate`, `upsert_exchange_rate`), audit log.

## Conventions

- Money is always `i64` minor units — never `f32`/`f64`.
- `#![deny(unsafe_code)]` in `lib.rs`; `missing_docs` is warned via
  `[lints] workspace = true`, inherited from the root `[workspace.lints]`.
- All public items have `///` docs.

> last audited 08-09-26 by docs-auditor
