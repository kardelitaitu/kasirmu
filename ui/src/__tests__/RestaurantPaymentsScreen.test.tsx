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

import fs from 'node:fs';
import path from 'node:path';
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
  getGateway: vi.fn(),
  setGateway: vi.fn(),
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

vi.mock('@/api/payment-gateways', () => ({
  getPaymentGatewayConfigScoped: (...args: unknown[]) => mocks.getGateway(...args),
  setPaymentGatewayConfigScoped: (...args: unknown[]) => mocks.setGateway(...args),
  listPaymentGatewaysScoped: vi.fn().mockResolvedValue([]),
  deletePaymentGatewayScoped: vi.fn().mockResolvedValue(true),
}));

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
  mocks.getGateway.mockReset();
  mocks.setGateway.mockReset();
  mocks.localPrefsEdc = '';
  mocks.profilePresent = true;
  mocks.sessionToken = 'tok-1';

  mocks.getPrimary.mockResolvedValue({ id: 'loc-1' });
  mocks.getMethods.mockResolvedValue(RAILS.map((r) => ({ ...r })));
  mocks.setMethods.mockResolvedValue([]);
  mocks.listEdc.mockResolvedValue(EDC_TERMINALS);
  mocks.edcStatus.mockResolvedValue({ status: 'ready' });
  mocks.hwSave.mockResolvedValue(undefined);
  mocks.getGateway.mockResolvedValue(null);
  mocks.setGateway.mockResolvedValue({ id: 'gw-1' });
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
  // ── The core rails the screen FORGETS (F17) ──────────────────────
  //
  // `CORE_RAIL_CODES` (paymentRailsLogic.ts:11) names FIVE rails that always exist
  // and cannot be removed: cash, card, qris, open_bill, credit. The screen renders
  // dedicated cards only for cash / qris / card / midtrans / stripe, and it EXCLUDES
  // open_bill and credit from the Other-Rails list:
  //
  //     const internalHiddenCodes = ['open_bill', 'credit'];   (:839)
  //     !internalHiddenCodes.includes(d.rail_code.toLowerCase()),   (:844)
  //
  // So those two render NOWHERE — no card and no other-rails row. The operator
  // cannot see the rail, cannot toggle it, and gets no hint it exists. That is
  // worse than a toggle that does nothing (F16): at least a dead toggle is visible.
  //
  // It matters more since round 52, because the charge modal now HONOURS the
  // open_bill flag: `coreRailWithheld` reads `is_enabled`, and the rail row is
  // seeded `is_enabled: true`. So open_bill shows at checkout with no way to turn
  // it off from this screen — the operator's only recourse is the checkout itself.
  it('offers a toggle for EVERY core rail, including open_bill and credit', async () => {
    // The fixture seeds only card + gopay, so open_bill/credit resolve from the
    // screen's own CORE_DEFAULTS merge. They must still be visible: a core rail is
    // non-removable, not non-renderable.
    await renderScreen();
    await screen.findByText('Cash');

    // Labels come from `CORE_DEFAULTS` (paymentRailsLogic.ts:37-42), except `card`,
    // which the fixture seeds with a shorter label of its own.
    for (const label of ['Cash', 'Card', 'QRIS', 'Open Bill (Table Tab)', 'Customer Credit']) {
      expect(
        screen.queryByRole('switch', { name: label }),
        `core rail "${label}" has no toggle on this screen`,
      ).not.toBeNull();
    }
  });

  it('lets the operator switch open_bill OFF, which the charge modal now honours', async () => {
    // The end-to-end point of the gate: a rail the modal reads must be reachable.
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('Cash');

    const openBill = screen.getByRole('switch', { name: 'Open Bill (Table Tab)' });
    expect(openBill).toBeChecked();
    await user.click(openBill);
    expect(openBill).not.toBeChecked();
  });

  it('does NOT require a rail toggle for midtrans or stripe (gateway cards, not rails)', async () => {
    // The guard against over-correcting: those two are operator-configured
    // GATEWAYS with their own cards and their own enable switch, and they are not
    // in CORE_RAIL_CODES. A "fix" that demanded a rail switch for them would
    // duplicate the gateway's own control.
    await renderScreen();
    await screen.findByText('Cash');
    expect(screen.queryByRole('switch', { name: 'Midtrans' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Stripe' })).toBeNull();
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

  it('saves gateway credentials to setPaymentGatewayConfigScoped separately from market rails', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('GoPay');

    // Toggle midtrans -> dirty
    const midtransSwitch = screen.getByRole('switch', { name: 'Midtrans Gateway' });
    await user.click(midtransSwitch);

    // Save
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mocks.setGateway).toHaveBeenCalledWith('tok-1', expect.objectContaining({
        gatewayName: 'midtrans',
        isActive: true,
      }));
    });
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
  it('interacts with Cash drawer switches and preset chips via data-testid', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('Cash');

    // Label input
    const labelInput = screen.getByTestId('cash-custom-label-input');
    expect(labelInput).toHaveValue('Cash');
    await user.clear(labelInput);
    await user.type(labelInput, 'Cash Money');
    expect(labelInput).toHaveValue('Cash Money');

    // Auto kick switch
    const autoKickSwitch = screen.getByTestId('cash-drawer-kick-toggle');
    expect(autoKickSwitch).toBeChecked();
    await user.click(autoKickSwitch);
    expect(autoKickSwitch).not.toBeChecked();

    // Verify drawer switch
    const verifySwitch = screen.getByTestId('cash-drawer-verify-toggle');
    expect(verifySwitch).not.toBeChecked();
    await user.click(verifySwitch);
    expect(verifySwitch).toBeChecked();

    // Preset chips
    const exactChip = screen.getByTestId('cash-preset-exact');
    expect(exactChip).toHaveAttribute('aria-pressed', 'true');
    await user.click(exactChip);
    expect(exactChip).toHaveAttribute('aria-pressed', 'false');

    const chip1k = screen.getByTestId('cash-preset-1000');
    expect(chip1k).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip1k);
    expect(chip1k).toHaveAttribute('aria-pressed', 'false');

    const chip10k = screen.getByTestId('cash-preset-10000');
    expect(chip10k).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip10k);
    expect(chip10k).toHaveAttribute('aria-pressed', 'false');

    const chip100k = screen.getByTestId('cash-preset-100000');
    expect(chip100k).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip100k);
    expect(chip100k).toHaveAttribute('aria-pressed', 'false');
  });

  it('interacts with QRIS mode buttons, inputs, and receipt print switch via data-testid', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('QRIS');

    const dynamicBtn = screen.getByTestId('qris-mode-dynamic');
    await user.click(dynamicBtn);
    expect(dynamicBtn).toHaveClass('resto-segmented-btn--active');

    const staticBtn = screen.getByTestId('qris-mode-static');
    await user.click(staticBtn);
    expect(staticBtn).toHaveClass('resto-segmented-btn--active');

    // NMID input
    const nmidInput = screen.getByTestId('qris-nmid-input');
    await user.clear(nmidInput);
    await user.type(nmidInput, 'ID999999999');
    expect(nmidInput).toHaveValue('ID999999999');

    // Surcharge input
    const surchargeInput = screen.getByTestId('qris-surcharge-input');
    await user.clear(surchargeInput);
    await user.type(surchargeInput, '0.5');
    expect(surchargeInput).toHaveValue('0.5');

    // Print bill toggle
    const printSwitch = screen.getByTestId('qris-print-bill-toggle');
    expect(printSwitch).toBeChecked();
    await user.click(printSwitch);
    expect(printSwitch).not.toBeChecked();
  });

  it('interacts with EDC card network chips, trace code toggle, and select via data-testid', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('Card');

    // Expand Card to ensure body is visible
    const cardToggle = screen.getByTestId('payment-card-toggle-card');
    await user.click(cardToggle);

    const traceSwitch = screen.getByTestId('edc-require-trace-toggle');
    expect(traceSwitch).toBeChecked();
    await user.click(traceSwitch);
    expect(traceSwitch).not.toBeChecked();

    const visaChip = screen.getByTestId('card-network-visa');
    expect(visaChip).toHaveAttribute('aria-pressed', 'true');
    await user.click(visaChip);
    expect(visaChip).toHaveAttribute('aria-pressed', 'false');

    const amexChip = screen.getByTestId('card-network-amex');
    expect(amexChip).toHaveAttribute('aria-pressed', 'false');
    await user.click(amexChip);
    expect(amexChip).toHaveAttribute('aria-pressed', 'true');

    // Check EDC select trigger data-testid
    const selectTrigger = screen.getByTestId('edc-default-select');
    expect(selectTrigger).toBeInTheDocument();
  });

  it('interacts with Midtrans and Stripe configuration buttons via data-testid', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('Midtrans Gateway');

    // Expand Midtrans
    const midtransToggle = screen.getByTestId('payment-card-toggle-midtrans');
    await user.click(midtransToggle);

    const prodBtn = screen.getByTestId('midtrans-env-production');
    await user.click(prodBtn);
    expect(prodBtn).toHaveClass('resto-segmented-btn--active');

    const sandboxBtn = screen.getByTestId('midtrans-env-sandbox');
    await user.click(sandboxBtn);
    expect(sandboxBtn).toHaveClass('resto-segmented-btn--active');

    // Inputs
    const merchantIdInput = screen.getByTestId('midtrans-merchant-id-input');
    await user.type(merchantIdInput, 'M123');
    expect(merchantIdInput).toHaveValue('M123');

    const clientKeyInput = screen.getByTestId('midtrans-client-key-input');
    await user.type(clientKeyInput, 'CK-123');
    expect(clientKeyInput).toHaveValue('CK-123');

    const serverKeyInput = screen.getByTestId('midtrans-server-key-input');
    await user.type(serverKeyInput, 'SK-123');
    expect(serverKeyInput).toHaveValue('SK-123');

    // Channels
    const gopayChip = screen.getByTestId('midtrans-channel-gopay');
    expect(gopayChip).toHaveAttribute('aria-pressed', 'true');
    await user.click(gopayChip);
    expect(gopayChip).toHaveAttribute('aria-pressed', 'false');

    const webhookSwitch = screen.getByTestId('midtrans-auto-confirm-toggle');
    expect(webhookSwitch).toBeChecked();
    await user.click(webhookSwitch);
    expect(webhookSwitch).not.toBeChecked();

    const testKeysBtn = screen.getByTestId('midtrans-test-api-btn');
    await user.click(testKeysBtn);
    expect(screen.getByText(/Midtrans credentials format verified/i)).toBeInTheDocument();

    // Expand Stripe
    const stripeToggle = screen.getByTestId('payment-card-toggle-stripe');
    await user.click(stripeToggle);

    const liveBtn = screen.getByTestId('stripe-mode-live');
    await user.click(liveBtn);
    expect(liveBtn).toHaveClass('resto-segmented-btn--active');

    const testBtn = screen.getByTestId('stripe-mode-test');
    await user.click(testBtn);
    expect(testBtn).toHaveClass('resto-segmented-btn--active');

    const pubKeyInput = screen.getByTestId('stripe-pub-key-input');
    await user.type(pubKeyInput, 'pk_live_123');
    expect(pubKeyInput).toHaveValue('pk_live_123');

    const secKeyInput = screen.getByTestId('stripe-sec-key-input');
    await user.type(secKeyInput, 'sk_live_123');
    expect(secKeyInput).toHaveValue('sk_live_123');

    const verifyKeysBtn = screen.getByTestId('stripe-verify-keys-btn');
    await user.click(verifyKeysBtn);
    expect(screen.getByText(/Stripe keys format valid/i)).toBeInTheDocument();
  });

  it('adds and removes a custom payment rail via the add custom rail card', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    await screen.findByText('GoPay');

    expect(screen.getByTestId('add-custom-rail-card')).toBeInTheDocument();
    const codeInput = screen.getByTestId('new-rail-code-input');
    const labelInput = screen.getByTestId('new-rail-label-input');
    const addBtn = screen.getByTestId('add-custom-rail-btn');

    expect(addBtn).toBeDisabled();

    // Type new rail details
    await user.type(codeInput, 'dana');
    await user.type(labelInput, 'DANA Wallet');
    expect(addBtn).toBeEnabled();

    await user.click(addBtn);

    // The new card should be in the list
    expect(screen.getByTestId('payment-card-dana')).toBeInTheDocument();
    expect(screen.getByText('DANA Wallet')).toBeInTheDocument();
    expect(codeInput).toHaveValue('');
    expect(labelInput).toHaveValue('');

    // Attempt to add duplicate code
    await user.type(codeInput, 'dana');
    await user.click(addBtn);
    expect(screen.getByText('A payment method with this code already exists')).toBeInTheDocument();

    // Remove the newly added rail
    const removeBtn = screen.getByTestId('payment-card-remove-dana');
    await user.click(removeBtn);
    expect(screen.queryByTestId('payment-card-dana')).not.toBeInTheDocument();
  });
});

// ── F4 on THIS screen: a failed gateway read must not look clean ────────
//
// The drafts baseline is seeded at `:377`, BEFORE the two gateway reads at
// `:453-456`. Those reads used to `.catch(() => null)` independently, and the
// setters are behind `if (midtransGw)` / `if (stripeGw)`. So a failed read left
// the screen looking CLEAN while showing empty fields — and saving then wrote
// those blanks over the stored credentials.
//
// ⚠️ The assertion shape matters. "Save is disabled after a failure" passes
// against the BUG too, because on the buggy path `dirty` is already false, so
// Save is disabled either way. The discriminating property is the EDIT: on the
// bug, editing afterwards sets `dirty` true and RE-ENABLES Save over defaults
// that were never read. That is the round-4 lesson from the plan, applied here.
describe('RestaurantPaymentsScreen — a failed gateway read is not silent (F4)', () => {
  it('flags the failure, blocks Save, and refuses to claim the settings are saved', async () => {
    mocks.getGateway.mockRejectedValue(new Error('gateway read failed'));

    await renderScreen();

    // 1. The operator is told.
    await waitFor(() => {
      expect(screen.getByTestId('restaurant-payments-load-error')).toBeInTheDocument();
    });

    // 2. The header does NOT claim success over values it never read.
    expect(screen.queryByText('All changes saved')).not.toBeInTheDocument();

    // 3. The discriminating half: make an EDIT, which is what re-enables Save
    //    on the buggy path.
    const user = await import('@testing-library/user-event').then((m) => m.default);
    const toggle = await screen.findByTestId('payment-card-toggle-cash');
    await user.click(toggle);

    // 4. Save stays disabled despite `dirty` now being true.
    const save = screen.getByTestId('restaurant-payments-save-btn');
    expect(save).toBeDisabled();
  });

  it('offers a Retry, and Retry CLEARS the flag so Save can return', async () => {
    // A flag that disables a control is a one-way latch without this path —
    // round 8 of the F4 campaign shipped four Save-gates and no recovery.
    mocks.getGateway.mockRejectedValueOnce(new Error('first read fails'));

    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('restaurant-payments-load-error')).toBeInTheDocument();
    });

    const user = await import('@testing-library/user-event').then((m) => m.default);
    // The retry succeeds.
    mocks.getGateway.mockResolvedValue(null);
    await user.click(screen.getByTestId('restaurant-payments-load-retry-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('restaurant-payments-load-error')).not.toBeInTheDocument();
    });
  });

  it('a successful read shows NO failure banner (the flag is not always-on)', async () => {
    // Guards the guard: if the banner rendered unconditionally, both cases above
    // would pass while telling the operator nothing true.
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText('GoPay')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('restaurant-payments-load-error')).not.toBeInTheDocument();
  });
});

// ── P6 i18n sweep, third screen ─────────────────────────────────────────
//
// This screen hardcoded 24 user-visible strings — 14 `resto-compact-label` /
// `resto-compact-block-title` text nodes, 10 `aria-label`s, and 3 English
// placeholders. They now read from `products.ftl` / `products.id.ftl` as
// `restaurant-payment-*`.
//
// These cases assert the BUNDLE VALUES render, not merely that something
// appeared. A regression to a hardcoded literal would show the SAME visible
// text, so a weaker assertion would pass on it — the round-15 lesson from the
// plan, where an "is it there" check survived the bug it was written for.
describe('RestaurantPaymentsScreen — P6 i18n sweep (no hardcoded English)', () => {
  // The keys this screen must own. Each was a literal before the sweep.
  const SWEPT = [
    'restaurant-payment-display-label',
    'restaurant-payment-auto-cash-drawer',
    'restaurant-payment-cash-presets',
    'restaurant-payment-drawer-verification',
    'restaurant-payment-mode',
    'restaurant-payment-print-pay-at-table',
    'restaurant-payment-card-networks',
    'restaurant-payment-require-approval',
    'restaurant-payment-environment',
    'restaurant-payment-payment-channels',
    'restaurant-payment-instant-webhook',
    'restaurant-payment-connection',
    'restaurant-payment-qr-mode',
    'restaurant-payment-qr-payload',
    'restaurant-payment-midtrans-env',
    'restaurant-payment-stripe-mode',
    'restaurant-payment-custom-code-example',
    'restaurant-payment-custom-label-example',
    'restaurant-payment-cash-placeholder',
  ];

  /** products.ftl as shipped, read from disk so the test cannot agree with a literal. */
  function readProductsBundle(): string {
    return fs.readFileSync(
      path.resolve(process.cwd(), '../shared-ui/locales/products.ftl'),
      'utf-8',
    );
  }

  /** The bundle's value for a key, looked up rather than retyped. */
  function bundleValue(bundle: string, key: string): string {
    return (bundle.match(new RegExp('^' + key + ' = (.*)$', 'm')) ?? [])[1] ?? '';
  }

  it('every swept key exists in the English bundle', () => {
    const bundle = readProductsBundle();
    for (const key of SWEPT) {
      expect(
        bundle,
        `${key} is missing from products.ftl — if this screen went back to a ` +
          'hardcoded literal, that is the regression this case exists for',
      ).toMatch(new RegExp('^' + key + ' = ', 'm'));
    }
  });

  it('renders those values from the bundle', async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText('GoPay')).toBeInTheDocument();
    });
    const bundle = readProductsBundle();
    // Looked up by KEY, so this cannot drift into agreeing with a literal.
    //
    // These three are on the DEFAULT-rendered panel. `restaurant-payment-connection`
    // deliberately is NOT in this list: it lives inside the collapsed Stripe/EDC
    // cards at :1534/:1689, so asserting it here would fail on layout rather than
    // on i18n. The key's presence is covered by the case above.
    for (const key of [
      'restaurant-payment-display-label',
      'restaurant-payment-cash-presets',
      'restaurant-payment-auto-cash-drawer',
    ]) {
      expect(screen.getByText(bundleValue(bundle, key))).toBeInTheDocument();
    }
  });

  it('leaves no hardcoded English label, aria-label or placeholder in the source', () => {
    // The source-level half: a literal can render the right words and still BE a
    // literal. Only reading the file catches that.
    const src = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/features/restaurant/screens/RestaurantPaymentsScreen.tsx',
      ),
      'utf-8',
    );
    const offenders = src
      .split('\n')
      .map((line, i) => ({ n: i + 1, line }))
      .filter(({ line }) =>
        /aria-label="[A-Z]/.test(line) ||
        /<span className="resto-compact-(label|block-title)">[A-Z]/.test(line) ||
        /placeholder="(Cash|e\.g\.)/.test(line));
    expect(
      offenders.map((o) => `${o.n}: ${o.line.trim().slice(0, 70)}`),
      'these lines hardcode user-visible English again — route them through l10n.getString',
    ).toEqual([]);
  });
});

// ── The device's condition: NO persisted rails (F40) ────────────────────
//
// ⚠️ WHAT THESE CASES DO AND DO NOT PROVE — read before trusting them.
//
// THEY DO distinguish the two branches of `mergeCoreRails` — the `match` branch
// (a persisted row) from the `else` branch (`CORE_DEFAULTS`). The pre-existing
// case for this property supplies `card` as a persisted row, so the DEFAULTED
// branch had no test at all.
//
// THEY DO NOT reproduce the device bug. These pass against the real component,
// while the tablet — with the same condition, an empty rail table — leaves the
// screen clean and Save disabled. jsdom and the device disagree here, so the cause
// is NOT in this component's dirty logic as exercised by these mocks, and a fix
// aimed at this file alone would be aimed at the wrong thing.
//
// The open question this leaves, recorded rather than guessed at: what differs
// between the mocked load and the real IPC one. Candidates checked so far — the
// load effect is NOT re-running on render (a re-run would emit its failure toast),
// and `drafts` IS updated by the toggle (the card's `isExpanded` side effect
// fires). See the F40 note in `todo-restaurant-pos-reliability.md` for the device
// evidence and the reproduction steps.
//
// `mergeCoreRails` fills every core rail from `CORE_DEFAULTS` when the store has
// no matching row (`paymentRailsLogic.ts:70-77`). The tablet's store database
// holds ZERO rail rows, so that is the branch it takes — and on that branch,
// toggling a core rail did NOT mark the screen dirty: the header stayed on
// "All changes saved" and Save stayed disabled, so the operator's change could
// not be persisted at all.
//
// The existing case (`toggling a rail onto a dirty screen enables Save`) passes
// because its fixture supplies `card` as a PERSISTED row, taking the `match`
// branch at `:62-69` instead. Both branches were therefore never distinguished:
// one had a test and the other, the one the real device is on, did not.
//
// This case supplies an EMPTY rail list, which is what the tablet actually
// returns, and asserts the same property.
describe('RestaurantPaymentsScreen — dirty tracking with NO persisted rails (F40)', () => {
  it('toggling a DEFAULTED core rail marks the screen dirty and enables Save', async () => {
    const user = await import('@testing-library/user-event').then((m) => m.default);
    // The device's condition: the store has no rail rows at all.
    mocks.getMethods.mockResolvedValue([]);

    await renderScreen();
    // The core set is synthesised from CORE_DEFAULTS, so the cards render.
    const cashToggle = await screen.findByTestId('payment-card-toggle-cash');
    const saveBtn = screen.getByTestId('restaurant-payments-save-btn');
    expect(cashToggle).toBeChecked();
    expect(saveBtn).toBeDisabled();

    await user.click(cashToggle);
    expect(cashToggle).not.toBeChecked();

    // The property under test: a real change on a defaulted rail is DIRTY.
    // On the defect this stays disabled, because the baseline was seeded from
    // the same defaulted array and the toggle never diverges from it.
    expect(
      saveBtn,
      'a toggled core rail left the screen CLEAN, so the change cannot be saved — ' +
        'this is the state the tablet is in when its store holds no rail rows',
    ).toBeEnabled();
  });

  it('the dirty header agrees with the Save button on a defaulted rail', async () => {
    // The header is the operator-facing half of the same computation; a screen
    // that forbids Save while saying "All changes saved" is worse than one that
    // merely disables it.
    const user = await import('@testing-library/user-event').then((m) => m.default);
    mocks.getMethods.mockResolvedValue([]);
    await renderScreen();

    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    await user.click(await screen.findByTestId('payment-card-toggle-cash'));
    expect(
      screen.getByText('Unsaved changes'),
      'the header still claims everything is saved after an unsaved edit',
    ).toBeInTheDocument();
  });

  it('a persisted rail still marks dirty (guards the case above)', async () => {
    // Confirms the two branches are genuinely different, so a fix for the
    // defaulted case cannot silently regress the persisted one.
    const user = await import('@testing-library/user-event').then((m) => m.default);
    await renderScreen();
    const card = await screen.findByTestId('payment-card-toggle-card');
    expect(card).not.toBeChecked();
    await user.click(card);
    expect(screen.getByTestId('restaurant-payments-save-btn')).toBeEnabled();
  });
});
