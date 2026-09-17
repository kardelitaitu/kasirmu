import { useState } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LicenseSettings from '../LicenseSettings';
import { getLicenseStatus, checkLicenseStatus } from '@/api/license';

const mockAddToast = vi.fn();

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/api/license', () => ({
  getLicenseStatus: vi.fn(),
  checkLicenseStatus: vi.fn(),
}));

const { mockL10n, mockUseLocalization } = vi.hoisted(() => {
  const mockL10n = {
    getString: (id: string) => {
      const map: Record<string, string> = {
        'settings-loading': 'Loading…',
        'settings-retry': 'Retry',
        'settings-section-license': 'License',
        'settings-license-load-failed': 'Failed to load license info',
        'settings-license-tier': 'Tier',
        'settings-license-tier-free': 'Free',
        'settings-license-tier-pro': 'Pro',
        'settings-license-tier-premium': 'Premium',
        'settings-license-tier-enterprise': 'Enterprise',
        'settings-license-status-label': 'Status',
        'settings-license-status-active': 'active',
        'settings-license-expires': 'Expires',
        'settings-license-grace': 'Grace Period Until',
        'settings-license-max-stores': 'Max Stores',
        'settings-license-max-pos': 'Max POS Instances',
        'settings-license-unlimited': 'Unlimited',
        'settings-license-tenant-id': 'Tenant ID',
        'settings-license-allowed-types': 'Allowed Workspace Types',
        'settings-license-allowed-types-all': 'All',
        'settings-license-not-activated':
          'No license activated. Activate a license to see details here.',
        'settings-license-server-status': 'Server Status',
        'settings-license-live-online': 'Live',
        'settings-license-live-offline': 'Offline',
        'settings-license-live-inactive': 'Inactive',
        'settings-license-live-checking': 'Checking…',
        'settings-license-last-checked': 'Last checked: {when}',
        'settings-license-just-now': 'just now',
        'settings-license-seconds-ago': '{seconds}s ago',
        'settings-license-minutes-ago': '{minutes}m ago',
        'settings-license-refresh': 'Refresh',
        'settings-license-refresh-aria': 'Refresh license status',
        'settings-license-poll-offline': 'Server unreachable',
        'settings-license-server-tier': 'Server Tier',
        'settings-license-server-active': 'Server Active',
        'settings-license-server-expires': 'Server Expires',
        'settings-license-server-results': 'License Check Results',
        'settings-license-server-status-retrieved':
          'Server license status retrieved.',
        'settings-license-server-check-failed': 'Server check failed',
        'settings-license-yes': 'Yes',
        'settings-license-no': 'No',
        'settings-license-ws-retail': 'Retail',
        'settings-license-ws-restaurant': 'Restaurant',
        'settings-license-ws-cafe': 'Café',
        'settings-license-ws-warehouse': 'Warehouse',
        'settings-license-ws-kds': 'KDS',
      };
      return map[id] || id;
    },
    // Empty bundles array: the en-US fallback is used by locale formatting.
    bundles: [],
  };
  const mockUseLocalization = vi.fn(() => ({ l10n: mockL10n }));
  return { mockL10n, mockUseLocalization };
});

vi.mock('@fluent/react', () => ({
  Localized: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLocalization: mockUseLocalization,
}));

vi.mock('@/components/Card', () => ({
  Card: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) => (
    <div data-testid="card">
      {header}
      {children}
    </div>
  ),
}));

vi.mock('@/components/Button', () => ({
  Button: ({ children, variant, loading, onClick, ...rest }: { children: React.ReactNode; variant?: string; loading?: boolean; onClick?: React.MouseEventHandler<HTMLButtonElement>; [key: string]: unknown }) => (
    <button
      onClick={onClick}
      disabled={loading}
      data-variant={variant}
      data-loading={loading ? 'true' : 'false'}
      aria-label={typeof rest['aria-label'] === 'string' ? rest['aria-label'] : undefined}
      aria-busy={loading ? 'true' : undefined}
    >
      {loading ? 'Loading…' : children}
    </button>
  ),
}));

/** Build a valid license payload for tests. */
function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: 'abc123-tenant',
    tier_key: 'pro',
    status: 'active',
    max_stores: 5,
    max_pos_instances: 10,
    allowed_types: ['retail', 'restaurant'],
    starts_at: '2025-01-01T00:00:00Z',
    expires_at: '2026-01-01T00:00:00Z',
    grace_until: '2026-02-01T00:00:00Z',
    issued_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

const VALID_LICENSE_STATUS = {
  isActive: true,
  status: 'valid' as const,
  tier: 'pro',
  payload: JSON.stringify(makePayload()),
  message: null,
};

const SERVER_STATUS = {
  tenantId: 'abc123-tenant',
  status: 'active',
  tier: 'pro',
  active: true,
  expiresAt: '2026-01-01T00:00:00Z',
  graceUntil: '2026-02-01T00:00:00Z',
  maxLocations: 5,
};

describe('LicenseSettings', () => {
  // ── 1. Loading state ──────────────────────────────────────
  describe('Loading state', () => {
    it('shows skeleton loading while getLicenseStatus is pending', () => {
      let resolve: (value: typeof VALID_LICENSE_STATUS) => void = () => {};
      vi.mocked(getLicenseStatus).mockReturnValue(
        new Promise((r) => { resolve = r; }),
      );
      const { container } = render(<LicenseSettings />);
      // Skeleton rows replace the old "Loading…" text.
      expect(container.querySelector('.settings-license-skeleton')).toBeInTheDocument();
      expect(container.querySelector('.settings-license-skeleton-row')).toBeInTheDocument();
      resolve(VALID_LICENSE_STATUS);
    });

    it('loading container has role="status" for screen readers', async () => {
      let resolve: (value: typeof VALID_LICENSE_STATUS) => void = () => {};
      vi.mocked(getLicenseStatus).mockReturnValue(
        new Promise((r) => { resolve = r; }),
      );
      const { container } = render(<LicenseSettings />);
      const statusEl = container.querySelector('[role="status"]');
      expect(statusEl).toBeInTheDocument();
      expect(statusEl).toHaveAttribute('aria-live', 'polite');
      resolve(VALID_LICENSE_STATUS);
    });
  });

  // ── 2. Error state ────────────────────────────────────────
  describe('Error state', () => {
    it('shows error message when getLicenseStatus rejects', async () => {
      vi.mocked(getLicenseStatus).mockRejectedValue(
        new Error('Network offline'),
      );
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText('Failed to load license info')).toBeInTheDocument();
      });
    });

    it('shows generic error when rejection is not an Error instance', async () => {
      vi.mocked(getLicenseStatus).mockRejectedValue('some string error');
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(
          screen.getByText('Failed to load license info'),
        ).toBeInTheDocument();
      });
    });

    it('error container has role="alert"', async () => {
      vi.mocked(getLicenseStatus).mockRejectedValue(new Error('fail'));
      const { container } = render(<LicenseSettings />);
      await waitFor(() => {
        expect(container.querySelector('[role="alert"]')).toBeInTheDocument();
      });
    });

    it('Retry button has aria-label', async () => {
      vi.mocked(getLicenseStatus).mockRejectedValue(new Error('fail'));
      render(<LicenseSettings />);
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /retry/i });
        expect(btn).toHaveAttribute('aria-label', 'Retry');
      });
    });

    it('clicking Retry re-invokes getLicenseStatus', async () => {
      vi.mocked(getLicenseStatus)
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(VALID_LICENSE_STATUS);

      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText('Failed to load license info')).toBeInTheDocument();
      });
      expect(getLicenseStatus).toHaveBeenCalledTimes(1);

      await userEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(getLicenseStatus).toHaveBeenCalledTimes(2);
      await waitFor(() => {
        expect(screen.getByText('Pro')).toBeInTheDocument();
      });
    });
  });

  // ── 3. Not-activated state ────────────────────────────────
  describe('Not-activated state', () => {
    it('shows message when payload is null', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        isActive: false,
        status: 'missing',
        tier: null,
        payload: null,
        message: null,
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(
          screen.getByText(
            'No license activated. Activate a license to see details here.',
          ),
        ).toBeInTheDocument();
      });
    });

    it('not-activated message has role="status"', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        isActive: false,
        status: 'missing',
        tier: null,
        payload: null,
        message: null,
      });
      const { container } = render(<LicenseSettings />);
      await waitFor(() => {
        const el = container.querySelector('[role="status"]');
        expect(el).toBeInTheDocument();
        // The empty state renders a lock icon SVG + text inside a div, not a <p>.
        expect(el!.tagName).toBe('DIV');
        expect(el!.querySelector('.settings-license-empty-icon')).toBeInTheDocument();
      });
    });
  });

  // ── 4. Normal render with valid payload ───────────────────
  describe('Normal render', () => {
    beforeEach(() => {
      vi.mocked(getLicenseStatus).mockResolvedValue(VALID_LICENSE_STATUS);
    });

    it('displays tier with correct label', async () => {
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText('Pro')).toBeInTheDocument();
      });
    });

    it('applies correct CSS class for tier badge', async () => {
      const { container } = render(<LicenseSettings />);
      await waitFor(() => {
        expect(
          container.querySelector('.settings-license-value--tier-pro'),
        ).toBeInTheDocument();
      });
    });

    it('displays status field', async () => {
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText('active')).toBeInTheDocument();
      });
    });

    it('active status has --active CSS class', async () => {
      const { container } = render(<LicenseSettings />);
      await waitFor(() => {
        expect(
          container.querySelector('.settings-license-value--active'),
        ).toBeInTheDocument();
      });
    });

    it('non-active status has --warning CSS class', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        ...VALID_LICENSE_STATUS,
        payload: JSON.stringify(makePayload({ status: 'gracePeriod' })),
      });
      const { container } = render(<LicenseSettings />);
      await waitFor(() => {
        expect(
          container.querySelector('.settings-license-value--warning'),
        ).toBeInTheDocument();
      });
    });

    it('displays formatted expiry date', async () => {
      render(<LicenseSettings />);
      await waitFor(() => {
        // formatDate converts RFC 3339 to locale date; year appears in both
        // the local expiry row and the server check results, so getAllByText
        const yearMatches = screen.getAllByText(/2026/);
        expect(yearMatches.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('displays formatted grace period date', async () => {
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText(/February/)).toBeInTheDocument();
      });
    });

    it('displays max stores count', async () => {
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText('5')).toBeInTheDocument();
      });
    });

    it('shows "Unlimited" when max_stores is 0', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        ...VALID_LICENSE_STATUS,
        payload: JSON.stringify(makePayload({ max_stores: 0 })),
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getAllByText('Unlimited').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('displays max POS instances count', async () => {
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText('10')).toBeInTheDocument();
      });
    });

    it('shows "Unlimited" when max_pos_instances is 0', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        ...VALID_LICENSE_STATUS,
        payload: JSON.stringify(makePayload({ max_pos_instances: 0 })),
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getAllByText('Unlimited').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('displays tenant ID in monospace', async () => {
      const { container } = render(<LicenseSettings />);
      await waitFor(() => {
        expect(
          container.querySelector('.settings-license-value--mono'),
        ).toBeInTheDocument();
        expect(screen.getByText('abc123-tenant')).toBeInTheDocument();
      });
    });

    it('license section container has role="region" with aria-label', async () => {
      const { container } = render(<LicenseSettings />);
      await waitFor(() => {
        const region = container.querySelector(
          '.settings-license-section[role="region"]',
        );
        expect(region).toHaveAttribute('aria-label', 'License');
      });
    });
  });

  // ── 5. Allowed types display ──────────────────────────────
  describe('Allowed workspace types', () => {
    it('displays comma-joined workspace type labels', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        ...VALID_LICENSE_STATUS,
        payload: JSON.stringify(
          makePayload({ allowed_types: ['retail', 'restaurant', 'cafe'] }),
        ),
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(
          screen.getByText('Retail, Restaurant, Café'),
        ).toBeInTheDocument();
      });
    });

    it('shows localized "All" when allowed_types is empty', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        ...VALID_LICENSE_STATUS,
        payload: JSON.stringify(makePayload({ allowed_types: [] })),
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText('All')).toBeInTheDocument();
      });
    });

    it('gracefully handles null allowed_types (null-safe guard)', async () => {
      // Simulate an older payload that omits allowed_types
      const payloadWithoutTypes = {
        tenant_id: 'abc123-tenant',
        tier_key: 'pro',
        status: 'active',
        max_stores: 5,
        max_pos_instances: 10,
        starts_at: '2025-01-01T00:00:00Z',
        expires_at: '2026-01-01T00:00:00Z',
        grace_until: '2026-02-01T00:00:00Z',
        issued_at: '2025-01-01T00:00:00Z',
      };
      vi.mocked(getLicenseStatus).mockResolvedValue({
        ...VALID_LICENSE_STATUS,
        payload: JSON.stringify(payloadWithoutTypes),
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        // Should not crash, and should show "All" since undefined ?? [] = []
        expect(screen.getByText('All')).toBeInTheDocument();
      });
    });

    it('falls back to raw slug for unmapped workspace types', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        ...VALID_LICENSE_STATUS,
        payload: JSON.stringify(
          makePayload({ allowed_types: ['unknown-type'] }),
        ),
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText('unknown-type')).toBeInTheDocument();
      });
    });
  });

  // ── 6. JSON payload edge cases ────────────────────────────
  describe('JSON payload edge cases', () => {
    it('handles malformed JSON payload gracefully', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        isActive: true,
        status: 'valid',
        tier: null,
        payload: '{ not valid json }',
        message: null,
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        // Should fall through to error state since JSON.parse throws
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
      });
    });

    it('handles empty string payload gracefully', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        isActive: true,
        status: 'valid',
        tier: null,
        payload: '',
        message: null,
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        // Empty string is falsy, so payload is treated as null → not-activated
        expect(
          screen.getByText(
            'No license activated. Activate a license to see details here.',
          ),
        ).toBeInTheDocument();
      });
    });

    it('handles payload with unexpected shape (missing all fields)', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        isActive: true,
        status: 'valid',
        tier: null,
        payload: '{}',
        message: null,
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        // When fields are undefined, String(undefined) renders the literal
        // string "undefined" for both max_stores and max_pos_instances.
        // The component doesn't crash.
        const undefs = screen.getAllByText('undefined');
        expect(undefs.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('handles numeric 0 expiry gracefully', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        ...VALID_LICENSE_STATUS,
        payload: JSON.stringify(makePayload({ max_stores: 0, max_pos_instances: 0 })),
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        const unlimited = screen.getAllByText('Unlimited');
        expect(unlimited.length).toBe(2); // both stores and instances
      });
    });
  });

  // ── 7. Server status check (manual refresh) ───────────────
  describe('Manual refresh', () => {
    beforeEach(() => {
      vi.mocked(getLicenseStatus).mockResolvedValue(VALID_LICENSE_STATUS);
      // Auto-poll succeeds on first call; individual tests override for error cases.
      vi.mocked(checkLicenseStatus).mockReset();
      vi.mocked(checkLicenseStatus).mockResolvedValue(SERVER_STATUS);
    });

    it('Refresh button is present after first poll and has aria-label', async () => {
      render(<LicenseSettings />);
      await waitFor(() => {
        const btn = screen.getByRole('button', {
          name: /refresh license status/i,
        });
        expect(btn).toHaveAttribute('aria-label', 'Refresh license status');
      });
    });

    it('clicking Refresh calls checkLicenseStatus', async () => {
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /refresh license status/i }),
        ).toBeInTheDocument();
      });

      const initialCount = vi.mocked(checkLicenseStatus).mock.calls.length;
      await userEvent.click(
        screen.getByRole('button', { name: /refresh license status/i }),
      );
      expect(vi.mocked(checkLicenseStatus).mock.calls.length).toBe(initialCount + 1);
    });

    it('shows server results after successful refresh', async () => {
      render(<LicenseSettings />);
      await waitFor(() => {
        // Server section auto-appears after first poll
        const tierMatches = screen.getAllByText('Pro');
        expect(tierMatches.length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText('Yes')).toBeInTheDocument();
      });
    });

    it('shows "No" when server active is false', async () => {
      vi.mocked(checkLicenseStatus).mockResolvedValue({
        ...SERVER_STATUS,
        active: false,
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText('No')).toBeInTheDocument();
      });
    });

    it('server results region has role="region" with aria-label', async () => {
      const { container } = render(<LicenseSettings />);
      await waitFor(() => {
        const region = container.querySelector(
          '.settings-license-server-section[role="region"]',
        );
        expect(region).toHaveAttribute('aria-label', 'License Check Results');
      });
    });

    it('does not show expiresAt row when server returns null', async () => {
      vi.mocked(checkLicenseStatus).mockResolvedValue({
        ...SERVER_STATUS,
        expiresAt: null,
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText('Yes')).toBeInTheDocument();
      });
      expect(screen.queryByText('Server Expires')).not.toBeInTheDocument();
    });

    it('shows info toast on successful refresh', async () => {
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /refresh license status/i }),
        ).toBeInTheDocument();
      });

      await userEvent.click(
        screen.getByRole('button', { name: /refresh license status/i }),
      );

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith({
          type: 'info',
          message: 'Server license status retrieved.',
        });
      });
    });

    it('shows error toast on failed refresh', async () => {
      // Auto-poll uses the resolved mock; the click will use the Once.
      vi.mocked(checkLicenseStatus)
        .mockResolvedValueOnce(SERVER_STATUS)
        .mockRejectedValueOnce(new Error('Server unreachable'));

      render(<LicenseSettings />);
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /refresh license status/i }),
        ).toBeInTheDocument();
      });

      await userEvent.click(
        screen.getByRole('button', { name: /refresh license status/i }),
      );

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith({
          type: 'error',
          message: 'Server check failed',
        });
      });
    });

    it('shows generic error toast for non-Error rejection', async () => {
      // Auto-poll succeeds, then manual click fails.
      vi.mocked(checkLicenseStatus)
        .mockResolvedValueOnce(SERVER_STATUS)
        .mockRejectedValueOnce('timeout');

      render(<LicenseSettings />);
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /refresh license status/i }),
        ).toBeInTheDocument();
      });

      await userEvent.click(
        screen.getByRole('button', { name: /refresh license status/i }),
      );

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith({
          type: 'error',
          message: 'Server check failed',
        });
      });
    });
  });

  // ── 8. Polling behavior ───────────────────────────────────
  describe('Polling behavior', () => {
    let origSetInterval: typeof globalThis.setInterval;

    beforeEach(() => {
      vi.mocked(getLicenseStatus).mockResolvedValue(VALID_LICENSE_STATUS);
      origSetInterval = globalThis.setInterval;
    });

    afterEach(() => {
      // Always restore real timers + setInterval to prevent leakage.
      vi.useRealTimers();
      globalThis.setInterval = origSetInterval;
    });

    it('shows "Checking…" before first poll completes', async () => {
      vi.mocked(checkLicenseStatus).mockReturnValue(
        new Promise(() => {}), // never resolves
      );
      render(<LicenseSettings />);
      // waitFor: payload loads async → polling effect fires → "Checking…" renders
      await waitFor(() => {
        expect(screen.getByText('Checking…')).toBeInTheDocument();
      });
    });

    it('shows "Live" after successful poll with active status', async () => {
      vi.mocked(checkLicenseStatus).mockResolvedValue(SERVER_STATUS);
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText('Live')).toBeInTheDocument();
      });
    });

    it('shows "Inactive" after poll with inactive status', async () => {
      vi.mocked(checkLicenseStatus).mockResolvedValue({
        ...SERVER_STATUS,
        active: false,
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText('Inactive')).toBeInTheDocument();
      });
    });

    it('shows "Offline" after MAX_POLL_FAILURES consecutive failures', async () => {
      vi.mocked(checkLicenseStatus)
        .mockResolvedValueOnce(SERVER_STATUS)   // auto-poll (immediate)
        .mockRejectedValueOnce(new Error('f1')) // interval tick 1
        .mockRejectedValueOnce(new Error('f2')) // interval tick 2
        .mockRejectedValueOnce(new Error('f3')); // interval tick 3

      // Override setInterval to fire the callback 3× synchronously.
      globalThis.setInterval = ((fn: (...args: unknown[]) => void, _ms: number, ...args: unknown[]) => {
        fn(...args);
        fn(...args);
        fn(...args);
        return origSetInterval(fn, Number.MAX_SAFE_INTEGER, ...args);
      }) as typeof globalThis.setInterval;

      render(<LicenseSettings />);

      await waitFor(() => {
        expect(screen.getByText('Offline')).toBeInTheDocument();
      });
    });

    it('shows live dot with online class after successful poll', async () => {
      vi.mocked(checkLicenseStatus).mockResolvedValue(SERVER_STATUS);
      const { container } = render(<LicenseSettings />);
      await waitFor(() => {
        const dot = container.querySelector('.settings-license-live-dot--online');
        expect(dot).toBeInTheDocument();
      });
    });

    it('shows live dot with offline class after failures', async () => {
      vi.mocked(checkLicenseStatus)
        .mockResolvedValueOnce(SERVER_STATUS)   // auto-poll (immediate)
        .mockRejectedValueOnce(new Error('f1')) // interval tick 1
        .mockRejectedValueOnce(new Error('f2')) // interval tick 2
        .mockRejectedValueOnce(new Error('f3')); // interval tick 3

      globalThis.setInterval = ((fn: (...args: unknown[]) => void, _ms: number, ...args: unknown[]) => {
        fn(...args);
        fn(...args);
        fn(...args);
        return origSetInterval(fn, Number.MAX_SAFE_INTEGER, ...args);
      }) as typeof globalThis.setInterval;

      const { container } = render(<LicenseSettings />);

      await waitFor(() => {
        const dot = container.querySelector('.settings-license-live-dot--offline');
        expect(dot).toBeInTheDocument();
      });
    });

    it('shows last-checked timestamp after poll', async () => {
      vi.mocked(checkLicenseStatus).mockResolvedValue(SERVER_STATUS);
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText(/Last checked:/)).toBeInTheDocument();
        expect(screen.getByText(/just now/)).toBeInTheDocument();
      });
    });

    it('does not re-fire getLicenseStatus on parent re-render with unstable l10n', async () => {
      vi.mocked(checkLicenseStatus).mockResolvedValue(SERVER_STATUS);
      vi.mocked(getLicenseStatus).mockClear();

      // Simulate LocaleProvider creating a new ReactLocalization on every render
      // (the pre-fix behavior that caused the "Checking…" hang).
      let callCount = 0;
      mockUseLocalization.mockImplementation(() => ({
        l10n: { getString: (id: string) => mockL10n.getString(id), _seq: callCount++, bundles: [] },
      }));

      // Use a test harness that forces parent re-renders.
      function Harness() {
        const [, force] = useState(0);
        return (
          <div>
            <LicenseSettings />
            <button data-testid="force-render" onClick={() => force((n) => n + 1)}>
              Force
            </button>
          </div>
        );
      }

      render(<Harness />);

      // Wait for initial load + first poll to complete.
      await waitFor(() => {
        expect(screen.getByText('Live')).toBeInTheDocument();
      });

      // getLicenseStatus should be called exactly once (initial mount).
      expect(getLicenseStatus).toHaveBeenCalledTimes(1);
      expect(checkLicenseStatus).toHaveBeenCalledTimes(1);

      // Force several parent re-renders.
      const forceBtn = screen.getByTestId('force-render');
      await userEvent.click(forceBtn);
      await userEvent.click(forceBtn);
      await userEvent.click(forceBtn);

      // After re-renders with unstable l10n, getLicenseStatus must NOT have
      // been called again — the empty-dep useCallback for load() prevents it.
      expect(getLicenseStatus).toHaveBeenCalledTimes(1);
      // checkLicenseStatus should still be exactly 1 (the initial poll).
      // The polling effect's interval was never reset because pollTick has
      // stable deps (no l10n dependency).
      expect(checkLicenseStatus).toHaveBeenCalledTimes(1);
    });
  });

  // ── 8. Tier variants ──────────────────────────────────────
  describe('Tier badge variants', () => {
    it.each([
      ['free', 'Free', 'settings-license-value--tier-free'],
      ['pro', 'Pro', 'settings-license-value--tier-pro'],
      ['premium', 'Premium', 'settings-license-value--tier-premium'],
      ['enterprise', 'Enterprise', 'settings-license-value--tier-enterprise'],
    ])(
      'displays %s tier with label "%s" and CSS class %s',
      async (tierKey, expectedLabel, expectedClass) => {
        vi.mocked(getLicenseStatus).mockResolvedValue({
          ...VALID_LICENSE_STATUS,
          payload: JSON.stringify(makePayload({ tier_key: tierKey })),
        });
        const { container } = render(<LicenseSettings />);
        await waitFor(() => {
          expect(screen.getByText(expectedLabel)).toBeInTheDocument();
          expect(
            container.querySelector(`.${expectedClass}`),
          ).toBeInTheDocument();
        });
      },
    );

    it('shows raw tier slug for unknown tiers', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        ...VALID_LICENSE_STATUS,
        payload: JSON.stringify(makePayload({ tier_key: 'custom_tier' })),
      });
      render(<LicenseSettings />);
      await waitFor(() => {
        expect(screen.getByText('custom_tier')).toBeInTheDocument();
      });
    });
  });
});
