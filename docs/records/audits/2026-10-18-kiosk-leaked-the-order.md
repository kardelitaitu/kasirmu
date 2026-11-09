# The kiosk handed customer A's order to customer B — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 108 · status: 1 defect fixed ·
     branch: 0.0.41 · commit: `12359b542` -->

<!- - Scope: the self-service kiosk — a CUSTOMER-FACING surface with no staff in the
     loop, and one this campaign had not executed. Tree verified green at 813/813
     (12,899 passed) going in. -->

## The defect

`resetIdle` cleared only the `idle` flag. `setCart([])` and `setCheckout(false)`
existed on the **Pay** handler alone (:138-139), so an order abandoned at the attract
screen survived into the next customer's session:

1. Customer A adds items, taps Checkout, walks away.
2. 60 s pass; the attract screen appears.
3. Customer B taps "Tap to start" — `idle` goes false and **`checkout` is still true**,
   so B lands on A's checkout total, reads A's items, and can tap **Pay**.

**Measured:** with the Pay button visible before the timeout, it was still visible after
B's tap. This is a customer-facing device, and the order it leaked belongs to someone
else.

**Fixed** by giving idling-out one meaning — "session over" — and routing both the mount
timer and every `resetIdle` through a single `endSession` that drops the cart, the
checkout step and the flag. Any per-session state belongs to that session, so there is
exactly one place to drop it.

## Why the existing idle tests could not see it

`KioskScreen.test.tsx` already had `shows attract screen after idle timeout` and
`exits attract screen on click`. **Both start from an empty cart and no checkout.** The
state that matters — idling out WITH an order in flight — is the one nothing constructed,
so both passed against the defect.

Same shape as rounds 100-101: a guard exists, and its construction cannot reach the bug.

## Three test-harness errors of my own, recorded

The case took four drafts, and each failure was mine rather than the code's:

1. **Fake timers enabled too late.** The mount effect and every `resetIdle` install
   their timer with whatever `setTimeout` is current *at that moment*. Clicks under real
   timers left a real timer pending, so `advanceTimersByTime` had nothing of its own to
   fire — measured, checkout was still up after advancing 61 s. `useFakeTimers()` has to
   come first, and interactions after it must use `fireEvent` (userEvent installs its own
   scheduling).
2. **An invented assertion.** I asserted "Cart is empty", a string this screen does not
   have — it renders the cart region only when the cart is non-empty (:209). The correct
   check is the region's absence.
3. **`vi.useRealTimers()` after the assertions.** When the case failed it left fake timers
   installed and **broke the seven cases below it**. Moved into a `finally`; a test that
   fails loudly is fine, one that poisons its neighbours is not.

## Verification

- **Full suite: 813/813 files, 12,900 passed, 0 failed** (3 skipped, 3 todo).
- The case fails pre-fix on the Pay button surviving, and passes after; **kill test**
  restores the old `resetIdle` and fails it; file restored byte-identical.
- All 14 pre-existing kiosk cases still pass.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean.

## Standing rule

> An idle timeout is a SESSION BOUNDARY, so every per-session value belongs to it — not
> just the flag that names it. And when a surface already has a test for the timeout,
> check what state that test starts from: a guard whose construction cannot reach the bug
> reads exactly like coverage.

> last audited 18-10-26 by autonomous-goal-round-108
