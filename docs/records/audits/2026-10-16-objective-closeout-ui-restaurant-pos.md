# Objective close-out: UI and restaurant-POS usability and reliability

**Date:** 2026-10-16
**Objective:** "continue review+audit+fix our codebase. lets focus on UI and restaurant pos
usability and reliability"
**Verdict:** met. Every reachable screen driven, every gate green, every defect found fixed and
committed with a kill test.

## Final gate state, measured on the current tree

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| `lint` | **0 errors** (120 pre-existing warnings, none introduced) |
| `npm run test` | **818 files / 13,035 passed / 3 skipped / 0 failed** |
| `npm run test:a11y` | 37 files / 84 passed |
| `lint:i18n` | no issues |
| `bundle:check` | all budgets satisfied |
| `testid:check` | 0 cross-file collisions |
| E2E desktop | **305 passed / 14 skipped / 0 failed** (all 103 non-API specs, two batches) |
| E2E tablet | **98 passed / 34 skipped / 0 failed** (all 103 specs) |
| Rust `kasirmu-core` reports | 121 passed / 0 failed |

## Surfaces driven and measured

Every reachable screen in the application:

* **15 sidebar destinations** — EOD Report, Products, Bundles, Stock Adjust, Exchange Rates,
  Promotions, Customers, Loyalty, Dashboard, Sales Report, Inventory Report, Custom Report,
  Staff Analytics, Terminals, Audit Log, Security Trail, Offline Queue, Shifts, General
* **11 admin tool cards** — all reach their own screen, 0 error boundaries
* **Restaurant POS** — desktop 1366x768, tablet 1024x1366 portrait, landscape, and the REAL
  tablet shell entry (`index.mobile.html` -> `TabletAppShell`)
* **Kiosk** — 45 product cards, 0 staff chrome leaked to customers
* **KDS / Expo** — verified correctly feature-gated
* **Sale / refund / payment** paths, including the QRIS styled-radio path

## Defects found and fixed

| Defect | Impact | Fix |
|---|---|---|
| **Analytics crashed on open** — `rows.reduce is not a function` | Whole screen to its error boundary, **and both exits** (back button gone, Escape handler uninstalled) | Mock returned an object where `Promise<VoidedSummaryRow[]>` is declared; fixed the mock AND the validator that had been fitted to the bug (`0dcbaacea`) |
| 9 stale line citations | Comments pointing at blank lines / `}`, including hazards whose explanation depends on a specific ordering | Re-pointed each at real code (`b382daa60`) |
| `.kiosk-success-card` missing noise-dither | Elevated surface with no overlay | Added to all three CSS lists + allowlist, ceiling raised with recorded reason (`b382daa60`) |
| 15 stale E2E specs | Red suite, and a course-chip case asserting an impossible opening state | Fixed to the real entry points and the real state machine (`0d4aafb6a`, `57b3bc95e`, `36dc98c1e`, `787e0eb1c`) |
| Kiosk case wrongly disabled | Coverage lost | Re-enabled — a feature gate hides the nav ITEM, not the page (`221b1ef03`) |

Every fix carries a kill test: reverted, observed red, restored byte-identically.

## Guards added

* `dev-mock-analytics-shape.test.ts` — 23 analytics readers pinned to the container their
  declared return type uses. The dev-mock answers 581 commands and only 7 were shape-checked
  before; this closes the surface the crash came through. Its first draft was **vacuous** — it
  drove `CARD_LOADERS`, which are transformers that cannot return an invalid shape. The kill
  test caught that, and it now tests the raw api call.

## Corrections to my own earlier work

Recorded because a wrong measurement left in a record is worse than none:

* "All eleven tool cards are `fullscreen: true`" — **wrong for six**; the registry says 5 true /
  6 false, and all six non-fullscreen cards do open their screens.
* Layout probes graded viewport position rather than reachability — corrected; a control below
  the fold in a scroll container is not unreachable.
* Touch targets graded on a fine pointer — the 44px floor is a `(pointer: coarse)` rule.
* The kiosk disable, above.

## Honest limits

* The **tablet project** skips 34 cases by their own `test.skip(project !== 'desktop')` with
  measured reasons; that is the suite's design, not a gap this pass introduced.
* `api.spec.ts` (10 cases) needs the Docker backend and self-skips without it.
* A green suite is evidence about asserted contracts, not proof of correctness. The two defects
  this objective found by reading and driving rather than by a red test — the Analytics crash
  and the Escape cascade — were both invisible to the suite as it stood.

> last audited 16-10-26 by docs-auditor
