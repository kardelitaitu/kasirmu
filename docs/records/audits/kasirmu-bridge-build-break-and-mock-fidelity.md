# A committed build break in kasirmu-bridge, and what it reveals (2026-10-12)

## The break

`cargo test -p kasirmu-bridge` **could not compile on HEAD**. Three `SaleDetail`
fixtures in `crates/kasirmu-bridge/src/history_tests.rs` still built the older
struct, while `a4a2f343c` ("polish sales history row touch ergonomics, detail
breakdown, and receipt reprint") had added four fields:

```
error[E0063]: missing fields `discount_label`, `discount_percent`,
`service_charge_minor` and 1 other field in initializer of `history::SaleDetail`
```

So the ENTIRE bridge test suite — 1500+ tests — was unrunnable, not just the three
cases. Fixed in `d09fd3393` by adding the four fields at their `#[serde(default)]`
zero values (0 / None / 0 / 0), in all three constructors: `make_detail`,
`sale_detail_debug`, `sale_detail_serialize`.

This is worth stating plainly because it changed how the finding was read at first:
no Rust file was dirty, so it was NOT another lane's uncommitted work — the break
was committed and had been sitting on the branch.

## What it means for the dev-mock work (rounds 24-30)

Those rounds fixed six dev-mock fidelity defects (KDS order create, refund
persistence, KDS device registration, floor-plan tables, key/value settings, batch
settings) and repeatedly recorded "not yet confirmed against the real SQLite
bridge". This round answered that question a different way — by reading the Rust:

| Command | Real bridge |
|---|---|
| `create_kds_order_from_sale_scoped` | `kds.rs:428`, tested `kds_tests.rs:1247` |
| `process_refund_scoped` | `refunds.rs:192` via `process_refund_unchecked` |
| `register_kds_device` / `list_kds_devices` | `kds_device.rs:36/63`, store-backed |

All three are properly implemented with their own tests. So the six defects were
**dev-mock-only fidelity gaps**: the mock disagreed with itself, while the product
path was sound. That is still worth fixing (a developer driving the preview sees
the wrong thing), but it was never a live-product defect — and saying so is more
accurate than leaving "unverified" standing as if the risk were open.

The honest confirmation would still be a live run against SQLite; the code reading
establishes that the mock's behaviour was not masking a missing implementation.

## Not verified live

Vite has been down since round 40 (seven rounds). A question about restarting it
was put to the user this round and **timed out unanswered**, so the dev server was
not started — infrastructure the user has not approved is not mine to start.

Consequently the five order-type-field fixes (`206462b4d`, `035d1d01b`,
`795fc18d4`, `547bf031d`, `54767afa5`) still rest on jsdom tests plus kill-tests.
Their guards are additionally swept by
`RestaurantOrderTypeFieldConsumers.test.ts`, which fails if any consumer is
dropped or written in the negative form.

> last audited 14-10-26 by docs-auditor
