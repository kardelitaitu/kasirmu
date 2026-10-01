/**
 * @file RestaurantPaymentsScreen.test.tsx
 * @description Component-level suite for the restaurant payment-rails screen —
 * the UI half of the restaurant POS payment settings surface (the pure logic
 * lives in paymentRailsLogic.ts and has its own 100% suite). This file drives
 * the screen's own branches: loading/load-error, the rails list + toggles, the
 * QRIS-only static-QR card, add/remove custom rail, the EDC terminal select and
 * test-connection flow, dirty-state gating of Save, the save payload shape, and
 * back navigation.
 *
 * The static-QR codec (read/writeStaticQrPayload) is kept REAL — a QR edit must
 * land inside the parameters bag without dropping sibling keys, which only the
 * real codec can prove. Only the IPC/network-facing names are stubbed.
 *
 * Localization: assertions are written against the ENGLISH values in
 * settings.ftl + products.ftl, mounted as the real bundles.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import RestaurantPaymentsScreen from '@/features/restaurant/screens/RestaurantPaymentsScreen';
import productsFtl from '@/locales/products.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';

const FTL = [productsFtl, settingsFtl];

// ── Mocks ─────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  getPrimary: vi.fn(),
  getMethods: vi.fn(),
  setMethods: vi.fn(),
  listEdc: vi.fn(),
  edcStatus: vi.fn(),
  hwSave: vi.fn(),
  localPrefsEdc: '' as string,
  profilePresent: true,
  sessionToken: 'tok-1' as string,
}));

vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mocks.getPrimary(...args),
}));

vi.mock('@/api/local-payment', async (importOriginal) => {
  // The static-QR codec must stay REAL (see file header).
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    getLocalPaymentMethodsScoped: (...args: unknown[]) => mocks.getMethods(...args),
    setLocalPaymentMethodsScoped: (...args: unknown[]) => mocks.setMethods(...args),
  };
});

vi.mock('@/api/edc', () => ({
  listEdcTerminalsScoped: (...args: unknown[]) => mocks.listEdc(...args),
  edcTerminalStatusScoped: (...args: unknown[]) => mocks.edcStatus(...args),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: mocks.sessionToken, terminalId: 'term-1' }),
}));

// Stable-ish profile object pegged to the hoisted flag so a per-test profile
// can inject a default EDC preference. The screen's effect only fires when the
// profile reference itself is truthy; it mis-fires if the ref changes per call.
vi.mock('@/hooks/useTerminalHardware', () => ({
  useTerminalHardware: () => {
    if (!mocks.profilePresent) {
      return {
        profile: null,
        isLoading: false,
        error: null,
        updatePrinter: vi.fn(),
        updateScale: vi.fn(),
        updateScanner: vi.fn(),
        updateLocalPrefs: vi.fn(),
        save: mocks.hwSave,
        reload: vi.fn(),
      };
    }
    return {
      profile: {
        terminalId: 'term-1',
        hardware: {
          printer: { connection: 'usb', devicePath: '/dev/usb/lp0', paperSize: '80' as const, testPrintIp: '' },
          scale: { connection: 'none' as const, devicePath: '', baudRate: 9600, zeroOnBoot: false },
          scanner: { mode: 'keyboard' as const, deviceId: '' },
        },
        localPrefs: { defaultEdcTerminalId: mocks.localPrefsEdc },
        initialized: '2026-01-01T00:00:00Z',
        version: 1,
      },
      isLoading: false,
      error: null,
      updatePrinter: vi.fn(),
      updateScale: vi.fn(),
      updateScanner: vi.fn(),
      updateLocalPrefs: vi.fn(),
      save: mocks.hwSave,
      reload: vi.fn(),
    };
  },
}));

const QRIS_BAG = JSON.stringify({ static_qr_payload: '00020120440014', merchant: 'KIOSK-A' });
// card is core (non-removable, disabled), gopay is a persisted custom rail.
const RAILS = [
  { rail_code: 'card', label: 'Card', is_enabled: false, parameters: '{}', scope: 'entity' as const },
  { rail_code: 'gopay', label: 'GoPay', is_enabled: true, parameters: '{}', scope: 'location' as const },
];
const EDC_TERMINALS = [
  {
    id: 'term_lane_1',
    name: 'Counter Lane 1',
    connectionType: 'wired',
    transport: 'serial',
    address: 'COM3',
    vendor: 'ingenico',
    model: 'iCT250',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

function renderScreen(props: { terminalId?: string; onSaved?: () => void; onBack?: () => void } = {}) {
  return renderWithProviders(<RestaurantPaymentsScreen {...props} />, ...FTL);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.getPrimary.mockReset();
  mocks.getMethods.mockReset();
  mocks.setMethods.mockReset();
  mocks.listEdc.mockReset();
  mocks.edcStatus.mockReset();
  mocks.hwSave.mockReset();
  mocks.localPrefsEdc = '';
  mocks.profilePresent = true;
  mocks.sessionToken = 'tok-1';

  mocks.getPrimary.mockResolvedValue({ id: 'loc-1' });
  mocks.getMethods.mockResolvedValue(RAILS.map((r) => ({ ...r })));
  mocks.setMethods.mockResolvedValue([]);
  mocks.listEdc.mockResolvedValue(EDC_TERMINALS);
  mocks.edcStatus.mockResolvedValue({ status: 'ready' });
  mocks.hwSave.mockResolvedValue(undefined);
});

describe('RestaurantPaymentsScreen — loading & load error', () => {
  it('shows the loading line before the reads resolve, then the rails list', async () => {
    let gate!: (v: unknown) => void;
    const pending = new Promise((res) => { gate = res; });
    mocks.getMethods.mockReturnValue(pending);

    await renderScreen();
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    gate(RAILS.map((r) => ({ ...r })));
    await waitFor(() => {
      expect(screen.getByText('GoPay')).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('surfaces the load-error toast (localised copy, not the raw rejection) and drops the editor', async () => {
    mocks.getMethods.mockRejectedValue(new Error('raw backend text'));

    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Could not load the payment methods.')).toBeInTheDocument();
    });
    expect(screen.queryByText(/raw backend text/)).not.toBeInTheDocument();
    expect(screen.queryByText('GoPay')).not.toBeInTheDocument();
  });

  it('stays stuck on the loading line and never asks for rails when there is no session token', async () => {
    mocks.sessionToken = '';
    await renderScreen();

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(mocks.getPrimary).not.toHaveBeenCalled();
    expect(mocks.getMethods).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});

describe('RestaurantPaymentsScreen — rails list & toggles', () => {
  it('renders core and custom rails; custom only gets a remove button', async () => {
    await renderScreen();
    await screen.findByText('GoPay');

    // card is core -> no remove button; gopay is custom -> has one.
    const cardRow = screen.getByText('Card').closest('.restaurant-rail-row') as HTMLElement;
    const gopayRow = screen.getByText('GoPay').closest('.restaurant-rail-row') as HTMLElement;
    expect(within(cardRow).queryByRole('button', { name: /remove/i })).toBeNull();
    expect(within(gopayRow).getByRole('button', { name: /remove/i })).toBeInTheDocument();

    // Both render the code chip.
    expect(screen.getByText('gopay')).toBeInTheDocument();
  });

  it('toggling a rail onto a dirty screen enables Save', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    const onSaved = vi.fn();
    await renderScreen({ onSaved });

    await screen.findByText('GoPay');
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect(saveBtn).toBeDisabled();

    // card is seeded disabled; toggling it on is dirty. The rail inputs use
    // role="switch", and the accessible name is the rail label (the <label
    // htmlFor> wins over the sr-only span).
    const cardToggle = screen.getByRole('switch', { name: 'Card' });
    expect(cardToggle).not.toBeChecked();
    await user.click(cardToggle);
    expect(cardToggle).toBeChecked();
    expect(saveBtn).toBeEnabled();
  });

  it('toggles Cash and QRIS off and back on', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('Cash');

    const cashToggle = screen.getByRole('switch', { name: 'Cash' });
    expect(cashToggle).toBeChecked();
    await user.click(cashToggle);
    expect(cashToggle).not.toBeChecked();

    const qrisToggle = screen.getByRole('switch', { name: 'QRIS' });
    expect(qrisToggle).toBeChecked();
    await user.click(qrisToggle);
    expect(qrisToggle).not.toBeChecked();

    // Toggle back on
    await user.click(cashToggle);
    expect(cashToggle).toBeChecked();
  });
});

describe('RestaurantPaymentsScreen — QRIS static QR card', () => {
  it('offers the static-QR editor only when qris is present and enabled', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    mocks.getMethods.mockResolvedValue([
      { rail_code: 'qris', label: 'QRIS', is_enabled: true, parameters: QRIS_BAG, scope: 'entity' as const },
      { rail_code: 'va-bca', label: 'BCA VA', is_enabled: false, parameters: '{}', scope: 'location' as const },
    ]);

    await renderScreen();
    await screen.findByText('QRIS');

    const area = screen.getByLabelText('Static QR payload (EMVCo string)');
    expect(area).toHaveValue('00020120440014');

    // Editing writes into the bag without dropping the sibling key.
    const user2 = user;
    await user2.clear(area);
    await user2.type(area, 'NEW-PAYLOAD');
    expect(area).toHaveValue('NEW-PAYLOAD');

    // Save and confirm the bag preserved `merchant`. mergeCoreRails orders the
    // save payload by core order (cash, card, qris, ...), so find the qris row
    // by its rail code instead of assuming index 0.
    await user2.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(mocks.setMethods).toHaveBeenCalledTimes(1);
    });
    const payload = mocks.setMethods.mock.calls[0]?.[2] as { rail_code: string; parameters: string }[];
    const qrisEntry = payload.find((r) => r.rail_code === 'qris')!;
    const qris = JSON.parse(qrisEntry.parameters) as Record<string, string>;
    expect(qris['static_qr_payload']).toBe('NEW-PAYLOAD');
    expect(qris['merchant']).toBe('KIOSK-A');
  });

  it('hides the QRIS card when the persisted qris rail is disabled', async () => {
    // mergeCoreRails guarantees core rails always exist, so a disabled qris is
    // the only way the static-QR card is gated off.
    mocks.getMethods.mockResolvedValue([
      { rail_code: 'qris', label: 'QRIS', is_enabled: false, parameters: QRIS_BAG, scope: 'entity' as const },
      { rail_code: 'gopay', label: 'GoPay', is_enabled: true, parameters: '{}', scope: 'location' as const },
    ]);

    await renderScreen();
    await screen.findByText('GoPay');
    expect(screen.queryByLabelText('Static QR payload (EMVCo string)')).not.toBeInTheDocument();
  });
});

describe('RestaurantPaymentsScreen — custom payment methods & card expand/collapse', () => {
  it('removes a custom payment method via its remove button', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('GoPay');

    const gopayRow = screen.getByText('GoPay').closest('.restaurant-rail-row') as HTMLElement;
    await user.click(within(gopayRow).getByRole('button', { name: /remove/i }));
    expect(screen.queryByText('GoPay')).not.toBeInTheDocument();
    // card (core) stays.
    expect(screen.getByText('Card')).toBeInTheDocument();
  });

  it('expands and collapses cards on header click', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('GoPay');

    const cashCard = screen.getByTestId('payment-card-cash');
    expect(cashCard).toHaveClass('resto-payment-card-wrapper--expanded');

    // Click expand button to collapse
    const expandBtn = screen.getByRole('button', { name: /collapse cash/i });
    await user.click(expandBtn);
    expect(cashCard).toHaveClass('resto-payment-card-wrapper--collapsed');

    // Click button again to re-expand
    const reExpandBtn = screen.getByRole('button', { name: /expand cash/i });
    await user.click(reExpandBtn);
    expect(cashCard).toHaveClass('resto-payment-card-wrapper--expanded');
  });
});

describe('RestaurantPaymentsScreen — EDC terminal', () => {
  it('lists active EDC terminals in the default select', async () => {
    await renderScreen();
    await screen.findByText('GoPay');

    const select = document.querySelector('#resto-default-edc') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    // The seeded active terminal is an option.
    expect(within(select).getByText(/Counter Lane 1/)).toBeInTheDocument();
  });

  it('shows Test Connection only after a default EDC is chosen and runs a status query', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('GoPay');

    expect(screen.queryByRole('button', { name: 'Test Connection' })).not.toBeInTheDocument();

    const select = document.querySelector('#resto-default-edc') as HTMLSelectElement;
    await user.selectOptions(select, 'term_lane_1');
    const testBtn = screen.getByRole('button', { name: 'Test Connection' });
    expect(testBtn).toBeInTheDocument();

    await user.click(testBtn);
    await waitFor(() => {
      expect(mocks.edcStatus).toHaveBeenCalledWith('tok-1', 'term_lane_1');
    });
    // ready -> success toast with the uppercased status.
    await waitFor(() => {
      expect(screen.getByText(/Test Connection: READY/)).toBeInTheDocument();
    });
  });

  it('falls back to an empty EDC list and still renders rails when the terminal list rejects', async () => {
    mocks.listEdc.mockRejectedValue(new Error('edc service down'));

    await renderScreen();
    await screen.findByText('GoPay');

    // Rails still load because the EDC rejection is swallowed by the .catch.
    expect(screen.getByText('Card')).toBeInTheDocument();
    // The EDC select degrades to the manual-entry-only option.
    const select = document.querySelector('#resto-default-edc') as HTMLSelectElement;
    expect(within(select).getByText('None (Manual Card Entry)')).toBeInTheDocument();
    expect(within(select).queryByText(/Counter Lane 1/)).not.toBeInTheDocument();
  });

  it('reports an error toast when the EDC status query rejects', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    mocks.edcStatus.mockRejectedValue(new Error('offline'));
    await renderScreen();
    await screen.findByText('GoPay');

    const select = document.querySelector('#resto-default-edc') as HTMLSelectElement;
    await user.selectOptions(select, 'term_lane_1');
    await user.click(screen.getByRole('button', { name: 'Test Connection' }));

    await waitFor(() => {
      expect(screen.getByText(/Test Connection: ERROR/)).toBeInTheDocument();
    });
  });
});

describe('RestaurantPaymentsScreen — save, dirty state & back', () => {
  it('saves a dirty change: writes rails + hardware pref and calls onSaved', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    const onSaved = vi.fn();
    mocks.localPrefsEdc = 'term_lane_1';
    await renderScreen({ onSaved });

    await screen.findByText('GoPay');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // Toggle card -> dirty. Rails are role="switch" named by the rail label.
    await user.click(screen.getByRole('switch', { name: 'Card' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mocks.setMethods).toHaveBeenCalledTimes(1);
    });
    // Rails written for the right location with the toggled card state.
    expect(mocks.setMethods).toHaveBeenCalledWith('tok-1', 'loc-1', expect.arrayContaining([
      expect.objectContaining({ rail_code: 'card', is_enabled: true }),
    ]));
    // Hardware EDC preference is saved too.
    expect(mocks.hwSave).toHaveBeenCalledTimes(1);

    // Success toast + onSaved.
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Settings saved successfully')).toBeInTheDocument();
  });

  it('reports an error toast when the rail save rejects and does not call onSaved', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    const onSaved = vi.fn();
    mocks.setMethods.mockRejectedValue(new Error('FORBIDDEN'));
    await renderScreen({ onSaved });

    await screen.findByText('GoPay');
    await user.click(screen.getByRole('switch', { name: 'Card' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Failed to save settings. Please try again.')).toBeInTheDocument();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('does not rewrite the hardware pref when there is no profile', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    mocks.profilePresent = false;
    await renderScreen();

    await screen.findByText('GoPay');
    await user.click(screen.getByRole('switch', { name: 'Card' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mocks.setMethods).toHaveBeenCalledTimes(1);
    });
    expect(mocks.hwSave).not.toHaveBeenCalled();
  });

  it('fires onBack when the header back button is clicked', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    const onBack = vi.fn();
    await renderScreen({ onBack });

    await screen.findByText('GoPay');
    await user.click(screen.getByTestId('restaurant-payments-back-btn'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows unsaved-changes dialog when back is clicked with dirty form', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    const onBack = vi.fn();
    await renderScreen({ onBack });

    await screen.findByText('GoPay');
    // Make form dirty by toggling Card switch
    await user.click(screen.getByRole('switch', { name: 'Card' }));

    await user.click(screen.getByTestId('restaurant-payments-back-btn'));
    // Dialog should appear; onBack not yet called
    expect(screen.getByTestId('unsaved-dialog-discard')).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('calls onBack when Discard is clicked in the unsaved dialog', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    const onBack = vi.fn();
    await renderScreen({ onBack });

    await screen.findByText('GoPay');
    await user.click(screen.getByRole('switch', { name: 'Card' }));

    await user.click(screen.getByTestId('restaurant-payments-back-btn'));
    await user.click(screen.getByTestId('unsaved-dialog-discard'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('closes dialog and stays when Cancel is clicked in the unsaved dialog', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    const onBack = vi.fn();
    await renderScreen({ onBack });

    await screen.findByText('GoPay');
    await user.click(screen.getByRole('switch', { name: 'Card' }));

    await user.click(screen.getByTestId('restaurant-payments-back-btn'));
    await user.click(screen.getByTestId('unsaved-dialog-cancel'));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.queryByTestId('unsaved-dialog-discard')).toBeNull();
  });

  it('does not render a back button when onBack is omitted', async () => {
    await renderScreen();
    await screen.findByText('GoPay');
    expect(screen.queryByTestId('restaurant-payments-back-btn')).not.toBeInTheDocument();
  });

  it('ignores a late rails response after the screen is unmounted mid-load', async () => {
    const gate = deferred<unknown[]>();
    mocks.getMethods.mockReturnValue(gate.promise);

    const result = await renderScreen();
    await waitFor(() => {
      expect(mocks.getPrimary).toHaveBeenCalled();
    });

    // Unmount before the rails read resolves, then let it land: the cancellation
    // guard must swallow the late result without setting state or crashing.
    result.unmount();
    gate.resolve(RAILS.map((r) => ({ ...r })));

    // No rails were rendered after unmount, and no state-set-after-unmount crash.
    expect(screen.queryByText('GoPay')).not.toBeInTheDocument();
  });

  it('ignores a late primary-location read after the screen unmounts before the first Promise.all settles', async () => {
    const gate = deferred<{ id: string }>();
    mocks.getPrimary.mockReturnValue(gate.promise);
    // With getPrimary pending, Promise.all([getPrimary, listEdc]) cannot settle,
    // so the continuation only runs after we unmount and then release it.
    const result = await renderScreen();
    await waitFor(() => {
      expect(mocks.listEdc).toHaveBeenCalled();
    });

    result.unmount();
    gate.resolve({ id: 'loc-1' });

    // The cancelled guard swallows the late location; no location-keyed state lands.
    expect(screen.queryByText('GoPay')).not.toBeInTheDocument();
  });
});

describe('RestaurantPaymentsScreen — card controls and interactive elements', () => {
  it('interacts with Cash drawer switches and preset chips', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('Cash');

    const autoKickSwitch = screen.getByRole('switch', { name: 'Automatic Cash Drawer' });
    expect(autoKickSwitch).toBeChecked();
    await user.click(autoKickSwitch);
    expect(autoKickSwitch).not.toBeChecked();

    const verifySwitch = screen.getByRole('switch', { name: 'Cashier Drawer Verification' });
    expect(verifySwitch).not.toBeChecked();
    await user.click(verifySwitch);
    expect(verifySwitch).toBeChecked();

    const chip10k = screen.getByRole('button', { name: '10.000' });
    expect(chip10k).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip10k);
    expect(chip10k).toHaveAttribute('aria-pressed', 'false');
  });

  it('interacts with QRIS mode buttons and receipt print switch', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('QRIS');

    const dynamicBtn = screen.getByRole('button', { name: 'Dynamic' });
    await user.click(dynamicBtn);
    expect(dynamicBtn).toHaveClass('resto-segmented-btn--active');

    const printSwitch = screen.getByRole('switch', { name: 'Print Pay-at-Table QR' });
    expect(printSwitch).toBeChecked();
    await user.click(printSwitch);
    expect(printSwitch).not.toBeChecked();
  });

  it('interacts with EDC card network chips and trace code toggle', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('Card');

    // Expand Card to ensure body is visible
    const cardToggle = screen.getByRole('switch', { name: 'Card' });
    await user.click(cardToggle);

    const traceSwitch = screen.getByRole('switch', { name: 'Require Approval Code' });
    expect(traceSwitch).toBeChecked();
    await user.click(traceSwitch);
    expect(traceSwitch).not.toBeChecked();

    const visaChip = screen.getByRole('button', { name: 'Visa' });
    expect(visaChip).toHaveAttribute('aria-pressed', 'true');
    await user.click(visaChip);
    expect(visaChip).toHaveAttribute('aria-pressed', 'false');
  });

  it('interacts with Midtrans and Stripe configuration buttons', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('Midtrans Gateway');

    // Expand Midtrans
    const midtransToggle = screen.getByRole('switch', { name: 'Midtrans Gateway' });
    await user.click(midtransToggle);

    const prodBtn = screen.getByRole('button', { name: 'Production' });
    await user.click(prodBtn);
    expect(prodBtn).toHaveClass('resto-segmented-btn--active');

    const gopayChip = screen.getByRole('button', { name: 'GoPay / QRIS' });
    expect(gopayChip).toHaveAttribute('aria-pressed', 'true');
    await user.click(gopayChip);
    expect(gopayChip).toHaveAttribute('aria-pressed', 'false');

    const webhookSwitch = screen.getByRole('switch', { name: 'Instant Webhook' });
    expect(webhookSwitch).toBeChecked();
    await user.click(webhookSwitch);
    expect(webhookSwitch).not.toBeChecked();

    const testKeysBtn = screen.getByRole('button', { name: 'Test API Keys' });
    await user.click(testKeysBtn);
    expect(screen.getByText(/Please enter Client Key and Server Key/i)).toBeInTheDocument();

    // Expand Stripe
    const stripeToggle = screen.getByRole('switch', { name: 'Stripe Processing' });
    await user.click(stripeToggle);

    const liveBtn = screen.getByRole('button', { name: 'Live' });
    await user.click(liveBtn);
    expect(liveBtn).toHaveClass('resto-segmented-btn--active');

    const verifyKeysBtn = screen.getByRole('button', { name: 'Verify Keys' });
    await user.click(verifyKeysBtn);
    expect(screen.getByText(/Please enter Publishable Key and Secret Key/i)).toBeInTheDocument();
  });
});

