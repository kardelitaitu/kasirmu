# The double-tap test that hid the defect — and the one that exposed it — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 139 · status: 1 real defect
     fixed (double safe drop), found only after TWO test shapes failed to find it ·
     branch: 0.0.41 · commit: `b0fbea9b6` -->

<!- - Scope: restaurant POS / cash shifts, per the active goal. Opened from round 138's
     carried-forward list: the ~14 screens guarded only by `loading={saving}`. -->

## Round 138's own claim was untested, and this round is what testing it cost

Round 138 closed by asserting those screens are "correct everywhere it appears so far."
That was read off line shapes, not measured. Testing it found the opposite.

`ShiftManagementScreen` has three handlers — open, close, payout — all sharing **one**
`saving` flag with **no in-flight guard**:

```ts
const handleCreatePayout = useCallback(async () => {
  if (!activeShift) return;
  ...
  setSaving(true);
  try { await createCashPayoutScoped(...); }
```

The only protection is `loading={saving}` on the button, which makes `Button` compute
`isDisabled` (`components/Button.tsx:72`). And **the backend does not protect this one**:

- core's compare-and-set refuses a payout only against a **closed** shift —
  `WHERE EXISTS (SELECT 1 FROM shifts WHERE id = ?2 AND status = 'open')`
  (`crates/kasirmu-core/src/db/cash_payouts.rs:60-73`) — so two concurrent payouts
  against an **open** shift BOTH succeed;
- `CashPayout::new` mints a fresh `uuid::Uuid::now_v7()` per call
  (`crates/kasirmu-core/src/cash_payout.rs:35`);
- the unique index covers only the id.

Two submits therefore store **two identical safe drops**: the drawer is short by double the
removal, and no reconciliation later can tell which row was the duplicate. This is strictly
worse than rounds 136-137, where the server refused the replay and only the toast lied.

## Three test shapes, two of which were false greens

This is the part worth recording. The first two shapes both passed and both were wrong.

**Shape 1 — `user.click` twice.** Passed. Round 136's lesson already said `userEvent` awaits
its own `act()` and flushes the chain, so the first call settles before the second click.
Useless.

**Shape 2 — two sequential `fireEvent.click`s.** Passed. Measured: `calls=1 disabled=true`
after the first click. `fireEvent` wraps **each** dispatch in its own `act()`, so React
COMMITS `setSaving(true)` between them and the second click lands on a disabled button.
**This reads exactly like a working guard, and it is not one.**

**Shape 3 — both clicks inside ONE `act()` batch.** `calls=2`. Red, as it must be. A
genuine double tap is two dispatches in one task, before React can re-render; that is the
shape that has to be tested.

```ts
const confirmBtn = screen.getByRole('button', { name: 'Record Payout' });
await act(async () => {
  fireEvent.click(confirmBtn);
  confirmBtn.removeAttribute('disabled');   // the DOM flag is not yet authoritative
  fireEvent.click(confirmBtn);
});
```

The `removeAttribute` is not a hack — it is the point. Without it the second dispatch is
refused by a flag React has not yet made authoritative, which is precisely the state a real
double tap does not have to wait for. **A guard that a test cannot observe is not a guard**,
and the previous two shapes could not observe it.

**The generalisation: rounds 136 and 137 both "fixed" a defect using the shape-2 test, which
cannot see a same-task race at all. Their fixes (ref guards) are correct, but their tests
were weaker than they looked. Every re-entry test from here should use shape 3.**

## Two of the three handlers were already safe, and I say so

I first guarded all three siblings. Then checked the backend and corrected my own premise
in the shipped comments:

- **open**: `idx_shifts_open_per_user` (`20261011_open_shift_uniqueness.sql`) holds one
  open row per user and `open_shift` counts before inserting — already refused.
- **close**: `UPDATE shifts SET ... WHERE id = ?14` with **no status predicate**
  (`crates/kasirmu-core/src/db/shifts.rs:312-319`) — a replay **overwrites the same row**
  rather than creating a second one. Idempotent by construction.
- **payout**: the real defect.

So the two sibling guards are **defence-in-depth that removes a redundant round trip and the
error the replay would raise**, not fixes for live defects. Only the payout guard fixes a
defect. The comments in the shipped file say exactly that, so a later reader does not
inherit this round's initial overclaim.

## Evidence

- **Red -> green:** shape 3 gives `expected 2 to be 1` before the guard; 23/23 pass after.
- **Kill-test:** `if (payoutPendingRef.current) return;` removed -> red `expected 2 to 1`;
  restored and confirmed **byte-identical** against a backup.
- **Gates:** `npm run lint` PASS (0 errors, 114 warnings — the baseline),
  `npm run typecheck` PASS, `featureCommentPaths` PASS.
- **Full suite:** 811 passed | 2 failed files; **12,918 passed** (up 1). The 2 failures are
  the unchanged pre-existing cross-lane ones (`nativeDialogCompliance`,
  `noiseDitherCompliance`).

## Carried forward

The strongest carry-forward is methodological, and it is a correction to my own work: every
`loading={saving}`-only screen on a **non-idempotent** create needs the same-task double
dispatch test, and every existing re-entry test in this repo was written in shape 2. The
remaining sites from round 138's list — `ProductManagementScreen`,
`PurchaseOrderForm`, `StockCountForm`, `WarehouseCountFlow`, `InventoryAdjustmentScreen`,
`LoyaltyManagementScreen`, `TaxConfigurationScreen` — are the candidates, and the payout
was the only one of its group proven broken.

> last audited 18-10-26 by docs-auditor
