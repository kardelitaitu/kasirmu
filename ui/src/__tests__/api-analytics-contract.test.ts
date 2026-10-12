/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── IPC contract tests for analytics.ts (analytics:view) ────────────
//
// Pins the analytics wire shape: both scoped commands carry sessionToken
// plus the inclusive [from, to] YYYY-MM-DD range, and the daily series adds
// the staff userId. A rename or a dropped argument breaks these tests
// deliberately.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import { getStaffAnalyticsScoped, getStaffAnalyticsDailyScoped } from '@/api/analytics';

const staffRow = {
  user_id: 'user-staff',
  display_name: 'Staff',
  shift_count: 1,
  closed_shift_count: 1,
  shift_sales_minor: 20000,
  sale_count: 2,
  sale_total_minor: 20000,
};

const dailyRow = {
  day: '2026-07-10',
  sale_count: 2,
  sale_total_minor: 20000,
  shift_count: 1,
  shift_sales_minor: 20000,
};

describe('analytics.ts scoped IPC contract (analytics:view)', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('getStaffAnalyticsScoped sends sessionToken + inclusive date range', async () => {
    mockInvoke.mockResolvedValue([staffRow]);
    const rows = await getStaffAnalyticsScoped('session-1', '2026-07-01', '2026-07-31');
    expect(mockInvoke).toHaveBeenCalledWith('get_staff_analytics_scoped', {
      sessionToken: 'session-1',
      from: '2026-07-01',
      to: '2026-07-31',
    });
    expect(rows).toEqual([staffRow]);
  });

  it('getStaffAnalyticsDailyScoped sends sessionToken + userId + range', async () => {
    mockInvoke.mockResolvedValue([dailyRow]);
    const rows = await getStaffAnalyticsDailyScoped(
      'session-1',
      'user-staff',
      '2026-07-01',
      '2026-07-31',
    );
    expect(mockInvoke).toHaveBeenCalledWith('get_staff_analytics_daily_scoped', {
      sessionToken: 'session-1',
      userId: 'user-staff',
      from: '2026-07-01',
      to: '2026-07-31',
    });
    expect(rows).toEqual([dailyRow]);
  });
});
