# Phase 2 — Topology Integration

- **Status:** IMPLEMENTED (ADR #22 unified workspace settings shipped in 0.0.19; re-audited 2026-08-08 by docs-auditor)
- **Phase:** 2 of 11 (Workspace Settings Architecture — ADR #22)
- **Parent:** `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md`
- **Severity:** CORE
- **Dependencies:** Phase 0b (SettingsContext), Phase 0d (delta ledger), Phase 1 (shared cards)
- **Owner:** TBD
- **Est. effort:** 3-4 days

## Summary

Wire the shared workspace cards into `NodeTopologyEditor.tsx`'s existing right Inspector Drawer. Replace the hardcoded inspector fields (node name, subtitle, coordinates, workspace type selector, warehouse hints) with shared settings cards rendered via `variant="inspector-drawer"`. Add live status badges to topology nodes that read from `SettingsContext`.

## Baseline (pre-fix)

- `NodeTopologyEditor.tsx`: Inspector drawer renders hardcoded fields — node name input, subtitle input, coordinates display, workspace type `<select>`, warehouse hints paragraph
- Inspector drawer is a fixed 300px right panel with `.node-inspector-drawer` class
- No shared settings cards are embedded in the inspector
- Topology nodes already show telemetry badges (`telemetryBadge`, `telemetryStatus`) on node cards, but these are static strings from node data, not live readings from `SettingsContext`
- `TopologyScreen.tsx`: Wraps `NodeTopologyEditor` with `workspaceInstances` prop and `onSave` callback

## Acceptance criteria

### Inspector drawer refactor
- [ ] Inspector drawer accepts a `children` slot or renders a `<WorkspaceCardAdapter>` component
- [ ] When a workspace node is selected, the inspector renders `WorkspaceStorePosSettings` or `WorkspaceRestaurantPosSettings` (depending on `metadata.typeKey`) with `variant="inspector-drawer"`
- [ ] When a store node is selected, the inspector renders a `StoreInfoCard` (read-only: name, address, branch)
- [ ] When a warehouse node is selected, the inspector renders `WorkspaceInventorySettings` with `variant="inspector-drawer"`
- [ ] When a hardware node is selected, the inspector renders the printer/scanner card with `variant="inspector-drawer"`
- [ ] Inspector drawer width accommodates card content without horizontal scroll at 300px
- [ ] Inspector close button still works (existing `X` button → `setSelectedNodeId(null)`)

### Live telemetry badges
- [ ] Topology node badges read from `SettingsContext` instead of static node data
- [ ] Badge content updates reactively when settings change (via `useSettings()` subscription)
- [ ] Badge examples: "Receipt ✓" (printer configured), "KDS 5m" (SLA threshold), "Low Stock 12" (inventory items below threshold)
- [ ] Badge status colors (online/warning/offline) reflect actual telemetry state
- [ ] Badges gracefully handle `SettingsContext` loading state (show spinner, not error)

## Plan

1. Refactor `NodeTopologyEditor.tsx` inspector drawer to accept a `children` prop or render a `<WorkspaceCardAdapter>` based on selected node type
2. Map node types to card components:
   - `workspace` + `typeKey='store-pos'` → `WorkspaceStorePosSettings`
   - `workspace` + `typeKey='restaurant-pos'` → `WorkspaceRestaurantPosSettings`
   - `workspace` + `typeKey='kds'` → `WorkspaceKdsSettings`
   - `warehouse` → `WorkspaceInventorySettings`
   - `store` → `StoreInfoCard` (new read-only component)
   - `hardware` → printer/scanner read-only view
3. Pass `terminalId` to cards rendered in the inspector (retrieved from the selected node's metadata or the active terminal)
4. Replace static telemetry badges with `useSettings()`-driven live badges
5. Add badge computation logic: receipt configured check, KDS SLA display, low stock count
6. Write E2E test: topology canvas → select node → inspector drawer renders correct card

## Verification

| Check | Expected |
|-------|----------|
| `cd ui && npm run typecheck` | exit 0 |
| `cd ui && npm run lint` | exit 0 |
| `cd ui && npx playwright test --config e2e/playwright.config.ts --project=desktop -g "topology"` | all passing |
| Manual: select Store POS workspace node → inspector shows printer config | Pass |
| Manual: select Warehouse node → inspector shows inventory thresholds | Pass |
| Manual: change receipt footer in SettingsPage → topology badge updates within debounce window | Pass |

## Residual / follow-ups

- `StoreInfoCard` and hardware read-only view are new components created in this phase
- The inspector drawer currently renders a single card at a time — tabbed inspector (multiple cards) is a future enhancement
- Badge computation logic is hardcoded per node type; a plugin-based badge system is deferred

## References

- `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md` §Pillar E, §Phase 2
- `ui/src/features/stores/NodeTopologyEditor.tsx`
- `ui/src/features/stores/TopologyScreen.tsx`
- `ui/src/features/stores/NodeTopologyIcons.tsx`

> (status corrected to IMPLEMENTED).
>
> last audited 08-08-26 by docs-auditor
