# Logo mark: the "k" is off-centre inside the blue tile

<!-- Audit stamp: 2026-09-19 · Cline · status: MEASURED, UNEXECUTED · authoring HEAD `ac3b2dd4ee67512fea489e8b5783a9f8906d03a9` on branch `0.0.39`. Every number below was produced in this checkout by a Playwright/Chromium probe against the real files — `getBBox()` on the shipped SVG, `getImageData()` on the decoded PNGs, `getBoundingClientRect()` on the real stylesheets — not read off a screenshot and not carried from another document. The working tree carried peer sessions' edits (`crates/kasirmu-bridge/src/*_tests.rs`, `docs/records/README.md`) throughout; none were touched and none are cited. No artwork, stylesheet or component was modified by this pass. -->

**Document:** `todo-logo-mark-optical-centring.md`
**Role:** Defect record — an artwork-level optical misalignment, with the proof that no stylesheet can fix it
**Goal:** Get the white "k" optically centred inside the mark's blue tile, on every surface the mark appears, without a hand-edit landing on a designer-owned export or on a sync destination.
**Acceptance:** the mark's ink centre-of-mass falls within ±2 viewBox units of the tile centre, **and** `cd ui && npm run typecheck && npm run test` is green, **and** `powershell -File scripts/sync-branding.ps1 -DryRun` lists all four vector variants as `[DRY]`. A `done-` rename is earned only once those three have been RUN and PASSED (AGENTS.md §4).

**Why this is not a UI bug.** The reporter's description was *"the logo is not properly aligned"* on the login screen. The login screen is innocent and was cleared first, because the obvious suspect is the one element that is correct.

---

## 1. What is measured, and where

| Fact | Source |
|---|---|
| `viewBox="0 0 216 216"` | `ui/public/branding/logo-mark.svg` |
| 3 ink elements: tile `rect`, `k` path (`cls-2`), dot path (`cls-3`) | same file |
| Login screen renders the mark at `clamp(96px, 28vw, 192px)` | `StaffLoginScreen.css:221-227` |
| Only ONE consumer of `/branding/logo-mark.svg` in the whole repo | `git grep -n "branding/logo"` → `ui/src/features/auth/StaffLoginScreen.tsx:368` |
| Mark is mirrored into 6 tracked files | §4 |

At a 192 px render the scale is `192/216 = 0.8889 px per viewBox unit`; all pixel figures below use it.

---

## 2. The login screen's layout is exact — clearing it first

Rendered in Chromium with the real `reset/fonts/tokens/components/responsive` sheets plus `StaffLoginScreen.css` and the real markup, then measured relative to the card's own centre axis:

| Element | Δx from card centre |
|---|---|
| `.staff-login-top-bar` | 0.00 px |
| `.staff-login-logo` (wrapper) | 0.00 px |
| `.staff-login-logo-img` (the mark itself) | **0.00 px** |
| `.staff-login-main-area` / `.staff-login-form` / `.staff-login-input` | 0.00 px |
| `.staff-login-bottom-bar` / `.staff-login-steps` | 0.00 px |
| `.staff-login-submit-btn` | +145 px (right-aligned inside the field, by design) |

Identical result at viewport widths **428 / 1024 / 1440 px**, so nothing here is a zoom or clamp artefact. `.staff-login-top-bar` centres via `align-items: center` and the tile is centred in the `216` canvas to within 0.03 units — the `<img>` box is not the problem, and moving it was rejected in §3.