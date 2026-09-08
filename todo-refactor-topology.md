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

- [ ] Confirm the working tree and identify any unrelated edits before touching topology files.
- [ ] Read the current `NodeTopologyEditor.tsx`, `TopologyScreen.tsx`, `topologyContract.ts`, and topology state modules in chunks.
- [ ] Inventory all imports of `NodeTopologyEditor`, its exported types, and its re-exported helpers.
- [ ] Inventory the current topology test coverage, especially `NodeTopologyEditor.test.tsx` and `InspectorIntegration.test.tsx`.
- [ ] Record the baseline file size and the current responsibilities still inside `NodeTopologyEditor.tsx`.
- [ ] Run the focused topology tests and `npm run typecheck` from `ui/`; save the results in the task notes or journal.
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

## Completion checklist

- [ ] `NodeTopologyEditor.tsx` is a small composition root rather than the owner of unrelated state machines and event systems.
- [ ] Each major responsibility has a named module with a narrow typed interface and focused tests.
- [ ] Existing topology entry points, exported types, tests, localization IDs, ARIA behavior, and CSS hooks remain supported or have an explicitly reviewed migration.
- [ ] Load/save/apply, revision conflict, dirty-state, undo/redo, validation, mouse, keyboard, touch, and pointer-cleanup tests pass.
- [ ] UI lint, typecheck, focused tests, and the agreed broader UI validation pass.
- [ ] Compatibility re-exports and transitional adapters have been removed only after a verified usage search.
- [ ] The final change log or journal records the slices completed, verification performed, and any follow-up work intentionally deferred.
