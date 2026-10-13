# Restaurant POS: what rounds 72-73 measured clean (2026-10-13)

## Why this note exists

Rounds 72-73 audited five classes on the restaurant-POS surface and found no defect in
four of them. A negative result that is not recorded gets re-derived, and the next
reader spends a round reaching the same conclusion. Each row below says what was
measured and what the measurement does NOT cover.

## The classes

| Class | Measured | Verdict |
|---|---|---|
| Refund allocation rounding | swept the invariant the doc comment claims, 36k + 110k combinations | correct, and now pinned by `refundAllocationInvariant.test.ts` |
| i18n on POS screens (plan F10) | 11 raw-English candidates across PaymentModal / PosScreen; all are the 3-arg `getString(key, null, 'fallback')` idiom, comments, or ISO country codes | clean |
| Fallback keys resolve | every one of the 23 `getString(…, null, …)` sites has its key defined in a bundle | clean — the fallback is genuinely a fallback |
| Fire-and-forget writes | 5 in `features/restaurant`; the two destructive ones discard the promise, not the reporting | clean — their `try/catch` toasts on every path |
| Tauri event subscriptions | 2 `listen(` call sites in the whole feature tree; both unlisten | clean |
| Tablet vs desktop CSS scoping | 3 viewport-width `@media` (all in `responsive.css`), 25 `html[data-shell='tablet']` sites | correct by design |

## What each row does NOT say

**i18n.** The sweep looked for raw English in JSX and `message:` properties. It did not
check that a *rendered* string is the right one for the locale — that needs the
bundles loaded, which `i18nBundle.test.tsx` and `lint-i18n.sh` already gate.

**Fire-and-forget.** Five sites in `restaurant/` only. `payment/` has more than one and
the verdict there is the same shape (round 41: `printKitchenChits` is deliberately
loud-but-non-fatal), but it was not re-swept line by line.

**Event subscriptions.** Two callers measured, both clean. A subscription added through
`useEffect` without `listen` — e.g. a raw `addEventListener` — is outside this count;
`tableActionTokenGuardReports`-style guards do not cover that shape yet.

**CSS scoping.** Counting selectors says the mechanism is used. It does not say every
tablet-only rule uses it — a width-query mistake inside a component sheet would not
appear in `theme/`.

## The refund row is the odd one

It is listed as clean because the CODE is correct, but it started as a suspected defect.
The doc comment on `RefundModal.lineShare` claims a property ("prorating the line total
and rounding ONCE cannot over-refund"), two fixtures pinned it, and no test evaluated
the claim as a property. That gap is now closed, which is the useful part: the next
person who edits that function has a 36,000-case sweep to satisfy rather than two
hand-picked examples.

# Re-verify with: cd ui && npx vitest run refundAllocationInvariant.test.ts i18nBundle.test.tsx
#               lint-i18n.sh; and grep for `listen(` in ui/src/features

