# Orchestrator Agent 3: Staff Management UI Deconstruction

**Document:** `todo-refactor-staff-auth-agents-3.md`  
**Role:** Orchestrator Agent 3 (Staff Admin UI Architect)  
**Goal:** Decompose `StaffManagementScreen.tsx` (1,380 lines) into modular sub-components: staff table list, member detail/edit drawer, role matrix editor, and PIN change modal.

**Target File:** `ui/src/features/staff/StaffManagementScreen.tsx` (Baseline: 1,380 lines)  
**Sibling Documents:**
- [`todo-refactor-staff-auth-agents-1.md`](./todo-refactor-staff-auth-agents-1.md) (Agent 1 — Auth & PIN Verification Core)
- [`todo-refactor-staff-auth-agents-2.md`](./todo-refactor-staff-auth-agents-2.md) (Agent 2 — Staff Profile & Permissions Engine)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(staff-ui): ...`
2. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/features/staff/StaffManagementScreen.tsx`
   - `ui/src/features/staff/components/` (StaffTable, StaffDrawer, RoleMatrix, StaffPinModal)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit backend Rust command files (Owned by Agent 1 & Agent 2).

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [x] Run `npm run test -- StaffManagementScreen` in `ui/`. — 27/27 passed at baseline (HEAD `20ab69c77`).
- [x] Run `npm run typecheck` in `ui/`. — 9 errors, **zero** under `features/staff` (all foreign: dev-mock ×2, RestaurantMenu ×5→expanding, WorkspaceHome ×2 — concurrent agents' in-flight work).
- [x] Record line count of `StaffManagementScreen.tsx` — **actual baseline: 1,453 lines** (the 1,380 above is stale; `Measure-Object -Line` undercounts blank lines — the doc's number came from that artifact).

### Phase 3.1: Extract Staff Table & Member Drawer
- [x] Extract `<StaffListTable />` into `components/StaffListTable.tsx`. — table + workspace-unavailable notice + `roleVariant`; presentational, callbacks via props.
- [x] Extract `<StaffDetailDrawer />` (profile fields, wage, active status) into `components/StaffDetailDrawer.tsx`. — the baseline's member editor is a `SettingsPopup` modal, not a drawer UI; extracted under the doc's name with its tightly-coupled state (form/fieldErrors/saving/error/quotaUpgrade, validation, `handleSave`, the profile+options fetch). The old `openEdit` pre-fill became a render-phase reset keyed on (open, member) so the dialog appears pre-filled in the same click; the profile/options fetch is an effect on the same transition — identical invoke sequence per open.
- [x] Verify: `npm run typecheck`. — zero `features/staff` errors after extraction.
- [x] **Commit Milestone:** `0ef0c413e6` — `refactor(staff-ui): extract StaffListTable and StaffDetailDrawer components` (also carried the final composition root and the `screenExtraction.test.ts` staff-entry `additionalTsx` adaptation — see deviations).

### Phase 3.2: Extract Role Matrix & PIN Management
- [x] Extract `<RoleAssignmentMatrix />` into `components/RoleAssignmentMatrix.tsx`. — the "role matrix" in the present file is the **Assignment Access editor** (ADR #35 D5 all/list dimensions + ADR #47 resource axis, global/scoped radios, branch/workspace/entity pickers + `wsIcon`). The role *dropdown* + permission chips stayed in the drawer (~40 lines, coupled to `form.roleId`/`selectedRole`).
- [ ] Extract `<StaffPinChangeModal />` into `components/StaffPinChangeModal.tsx`. — **not done: no separate PIN-change modal exists in the baseline.** PIN is a field inside the add/edit modal, rotated by `handleSave` when non-empty (STAFF-03). That field moved into `StaffDetailDrawer` verbatim; inventing a standalone modal component would add behavior/visuals, which the pure-refactor fence forbids.
- [x] Reduce `StaffManagementScreen.tsx` to < 400 lines (composition root). — **335 lines** (from 1,453). Root keeps list data (`load`), row actions (edit/deactivate-confirm STAFF-10/impersonation), cap banner C2.2, and the loading/error/empty branches.
- [ ] Verify: `npm run check:all`. — **not run per mission override** (it chains Docker E2E, which this session must not start). Replaced by: `npm run test -- StaffManagementScreen.test.tsx api-staff-contract.test.ts errorPolicyCompliance.test.ts screenExtraction.test.ts` (+ `focusVisibleCompliance`, `touchTargetSizing`), `npx eslint` on all four staff files, and `npm run typecheck` — all green for staff; see stamp.
- [x] **Commit Milestone:** `e263b786a1` — `refactor(staff-ui): extract RoleAssignmentMatrix from StaffDetailDrawer` (the composition-root reduction itself landed in `0ef0c413e6` because the drawer was its last remaining subtree).

---

## 🧾 Implementation Stamp (Agent 3 execution, 2026-09-13)

**Baseline → final:** `StaffManagementScreen.tsx` 1,453 → **335** lines.
New files: `components/StaffListTable.tsx` 192 · `components/StaffDetailDrawer.tsx` 890 · `components/RoleAssignmentMatrix.tsx` 298.
Target **< 400 as written: met** (no 500-line deviation needed).

**Commits (branch `0.0.37`, shared):**
1. `0ef0c413e6` refactor(staff-ui): extract StaffListTable and StaffDetailDrawer components — `StaffListTable.tsx` (new), `StaffDetailDrawer.tsx` (new), `StaffManagementScreen.tsx`, `__tests__/screenExtraction.test.ts`
2. `e263b786a1` refactor(staff-ui): extract RoleAssignmentMatrix from StaffDetailDrawer — `RoleAssignmentMatrix.tsx` (new), `StaffDetailDrawer.tsx`, `__tests__/screenExtraction.test.ts`
3. this docs commit — `todo-refactor-staff-auth-agents-3.md`

**Verification at final state:**
- `StaffManagementScreen.test.tsx` 27/27 ✓ (unmodified — all queries still match; JSX moved as-is, same DOM, same invoke sequence under the invoke-coverage guard)
- `api-staff-contract.test.ts` 9/9 ✓ · `errorPolicyCompliance.test.ts` 4/4 ✓ · `screenExtraction.test.ts` staff entry 3/3 ✓
- `npx eslint` root + `components/`: 0 errors, 0 warnings · `npm run typecheck`: 0 errors under `features/staff`
- Pre-commit bundle-parity gate: 0 missing FTL keys across all three commits.
- Combined final run of all eight suites (the six above + `StaffLoginScreen`, `StaffLoginKeyboard`): **265/266 passed** — the single failure is the external `RestaurantMenu` entry (see deviations); every Staff-scoped test is green.

**Deviations & collisions recorded:**
- **Fence extension (necessary):** `ui/src/__tests__/screenExtraction.test.ts` — the StaffManagementScreen entry gained `additionalTsx` for the three component files (same convention as the existing KDS/Settings entries). Without it the dead-class soft check goes red the moment classNames leave the screen file; no other entry was touched.
- **`npm run check:all` skipped** (mission override — chains Docker E2E); scoped gate set above run instead.
- **Transient scanner reds during baseline** (08:44–08:48): `errorPolicyCompliance` / `screenExtraction` / `touchTargetSizing` / `focusVisibleCompliance` intermittently failed with `ReferenceError: listMockLegalEntities is not defined` from `ui/src/dev-mock/tauri-api.ts` — another agent's mid-write dev-mock extraction; passed on re-run after their snapshot settled. Not touched.
- **Residual red at final verification:** `screenExtraction.test.ts` "CSS class integrity — RestaurantMenu" (8 dead `restaurant-card-*` classes) — another agent's in-flight RestaurantMenu extraction; **not caused by, and not fixable inside, this fence** (was green at the 08:48 baseline probe, red from ~08:57 as their work landed uncommitted).
- **No locale changes:** every `Localized` id and `getString` key moved verbatim; `staff.ftl` / `staff.id.ftl` untouched.
- **No CSS changes:** `StaffManagementScreen.css` untouched — extracted components consume its global classes through the root's existing import (the same file-ownership convention the doc's §2 names).
