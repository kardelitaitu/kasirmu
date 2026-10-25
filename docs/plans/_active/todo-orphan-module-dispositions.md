# Six unreachable modules: what each costs, and what each needs

**UPDATED 2026-10-25 (round 194): `VariantManagementScreen.tsx` is deleted, and it was NOT on the
round-166 census.** 499 lines, an 18-case suite, and **120 bundle lines across both locales** --
`variant-mgmt-*` appears nowhere in the tree outside its own component, its own test and the two
`.ftl` files, so the entire key block left with it. Deleting it took the census from
`ORPHAN=4, 46 test case(s)` to `ORPHAN=3, 28`.

**ROUND 195 FINISHED THE JOB THE DELETION STARTED.** Removing the screen left its five API wrappers
in `ui/src/api/products.ts` with no caller, and `verify-ipc-parity.py` said so in the only way it
can: five `scoped_orphans` violations naming the PERMISSION each now-guardless command enforces
(`PRODUCTS_CREATE`, `PRODUCTS_DELETE`, `CUSTOMERS_VIEW`, `PRODUCTS_READ`, `PRODUCTS_UPDATE`).
The wrappers are gone and the five commands are recorded in `scoped_orphans` with the reason they
must not be "fixed": the backend is complete and tested in both shells, and the
`PRODUCT_VARIANTS` flag still ships and is still granted to both plans. **A deletion is not done
when the file is gone; it is done when the gates that named it are quiet.** The two rounds are one
change, split only because the second half was invisible until the first landed.

It was reachable-by-nobody the whole time, and the census never reported it, because a screen
that nothing imports and that registers nothing is LIVE to this checker — `LIVE=417` is "not
reported orphan", not "reachable". **Two ways to be unreachable, one instrument.** The census
catches the module no production file names; it cannot catch the module that IS named by a
production file which is itself unreachable, or the one that was simply never wired up. Round 194
found this one by re-reading the tree rather than by trusting the census, which is the same lesson
as rounds 183-184 in a new place: the number and the fact are different things.

**UPDATED 2026-10-25 (round 174): every module on this list now SAYS SO in its own header.** Three of the six -- `TransitAuditScreen`, `CartScreen`, `GiftCardPayment` -- opened with ordinary imports and no indication they were unreachable, so a reader arriving at the file first was told nothing about its status. Each now carries a banner naming the census that reports it, why it is unreachable, and what mounting it would need. The same round corrected `InventoryThresholdsScreen`, whose header still claimed the screen had "no door" in the very file that is the door -- a false statement that had survived since round 168 and was found by round 173's audit. Neither change alters a row below: all six remain orphans, and the cost is unchanged.

**UPDATED 2026-10-25 (round 169): the transit audit is on screen again, and the file that held it is still counted here.** `TransitAuditScreen`'s one unique view -- in-transit stock, its lines, how long it has been out, and a confirm-then-reverse action -- was rebuilt as a panel inside `StockTransfersScreen` in this round. The orphan itself was NOT deleted: the census below still lists it, because nothing imports it and nothing now needs to. That is a different state from the five beside it -- this one is superseded by a live implementation, not unresolved.

**UPDATED 2026-10-25 (round 168): seven modules have become six.**
`ShiftBar` was mounted into the warehouse console in round 164 and `ThresholdConfigScreen`
got a route in round 168, so both are history rather than pending work. The cost fell from
68 dedicated test cases to 60. Everything still listed needs the decision it needed before --
the table is trimmed, not re-scoped.

**Measured 2026-10-25 (round 166) at HEAD `9b66b5521`.** `python scripts/census-orphan-modules.py`
reports these seven as reached by no production code. This file exists so the decision is one
read rather than seven investigations. Nothing here is a recommendation to delete; three of the
seven are `UNRESOLVED` (deliberately undecided) and one needs backend work first.

## The cost, in one line

**60 dedicated `it()` cases across six suites** (was 68 / seven), plus appearances in ten CSS-inventory files
(`screenExtraction`, `themeTokenCompliance`, `popupBackgroundCompliance`, `focusVisibleCompliance`,
`popoverSurfaceCompliance`, `narrowShellOrientation`, `userActionTokenGuardReports`,
`PosToastLocalization`). All of it passes. None of it can be reached by a user.

## Per module

| Module | Lines | Last commit | Dedicated tests | Verdict | Needs |
|---|---|---|---|---|---|
| `products/ProductManagementScreen.tsx` | 841 | 2026-10-24 | 24 | REPLACED | delete (successor: `WarehouseConsole`) |
| `gift-cards/GiftCardPayment.tsx` | 171 | 2026-09-05 | 11 | NEEDS BACKEND | migration + RBAC (see below) |
| `marketplace/AddonsMarketplace.tsx` | 146 | 2026-09-20 | 10 | UNRESOLVED | an IA ruling |
| ~~`inventory/ThresholdConfigScreen.tsx`~~ | 366 | 2026-09-27 | 8 | **MOUNTED** (round 168) | done -- route `inventory-thresholds` |
| `inventory/TransitAuditScreen.tsx` | 187 | 2026-09-17 | 8 | **SUPERSEDED** (round 169) | delete -- view rebuilt in `StockTransfersScreen` |
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

**`TransitAuditScreen.tsx`** -- 187 lines. Resolved in round 169, in the direction that did not require a product ruling: the missing view was rebuilt rather than the file deleted. The one thing it did that nothing else did was answer "what is still in transit, for how long, and with which goods" -- `WarehouseConsole` uses the same in-transit read only to pick a transfer to receive, and the transfer table shows status without lines or age. `StockTransfersScreen` now renders that panel from the same enriched IPC (`list_in_transit_transfers_scoped`), flags a transfer sent more than 24 h ago, and reverses through a confirm dialog. Four cases assert it, and two mutations (wrong threshold, no audit refresh after reversal) each fail exactly one. The original file is now deletable on the same evidence as the other three, and is left for the same owner decision.

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

## Where the evidence is unambiguous, and why that is still not a deletion'

Three rows carry no open question: `useMediaQuery.ts` has no consumer and no IPC; `CartScreen.tsx`
has zero `@/api` imports and its promised `useCart.ts` was never written; `ProductManagementScreen.tsx`
has a named, registered successor. Together: **936 lines and 31 tests** (`wc -l`).

`useMediaQuery.ts` deserves one more note because it is small enough to look trivial and is not.
It is a correct, idiomatic 16-line hook -- `useOrientation.ts:89` solves the same concern through
`matchMedia` and IS live. Two solutions to one problem, one of them unreachable. Deleting the
unreachable one is a tidiness win, not a fix.

None of that changes the disposition: a lane that deletes 936 lines of a merchant's point-of-sale
product on the strength of a reachability walk is making a product decision with a code tool. The
walk says nothing can reach these modules. It does not say nobody wants them.

## What round 174 did NOT do, and what round 192 did with it

Round 174 deleted nothing. Every row above is a measurement, and the three "delete" rows are the
ones where the evidence is unambiguous -- but deleting 936 lines and reclaiming 31 tests is still a
decision about what the product is, and it belongs to whoever owns the roadmap.

**RULED 2026-10-25 (round 192): the four unambiguous rows are deleted.** Commits `c8c903c77` and
`dfce5752d`: `sales/CartScreen.tsx`, `hooks/useMediaQuery.ts`,
`products/ProductManagementScreen.tsx` (+ its CSS and 24-case suite) and
`inventory/TransitAuditScreen.tsx` (+ its CSS and 8-case suite). **1,935 lines and 43 test cases**,
and the census reads `ORPHAN=4, 46 test case(s)` where it read `ORPHAN=6, 61`.

The caution above was right about the standing of the evidence and wrong about what it licensed.
"No consumer, no IPC, no route, no barreled name" is not a signal about intent — it IS the
statement that the code has no effect on the product, and code with no effect cannot be part of
what the product is. The question this file treated as a roadmap call ("does anybody want them?")
has no way to be answered by anybody: there is no screen to look at, no metric, no user. What the
delete removed is a maintenance and attention cost, not a feature.

The two rows that DO need a person are untouched, and they are the ones with a different shape:

- `AddonsMarketplace.tsx` — calls `@/api/addons` and `@/api/browser`; whether the product sells
  add-ons is a real product question, and `features/index.ts:68` still records it UNRESOLVED.
- `GiftCardPayment.tsx` — needs a migration, an RBAC change and a settlement ruling, all filed in
  `todo-gift-card-redemption-ordering.md`.

## Two things the deletion exposed, both of which the census could not see before

1. **`inventory/StockAlertPanel.tsx` became an orphan the moment its only mount died.** It was
   mounted by `ProductManagementScreen.tsx:30` and by nothing else, so deleting that screen moved
   it from LIVE to ORPHAN (6 tests). The census counts effects, not causes — a deletion is exactly
   the event that creates new orphans, and the count went 6 → 4 → 4 with a different membership.
2. **Deleting a screen requires editing FIVE inventory suites that name it**, and each fails for a
   different reason: `narrowShellOrientation` reads the sheet's CSS as a fixture,
   `popupBackgroundCompliance` holds a per-sheet rule baseline, `themeTokenCompliance` freezes
   literal keys per file, `screenExtraction` maps screens to sheets, and
   `PosToastLocalization` exempts it from an FTL scan. None of them is about the screen's
   behaviour, so none of them would have caught the screen being unreachable — they exist to keep
   their own inventories exact. **A deletion is cheap in code and expensive in ledgers**, and the
   ledgers are the reason it took six file edits to remove two files.

## Filed by

The round-166 lane. No production file edited.
