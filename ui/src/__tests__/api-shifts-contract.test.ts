/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── IPC contract tests for shifts.ts ──────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  openShiftScoped,
  closeShiftScoped,
  getActiveShiftScoped,
  listShiftsScoped,
  getShiftScoped,
  getShiftReportScoped,
} from '@/api/shifts';

describe('shifts.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('openShiftScoped → open_shift_scoped with sessionToken + args', async () => {
    mockInvoke.mockResolvedValue({ id: 'shift-1' });
    await openShiftScoped('tok', 100000, 'terminal-1');
    expect(mockInvoke).toHaveBeenCalledWith('open_shift_scoped', { sessionToken: 'tok', args: { terminalId: 'terminal-1', openingBalanceMinor: 100000 } });
  });

  it('openShiftScoped without terminalId → null terminalId', async () => {
    mockInvoke.mockResolvedValue({ id: 'shift-1' });
    await openShiftScoped('tok', 50000);
    expect(mockInvoke).toHaveBeenCalledWith('open_shift_scoped', { sessionToken: 'tok', args: { terminalId: null, openingBalanceMinor: 50000 } });
  });

  it('closeShiftScoped → close_shift_scoped with sessionToken + args', async () => {
    mockInvoke.mockResolvedValue({ id: 'shift-1' });
    await closeShiftScoped('tok', 'shift-1', 60000, 'Closed on time');
    expect(mockInvoke).toHaveBeenCalledWith('close_shift_scoped', { sessionToken: 'tok', args: { id: 'shift-1', closingBalanceMinor: 60000, notes: 'Closed on time' } });
  });

  it('closeShiftScoped without notes → null notes', async () => {
    mockInvoke.mockResolvedValue({ id: 'shift-1' });
    await closeShiftScoped('tok', 'shift-1', 50000);
    expect(mockInvoke).toHaveBeenCalledWith('close_shift_scoped', { sessionToken: 'tok', args: { id: 'shift-1', closingBalanceMinor: 50000, notes: null } });
  });

  it('getActiveShiftScoped → get_active_shift_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue(null);
    await getActiveShiftScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('get_active_shift_scoped', { sessionToken: 'tok' });
  });

  it('listShiftsScoped → list_shifts_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue([]);
    await listShiftsScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_shifts_scoped', { sessionToken: 'tok' });
  });

  it('getShiftScoped → get_shift_scoped with sessionToken + id', async () => {
    mockInvoke.mockResolvedValue(null);
    await getShiftScoped('tok', 'shift-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_shift_scoped', { sessionToken: 'tok', id: 'shift-1' });
  });

  it('getShiftReportScoped → get_shift_report_scoped with sessionToken + shiftId', async () => {
    mockInvoke.mockResolvedValue({});
    await getShiftReportScoped('tok', 'shift-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_shift_report_scoped', { sessionToken: 'tok', shiftId: 'shift-1' });
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('shift already closed'));
    await expect(closeShiftScoped('tok', 'shift-1', 0)).rejects.toThrow('shift already closed');
  });
});
