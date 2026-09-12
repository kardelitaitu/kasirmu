/**
 * Tests for `widget-registry` — dashboard widget registration and
 * feature filtering.
 *
 * The dashboard renders widgets from this registry dynamically, so the
 * feature-gate filtering and duplicate-id overwrite semantics are the
 * contracts to pin.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { screen } from '@testing-library/react';
import {
  clearWidgets,
  getWidgets,
  getDeniedWidgets,
  isWidgetAccessible,
  registerWidget,
} from '@/platform/ui/widget-registry';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import SalesDashboardScreen from '@/features/sales/SalesDashboardScreen';
import { registerSalesWidgets } from '@/features/sales/widgets';
import salesFtl from '@/locales/sales.ftl?raw';

const mockSession = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: mockSession() }),
}));

vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({
    enabled: new Set(['simple-retail']),
    loading: false,
    isEnabled: (key: string) => key === 'simple-retail',
    filterRoutes: (routes: string[]) => routes,
    error: null,
    loaded: true,
  }),
}));

const widget = (id: string, extra: Partial<Parameters<typeof registerWidget>[0]> = {}) => ({
  id,
  component: () => null,
  title: id,
  ...extra,
});

describe('widget-registry', () => {
  beforeEach(() => clearWidgets());

  it('registers and lists widgets in registration order', () => {
    registerWidget(widget('a'));
    registerWidget(widget('b'));
    expect(getWidgets().map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('overwrites a duplicate id with the last registration', () => {
    registerWidget(widget('a', { title: 'first' }));
    registerWidget(widget('a', { title: 'second' }));
    expect(getWidgets()).toHaveLength(1);
    expect(getWidgets()[0]!.title).toBe('second');
  });

  it('clearWidgets empties the registry', () => {
    registerWidget(widget('a'));
    clearWidgets();
    expect(getWidgets()).toHaveLength(0);
  });

  it('returns all widgets when enabledFeatures is omitted', () => {
    registerWidget(widget('a', { feature: 'pro' }));
    registerWidget(widget('b'));
    expect(getWidgets()).toHaveLength(2);
  });

  it('filters feature-gated widgets by the enabled set', () => {
    registerWidget(widget('a', { feature: 'pro' }));
    registerWidget(widget('b', { feature: 'base' }));
    registerWidget(widget('c')); // ungated — always shown
    const enabled = getWidgets(new Set(['base']));
    expect(enabled.map((w) => w.id)).toEqual(['b', 'c']);
  });

  it('shows all widgets when the enabled set does not contain the gate', () => {
    // A missing enabledFeatures means "everything enabled" (dashboard
    // default), NOT "nothing enabled".
    registerWidget(widget('a', { feature: 'pro' }));
    expect(getWidgets()).toHaveLength(1);
  });
});

/* ── permission gate ──────────────────────────────────────────────── */

describe('widget-registry access gate', () => {
  beforeEach(() => clearWidgets());

  /** The two tiles the sales dashboard registers: one export-gated, one not. */
  function registerPair(): void {
    registerWidget(
      widget('daily-total', {
        feature: 'simple-retail',
        requiredPermission: 'reports:export',
      }),
    );
    registerWidget(widget('pos-status'));
  }
  const STAFF = { userRole: 'Staff', permissions: ['sales:view'] };
  const MANAGER = { userRole: 'Manager', permissions: ['sales:view', 'reports:export'] };
  const ids = (list: { id: string }[]) => list.map((w) => w.id);

  it('registers the permission field the page and menu registries already carry', () => {
    expect(isWidgetAccessible({ requiredPermission: 'reports:export' }, STAFF)).toBe(false);
    expect(isWidgetAccessible({ requiredPermission: 'reports:export' }, MANAGER)).toBe(true);
    // No gate at all -> always accessible.
    expect(isWidgetAccessible(widget('a'), STAFF)).toBe(true);
    expect(isWidgetAccessible(undefined, STAFF)).toBe(true);
  });

  it('refuses the gated tile to a Staff session and reports it as denied', () => {
    registerPair();
    expect(ids(getWidgets(new Set(['simple-retail']), STAFF))).toEqual(['pos-status']);
    expect(ids(getDeniedWidgets(new Set(['simple-retail']), STAFF))).toEqual(['daily-total']);
  });

  it('shows the tile to a session that holds the key, denying nothing', () => {
    registerPair();
    expect(ids(getWidgets(new Set(['simple-retail']), MANAGER))).toEqual([
      'daily-total',
      'pos-status',
    ]);
    expect(getDeniedWidgets(new Set(['simple-retail']), MANAGER)).toEqual([]);
  });

  it('accepts the "*" and "reports:*" wildcards, like the backend does', () => {
    registerPair();
    for (const permissions of [['*'], ['reports:*'], ['reports:export']]) {
      expect(
        ids(getWidgets(new Set(['simple-retail']), { userRole: 'Owner', permissions })),
      ).toContain('daily-total');
    }
  });

  it('treats "no session data" as not enough information to deny', () => {
    registerPair();
    // No user supplied at all (a caller with no AuthProvider): the tile stays.
    expect(ids(getWidgets(new Set(['simple-retail'])))).toEqual(['daily-total', 'pos-status']);
    // Logged out is NOT the same thing: an empty grant set denies.
    expect(ids(getWidgets(new Set(['simple-retail']), { userRole: undefined, permissions: [] }))).toEqual(['pos-status']);
  });

  it('fails closed on a role gate when the user role is unknown', () => {
    registerWidget(widget('a', { requiredRole: 'manager' }));
    expect(getWidgets(undefined, { userRole: undefined, permissions: undefined })).toEqual([]);
    expect(ids(getDeniedWidgets(undefined, { userRole: 'Staff', permissions: undefined }))).toEqual(['a']);
    expect(ids(getWidgets(undefined, { userRole: 'Owner', permissions: undefined }))).toEqual(['a']);
  });

  it('visible + denied is exactly the feature-visible set', () => {
    registerPair();
    registerWidget(widget('hidden', { feature: 'pro' }));
    const enabled = new Set(['simple-retail']);
    for (const user of [STAFF, MANAGER, undefined]) {
      const seen = getWidgets(enabled, user).map((w) => w.id).sort();
      const refused = getDeniedWidgets(enabled, user).map((w) => w.id).sort();
      const every = ids(getWidgets()).filter((id) => id !== 'hidden').sort();
      expect([...seen, ...refused].sort()).toEqual(every);
    }
  });
});

/* ── the real sales registrations ─────────────────────────────────── */

describe('registerSalesWidgets declarations', () => {
  const enabled = new Set(['simple-retail']);
  const EXPORT_ONLY = { userRole: 'Manager', permissions: ['sales:view', 'reports:export'] };
  const VIEW_ONLY = { userRole: 'Auditor', permissions: ['audit:view', 'reports:view'] };
  const STAFF = { userRole: 'Staff', permissions: ['sales:view'] };
  const VIEW_TILES = ['revenue-line-chart', 'category-pie-chart', 'hourly-heatmap'];
  const EXPORT_TILES = ['daily-total', 'sales-by-hour'];

  beforeEach(() => {
    clearWidgets();
    registerSalesWidgets();
  });

  it('arms all five tiles, mirroring the permission each command checks', () => {
    const declared = Object.fromEntries(
      getWidgets().map((w) => [w.id, w.requiredPermission]),
    );
    // reports.rs:103/:261/:293 gate on REPORTS_VIEW through resolve_report_scope
    // (:109, :267, :299); history.rs:365/:389 gate on REPORTS_EXPORT.
    expect(declared).toEqual({
      'daily-total': 'reports:export',
      'sales-by-hour': 'reports:export',
      'revenue-line-chart': 'reports:view',
      'category-pie-chart': 'reports:view',
      'hourly-heatmap': 'reports:view',
    });
  });

  it('refuses every tile to a Staff session and reports each as denied, not removed', () => {
    expect(getWidgets(enabled, STAFF).map((w) => w.id)).toEqual([]);
    expect(getDeniedWidgets(enabled, STAFF).map((w) => w.id).sort()).toEqual(
      [...VIEW_TILES, ...EXPORT_TILES].sort(),
    );
  });

  it('keeps the three reports:view tiles for an Auditor, who holds no reports:export', () => {
    // rbac_presets.rs:266 — the only preset with reports:view and not
    // reports:export. If this test goes red, arming took data off a role.
    expect(getWidgets(enabled, VIEW_ONLY).map((w) => w.id).sort()).toEqual(
      [...VIEW_TILES].sort(),
    );
    expect(getDeniedWidgets(enabled, VIEW_ONLY).map((w) => w.id).sort()).toEqual(
      [...EXPORT_TILES].sort(),
    );
  });

  it('shows an export role its two tiles and refuses the reports:view three', () => {
    expect(getWidgets(enabled, EXPORT_ONLY).map((w) => w.id).sort()).toEqual(
      [...EXPORT_TILES].sort(),
    );
  });

  it('accepts the reports:* and "*" wildcards on every tile', () => {
    for (const permissions of [['reports:*'], ['*']]) {
      expect(getWidgets(enabled, { userRole: 'Owner', permissions })).toHaveLength(5);
      expect(getDeniedWidgets(enabled, { userRole: 'Owner', permissions })).toEqual([]);
    }
  });
});

/* ── what the user sees when the gate refuses ─────────────────────── */

describe('SalesDashboardScreen denied tile slot', () => {
  let mountedGated = false;

  beforeEach(() => {
    clearWidgets();
    mountedGated = false;
    registerWidget({
      id: 'daily-total',
      title: 'Daily Summary',
      feature: 'simple-retail',
      width: 2,
      requiredPermission: 'reports:export',
      component: () => {
        mountedGated = true;
        return createElement('div', null, '1,250.00');
      },
    });
    registerWidget({
      id: 'pos-status',
      title: 'POS Status',
      component: () => createElement('div', null, 'POS-OK'),
    });
  });

  it('keeps the slot, says so, and never mounts the widget for a Staff session', () => {
    mockSession.mockReturnValue({ role_name: 'Staff', permissions: ['sales:view'] });
    const { container } = renderWithFluentSync(createElement(SalesDashboardScreen), salesFtl);

    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument();
    expect(screen.getByText(/have permission to access Daily Summary/)).toBeInTheDocument();
    expect(screen.getByText(/required permission: reports:export/i)).toBeInTheDocument();
    // Refused, not removed: the slot is still a rendered tile in the grid.
    expect(container.querySelectorAll('.reporting-dashboard-empty')).toHaveLength(1);
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(mountedGated).toBe(false);
    // And the tile the user may see still shows its data.
    expect(screen.getByText('POS-OK')).toBeInTheDocument();
  });

  it('mounts the widget and shows the number for a manager session', () => {
    mockSession.mockReturnValue({ role_name: 'Manager', permissions: ['reports:export'] });
    renderWithFluentSync(createElement(SalesDashboardScreen), salesFtl);

    expect(mountedGated).toBe(true);
    expect(screen.getByText('1,250.00')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /access denied/i })).not.toBeInTheDocument();
  });
});
