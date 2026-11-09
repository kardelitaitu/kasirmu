# Analytics crashed on open: a mock returned an object where the contract declares an array

**Date:** 2026-10-16
**Scope:** `ui/src/dev-mock/handlers/analytics.ts`,
`ui/src/features/analytics/analytics-data.ts`.
**Verdict:** a real crash, reproduced and fixed. This is the first defect this session found by
driving the UI rather than by a red test — and no test covered it.

## The symptom

Opening **Analytics** from the admin tool card took the screen to its error boundary:

    Something went wrong
    rows.reduce is not a function
    [Try Again]

Because the boundary had replaced the screen, the screen's own `.analytics-back-btn` was gone
too, and `AppShell`'s Escape-to-picker handler was not installed (Analytics reached this way
has no active workspace, and the handler returns early on `!active`, `AppShell.tsx:61`). So
the crash also removed both ways out — the screen looked like a dead end, which is what drew
me to it.

## Root cause, traced to the contract

`RefundsCard.tsx:35` calls `rows.reduce(...)`, and the loader is typed as an array by every
declaration that owns the fact:

| Owner | Declaration |
|---|---|
| TypeScript API | `getVoidedSalesSummary(...): Promise<VoidedSummaryRow[]>` — `api/reports.ts:330` |
| The row type | `VoidedSummaryRow { currency, void_count, void_total_minor }`, documented "one row per currency (REP-06)" |
| Rust backend | `voided_sales_summary(...) -> Result<Vec<VoidedSummaryRow>>` — `kasirmu-core/.../sales_summary.rs:239` |
| Rust test | `voided_sales_summary_groups_by_currency` asserts `rows.len() == 2` across USD + IDR |
| Card comment | "voided totals arrive as one row per currency" |

Only the dev-mock disagreed:

    'get_voided_sales_summary_scoped': () => ({ void_count: 23, void_total_minor: 5400000 }),

A bare **object**, with no `currency`, so `rows.reduce` threw on open.

## The second half: a guard fitted to the bug

`CARD_PAYLOAD_VALIDATORS` exists to reject a payload whose shape has drifted, and it said:

    refunds: isRecord,

— the object container. So the one guard in a position to catch this had been written to match
the mock rather than the declared type, and therefore accepted exactly the payload the card
cannot consume. **A guard fitted to a bug cannot catch that bug.**

## Fix, and why both halves matter

1. **The mock** now returns `VoidedSummaryRow[]` with two currencies, so the card's
   per-currency join (`rows.map(r => fmtIn(...)).join(' · ')`) is genuinely exercised.
2. **The validator** is now `Array.isArray`, matching the container the card requires.

Kill tests, each reverted then restored:

| Reverted | Result |
|---|---|
| The mock back to an object (validator fixed) | **No crash** — the validator rejects the malformed payload, the card shows its loading state. Degrades instead of breaking. |
| **Both** halves reverted | **The original crash returns exactly**: `boundary: 1`, `rows.reduce is not a function` |

The first row is the interesting one and is recorded rather than glossed: with only the
validator fixed, a bad payload is *contained* rather than *reported*. The mock fix is the one
that restores the screen; the validator fix is what makes future drift non-fatal.

## Verified after fix

`boundary: 0`, `.analytics` root present, **`.analytics-back-btn` present** (it was absent
only because the boundary had replaced the screen), no page errors.

## Why no test caught it

`AnalyticsScreen.test.tsx` mocks `getVoidedSalesSummary` to return `[]` (line 230's factory),
which is a valid array — the test never sees the mock's real shape. The gap is between the
unit test's stub and the dev-mock's data, and nothing graded the dev-mock handler against the
declared return type.

## Gates

`tsc --noEmit` clean, `lint` 0 errors, `npm run test` **817 files / 13,012 passing**.
Committed `0dcbaacea`.

> last audited 16-10-26 by docs-auditor
