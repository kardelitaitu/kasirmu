// ── WorkspaceInventorySettings tests ───────────────────────────────
//
// Covers: low stock threshold number input, deduction prefer warehouse
// toggle (gated on locationId), dirty tracking, save flow,
// variant differences.
//
// ADR #22 Phase 1 testing gate (§9).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode, ReactElement } from 'react';
import { LocalizationProvider } from '@fluent/react';
import { ToastProvider } from '@/frontend/shared/Toast';
import { WorkspaceInventorySettings } from '@/features/settings/workspace-cards/WorkspaceInventorySettings';
import { setSettingsScoped } from '@/api/settings';

// Resolve the settings IPC instantly (the dev-mock invoke adds a fixed
// 50ms real-timer delay per call). The card's mount load calls setState
// when it lands, which can revert a change made in that window and disable
// Save — skipping onSaved. Microtask resolution makes the load
// deterministic. `null` values parse back to the card's defaults (10,
// false), so dirty tracking starts clean.
vi.mock('@/api/settings', () => ({
  getSettingScoped: vi.fn(() => Promise.resolve(null)),
  setSettingsScoped: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      receipt: { showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '',
        paperWidth: 'standard' as const, showTableNumber: false,
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 },
      store: { name: '', address: '', taxId: '', currency: 'USD', branch: '' },
      sync: { serverUrl: null, hasApiKey: false, enabled: false },
      brand: { colour: '#147EFB', storeName: '' },
      preferences: { cardSize: 0, fontSize: 0, fontSmoothing: 'antialiased' },
      currencies: [], appVersion: '',
    },
    loading: false, error: null, hasPartialError: false,
    refetch: vi.fn(), lastChangedKeys: [], markSettingsUpdated: vi.fn(),
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: 'test-session-token',
    terminalId: 'test-terminal',
  }),
}));

const testL10n = {
  bundles: [], areBundlesEmpty: () => true,
  parseMarkup: (str: string) => [{ nodeName: '#text', textContent: str } as unknown as Node],
  getElement: (sourceElement: ReactElement) => sourceElement,
  getString: (id: string) => {
    const d: Record<string, string> = {
      'workspace-inv-threshold-heading': 'Stock Thresholds',
      'workspace-inv-low-stock': 'Low Stock Alert At',
      'workspace-inv-deduction-heading': 'Deduction Rules',
      'workspace-inv-deduction-warehouse': 'Prefer Warehouse First',
      'save': 'Save',
      'settings-save-error': 'Save failed',
    };
    return d[id] ?? id;
  },
  reportError: () => {}, getBundle: () => null, getChildren: (str: string) => str,
};

function Wrapper({ children }: { children: ReactNode }) {
  return <LocalizationProvider l10n={testL10n}><ToastProvider>{children}</ToastProvider></LocalizationProvider>;
}
function renderCard(overrides: Record<string, unknown> = {}) {
  return render(<Wrapper><WorkspaceInventorySettings
    variant="full-page" onSaved={vi.fn()} {...overrides} /></Wrapper>);
}

describe('WorkspaceInventorySettings', () => {
  it('renders Stock Thresholds heading', () => {
    renderCard();
    expect(screen.getByText('Stock Thresholds')).toBeInTheDocument();
  });

  it('renders low stock threshold input with default value', () => {
    renderCard();
    const input = document.getElementById('inv-low-stock') as HTMLInputElement;
    expect(Number(input.value)).toBe(10);
    expect(input.type).toBe('number');
  });

  it('shows Deduction Rules card when locationId is present', () => {
    renderCard({ locationId: 'loc-1' });
    expect(screen.getByText('Deduction Rules')).toBeInTheDocument();
  });

  it('hides Deduction Rules card when locationId is absent', () => {
    renderCard();
    expect(screen.queryByText('Deduction Rules')).not.toBeInTheDocument();
  });

  it('renders prefer warehouse toggle unchecked when locationId present', () => {
    renderCard({ locationId: 'loc-1' });
    const t = document.getElementById('inv-deduction-wh') as HTMLInputElement;
    expect(t.checked).toBe(false);
  });

  // ── Dirty tracking ───────────────────────────────────────────
  // originalsRef starts with current state (10, false), dirty=false

  it('Save button disabled when clean', () => {
    renderCard();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('Save button enabled after changing threshold', async () => {
    renderCard();
    const input = document.getElementById('inv-low-stock') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    });
  });

  it('calls onSaved after successful save', async () => {
    const onSaved = vi.fn();
    renderCard({ onSaved });
    fireEvent.change(document.getElementById('inv-low-stock')!, { target: { value: '5' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  // ── The save payload ───────────────────────────────────────────
  //
  // The test above asserts the callback fired, never what was sent. setSettingsScoped
  // was mocked and not asserted on in this file, in WorkspaceRestaurantPosSettings, or
  // in WorkspaceKdsSettings -- so no settings card anywhere checked its batch payload.
  // That is how 974388a0's density bug shipped: setSettingsScoped takes
  // Record<string, string> and the Rust command deserializes HashMap<String, String>
  // (commands/settings.rs:1054), so ONE non-string member rejects the whole call and
  // every key in the batch fails with it.
  //
  // This card is currently correct -- both values are wrapped in String() at
  // WorkspaceInventorySettings.tsx:84-85 -- so this is a guard, not a regression pin.
  // Stated plainly because a test that passes on arrival is worth less than one whose
  // failure mode is named.

  it('sends both inventory settings as strings in one batch', async () => {
    // Rendered WITH a session token deliberately. This file's renderCard() passes none,
    // so every existing test here drives the card with sessionToken undefined, and the
    // card then calls setSettingsScoped(undefined ?? null, ...) -- a null token that the
    // real function rejects outright (api/settings.ts:248-250, `No session token`). The
    // mock resolves it, so nothing surfaces. That is a separate gap from the payload one;
    // this test passes a token so it asserts the call production actually makes.
    renderCard({ sessionToken: 'test-token' });
    fireEvent.change(document.getElementById('inv-low-stock')!, { target: { value: '5' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled());
    vi.mocked(setSettingsScoped).mockClear();
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(setSettingsScoped).toHaveBeenCalled());

    const [token, entries] = vi.mocked(setSettingsScoped).mock.calls[0]!;
    expect(token).toBe('test-token');
    expect(Object.keys(entries!).sort()).toEqual([
      'inventory.deduction_prefer_warehouse', 'inventory.low_stock_threshold',
    ]);
    // The wire contract, asserted rather than left to the compiler.
    for (const [k, v] of Object.entries(entries!)) {
      expect(typeof v, `${k} must be serialised as a string`).toBe('string');
    }
    // A number here would be a silent whole-batch rejection at the Rust boundary.
    expect(entries!['inventory.low_stock_threshold']).toBe('5');
  });

  it('hides Save button in inspector-drawer variant', () => {
    renderCard({ variant: 'inspector-drawer' });
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });
});
