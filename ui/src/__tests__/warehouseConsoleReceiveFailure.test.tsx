import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import { ToastProvider } from '@/components/Toast';
import WarehouseConsole from '@/features/warehouse/WarehouseConsole';
import sharedFtl from '@/locales/shared.ftl?raw';

// ── Warehouse console: the receive pickers must not claim "none" on a failed read ──
//
// This screen had NO behavioural test — only static/scanner suites referenced it — so the
// fix that made a failed picker read render an alert was unguarded. These two cases pin it.

const mockListInTransit = vi.fn();
const mockListPurchaseOrders = vi.fn();

vi.mock('@/api/stockTransfers', () => ({
  createStockTransfer: vi.fn(),
  addStockTransferLine: vi.fn(),
  sendStockTransfer: vi.fn(),
  receiveStockTransfer: vi.fn(),
  listInTransitTransfers: (...a: unknown[]) => mockListInTransit(...a),
}));
vi.mock('@/api/purchaseOrders', () => ({
  listPurchaseOrdersScoped: (...a: unknown[]) => mockListPurchaseOrders(...a),
  receivePurchaseOrderWithLinesScoped: vi.fn(),
}));
vi.mock('@/api/products', () => ({
  listWarehouseProductsAtLocation: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok', activeInstance: { instance_id: 'inst-1' } }),
}));
vi.mock('@/hooks/useFullscreen', () => ({ useFullscreen: () => ({ toggle: vi.fn() }) }));
// The console body only renders once a location is bound, so the picker mock exposes a
// button that selects one — the same contract the real component's onChange has.
vi.mock('@/features/inventory/LocationPicker', () => ({
  default: ({ onChange }: { onChange: (id: string) => void }) => (
    <button type="button" onClick={() => onChange('loc-1')}>pick-location</button>
  ),
}));
vi.mock('@/features/warehouse/useWarehouseScanner', () => ({
  useWarehouseScanner: () => ({ status: 'idle' }),
}));
// The real FnBar: its Receive button is the supported way in (the F1 keydown path is
// guarded on a typing state this harness does not drive).
vi.mock('@/features/warehouse/WarehouseCountFlow', () => ({ default: () => null }));
// `ShiftBar` (mounted into WarehouseConsole in round 164) reads `useAuth`, and the shared
// `renderWithProviders` helper supplies Brand/Theme/Toast/Zoom but NOT AuthProvider. Mocking
// `useAuth` directly is the established workaround -- 86 other suites do the same -- and it is
// safer than widening the helper for every component that happens to read a session.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: null, user: null }),
}));


function makeL10n() {
  const bundle = new FluentBundle('en-US');
  bundle.addResource(new FluentResource(sharedFtl));
  return new ReactLocalization([bundle]);
}

function renderConsole() {
  return render(
    <LocalizationProvider l10n={makeL10n()}>
      <ToastProvider>
        <WarehouseConsole />
      </ToastProvider>
    </LocalizationProvider>,
  );
}

describe('WarehouseConsole receive pickers', () => {
  beforeEach(() => {
    mockListInTransit.mockReset();
    mockListPurchaseOrders.mockReset();
  });

  it('says the transfer list failed to load instead of claiming none are in transit', async () => {
    mockListInTransit.mockRejectedValue(new Error('ipc down'));
    mockListPurchaseOrders.mockResolvedValue([]);
    renderConsole();

    // Bind a location, then open the receive popup and pick the transfer source.
    await userEvent.click(await screen.findByText('pick-location'));
    await userEvent.click(await screen.findByRole('button', { name: /Receive/i }));
    await userEvent.click(await screen.findByText('Receive from transfer'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.queryByText('No in-transit transfers')).toBeNull();
  });
});
