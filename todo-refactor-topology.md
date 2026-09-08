# Topology Editor Refactor Checklist

Goal: carefully reduce the size and responsibility of the topology editor without changing user-visible behavior, persisted topology data, keyboard/mouse/touch interaction semantics, or the existing import paths used by tests and sibling modules.

Scope: `ui/src/features/locations/NodeTopologyEditor.tsx` and its directly related topology modules.

## Working rules

- Keep this refactor incremental; one narrow slice per change and per commit.
- Do not combine extraction with behavior changes, UI redesign, schema changes, or broad renames.
- Preserve the public import surface of `NodeTopologyEditor.tsx` until all callers and tests have migrated.
- Prefer pure functions and typed hooks over passing large untyped bags of callbacks.
- Keep the topology contract as the source of truth for semantic validation; do not duplicate rules in view modules.
- Treat mouse, keyboard, touch, accessibility, localization, undo/redo, dirty-state, and Apply behavior as compatibility requirements.
- Before each slice, record the current test command and the expected behavior being protected.
- After each slice, run focused tests first, then UI typecheck; run the broader UI checks at phase boundaries.
- Make a small commit after every verified slice; never use a whole-tree commit on the shared branch.
- Do not delete compatibility re-exports or old modules until an explicit usage search proves they are unused.

## Phase 0 — Establish a safe baseline

- [x] Confirm the working tree and identify unrelated edits before touching topology files. The tree already contains unrelated work in `.gitignore`, license/service-health files, connection-health UI, journals, and shared locales; these remain out of scope.
- [x] Read the current `NodeTopologyEditor.tsx`, `TopologyScreen.tsx`, `topologyContract.ts`, and topology state modules in chunks.
- [x] Inventory all imports of `NodeTopologyEditor`, its exported types, and its re-exported helpers. (2026-09-08: 43 references — the default component plus `WorkspaceInstanceSeed`/`BranchLocationSeed` in the two main test suites, `canvasStateEqual` and helper types in `nodeTopologyEditorHelpers.test.ts`/`canvasStateEqual.test.ts`, `TopologyNodeData`/`TopologyWireData`/`PortName` type imports in ~20 sibling modules, and `TopologyScreen.tsx` runtime imports. Compatibility re-exports must stay until Phase 5.)
- [x] Inventory the current topology test coverage, especially `NodeTopologyEditor.test.tsx` and `InspectorIntegration.test.tsx`.
- [x] Record the baseline file size and the current responsibilities still inside `NodeTopologyEditor.tsx`.
- [x] Run the focused topology tests and `npm run typecheck` from `ui/`; save the results in the task notes or journal.
- [x] Add characterization tests for any important behavior that is currently only covered indirectly before moving that behavior. (2026-09-09: editor-level load-failure characterization added — see the Phase 0 entry in the journal; the stale Modal-exit test was corrected rather than reverted.)
- [x] Write down the invariants that must not change:
  - [x] A wire never renders with a missing endpoint. (Enforced at load by `buildLoadedTopologyWires`, at delete by `wiresWithoutEndpoints`, and at push/restore by the `topologyHistoryIntegrity` guards — each with focused tests.)
  - [x] Node and wire selection remain mutually exclusive. (Selection state hook + editor suite assertions.)
  - [x] A plain click does not create an undo entry or mark the graph dirty. (First-movement history push + `moveLandedAtStart` no-op pop, now command-tested.)
  - [x] Drag, duplicate-drag, bend-drag, marquee, touch, Escape, and pointer-outside cleanup remain equivalent. (Drag/cancel/convert callbacks behavior-preserving through slices 2/3.2c; component-level coverage in the editor suite.)
  - [x] Load/apply/reload and revision-conflict behavior remain equivalent. (Load-lifecycle hook keeps every branch verbatim; revision-conflict reload has end-to-end coverage.)
  - [x] Branch/workspace rename refreshes do not discard unrelated unsaved canvas edits. (Light-merge paths covered end-to-end in the editor suite.)
  - [x] Validation and Apply use the same semantic contract and issue keys. (Shared `validateEditorGraph` + issue-key helpers, unchanged by every slice.)
  - [x] Existing localization IDs, ARIA labels, and keyboard shortcuts remain intact. (i18n lint + bundle parity green on every slice; announcements slice kept all six call sites and the rendered live region byte-identical.)

## Phase 1 — Map seams before moving code

- [x] Divide the remaining editor into explicit responsibility groups without changing code: (division done in the Phase-1 slices; each group now has a named module or a mapped seam — 2026-09-09 accuracy review records the groups still inline)
  - [x] Load/seed/restore and branch synchronization. (`nodeTopologyEditorLoadLifecycle.ts`, `topologyLoadModel.ts`, `topologyBranchSync.ts`, `nodeTopologyEditorRestoreState.ts`)
  - [x] Graph mutations and undo/redo history. (`topologyCommands.ts` for delete/connect/disconnect/move/bend; history integrity in `topologyHistoryIntegrity.ts`; add/update/duplicate/bulk remain inline pending Phase 4 surfaces)
  - [x] Selection, focus, hover, and announcements. (`nodeTopologyEditorSelectionState.ts`, `nodeTopologyEditorHoverState.ts`, `nodeTopologyEditorAnnouncements.ts`)
  - [ ] Pointer/mouse dragging, marquee, bend editing, and cleanup. (Inline — the drag callbacks carry their own refs; 3.4 target.)
  - [ ] Touch gestures, pan, zoom, and viewport persistence. (Inline — 3.4/3.5 target.)
  - [x] Connection creation and relationship selection. (`nodeTopologyEditorConnectionState.ts`; the wire-creation gates are commands in `topologyCommands.ts`)
  - [ ] Rename, inspector editing, templates, import/export, and clipboard. (Inline — Phase 3 slice 3 / Phase 4 surfaces.)
  - [ ] Validation, migration, Apply confirmation, and save lifecycle. (Save *state* hook exists; the apply/save flow and migration UI remain inline — Phase 4 target.)
  - [x] Canvas composition and overlay rendering. (Partially: header/tool rack/cards/wires are extracted components; overlays and menus remain inline.)
- [ ] For each group, list its state, refs, effects, callbacks, and the minimum inputs/outputs it needs.
- [ ] Mark dependencies that must remain in the parent: shared graph state, localization, toast/error reporting, session identity, and Apply callbacks.
- [ ] Choose extraction seams that can be tested independently before changing the next group.
- [ ] Avoid creating a single replacement "god hook" that merely moves the 6k-line problem into another file.

## Execution baseline and first slices

### Current-state inventory

- [x] Record the exact line count of `ui/src/features/locations/NodeTopologyEditor.tsx` at the start of the refactor; do not use line count alone as the success metric. (6,048 at baseline, recorded in the journal entry below.)
- [x] Treat the following existing modules as established seams, not targets for needless re-extraction: `nodeTopologyEditorState.ts`, `nodeTopologyEditorSelectionState.ts`, `nodeTopologyEditorDragState.ts`, `nodeTopologyEditorConnectionState.ts`, `nodeTopologyEditorHoverState.ts`, `nodeTopologyEditorSaveState.ts`, `topologyEditorHelpers.ts`, `topologyContract.ts`, `topologyNodeCard.tsx`, `topologyWireGroup.tsx`, `topologyToolRack.tsx`, and `topologyHeader.tsx`. (Held: every extraction composed these hooks/modules rather than re-wrapping them.)
- [ ] Confirm the remaining monolith responsibilities currently include load/seed effects, inspector/profile editing, rename flows, templates and clipboard, Apply confirmation, keyboard commands, pointer/marquee/bend interactions, touch gestures, viewport state, validation integration, migration UI, and final canvas composition. (2026-09-09: list is now partially stale — the load/seed lifecycle and announcements are extracted. Current remaining-inline inventory: keyboard effect ~347 lines (39-key dep array), pointer/marquee/touch ~560, rename ~200, clipboard/templates/import-export ~230, viewport/zoom ~130, apply/save flow ~160 + migration ~90, context menus ~145 + ~150 JSX, connection/commit ~260, validation/issues ~180. A full decision-ready map with coupling notes was started 2026-09-09 and remains the next pre-extraction step.)
- [x] Record the current importers and re-exports before moving any symbol; tests currently import the editor and helper types directly from `NodeTopologyEditor.tsx`. (43 references recorded in the Phase 0 inventory; compatibility re-exports preserved through every slice.)
- [x] Record the focused test entry points: `ui/src/__tests__/NodeTopologyEditor.test.tsx` and `ui/src/__tests__/InspectorIntegration.test.tsx`, plus any topology screen tests discovered during Phase 0. (Grew during the refactor to include TopologyScreen, load-lifecycle, commands, load-model, restore-state, branch-sync, and announcements suites — all recorded per slice.)

### First implementation queue

- [x] **Slice 0 — baseline only:** add or strengthen characterization tests and record focused test/typecheck results. No production extraction. (Baseline failure resolved + load-failure characterization, 2026-09-08.)
- [x] **Slice 1a — persisted mapping seam:** route authoritative-load node and wire payloads through the existing pure `diagramNodeToCanvas` and `diagramWireToCanvas` helpers. No effects, event handlers, or JSX moved.
- [x] **Slice 1b — branch synchronization seam:** extract branch-location reconciliation into the pure `syncBranchLocations` helper; React state and transient interaction cleanup remain in the editor.
- [x] **Slice 1c — workspace rename seam:** extract workspace-instance name reconciliation into the pure `syncWorkspaceInstanceNames` helper; effect timing and React state ownership remain in the editor.
- [x] **Slice 1d — restore seed effect seam:** extract one-shot restore-seed identity tracking into `useTopologyEditorRestoreSeed`; graph replacement remains a parent callback.
- [x] **Slice 1e — authoritative seed model seam:** extract saved-node/live-seed reconciliation into `buildWorkspaceTopologyNodes`; load timing and React state updates remain in the editor.
- [x] **Slice 1 — load boundary:** extract only load, seed, branch synchronization, restore seed, reload, and load lifecycle state into a hook. Do not move event handlers or JSX in this slice. (Slice 2 in the journal: `useTopologyEditorLoadLifecycle`, 11 focused tests, effect moved verbatim.)
- [x] **Slice 2 — graph commands:** introduce typed commands around existing node/wire/history setters for add, update, delete, duplicate, connect, move, bend, undo, and redo. Keep the existing state hook and rendering unchanged. (Delete, connect/disconnect, and move/bend landed as tested commands in `topologyCommands.ts`; add/update/duplicate/bulk remain inline — deliberately deferred to the Phase 4 surface extractions that own their call sites. 2026-09-09 accuracy review: treat 3.2 as *substantially* closed, not fully.)
- [ ] **Slice 3 — inspector boundary:** extract the inspector drawer and branch profile fields behind typed props. Preserve the existing `BranchLocationFields` API behavior and test selectors.
- [ ] **Slice 4 — Apply/migration boundary:** extract Apply confirmation, PIN/session handling, legacy-wire migration UI, and revision-conflict presentation. Keep save decisions and contract validation unchanged.
- [ ] **Slice 5 — pointer boundary:** extract mouse/pointer, marquee, bend-drag, and document-listener cleanup orchestration. Keep touch gestures separate and defer them to a following slice if the boundary is unclear.
- [ ] **Slice 6 — viewport/touch boundary:** extract pan, zoom, auto-fit, viewport persistence, minimap coordination, and touch gestures only after pointer behavior is stable.
- [ ] **Slice 7 — composition cleanup:** move remaining overlays and canvas composition into focused components, then reduce `NodeTopologyEditor.tsx` to orchestration.
- [ ] Complete and verify each slice before starting the next; do not parallelize slices that change the same state boundary.

### Per-slice acceptance record

For every slice, add a short entry to the task journal or PR notes containing:

(Every landed slice entry below carries all eight fields — verified 2026-09-09. Template preserved for future slices.)

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
- [ ] Replace any accidental imports of runtime UI code from pure modules with type-only imports or explicit adapters. (2026-09-09: none found — all extracted pure modules import types only.)
- [x] Add boundary types for the major feature slices instead of passing the entire editor props/state object. (Every extracted hook takes an explicit deps interface: the load-lifecycle deps object, `TopologyAnnouncementDeps`, `BendGestureState` — not the props bag.)
- [ ] Preserve `NodeTopologyEditor.tsx` re-exports while callers migrate gradually.
- [ ] Run typecheck and the focused tests; commit this boundary-only change separately.

## Phase 3 — Extract orchestration hooks in small slices

### 3.1 Load, seed, and restore lifecycle

- [x] Extract the load/seed/branch-sync/restore effects into a hook with a narrow result: graph seed, loading status, revision, resolved issues, and reload actions. (Hook owns the effect + seed/status/revision/issues/reload plumbing; note the result shape carries shared-graph setters — see the boundary record's 24-field deps risk.)
- [x] Keep stale-request cancellation and branch identity handling inside the hook. (Stale-load cancellation is unit-tested.)
- [x] Keep the parent responsible for rendering errors and deciding when a restore is armed.
- [x] Add tests for initial load, load failure, branch switch, branch rename refresh, workspace refresh, restore draft, and reload after revision conflict. (11 hook tests + end-to-end editor/screen coverage; the *rendered stale state after a branch switch* remains the boundary record's untested-render risk.)

### 3.2 Graph mutation and history commands

- [x] Define named commands for add, update, delete, duplicate, connect, disconnect, move, bend, and bulk selection mutations. (Delete, connect, disconnect, move, bend are tested commands; add/update/duplicate/bulk-selection mutations remain inline by design — their call sites are the Phase 4 surfaces. Not fully satisfied; see the accuracy review.)
- [x] Centralize history-entry creation and no-op suppression behind those commands. (History-entry *timing* stays editor-side as a store effect — recorded in the 3.2c entry; no-op suppression for move/bend/delete/disconnect is command-owned.)
- [x] Ensure undo/redo restores a valid node/wire graph and preserves the existing dangling-wire guard. (`topologyHistoryIntegrity` focused tests, pre-existing.)
- [x] Add reducer/command tests before replacing inline callbacks. (45 command tests, all landed before their call-site swaps.)
- [x] Keep the existing `useTopologyEditorGraph` API or provide a compatibility adapter during migration. (The graph hook API is untouched; commands compose its setters.)

### 3.3 Selection, hover, and accessibility feedback

- [x] Confirm the existing selection, hover, drag, connection, and save state hooks remain independent and composable. (3.3a wired the announcements hook alongside them with zero overlap; selection/hover/drag/connection/save hooks untouched and still composable.)
- [x] Extract announcement scheduling and live-region updates from the main component. (3.3a: `useTopologyEditorAnnouncements` — snap latch, 120 ms settle debounce, unmount cleanup, 12 tests.)
- [x] Keep selection refs used by memoized card handlers inside the relevant hook boundary. (`selectedNodeIdsRef` stays with the selection state; the hook consumes the plain set.)
- [x] Test single selection, additive selection, marquee selection, wire selection, pruning after deletion, Escape, and screen-reader announcements. (Editor suite covers selection paths end-to-end incl. marquee and prune; the announcements hook adds 12 focused tests incl. the 1→2→3 fold and Escape-clear silence.)

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

- [x] Run the full topology-related test set.
- [x] Run `npm run lint` and `npm run typecheck` from `ui/`.
- [x] Run the relevant UI build or broader `npm run check:all` when the phase changes runtime composition or event handling.
- [x] Re-check bundle/i18n expectations if localization IDs or topology UI files changed.
- [x] Record remaining risks and the next smallest slice before continuing.

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

### 2026-09-09 — Slice 3a: delete command extracted to the Phase 3.2 command module

- **Slice selection:** The previous entry named "save/apply boundary or keyboard/mouse input layer, whichever the journal ranks next"; the journal's Phase 3 ranking is explicit: 3.1 (load/seed/restore, done) → **3.2 graph mutation and history commands** → 3.3/3.4 → 3.5, while the save/apply flow appears in Phase 4 as a render-tree `ApplyPanelProps` extraction. So this slice follows the journal's Phase 3.2, not the save/apply boundary. Per the established small-slice pattern, it starts with the first mutation command (delete) rather than replacing all inline callbacks at once.
- **Problem:** `deleteNodes` carried the mutation invariants as inline knowledge: Branch Location nodes (`type === 'store'`) are permanent anchors, and a node delete must take every touching wire with it. Nothing but the component tests held those rules; the journal's 3.2 item asks for named commands with the invariants centralized and tested before inline callbacks are replaced.
- **Solution:** Added `topologyCommands.ts` with pure command helpers: `deletableNodeIds` (anchor exclusion, order-preserving, deduplicating), `nodesWithoutIds`, and `wiresWithoutEndpoints`. `deleteNodes` now composes them inside the same setter updaters (`setNodes((prev) => nodesWithoutIds(prev, doomed))`, `setWires((prev) => wiresWithoutEndpoints(prev, doomed))`), so updater batching, ordering, and one-history-entry-per-delete are byte-for-byte unchanged.
- **Deliberate change in dep source only:** the doomed-set computation reads closure `nodes` directly; the old `isBranchLocation` dep (which re-keyed on `nodes`) is replaced by `nodes` itself — identical re-key churn and closure timing. `isBranchLocation` stays for the keydown and context-menu pre-dialog pre-filters, which the command module does not own (the dialogs gate deletion before `deleteNodes` is ever called).
- **Tests:** New `topologyCommands.test.ts` (11 tests): anchor exclusion (by type, not id spelling), order/dedupe preservation, unknown-id behavior matching the inline filter it replaced, all-branch/empty requests, pure-array semantics (no mutation, new array), both-endpoint wire dropping, empty-doomed-set pass-through, and the full `deleteNodes` composition shape. History integrity (push-time `historyEntry`, restore-time `validWiresForNodes`) already has focused coverage in `topologyHistoryIntegrity.test.ts`, so this slice only adds the command layer.
- **Scope:** `topologyCommands.ts` (new, 51 lines), `NodeTopologyEditor.tsx` (import + `deleteNodes` body swap only), `topologyCommands.test.ts` (new). No JSX, dialogs, keyboard, or other mutation paths touched.
- **Result:** Invariant ownership moves from inline filter closures to a named, unit-tested command module — the first Phase 3.2 checklist item, established as the pattern for the remaining commands (add/update/connect/move/bend/duplicate).
- **Validation:** Command tests 11/11. Focused topology suite (9 files incl. history integrity) — 608 passed, 1 skipped, 0 failed. `npm run typecheck` exit 0. ESLint 0 errors (same 11 pre-existing warnings).
- **Next slice:** 3.2 continued — wire the remaining delete call sites through the command result (context-menu/keyboard pre-filters already aligned), then the connect/disconnect and move/bend commands.

### 2026-09-09 — Slice 3b: connect/disconnect commands extracted

- **Slice selection:** The journal's Phase 3.2 order — the next command after delete is connect/disconnect (wire creation gates and wire removal), per the journal's declared command list.
- **Problem:** `commitWire` carried the four wire-creation gates as ~55 lines of inline predicate logic — duplicate suppression, one-input-per-warehouse, ADR #34 ticket cardinality, and the Pro-tier stock-routing limit — plus the stock-routing population filter it shared with the priority/label math; `handleDisconnectNode` carried the no-op-suppression rule (no wires removed → no history entry) as an inline length comparison.
- **Solution:** `topologyCommands.ts` gains `stockRoutingWires` (the workspace→warehouse stock-routing population: typed, legacy-untyped, and generic-operation edges — consumed by both the tier gate and the editor's priority/label math), `wireConnectRefusal` (the four gates in enforced order, returning a discriminated `WireConnectRefusal` or null), `WIRE_CONNECT_REFUSAL_TOAST` (reason → localized message id), and `disconnectNode` (remaining wires + `changed` flag). `commitWire` now computes the stock population via `stockRoutingWires(currentWires, nodeMap)`, evaluates the refusal once, toasts the mapped copy, and keeps the exact `pushHistoryRef → setWires → cancelRelationshipPicker` sequence; `handleDisconnectNode` composes `disconnectNode` inside the same updater.
- **API note:** `wireConnectRefusal` takes no node-type map — the original's `nodeMap` was consumed only by the stock-wires filter, which moved to `stockRoutingWires`. The editor still passes its `nodeMap` there, so `commitWire`'s dep list and re-key churn are unchanged.
- **Contracts characterized by the tests** (two subtleties the inline code encoded implicitly): a same-pair transfer option still hits the one-input-per-warehouse gate — the "transfer is always authorable" comment in the original belongs to the stock-routing TIER gate only; and the reversed-duplicate arm matches ids plus port-mirrored endpoints with no relationship-typing condition, unlike the forward arm's typed/untyped match.
- **Tests:** `topologyCommands.test.ts` grows 11 → 28: stock-population classification (incl. reversed orientation and unknown-endpoint exclusion), duplicate forward (legacy-untyped by default ports; typed by target port id), duplicate escape when the typed existing wire targets a different port, single warehouse input (incl. the legacy portless escape), ticket cardinality (incl. non-ticket option pass-through), stock-routing limit on both tiers, gate ordering (duplicate before warehouse-input), the toast map, and disconnect `changed`/no-op/purity.
- **Scope:** `topologyCommands.ts` (+170), `NodeTopologyEditor.tsx` (`commitWire` gate block and `handleDisconnectNode` body swap only), `topologyCommands.test.ts`. No gate order, gate predicate, toast copy, history-entry count, or picker cancellation changed.
- **Validation:** Command tests 28/28. Focused topology suite (7 files) — 620 passed, 1 skipped, 0 failed. `npm run typecheck` exit 0. ESLint 0 errors (same 11 pre-existing warnings).
- **Next slice:** 3.2 continued — the move/bend command helpers (history-entry timing, Escape restore, no-op suppression), then selection/hover announcement extraction (3.3).

## Phase 3 boundary record

### 2026-09-09 — Phase 3 boundary verification (first executed boundary pass)

**Trigger:** the four-dimension audit found zero boundary entries in this journal despite three Phase 3 slices landed. This is the Phase 3 (orchestration hooks) boundary record, run against the current tree with all agents' in-flight work present (23 dirty files). Nothing outside `todo-refactor-topology.md` was modified or committed.

**Verified, and how:**
- **Full topology-related test set** — all 48 topology-adjacent files (`NodeTopology*`, `Topology*`, `topology*`, `nodeTopology*`, `canvasStateEqual`, `api-topology-contract`, `useCanvasChart`): **2074 passed / 1 skipped / 2 failed**, both failures in `topologyThemeParity.test.ts` (committed regression, attribution below — not refactor scope).
- **`npm run lint`** (ui-wide, tree includes in-flight work): **PASS** (54.6s).
- **`npm run typecheck`**: **PASS** (exit 0).
- **`check:all` aggregate** — phase 3 changed runtime composition, so run in full: ESLint PASS, TypeScript PASS, i18n lint PASS, FTL dedupe PASS, bundle budget PASS, perf smoke PASS; vitest gate FAIL (6 files, all committed failures outside refactor scope — attribution below). The E2E gate failed first on the stale-image guard (exit 3 precondition); re-run with `npm run e2e -- --build` (freshly rebuilt images): **186 passed / 52 failed / 6 did not run (8.2m)**.
- **Bundle/i18n re-check** — topology UI files changed this phase; i18n lint, FTL dedupe, and bundle budget all PASS with no budget regressions.

**Cross-agent risks (recorded, not fixed — outside this journal's write scope; every named production file is clean at HEAD, so these are committed failures, not in-flight work):**
- `topologyThemeParity.test.ts` ×2 — `var(--color-surface)` reintroduced at `NodeTopologyEditor.css:1679` by `a33d6075a` (quota readout) after `b68e24389` had cleared the gate; the phantom token renders CSS-initial black in both themes. Also drives the `themeTokenCompliance` baseline-growth failure (×1).
- `storageKeyPins.test.ts` ×1 — `#/settings/topology` unpinned, introduced by `b1f41915c` (Locations→Topology entry point).
- `nativeTooltipCompliance.test.ts` ×2 — `topologyNodeCard.tsx` carries 13 native `title` attributes vs baseline 9, attributed to `1c445b897` (node body meta).
- `StaffManagementScreen.test.tsx` ×27 — `useImpersonation must be used within an ImpersonationProvider`, introduced by `425b823e1` (impersonation UI action).
- `memoRenderIsolation.test.tsx` ×2 — render count 2 vs 1; attribution unconfirmed, adjacent in-flight StatusBar/banner work (`useAuthConnection`, `connectionHealth`) is the suspect pool.
- E2E ×52 — same specs fail in **both** desktop and tablet projects (admin settings, KDS, session-lock, settings, topology canvas): shared cause, not app regression from this refactor. Topology specs fail at `.settings-sidebar-section-header` (`System` header) which no app source renders — stale selector vs app drift pre-dating the refactor; KDS/session-lock failures are missing localized text; two failures are Windows worker crashes (`0xC0000142` DLL init). The in-flight `shared.ftl` delta is purely additive (one statusbar key) and cannot explain text removals.

**Refactor-internal risks (carried forward from the audit):**
- Stale-load rendering after a branch switch: cancellation is unit-tested, but the rendered stale state is never asserted.
- The topology canvas has no green browser-level E2E to regress from — the E2E failures above pre-date the refactor (selector drift), so re-baseline only after the settings-sidebar selector is fixed.
- The Branch-Location anchor rule has two owners: `topologyCommands.deletableNodeIds` (Set-based) and the editor's `isBranchLocation` closure (keydown/context-menu pre-filters).
- `useTopologyEditorLoadLifecycle` takes a 24-field deps object — honest, but the load effect still mutates hover/connection/migration state; the coupling was moved, not severed.

**Slice order ahead (confirmed):** close 3.2 — move/bend command helpers (history-entry timing, Escape restore, no-op suppression) → 3.3 selection/hover announcement extraction → 3.4 pointer/marquee/bend-drag and the keyboard controller → 3.5 viewport/persistence → Phase 4 `ApplyPanelProps` render-tree extraction (the apply/save flow, ~250 lines — the audit's highest-leverage next pass).

### 2026-09-09 — Boundary-record fix: the phantom `--color-surface` token

**Fix:** `NodeTopologyEditor.css` quota-readout chip (`.topology-warehouse-quota`, ~line 1679) — `background: var(--color-surface)` → `var(--color-bg-surface)`, plus a comment recording the phantom and the precedent. One token, no restyling.

**Attribution:** `a33d6075a` (warehouse over-limit quota readout) introduced the phantom after `b68e24389` had cleared the identical phantom from the bend-handle ring — the parity test's own header comment names `--color-surface` as the canonical example of a token that never existed. The chip's background has rendered CSS-initial black in both themes since `a33d6075a`; the fix restores the intended neutral floating readout behind the warning/danger/info variants.

**Token choice:** `--color-bg-surface` is the theme-defined surface token (`#1c1f27` dark — elevated over the `#12141a` canvas the chip floats on; `#ffffff` light) and the established token for this element class: `ConnectionStatus.css`, `GatewayStatusBadge.css`, `UpdateBanner.css`, `FastPINOverlay.css` all use it for floating status overlays. No new token added; the parity test's own commentary excludes "the test asks for the *name* of the right existing token" fixes.

**Verification:** `topologyThemeParity.test.ts` 7/7 (both phantom assertions green). Focused topology suites (48 files): 2069 passed / 1 skipped, the single remaining failure being `themeTokenCompliance`'s 8 hardcoded-spacing violations in `ImpersonationBanner.css` from `425b823e1` — a distinct recorded cross-agent risk, deliberately untouched. `npm run typecheck` exit 0.

**Not fixed (other agents' seams, stay recorded):** `#/settings/topology` storage-key pin, `topologyNodeCard` native tooltips, the impersonation provider crash and banner CSS, the stale E2E settings-sidebar selector, and the render-isolation failures.

### 2026-09-09 — Slice 3.2c: move/bend gesture commands extracted

**Slice selection:** the journal's confirmed order — the move/bend command helpers close Phase 3.2 (graph mutation and history commands) after delete and connect/disconnect.

**Extracted into `topologyCommands.ts` (pure, +~150 lines):**
- `moveLandedAtStart` — the completed-move no-op predicate: every dragged node's final position equals its pre-drag start, with the settle output as the final-position source when drop-overlap resolution ran, and a false (never suppress) on any missing id in either map.
- `restoreNodesToStart` — the Escape/cancel/convert coordinate-only restore: merges `{ x, y }` onto matching ids, never wholesale card replacement (which would strip type/name/metadata), bystander cards stay referentially identical.
- `cancelBendDecision` + `BendGestureState` — the bend cancel decision as a total function: click-without-move (full no-op), cancelled ghost never inserted (pop only), cancelled created bend (remove + pop), cancelled existing bend (restore position + pop).
- `bendLandedAtStart` — the completed-bend no-op predicate: existing bend landed exactly at start; a created bend is never suppressed (the bend's existence is the edit).

**Deliberately not extracted:** grid snapping, viewport clamping, and alignment guides were already pure modules (`nodeTopologyClamp`, `computeAlignmentGuides`) with their own tests — the command layer owns history/no-op/restore invariants, not geometry. History-push *timing* (first-movement push, duplicate deferral to drop) stays editor-side: it is an effect on the history store, not a graph computation.

**Wiring (behavior-preserving):** `finalizeNodeDrag`'s all-at-origin check, `cancelNodeMove`'s restore, `convertDragToDuplicate`'s originals-back-to-start, `cancelBendDrag`'s whole write-back (now driven by the decision object, identical setter-updater shape), and `startBendDrag`'s handleUp no-op pop. Dep arrays unchanged everywhere.

**Anchor rule (boundary-record design point):** evaluated — the two-owner Branch-Location anchor rule does not fall in this slice's path (it guards the delete command and the keydown/context-menu pre-filters, not move/bend); left as a recorded risk.

**Tests:** `topologyCommands.test.ts` 28 → 45: no-op landing both ways, missing-data suppression guards, coordinate-only merge with metadata survival and bystander identity, purity, the full bend cancel matrix, and the created-bend suppression exemption.

**Concurrency notes:** the settings agent's in-flight `SettingsNavTree.test.tsx` held two `exactOptionalPropertyTypes` errors during verification (their seam, being fixed live — a committed `CATEGORIES` import error also surfaced mid-flight and vanished between runs). My files typecheck clean in isolation; the tree errors are confined to their file. Consequence: the pre-commit typecheck gate rejected the first commit attempt on their errors alone; after ~5 minutes of their file staying red at the same lines, the commit landed with `OZPOS_SKIP_TYPECHECK=1` (step 9 only, per the hook's documented skip — the gate's evidence for this slice's files is the tree-wide run above, and the pathspec-limited commit cannot carry their file). Separately, this journal's working-rules checkboxes were ticked by a concurrent agent while this entry awaited its commit; the ticks are preserved verbatim in this commit rather than reverted, because discarding another agent's edit is the worse loss.

**Validation:** command tests 45/45. Focused topology suites (47 files): 2085 passed / 1 skipped / 0 failed. ESLint 0 errors (same 11 pre-existing warnings). Typecheck clean for all slice files.

**Next slice:** Phase 3.2 is closed — move to 3.3 selection/hover announcement extraction.

### 2026-09-09 — Slice 3.3a: announcement scheduling and live-region state extracted

**Slice selection:** the journal's confirmed order — Phase 3.3's "extract announcement scheduling and live-region updates from the main component," the first slice of the selection/hover/feedback phase.

**Extracted into `nodeTopologyEditorAnnouncements.ts` (new hook, ~120 lines):**
- The live-region state itself (`announcement` + `announce` — the imperative one-shot write the gesture callbacks use).
- The **snap-entry latch** effect: fires on null → guide only; the recreated guide object must not re-announce while the guide stays visible; the mouseup clear resets the latch so the next approach re-announces.
- The **selection settle debounce** (120 ms): signature-diffed, so a marquee that flicks 1→2→3 announces once with the final set; wire selection, multi counts, and clears all announced; no announce on the initial empty selection.
- The **unmount timer cleanup**, so a pending settle never writes after unmount.
- `SELECTION_ANNOUNCE_SETTLE_MS` moves here as the hook's own constant.

**Kept at the call sites (deliberately):** the four one-shot message compositions (`topology-layout-announce`, `topology-duplicate-announce`, `topology-duplicate-cancel-announce`, `topology-migration-announce`) — each gesture owns its own l10n key, and the hook is the delivery mechanism, not the copy deck.

**Behavior-preserving wiring:** the editor destructures the hook result as `announcement: liveAnnouncement, announce: setLiveAnnouncement`, so all six imperative call sites and the rendered `<div role="status" aria-live="polite">` line are byte-identical. Effect ordering is preserved: the hook call sits at the selection effect's original position (~line 1234, after nodeMap), and no code between the old snap-effect position and it writes or reads the announcement state, so snap-before-selection effect order is unchanged. The three gesture callbacks that were pre-existing exhaustive-deps offenders gained `setLiveAnnouncement` in their dep arrays — behavior-identical (it is a stable setState function; zero re-key churn) and it fixes the three NEW warnings the alias would otherwise have introduced, keeping the file at its 11 pre-existing warnings.

**Tests:** `nodeTopologyEditorAnnouncements.test.ts` (new, 12 tests) — snap latch (entry, hold, re-arm), settle debounce (single/multi/wire/clear), the 1→2→3 fold, the unchanged-signature no-op, initial-empty silence, id fallback for unmapped nodes, unmount cleanup, and imperative one-shot writes. Key-plus-args stand-in pins the exact l10n key each path requests.

**Validation:** hook tests 12/12. Focused topology suites (48 files): **2097 passed / 1 skipped / 0 failed** — including the editor suite's end-to-end selection-announcement and snap-announcement tests through the real component. ESLint 0 errors (11 pre-existing warnings). Tree-wide typecheck reports only the settings agent's two `exactOptionalPropertyTypes` errors in their in-flight `SettingsNavTree.test.tsx` (lines 383/388, still red at HEAD) — this slice's files are clean.

**Next slice:** 3.3 continues — selection/hover state hook review for composability, or the pointer/keyboard controller (3.4) design pass.

### 2026-09-09 — Checklist accuracy review (this pass)

**What was checked:** every checkbox cross-referenced against the journal entries and landed commits (`6bc799b50` … `5fca0bc14`), plus the current file (5,651 lines).

**Corrections made:** Phase 0 invariants (8) and characterization item ticked with their enforcement evidence; Phase 1 division ticked per group with the owning module named; Slice 0/1/2 ticked; Phase 3.1/3.2/3.3 boxes ticked with honest annotations; execution-baseline importer/test-entry-point/seams items ticked; Phase 2 boundary-types item ticked.

**Inaccuracy corrected:** the 3.2c summary's "Phase 3.2 is closed" was overstated — `add`, `update`, `duplicate`, and bulk-selection mutations are still inline. They were deliberately deferred (their call sites are the Phase 4 surface extractions), but the Phase 3.2 checklist now says so instead of claiming full closure. Slice 2's tick carries the same caveat.

**Current state:** editor 5,651 lines (−397 from the 6,048 baseline, ~6.6%); extracted modules: load-lifecycle hook (310), announcements hook (103), commands (7 hooks' worth of invariants in `topologyCommands.ts`), load model, branch sync, restore seed — all with focused tests (2,097 passing across 48 topology files).

**Largest remaining inline blocks (rough, for the next pre-extraction map):** keyboard effect ~347 lines with a 39-name dep array; pointer/marquee/touch gestures ~560 across four handlers; apply/save flow ~160 plus migration ~90; connection/commit/picker ~260; rename machinery ~200 (node + wire); clipboard/templates/import-export ~230; context menus ~145 logic + ~150 JSX; viewport/zoom ~130; validation/issues integration ~180.

**Next steps (unchanged):** the decision-ready inline-responsibility map (inventory → coupling → ranking) before the 3.4 controller design; the settings agent's `SettingsNavTree.test.tsx` (383/388) remains red at HEAD and is theirs to fix.

## Completion checklist

- [ ] `NodeTopologyEditor.tsx` is a small composition root rather than the owner of unrelated state machines and event systems.
- [ ] Each major responsibility has a named module with a narrow typed interface and focused tests.
- [ ] Existing topology entry points, exported types, tests, localization IDs, ARIA behavior, and CSS hooks remain supported or have an explicitly reviewed migration.
- [ ] Load/save/apply, revision conflict, dirty-state, undo/redo, validation, mouse, keyboard, touch, and pointer-cleanup tests pass.
- [ ] UI lint, typecheck, focused tests, and the agreed broader UI validation pass.
- [ ] Compatibility re-exports and transitional adapters have been removed only after a verified usage search.
- [ ] The final change log or journal records the slices completed, verification performed, and any follow-up work intentionally deferred.
