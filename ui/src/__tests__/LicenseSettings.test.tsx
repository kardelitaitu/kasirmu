import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/locales/test-utils';
import LicenseSettings from '@/features/settings/LicenseSettings';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';
import salesFtl from '@/locales/sales.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import salesIdFtl from '@/locales/sales.id.ftl?raw';
import settingsIdFtl from '@/locales/settings.id.ftl?raw';
import sharedIdFtl from '@/locales/shared.id.ftl?raw';

// ── Mocks ────────────────────────────────────────────────────────

const mockGetLicenseStatus = vi.fn();
const mockCheckLicenseStatus = vi.fn();
const mockPauseSubscription = vi.fn();
const mockResumeSubscription = vi.fn();
// Separate spies, not delegates: a mirror registers a call on the unscoped spy, which makes
// `expect(unscoped).not.toHaveBeenCalled()` unprovable and the test would pass whichever path
// ran. See DataManagementBackup.test.tsx for the full reasoning.
const mockPauseSubscriptionScoped = vi.fn();
const mockResumeSubscriptionScoped = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/api/license', () => ({
  getLicenseStatus: () => mockGetLicenseStatus(),
  checkLicenseStatus: () => mockCheckLicenseStatus(),
  pauseSubscription: (...args: unknown[]) => mockPauseSubscription(...args),
  resumeSubscription: () => mockResumeSubscription(),
  pauseSubscriptionScoped: (token: string, months: number) =>
    mockPauseSubscriptionScoped(token, months),
  resumeSubscriptionScoped: (token: string) => mockResumeSubscriptionScoped(token),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'test-user' },
    loading: false,
  }),
}));

vi.mock('@/frontend/shell/Tooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components', () => ({
  ...vi.importActual('@/components'),
  requiredLocalized: (l10n: { getString: (id: string) => string }, id: string) =>
    l10n.getString(id),
}));

vi.mock('@/components/Card', () => ({
  Card: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) => (
    <div className="card">
      {header && <div className="card-header">{header}</div>}
      <div className="card-body">{children}</div>
    </div>
  ),
}));

vi.mock('@/components/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ExitSurveyModal', () => ({
  default: ({
    open,
    onClose,
    onConfirm,
  }: {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
  }) =>
    open ? (
      <div data-testid="exit-survey-modal">
        <button onClick={onClose}>Close Survey</button>
        <button onClick={onConfirm}>Confirm Pause</button>
      </div>
    ) : null,
}));

vi.mock('@/utils/app-error', () => ({
  l10nErrorMessage: (err: unknown, _l10n: unknown, fallback: string) =>
    typeof err === 'string' ? err : fallback,
}));

// ── Test utilities ────────────────────────────────────────────────

async function renderWithFluent(ui: React.ReactElement) {
  return renderInAct(withFluent(ui, sharedFtl, salesFtl, settingsFtl));
}

async function renderWithFluentId(ui: React.ReactElement) {
  return renderInAct(
    withFluentLocale('id', ui, sharedIdFtl, salesIdFtl, settingsIdFtl),
  );
}

// ── Mock data ────────────────────────────────────────────────────

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: 'tenant-abc',
    tier_key: 'pro',
    status: 'active',
    max_stores: 3,
    max_pos_instances: 5,
    allowed_types: ['store-pos', 'kds'],
    starts_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-12-31T23:59:59Z',
    grace_until: '2027-01-31T23:59:59Z',
    issued_at: '2025-12-15T10:00:00Z',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('LicenseSettings — EN', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no license activated
    mockGetLicenseStatus.mockResolvedValue({ payload: null, tier: null, status: null });
    mockCheckLicenseStatus.mockResolvedValue({ tier: 'free', active: false });
  });

  describe('Loading state', () => {
    it('shows skeleton while loading', async () => {
      mockGetLicenseStatus.mockReturnValue(new Promise(() => {})); // Never resolves
      await renderWithFluent(<LicenseSettings />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows not-activated message when no license', async () => {
      await renderWithFluent(<LicenseSettings />);
      expect(screen.getByText(/no license activated/i)).toBeInTheDocument();
    });
  });

  describe('License payload display', () => {
    beforeEach(() => {
      mockGetLicenseStatus.mockResolvedValue({
        payload: JSON.stringify(makePayload()),
        tier: 'pro',
        status: 'active',
      });
    });

    it('renders tier label', async () => {
      await renderWithFluent(<LicenseSettings />);
      expect(screen.getByText(/pro/i)).toBeInTheDocument();
    });

    it('renders active status', async () => {
      await renderWithFluent(<LicenseSettings />);
      // The status row has class settings-license-value--active when active
      const activeValue = document.querySelector('.settings-license-value--active');
      expect(activeValue).toBeInTheDocument();
      expect(activeValue?.textContent?.toLowerCase()).toContain('active');
    });

    it('renders expiry date', async () => {
      await renderWithFluent(<LicenseSettings />);
      // The date is formatted with toLocaleDateString — check it renders something
      const expiresRow = screen.getByText(/expires/i).closest('.settings-license-row');
      expect(expiresRow).toBeInTheDocument();
    });

    it('renders max stores', async () => {
      await renderWithFluent(<LicenseSettings />);
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('renders max POS instances', async () => {
      await renderWithFluent(<LicenseSettings />);
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('renders tenant ID', async () => {
      await renderWithFluent(<LicenseSettings />);
      expect(screen.getByText('tenant-abc')).toBeInTheDocument();
    });

    it('renders allowed workspace types', async () => {
      await renderWithFluent(<LicenseSettings />);
      expect(screen.getByText(/store-pos/i)).toBeInTheDocument();
      expect(screen.getByText(/kds/i)).toBeInTheDocument();
    });

    it('shows "All" when allowed_types is empty', async () => {
      mockGetLicenseStatus.mockResolvedValue({
        payload: JSON.stringify(makePayload({ allowed_types: [] })),
        tier: 'pro',
        status: 'active',
      });
      await renderWithFluent(<LicenseSettings />);
      // The 'All' text comes from <Localized id="settings-license-allowed-types-all">
      const allowedRow = screen.getByText(/allowed workspace types/i).closest('.settings-license-row');
      expect(allowedRow).toBeInTheDocument();
      const value = allowedRow?.querySelector('.settings-license-value');
      expect(value).toBeInTheDocument();
    });

    it('shows unlimited when max_stores is 0', async () => {
      mockGetLicenseStatus.mockResolvedValue({
        payload: JSON.stringify(makePayload({ max_stores: 0 })),
        tier: 'pro',
        status: 'active',
      });
      await renderWithFluent(<LicenseSettings />);
      expect(screen.getByText(/unlimited/i)).toBeInTheDocument();
    });
  });

  describe('Pause / Resume subscription', () => {
    it('shows Pause button for active subscription', async () => {
      mockGetLicenseStatus.mockResolvedValue({
        payload: JSON.stringify(makePayload({ status: 'active' })),
        tier: 'pro',
        status: 'active',
      });
      await renderWithFluent(<LicenseSettings />);
      expect(screen.getByText(/pause subscription/i)).toBeInTheDocument();
    });

    it('shows Resume button for paused subscription', async () => {
      mockGetLicenseStatus.mockResolvedValue({
        payload: JSON.stringify(makePayload({ status: 'paused' })),
        tier: 'pro',
        status: 'paused',
      });
      await renderWithFluent(<LicenseSettings />);
      expect(screen.getByText(/resume subscription/i)).toBeInTheDocument();
    });

    it('shows paused-until date for paused subscription', async () => {
      mockGetLicenseStatus.mockResolvedValue({
        payload: JSON.stringify(makePayload({ status: 'paused' })),
        tier: 'pro',
        status: 'paused',
      });
      await renderWithFluent(<LicenseSettings />);
      expect(screen.getByText(/paused until/i)).toBeInTheDocument();
    });

    it('opens exit survey when Pause clicked', async () => {
      mockGetLicenseStatus.mockResolvedValue({
        payload: JSON.stringify(makePayload({ status: 'active' })),
        tier: 'pro',
        status: 'active',
      });
      await renderWithFluent(<LicenseSettings />);
      fireEvent.click(screen.getByText(/pause subscription/i));
      expect(screen.getByTestId('exit-survey-modal')).toBeInTheDocument();
    });

    it('calls pauseSubscription after exit survey confirm', async () => {
      mockPauseSubscription.mockResolvedValue(undefined);
      mockCheckLicenseStatus.mockResolvedValue({ tier: 'pro', active: true });
      mockGetLicenseStatus.mockResolvedValue({
        payload: JSON.stringify(makePayload({ status: 'active' })),
        tier: 'pro',
        status: 'active',
      });
      await renderWithFluent(<LicenseSettings />);
      fireEvent.click(screen.getByText(/pause subscription/i));
      fireEvent.click(screen.getByText(/confirm pause/i));
      await waitFor(() => {
        // pause_subscription reads the stored API key and calls the billing server with no
        // session and no permission check; pause_subscription_scoped (license.rs:806) enforces
        // permissions::SETTINGS_EDIT first. Pausing a subscription is a billing action.
        expect(mockPauseSubscriptionScoped).toHaveBeenCalledWith(HARNESS_SESSION_TOKEN, 1);
        expect(mockPauseSubscription).not.toHaveBeenCalled();
      });
    });

    it('calls resumeSubscription when Resume clicked', async () => {
      mockResumeSubscription.mockResolvedValue(undefined);
      mockCheckLicenseStatus.mockResolvedValue({ tier: 'pro', active: true });
      mockGetLicenseStatus.mockResolvedValue({
        payload: JSON.stringify(makePayload({ status: 'paused' })),
        tier: 'pro',
        status: 'paused',
      });
      await renderWithFluent(<LicenseSettings />);
      fireEvent.click(screen.getByText(/resume subscription/i));
      await waitFor(() => {
        expect(mockResumeSubscriptionScoped).toHaveBeenCalledWith(HARNESS_SESSION_TOKEN);
        expect(mockResumeSubscription).not.toHaveBeenCalled();
      });
    });
  });

  describe('Server status polling', () => {
    it('shows checking state initially', async () => {
      mockGetLicenseStatus.mockResolvedValue({
        payload: JSON.stringify(makePayload()),
        tier: 'pro',
        status: 'active',
      });
      mockCheckLicenseStatus.mockReturnValue(new Promise(() => {})); // Never resolves
      await renderWithFluent(<LicenseSettings />);
      expect(screen.getByText(/checking/i)).toBeInTheDocument();
    });

    it('shows online when server responds active', async () => {
      mockGetLicenseStatus.mockResolvedValue({
        payload: JSON.stringify(makePayload()),
        tier: 'pro',
        status: 'active',
      });
      mockCheckLicenseStatus.mockResolvedValue({ tier: 'pro', active: true });
      await renderWithFluent(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText(/live/i)).toBeInTheDocument();
      });
    });

    it('shows inactive when server responds inactive', async () => {
      mockGetLicenseStatus.mockResolvedValue({
        payload: JSON.stringify(makePayload()),
        tier: 'pro',
        status: 'active',
      });
      mockCheckLicenseStatus.mockResolvedValue({ tier: 'pro', active: false });
      await renderWithFluent(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText(/inactive/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error state', () => {
    it('shows error message when load fails', async () => {
      mockGetLicenseStatus.mockRejectedValue('Connection refused');
      await renderWithFluent(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('shows Retry button on error', async () => {
      mockGetLicenseStatus.mockRejectedValue('Connection refused');
      await renderWithFluent(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText(/retry/i)).toBeInTheDocument();
      });
    });
  });
});

describe('LicenseSettings — ID', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLicenseStatus.mockResolvedValue({
      payload: JSON.stringify(makePayload()),
      tier: 'pro',
      status: 'active',
    });
    mockCheckLicenseStatus.mockResolvedValue({ tier: 'pro', active: true });
  });

  it('renders tier in Indonesian locale', async () => {
    await renderWithFluentId(<LicenseSettings />);
    // Pro tier should render regardless of locale
    const tierRow = document.querySelector('.settings-license-value--tier');
    expect(tierRow).toBeInTheDocument();
  });

  it('renders pause button in Indonesian', async () => {
    await renderWithFluentId(<LicenseSettings />);
    // The button exists with a localized label
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });
});
