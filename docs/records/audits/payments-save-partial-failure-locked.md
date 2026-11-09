# RestaurantPaymentsScreen save: partial-batch failure — audited, NO defect, now locked

**Date:** 2026-10-11 · **Round:** 44 (session) · **Status:** VERIFIED SOUND + REGRESSION-GUARDED
**Area:** `ui/src/features/restaurant/screens/RestaurantPaymentsScreen.tsx` — `handleSave`

## The hypothesis

`handleSave` (:741) fans **four independent writes** into one batch (:745-792):

1. `setLocalPaymentMethodsScoped` — the market rails, carrying the operator's toggles
2. `setPaymentGatewayConfigScoped({ gatewayName: 'midtrans' })`
3. `setPaymentGatewayConfigScoped({ gatewayName: 'stripe' })`
4. `hw.save()` — the hardware EDC default, only when `effectiveTerminalId && hw.profile`

They are joined by `await Promise.all(tasks)` (:794). The success branch that follows
(:796-807) clears the dirty baseline (`originalsRef.current = …`), toasts
`restaurant-save-success` and calls `onSaved?.()`.

The suspected hazard was **ordering**. If write 1 lands and write 3 rejects, the rails
change *has already been applied server-side*. A success branch that still ran would leave
the operator with a clean-looking form over a half-applied save, and — the expensive part —
a cleared dirty baseline, so the un-landed Stripe change becomes **unretryable through the
UI**: Save is disabled because nothing reads as dirty any more.

## What the audit found: no defect

I wrote the test first and **it passed on the first run**, which is evidence about the test
before the code, so I chased down why rather than banking the green.

The reason is structural: `Promise.all` rejects on the first failure, so the continuation
after `await` **never executes** on any rejected task. The success branch at :796-807 is
therefore not "the all-succeeded branch by convention" — it is unreachable unless every
task resolved. `originalsRef.current` is only assigned on that path, so the dirty baseline
is correctly left stale on a partial failure and Save stays enabled. The single catch
(:808) shows `settings-save-error` for every failure mode.

Coverage gap, not a bug: every pre-existing save test rejects the **first** task
(`mocks.setMethods.mockRejectedValue` at :587), so the suite never exercised an
earlier-write-succeeded / later-write-failed arrangement. The behaviour was right and
unguarded — one refactor from being wrong.

## The guard

New test in `RestaurantPaymentsScreen.test.tsx`:

> *does NOT clear the dirty flag or claim success when only a LATER write in the batch fails*

It resolves `setMethods` and rejects only the `stripe` gateway write, then asserts:

- `onSaved` **not** called (no false success callback)
- `Settings saved successfully` **absent** (no false toast)
- Save button **still enabled** (the un-landed change is retryable)

## Evidence — kill-tested

The test was proven to be about the code and not about itself by swapping
`Promise.all` → `Promise.allSettled`, which is exactly the shape that would produce the
false success the test forbids:

```
× does NOT clear the dirty flag or claim success when only a LATER write in the batch fails
```

Reverted; suite **49 passed** (was 48).

## Why this is worth recording

F4 and F40 (documented inline above the load effect) show this screen has historically
failed in exactly this family — a swallowed read that left the UI looking clean over bad
state. The difference here is the outcome: the *read* paths were genuinely broken and were
fixed; the *write* batch is correct, and what it lacked was the test that says so. A
record that only lists defects would suggest this path was never examined.

**Not changed:** the four writes stay in one `Promise.all`. All-or-nothing reporting is the
documented behaviour and the operator-visible contract is one toast; what matters is that
"nothing" is reported honestly, which the new test pins.

> last audited 11-10-26 by docs-auditor
