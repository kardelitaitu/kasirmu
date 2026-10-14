# The restaurant kitchen dispatch, driven live (round 137)

## What was verified

Vite + Playwright, `owner` / PIN 1234, press `1` for Restaurant POS.

| Step | Result |
|---|---|
| Send to Kitchen with an EMPTY cart / no table | **absent** (`count=0`) |
| after typing a table number | **appears** (`count=1`) |
| after clicking it | the cart line shows `Sent`; the header reads `Table T5` and `Active Tab`; `Charge` becomes `Update Tab` |

The gate is `CartActionBar.tsx:190`:

```tsx
{hasLines && (Boolean(tableNumber?.trim()) || Boolean(activeOpenBillId)) && hasUndispatchedItems && (
```

So the button requires a table or an open bill, which is correct for a restaurant: a kitchen
ticket is about a table. And dispatch is not the ONLY route — `usePosHeldCarts.ts:213`
computes `shouldDispatch = dispatchOnTabSave !== false`, so **Save Tab** dispatches without a
table, which covers a takeaway or counter order. Two routes, each for a case.

## The KDS board is live and richly populated

The Kitchen Display workspace renders 10 open orders (`#101`-#`110`) with station groups
(`0/2 MAIN`, `0/1 BEVERAGE`), SLA timers, statuses (PENDING / PREPARING / READY / SERVED),
RUSH markers, and real modifier state (`2x Nasi Goreng Spesial`, `Pedas level 2`,
`+ EXTRA SAMBAL`).

## What I could NOT verify, and why it should not be claimed

**That a dispatch from the POS creates a ticket on the KDS board is UNVERIFIED.** Four
attempts to chain the two in one browser context all failed at the navigation step — the
Escape key does not leave the restaurant workspace, so the `3` keystroke landed inside the POS
and the KDS board never mounted (`KDS_TICKETS=` came back empty).

An earlier run produced `HAS_T5=true` and `HAS_LATTE=true` and looked like proof of the chain.
**It was a false positive.** A seeded ticket `#102 | T5` already exists on the board holding
`Ayam Bakar Madu` + `Soto Ayam` — nothing to do with my Caffe Latte — and the later
`HAS_T77` reading matched the cart line on the POS screen, not a ticket. Both claims would
have been wrong, and the seed data is what makes them plausible.

To close the chain properly: navigate POS -> KDS through the workspace picker
(`selectWorkspace`, as `ui/e2e/helpers.ts:87` does) rather than the keyboard, or drive it as a
Playwright SPEC against the same dev server. Recorded as the method to use, not as done.

## Verified

| Item | Result |
|---|---|
| Kitchen button gate | correct: absent without a table, present with one |
| Dispatch side effect | line shows `Sent`; header shows the table and Active Tab |
| Save Tab route | `shouldDispatch` at `usePosHeldCarts.ts:213`, no table needed |
| KDS board | live, 10 orders, stations and statuses |
| POS -> KDS chain | **NOT verified**; see above |
| Tree | clean but for another lane's file; scratch script deleted; Vite stopped |