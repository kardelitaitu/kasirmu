# A takeaway order could claim a table (2026-10-12)

Found while driving the order-type controls in the browser — the surface I had
audited for accessible NAMES but never for BEHAVIOUR.

## The defect

The cart panel renders the **Table number** field for the restaurant POS on
**every** order type. Its comment says that is deliberate
(`CartPanel.tsx:735-743`: table capture "does not depend on a setting"), and that
is fine on its own.

What was not fine is that the table CLAIM did not check the order type either:

```ts
// PaymentModal.tsx, in BOTH checkout paths
if (sessionToken && tableNumber) {          // <- truthy alone
  const tbls = await listTablesScoped(sessionToken);
  const match = tbls.find(...);
  if (match) await assignTableOrderScoped(sessionToken, match.id, saleResult.saleId);
}
```

So ringing up a **Takeaway** with a number left in that field filed a real table
claim. Captured from the live console:

```
complete_sale_scoped      { sessionToken: mock-session-… }
list_tables_scoped        { sessionToken: mock-session-…, section: null }
assign_table_order_scoped { sessionToken: mock-session-…, tableId: table-01, saleId: mock-sale-… }
```

and `PosScreen.tsx:713-728` then RELEASES that table on completion
(`if (tableNumber && sessionToken) … releaseTableScoped`). A takeaway sale could
therefore take an occupied table and free it — corrupting the floor plan's
occupancy for an order that has no table at all.

## The fix — `206462b4d`

Both assignment sites now guard on `orderType === 'dine_in'`. `orderType` was
already a prop of `PaymentModal` (default `'dine_in'`), so nothing new had to be
threaded through.

**Both sites mattered.** The block is duplicated: line ~912 on the cash/QRIS path
and ~1421 on the card/terminal path. Fixing only one would have left the defect
reachable by switching tender.

**A lint warning caught a second, real problem.** Adding `orderType` to the
callback made `react-hooks/exhaustive-deps` report it missing from the dependency
array — a genuine stale-closure bug: without it, a cashier who switched
Dine-In → Takeaway after mount would still take the dine-in branch and claim a
table. Fixed by adding the dep (not by suppressing the warning).

## Guards

`PaymentModalSaleFlow.test.tsx` — "does NOT assign a table when the order is
takeaway or delivery", driven for both order types, asserting the sale STILL
completes while **no** `assign_table_order_scoped` call is made. Kill-tested:
removing the guard fails it.

## Not verified live

The browser pass that found this could not be repeated after the fix — the Vite
dev server went down mid-round and restarting it is not something to do
unprompted. The jsdom test and the kill-test both pass, and the guard is a
one-clause condition over a value the component already reads, so the fix is not
in doubt; a live re-run is simply the stronger confirmation and is outstanding.
