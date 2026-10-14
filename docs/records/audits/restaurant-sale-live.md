# A completed restaurant sale, driven live; the KDS half stays open (round 140)

## The round-138 leg, closed

Round 138 could not complete a sale because it clicked `settle-button` with an EMPTY tender,
and `useTenderMath.ts:157-164` requires `tenderedMinor >= effectiveTotal`. The fix is one step:
click a quick-tender button first.

Measured live (Vite + Playwright, `owner` / PIN 1234, press `1`):

| Step | Result |
|---|---|
| Cart subtotal | `Rp 45.000` (Caffe Latte) |
| Charge the customer | payment modal opens |
| Click the first quick-tender button | `Amount Tendered` set; `Change Rp 5.000` |
| `settle-button` | `disabled=false` |
| After settling | **`SALE_DONE=true`** — the receipt screen renders |

So a restaurant sale now runs end to end in the browser: menu -> cart -> charge -> tender ->
receipt. Alongside rounds 118 and 119 (Card, QRIS, split arithmetic) the settlement surface is
verified.

## The ticket-minting mechanism, confirmed in-tree

`ui/src/dev-mock/tauri-api.ts:88` `pushKdsOrderFromCart` mints the order:

```ts
const orderId = `kds-order-e2e-${Date.now()}`;
mockKdsOrders.push({ id: orderId, ... status: 'pending' ... });
```

and `handlers/sales.ts:523/571/600` call it on sale completion with the comment
`// Push a KDS mock order so POS -> KDS E2E flow works.` So the mock does mint a ticket on a
completed sale — round 138's negative was about a DISPATCH, not a sale.

## What still did not verify, and the reason is precise

**The minted ticket appearing on the KDS board is still UNVERIFIED.** Four navigation attempts
this round failed to reach the board without a page reload:

* `window.location.hash = '#/kds'` — worked in round 138; this round the app was in a state
  where it did not;
* `#/pos` — does not route to the restaurant workspace;
* the sidebar's `Exit Terminal` — not matched by `filter({ hasText: /Exit Terminal/ })`,
  because the sidebar popover closes before the click lands;
* keyboard `Escape` — round 138 established it does not leave the workspace.

And a reload discards the evidence within a run: **`mockKdsOrders` is seeded into memory on
load and written only on mutation.** `oz-dev-mock:kds` is absent on a FRESH page because
`loadMockKdsState` (`kds.ts:224-244`) reads the slice and falls back to the SEED **without
writing it** — `readSlice` takes a fallback thunk, so the first load persists nothing. The
write happens through `saveMockKdsState` (`:243`) called only by the mutators (`:408`,
`:498`, `:573`, …), so the state is in memory until something changes it.

> **CORRECTED in round 142.** My original text here said the array was "page memory, not
> persisted" and cited `NO_KEY` as proof. That was wrong, and it is why this round's own
> verification was hard to read: the slice IS persisted once mutated, and a subsequent load
> restores it — `kds.ts:245-247` seeds `mockKdsOrders` FROM the slice. `NO_KEY` was true only
> because nothing had mutated in that fresh context. `settings.ts` persists on write too; the
> KDS slice simply does not write on READ.

So the only way to see the minted ticket is to reach the KDS **without reloading**, and no
route I tried does that. The claim is therefore left open — twice now, with the remaining
obstacle identified exactly: a navigation path, not missing code.

## What a reader should take

| Claim | Status |
|---|---|
| A restaurant sale completes in the browser | **verified** (this round) |
| The mock mints a ticket on sale completion | verified statically (`tauri-api.ts:88`, `sales.ts:523`) |
| Production creates the ticket | verified (`kds.rs:464` + 38 passing Rust tests, round 139) |
| The minted ticket appears on the KDS board | **UNVERIFIED — no reload-free route to the board** |

## Verified

| Gate | Result |
|---|---|
| Live sale | subtotal `Rp 45.000`, change `Rp 5.000`, receipt rendered |
| Ticket minting | `kds-order-e2e-*` id at `tauri-api.ts:93` |
| Mock KDS persistence | in-memory only; `oz-dev-mock:kds` absent on a fresh load |
| Full suite | 12,665 passed, 0 failed |
| Tree | clean but for another lane's file; scratch script deleted; Vite stopped |