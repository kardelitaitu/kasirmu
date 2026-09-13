# Orchestrator Agent 1: Settings Backend IPC Command Modularization

<!-- Superseded stamp: 2026-09-13 · DSH · DO NOT EXECUTE. The 1,109-line
`commands/settings.rs` this doc targets is now 379 lines: the oz-bridge
campaign (todo-refactor-oz-pos-app-*, 54 commits in 36h at stamp time)
achieved the modularization goal by extracting logic into
`crates/oz-bridge/src/settings.rs` (1,394 lines) instead of splitting the
command file in place. The size debt moved with the logic — it is now the
bridge campaign's to decompose. No checklist item here was ever run. -->

**Document:** `todo-refactor-settings-agents-1.md`  
**Role:** Orchestrator Agent 1 (Settings Backend IPC Architect)  
**Goal:** Decompose `apps/desktop-client/src/commands/settings.rs` (1,109 lines) into modular sub-modules: printer settings, receipt layout configurations, currency/tax defaults, and local API keys.

**Target File:** `apps/desktop-client/src/commands/settings.rs`  
**Sibling Documents:**
- [`todo-refactor-settings-agents-2.md`](./todo-refactor-settings-agents-2.md) (Agent 2 — Master-Detail Settings Screen Deconstruction)
- [`todo-refactor-settings-agents-3.md`](./todo-refactor-settings-agents-3.md) (Agent 3 — Database Management & Factory Reset Workflows)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(settings-ipc): ...`
2. **Owned Path Fence (Exclusive to Agent 1):**
   - `apps/desktop-client/src/commands/settings.rs` & `settings_tests.rs`
   - Submodules under `apps/desktop-client/src/commands/settings/` (NEW)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `SettingsPage.tsx` (Owned by Agent 2).
   - DO NOT edit `DataManagementScreen.tsx` (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [ ] Run `cargo test -p oz-pos-app settings` (or via check.sh).
- [ ] Verify `python scripts/verify-ipc-parity.py`.

### Phase 1.1: Decompose `commands/settings.rs`
- [ ] Separate receipt formatting commands into `settings/receipt.rs`.
- [ ] Separate peripheral printer configuration commands into `settings/printers.rs`.
- [ ] Separate general store identity & locale settings into `settings/general.rs`.
- [ ] Keep `commands/settings.rs` as a clean facade re-exporting all `#[tauri::command]` functions.
- [ ] Verify: `python scripts/verify-ipc-parity.py` (Must be 0 errors).
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(settings-ipc): split settings commands into receipt, printers, and general submodules"
  ```
