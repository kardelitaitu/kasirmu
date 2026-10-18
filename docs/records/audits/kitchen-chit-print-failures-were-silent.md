# The kitchen never got the ticket: three silent chit-print failures

**Round 36 · 2026-10-11 · restaurant POS · kitchen/bar dispatch**

Axis shift this round: from modals and keyboard handling to the **order lifecycle**, where
a reliability failure costs the most — a station that never learns about an order.

## The tell

`PaymentModal.tsx` has two adjacent failure catches doing the same job differently:

```tsx
// :778  publishCourseFired failed
console.error('publishCourseFired failed', fireErr);
addToast({ message: requiredLocalized(l10nRef.current, 'payment-toast-kds-failed'), type: 'warning' });

// :800  printKdsChitScoped failed
console.error('printKdsChitScoped failed', order.id, chitErr);   // console ONLY
```

The second one's comment argued console was the right place. But the sibling 20 lines above
disagrees, and the situation is worse: the sale has already completed, so a chit that never
printed means **the kitchen has no ticket and the cashier has no idea**. `payment-toast-kds-
failed` already exists in both bundles with exactly the right words — *"Payment succeeded,
but the kitchen ticket could not be created — notify the kitchen manually"*.

Measured, with a rejected `printKdsChitScoped` and the sale otherwise succeeding:

```
AssertionError: a failed kitchen chit printed nothing the cashier can see:
  expected '' to match /kitchen/i
```

## The same defect, twice more, on the dispatch path

Grepping for `console.error|console.warn` without an `addToast` nearby found 8 more sites.
Two matter most — `PosScreen.handleDispatchKitchenDelta`:

```tsx
} catch (printErr) {
  console.warn('Kitchen chit printing failed/unavailable (non-fatal):', printErr);
}                                    // :1061 — and addToast was ALREADY in the dep array
```

The same for the bar chit at `:1077`. `addToast` appears in the callback's dependency list
(`:1085`), so the intent was there and the call was simply never written. This is the
dispatch path — where the order is actually sent — so it is arguably the more important of
the three.

**Fixed all three**, with two new localized strings so the operator knows *which* station is
missing its ticket rather than a generic failure:

```
pos-toast-kitchen-print-failed = The order was sent, but the kitchen ticket did not print - check the printer
pos-toast-bar-print-failed     = The order was sent, but the bar ticket did not print - check the printer
```

Both added to EN and ID; `npm run lint:i18n` reports no issues.

## A latent flaw in the guard I extended

`PosScreenKitchenBarRouting.test.ts` is a source-text guard, and its `dispatchBody()` sliced
a fixed `+ 3500` characters. **Measured: the handler spans 3982.** The bar chit catch sat 482
characters past the window, so my first assertion against it matched nothing and failed for
the wrong reason. Re-bounded on the next top-level declaration instead, which cannot drift.

## Verification

| Check | Result |
|---|---|
| chit toasts removed (kill-test, PaymentModal) | -> **red** |
| both POS toasts removed (kill-test) | -> **red**, both cases |
| `PosScreenKitchenBarRouting.test.ts` | **5 passed** (2 new) |
| `PaymentModalSaleFlow.test.tsx` | **63 passed** (1 new) |
| wide POS + i18n sweep (6 files) | **141 passed**, 1 skipped |
| ESLint / typecheck / `lint:i18n` | **clean** |

Typecheck caught one more thing the test run could not: my chained mock passed a second
argument to a mock typed `(cmd: string) => …`. Third round running that `tsc` found something
`vitest` was happy with.

## Still open, recorded

Six `console.error`-only sites remain, none on the dispatch path:
`PaymentModal:379` (credit settings load), `:985` and `:1550` (assign table to order),
`:1457` (cash drawer auto-kick), `StockShortfallDialog:272` and `:386`. The drawer one is
interesting — `pos-toast-drawer-unconfirmed` already exists for a related case — but each
needs its own read of whether the failure is operator-actionable before adding noise.

## Method notes

- **Adjacent catches doing the same job differently is the strongest tell in this codebase.**
  The inconsistency itself is the evidence — one of the two is wrong, and the sibling's
  existence removes any argument that the quieter one is a deliberate style.
- **A pre-existing guard can be silently blind.** The 3500-char slice was written before the
  bar branch existed and was never re-measured. Extending a source-text guard is a good
  moment to check that its window still covers what it claims.
- `addToast` in a dependency array with no `addToast` call is a fossil of intent — worth
  grepping for when auditing a handler.

> last audited 16-10-26 by docs-auditor
