# A failed sale-detail open was a dead tap — the one read settleRead never covered

**Date:** 2026-10-11 · **Round:** 50 (session) · **Status:** FIXED
**Area:** `ui/src/features/sales/SalesHistoryScreen.tsx` — `openDetail`

## The defect

`openDetail` (`:532-615`) fetches three things in one `Promise.all`: the sale, its refunds,
and its per-line margins. Two of the three already went through `settleRead` — the shared
helper (`ui/src/utils/settle-read.ts`) that keeps a read's FAILURE distinct from its
ANSWER. That distinction exists precisely because a read has three outcomes, not two, and
collapsing the last two turns "we could not ask" into something the screen says out loud.

The **primary** read did not:

```ts
const [sale, refundData, marginData] = await Promise.all([
  sessionToken ? getSaleScoped(sessionToken, id) : getSale(id),   // bare await
  settleRead('refunds', listRefundsScoped(sessionToken!, id)),
  settleRead('sale_line_margins', ...),
]);
// ...
} catch {
  // IPC unavailable.
}
```

When `getSaleScoped` rejects, the **whole Promise.all rejects**, the empty catch drops it,
`detail` stays null, and the modal's render guard (`detailExit.shouldRender && detail`,
:1667) draws nothing at all.

So the cashier taps a row on the sales-history list and the drawer **never opens** — no
skeleton, no message, nothing. Their next move is to tap it again, and again.

`settle-read.ts`'s own doc lists this screen as a consumer — *"the refunds of the open sale
… then the sale's roster, then its per-line cost/margin report"* — and stops one read short
of the one everything else depends on. Two siblings already reported their own failures on
screen (`refundsUnknown`, `marginsUnknown`, each with its own alert and retry); the third
failed silently.

## Fix

1. The primary read goes through `settleRead('sale', …)`, so its failure is a value the
   handler can branch on rather than a throw that takes the other two down with it.
2. On `!saleRead.ok`: clear `detail`, set a new `detailLoadFailed`, and **report** — both a
   toast and a persistent `role="alert"` banner that outlives the toast.
3. The residual `catch` is no longer reachable (all three reads are settled), so it now
   logs and reports rather than being empty — the failure mode it once guarded cannot come
   back accidentally.

New bilingual key `sales-history-detail-load-failed`.

## Evidence

Two new tests:

- **source-level guard** — asserts `settleRead('sale', …)` is present in the component. The
  behaviour is an ABSENCE (no modal, no message), and a render assertion cannot tell that
  apart from "the modal has not opened yet", so the contract is pinned at source.
- **behavioural** — *names the failure when the SALE read throws, and retries*. Rejects
  `getSaleScoped` once, taps View, and requires the persistent banner. Then answers the
  second attempt and requires the detail to open. **RED before the fix** with

  `tapping a sale that failed to load said nothing: expected '' to match /could not…/`.

**Kill-tested** by reverting the primary read to a bare `await`: red again, green on restore.

- `SalesHistoryScreen.test.tsx` **44 passed** (was 43 — the two new tests net +1 pair)
- full UI suite **807 files, 12,812 passed**
- `typecheck` clean · `eslint` clean · `lint:i18n` clean

## Why this one is different from the last four rounds

Rounds 46-49 all found *a mute handler sitting next to one that reports*. This one is the
inverse: **the mute thing is the absence of a rule that was already applied next door.**
There was no second catch to compare against — there was a helper the file imported and used
twice, and the third use just did not use it. The tell was the helper's own documentation
naming this screen as a consumer and listing three reads where the code had two protected
reads and one raw one.

## Related

The same helper guards: `OfflineQueueScreen`, `ShiftManagementScreen` (where a failed read
was inviting the cashier to open a shift that was already open), `useMultiCurrency`,
`AppShell`'s boot reads, `StockTransfersScreen`, `WarehouseCountFlow`, and `boot-retry.ts`.
This finding suggests the remaining `settleRead` consumers are worth auditing for a
primary read left bare — recorded as a follow-up, not done this round.

> last audited 11-10-26 by docs-auditor
