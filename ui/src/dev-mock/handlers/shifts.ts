/**
 * Dev-mock handlers — shift domain.
 *
 * The open shift, its closed-shift history, and the shift command surface
 * (`open_shift`, `close_shift`, `list_shifts`, `get_shift_report`,
 * `create_cash_payout`). Extracted from `tauri-api.ts` by the agent-2 work
 * order (`todo-refactor-devmock-agents-2.md`, phase 2.2); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * The shift state cluster moved with the handlers that own it. Every
 * occurrence of `mockActiveShift`, `mockShiftHistory` and their load/save
 * helpers outside this file was their own declaration, so nothing else
 * reads them and the module needs no injected dependencies — it imports
 * only the storage primitives and key literals from `core/mockDatabase`.
 */

import type { MockHandler } from '../core/mockDispatcher';
import {
  MOCK_ACTIVE_SHIFT_KEY,
  MOCK_SHIFT_CLOSED_SENTINEL,
  MOCK_SHIFT_HISTORY_KEY,
  readSlice,
  readSliceRaw,
  writeSlice,
  writeSliceRaw,
} from '../core/mockDatabase';


// ═══════════════════════════════════════════════════════════════════
// SHIFT STATE
// ═══════════════════════════════════════════════════════════════════

// ── Active shift state (for pay-btn-enabled E2E test) ──────────
// The real backend persists the open shift (with its opened_at) to the
// store-scoped `shifts` table, so a restart resumes the elapsed clock from
// the original opening time. The mock previously built a fresh shift with
// `openedAt: new Date()` at module load — every page reload reset the
// resto-POS "Current Order" shift duration to 0m. Seed from localStorage
// (same stateful pattern as user prefs below) so previews behave like a
// real store DB across reloads.
// The closed-shift marker itself lives with the slice's wire format, in
// `core/mockDatabase.ts`.
function loadMockActiveShift(): Record<string, unknown> | null {
  const raw = readSliceRaw(MOCK_ACTIVE_SHIFT_KEY);
  if (raw === null || raw === MOCK_SHIFT_CLOSED_SENTINEL) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Corrupt payload — treat as "no shift open" rather than throwing at load.
    return null;
  }
}
function hasPersistedShiftState(): boolean {
  return readSliceRaw(MOCK_ACTIVE_SHIFT_KEY) !== null;
}
function saveMockActiveShift(shift: Record<string, unknown> | null): void {
  if (shift === null) {
    writeSliceRaw(MOCK_ACTIVE_SHIFT_KEY, MOCK_SHIFT_CLOSED_SENTINEL);
    return;
  }
  try {
    writeSliceRaw(MOCK_ACTIVE_SHIFT_KEY, JSON.stringify(shift));
  } catch {
    // Circular payload or storage unavailable — keep the in-memory copy.
  }
}
let mockActiveShift: Record<string, unknown> | null = loadMockActiveShift();
if (!hasPersistedShiftState()) {
  // First-ever load in this browser (nothing persisted yet): seed an open
  // shift so the pay button and the "Current Order" shift duration render
  // in dev previews without a manual open/close cycle. Explicitly closing
  // it (or never opening one) leaves the sentinel, so reloads stay closed.
  mockActiveShift = {
    id: 'shift-1', userId: 'user-1', terminalId: null, openedAt: new Date().toISOString(), closedAt: null,
    openingBalanceMinor: 0, closingBalanceMinor: null, expectedCashMinor: null, cashDifferenceMinor: null,
    totalSalesMinor: 0, totalCashMinor: 0, totalCardMinor: 0, totalOtherMinor: 0,
    totalVoidsMinor: 0, totalRefundsMinor: 0, totalPayoutsMinor: 0, notes: '', status: 'open',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  saveMockActiveShift(mockActiveShift);
}
// Closed-shift history so the reconciliation spec can verify shifts appear
// in the Shift History table after closing. One pre-seeded closed shift
// guarantees the history table renders on every fresh page load (the older
// shift.spec asserts .shift-mgmt-table without running an open/close cycle).
// The real backend keeps closed shifts in the `shifts` table, so persist
// the history (same stateful pattern as the other mocks) — previously a
// reload reverted to just the seed and every reconciliation record
// vanished.
const _initialShiftHistory: Array<Record<string, unknown>> = [
  {
    id: 'shift-seed-1', userId: 'user-1', terminalId: null,
    openedAt: new Date(Date.now() - 3600000).toISOString(), closedAt: new Date(Date.now() - 1800000).toISOString(),
    openingBalanceMinor: 100000, closingBalanceMinor: 150000, expectedCashMinor: 150000, cashDifferenceMinor: 0,
    totalSalesMinor: 50000, totalCashMinor: 50000, totalCardMinor: 0, totalOtherMinor: 0,
    totalVoidsMinor: 0, totalRefundsMinor: 0, totalPayoutsMinor: 0, notes: '', status: 'closed',
    createdAt: new Date(Date.now() - 3600000).toISOString(), updatedAt: new Date(Date.now() - 1800000).toISOString(),
  },
];
function loadMockShiftHistory(): Array<Record<string, unknown>> {
  // First load: seed one closed shift so the history table renders without
  // an open/close cycle. Shallow-clone so pushes never bleed into the seed.
  return readSlice(
    MOCK_SHIFT_HISTORY_KEY,
    () => _initialShiftHistory.map((s) => ({ ...s })),
    (value) => (Array.isArray(value) ? (value as Array<Record<string, unknown>>) : null),
  );
}
function saveMockShiftHistory(): void {
  writeSlice(MOCK_SHIFT_HISTORY_KEY, mockShiftHistory);
}
const mockShiftHistory: Array<Record<string, unknown>> = loadMockShiftHistory();
// ═══════════════════════════════════════════════════════════════════
// HANDLER MAP
// ═══════════════════════════════════════════════════════════════════

export const shiftHandlers: Record<string, MockHandler> = {

  // ═══════════════════════════════════════════════════════════════
  // SHIFTS
  // ═══════════════════════════════════════════════════════════════

  'get_active_shift': () => mockActiveShift,
  'get_active_shift_scoped': () => mockActiveShift,
  'open_shift': () => {
    mockActiveShift = {
      id: 'shift-1', userId: 'user-1', terminalId: null, openedAt: new Date().toISOString(), closedAt: null,
      openingBalanceMinor: 0, closingBalanceMinor: null, expectedCashMinor: null, cashDifferenceMinor: null,
      totalSalesMinor: 0, totalCashMinor: 0, totalCardMinor: 0, totalOtherMinor: 0,
      totalVoidsMinor: 0, totalRefundsMinor: 0, totalPayoutsMinor: 0, notes: '', status: 'open',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    saveMockActiveShift(mockActiveShift);
    return mockActiveShift;
  },
  'open_shift_scoped': () => {
    mockActiveShift = {
      id: 'shift-1', userId: 'user-1', terminalId: null, openedAt: new Date().toISOString(), closedAt: null,
      openingBalanceMinor: 0, closingBalanceMinor: null, expectedCashMinor: null, cashDifferenceMinor: null,
      totalSalesMinor: 0, totalCashMinor: 0, totalCardMinor: 0, totalOtherMinor: 0,
      totalVoidsMinor: 0, totalRefundsMinor: 0, totalPayoutsMinor: 0, notes: '', status: 'open',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    saveMockActiveShift(mockActiveShift);
    return mockActiveShift;
  },
  'close_shift': () => {
    mockActiveShift = null;
    saveMockActiveShift(null);
    const closed: Record<string, unknown> = {
      id: `shift-${mockShiftHistory.length + 1}`, userId: 'user-1', terminalId: null, openedAt: new Date().toISOString(), closedAt: new Date().toISOString(),
      openingBalanceMinor: 100000, closingBalanceMinor: 150000, expectedCashMinor: 150000, cashDifferenceMinor: 0,
      totalSalesMinor: 50000, totalCashMinor: 50000, totalCardMinor: 0, totalOtherMinor: 0,
      totalVoidsMinor: 0, totalRefundsMinor: 0, totalPayoutsMinor: 0, notes: '', status: 'closed',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    mockShiftHistory.push(closed);
    // Persist the closed shift so a reload keeps the reconciliation record.
    saveMockShiftHistory();
    return closed;
  },
  'close_shift_scoped': () => {
    mockActiveShift = null;
    saveMockActiveShift(null);
    const closed: Record<string, unknown> = {
      id: `shift-${mockShiftHistory.length + 1}`, userId: 'user-1', terminalId: null, openedAt: new Date().toISOString(), closedAt: new Date().toISOString(),
      openingBalanceMinor: 100000, closingBalanceMinor: 150000, expectedCashMinor: 150000, cashDifferenceMinor: 0,
      totalSalesMinor: 50000, totalCashMinor: 50000, totalCardMinor: 0, totalOtherMinor: 0,
      totalVoidsMinor: 0, totalRefundsMinor: 0, totalPayoutsMinor: 0, notes: '', status: 'closed',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    mockShiftHistory.push(closed);
    // Persist the closed shift so a reload keeps the reconciliation record.
    saveMockShiftHistory();
    return closed;
  },
  'list_shifts': () => mockShiftHistory,
  'list_shifts_scoped': () => mockShiftHistory,
  'get_shift': () => null,
  'get_shift_report': () => null,
  'create_cash_payout': () => null,
};
