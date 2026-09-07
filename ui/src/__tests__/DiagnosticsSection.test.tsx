/**
 * @file DiagnosticsSection.test.tsx
 * @description Tests for Settings → System → Diagnostics — the feature-
 * availability verdict readout (todo-global-saas-3.md observability).
 *
 * Covers:
 *   - All ten v1 feature rows render once loaded
 *   - An unavailable feature renders its reason badge, not "Available"
 *   - The quota detail line renders usage/limit when the verdict carries them
 *   - The scope detail line renders the covered/not-covered phrasing
 *   - The expiry/grace detail fields render when present
 *   - A failed verdict batch renders the error hint (role="alert")
 *   - Session-token-less render fires no verdict calls
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import DiagnosticsSection from '@/features/settings/sections/DiagnosticsSection';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';

// ── Mock infra ────────────────────────────────────────────────────

const { invokeMock, verdictHandler } = vi.hoisted(() => {
  // Default: every feature available (dev-mock parity), overridable
  // per test via verdictHandler.current.
  let handler: ((cmd: string, args?: unknown) => Promise<unknown>) | null = null;
  const impl = (cmd: string, args?: unknown): Promise<unknown> => {
    if (handler) return handler(cmd, args);
    if (cmd === 'explain_feature_availability_scoped') {
      const feature = (args as { feature?: string })?.feature ?? '';
      return Promise.resolve({
        feature,
        available: true,
        reason: null,
        detail: {
          tier: 'premium',
          state: 'active',
          limit: null,
          usage: null,
          permission: null,
          scopeGranted: null,
          expiresAt: null,
          graceUntil: null,
        },
      });
    }
    if (cmd === 'get_brand_settings') {
      return Promise.resolve({ primary_colour: '#4f46e5', logo_path: null, store_name: '' });
    }
    return Promise.resolve(undefined);
  };
  return {
    invokeMock: vi.fn(impl),
    verdictHandler: {
      set: (h: typeof handler) => {
        handler = h;
      },
      clear: () => {
        handler = null;
      },
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

const workspaceValue = {
  activeWorkspace: 'admin' as const,
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
  sessionToken: 'test-token',
  swapSessionToken: vi.fn(),
  terminalId: '',
};

function renderSection(withToken = true) {
  // The global test-setup mock owns useWorkspace; per the setup's
  // documented pattern, per-test overrides go through vi.mocked.
  vi.mocked(useWorkspace).mockReturnValue({
    ...workspaceValue,
    sessionToken: withToken ? HARNESS_SESSION_TOKEN : null,
  });
  return renderWithProvidersSync(<DiagnosticsSection />, settingsFtl, sharedFtl);
}

const ALL_KEYS = [
  'supports_qris',
  'supports_analytics',
  'supports_loyalty',
  'supports_daily_dashboard',
  'supports_cloud_sync',
  'sales_history_days',
  'locations',
  'staff_users',
  'pos_instances',
  'warehouses',
];

beforeEach(() => {
  cleanup();
  invokeMock.mockReset();
  verdictHandler.clear();
});

afterEach(() => {
  cleanup();
});

// ── Tests ─────────────────────────────────────────────────────────

describe('DiagnosticsSection', () => {
  it('renders all ten v1 feature rows with the available badge', async () => {
    renderSection();
    await waitFor(() => {
      expect(screen.getAllByText('Available')).toHaveLength(ALL_KEYS.length);
    });
    for (const key of ALL_KEYS) {
      expect(screen.getByTestId('diagnostics-row-' + key)).toBeInTheDocument();
    }
    // Every verdict call carried the session token.
    const calls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'explain_feature_availability_scoped');
    expect(calls).toHaveLength(ALL_KEYS.length);
    for (const [, args] of calls) {
      expect((args as { sessionToken: string }).sessionToken).toBe(HARNESS_SESSION_TOKEN);
    }
  });

  it('renders the reason badge for an unavailable feature', async () => {
    verdictHandler.set((_cmd, args) => {
      const feature = (args as { feature?: string })?.feature ?? '';
      if (feature === 'supports_analytics') {
        return Promise.resolve({
          feature,
          available: false,
          reason: 'tier',
          detail: {
            tier: 'plus',
            state: 'active',
            limit: null,
            usage: null,
            permission: 'analytics:view',
            scopeGranted: null,
            expiresAt: null,
            graceUntil: null,
          },
        });
      }
      const f = feature;
      return Promise.resolve({
        feature: f,
        available: true,
        reason: null,
        detail: {
          tier: 'premium',
          state: 'active',
          limit: null,
          usage: null,
          permission: null,
          scopeGranted: null,
          expiresAt: null,
          graceUntil: null,
        },
      });
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('Not in this tier')).toBeInTheDocument();
    });
    // Nine rows stay available, one names the tier reason.
    expect(screen.getAllByText('Available')).toHaveLength(9);
  });

  it('renders the quota detail line when the verdict carries usage and limit', async () => {
    verdictHandler.set((_cmd, args) => {
      const feature = (args as { feature?: string })?.feature ?? '';
      if (feature === 'locations') {
        return Promise.resolve({
          feature,
          available: false,
          reason: 'quota',
          detail: {
            tier: 'pro',
            state: 'active',
            limit: 2,
            usage: 2,
            permission: 'topology:write',
            scopeGranted: null,
            expiresAt: null,
            graceUntil: null,
          },
        });
      }
      return Promise.resolve({
        feature,
        available: true,
        reason: null,
        detail: {
          tier: 'premium',
          state: 'active',
          limit: null,
          usage: null,
          permission: null,
          scopeGranted: null,
          expiresAt: null,
          graceUntil: null,
        },
      });
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('Usage: 2 / 2')).toBeInTheDocument();
    });
    expect(screen.getByText('Quota reached')).toBeInTheDocument();
  });

  it('renders the scope coverage detail when the verdict carries it', async () => {
    verdictHandler.set((_cmd, args) => {
      const feature = (args as { feature?: string })?.feature ?? '';
      if (feature === 'supports_loyalty') {
        return Promise.resolve({
          feature,
          available: false,
          reason: 'scope',
          detail: {
            tier: 'premium',
            state: 'active',
            limit: null,
            usage: null,
            permission: 'loyalty:view',
            scopeGranted: false,
            expiresAt: null,
            graceUntil: null,
          },
        });
      }
      return Promise.resolve({
        feature,
        available: true,
        reason: null,
        detail: {
          tier: 'premium',
          state: 'active',
          limit: null,
          usage: null,
          permission: null,
          scopeGranted: null,
          expiresAt: null,
          graceUntil: null,
        },
      });
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('Does not cover this location')).toBeInTheDocument();
    });
    expect(screen.getByText('Out of location scope')).toBeInTheDocument();
  });

  it('renders expiry and grace details when present', async () => {
    verdictHandler.set((_cmd, args) => {
      const feature = (args as { feature?: string })?.feature ?? '';
      if (feature === 'supports_loyalty') {
        return Promise.resolve({
          feature,
          available: false,
          reason: 'lifecycle',
          detail: {
            tier: 'premium',
            state: 'expired',
            limit: null,
            usage: null,
            permission: 'loyalty:view',
            scopeGranted: null,
            expiresAt: '2025-01-01T00:00:00Z',
            graceUntil: null,
          },
        });
      }
      if (feature === 'supports_analytics') {
        return Promise.resolve({
          feature,
          available: true,
          reason: null,
          detail: {
            tier: 'premium',
            state: 'grace',
            limit: null,
            usage: null,
            permission: 'analytics:view',
            scopeGranted: null,
            expiresAt: '2026-09-01T00:00:00Z',
            graceUntil: '2026-10-31T00:00:00Z',
          },
        });
      }
      return Promise.resolve({
        feature,
        available: true,
        reason: null,
        detail: {
          tier: 'premium',
          state: 'active',
          limit: null,
          usage: null,
          permission: null,
          scopeGranted: null,
          expiresAt: null,
          graceUntil: null,
        },
      });
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('Subscription ended')).toBeInTheDocument();
      expect(screen.getByText('Expires: 2025-01-01T00:00:00Z')).toBeInTheDocument();
      expect(screen.getByText('Grace until: 2026-10-31T00:00:00Z')).toBeInTheDocument();
    });
  });

  it('renders the error hint when the verdict batch fails', async () => {
    verdictHandler.set(() => Promise.reject(new Error('ipc down')));
    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId('diagnostics-failed')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('fires no verdict calls without a session token', async () => {
    renderSection(false);
    // Let any (wrongly) fired promise settle.
    await new Promise((r) => setTimeout(r, 20));
    const calls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'explain_feature_availability_scoped');
    expect(calls).toHaveLength(0);
    // All rows stay in the pending state.
    expect(screen.getAllByText('…')).toHaveLength(ALL_KEYS.length);
  });
});
