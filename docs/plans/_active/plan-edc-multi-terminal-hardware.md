<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with no prior stamp, footer or marker. It is marked completed, and it is the third document in this directory to address the payment phase — after the methods plan that decides what exists, the resilience design that decides how failures are handled, and the owner question recording that part of the phase is blocked on input. A reader who takes this one alone will conclude the phase is finished, which is why the stamp leads with the set rather than the file. · THE HARDWARE ABSTRACTION IT PLANS AGAINST IS REAL, and this is the checkable part. The card-present driver exists in the hardware abstraction layer with a sibling test file beside it, which is the structural convention the root guide requires — driver implementations and their tests as separate files rather than tests embedded in the implementation. A plan describing hardware that does not exist is a different document, and this is not one. · THE DESIGN PROBLEM IS THE INTERESTING PART, and it is why the word RESILIENT appears in the title alongside binding. One physical card terminal shared across several logical registers or workspaces is a resource-arbitration problem before it is a driver problem: two cashiers must not drive one device simultaneously, the device must be claimable and releasable without a crash stranding it, and a terminal failing mid-transaction must leave the sale in a state a person can reason about. That is why it is filed next to the resilience design rather than with the ordinary hardware documentation — the binding and the failure handling are ONE problem, and the resilience mechanism audited in an earlier round is the same machinery this one depends on. · NOT re-measured: the binding implementation, the arbitration, or the recovery behaviour on device failure. Those are the document's own content and are the original work. What is established is that the driver it builds on exists, and that its design problem is the same one the resilience decision addresses. · No stamp existed; this is the first. -->
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
  - Add `EdcTerminalsCard` to Hardware Settings.
  - Show list of configured terminals with connection type badges.
  - "Test Connection" button to probe terminal status on-demand.
  - Add/Edit/Delete terminal modal with connection & transport validation.
  - Option to set as "Register Default" in register hardware preferences.

### Phase 4: Checkout Multi-Terminal Picker
- [x] In `ui/src/features/sales/payment/`:
  - In `useEdcTenderPhase.ts`:
    - Fetch active terminals on mount.
    - Manage `selectedTerminalId`, defaulting to register's preferred terminal.
    - Expose `availableTerminals`, `selectedTerminalId`, and `setSelectedTerminalId`.
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

> last audited 29-09-26 by docs-auditor
