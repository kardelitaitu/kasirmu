// ── Quota gate-parity (todo-tools.md L319) ──────────────────────
//
// Closes L319's "page/action quota gates separately" clause. The
// availability stack (Rust `explain_availability`, precedence
// server_policy > lifecycle > tier > quota > role > scope) surfaces a
// quota-denied feature as a `FeatureVerdict` with `reason: 'quota'` and
// `available: false`. The UI mirrors that verdict 1:1 (same wire codes,
// same camelCase fields) and the page/action layer reads `available` to
// hide/disable. This test pins that the IA/page layer honors the quota
// verdict: the only verdict consumer (`DiagnosticsSection`) reports the
// feature as unavailable with the quota reason rather than "Available".
//
// The resolver side of this contract — the availability precedence that
// produces `reason: 'quota'` from exceeded usage — is pinned by
// `verdict_names_quota_at_the_cap_and_clears_one_below`
// (apps/desktop-tauri/src/commands/subscription_tests.rs). This file is
// the UI half: it asserts the page/action layer honors that verdict.
//
// Does NOT touch the production page-registry gate (which gates on
// role/permission/feature-set only) — quota is an availability-axis
// verdict the registry does not yet consume, so the contract asserted
// here is the `FeatureVerdict` the page/action layer reads to gate.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, within } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import DiagnosticsSection from '@/features/settings/sections/DiagnosticsSection';
import { explainFeatureAvailability, type AvailabilityFeatureKey, type FeatureVerdict } from '@/api/subscription';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';

// ── Mock infra (mirrors DiagnosticsSection.test.tsx) ─────────────
const { invokeMock, verdictHandler } = vi.hoisted(() => {
  let handler: ((cmd: string, args?: unknown) => Promise<unknown>) | null = null;
  const impl = (cmd: string, args?: unknown): Promise<unknown> => {
    if (handler) return handler(cmd, args);
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

function renderSection() {
  vi.mocked(useWorkspace).mockReturnValue({
    ...workspaceValue,
    sessionToken: HARNESS_SESSION_TOKEN,
  });
  return renderWithProvidersSync(<DiagnosticsSection />, settingsFtl, sharedFtl);
}

// The availability stack's output for a Pro tenant at its 2-location cap.
const QUOTA_VERDICT: FeatureVerdict = {
  feature: 'locations',
  available: false,
  reason: 'quota',
  detail: {
    tier: 'pro',
    state: 'active',
    limit: 2,
    usage: 2,
    permission: 'inventory:locations_manage',
    scopeGranted: null,
    expiresAt: null,
    graceUntil: null,
  },
};

function availableElsewhere(feature: AvailabilityFeatureKey): FeatureVerdict {
  return {
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
  };
}

beforeEach(() => {
  cleanup();
  invokeMock.mockReset();
  verdictHandler.clear();
});
afterEach(() => {
  cleanup();
});

describe('L319 — page/action quota gate parity (FeatureVerdict.reason === "quota")', () => {
  it('gates a quota-denied feature: verdict unavailable + IA honors the quota reason', async () => {
    verdictHandler.set((cmd, args) => {
      if (cmd === 'explain_feature_availability_scoped') {
        const feature = (args as { feature?: string }).feature ?? '';
        if (feature === 'locations') return Promise.resolve(QUOTA_VERDICT);
        return Promise.resolve(availableElsewhere(feature as AvailabilityFeatureKey));
      }
      if (cmd === 'get_brand_settings') {
        return Promise.resolve({ primary_colour: '#4f46e5', logo_path: null, store_name: '' });
      }
      return Promise.resolve(undefined);
    });

    // The page/action layer reads this verdict to hide/disable the feature.
    const verdict = await explainFeatureAvailability(HARNESS_SESSION_TOKEN, 'locations');
    expect(verdict.feature).toBe('locations');
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toBe('quota');
    expect(verdict.detail.limit).toBe(2);
    expect(verdict.detail.usage).toBe(2);

    renderSection();
    const row = await screen.findByTestId('diagnostics-row-locations');
    // The IA surface that consumes verdicts honors the quota verdict:
    // the locations row is NOT "Available" and names the quota reason.
    await waitFor(() => expect(within(row).queryByText('Available')).not.toBeInTheDocument());
    expect(within(row).getByText('Quota reached')).toBeInTheDocument();
  });

  it('does not over-gate: a quota-irrelevant feature stays available alongside the quota denial', async () => {
    verdictHandler.set((cmd, args) => {
      if (cmd === 'explain_feature_availability_scoped') {
        const feature = (args as { feature?: string }).feature ?? '';
        if (feature === 'locations') return Promise.resolve(QUOTA_VERDICT);
        return Promise.resolve(availableElsewhere(feature as AvailabilityFeatureKey));
      }
      if (cmd === 'get_brand_settings') {
        return Promise.resolve({ primary_colour: '#4f46e5', logo_path: null, store_name: '' });
      }
      return Promise.resolve(undefined);
    });

    const verdict = await explainFeatureAvailability(HARNESS_SESSION_TOKEN, 'supports_analytics');
    expect(verdict.available).toBe(true);
    expect(verdict.reason).toBeNull();

    renderSection();
    const row = await screen.findByTestId('diagnostics-row-supports_analytics');
    await waitFor(() => expect(within(row).getByText('Available')).toBeInTheDocument());
    expect(within(row).queryByText('Quota reached')).not.toBeInTheDocument();
  });
});
