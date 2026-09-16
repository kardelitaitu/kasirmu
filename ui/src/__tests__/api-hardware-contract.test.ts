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
  openCashDrawerScoped,
  printSalesReceiptScoped,
  listScannersScoped,
  startScannerScoped,
  stopScannerScoped,
  listDisplaysScoped,
  displayShowScoped,
  displayClearScoped,
  readScaleWeight,
  discoverHardwareScoped,
} from '@/api/hardware';

describe('hardware.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  // ── Cash Drawer ───────────────────────────────────────────

  // `OpenCashDrawerArgs` on the Rust side has no `#[serde(rename_all)]`, so the
  // wire key is `device_id`. The field is `#[serde(default)] Option<String>`,
  // so the camelCase key would NOT error — it would silently open the
  // "default" drawer. Pin input-camelCase → invoke-snake_case (tax.ts shape).
  //
  // These two cases used to sit on the unscoped `openCashDrawer` as well. That wrapper was
  // deleted on 2026-09-16 (T22) because no screen, hook or client facade imported it, and the
  // command it invoked is registered in neither shell -- so it could not have caught a real
  // regression. The pin itself stays, and it is the same code path: both wrappers call the
  // module-private `cashDrawerWireArgs`, so mapping and omission are still graded where they
  // are actually shipped.
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

  it('openCashDrawerScoped with no deviceId omits device_id (Rust defaults to "default")', async () => {
    mockInvoke.mockResolvedValue({ opened: true });
    await openCashDrawerScoped('tok', {});
    expect(mockInvoke).toHaveBeenCalledWith('open_cash_drawer_scoped', {
      sessionToken: 'tok',
      args: {},
    });
  });

  // ── Receipt Printing ──────────────────────────────────────

  it('printSalesReceiptScoped → print_sales_receipt_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue({ printed: true });
    await printSalesReceiptScoped('tok', { date: '2026-08-19', receiptNumber: 'R1', items: [], subtotal: { minorUnits: 0, currency: 'USD' }, total: { minorUnits: 0, currency: 'USD' }, payments: [] });
    expect(mockInvoke).toHaveBeenCalledWith('print_sales_receipt_scoped', { sessionToken: 'tok', args: expect.objectContaining({ receiptNumber: 'R1' }) });
  });

  // ── Barcode Scanner ───────────────────────────────────────

  // These three cases used to pin `list_scanners` / `start_scanner` / `stop_scanner` -- commands
  // registered in NEITHER shell (T21). They are the only wire-shape coverage this surface has, so
  // deleting the unscoped wrappers without moving them would have left the registered doors with
  // no test at all while an unregistered one kept three. `start_scanner`'s camelCase `scannerId`
  // key is the load-bearing half: Tauri converts the command's OUTER name and nothing else, so a
  // payload that says `scanner_id` is silently None on the Rust side (T23's `deviceId` lesson).
  it('listScannersScoped → list_scanners_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue([]);
    await listScannersScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_scanners_scoped', { sessionToken: 'tok' });
  });

  it('startScannerScoped → start_scanner_scoped with sessionToken + scannerId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await startScannerScoped('tok', 'scanner-1');
    expect(mockInvoke).toHaveBeenCalledWith('start_scanner_scoped', { sessionToken: 'tok', scannerId: 'scanner-1' });
  });

  it('stopScannerScoped → stop_scanner_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await stopScannerScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('stop_scanner_scoped', { sessionToken: 'tok' });
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
    await expect(listScannersScoped('tok')).rejects.toThrow('device not found');
  });
});
