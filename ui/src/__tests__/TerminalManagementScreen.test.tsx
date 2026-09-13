import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import { ToastProvider } from '@/frontend/shared/Toast';
import TerminalManagementScreen from '@/features/terminals/TerminalManagementScreen';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { makeSubscriptionCaps } from '@/__tests__/test-utils/mocks/subscriptionCaps';
import terminalsFtl from '@/locales/terminals.ftl?raw';
import type { TerminalDto } from '@/api/terminals';

const { mockListTerminals, mockRegisterTerminal, mockDeleteTerminal,
  mockListTerminalOverrides } =
  vi.hoisted(() => ({
    mockListTerminals: vi.fn(),
    mockRegisterTerminal: vi.fn(),
    mockDeleteTerminal: vi.fn(),
    mockListTerminalOverrides: vi.fn(),
  }));

vi.mock('@/api/terminals', () => ({
  listTerminalsScoped: (_sessionToken: string) => mockListTerminals(),
  registerTerminalScoped: (_sessionToken: string, args: unknown) => mockRegisterTerminal(_sessionToken, args),
  updateTerminalScoped: () => Promise.resolve({ id: 't-1' }),
  deleteTerminalScoped: (_sessionToken: string, id: string) => mockDeleteTerminal(_sessionToken, id),
  listTerminalOverridesScoped: (_sessionToken: string, id: string) => mockListTerminalOverrides(id),
  setTerminalOverrideScoped: () => Promise.resolve(),
  deleteTerminalOverrideScoped: () => Promise.resolve(),
  getDeviceBindingScoped: () => Promise.resolve({ bounded: false, boundStoreId: null, boundInstanceId: null, signatureValid: false }),
  setDeviceBindingScoped: () => Promise.resolve(),
  clearDeviceBindingScoped: () => Promise.resolve(),
}));

vi.mock('@/hooks/useFeatures', () => ({
  FEATURES: {
    SIMPLE_RETAIL: 'simple-retail', RESTAURANT: 'restaurant',
    DISCOUNT_ENGINE: 'discount-engine', TAX_ENGINE: 'tax-engine',
    PROMOTIONS_ENGINE: 'promotions-engine', PRODUCT_BUNDLES: 'product-bundles',
    LOYALTY_PROGRAM: 'loyalty-program', KITCHEN_DISPLAY: 'kitchen-display',
    TABLE_MANAGEMENT: 'table-management', CASH_PAYMENT: 'cash-payment',
    CARD_PAYMENT: 'card-payment', MULTI_CURRENCY: 'multi-currency',
    INVENTORY_TRACKING: 'inventory-tracking', PRODUCT_VARIANTS: 'product-variants',
    CATEGORIES_ENABLED: 'categories-enabled', BARCODE_SCANNING: 'barcode-scanning',
    RECEIPT_PRINTING: 'receipt-printing', CASH_DRAWER: 'cash-drawer',
    CUSTOMER_DISPLAY: 'customer-display', NFC_READER: 'nfc-reader',
    STAFF_LOGIN: 'staff-login', STAFF_ROLES: 'staff-roles',
    SHIFT_MANAGEMENT: 'shift-management', AUDIT_LOG: 'audit-log',
    CLOUD_SYNC: 'cloud-sync', MULTI_STORE: 'multi-store',
    MULTI_TERMINAL: 'multi-terminal', REPORTING: 'reporting',
    ANALYTICS: 'analytics', EXPORT_IMPORT: 'export-import',
    PLUGIN_SYSTEM: 'plugin-system', SELF_SERVICE_KIOSK: 'self-service-kiosk',
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: { user_id: 'user-1' } }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1' }),
}));

const { mockListWorkspacesForStoreScoped } = vi.hoisted(() => ({
  mockListWorkspacesForStoreScoped: vi.fn(),
}));

vi.mock('@/api/workspaces', () => ({
  listWorkspacesForStoreScoped: (...args: unknown[]) =>
    mockListWorkspacesForStoreScoped(...args),
}));

const bundle = new FluentBundle('en-US');
bundle.addResource(new FluentResource(terminalsFtl));
const l10n = new ReactLocalization([bundle]);

function renderScreen() {
  return render(
    <LocalizationProvider l10n={l10n}>
      <ToastProvider>
        <TerminalManagementScreen />
      </ToastProvider>
    </LocalizationProvider>,
  );
}

function makeTerminal(overrides: Partial<TerminalDto> = {}): TerminalDto {
  return {
    id: 't-1', name: 'Front Counter', deviceId: 'dev-001', isActive: true,
    lastSeenAt: '2026-07-01T12:00:00Z', metadata: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-07-01T12:00:00Z',
    ...overrides,
  };
}

describe('TerminalManagementScreen', () => {
  beforeEach(() => {
    mockListTerminals.mockResolvedValue([]);
    mockListTerminalOverrides.mockResolvedValue([]);
    mockRegisterTerminal.mockResolvedValue({ id: 'new-t' });
    mockDeleteTerminal.mockResolvedValue(undefined);
    mockListWorkspacesForStoreScoped.mockResolvedValue([]);
  });

  it('renders the title', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Terminal Management')).toBeDefined());
  });

  it('renders the Register Terminal button', async () => {
    renderScreen();
    await waitFor(() => {
      const btns = screen.getAllByText('Register Terminal');
      expect(btns.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows loading skeleton while fetching terminals', () => {
    mockListTerminals.mockReturnValue(new Promise(() => {}));
    renderScreen();
    expect(document.querySelector('.terminal-mgmt-loading-skeleton')).toBeDefined();
    expect(screen.queryByText('Loading terminals…')).toBeNull();
  });

  it('shows empty state', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText(/No terminals registered yet/)).toBeDefined());
  });

  it('shows error state with retry', async () => {
    mockListTerminals.mockRejectedValue(new Error('Failed'));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Retry')).toBeDefined());
  });

  it('renders table with terminal data', async () => {
    mockListTerminals.mockResolvedValue([
      makeTerminal(),
      makeTerminal({ id: 't-2', name: 'Bar', deviceId: 'dev-002' }),
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Front Counter')).toBeDefined();
      expect(screen.getByText('Bar')).toBeDefined();
      expect(screen.getByText('Name')).toBeDefined();
      expect(screen.getByText('Device ID')).toBeDefined();
      expect(screen.getByText('Status')).toBeDefined();
    });
  });

  it('shows Active status badge for active terminal', async () => {
    mockListTerminals.mockResolvedValue([makeTerminal({ isActive: true })]);
    renderScreen();
    await waitFor(() => {
      expect(document.querySelector('.terminal-mgmt-status-active')).toBeDefined();
    });
  });

  it('shows Inactive status badge for inactive terminal', async () => {
    mockListTerminals.mockResolvedValue([makeTerminal({ isActive: false })]);
    renderScreen();
    await waitFor(() => {
      expect(document.querySelector('.terminal-mgmt-status-inactive')).toBeDefined();
    });
  });

  it('shows device ID in table', async () => {
    mockListTerminals.mockResolvedValue([makeTerminal({ deviceId: 'dev-abc' })]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('dev-abc')).toBeDefined());
  });

  it('shows Never for terminal with null lastSeenAt', async () => {
    mockListTerminals.mockResolvedValue([makeTerminal({ lastSeenAt: null })]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Never')).toBeDefined());
  });

  it('has Edit and Delete buttons per row', async () => {
    mockListTerminals.mockResolvedValue([makeTerminal()]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getAllByText('Edit').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Delete').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('opens delete confirmation modal on Delete click', async () => {
    mockListTerminals.mockResolvedValue([makeTerminal()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Front Counter')).toBeDefined());

    await userEvent.click(screen.getAllByText('Delete')[0]!.closest('button')!);
    await waitFor(() =>
      expect(screen.getByText(/Are you sure you want to delete terminal/)).toBeDefined(),
    );
  });

  it('calls deleteTerminal on confirm delete', async () => {
    mockListTerminals.mockResolvedValue([makeTerminal()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Front Counter')).toBeDefined());

    await userEvent.click(screen.getAllByText('Delete')[0]!.closest('button')!);
    await waitFor(() => expect(screen.getByText('Delete Terminal')).toBeDefined());

    const confirmBtn = screen.getAllByText('Delete').slice(-1)[0]!.closest('button')!;
    await userEvent.click(confirmBtn);

    await waitFor(() => expect(mockDeleteTerminal).toHaveBeenCalledWith('tok-1', 't-1'));
  });

  it('opens register modal when Register Terminal is clicked', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Register Terminal')).toBeDefined());

    await userEvent.click(screen.getAllByText('Register Terminal')[0]!.closest('button')!);
    await waitFor(() => expect(screen.getByText('Register New Terminal')).toBeDefined());
  });

  // ── C2.2: terminal-limit banner (Plus→Pro trigger) ────────────

  it('shows the non-blocking limit banner at the tier\'s register cap (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ maxPosInstances: 2, terminalCount: 2 }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    mockListTerminals.mockResolvedValue([makeTerminal(), makeTerminal({ id: 't-2', deviceId: 'dev-002' })]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText(/register limit for your plan/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
  });

  it('hides the terminal-limit banner under the cap (C2.2)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ maxPosInstances: 5, terminalCount: 2 }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    mockListTerminals.mockResolvedValue([makeTerminal(), makeTerminal({ id: 't-2', deviceId: 'dev-002' })]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getAllByText('Front Counter').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
