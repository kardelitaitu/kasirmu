import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

// ── SyncConflictsPanel — the bulk requeue must not run twice ────────────────
//
// "Requeue all" walks the dead-lettered list and issues one command per row. Two taps
// inside one tick reach the handler twice, because \`requeueingAll\` is STATE and React
// commits it on the next render. The second walk re-issues every row it already
// requeued and restarts the progress bar at 1 of N while the first walk is still going.

const mocks = vi.hoisted(() => ({
  listRemoteFailures: vi.fn(),
  requeueRemoteFailure: vi.fn(),
}));

vi.mock('@/api/offline', () => ({
  listRemoteFailuresScoped: (...a: unknown[]) => mocks.listRemoteFailures(...a),
  requeueRemoteFailureScoped: (...a: unknown[]) => mocks.requeueRemoteFailure(...a),
}));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1' }),
}));
vi.mock('@/app/Tooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { SyncConflictsPanel } from '@/features/settings/SyncConflictsPanel';

const FAILURES = [
  { itemId: 'remote-1', action: 'upsert_sale', payload: '{}', attempts: 3, lastError: 'a', deadLettered: true },
  { itemId: 'remote-2', action: 'upsert_sale', payload: '{}', attempts: 3, lastError: 'b', deadLettered: true },
];

describe('SyncConflictsPanel — bulk requeue', () => {
  beforeEach(() => {
    mocks.listRemoteFailures.mockReset().mockResolvedValue(FAILURES);
    mocks.requeueRemoteFailure.mockReset().mockResolvedValue(undefined);
  });

  it('requeues each dead-lettered row once when Requeue all is double-tapped', async () => {
    // Undiciable per-row queue: the FIRST row's call stays pending, so the first walk is
    // still in flight when the second tap fires. Row 2 must never leave the first walk's
    // shadow, which is what makes "called exactly once per row" a real assertion.
    const gates: Array<() => void> = [];
    mocks.requeueRemoteFailure.mockImplementation(() => new Promise<void>((res) => { gates.push(res); }));

    renderWithProvidersSync(<SyncConflictsPanel />, settingsFtl, sharedFtl);

    const btn = await screen.findByRole('button', { name: /requeue all quarantined sync conflicts/i });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });

    // Drain the gates in waves: each resolution lets the loop ask for the next row.
    for (let i = 0; i < 4 && gates.length > 0 && mocks.requeueRemoteFailure.mock.calls.length < 4; i += 1) {
      const pending = gates.splice(0, gates.length);
      await act(async () => { pending.forEach((release) => release()); });
    }

    expect(
      mocks.requeueRemoteFailure.mock.calls.map((c) => c[1]),
      'a double tap requeued rows twice',
    ).toEqual(['remote-1', 'remote-2']);
  });
});
