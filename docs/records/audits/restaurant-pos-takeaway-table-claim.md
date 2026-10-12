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

## The fix was only HALF of it — the release path (`035d1d01b`)

The claim fix was incomplete, and following the same `tableNumber` guard across
the codebase is what showed it. `PosScreen.tsx:713` had the mirror-image:

```ts
// Release table if the completed order/bill had one
if (tableNumber && sessionToken) {   // <- order type ignored, exactly as before
  ... if (match && (occupied || reserved)) return releaseTableScoped(sessionToken, match.id);
}
```

So blocking the CLAIM alone still left the RELEASE wide open: a **Takeaway** with
a number left in the Table field would free whatever table that number resolved
to, including an occupied one it had never claimed. Blocking one half of a
claim/release pair does not fix the pair.

Fixed with the same `orderType === 'dine_in'` condition, and `orderType` added to
the completion callback's dependency array — it is read by the guard, so leaving
it out is a stale closure where a cashier switching Dine-In -> Takeaway after
mount still frees the table.

**Guards**: `PosScreenTableReleaseOrderType.test.ts` — three cases: the release
guard requires dine-in; the CLAIM and RELEASE guards must not disagree (the
asymmetry was the bug); and `orderType` must be a declared dependency.
Kill-tested both ways: removing the condition fails case 1, dropping the dep
fails case 3.

**Why source-level for the release.** Driving PosScreen's completion handler needs
the whole checkout (shift, receipt settings, a PaymentModal round-trip), whose
harness is PosScreen.integration.test.tsx. The claim half has a real behavioural
test in PaymentModalSaleFlow; the release half is pinned by the source guard plus
its two kill-tests. Stated so the weaker evidence is not mistaken for the stronger.

## Third site: the OPEN BILL payload (`795fc18d4`)

Tracing the same `tableNumber` reads found one more, on a different path:

```ts
// PaymentModal.tsx, the open_bill branch of `complete`
const trimmedName = customerName.trim();
const trimmedTable = (tableNumber ?? '').trim();   // order type not consulted
```

`trimmedTable` is written into BOTH the saved `cart_data` and the tab's label
(:1194, :1202). Measured for a takeaway open bill:

```json
{"lines":[…],"discountPercent":0,"tableNumber":"T99","orderType":"takeaway"}
```

— a persisted record that contradicts itself, and the label outlives the screen
(the open-bill list is where an operator reads it back).

Fixed with the same dine-in condition, on the same reasoning: an **open bill is a
table's running tab**, so a takeaway has no table to name. With no table the label
falls back to the customer name (via `heldCartLabel`, tableLabel.ts:64), which is
what a takeaway tab should be identified by.

**Guard**: PaymentModalSaleFlow — "does NOT persist a table number on an OPEN BILL
that is not dine-in", asserting both the `cart_data` and the label, and that the
tab is still usable by customer name. Kill-tested: restoring the unguarded
`trimmedTable` fails it.

### Three sites, one reading of the same field

| Site | What it did with a stray table number |
|---|---|
| PaymentModal claim (`206462b4d`) | attached a real table to the sale |
| PosScreen release (`035d1d01b`) | freed that table on completion |
| PaymentModal open bill (`795fc18d4`) | wrote it into the saved tab |

All three read `tableNumber` as though it were meaningful on every order type,
because the cart panel offers the field on every order type. Worth remembering
that the FIELD being unconditional is deliberate (CartPanel.tsx:735-743) — it is
each READER that has to apply the order-type rule.

## Not verified live

The browser pass that found this could not be repeated after the fix — the Vite
dev server went down mid-round and restarting it is not something to do
unprompted. The jsdom test and the kill-test both pass, and the guard is a
one-clause condition over a value the component already reads, so the fix is not
in doubt; a live re-run is simply the stronger confirmation and is outstanding.
