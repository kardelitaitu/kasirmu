# Orchestrator Agent 1: Dev-Mock Storage Core & Seeding Engine

**Document:** `todo-refactor-devmock-agents-1.md`  
**Role:** Orchestrator Agent 1 (Mock Infrastructure & Storage Architect)  
**Goal:** Extract the in-memory/localStorage persistence engine, fixture seeders, transaction simulation, and IPC routing dispatcher from `ui/src/dev-mock/tauri-api.ts` (5,226 lines as measured 2026-09-13) into a modular core framework.

**Target File:** `ui/src/dev-mock/tauri-api.ts` (Baseline: 5,226 lines / 506 literal command keys, measured 2026-09-13 against `ce8666604^` with `git show ce8666604^:ui/src/dev-mock/tauri-api.ts | wc -l`. The 4,904 quoted here earlier matches no commit in this lane's history and is withdrawn; when two sources disagree, this one is the measurement and the other was an estimate.)  
**Lane status: COMPLETE.** Phases 1.0 and 1.1 landed as `ce8666604` — `refactor(devmock-core): extract mock storage engine, dispatcher, and seed fixtures` — at 05:46:39. Do not re-run this lane.  
**Sibling Documents:**
- [`todo-refactor-devmock-agents-2.md`](./todo-refactor-devmock-agents-2.md) (Agent 2 — Operational Mocks: Sales, Inventory & Catalog)
- [`todo-refactor-devmock-agents-3.md`](./todo-refactor-devmock-agents-3.md) (Agent 3 — Enterprise Mocks: Staff, Workspaces, Topology & Settings)
- [`todo-refactor-devmock-agents-4.md`](./todo-refactor-devmock-agents-4.md) (Agent 4 — Services & Platform Mocks)

> **Shared-file hazard.** All four plans edit `ui/src/dev-mock/tauri-api.ts`, so these lanes
> are serial on that path, not parallel. In this shared checkout every commit named below
> carries an explicit pathspec (AGENTS.md, Git & Commit Policy §3); a bare `git commit`
> files whatever another session happened to stage under your subject. Immediately before
> each commit run `git --no-optional-locks status --porcelain -- ui/src/dev-mock/tauri-api.ts`
> and confirm the router is clean against HEAD; if it carries edits that are not yours, stop
> and report rather than committing them.

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
- [x] Verify `npm run dev` and `npm run test` against current mock baseline.

### Phase 1.1: Extract Mock Database & Storage Engine
- [x] Create `ui/src/dev-mock/core/mockDatabase.ts` providing CRUD helpers over localStorage.
- [x] Create `ui/src/dev-mock/core/mockDispatcher.ts` handling `window.__TAURI_INTERNALS__.invoke` routing.
- [x] Move initial seed fixtures (sample store, default admin, initial categories) to `core/mockSeedData.ts`.
- [x] Verify: `npm run typecheck`.
- [x] **Commit Milestone:** landed as `ce8666604`, which also changed
  `ui/src/__tests__/storageKeyPins.test.ts` — a path this checklist never named. Name every
  path a step changes. The four `core/` files were new, so this is the one sanctioned
  new-file chain: a bare pathspec commit cannot introduce an untracked path and
  `git commit --include` fails the same way (§3 rev 2).
  ```bash
  git add -- ui/src/dev-mock/core/mockDatabase.ts ui/src/dev-mock/core/mockDispatcher.ts ui/src/dev-mock/core/mockStorageAdapter.ts ui/src/dev-mock/core/mockSeedData.ts && git commit -m "refactor(devmock-core): extract mock storage engine, dispatcher, and seed fixtures" -- ui/src/dev-mock/tauri-api.ts ui/src/dev-mock/core/mockDatabase.ts ui/src/dev-mock/core/mockDispatcher.ts ui/src/dev-mock/core/mockStorageAdapter.ts ui/src/dev-mock/core/mockSeedData.ts ui/src/__tests__/storageKeyPins.test.ts
  ```
