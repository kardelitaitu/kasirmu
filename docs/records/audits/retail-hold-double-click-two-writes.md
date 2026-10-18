# A double-click on Hold issued two hold writes for one sale

**Date:** 2026-10-11 · **Round:** 57 (session) · **Status:** FIXED
**Area:** `ui/src/features/retail/RetailPosScreen.tsx` — `handleHold`

## The defect

`handleHold` (:1302) had **no re-entry guard** — no in-flight flag, no ref, no cooldown.
It is reachable from two places that both allow a fast repeat:

- the Hold/Resume function-bar button (`RetailFnBar.tsx:69`), which is `disabled` only
  when the cart is **empty**;
- the F4 hotkey (:1587), whose guards cover overlays and typing but not re-entry.

A DOM `disabled` cannot save it either: **React does not re-render between two clicks
that land inside one `await`**, so both handlers run and both issue `holdCartScoped`.
The result was two held carts for one sale — a duplicate tab the cashier then has to
find and delete, and a cart that can be resumed twice.

Note the failure is entirely silent: both holds succeed, so nothing is reported.

## Fix

A `holdingRef` in-flight guard, the same shape `usePosHeldCarts` and `useAutoQr` already
use. Released in a `finally`, so a second press landing mid-await is **dropped**, not
queued — a queue would still produce the duplicate, just later.

## Evidence

**RED before the fix**, with the duplicate counted exactly:

```
AssertionError: a double-click on Hold issued more than one hold write:
  expected 2 to be 1
```

**Kill-tested** by removing the two guard lines — `2 to 1` again, green on restore.

- `RetailPosScreenInteractions.test.tsx` **49 passed** (was 47 — two new)
- full UI suite **807 files, 12,824 passed**
- `typecheck` clean · `eslint` no new findings

## Two things the test had to get right

**The two presses must be synchronous.** A first attempt used two `userEvent.keyboard`
F4 presses; it passed *before* the fix, because `userEvent` awaits between keystrokes and
the first hold had already completed — flipping `heldCartId`, so the second F4 became a
*resume*. That test was worthless. The real race is two `fireEvent.click` calls with no
`await` between them, and the mock is gated on a never-resolving promise so the handler is
provably still inside its `await` when the second click lands.

**The cart must not be empty.** On the shared default it is, and `handleHold` returns at
its first line — so a test would pass on zero writes either way. The neighbouring hold
case in the same file documents this exact trap (:749-751); both new tests seed a line
through `createUsePosStateMock`.

## How this was found

A new class: **async write handlers with no re-entry guard.** The first sweep returned
`0 of 0 handlers`, which by the standard from rounds 51-54 means the detector is wrong,
not that the code is clean. It was — the regex required `useCallback\s*\(\s*async` while
the real syntax is `useCallback(async () => {`. Validating it against a known handler
showed the pattern matching nothing. Fixed, the sweep found **159 async write handlers,
72 guarded and 87 not**.

`handleHold` was the one confirmed by test. The other 86 are not all defects — most are
guarded at the DOM level, are reads rather than writes, or are reached through a modal
that closes on success. Narrowing that set to genuinely reachable double-invocations is
the natural next sweep, and is recorded rather than claimed done here.

## Related

- `multistore-set-primary-delete-silent-failure.md` (56),
  `barcode-lookup-failure-was-silent.md` (48) — the same "operator not told" family. This
  one is worse because nothing appears to fail at all: the duplicate is created
  successfully and silently.

> last audited 11-10-26 by docs-auditor
