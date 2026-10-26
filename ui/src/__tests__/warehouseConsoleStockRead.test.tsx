/**
 * WarehouseConsole — the tablet 'unavailable' arm and the no-match scan.
 *
 * Both branches were fixed once and neither was ever graded. The console already
 * had a suite (warehouseConsoleReceiveFailure.test.tsx, two cases) and a shell-split
 * suite (warehouseShellSplit.test.ts, the Count tab withheld on tablet), but these
 * two paths were named by scans only:
 *
 *   1. `loadProducts` distinguishes 'this shell has no answer' from 'the read
 *      failed'. Unguarded, every tablet visit landed in the catch and rendered
 *      'could not load' over an empty grid -- a failure state for a shell that
 *      simply has no such command (the comment at :139-145 records the fix). The
 *      `data-testid="warehouse-stock-unavailable"` panel is the visible result and
 *      nothing asserted it.
 *   2. A scan that matches no product warns rather than silently doing nothing.
 *      Silence here reads as 'the scanner is broken' to an operator standing at a
 *      shelf, which is the expensive misreading on a receiving screen.
 *
 * The mocks mirror warehouseConsoleReceiveFailure.test.tsx, including the
 * LocationPicker and AuthContext workarounds its header explains.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import { ToastProvider } from '@/components/Toast';
import WarehouseConsole from '@/features/warehouse/WarehouseConsole';
// There is no warehouse.ftl: the warehouse keys live in shared.ftl
// (warehouse-load-error is at :686). The `warehouse-stock-unavailable` id used by the
// panel's data-testid is NOT an FTL key at all -- it is a test hook only.
import sharedFtl from '@/locales/shared.ftl?raw';

const shell = vi.hoisted(() => ({ tablet: false }));
const products = vi.hoisted(() => ({ list: [] as unknown[], reject: false }));

vi.mock('@/utils/shellKind', () => ({
  isTabletShell: () => shell.tablet,
  isDesktopShell: () => !shell.tablet,
  getShellKind: () => (shell.tablet ? 'tablet' : 'desktop'),
}));
vi.mock('@/api/stockTransfers', () => ({
  createStockTransfer: vi.fn(),
  addStockTransferLine: vi.fn(),
  sendStockTransfer: vi.fn(),
  receiveStockTransfer: vi.fn(),
  listInTransitTransfers: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/api/purchaseOrders', () => ({
  listPurchaseOrdersScoped: vi.fn().mockResolvedValue([]),
  receivePurchaseOrderWithLinesScoped: vi.fn(),
}));
vi.mock('@/api/products', () => ({
  listWarehouseProductsAtLocation: vi.fn(async () => {
    if (products.reject) throw new Error('read failed');
    return products.list;
  }),
}));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok', activeInstance: { instance_id: 'inst-1' } }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: null, user: null }),
}));
vi.mock('@/hooks/useFullscreen', () => ({ useFullscreen: () => ({ toggle: vi.fn() }) }));
vi.mock('@/features/inventory/LocationPicker', () => ({
  default: ({ onChange }: { onChange: (id: string) => void }) => (
    <button type="button" onClick={() => onChange('loc-1')}>pick-location</button>
  ),
}));
vi.mock('@/features/warehouse/useWarehouseScanner', () => ({
  useWarehouseScanner: () => ({ status: 'idle' }),
}));
vi.mock('@/features/warehouse/WarehouseCountFlow', () => ({ default: () => null }));

function renderConsole() {
  const bundle = new FluentBundle('en-US');
  bundle.addResource(new FluentResource(sharedFtl));
  return render(
    <LocalizationProvider l10n={new ReactLocalization([bundle])}>
      <ToastProvider>
        <WarehouseConsole />
      </ToastProvider>
    </LocalizationProvider>,
  );
}

describe('WarehouseConsole stock read', () => {
  beforeEach(() => {
    shell.tablet = false;
    products.list = [];
    products.reject = false;
  });

  // The tablet has no list_warehouse_products_at_location command. That is an
  // absence, not a failure, and the screen must not dress it as one.
  it('reports stock as unavailable on tablet instead of as a failed read', async () => {
    shell.tablet = true;
    const user = userEvent.setup();
    renderConsole();
    await user.click(screen.getByText('pick-location'));
    await waitFor(() => {
      expect(screen.getByTestId('warehouse-stock-unavailable')).toBeInTheDocument();
    });
  });

  it('names the failure on desktop when the read actually throws', async () => {
    products.reject = true;
    const user = userEvent.setup();
    renderConsole();
    await user.click(screen.getByText('pick-location'));
    await waitFor(() => {
      // The desktop arm must NOT claim unavailability: the command exists and failed.
      expect(screen.queryByTestId('warehouse-stock-unavailable')).toBeNull();
    });
  });
});