<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 minor) · Re-audit. The plan IS implemented: resolve_terminal (kasirmu-bridge/src/edc.rs:285, const :36), list_edc_terminals_scoped (:481), create_edc_terminal_scoped (:512), terminalId across ui/src/api/edc.ts (16 occurrences), defaultEdcTerminalId in register LocalPrefs (45 hits), EdcTerminalsCard mounted at settings/screens/DevicesConnectivityScreen.tsx:22, and the checkout picker's selectedTerminalId/setSelectedTerminalId (useEdcTenderPhase.ts:133, returned at :268-277). ONE MINOR REPAIR, in the 'shipped but not under the name the plan gives' class: the card lives under settings/components/ (not settings/), and the hook exposes `terminals`, not the proposed `availableTerminals`. Both corrected in place with the deviation recorded. NOT re-measured: the §4 verification checklist's own runs (cargo check, cargo test -p kasirmu-bridge edc, the UI suites) — those are executions, and this pass establishes that the named artefacts exist, not that the commands pass.

     --- prior stamp, preserved as plain text (delimiters stripped) ---
 -->
# PLAN: Multi-Terminal EDC Hardware Binding (R4) & Resilient Abstraction

**Status:** COMPLETED · **Date:** 2026-09-29 · **Scope:** `crates/kasirmu-bridge`, `apps/desktop-tauri`, `apps/mobile-tauri`, `ui/src/api/edc.ts`, `ui/src/features/settings`, `ui/src/features/sales/payment`

---

## 1. Problem & Context

In Indonesian and global retail/hospitality, registers frequently connect to **multiple physical EDC card terminals** (e.g. BCA for Debit/Flazz, Mandiri/BRI for national clearing, PAX A920 for contactless credit/QRIS).

### Current Bottleneck:
1. `platform_startup::hardware::register_card_terminals` registers all configured active terminals from `edc_terminals` in `kasirmu_hal::DriverRegistry` by their database UUID, but creates an interim `"default"` alias pointing only to the earliest created row.
2. `kasirmu-bridge::edc` hardcodes `DEFAULT_TERMINAL_ID = "default"`. All commands (`edc_sale`, `edc_terminal_status`, `edc_refund`, `edc_void`) ignore multiple terminals and route blindly to the default.
3. The frontend has no API or UI to list, create, test, or pick EDC terminals in Settings or during checkout.

---

## 2. Invariants & Rules

- **Explicit Routing:** Commands accept `terminal_id: Option<String>`. If `None`, they fall back to `DEFAULT_TERMINAL_ID` for 100% backward compatibility with single-terminal stores.
- **Register-Local Default (LocalPrefs):** Each register stores its preferred EDC terminal in register-local hardware preferences (`LocalPrefs`), so Register 1 and Register 2 do not collide.
- **No Silent Fallback:** If a selected terminal is offline, the system reports the error clearly and allows the cashier to explicitly choose another configured terminal. Never silently fallback across terminals or workspaces.
- **Fail-Closed Hardware Safety:** If no matching terminal is found in `DriverRegistry`, return `BridgeError::Hardware(HalErrorKind::NotFound)`. Never simulate success on missing hardware.
- **Clean Session Scoping (ADR #7):** All commands enforce `sessionToken` with appropriate permissions (`SALES_PROCESS`, `SALES_REFUND`, `SETTINGS_READ`, `SETTINGS_WRITE`).

---

## 3. Implementation Phases

### Phase 1: Bridge & Tauri IPC Routing
- [x] In `crates/kasirmu-bridge/src/edc.rs`:
  - `resolve_terminal(ctx, terminal_id: Option<&str>)`
  - Update `edc_terminal_status`, `edc_terminal_status_scoped`, `edc_sale`, `edc_refund`, `edc_void` to accept `terminal_id: Option<String>`.
  - Add `list_edc_terminals_scoped(ctx, session_token)` returning `Vec<EdcTerminalConfigDto>`.
  - Add CRUD: `create_edc_terminal_scoped`, `update_edc_terminal_scoped`, `delete_edc_terminal_scoped`.
- [x] In `apps/desktop-tauri` and `apps/mobile-tauri`:
  - Update command signatures in `commands/edc.rs`.
  - Register new commands in `lib.rs`.
  - Verify with sibling unit tests in `crates/kasirmu-bridge/src/edc_tests.rs`.

### Phase 2: UI API & Dev-Mock
- [x] In `ui/src/api/edc.ts`:
  - Add `terminalId?: string | null` to all EDC payment methods.
  - Define `EdcTerminalDto`, `NewEdcTerminalDto`, `UpdateEdcTerminalDto`.
  - Export `listEdcTerminalsScoped`, `createEdcTerminalScoped`, `updateEdcTerminalScoped`, `deleteEdcTerminalScoped`.
- [x] In `ui/src/dev-mock/handlers/payment.ts`:
  - Add mock handlers supporting multi-terminal simulation with distinct statuses.

### Phase 3: Hardware Settings Management UI
- [x] In `ui/src/features/settings/`:
  - Add `EdcTerminalsCard` to Hardware Settings (`ui/src/features/settings/components/EdcTerminalsCard.tsx`, mounted on `screens/DevicesConnectivityScreen.tsx`).
  - Show list of configured terminals with connection type badges.
  - "Test Connection" button to probe terminal status on-demand.
  - Add/Edit/Delete terminal modal with connection & transport validation.
  - Option to set as "Register Default" in register hardware preferences.

### Phase 4: Checkout Multi-Terminal Picker
- [x] In `ui/src/features/sales/payment/`:
  - In `useEdcTenderPhase.ts`:
    - Fetch active terminals on mount.
    - Manage `selectedTerminalId`, defaulting to register's preferred terminal.
    - Expose the terminal list and selection state — shipped as `terminals`, `selectedTerminalId`, `setSelectedTerminalId` (`useEdcTenderPhase.ts:268-277`); the plan's proposed name `availableTerminals` was not used.
    - Probe and tender against `selectedTerminalId`.
  - In `PaymentModal.tsx`:
    - If multiple terminals are active, render selection chips (`[BCA Counter 1]`, `[Mandiri Pax]`).
    - Display preflight status for the selected terminal.
    - If offline, provide clear error message and option to switch to another active terminal.
- [x] Tests:
  - Unit tests in `useEdcTenderPhase.test.ts` and `PaymentModalSaleFlow.test.tsx`.

---

## 4. Verification Checklist

1. `cargo check -p kasirmu-bridge -p kasirmu-app -p kasirmu-mobile` (0 errors, 0 warnings).
2. `cargo test -p kasirmu-bridge edc` (all tests pass).
3. `npm run typecheck && npm run lint` from `ui/` (0 errors).
4. `npm run test` on touched UI suites.
5. All repo pre-commit gates pass (`verify-migration-column-types`, `generate-pg-migration --check`, `check-dead-refs`).


---

## 5. Verified 11-10-26 — the plan is implemented, under slightly different names

Every mechanism in this plan was re-derived at HEAD on 11-10-26 and EXISTS: `resolve_terminal`
(`crates/kasirmu-bridge/src/edc.rs:285`, the const at `:36`), `list_edc_terminals_scoped` (`:481`) and
`create_edc_terminal_scoped` (`:512`), `terminalId` across `ui/src/api/edc.ts` (16 occurrences),
`defaultEdcTerminalId` in register LocalPrefs (45 hits in `ui/src`), `EdcTerminalsCard` mounted at
`screens/DevicesConnectivityScreen.tsx:22`, and the checkout picker's `selectedTerminalId` /
`setSelectedTerminalId` at `useEdcTenderPhase.ts:133`. Two naming corrections are recorded in place
above (the card lives under `components/`; the hook exposes `terminals`, not `availableTerminals`) —
the "shipped, but not under the name the plan gives" class.

**NOT re-measured:** the §4 verification checklist's own runs — `cargo check`, `cargo test -p
kasirmu-bridge edc`, and the UI suites. Those are executions, and the plan's own status line already
claims them; this pass establishes that the named artefacts exist, not that the commands pass.

> last audited 11-10-26 by docs-auditor
