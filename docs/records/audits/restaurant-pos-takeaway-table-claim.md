# A takeaway order could claim a table (2026-10-12)

Found while driving the order-type controls in the browser — the surface I had
audited for accessible NAMES but never for BEHAVIOUR.

## The defect

The cart panel renders the **Table number** field for the restaurant POS on
**every** order type. Its comment says that is deliberate
(`CartPanel.tsx:855-862`: table capture "does not depend on a setting"), and that
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
that the FIELD being unconditional is deliberate (CartPanel.tsx:855-862) — it is
each READER that has to apply the order-type rule.

## Fourth site: the DISPLAY half (`547bf031d`)

The three fixes above stop a stray table number DOING damage. None of them
stopped it being SHOWN. The cart panel renders the table name in its active-tab
banner with no order-type check:

```tsx
// CartPanel.tsx:669 — before this fix
{tableNumber ? `Table ${bareTableNumber(tableNumber)}` : ''}
```

So after switching Dine-In -> Takeaway the cashier still read **"Table 12"** on a
takeaway order, and the field was still offered. Measured in jsdom: the banner's
text was `"Table 12Active Tab"` for a takeaway.

The field itself is deliberately unconditional — the cart offers it for the
restaurant POS on every order type (CartPanel.tsx:855-862, "does not depend on a
setting"), and that is a reasonable choice. It is each READER that owes the rule.

Fixed with a single `showTableForOrder = orderType === 'dine_in' && !!tableNumber`
predicate used by both the table name and its `(customer)` suffix, so the banner
cannot half-render.

**Guard**: CartPanel.test — "shows a table name for a dine-in order" and "does
NOT show a table name for a takeaway or delivery order" (both non-dine-in types).
Kill-tested: reverting the predicate fails the second.

## Four sites, one reading of the same field

| Site | What a stray table number did |
|---|---|
| PaymentModal claim (`206462b4d`) | attached a real table to the sale |
| PosScreen release (`035d1d01b`) | freed that table on completion |
| PaymentModal open bill (`795fc18d4`) | wrote it into the saved tab |
| CartPanel banner (`547bf031d`) | displayed it as this order's table |

Three were damage; the fourth was a lie to the cashier. All four are the same
mistake: reading a field whose MEANING is order-type-dependent as though it were
unconditional.

## A negative result worth recording

`guestCount` (pax) is written into the same held-cart payloads
(`PosScreen.tsx:818`, `usePosHeldCarts.ts:199`) with no order-type check either.
It was **not** fixed, because it is harmless: `grep guestCount crates/` returns
nothing — the backend never reads it, so it is opaque cart data that cannot
corrupt a table, a ledger or a receipt. Recording the decision so a later pass
does not "fix" it by symmetry with the table cases.

## Coordinate re-verified (2026-10-11, docs-auditor)

The comment this record quotes — table capture "does not depend on a setting" — is still in
`CartPanel.tsx`, but it is at **`:855-862`**, not `:735-743`. It did not change or get deleted:
the DISPLAY fix in this very record (`547bf031d`) added the active-tab banner **above** the
table-number field, pushing the field and its comment down by 120 lines. The three citations
above were repointed to the live coordinate; the original `:735-743` was a correct reading of
the revision the record measured.

Everything else in this record was re-derived at HEAD and holds: all four guard sites
(`PaymentModal.tsx:922`, `:1469`, `:1212`, `PosScreen.tsx:766`) carry the `orderType === 'dine_in'`
condition with the comments this record quotes; `showTableForOrder` is at `CartPanel.tsx:458`;
`heldCartLabel` is at `features/sales/utils/tableLabel.ts:64`; all four named guard tests exist with
their exact titles; and the negative claim about `guestCount` still holds — `grep guestCount crates/`
returns **0** hits, so it remains opaque cart data on the backend.

## Not verified live

The browser pass that found this could not be repeated after the fix — the Vite
dev server went down mid-round and restarting it is not something to do
unprompted. The jsdom test and the kill-test both pass, and the guard is a
one-clause condition over a value the component already reads, so the fix is not
in doubt; a live re-run is simply the stronger confirmation and is outstanding.
