# The table floor plan, driven live — and a probe that read it too early (round 177)

## What this round

Rounds 165-176 were sweeps, guards and audits. This one went back to the technique that
actually found round 163's defect: pick an unswept surface, DRIVE it, and read what happens.

The sweep that started it found **94 restaurant/tables testids with no e2e reference**. The
biggest cluster was `TableManagementScreen` — 17 testids of which E2E touched exactly one, the
back button round 149 added to prove the route.

## The screen, measured live

The dev mock seeds a real floor plan: **12 tables across two sections** (Indoor 5/6, Patio 6),
with `OCCUPIED` and `AVAILABLE` both on screen. So the load path, the section headers and the
status chips are all observable with no fixture, which is what made this worth a spec.

## The one mistake, and it was the instrument again

My first probe read the body immediately after the screen mounted and caught `Loading…` with
no tables — which looks exactly like a broken screen. Re-probing with a wait for the IPC trace
showed `list_tables_scoped` called twice, both resolving, and `STILL_LOADING=false`.

`setLoading(false)` is in a `finally` (`TableManagementScreen.tsx:201`), so the state cannot
stick. **The screen was never broken; my probe was premature.** Round 144's lesson, a third
instance — and the fix is now recorded in the spec itself: wait for a table tile, then assert
`Loading` has gone, rather than reading the body once.

## Two selector mistakes, both mine

| What I wrote | What was wrong |
|---|---|
| `getByText(/OCCUPIED/)` | the screen lowercases statuses via `statusLabel` — the DOM says `occupied` |
| count `getByText(/Table/)` grows after an add | the Add Table button and the section badges also contain the word, so the count did not move |

Both fixed by matching the real DOM — case-insensitively for status, and counting the new
table by name rather than by a shared word.

## What the spec now covers

`ui/e2e/restaurant-tables-live.spec.ts` — **4 passed** (2 cases x desktop/tablet):

| Case | Asserts |
|---|---|
| floor plan loads | 12 tables render, Loading clears, both sections and both statuses appear |
| add a table | name it, Save, dialog closes, `Teras E2E` is in the plan |

The setup also covers the **Shift+L route**, which is the only way in: the sidebar row is
feature-gated (`FEATURES.TABLE_MANAGEMENT`, omitted by the mock) but the screen is not. That is
the same note round 161's tables-form spec carries, and it makes this file's `beforeEach`
double as coverage that the shortcut lands on a real screen.

## Also cleaned

A `ui/e2e/probe-verify.spec.ts` left over from round 173's verification run was still untracked
in the tree. Found by reading `git status` before committing rather than after, and removed.

## Verified

| Item | Result |
|---|---|
| New spec | **4 passed** (desktop 3.2s/2.0s, tablet 4.9s/5.6s) |
| Live probe | 12 tables, 2 sections, both statuses — all four assertions hold |
| Premature-read trap | reproduced then fixed; the spec's comment records it |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,693 passed |
| Stale probe | removed |