# E2E Test Suite

<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (1 finding) · The CI Pipeline section described the e2e job in .github/workflows/ci.yml in present tense. ci.yml is retired (ci.yml.bak, by 23c96330 on 09-02), e2e-pr.yml likewise, and neither live workflow contains an e2e job: dev-ci.yml's jobs are changes, website, cargo-check, cargo-nextest, ui-test, i18n, ci-docs-drift, static-gates, release-readiness, northflank-deploy and release.yml's are release-validate, release-build, release-publish. AGENTS.md already states the consequence - E2E, a11y, security and nightly are not enforced in CI - so the README contradicted a rule the repo itself documents, and the practical effect is that a red E2E suite produces no artifact and no failure signal anywhere in CI. Steps kept verbatim as the shape of a run with the local equivalent named (npm run e2e from ui/, plus scripts/check.sh), and step 5 relabelled CI-only because a local run writes traces to the Playwright output dir rather than uploading with 7-day retention. · Everything else on the page re-confirmed: workers 4 local / 2 CI matches e2e/playwright.config.ts, storageState per-worker auth caching is real in fixtures.ts, and the spec-file table's filenames exist under ui/e2e/. (fixtures.ts was later deleted as dead code on 2026-09-22, 46fd79d19 — no spec or config imported it; see the note under Test Isolation.) · Found while sweeping every live doc for claims about CI jobs that do not exist, after CONTRIBUTING.md (bd7fddae3) turned out to contain one my own 08-09-26 audit had stamped as accurate. Same sweep also produced one near-miss I did NOT report: signpath-onboarding.md:211 points at a release-build job, and release-build is genuinely live in release.yml - checking job membership against the file, not against a remembered list, is the only reason that one stayed out of the fix list. -->

Playwright-based end-to-end tests for OZ-POS. Tests run against the Vite
dev server with mocked Tauri IPC (`dev-mock/tauri-api.ts`) — no Rust backend
required.

## Dev-server port: the suite owns its own (1421), never 1420

An E2E run starts its **own** Vite on `E2E_PORT` (default **1421**) and kills only
the PID it spawned. It never probes for or adopts a server it did not start, and
never kills by port.

Why this matters in a shared checkout: port **1420** is the Tauri desktop `devUrl`
contract (`apps/desktop-tauri/tauri.conf.json`) used by the human-facing
`npm run dev`. When the suite shared that port it would adopt another session's
dev server and then tear it down mid-run, producing
`page.goto: Could not connect to server` on every test after the first batch —
and an E2E cleanup could kill a sibling session's server outright.

- Running the suite while something already holds 1421 now fails **loudly** with
exit 3 (`Port 1421 is already in use … refusing to adopt`) — 0 tests executed,
never a silent attach.
- To run two E2E passes concurrently, give one its own port:
  `E2E_PORT=1431 npm run e2e:ui`.
- `npm run dev` and `cargo tauri dev` are unaffected: they stay on 1420.

## Quick Start

```bash
cd ui

# Install browsers for the full project matrix (desktop=Chromium,
# tablet=iPad Pro 11 emulation=WebKit). `npm run e2e` and the PR
# workflow run ALL projects, so both are required — chromium-only
# crashes the tablet specs with "Executable doesn't exist at
# .../ms-playwright/webkit-*/pw_run.sh".
npx playwright install chromium webkit --with-deps

# Start the dev server + run tests in one command (webServer auto-start)
npx playwright test --config e2e/playwright.config.ts

# Run a single spec
npx playwright test --config e2e/playwright.config.ts e2e/auth.spec.ts

# Headed mode (watch the browser)
npx playwright test --config e2e/playwright.config.ts --headed

# Playwright UI mode (debug with timeline, pick locators)
npx playwright test --config e2e/playwright.config.ts --ui

# Tablet viewport only
npx playwright test --config e2e/playwright.config.ts --project=tablet
```

## Architecture

### Dev-mock IPC

All Tauri `invoke()` calls are intercepted by `ui/src/dev-mock/tauri-api.ts`
via a Vite alias. The mock provides deterministic data for 45 products, 5
workspaces, 5 staff members, and cart/order lifecycle operations.

Each spec's `beforeEach` calls `page.goto('/')` which loads a fresh app
instance. The dev-mock resets on page load (no shared mutable state), so
tests are already isolated and parallel-safe.

### CSS Contract

Tests use stable CSS class selectors from the component source. When a
component adds `data-testid`, the helpers prefer `getByTestId`. The full
CSS contract is documented in each spec file's header comment.

| Component | Key selector | data-testid |
|-----------|-------------|-------------|
| StaffLoginScreen | `.staff-login-screen` | — |
| WorkspaceHome | `.workspace-home` | `workspace-home` |
| Workspace card | `.workspace-card` | — |
| ProductLookupScreen | `.product-card-btn` | — |
| RetailPosScreen cart | `.retail-cart-action-btn--pay` | `cart-panel` |
| RetailCartPanel line | `.retail-cart-line-sku` | `retail-cart-line-item` |
| PaymentModal | `.payment-modal` | `payment-modal` |
| ReceiptPreview | `.receipt-preview-paper` | — |
| Settings sidebar | `.settings-sidebar` | `settings-sidebar` |
| Audit log | `.audit-log` | `audit-log-table` |
| Product mgmt | `.product-mgmt` | — |
| Shift mgmt | `.shift-mgmt` | — |
| KDS screen | `.kds` | — |
| Session lock | `.session-lock-card` | — |

### Test Isolation

Each test file is fully isolated:
- `page.goto('/')` resets the dev-mock state
- No shared mutable state between tests
- `workers: 4` (local) or `workers: 2` (CI) runs tests in parallel

⚠️ **Auth caching has NOT been per-worker, and this claim was wrong.** This line
used to read “`storageState` in `fixtures.ts` provides per-worker auth caching”.
It does not: `fixtures.ts` used ONE shared path (`.e2e-auth.json`) that every
worker read at context creation and wrote after logging in. With 4 workers those
reads and writes interleave, so a worker can read a half-written session, fail
its “already logged in?” probe, log in again and clobber the file. That is the
mechanism behind the flake where the same code produced 0 failures in one full
run and 32 in the next.

Fixing it means giving each worker its own auth path (keyed on `workerIndex`,
and on the project, since desktop and tablet share a worker pool). Verify with
TWO consecutive full runs — a single green run is weak evidence for a flake fix.

> `fixtures.ts` itself is gone: deleted 2026-09-22 (46fd79d19) as dead code —
> no spec or config imported it, per-worker auth lives in the specs' own
> `loginAs` helper (helpers.ts). The history above is kept as-is.

### CI Pipeline — retired; nothing runs E2E in CI

> ⚠️ **This describes a pipeline that no longer executes.** The `e2e` job lived in
> `.github/workflows/ci.yml`, which `23c96330` retired to `ci.yml.bak` on 09-02; `e2e-pr.yml`
> went the same way. GitHub never reads a `.bak` file, and neither live workflow defines an
> `e2e` job — `dev-ci.yml`'s jobs are `changes`, `website`, `cargo-check`, `cargo-nextest`, <!-- ci-claim: ok: this line enumerates the live jobs to prove e2e is absent -->
> `ui-test`, `i18n`, `ci-docs-drift`, `static-gates`, `release-readiness`, `northflank-deploy`;
> `release.yml`'s are `release-validate`, `release-build`, `release-publish`. `AGENTS.md` says
> so directly: "E2E, a11y, security and nightly suites are NOT enforced in CI — a green Dev CI
> run is not proof those passed." The steps below are kept because they are still the shape of a
> run, and `npm run e2e` reproduces 1–5 locally.

What a run does (locally today; in CI before 09-02):
1. Installs Playwright browsers (Chromium)
2. Starts Docker E2E backend (cloud-server + license-server)
3. Starts Vite dev server
4. Runs `npx playwright test --config e2e/playwright.config.ts --project=desktop`
5. Uploads traces on failure (7-day retention) — CI-only; locally traces land in the Playwright
   output directory instead, so the retention line does not apply to a local run.

Because step 5 is the only artifact and no CI run produces it, **a red E2E suite is invisible to
CI today**: the guard is `npm run e2e` from `ui/`, plus `scripts/check.sh` for the full matrix.
Note also that the local run is stale-image-guarded — `run-e2e.mjs` exits 3 rather than running
against an outdated image; see `AGENTS.md`.

## Spec Files

| File | Coverage | Items |
|------|----------|-------|
| `auth.spec.ts` | Login, PIN, lockout, session persistence | E2E-4→8 |
| `sale.spec.ts` | Product grid, cart, payment, receipt | E2E-9→15 |
| `product.spec.ts` | Product list, create modal, form validation | E2E-16→19 |
| `settings.spec.ts` | Sidebar, navigation, dirty-state guard | E2E-20→22 |
| `shift.spec.ts` | Open/close shift, balance, summary | E2E-23→25 |
| `new-flows.spec.ts` | Workspace picker, session lock, KDS, audit | E2E-26→29 |
| `tablet-viewport.spec.ts` | Tablet viewport smoke, touch targets | E2E-30 |
| `api.spec.ts` | Cloud server / license server HTTP API | — |
| `e2e-sale-to-history.spec.ts` | **Critical Path:** complete sale → verify in Sales History | CP #1 |
| `e2e-shift-reconciliation.spec.ts` | **Critical Path:** open shift → sale → close → verify summary | CP #2 |
| `e2e-settings-persist.spec.ts` | **Critical Path:** change setting → navigate → return → verify persist | CP #3 |

## npm run e2e — Unified Runner

A cross-platform Node.js runner that handles the full E2E lifecycle:

```bash
# Full suite (starts Docker + Vite + Playwright)
npm run e2e

# Watch the browser
npm run e2e:headed

# API tests only
npm run e2e:api

# UI tests only
npm run e2e:ui

# Skip Docker (use existing servers)
npm run e2e -- --no-docker

# Single spec
npm run e2e -- e2e/auth.spec.ts
```

The runner detects Docker availability gracefully — if Docker is not
installed or the daemon isn't running, it skips the Docker services
and runs only the Playwright tests against the Vite dev server.

### `--ui-only` derives its spec list from disk

`npm run e2e:ui` used to carry a hand-maintained array of 10 spec paths. The
directory held 29, so **17 specs silently never ran** and a green run said
nothing about the gap. It now reads the directory and excludes only
`api.spec.ts`, so adding a spec file is enough to make it run.

The table under “Spec Files” below is a partial, dated snapshot from 2026-09-09
and was already incomplete when written — treat the directory as the authority:
`ls ui/e2e/*.spec.ts`. The reason to prefer the directory is the bug above: a
curated list cannot notice what it omits.

## Writing New Tests

1. **Use hard assertions** — no `if (count > 0)` guards. Tests MUST fail on
   regressions.
2. **Prefer `waitForSelector` over `waitForTimeout`** — magic sleeps are the
   #1 cause of flaky tests. Use `expect(locator).toBeVisible()` which has
   built-in auto-wait.
3. **Use CSS class selectors** matching the component source. When a
   `data-testid` exists, prefer it over class selectors for robustness.
4. **Wrap logical steps in `test.step()`** for readable traces when a test
   fails.
5. **Clean up after yourself** — dismiss modals, close drawers, reset forms
   so subsequent tests in the same worker start clean.

> last audited 09-09-26 by docs-auditor
