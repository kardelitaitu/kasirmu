// ── TerminalPreferencesCard tests ──────────────────────────────────
//
// Covers: sound volume slider, dark mode toggle, scale auto-zero toggle,
// dirty tracking (Save disabled when clean, enabled when dirty),
// Save button hidden in inspector-drawer, Save flow calls
// useTerminalHardware.save + onSaved.
//
// ADR #22 Phase 1 testing gate (§9).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode, ReactElement } from 'react';
import { LocalizationProvider } from '@fluent/react';
import { ToastProvider } from '@/components/Toast';
import { WorkspaceContext, type WorkspaceContextValue } from '@/contexts/WorkspaceContext';
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
      'settings-edc-default-select': 'Register Default EDC Terminal',
      'settings-edc-default-auto': 'Auto (Earliest Created)',
      'settings-edc-test': 'Test Connection',
      'settings-edc-testing': 'Testing…',
      'save': 'Save',
    };
    return defaults[id] ?? id;
  },
  reportError: () => {},
  getBundle: () => null,
  getChildren: (str: string) => str,
};

// ── Mock state ──────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  localPrefs: {
    soundVolume: 80,
    darkMode: false,
    scaleAutoZero: true,
    defaultEdcTerminalId: '',
  },
  hwError: null as string | null,
  // Controllable so the F4 case can simulate a FAILED profile read, where
  // `profile` is a default rather than the terminal's real config.
  hwLoadFailed: false,
}));

// Stable profile object — must NOT create a new reference on each
// render hook call, otherwise the component's useEffect([hw.profile])
// fires on every render and resets originalsRef + draft state.
const stableProfile = {
  terminalId: 'term-1',
  storeId: 'store-1',
  hardware: {
    printer: { connection: 'auto' as const, devicePath: '', paperSize: '80' as const, testPrintIp: '' },
    scale: { connection: 'none' as const, devicePath: '', baudRate: 9600, zeroOnBoot: false },
    scanner: { mode: 'auto' as const, deviceId: '' },
  },
  get localPrefs() { return { ...mocks.localPrefs }; },
  initialized: '2026-01-01T00:00:00Z',
  version: 1,
};

// ── useTerminalHardware mock ────────────────────────────────────────

vi.mock('@/hooks/useTerminalHardware', () => ({
  useTerminalHardware: (terminalId: string) => {
    if (!terminalId) return {
      profile: null, isLoading: false, error: mocks.hwError,
      loadFailed: mocks.hwLoadFailed,
      updatePrinter: vi.fn(), updateScale: vi.fn(), updateScanner: vi.fn(),
      updateLocalPrefs: vi.fn(), save: vi.fn(), reload: vi.fn(),
    };

    return {
      profile: stableProfile,
      isLoading: false,
      error: mocks.hwError,
      loadFailed: mocks.hwLoadFailed,
      updatePrinter: vi.fn(),
      updateScale: vi.fn(),
      updateScanner: vi.fn(),
      updateLocalPrefs: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn(),
    };
  },
}));

vi.mock('@/api/edc', () => ({
  listEdcTerminalsScoped: vi.fn().mockResolvedValue([
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
  ]),
  edcTerminalStatusScoped: vi.fn().mockResolvedValue({
    terminal_id: 'term_lane_1',
    state: 'ready',
    battery_pct: null,
    last_seen_secs: 0,
  }),
}));

// ── Helpers ─────────────────────────────────────────────────────────

const mockWorkspaceValue: WorkspaceContextValue = {
  activeWorkspace: 'pos',
  setActiveWorkspace: vi.fn(),
  activeInstance: null,
  setActiveInstance: vi.fn(),
  availableWorkspaces: [],
  workspaceScreens: [],
  loading: false,
  error: null,
  retry: vi.fn(),
  lastWorkspace: null,
  switchStore: vi.fn(),
  resolvedStoreId: 'store-1',
  sessionToken: 'test-session-token',
  terminalId: 'term-1',
  swapSessionToken: vi.fn(),
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <LocalizationProvider l10n={testL10n}>
      <ToastProvider>
        <WorkspaceContext.Provider value={mockWorkspaceValue}>
          {children}
        </WorkspaceContext.Provider>
      </ToastProvider>
    </LocalizationProvider>
  );
}

function renderCard(overrides: Record<string, unknown> = {}) {
  return render(
    <Wrapper>
      <TerminalPreferencesCard
        terminalId="term-1"
        variant="full-page"
        onSaved={vi.fn()}
        {...overrides}
      />
    </Wrapper>,
  );
}

beforeEach(() => {
  Object.assign(mocks.localPrefs, { soundVolume: 80, darkMode: false, scaleAutoZero: true, defaultEdcTerminalId: '' });
  mocks.hwError = null;
  mocks.hwLoadFailed = false;
});

// ── Tests ───────────────────────────────────────────────────────────

describe('TerminalPreferencesCard', () => {
  // ── Rendering ────────────────────────────────────────────────

  it('renders heading', () => {
    renderCard();
    expect(screen.getByText('Terminal Preferences')).toBeInTheDocument();
  });

  it('renders sound volume slider with initial value', () => {
    renderCard();
    const slider = screen.getByLabelText('Sound volume') as HTMLInputElement;
    expect(slider.type).toBe('range');
    expect(Number(slider.value)).toBe(80);
  });

  it('shows sound volume percentage label when not compact', () => {
    renderCard({ variant: 'full-page' });
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('renders dark mode toggle unchecked initially', () => {
    renderCard();
    const toggle = document.getElementById('term-dark-mode') as HTMLInputElement;
    expect(toggle).not.toBeNull();
    expect(toggle.checked).toBe(false);
  });

  it('renders scale auto-zero toggle checked initially', () => {
    renderCard();
    const toggle = document.getElementById('term-scale-zero') as HTMLInputElement;
    expect(toggle).not.toBeNull();
    expect(toggle.checked).toBe(true);
  });

  // ── Dirty tracking ───────────────────────────────────────────
  //
  // TerminalPreferencesCard initialises originalsRef with the current
  // state values (not empty), so dirty is false on first render.
  // No waitFor for originals loading is needed here (unlike
  // WorkspaceStorePosSettings which starts with empty originalsRef).

  it('Save button is disabled when no changes (not dirty)', () => {
    renderCard();
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn).toBeDisabled();
  });

  it('Save button becomes enabled after changing sound volume', async () => {
    renderCard();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();

    const slider = screen.getByLabelText('Sound volume');
    fireEvent.change(slider, { target: { value: '50' } });

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /save/i });
      expect(btn).not.toBeDisabled();
    });
  });

  it('keeps Save disabled after a FAILED profile read, even once the user edits (F4)', async () => {
    // `hw.profile` is a DEFAULT when the read failed, so the baseline this card
    // compares against is not the terminal's real config.
    //
    // The discriminating property is the EDIT: on the buggy path `dirty` is false
    // so Save is disabled either way, and the banner renders from `hw.loadFailed`
    // independently. Asserting only "disabled" passes on the bug.
    mocks.hwLoadFailed = true;

    renderCard();

    expect(screen.getByTestId('terminal-prefs-load-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();

    // Now edit. On the bug this sets dirty=true and re-enables Save.
    fireEvent.change(screen.getByLabelText('Sound volume'), { target: { value: '50' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });
  });

  // ── Variants ─────────────────────────────────────────────────

  it('hides Save button in inspector-drawer variant', () => {
    renderCard({ variant: 'inspector-drawer' });
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('hides percentage label in inspector-drawer variant', () => {
    renderCard({ variant: 'inspector-drawer' });
    expect(screen.queryByText('80%')).not.toBeInTheDocument();
  });

  // ── Save flow ────────────────────────────────────────────────

  it('calls onSaved after successful save', async () => {
    const onSaved = vi.fn();
    renderCard({ onSaved });

    // Change sound volume to make dirty
    const slider = screen.getByLabelText('Sound volume');
    fireEvent.change(slider, { target: { value: '50' } });

    // Wait for button to enable
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    });

    // Click save
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
  });

  // ── Error display ───────────────────────────────────────────
  // When hw.error is non-null the card must show an error banner
  // so the user knows the last operation failed.

  it('displays error message when hw.error is set', () => {
    mocks.hwError = 'Save failed: connection timeout';
    renderCard();
    const banners = screen.getAllByRole('alert');
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent(/Save failed/i);
  });

  // ── Scale auto-zero toggle ───────────────────────────────────

  it('toggles scale auto-zero off and back on', async () => {
    renderCard();
    const toggle = document.getElementById('term-scale-zero') as HTMLInputElement;

    // Click to toggle off
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(toggle.checked).toBe(false);
    });

    // Click to toggle back on
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(toggle.checked).toBe(true);
    });
  });

  // ── Edge case: revert to original ───────────────────────────

  it('revert sound volume to original disables Save again', async () => {
    renderCard();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();

    // Change volume
    const slider = screen.getByLabelText('Sound volume');
    fireEvent.change(slider, { target: { value: '50' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    });

    // Revert back to original
    fireEvent.change(slider, { target: { value: '80' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });
  });

  // ── Default EDC terminal ─────────────────────────────────────

  it('renders default EDC terminal select with initial value', () => {
    renderCard();
    const select = document.getElementById('term-edc-default') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('');
  });

  it('changing default EDC terminal enables Save button', async () => {
    renderCard();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();

    await waitFor(() => {
      expect(screen.getByText(/Counter Lane 1/i)).toBeInTheDocument();
    });

    const select = document.getElementById('term-edc-default') as HTMLSelectElement;
    select.value = 'term_lane_1';
    fireEvent.change(select, { target: { value: 'term_lane_1' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    });
  });

  it('reverting default EDC terminal disables Save button', async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByText(/Counter Lane 1/i)).toBeInTheDocument();
    });

    const select = document.getElementById('term-edc-default') as HTMLSelectElement;
    select.value = 'term_lane_1';
    fireEvent.change(select, { target: { value: 'term_lane_1' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    });

    select.value = '';
    fireEvent.change(select, { target: { value: '' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });
  });
});
