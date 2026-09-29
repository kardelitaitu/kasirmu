<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · Clean pass. `ui/src/features/settings/WorkspaceSettingsModal.tsx` exists at exactly the path the Plan specifies, with a paired `WorkspaceSettingsModal.module.css` and two dedicated test files — `ui/src/__tests__/WorkspaceSettingsModal.test.tsx` and `ui/src/__tests__/WorkspaceSettingsModal.role-swap.test.tsx`. That second file is worth calling out: this phase's hardest acceptance criterion is role-gated content with a live session role swap mid-modal (Cashier sees only `TerminalPreferencesCard`; Manager sees the full card), and there is a test named for exactly that scenario. · The Baseline line "No animated modal dismiss exists (`useExitAnimation` is referenced but needs verification)" resolves in the phase's favour: `ui/src/hooks/useExitAnimation.ts` exists and is listed in the hooks directory, so the "may need to be created or adapted" worry in the Residual section was resolved rather than deferred. · The dependencies the criteria assume are also real — `ui/src/hooks/useFocusTrap.ts` (exported at line 57, the signature the modal criteria rely on) and `ui/src/components/SettingsPopup.tsx` as the modal pattern reference. The POS hotkey guard this phase specifies uses `document.querySelector('[aria-modal="true"]')`, and `isAnyOverlayOpen()` — the same predicate named in the modal checklist audited earlier in this campaign — exists in `ui/src/features/retail/RetailPosScreen.tsx`, so the guard has a real implementation to build on. Same unchecked-criteria note as the sibling 0-phase files: Status says IMPLEMENTED while every acceptance box is open. I did not tick them — confirming the artifacts exist is not the same as running the typecheck/lint/unit/E2E suites the boxes assert, and a ticked box is a claim about a verification I did not perform. -->
# Phase 4 — Tier 2 Modal (WorkspaceSettingsModal)

- **Status:** IMPLEMENTED (ADR #22 unified workspace settings shipped in 0.0.19; re-audited 2026-08-08 by docs-auditor)
- **Phase:** 4 of 11 (Workspace Settings Architecture — ADR #22)
- **Parent:** `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md`
- **Severity:** CORE
- **Dependencies:** Phase 0b (SettingsContext), Phase 1 (shared cards)
- **Owner:** TBD
- **Est. effort:** 3-4 days

## Summary

Implement `WorkspaceSettingsModal.tsx` — the Tier 2 contextual modal that opens via F10 inside a workspace. The modal renders the appropriate shared workspace card scoped to the active workspace, handles role-based content gating (Cashiers see only `TerminalPreferencesCard`), isolates POS hotkeys while open, traps focus, animates entry/exit, and provides an "Admin Settings ↗" shortcut to the Tier 1 hub.

## Baseline (pre-fix)

- `ui/src/features/settings/WorkspaceSettingsModal.tsx` — **does not exist**
- `ui/src/frontend/shared/SettingsPopup.tsx` — generic CRUD form modal (createPortal, focus trap, backdrop close). Used as a pattern reference.
- `ui/src/hooks/useFocusTrap.ts` — exists, used by `SettingsPopup` and `SettingsNavTree`
- No animated modal dismiss exists (`useExitAnimation` is referenced but needs verification)

## Acceptance criteria

### Modal behavior
- [ ] `WorkspaceSettingsModal` renders as a portal at `document.body`
- [ ] Uses `role="dialog"` and `aria-modal="true"`
- [ ] Heading linked via `aria-labelledby="workspace-settings-title"`
- [ ] Uses `useFocusTrap` to trap tab focus within the modal
- [ ] Pressing `Esc` closes the modal using `useExitAnimation` (no visual snap)
- [ ] Clicking the backdrop (outside the modal panel) closes the modal
- [ ] `presentation="overlay"` renders full-screen centered modal (Store POS)
- [ ] `presentation="slideover"` renders right-edge slide-over panel (Restaurant POS)

### Role-gated content
- [ ] Modal inspects `useAuth().role` on mount and on session change
- [ ] **Owner/Manager**: Renders the full shared workspace card for the active workspace
- [ ] **Cashier**: Renders only `TerminalPreferencesCard` (no store settings, no Admin ↗ shortcut)
- [ ] Session role swap (Manager → Cashier timeout) → modal content switches to `TerminalPreferencesCard`
- [ ] Session role swap (Cashier → Manager login) → modal content upgrades to full card

### POS hotkey isolation
- [ ] While modal is open, all POS hotkey handlers (F1-F12, numeric keypad) check `document.querySelector('[aria-modal="true"]')` and return early
- [ ] This prevents "F1 Pay" from triggering checkout while typing in the settings modal

### Admin Settings shortcut
- [ ] "Admin Settings ↗" button in modal header (Owners/Managers only)
- [ ] Clicking navigates to `#/settings` (Tier 1 hub) and closes the modal
- [ ] If offline (no route available), shows toast: "Settings Hub is unavailable offline."

### Nested modal focus trap
- [ ] If a `SettingsPopup` (CRUD form) opens inside `WorkspaceSettingsModal`, the outer focus trap suspends
- [ ] Track nested modal depth via ref counter
- [ ] Re-engage outer trap after inner modal closes
- [ ] `Esc` dismissal order: inner modal closes first, then outer

## Plan

1. Create `ui/src/features/settings/WorkspaceSettingsModal.tsx`
2. Implement portal rendering with `createPortal` to `document.body`
3. Implement `presentation` prop support: `'overlay'` and `'slideover'` CSS classes
4. Wire `useFocusTrap` for tab cycling
5. Wire `useExitAnimation` for smooth dismiss (600ms duration)
6. Implement role-gated content: `useAuth().role` → conditional card rendering
7. Implement `useAuth()` reactive subscription for session change handling
8. Implement nested modal depth tracking for focus trap suspension
9. Implement "Admin Settings ↗" button with offline degradation
10. Write integration tests: role-swap, Esc dismissal, focus trap, nested modal

## Verification

| Check | Expected |
|-------|----------|
| `cd ui && npm run typecheck` | exit 0 |
| `cd ui && npm run lint` | exit 0 |
| `cd ui && npx vitest run src/features/settings/__tests__/WorkspaceSettingsModal.test.tsx` | all passing |
| Unit: modal opens → renders correct card for role | Pass |
| Unit: role swap mid-modal → content switches | Pass |
| Unit: Esc → modal closes with animation | Pass |
| Unit: nested SettingsPopup → outer focus trap suspended | Pass |
| Unit: Admin Settings ↗ offline → toast appears | Pass |
| A11y: focus trap, Esc dismissal, aria-modal verified | Pass |

## Residual / follow-ups

- The modal is created but not yet wired to F10 in Retail/POS screens (Phase 5)
- `useExitAnimation` hook may need to be created or adapted from existing CSS transition patterns
- The "slideover" variant needs CSS that slides from the right edge — may reuse the inspector drawer pattern from `NodeTopologyEditor.tsx`

## References

- `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md` §Pillar F, §Edge Case #2, #5, #6, #7, #9, §Phase 4
- `ui/src/frontend/shared/SettingsPopup.tsx` (modal pattern reference)
- `ui/src/hooks/useFocusTrap.ts`
- `ui/src/features/stores/NodeTopologyEditor.tsx` (inspector drawer CSS pattern for slideover)

> (status corrected to IMPLEMENTED).
>
> last audited 29-09-26 by docs-auditor
