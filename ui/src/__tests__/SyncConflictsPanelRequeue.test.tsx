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

  it('keeps walking when ONE row is refused, and reports the partial count', async () => {
    // Requeueing a row that is no longer dead-lettered returns CoreError::NotFound
    // (remote.rs:192-195) — a NORMAL outcome, because the operator may have used the
    // row button a moment earlier. The old loop let that single refusal throw out of
    // the walk, so row 2 was never attempted. Both facts are asserted: row 2 MUST be
    // called, and the operator must be told the batch was partial rather than shown a
    // silent success.
    mocks.requeueRemoteFailure.mockImplementation((_t: string, id: string) =>
      id === 'remote-1' ? Promise.reject(new Error('not found')) : Promise.resolve(undefined),
    );

    renderWithProvidersSync(<SyncConflictsPanel />, settingsFtl, sharedFtl);
    const btn = await screen.findByRole('button', { name: /requeue all quarantined sync conflicts/i });
    await act(async () => { fireEvent.click(btn); });

    await screen.findByText(/some conflicts could not be requeued/i);
    expect(
      mocks.requeueRemoteFailure.mock.calls.map((c) => c[1]),
      'a refused row aborted the remaining rows',
    ).toEqual(['remote-1', 'remote-2']);
    expect(screen.getByText(/\(1\/2\)/)).toBeInTheDocument();
  });

  it('never renders the raw rejection text from a PER-ROW retry', async () => {
    // The per-row button is the path that owned `setError(String(e))`; the bulk walk
    // reports through the PARTIAL branch, so a bulk-driven case would never reach the
    // line this test exists for -- measured, because a first version of this case drove
    // Requeue All and stayed green under a mutation that restored String(e).
    //
    // A distinctive raw message makes the assertion able to fail: if the rejection
    // leaks, that exact sentence appears on screen.
    mocks.requeueRemoteFailure.mockRejectedValue(new Error('IPC invoke failed: sql row 42'));

    renderWithProvidersSync(<SyncConflictsPanel />, settingsFtl, sharedFtl);
    // The row buttons are labelled 'Retry {id}' via sync-conflicts-retry-aria.
    const rowBtn = await screen.findByRole('button', { name: /retry sync for item remote-1/i });
    await act(async () => { fireEvent.click(rowBtn); });

    await screen.findByText(/could not requeue this conflict/i);
    expect(screen.queryByText(/IPC invoke failed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sql row 42/i)).not.toBeInTheDocument();
  });
});
