# Orchestrator Agent 2: Master-Detail Settings Screen Deconstruction

**Document:** `todo-refactor-settings-agents-2.md`  
**Role:** Orchestrator Agent 2 (Settings Frontend Experience Architect)  
**Goal:** Decompose `ui/src/features/settings/SettingsPage.tsx` (844 lines) from a monolithic form into isolated setting tab panels (Store Info, Hardware/Printers, Receipt Customization, and Tax Defaults).

**Target File:** `ui/src/features/settings/SettingsPage.tsx` (Baseline: 844 lines)  
**Sibling Documents:**
- [`todo-refactor-settings-agents-1.md`](./todo-refactor-settings-agents-1.md) (Agent 1 — Settings Backend IPC Modularization)
- [`todo-refactor-settings-agents-3.md`](./todo-refactor-settings-agents-3.md) (Agent 3 — Database Management & Factory Reset Workflows)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(settings-ui): ...`
2. **Owned Path Fence (Exclusive to Agent 2):**
   - `ui/src/features/settings/SettingsPage.tsx`
   - `ui/src/features/settings/panels/` (NEW directory)
     - `GeneralSettingsPanel.tsx`
     - `PrinterSettingsPanel.tsx`
     - `ReceiptSettingsPanel.tsx`
     - `TaxSettingsPanel.tsx`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit backend Rust command files (Owned by Agent 1).
   - DO NOT edit `DataManagementScreen.tsx` (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 2.0: Baseline Audit
- [ ] Run `npm run test -- SettingsPage` in `ui/`.
- [ ] Run `npm run typecheck` in `ui/`.

### Phase 2.1: Extract Hardware & Receipt Settings Panels
- [ ] Extract `<PrinterSettingsPanel />` into `panels/PrinterSettingsPanel.tsx`.
- [ ] Extract `<ReceiptSettingsPanel />` into `panels/ReceiptSettingsPanel.tsx` (header, footer, logo toggle, preview).
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(settings-ui): extract PrinterSettingsPanel and ReceiptSettingsPanel"
  ```

### Phase 2.2: Extract General Settings & Reduce `SettingsPage.tsx`
- [ ] Extract `<GeneralSettingsPanel />` and `<TaxSettingsPanel />`.
- [ ] Reduce `SettingsPage.tsx` to a master-detail tab navigator orchestrating dirty-state and the top-right Save button.
- [ ] Verify `SettingsPage.tsx` line count drops from 844 to < 250 lines.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(settings-ui): modularize general settings and reduce SettingsPage to navigation root"
  ```
