# The KDS lifecycle test is reactivated, and the board is a masonry (round 145)

## What was found

Round 144 enabled this test, watched it fail, and reported *"the write succeeds, the board
does not repaint"*. That diagnosis was **half wrong**, and correcting it is what let the
test pass.

**The board is a MASONRY, not three status buckets.** `KdsLayoutMasonry.tsx:53-60`:

```ts
const columns = useMemo(() => {
  const count = 3;
  const cols: KdsOrder[][] = Array.from({ length: count }, () => []);
  orders.forEach((o, i) => {
    cols[i % count]!.push(o);      // <- by INDEX, not by status
  });
  return cols;
}, [orders]);
```

and `:79` labels column `ci` with `statusClasses[ci]`. The comment at `:51-52` states the
intent: *"Distribute orders round-robin across the column count so no single column grows
unboundedly as new tickets arrive."*

So **a ticket never moves between columns when its status changes** — the original
assertion (`#101 should leave pending`) could not pass, and never would have. That was one
reason the test sat disabled; the *stated* reason (a refactored advance mechanism) was the
other, and it was simply stale.

## The other half of round 144's diagnosis was my instrument

Round 144 counted `list_kds_orders` calls to decide whether a refetch happened, and saw zero.
`fetchOrders` (`KdsScreen.tsx:157`) calls `get_kds_queue_scoped`, so the counter was watching a
command the board does not use. Re-instrumented across all `kds` commands:

```
KDS_CALLS_AFTER_CLICK=["update_kds_status_scoped", "get_kds_queue_scoped"]
```

The refetch always happened. Everything downstream of it works.

## The test, rewritten

The observable is the card's own status cue, not its column:

| Cue | Source |
|---|---|
| `.status` class | `KdsTicketCard.tsx:349` — `status status--${order.status}` |
| advance button aria-label | `:480` — `Start 101`, then `Mark Ready 101` |

The body picks the first card, holds its display number, and advances twice, asserting the cue
after each click.

The three column classes are still referenced — `screenExtraction.test.ts:855` declares them
**selector-only for E2E** and requires every such name to be read by a `ui/e2e` locator, so a
rewrite that dropped them failed that gate. They are asserted present with a comment saying
why: the class is a locator target, not a status statement.

## Verified

| Run | Result |
|---|---|
| `e2e-kds-critical-path` | **10 passed, 0 skipped** (desktop 3.9s, tablet 6.3s) |
| `--repeat-each=2` | **20 passed**, no flake |
| Kill-test (drop the advance click) | **fails**, so the assertions bind |
| `screenExtraction` gate | 323 passed after restoring the column locators |
| Full UI suite | 12,665 passed, 0 failed |
| `tsc` | 0 |