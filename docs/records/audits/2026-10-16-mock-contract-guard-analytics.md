# Closing the mock/contract gap that shipped the Analytics crash

**Date:** 2026-10-16
**Scope:** new guard `ui/src/__tests__/dev-mock-analytics-shape.test.ts`.
**Result:** 23 analytics readers pinned. No new product defect found — the surface conforms.

## The gap

The Analytics crash of the previous round came through a hole the existing
`dev-mock-dto-conformance.test.ts` already names in its own header:

> The mock registry is typed `(args: unknown) => unknown`, so nothing checks that a handler
> answers the shape its consumer declares.

That file covers **7 commands** on the setup/auth surfaces. The dev-mock answers **581**. The
analytics surface — where the crash landed — was not among them.

## The guard

Each entry names a raw reader from `api/reports.ts` and the **container** its declared return
type uses (`Promise<X[]>` -> array, `Promise<X>` -> object). The runtime compares the
container the mock actually answers.

## Why it tests the RAW api and not the card loader — measured, not assumed

The first version drove `CARD_LOADERS` and asserted each payload passed
`CARD_PAYLOAD_VALIDATORS`. It passed **17/17 with the refunds defect restored** — vacuous.

The reason is structural: `CARD_LOADERS` are *transformers*. `loadRevenue` builds a fresh
`Bucket[]` by zero-filling the range, so a loader cannot return a payload its own validator
rejects. Testing that layer can never detect a raw-payload drift. The raw call is the layer
where the mock's answer is still visible, and the rewritten version fails against the defect
(the kill test below) instead of passing.

This is the third time in the session that a newly written check was vacuous on first draft,
and the third time running the kill test caught it.

## Kill test

`get_voided_sales_summary_scoped` restored to its object form:

    × 'getVoidedSalesSummary'
    AssertionError: getVoidedSalesSummary declares Promise<X[]> but the dev-mock answered
      object: {"units_sold":1280,...}

**Exactly 1 of 23 fails — the one the guard exists for.** The other 22 stay green, so the test
discriminates rather than failing wholesale.

## Two of my own case-list entries were wrong, and were corrected rather than filed

| Wrong entry | Truth |
|---|---|
| `getInventoryTurnover` marked `array` | It declares `Promise<InventoryTurnoverRow>` — an **object** — and takes a 4th `locationId` arg. The mock was right. |
| `getCategoryTrend` | No such export; the reader is `getCategoryPopularityTrend`. |

Both were flagged BY the guard before anything was reported as a product defect. That is the
intended order: a new check's first failures are at least as likely to be its own bugs, so each
is verified against the declaration before being called a finding.

## Typecheck note

`tsc --noEmit` caught three wrong argument counts that **vitest silently accepted** —
`getTopProducts` needs `(from, to, limit, token)`, `getCategoryPopularity` takes the token
FIRST, and `getCategoryPopularityTrend` needs a granularity. Vitest does not typecheck; a
passing test run is not evidence that the test call sites are well-formed. This is the third
arity defect of the session found that way.

## Verified surface

23 readers, all conforming: daily/weekly/monthly revenue, top products, category popularity,
category popularity trend, category forecast, hourly heatmap, low-stock alerts, category
breakdown, payment-method breakdown, voided sales summary, voided items, basket size, basket
trend, customer split, discounts summary, inventory turnover, inventory trend, table turnover,
hourly occupancy, menu engineering.

## Gates

`tsc --noEmit` clean, `lint` 0 errors, `npm run test` **818 files / 13,035 passing / 0 failed**.
Committed `66e956c48`.

> last audited 16-10-26 by docs-auditor
