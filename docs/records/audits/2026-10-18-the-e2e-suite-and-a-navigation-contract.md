# The E2E suite, and a navigation contract I could only describe — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 165 - status: 1 reproducible defect
     FOUND and narrowed but NOT fixed (mechanism unproven), 1 gate exercised for the first
     time, 0 code changes - branch: 0.0.41 - commit: none -->

<!- - Scope: the behavioural gate round 164 named as unexplored. `npm run e2e` had never
     been run in this session, and every class closed so far was found by STATIC analysis. -->

## The gate now runs, and both projects work

Playwright browsers were absent (`ms-playwright` cache empty); `npx playwright install
chromium` restored them, and webkit was already present, so the full desktop+tablet matrix
runs. My first invocation was WRONG and produced 7 false failures: `npx playwright test
<spec>` without `--config e2e/playwright.config.ts` skips the `webServer` block and the
`baseURL`, so every test died on `page.goto: Cannot navigate to invalid URL`. With the
config, one spec went 4/4 in 12s. **That is a trap worth recording: a bare `playwright test`
in this repo looks like a catastrophic regression and is entirely an invocation error.**

Full run: `npm run e2e:ui` -> **86 failed, 514 passed (15.5m)**.

## The dominant failure is one cause, not 86

Aggregating the error text: 68 of the failures are `expect(locator).toBeVisible() failed`
with `element(s) not found` — the same shape. Reading one in full
(`adr22-workspace-settings.spec.ts`) and its Playwright `error-context.md` snapshot showed
the page rendering the WORKSPACE PICKER, not the expected screen.

## The defect, reproduced minimally

Narrowed to two facts, both measured:

1. Clicking the real **Locations tool card** works. A probe clicked
   `getByRole('button', { name: 'Locations', exact: true })` and the dashboard rendered:
   `.multi-store-dashboard = 1`, `.workspace-home-wrapper = 0`. The product is fine.
2. The **helper's own path** does not. After `selectWorkspace(page, WORKSPACES.ADMIN)`
   leaves the admin shell up (`sidebar = 1`, `picker = 0`, hash `#/settings`), a
   `navigateTo(page, 'locations')` — exactly what `helpers.ts:177` does — drops the operator
   back to the picker: `picker = 1`, `dash = 0`, and the hash stays `#/locations`.

The drop happens within **200ms** (time-sliced at 200/600/1200/2500ms: the picker is
already there at the first sample), so it is a synchronous state clear rather than a
timeout — and the hash is NOT cleared, which rules out `goToWorkspacePicker` (it sets
`window.location.hash = ''`). Since `AppShell.tsx:708` renders the picker on `if
(!activeWorkspace)`, the workspace itself became falsy.

`handleShortcutNav` (`WorkspaceHome.tsx:553`) is the only thing that pairs a route with
`setActiveWorkspace('admin')`, which is why the tool-card path works and a bare hash set
does not.

## Why I stopped short of a fix

I could not prove the clearing caller, and I am not willing to change navigation on a
hypothesis. Ruled out BY READING, each for a stated reason: `WorkspaceContext` never reads
the hash (`grep` 0 hits); the `!activeWorkspace` branch at `AppShell.tsx:337` only runs when
the workspace ALREADY changed; `syncFromHash` handles `#/locations` correctly via
`getPage(route)`; `useSettingsHashSection` returns at `:78` for a non-`settings/` hash, so
its `replaceState` at `:89` does not fire; and no route-to-workspace guard exists
(`grep` for `route.*activeWorkspace` returns nothing).

What IS established is the boundary the fix must respect: **a route the current workspace
can serve is being treated as a workspace change.** `handleShortcutNav` already encodes the
correct rule for the tool-card path.

## Honest limits of this round

- 86 failures were NOT individually triaged. I characterised the dominant class (68) and
  proved it with one full trace plus two probes. The other ~18 name different errors
  (`sales-history tier surfaces missing`, `the seeded bill must attach to a table`,
  `the plan has a free table`, a 480x800 horizontal scroll, viewport-clipped clicks) and
  are plausible REAL product or fixture defects that this round did not reach.
- One spec, `adr22-workspace-settings.spec.ts`, was rerun in isolation and failed 6/12 the
  same way — so it is NOT cross-test interference, which was worth ruling out given
  round 162's lesson about assuming a failure is environmental.

## Evidence

- Gate exercised: `npm run e2e:ui` -> 514 passed / 86 failed; the config-versus-bare
  invocation difference demonstrated directly (7 fails -> 4/4).
- Reproduction: three throwaway probes under `ui/e2e/zz-diag*.spec.ts`, all DELETED after
  use (verified: 0 remain), and one scratch run of the real failing spec on its own.
- Ruled-out list above is `grep`-backed, not recalled.
- **No production file touched.** `git status` on `ui/e2e/helpers.ts` and
  `adr22-workspace-settings.spec.ts` is clean; the only changes in the tree are other
  lanes' in-flight files.

## Carried forward

1. FIND the clearing caller before fixing. The next probe should instrument
   `WorkspaceContext.setActiveWorkspace` (or React DevTools state) and log a stack trace at
   the moment it is passed null during a hashchange — that names the caller in one run.
2. The ~18 non-dominant failures are unexamined and several name specific unmet
   preconditions, which is the signature of a real defect rather than a harness gap.
3. `npm run e2e` needs the browsers installed, which they were not. That is a one-line
   documented prerequisite in `ui/e2e/README.md` already, but nothing in this session had
   ever satisfied it — worth noting that "the gate is green" was never verified here
   before this round.

> last audited 18-10-26 by docs-auditor
