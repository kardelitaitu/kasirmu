# Orchestrator Agent 3: Enterprise Mocks (Staff, Workspaces, Topology & Settings)

**Document:** `todo-refactor-devmock-agents-3.md`  
**Role:** Orchestrator Agent 3 (Enterprise Mock Domain Architect)  
**Goal:** Extract staff profiles, authentication tokens, roles/permissions, workspace instances, topology graph persistence, hardware printer mocks, and system settings from `ui/src/dev-mock/tauri-api.ts`. Reduce `tauri-api.ts` into a clean entry router.

**Target File:** `ui/src/dev-mock/tauri-api.ts`  
**Shared-file hazard:** all four plans edit this one file, so these lanes are serial on it,
not parallel. Every commit named below carries an explicit pathspec (AGENTS.md, Git & Commit
Policy §3), because a bare `git commit` in this shared checkout files whatever another
session happened to stage under your subject. Immediately before each commit, confirm the
router is clean against HEAD: `git --no-optional-locks status --porcelain -- ui/src/dev-mock/tauri-api.ts`.
If it holds edits that are not yours, stop and report rather than committing them.  
**Lane status (measured 2026-09-13): ZERO PROGRESS.** None of `handlers/staff.ts`,
`handlers/workspaces.ts`, `handlers/topology.ts` or `handlers/settings.ts` exists, and
`resolve_boot_store`, `list_workspaces`, `load_topology` and `apply_topology_diff` are still
literal entries in the router. This lane is still open.  
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
  git add -- ui/src/dev-mock/handlers/staff.ts ui/src/dev-mock/handlers/workspaces.ts && git commit -m "refactor(devmock-enterprise): extract staff and workspace mock handlers" -- ui/src/dev-mock/handlers/staff.ts ui/src/dev-mock/handlers/workspaces.ts ui/src/dev-mock/tauri-api.ts
  ```
  The `add` is required only because both handler files are new: a bare pathspec commit
  cannot introduce an untracked path and `git commit --include` fails the same way (§3 rev 2).
  Chain the two on one line so no staged window is left open for another agent.

### Phase 3.2: Extract Topology & Settings Mocks
- [ ] Move `load_topology`, `apply_topology_diff` mocks to `handlers/topology.ts`.
- [ ] Move printer/receipt settings, cloud sync status, and license mocks to `handlers/settings.ts`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git add -- ui/src/dev-mock/handlers/topology.ts ui/src/dev-mock/handlers/settings.ts && git commit -m "refactor(devmock-enterprise): extract topology and settings mock handlers" -- ui/src/dev-mock/handlers/topology.ts ui/src/dev-mock/handlers/settings.ts ui/src/dev-mock/tauri-api.ts
  ```

### Phase 3.3: Final Reduction of `tauri-api.ts` — SUPERSEDED BY PHASE 4.5
> **Do not execute this phase.** It and [`todo-refactor-devmock-agents-4.md`](./todo-refactor-devmock-agents-4.md)
> phase 4.5 both claimed the final consolidation of the router; that is one job with one
> owner, and 4.5 owns it. Agent 3's remaining scope is phases 3.1 and 3.2 only — extract
> the four enterprise handler modules and leave the router to Agent 4. The milestone below
> is kept in corrected form solely so a stale grep for a bare commit cannot resurrect it.
- [ ] ~~*Wait Gate:* Verify Agent 1 has landed `refactor(devmock-core):` and Agent 2 has landed `refactor(devmock-ops):`.~~ Both landed: `ce8666604`, `6105ce224`, `efd766226`.
- [ ] ~~Reduce `ui/src/dev-mock/tauri-api.ts` to registering the domain handler maps into `mockDispatcher`.~~ see phase 4.5
- [ ] ~~Verify `tauri-api.ts` line count drops from 4,904 to < 200 lines.~~ Both numbers were wrong. The file never measured 4,904 at any commit in this history (`ce8666604^` = 5,226; `ce8666604` = 4,991), and as of 2026-09-13 it measures 2,375 lines at HEAD with 181 literal entries still inside it — a line-count target is not a definition of done while entries remain unowned. Measure with `git show HEAD:ui/src/dev-mock/tauri-api.ts | wc -l`.
- [ ] Run full UI tests: `npm run test` and `npm run check:all`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(devmock-enterprise): modularize dispatcher and reduce tauri-api.ts to router root" -- ui/src/dev-mock/tauri-api.ts ui/src/dev-mock/core/mockDispatcher.ts
  ```
