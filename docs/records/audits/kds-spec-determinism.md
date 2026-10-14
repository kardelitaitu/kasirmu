# What makes the POS-to-KDS ticket deterministic, and why the spec is fixme (round 142)

## The spec already exists and is disabled

`ui/e2e/e2e-pos-to-kds.spec.ts:34` is `test.fixme('complete a sale in Restaurant POS and
verify ticket appears on KDS')`. Its comment gives three reasons:

1. auto-generated KDS orders every 60s break the exact `baselineCount+1` assertion;
2. auto-progress moves tickets between columns every 10s;
3. the sale-to-KDS push "relies on localStorage which persists across test runs, making
   baseline count unpredictable".

Rounds 138-141 measured the mechanism, so each can be checked.

## Reason 3 is wrong, and correcting it changes what is possible

The dev-mock's KDS state lives in a slice with a **seed-on-read, write-on-mutation** contract:

```ts
// kds.ts:224-244
function loadMockKdsState(): MockKdsState {
  return readSlice(MOCK_KDS_KEY, () => ({ orders: [..._initialKdsOrders], ... }));
}
function saveMockKdsState(): void {
  writeSlice(MOCK_KDS_KEY, { orders: mockKdsOrders, lineItems: mockKdsLineItems });
}
const mockKdsOrders = mockKdsState.orders;   // :245-247 seeds from the slice
```

So the SEED is never persisted — a first load reads nothing and seeds ten orders in memory.
Once any mutator runs (`:408` auto-generation, `:498`/`:573`/`:583`/`:618`/`:628`/`:673` status
and line writes) the slice exists and later loads restore it.

*This is also a correction to round 140*, which said the array was "page memory, not
persisted" and cited `NO_KEY` as proof. `NO_KEY` was true only because nothing had mutated in
that fresh context. Both facts are needed: unmutated state is memory-only; mutated state
persists and is restored.

## Reasons 1 and 2 are real, and both are interval-driven

| Drift | Source | Interval |
|---|---|---|
| A new order is generated | `startKdsAutoGeneration`, `:397-415` | `KDS_ORDER_INTERVAL_MS = 60_000` |
| A ticket advances pending->preparing->ready | `startKdsAutoProgress`, `:426` | check every `10_000`; transitions at 2-5 min / 3-8 min |
| Served/cancelled orders are evicted | `evictCompletedOrders` inside the generator | same 60s tick |

`kdsDisplayCounter` (`:310`) is `{ value: maxDisplay + 1 }`, computed from the highest
**persisted** display number — so it is stable given the same state, but auto-generation
increments it every 60s. Round 141 saw exactly `#111`, consistent with the seeded 110 being
the maximum and a single sale consuming the next id.

## What a resilient spec would assert instead

The fixme's instinct — `baselineCount + 1` — is the wrong shape because a **count** is
perturbed by all three drift sources, while an **id set** is only perturbed by one. Two
properties survive:

1. **A new `kds-order-e2e-*` id exists that was not there before.** Auto-generated orders use
   the `kds-order-auto-*` prefix, and `saleDerivedKdsOrders()` reads by prefix precisely so
   the two never mix (`:518-524`). A sale-derived id is therefore specific to the sale;
2. **The ticket carries the sale's items.** `pushKdsOrderFromCart` (`tauri-api.ts:90`) builds
   `items_summary` as `${qty}x ${name}` from the cart lines, so the summary names what was
   bought.

Both are what round 141 measured hand-driven, and both ignore the count. Reason 1's perturber
is the 60s generator, which a 30-60s test can out-run, and reason 2's progress drift does not
touch a pending ticket's id or summary at all.

## NOT done, and the reason is a boundary

**The spec was not rewritten.** Round 141 drove the chain by hand and proved it; converting
that into a Playwright spec needs `npm run e2e`, which needs Docker (`scripts/run-e2e.mjs`),
and `docker info` fails in this session. A spec written without running it is exactly the
"verified without evidence" shape this project's gates reject.

The record therefore leaves the next step precise: run `cd ui && npm run e2e -- --build
e2e/e2e-pos-to-kds.spec.ts` somewhere Docker works, asserting the id-set delta and the item
summary rather than the count.

## Verified

| Item | Result |
|---|---|
| Spec currently disabled | `e2e-pos-to-kds.spec.ts:34` `test.fixme` |
| KDS seed is persisted on load | no — `readSlice(KEY, fallback)` does not write |
| KDS mutators persist | `saveMockKdsState`, 9 call sites |
| Auto-generation interval | 60s (`kds.ts:252`) |
| Auto-progress interval | 10s check (`:420`) |
| Display counter | `maxDisplay + 1` from persisted state (`:310`) |
| Sale-derived ids | `kds-order-e2e-*`, distinct from `kds-order-auto-*` (`:527`) |
| Round 141's new ticket | `#111` |
| Tree | no source changed this round |