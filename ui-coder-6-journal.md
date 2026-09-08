# ui-coder-6 Journal

## Mission

Two scoped hygiene missions on branch 0.0.37, fenced to 18 files:

- MISSION A - type-import hygiene. Clear every
  @typescript-eslint/consistent-type-imports warning inside the fence
  (12 ui/src/__tests__/* files + 4 ui/src/features/locations/topology*.tsx
  files), leaving the react-refresh/only-export-components warnings alone.
- MISSION B - Tooltip align dep + ratchet. Add the missing align
  dependency to the portal-clamp useLayoutEffect in
  ui/src/frontend/shell/Tooltip.tsx, then lower the
  react-hooks/exhaustive-deps ratchet cap 5 -> 4.

## Changes

### MISSION A - 16 files (type-only, runtime-erased)

Two distinct shapes were reported by the baseline lint, and each was fixed in
its own way rather than by one blanket rewrite.

1. Inline import() type annotations (9 test files). These are the
   "`import()` type annotations are forbidden" hits. Converted to a
   top-of-file type import, then referenced by binding name:

   | File | Site | Before -> After |
   |---|---|---|
   | AuditLogScreen.test.tsx | 45 | typeof import('@/contexts/SubscriptionContext') -> typeof SubscriptionContextModule (+ import type * as ...) |
   | DataManagementExport.test.tsx | 43 | same pattern |
   | MemosScreen.test.tsx | 57 | same pattern |
   | EditProductModal.test.tsx | 22 | importActual<typeof import('@/api/products')>() -> typeof ProductsModule |
   | TopologyApplyConfirm.characterization.test.tsx | 37 | vi.importActual<typeof import('@fluent/react')>() -> typeof FluentReactModule |
   | BundleManagementScreen.test.tsx | 27 | children: import('react').ReactNode -> children: ReactNode (+ import type { ReactNode } from 'react') |
   | GiftCardsScreen.test.tsx | 18 | same ReactNode pattern |
   | PurchaseOrderForm.test.tsx | 13 | same ReactNode pattern |
   | SuppliersScreen.test.tsx | 9 | same ReactNode pattern |

2. Value imports used only as types (3 test + 4 topology files).

   - useCanvasChart.test.tsx, useKeyboardAvoidance.test.tsx,
     usePullToRefresh.test.ts: import React from 'react' ->
     import type React from 'react'. React appeared only in type positions
     (React.MutableRefObject, React.RefObject, React.TouchEvent,
     React.UIEvent), and jsx: "react-jsx" means no runtime React binding is
     needed for the JSX. usePullToRefresh.test.ts kept its existing
     double-quote style to avoid an unrelated diff.
   - topologyCanvasZoomControls.tsx, topologyHeader.tsx,
     topologyToolRack.tsx: import { Localized, useLocalization } split into a
     value import of Localized (rendered as JSX) plus
     import type { useLocalization } (used only as
     ReturnType<typeof useLocalization>['l10n']).
   - topologyContextMenu.tsx: useLocalization was the declaration's only
     member and type-only, so the whole statement became import type.

Why typeof X is legal on an import type binding. Before editing, the pattern
import type * as NS from 'mod'; type T = typeof NS was probed against the
project's compiler flags in a throwaway file (exit 0), because a type query
over a type-only namespace import is the one construct here that could
plausibly have been rejected. It is not. The throwaway file was deleted.

Mocking is unaffected. Every converted import is erased at compile time, so
vi.mock factories, vi.hoisted blocks and importOriginal / vi.importActual
calls keep their exact runtime behaviour. This was proven by re-running the
touched suites, not asserted (see Evidence).

### MISSION B - 2 files

- ui/src/frontend/shell/Tooltip.tsx: the portal-clamp useLayoutEffect read
  align in both the bottom and top branches (three-way left / center / right
  anchoring) but listed only [visible, portal, position, triggerRect]. Added
  align, with a comment recording the concrete symptom of the omission:
  changing align while a portal tooltip is visible left the bubble at the old
  offset until an unrelated dep fired.
- scripts/exhaustive-deps-baseline.json: max_exhaustive_deps 5 -> 4, and the
  _note extended to name the four remaining sites and why each is left alone.
  The four were NOT touched: StaffLoginScreen.tsx:170 (cosmetic),
  KdsScreen.tsx:372 (correct as written), NodeTopologyEditor.tsx:2220 and
  :3242 (correct as written).

## Verification

| Gate | Command (from ui/ unless noted) | Result |
|---|---|---|
| a. Lint | npx eslint src --ext .ts,.tsx | 0 consistent-type-imports; exhaustive-deps lists exactly the 4 assessed sites (StaffLoginScreen 170, KdsScreen 372, NodeTopologyEditor 2220 + 3242). Total 61 -> 44 warnings, 0 errors. The 40 remaining non-deps warnings are all react-refresh/only-export-components (out of scope). |
| b. Types | npm run typecheck (tsc --noEmit) | exit 0, clean |
| c. Tests | npx vitest run the 12 touched test files + Tooltip.test.tsx | 13 files / 228 tests passed, 0 failed |
| c+. Topology consumers | npx vitest run NodeTopologyEditor, NodeTopologyEditorDevMock, TopologyScreen, nodeTopologyMemo, topologyWidgets, TopologyRevisionBrowser | 6 files / 586 passed, 1 skipped - proves the 4 topology import type splits broke no runtime import |
| c+. Tooltip consumers | npx vitest run Tooltip, TooltipCompliance, TooltipPreview, SettingsNavTree, EmailReportSettings, LicenseSettings, AnalyticsScreen | 7 files / 262 passed - the added dep changed no existing behaviour |
| d. Ratchet | python scripts/verify-exhaustive-deps.py (repo root) | warnings total: 44   exhaustive-deps: 4   cap: 4 - exit 0 |

Pre-commit gate 9 (npm run typecheck) also ran and passed inside the Tooltip
commit, which staged ui/src TypeScript.

## Commits (final, verified against HEAD)

| SHA | Subject | Files |
|---|---|---|
| 546f6756 | test(ui): convert inline import type annotations | my 16 MISSION A files exactly - 16 files changed, +28/-22 |
| 3406a50e | fix(ui): supply Tooltip align dep and update deps ratchet | ui/src/frontend/shell/Tooltip.tsx, scripts/exhaustive-deps-baseline.json (2 files, +7/-3) |

git show --stat on both confirms neither commit carries a file outside the
18-file fence, and git status --porcelain over all 18 paths is empty.

## Deviations / incidents

1. MISSION A's first commit was swept by a concurrent agent, then unwound by
   that agent's recovery reset. Sequence, read out of the reflog:

   a. I staged exactly my 16 fence files by explicit path and ran
      git commit -m "test(ui): convert inline import type annotations" -- <16 paths>.
      It exited 1 with "no changes added to commit".
   b. git show --stat HEAD explained it: another agent's whole-index commit
      35cf7fa3 (subject "test(licensing): pin the per-feature grant precedence
      in both clients") landed first and consumed my staged 16 files alongside
      its own two subscription_tests.rs files and coder-1-journal.md - the
      exact failure mode AGENTS.md documents. Content correct, attribution lost.
   c. That agent then ran the documented recovery (reset --mixed HEAD~1, then a
      reset back to 108704d9) and replayed its own work. A mixed reset moves
      HEAD but not the working tree, so my 16 files came back to "modified,
      unstaged" with their content intact - verified by re-running the suite
      against the working tree rather than trusting the reset.
   d. I re-committed the set in one motion (git add -- <16 paths>; git commit
      -- <16 paths>) as 546f6756, which is the SHA to review.

   Net: MISSION A is committed once, cleanly, under its own subject. Nothing
   was rewritten by me - no amend, no reset, no stash, no push - because a
   reset on this branch would have destroyed other agents' in-flight commits.
2. MISSION B's commit SHA moved for the same reason: my original 525a29f1 was
   inside the range the concurrent agent reset away, and the identical 2-file
   change was replayed as 3406a50e. Content is byte-identical (Tooltip.tsx
   +6/-1 with the align dep and its comment, baseline json 5 -> 4).
3. Baseline arithmetic differs slightly from the brief. The brief estimated
   ~45 CTI + ~11 react-refresh + 6 exhaustive-deps. The authoritative
   npx eslint src --ext .ts,.tsx run measured 61 warnings as
   16 CTI + 40 react-refresh + 5 exhaustive-deps (the 5th being Tooltip's, the
   one MISSION B fixes). Counts differ; the target set did not - every CTI
   warning in the fence was in one of the 16 files listed above, and all 16
   are now zero.
4. No other deviations. No git add -A/-u, no bare git commit, no --amend, no
   --no-verify, no branch creation or switch, no stash, no push. No file
   outside the 18-file fence was edited. The 4 remaining exhaustive-deps sites
   were deliberately left untouched, and the cap was lowered rather than
   raised.

## Deviations / incidents

1. MISSION A's commit was swept by a concurrent agent. I staged exactly my
   16 fence files by explicit path and ran
   git commit -m "test(ui): convert inline import type annotations" -- <16 paths>.
   It exited 1 with "no changes added to commit". git show --stat HEAD
   explains why: another agent's whole-index commit 35cf7fa3 (subject
   "test(licensing): pin the per-feature grant precedence in both clients")
   landed first and consumed my staged 16 files alongside its own two
   subscription_tests.rs files and coder-1-journal.md - the exact failure
   mode AGENTS.md documents. The content is committed and correct; verified
   with git diff HEAD -- <my 16 paths>, which is empty, so the working tree
   and HEAD agree on every one of my files. I did not amend, reset, or
   re-commit: rewriting a commit that also carries another agent's Rust work
   would destroy it, and a duplicate commit was impossible anyway (nothing
   left to commit). The only loss is attribution - the subject line describes
   licensing, not type-import hygiene. This journal entry is the rationale
   record that AGENTS.md prescribes for exactly this case.
2. Baseline arithmetic differs slightly from the brief. The brief estimated
   ~45 CTI + ~11 react-refresh + 6 exhaustive-deps. The authoritative
   npx eslint src --ext .ts,.tsx run measured 61 warnings as
   16 CTI + 40 react-refresh + 5 exhaustive-deps (the 5th being Tooltip's, the
   one MISSION B fixes). Counts differ; the target set did not - every CTI
   warning in the fence was in one of the 16 files listed above, and all 16
   are now zero.
3. No other deviations. No git add -A/-u, no bare git commit, no --amend, no
   --no-verify, no branch creation or switch, no stash, no push. No file
   outside the 18-file fence was edited. The 4 remaining exhaustive-deps sites
   were deliberately left untouched, and the cap was lowered rather than
   raised.
