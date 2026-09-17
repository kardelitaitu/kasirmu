// ── WorkspaceKdsSettings tests ─────────────────────────────────────
//
// Covers: SLA thresholds (yellow/red sliders), sound toggle,
// auto-acknowledge toggle, ticket display density select,
// dirty tracking, save flow, variant differences.
//
// ADR #22 Phase 1 testing gate (§9).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode, ReactElement } from 'react';
import { LocalizationProvider } from '@fluent/react';
import { ToastProvider } from '@/components/Toast';
import { WorkspaceKdsSettings } from '@/features/settings/workspace-cards/WorkspaceKdsSettings';
import { getSettingScoped, setSettingsScoped } from '@/api/settings';

const testL10n = {
  bundles: [], areBundlesEmpty: () => true,
  parseMarkup: (str: string) => [{ nodeName: '#text', textContent: str } as unknown as Node],
  getElement: (sourceElement: ReactElement) => sourceElement,
  getString: (id: string) => {
    const d: Record<string, string> = {
      'workspace-kds-sla-heading': 'SLA Escalation',
      'workspace-kds-sound': 'New Order Sound',
      'workspace-kds-yellow-threshold': 'Yellow Alert (min)',
      'workspace-kds-red-threshold': 'Red Alert (min)',
      'workspace-kds-yellow-threshold-aria': 'Yellow escalation threshold in minutes',
      'workspace-kds-red-threshold-aria': 'Red escalation threshold in minutes',
      'workspace-kds-display-heading': 'Ticket Display',
      'workspace-kds-auto-ack': 'Auto-Acknowledge',
      'workspace-kds-density': 'Density',
      'save': 'Save',
      'settings-save-error': 'Save failed',
    };
    return d[id] ?? id;
  },
  reportError: () => {}, getBundle: () => null, getChildren: (str: string) => str,
};

const mocks = vi.hoisted(() => ({
  fontSmoothing: 'antialiased' as string,
}));

// Stable preferences reference — prevents useEffect([settings.preferences])
// from re-firing on every render (which would cause infinite setDraft loop).
const stablePrefs = {
  cardSize: 0, fontSize: 0,
  get fontSmoothing() { return mocks.fontSmoothing; },
};

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      preferences: stablePrefs,
      receipt: { showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '',
        paperWidth: 'standard' as const, showTableNumber: false,
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 },
      store: { name: '', address: '', taxId: '', currency: 'USD', branch: '' },
      sync: { serverUrl: null, hasApiKey: false, enabled: false },
      brand: { colour: '#147EFB', storeName: '' },
      currencies: [], appVersion: '',
    },
    loading: false, error: null, hasPartialError: false,
    refetch: vi.fn(), lastChangedKeys: [], markSettingsUpdated: vi.fn(),
  }),
}));

vi.mock('../features/settings/SettingsSelect', () => ({
  default: ({ id, value, onChange, options }: {
    id: string; value: string; onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select id={id} data-testid={id} value={value}
      onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

// Resolve the settings IPC deterministically: the dev-mock invoke adds a
// fixed 50ms real-timer delay per call, and its get_setting returns ''
// (which parses to the card defaults). The regression test below also
// overrides a single call via mockImplementationOnce.
vi.mock('@/api/settings', () => ({
  getSettingScoped: vi.fn(() => Promise.resolve(null)),
  setSettingsScoped: vi.fn(() => Promise.resolve()),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <LocalizationProvider l10n={testL10n}><ToastProvider>{children}</ToastProvider></LocalizationProvider>;
}
function renderCard(overrides: Record<string, unknown> = {}) {
  return render(<Wrapper><WorkspaceKdsSettings
    sessionToken="test-token" variant="full-page" onSaved={vi.fn()} {...overrides} /></Wrapper>);
}

beforeEach(() => { mocks.fontSmoothing = 'antialiased'; });

describe('WorkspaceKdsSettings', () => {
  it('renders SLA Escalation heading', () => {
    renderCard();
    expect(screen.getByText('SLA Escalation')).toBeInTheDocument();
  });

    it('renders sound toggle (initially checked — default)', () => {
    renderCard();
    const t = document.getElementById('kds-sound') as HTMLInputElement;
    // DEFAULT_KDS.soundEnabled = true
    expect(t.checked).toBe(true);
  });

  it('renders yellow threshold slider', () => {
    renderCard();
    expect(screen.getByLabelText('Yellow escalation threshold in minutes')).toBeInTheDocument();
  });

  it('renders red threshold slider', () => {
    renderCard();
    expect(screen.getByLabelText('Red escalation threshold in minutes')).toBeInTheDocument();
  });

  it('renders Ticket Display heading', () => {
    renderCard();
    expect(screen.getByText('Ticket Display')).toBeInTheDocument();
  });

  it('renders auto-acknowledge toggle', () => {
    renderCard();
    const t = document.getElementById('kds-auto-ack') as HTMLInputElement;
    expect(t.checked).toBe(false);
  });

  it('renders density select', () => {
    renderCard();
    expect(screen.getByTestId('kds-density')).toBeInTheDocument();
  });

  // ── Dirty tracking ───────────────────────────────────────────
  // originalsRef starts matching draft (DEFAULT_KDS), so dirty=false

  it('Save button disabled when clean', () => {
    renderCard();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('Save button enabled after toggling auto-acknowledge', async () => {
    renderCard();
    const t = document.getElementById('kds-auto-ack') as HTMLInputElement;
    fireEvent.click(t);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    });
  });

  it('calls onSaved after successful save', async () => {
    const onSaved = vi.fn();
    renderCard({ onSaved });

    // Wait for getSetting calls to resolve
    await new Promise((r) => setTimeout(r, 10));

    const t = document.getElementById('kds-auto-ack') as HTMLInputElement;
    fireEvent.click(t);
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled(), { timeout: 3000 });
  });

  // ── The save payload ───────────────────────────────────────────
  //
  // `calls onSaved after successful save` above asserts the callback fired, never what
  // was sent. setSettingsScoped was mocked and never asserted on -- in this file or in
  // either sibling card's test -- so the entire batch payload had zero coverage. That is
  // how fcfddf79 shipped a regression: it turned DisplayDensity from a string union into
  // a number, converted the read path and the control, and missed the write-back at
  // WorkspaceKdsSettings.tsx:130.
  //
  // The consequence was not cosmetic. setSettingsScoped takes Record<string, string> and
  // the Rust command deserializes HashMap<String, String>
  // (apps/desktop-client/src/commands/settings.rs), so a JSON number anywhere in the map
  // fails serde for the WHOLE call. All five keys go in one batch, so saving the sound
  // toggle or a threshold failed too -- not just density -- and the user got the
  // settings-save-error toast. TypeScript caught it; the test suite would not have.

  it('sends every KDS setting as a string, and all five keys in one batch', async () => {
    renderCard();
    await new Promise((r) => setTimeout(r, 10));

    const t = document.getElementById('kds-auto-ack') as HTMLInputElement;
    fireEvent.click(t);
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(setSettingsScoped).toHaveBeenCalled());

    const [token, entries] = vi.mocked(setSettingsScoped).mock.calls[0]!;
    expect(token).toBe('test-token');
    expect(Object.keys(entries!).sort()).toEqual([
      'kds.auto_acknowledge', 'kds.density', 'kds.red_threshold_min',
      'kds.sound_enabled', 'kds.yellow_threshold_min',
    ]);
    // The contract with the Rust command, asserted rather than left to the compiler:
    // one non-string value rejects the entire batch at deserialisation.
    for (const [k, v] of Object.entries(entries!)) {
      expect(typeof v, `${k} must be serialised as a string`).toBe('string');
    }
    expect(entries!['kds.density']).toBe('3');
  });

  it('persists a changed column count as its string form, not a bare number', async () => {
    renderCard();
    await new Promise((r) => setTimeout(r, 10));

    const sel = document.getElementById('kds-density') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: '5' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled());
    vi.mocked(setSettingsScoped).mockClear();
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(setSettingsScoped).toHaveBeenCalled());

    const [, entries] = vi.mocked(setSettingsScoped).mock.calls[0]!;
    // Regression pin for the exact line that broke: '3' not 3, so serde accepts it.
    expect(entries!['kds.density']).toBe('5');
  });

  it('keeps a toggle made before the settings load lands (no draft-overwrite race)', async () => {
    let releaseLoad!: (v: string | null) => void;
    // Gate the first getSetting call (kds.sound_enabled) so the whole load
    // stays in flight; the remaining four calls resolve via the default
    // mock (null). Releasing it as 'false' makes the *untouched* sound
    // toggle flip only once the load actually lands — our landing signal.
    vi.mocked(getSettingScoped).mockImplementationOnce(
      () => new Promise<string | null>((resolve) => { releaseLoad = resolve; }),
    );

    renderCard();
    const toggle = document.getElementById('kds-auto-ack') as HTMLInputElement;
    // Edit while the load is still in flight.
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);

    // Let the load land: the untouched sound toggle (persisted 'false')
    // flips to unchecked — proving the loaded values were applied.
    releaseLoad('false');
    const sound = document.getElementById('kds-sound') as HTMLInputElement;
    await waitFor(() => expect(sound.checked).toBe(false));

    // The user's auto-ack toggle must NOT have been reverted by the load.
    expect(toggle.checked).toBe(true);
  });

  it('hides Save button in inspector-drawer variant', () => {
    renderCard({ variant: 'inspector-drawer' });
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  // ── soundEnabled independence from font smoothing ───────────
  // soundEnabled must NOT be derived from fontSmoothing — those
  // are orthogonal concerns. When fontSmoothing='subpixel' the
  // sound toggle should still default to true.

  it('sound toggle is checked when fontSmoothing is subpixel', () => {
    mocks.fontSmoothing = 'subpixel';
    renderCard();
    const t = document.getElementById('kds-sound') as HTMLInputElement;
    expect(t.checked).toBe(true);
  });

  // ── Boundary values ─────────────────────────────────────────

  it('yellow threshold slider has min=3', () => {
    renderCard();
    const slider = screen.getByLabelText('Yellow escalation threshold in minutes') as HTMLInputElement;
    expect(Number(slider.min)).toBe(3);
    expect(Number(slider.max)).toBe(10);
  });

  it('red threshold slider min depends on yellow threshold + 1', () => {
    // Yellow starts at 5, so red min = max(5+1, 6) = 6
    renderCard();
    const slider = screen.getByLabelText('Red escalation threshold in minutes') as HTMLInputElement;
    expect(Number(slider.min)).toBe(6);
    expect(Number(slider.max)).toBe(15);
  });
});
