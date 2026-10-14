# The KDS advance writes correctly and the board does not repaint (round 144)

## What was tried

`e2e-kds-critical-path.spec.ts` has one `test.fixme` — the only test in the suite that
exercises a **status transition** rather than a render. Its skip reason looked stale:

> *Skipped: KDS component refactored — advance mechanism changed from card click to footer
> button with cooldown wrapper. Business logic test needs to be rewritten against the new
> component API.*

The body below already uses the footer button. Verified before enabling:

| Selector | Present at |
|---|---|
| `.kds-status-btn` | `KdsTicketCard.tsx:471` |
| `.kds-column--pending/preparing/ready` | `KdsLayoutMasonry.tsx:74` |
| `.order-no` | `KdsTicketCard` header, `KdsCompletedView.tsx:231` |

So the reason was stale and the test was enabled. **It fails, and locating why is the
finding.**

## The failure, traced step by step

Driven live against the dev server (`npx vite --port 1421`, the port the Playwright config
owns) with the console captured:

```
[tauri] update_kds_status_scoped → started
[TAURI MOCK] invoke: update_kds_status_scoped { id: kds-order-1, status: preparing }
[tauri] update_kds_status_scoped → succeeded (53ms)
PERSISTED_STATUS_of_kds-order-1=preparing
```

| Link | State |
|---|---|
| the click reaches `handleAdvance` | yes — `KdsTicketCard.tsx:272` |
| `update_kds_status_scoped` invoked | yes |
| the write succeeds | yes, 53-66 ms |
| the mock persists it | **yes** — `oz-dev-mock:kds` has `status: 'preparing'` |
| the board repaints | **NO** — `#101` stays in `kds-column--pending` |
| further `list_kds_orders` invokes after the write | **zero** |

Board snapshot before and after the click, identical: `pending=[#101,#104,#107,#110]`,
`preparing=[#102,#105,#108]`.

## What this rules out

The chain was read end to end and each link checked:

* **the data layer is correct** — the persisted slice proves the mutation landed;
* **`sameOrders` cannot be the suppressor** — `kdsOrdersDiff.ts:32` compares `status`, so a
  status change makes it return `false` and `setOrders` replaces the state (`KdsScreen.tsx:182`);
* **the mock's event bridge is symmetric** — `emit` (`tauri-event.ts:124`) and `listen` (`:75`)
  both branch on `hasTauriInternals()` (`:33`), which is `false` in a plain browser, so both use
  the same in-memory `listeners` map;
* **the handler emits** — `kds.ts:584`, inside `update_kds_status_scoped`;
* **the subscription exists** — `useKdsRealtime.ts:99`, wired at `KdsScreen.tsx:213`, and
  `kds/register.tsx:9` mounts `KdsScreen` for the route `AppShell.tsx:357` resolves.

**Zero refetches is therefore the anomaly.** `list_kds_orders` logs through
`mockDispatcher.ts:150` on every invoke, and the counter did not move, so the
`kds:orders-changed` -> `fetchOrders` hop did not fire even though the emit call is on the
executed path.

## NOT fixed, and the state left behind

The test is back to `test.fixme`, with its stale reason **replaced by the measured one** so
the next attempt starts where this one stopped rather than re-deriving the selectors.
Nothing else was changed.

The remaining question is narrow: does the `void emit('kds:orders-changed', null)` in the
mock handler reach the listener registered by `useKdsRealtime`? A one-off probe — call
`emit` from the page and see whether `fetchOrders` runs — would settle it, and it needs a
module handle the page does not expose. That is the next instrument, not more reading.

## Verified

| Gate | Result |
|---|---|
| `e2e-kds-critical-path` | 8 passed, 2 skipped — green again after the restore |
| live write | succeeds and persists (`preparing`) |
| live repaint | none |
| full UI suite | 12,665 passed, 0 failed |