# Topology Editor Refactor Checklist

Goal: carefully reduce the size and responsibility of the topology editor without changing user-visible behavior, persisted topology data, keyboard/mouse/touch interaction semantics, or the existing import paths used by tests and sibling modules.

Scope: `ui/src/features/locations/NodeTopologyEditor.tsx` and its directly related topology modules.

## Working rules

- [ ] Keep this refactor incremental; one narrow slice per change and per commit.
- [ ] Do not combine extraction with behavior changes, UI redesign, schema changes, or broad renames.
- [ ] Preserve the public import surface of `NodeTopologyEditor.tsx` until all callers and tests have migrated.
- [ ] Prefer pure functions and typed hooks over passing large untyped bags of callbacks.
- [ ] Keep the topology contract as the source of truth for semantic validation; do not duplicate rules in view modules.
- [ ] Treat mouse, keyboard, touch, accessibility, localization, undo/redo, dirty-state, and Apply behavior as compatibility requirements.
- [ ] Before each slice, record the current test command and the expected behavior being protected.
- [ ] After each slice, run focused tests first, then UI typecheck; run the broader UI checks at phase boundaries.
- [ ] Make a small commit after every verified slice; never use a whole-tree commit on the shared branch.
- [ ] Do not delete compatibility re-exports or old modules until an explicit usage search proves they are unused.

## Phase 0 — Establish a safe baseline

- [x] Confirm the working tree and identify unrelated edits before touching topology files. The tree already contains unrelated work in `.gitignore`, license/service-health files, connection-health UI, journals, and shared locales; these remain out of scope.
- [x] Read the current `NodeTopologyEditor.tsx`, `TopologyScreen.tsx`, `topologyContract.ts`, and topology state modules in chunks.
- [x] Inventory all imports of `NodeTopologyEditor`, its exported types, and its re-exported helpers. (2026-09-08: 43 references — the default component plus `WorkspaceInstanceSeed`/`BranchLocationSeed` in the two main test suites, `canvasStateEqual` and helper types in `nodeTopologyEditorHelpers.test.ts`/`canvasStateEqual.test.ts`, `TopologyNodeData`/`TopologyWireData`/`PortName` type imports in ~20 sibling modules, and `TopologyScreen.tsx` runtime imports. Compatibility re-exports must stay until Phase 5.)
- [x] Inventory the current topology test coverage, especially `NodeTopologyEditor.test.tsx` and `InspectorIntegration.test.tsx`.
- [x] Record the baseline file size and the current responsibilities still inside `NodeTopologyEditor.tsx`.
- [x] Run the focused topology tests and `npm run typecheck` from `ui/`; save the results in the task notes or journal.
- [ ] Add characterization tests for any important behavior that is currently only covered indirectly before moving that behavior.
- [ ] Write down the invariants that must not change:
  - [ ] A wire never renders with a missing endpoint.
  - [ ] Node and wire selection remain mutually exclusive.
  - [ ] A plain click does not create an undo entry or mark the graph dirty.
  - [ ] Drag, duplicate-drag, bend-drag, marquee, touch, Escape, and pointer-outside cleanup remain equivalent.
  - [ ] Load/apply/reload and revision-conflict behavior remain equivalent.
  - [ ] Branch/workspace rename refreshes do not discard unrelated unsaved canvas edits.
  - [ ] Validation and Apply use the same semantic contract and issue keys.
  - [ ] Existing localization IDs, ARIA labels, and keyboard shortcuts remain intact.

## Phase 1 — Map seams before moving code

- [ ] Divide the remaining editor into explicit responsibility groups without changing code:
  - [ ] Load/seed/restore and branch synchronization.
  - [ ] Graph mutations and undo/redo history.
  - [ ] Selection, focus, hover, and announcements.
  - [ ] Pointer/mouse dragging, marquee, bend editing, and cleanup.
  - [ ] Touch gestures, pan, zoom, and viewport persistence.
  - [ ] Connection creation and relationship selection.
  - [ ] Rename, inspector editing, templates, import/export, and clipboard.
  - [ ] Validation, migration, Apply confirmation, and save lifecycle.
  - [ ] Canvas composition and overlay rendering.
- [ ] For each group, list its state, refs, effects, callbacks, and the minimum inputs/outputs it needs.
- [ ] Mark dependencies that must remain in the parent: shared graph state, localization, toast/error reporting, session identity, and Apply callbacks.
- [ ] Choose extraction seams that can be tested independently before changing the next group.
- [ ] Avoid creating a single replacement "god hook" that merely moves the 6k-line problem into another file.

## Execution baseline and first slices

### Current-state inventory

- [x] Record the exact line count of `ui/src/features/locations/NodeTopologyEditor.tsx` at the start of the refactor; do not use line count alone as the success metric. (6,048 at baseline, recorded in the journal entry below.)
- [ ] Treat the following existing modules as established seams, not targets for needless re-extraction: `nodeTopologyEditorState.ts`, `nodeTopologyEditorSelectionState.ts`, `nodeTopologyEditorDragState.ts`, `nodeTopologyEditorConnectionState.ts`, `nodeTopologyEditorHoverState.ts`, `nodeTopologyEditorSaveState.ts`, `topologyEditorHelpers.ts`, `topologyContract.ts`, `topologyNodeCard.tsx`, `topologyWireGroup.tsx`, `topologyToolRack.tsx`, and `topologyHeader.tsx`.
- [ ] Confirm the remaining monolith responsibilities currently include load/seed effects, inspector/profile editing, rename flows, templates and clipboard, Apply confirmation, keyboard commands, pointer/marquee/bend interactions, touch gestures, viewport state, validation integration, migration UI, and final canvas composition.
- [ ] Record the current importers and re-exports before moving any symbol; tests currently import the editor and helper types directly from `NodeTopologyEditor.tsx`.
- [ ] Record the focused test entry points: `ui/src/__tests__/NodeTopologyEditor.test.tsx` and `ui/src/__tests__/InspectorIntegration.test.tsx`, plus any topology screen tests discovered during Phase 0.

### First implementation queue

- [ ] **Slice 0 — baseline only:** add or strengthen characterization tests and record focused test/typecheck results. No production extraction.
- [x] **Slice 1a — persisted mapping seam:** route authoritative-load node and wire payloads through the existing pure `diagramNodeToCanvas` and `diagramWireToCanvas` helpers. No effects, event handlers, or JSX moved.
- [x] **Slice 1b — branch synchronization seam:** extract branch-location reconciliation into the pure `syncBranchLocations` helper; React state and transient interaction cleanup remain in the editor.
- [x] **Slice 1c — workspace rename seam:** extract workspace-instance name reconciliation into the pure `syncWorkspaceInstanceNames` helper; effect timing and React state ownership remain in the editor.
- [x] **Slice 1d — restore seed effect seam:** extract one-shot restore-seed identity tracking into `useTopologyEditorRestoreSeed`; graph replacement remains a parent callback.
- [x] **Slice 1e — authoritative seed model seam:** extract saved-node/live-seed reconciliation into `buildWorkspaceTopologyNodes`; load timing and React state updates remain in the editor.
- [ ] **Slice 1 — load boundary:** extract only load, seed, branch synchronization, restore seed, reload, and load lifecycle state into a hook. Do not move event handlers or JSX in this slice.
- [ ] **Slice 2 — graph commands:** introduce typed commands around existing node/wire/history setters for add, update, delete, duplicate, connect, move, bend, undo, and redo. Keep the existing state hook and rendering unchanged.
- [ ] **Slice 3 — inspector boundary:** extract the inspector drawer and branch profile fields behind typed props. Preserve the existing `BranchLocationFields` API behavior and test selectors.
- [ ] **Slice 4 — Apply/migration boundary:** extract Apply confirmation, PIN/session handling, legacy-wire migration UI, and revision-conflict presentation. Keep save decisions and contract validation unchanged.
- [ ] **Slice 5 — pointer boundary:** extract mouse/pointer, marquee, bend-drag, and document-listener cleanup orchestration. Keep touch gestures separate and defer them to a following slice if the boundary is unclear.
- [ ] **Slice 6 — viewport/touch boundary:** extract pan, zoom, auto-fit, viewport persistence, minimap coordination, and touch gestures only after pointer behavior is stable.
- [ ] **Slice 7 — composition cleanup:** move remaining overlays and canvas composition into focused components, then reduce `NodeTopologyEditor.tsx` to orchestration.
- [ ] Complete and verify each slice before starting the next; do not parallelize slices that change the same state boundary.

### Per-slice acceptance record

For every slice, add a short entry to the task journal or PR notes containing:

- [ ] Slice name and one-sentence responsibility boundary.
- [ ] Exact production files and test files changed.
- [ ] Public imports/re-exports intentionally preserved or migrated.
- [ ] Focused test command and result.
- [ ] `npm run typecheck` result from `ui/`.
- [ ] Behavior explicitly checked manually or through tests.
- [ ] Rollback point: the commit can be reverted without reverting an unrelated slice.
- [ ] Remaining coupling or follow-up work, if any.

### Dependency direction

- [ ] Pure modules may depend on types, constants, and pure contract helpers, but not React context, toasts, browser globals, or API clients.
- [ ] State hooks may depend on pure modules and typed domain actions, but should not render JSX.
- [ ] Feature components may depend on state hooks and pure modules, but API/session access should remain behind the existing screen/editor boundary or a named hook.
- [ ] `TopologyScreen.tsx` remains responsible for branch selection, permission gating, backend loading around the editor, revision browser ownership, and dirty-switch confirmation unless a later slice explicitly changes that boundary.
- [ ] `NodeTopologyEditor.tsx` remains the compatibility entry point until all importers have moved.
- [ ] Do not introduce circular imports between the editor, contract, card, and state modules; use type-only imports or a small shared types module when necessary.

### Stop and reassess conditions

- [ ] Stop the current slice if it requires changing persisted schema, backend APIs, localization IDs, or interaction semantics.
- [ ] Stop if the proposed module needs most of the parent component's state, refs, effects, and callbacks; the seam is too broad and needs to be split.
- [ ] Stop if the extraction requires more than one compatibility adapter or causes broad test rewrites unrelated to the moved responsibility.
- [ ] Stop if focused tests become less specific, require timing sleeps, or lose coverage of cleanup and cancellation paths.
- [ ] Record the coupling problem and choose a smaller seam before continuing; do not solve uncertainty with a large rewrite.

## Phase 2 — Stabilize shared types and boundaries

- [ ] Decide which data types are editor-domain types and which are semantic-contract types.
- [ ] Move only genuinely shared editor types/constants into a small dedicated types module if doing so does not create cycles.
- [ ] Keep semantic graph types and validation errors owned by `topologyContract.ts`.
- [ ] Replace any accidental imports of runtime UI code from pure modules with type-only imports or explicit adapters.
- [ ] Add boundary types for the major feature slices instead of passing the entire editor props/state object.
- [ ] Preserve `NodeTopologyEditor.tsx` re-exports while callers migrate gradually.
- [ ] Run typecheck and the focused tests; commit this boundary-only change separately.

## Phase 3 — Extract orchestration hooks in small slices

### 3.1 Load, seed, and restore lifecycle

- [ ] Extract the load/seed/branch-sync/restore effects into a hook with a narrow result: graph seed, loading status, revision, resolved issues, and reload actions.
- [ ] Keep stale-request cancellation and branch identity handling inside the hook.
- [ ] Keep the parent responsible for rendering errors and deciding when a restore is armed.
- [ ] Add tests for initial load, load failure, branch switch, branch rename refresh, workspace refresh, restore draft, and reload after revision conflict.

### 3.2 Graph mutation and history commands

- [ ] Define named commands for add, update, delete, duplicate, connect, disconnect, move, bend, and bulk selection mutations.
- [ ] Centralize history-entry creation and no-op suppression behind those commands.
- [ ] Ensure undo/redo restores a valid node/wire graph and preserves the existing dangling-wire guard.
- [ ] Add reducer/command tests before replacing inline callbacks.
- [ ] Keep the existing `useTopologyEditorGraph` API or provide a compatibility adapter during migration.

### 3.3 Selection, hover, and accessibility feedback

- [ ] Confirm the existing selection, hover, drag, connection, and save state hooks remain independent and composable.
- [ ] Extract announcement scheduling and live-region updates from the main component.
- [ ] Keep selection refs used by memoized card handlers inside the relevant hook boundary.
- [ ] Test single selection, additive selection, marquee selection, wire selection, pruning after deletion, Escape, and screen-reader announcements.

### 3.4 Input controllers

- [ ] Extract mouse/pointer event orchestration into a controller hook without moving presentational JSX yet.
- [ ] Extract touch gesture orchestration separately; do not merge touch and mouse behavior into one opaque handler.
- [ ] Keep document-level listener cleanup owned by the controller that installs it.
- [ ] Add regression tests for pointer release outside the canvas, window blur, visibility changes, Escape cancellation, duplicate drag, bend drag, and touch cancellation.
- [ ] Verify no handler identity churn regresses memoized topology cards.

### 3.5 Viewport and canvas interaction

- [ ] Extract pan, zoom, auto-fit, viewport persistence, minimap interaction, and cursor readout coordination.
- [ ] Keep geometry calculations in the existing pure modules (`nodeTopologyClamp`, `nodeTopologyLayout`, `topologyWireGeometry`, and related helpers).
- [ ] Add focused tests for zoom bounds, saved viewport restoration, auto-fit suppression after manual movement, and pan/zoom keyboard controls.

## Phase 4 — Extract feature surfaces from the render tree

- [ ] Keep the parent as a thin composition root that wires hooks to feature components.
- [ ] Extract the inspector/drawer surface, including branch profile fields and workspace fields, behind a typed `InspectorProps` boundary.
- [ ] Extract the confirmation and Apply flow behind a typed `ApplyPanelProps` boundary; preserve PIN/session behavior and revision conflict handling.
- [ ] Extract migration/legacy-wire resolution UI and its state transitions.
- [ ] Extract template/import/export/clipboard controls if they are still coupled to the parent render function.
- [ ] Extract canvas overlays and menus that are not already isolated: validation widget integration, relationship picker integration, context menu integration, guides, and selection overlays.
- [ ] Keep `TopologyNodeCard`, `TopologyWireGroup`, `TopologyToolRack`, `TopologyHeader`, and other existing extracted components as stable seams rather than wrapping them in unnecessary pass-through layers.
- [ ] After each extraction, compare rendered DOM roles, labels, class names used by tests, and keyboard focus behavior.

## Phase 5 — Reduce parent responsibilities

- [ ] Make `NodeTopologyEditor.tsx` responsible only for composition, shared context wiring, and the smallest possible cross-feature coordination.
- [ ] Replace repeated inline callbacks with named commands or hook actions where the behavior is already covered.
- [ ] Remove dead imports, stale compatibility comments, and obsolete local state only after tests and usage searches confirm they are no longer needed.
- [ ] Update tests to import extracted pure modules directly where that improves isolation, while retaining a small end-to-end editor suite.
- [ ] Migrate sibling modules away from compatibility re-exports only when the new ownership is stable.
- [ ] Keep a deliberate public entry point for `NodeTopologyEditor` and its supported types.

## Phase 6 — Verification after each slice and at phase boundaries

### Every slice

- [ ] Review the diff for accidental behavior changes or unrelated formatting churn.
- [ ] Run the smallest relevant Vitest test file(s).
- [ ] Run `npm run typecheck` from `ui/`.
- [ ] Check that no new hardcoded user-visible strings or accessibility violations were introduced.
- [ ] Check that no direct `invoke(...)` calls or API mutations were added to components.
- [ ] Commit only the files belonging to the slice with a conventional commit message.

### Each phase boundary

- [ ] Run the full topology-related test set.
- [ ] Run `npm run lint` and `npm run typecheck` from `ui/`.
- [ ] Run the relevant UI build or broader `npm run check:all` when the phase changes runtime composition or event handling.
- [ ] Re-check bundle/i18n expectations if localization IDs or topology UI files changed.
- [ ] Record remaining risks and the next smallest slice before continuing.

## Explicit non-goals during this refactor

- [ ] Do not redesign the topology UI or change the node/wire interaction model.
- [ ] Do not change persisted topology schema, migration behavior, or backend APIs as part of a front-end extraction.
- [ ] Do not replace the editor with a new graph library while extracting it.
- [ ] Do not make broad naming or formatting changes across `ui/src/features/locations`.
- [ ] Do not remove tests because an implementation moved; move or strengthen them instead.
- [ ] Do not optimize rendering based on intuition; measure first and keep performance work separate.

## Refactor journal

### 2026-09-08 — Baseline before first extraction

- **Problem:** `NodeTopologyEditor.tsx` is a large orchestration component and needs a slow, reversible refactor rather than a rewrite.
- **Baseline:** `NodeTopologyEditor.tsx` 6,048 lines; `TopologyScreen.tsx` 981 lines; `nodeTopologyEditorState.ts` 74 lines; `topologyContract.ts` 1,052 lines. The focused editor test file is 11,159 lines and the inspector integration suite is 380 lines.
- **Validation:** `ui/npm run typecheck` passed. `ui/npm run test -- --run src/__tests__/NodeTopologyEditor.test.tsx src/__tests__/InspectorIntegration.test.tsx` ran 519 tests: 517 passed, 1 skipped, and 1 failed.
- **Known baseline failure:** `NodeTopologyEditor — dialog Escape isolation > Escape cancelling the delete dialog keeps the node selected` fails at `NodeTopologyEditor.test.tsx:7020` because the Delete Node dialog remains visible after Escape. This failure predates the refactor and must be resolved or explicitly isolated before claiming a clean refactor milestone. (Resolved 2026-09-08 — see the dialog-Escape entry below.)
- **Decision:** Start with characterization and boundaries; do not change production topology code until the first extraction has a focused acceptance test and a clean comparison against this baseline.
- **Next slice:** complete the import/re-export inventory, then extract only the load/seed/branch-sync/restore lifecycle.
- **Commit:** baseline journal recorded in the current refactor-plan commit.

### 2026-09-08 — Slice 1a: reuse persisted mapping helpers

- **Problem:** The authoritative load path duplicated node and wire payload-to-canvas mapping already used by restore-to-draft, allowing the two paths to drift.
- **Solution:** Replaced both load-path mapping blocks with `diagramNodeToCanvas` and `diagramWireToCanvas` from `topologyEditorHelpers.ts`. Endpoint filtering remains in the load path; semantic normalization and optional-field handling now have one implementation.
- **Scope:** `NodeTopologyEditor.tsx` only for production code; no event handlers, effects, refs, JSX, API behavior, or persisted schema moved.
- **Result:** Editor reduced from 6,048 to 5,996 lines. The remaining load effect is intentionally still in the parent for the next lifecycle slice.
- **Validation:** `ui/npm run typecheck` passed. Focused topology tests ran 519 tests: 517 passed, 1 skipped, and the same baseline Delete Node Escape failure remained at `NodeTopologyEditor.test.tsx:7020`.
- **Rollback:** Revert commit `refactor(ui): reuse topology mapping helpers` without affecting unrelated work.

### 2026-09-08 — Slice 1b: extract branch synchronization

- **Problem:** The load effect mixed pure branch-list reconciliation with React setters and transient hover/connection cleanup, making the first lifecycle seam too broad.
- **Solution:** Added `topologyBranchSync.ts` with pure `syncBranchLocations`. It preserves canonical branch nodes, updates live names, adds new branches at the existing snapped spawn position, filters wires for removed branches, and returns removed IDs for the parent’s transient cleanup.
- **Scope:** `NodeTopologyEditor.tsx` now delegates only the pure reconciliation result; it still owns refs, setters, connection cancellation, hover cleanup, and effect control flow.
- **Tests:** Added `topologyBranchSync.test.ts` covering rename/add/delete reconciliation and legacy store nodes without canonical identity.
- **Result:** Editor reduced from 5,996 to 5,972 lines; the new pure helper is 63 lines and has two focused tests.
- **Validation:** `ui/npm run typecheck` passed. Helper tests passed 2/2. Focused editor/inspector tests ran 519 tests: 517 passed, 1 skipped, and the same baseline Delete Node Escape failure remained at `NodeTopologyEditor.test.tsx:7020`.
- **Next slice:** inventory imports/re-exports, then isolate the load/seed/restore lifecycle without moving JSX or input handlers.

### 2026-09-08 — Slice 1c: extract workspace rename reconciliation

- **Problem:** The load effect also contained a second pure synchronization path for parent refreshes that changed workspace names without changing instance IDs. Keeping it inline mixed data reconciliation with effect control flow.
- **Solution:** Added `syncWorkspaceInstanceNames` beside the branch helper. It updates only changed workspace names and preserves object identity for unchanged nodes, including all non-workspace nodes.
- **Scope:** `NodeTopologyEditor.tsx` still owns the same-ID detection, skip-after-Apply guard, and React setter; only the pure map operation moved.
- **Tests:** Extended `topologyBranchSync.test.ts` with identity and rename assertions.
- **Result:** Editor reduced from 5,972 to 5,967 lines; the shared synchronization module is 81 lines with three focused tests.
- **Validation:** `ui/npm run typecheck` passed. Helper tests passed 3/3. Focused editor/inspector tests ran 519 tests: 517 passed, 1 skipped, and the same baseline Delete Node Escape failure remained at `NodeTopologyEditor.test.tsx:7020`.
- **Next slice:** inventory imports/re-exports, then isolate the load/seed/restore lifecycle without moving JSX or input handlers.

### 2026-09-08 — Slice 1d: extract restore-seed effect

- **Problem:** The editor owned one-shot restore-seed identity tracking and graph replacement in the same inline effect, adding lifecycle bookkeeping to the main component.
- **Solution:** Added `useTopologyEditorRestoreSeed` to own only seed identity and effect timing. The editor now supplies `applyRestoreSeed`, which preserves transient reset, undo/redo clearing, pre-restore snapshotting, and payload mapping exactly as before.
- **Scope:** No restore UI, API calls, validation, Apply behavior, or persisted schema changed. Clearing the prop remains a no-op, and a seed object is still applied once by identity.
- **Tests:** Added `nodeTopologyEditorRestoreState.test.ts` covering one-shot application, prop clearing, and effect behavior.
- **Result:** Editor reduced from 5,967 to 5,952 lines; the new hook is 26 lines and has two focused tests.
- **Validation:** Restore hook tests passed 2/2. Focused editor/inspector tests ran 519 tests: 517 passed, 1 skipped, and the same baseline Delete Node Escape failure remained at `NodeTopologyEditor.test.tsx:7020`. Full `npm run typecheck` is currently blocked by seven unrelated `SettingsNavTree.test.tsx` errors; the new restore files have no reported type errors.
- **Next slice:** inventory imports/re-exports, then extract the remaining load lifecycle boundary without moving JSX or input handlers.

### 2026-09-08 — Slice 1e: extract authoritative seed model

- **Problem:** The authoritative load effect mixed the pure construction of workspace and branch canvas nodes with async loading, cancellation, transient reset, history clearing, and React state updates.
- **Solution:** Added `buildWorkspaceTopologyNodes` to reconcile saved nodes with live workspace instances and branch locations. It preserves saved workspace geometry/metadata, applies live instance fields, adopts legacy branch identity, filters deleted branches, refreshes branch names, and seeds new branches at the existing snapped position.
- **Scope:** `NodeTopologyEditor.tsx` still owns the load effect, cancellation, skip-after-Apply behavior, wire filtering, transient cleanup, migration reset, history, snapshots, and state setters. Only pure node construction moved.
- **Tests:** Added `topologyLoadModel.test.ts` for saved workspace restoration and branch identity/deletion/seeding behavior.
- **Result:** Editor reduced from 5,952 to 5,883 lines; the new builder is 77 lines and has two focused tests.
- **Validation:** Load-model tests passed 2/2. Focused editor/inspector tests ran 519 tests: 517 passed, 1 skipped, and the same baseline Delete Node Escape failure remained at `NodeTopologyEditor.test.tsx:7020`. Full `npm run typecheck` remains blocked by seven unrelated `SettingsNavTree.test.tsx` errors; the new load-model files have no reported type errors.
- **Next slice:** extract authoritative wire filtering/modeling, then consolidate the remaining load lifecycle into a hook.

### 2026-09-08 — Baseline failure resolved: dialog Escape vs modal exit fade

- **Context:** While preparing the load-lifecycle slice, the shared seam was found busy: Slice 1e (`buildWorkspaceTopologyNodes`, commit `b3a52cb36`) had landed from a concurrent session with uncommitted follow-up edits in `NodeTopologyEditor.tsx` and `topologyLoadModel.ts`. To avoid the swept-commit hazard, this slice deliberately touches neither file and instead clears the journal's known baseline failure — the last red test standing between the refactor and a clean focused suite.
- **Root cause:** Commit `a986bc275` (2026-09-08, "feat(ui): add exit animation to the shared modal primitive") added a 200ms CSS exit fade to the shared `Modal` via `useExitAnimation`; Escape now unmounts the dialog asynchronously. The topology test predating that change (`e459c58f6`, 2026-08-07) asserted immediate disappearance synchronously. The editor behavior is correct and unchanged — the test was stale. `a986bc275` itself updated the shared Modal and ConfirmDialog suites to `waitFor`; the topology suite was missed.
- **Fix:** `NodeTopologyEditor.test.tsx` "Escape cancelling the delete dialog keeps the node selected" now awaits the unmount with `waitFor` (and is `async`), matching the Modal and ConfirmDialog suites. The assertion the test exists for — Escape must not let the editor's window-level handler steal the selection — is unchanged and still runs after the dialog is gone.
- **Scope:** `ui/src/__tests__/NodeTopologyEditor.test.tsx` only. No production code changed; `NodeTopologyEditor.tsx` and `topologyLoadModel.ts` untouched (concurrent in-flight edits preserved).
- **Validation:** Isolated test passed. Full focused suite (`npm run test -- --run src/__tests__/NodeTopologyEditor.test.tsx src/__tests__/InspectorIntegration.test.tsx`): 519 tests, 518 passed, 1 skipped, 0 failed — the first fully green focused run of the refactor. `npm run typecheck` exit 0 (the seven unrelated `SettingsNavTree.test.tsx` errors recorded at Slice 1d have also cleared).
- **Next slice:** the load-lifecycle hook consolidation remains the next production slice once the seam is free; the import/re-export inventory is recorded in the Phase 0 checklist above.

### 2026-09-08 — Phase 0: editor-level load-failure characterization test

- **Gap:** The load-failure catch path was covered only at the screen level (`TopologyScreen` asserts `canSave` drops). No editor-level test exercised a *thrown* `loadTopology` rejection (corrupt DB / serialisation failure — distinct from the expected `null` result), so the load-lifecycle hook extraction (next production slice) had no safety net for the error branch.
- **Characterized contract:** a thrown load error must (1) toast the localized "Failed to load topology" category with the USER-SAFE fallback copy (`plainErrorMessage`) — the ERR-06 redaction policy means the raw backend message never renders anywhere; (2) notify the parent with the ORIGINAL error via `onLoadError` (TopologyScreen drops `canSave` and logs the raw detail); (3) leave the canvas untouched — a failed load must never wipe or half-replace the rendered graph.
- **Correction made during characterization:** the first draft asserted the raw detail in the toast; that is wrong by design — the toast carries only the localized category plus fallback copy. The test now asserts the raw message is *absent*.
- **Scope:** `ui/src/__tests__/NodeTopologyEditor.test.tsx` only — `renderEditor` harness gains an optional `onLoadError` prop; one new test. No production code changed; `NodeTopologyEditor.tsx` and `topologyLoadModel.ts` untouched (concurrent in-flight edits preserved).
- **Validation:** Re-verified against the current tree after the concurrent slice landed: isolated test passes; full focused suite 511 tests — 510 passed, 1 skipped, 0 failed; `npm run typecheck` exit 0.
- **Next slice:** the load-lifecycle hook consolidation, once the seam (`NodeTopologyEditor.tsx` / `topologyLoadModel.ts`) is committed and free.

### 2026-09-09 — Slice 1f (adopted): extract authoritative wire filtering

- **Provenance:** While re-checking seam availability, the concurrent session's in-flight edits were found **abandoned** — last touched 20:31 the previous day (~6.5h stale, spanning two of this session's own commits), and they implement exactly that session's stated "next slice": extract the dangling-wire filter into `topologyLoadModel.ts`. Per the concurrency policy (do not discard others' uncommitted work; unblock by verifying and adopting), this slice verifies and commits that work rather than re-deriving it or leaving the main seam blocked indefinitely.
- **Change:** `buildLoadedTopologyWires(persistedWires, validNodeIds)` in `topologyLoadModel.ts` — keeps only persisted wires whose endpoints survived live-node reconciliation, maps survivors through the canonical `diagramWireToCanvas` converter. The editor's load effect now calls it instead of the inline `.filter(...).map(...)` pair.
- **Scope:** `NodeTopologyEditor.tsx` (import + 4-line call-site swap only), `topologyLoadModel.ts` (+13 lines), `topologyLoadModel.test.ts` (+1 test: dangling endpoint dropped, kept wire normalized). No load-order, cancellation, transient-reset, or state behavior changed.
- **Validation:** Load-model tests 3/3. Editor focused suite (510 passed, 1 skipped, 0 failed, 02:55) and `npm run typecheck` (exit 0, 02:56) both ran *with* these edits already in the tree.
- **Seam status:** `NodeTopologyEditor.tsx` / `topologyLoadModel.ts` are now committed and free — the load-lifecycle hook consolidation is unblocked as the next production slice.

### 2026-09-09 — Slice 2: extract the load-lifecycle hook

- **Problem:** The authoritative load effect (~212 lines) mixed the two light-merge fast paths (branch-location rename/seed/delete; workspace name refresh), the full rebuild, the post-Apply skip guard, the unassigned-empty path, the legacy saved-diagram/preset fallback, and the thrown-error boundary into one inline effect — the largest remaining lifecycle block in the editor, plus two private prev-prop identity refs.
- **Solution:** Added `useTopologyEditorLoadLifecycle` (`nodeTopologyEditorLoadLifecycle.ts`) owning the effect verbatim plus the private prev refs. Callbacks are passed as a deps object (restore-seed hook's parameter convention); `snap` is a param (branch-sync convention); `skipNextLoadRef`/`migrationDismissedRef` stay editor-owned because the save flow and migration dialog write them. `cancelMarquee`, `cancelBendDrag`, and `resetTransientCanvasState` were hoisted ~850 lines up, above the call site — the hook call evaluates its arguments during render, so passing `resetTransientCanvasState` required it declared before the call (TDZ); hoisting earlier is order-safe, and the hoisted callbacks' transitive deps (`cancelConnection`, hover, marquee/bend refs, context menu) were verified declared before the insertion point. The call site sits at the exact original effect position, so hook order — and therefore effect order — is unchanged.
- **Scope:** No behavioral change: every branch, comment, cancellation guard, and dependency is copied verbatim; the `eslint-disable-next-line exhaustive-deps` on the dep array moved with it. `loadTopology`, `syncBranchLocations`, `syncWorkspaceInstanceNames`, `buildWorkspaceTopologyNodes`, `buildLoadedTopologyWires` imports left the editor; `diagramNodeToCanvas`/`diagramWireToCanvas` stay (used by `applyRestoreSeed`).
- **Tests:** New `nodeTopologyEditorLoadLifecycle.test.tsx` (11 tests): branch-rename light merge; deleted-branch card/wire/transient cleanup; instance-name merge; structural-change rebuild (with dangling-wire filter and migration-dialog re-arm); post-Apply skip guard (persisted-flag updater only); explicit unassigned empty graph; explicit empty seeds; standalone preset retention; legacy verbatim diagram; thrown-error toast (ERR-06 redaction) + `onLoadError` + lifecycle lock; stale-load cancellation after a branch switch.
- **Result:** Editor 5,881 → 5,714 lines (−167); the hook is 310 lines and fully unit-tested in isolation for the first time (the inline effect was only reachable through component tests).
- **Validation:** Hook tests 11/11. Focused topology suite (7 files: editor, inspector, screen, load model, restore state, branch sync, load lifecycle) — 594 passed, 1 skipped, 0 failed. `npm run typecheck` exit 0 (the test file needed four strict-mode fixes: non-null assertions on indexed mock calls, typed promise executor). ESLint 0 errors; the 11 warnings are pre-existing (compat re-export block + two untouched dep arrays).
- **Next slice:** continue Phase 3 — the save/apply boundary (handleApplyClick + duplicate-commit guard) or the keyboard/mouse input layer, whichever the journal ranks next.

## Completion checklist

- [ ] `NodeTopologyEditor.tsx` is a small composition root rather than the owner of unrelated state machines and event systems.
- [ ] Each major responsibility has a named module with a narrow typed interface and focused tests.
- [ ] Existing topology entry points, exported types, tests, localization IDs, ARIA behavior, and CSS hooks remain supported or have an explicitly reviewed migration.
- [ ] Load/save/apply, revision conflict, dirty-state, undo/redo, validation, mouse, keyboard, touch, and pointer-cleanup tests pass.
- [ ] UI lint, typecheck, focused tests, and the agreed broader UI validation pass.
- [ ] Compatibility re-exports and transitional adapters have been removed only after a verified usage search.
- [ ] The final change log or journal records the slices completed, verification performed, and any follow-up work intentionally deferred.
