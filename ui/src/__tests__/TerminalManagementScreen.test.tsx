import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import { ToastProvider } from '@/components/Toast';
import TerminalManagementScreen from '@/features/terminals/TerminalManagementScreen';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { makeSubscriptionCaps } from '@/__tests__/test-utils/mocks/subscriptionCaps';
import terminalsFtl from '@/locales/terminals.ftl?raw';
import type { TerminalDto } from '@/api/terminals';

const { mockListTerminals, mockRegisterTerminal, mockDeleteTerminal,
  mockListTerminalOverrides, mockSetTerminalOverride, mockGetDeviceBinding,
  mockSetDeviceBinding } =
  vi.hoisted(() => ({
    mockListTerminals: vi.fn(),
    mockRegisterTerminal: vi.fn(),
    mockDeleteTerminal: vi.fn(),
    mockListTerminalOverrides: vi.fn(),
    mockSetTerminalOverride: vi.fn(),
    mockGetDeviceBinding: vi.fn(),
    mockSetDeviceBinding: vi.fn(),
  }));

vi.mock('@/api/terminals', () => ({
  listTerminalsScoped: (_sessionToken: string) => mockListTerminals(),
  registerTerminalScoped: (_sessionToken: string, args: unknown) => mockRegisterTerminal(_sessionToken, args),
  updateTerminalScoped: () => Promise.resolve({ id: 't-1' }),
  deleteTerminalScoped: (_sessionToken: string, id: string) => mockDeleteTerminal(_sessionToken, id),
  listTerminalOverridesScoped: (_sessionToken: string, id: string) => mockListTerminalOverrides(id),
  setTerminalOverrideScoped: (...args: unknown[]) => mockSetTerminalOverride(...args),
  deleteTerminalOverrideScoped: () => Promise.resolve(),
  getDeviceBindingScoped: () => mockGetDeviceBinding(),
  setDeviceBindingScoped: (...args: unknown[]) => mockSetDeviceBinding(...args),
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
    mockGetDeviceBinding.mockResolvedValue({ bounded: false, boundStoreId: null, boundInstanceId: null, signatureValid: false });
    mockSetTerminalOverride.mockResolvedValue(undefined);
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

  it('says the instance list could not be read instead of showing an empty store', async () => {
    // Opening Edit loads the store's workspace instances for the binding picker. A
    // rejected read used to empty the list with no error, so the "— Select instance —"
    // placeholder was identical to a store that genuinely has no instances and Bind
    // stayed disabled with nothing explaining why.
    mockListTerminals.mockResolvedValue([makeTerminal()]);
    mockGetDeviceBinding.mockResolvedValue({
      bounded: true, boundStoreId: 'store-1', boundInstanceId: 'inst-1', signatureValid: true,
    });
    mockListWorkspacesForStoreScoped.mockRejectedValue(new Error('ipc down'));
    renderScreen();

    await waitFor(() => expect(screen.getAllByText('Edit').length).toBeGreaterThanOrEqual(1));
    await act(async () => {
      await userEvent.click(screen.getAllByText('Edit')[0]!);
    });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load this store/i)).toBeInTheDocument();
    });
  });

  it('binds the terminal once when Bind is double-tapped', async () => {
    // The upsert of one (terminal, store, instance) triple cannot bind twice; what a
    // replay does is share ONE \`bindingError\` slot between two runs, so the second can
    // report a failure over a binding that landed.
    mockListTerminals.mockResolvedValue([makeTerminal()]);
    mockGetDeviceBinding.mockResolvedValue({
      bounded: false, boundStoreId: null, boundInstanceId: null, signatureValid: false,
    });
    // The picker's option VALUE is `instance_id`; a camelCase fixture renders an option
    // whose value is undefined, so the select can never carry a usable instance id.
    mockListWorkspacesForStoreScoped.mockResolvedValue([
      { instance_id: 'inst-1', name: 'Register 1', type_key: 'retail' },
    ]);
    let release: (() => void) | undefined;
    mockSetDeviceBinding.mockReturnValue(new Promise<void>((res) => { release = res; }));

    renderScreen();
    await waitFor(() => expect(screen.getAllByText('Edit').length).toBeGreaterThanOrEqual(1));
    await act(async () => {
      await userEvent.click(screen.getAllByText('Edit')[0]!);
    });

    const bindBtn = await screen.findByText(/^Bind Terminal$/i);
    const button = bindBtn.closest('button') as HTMLButtonElement;
    // The dialog preselects nothing; both pickers must carry a value before Bind arms.
    // `listLocationsScoped` is the real IPC read here, so the store option comes from the
    // harness's own fixture — select whatever it offers rather than assuming an id.
    const storeSelect = screen.getByLabelText(/^Store$/i) as HTMLSelectElement;
    const storeOption = Array.from(storeSelect.options).map((o) => o.value).find((v) => v !== '');
    expect(storeOption, 'no store option to bind to').toBeTruthy();
    fireEvent.change(storeSelect, { target: { value: storeOption } });

    const instanceSelect = await waitFor(() => {
      const el = screen.getByLabelText(/Workspace Instance/i) as HTMLSelectElement;
      expect(Array.from(el.options).map((o) => o.value)).toContain('inst-1');
      return el;
    });
    fireEvent.change(instanceSelect, { target: { value: 'inst-1' } });
    expect(button.disabled, 'Bind must be armed before this case means anything').toBe(false);
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    release?.();
    await waitFor(() => expect(mockSetDeviceBinding).toHaveBeenCalledTimes(1));
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

  // ── Feature-override toggles: in-flight guard ──────────────────────
  //
  // The override switch is a CONTROLLED checkbox whose `checked` derives from
  // the `overrides` list. Two fast clicks before the refetch resolved both
  // read the same stale `checked`, so both wrote the SAME `!currentEnabled` —
  // the second click vanished and the switch snapped back to where it started.
  // A manager toggling a terminal feature got the wrong end state.

  /** Switch into edit mode on the one terminal, with one override row shown. */
  async function openOverrides(enabled: boolean, overrides: Record<string, unknown>[] = []) {
    mockListTerminals.mockResolvedValue([makeTerminal()]);
    mockListTerminalOverrides.mockResolvedValue([
      { terminalId: 't-1', feature: 'cloud-sync', enabled, createdAt: '', updatedAt: '' },
      ...overrides,
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Front Counter')).toBeDefined());
    await userEvent.click(screen.getAllByText('Edit')[0]!.closest('button')!);
    const box = await waitFor(() => {
      const el = screen.getByLabelText(/Override .*Cloud Sync/i) as HTMLInputElement;
      // The load must have settled: the guard refuses clicks while it is in
      // flight, so clicking earlier would measure the guard, not the write.
      expect(el.disabled).toBe(false);
      return el;
    });
    return box;
  }

  it('writes the toggle only once when a second click lands mid-round-trip', async () => {
    let release!: () => void;
    mockSetTerminalOverride.mockReturnValue(
      new Promise<void>((res) => { release = () => res(); }),
    );
    const checkbox = await openOverrides(false);

    expect(checkbox.checked).toBe(false);
    await userEvent.click(checkbox);
    // Reachability: the FIRST click must reach the write, or the guard is
    // simply swallowing every toggle and this test measures nothing.
    await waitFor(() => expect(mockSetTerminalOverride).toHaveBeenCalledTimes(1));
    // The optimistic flip landed, so the switch already shows the new value.
    expect(checkbox.checked).toBe(true);

    // Second click while the first is still in flight — the control is frozen.
    await userEvent.click(checkbox);
    expect(mockSetTerminalOverride).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(mockSetTerminalOverride).toHaveBeenCalledTimes(1));
  });

  it('sends the flipped value, not the stale one, and survives a rapid double click', async () => {
    // The defect's signature: with no guard, both calls carry `true` because
    // both read the same stale `checked === false`. Asserting the ARGUMENTS is
    // what distinguishes "one write" from "two identical writes".
    let release!: () => void;
    mockSetTerminalOverride.mockReturnValue(
      new Promise<void>((res) => { release = () => res(); }),
    );
    const checkbox = await openOverrides(false);

    await userEvent.click(checkbox);
    await userEvent.click(checkbox);

    await waitFor(() => expect(mockSetTerminalOverride).toHaveBeenCalled());
    const writes = mockSetTerminalOverride.mock.calls.filter(([, , , enabled]) => enabled === true);
    expect(writes).toHaveLength(1);
    release();
  });

  it('rolls the switch back when the override write fails', async () => {
    // A deferred rejection, not `mockRejectedValue`: an immediately-rejecting
    // promise lets React batch the optimistic set and the rollback into ONE
    // render, so the intermediate `checked === true` is never observable and
    // the mid-flight assertion below would fail against a CORRECT
    // implementation. The deferred form is what makes the two states
    // distinguishable.
    let fail!: (e: Error) => void;
    mockSetTerminalOverride.mockReturnValue(
      new Promise<void>((_res, rej) => { fail = rej; }),
    );
    const checkbox = await openOverrides(false);

    await userEvent.click(checkbox);
    // Optimistic first…
    await waitFor(() => expect(checkbox.checked).toBe(true));
    // …then the failure undoes it, or the switch advertises a state the
    // backend never stored.
    await act(async () => { fail(new Error('offline')); });
    await waitFor(() => expect(checkbox.checked).toBe(false));
  });
});
