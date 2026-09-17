// ── FeatureToggleScreen component tests ─────────────────────────────
//
// Covers: loading state, error state with retry, empty state (no features),
// search with no results, feature list rendering, single toggle, bulk
// enable/disable, dependency display, and group headers.

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';

// FAST_WAIT: 5ms polling for async assertions (10x faster than default 50ms).
const FAST_WAIT = { interval: 5, timeout: 500 } as const;
import { renderWithFluent } from '@/__tests__/test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import { ToastProvider } from '@/components/Toast';
import FeatureToggleScreen from '@/features/settings/FeatureToggleScreen';

// ── Mock @tauri-apps/api/core ────────────────────────────────────

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ── Mock useAuth ─────────────────────────────────────────────────

// A session token has to be supplied for the ADR #7 case to be reachable: the screen reads
// `const sessionToken = rawToken ?? ''` and an empty string is falsy, so without a provider the
// conditional takes the ambient branch and the scoped path is never exercised. Mocking the context
// rather than the api module keeps the real api/features.ts running, so the assertion below checks
// the command name actually sent rather than a mock someone configured.
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'session-1' }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', display_name: 'Admin', role_name: 'admin' },
  }),
}));



// ── Sample data ───────────────────────────────────────────────────

const sampleFeatures = [
  { key: 'cash_payment', name: 'Cash Payment', description: 'Accept cash payments', group: 'Core', enabled: true, dependencies: [] },
  { key: 'card_payment', name: 'Card Payment', description: 'Accept card payments', group: 'Payments', enabled: false, dependencies: ['cash_payment'] },
  { key: 'inventory_tracking', name: 'Inventory Tracking', description: 'Track stock levels', group: 'Products', enabled: true, dependencies: [] },
  { key: 'staff_login', name: 'Staff Login', description: 'PIN-based staff login', group: 'Staff', enabled: true, dependencies: [] },
  { key: 'barcode_scanning', name: 'Barcode Scanner', description: 'USB barcode scanning', group: 'Hardware', enabled: false, dependencies: [] },
];

const sampleFeaturesResult = { features: sampleFeatures };

// ── Tests ─────────────────────────────────────────────────────────

describe('FeatureToggleScreen', () => {
  // ── Loading state ────────────────────────────────────────────

  it('renders loading skeleton while fetching features', async () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    // Skeleton container should render instead of text
    expect(document.querySelector('.feature-toggle-loading-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/loading features/i)).not.toBeInTheDocument();
  });

  // ── Error state ──────────────────────────────────────────────

  it('renders error with retry button when load fails', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC error'));

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Failed to load features')).toBeInTheDocument();
    }, FAST_WAIT);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('calls load again when retry is clicked', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('IPC error'));
    mockInvoke.mockResolvedValueOnce(sampleFeaturesResult);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    }, FAST_WAIT);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText('Cash Payment')).toBeInTheDocument();
    }, FAST_WAIT);
  });

  // ── Empty state ──────────────────────────────────────────────

  it('renders empty state when no features exist', async () => {
    mockInvoke.mockResolvedValue({ features: [] });

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText(/No features found/i)).toBeInTheDocument();
    }, FAST_WAIT);
  });

  // ── Main render ──────────────────────────────────────────────

  it('renders the title and subtitle with feature count', async () => {
    mockInvoke.mockResolvedValue(sampleFeaturesResult);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Feature Toggles')).toBeInTheDocument();
    }, FAST_WAIT);
    // 3 of 5 enabled
    expect(screen.getByText(/3 \/ 5 enabled/)).toBeInTheDocument();
  });

  it('renders all feature groups with correct headers', async () => {
    mockInvoke.mockResolvedValue(sampleFeaturesResult);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Cash Payment')).toBeInTheDocument();
    }, FAST_WAIT);
    // Use heading role to disambiguate from LSP nav chips that share group names
    expect(screen.getByRole('heading', { name: /core/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /payments/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /products/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /staff/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /hardware/i })).toBeInTheDocument();
  });

  it('renders feature names and descriptions', async () => {
    mockInvoke.mockResolvedValue(sampleFeaturesResult);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Cash Payment')).toBeInTheDocument();
    }, FAST_WAIT);
    expect(screen.getByText('Accept cash payments')).toBeInTheDocument();
    expect(screen.getByText('Card Payment')).toBeInTheDocument();
  });

  it('renders group-level enabled/total count in each heading', async () => {
    mockInvoke.mockResolvedValue(sampleFeaturesResult);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Cash Payment')).toBeInTheDocument();
    }, FAST_WAIT);

    // Core: cash_payment is enabled → "1/1".
    const coreHeading = screen.getByRole('heading', { name: /core/i });
    expect(within(coreHeading).getByText('1/1')).toBeInTheDocument();

    // Hardware: barcode_scanning is disabled → "0/1".
    const hardwareHeading = screen.getByRole('heading', { name: /hardware/i });
    expect(within(hardwareHeading).getByText('0/1')).toBeInTheDocument();
  });

  it('renders Enable All / Disable All bulk buttons per group', async () => {
    mockInvoke.mockResolvedValue(sampleFeaturesResult);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Cash Payment')).toBeInTheDocument();
    }, FAST_WAIT);

    // Each group with features gets Enable All / Disable All buttons
    const enableButtons = screen.getAllByText(/enable all/i);
    const disableButtons = screen.getAllByText(/disable all/i);
    expect(enableButtons.length).toBe(5);
    expect(disableButtons.length).toBe(5);
  });

  // ── Search ────────────────────────────────────────────────────

  it('renders a search input', async () => {
    mockInvoke.mockResolvedValue(sampleFeaturesResult);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Cash Payment')).toBeInTheDocument();
    }, FAST_WAIT);

    expect(screen.getByPlaceholderText(/search features/i)).toBeInTheDocument();
  });

  it('filters features when searching', async () => {
    mockInvoke.mockResolvedValue(sampleFeaturesResult);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Cash Payment')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search features/i);
    fireEvent.change(searchInput, { target: { value: 'card' } });

    await waitFor(() => {
      expect(screen.getByText('Card Payment')).toBeInTheDocument();
    }, FAST_WAIT);
    expect(screen.queryByText('Cash Payment')).not.toBeInTheDocument();
  });

  it('shows search-no-results message when query has no matches', async () => {
    mockInvoke.mockResolvedValue(sampleFeaturesResult);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Cash Payment')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search features/i);
    fireEvent.change(searchInput, { target: { value: 'zzzznotfound' } });

    await waitFor(() => {
      expect(screen.getByText(/No features match your search/i)).toBeInTheDocument();
    }, FAST_WAIT);
  });

  it('shows clear button when search has a value', async () => {
    mockInvoke.mockResolvedValue(sampleFeaturesResult);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Cash Payment')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search features/i);
    fireEvent.change(searchInput, { target: { value: 'card' } });

    const clearBtn = screen.getByRole('button', { name: /clear search/i });
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);
    expect(searchInput).toHaveValue('');
  });

  // ── Single toggle ─────────────────────────────────────────────

  it('toggles a feature on when clicked', async () => {
    const toggledFeatures = sampleFeatures.map((f) =>
      f.key === 'card_payment' ? { ...f, enabled: true } : f,
    );
    mockInvoke
      .mockResolvedValueOnce(sampleFeaturesResult)
      .mockResolvedValueOnce({ success: true, features: toggledFeatures, auto_enabled: [] });

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Card Payment')).toBeInTheDocument();
    }, FAST_WAIT);

    // Find the Card Payment toggle checkbox and click it
    const cardRow = screen.getByText('Card Payment').closest('.feature-toggle-item') as HTMLElement;
    const toggle = cardRow.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(toggle).not.toBeNull();
    expect(toggle!.checked).toBe(false);

    fireEvent.click(toggle!);

    await waitFor(() => {
      // After toggle, the feature list updates and card_payment should be enabled
      expect(mockInvoke).toHaveBeenCalledWith(
        'set_feature',
        expect.objectContaining({ args: { key: 'card_payment', enabled: true } }),
      );
    }, FAST_WAIT);
  });

  it('shows auto-enabled dependency toast when toggle enables dependencies', async () => {
    const toggledFeatures = sampleFeatures.map((f) =>
      f.key === 'card_payment' ? { ...f, enabled: true } : f,
    );
    mockInvoke
      .mockResolvedValueOnce(sampleFeaturesResult)
      .mockResolvedValueOnce({
        success: true,
        features: toggledFeatures,
        auto_enabled: ['cash_payment'],
      });

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Card Payment')).toBeInTheDocument();
    }, FAST_WAIT);

    const autoCardRow = screen.getByText('Card Payment').closest('.feature-toggle-item') as HTMLElement;
    const autoToggle = autoCardRow.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(autoToggle).not.toBeNull();
    fireEvent.click(autoToggle!);

    await waitFor(() => {
      expect(screen.getByText(/auto-enabled dependencies/i)).toBeInTheDocument();
    }, FAST_WAIT);
  });

  // ── Bulk toggle ───────────────────────────────────────────────

  it('bulk-enables all features in a group', async () => {
    const allHardwareEnabled = sampleFeatures.map((f) =>
      f.group === 'Hardware' ? { ...f, enabled: true } : f,
    );
    mockInvoke
      .mockResolvedValueOnce(sampleFeaturesResult)
      .mockResolvedValueOnce({ features: allHardwareEnabled });

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Barcode Scanner')).toBeInTheDocument();
    }, FAST_WAIT);

    // Find Hardware group's Enable All button and click it
    const hardwareGroup = screen.getByRole('heading', { name: /hardware/i }).closest('.feature-toggle-group') as HTMLElement;
    const enableAllBtn = within(hardwareGroup).getByText(/enable all/i);
    fireEvent.click(enableAllBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'set_features_bulk',
        expect.objectContaining({
          args: expect.objectContaining({ keys: ['barcode_scanning'], enabled: true }),
        }),
      );
    }, FAST_WAIT);
  });

  it('bulk-disables all features in a group', async () => {
    const allCoreDisabled = sampleFeatures.map((f) =>
      f.group === 'Core' ? { ...f, enabled: false } : f,
    );
    mockInvoke
      .mockResolvedValueOnce(sampleFeaturesResult)
      .mockResolvedValueOnce({ features: allCoreDisabled });

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Cash Payment')).toBeInTheDocument();
    }, FAST_WAIT);

    // Find Core group's Disable All button and click it
    const coreGroup = screen.getByRole('heading', { name: /core/i }).closest('.feature-toggle-group') as HTMLElement;
    const disableAllBtn = within(coreGroup).getByText(/disable all/i);
    fireEvent.click(disableAllBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'set_features_bulk',
        expect.objectContaining({
          args: expect.objectContaining({ keys: ['cash_payment'], enabled: false }),
        }),
      );
    }, FAST_WAIT);
  });

  // ── Dependency display ────────────────────────────────────────

  it('shows dependency info for features with dependencies', async () => {
    mockInvoke.mockResolvedValue(sampleFeaturesResult);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Card Payment')).toBeInTheDocument();
    }, FAST_WAIT);

    // Card Payment depends on Cash Payment
    expect(screen.getByText(/requires: cash payment/i)).toBeInTheDocument();
  });

  it('does not show dependency info for features without dependencies', async () => {
    mockInvoke.mockResolvedValue(sampleFeaturesResult);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Cash Payment')).toBeInTheDocument();
    }, FAST_WAIT);

    // Cash Payment has no dependencies — the requires text should not appear in its row
    const cashRow = screen.getByText('Cash Payment').closest('.feature-toggle-item') as HTMLElement;
    expect(cashRow.querySelector('.feature-toggle-item-deps')).toBeNull();
  });

  // ── Disabled state on toggle ──────────────────────────────────

  it('disables toggle input while toggling is in progress', async () => {
    // Don't resolve the setFeature call — keeps toggling=true
    const togglePromise = new Promise(() => {});
    mockInvoke
      .mockResolvedValueOnce(sampleFeaturesResult)
      .mockReturnValueOnce(togglePromise);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Cash Payment')).toBeInTheDocument();
    }, FAST_WAIT);

    const disabledCashRow = screen.getByText('Cash Payment').closest('.feature-toggle-item') as HTMLElement;
    const disabledToggle = disabledCashRow.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(disabledToggle).not.toBeNull();

    // Click to start toggling
    fireEvent.click(disabledToggle!);

    // Toggle should be disabled while in progress
    expect(disabledToggle!).toBeDisabled();
  });

  // ADR #7: this screen writes through set_feature / set_features_bulk, both of which take a
  // sessionToken, while its read called the ambient list_all_features with none. So the flags a
  // cashier saw came from the ambient store while the ones they toggled went to the session's --
  // the same asymmetry item 65 tracks, and the reason list_all_features_scoped existed with zero
  // production callers. Asserted at the invoke layer, so the real api/features.ts runs.
  it('loads the feature list through list_all_features_scoped when a token exists', async () => {
    mockInvoke.mockResolvedValue(sampleFeaturesResult);

    await renderWithFluent(<ToastProvider><FeatureToggleScreen /></ToastProvider>, settingsFtl, sharedFtl);

    await waitFor(() => {
      const commands = mockInvoke.mock.calls.map((call) => call[0]);
      expect(commands).toContain('list_all_features_scoped');
    }, FAST_WAIT);
    const commands = mockInvoke.mock.calls.map((call) => call[0]);
    expect(commands).not.toContain('list_all_features');
    // The token must actually travel, not just the command name.
    const call = mockInvoke.mock.calls.find((c) => c[0] === 'list_all_features_scoped');
    expect((call?.[1] as { sessionToken?: string })?.sessionToken).toBe('session-1');
  });
});
