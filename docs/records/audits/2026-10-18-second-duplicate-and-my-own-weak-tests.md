# Round 139's lesson applied to my own tests, and it found a second duplicate — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 140 · status: 1 real defect
     fixed (duplicate customer), plus my own rounds 136-137 tests strengthened ·
     branch: 0.0.41 · commit: `6aab51f6f` -->

<!- - Scope: restaurant POS / customers, per the active goal. Opened from round 139's
     carry-forward list of `loading={saving}`-only screens. -->

## First: round 139's lesson turned on my own tests

Round 139 concluded that sequential `fireEvent` cannot see a same-task race, and that
**rounds 136 and 137 both used that shape**. Before auditing anything new I re-ran their
tests in shape 3 — both dispatches inside one `act()` batch — to find out whether the
**production guards I had shipped were actually correct**, or whether I had declared a fix
that a competent test would still fail.

They hold. Removing both ref guards makes both upgraded cases red; restoring returns them
to green, byte-identical. So rounds 136/137 fixed real defects with correct guards — their
tests were simply too weak to *prove* it, which is a different (and less severe) failure
than shipping a broken guard. Recorded as a commit of its own (`60864a5e5`) because a
weak test on a correct fix is still a latent hole: the next person to touch that code has
no signal that the guard matters.

## Then: the same hunt, and a second real duplicate

Round 139's filter was not "does a UUID get minted" — that matches ~150 call sites and
tells you nothing. The filter that matters is **whether the create has any dedupe at all**,
and it sorts the candidates into two very different classes:

- **Backend refuses the replay** → the double tap is cosmetic (a false error). ShiftBar's
  open/close (rounds 136-137), `products` (`sku TEXT NOT NULL UNIQUE`,
  `20260813_init.sql:441`).
- **No dedupe, no unique constraint** → the double tap **stores a duplicate row**. Cash
  payouts (round 139) and **customers**.

`CustomerManagementScreen.handleSave` was in the second class:

```ts
const handleSave = useCallback(async () => {
  ...validate...
  setSaving(true);            // <-- no in-flight guard before this
  try { await createCustomerScoped(sessionToken, args); }
```

and core is defenceless:

```rust
// crates/kasirmu-core/src/db/customers.rs:228-243
let id = uuid::Uuid::now_v7().to_string();
self.conn.execute("INSERT INTO customers (id, name, email, phone, notes, ...) VALUES (...)")?;
```

No unique constraint on `name`. Two submits therefore store **two customers with the same
name and the same loyalty ledger** — and unlike a duplicate payout, a duplicate customer is
silently invisible: nothing reconciles the customer list against a drawer, so both rows
persist and both accumulate points.

Shape 3 confirms it: `expected 2 to be 1`. Fixed with a `savePendingRef` guard in the
handler, released in `finally`.

## A note on method, since this round was about method

The grep that found this was not "find `loading={saving}`" — that was round 138's mistake,
and it produced two refuted suspicions because a line shape says nothing about the server.
The grep that works is over the **backend create**: mint-UUID + unconditional INSERT + no
unique constraint. That is a short, checkable list, and it is what separated
`products` (safe, UNIQUE sku) from `customers` (unsafe) in one pass instead of one
audit round per screen.

## Evidence

- **Round 136/137 guards re-verified in shape 3:** removing both ref guards turns both
  upgraded cases red; restored byte-identical from a backup.
- **New defect red -> green:** `expected 2 to be 1` before the guard; 37/37 customer tests
  pass after.
- **Kill-test:** `if (savePendingRef.current) return;` removed -> red; restored
  byte-identical.
- **Gates:** `npm run lint` PASS (0 errors, 114 warnings — baseline; one transient failure
  came from running lint and typecheck concurrently against the same ESLint cache, and a
  clean re-run confirmed 0 errors), `npm run typecheck` PASS, `npm run lint:i18n` PASS,
  `featureCommentPaths` PASS.
- **Full suite:** 811 passed | 2 failed files; **12,919 passed** (up 1). The 2 failures are
  the unchanged pre-existing cross-lane ones (`nativeDialogCompliance`,
  `noiseDitherCompliance`).

## Carried forward

The backend-side filter is now the tool, and it has one obvious remaining hit: the
`loading={saving}` screens whose create mints a UUID with no dedupe. `gift_cards`,
`memos`, `loyalty`, `purchase_orders`, `suppliers`, `stock_transfers`,
`receipt_formats` all mint in `db/`, and each needs the same two-line check (is there a
unique constraint? does the bridge refuse a replay?) before anyone touches the UI. The
`PromotionManagement` path was already measured and is protected only by the button's
`loading` prop — correct, but pinned by exactly one test.

> last audited 18-10-26 by docs-auditor
