# ui-coder-1 Journal — Dead CSS Token Reference Repair

## Mission

Repoint **dead** `var(--token)` references in 9 fenced feature stylesheets to the real
tokens defined in `ui/src/frontend/themes/tokens.css`. Bug fix, not a redesign: each
declaration resolved to *nothing* at computed-value time — `font-size` fell back to
`inherit`, colours pinned to their dark hex fallback even under `[data-theme='light']`,
and whole `transition` shorthand lists were dropped as invalid.

Ground truth for token names: `ui/src/frontend/themes/tokens.css` only. The
`dev/design-language.html` shorthand names (`--bg`, `--primary`, `--r-sm`) are demo
vocabulary and were never copied in.

## Commit

| SHA | Subject | Files | Diff |
|---|---|---|---|
| `5080ae95` | `fix(ui): repoint dead css token references to real tokens` | 9 | 59 insertions(+), 59 deletions(-) |

Pure 1:1 token-name substitution — the equal insertion/deletion count is the proof that
no line was added, removed, or restructured.

> **`c0faee34` is a dead SHA — see "Concurrent reset" under Incidents.**

## Files changed (exact)

1. `ui/src/features/locations/TopologyRevisionBrowser.css` (15 lines)
2. `ui/src/features/locations/TopologyScreen.css` (1)
3. `ui/src/features/memo/MemosScreen.css` (1)
4. `ui/src/features/reports/CustomReportScreen.css` (13)
5. `ui/src/features/settings/WorkspaceSettingsModal.module.css` (11)
6. `ui/src/features/settings/LicenseSettings.css` (3)
7. `ui/src/features/staff/RoleAuthoringScreen.css` (1)
8. `ui/src/features/auth/SessionLockScreen.css` (3)
9. `ui/src/features/auth/StaffLoginScreen.css` (11)

## Fence deviations (paths, not scope)

Two fenced paths did not exist. Globbed within the same feature tree and used the real
file — same mission, different directory than the fence named:

| Fence said | Actual |
|---|---|
| `ui/src/features/memos/MemosScreen.css` | `ui/src/features/memo/MemosScreen.css` (dir is singular) |
| `ui/src/features/settings/RoleAuthoringScreen.css` | `ui/src/features/staff/RoleAuthoringScreen.css` (different feature dir) |

No other file outside these 9 was staged or committed.

## Mapping decisions

### 1. Type scale — 29 uses (matches scout count exactly)

`--font-size-{xs,sm,md,lg,xl}` defined nowhere in `ui/src/**/*.css` (verified against all
127 stylesheets, not just `themes/`). Repointed by **exact name analogue** to the real
`--text-*` ladder (tokens.css:144-155):

| Phantom | Real | Value |
|---|---|---|
| `--font-size-xs` | `--text-xs` | 0.625rem |
| `--font-size-sm` | `--text-sm` | 0.75rem |
| `--font-size-md` | `--text-md` | 1rem |
| `--font-size-lg` | `--text-lg` | 1.125rem |
| `--font-size-xl` | `--text-xl` | 1.25rem |

Monotonic ladder preserved. Corroborated in-file: `TopologyScreen.css:25,48` and all of
`MemosScreen.css` already use `--text-sm` for identical roles, with the phantom as the
single outlier. The already-repaired sibling `NodeTopologyEditor.css` uses
`--text-xs`/`--text-sm`/`--text-lg` — same house convention.

### 2. Surfaces — 4 uses
`--color-surface` → `--color-bg-surface` (tokens.css:50 dark `#1c1f27` / :361 light `#ffffff`).

### 3. Text colours — 4 uses
| Phantom | Real | Note |
|---|---|---|
| `--color-text-primary` | `--color-fg-primary` | **Deviation from brief.** Brief suggested `--color-fg`; `--color-fg-primary` is the exact-name analogue and both resolve identically in light (`#1a1d23`). |
| `--color-text-tertiary` | `--color-fg-tertiary` | **Deviation from brief.** Brief suggested `--color-fg-secondary`, but `--color-fg-tertiary` exists and is the correct name analogue. Its own hex fallback `#9ca3af` sits next to the real light value `#8e8e93`; `--color-fg-secondary` (`#596577`) would have been a contrast jump. |

### 4. Status — 2 uses
`--color-error` → `--color-danger` (tokens.css:121 `#FF6B68` / :430 `#FC3D39`).

### 5. Spacing — 5 uses (WorkspaceSettingsModal)
Not in the brief; found by the full cross-check sweep. Each real step equals the
declaration's own rem fallback, so the rendered value is unchanged:

| Phantom | Real | Fallback it matched |
|---|---|---|
| `--space-sm` | `--space-3` | 0.75rem |
| `--space-md` | `--space-4` | 1rem |
| `--space-lg` | `--space-5` | 1.25rem |

### 6. Backdrop — 2 uses
`--color-backdrop` → `--color-bg-overlay`, the documented modal-overlay surface token
(tokens.css:53 / :364).

### 7. Border — 1 use (judgement call)
`border-bottom-color: var(--color-border-dim, var(--color-border))` → `var(--color-border)`.

`--color-border-dim` is dead, so the declaration already renders `--color-border` in both
themes today. Mapping to `--color-border-subtle` (alpha 0.06) would have made the rule
nearly invisible — a visual change, not a fix. Collapsing to the live fallback preserves
today's pixels exactly. This is the one place a fallback was removed, and it is forced:
there is no other way to retire a dead name written in that shape.

### 8. Motion — 14 uses
`--duration-120` → `--duration-100`. All 14 are `:hover`/`:active` press-feedback
transitions. Chose 100 over 150 because (a) 100 is numerically nearer 120 (Δ20 vs Δ30),
and (b) the design language caps press feedback at ≤120ms — 150ms would break that
contract. All 14 repo-wide occurrences of `--duration-120` were in my fence; none remain.

## Brief claims that did NOT hold (reported, not silently "fixed")

| Claim | Reality |
|---|---|
| `--duration-250` missing at `SessionLockScreen.css:354-356`, `StaffLoginScreen.css:125-126,307` | Those lines hold `--duration-120`. `--duration-250` appears **nowhere** in my fence. |
| `--color-muted` used in `LicenseSettings.css` / `WorkspaceSettingsModal.module.css` | Not present. Both files use `--color-text-muted`, which **is** defined (tokens.css:68/:379). No change needed. |
| `--color-surface-secondary` / `--color-surface-hover` | Neither name appears in the fence. `WorkspaceSettingsModal` already used the real `--color-bg-hover`. |
| "29 uses incl. … `CustomReportScreen.css:3,7,15,29,49,66,95,120`" | 29 total confirmed, but the per-file line list is short — `CustomReportScreen.css` also had :144, :156, :164, :169, :171 and `TopologyRevisionBrowser.css` had :251, :258. Caught by the sweep, not the list. |
| Preserve `[data-theme='light']` override blocks | **No fenced file contains a `[data-theme='light']` block.** The only theme override is `:global(.dark)` in `WorkspaceSettingsModal.module.css` (5 blocks) — all preserved structurally, name-only edits, fallbacks intact. |

## Verification evidence

All commands run from `ui/`.

**a) Compliance gates** — `themeTokenCompliance` (baseline 0), `colorContrastCompliance`
(69), `forcedColorsCompliance`, plus `topologyThemeParity` (the existing phantom-token
gate, run as a regression guard): green before and after.

**b) Scoped screen tests** — 25 test files, **933 tests passed, 1 skipped, 0 failed**
(901 in the first batch + 32 in the four `.ts` files I initially passed with a `.tsx`
extension). Re-ran 13 of them post-commit at the moved HEAD: 281 passed, 0 failed.
Note `nestedModalDepth`, `focusVisibleCompliance`, `popoverSurfaceCompliance` and
`topologyDiff` are `.ts`, not `.tsx`.

**c) `npm run typecheck`** — `tsc --noEmit`, clean, exit 0 (re-run post-commit, exit 0).

**d) `npx eslint <9 files>`** — 0 errors. All 9 return *"File ignored because no matching
configuration was supplied"*: this project's ESLint config covers TS/TSX only, so CSS is
out of scope. Non-signal, not a failure.

**e) Post-commit blob audit** — re-extracted every `var()` token from the 9 **committed**
blobs via `git show HEAD:<path>`: 272 distinct tokens, **0 phantoms**.

**f) Theme resolution proof** — parsed `:root` and `[data-theme='light']` into value maps
and resolved each repointed name. `--text-*`, `--space-*`, `--duration-*` are deliberately
theme-invariant (113 tokens defined in `:root` only, inherited by light). The colour
tokens now differ per theme, which was the bug:

| Declaration | Light BEFORE | Light AFTER | Dark AFTER |
|---|---|---|---|
| `--color-error` → `--color-danger` | `#ef4444` (pinned) | `#FC3D39` | `#FF6B68` |
| `--color-surface` → `--color-bg-surface` | `#fff` (pinned) | `#ffffff` | `#1c1f27` |
| `--color-text-primary` → `--color-fg-primary` | `#111827` (pinned) | `#1a1d23` | `#f1f5f9` |
| `--color-text-tertiary` → `--color-fg-tertiary` | `#9ca3af` (pinned) | `#8e8e93` | `#94a3b8` |
| `--color-backdrop` → `--color-bg-overlay` | `rgba(0,0,0,.4)` | `rgba(0,0,0,0.45)` | `rgba(0,0,0,0.60)` |

## Incidents

### Self-inflicted, caught and repaired before commit
A batch replacement for `--color-text-primary`/`--color-text-tertiary` carried a stray
closing paren, producing malformed CSS: `color: var(--color-fg-primary), #111827);`
(4 occurrences). Caught by a paren-balance assertion in the same turn, repaired to
`var(--color-fg-primary, #111827)`, and re-verified. Nothing malformed was ever staged.

### Concurrent `git reset` dropped a good commit (external)
My first commit `c0faee34` landed correctly on the branch. Reflog then shows
`HEAD@{1}: reset: moving to HEAD~1` by another agent, which moved the branch pointer off
my commit before they re-committed. My work survived only because `--mixed` leaves the
working tree alone. I re-verified the tree and re-committed as `5080ae95`, now confirmed
an ancestor of HEAD.

**This is the AGENTS.md index race manifesting as a dropped commit rather than a swept
one — a pathspec commit cannot prevent it, because the damage is to the branch pointer,
not the index.** Any coder on this branch should re-check `git merge-base --is-ancestor
<my-sha> HEAD` after committing, not just `git show --stat`.

### Transient lock contention
`git commit` hit `.git/index.lock` once; the 15s wait-and-retry succeeded on attempt 2,
per the brief.

### Pre-commit gates
Ran clean both times — `i18n lint: no issues detected`, no gate failed, `--no-verify`
never used.

## Deviations summary

1. Two fence paths corrected to their real locations (`memo/`, `staff/`) — listed above.
2. `--color-text-primary` → `--color-fg-primary` (brief said `--color-fg`) and
   `--color-text-tertiary` → `--color-fg-tertiary` (brief said `--color-fg-secondary`),
   both to use the exact-name analogue that exists in `tokens.css`.
3. `--color-border-dim` collapsed to `var(--color-border)` rather than mapped to
   `--color-border-subtle`, to avoid changing the rendered value.
4. Found and fixed 8 phantom uses the brief did not list (`--space-{sm,md,lg}` ×5,
   `--color-backdrop` ×2, `--color-border-dim` ×1) — **61 total uses**, not 29+4+4+14.
5. Reported 4 brief claims that did not survive verification (above).
