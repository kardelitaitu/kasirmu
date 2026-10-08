<!-- Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (1 finding) · Supersedes the 2026-07-22 marker below, kept verbatim. Repaired: the §Lifecycle note said `on_load` "does not register the `SaleCompletedReporter` (that wiring lives in platform/startup)". `SaleCompletedReporter` no longer exists anywhere in the tree — MSL-11 removed it (only explanatory comments remain, e.g. modules/reporting/src/handlers.rs:3 and platform/startup/src/startup_tests.rs:535) — and `platform/startup` registers only `ReportingModule` (platform/startup/src/lib.rs:130). The sentence implied wiring that is merely absent from this module rather than removed entirely. Corrected. · Repaired against branch 0.0.41. -->
<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · behavioral claim verified: SaleCompletedReporter (modules/reporting/src/handlers.rs:25) subscribes to sale.completed and creates+inserts into report_sales table (handlers.rs:38/70); ReportingModule implements Module and registers handler in on_load; modules/reporting/manifest.json deps [inventory, sales] match; Kernel::register/load_all/start_all match platform/kernel API · RE-AUDITED 2026-08-31 by docs-auditor: manifest deps [inventory,sales] + perms [reports:view,reports:export] and SaleCompletedReporter (handlers.rs:32) re-confirmed against current HEAD; three post-08-09 commits (767eb0d0 audit, a8c3d9a9 MSL-4/7, bf1ff807 MSL-8) are enhancements not contradictions — MSL-8 made the report_sales insert idempotent (replayed sale.completed logged+skipped), consistent with the README's "inserts a row per completed sale". OPEN (not a doc drift): refunded sales remain in report revenue since no refund event exists — product decision to confirm; README is module-scope and correctly silent · RE-AUDITED 31-08 (cont) by docs-auditor: CORRECTED the 07-22 "registers handler in on_load" claim — on_load is a lifecycle stub (lib.rs:74-77, logs only); the SaleCompletedReporter is actually constructed+subscribed in platform/startup/src/lib.rs:165 (same pattern as loyalty's handler). Body Event Handlers + Lifecycle updated to say so; the module's own doc comment (lib.rs:45 "Registers the SaleCompletedReporter") is similarly imprecise — code-side, left for the author --> · REPAIRED 2026-09-26 by DSH: MSL-11 removed the `SaleCompletedReporter` subscription and its `report_sales` projection (no reader in the tree); the aggregate queries it claimed to serve live in `kasirmu_core::db::reports`. Body Overview + Event Handlers rewritten accordingly. The earlier stamps' `SaleCompletedReporter` claims (07-22, 08-31) describe code that no longer exists -->

# Reporting Module

**Status:** Active (read-only report queries)

## Overview

The reporting module generates and exports sales, inventory, and financial reports.

It owns no event handlers. It previously subscribed `SaleCompletedReporter` to
`sale.completed` to maintain a `report_sales` projection; that table had **no
reader anywhere in the tree** (no Rust, UI, or export path selected from it),
while the handler paid a lazy `CREATE TABLE IF NOT EXISTS` plus an unbounded
append on every completed sale and discarded `event.store_id`, losing store
attribution in multi-store mode. The projection was removed (MSL-11).

The aggregates it was meant to serve are computed directly from the live tables
by `kasirmu_core::db::reports` — `daily_revenue`/`weekly_revenue`/
`monthly_revenue` group by currency, apply the store's UTC offset (REP-03), and
join refunds `FULL OUTER` so a refund-only day still produces a row (REP-04).

## Module Info

| Field        | Value                  |
|--------------|------------------------|
| ID           | `reporting`            |
| Version      | `1.0.0`                |
| Dependencies | `inventory`, `sales`   |
| Permissions  | `reports:view`, `reports:export` |

## Event Handlers

None. The `sale.completed` subscription and its `report_sales` projection were
removed with MSL-11 (see Overview). `modules/reporting/src/handlers.rs` is kept
at the same path as an intentionally empty module so the crate layout is stable.

## Lifecycle

The module implements `foundation::contracts::Module`. Its lifecycle hooks are **stubs** — each logs and returns `Ok(())`. There is no sale-completed reporter to register: `SaleCompletedReporter` was **removed** by MSL-11, and `platform/startup` now registers only `ReportingModule` (`platform/startup/src/lib.rs:130`):

1. **`on_load`** — logs "validating configuration"
2. **`on_start`** — logs "ready for reporting"
3. **`on_stop`** — logs "cleaning up"

## Registration

Registered with the kernel during application setup:

```rust
use modules_reporting::ReportingModule;
use platform_kernel::Kernel;

let mut kernel = Kernel::new();
kernel.register(Box::new(ReportingModule::new()))?;
kernel.load_all()?;
kernel.start_all()?;
```

## Manifest

```json
{
  "id": "reporting",
  "name": "Reporting",
  "version": "1.0.0",
  "dependencies": ["inventory", "sales"],
  "permissions": ["reports:view", "reports:export"]
}
```

> last audited 08-10-26 by docs-auditor
