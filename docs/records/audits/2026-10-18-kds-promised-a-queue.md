# The KDS told the cook a queue existed — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 105 · status: 1 defect fixed,
     1 guard extended from "is it reported" to "is it TRUE" · branch: 0.0.41 ·
     commit: `b2f157208` -->

<!- - Scope: the KDS per-item status advance, executed rather than read. Tree verified
     green at 813/813 (12,896 passed) going in. -->

## The defect

`KdsScreen.advanceItemStatus` — the cook tapping "this dish is done" — reports a failed
write with `kds-offline-queued-update`:

```
kds-offline-queued-update = Update queued — will sync when online
```

**Nothing is queued, and nothing ever retries it.** The item path cannot use the offline
queue at all: `PendingKdsAction` is keyed on `(orderId, targetStatus)`
(`useKdsOffline.ts:59-65`) with no item-level action type. The catch's own comment above
concedes exactly that — and then raises a string promising the opposite.

**A false reassurance is worse than silence.** A cook who reads "queued, will sync" stops
worrying; the dish is never marked done and no retry exists. The earlier fix in this area
replaced silence with a report — correct, and it stopped one step short of asking whether
the report was accurate.

**The sibling had it right.** `ExpoScreen.advanceItemStatus` (:321) raises
`kds-error-update-failed` — "Failed to update the order — try again" — for the identical
situation. KdsScreen now uses that string, so this does not introduce a second wording
either.

## Why the existing guard could not catch it

`kdsItemStatusFailureIsReported.test.ts` is a careful file: it walks each
`updateKdsLineItemStatusScoped` call, brace-matches to its own catch, strips comments, and
requires a `setError`/`setActionError`/`addToast`. Its own comment names the mechanism —
*"KdsScreen via wrapUpdate's kds-offline-queued-update banner"* — as though the string were
incidental.

It pins that a failure is **REPORTED**. It never asks whether the report is **TRUE**, which
is the difference between "the operator is told something" and "the operator is told
something that happened".

**Extended, not replaced.** The new case walks the same catches and rejects a string whose
promise the code cannot keep. Kill-tested: restoring `kds-offline-queued-update` fails it.

## The generalisation

Twelve rounds of this campaign have fixed *silent* failures — a swallowed catch, an ignored
return value, a refusal nobody reports. This is the next class up: a **loud but false**
failure. The guard pattern that catches it is to assert on the message's *claim*, not its
presence — and it only became visible by reading the catch's own comment, which said the
queue could not carry the action, next to a string saying it had.

## Verification

- **Full suite: 813/813 files, 12,897 passed, 0 failed** (3 skipped, 3 todo).
- The new case fails pre-fix on `KdsScreen.tsx` and passes after; **kill test** restores
  the failure; file restored byte-identical.
- `kds-error-update-failed` resolves in BOTH bundles (verified before use).
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean.

## Standing rule

> A guard on a failure path usually checks that SOMETHING was reported. The stronger
> question is whether what was reported is true. Where a code path cannot do the thing its
> message promises — here, queue an item-level retry — the message is the defect, and it is
> invisible to every test that only asserts a report exists.

> last audited 18-10-26 by autonomous-goal-round-105
