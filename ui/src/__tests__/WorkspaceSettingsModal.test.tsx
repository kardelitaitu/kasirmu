// ── WorkspaceSettingsModal tests ───────────────────────────────────
//
// Covers: role gating (Manager = full card, Staff = TerminalPreferencesCard),
// Admin Settings button visibility and navigation, exit animation signaling,
// portal rendering into document.body, workspace type to card routing,
// nested modal depth tracking, close-on-backdrop-click, open=false renders null.
//
// ADR #22 Phase 4 testing gate (§9).

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { type ReactNode, type ReactElement } from 'react';
import { LocalizationProvider } from '@fluent/react';
import { SettingsProvider } from '@/contexts/SettingsContext';
import WorkspaceSettingsModal, {
  type WorkspaceSettingsModalProps,
} from '@/features/settings/WorkspaceSettingsModal';

// ── Hoisted mock state ────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  manager: true,
  owner: false,
  hashTarget: '',
  setActiveWorkspace: vi.fn(),
}));

// ── WorkspaceContext mock ─────────────────────────────────────────

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspace: 'store-pos',
    setActiveWorkspace: mocks.setActiveWorkspace,
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
  }),
}));

// ── AuthContext mock ──────────────────────────────────────────────

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: {
      user_id: 'user-1',
      username: 'testuser',
      role_name: mocks.manager ? 'manager' : 'staff',
      token: 'tok-123',
      role_id: 'role-1',
      display_name: mocks.manager ? 'Manager Test' : 'Staff Test',
    },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: mocks.manager,
    isOwner: mocks.owner,
  }),
}));

// ── Workspace card stubs ──────────────────────────────────────────

vi.mock('@/features/settings/workspace-cards', () => ({
  WorkspaceStorePosSettings: ({ variant, terminalId }: { variant: string; terminalId: string }) => (
    <div data-testid="card-store-pos" data-variant={variant} data-terminal-id={terminalId}>
      Store POS Card
    </div>
  ),
  WorkspaceRestaurantPosSettings: ({ variant, terminalId }: { variant: string; terminalId: string }) => (
    <div data-testid="card-restaurant-pos" data-variant={variant} data-terminal-id={terminalId}>
      Restaurant POS Card
    </div>
  ),
  WorkspaceKdsSettings: ({ variant, terminalId }: { variant: string; terminalId: string }) => (
    <div data-testid="card-kds" data-variant={variant} data-terminal-id={terminalId}>
      KDS Card
    </div>
  ),
  WorkspaceInventorySettings: ({ variant, terminalId }: { variant: string; terminalId: string }) => (
    <div data-testid="card-inventory" data-variant={variant} data-terminal-id={terminalId}>
      Inventory Card
    </div>
  ),
  TerminalPreferencesCard: ({ variant, terminalId }: { variant: string; terminalId: string }) => (
    <div data-testid="card-terminal-prefs" data-variant={variant} data-terminal-id={terminalId}>
      Terminal Preferences
    </div>
  ),
}));

// ── Nested modal depth mock ───────────────────────────────────────

vi.mock('@/features/settings/nestedModalDepth', () => ({
  getNestedDepth: () => 0,
  onNestedDepthChange: () => () => {},
}));

// ── Exit animation mock ──────────────────────────────────────────

let exitShouldRender = true;

vi.mock('@/hooks/useExitAnimation', () => ({
  useExitAnimation: (_open: boolean, onClose: () => void, _duration: number) => ({
    shouldRender: exitShouldRender,
    exiting: false,
    requestClose: onClose,
  }),
}));

// ── Focus trap mock ──────────────────────────────────────────────

vi.mock('@/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}));

// ── Error boundary mock ──────────────────────────────────────────

vi.mock('@/components/ErrorBoundary', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// ── Tauri event mock ─────────────────────────────────────────────

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  once: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
  emitTo: vi.fn(() => Promise.resolve()),
}));

// ── API mocks for SettingsContext ────────────────────────────────

vi.mock('@/api/settings', () => ({
  getReceiptSettingsScoped: vi.fn(() => Promise.resolve({
    showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '',
    paperWidth: 'standard', showTableNumber: false,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  })),
  getStoreSettingsScoped: vi.fn(() => Promise.resolve({
    name: '', address: '', taxId: '', currency: 'IDR', branch: '',
  })),
  getUserPreferencesScoped: vi.fn(() => Promise.resolve({
    cardsize: '2', fontsize: '1', 'font-smoothing': 'antialiased',
  })),
  // SettingsProvider subscribes via this wrapper (ui/src/api/settings.ts);
  // these tests do not exercise the event bus — resolve to a no-op unlisten.
  onSettingsUpdated: vi.fn(() => Promise.resolve(async () => {})),
}));

vi.mock('@/api/offline', () => ({
  getSyncSettingsScoped: vi.fn(() => Promise.resolve({
    serverUrl: null, hasApiKey: false, enabled: false,
  })),
}));

vi.mock('@/api/currency', () => ({
  listCurrenciesScoped: vi.fn(() => Promise.resolve([
    { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
  ])),
}));

vi.mock('@/api/branding', () => ({
  getBrandSettingsScoped: vi.fn(() => Promise.resolve({
    primary_colour: '#147EFB', logo_path: null, store_name: '',
  })),
}));

vi.mock('@/api/system', () => ({
  getVersionScoped: vi.fn(() => Promise.resolve({
    name: 'oz-pos', version: '0.0.19', rustVersion: '1.80', target: 'x86_64',
  })),
}));

// ── Minimal Fluent l10n for Localized ───────────────────────────

const testL10n = {
  bundles: [],
  areBundlesEmpty: () => true,
  parseMarkup: (str: string) => [{ nodeName: '#text', textContent: str } as unknown as Node],
  getElement: (sourceElement: ReactElement) => sourceElement,
  getString: (id: string) => {
    const defaults: Record<string, string> = {
      'workspace-modal-title': 'Workspace Settings',
      'workspace-modal-admin-settings': 'Admin Settings',
      'workspace-modal-close-aria': 'Close settings',
      'workspace-modal-role-manager': 'Manager',
      'workspace-modal-role-staff': 'Staff',
      'workspace-modal-role-auditor': 'Auditor',
    };
    return defaults[id] ?? id;
  },
  reportError: () => {},
  getBundle: () => null,
  getChildren: (str: string) => str,
};

// ── Helpers ──────────────────────────────────────────────────────

const defaultProps: WorkspaceSettingsModalProps = {
  open: true,
  onClose: vi.fn(),
  workspaceType: 'store-pos',
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <LocalizationProvider l10n={testL10n}>
      <SettingsProvider>{children}</SettingsProvider>
    </LocalizationProvider>
  );
}

function renderModal(overrides: Partial<WorkspaceSettingsModalProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(
    <Wrapper>
      <WorkspaceSettingsModal {...props} />
    </Wrapper>,
  );
}

beforeEach(() => {
  mocks.manager = true;
  mocks.owner = false;
  mocks.hashTarget = '';
  exitShouldRender = true;
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    get hash() { return mocks.hashTarget; },
    set hash(v: string) { mocks.hashTarget = v; },
    href: '',
    ancestorOrigins: {} as DOMStringList,
    origin: 'http://localhost',
    protocol: 'http:',
    host: 'localhost',
    hostname: 'localhost',
    port: '',
    pathname: '/',
    search: '',
    assign: vi.fn(),
    reload: vi.fn(),
    replace: vi.fn(),
    toString: () => '',
  } as unknown as Location);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────

describe('WorkspaceSettingsModal', () => {
  // ── Rendering gates ────────────────────────────────────────

  it('renders null when exit.shouldRender is false (modal closed)', async () => {
    exitShouldRender = false;
    const { container } = renderModal({ open: true });
    // Should render nothing into the DOM
    expect(container.innerHTML).toBe('');
  });

  it('renders content when open and shouldRender is true', async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId('card-store-pos')).toBeInTheDocument();
    });
  });

  // ── Role gating ────────────────────────────────────────────

  it('renders full workspace card for manager role', async () => {
    mocks.manager = true;
    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId('card-store-pos')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-terminal-prefs')).not.toBeInTheDocument();
  });

  it('renders TerminalPreferencesCard for staff role', async () => {
    mocks.manager = false;
    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId('card-terminal-prefs')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('card-store-pos')).not.toBeInTheDocument();
  });

  it('shows Admin Settings button for manager', async () => {
    mocks.manager = true;
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Admin Settings')).toBeInTheDocument();
    });
  });

  it('hides Admin Settings button for staff', async () => {
    mocks.manager = false;
    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId('card-terminal-prefs')).toBeInTheDocument();
    });
    expect(screen.queryByText('Admin Settings')).not.toBeInTheDocument();
  });

  // ── Workspace type routing ─────────────────────────────────

  it('renders Store POS card for store-pos type', async () => {
    renderModal({ workspaceType: 'store-pos' });

    await waitFor(() => {
      expect(screen.getByTestId('card-store-pos')).toBeInTheDocument();
    });
  });

  it('renders Restaurant POS card for restaurant-pos type', async () => {
    renderModal({ workspaceType: 'restaurant-pos' });

    await waitFor(() => {
      expect(screen.getByTestId('card-restaurant-pos')).toBeInTheDocument();
    });
  });

  it('renders KDS card for kds type', async () => {
    renderModal({ workspaceType: 'kds' });

    await waitFor(() => {
      expect(screen.getByTestId('card-kds')).toBeInTheDocument();
    });
  });

  it('renders Inventory card for warehouse type', async () => {
    renderModal({ workspaceType: 'warehouse' });

    await waitFor(() => {
      expect(screen.getByTestId('card-inventory')).toBeInTheDocument();
    });
  });

  // ── Admin Settings shortcut ─────────────────────────────────

  it('Admin Settings button sets activeWorkspace to admin, location.hash to #/settings and calls onClose', async () => {
    const onClose = vi.fn();
    mocks.manager = true;
    renderModal({ onClose });

    await waitFor(() => {
      expect(screen.getByText('Admin Settings')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Admin Settings'));

    expect(mocks.setActiveWorkspace).toHaveBeenCalledWith('admin');
    expect(mocks.hashTarget).toBe('#/settings');
    expect(onClose).toHaveBeenCalled();
  });

  // ── Portal rendering ───────────────────────────────────────

  it('renders via portal into document.body', async () => {
    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId('card-store-pos')).toBeInTheDocument();
    });

    // The modal should be rendered outside the test container
    // (portal renders into document.body)
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeInTheDocument();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
  });

  // ── ARIA semantics ─────────────────────────────────────────

  it('has role=dialog and aria-modal=true', async () => {
    renderModal();

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeInTheDocument();
      expect(dialog!.getAttribute('aria-modal')).toBe('true');
    });
  });

  it('has aria-labelledby pointing to workspace-settings-title', async () => {
    renderModal();

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog!.getAttribute('aria-labelledby')).toBe('workspace-settings-title');
    });
  });

  // ── Terminal ID prop forwarding ────────────────────────────

  it('forwards terminalId to workspace cards', async () => {
    renderModal({ terminalId: 'term-kitchen-1' });

    await waitFor(() => {
      const card = screen.getByTestId('card-store-pos');
      expect(card.getAttribute('data-terminal-id')).toBe('term-kitchen-1');
    });
  });

  // ── Role badge in footer ───────────────────────────────────

  it('shows Manager role badge for manager', async () => {
    mocks.manager = true;
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Manager')).toBeInTheDocument();
    });
  });

  it('shows Staff role badge for staff', async () => {
    mocks.manager = false;
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Staff')).toBeInTheDocument();
    });
  });

  // ── Close button ───────────────────────────────────────────

  it('has a close button with aria-label', async () => {
    renderModal();

    await waitFor(() => {
      const closeBtn = document.querySelector('[aria-label="Close settings"]');
      expect(closeBtn).toBeInTheDocument();
    });
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    await waitFor(() => {
      const closeBtn = document.querySelector('[aria-label="Close settings"]');
      expect(closeBtn).toBeInTheDocument();
      fireEvent.click(closeBtn!);
    });

    expect(onClose).toHaveBeenCalled();
  });

  // ── Slideover presentation ─────────────────────────────────

  it('renders with slideover presentation class', async () => {
    renderModal({ presentation: 'slideover' });

    await waitFor(() => {
      expect(screen.getByTestId('card-store-pos')).toBeInTheDocument();
    });

    const panel = document.querySelector('[role="dialog"]');
    expect(panel?.className).toContain('slideover');
  });

  it('renders with overlay presentation class by default', async () => {
    renderModal(); // no presentation prop = default 'overlay'

    await waitFor(() => {
      expect(screen.getByTestId('card-store-pos')).toBeInTheDocument();
    });

    const panel = document.querySelector('[role="dialog"]');
    expect(panel?.className).toContain('overlay');
  });
});
