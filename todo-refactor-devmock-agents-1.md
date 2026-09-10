# Orchestrator Agent 1: Dev-Mock Storage Core & Seeding Engine

**Document:** `todo-refactor-devmock-agents-1.md`  
**Role:** Orchestrator Agent 1 (Mock Infrastructure & Storage Architect)  
**Goal:** Extract the in-memory/localStorage persistence engine, fixture seeders, transaction simulation, and IPC routing dispatcher from `ui/src/dev-mock/tauri-api.ts` (4,904 lines) into a modular core framework.

**Target File:** `ui/src/dev-mock/tauri-api.ts` (Baseline: 4,904 lines)  
**Sibling Documents:**
- [`todo-refactor-devmock-agents-2.md`](./todo-refactor-devmock-agents-2.md) (Agent 2 — Operational Mocks: Sales, Inventory & Catalog)
- [`todo-refactor-devmock-agents-3.md`](./todo-refactor-devmock-agents-3.md) (Agent 3 — Enterprise Mocks: Staff, Workspaces, Topology & Settings)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(devmock-core): ...`
2. **Owned Path Fence (Exclusive to Agent 1):**
   - `ui/src/dev-mock/core/` (NEW directory)
     - `mockDatabase.ts`
     - `mockDispatcher.ts`
     - `mockStorageAdapter.ts`
     - `mockSeedData.ts`
   - Main entry point: `ui/src/dev-mock/tauri-api.ts` (Dispatcher wiring only).
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit operational command mock handlers (Owned by Agent 2).
   - DO NOT edit enterprise command mock handlers (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [ ] Verify `npm run dev` and `npm run test` against current mock baseline.

### Phase 1.1: Extract Mock Database & Storage Engine
- [ ] Create `ui/src/dev-mock/core/mockDatabase.ts` providing CRUD helpers over localStorage.
- [ ] Create `ui/src/dev-mock/core/mockDispatcher.ts` handling `window.__TAURI_INTERNALS__.invoke` routing.
- [ ] Move initial seed fixtures (sample store, default admin, initial categories) to `core/mockSeedData.ts`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(devmock-core): extract mock storage engine, dispatcher, and seed fixtures"
  ```
