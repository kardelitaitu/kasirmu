// ── WorkspaceStorePosSettings tests ────────────────────────────────
//
// Covers: receipt form rendering, dirty tracking, save flow (calls
// useTerminalHardware.save + onSaved), variant='inspector-drawer' hides
// footer + save button, printer/scanner sections gated on terminalId,
// Save button disabled when not dirty.
//
// ADR #22 Phase 1 testing gate (§9).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode, ReactElement } from 'react';
import { LocalizationProvider } from '@fluent/react';
import { ToastProvider } from '@/components/Toast';
import { WorkspaceStorePosSettings } from '@/features/settings/workspace-cards/WorkspaceStorePosSettings';

// ── Fluent test l10n ───────────────────────────────────────────────

const testL10n = {
  bundles: [],
  areBundlesEmpty: () => true,
  parseMarkup: (str: string) => [{ nodeName: '#text', textContent: str } as unknown as Node],
  getElement: (sourceElement: ReactElement) => sourceElement,
  getString: (id: string) => {
    const defaults: Record<string, string> = {
      'workspace-pos-receipt-heading': 'Receipt Settings',
      'workspace-pos-paper-width': 'Paper Width',
      'workspace-pos-show-currency': 'Show Currency',
      'workspace-pos-show-tax': 'Show Tax',
      'workspace-pos-tax-rounding': 'Tax Rounding',
      'workspace-pos-tax-rounding-halfup': 'Round Half Up',
      'workspace-pos-tax-rounding-truncate': 'Truncate (Legacy)',
      'workspace-pos-show-table': 'Show Table Number',
      'workspace-pos-footer': 'Receipt Footer',
      'workspace-pos-printer-heading': 'Printer',
      'workspace-pos-printer-connection': 'Connection',
      'workspace-pos-printer-ip': 'IP Address',
      'workspace-pos-printer-paper-size': 'Paper Size',
      'workspace-pos-scanner-heading': 'Barcode Scanner',
      'workspace-pos-scanner-mode': 'Input Mode',
      'workspace-pos-scanner-device': 'Device ID',
      'save': 'Save',
      'settings-save-error': 'Save failed',
    };
    return defaults[id] ?? id;
  },
  reportError: () => {},
  getBundle: () => null,
  getChildren: (str: string) => str,
};

// ── @/api/settings mock (save-payload assertions) ────────────────

const apiMocks = vi.hoisted(() => ({
  setReceiptSettingsScoped: vi.fn((_token: string, _args: Record<string, unknown>) => Promise.resolve()),
}));

vi.mock('@/api/settings', () => ({
  setReceiptSettingsScoped: apiMocks.setReceiptSettingsScoped,
}));

// ── Mock state ──────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  receiptSettings: {
    paperWidth: 'standard' as const,
    showCurrency: false,
    showTax: true,
    showTableNumber: false,
    taxRoundingMode: 'half_up',
    footer: '',
  },
  storeSettings: {
    name: 'Test Store',
    address: '',
    taxId: '',
    currency: 'USD',
    branch: '',
  },
  // Hoisted save control for the "save while saving" test
  _saveHang: null as (() => void) | null,
  hwError: null as string | null,
}));

// Stable profile object — prevents useEffect([hw.profile]) from
// re-firing on every render (which would reset originalsRef).
const stableProfile = {
  terminalId: 'term-1',
  storeId: 'store-1',
  hardware: {
    printer: { connection: 'auto' as const, devicePath: '', paperSize: '80' as const, testPrintIp: '' },
    scale: { connection: 'none' as const, devicePath: '', baudRate: 9600, zeroOnBoot: false },
    scanner: { mode: 'auto' as const, deviceId: '' },
  },
  localPrefs: { soundVolume: 80, darkMode: false, scaleAutoZero: true },
  initialized: '2026-01-01T00:00:00Z',
  version: 1,
};

// ── SettingsContext mock ────────────────────────────────────────────

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      receipt: mocks.receiptSettings,
      store: mocks.storeSettings,
    },
    loading: false,
    error: null,
    hasPartialError: false,
    refetch: vi.fn(),
    lastChangedKeys: [],
    markSettingsUpdated: vi.fn(),
  }),
}));

// ── useTerminalHardware mock ────────────────────────────────────────

vi.mock('@/hooks/useTerminalHardware', () => ({
  useTerminalHardware: (terminalId: string) => {
    if (!terminalId) return {
      profile: null,
      isLoading: false,
      error: mocks.hwError,
      updatePrinter: vi.fn(),
      updateScale: vi.fn(),
      updateScanner: vi.fn(),
      updateLocalPrefs: vi.fn(),
      save: vi.fn(),
      reload: vi.fn(),
    };

    return {
      profile: stableProfile,
      isLoading: false,
      error: mocks.hwError,
      updatePrinter: vi.fn(),
      updateScale: vi.fn(),
      updateScanner: vi.fn(),
      updateLocalPrefs: vi.fn(),
      save: vi.fn().mockImplementation(() => {
        if (mocks._saveHang) {
          return new Promise<void>((resolve) => { mocks._saveHang = resolve; });
        }
        return Promise.resolve();
      }),
      reload: vi.fn(),
    };
  },
}));

// ── SettingsSelect mock (simple wrapper) ────────────────────────────

vi.mock('../features/settings/SettingsSelect', () => ({
  default: ({ id, value, onChange, options }: {
    id: string;
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select
      id={id}
      data-testid={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  ),
}));

// ── Helpers ─────────────────────────────────────────────────────────

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <LocalizationProvider l10n={testL10n}>
      <ToastProvider>
        {children}
      </ToastProvider>
    </LocalizationProvider>
  );
}

function renderCard(overrides: Record<string, unknown> = {}) {
  return render(
    <Wrapper>
      <WorkspaceStorePosSettings
        terminalId="term-1"
        variant="full-page"
        onSaved={vi.fn()}
        {...overrides}
      />
    </Wrapper>,
  );
}

beforeEach(() => {
  Object.assign(mocks.receiptSettings, {
    paperWidth: 'standard',
    showCurrency: false,
    showTax: true,
    showTableNumber: false,
    taxRoundingMode: 'half_up',
    footer: '',
  });
  Object.assign(mocks.storeSettings, {
    name: 'Test Store', address: '', taxId: '', currency: 'USD', branch: '',
  });
  mocks._saveHang = null;
  mocks.hwError = null;
});

// ── Tests ───────────────────────────────────────────────────────────

describe('WorkspaceStorePosSettings', () => {
  // ── Rendering ────────────────────────────────────────────────

  it('renders receipt settings heading', () => {
    renderCard();
    expect(screen.getByText('Receipt Settings')).toBeInTheDocument();
  });

  it('renders paper width select with initial value', () => {
    renderCard();
    const select = screen.getByTestId('pos-paper-width') as HTMLSelectElement;
    expect(select.value).toBe('standard');
  });

  it('renders show currency toggle with correct initial state', () => {
    renderCard();
    const toggle = screen.getByLabelText('Show Currency') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('renders show tax toggle with correct initial state', () => {
    renderCard();
    const toggle = screen.getByLabelText('Show Tax') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('renders footer textarea in full-page variant', () => {
    renderCard({ variant: 'full-page' });
    expect(screen.getByLabelText('Receipt Footer')).toBeInTheDocument();
  });

  it('renders tax rounding select with initial value', () => {
    renderCard();
    const select = screen.getByTestId('pos-tax-rounding') as HTMLSelectElement;
    expect(select.value).toBe('half_up');
    // Both options are present
    expect(select.querySelectorAll('option')).toHaveLength(2);
  });

  it('changing tax rounding mode enables Save and persists truncate', async () => {
    renderCard();

    // Wait for originals to load and save to become disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    // Switch rounding mode to truncate
    fireEvent.change(screen.getByTestId('pos-tax-rounding'), { target: { value: 'truncate' } });

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /save/i });
      expect(btn).not.toBeDisabled();
    });
  });

  it('save sends taxRoundingMode to the backend', async () => {
    apiMocks.setReceiptSettingsScoped.mockClear();
    renderCard();

    // Wait for originals to load and save to become disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    // Switch rounding mode to truncate, then save
    fireEvent.change(screen.getByTestId('pos-tax-rounding'), { target: { value: 'truncate' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(apiMocks.setReceiptSettingsScoped).toHaveBeenCalledWith(
        'mock-session-token',
        expect.objectContaining({ taxRoundingMode: 'truncate' }),
      );
    });
  });

  // ── Variant: inspector-drawer ────────────────────────────────

  it('hides footer textarea in inspector-drawer variant', () => {
    renderCard({ variant: 'inspector-drawer' });
    expect(screen.queryByLabelText('Receipt Footer')).not.toBeInTheDocument();
  });

  it('hides Save button in inspector-drawer variant', () => {
    renderCard({ variant: 'inspector-drawer' });
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  // ── Printer section ──────────────────────────────────────────

  it('renders printer section when terminalId is provided', () => {
    renderCard({ terminalId: 'term-1' });
    expect(screen.getByText('Printer')).toBeInTheDocument();
    expect(screen.getByText('Barcode Scanner')).toBeInTheDocument();
  });

  it('hides printer section when terminalId is empty', () => {
    renderCard({ terminalId: '' });
    expect(screen.queryByText('Printer')).not.toBeInTheDocument();
    expect(screen.queryByText('Barcode Scanner')).not.toBeInTheDocument();
  });

  it('hides IP input when printer connection is auto', () => {
    renderCard({ terminalId: 'term-1' });
    // Mock always returns 'auto' — IP field should not render
    expect(screen.queryByLabelText('IP Address')).not.toBeInTheDocument();
  });

  // ── Dirty tracking ───────────────────────────────────────────
  //
  // IMPORTANT: WorkspaceStorePosSettings uses an originalsRef that is
  // populated by a useEffect AFTER the first render. On the first
  // render, originalsRef is {} (empty), so dirty is true and the Save
  // button is enabled. After the useEffect populates originalsRef,
  // dirty becomes false and the button becomes disabled. Tests must
  // wait for this async initialisation.

  it('Save button is disabled after originals load (not dirty)', async () => {
    renderCard();

    // Wait for originalsRef to be populated by useEffect
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /save/i });
      expect(btn).toBeDisabled();
    });
  });

  it('Save button becomes enabled after a change (dirty)', async () => {
    renderCard();

    // Wait for originals to load and save to become disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    // Now make a change
    fireEvent.click(screen.getByLabelText('Show Currency'));

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /save/i });
      expect(btn).not.toBeDisabled();
    });
  });

  it('Save button disabled while saving', async () => {
    // Use hoisted _saveHang to make save hang
    mocks._saveHang = vi.fn();

    renderCard();

    // Wait for originals to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    // Make it dirty
    fireEvent.click(screen.getByLabelText('Show Currency'));

    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);

    // Button should be disabled while save is pending
    expect(saveBtn).toBeDisabled();

    // Resolve the save to clean up
    if (mocks._saveHang) mocks._saveHang();
  });

  // ── Save flow ────────────────────────────────────────────────

  it('calls onSaved after successful save', async () => {
    const onSaved = vi.fn();
    renderCard({ onSaved });

    // Wait for originals to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    // Make dirty
    fireEvent.click(screen.getByLabelText('Show Currency'));

    // Click save
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it('renders with variant=modal without errors', () => {
    renderCard({ variant: 'modal' });
    expect(screen.getByText('Receipt Settings')).toBeInTheDocument();
  });

  it('has correct initial textarea value from receipt settings', () => {
    Object.assign(mocks.receiptSettings, { footer: 'Thank you!' });
    renderCard();
    const textarea = screen.getByLabelText('Receipt Footer') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Thank you!');
  });

  // ── Error display ────────────────────────────────────────────

  it('displays error message when hw.error is set', () => {
    mocks.hwError = 'Printer connection failed';
    renderCard();
    const banners = screen.getAllByRole('alert');
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent(/Printer connection/i);
  });

  // ── Edge cases ──────────────────────────────────────────────

  it('renders without printer section when terminalId is undefined', () => {
    renderCard({ terminalId: undefined });
    expect(screen.queryByText('Printer')).not.toBeInTheDocument();
    expect(screen.queryByText('Barcode Scanner')).not.toBeInTheDocument();
  });

  it('revert to original disables Save button again', async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    // Toggle Show Currency on
    fireEvent.click(screen.getByLabelText('Show Currency'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    });

    // Toggle Show Currency back off (revert)
    fireEvent.click(screen.getByLabelText('Show Currency'));
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /save/i });
      expect(btn).toBeDisabled();
    });
  });

  // ── i18n: no hardcoded "Toggle" sr-only strings ───────────────
  //
  // Each settings toggle switch renders a `<span className="sr-only">`
  // as the accessible name for the `role="switch"` input. The literal
  // English "Toggle" text bypasses @fluent/react — AGENTS.md mandates
  // <Localized> for all user-visible strings. A screen reader announces
  // the untranslated word instead of a localized control label.
  // This test asserts the sr-only text is NOT the hardcoded English
  // "Toggle" — after the fix it is wrapped in <Localized id="toggle">.

  it('does not render hardcoded English "Toggle" as sr-only switch labels', () => {
    renderCard();
    // Every toggle on this card previously rendered <span class="sr-only">Toggle</span>.
    // After localization, the text comes from the Fluent bundle, not the
    // literal string "Toggle". queryAllByText returns [] when no match
    // (getAllByText throws) — we assert zero hardcoded "Toggle" strings.
    const toggleSpans = screen.queryAllByText('Toggle');
    expect(
      toggleSpans,
      'found hardcoded English "Toggle" sr-only strings — these must be wrapped in <Localized id="toggle">',
    ).toHaveLength(0);
  });
});
