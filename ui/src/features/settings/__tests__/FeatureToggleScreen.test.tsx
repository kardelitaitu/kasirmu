import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  assertAllInvokesHandled,
  recordUnmatchedInvoke,
  resetUnmatchedInvokes,
} from '@/__tests__/test-utils/invokeCoverage';

const { mockInvoke, mockAddToast } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockAddToast: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  once: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
  emitTo: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/frontend/shared', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  useContextMenu: () => ({
    menu: null,
    menuRef: { current: null },
    open: vi.fn(),
    close: vi.fn(),
    handleCopy: vi.fn(),
    handlePaste: vi.fn(),
  }),
  ContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const STABLE_L10N = {
  getString: (id: string, vars?: Record<string, string>) => {
    const map: Record<string, string> = {
      'feature-toggle-error-load': 'Failed to load features',
      'feature-toggle-error-toggle': 'Failed to toggle feature',
      'feature-toggle-search-aria': 'Search features',
      'feature-toggle-search-clear-aria': 'Clear search',
      'feature-toggle-toggle-aria': 'Toggle {name}',
      'feature-toggle-bulk-enable-aria': 'Enable all features in {group}',
      'feature-toggle-bulk-disable-aria': 'Disable all features in {group}',
      'feature-toggle-group-aria': '{group} features',
      'feature-toggle-requires': 'Requires: {deps}',
      'feature-toggle-auto-enabled': 'Also enabled: {list}',
      'feature-toggle-search-placeholder': 'Search features\u2026',
    };
    let result = map[id] ?? id;
    if (vars) {
      for (const [key, val] of Object.entries(vars)) {
        result = result.replace(`{${key}}`, val);
      }
    }
    return result;
  },
};

vi.mock('@fluent/react', () => ({
  Localized: ({ children, id, vars }: { children: React.ReactNode; id: string; vars?: Record<string, string> }) => {
    if (id === 'feature-toggle-subtitle') {
      return <span>{vars?.['enabled'] ?? '0'} / {vars?.['total'] ?? '0'} enabled</span>;
    }
    return <>{children}</>;
  },
  useLocalization: () => ({ l10n: STABLE_L10N }),
}));

vi.mock('@/components/Button', () => ({
  Button: ({ children, onClick, disabled, variant, loading, 'aria-label': ariaLabel, className, type }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    loading?: boolean;
    'aria-label'?: string;
    className?: string;
    type?: React.ButtonHTMLAttributes<HTMLButtonElement>['type'];
  }) => (
    <button
      type={type}
      className={className}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      data-variant={variant}
    >
      {loading ? 'Loading\u2026' : children}
    </button>
  ),
}));

vi.mock('@/components/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div className="card">{children}</div>,
}));

vi.mock('@/components/Skeleton', () => ({
  Skeleton: ({ variant }: { variant?: string }) => <div data-testid="skeleton" data-variant={variant} />,
}));

vi.mock('@/features/setup/components/LiveSetupPreview', () => ({
  default: ({ selectedFeatures }: { selectedFeatures: Set<string> }) => (
    <div data-testid="live-preview">{selectedFeatures.size} features active in preview</div>
  ),
}));

import FeatureToggleScreen from '../FeatureToggleScreen';
import type { FeatureInfo } from '../FeatureToggleScreen';

function createFeatures(): FeatureInfo[] {
  return [
    { key: 'pos-core', name: 'POS Core', description: 'Core POS functionality', group: 'Core', enabled: true, dependencies: [] },
    { key: 'inventory', name: 'Inventory Management', description: 'Stock tracking', group: 'Core', enabled: false, dependencies: ['pos-core'] },
    { key: 'card-payments', name: 'Card Payments', description: 'Credit/debit card payments', group: 'Payments', enabled: true, dependencies: ['pos-core'] },
    { key: 'barcode-scanner', name: 'Barcode Scanner', description: 'USB barcode scanner support', group: 'Hardware', enabled: false, dependencies: [] },
    { key: 'receipt-printer', name: 'Receipt Printer', description: 'Thermal receipt printer', group: 'Hardware', enabled: false, dependencies: [] },
  ];
}

describe('FeatureToggleScreen', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockAddToast.mockClear();
    resetUnmatchedInvokes();
  });

  afterEach(() => {
    cleanup();
    assertAllInvokesHandled('FeatureToggleScreen');
  });

  it('shows loading skeleton on mount', () => {
    const { container } = render(<FeatureToggleScreen />);
    expect(container.querySelector('.feature-toggle-loading-skeleton')).toBeInTheDocument();
  });

  it('renders feature list after loading completes', async () => {
    mockInvoke.mockResolvedValue({ features: createFeatures() });
    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('POS Core')).toBeInTheDocument();
    });
    expect(screen.getByText(/2 \/ 5 enabled/)).toBeInTheDocument();
  });

  // Regression: the mount loader must not depend on unstable hook objects
  // (l10n/addToast). If `load` listed `l10n` in its deps it would be
  // recreated every render and the mount effect would re-fire in a loop,
  // calling list_all_features repeatedly and never settling. Assert it is
  // invoked exactly once for the initial load.
  it('loads features exactly once on mount (no effect re-fire loop)', async () => {
    mockInvoke.mockResolvedValue({ features: createFeatures() });
    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('POS Core')).toBeInTheDocument();
    });
    const loadCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'list_all_features' || c[0] === 'list_all_features_scoped',
    );
    expect(loadCalls).toHaveLength(1);
  });

  it('shows error state when list_all_features fails', async () => {
    mockInvoke.mockRejectedValue(new Error('network error'));
    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load features')).toBeInTheDocument();
    });
  });

  it('retry button re-loads features after error', async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ features: createFeatures() });

    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load features')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByText('POS Core')).toBeInTheDocument();
    });
  });

  it('search filters features by name', async () => {
    mockInvoke.mockResolvedValue({ features: createFeatures() });
    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('POS Core')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox');
    await userEvent.type(searchInput, 'Barcode');

    expect(screen.queryByText('POS Core')).not.toBeInTheDocument();
    expect(screen.getByText('Barcode Scanner')).toBeInTheDocument();
  });

  it('shows empty search state when no features match', async () => {
    mockInvoke.mockResolvedValue({ features: createFeatures() });
    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('POS Core')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox');
    await userEvent.type(searchInput, 'zzzzz');

    expect(screen.getByText(/no features match/i)).toBeInTheDocument();
  });

  it('clear search button restores all features', async () => {
    mockInvoke.mockResolvedValue({ features: createFeatures() });
    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('POS Core')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox');
    await userEvent.type(searchInput, 'Barcode');
    expect(screen.queryByText('POS Core')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Clear search'));
    expect(screen.getByText('POS Core')).toBeInTheDocument();
  });

  function makeToggleMock() {
    const features = createFeatures();
    mockInvoke.mockImplementation((cmd: string, payload: { args: Record<string, unknown> }) => {
      // Both names: the screen reads through list_all_features_scoped when a session token is
      // present, and this mock models the backend, which now answers under two names for the same
      // read. Matching only the ambient name left the scoped call unhandled and every test here
      // rendered an empty list.
      if (cmd === 'list_all_features' || cmd === 'list_all_features_scoped') {
        return Promise.resolve({ features: features.map((f) => ({ ...f })) });
      }
      if (cmd === 'set_feature') {
        const { key, enabled } = payload.args as { key: string; enabled: boolean };
        const found = features.find((f) => f.key === key);
        if (found) found.enabled = enabled;
        return Promise.resolve({ success: true, features: features.map((f) => ({ ...f })), auto_enabled: [] });
      }
      if (cmd === 'set_features_bulk') {
        const { keys, enabled } = payload.args as { keys: string[]; enabled: boolean };
        features.forEach((f) => { if (keys.includes(f.key)) f.enabled = enabled; });
        return Promise.resolve({ features: features.map((f) => ({ ...f })) });
      }
      // These three are the deliberately-UNSCOPED feature commands (see the
      // "genuinely global" category in scripts/verify-scoped-coverage.sh) --
      // plain names are correct here, not a mock gap.
      recordUnmatchedInvoke(cmd);
      return Promise.reject(new Error(`Unknown command: ${cmd}`));
    });
    return features;
  }

  it('toggles a feature on', async () => {
    makeToggleMock();

    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('Barcode Scanner')).toBeInTheDocument();
    });

    const toggle = screen.getByRole('switch', { name: 'Toggle Barcode Scanner' });
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Toggle Barcode Scanner' })).toBeChecked();
    });
  });

  it('toggles a feature off', async () => {
    makeToggleMock();

    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('POS Core')).toBeInTheDocument();
    });

    const toggle = screen.getByRole('switch', { name: 'Toggle POS Core' });
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Toggle POS Core' })).not.toBeChecked();
    });
  });

  it('shows success toast after toggle', async () => {
    makeToggleMock();

    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('Barcode Scanner')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('switch', { name: 'Toggle Barcode Scanner' }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success' }),
      );
    });
  });

  it('shows error toast and re-enables toggle when set_feature fails', async () => {
    makeToggleMock();

    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('Barcode Scanner')).toBeInTheDocument();
    });

    mockInvoke.mockRejectedValueOnce(new Error('toggle failed'));
    const toggle = screen.getByRole('switch', { name: 'Toggle Barcode Scanner' });
    await userEvent.click(toggle);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
    });

    expect(screen.getByRole('switch', { name: 'Toggle Barcode Scanner' })).not.toBeDisabled();
  });

  it('bulk enable all features in a group', async () => {
    makeToggleMock();

    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('Hardware')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Enable all features in Hardware' }));

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Toggle Barcode Scanner' })).toBeChecked();
      expect(screen.getByRole('switch', { name: 'Toggle Receipt Printer' })).toBeChecked();
    });
  });

  it('bulk disable all features in a group', async () => {
    makeToggleMock();

    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('Core')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Disable all features in Core' }));

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Toggle POS Core' })).not.toBeChecked();
      expect(screen.getByRole('switch', { name: 'Toggle Inventory Management' })).not.toBeChecked();
    });
  });

  it('shows error toast when bulk toggle fails', async () => {
    makeToggleMock();

    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('Hardware')).toBeInTheDocument();
    });

    mockInvoke.mockRejectedValueOnce(new Error('bulk failed'));
    await userEvent.click(screen.getByRole('button', { name: 'Enable all features in Hardware' }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
    });
  });

  it('shows dependency label for features with dependencies', async () => {
    makeToggleMock();

    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('Inventory Management')).toBeInTheDocument();
    });

    const requires = screen.getAllByText(/Requires:/);
    expect(requires.length).toBeGreaterThanOrEqual(1);
  });

  it('renders live setup preview with active features', async () => {
    makeToggleMock();

    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByTestId('live-preview')).toBeInTheDocument();
    });

    expect(screen.getByText(/2 features active in preview/)).toBeInTheDocument();
  });

  it('shows enabled/total count per group', async () => {
    makeToggleMock();

    render(<FeatureToggleScreen />);
    await waitFor(() => {
      expect(screen.getByText('Core')).toBeInTheDocument();
    });

    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();
  });
});
