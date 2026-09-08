# Phase 1 — Shared Cards & Local Profile

- **Status:** IMPLEMENTED (ADR #22 unified workspace settings shipped in 0.0.19; re-audited 2026-08-08 by docs-auditor)
- **Phase:** 1 of 11 (Workspace Settings Architecture — ADR #22)
- **Parent:** `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md`
- **Severity:** CORE
- **Dependencies:** Phase 0b (SettingsContext), Phase 0c (terminal_profile.json + hook)
- **Owner:** TBD
- **Est. effort:** 4-6 days

## Summary

Create the 5 shared workspace card components under `ui/src/features/settings/workspace-cards/`. Each card encapsulates settings logic for a specific workspace type with terminal profile separation for local hardware. Cards consume `useSettings()` (Phase 0b) for shared state and `useTerminalProfile(terminalId)` (Phase 0c) for register-local hardware bindings.

## Baseline (pre-fix)

- `ui/src/features/settings/workspace-cards/` — **does not exist**
- Settings logic for each workspace type is scattered across `SettingsPage.tsx`, `RetailOptionsScreen.tsx`, `SettingsSubScreen` (in `PosScreen.tsx`)
- No typed `WorkspaceCardProps` interface exists
- No card renders in `variant='full-page' | 'modal' | 'inspector-drawer'` modes

## Components to Create

| Component | Purpose | State Sources |
| :--- | :--- | :--- |
| `WorkspaceCardProps` interface | Shared props interface for all cards | Re-exported from index |
| `WorkspaceStorePosSettings.tsx` | Receipt layout, printers, scanners, scale, presets | `useSettings()` + `useTerminalProfile()` |
| `WorkspaceRestaurantPosSettings.tsx` | Kitchen printers, table management, course rules | `useSettings()` + `useTerminalProfile()` |
| `WorkspaceKdsSettings.tsx` | KDS layout, SLA timers, ticket colors, audio chimes | `useSettings()` |
| `WorkspaceInventorySettings.tsx` | Low stock thresholds, deduction location rules | `useSettings()` |
| `TerminalPreferencesCard.tsx` | Local terminal: theme, sound, scale zeroing | `useTerminalProfile()` |

## `WorkspaceCardProps` Interface

```tsx
export interface WorkspaceCardProps {
  sessionToken?: string;
  locationId?: string;
  terminalId?: string;
  variant?: 'full-page' | 'modal' | 'inspector-drawer';
  onSaved?: () => void;
}
```

- `terminalId` is **required when `variant='modal'`** (Tier 2) so the card knows which register's hardware bindings to display
- `variant` controls card width, padding, and whether the card renders a header bar (full-page/modal) or is embedded (inspector-drawer)
- `onSaved` fires after successful save — used by parent to dismiss modal, show toast, or trigger topology badge refresh

## Acceptance criteria

### Shared card behavior
- [ ] All 5 cards render correctly in all 3 variants (`full-page`, `modal`, `inspector-drawer`)
- [ ] Cards use local draft state (`useState`) for all form fields — unsaved edits are isolated
- [ ] Save button is disabled when no changes have been made (dirty tracking)
- [ ] Save calls appropriate IPC + publishes `settings_updated` event
- [ ] Cards wrapped in `<ErrorBoundary>` — IPC errors render retry UI, don't crash parent
- [ ] `variant='inspector-drawer'` renders compact layout suitable for 300px sidebar width

### Terminal profile integration
- [ ] `WorkspaceStorePosSettings` reads/writes printer config via `useTerminalProfile(terminalId)`
- [ ] `WorkspaceRestaurantPosSettings` reads/writes kitchen printer config via `useTerminalProfile(terminalId)`
- [ ] `TerminalPreferencesCard` reads/writes sound, theme, scale zeroing via `useTerminalProfile(terminalId)`
- [ ] Changing printer IP via card → `terminal_profile.json` updated within 3-phase commit

### Form draft isolation
- [ ] Editing a printer IP and closing modal via `Esc` → value reverts, no dirty state leaked
- [ ] Editing a printer IP and clicking Save → value committed to `terminal_profile.json` + SQLite
- [ ] Unit test: modify form field → don't save → reopen card → old value shown

### Concurrent edit detection
- [ ] Card checks `version` from Phase 0d delta ledger on save
- [ ] If version incremented since load: show `ConfirmDialog` "This setting was modified by another terminal. Overwrite?"
- [ ] Accept → force-push value; Cancel → reload other terminal's value

## Plan

1. Create `ui/src/features/settings/workspace-cards/` directory
2. Define and export `WorkspaceCardProps` interface in `workspace-cards/types.ts`
3. Implement `WorkspaceStorePosSettings.tsx` — receipt layout, printer, scanner, scale, presets
4. Implement `WorkspaceRestaurantPosSettings.tsx` — kitchen printers, table rules, course config
5. Implement `WorkspaceKdsSettings.tsx` — layout mode, SLA thresholds, colors, chimes
6. Implement `WorkspaceInventorySettings.tsx` — low stock thresholds, deduction location
7. Implement `TerminalPreferencesCard.tsx` — theme toggle, sound volume slider, scale zeroing
8. Write unit tests for each card: save/load cycle, draft isolation, form validation
9. Write unit test: concurrent-edit detection via version mismatch

## Verification

| Check | Expected |
|-------|----------|
| `cd ui && npm run typecheck` | exit 0 |
| `cd ui && npm run lint` | exit 0 |
| `cd ui && npx vitest run src/features/settings/workspace-cards/__tests__/` | all passing |
| Unit: card render in all 3 variants | Pass |
| Unit: draft isolation (edit → close → reopen → old value) | Pass |
| Unit: save → terminal_profile.json updated | Pass |
| Unit: concurrent edit dialog triggers on version mismatch | Pass |

## Residual / follow-ups

- Cards are created but not yet wired into SettingsPage (Phase 3) or WorkspaceSettingsModal (Phase 4-5)
- Cards are not yet imported via `React.lazy()` (Phase 3 code splitting)
- Printer connectivity test ("Test Print" button) is a UI enhancement for a future sprint
- WorkspaceInventorySettings stock deduction priority wires are view-only in Phase 1; editing is in Phase 2 topology integration

## References

- `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md` §Pillar A, §Edge Case #4, #8, §Phase 1
- `ui/src/features/settings/AppearanceSettings.tsx` (existing embedded card pattern)
- `ui/src/components/Card.tsx` (Card component used by settings)
- `ui/src/features/kds/KdsSettingsPanel.tsx` (existing KDS settings — source of truth for KDS fields)

> (status corrected to IMPLEMENTED).
>
> last audited 08-08-26 by docs-auditor
