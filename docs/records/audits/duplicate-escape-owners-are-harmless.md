# Twelve dialogs close twice per Escape — and it does not matter

**Round 35 · 2026-10-11 · POS surfaces · duplicate Escape owners**

Round 33 moved Escape ownership from the overlay to `useFocusTrap` in `ShiftModals`,
because two closers would double-fire. This round asked where else that shape exists.

## The find

`RetailModals.tsx` has **12 dialogs**, and every one has both:

```tsx
useFocusTrap(openShiftPanelRef, ..., () => shift.openShiftExit.requestClose());  // :215
onKeyDown={(e) => { if (e.key === 'Escape') shift.openShiftExit.requestClose(); }} // :239
```

The trap listens on `document`; the overlay's keydown bubbles to that same listener, so
**one Escape press calls `requestClose` twice** on all 12. `PaymentModal.tsx:1663` +
`:2567` (the customer-search modal) is the same shape.

By round 33's reasoning this should be a defect. It is not, and the reason is one line of
the hook:

```ts
const requestClose = useCallback(() => {
  if (exiting) return; // already closing
  setExiting(true);
}, [exiting]);
```

**Measured, not assumed** — three rapid calls on the hook produced `onCloseCalls= 1`.

I also checked the one way a duplicate *could* bite: if the overlay's Escape branch did
more than close, its side effect would run twice. All 12 branches call **only**
`requestClose()` — grep for branches with more than one statement returns **0** — and
`PaymentModal`'s duplicate is a plain `setShowCustomerSearch(false)`, a React setter.
Harmless.

This is the distinction round 33 acted on, worth stating plainly: there, the overlay
branch also ran `setCloseShiftError(null)`, so the duplicate had an observable second
effect. Here it has none.

## What was worth keeping

The negatives rest on one unstated invariant: **`requestClose` closes exactly once however
many times it is called.** Nothing pinned it — `useExitAnimation.test.ts` called it once
per case. Two cases were added to that file: three same-tick calls fire `onClose` once, and
a duplicate arriving mid-fade does not restart the timer.

## The kill-test that did not fire — and what it taught

Both new cases **stayed green with `if (exiting) return;` deleted.** They are not testing
the guard, because React makes it redundant here: a repeated `setExiting(true)` bails out
of re-rendering, so the exit effect still runs once. I probed two further shapes (calls
separated by `act()`, and a reopen during the fade) and both also held at 1.

So the guard is **defensive, not load-bearing**, and the test header now says exactly that
rather than implying the cases protect it:

```
These cases pin the BEHAVIOUR, not the `if (exiting) return` guard - measured:
removing that guard leaves them GREEN ...
```

## Verification

| Check | Result |
|---|---|
| 3 same-tick `requestClose` calls | `onClose` **once** |
| guard removed, all probes | still 1 — guard is redundant |
| `useExitAnimation.test.ts` | **14 passed** (12 existing + 2 new) |
| dependent-surface sweep (7 files) | **149 passed** |
| ESLint / typecheck | **0 errors** / clean |

## Method notes

- **The same shape is not the same defect.** Rounds 33 and 35 found identical
  duplicate-Escape structures; one had an extra side effect and one did not. The
  difference was inside the branch, not in the pattern.
- **A kill-test that does not fire is a finding about the test.** I could have shipped two
  green cases claiming to guard idempotence. The honest version records that React makes
  the guard redundant and the cases pin behaviour instead — still worth having, because
  nothing else asserted the contract those 12 dialogs rely on.
- Reading `requestClose` before treating 12 dialogs as broken is the whole round: the grep
  found the pattern, and the hook decided whether it mattered.

> last audited 16-10-26 by docs-auditor
