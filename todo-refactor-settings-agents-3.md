# Orchestrator Agent 3: Database Management & Factory Reset Workflows

**Document:** `todo-refactor-settings-agents-3.md`  
**Role:** Orchestrator Agent 3 (Data Lifecycle & Backup Architect)  
**Goal:** Decompose `ui/src/features/settings/DataManagementScreen.tsx` (915 lines) into modular sub-panels: SQLite database backup/restore, CSV catalog import/export, audit log retention scrubbing, and factory reset PIN confirmation modal.

**Target File:** `ui/src/features/settings/DataManagementScreen.tsx` (Baseline: 915 lines)  
**Sibling Documents:**
- [`todo-refactor-settings-agents-1.md`](./todo-refactor-settings-agents-1.md) (Agent 1 — Settings Backend IPC Modularization)
- [`todo-refactor-settings-agents-2.md`](./todo-refactor-settings-agents-2.md) (Agent 2 — Master-Detail Settings Screen Deconstruction)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(settings-data): ...`
2. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/features/settings/DataManagementScreen.tsx`
   - `ui/src/features/settings/data/` (NEW directory)
     - `BackupRestoreSection.tsx`
     - `CatalogCsvImportExport.tsx`
     - `AuditRetentionSection.tsx`
     - `FactoryResetConfirmationModal.tsx`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `SettingsPage.tsx` (Owned by Agent 2).
   - DO NOT edit backend `commands/settings.rs` (Owned by Agent 1).

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [ ] Run `npm run test -- DataManagement` in `ui/`.
- [ ] Run `npm run typecheck` in `ui/`.

### Phase 3.1: Extract Backup & CSV Import/Export Sections
- [ ] Extract `<BackupRestoreSection />` into `data/BackupRestoreSection.tsx`.
- [ ] Extract `<CatalogCsvImportExport />` into `data/CatalogCsvImportExport.tsx`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(settings-data): extract BackupRestoreSection and CatalogCsvImportExport"
  ```

### Phase 3.2: Extract Factory Reset Modal & Screen Reduction
- [ ] Extract `<FactoryResetConfirmationModal />` (double PIN check + confirmation keyword input).
- [ ] Extract `<AuditRetentionSection />`.
- [ ] Reduce `DataManagementScreen.tsx` to a clean section coordinator.
- [ ] Verify `DataManagementScreen.tsx` line count drops from 915 to < 250 lines.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(settings-data): extract FactoryResetConfirmationModal and reduce DataManagementScreen"
  ```
