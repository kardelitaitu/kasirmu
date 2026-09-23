---
num: 1
area: frontend-architecture
title: ADR-0001: Orientation & Adaptive Layout Strategy — the hybrid ladder (shell media queries, container queries, a declared escape hatch, and a walker gate)
status: Implemented (2026-10-11) — all four tiers landed and gated; 7 sheets migrated
---

# ADR-0001: Orientation & Adaptive Layout Strategy

**Status:** Implemented (2026-10-11). All four tiers (T1 shell media queries, T2 container
queries, T3 declared layout escape hatch, T4 walker gate) are in the tree and enforced. Slices
0-7 landed; seven sheets migrated (RetailPos, KDS, SalesHistory, PaymentModal, PosScreen,
EodReport, CartPanel). The remaining sheets are future Slice-5 work under the same gate.
**Date:** 2026-10-11
**Recorded against:** branch `0.0.39`
**Tags:** css, layout, orientation, container-queries, tablet, tauri, gates, walker

> **Why the number is 1 and the location is `docs/adr/`.** Every existing record lives in
> `docs/decisions/` as `YYYY-MM-DD-adrNN-<slug>.md` (`docs/decisions/README.md` — the
> highest number in use is **59**, numbers #16 and #24–#29 are unused, and **#43 is claimed
> twice**). This file was requested under `docs/adr/`, a directory that did not exist before
> this write, and it takes a **fresh local series starting at 0001** so it cannot collide with
> the `decisions/` numbering. **Cite this record by filename, not by number.** If the series
> is later folded into `docs/decisions/`, renumber there and leave a pointer — do not renumber
> in place, because filenames are the only collision-free citation form this repo has.

## Context

The app must lay out correctly in both orientations on a resizable Tauri window (desktop) and a
freely-rotating Android WebView (tablet). Nothing enforces orientation today, and that is by
measurement, not by omission.

**1. The lock never worked.** `TabletAppShell.tsx` used to call
`useOrientation('landscape-primary')`. It was removed, and the removal is documented in a
comment at `ui/src/app/tablet/TabletAppShell.tsx:36-57`: `screen.orientation.lock` is absent
in the Android WebView, so `useOrientation` reports `supported: false` and the request is a
silent no-op (`ui/src/hooks/useOrientation.ts:116-146`). Measured 2026-09-20 on the same
installed build: 1200x1920 (portrait), then 1920x1200 (landscape). **The app rotates freely.**
The belief that it was locked is precisely why neither `tablet.css` nor `SetupWizard.css`
carried a single orientation rule.

**2. The keyboard trap.** A screen laid out for one orientation on a device that can be in the
other is not merely ugly — on a height-starved landscape viewport an on-screen keyboard consumes
the remaining height and pushes the focused field (and the submit control below it) out of the
visible region. The user cannot see what they are typing and cannot reach the control that ends
the interaction; there is no scroll gesture that helps when the viewport itself is the short
axis. Portrait-only layouts on a rotating device produce this state routinely. Any strategy that
assumes a fixed orientation inherits the trap.

**3. The gap is 84% of the stylesheets, and nothing measures it.** `ui/src/**/*.css` holds
**139** files. Exactly **one** of them contains an orientation rule:
`ui/src/features/setup/SetupWizard.css:625` —
`@media (orientation: landscape) and (min-width: 48rem)` — backed by one test
(`ui/src/__tests__/setupWizardLandscape.test.ts`). The one design system that owns the real
breakpoints, `ui/src/theme/tokens.css:268-272`, declares `--bp-desktop: 1024px`,
`--bp-tablet: 1023px`, `--bp-tablet-portrait: 768px`, `--bp-mobile: 480px` — **width only, no
orientation axis, and the tokens are not the literal values the sheets actually use.** So:

> **97 of 115 non-vendor stylesheets (84%) are unresponsive in any measured sense** — no
> orientation rule, and no mechanism by which a width-only token set could produce one.
> *(Working figure as briefed. Re-derive before quoting: the two instrumented counts in this
> file are 139 CSS files under `ui/src` and 3 tree-wide hits for an orientation
> `@media` — one rule, one comment citing it, one test asserting it. The denominator 115 comes
> from the brief, not from a command recorded here.)*

**4. Orientation is a layout axis, not a state.** A rotation is not always a viewport resize.
When a device rotates, CSS media queries re-evaluate and re-lay-out with **no React re-render**
and no state to keep in sync. Anything expressed as a media query therefore survives rotation for
free; anything expressed as a component tree must be re-derived, re-tested, and re-verified at a
second size.

**5. Container queries are available and are the better tool where they fit.** The shell's own
layout problem — a page rendered inside a shell with a rail, a tab bar, and optional insets — is
a *container* problem, not a viewport problem: the page does not care how wide the screen is, it
cares how much room it was given. Container queries express that directly and make a page
correct in a preview pane, a modal, a split view, or an e2e harness frame, none of which a
viewport query can see.

**6. Tauri is resizable.** There is no fixed canvas. A desktop window can be dragged to any
aspect ratio including extreme portrait, and the tablet window resizes on rotation. Any strategy
that hard-codes an orientation assumption is wrong on hardware the product already ships.

**7. There is no gate.** No walker suite in `docs/audits/frontend/css-verification.md` asserts
anything about orientation or adaptiveness, and no CSS linter exists in this repo at all.
A rule added as prose is a rule that will not survive the next feature.

## Decision

Adopt a **hybrid, four-tier strategy**, applied in this precedence order:

| Tier | Owner | Mechanism | Scope |
|---|---|---|---|
| **T1 — Shell chrome** | `ui/src/app/tablet/*`, shell CSS | `@media (orientation: …)` at the shell level only | Rail, tab bar, insets, shell-level column count |
| **T2 — Page content (desktop & wide shells)** | page `.css` | **Container queries** (`@container`) keyed on the space the shell grants | Everything inside the shell's content slot |
| **T3 — Escape hatch** | `ui/src/registries/page-registry/index.ts` | A **declared** layout/orientation preference on the page registration | Pages that genuinely need a different structural tree |
| **T4 — Enforcement** | `ui/src/__tests__` walker suite | A walker that fails a sheet claiming adaptiveness without a mechanism, and a page whose declared layout is not consumed | The whole `ui/src` CSS corpus |

**T1.** Orientation media queries are permitted **only at the shell**, where the shell owns the
whole viewport and there is exactly one of them to keep in step. This is the `SetupWizard.css`
pattern generalized, and it is the tier that fixes the keyboard trap: the shell is where column
count, rail collapse and inset padding change together on rotation.

**T2.** Page content adapts to **its container**, not to the viewport. The shell declares the
container (`container-type: inline-size` on the content slot); every page `.css` uses
`@container` and container-relative units. A page written this way is correct in portrait and
landscape, in a narrow shell, and in a preview surface, from one set of rules.

**T3.** The escape hatch is **declared, not discovered.** `PageRegistration`
(`ui/src/registries/page-registry/index.ts:42-64`) gains a layout field alongside the existing
`route` / `component` / `label` / `feature` / `requiredRole` / `requiredPermission` /
`icon` / `fullscreen`. `fullscreen` is the precedent: a page can already declare that the shell
must change shape for it, and the shell honours it. The new field carries the same contract — a
page says what it needs, the registry is the one place that records it, and the shell is the one
place that reads it. A structural orientation need becomes data, reviewable in a diff, rather
than a `useOrientation` call buried in a component.

**T4.** Enforcement is a **walker suite** in the existing five-suite family
(`docs/audits/frontend/css-verification.md`), because that is the only thing in this repo that reads
`.css` at all. Two assertions: (a) a stylesheet that declares an orientation branch outside the
shell, or a second copy of the landscape literal, fails; (b) a page registration whose declared
layout is not consumed by a call site fails. It prints its denominator, like its siblings.

**Explicitly rejected as a mechanism:** `screen.orientation.lock`. It is not a fallback, it is
a no-op (`ui/src/app/tablet/TabletAppShell.tsx:40-43`). If the product ever wants a
landscape-only build, the enforceable mechanism is the Android manifest
(`android:screenOrientation="sensorLandscape"` on `.MainActivity`), not a web API — and that is
a product decision, not a layout one.

## Options rejected

### A — Orientation lock as the strategy (JS `screen.orientation.lock`, re-added)
**Rejected: it does not work on the target hardware, and it fails silently.** Re-measured
2026-09-20: the hook reports `supported: false` in the Android WebView, so a lock is not
best-effort — it is nothing at all, and the failure mode is invisible (`.catch(() => {})` at
`ui/src/hooks/useOrientation.ts:131-135` swallows the rejection). It also does not help the
Tauri window, which is resizable by construction, and it does not help a desktop user who drags
the window taller than it is wide. Adopting it would re-introduce the belief that caused the
original defect.

### B — A single global all-CSS media-query pass (viewport `@media` everywhere, all 115 sheets)
**Rejected: correct in principle, unbounded in cost, and blind to its own container.**
The migration is every unresponsive sheet, and there is no gate that can tell a sheet that
handles orientation from one that merely happens to look fine at the size the author used.
Worse, it encodes the wrong axis: a page inside the shell does not see the viewport, it sees the
content slot, so a viewport query gives the wrong answer in a split view, a modal, or a harness
frame. It also repeats the literal `(orientation: landscape)` across 115 files with nothing but
a comment keeping them in step — the exact failure the current single-rule file already
documents (`ui/src/hooks/useOrientation.ts:3-11`).

### C — JS-driven layout (React re-render on orientation change)
**Rejected: it pays for a re-render to do what CSS does at zero cost, and it puts layout state
in the tree.** Rotation would tear down and rebuild layouts, re-running effects and losing
transient component state (focus, scroll position, an open popover) on every rotate. It also
multiplies the test surface: every screen would need verification at two sizes, where a media
query needs one sheet. Kept, deliberately, as the **narrow** T3 escape hatch — for structural
needs CSS cannot express, and only when declared in the registry. `useOrientation` remains in
the tree for exactly that purpose and is not deleted.

### D — Do nothing / defer
**Rejected: it is already failing on shipped hardware.** The keyboard trap is reproducible today
on a rotating device, the window is resizable today, and 97 of 115 sheets are unresponsive today.
"Do nothing" is not a neutral option when the measured state is a defect with a user-visible
consequence.

## Consequences

**Positive**
- **Rotation costs no React work.** Every tier except T3 re-lays-out in CSS with no re-render, so
  focus, scroll and transient state survive a rotate.
- **81% fewer orientation literals** than Option B: the literal appears once, at the shell,
  instead of in every sheet.
- **Pages become context-correct, not device-correct.** A container query is right in a shell, a
  preview, a modal and a harness frame; a viewport query is right in exactly one of those.
- **The accessibility consequence is the point.** The keyboard trap is the reason this is an
  ADR and not a refactor ticket: it is a WCAG-relevant failure (content and controls unavailable
  when the keyboard is up) that no amount of styling polish fixes while the layout assumes an
  orientation the device does not have.
- **The escape hatch is reviewable.** A structural orientation need shows up as one line in a
  registration diff, and the walker can assert it is consumed.

**Negative / costs**
- **Two mental models in one codebase.** Readers must know when a media query is allowed (shell)
  and when a container query is required (page). That is mitigated only by T4.
- **A new registry field is a public contract.** `registerPage` is called from feature
  `register.tsx` files; adding a field is additive and safe, but *consuming* it is shell work
  that must land with the field or the field is inert.
- **Container queries have a browser floor.** They are available in the target Tauri/WebView
  versions this product ships, but any future embedded target older than that needs a fallback,
  and the fallback is a viewport query — which is Option B's shape for that one target.
- **The gate is new tooling.** The five walker suites grade fixed shapes with printed
  denominators; a sixth inherits the same caveat that a printed denominator is not coverage.
- **The 97-sheet migration is not free.** It is a per-sheet change (below), each of which is a
  visual change that needs verification at two sizes.

**Neutral**
- `useOrientation` stays. It is not deprecated by this decision; it is scoped to T3.
- `--bp-*` tokens stay width-only. T2 deliberately moves page adaptiveness off tokens and onto
  container width; the tokens remain correct for the shell's own widths.

## Migration slices

Each slice is independently landable and independently verifiable. **Slices 0-7 are landed.**

| # | Slice | Content | Done condition |
|---|---|---|---|
| **0** | Wizard landscape *(shipped)* | `SetupWizard.css:604-659` — one orientation media query, the container widens, presets go three-up, features two-up, preview moves beside the presets. Pinned by `ui/src/__tests__/setupWizardLandscape.test.ts`. | Exists. This slice is the pattern T1 generalizes. |
| **1** | Registry field + shell consumption | Add the layout/orientation preference to `PageRegistration` and read it in the shell. No page sets it yet. | A registration that sets the field changes the shell layout; a registration that does not, does not. **Done** (`9f26373f1`, `17765ab6e`, `cbf4557f2`). |
| **2** | Shell declares its container | `container-type: inline-size` on the shell content slot; document the slot in the shell CSS. | A page `.css` can use `@container` and see the slot's width, not the viewport's. **Done** (`1e6d6bd8e`). |
| **3** | Shell orientation tier (T1) | Shell chrome gets its `@media (orientation: …)` rules — rail, tab bar, insets, shell column count. | Rotating the app re-lays-out the shell with no React re-render. **Done** (`c4b26328a`; `AppLayout.css:658`, `tablet.css:437`). |
| **4** | Walker suite (T4) | The sixth CSS walker: orientation literal outside the shell fails; unconsumed declared layout fails. | The suite fails on a planted violation and prints its denominator. **Done** (`4748e24df`, `5964fb7ef`; verified end-to-end by planting a real violation and watching it fail at file:line). |
| **5** | Page migration, by feature | Convert page `.css` to container queries, feature by feature, largest first. | Each converted feature is verified at both orientations in its own slice, not in a batch. **Partially done** — 13 sheets migrated (RetailPos `952aaa0f8`+`715816be`, KDS `97bae2095`, PosScreen `b37236d56`, SalesHistory `cbf225512`+`4d8dc48b`, PaymentModal `a83995896`, EodReport `13b5e663b`+`a5e2933e5`, CartPanel `6de083368`, KDS Expo `cea903e93`, TransitAudit `da373a7a7`, CategoryManagement `edb7f500a`, StaffManagement `db903d694`, MultiStoreDashboard `f8e628cce`, InventoryReport `52315a453`). **The narrow-shell census reports 20/20 container tiers across 11 registered sheets with 0 findings** — every registered sheet now has a rule at the 640px narrow-shell case, and the two former coverage gaps (RetailPos, SalesHistory — both previously pinned at an 880px floor) are closed. Remaining unresponsive sheets are future work under the same gate. |
| **6** | Keyboard-trap verification | A check that a focused field plus an open on-screen keyboard leaves the submit control reachable, in both orientations. | One runnable check per migrated form-bearing screen. **Done** (`e93880a16`; 5 tests, 2 form screens, 0 gaps). |
| **7** | Narrow-shell verification | Confirm the container-query pages behave in a shell narrower than the tablet, and in a desktop window dragged to portrait. | The extreme-aspect-ratio case is exercised, not assumed. **Done** (`9d18ecf84`, `f9dd06ac2`, `ed3e941f2`; 8 tests, 6 sheets registered, 9 tiers graded, 2 gaps pinned as findings). |

**Sequencing constraint:** slice 4 must land **before** slice 5 is broad. A gate that arrives
after the migration is measuring a tree it can no longer change cheaply.

## Verification commands

Re-derive the two instrumented readings before quoting this record:

```bash
# Orientation rules that exist today (expect 3: one rule, one comment, one test)
grep -rn "@media[^{]*orientation" ui/src

# The responsive gap, by file count
find ui/src -name '*.css' -not -path '*/node_modules/*' | wc -l
grep -rln "@media[^{]*orientation" ui/src --include='*.css' | wc -l

# The breakpoint tokens the design system declares (width only, 268-272)
grep -n "--bp-" ui/src/theme/tokens.css

# The walker family; the orientation suite (T4) is the sixth member and DOES assert orientation
sed -n '13,20p' docs/audits/frontend/css-verification.md
```

**Measured 2026-10-21** (replaces the briefed 97/115 figure, which no command reproduced):

```
find ui/src -name '*.css' | wc -l                           → 139   (all sheets)
find ui/src/features -name '*.css' | wc -l                  → 106   (feature sheets)
grep -rln '@media' ui/src/features --include='*.css' | wc -l →  66   (feature sheets with ANY @media)
   ⇒ 40 of 106 feature sheets (38%) declare no @media at all
```

The walker prints the same population live (`139 sheets parsed; 106 feature sheets fenced`), so the
denominator is self-auditing rather than quoted. The honest figure is **40 of 106 feature sheets
carry no width or orientation query**; the T4 gate is what keeps it visible.

> last written 21-10-26 — status **Implemented**; not yet audited.
