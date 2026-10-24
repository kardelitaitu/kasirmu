# Seven unreachable modules: what each costs, and what each needs

**Measured 2026-10-25 (round 166) at HEAD `9b66b5521`.** `python scripts/census-orphan-modules.py`
reports these seven as reached by no production code. This file exists so the decision is one
read rather than seven investigations. Nothing here is a recommendation to delete; three of the
seven are `UNRESOLVED` (deliberately undecided) and one needs backend work first.

## The cost, in one line

**68 dedicated `it()` cases across seven suites**, plus appearances in ten CSS-inventory files
(`screenExtraction`, `themeTokenCompliance`, `popupBackgroundCompliance`, `focusVisibleCompliance`,
`popoverSurfaceCompliance`, `narrowShellOrientation`, `userActionTokenGuardReports`,
`PosToastLocalization`). All of it passes. None of it can be reached by a user.

## Per module

| Module | Lines | Last commit | Dedicated tests | Verdict | Needs |
|---|---|---|---|---|---|
| `products/ProductManagementScreen.tsx` | 841 | 2026-10-24 | 24 | REPLACED | delete (successor: `WarehouseConsole`) |
| `gift-cards/GiftCardPayment.tsx` | 171 | 2026-09-05 | 11 | NEEDS BACKEND | migration + RBAC (see below) |
| `marketplace/AddonsMarketplace.tsx` | 146 | 2026-09-20 | 10 | UNRESOLVED | an IA ruling |
| `inventory/ThresholdConfigScreen.tsx` | 366 | 2026-09-27 | 8 | FORGOTTEN | a route or a section to live in |
| `inventory/TransitAuditScreen.tsx` | 187 | 2026-09-17 | 8 | PARTLY REPLACED | confirm before deleting |
| `hooks/useMediaQuery.ts` | 17 | 2026-07-12 | 4 | DEAD | delete (17 lines, no IPC) |
| `sales/CartScreen.tsx` | 81 | 2026-08-12 | 3 | SCAFFOLD | delete (never finished) |

## The three that are genuinely easy

**`useMediaQuery.ts`** -- 17 lines, no IPC, no imports, last touched 2026-07-12. Four tests cover
a hook nothing calls. Deleting it and its suite is a pure loss of nothing.

**`CartScreen.tsx`** -- 81 lines, **no `@/api` imports at all**, last touched 2026-08-12. Its own
header says state and IPC live in `useCart.ts`, "added in the next scaffold pass" -- that file was
never written (`ls ui/src/features/sales/useCart*` is empty). An abandoned scaffold, not a
superseded screen.

**`ProductManagementScreen.tsx`** -- 841 lines, 24 tests, the largest single cost. Its archive
banner says it was replaced, and the replacement is real: `WarehouseConsole`, registered at route
`warehouse`. (The banner's *filename* was wrong until round 162 corrected it -- it named a
`WarehouseScreen` that does not exist.) Deleting it is a 841-line and 24-test reduction.

## The three that need a person

**`AddonsMarketplace.tsx`** -- `ui/src/features/index.ts:68-74` records it EXPLICITLY as
"Recorded as UNRESOLVED, not as dead code". That ruling was made deliberately and this round did
not overturn it. It calls `@/api/addons` and `@/api/browser`; whether the product sells add-ons
is not a code question.

**`ThresholdConfigScreen.tsx`** -- 366 lines, the sole consumer of `getStockThresholds`,
`setStockThreshold` and `deleteStockThreshold`, all three registered on BOTH shells (desktop
`lib.rs:1545-1547`, tablet `1491-1493`). It is not dead code; it is a working feature with no
door. Needs a route, or a section inside `Stock Counts` or the warehouse console.

**`TransitAuditScreen.tsx`** -- 187 lines. Its API *is* consumed elsewhere (`WarehouseConsole`
took the receive flow, `StockTransfersScreen` took cancel), so the feature is not gone. What was
lost is the standalone audit/reverse view. Deleting it would discard a view, not duplicate one --
confirm with the owner before doing it.

## The one that needs backend work

**`GiftCardPayment.tsx`** -- 171 lines, 11 tests, a complete tender panel. Blocked on three things
this round verified at source, each documented in `todo-gift-card-redemption-ordering.md`:

1. `payments.method` is a closed CHECK with no gift member
   (`20261017_payments_method_check.sql:41-45`), so a gift payment cannot be recorded.
2. The Staff/checkout RBAC preset carries no `giftcards:redeem` (`rbac_presets.rs:168-201`), so a
   cashier could not redeem even after (1).
3. The component requires a `saleId`, and `PaymentModal` has none before `completeSaleScoped`.

None of that is UI glue. It is a migration, an RBAC change and a settlement-contract decision --
each an owner call under AGENTS.md.

## What this round did NOT do

Nothing was deleted. Every row above is a measurement, and the three "delete" rows are the ones
where the evidence is unambiguous -- but deleting 1,069 lines and reclaiming 68 tests is still a
decision about what the product is, and it belongs to whoever owns the roadmap.

## Filed by

The round-166 lane. No production file edited.
