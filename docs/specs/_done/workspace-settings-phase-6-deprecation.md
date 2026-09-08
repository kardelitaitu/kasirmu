# Phase 6 — Deprecation

- **Status:** IMPLEMENTED (ADR #22 unified workspace settings shipped in 0.0.19; re-audited 2026-08-08 by docs-auditor) (gated — must wait one full release cycle after Phase 5)
- **Phase:** 6 of 11 (Workspace Settings Architecture — ADR #22)
- **Parent:** `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md`
- **Severity:** LOW (safe if feature-flag gated)
- **Dependencies:** Phase 5 (workspace wiring) deployed and flagged on for one full release cycle with no reported regressions
- **Owner:** TBD
- **Est. effort:** 1 day

## Summary

Delete the obsolete `RetailOptionsScreen.tsx` component and clean up legacy CSS rules. Remove the `workspace-settings-v2` feature flag from the codebase (it served its purpose during the Phase 5 rollout). This is the final cleanup phase — all functionality has been migrated to `WorkspaceSettingsModal` and verified in production for at least one release cycle.

## Baseline (pre-fix)

- `ui/src/features/retail/RetailOptionsScreen.tsx`: Still exists on disk. No longer imported by `RetailPosScreen.tsx` (Phase 5 removed the import). Dead code.
- `ui/src/features/retail/RetailPosScreen.css`: Contains legacy CSS rules for `RetailOptionsScreen` (`.retail-options-overlay`, `.retail-options-tabs`, `.retail-options-tab`, etc.)
- Feature flag `workspace-settings-v2`: Still present in `RetailPosScreen.tsx` and `PosScreen.tsx` as a conditional branch. The `else` path (legacy components) is dead code since the flag has been enabled for a full release cycle.
- `SettingsSubScreen` function in `PosScreen.tsx`: Removed in Phase 5. Any remaining references (type imports, CSS) may still exist.

## Acceptance criteria

### Deletion
- [ ] `ui/src/features/retail/RetailOptionsScreen.tsx` deleted
- [ ] `RetailOptionsScreen` import and any type references removed from all files
- [ ] `SettingsSubScreen` function and any remaining references removed from `PosScreen.tsx`
- [ ] Legacy CSS rules for `RetailOptionsScreen` removed from `RetailPosScreen.css`

### Feature flag removal
- [ ] `workspace-settings-v2` feature flag constant removed
- [ ] Conditional branches in `RetailPosScreen.tsx` and `PosScreen.tsx` simplified to always use `WorkspaceSettingsModal` (remove `else` dead code)
- [ ] Feature flag removed from `terminal_profile.json` default template (if present)

### Verification of no broken references
- [ ] `npm run typecheck` passes with no errors about missing imports
- [ ] `npm run lint` passes
- [ ] No `RetailOptionsScreen` references remain in the codebase (verified via `rg RetailOptionsScreen`)
- [ ] All E2E tests pass (especially settings, admin workflows, POS workflows)
- [ ] All §9 testing gates pass (this is Phase 6's gate — "All §9 gates must pass")

## Plan

1. Delete `ui/src/features/retail/RetailOptionsScreen.tsx`
2. Delete `ui/src/features/retail/__tests__/RetailOptionsScreen.test.tsx` (if it exists)
3. Clean up `RetailPosScreen.css` — remove `.retail-options-*` CSS rules
4. Remove `workspace-settings-v2` feature flag constant
5. Simplify conditional branches in `RetailPosScreen.tsx` and `PosScreen.tsx`:
   - Remove `if (featureFlag) { WorkspaceSettingsModal } else { RetailOptionsScreen }` → just `WorkspaceSettingsModal`
6. Run `rg RetailOptionsScreen` to verify no remaining references
7. Run full test suite

## Verification

| Check | Expected |
|-------|----------|
| `cd ui && npm run typecheck` | exit 0 |
| `cd ui && npm run lint` | exit 0 |
| `rg RetailOptionsScreen ui/src` | 0 matches |
| `rg SettingsSubScreen ui/src` | 0 matches (except PosScreen.tsx if still referenced internally) |
| `cd ui && npx playwright test --config e2e/playwright.config.ts --project=desktop` | all non-skipped tests pass |
| `cd ui && npx vitest run` | all passing |
| Manual: open Store POS → press F10 → WorkspaceSettingsModal opens | Pass |
| Manual: open Restaurant POS → click gear icon → slideover panel opens | Pass |

## Residual / follow-ups

- `SettingsPopup.tsx` remains in the codebase (used by Tax, Categories, Customers, Staff, Terminals, Suppliers CRUD forms — not a settings migration target)
- `KdsSettingsPanel.tsx` remains functional until `WorkspaceKdsSettings` is feature-complete (tracked separately)
- Any legacy CSS classes not covered by this spec should be cleaned up in a separate CSS audit PR

## References

- `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md` §Phase 6, §Backward Compatibility & Rollback
- `ui/src/features/retail/RetailOptionsScreen.tsx`
- `ui/src/features/retail/RetailPosScreen.tsx`
- `ui/src/features/retail/RetailPosScreen.css`
- `ui/src/features/sales/PosScreen.tsx`

> (status corrected to IMPLEMENTED).
>
> last audited 08-08-26 by docs-auditor
