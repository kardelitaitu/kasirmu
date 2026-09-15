// ── IPC contract tests for hardware.ts ─────────────────────────
//
// Verifies every exported function calls loggedInvoke with the
// correct IPC command name and argument shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

import {
  openCashDrawer,
  openCashDrawerScoped,
  printReceipt,
  printSalesReceiptScoped,
  listScanners,
  startScanner,
  stopScanner,
  listDisplaysScoped,
  displayShowScoped,
  displayClearScoped,
  readScaleWeight,
  discoverHardwareScoped,
} from '@/api/hardware';

describe('hardware.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  // ── Cash Drawer ───────────────────────────────────────────

  it('openCashDrawer → open_cash_drawer with default empty args', async () => {
    mockInvoke.mockResolvedValue({ opened: true });
    await openCashDrawer();
    expect(mockInvoke).toHaveBeenCalledWith('open_cash_drawer', { args: {} });
  });

  // `OpenCashDrawerArgs` on the Rust side has no `#[serde(rename_all)]`, so the
  // wire key is `device_id`. The field is `#[serde(default)] Option<String>`,
  // so the camelCase key would NOT error — it would silently open the
  // "default" drawer. Pin input-camelCase → invoke-snake_case (tax.ts shape).
  it('openCashDrawer with deviceId → open_cash_drawer with args.device_id', async () => {
    mockInvoke.mockResolvedValue({ opened: true });
    await openCashDrawer({ deviceId: 'drawer-1' });
    expect(mockInvoke).toHaveBeenCalledWith('open_cash_drawer', {
      args: {
        device_id: 'drawer-1',
      },
    });
  });

  it('openCashDrawerScoped with deviceId → open_cash_drawer_scoped with args.device_id', async () => {
    mockInvoke.mockResolvedValue({ opened: true });
    await openCashDrawerScoped('tok', { deviceId: 'drawer-1' });
    expect(mockInvoke).toHaveBeenCalledWith('open_cash_drawer_scoped', {
      sessionToken: 'tok',
      args: {
        device_id: 'drawer-1',
      },
    });
  });

  it('openCashDrawer with no deviceId omits device_id (Rust defaults to "default")', async () => {
    mockInvoke.mockResolvedValue({ opened: true });
    await openCashDrawer({});
    expect(mockInvoke).toHaveBeenCalledWith('open_cash_drawer', { args: {} });
  });

  // ── Receipt Printing ──────────────────────────────────────

  it('printReceipt → print_receipt with body', async () => {
    mockInvoke.mockResolvedValue({ printedLines: 5 });
    await printReceipt({ body: 'Hello World' });
    expect(mockInvoke).toHaveBeenCalledWith('print_receipt', { args: { body: 'Hello World' } });
  });

  it('printSalesReceiptScoped → print_sales_receipt_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue({ printed: true });
    await printSalesReceiptScoped('tok', { date: '2026-08-19', receiptNumber: 'R1', items: [], subtotal: { minorUnits: 0, currency: 'USD' }, total: { minorUnits: 0, currency: 'USD' }, payments: [] });
    expect(mockInvoke).toHaveBeenCalledWith('print_sales_receipt_scoped', { sessionToken: 'tok', args: expect.objectContaining({ receiptNumber: 'R1' }) });
  });

  // ── Barcode Scanner ───────────────────────────────────────

  it('listScanners → list_scanners (no args)', async () => {
    mockInvoke.mockResolvedValue([]);
    await listScanners();
    expect(mockInvoke).toHaveBeenCalledWith('list_scanners', undefined);
  });

  it('startScanner → start_scanner with scannerId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await startScanner('scanner-1');
    expect(mockInvoke).toHaveBeenCalledWith('start_scanner', { scannerId: 'scanner-1' });
  });

  it('stopScanner → stop_scanner (no args)', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await stopScanner();
    expect(mockInvoke).toHaveBeenCalledWith('stop_scanner', undefined);
  });

  // ── Customer Display (scoped — ADR #7) ──────────────────────

  it('listDisplaysScoped → list_displays_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue([]);
    await listDisplaysScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_displays_scoped', { sessionToken: 'tok' });
  });

  // `DisplayShowArgs` on the Rust side has no `#[serde(rename_all)]` either,
  // so the wire key is `display_id` — a required `String`, i.e. a hard
  // missing-field error on both shells. Pin input-camelCase → invoke-snake_case.
  it('displayShowScoped → display_show_scoped with args.display_id', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await displayShowScoped('tok', { displayId: 'd1', line1: 'Total', line2: '$10.00' });
    expect(mockInvoke).toHaveBeenCalledWith('display_show_scoped', {
      sessionToken: 'tok',
      args: {
        display_id: 'd1',
        line1: 'Total',
        line2: '$10.00',
      },
    });
  });

  it('displayClearScoped → display_clear_scoped with sessionToken + displayId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await displayClearScoped('tok', 'd1');
    expect(mockInvoke).toHaveBeenCalledWith('display_clear_scoped', { sessionToken: 'tok', displayId: 'd1' });
  });

  // ── Weight Scale ──────────────────────────────────────────

  it('readScaleWeight → read_scale_weight (no args)', async () => {
    mockInvoke.mockResolvedValue({ weightGrams: 500, stable: true });
    await readScaleWeight();
    expect(mockInvoke).toHaveBeenCalledWith('read_scale_weight', undefined);
  });

  // ── Device Discovery (scoped — ADR #7) ─────────────────────

  it('discoverHardwareScoped → discover_hardware_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue([]);
    await discoverHardwareScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('discover_hardware_scoped', { sessionToken: 'tok' });
  });

  // ── Error propagation ─────────────────────────────────────

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('device not found'));
    await expect(listScanners()).rejects.toThrow('device not found');
  });
});
