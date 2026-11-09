// ── WorkspaceTerminalPreferencesCard tests ─────────────────────────
//
// Covers: terminal prefs form rendering (sound, dark mode, scale),
// dirty tracking, save flow (calls useTerminalHardware.save + onSaved),
// variant='inspector-drawer' hides footer + save button,
// Save button disabled when not dirty.
//
// ADR #22 Phase 1 testing gate (§9).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode, ReactElement } from 'react';
import { LocalizationProvider } from '@fluent/react';
import { TerminalPreferencesCard } from '@/features/settings/workspace-cards/TerminalPreferencesCard';

// ── Fluent test l10n ───────────────────────────────────────────────

const testL10n = {
  bundles: [],
  areBundlesEmpty: () => true,
  parseMarkup: (str: string) => [{ nodeName: '#text', textContent: str } as unknown as Node],
  getElement: (sourceElement: ReactElement) => sourceElement,
  getString: (id: string) => {
    const defaults: Record<string, string> = {
      'workspace-terminal-prefs-heading': 'Terminal Preferences',
      'workspace-terminal-sound': 'Sound Volume',
      'workspace-terminal-dark-mode': 'Dark Mode',
      'workspace-terminal-scale-zero': 'Auto-Zero Scale on Boot',
      'terminal-sound-volume-aria': 'Sound volume',
      'save': 'Save',
      'settings-save-error': 'Save failed',
      // The EDC test/default controls and the load-error line. No case in this
      // file asserts them, so their absence was silent: getString fell through to
      // the raw id and the card rendered 'settings-edc-test' to the user.
      // Values copied verbatim from shared-ui/locales/settings.ftl.
      'settings-edc-test': 'Test Connection',
      'settings-edc-testing': 'Testing…',
      'settings-edc-default-select': 'Register Default EDC Terminal',
      'settings-edc-default-auto': 'Auto (Earliest Created)',
      'settings-load-failed': 'Failed to load settings',
    };
    return defaults[id] ?? id;
  },
  reportError: () => {},
  getBundle: () => null,
  getChildren: (str: string) => str,
};

// ── Mock state ──────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  hw: {
    profile: {
      localPrefs: {
        soundVolume: 80,
        darkMode: false,
        scaleAutoZero: true,
      },
      hardware: {
        printer: { connection: 'auto', devicePath: '', paperSize: '80' },
        scanner: { mode: 'auto', deviceId: '' },
        kitchenPrinter: { connection: 'disabled', devicePath: '' },
      },
      schemaVersion: 1,
    },
    save: vi.fn(),
    updateLocalPrefs: vi.fn(),
    error: null as string | null,
  },
}));

vi.mock('@/hooks/useTerminalHardware', () => ({
  useTerminalHardware: () => mocks.hw,
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

// ── Wrapper ─────────────────────────────────────────────────────────

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <LocalizationProvider l10n={testL10n as unknown as React.ComponentProps<typeof LocalizationProvider>['l10n']}>
      {children}
    </LocalizationProvider>
  );
}

function renderCard(overrides: Record<string, unknown> = {}) {
  return render(
    <Wrapper>
      <TerminalPreferencesCard
        terminalId="term-001"
        userId="user-001"
        variant="full-page"
        {...overrides}
      />
    </Wrapper>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────

describe('TerminalPreferencesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all three preference fields', async () => {
    renderCard();
    expect(screen.getByText('Sound Volume')).toBeInTheDocument();
    expect(screen.getByText('Dark Mode')).toBeInTheDocument();
    expect(screen.getByText('Auto-Zero Scale on Boot')).toBeInTheDocument();
  });

  it('sound volume slider reflects profile value', () => {
    renderCard();
    const slider = screen.getByRole('slider', { name: /sound volume/i });
    expect(slider).toHaveValue('80');
  });

  it('dark mode toggle reflects profile value', () => {
    renderCard();
    const toggle = screen.getByRole('switch', { name: /dark mode/i });
    expect(toggle).not.toBeChecked();
  });

  it('scale auto-zero toggle reflects profile value', () => {
    renderCard();
    const toggle = screen.getByRole('switch', { name: /auto-zero/i });
    expect(toggle).toBeChecked();
  });

  it('updates localPrefs when sound volume slider changes', () => {
    renderCard();
    const slider = screen.getByRole('slider', { name: /sound volume/i });
    fireEvent.change(slider, { target: { value: '60' } });
    expect(mocks.hw.updateLocalPrefs).toHaveBeenCalledWith({ soundVolume: 60 });
  });

  it('updates localPrefs when dark mode toggle is clicked', () => {
    renderCard();
    const toggle = screen.getByRole('switch', { name: /dark mode/i });
    fireEvent.click(toggle);
    expect(mocks.hw.updateLocalPrefs).toHaveBeenCalledWith({ darkMode: true });
  });

  it('updates localPrefs when scale auto-zero toggle is clicked', () => {
    renderCard();
    const toggle = screen.getByRole('switch', { name: /auto-zero/i });
    fireEvent.click(toggle);
    expect(mocks.hw.updateLocalPrefs).toHaveBeenCalledWith({ scaleAutoZero: false });
  });

  it('save button is disabled when card initially loads (no changes)', () => {
    renderCard();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('save button becomes enabled after changing a field', () => {
    renderCard();
    const slider = screen.getByRole('slider', { name: /sound volume/i });
    fireEvent.change(slider, { target: { value: '60' } });
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
  });

  it('save button becomes disabled again after saving with no further changes', async () => {
    mocks.hw.save.mockResolvedValue(undefined);
    renderCard();

    // Make a change to enable save
    const slider = screen.getByRole('slider', { name: /sound volume/i });
    fireEvent.change(slider, { target: { value: '60' } });
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();

    // Save
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });
  });

  it('calls hw.save and onSaved on successful save', async () => {
    mocks.hw.save.mockResolvedValue(undefined);
    const onSaved = vi.fn();

    renderCard({ onSaved });

    // Make a change first
    const toggle = screen.getByRole('switch', { name: /dark mode/i });
    fireEvent.click(toggle);

    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      // Asserted with NO arguments on purpose: `toHaveBeenCalledWith()` fails if the card hands
      // anything to the save path, which is the point of T11 -- the renderer stopped naming the
      // actor a permission check asks about. `toHaveBeenCalled()` would have passed either way.
      expect(mocks.hw.save).toHaveBeenCalledWith();
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it('hides save button in inspector-drawer variant', () => {
    renderCard({ variant: 'inspector-drawer' });
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('shows error banner when hw.error is set', () => {
    mocks.hw.error = 'Printer not found';
    renderCard();
    expect(screen.getByText('Printer not found')).toBeInTheDocument();
  });

  // The three cases below pin copy that nothing asserted before, which is exactly
  // why the map could drop it without a single test going red: the card rendered
  // 'settings-edc-test' and 'settings-edc-default-auto' as visible text and as an
  // aria-label, and every assertion in this file looked elsewhere.
  // NB: the Test Connection button and the load-error banner are both gated
  // (sessionToken is not passed here; hw.loadFailed is false), so no case in this
  // file can reach them. The select below is unconditional, which is why it is the
  // one that carries the regression guard for the EDC labels.

  it('gives the default-terminal select its aria-label and auto option in English', () => {
    renderCard();
    const select = screen.getByLabelText('Register Default EDC Terminal');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Auto (Earliest Created)' })).toBeInTheDocument();
  });
});
