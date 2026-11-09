# The same lie on the other button, and two guards that fail differently — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 137 · status: 1 real defect
     fixed (the mirror of round 136's, in the same component) · branch: 0.0.41 ·
     commit: `dcdc57f15` -->

<!- - Scope: restaurant POS / inventory UI, per the active goal. Opened by re-reading
     the file round 136 had just edited rather than by any checker. -->

## Finding it

Round 136 fixed the End Shift double tap in `ShiftBar.tsx` and left the component. The
Start path sits 15 lines away and reads identically -- `if (!guards) return;` then
`await` -- so the question was whether the backend makes the duplicate harmless there
too. It does not, or rather it does and the UI lies about it anyway:

```rust
// crates/kasirmu-core/src/db/inventory.rs:396-408
let active_count: i64 = tx.query_row(
    "SELECT COUNT(*) FROM inventory_shifts
         WHERE user_id = ?1 AND location_id = ?2 AND status = 'active'", ...)?;
if active_count > 0 {
    return Err(CoreError::Validation { field: "shift", message: "user already has ..." });
}
```

Backed by the partial unique index `idx_inv_shifts_active_per_user_location` on
`(user_id, location_id) WHERE status = 'active'` (`20260813_init.sql:1134`). So a double
submit does **not** open two shifts. But the second call's `Validation` rejection lands in
`handleStartShift`'s `catch` and raises `inv-shift-error-start` — "Failed to start shift"
— for a shift that **did** open, and the operator is left staring at the start form while
their shift is running.

Same defect class, same component, one button over from round 136: **the UI reporting
success as failure because a replay was rejected by a guard the UI does not know about.**

## Two guards, and the kill-tests said something different this time

Round 136 added a ref guard **and** `disabled`, then measured that each halted the second
call on its own — so the double-tap case could not see the attribute, and a separate
`toBeDisabled` case was needed. I expected the same here. It is **not** the same:

| Variant | double-submit call count |
|---|---|
| ref guard removed, `disabled` kept | **RED** (2 calls) |
| `disabled` removed, ref guard kept | green (1 call) |
| both removed | RED (2 calls) |

The asymmetry is the mechanism: a `fireEvent.submit` on the form dispatches regardless of
the submit button's `disabled` state, so the attribute never blocks the second call — the
**ref is the only thing the call-count assertion tests**. On the End path the second event
was a `click` on the button itself, which the attribute does block. Same two defences, same
test shape, opposite result.

So again the `disabled` attribute needed its own case, and again kill-testing proved it
load-bearing (red without it). The two paths now each carry: a call-count case killing the
ref, and a `toBeDisabled` case killing the attribute.

## Evidence

- **Red -> green:** `expected 2 to be 1 // Object.is equality` before the guard; 13/13 pass
  after.
- **Kill-tests:** the three-variant table above, plus a fourth revert removing `disabled`
  alone against its own case. Every revert restored and confirmed **byte-identical** against
  a backup copy.
- **Round 136's lesson applied up front:** the overlap is created with `fireEvent.submit`,
  not `userEvent.click`, because `userEvent` awaits its own `act()` and would flush the
  first call's chain before the second submit — the false green round 136 lost a cycle to.
  The comment in the test says so, so it is not "simplified" back later.
- **Gates:** `npm run lint` PASS (0 errors, 114 warnings — the baseline),
  `npm run typecheck` PASS, `npm run lint:i18n` PASS.
- **Full suite:** 811 passed | 2 failed files; **12,916 passed** (up 2). The 2 failures are
  the unchanged pre-existing cross-lane ones (`nativeDialogCompliance`,
  `noiseDitherCompliance`).

## Why this took a second round rather than being found with the first

Round 136 fixed the one button the checker's output pointed at, and stopped. The lead was
in the file it had open the whole time. A handler's sibling is not reassurance — it is the
next place the same bug lives, and this session has now demonstrated that four times
(rounds 124, 131, 133, 136). Recorded here because the cost was one extra round for a defect
that was one screen-scroll away.

## Carried forward

`handleStartShift` and `handleEndShift` now share a naming convention
(`<verb>PendingRef` + `<verb>Pending`) that a future reader can grep for. The remaining
question for a later round: the same "replay rejected, UI calls it a failure" shape wherever
a create/close path is guarded server-side and unguarded client-side — `CategoryManagement`,
`CustomerManagement` and `ThresholdConfigScreen` all appeared in round 136's candidate
scan and have not been individually read.

> last audited 18-10-26 by docs-auditor
