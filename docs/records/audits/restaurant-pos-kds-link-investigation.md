# Restaurant POS ↔ KDS link: found broken in the dev-mock (2026-10-12)

## Status: FIXED in `0e2ddc7ac` — and this file's first conclusion was WRONG

**Read this section before the rest.** The original investigation below blamed a
"module-instance or registration-order problem" and left the item open rather
than guess. That diagnosis was **not correct**, and the way it went wrong is the
useful part:

The probe used `sessionToken: "mock-session-token"`. That string is a
**test-only constant** (`ui/src/test-utils.tsx:12`), not the running app's
session. The call therefore rejected with `{"kind":"invalidSession"}` — a shape
the dev-mock never produces; it comes from the **real Rust bridge**. The probe
was invalid, and I read its failure as evidence about the mock.

Re-tested with a jsdom harness that routes `invoke` through the mock properly
(`ui/src/__tests__/dev-mock-sale-kds-link.test.ts`), the real fault was found in
minutes and is deterministic:

- **The side effect worked all along.** `complete_sale` / `complete_sale_scoped`
  call `pushKdsOrderFromCart`, which mints a `kds-order-e2e-*` order AND its
  line items. Two of the three new tests assert exactly that, and both PASSED
  before any fix.
- **The command was the stub.** `kdsHandlers` answered
  `create_kds_order_from_sale_scoped` with `() => []`. Because
  `registerHandlers` is `Object.assign` and `kdsHandlers` is registered after
  `createSalesHandlers`, that empty stub is what the client received — so the
  POS was told "no orders" about a sale the board was already displaying.

Fix: the handlers now return the sale-derived orders
(`saleDerivedKdsOrders()`, matched on the `kds-order-e2e-` id prefix, newest
first), which is what the real bridge does.

## The original investigation (kept: its evidence was real, its conclusion was not)

## Symptom

Complete a sale on the Restaurant POS, then open the Kitchen Display:
**the board shows `Open 0` and no ticket.** The sale is committed (receipt
prints, cart resets, history records it) — the kitchen simply never sees it.

## Evidence gathered

1. **Product code is correct.** `PaymentModal.tsx:929` calls
   `createKdsOrderFromSaleScoped(sessionToken, saleId)` unconditionally, with a
   comment stating the ORDER is created regardless and only printing is optional.
   Its `catch` logs `'createKdsOrderFromSale failed'` and raises a warning toast.

2. **The mock kernel intends to do this.** Both `complete_sale` (`sales.ts:424`)
   and `complete_sale_scoped` (`sales.ts:472`) call
   `pushKdsOrderFromCart(cartState.lines, 'store-1')`.

3. **The helper is fully implemented** (`tauri-api.ts:88`): it mints a
   `kds-order-e2e-<now>` id, pushes a `pending` order AND seeds course-grouped
   line items into `mockKdsLineItems`, then calls `saveMockKdsState()`.

4. **It never lands.** Reading the persisted state (`localStorage["oz-dev-mock:kds"]`)
   after a real completed sale shows only `kds-order-auto-*` entries from the
   random generator. A search for `kds-order-e2e` in that payload returns
   **false**.

5. **A direct IPC call rejects.** Invoking `list_kds_orders_scoped` through
   `window.__TAURI_INTERNALS__.invoke` from the page rejects with an OBJECT
   (not an Error), i.e. `String(e)` is `[object Object]`. That is consistent
   with the POS's own `catch (kdsErr)` swallowing a non-Error rejection.

## Lead (unproven)

The KDS list handlers (`kdsHandlers`) are registered by
`registerHandlers(kdsDeviceHandlers)` in `tauri-api.ts`, and the sales handlers
by `registerHandlers(createSalesHandlers({ ... pushKdsOrderFromCart }))`. The
suspicion is a **module-instance or registration-order problem**: the
`pushKdsOrderFromCart` closure captured by the sales handlers may not be writing
to the same `mockKdsOrders` array that `list_kds_orders_scoped` reads — or the
invoke rejects before the handler runs at all. Evidence 5 (a rejection rather
than a wrong value) points at the latter: the command may not be resolving.

## How to confirm

Instrument `create_kds_order_from_sale_scoped` with a `console.log` at entry
(before any work) plus a try/catch that logs `e`. Then ring up one sale and read
the WebView console — I already have the CDP recipe for that in the sibling audit
records. That single run distinguishes "handler not reached" from "handler
reached but wrote to the wrong array".

## Why this matters beyond dev

The KDS ticket is how the kitchen learns an order exists. If the same failure
shape can occur against the real bridge (a rejected invoke swallowed by the
warning-toast path), a paid sale could silently produce no kitchen ticket — the
exact scenario `PaymentModal.tsx:943-948` says was already fixed once. Worth
confirming the real path logs and toasts rather than trusting the comment.

## Not fixed in this round, deliberately

Shipping a change here would be a guess. The symptom is documented so the next
pass starts from the narrowed evidence instead of rediscovering it.

> last audited 14-10-26 by docs-auditor
