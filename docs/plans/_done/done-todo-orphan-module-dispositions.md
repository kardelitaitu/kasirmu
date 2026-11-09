<!-- Acceptance verified 2026-10-26: python scripts/census-orphan-modules.py (exit 0, ORPHAN=2, LIVE=417; all actionable modules deleted/mounted, preserving only the 2 documented intentional orphans: GiftCardPayment.tsx awaiting backend work per todo-gift-card-redemption-ordering.md and AddonsMarketplace.tsx unresolved pending catalog per todo.md C4.3). Earned done- prefix per AGENTS.md §7.4. -->
# Six unreachable modules: what each costs, and what each needs
> Status: RESOLVED & ARCHIVED (2026-10-26). All actionable unreachable modules deleted (CartScreen.tsx, useMediaQuery.ts, ProductManagementScreen.tsx, TransitAuditScreen.tsx, VariantManagementScreen.tsx, StockAlertPanel.tsx) or mounted (ThresholdConfigScreen.tsx). Only the 2 documented intentional modules remain (GiftCardPayment, AddonsMarketplace). Earned done- prefix per AGENTS.md §7.4.


**UPDATED 2026-10-25 (round 194): `VariantManagementScreen.tsx` is deleted, and it was NOT on the
round-166 census.** 499 lines, an 18-case suite, and **120 bundle lines across both locales** --
`variant-mgmt-*` appears nowhere in the tree outside its own component, its own test and the two
`.ftl` files, so the entire key block left with it. Deleting it took the census from
`ORPHAN=4, 46 test case(s)` to `ORPHAN=3, 28`.

**ROUND 197: two leftovers of the same deletion, and neither was reported by a gate.**
`product-mgmt-stock-alert-open` / `-close` ("Open stock alerts" / "Close stock alerts") were in
BOTH locales and read by nothing — `lint-i18n.sh` says "no issues", because its orphan rule compares
the two bundles against each other, not against the code. They were the strings for a drawer that
the panel's own removal made unreachable. And `sales/PromotionsModal.css:178` still cited
`inventory/StockAlertPanel.css:147-151` as its provenance for three copied declarations — a live
citation of a file that no longer exists. **A green gate is a statement about what it grades**, and
neither of these was in any gate's scope: the FTL lint grades bundle-to-bundle, and a CSS comment
is prose. Both are fixed rather than noted, because the second one would have sent a reader to a
missing file for a reason that is still true.

**ROUND 196 DELETED `StockAlertPanel.tsx` — an orphan created BY a deletion, and a new shape the
census had not reported before.** It was mounted in exactly one place,
`ProductManagementScreen.tsx:30`, so round 192's deletion did not merely remove a screen: it
turned a live widget into a dead one. The census then reported it (`ORPHAN`), which is the
instrument working — but the lesson is that **a deletion's blast radius includes everything that
hung off the deleted file**, and that set is not zero. What went with the panel: 227 lines of
component, 271 of CSS, 6 tests, 36 bundle lines (`inv-alert-*` in both locales), and five entries
in four compliance suites (`forcedColorsCompliance` x5, `popupBackgroundCompliance` x1,
`themeTokenCompliance` x1, `screenExtraction` x1). Census: `ORPHAN 3 → 2`, unreachable tests
`28 → 22`.

**The companion that was NOT deleted, and why that is the right call.** `components/StockAlertBell`
reads the SAME `getActiveStockAlerts` and renders a count in the app top bar
(`AppLayout.tsx:376`). It still has a mount, so it is live and it stays — verified rather than
assumed, because the tempting inference ("the panel's data source is dead") is wrong. And its
`onNavigate('products')` still lands somewhere real: `features/products/register.tsx:9` registers
`route: 'products'` to `ProductLookupScreen`, a DIFFERENT screen that survived both deletions. So
the bell keeps working and keeps navigating, and the first draft of this note — which claimed the
route had been retired with `ProductManagementScreen` — was wrong. The archived-route comment
directly beneath that registration names `'inventory'`, not `'products'`, and reading the registry
rather than the comment is what settled it.

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

**NARROWED 2026-10-25 (round 201), without overturning the ruling.** Four measurements that
make "needs an IA ruling" more precise than it was: (a) the component's ONLY action is one tap
— `handlePurchase` opens the WEBSITE pricing page with an anchor
(`AddonsMarketplace.tsx:102`, `/pricing/#addon-<id>`) — so mounting it adds a screen whose whole
function is a browser hand-off; (b) its data is a static client-side catalog
(`api/addons.ts:31` `ADDON_CATALOG`), not a read; (c) the flow cannot complete today even
with a route; and (d) the entitlement it reads (`SignedSubscriptionPayload.addons`) is real and
shipped, which is why the file stays.

**CORRECTED 2026-10-25 (round 204) — (c) above stated the mechanism backwards, and the
backwards reading was hiding a live defect.** Three measurements, in the order they mattered:

1. `ui/src/api/addons.ts` is 85 lines and carries four `pri_addon_*_monthly` ids (:38, :47,
   :56, :65). `pri_placeholder_` appears in that file **zero** times, and `:90-93` is past its
   end — the coordinate was never real. So the sentence "every Paddle price is a placeholder"
   described a catalog that does not exist.
2. What it was standing in for is worse. `AddonsMarketplace.tsx` refused a price by testing
   `startsWith('pri_placeholder_')`, and since nothing in the catalog begins with that prefix
   the branch was UNREACHABLE: `handlePurchase` opened the browser for **every** entry. The
   documented "warns and returns without opening anything" described a path no catalog value
   could take.
3. The refusal that was meant to happen now happens, and it is one named function
   (`isPlaceholderPriceId`, the website's own test — `website/src/components/paddle.ts:101`).
   Both arms are pinned: one case feeds the catalog's real id and expects the hand-off, the
   other feeds a placeholder id and expects no hand-off plus the warning. The second case
   cannot be driven from the shipped catalog at all, which is exactly why it has to exist —
   a test that only clicks the real catalog cannot tell a working guard from no guard.

**And the destination is not what the sentence implies.** `website/src/pages/[locale]/pricing.astro`
renders `PricingGrid`, whose only ids are the tier keys (`free`/`plus`/`pro`, en.ts:19/38/66);
"addon" has zero hits under `website/src`, so the built `#addon-<id>` fragment has NO target and
the tap lands on the pricing table. That is the right place for a purchase to start — it is just
not a page about the add-on it was tapped from, and with the guard fixed it is now the first
thing an operator sees rather than the second.

None of this changes the disposition: **(a) and (d) stand, and the server still does not consume
the catalog.** `SubscriptionPayload` (`apps/license-server/main.go:1440`) has no `addons` field,
so no payload the license server signs carries one; the admin routes
(`/api/v1/admin/license-addons`) write `license_keys.addons` but nothing reads it back into a
signed subscription; and nothing calls those routes — a `transaction.completed` webhook only
records revenue (`paddle_webhook.go:657-663`), while `subscription.created` REFUSES any price not
in `PADDLE_PRICE_TIERS` (`:1002-1005`), which contains none of the four `pri_addon_*` ids. So the
condition an owner is asked about is unchanged, and now correctly stated: the component is
wired to a UI-side placeholder catalog on both ends, and the purchase it offers has no server
path to an entitlement.

So the question is no longer "does the product sell add-ons" in the abstract — it is "has the
catalog been wired", and `todo.md` C4.3 already answers that in the same words: *"The Go side
will wire the field when actual add-ons are catalogued."* **The component is ahead of nothing and
behind nothing; it waits on the catalog.** That is a smaller and more checkable condition than
an IA ruling, and it is what an owner should be asked.

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
2. No built-in RBAC preset carries `giftcards:redeem` — not the Staff/checkout preset
   (`rbac_presets.rs:168-201`) and not any of the other five either, so a cashier could not redeem
   even after (1).
3. The component requires a `saleId`, and `PaymentModal` has none before `completeSaleScoped`.

None of that is UI glue. It is a migration, an RBAC change and a settlement-contract decision --
each an owner call under AGENTS.md.

**CORRECTED AND PINNED 2026-10-25 (round 216).** Point (2) above said only the Staff preset lacks
the key, which reads as "the other five have it". Measured: `ROLE_PRESETS` contains ZERO
occurrences of the gift-card family across all six presets — Owner, Manager, Staff, Admin, Auditor
and Custom — so redemption is reachable only through a Custom role an owner builds by hand. The
narrower wording was wrong in the direction that would have made the blocker look smaller.

The boundary was also held by nothing a test could fail on. Two existing tests touch the presets
and neither would have caught a grant:

  * `every_enforced_key_is_granted_by_at_least_one_preset` lists all three gift-card keys in its
    `unpreseted_exceptions` — the exception is what makes them owner-only, and it is also what
    makes that test SKIP them.
  * `sensitive_family_wildcard_rejected` stops `giftcards:*`, but an explicit single-key grant is
    not a wildcard and passes it.

`permission_registry_tests.rs` now carries `no_builtin_preset_grants_a_giftcard_key` and
`giftcard_keys_are_declared_in_the_inventory`. Proven to fire rather than assumed: inserting
`permissions::GIFTCARDS_REDEEM` into the Manager preset makes it panic naming `Manager`, and the
same insert into the Staff block panics naming `Staff`. The first probe landed in Manager because
`LOYALTY_REDEEM` appears in BOTH presets and a plain string replace hit the earlier one — worth
recording, because the mutation I THOUGHT I made and the mutation I made were on different tiers.

**ALSO PINNED 2026-10-25 (round 217), blocker (1): the method CHECK refuses `gift`.**
`payments_method_check_and_gateway_status_constraints_enforced` gained a `gift` arm covering four
spellings (`gift`, `gift_card`, `giftcard`, `gift_cards`). Before it the invalid list held only
`bitcoin`, `cheque`, `stripe_direct`, `CASH` and the empty string, so a migration could have
smuggled a gift member in and left the suite green while silently unblocking a third of this
record.

**WHICH FILE OWNS THE CONSTRAINT IS NOT OBVIOUS, and the first mutation proved it by lying.** The
method list appears in BOTH `20261017_payments_method_check.sql` and
`20261018_gateway_status_adr64_vocabulary.sql`; the later one REBUILDS the `payments` table, so
20261018 is the live definition. Adding `'gift'` to 20261017 left the new assert GREEN — a
mutation whose colour proves nothing unless you check what it targeted. Adding it to 20261018
reddens exactly that assert with the message naming the three-part decision. Both files were
restored, and a stale cargo binary then reported the failure for a further run after the source
was already clean: touching the migration's mtime forced the rebuild. A green or red result is
only as fresh as the binary that produced it.

**WIDENED 2026-10-25 (round 218): the same audit found the HIGHEST-leverage grant unpinned.**
Every tier boundary above is about one key. The global wildcard is the boundary for ALL of them
at once: `grant_matches` (rbac.rs:259) returns true when the grant is `"*"`, for any required
key, so a preset holding it IS a full-access role whatever else it lists. The Owner preset is
exactly that — `permissions: &["*"]` at `rbac_presets.rs:75`, no other key.

Nothing checked it at seed time. `seed_default_roles`
(`crates/kasirmu-core/src/db/staff.rs:72-95`) writes each preset's permission JSON straight to
the roles table with no call to `validate_grant`. The only preset-wide test,
`every_preset_permission_is_registered_and_enforced`, SKIPS `"*"` as "special token, not a
registered key" — so adding the wildcard to the Staff preset would have passed every check in
that file while handing every cashier the whole permission space. `validate_grant`'s
`allow_global` arm guards the other direction (refusing `"*"` when not permitted); nothing
guarded its misuse from inside.

Two tests now hold both directions:
`only_the_owner_preset_carries_the_global_wildcard` (the Owner preset must hold it, every other
preset must not) and `the_owner_preset_grants_the_wildcard_and_nothing_else` (a mixed
`["*", "x"]` preset hides intent — deleting `*` would leave `x` looking deliberate). Both were
mutated rather than assumed: adding `"*"` to the Staff preset panics with `preset 'role-staff'
carries the global wildcard, which makes it a full-access role`, and downgrading Owner to
`&[]` panics twice — `the Owner preset must carry "*"` and `Owner must grant exactly the
wildcard, found []`.
**NARROWED 2026-10-25 (round 202): the settlement-contract decision is made, by precedent.**
`PaymentModal` already redeems loyalty points AFTER `completeSaleScoped` in the same
post-checkout block, from two call sites (`PaymentModal.tsx:1190` direct and `:1834` gateway),
both reading the `saleId` that only exists after the sale commits — so the "there is no saleId
yet" objection in the sibling plan is answered by code that ships today. The failure discipline
is answered too: the redemption is non-blocking for the sale and raises a WARNING toast naming
the leak, and `PaymentModalSaleFlow.test.tsx` drives BOTH paths with the redemption rejected and
asserts the toast appears plus `redeemAttempted` so the case cannot pass on a redemption that
never ran.

The RBAC half also has a ruling, and it is the interesting one: `LOYALTY_REDEEM` is in the STAFF
preset (`rbac_presets.rs:184`) while `GIFTCARDS_REDEEM` is granted to NO preset at all. A cashier
may take money in against a customer's debt or points and may not touch a gift card. **That is a
deliberate asymmetry and it means the RBAC row is not "add it to Staff" — it is "confirm the
asymmetry", which is a yes/no an owner can answer.**

**CORRECTED 2026-10-25 (round 223).** The sentence above used to continue "granted only to
MANAGER/ADMIN/OWNER (`:419`)". `:419` is not a preset line: it is inside `ALL_ENFORCED`, the
constant inventory, which opens at `:340` and whose last PRESET (`Custom`) closes at `:331`.
Measured: `ROLE_PRESETS` holds ZERO gift-card references across all six presets, so the key is
granted to nobody by default. THIS PARAGRAPH IS THE LIKELY ORIGIN of the same misreading in
three other places in this tree (the sibling gift-card plan, `payment-methods-plan.md`, and a
round-217 probe of mine that mutated the wrong migration on the strength of the same habit) —
all four read a line in the inventory as a line in a role. The narrowed question an owner is
asked therefore gets SMALLER, not larger: it was "re-confirm three presets already hold it", and
it is "decide whether any built-in role should hold it, knowing none does today".
`no_builtin_preset_grants_a_giftcard_key` (`permission_registry_tests.rs`) pins the measured
state.

So what remains is what the sibling plan now says: one migration (`payments.method` has no gift
member) plus one settlement decision, and the shape to copy is `PaymentModal.tsx:1190` with its
toast.

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
