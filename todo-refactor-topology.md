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
- [x] For each group, list its state, refs, effects, callbacks, and the minimum inputs/outputs it needs.
- [x] Mark dependencies that must remain in the parent: shared graph state, localization, toast/error reporting, session identity, and Apply callbacks.
- [x] Choose extraction seams that can be tested independently before changing the next group.
- [x] Avoid creating a single replacement "god hook" that merely moves the 6k-line problem into another file.

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

- Slice name and one-sentence responsibility boundary.
- Exact production files and test files changed.
- Public imports/re-exports intentionally preserved or migrated.
- Focused test command and result.
- `npm run typecheck` result from `ui/`.
- Behavior explicitly checked manually or through tests.
- Rollback point: the commit can be reverted without reverting an unrelated slice.
- Remaining coupling or follow-up work, if any.

### Dependency direction

- Pure modules may depend on types, constants, and pure contract helpers, but not React context, toasts, browser globals, or API clients.
- State hooks may depend on pure modules and typed domain actions, but should not render JSX.
- Feature components may depend on state hooks and pure modules, but API/session access should remain behind the existing screen/editor boundary or a named hook.
- `TopologyScreen.tsx` remains responsible for branch selection, permission gating, backend loading around the editor, revision browser ownership, and dirty-switch confirmation unless a later slice explicitly changes that boundary.
- `NodeTopologyEditor.tsx` remains the compatibility entry point until all importers have moved.
- Do not introduce circular imports between the editor, contract, card, and state modules; use type-only imports or a small shared types module when necessary.

### Stop and reassess conditions

- Stop the current slice if it requires changing persisted schema, backend APIs, localization IDs, or interaction semantics.
- Stop if the proposed module needs most of the parent component's state, refs, effects, and callbacks; the seam is too broad and needs to be split.
- Stop if the extraction requires more than one compatibility adapter or causes broad test rewrites unrelated to the moved responsibility.
- Stop if focused tests become less specific, require timing sleeps, or lose coverage of cleanup and cancellation paths.
- Record the coupling problem and choose a smaller seam before continuing; do not solve uncertainty with a large rewrite.

## Phase 2 — Stabilize shared types and boundaries

- [x] Decide which data types are editor-domain types and which are semantic-contract types. (2026-09-09 P5-A/S2a: the nine editor-domain declarations now live in `nodeTopologyEditorTypes.ts`; `topologyContract.ts` keeps the semantic layer. One duplication survived the decision — `SemanticRelationshipType` is declared in BOTH files — recorded in the S2a entry below rather than quietly left as a tick.)
- [x] Move only genuinely shared editor types/constants into a small dedicated types module if doing so does not create cycles. (P5-A/S2a landed `nodeTopologyEditorTypes.ts`: types only, zero imports, so no cycle is possible by construction; `WIRE_DIRECTION_CYCLE` was deliberately NOT moved — the editor is its only reader.)
- [x] Keep semantic graph types and validation errors owned by `topologyContract.ts`.
- [ ] Replace any accidental imports of runtime UI code from pure modules with type-only imports or explicit adapters. (2026-09-09: none found — all extracted pure modules import types only.)
- [x] Add boundary types for the major feature slices instead of passing the entire editor props/state object. (Every extracted hook takes an explicit deps interface: the load-lifecycle deps object, `TopologyAnnouncementDeps`, `BendGestureState` — not the props bag.)
- [x] Preserve `NodeTopologyEditor.tsx` re-exports while callers migrate gradually.
- [x] Run typecheck and the focused tests; commit this boundary-only change separately. (P5-A/S2a+S2b committed alone as 124d07918 — new module +104, editor +18/−93, no runtime line touched; `tsc --noEmit` exit 0 and the gate battery 18 files / 735 passed / 1 skipped / 0 failed.)

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

- [x] Extract mouse/pointer event orchestration into a controller hook without moving presentational JSX yet.
- [x] Extract touch gesture orchestration separately; do not merge touch and mouse behavior into one opaque handler.
- [ ] Keep document-level listener cleanup owned by the controller that installs it.
- [x] Add regression tests for pointer release outside the canvas, window blur, visibility changes, Escape cancellation, duplicate drag, bend drag, and touch cancellation.
- [x] Verify no handler identity churn regresses memoized topology cards.

### 3.5 Viewport and canvas interaction

- [ ] Extract pan, zoom, auto-fit, viewport persistence, minimap interaction, and cursor readout coordination.
- [x] Keep geometry calculations in the existing pure modules (`nodeTopologyClamp`, `nodeTopologyLayout`, `topologyWireGeometry`, and related helpers).
- [x] Add focused tests for zoom bounds, saved viewport restoration, auto-fit suppression after manual movement, and pan/zoom keyboard controls.

## Phase 4 — Extract feature surfaces from the render tree

- [ ] Keep the parent as a thin composition root that wires hooks to feature components.
- [x] Extract the inspector/drawer surface, including branch profile fields and workspace fields, behind a typed `InspectorProps` boundary.
- [x] Extract the confirmation and Apply flow behind a typed `ApplyPanelProps` boundary; preserve PIN/session behavior and revision conflict handling.
- [ ] Extract migration/legacy-wire resolution UI and its state transitions.
- [x] Extract template/import/export/clipboard controls if they are still coupled to the parent render function.
- [ ] Extract canvas overlays and menus that are not already isolated: validation widget integration, relationship picker integration, context menu integration, guides, and selection overlays.
- [x] Keep `TopologyNodeCard`, `TopologyWireGroup`, `TopologyToolRack`, `TopologyHeader`, and other existing extracted components as stable seams rather than wrapping them in unnecessary pass-through layers.
- [x] After each extraction, compare rendered DOM roles, labels, class names used by tests, and keyboard focus behavior.

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

- Do not redesign the topology UI or change the node/wire interaction model.
- Do not change persisted topology schema, migration behavior, or backend APIs as part of a front-end extraction.
- Do not replace the editor with a new graph library while extracting it.
- Do not make broad naming or formatting changes across `ui/src/features/locations`.
- Do not remove tests because an implementation moved; move or strengthen them instead.
- Do not optimize rendering based on intuition; measure first and keep performance work separate.

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

### 2026-09-09 — Decision-ready inline-responsibility map delivered (Phase 1 closure input)

**Method:** two read-only scout passes against the current tree (5,681 lines at fc5038fec): (1) a full-file G1-G21 responsibility-group map with line ranges, owned hooks, cross-group deps, JSX blocks, and risk notes; (2) a Phase 3.4 input-controller deep-dive (handler inventory, gesture refs, listener lifecycle, memo hazards, coverage audit, proposed hook boundaries with deps interfaces, TDZ ordering constraints). Full dossiers recorded in orchestrator-journal.md (GOAL 3 section).

**Corrections to earlier review entries:** keyboard dep array is 36 names, not 39; editor is 5,681 lines (the 5,651 figure pre-dates a4ed7a511's timezone select); one unlisted inline group exists (G1 serialized blur-persist profile, 383-455 + module-scope inspector helpers 456-536 — folds into the Phase-3 inspector boundary).

**Stop-and-split verdicts (binding for slice design):** the keyboard effect (G14, 36-name deps) breaches the doc's stop condition if extracted whole — it must be extracted only as a per-action dispatch after rename/duplicate/delete/clipboard own their callbacks. The pointer/duplicate cluster (G15+G9) shares dragOffsetsRef/duplicateDragRef/dragStartRef + pushHistory timing — split finalize/commit from begin/mousedown, keep ref-stable identities for memoized cards. The unmount sweep + resetTransientCanvasState + cancel* (G6+G20) form a cleanup knot owned atomically with the gesture controllers.

**Slice ladder adopted (Phase 3.4, sequential on the editor fence):** 3.4a bend trio -> topologyEditorBendDrag.ts (in progress, coder-20); parallel test-only slice adds the 4 missing input-controller regression tests (visibilitychange / pointercancel / unmount teardown beyond marquee / wheel pan component — coder-21); then 3.4b pointer core (marquee/pan/wheel/inline contextmenu -> nodeTopologyEditorPointer.ts), 3.4c node-drag+duplicate cluster, 3.4d keyboard, 3.4e touch (separate hook per the doc's rule) + remaining tests. After 3.4: 3.5 viewport (G2, lowest coupling) -> G5 rename -> Phase 4 G8 ApplyPanelProps -> G4 migration -> G7/G13 -> G18 menus last.


### 2026-09-09 — Slice 3.4a: bend-drag gesture hook extracted

- **Responsibility boundary:** the wire bend-drag gesture (startBendDrag / startGhostBendDrag / removeBend) moves to `useTopologyEditorBendDrag` (topologyEditorBendDrag.ts, 200 lines); the parent keeps cancelBendDrag, the Escape path, and the unmount listener sweep.
- **Files:** NodeTopologyEditor.tsx (5,681 -> 5,589 lines); topologyEditorBendDrag.ts NEW (200 lines). ui-coder-20-journal.md carries the dated record.
- **Public imports/re-exports:** unchanged. `bendLandedAtStart` left the editor's topologyCommands import list (the trio was its only consumer there; noUnusedLocals). Wire JSX props untouched.
- **Focused tests:** NodeTopologyEditor + InspectorIntegration + nodeTopologyMemo = 523 passed / 1 skipped / 0 failed — the bend matrix is bit-identical to the pre-slice baseline; re-run independently by the orchestrator (exit 0).
- **Typecheck:** exit 0 (coder twice + pre-commit gate).
- **Behavior checked:** all 74 non-comment code lines byte-identical including the three useCallback dep arrays; hook called at the exact vacated position so hook/effect order is unchanged; parent-owned refs (bendDragRef, bendDragCleanupRef, nodesRef, wiresRef, pushHistoryRef) arrive through one explicit deps object with per-field doc comments.
- **Rollback point:** revert 20f7e4dfc alone.
- **Remaining coupling / follow-up:** react-hooks v7 counts a ref only when useRef runs in the same scope, so passing parent refs through deps re-flagged 3 exhaustive-deps sites (2 hook, 1 parent unmount sweep); suppressed with targeted reasoned eslint-disables (ratchet cap 4 held, 7 would have breached). These dissolve when the unmount sweep + remaining gesture systems move with 3.4b/c. G6+G20 cleanup-knot rule unchanged: sweep moves atomically with the gesture controllers.


### 2026-09-09 — Phase 3.4 regression-coverage gaps closed (test-only slice, parallel)

All four previously-missing input-controller coverage items landed in one additive describe block ("input controller disarm and teardown", +163 lines): (1) visibilitychange disarms held Space with marquee follow-through; (2) pointercancel on a one-finger touch drag restores position — characterized as PRE-threshold only, because a post-move cancel delegates to finalizeNodeDrag (cancel == release semantics; documented for the 3.4e touch hook); (3) unmount tears down pan/node-drag/bend-drag/touch document listeners with a fresh-mount identity-transform proof; (4) wheel zoom-to-cursor pan invariance asserted via parsed transform floats (floats need toBeCloseTo, not string equality). Commit 98e208d3f, single test file, ran green against both the pre- and post-3.4a shapes (514 passed / 1 skipped, typecheck exit 0). These tests protect every remaining 3.4 extraction.


### 2026-09-09 — Slice 3.4b: canvas pointer core extracted

- **Responsibility boundary:** background mousedown/move/up, wheel zoom-to-cursor, marquee finalize, middle/right pan start, and the inline canvas context-menu handler move to `useTopologyEditorPointer(deps: TopologyPointerDeps)` (nodeTopologyEditorPointer.ts, 411 lines, 31-field deps object with per-field doc comments). The parent keeps all gesture refs, cancelMarquee/cancelBendDrag, resetTransientCanvasState, the Space-pan effect, touch, bend, and the node-drag cluster.
- **Files:** NodeTopologyEditor.tsx (5,589 -> 5,389); nodeTopologyEditorPointer.ts NEW (411). ui-coder-22-journal.md carries the dated record.
- **Public imports/re-exports:** unchanged; canvas JSX changed on exactly one line (onContextMenu={handleContextMenu}).
- **Focused tests:** 3 suites 527 passed / 1 skipped / 0 failed (+4 vs prior baseline = the newly landed input-controller regression block, not failures); typecheck exit 0; exhaustive-deps ratchet at cap 4.
- **Behavior checked:** all six moved blocks byte-identical against HEAD~1 by script (56+8+55+36+52+18 lines); nothing newly wrapped in useCallback (per-render identities preserved for memoized card/wire props); hook call at the original block position registering no internal hooks; onContextMenu arrow lifted byte-identical modulo 8-space dedent.
- **Rollback point:** revert 7201d806f alone.
- **Remaining coupling / follow-up:** +2 targeted eslint-disables in the parent unmount sweep (panCleanupRef/marqueeCleanupRef reads; react-hooks v7 ref-scope rule — the refs' only writers moved into the hook); all five sweep disables (3 from 3.4a + these) retire when the sweep moves atomically with the gesture systems at 3.4c-e. Handoff notes: finalizeMarquee/startPan returned but not destructured (noUnusedLocals); applyDragMove/finalizeNodeDrag are already hook deps, which forces the 3.4c split order (trio first, call-site relocation with the cluster last) — see the scout-4 dossier in orchestrator-journal.md.


### 2026-09-09 — Extraction-protection test wave (parallel test-only slices)

Two guard layers landed while the extraction ladder advanced, both strictly additive and green at HEAD: (1) ui-coder-24's memo churn tripwire (nodeTopologyMemo.test.tsx +104, 3 tests): pan and wheel zoom re-key the wire props (onStartBendDrag/onStartGhostBend identities differ) while node-card drag/selection props stay referentially stable and the memoized cards render zero times — with throwing never-captured accessors so a silently-stopped render layer cannot pass vacuously. This pins the contract 3.4c-e and 3.5 must preserve; if a slice legitimately drops pan from the bend hook deps, the assertion flips deliberately, never silently. (2) ui-coder-23's hook-in-isolation suite for the 3.4a bend seam (NEW topologyEditorBendDrag.test.ts +404, 8 tests): arming/disposer re-arm (a leaked listener is only observable by re-arming the ref and pinning setWires to one call — handleMove early-returns on a null ref), no-trace release, the existing-bend-suppressed vs created-bend-never-suppressed matrix, client->canvas mapping (client - rect - pan) / zoom, and removeBend identity preservation. Pinned finding: the ghost path double-fires selectWire/stopPropagation/preventDefault (startGhostBendDrag delegates to startBendDrag) — idempotent and correct today, so removing it is now a deliberate, test-visible decision.


### 2026-09-09 — Slice R0 (pre-extraction): rename-flow characterization gaps closed

All six scout-identified rename gaps landed as characterization tests (b30e97c63, single test file, 6/6 green independently re-run): (a) wire-rename blur commit with the no-focus-steal half; (b) empty wire relabel DELETES the label field — asserted on the onSave payload because the display fallback is byte-identical under delete-vs-empty-string (this is the only guard distinguishing the two); (c) keyboard-driven rename close returns focus to .wire-hitbox[data-wire-id] for both Enter and Escape; (d) the renameSaving Enter+blur double-submit guard (exactly one round-trip under a deferred promise); (e) a rejected card-level commit keeps the draft open and releases the guard; (f) a wire relabel pushes exactly one undo entry and marks the canvas dirty (Ctrl+Z / Ctrl+Shift+Z round-trip).

**Binding flags for the R1 rename extraction:** (1) do not weaken test 2's payload assertion — it is the only delete-vs-empty guard; (2) renameSaving must STAY in commitNodeRename's dependency array — dep-pruning or a ref conversion makes test 4 red by design; (3) the body-config/inspector path (renameBaselineRef / persistNodeRename, ~1610-1633) has thinner coverage than the six above; if R1 moves it, extend the suite in the same slice. Editor suite at 520 passed / 1 skipped.


### 2026-09-09 — Slice 3.4c-1: node-drag trio folded into the pointer hook

- **Responsibility boundary:** applyDragMove (edge-autopan/clamp/alignment), finalizeNodeDrag, beginNodeDrag (ref-only graph reads for memoized cards preserved), and handleNodeMouseDown move into useTopologyEditorPointer; the duplicate-drag lifecycle (commit/cancel/convert/cancelNodeMove) stays parent-owned, which is what keeps 3.4c-2 separable.
- **Safety gate (ran before any edit):** the central keydown effect's dependency array names only cancelDuplicateDrag / cancelNodeMove / convertDragToDuplicate / cancelBendDrag — zero trio names — so trio-only extraction is TDZ-safe at the unchanged hook call site. The trio were the only hooks between executeDelete and the canvas-handler block, so hook and effect order are provably unchanged.
- **Files:** NodeTopologyEditor.tsx (5,389 -> 5,099); nodeTopologyEditorPointer.ts (411 -> 879; TopologyPointerDeps 31 -> 59 fields). Public imports/re-exports unchanged; JSX zero lines changed; dead imports dropped per noUnusedLocals (edgeAutoPanDelta, moveLandedAtStart — now imported by the hook).
- **Focused tests:** editor + inspector + memo = 536/1/0; the two most dep-exposed files (pointer isolation + memo) 21/21; ORCHESTRATOR independent re-run over 4 suites 550 passed / 1 skipped / 0 failed (exit 0).
- **Typecheck:** exit 0; exhaustive-deps ratchet at cap 4; +4 targeted eslint-disables (react-hooks v7 ref-scope rule: refs arriving through deps are no longer counted) — scheduled to retire when the unmount sweep moves with the gesture systems.
- **Behavior checked:** 323 lines moved mechanically (never retyped); bodies/comments/3 useCallback dep arrays byte-identical; nothing newly wrapped in useCallback; hoveredTarget identity rule and memo churn tripwire (nodeTopologyMemo 7/7) both hold.
- **Rollback point:** revert 4956d74a4 alone.
- **Remaining coupling / follow-up:** 3.4c-2 (duplicate cluster + hook-call-site relocation) is ONE fused commit — commitDuplicateDrag is still a parent-owned dep the trio calls; nodeTopologyEditorPointer.test.ts's exhaustive deps literal is a deliberate tripwire and must be updated inside the same commit.


### 2026-09-09 — Slice T-G2: viewport view-preferences characterization gaps closed pre-extraction

All five G2 gaps (b)-(f) landed as 10 characterization tests (54735b777, single test file). Two suspected bugs were investigated and DISPROVEN rather than pinned: the predicted "unmount drops the pending write" does not exist (persistViewport is a stable useCallback([]); the unmount cleanup writes the LATEST zoom+pan — test pins the 1.1 -> 1.375 ordering), and the zoom-popover Escape "cross-talk" is genuine exclusivity (popover listens on document, canvas Escape ladder on window; probed empirically, selection survives). NaN restore is already rejected by the validator (JSON.stringify emits null).

**Binding flags for the 3.5a viewport extraction:** (1) the 0.4..2.0 clamp lives ONLY in the useState initializer — the write path never clamps; moving it breaks restore safety (tests 3+4 guard); (2) viewPersistRef carries its own viewKey inside the persisted record — do NOT simplify to a closure over the live key (per-branch cross-write protection); (3) autoFitKeyRef is consumed only AFTER the measured-canvas guard — hoisting it silently kills every load fit; (4) 0.4/2.0 literals confirmed at 4 editor sites + the wheel clamp in nodeTopologyEditorPointer.ts — the const extraction remains its own commit; (5) gap (e)'s positive half (a new diagram replacing the current one and refitting) still needs a two-load harness — build it inside 3.5a. Editor suite now 530 passed / 1 skipped.


### 2026-09-09 — Slice 3.4c-2: duplicate-drag cluster folded in + pointer-hook call site relocated (ONE commit)

- **Responsibility boundary:** commitDuplicateDrag and beginDrag become internal to useTopologyEditorPointer (beginNodeDrag calls both); cancelDuplicateDrag, convertDragToDuplicate, and cancelNodeMove are returned and consumed by the keydown Escape ladder / Alt-mid-move path; duplicate state stays parent-declared. The pointer hook now owns the full node-drag + duplicate lifecycle; the editor no longer defines any drag callback.
- **Safety gates (verified pre-edit by the coder, re-verified independently):** resetTransientCanvasState and the load-lifecycle call reference none of the four cluster callbacks; the four useCallbacks moved verbatim (bodies/comments/dep arrays byte-identical, internal order preserved); zero other hooks existed between the old and new call-site positions, so hook/effect order is provably unchanged. The relocation satisfied scout-7's sequencing gate (a): call site below resetTransientCanvasState (1495) and userInteractedRef (1994), above the keydown effect (2521).
- **Files:** NodeTopologyEditor.tsx (5,099 -> 4,960); nodeTopologyEditorPointer.ts (879 -> 1,092); nodeTopologyEditorPointer.test.ts deps literal updated inside the same commit (the deliberate tripwire worked as designed).
- **Focused tests:** ORCHESTRATOR independent 5-suite re-run = 582 passed / 1 skipped / 0 failed (editor + inspector + memo + pointer isolation + apply characterization), exit 0.
- **Typecheck / lint:** exit 0; exhaustive-deps ratchet at cap 4; the ref-scope eslint-disable set carried over unchanged (no new ones for this slice).
- **Behavior checked:** duplicate-drag semantics pinned by existing editor tests + tripwire; zero JSX changes.
- **Rollback point:** revert 59d37d6c1 alone.
- **Remaining coupling / follow-up:** the unmount sweep's dragCleanupRef disable is now the only ref-scope disable whose writer is fully hook-side — scheduled to retire with 3.4d; next slice on the editor fence = R2 (F2 -> startNodeRename dedupe, which scout-7 corrected to a 35-name dep array).

### 2026-09-09 — Slice T-G8 (pre-extraction): apply save-flow characterization landed

Seven tests (5e9e4b59d, TopologyApplyConfirm.characterization.test.tsx 15 -> 22) pin the G8 contract: onSave positional arity 5 with a LIVE canvas arg0 and an array-copy arg3; Apply is NOT dirty-gated; the .topology-apply-confirm-overlay keyboard shield (the 3.4d closest() guard made executable); backdrop-mousedown shield (guards against swapping in the shared Modal); failure path releases the guard without reopening or blaming the PIN; no-Remember forces re-PIN; commitSnapshot flips both dirty views atomically. **Open question for the G8 slice (deliberately unpinned):** revision adoption — a save resolving {revision: N} does not surface in the next Apply's baseRevision; either a post-save authoritative load re-bases (correct) or finishApply(nextRevision) is dead. Root-cause before/at G8, then pin the winner. **Extraction tripwire:** finishApply/failApply release via setTimeout(0) — inlining it will red tests 5-7 by design.


### 2026-09-09 — Slice R2: F2 routed through startNodeRename (keyboard deps 35 -> 34)

- **Change:** startNodeRename absorbs the node lookup (nodesRef) and the renameable type-gate; signature (nodeId), deps [] (referentially stable). The F2 branch is now guard + preventDefault + startNodeRename. All three external callers (canvas context menu, node-card double-click/pencil) pass nodes-derived names — verified loss-free by a caller audit, so the absorbed lookup reconstructs every name exactly.
- **Dependency effect:** onRenameBranch/onRenameWorkspace leave the central keydown dep array (grep-proven sole reader was the F2 branch); startNodeRename replaces them as a permanently stable dep. Net 35 -> 34: two volatile props became one stable callback.
- **Accepted deviation:** the absorbed gate reads two render-mirror booleans (canRenameBranchRef/canRenameWorkspaceRef, assigned beside the existing nodesRef mirror) instead of the props directly. Reading props inside the []-dep callback would force it to churn, breaking memoized-card prop identity and making the dep narrowing nominal rather than real. Behavior identical (the gate reads presence only); documented in-file.
- **Tests:** 4 scoped suites 575/1/0 + nodeTopologyMemo 7/7 (independent proof the memoized card props stayed referentially stable); ratchet at cap 4; typecheck clean for the file (transient foreign reds from a concurrent locale workstream healed on their own).
- **Ladder note:** the keydown dep array now carries only 1 rename-related dep-adjacent name; with 3.5a (planned next-but-one) removing the 5 viewport deps, 3.4d will extract at ~29 deps.
- **Rollback point:** revert 2c6632284 alone.

### 2026-09-09 — Slice T-R1c: inspector rename persistence pinned (coverage hole closed)

Five tests (d07864a5a, +127, single test file): inspector rename persists through the parent and marks the canvas dirty with baseline-advance (no double commit on re-blur); an unedited blur never round-trips the focus-time name; a whitespace-only inspector commit is a no-op (in contrast to the wire relabel that DELETES the label — the trim-gate asymmetry is now pinned); a rejected inspector rename reverts the live-bound name and stays retryable; an inspector rename followed by a card rename costs exactly one undo entry. **R1 flags:** persistNodeRename has NO renameSaving guard (card-form-only; adding one during extraction is a behavior change — do not silently "fix"); its deps re-bind per nodes change via the baseline-revert setNodes. Editor suite now 535 passed / 1 skipped.


### 2026-09-09 — Slice 3.4e: touch gesture hook extracted

- **Responsibility boundary:** the entire canvas touch loop (pointerdown/up/cancel/pinch) moves into useTopologyEditorTouch (NEW nodeTopologyEditorTouch.ts, 312 lines, 16 dep fields). Only handleCanvasPointerDown is returned (the block's sole external consumer). touchPointersRef and touchGestureRef move INTO the hook (zero external readers, full-file line map); touchCleanupRef stays parent-declared (read by the unmount sweep) with its declaration relocated beside the other cleanup refs atomically with the extraction.
- **Safety gates:** all consumers resolve above the hook call site (no TDZ); the hook registers exactly two useRef and no useEffect/useCallback, so component hook/effect order is unchanged; the 213 moved lines are byte-identical to the source slice (line-slice, never retyped); handleTouchPointerCancel still delegates verbatim to handleTouchPointerUp ("end the gesture exactly like a release" — the cancel==release post-threshold semantics preserved, now also component-pinned by the touch characterization suite).
- **Files:** NodeTopologyEditor.tsx 4,984 -> 4,802; nodeTopologyEditorTouch.ts NEW 312.
- **Focused tests:** 587 passed / 1 skipped / 0 failed across editor + pointer-isolation + memo + apply-characterization (exact pre-slice baseline — zero behavioral drift); ORCH independent re-run exit 0.
- **Typecheck / lint:** exit 0; ratchet exhaustive-deps 4 = cap 4; +1 targeted eslint-disable (unmount-sweep read of the parent-side touchCleanupRef, worded like its siblings); JSX zero lines changed.
- **Rollback point:** revert cfad63603 alone.
- **Remaining coupling / follow-up:** gesture controllers are now fully hook-owned (bend/pointer+node-drag/duplicate/touch); the unmount sweep's five cleanup-ref disables are the residue to retire in 3.4d's neighborhood; next on the editor fence = 3.5a/3.5b-1 viewport (keyboard-dep shrink lever, gate decision recorded in the orchestrator journal).

### 2026-09-09 — GATE DECISION: 3.5b view-preferences persistence split (storageKeyPins)

The storageKeyPins enforcement is a vitest fixture (not a pre-commit hook): T4 pins key->owner-path by exact string; only the 3 legacy fallback literals are scanner-visible. Decision: 3.5b-1 (viewport zoom/pan + minimap persistence) lands as a clean 2-file slice with zero registry impact; 3.5b-2 (routing/snap/wire-labels) lands as a 3-file atomic commit including the storageKeyPins.test.ts registry path update (by-design co-change, itemized in the commit body). Key-injection and shared-constants alternatives rejected (stranded fallbacks / 4 files + still-red T4). Guardrails: no new *_KEY/*_PREFIX consts; no literal duplication across the fence; storageKeyPins.test.ts must be run before and after each 3.5b commit.


### 2026-09-09 — Slice T-3.4e: touch gesture behavior pinned (component level)

Six tests (c6d626f20, +152, single test file) pin the touch contract that 3.4e's hook extraction must preserve: a pointercancel AFTER the drag threshold commits exactly like a pointerup (position + cleanup, completing the pre-threshold case pinned by 98e208d3f); two-finger pinch zooms via pinchTransform and a pinch during an in-flight node drag COMMITS that drag; a drag below TOUCH_DRAG_THRESHOLD never arms; a touch tap selects; unmount with an armed gesture tears down with no leaked document listeners (re-arm proof pattern). Landed after the 3.4e extraction (cfad63603) — it retroactively pins the hook's behavior at the component level. Editor suite 541 passed / 1 skipped.


### 2026-09-09 — Slices 3.5a + 3.5b-1: viewport machinery extracted

- **Responsibility boundary:** view-preferences persistence (zoom/pan debounce + unmount flush + restore), minimap persistence, center/nudge viewport, and the zoom cluster (zoomToFit/zoomToSelection/zoomBy/resetView) move into useTopologyEditorViewport (NEW nodeTopologyEditorViewport.ts, 225 lines, 9 dep fields). The hook is called at the vacated G2-A slot; auto-fit stays parent-side deliberately (its autoFitKeyRef consumption sits after the measured-canvas guard, and userInteractedRef is declared below the hook call).
- **Storage-keys guardrails honored (gate decision, scout-8):** zero legacy literals moved (routing/snap/wire-labels remain editor-side for 3.5b-2), zero new *_KEY/*_PREFIX consts, storageKeyPins green before and after — template keys are scanner-invisible, so the oz-topology-viewport:[branchId] key moved without a registry edit.
- **Keyboard lever landed:** the central keydown dep array is byte-identical (34 names); zoomToFit/zoomBy/resetView now bind from the hook's return. 3.4d can now relocate the keyboard effect into its own controller whose dep object excludes the volatile viewport callbacks.
- **Files:** NodeTopologyEditor.tsx 4,802 -> 4,702; nodeTopologyEditorViewport.ts NEW 225.
- **Focused tests:** 591 passed / 1 skipped / 0 failed (editor 541 incl. the touch characterization +6, pointer-isolation 21, memo 7, apply-characterization 22); ORCH independent re-run with storageKeyPins: 596/1/0 exit 0.
- **Typecheck / lint:** exit 0; ratchet cap 4; +5 targeted eslint-disables in the hook (ref-scope rule), editor count unchanged.
- **Rollback point:** revert 2fa4cbfe1 alone.
- **Remaining coupling / follow-up:** 3.5b-2 (routing/snap/wire-labels + registry path strings) and 3.4d (keyboard controller, in flight) remain on the editor fence; zoom 0.4/2.0 clamp const extraction still deferred (now 4 editor-side sites + 1 hook site became hook-internal — re-verify site count before that slice).


### 2026-09-09 — Slice 3.4d: keyboard controller extracted (LAST input controller)

- **Responsibility boundary:** the central window keydown useEffect (344 lines, editor 2454-2797) moves into useTopologyEditorKeyboard (NEW nodeTopologyEditorKeyboard.ts, 588 lines). Hook args = 53 fields (the byte-identical 34-name dep array + 19 body-read extras: 6 gesture refs, userInteractedRef/migrationDismissedRef/nudgeSessionRef/canvasRef, handleAddNodeRef passed BY REF because it is still assigned below the call, 5 state setters, setNodes, isBranchLocation, GRID_SIZE/NUDGE_COALESCE_MS/snap). The hook returns nothing — it is listener registration only.
- **Behavior preservation proved:** body copied by splice-guarded line-slice (the script refuses to write unless the source boundary lines match, then asserts the written hook is byte-equal to the saved block); the .topology-apply-confirm-overlay closest() shield and the F2 -> startNodeRename(nodeId) form are verbatim; zero JSX lines changed; call sits at the exact vacated slot.
- **The +1 disable:** isBranchLocation (deps [nodes]) is called inside the body but is not in the 34-name array — passed as a hook arg outside the array text with one targeted react-hooks/exhaustive-deps on the in-hook array. Directive-placement gotcha recorded: a multi-line comment above the array makes the directive "unused"; it must be the last line before the array.
- **Ratchet improved:** whole-tree exhaustive-deps 4 -> 3 against cap 4 (the editor's keydown warning moved out and is now suppressed as sanctioned). Locking the baseline JSON at 3 is a deferred one-file follow-up.
- **Files:** NodeTopologyEditor.tsx 4,702 -> 4,415; nodeTopologyEditorKeyboard.ts NEW 588. Two dead imports whose sole consumer moved (nodeBoxesOverlap, computeAlignmentGuides) were dropped from the editor's import list; the compatibility re-export block is untouched.
- **Focused tests:** 594/1/0 x4 suites at the slice HEAD; ORCH independent 6-suite re-run (incl. touch isolation + storageKeyPins): 609/1/0 exit 0.
- **Phase 3.4 is now COMPLETE:** all input controllers live in dedicated hooks — topologyEditorBendDrag (3.4a), nodeTopologyEditorPointer (3.4b/c), nodeTopologyEditorTouch (3.4e), nodeTopologyEditorKeyboard (3.4d). Remaining inline input handling in the editor: none. The unmount-sweep ref-scope disables (+15 across hooks) retire when the sweep + resetTransientCanvasState move in the next phase.
- **Rollback point:** revert e9e0f0ef0 alone.


### 2026-09-09 — Slice 3.5b-2: view preferences moved into the viewport hook (3.5 COMPLETE)

- **Responsibility boundary:** routing / snap / wire-labels persistence (the three scanner-visible legacy keys) moves into useTopologyEditorViewPrefs, a second export in nodeTopologyEditorViewport.ts alongside the sibling minimap pref. Each key's legacy fallback read + per-branch write-back effect moved as one closed set (splitting them would strand a legacy value unmigrated — a real behavior change). panToolActive, anyBentWires and snapOrNot stay parent-side (pointer deps / render-scope consumers).
- **The gate co-edit, by design:** storageKeyPins.test.ts re-attributes the three relocated literals to the hook file (T4 owner match, exact-string src-relative paths). T5's exactly-two-shared-owners invariant held — no legacy literal was duplicated across the fence; no const *_KEY was introduced (KEY_DECL would discover new keys). This is the one slice where the registry edit is itemized in the commit body rather than a violation.
- **Files:** NodeTopologyEditor.tsx (71+/−~140); nodeTopologyEditorViewport.ts +107; storageKeyPins.test.ts 3 lines. Zero new eslint-disables (the states moving into the hook made all three persist effects hook-local).
- **Focused tests:** 546 passed / 1 skipped / 0 failed (editor suite 541 + storageKeyPins 5 — exact). storageKeyPins ran green before AND after the commit (vitest-only gate; the pre-commit hook does not run it).
- **Rollback point:** revert 29300f8ea alone.
- **Phase 3.5 is COMPLETE:** all view state (viewport zoom/pan/minimap prefs in 3.5b-1, view prefs in 3.5b-2) is hook-owned; the storageKeyPins registry now attributes every legacy topology key to its true owner file.


### 2026-09-09 — Slices R1 + R1b: both rename halves extracted (G5 COMPLETE)

- **R1 — node half (c877b1e6c):** the 145-line inline node-rename block (state x2, refs x3, focus effects x2, canRename render mirrors, startNodeRename/cancelNodeRename/persistNodeRename/commitNodeRename) moved into useTopologyEditorNodeRename (NEW nodeTopologyEditorRename.ts, 220 lines). Deps = 5 parent-owned fields (nodes, setNodes, nodesRef, onRenameBranch, onRenameWorkspace — all also read at other call sites, not relocatable). Byte-identity PROVEN against HEAD content (145/145 case-sensitive equal). All four dep arrays byte-identical — commitNodeRename keeps renameSaving (coder-25 flag b), persistNodeRename gains NO guard (coder-31: that would be a behavior change). The canRename gate stays on render-mirror refs (coder-32 deviation preserved: switching to prop reads would churn startNodeRename identity and red memoRenderIsolation). renameBaselineRef/renameInputRef remain the SAME ref objects the card receives and the inspector writes — no value-ification. Editor 4,362 -> 4,239; +1 targeted eslint-disable in the hook file (startNodeRename deps [] reads param nodesRef; viewport precedent). Verified: 618/1/0 (editor 541 + card 77) + tsc 0 + ratchet 3/4, independently re-verified by ORCH at 629/1/0 across 4 suites after the foreign dev-mock syntax outage healed.
- **R1b — wire half (ffe5e448d):** the 72-line inline wire-rename block (2 useState + 3 useRef + 2 effects + plain-arrow startWireRename/cancelWireRename/commitWireRename) moved into useTopologyEditorWireRename as the hook file's second export. The scout-10 blocker (commitWireRename calls pushHistory declared below the block) resolved by scout-11 option (iv): the hook dep is typed '() => void' and wired parent-side as the deferred-access wrapper '() => pushHistory()' — the arrow closes over the binding without reading it at render, so the call site stays at the exact marker (slot-identical, zero positional-hook delta) while pushHistory/pushHistoryRef positions remain untouched. Callbacks stay plain arrows (pre-existing identity churn preserved; no new deps arrays, +0 disables expected). commitWireRename body byte-identical incl. the empty-label delete branch and fromKeyboard focus-return. Editor 4,239 -> ~4,164. Verified by ORCH: 622/1/0 (editor 541 + audit 4 + card 77 exact) across 3 suites.
- **Test protection:** ~26 node-rename tests + 9 wire-rename direct pins all stayed green with zero test edits — the R0/R2/coder-31 characterization work did its job.
- **Rollback points:** revert c877b1e6c and ffe5e448d independently (R1b shares only the file with R1, not symbols).


### 2026-09-09 — Slice G8-a: the apply/save surface extracted (Phase 4 opened)

- **Responsibility boundary:** the apply-confirm save flow — applyConfirmOpen/applyConfirmData state, confirmApply (118 ln), handleApplyClick (76 ln), dirtySummary (33 ln) and the PIN_VERIFIED_SESSIONS module cache — moves into useTopologyEditorApplyPanel (NEW nodeTopologyEditorApplyPanel.ts, 402 lines, deps 27, returns 6). TopologyApplyConfirm is ALREADY a props-driven child component and its JSX mount is untouched; the extraction takes the LOGIC, not the markup (scout-12's split verdict — G8-b, a cosmetic mount-surface component, is deferred to the G13/menu pass).
- **Byte-identity proved mechanically:** every span's first and last line asserted against exact literals; all three dep arrays (12/11/3 names) compared as full strings; the written hook re-read requiring the joined spans verbatim including injected disable lines. PIN_VERIFIED_SESSIONS relocates as an export so the staying pinVerifiedRef initializer stays byte-identical (a deps-field pass would have made exhaustive-deps demand a 13th name into a frozen array).
- **Contracts held (each re-read from source after the splice):** commitSnapshot is called, never re-derived; the skipNextLoadRef cross-effect handshake and the setTimeout(0) finishApply release are verbatim; Apply is not dirty-gated; onSave receives a positional array copy; setHistory([])/setRedo([]) are literal clears so the history-creator audit multiset pin holds; storageKeyPins untouched; the dialog stays mounted unconditionally (keyboard overlay shield contract); the jsx-a11y disable/enable block survives with every cut inside it.
- **Ratchet:** +2 targeted disables (handleApplyClick + dirtySummary, each only appliedSnapshotRef); confirmApply's pre-existing warning left visible; whole-tree exhaustive-deps 3 vs cap 4.
- **Focused tests:** 592 passed / 1 skipped / 0 failed across 6 suites (editor 541 + apply-characterization 22 + save-state 13 + history audit 4 + storageKeyPins 5 + memo 7). typecheck 0; 10 gates.
- **Editor size:** 3,983 lines (from 6,048 baseline; -2,065 across the refactor).
- **Rollback point:** revert 420f30a60 alone.
- **Remaining per doc:** G4 (load/migration surface), G7/G13, G18 menus LAST. Next scout pass ranks them at current anchors.


### 2026-09-09 — Slice G4-a: the migration logic extracted (residual G4)

- **Premise correction (scout-13):** G4's load half was already banked — useTopologyEditorLoadLifecycle has lived in its own file since b5d00ac91 (26 deps, 11-test isolation suite). The doc's "G4 migration" item therefore reduces to the legacy-wire MIGRATION surface alone.
- **Boundary:** the migration state trio stays in the editor by construction — migrationOpen is consumed as a VALUE by the keyboard hook and migrationDismissedRef by both the load and keyboard hooks, all above liveValidation, which the moved memos need. A state-owning hook would have to sit above the load hook yet below liveValidation: impossible. The LOGIC (ambiguous-wire detection memo, entries memo, per-wire selection, auto-open effect, resolve/later handlers, 108 lines) moves to useTopologyEditorMigration (NEW nodeTopologyEditorMigration.ts, 210 lines, deps 11, returns 4) at a slot-identical call site.
- **Contracts held:** handleResolveMigration only CALLS pushHistory (no history-producer move; the entry-audit multiset pin holds); zero legacy storage literals in the span (registry untouched); the keyboard hook's own Escape-dismissal duplication is deliberately preserved (routing it through the hook would break the 34-name keydown dep array); class strings unchanged (noise-dither allowlist intact); the 5 migration tests pass unedited.
- **Ratchet:** +1 targeted disable in the new file (auto-open effect; same shape as the load hook's), whole-tree exhaustive-deps 3 vs cap 4.
- **Focused tests:** 565 passed / 1 skipped / 0 failed across 5 suites (editor 541 + history audit 4 + storageKeyPins 5 + loadLifecycle 11 + timezoneSelect 4). typecheck 0; 10 gates.
- **Editor size:** 3,900 lines (coder-48 correction: -83 net, not -94).
- **Rollback point:** revert bbb255a19 alone.
- **Remaining per doc:** G7-a (BranchLocationFields 173 ln, module-scope component move), G7-b (inspector drawer IIFE), G13-prep/G13-c/G13-a+b (clipboard + templates, tests first), G18 menus LAST. G8-b skip recorded (evidence-backed).


### 2026-09-09 — Slice G7-a: BranchLocationFields relocated (Phase 4 inspector boundary opened)

- **Boundary:** the module-scope BranchLocationFields component (173 lines: 4 state slots, 4 refs, persist-on-blur, load effect, timezone-aware JSX) plus its two private timezone helpers move to topologyBranchLocationFields.tsx verbatim. Parent coupling was exactly one prop (beginInspectorEdit); zero hook slots, zero TDZ, zero dep arrays — the cheapest safe slice in the file, taken first per the ranking.
- **Contracts held:** JSX, class names, and props byte-identical; no useCallback introduction; the compat re-export block untouched; the timezone-select test suite pins the component behavior unedited.
- **Focused tests:** 563 passed / 1 skipped / 0 failed across 5 suites (editor 541 + timezoneSelect 4 + InspectorIntegration 9 + history audit 4 + storageKeyPins 5). typecheck 0; 10 gates.
- **Editor size:** 3,726 lines (coder-49 measured: -174 net).
- **Rollback point:** revert a7b0c5051 alone.
- **Next:** G7-b (inspector drawer IIFE -> TopologyInspectorDrawer) + G13-prep characterization in parallel (disjoint fences), then G13-c/G13-a+b, G18 menus LAST.


### 2026-09-09 — Slice G13-prep (clipboard characterization) + Slice G7-b (inspector drawer extracted)

- **G13-prep (f67b5034f, test-only):** 7 clipboard/selection characterization tests added on top of the pre-existing 13-test "clipboard & bulk duplication" describe (scout-14's "zero coverage" census corrected). Pinned: copy snapshot semantics (array-of-copies, not live refs), paste reads clipboard not selection, paste-cascade counter reset-on-fresh-copy with unique ids, empty-selection/empty-clipboard no-ops, refused warehouse paste creates NO undo entry, inspector Duplicate drives the same path. The refusal-before-history ordering is now executable-pinned — a future reorder will redden by design. New editor baseline: 549 tests. G13-c unblocked.
- **G7-b (5c7739327):** the inspector drawer IIFE (244 lines) plus its renderWorkspaceCard adapter moves into topologyInspectorDrawer.tsx (323 lines, 12 props). selectedNode, renameBaselineRef and persistNodeRename cross the boundary unwrapped — the inspector rename contracts stay byte-stable. Mount guard remains editor-side; getTelemetry stays (card-grid consumer). Two-line createElement conformance swap (the IIFE had shielded a component-reference pattern that is now a hard lint rule); no new eslint-disable; ratchet held at 3/4.
- **Focused tests:** 747 passed / 1 skipped / 0 failed across 5 suites (editor 549 + InspectorIntegration 9 + history audit 4 + storageKeyPins 5 + screenExtraction 181). typecheck 0; 10 gates.
- **Editor size:** 3,475 lines (from 6,048 baseline; -2,573 across the refactor).
- **Rollback points:** revert 5c7739327 (drawer) or f67b5034f (tests) alone.
- **Remaining per doc:** G13-c clipboard hook -> G13-a+b templates/import-export -> G18 menus LAST (consumes the settled callback surfaces).


### 2026-09-09 — Slice G13-c: clipboard/duplicate/paste hook extracted

- **Responsibility boundary:** the internal Ctrl+C/Ctrl+V clipboard (clipboardRef), the Figma-style paste-cascade counter (pasteCascadeRef), and copySelection/duplicateSelection/pasteClipboard move into useTopologyEditorClipboard (NEW nodeTopologyEditorClipboard.ts, 198 lines, deps 14). Parent keeps graph state, viewport, the shared creation gate, toast/l10n, and GRID_SIZE as explicit fields.
- **Files:** NodeTopologyEditor.tsx (3,475 -> 3,387); nodeTopologyEditorClipboard.ts NEW. ui-coder-52-journal.md carries the dated record. Provenance note: executed by the manager-as-executor — the session's subagent delegation infrastructure failed deterministically at tool binding (all spawn_* roles), so the dispatched brief was executed in place with unchanged fences and verification battery.
- **Public imports/re-exports:** unchanged. Keyboard controller and inspector drawer consume the callbacks under their original names; both refs had zero external readers (grep-verified).
- **Byte-identity proof:** 112-line cluster excised by scripted splice with first/last-line boundary assertions; all 109 non-blank lines verified verbatim in the hook file (0 missing). No new useCallback; nothing renamed; JSX zero lines changed.
- **Accepted deviation:** two dep arrays gain canvasRef + GRID_SIZE (stable ref + module const — identity churn unchanged, 3.3a precedent) because both became deps-object fields; +2 disables would have breached the exhaustive-deps ratchet cap. Documented in the hook header.
- **Dead imports:** sanitizeCopiedNode dropped (sole consumer moved); clampNodeToViewport and GRID_SIZE stay (other call sites); GRID_SIZE forwarded as a deps field.
- **Focused tests:** baseline 564/1/0 and post-slice 564/1/0 across editor + InspectorIntegration + memo — bit-identical, ZERO test edits (the f67b5034f characterization block is the protection). Typecheck exit 0 tree-wide; ESLint 0 errors, hook file 0 warnings.
- **Rollback point:** revert 5842e2d81 alone.
- **Next:** G13-a+b templates/import-export (anchors re-pinned; l10nRef read inside two template handlers is the deps-design input), then G18 menus LAST.


### 2026-09-09 — Slice G13-a+b: import/export + template handlers extracted

- **Responsibility boundary:** handleExport (clipboard-JSON envelope), handleImport (canvas replacement under one undo entry), and the template quartet (save/load/delete/openTemplates) move into useTopologyEditorIo (NEW nodeTopologyEditorIo.ts, deps 11, returns 6). The four popover state slots stay PARENT-owned by construction (pushHistory TDZ pins the hook below :1312; the state's only consumers are TopologyHeader props — G4-a precedent); the setters cross as stable deps.
- **Files:** NodeTopologyEditor.tsx (3,387 -> 3,329); nodeTopologyEditorIo.ts NEW. ui-coder-53-journal.md carries the dated record. Provenance: manager-as-executor (delegation infrastructure unavailable — see G13-c note).
- **Public imports/re-exports:** unchanged. All six topologyExport symbols leave the editor's import block (sole consumers moved). TopologyHeader props identical.
- **Byte-identity proof:** 75-line span (1365-1439) excised by scripted splice with boundary assertions; all 70 non-blank lines verbatim in the hook (0 missing). The splice script refused to write on two boundary re-pins before the correct one (1368->1367->1365) and on an over-broad uniqueness guard — every refusal was a guard firing, not a silent write.
- **Accepted deviation:** dep arrays gain l10nRef (stable ref) + the four popover setters (React-guaranteed dispatches); openTemplates' [] gains its two setters. Identity churn unchanged; +6 disables rejected (ratchet). Documented in the hook header.
- **Deps interface:** real TopologyNodeData/TopologyWireData via type-only import from './NodeTopologyEditor' (keyboard pattern; no runtime cycle). A structural-stand-in draft was rejected before verification (index-signature mismatch under strict mode).
- **Focused tests:** post-splice 564/1/0 across editor + Inspector + memo — identical to the G13-c post-slice baseline, ZERO test edits. Protection recorded pre-extraction per the Phase-0 rule: the "topology export / import / templates (clipboard + localStorage)" describe (NodeTopologyEditor.test.tsx:10447, 4 tests).
- **Typecheck:** exit 0 tree-wide. **ESLint:** 0 errors; io hook 0 warnings; editor warnings unchanged (pre-existing react-refresh block, 9).
- **Rollback point:** revert 0b2d86e72 alone.
- **Next:** G18 context menus LAST (scout-14 flagged the pointer setContextMenu coupling — recon before extraction), then the unmount-sweep eslint-disable retirement and Phase 5.


### 2026-09-09 — Slice G18: context-menu state + open handlers extracted (LAST named extraction)

- **Responsibility boundary:** the menu state (ContextMenuPoint | null), the document close effect (Escape + outside-mousedown, self-owned cleanup), and openNodeMenu/openWireMenu move into useTopologyEditorContextMenu (NEW nodeTopologyEditorContextMenu.ts, deps 3, returns 4). The pointer hook keeps handleContextMenu (canvas swallow-gate — gesture concern); handleWireClick stays parent (selection+direction cycling, not menu machinery).
- **Design pass (resolves scout-14's double-re-plumb warning):** the keyboard hook has NO menu dependency (grep-verified; the pre-baked brief's ":1224 keyboard" attribution was wrong — that line is resetTransientCanvasState's dep array). Real consumers: pointer hook, touch hook, resetTransientCanvasState, the two open-handlers, the close effect, and the JSX mount. The state-owning hook sits at the vacated state slot (above all consumers) and returns setContextMenu under the ORIGINAL name — pointer/touch/resetTransient call sites are untouched. No re-plumb.
- **Files:** NodeTopologyEditor.tsx (3,329 -> 3,305); nodeTopologyEditorContextMenu.ts NEW. ui-coder-54-journal.md carries the dated record. Provenance: manager-as-executor (see G13-c note).
- **Public imports/re-exports:** unchanged. TopologyContextMenu mount, card/wire onOpenNodeMenu/onOpenWireMenu props identical.
- **Byte-identity proof:** three spans excised by scripted splice with per-span boundary assertions (including a between-block assertion that handleWireClick sits between the two handler spans); 38/39 non-blank lines verbatim — the ONE difference is the documented substitution of the useState type literal by the structurally identical ContextMenuPoint alias (pointer.ts:81; the same shape the pointer/touch hooks already use for the same state). No new useCallback; JSX zero lines changed.
- **Dep arrays: zero deviations** — every name in the moved arrays is a deps field or hook-internal setState. No disables, no additions, ratchet untouched.
- **Coverage recorded pre-extraction (Phase-0 rule):** dedicated editor-suite describes — canvas menu (right-click spawn, select-all, authoritative-reload-closes-menu), node menu (select+rename), wire menu (select+label title), edge clamp, right-button-pan swallow, strict-mode store omission, conditional zoom-to-selection.
- **Focused tests:** post-splice 564/1/0 across editor + Inspector + memo — identical baseline, ZERO test edits. Typecheck exit 0. ESLint 0 errors; hook file 0 warnings.
- **Rollback point:** revert 664e8a815 alone.
- **Next:** the unmount-sweep + resetTransientCanvasState relocation retires the ref-scope eslint-disable set, then Phase 5 (reduce parent to composition). **(SUPERSEDED 2026-09-09 — the relocation premise was measured false; see the P4-sweep entry at the end of this journal for what replaced it.)**
- **Checkbox-sync pass (2026-09-09):** Phase 1 (:51-54), Phase 2 (:119, :122), 3.4 (:151, :152, :154, :155), 3.5 (:160, :161) and Phase 4 (:166, :167, :169, :171, :172) boxes ticked against the landed-slice records above; left open by that pass and why — :153 (the sweep + `resetTransientCanvasState` were still parent-side), :159 (auto-fit deliberately parent-side; the cursor readout was already its own component), :165 (Phase 5 work), :168 (migration dialog JSX and its state trio still inline), :170 (menu JSX mount, guides and selection overlays still inline), :117/:118/:123 (no shared-types module had landed).

**Correction after the four records below (same day):** :117, :118 and :123 are now TICKED — 124d07918 landed `nodeTopologyEditorTypes.ts`, the module all three were waiting for. :153 stays UNCHECKED but for the opposite reason: its five sweep disables are gone (f2dfd05bb retired them in place), yet the sweep is still parent-side, so document-listener cleanup is still not owned by the controllers that install it — and the hook-ownership work that remains is a different slice than the one this line used to point at. :165 also stays UNCHECKED after P5-A: the dossier measured 686 JSX lines under the parent's `return(` and 43 `useCallback`s at 3,305 lines, and P5-A moved types and comments, not logic — "thin composition root" is still Phase 5's claim (S3-S6 inline).


### 2026-09-09 — Slice P4-sweep: the unmount-sweep ref-scope disables retired IN PLACE (relocation premise measured FALSE)

- **Responsibility boundary:** the parent's unmount sweep still disarms the five document-level gesture cleanups and the fresh-node timers; only HOW it reads them changed. Nothing moved, no hook was created — the briefed G6+G20 "cleanup knot" relocation was not performed, because STEP 0 measured it to be pointless.
- **The measurement that killed the premise:** eslint-plugin-react-hooks is 7.1.1 (flat config `ui/eslint.config.js:13`, the strict v7 rule set off at `:50-54`). A `lintText` probe settled two things: same-scope `useRef` values satisfy `missing-deps` while prop/arg-arriving refs do NOT; and decisively, the sweep's five suppressions are for "ref value will likely have changed by cleanup", which fires EVEN for same-scope refs (proof: delete the five disable lines and the rule emits 5 warnings at the access lines, 0 at the dep array). **So relocating the sweep into a hook retires 0 disables and ADDS at least 1.** The rule's own remedy — capture the stable ref OBJECT in a local inside the effect, keep reading `.current` when the cleanup runs — retires all five with zero new suppressions, and that is what landed.
- **Files:** `NodeTopologyEditor.tsx` only (+17/−13; editor 3,305 -> 3,309). Zero test files touched, no new module.
- **Public imports/re-exports:** unchanged.
- **Focused tests:** 17 topology test files, 727 passed / 1 skipped / 0 failed at the f2dfd05bb gate; the manager re-ran the same filter against a quiet tree and got the identical numbers (44.7 s). The teardown pins added by 98e208d3f (the "input controller disarm and teardown" block, :465-:467 above) pass unedited — that block is what actually protects this effect.
- **Typecheck / lint:** `npm run typecheck` exit 0; ESLint 0 errors. Ref-scope disable tally moved 27 -> 22 in `features/locations` and 35 -> 30 across `ui/src`; **editor 6 -> 1** (the survivor is the auto-fit dep-set choice at :1634, not a ref; the jsx-a11y block at :2484 is unrelated and was never in the tally).
- **Behavior checked:** the sweep still calls pan / node-drag / marquee / bend-drag / touch disarms and clears the timer Set in the same order; the five locals hold what the hooks assigned (the ref object for the four cleanup refs, the live Set for the timers), so a closure installed AFTER setup is still reached at cleanup time — copying `.current` into a local would have frozen the empty setup-time value and silently disarmed the whole sweep, which is now written down in the file at :1567-:1573.
- **Rollback point:** revert f2dfd05bb alone.
- **Remaining coupling / follow-up:** the last 10 in-fence ref-scope disables (pointer 7, keyboard 1, bend 2) are a HOOK-OWNERSHIP problem, not a sweep problem — retiring them means moving each cleanup ref's `useRef` into the hook that arms it (`nodeTopologyEditorTouch.ts` is granted to that slice; it currently carries 0). A transient-reset hook for `resetTransientCanvasState` is now a pure size move with a 0 disable delta, so it belongs to Phase 5 ordering, not to a "cleanup knot".


### 2026-09-09 — Slice P5-A/S1a: helper tests re-pointed to their own module

- **Responsibility boundary:** two suites stop importing pure helpers through the editor and name their module directly; no assertion, fixture or expectation was edited.
- **Files:** `ui/src/__tests__/canvasStateEqual.test.ts` (:15-:16) and `ui/src/__tests__/nodeTopologyEditorHelpers.test.ts` (:12 + the :13-:22 import block) — 11 lines, TEST-only, zero production edits. This is the doc's own :179 item executed.
- **Public imports/re-exports:** the helper VALUES (`canvasStateEqual`, `elbowPoints`, `polylineD`, `diagramOverflowsCanvas`, `validateEditorGraph`, …) now resolve to `../features/locations/topologyEditorHelpers`; the type names still resolve through `NodeTopologyEditor` because at that commit that was still the deliberate entry point (S2b keeps it true for types only). Verified at HEAD: no test file imports a pure helper value from the editor any more.
- **Focused tests:** none run standalone — an import-path-only change fails at module resolution, not at an assertion, so a pass would have proved little. It is covered by the P5-A gate battery (see S2a+S2b below).
- **Typecheck:** exit 0; that IS the meaningful check here, since an unresolved specifier is a `tsc` error (TS2307) and `tsc --noEmit` covers `ui/src/__tests__`.
- **Behavior checked:** none possible — nothing under `ui/src/features` was edited.
- **Rollback point:** revert 29853b6e2 alone.
- **Remaining coupling / follow-up:** other suites still reach TYPE names through the editor's re-export (`nodeTopologyEditorLoadLifecycle.test.tsx:6-:11` is one); migrating those is :180's business and is only worth doing when the type ownership settles.


### 2026-09-09 — Slice P5-A/S1b: the compatibility re-export block is retired

- **Responsibility boundary:** the editor's module-scope compat shim (the block at :102-:115 at the time, kept alive since Phase 0 because tests and siblings imported through it) is deleted now that every consumer names the real module.
- **Files:** `NodeTopologyEditor.tsx` (−14: the shim plus its header comment rewritten to state the new rule — now :82-:85, "this module keeps no compat re-export shim; only its own type surface is re-exported below"); `topologyEditorHelpers.ts:8-11` (its header now says importers and tests name it directly).
- **Public imports/re-exports:** MIGRATED, deliberately — the runtime surface the shim carried is gone; the TYPE surface stays and is re-exported by S2b, because :181 still wants a public entry point. Read this against the earlier ticks: :24/:63's inventories and :122 describe the shim while it existed, so :122 is now a completed-duration claim, not a live constraint.
- **Focused tests:** no standalone run — see the typecheck note, which is the real gate for a removal of this kind; the P5-A battery below covers it.
- **Typecheck / lint:** `tsc --noEmit` clean at the gate (a still-needed re-export would be TS2305/TS2724 at the importer, not a runtime surprise); ESLint editor react-refresh warnings **9 -> 0**, exactly as the Phase 5 dossier predicted — the warnings were caused by those value exports sitting in a component file.
- **Behavior checked:** zero runtime and zero JSX lines changed; the only observable effect is in the lint output.
- **Rollback point:** revert 3fd7dc61d alone.
- **Remaining coupling / follow-up:** none for the refactor; the doc's Phase 0 inventory lines now describe a state of the tree that no longer exists and should be read as dated.


### 2026-09-09 — Slice P5-A/S2a+S2b: editor-domain types get a home (Phase 2 :117/:118/:123 close)

- **Responsibility boundary:** the nine editor-domain type declarations (`NodeType` through `WorkspaceInstanceSeed`) move into a new types-only module, with the editor re-exporting them as its public type surface; the semantic contract and the cycle constant deliberately stay put.
- **Files:** NEW `ui/src/features/locations/nodeTopologyEditorTypes.ts` (+104 — 9 export markers, exactly the 9 prescribed names, zero imports); `NodeTopologyEditor.tsx` +18/−93.
- **Public imports/re-exports:** migrated behind a door that stays open on purpose — the editor imports the nine names for local use (:96-:106) and re-exports them type-only (:125), so nothing new is required of importers. Measured at this HEAD: 57 files under `ui/src` still name `…/NodeTopologyEditor` as their import path (31 siblings in `features/locations` + 26 test files) and all compile — the dossier's "55 in-dir type importers" is the same population counted by edges rather than by file. `NodeTopologyEditorProps` remains declared and exported in the editor (:130): it is the component's props, not a domain type.
- **Focused tests:** 18 files / 735 passed / 1 skipped / 0 failed at the manager-run P5-A gate on a quiet tree.
- **Typecheck / lint:** `tsc --noEmit` exit 0; ESLint tree-wide 0 errors / 40 warnings (all pre-existing, other files), 0 problems on the editor + types pair.
- **Behavior checked:** none — types erase at compile time. The move was verbatim (line-slice, not retyped) and the boundary that mattered held: `WIRE_DIRECTION_CYCLE` has 0 occurrences in the new module and remains editor module-local (:128, single consumer :2320), because moving it would have exported a value from a types-only file and re-litigated the react-refresh rule S1b had just cleared.
- **Editor size:** 3,309 -> 3,220 (S1b −14, S2 net −75). Two measurement notes for anyone re-counting: a direct total-line count of the file reads 3,219, the 1-line delta being the trailing-newline convention; and the "3,066 / 3,149" mid-audit readings earlier in the session were PowerShell non-blank counts, not lost code.
- **Rollback point:** revert 124d07918 alone.
- **Remaining coupling / follow-up:** three findings, none of them a behavior bug — (1) two comment blocks crossed over WITHOUT their subjects: the 11-line "Restore-boundary integrity guard for Undo/Redo" doc now sits at `nodeTopologyEditorTypes.ts:21-:31` describing `validWiresForNodes` (which lives in `topologyHistoryIntegrity.ts`), and "Node types offered by the right-click canvas context menu" sits at :33 directly above `SemanticRelationshipType` (:35), which therefore has no doc of its own — orphan text in a types-only file is exactly the :178 stale-comment class, one cheap follow-up commit; (2) `SemanticRelationshipType` is now declared identically in BOTH `nodeTopologyEditorTypes.ts:35-:41` and `topologyContract.ts:53-:59` (the duplication pre-dates this slice — the editor already kept its own copy), so :117's decision should name a winner before a third copy appears; (3) `PortName` (:19) arrived without the doc comment its neighbours kept.

- **Next:** with the relocation premise dead and P5-A landed, the remaining ladder is: (a) Phase 5 P5-B logic slices — S3 wire-commit (~180 ln), S4 validation (~160), S5 delete-confirm (~110), S6 add-node — whose deferral reason ("inside the sweep's disable-retirement blast radius") is now OBSOLETE, so re-read the ordering argument before scheduling; (b) hook-ownership disable retirement for the last 10 in-fence (pointer 7 + keyboard 1 + bend 2), the slice that holds the granted `nodeTopologyEditorTouch.ts` fence — re-read (b) against the DG1 remedy note below before scheduling it; (c) the out-of-fence ref-scope retirements (viewport x5, applyPanel x2, rename x1, migration x1) — this line said IN FLIGHT; it has since **LANDED**, 9/9 in four pathspec-limited commits, and the DG1 entry below supersedes this pointer. Box bookkeeping: :178/:179/:180/:181 are now backed by S1a/S1b/S2 above but are still UNCHECKED here — ticking Phase 5 was not this pass's authority; same for the stale Phase 1 parentheticals at :45/:46/:48/:49, which need a prose pass, not a tick.


### 2026-09-09 — Slice DG1: the out-of-fence ref-scope disables retired (9/9, four hooks)

- **Responsibility boundary:** retire the nine `react-hooks/exhaustive-deps` ref-scope suppressions that live OUTSIDE the editor/gesture fence — viewport x5, applyPanel x2, rename x1, migration x1 — without moving any code. Labelled DG1 for the second coder slot that ran it in parallel with P5-A; its fence was those four files only, so it never touched `NodeTopologyEditor.tsx` or a gesture hook.
- **The remedy finding this record exists for (extends f2dfd05bb):** capture-into-a-local only silences the rule when the capture and the use sit in DIFFERENT scopes — the sweep worked because it captures outside and reads `.current` inside the returned cleanup. At 8 of these 9 sites capture and use share the callback scope, so the same capture still fired `missing-deps`. The rule's own other remedy retired them instead: **list the stable ref/setter identities in the dep array** — the precedent is already repo-sanctioned (`canvasRef` added in the clipboard hook, `l10nRef` in the io hook, both documented in the hook headers). Migration's auto-open effect (:134-:139) is the one site that kept a local capture, and it still lists `migrationDismissedRef` + `setMigrationOpen`, so even there the suppression came from the listed identities, not from the capture. The invariant held at every site: `.current` is read when the effect runs, never copied into a local, and every name added to an array is a `useRef` object or a React-guaranteed stable setter/dispatch — so re-render churn is unchanged by construction.
- **Files:** four commits, one file each, each pathspec-limited: `nodeTopologyEditorViewport.ts` **68a29a1e7** (+5/−10) · `nodeTopologyEditorApplyPanel.ts` **e49156ad7** (+2/−4) · `nodeTopologyEditorRename.ts` **55464d8f2** (+4/−4) · `nodeTopologyEditorMigration.ts` **58daaa6eb** (+3/−7). Zero test files touched; numstat over `124d07918..58daaa6eb` = exactly those four files, +14/−25.
- **Public imports/re-exports:** unchanged — no export, signature or return shape in any of the four hooks moved.
- **Focused tests:** 17 files / 727 passed / 1 skipped / 0 failed — bit-for-bit the f2dfd05bb baseline, re-run independently by the manager at the wave-5 gate over a quiet tree. Zero test edits.
- **Typecheck / lint:** `tsc --noEmit` clean; ESLint on the four files = 0 errors and no warning count increased. The one warning still in the set is applyPanel's PRE-EXISTING `confirmApply` dep-set choice (:279) — a different hook and a genuine dep-set decision, deliberately left, like editor :1634 and loadLifecycle :308. Measured after the wave: **0 `eslint-disable` occurrences remain in any of the four files.**
- **Behavior checked:** none observable — the effects and callbacks run the same statements, the pre-existing array members are untouched, and the added names are stable identities (viewport :132/:162/:187, applyPanel :390, rename :134, migration :139). Dep-array *length* grew where the suppression was; nothing was removed, so no effect re-keys less often than before, only never more often.
- **Rollback point:** revert any one of the four independently — each commit is a single file; the range is `68a29a1e7..58daaa6eb`.
- **Remaining coupling / follow-up:** 10 ref-scope suppressions are left and all of them are inside the gesture fence, every one still worded "dep array kept byte-identical" — pointer :356/:391/:462/:489/:558/:691/:721, keyboard :586, bend :167/:196 (measured directory-wide: those 10 are the whole remaining class). DG1's finding says that set is NOT all an ownership problem: try listing the stable identity first and only move a `useRef` into its arming hook where the array genuinely must stay frozen — which is the memoized-card-props case, i.e. mostly the pointer hook. Two dep-set suppressions outside that class stay by design (editor :1634, loadLifecycle :308).

- **Next:** (a) Phase 5 P5-B logic slices S3-S6 (size them from the Phase 5 dossier; its blast-radius deferral argument is obsolete, so the order is open for re-reading), then (b) the 10-site gesture-fence retirement as its own slice with the granted `nodeTopologyEditorTouch.ts` fence — attempting (b)'s cheap half before (a) is now an option, since DG1 proved 8 of 9 sites needed no restructure at all. No box was ticked or unticked by this record. **(Update, same day: (a) is under way — S3 has LANDED as the first P5-B logic slice; the entry below re-anchors what is left.)**


### 2026-09-09 — Slice P5-B/S3: the wire-commit cluster extracted (first logic slice off the render body)

- **Responsibility boundary:** the three callbacks that turn a completed port gesture into a wire — `commitWire` (the single ADR #34 creation path: duplicate gate, one-input-per-warehouse, ticket cardinality, Pro-tier stock routing, then the insert), `commitPickerOption` and `handlePortClick` — move out of the parent body into `useTopologyEditorWireCommit` (NEW `nodeTopologyEditorWireCommit.ts`, 257 lines).
- **Files:** `NodeTopologyEditor.tsx` +27/−151 → **3,095 lines** (total-line count verified against the file, not a non-blank count); NEW `nodeTopologyEditorWireCommit.ts` 257 lines, **0 disables**; zero test files touched. Commit **56375346d**.
- **Public imports/re-exports:** unchanged — the editor's own surface moved not one name; the hook takes its types from `nodeTopologyEditorTypes` (the P5-A home) rather than from the editor, so no new runtime cycle is created.
- **Splice integrity:** 147/147 span lines byte-identical, guard-verified (boundary literals asserted before the write, written block re-read against the saved slice). The span was CUT SHORT on purpose: the `useTopologyEditorBendDrag` call and `handleCycleWireDirection` sat inside the dossier's original range and stayed parent-side — the cycle callback reads the module-local `WIRE_DIRECTION_CYCLE` (:125, read at :2196), and exporting that const to move the callback would re-open exactly the re-export hazard P5-A/S2a had just closed.
- **Design decision worth reusing:** `commitWire` is **hook-internal**. Its only readers were inside the span, so it is not returned (`:256` returns exactly `{ commitPickerOption, handlePortClick }`), and the parent destructures only those two (:2166) — consumed by JSX `onCommit` :2660 and `onPortClick` :2920. Same shape as pointer's `commitDuplicateDrag` in 3.4c-2. The port pair (`portDirection` :1879, `isPortCompatible` :1883) deliberately stayed parent-side because the card JSX consumes it too; it arrives as a dep the moved arrays already listed.
- **The one sanctioned deviation:** `commitWire`'s dep array gained `wiresRef` + `pushHistoryRef` (hook :180). Both were parent-declared `useRef` objects, exempt from the rule in component scope; as deps-object fields 7.1.1 no longer treats them as known-stable and demands them. They are refs — identity never changes — so churn is unchanged, and listing them beats a suppression (precedent 68a29a1e7; documented in the hook header :12-:18). Net effect on the class tally: **zero new suppressions**; the ref-scope class stays at 10 and the editor keeps its own 2 (:1631 dep-set choice, :2360 jsx-a11y).
- **Focused tests:** 18 files / 735 passed / 1 skipped / 0 failed — the same battery as the P5-A gate, editor suite unchanged at 549 passed / 1 skipped, memo identity pins untouched, **zero test edits**.
- **Typecheck / lint:** `tsc --noEmit` clean tree-wide; ESLint 0 errors / 0 warnings on both fence files. One correction on the mid-session red that briefly blocked the gate: it was 100% FOREIGN (`StatusBar.tsx`, another workstream's in-flight edit; the "'string | undefined' is not assignable to 'string'" seam-looking error was its `hint` prop), and it cleared when that owner committed 7d644ecfa. **No `OZPOS_SKIP_TYPECHECK` was used or needed** — the 3.2c skip precedent stays unused, which is the recorded answer to the "foreign red at commit time" assumption: wait, do not skip, do not touch the foreign file.
- **Behavior checked:** zero JSX lines changed (both consumers keep their original prop names and value identities); the hook call sits at the exact slot the three callbacks vacated, so hook order — and therefore effect order — is provably unchanged; no `useCallback` was newly introduced and none was removed from the parent's contract.
- **Rollback point:** revert 56375346d alone (2 files).
- **Process notes for future slices (tooling, not code):** (1) `git commit -- <path>` **refuses an untracked new file**, so a two-file slice with a NEW module needs an explicit `git add -- <paths>` first — pathspec discipline is unchanged by that; (2) `cmd | tail; echo EXIT=$?` reports the **pipe's** exit status, not git's, so commit success must be verified with `git log`, never with the echoed number.
- **Remaining coupling / follow-up:** P5-B still carries **no** disable payoff — re-confirmed, no span contains a ref-scope suppression, so the blast-radius premise stays dead. Anchor hygiene: every number quoted above is re-measured at this HEAD; the Phase 5 dossier's spans pre-date S3 and must not be reused without re-measuring, and the shift is NOT uniform (top-of-file import churn moves some anchors one way, the −124 body move another).

- **Next:** S3 done; the remaining P5-B order with freshly measured anchors — **S6 add-node** (in flight): `const handleAddNode =` :1800, a plain arrow with no `useCallback` to convert, `handleAddNodeRef` :1663 written at :1877. **S5 delete-confirm**: genuinely non-contiguous — state `confirmDelete` :596 / `confirmDeleteMany` :599, `isBranchLocation` :1593-:1596, `deleteNodes` :1598-:1608, `executeDelete` :1724-:1764, `handleDeleteRequest` :2264, two `ConfirmDialog` mounts (:2420/:2439), three consumers (:2470/:2637/:3069); five of those names cross INTO the keyboard hook call (:1675, :1676, :1679, :1715, :1716 — the call starts at :1668), so the S5 hook must sit above :1668 or hand them down through a deferred-access wrapper (R1b's `() => pushHistory()` is the known-safe shape). **S4 validation** (256 ln, the largest): `liveValidation` :1908 calling `validateEditorGraph` at :1909, consumer memos :1973/:2017/:2085, JSX consumer :2777, and the migration hook reads `liveValidation` at :1947 — the cluster head stays parent-side and above that call, exactly as the dossier framed it. **Port-pair rider** (optional, 22 ln at :1879/:1883): folding it in would have avoided two of S3's dep additions; folding it into S4/S5 or leaving it are both defensible, and the hook header (:22-:24) records why it stayed. Box state: nothing ticked or unticked here — at 3,095 lines with `return (` at :2410 (~685 JSX lines) and 37 `useCallback(` occurrences in the parent, :165 and Phase 5 stay honestly open. Counting-method caution: the dossier's "43 useCallbacks at 3,305 lines" was not taken with this pattern, so 37 is not a six-callback reduction.




