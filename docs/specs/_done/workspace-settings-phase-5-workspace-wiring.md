# Phase 5 — Workspace Wiring

- **Status:** IMPLEMENTED (ADR #22 unified workspace settings shipped in 0.0.19; re-audited 2026-08-08 by docs-auditor)
- **Phase:** 5 of 11 (Workspace Settings Architecture — ADR #22)
- **Parent:** `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md`
- **Severity:** CORE (highest user-facing risk — replaces two in-production components)
- **Dependencies:** Phase 0a (SettingsPage extraction), Phase 0b (SettingsContext), Phase 0c (terminal_profile.json), Phase 0e (async event bus), Phase 1 (shared cards), Phase 3 (Tier 1), Phase 4 (modal)
- **Owner:** TBD
- **Est. effort:** 3-5 days

## Summary

Replace `RetailOptionsScreen` in `RetailPosScreen.tsx` (Store POS, F10 hotkey, full overlay modal) and `SettingsSubScreen` in `PosScreen.tsx` (Restaurant POS, gear icon click, inline sub-screen) with `WorkspaceSettingsModal`. Add `aria-modal="true"` guards to all POS hotkey handlers. The F10 binding fires for all roles; the modal role-gates its content (Cashiers see only `TerminalPreferencesCard`). This is the highest-risk phase because it removes two in-production components.

## Baseline (pre-fix)

- `ui/src/features/retail/RetailOptionsScreen.tsx`: 8-tab modal overlay opened by F10 inside Store POS (`RetailPosScreen.tsx`). Legacy modal styles, hardcoded colors, raw inputs. ~1,000+ lines.
- `ui/src/features/sales/PosScreen.tsx` line 321: `SettingsSubScreen` — 4-tab inline sub-screen opened by gear icon click inside Restaurant POS. Rendered at line 1249 when `showSettings` is `true`.
- No `aria-modal="true"` guard exists on POS hotkey handlers — pressing F1 (Pay) while typing in settings currently triggers checkout

## Acceptance criteria

### Store POS (RetailPosScreen.tsx)
- [ ] `F10` hotkey in `RetailPosScreen.tsx` opens `WorkspaceSettingsModal` with `presentation="overlay"`
- [ ] Modal renders `WorkspaceStorePosSettings` scoped to the active workspace
- [ ] `RetailOptionsScreen` import removed from `RetailPosScreen.tsx`
- [ ] `RetailOptionsScreen.tsx` still exists on disk (deprecation is Phase 6) but is no longer imported
- [ ] Feature flag `workspace-settings-v2` gates the F10 handler — when disabled, F10 opens legacy `RetailOptionsScreen`

### Restaurant POS (PosScreen.tsx)
- [ ] Gear icon click in `PosScreen.tsx` opens `WorkspaceSettingsModal` with `presentation="slideover"`
- [ ] Modal renders `WorkspaceRestaurantPosSettings` scoped to the active dining workspace
- [ ] `SettingsSubScreen` function removed from `PosScreen.tsx`
- [ ] `showSettings` state and the gear icon handler wired to the new modal
- [ ] Feature flag gates the gear icon handler

### POS hotkey guards
- [ ] All POS hotkey handlers (F1-F12, numeric keypad, scanner input handlers) in both `RetailPosScreen.tsx` and `PosScreen.tsx` check `document.querySelector('[aria-modal="true"]')` and return early if a modal is open
- [ ] This includes: F1 (Pay), F3 (Discount), F4 (Hold), F6 (Void), F7 (Cash), F8 (Card), F9 (QRIS), F12 (New Sale), product scan handlers

### Role-gating
- [ ] F10 binding fires for **all roles** (Cashier, Manager, Owner)
- [ ] Modal internally inspects `useAuth().role` and renders:
  - Owner/Manager → full `WorkspaceStorePosSettings` or `WorkspaceRestaurantPosSettings`
  - Cashier → `TerminalPreferencesCard` only
- [ ] Cashier sees no "Admin Settings ↗" button, no store-level settings

## Plan

1. Create feature flag constant `WORKSPACE_SETTINGS_V2` (read from `terminal_profile.json` or environment)
2. **Store POS**: In `RetailPosScreen.tsx`, add conditional branch: if feature flag enabled, F10 opens `WorkspaceSettingsModal`; else opens `RetailOptionsScreen`
3. **Restaurant POS**: In `PosScreen.tsx`, add conditional branch: if feature flag enabled, gear icon opens `WorkspaceSettingsModal` with `presentation="slideover"`; else toggles `showSettings` (legacy)
4. Add `aria-modal` guard function: `isAnyModalOpen(): boolean` → `document.querySelector('[aria-modal="true"]') !== null`
5. Add guard check as first line in every POS hotkey and scanner handler
6. Pass `terminalId`, `sessionToken`, `locationId` to `WorkspaceSettingsModal` from POS context
7. Test manually: F1 (Pay) does nothing while modal is open
8. Test manually: F10 → modal opens → Esc → modal closes → F10 opens again
9. Test manually: Cashier presses F10 → sees only `TerminalPreferencesCard`
10. Write E2E test: F10 → Admin Settings ↗ → SettingsPage
11. Write integration test: role-swap timeout mid-modal

## Verification

| Check | Expected |
|-------|----------|
| `cd ui && npm run typecheck` | exit 0 |
| `cd ui && npm run lint` | exit 0 |
| `cd ui && npx playwright test --config e2e/playwright.config.ts --project=desktop -g "F10|Admin Settings"` | all passing |
| Integration test: Manager → Cashier timeout mid-modal → content switches | Pass |
| Manual: open Store POS → press F10 → modal shows printer/scanner/receipt config | Pass |
| Manual: while modal open, press F1 (Pay) → nothing happens | Pass |
| Manual: open Restaurant POS → click gear icon → slideover panel shows kitchen printer/tables config | Pass |
| Manual: disable feature flag → F10 opens legacy RetailOptionsScreen | Pass |
| Manual: enable feature flag → F10 opens WorkspaceSettingsModal | Pass |

## Rollback

- Feature flag `workspace-settings-v2` is toggled per-terminal via `terminal_profile.json`
- When disabled, both POS screens revert to legacy components immediately — no code deployment needed
- Phase 6 (deletion of `RetailOptionsScreen.tsx`) must not occur until the feature flag has been enabled in production for at least one full release cycle with no reported regressions

## Residual / follow-ups

- Phase 6: delete `RetailOptionsScreen.tsx` and legacy CSS after one release cycle with flag enabled
- `SettingsPopup.tsx` remains untouched (used by Tax, Categories, Customers, Staff, Terminals, Suppliers CRUD forms)
- `KdsSettingsPanel.tsx` remains functional during Phase 5; works alongside WorkspaceKdsSettings in the topology inspector

## References

- `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md` §Phase 5, §Backward Compatibility & Rollback
- `ui/src/features/retail/RetailOptionsScreen.tsx`
- `ui/src/features/retail/RetailPosScreen.tsx`
- `ui/src/features/sales/PosScreen.tsx`

> (status corrected to IMPLEMENTED).
>
> last audited 08-08-26 by docs-auditor
