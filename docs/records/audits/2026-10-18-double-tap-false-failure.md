# A passing test that proved nothing, and the defect it hid — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 136 · status: 1 real defect
     fixed, preceded by a FALSE GREEN from my own first test · branch: 0.0.41 ·
     commit: `b245189b6` -->

<!- - Scope: restaurant POS / inventory UI, per the active goal. Run after round 135,
     which closed by naming its own follow-up: re-run the post-await closure checker
     across the tree. -->

## The checker lane is exhausted — so I widened the net

Round 135's stated follow-up was to re-run `check-state-closure-after-await.py`. It now
reports **0 candidates**; its two round-135 hits were the whole set. Every other Python
checker was then run: `check-tz-invariance` (5 zones x 13 files, 424 passed, identical),
`check-mapper-alignment` (819 .rs files, clean), `check-merged-lines` (1555 files, clean),
`check-replay-fork`, `check-chokepoints`, `check-ftl-attrs` (5603 messages),
`check-client-type-drift` (54 schemas), `check-gate-runners` (121 gates). **All exit 0.**

So the defect was not found by a checker. Reading the checker's own docstring named its
structural limit — it matches only a setter's **argument**. A stale state read after an
`await` that feeds an awaited IPC call is invisible to it. A throwaway scanner over that
gap produced 114 candidates; nearly all were correct-by-construction (`editTarget`,
`revising` are set synchronously with the row being acted on). One was not.

## The defect

`ShiftBar.tsx` `handleEndShift` awaited a transactions read **before** writing:

```ts
const filtered = await listInventoryTransactionsForShift(sessionToken, activeShift.location_id, since);
await endInventoryShift(sessionToken, activeShift.id);   // :174
```

No re-entry guard, and the End button carried no `disabled`. A double tap sent **two**
`endInventoryShift` calls. Core settles the severity
(`crates/kasirmu-core/src/db/inventory.rs:434`):

```sql
UPDATE inventory_shifts SET ended_at = ?1, status = 'ended', updated_at = ?2
 WHERE id = ?3 AND status = 'active'
```

`updated == 0` returns `NotFound`. So the shift is **not** closed twice — but the replay's
rejection lands in `handleEndShift`'s `catch`, which raises the ERROR toast
`inv-shift-error-end` ("Failed to end shift") **on an operation that succeeded**. The
operator is told the close failed while it worked, and the summary modal that should have
appeared is replaced by that message. Same re-entry class as `useAutoQr.handleAutoReissue`
(round 124) and `usePosHeldCarts.handleOpenBill` (round 126).

## My first test was a false green — and this is the round's real lesson

The first version tapped twice with `user.click` and **passed**. A passing test is a
finding about the CLAIM, not the code, so I instrumented it:

```
[probe] after 1st click: calls=1 firstStillPending=false
```

`userEvent.click` awaits its own `act()`, which flushes the pending promise chain. By the
second tap the first `endInventoryShift` had already **settled**, `activeShift` was
`null`, and the early return — not any guard — was doing the work. **The test could not
create the overlap it claimed to test.** Swapping to `fireEvent` (which does not await)
made it red: `expected 2 to be 1`. A real double tap is two DOM events in one tick, which
is what `fireEvent` models.

The comment in the shipped test records this, so the next reader does not "simplify" it
back to `user.click` and silently lose the coverage.

## Kill-tests found something I did not expect

Two independent defences were added: a synchronous `endShiftPendingRef` guard, and
`disabled={endShiftPending}` on the button. Removing **either one alone** leaves the
double-tap case green:

| Variant | Double-tap case |
|---|---|
| ref guard removed, `disabled` kept | **green** |
| `disabled` removed, ref guard kept | **green** |
| both removed | red |

So each halts the second *call* on its own — which means the double-tap test **cannot see
the `disabled` attribute at all**. Removing `disabled` would have left every case green.
That is why a second case was added asserting the button `toBeDisabled()` while the end is
in flight and back to enabled after release; kill-tested, it is load-bearing (red without
`disabled`). Two defences, two tests, each killing its own half.

## Evidence

- **Red -> green:** `expected 2 to be 1 // Object.is equality` before the guard; 11/11 pass
  after.
- **Kill-tests:** four separate reverts, each restored and confirmed **byte-identical**
  against a backup copy.
- **Mock hygiene:** the first run of the new case leaked `mockRejectedValueOnce` into a
  later case, because `vi.clearAllMocks()` clears CALLS and not implementations. Caught by
  running the whole file rather than the single case; fixed with an explicit
  `mockReset()` + `mockResolvedValue(undefined)` at the end of the case.
- **Gates:** `npm run lint` PASS (0 errors, 114 warnings — the baseline),
  `npm run typecheck` PASS, `npm run lint:i18n` PASS.
- **Full suite:** 811 passed | 2 failed files; **12,914 passed** (up 2, the new cases).
  The 2 failures are the unchanged pre-existing cross-lane ones
  (`nativeDialogCompliance`, `noiseDitherCompliance`) — neither mine, neither regressed.

## Carried forward

The throwaway gap scanner was **deleted, not committed** — its 114 candidates were 113 parts
noise and committing it would have added a checker nobody can act on. The reusable part is
the method, not the script: the closure checker's docstring states its own blind spot, and
reading a tool's stated limits is what located this defect after every checker came back
clean.

> last audited 18-10-26 by docs-auditor
