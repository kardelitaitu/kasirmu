# Production module-level state in the POS: three audits, no defect (round 103)

## Why this was checked

Rounds 88-102 found six mechanisms by which MOCK state leaked between tests. The
production analogue is module-level mutable state — a value that outlives the component
that set it. `features/sales` has exactly two such bindings, and both were read in full.

## 1. `memoryLeases` (`hooks/useTabLeases.ts:26`) — SOUND

```ts
let memoryLeases: Record<string, TabLease> = {};   // "shared across components in one window"
```

The concurrency lease that stops two terminals editing one tab. Written from five paths
(the Tauri `tabs:lease-acquired`/`-released` listeners, two DOM events, and `claimLease`),
and **pruned by expiry only** — never by store:

```ts
for (const [id, lease] of Object.entries(memoryLeases)) {
  if (lease.expiresAt > now) valid[id] = lease;   // no store check
}
```

So a store switch keeps the PREVIOUS store's leases in memory for up to 60s
(`TAB_LEASE_DURATION_MS`). That looked like the leak shape.

**It is not reachable.** The map is keyed by `tabId`, and every read is
`getConflict(someId)` — a direct lookup, never an enumeration. The three consumers are:

| Consumer | Read |
|---|---|
| `TableManagementScreen.tsx:1010` | `getConflict(activeBill.id)` |
| `CartPanel.tsx:440` | `getConflict(activeOpenBillId)` |
| `usePosHeldCarts.ts:392` | `claimLease(id, …)` |

`tabId` is a held-cart / bill id from the store database, so it is globally unique and a
leftover entry for another store's tab is never looked up. `getConflict` also returns
`null` for the current terminal's own lease (`:199`), so it cannot warn against itself.

## 2. `nextLineId` (`usePosState.ts:5`) — SOUND

```ts
let nextLineId = 0;
`)` `line-${Date.now()}-${nextLineId++}` `as LineId`
```

A monotonic counter combined with a timestamp, so ids stay unique across remounts and
across stores. Nothing resets it, which is what makes it correct.

## 3. The conflict banner does not gate actions — BY DESIGN

`conflictLease` in `TableManagementScreen` is used only to render the
`tables-warning-banner` (`role="alert"`) with its terminal name and a **Take Over Tab**
button (`:1024-1035`). It is not consulted by any destructive handler.

That is a deliberate warning-not-lock design: `forceTakeover` is the sanctioned path, and
the banner tells the operator who else is on the tab before they take it.

## What this does NOT cover

Only module-level `let`/`var` bindings in `features/sales`. State that outlives a component
by other means — a module-scope `Map`/`Set`, a cached object, or `localStorage` — is a
different shape and was not swept. The KDS offline layer (`hooks/useKdsOffline.ts`) holds
both a cache and a queue in storage and was audited in round 90 for its bounds, not for
store-scoping.