/**
 * @file OverQuotaCard.test.tsx
 * @description Tests for the §J downgrade remediation card
 * (todo-global-saas-2.md), added by aa420395. The commit shipped the card
 * with two desktop Rust tests and one tablet mirror; the 139-line
 * component and its two exported helpers had no UI test at all, so every
 * branch that decides whether the owner sees "within quota" or a real
 * excess was unobserved.
 *
 * Covers:
 *   - The all-clear renders only from an assessment that says so
 *   - Nothing is claimed before the assessment arrives (report === null)
 *   - A failed assessment never reads as all-clear
 *   - Each over dimension renders its own label, current/limit and excess
 *   - At-cap is within quota (the strictly-greater rule)
 *   - An unlimited dimension is never over, however large the usage
 *   - The alert's Refresh retries the assessment
 *
 * B1 added the two remediation actions, covered below:
 *   - They are offered while the tenant is within quota (recovery state)
 *   - Suspend sends the store the hint names, and reports its count
 *   - A 0 count says "nothing to change" rather than going quiet
 *   - A rejected action surfaces failure without discarding the assessment
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import OverQuotaCard from '@/features/settings/OverQuotaCard';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';
import { setShellKind } from '@/utils/shellKind';
import type { QuotaUsageRow, OverQuotaMarkerRow } from '@/api/subscription';

const { invokeMock, reportHandler } = vi.hoisted(() => {
  let handler: ((cmd: string, args?: unknown) => Promise<unknown>) | null = null;
  const impl = (cmd: string, args?: unknown): Promise<unknown> => {
    if (handler) return handler(cmd, args);
    if (cmd === 'get_over_quota_report_scoped') {
      return Promise.resolve({
        tierKey: 'premium',
        tierName: 'Premium',
        usages: [
          { dimension: 'locations', limit: null, current: 1 },
          { dimension: 'pos_registers', limit: null, current: 1 },
          { dimension: 'warehouses', limit: null, current: 0 },
          { dimension: 'staff', limit: null, current: 1 },
          { dimension: 'products', limit: null, current: 0 },
        ],
        // Slice C §J: optional markers array. The card ignores it for now, but
        // the payload must carry the shape without breaking the type.
        markers: [],
      });
    }
    if (cmd === 'get_brand_settings') {
      return Promise.resolve({ primary_colour: '#4f46e5', logo_path: null, store_name: '' });
    }
    // §J B1: both remediation commands answer a COUNT (Result<u32>), which is
    // the shape the dev-mock used to get wrong by answering []. Defaults here
    // keep the pre-existing tests untouched; the remediation tests install a
    // handler and assert the payload they send.
    if (cmd === 'suspend_surplus_workspace_instances_scoped') return Promise.resolve(2);
    if (cmd === 'recover_workspace_instances_scoped') return Promise.resolve(1);
    return Promise.resolve(undefined);
  };
  return {
    invokeMock: vi.fn(impl),
    reportHandler: {
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
  // B1 added two calls that DO carry arguments, so the mock now forwards both.
  // This file previously kept arity at 1 on purpose, so an unexpected argument
  // was visible by construction. That guarantee is not free any more, so it
  // moved into the remediation tests below, which assert the exact payload
  // instead of relying on a mock that would drop it.
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

vi.mocked(useWorkspace).mockReturnValue({
  activeWorkspace: 'admin',
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
  sessionToken: HARNESS_SESSION_TOKEN,
  swapSessionToken: vi.fn(),
  terminalId: '',
});

/** One usage row as the Rust QuotaUsage serialises it. */
const row = (dimension: string, limit: number | null, current: number): QuotaUsageRow => ({
  dimension,
  limit,
  current,
});

/** A report carrying exactly these rows. */
function reportWith(usages: QuotaUsageRow[], markers: OverQuotaMarkerRow[] = []) {
  return { tierKey: 'premium', tierName: 'Premium', usages, markers };
}

function renderWithRows(usages: QuotaUsageRow[]) {
  reportHandler.set(() => Promise.resolve(reportWith(usages)));
  return renderWithProvidersSync(<OverQuotaCard />, settingsFtl, sharedFtl);
}

beforeEach(() => {
  cleanup();
  invokeMock.mockReset();
  reportHandler.clear();
});

afterEach(() => {
  cleanup();
});

describe('OverQuotaCard', () => {
  it('renders the all-clear when nothing exceeds its cap', async () => {
    renderWithProvidersSync(<OverQuotaCard />, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-ok')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('over-quota-over')).not.toBeInTheDocument();
    expect(screen.getByText('Everything is within quota.')).toBeInTheDocument();
  });

  it('claims nothing while the assessment is still in flight', () => {
    // The all-clear branch is guarded by `report !== null`, and that guard
    // is the difference between "within quota" and "not measured yet".
    // Drop it and every mount flashes a clean bill of health before the
    // IPC has answered — the exact reassurance this card must not give
    // without evidence.
    // A promise that never settles: the card is stuck in "measuring",
    // which is a third state the render must not resolve into either
    // verdict. That the settled path does render is covered by the five
    // tests below, so this one only has to hold the line on the empty
    // report state.
    reportHandler.set(() => new Promise(() => {}));
    renderWithProvidersSync(<OverQuotaCard />, settingsFtl, sharedFtl);

    expect(screen.queryByTestId('over-quota-ok')).not.toBeInTheDocument();
    expect(screen.queryByTestId('over-quota-over')).not.toBeInTheDocument();
    expect(screen.queryByTestId('over-quota-failed')).not.toBeInTheDocument();
    expect(
      // W6-C re-wired the read to the scoped command; the filter tracks the
      // call the card actually makes, or the count is always 0.
      invokeMock.mock.calls.filter(([cmd]) => cmd === 'get_over_quota_report_scoped'),
    ).toHaveLength(1);
  });

  it('never reads a failed assessment as all-clear', async () => {
    // The card must not tell an owner they are fine precisely when it
    // cannot know. Note what this can and cannot reach: on a first-load
    // failure `report` is still null, so the `report !== null` guard
    // already hides the all-clear and this test would pass without
    // `!failed`. The guard earns its place on a RE-check that fails —
    // session token changes, `refresh` re-runs, and the previous
    // all-clear is still sitting in state next to the new alert. No
    // in-test trigger reaches that path (the only retry affordance lives
    // inside the alert itself), so it is recorded here rather than
    // asserted: deleting `!failed` survives the suite.
    reportHandler.set(() => Promise.reject(new Error('ipc down')));
    renderWithProvidersSync(<OverQuotaCard />, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-failed')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('over-quota-ok')).not.toBeInTheDocument();
    expect(screen.queryByTestId('over-quota-over')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('lists each over dimension with its own label, counts and excess', async () => {
    renderWithRows([
      row('locations', 5, 7),
      row('staff', 10, 12),
      row('warehouses', 2, 1),
    ]);
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-over')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('over-quota-ok')).not.toBeInTheDocument();

    // Only the two over rows are listed; the one under its cap is not.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Locations')).toBeInTheDocument();
    expect(screen.getByText('Staff accounts')).toBeInTheDocument();
    expect(screen.queryByText('Warehouse stock points')).not.toBeInTheDocument();
    // excessOf: current - limit, per dimension, not a shared total.
    expect(screen.getByText('7 of 5 — 2 over')).toBeInTheDocument();
    expect(screen.getByText('12 of 10 — 2 over')).toBeInTheDocument();
    expect(screen.getByText('Over quota — archive or upgrade')).toBeInTheDocument();
    expect(screen.getByText(/Nothing was deleted automatically/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Over-quota resources' })).toBeInTheDocument();
  });

  it('treats a dimension sitting exactly on its cap as within quota', async () => {
    // The rule is strictly greater, on both the filter and the arithmetic.
    // `>=` instead of `>` would tell an owner at the limit to archive
    // resources they are allowed to keep — and "0 over" is a nonsense
    // excess that the Rust side (is_over_quota) never reports.
    renderWithRows([row('locations', 5, 5), row('pos_registers', 1, 1)]);
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-ok')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('over-quota-over')).not.toBeInTheDocument();
    expect(screen.queryByText(/over$/)).not.toBeInTheDocument();
  });

  it('never calls an unlimited dimension over quota, however large the usage', async () => {
    // `limit: null` is unlimited, not zero. Reading null as 0 (or dropping
    // the null arm) turns every Premium tenant into an over-quota tenant
    // the moment they hold anything — and the card would then demand they
    // archive resources against a cap of 0.
    renderWithRows([row('locations', null, 999), row('products', null, 4000)]);
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-ok')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('over-quota-over')).not.toBeInTheDocument();
  });

  it('accepts persisted markers in the payload without changing the display', async () => {
    // Slice C §J adds an optional `markers` array to OverQuotaReport. The card
    // renders only from `usages` (markers are surfaced elsewhere / later), so a
    // payload carrying markers must render exactly as one without them.
    reportHandler.set(() =>
      Promise.resolve({
        tierKey: 'premium',
        tierName: 'Premium',
        usages: [row('locations', 5, 7), row('staff', 10, 12)],
        markers: [
          { resourceId: 'default', resourceType: 'locations', dimension: 'locations', severity: 'over' as const, limit: 5, current: 7, markedAt: '2026-09-22T00:00:00.000Z' },
          { resourceId: 'default', resourceType: 'staff', dimension: 'staff', severity: 'over' as const, limit: 10, current: 12, markedAt: '2026-09-22T00:00:00.000Z' },
        ],
      }),
    );
    renderWithProvidersSync(<OverQuotaCard />, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-over')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('7 of 5 — 2 over')).toBeInTheDocument();
    expect(screen.getByText('12 of 10 — 2 over')).toBeInTheDocument();
  });

  it('retries the assessment from the alert and recovers', async () => {
    // The alert carries the only retry affordance on the card, so the
    // recovery path has to be the tested one: setFailed(false) at the top
    // of refresh is what retires it.
    let failing = true;
    reportHandler.set(() =>
      failing ? Promise.reject(new Error('ipc down')) : Promise.resolve(reportWith([row('locations', 2, 5)])),
    );
    renderWithProvidersSync(<OverQuotaCard />, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-failed')).toBeInTheDocument();
    });

    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(screen.queryByTestId('over-quota-failed')).not.toBeInTheDocument();
      expect(screen.getByText('5 of 2 — 3 over')).toBeInTheDocument();
    });
    const calls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'get_over_quota_report_scoped',
    );
    expect(calls).toHaveLength(2);
  });

  // ── §J B1: the two remediation actions ─────────────────────────────────
  it('offers the remediation actions while everything is within quota', async () => {
    // The recovery half of §J matters most when the numbers already look clean:
    // after an upgrade the tenant is within quota, but the registers a downgrade
    // suspended are still suspended. Gate this section on an over-quota row and
    // the only route back from a suspension becomes a support ticket — in the
    // one state where the owner has already paid to fix it.
    reportHandler.set(() => Promise.resolve(reportWith([row('locations', 5, 1)])));
    renderWithProvidersSync(<OverQuotaCard />, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-ok')).toBeInTheDocument();
    });
    expect(screen.getByTestId('over-quota-remedy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend surplus' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore suspended' })).toBeInTheDocument();
  });

  it('suspends the store the session is bound to and reports the count returned', async () => {
    let sent: unknown;
    reportHandler.set((cmd, args) => {
      if (cmd === 'suspend_surplus_workspace_instances_scoped') {
        sent = args;
        return Promise.resolve(3);
      }
      return Promise.resolve(reportWith([row('pos_registers', 2, 5)]));
    });
    renderWithProvidersSync(<OverQuotaCard />, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-remedy')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Suspend surplus' }));
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-remedy-note')).toHaveTextContent(
        '3 surplus register(s) suspended',
      );
    });
    // The payload assertion replaces what the old arity-1 mock enforced
    // structurally: the command has to receive the store the hint names, and
    // the key must be present as storeId (the wire name for the Rust
    // Option<String>). A call that silently dropped it would still render a
    // plausible success — the backend falls back to the session store — which
    // is exactly why it is asserted rather than assumed.
    expect(sent).toEqual({ sessionToken: HARNESS_SESSION_TOKEN, storeId: 'default' });
  });

  it('says so when an action changes nothing, instead of going quiet', async () => {
    // count === 0 is a real answer with an opposite meaning to "the button did
    // nothing". Both commands return 0 when the store has no surplus and
    // nothing suspended, so an unhandled 0 reads as a broken control.
    reportHandler.set((cmd) => {
      if (cmd === 'recover_workspace_instances_scoped') return Promise.resolve(0);
      return Promise.resolve(reportWith([row('locations', 5, 1)]));
    });
    renderWithProvidersSync(<OverQuotaCard />, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-remedy')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restore suspended' }));
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-remedy-note')).toHaveTextContent('Nothing to change');
    });
  });

  it('surfaces a rejected action without discarding the assessment it already had', async () => {
    reportHandler.set((cmd) => {
      if (cmd === 'suspend_surplus_workspace_instances_scoped') {
        return Promise.reject(new Error('unknown store: nope'));
      }
      return Promise.resolve(reportWith([row('pos_registers', 2, 5)]));
    });
    renderWithProvidersSync(<OverQuotaCard />, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('5 of 2 — 3 over')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Suspend surplus' }));
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-remedy-note')).toHaveTextContent('That action failed');
    });
    // The failure is about the action, not the assessment: the over-quota rows
    // must survive it, or a failed button press would look like the excess
    // resolved itself.
    expect(screen.getByText('5 of 2 — 3 over')).toBeInTheDocument();
    expect(screen.queryByTestId('over-quota-failed')).not.toBeInTheDocument();
  });

  it('lists per-location rows and acts on the row store, not the session store', async () => {
    // §J B3: the row IS the picker. A location other than the session's must be
    // remediable directly, and the payload must name THAT store. A regression
    // here would suspend registers in one location while the owner reads a row
    // about another, which is the exact class of wrong-target bug B1's validator
    // exists to prevent.
    const other: OverQuotaMarkerRow = {
      resourceId: 'store-7',
      resourceType: 'kds_screen',
      dimension: 'kds_screens',
      severity: 'over',
      limit: 2,
      current: 4,
      markedAt: '2026-09-09T00:00:00.000Z',
    };
    // Marker S4: the third per-location kind. The label lookup used to be a
    // two-way ternary whose else branch was the WAREHOUSES label, so this row
    // would have rendered mislabeled; the map lookup must name it its own key.
    const aggregate: OverQuotaMarkerRow = {
      resourceId: 'store-7',
      resourceType: 'topology_node',
      dimension: 'topology_nodes',
      severity: 'over',
      limit: 5,
      current: 9,
      markedAt: '2026-09-10T00:00:00.000Z',
    };
    const sent: unknown[] = [];
    reportHandler.set((cmd, args) => {
      if (cmd === 'suspend_surplus_workspace_instances_scoped') {
        sent.push(args);
        return Promise.resolve(2);
      }
      return Promise.resolve(reportWith([row('locations', 5, 1)], [other, aggregate]));
    });
    renderWithProvidersSync(<OverQuotaCard />, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-locations')).toBeInTheDocument();
    });
    // The dimension label resolves from the real FTL — proving the key for a
    // dimension that has no tenant-global usage row was actually added — and
    // the topology aggregate gets its OWN label, not the warehouses one.
    expect(screen.getByText('KDS screens (this location)')).toBeInTheDocument();
    expect(screen.getByText('Topology nodes (this store)')).toBeInTheDocument();
    expect(screen.queryByText('Warehouse stock points')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('over-quota-location-row')).toHaveLength(2);
    expect(screen.getByText('4 of 2 — 2 over')).toBeInTheDocument();
    expect(screen.getByText('9 of 5 — 4 over')).toBeInTheDocument();
    // Scoped to the row rather than picked out of a flat list: this also proves
    // the affordance belongs to that location, not merely that one exists.
    // `locRow`, not `row`: this file already has a module-level row() fixture
    // helper, and shadowing it inside the test makes the earlier row(...) call in
    // the same block stop typechecking.
    const locRow = screen.getAllByTestId('over-quota-location-row')[0]!;
    expect(within(locRow).getByRole('button', { name: 'Suspend surplus' })).toBeInTheDocument();
    fireEvent.click(within(locRow).getByRole('button', { name: 'Suspend surplus' }));
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]).toEqual({ sessionToken: HARNESS_SESSION_TOKEN, storeId: 'store-7' });
  });

  it('surfaces the backend refusal when a per-location row no longer resolves', async () => {
    // A stale report can name a store that has since been deleted. The validator
    // rejects it rather than opening a database, and the card must show that
    // reason instead of collapsing it into a generic failure — a hidden no-op is
    // the failure shape this whole slice is built to avoid.
    const ghost: OverQuotaMarkerRow = {
      resourceId: 'store-gone',
      resourceType: 'warehouse',
      dimension: 'warehouses',
      severity: 'at',
      limit: 1,
      current: 1,
      markedAt: '2026-09-09T00:00:00.000Z',
    };
    reportHandler.set((cmd) => {
      if (cmd === 'suspend_surplus_workspace_instances_scoped') {
        // The typed AppError shape as it crosses the IPC boundary, not a plain
        // Error carrying the backend's sentence: ERR-05/06 requires the message
        // be mapped by kind. `invalid` is what B1's validator returns for an
        // unknown store.
        return Promise.reject({ kind: 'invalid', message: 'unknown store: store-gone' });
      }
      return Promise.resolve(reportWith([row('locations', 5, 1)], [ghost]));
    });
    renderWithProvidersSync(<OverQuotaCard />, settingsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-locations')).toBeInTheDocument();
    });
    const locRow = screen.getByTestId('over-quota-location-row');
    fireEvent.click(within(locRow).getByRole('button', { name: 'Suspend surplus' }));
    await waitFor(() => {
      expect(screen.getByTestId('over-quota-remedy-note')).toHaveTextContent(
        'Please check the information you entered',
      );
    });
    // Which row failed is still legible — the note prints the store id — so the
    // owner learns the refusal applied to `store-gone` without any backend
    // sentence reaching the DOM.
    expect(screen.getByTestId('over-quota-remedy-note')).toHaveTextContent('store-gone');
    // And the point of the mapping: the raw message must not leak. This is the
    // assertion that would have failed the first version of this slice.
    expect(screen.getByTestId('over-quota-remedy-note')).not.toHaveTextContent(
      'unknown store:',
    );
  });

  // ── Shell-gated remediation actions ────────────────────────
  //
  // suspend_surplus_workspace_instances_scoped and
  // recover_workspace_instances_scoped are registered on the desktop shell
  // only, so the tablet renders the assessment without the two actions. The
  // store-level block AND the per-location row buttons are both gated; a
  // per-location row that kept its buttons would be the same always-failing
  // control in a smaller container.
  describe('Shell-gated remediation actions', () => {
    afterEach(() => {
      // Restored, so no later case can inherit the tablet shell.
      setShellKind('desktop');
    });

    const ghostMarker: OverQuotaMarkerRow = {
      resourceId: 'store-7',
      resourceType: 'warehouse',
      dimension: 'warehouses',
      severity: 'at',
      limit: 1,
      current: 1,
      markedAt: '2026-09-09T00:00:00.000Z',
    };

    function renderRemediable() {
      reportHandler.set(() =>
        Promise.resolve(reportWith([row('locations', 5, 1)], [ghostMarker])),
      );
      return renderWithProvidersSync(<OverQuotaCard />, settingsFtl, sharedFtl);
    }

    it('offers both remedies on the desktop shell', async () => {
      setShellKind('desktop');
      renderRemediable();
      await waitFor(() => {
        expect(screen.getByTestId('over-quota-locations')).toBeInTheDocument();
      });
      expect(screen.getByTestId('over-quota-remedy')).toBeInTheDocument();
      expect(screen.getByTestId('over-quota-remedy-suspend')).toBeInTheDocument();
      expect(screen.getByTestId('over-quota-remedy-recover')).toBeInTheDocument();
      expect(
        within(screen.getByTestId('over-quota-location-row')).getByRole('button', {
          name: 'Suspend surplus',
        }),
      ).toBeInTheDocument();
    });

    it('hides the store-level remedies on the tablet shell but keeps the assessment', async () => {
      setShellKind('tablet');
      renderRemediable();
      await waitFor(() => {
        expect(screen.getByTestId('over-quota-locations')).toBeInTheDocument();
      });
      // The assessment the tablet CAN read is still there...
      expect(screen.getByTestId('over-quota-remedy')).toBeInTheDocument();
      // ...with no action that cannot run.
      expect(screen.queryByTestId('over-quota-remedy-suspend')).not.toBeInTheDocument();
      expect(screen.queryByTestId('over-quota-remedy-recover')).not.toBeInTheDocument();
    });

    it('hides the per-location row buttons on the tablet shell', async () => {
      setShellKind('tablet');
      renderRemediable();
      await waitFor(() => {
        expect(screen.getByTestId('over-quota-location-row')).toBeInTheDocument();
      });
      expect(
        within(screen.getByTestId('over-quota-location-row')).queryByRole('button'),
      ).toBeNull();
    });
  });
});
