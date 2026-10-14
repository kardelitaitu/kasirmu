# Restaurant POS — rendered-behaviour verification in a real browser (2026-10-12)

## Why this exists

The dev-mock unit tests (rounds 24-30) prove the *mock* agrees with itself. The
a11y suites prove controls are *named*. Neither proves what the screen actually
RENDERS, because jsdom has no layout, no z-order and no real click routing.

The Tauri WebView2 route (CDP on 9222) needs the app started with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, and the
running instance routinely does not have it. **Playwright against the Vite dev
server needs nothing but the dev server**, and exercises the same React code.

## How to run it

`ui/node_modules/playwright` and its bundled Chromium are already installed, so
this needs no new dependency. From the repo root, with Vite up on :1420:

```js
const { chromium } = require('C:/dev/kasirmu/ui/node_modules/playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
```

Then log in exactly as the harness below does. Three details are load-bearing:

1. **Log in with the real flow** — fill `#staff-login-username` with `owner`,
   `requestSubmit()` the `.staff-login-form`, then click
   `.staff-login-pad-key[aria-label="1"]` … `"4"` (PIN 1234).
2. **If the Tauri window is also running, the dev server may load in the Tauri
   webview instead** — that is the `hasTauriInternals()` guard doing its job, and
   this harness still works because it drives its own page.
3. **Hide the dev toolbar before clicking anything low on the screen**:
   `await page.addStyleTag({ content: '.dev-toolbar{display:none !important}' })`.
   Otherwise Playwright fails with
   `<div role="toolbar" class="dev-toolbar" ...> intercepts pointer events` —
   the toolbar is a fixed overlay and swallows the click.

## What was verified (zero console/page errors throughout)

| Screen | Result |
|---|---|
| Workspace home | 36 visible controls, **0 unnamed** |
| Restaurant POS | 56 visible controls, **0 unnamed** |
| Menu | 27 cards render with correct prices (Caffè Latte Rp 45.000, …) |
| Empty cart | no Charge button, correct — nothing to charge |
| After adding an item | cart line appears, Charge button enables |
| Cart footer | discount, promotions, tip 15/18/20%, service charge, Clear, Save all present |
| Payment modal | Total Due Rp 45.000; quick tender Rp 50,000 / Rp 60,000 / Rp 100,000 / Exact |
| **Exact** tender | fills 45000 → `CASH Rp 45.000` / `CHANGE: Rp 0` |
| Receipt | correct items, SUBTOTAL = TOTAL = Rp 45.000, then Skip / Issue Tax Invoice / Print Receipt |

## Two method traps this pass caught in its own harness

Both were MY test being wrong while the app was right — worth recording so the
next pass does not report either as a defect:

1. **`.payment-quick-btn` is not the Exact button.** Selecting it picks the FIRST
   quick-tender chip, `Rp 50,000`, which tenders 50.000 against a 45.000 total and
   correctly yields `CHANGE: Rp 5.000`. The app was right; my selector was sloppy.
   Select by text (`.payment-quick-btn:has-text("Exact")`) or enumerate first.
2. **An empty cart on a fresh profile is correct, not a regression.** The Tauri
   webview carries a persisted cart from earlier manual use; a fresh Playwright
   profile has none, so 0 lines and no Charge button is the right empty state.

## Round 33 — all six sidebar screens, and the KDS ticket lifecycle

Every restaurant screen reachable from the POS sidebar was driven and audited
(controls counted, names computed the way the browser computes them, console and
page errors captured per screen). Zero unnamed controls, zero errors:

| Screen | Controls | Unnamed | Errors |
|---|---|---|---|
| Menu Editor | 214 | 0 | 0 |
| Kitchen Display | 86 | 0 | 0 |
| Receipts | 43 | 0 | 0 |
| Payments | 34 | 0 | 0 |
| History | 15 | 0 | 0 |
| Settings | 6 | 0 | 0 |

Total across the six: **398 controls, all named.** The POS and payment modal were
covered in the previous pass.

### KDS ticket lifecycle — driven buttons, each step read off the board

The board renders real tickets (e.g. #101 T3, #104 T2 Ready, #107 RUSH Served)
with station-grouped lines (`0/1 MAIN`, `0/2 MAIN`). One ticket was advanced
through the whole flow by pressing the actual buttons, reading the rendered state
back after each press:

| Button pressed | #101 rendered state |
|---|---|
| (initial) | `Pending` |
| `Start 101` | `Preparing` |
| `Mark Ready 101` | `Ready` |
| `Serve 101` | `Served` |

The action button's own label advances with the state (Start -> Mark Ready ->
Serve), and no console or page error was raised at any step. The Open tab
reported `Open 10` throughout, which is correct for a same-session transition.

### Currency scan across every screen

Following the USD seed defect fixed in `7a5f5d2fc`, every screen was scanned for
currency tokens: **no `$` token appears anywhere**, and `Rp` appears where money
is shown (POS 27, Menu Editor 27, History 1). The one History row reads
`Rp 115.000` = 1x LATTE (Rp 45.000) + 2x CROISS (Rp 35.000), which matches the
menu.

## Not covered here
- Settling with a split tender, or with a stored card method.
- ~~Screens reached only through the sidebar~~ — COVERED in round 33 (all six).
- Settling with a stored card method, or a QRIS/EDC rail end to end.
- Anything requiring the real Rust bridge: this drives the dev-mock, so the five
  persistence fixes from rounds 24-30 are exercised here but NOT against SQLite.

> last audited 14-10-26 by docs-auditor
