# Module-scope collections and caches: four more, all sound (round 104)

## Why this was checked

`pos-module-state-audit.md` (round 103) read the two module-level `let` bindings in
`features/sales` and closed with an explicit caveat: *"a module-scope `Map`/`Set`, a cached
object, or `localStorage` is a different shape and was not swept."* This is that sweep.

## What was found

Nine module-scope `Map`/`Set` bindings under `ui/src/features`; four hold MUTABLE runtime
state (the rest are constant lookup tables the validators iterate).

### 1. `tickerSubscribers` — `features/kds/hooks/useTicketSla.ts:128`

The shared 1 Hz tick every KDS ticket card subscribes to. Add at `:133`, delete at `:141`,
and the interval is stopped when the set empties (`:142`). The hook returns the unsubscribe
directly from its effect (`:225`), so React runs it on unmount and on `createdAt` change:

```ts
useEffect(() => {
  setResult(compute());
  return subscribeToTicker(() => { /* PERF-KDS-01 identity-preserving set */ });
}, [createdAt]);
```

Two details worth noting because they are the ones usually got wrong: the fan-out copies
before iterating (`:137`, *"a subscriber may unsubscribe during the fan-out"*), and the
reducer returns `prev` when nothing displayed changed, so a settled board does not
re-render at 1 Hz.

### 2. `listeners` — `features/sales/hooks/useTabLeases.ts:27`

Add at `:97`, delete at `:148` from the effect's cleanup. Paired.

### 3. `listeners` — `features/settings/nestedModalDepth.ts:9`

Add at `:13`, and the subscribe function RETURNS the delete (`:14`). Paired.

### 4. `failures` / `analyticsDataCache` — `features/analytics/`

`failures` is keyed by the card definitions (a bounded set), deleted on success (`:111`,
`:159`) and globally on refresh (`:38`).

`analyticsDataCache` is the one worth naming: it is a real bounded LRU —
`ANALYTICS_CACHE_MAX_ENTRIES = 200`, MRU promotion on `get`, `evictIfNeeded()` on `set`, and
its own counters (`hits`, `misses`, `expiries`, `sets`, `evictions`) surfaced in
`CacheMetricsPanel`. It has a dedicated test file (`analytics-cache.test.ts`).

## Verdict

**No defect.** Every collection that accumulates pairs its add with a remove, and the one
unbounded-looking cache is a capped LRU with metrics.

## What remains unwatched

The `localStorage` shape. `usePosState`'s draft/lock keys, `useKdsOffline`'s cache, queue
and dead-letter keys, and `retentionMetric`-style counters all persist across sessions.
Round 90 audited the KDS offline layer's BOUNDS (dead-letter growth is bounded by distinct
`(orderId, status)` ids and surfaced in a banner). The POS draft keys were audited for
restore semantics in round 78. What neither covered is whether any of them is store-scoped
— i.e. whether switching stores can read another store's persisted value. That is the next
shape to check, and it is the one with a user-visible consequence.