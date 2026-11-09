# Resume stole the lease before the warning could be shown (round 298)

## Applying round 297's lesson systematically

Round 297 found that a guard added to a shared handler propagates to every caller, and
concluded the general rule: *"when a refusal is added, list the callers and ask of each whether
refusing is the right answer THERE."* This round turned that into a sweep — every guard these
sessions have touched, and every caller of each.

Most came back clean. The shift-availability guard, for instance, is threaded through four call
sites consistently via refs (`PosScreen.tsx:614`, `:681`, `:696`, `usePosCartActions.ts:140`) and
already has a file pinning the direction. One did not.

## The defect

`usePosHeldCarts.handleResumeOpenBill` ended with:

```tsx
setActiveOpenBillId(id);
await claimLease(id, data.tableNumber);      // <-- unconditional
```

`claimLease` writes the lease with **this** terminal's id. `getConflict` discards any lease whose
terminal is the current one (`useTabLeases.ts:197`). So the sequence was:

1. operator resumes a tab another terminal is working on
2. `setActiveOpenBillId(id)` runs
3. `claimLease` overwrites the foreign lease with ours
4. `CartPanel` evaluates `getConflict(activeOpenBillId)` — **null**, because the lease now looks
   like ours

The warning banner and its Take Over button (`pos-cart-conflict-alert`, `CartPanel.tsx:776`)
**could never appear on the one path they exist for.** Two waitstaff edit one table's order with
nothing on screen to say so — which is precisely the failure the whole lease subsystem was built
to prevent. The machinery, the banner, the Take Over button and `e2e/restaurant-tab-conflict.spec.ts`
were all present and working; the resume path simply walked past them.

## The fix

`getConflict(id)` is checked **before** anything is claimed. Refusing to claim is what leaves the
foreign lease intact — the precondition for the banner ever rendering. The refusal names the other
terminal, because a waiter who cannot open a tab needs to know **who** to go and ask.

The Take Over button stays for its original case (the resume is done and the flag is raised
afterwards). Same escape hatch, now with a second entry point that reaches it.

New string, both bundles:

> { $terminal } is working on this tab. Ask them to finish, or use Take Over on the tab.

## Two tests, and one of them is the "both directions" rule again

| Case | Asserts |
|---|---|
| a foreign lease | the lease **survives** the resume, and the refusal names the holder |
| no lease | the resume still happens — no toast, `getHeldCartScoped` called |

The second is the over-correction guard. A fix that blocked every resume would be the same class
of defect as the one being fixed: a waiter unable to open any tab.

The refusal is asserted through the **echo-stub l10n** the file already uses, so the assertion is
on the KEY — a silent refusal, or a reversion to a hardcoded literal, fails the case rather than
passing quietly.

## ⚠️ A test-writing trap worth recording

The first draft seeded the foreign lease by calling `claimLease` from a second hook instance. That
is **not foreign**: both instances read the same `currentTerminalId`, so it is self-ownership and
`getConflict` correctly returns null. The first draft failed for that reason, and the failure was
a fact about the test, not the code.

`useTabLeases.test.ts` already had the right mechanism — dispatch
`kasirmu:tabs:lease-acquired` with another terminal's id, which is also how a real second terminal
announces itself. Adopting it made the case valid: the seeding-registered conflict is now asserted
(`expect(before).not.toBeNull()`) before the resume is measured, so the test cannot pass vacuously
on a seed that did nothing.

**A test that fails must be read before it is believed** — the same lesson as round 9's test that
asserted the defect, from the opposite side.

## Kill-tested

Disabling the guard (`false && getConflict(id)`):

```
Tests  1 failed | 1 passed (2)
```

The conflict case fails; the free-tab case is unaffected — the discrimination the pair is for.
Re-verified after every subsequent edit, then restored.

## Verified

| Item | Result |
|---|---|
| New lease cases | **2 passed** |
| Kill-test (guard disabled) | **1 failed / 1 passed**, re-verified after later edits |
| `restaurant-tab-conflict` + `restaurant-tables-tab-conflict` e2e | **4 passed** (desktop + tablet) |
| `usePosHeldCarts` original suite | **13 passed** — the change does not disturb the existing paths |
| POS / restaurant / payment / tab suites | **1182 passed, 85 files, 0 failed** |
| `npm run typecheck` | exit 0 |
| eslint | 0 |
| `lint-i18n.sh` | no issues |
| pre-commit FTL checks | 1 key added (1 en / 1 id), 0 stranded, 0 one-sided |
| Commits | `e044c7d06` (fix) + `9fa633190` (tests) |

## Round 10 was interrupted, and this round finished it

The previous round left a proven failing test and a half-applied fix (only the `getConflict`
destructure). Resuming found the test still red against the live code, which is the correct state
to pick up from: the reproduction outlived the session boundary and confirmed the defect was still
real before any fix was attempted.

## What this says about the lease subsystem

Everything except the resume path honoured the lease: `CartPanel` renders the warning,
`TableManagementScreen` checks before takeover, the hook exposes `getConflict` to both. The
subsystem was not missing a guard — **one caller of it skipped the check**, and it happened to be
the busiest one. That is the round-297 shape exactly, one layer over: not a missing guard, a caller
that does not consult it.

> last audited 15-10-26 by docs-auditor
