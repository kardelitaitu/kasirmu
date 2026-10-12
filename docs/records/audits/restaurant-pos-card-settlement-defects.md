# Every card payment failed, then settled anyway (2026-10-12)

Found by driving a Card settlement to a receipt in the browser (the gap named in
the two previous rounds). Two separate defects, one root cause behind the first.

## Defect 1 — FIXED: the click event was used as the terminal id

**Symptom.** Pressing "Pay on card terminal" always failed with
"Card payment failed: Something went wrong. Please try again."

**Root cause.** `CardTenderPanel` wires the pay button as
`onClick={onTerminalPay}` (CardTenderPanel.tsx:115), so React invokes
`handleTerminalPay` with a **SyntheticBaseEvent** as its first argument. The
guard was

```ts
const terminalIdToUse = targetTerminalId !== undefined ? targetTerminalId : selectedTerminalId;
```

and an event is `!== undefined`, so the EVENT became the terminal id. The WebView
console showed it plainly:

```
invoke: edc_terminal_status_scoped { ..., terminalId: SyntheticBaseEvent }
failed [unknown] EDC card terminal '[object Object]' not found
```

So pre-flight never reached the terminal. **Every card payment died here.**

**Fix** (`useEdcTenderPhase.ts`): guard on the type, not on undefinedness —
`typeof targetTerminalId === 'string' ? targetTerminalId : null`, then fall back
to the selected terminal. A no-argument call stays valid, which is why the
existing tests passed: they only ever called `handleTerminalPay()`.

**Verified live after the fix:**

```
edc_terminal_status_scoped { terminalId: edc-term-1 } -> succeeded
edc_sale { amountMinor: 45000, currency: IDR, terminalId: edc-term-1 } -> succeeded
```

and the receipt printed `Card Rp 45.000`. **This was the first card settlement
this app has completed in these sessions.**

**Guard**: `useEdcTenderPhase.test.ts` — "ignores the click event React passes
when the pay button is pressed directly". Kill-tested: restoring the
`!== undefined` guard fails it.

## Defect 2 — NOT FIXED, and the dangerous one

Before the fix, that failed card attempt still ended in a **settled sale**:

1. The toast said "Card payment failed".
2. The method was **still `card`**.
3. `[data-testid="settle-button"]` was **still enabled** (`aria-disabled` null).
4. Pressing Complete **settled the sale and printed a receipt recording
   `CARD Rp 45.000`**.

So a cashier whose terminal declines can press Complete and the POS books a card
sale that was never charged — taking the order, printing the receipt, and leaving
the customer with nothing paid.

**Why it was reachable.** `useEdcTenderPhase`'s catch block
(`useEdcTenderPhase.ts:206-217`) resets the overlay and raises a toast, then
returns — control goes back to the tender screen with `method` still `'card'`
and `processing` cleared. Nothing marks the card path as failed, so Complete is
offered again.

**Not fixed here deliberately.** The correct behaviour is a product decision I
should not invent: the options are (a) block Complete after a card failure until
the method changes or the payment is retried, (b) keep Complete but record the
sale as unpaid/pending rather than captured, or (c) both. Each changes what a
declined card does to a real bill. The defect is recorded with its exact
reproduction so that decision can be made explicitly.

Note the contrast with the intended design: `settleGatewaySale(..., false, ...)`
passes `voidOnFinalizeFailure = false` precisely "a local finalize fault must
not void a PAID sale" (line 197-199). The code is careful about a PAID sale; the
unpaid path has no equivalent guard.

## How to reproduce defect 2

1. Restaurant POS, add any item, Charge.
2. Choose Card. Press "Pay on card terminal" and let it fail.
3. Observe the failure toast, the method still Card, and Complete still enabled.
4. Press Complete — a receipt prints with the method recorded as CARD.
