# Orchestrator Agent 3: Enterprise Mocks (Staff, Workspaces, Topology & Settings)

**Document:** `todo-refactor-devmock-agents-3.md`  
**Role:** Orchestrator Agent 3 (Enterprise Mock Domain Architect)  
**Goal:** Extract staff profiles, authentication tokens, roles/permissions, workspace instances, topology graph persistence, hardware printer mocks, and system settings from `ui/src/dev-mock/tauri-api.ts`. Reduce `tauri-api.ts` into a clean entry router.

**Target File:** `ui/src/dev-mock/tauri-api.ts`  
**Sibling Documents:**
- [`todo-refactor-devmock-agents-1.md`](./todo-refactor-devmock-agents-1.md) (Agent 1 — Dev-Mock Storage Core & Seeding Engine)
- [`todo-refactor-devmock-agents-2.md`](./todo-refactor-devmock-agents-2.md) (Agent 2 — Operational Mocks: Sales, Inventory & Catalog)

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Communication happens strictly through the Git commit history and durable commit subjects.
2. **Commit Subject Convention:**
   - All commits made by Agent 3 MUST use:
     - `refactor(devmock-enterprise): ...`
3. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/dev-mock/handlers/staff.ts` (NEW)
   - `ui/src/dev-mock/handlers/workspaces.ts` (NEW)
   - `ui/src/dev-mock/handlers/topology.ts` (NEW)
   - `ui/src/dev-mock/handlers/settings.ts` (NEW)
   - Final consolidation in `ui/src/dev-mock/tauri-api.ts`.
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit mock storage engine in `ui/src/dev-mock/core/` (Owned by Agent 1).
   - DO NOT edit operational command mocks in `ui/src/dev-mock/handlers/{sales,inventory,catalog,shifts}.ts` (Owned by Agent 2).
5. **Git Dependency Waiting Protocol:**
   - Agent 3 can create and test `staff.ts`, `workspaces.ts`, `topology.ts`, and `settings.ts` independently.
   - Before Phase 3.3 (final consolidation of `tauri-api.ts`), check that Agent 1 and Agent 2 have committed:
     ```powershell
     git log -n 50 --oneline --grep="refactor(devmock-core):"
     git log -n 50 --oneline --grep="refactor(devmock-ops):"
     ```

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [ ] Map remaining staff, workspace, topology, and settings command strings in `tauri-api.ts`.

### Phase 3.1: Extract Staff & Workspace Mocks
- [ ] Move `login_with_pin`, `list_staff`, `create_staff`, `assign_role` mocks to `handlers/staff.ts`.
- [ ] Move `list_workspaces`, `create_workspace_instance`, `resolve_boot_store` mocks to `handlers/workspaces.ts`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(devmock-enterprise): extract staff and workspace mock handlers"
  ```

### Phase 3.2: Extract Topology & Settings Mocks
- [ ] Move `load_topology`, `apply_topology_diff` mocks to `handlers/topology.ts`.
- [ ] Move printer/receipt settings, cloud sync status, and license mocks to `handlers/settings.ts`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(devmock-enterprise): extract topology and settings mock handlers"
  ```

### Phase 3.3: Final Reduction of `tauri-api.ts`
- [ ] *Wait Gate:* Verify Agent 1 has landed `refactor(devmock-core):` and Agent 2 has landed `refactor(devmock-ops):`.
- [ ] Reduce `ui/src/dev-mock/tauri-api.ts` to registering the domain handler maps into `mockDispatcher`.
- [ ] Verify `tauri-api.ts` line count drops from 4,904 to < 200 lines.
- [ ] Run full UI tests: `npm run test` and `npm run check:all`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(devmock-enterprise): modularize dispatcher and reduce tauri-api.ts to router root"
  ```
