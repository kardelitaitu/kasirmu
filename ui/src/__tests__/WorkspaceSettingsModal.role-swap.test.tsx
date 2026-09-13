// ── WorkspaceSettingsModal role-swap tests ────────────────────────
//
// ADR #22 §9 integration test: "WorkspaceSettingsModal role-swap:
// Manager → Staff session timeout mid-modal". Verifies the modal
// reactively switches from full workspace card to TerminalPreferencesCard
// when the auth session changes role.
//
// Appended to the existing WorkspaceSettingsModal test suite.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode, ReactElement } from 'react';
import { LocalizationProvider } from '@fluent/react';
import { SettingsProvider } from '@/contexts/SettingsContext';
import WorkspaceSettingsModal from '@/features/settings/WorkspaceSettingsModal';

// ── Hoisted mock state ────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  manager: true,
}));

// ── WorkspaceContext mock (required by SettingsProvider) ──────────

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: 'test-token-123',
    activeWorkspace: 'store-pos',
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
    resolvedStoreId: 'default',
    swapSessionToken: vi.fn(),
  }),
}));

// ── AuthContext mock ──────────────────────────────────────────────

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: {
      user_id: 'user-1', username: 'testuser',      role_name: mocks.manager ? 'manager' : 'staff',
      token: 'tok-123',
      role_id: 'role-1',
      display_name: mocks.manager ? 'Manager Test' : 'Staff Test',
    },
    loading: false, error: null,
    login: vi.fn(), logout: vi.fn(), clearError: vi.fn(),
    isManager: mocks.manager,
    isOwner: false,
  }),
}));

// ── Workspace card stubs ──────────────────────────────────────────

vi.mock('@/features/settings/workspace-cards', () => ({
  WorkspaceStorePosSettings: () => <div data-testid="card-store-pos">Store POS Card</div>,
  WorkspaceRestaurantPosSettings: () => <div data-testid="card-restaurant-pos">Restaurant POS</div>,
  WorkspaceKdsSettings: () => <div data-testid="card-kds">KDS</div>,
  WorkspaceInventorySettings: () => <div data-testid="card-inventory">Inventory</div>,
  TerminalPreferencesCard: () => <div data-testid="card-terminal-prefs">Terminal Preferences</div>,
}));

vi.mock('@/features/settings/nestedModalDepth', () => ({
  getNestedDepth: () => 0,
  onNestedDepthChange: () => () => {},
}));

let exitShouldRender = true;
vi.mock('@/hooks/useExitAnimation', () => ({
  useExitAnimation: (_open: boolean, onClose: () => void, _duration: number) => ({
    shouldRender: exitShouldRender, exiting: false, requestClose: onClose,
  }),
}));

vi.mock('@/hooks/useFocusTrap', () => ({ useFocusTrap: vi.fn() }));
vi.mock('@/components/ErrorBoundary', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  once: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
  emitTo: vi.fn(() => Promise.resolve()),
}));

// ── API mocks for SettingsContext ────────────────────────────────

vi.mock('@/api/settings', () => ({
  getReceiptSettingsScoped: vi.fn(() => Promise.resolve({ showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '', paperWidth: 'standard', showTableNumber: false, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 })),
  getStoreSettingsScoped: vi.fn(() => Promise.resolve({ name: '', address: '', taxId: '', currency: 'IDR', branch: '' })),
  getUserPreferencesScoped: vi.fn(() => Promise.resolve({ cardsize: '2', fontsize: '1', 'font-smoothing': 'antialiased' })),
  // SettingsProvider subscribes via this wrapper (ui/src/api/settings.ts);
  // this test does not exercise the event bus — resolve to a no-op unlisten.
  onSettingsUpdated: vi.fn(() => Promise.resolve(async () => {})),
}));
vi.mock('@/api/offline', () => ({ getSyncSettingsScoped: vi.fn(() => Promise.resolve({ serverUrl: null, hasApiKey: false, enabled: false })) }));
vi.mock('@/api/currency', () => ({ listCurrenciesScoped: vi.fn(() => Promise.resolve([{ code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' }])) }));
vi.mock('@/api/branding', () => ({ getBrandSettingsScoped: vi.fn(() => Promise.resolve({ primary_colour: '#147EFB', logo_path: null, store_name: '' })) }));
vi.mock('@/api/system', () => ({ getVersionScoped: vi.fn(() => Promise.resolve({ name: 'oz-pos', version: '0.0.19', rustVersion: '1.80', target: 'x86_64' })) }));

// ── Minimal Fluent l10n ─────────────────────────────────────────

const testL10n = {
  bundles: [], areBundlesEmpty: () => true,
  parseMarkup: (str: string) => [{ nodeName: '#text', textContent: str } as unknown as Node],
  getElement: (sourceElement: ReactElement) => sourceElement,
  getString: (id: string) => {
    const defaults: Record<string, string> = {
      'workspace-modal-title': 'Workspace Settings',
      'workspace-modal-admin-settings': 'Admin Settings',
      'workspace-modal-role-manager': 'Manager',
      'workspace-modal-role-staff': 'Staff',
      'workspace-modal-role-auditor': 'Auditor',
    };
    return defaults[id] ?? id;
  },
  reportError: () => {}, getBundle: () => null, getChildren: (str: string) => str,
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <LocalizationProvider l10n={testL10n}>
      <SettingsProvider>{children}</SettingsProvider>
    </LocalizationProvider>
  );
}

beforeEach(() => {
  mocks.manager = true;
  exitShouldRender = true;
});

afterEach(() => {
  // mocks.manager reset is handled by beforeEach
});

// ── Tests ────────────────────────────────────────────────────────

describe('WorkspaceSettingsModal role-swap', () => {
  it('shows Store POS card for manager initially', async () => {
    mocks.manager = true;
    render(
      <Wrapper>
        <WorkspaceSettingsModal open={true} onClose={vi.fn()} workspaceType="store-pos" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('card-store-pos')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-terminal-prefs')).not.toBeInTheDocument();
  });

  it('switches to TerminalPreferencesCard when session downgrades to Staff', async () => {
    mocks.manager = true;
    const { rerender } = render(
      <Wrapper>
        <WorkspaceSettingsModal open={true} onClose={vi.fn()} workspaceType="store-pos" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('card-store-pos')).toBeInTheDocument();
    });

    // Simulate session timeout: Manager → Staff
    mocks.manager = false;

    // Re-render with updated auth context
    rerender(
      <Wrapper>
        <WorkspaceSettingsModal open={true} onClose={vi.fn()} workspaceType="store-pos" />
      </Wrapper>,
    );

    // Modal should reactively swap to TerminalPreferencesCard
    await waitFor(() => {
      expect(screen.getByTestId('card-terminal-prefs')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-store-pos')).not.toBeInTheDocument();
  });

  it('hides Admin Settings button after role downgrade', async () => {
    mocks.manager = true;
    const { rerender } = render(
      <Wrapper>
        <WorkspaceSettingsModal open={true} onClose={vi.fn()} workspaceType="store-pos" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Admin Settings')).toBeInTheDocument();
    });

    mocks.manager = false;
    rerender(
      <Wrapper>
        <WorkspaceSettingsModal open={true} onClose={vi.fn()} workspaceType="store-pos" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.queryByText('Admin Settings')).not.toBeInTheDocument();
    });
  });
});
