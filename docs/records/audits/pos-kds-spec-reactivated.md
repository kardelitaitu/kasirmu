# The POS-to-KDS spec is reactivated and green (round 143)

## What round 142 got wrong about the blocker

Round 142 recorded that rewriting this spec needs `npm run e2e`, which needs Docker, and left
it undone. **Docker is not required.** `ui/e2e/playwright.config.ts:114`:

```ts
webServer: process.env['E2E_SERVER_EXTERNAL']
  ? undefined
  : { command: `npx vite --port ${PORT} --strictPort`, ... }
```

The config declares its own Vite server unless the runner sets `E2E_SERVER_EXTERNAL`. So a
DIRECT run needs no runner and no Docker:

```
cd ui && npx playwright test --config e2e/playwright.config.ts e2e/e2e-pos-to-kds.spec.ts
```

The comment at `:106-108` names exactly this path (*"Direct ... no runner exists, so Playwright
starts and stops its own server"*), and `:125` sets `VITE_DEV_TOOLBAR: '0'` so the dev
toolbar overlay cannot intercept clicks. Verified with a two-line probe spec before writing
anything: 2 passed in 4.9s against `http://localhost:1421/`.

## The test

`test.fixme` removed; three assertions in sequence:

| Step | Assertion |
|---|---|
| Baseline | the display numbers on the KDS board |
| Sale | the quick tender is CLICKED, then `.receipt-preview-paper` is visible |
| After | exactly **one** new display number appeared |

**The delta is a set of display numbers, not a count.** `KdsTicketCard.tsx:315` renders
`data-testid="kds-order-card-${display_number}"`, and the mock's `kdsDisplayCounter` is
`maxDisplay + 1` from persisted state — so the numbers are stable, while a total is perturbed
by the 60s auto-generator and the 10s progress sweep.

The two other original complaints are answered the same way: auto-generated orders carry the
`kds-order-auto-*` prefix and the sale's `kds-order-e2e-*` (`kds.ts:527`), and progress MOVES
an id between columns without adding or removing one. The test reads no column.

## The portrait branch, found by running it

The first run **passed on desktop and timed out on tablet**. The failure snapshot showed the
portrait layout — a `Menu` hamburger and a tablist — and `PosScreen.tsx:1802` renders
`.pos-cart-panel` only when `!isPortraitRestaurant`. On a 1024x1366 tablet the cart is a bottom
sheet behind `.restaurant-floating-cart-trigger`.

The spec now clicks that trigger when it exists. This is round 96's third render gate, in a
different guise: the same screen has two cart surfaces and only one is in the DOM at a time.

## Verification

| Run | Result |
|---|---|
| Direct, both projects | **2 passed** (desktop 4.9s, tablet 8.0s) |
| `--repeat-each=3`, 4 workers | **6 passed** in 18.5s — no flake under parallelism |
| Kill-test: `before` -> `after` in the filter | **fails**, so the delta assertion binds |
| Full UI suite | 12,665 passed, 0 failed |

## What this changes

The flow rounds 138-141 characterised by hand is now **executable**: a completed restaurant sale
producing a kitchen ticket is a regression test, on both form factors, in ~12 seconds.

The unused `test.fixme` and its three reasons are gone. Reason 3 — the localStorage claim — was
already false when written, per round 142's measurement of `loadMockKdsState`; reasons 1 and 2
were real but describe a count assertion the rewrite does not make.