import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import offlineFtl from '@/locales/offline.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import OfflineQueueScreen from '@/features/offline/OfflineQueueScreen';

// ── Mocks ────────────────────────────────────────────────────────────

const mockListAllOffline = vi.fn();
const mockPendingOfflineCount = vi.fn();
const mockRetryOfflineSync = vi.fn();
const mockDeleteOfflineItem = vi.fn();
const mockOfflineQueueStatusSummary = vi.fn();
const mockListRemoteFailures = vi.fn();
const mockRequeueRemoteFailure = vi.fn();
const mockGetSyncPlan = vi.fn();

vi.mock('@/api/offline', () => ({
  listAllOfflineScoped: (...args: unknown[]) => mockListAllOffline(...args),
  pendingOfflineCountScoped: (...args: unknown[]) => mockPendingOfflineCount(...args),
  retryOfflineSyncScoped: (...args: unknown[]) => mockRetryOfflineSync(...args),
  deleteOfflineItemScoped: (...args: unknown[]) => mockDeleteOfflineItem(...args),
  getOfflineQueueStatusSummaryScoped: (...args: unknown[]) => mockOfflineQueueStatusSummary(...args),
  getSyncPlanScoped: (...args: unknown[]) => mockGetSyncPlan(...args),
  listRemoteFailuresScoped: (...args: unknown[]) => mockListRemoteFailures(...args),
  requeueRemoteFailureScoped: (...args: unknown[]) => mockRequeueRemoteFailure(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────

function makeQueueItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'oq-1',
    action: 'sale.create',
    status: 'pending',
    retryCount: 0,
    lastError: null,
    createdAt: '2025-07-07T12:00:00.000Z',
    syncedAt: null,
    ...overrides,
  };
}

function makeFailure(overrides: Record<string, unknown> = {}) {
  return {
    itemId: 'remote-sale-1',
    action: 'upsert_sale',
    payload: '{"id":"remote-sale-1"}',
    attempts: 3,
    lastError: 'missing product sku-X',
    deadLettered: true,
    ...overrides,
  };
}

function renderScreen() {
  return renderWithFluentSync(<OfflineQueueScreen />, offlineFtl, sharedFtl);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('OfflineQueueScreen', () => {
  beforeEach(() => {
    mockListAllOffline.mockReset();
    mockPendingOfflineCount.mockReset();
    mockRetryOfflineSync.mockReset();
    mockDeleteOfflineItem.mockReset();
    mockOfflineQueueStatusSummary.mockReset();
    mockListRemoteFailures.mockReset();
    mockRequeueRemoteFailure.mockReset();
    mockGetSyncPlan.mockReset();
    mockListAllOffline.mockResolvedValue([]);
    mockPendingOfflineCount.mockResolvedValue(0);
    mockListRemoteFailures.mockResolvedValue([]);
    mockGetSyncPlan.mockResolvedValue({ ok: true, plan: 'pro', status: 'ok' });
    mockOfflineQueueStatusSummary.mockResolvedValue({
      pendingCount: 0, syncedCount: 0, failedCount: 0, conflictCount: 0,
      lastSyncedAt: null, oldestPendingAt: null,
    });
  });

  // offline_queue.status has no CHECK constraint, so a spelling the UI does not know is
  // reachable rather than hypothetical. The fallback used to be 'pending' -- the state that
  // literally means "this will be pushed" -- so an unreadable row would have been shown as
  // work that is definitely on its way. Unknown must read as unknown.
  it('labels an unrecognised queue status as unknown, never as pending', async () => {
    mockListAllOffline.mockResolvedValue([makeQueueItem({ status: 'quarantined' })]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Unknown status')).toBeTruthy();
    });
    expect(screen.queryByText('Pending')).toBeNull();
  });
  it('renders the title', async () => {
    mockListAllOffline.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Offline Queue')).toBeTruthy();
    });
  });

  it('shows loading skeleton initially', () => {
    mockListAllOffline.mockImplementation(() => new Promise(() => {}));
    renderScreen();

    expect(document.querySelector('.offline-queue-loading-skeleton')).toBeTruthy();
  });

  it('shows empty state when no items', async () => {
    mockListAllOffline.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('All transactions synced. No pending items.')).toBeTruthy();
    });
  });

  // ── SYNC-11: quarantined remote items ───────────────────────────

  it('shows the quarantined section with no failures as empty', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Quarantined Remote Items')).toBeTruthy();
      expect(screen.getByText('No quarantined items.')).toBeTruthy();
    });
  });

  // ── a FAILED quarantine read is not "nothing failed remotely" ─────────
  //
  // The outlier was `listRemoteFailuresScoped(...).catch(() => [])`: the
  // rejection was converted into an EMPTY LIST and written into the same
  // state a real answer writes, so the one screen whose job is showing sync
  // trouble reported "No quarantined items." — a clean queue — for a read
  // that never answered. The file already gets this right twice (:128 and
  // :173's `.catch(() => null)` behind `if (summary)`, and the phase
  // 'error' branch at :469-479), so these cases pin the outlier to the same
  // rule: failure leaves the quarantine UNKNOWN, the existing error copy
  // carries it, and a later real answer replaces it. No new Fluent key is
  // used or needed — `offline-queue-error` / `offline-queue-retry` already
  // exist in both bundles and this screen already renders them.

  it('reports an UNKNOWN quarantine, not a clean one, when the read fails', async () => {
    mockListRemoteFailures.mockRejectedValue(new Error('offline_remote_failures not registered'));
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Quarantined Remote Items')).toBeTruthy();
    });
    // The claim under test: this copy is the positive assertion "nothing
    // failed remotely", and a failed read cannot license it.
    expect(screen.queryByText('No quarantined items.')).toBeNull();
    // The file's existing degraded surface carries it instead.
    expect(screen.getByText('Failed to load queue. Please try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('restores a known quarantine when a later read answers', async () => {
    mockListRemoteFailures.mockRejectedValueOnce(new Error('transient read failure'));
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Failed to load queue. Please try again.')).toBeTruthy();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText('No quarantined items.')).toBeTruthy();
    });
    expect(screen.queryByText('Failed to load queue. Please try again.')).toBeNull();
  });

  it('renders quarantined remote items with attempts and last error', async () => {
    mockListRemoteFailures.mockResolvedValue([
      makeFailure(),
      makeFailure({ itemId: 'remote-tax-2', action: 'upsert_tax_rate', attempts: 7, lastError: 'unknown tax rate' }),
    ]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('remote-sale-1')).toBeTruthy();
      expect(screen.getByText('upsert_sale')).toBeTruthy();
      expect(screen.getByText('remote-tax-2')).toBeTruthy();
      expect(screen.getByText('unknown tax rate')).toBeTruthy();
    });
  });

  it('calls requeueRemoteFailure with the item id on Requeue', async () => {
    mockListRemoteFailures.mockResolvedValueOnce([makeFailure()]);
    mockListRemoteFailures.mockResolvedValueOnce([]);
    mockRequeueRemoteFailure.mockResolvedValue(undefined);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Requeue')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Requeue'));

    await waitFor(() => {
      expect(mockRequeueRemoteFailure).toHaveBeenCalledWith(expect.any(String), 'remote-sale-1');
      // Reloaded after requeue → the quarantined row is gone.
      expect(screen.getByText('No quarantined items.')).toBeTruthy();
    });
  });

  it('shows a localized error when requeue fails', async () => {
    mockListRemoteFailures.mockResolvedValue([makeFailure()]);
    mockRequeueRemoteFailure.mockRejectedValue(new Error('not found'));
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Requeue')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Requeue'));

    await waitFor(() => {
      expect(screen.getByText('Failed to requeue item')).toBeTruthy();
    });
  });

  it('shows error state with retry', async () => {
    mockListAllOffline.mockRejectedValue(new Error('Failed'));
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeTruthy();
    });
  });

  it('calls load when retry button is clicked after error', async () => {
    // First call during mount rejects — shows error state
    mockListAllOffline.mockRejectedValueOnce(new Error('Failed'));
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeTruthy();
    });

    // Clear mock so retry uses the default resolved value from beforeEach
    mockListAllOffline.mockClear();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockListAllOffline).toHaveBeenCalledTimes(1);
    });
  });

  it('renders queue items in a table', async () => {
    mockListAllOffline.mockResolvedValue([
      makeQueueItem(),
      makeQueueItem({ id: 'oq-2', action: 'product.update', status: 'failed', retryCount: 3, lastError: 'timeout' }),
    ]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Action')).toBeTruthy();
      expect(screen.getByText('Status')).toBeTruthy();
      expect(screen.getByText('Retries')).toBeTruthy();
      expect(screen.getByText('sale.create')).toBeTruthy();
      expect(screen.getByText('product.update')).toBeTruthy();
    });
  });

  it('shows status badges with correct classes', async () => {
    mockListAllOffline.mockResolvedValue([
      makeQueueItem({ id: 'oq-1', status: 'pending' }),
      makeQueueItem({ id: 'oq-2', status: 'synced' }),
      makeQueueItem({ id: 'oq-3', status: 'failed', lastError: 'error', retryCount: 2 }),
    ]);
    renderScreen();

    await waitFor(() => {
      expect(document.querySelector('.status-pending')).toBeTruthy();
      expect(document.querySelector('.status-synced')).toBeTruthy();
      expect(document.querySelector('.status-failed')).toBeTruthy();
    });
  });

  it('shows retry counts', async () => {
    mockListAllOffline.mockResolvedValue([makeQueueItem({ id: 'oq-1', retryCount: 5 })]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('5')).toBeTruthy();
    });
  });

  it('shows last error text', async () => {
    mockListAllOffline.mockResolvedValue([makeQueueItem({ lastError: 'Connection refused' })]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeTruthy();
    });
  });

  it('each row has a Delete button', async () => {
    mockListAllOffline.mockResolvedValue([makeQueueItem()]);
    renderScreen();

    await waitFor(() => {
      const deleteBtns = screen.getAllByText('Delete');
      expect(deleteBtns.length).toBe(1);
    });
  });

  it('calls deleteOfflineItem on Delete click', async () => {
    mockListAllOffline.mockResolvedValueOnce([makeQueueItem()]);
    mockListAllOffline.mockResolvedValueOnce([]);
    mockDeleteOfflineItem.mockResolvedValue(undefined);

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockDeleteOfflineItem).toHaveBeenCalledWith(expect.any(String), 'oq-1');
    });
  });

  // ── A hostile pending count must not split the badge and the button ──────
  //
  // `pending_offline_count_scoped` declares a number and nothing enforces it at the
  // IPC boundary. The count reached `setPendingCount` raw, and its two readers then
  // disagreed about the same value:
  //
  //   badge    `pendingCount > 0`    -> hidden for 'three' and for -5
  //   button   `pendingCount === 0`  -> ENABLED for both, since neither equals 0
  //
  // MEASURED: with an item on screen and the count answering 'three', the row
  // rendered, no pending badge appeared, and Sync All stayed clickable — the one
  // affordance saying 'work is queued' gone, while the action that clears it stayed
  // armed. The fix floors the count at 0 (`asCount`), so both readers agree.
  it.each([
    ['a non-numeric count', 'three'],
    ['a negative count', -5],
    ['NaN', Number.NaN],
  ])('keeps the badge and the Sync All button agreeing on %s', async (_label, value) => {
    mockListAllOffline.mockResolvedValue([makeQueueItem()]);
    mockPendingOfflineCount.mockResolvedValue(value as never);
    renderScreen();

    // The row is the precondition: without it this case could pass on an empty queue.
    await waitFor(() => expect(screen.getByText('Delete')).toBeTruthy());

    expect(
      document.querySelector('.offline-queue-badge'),
      'a bad count must not render a pending badge',
    ).toBeNull();
    expect(
      (screen.getByText('Sync All').closest('button') as HTMLButtonElement).disabled,
      'the badge says nothing while Sync All stays armed — the two readers of one ' +
        'untrusted value disagree',
    ).toBe(true);
  });
  it('shows pending count badge', async () => {
    mockListAllOffline.mockResolvedValue([makeQueueItem()]);
    mockPendingOfflineCount.mockResolvedValue(3);
    renderScreen();

    await waitFor(() => {
      const badge = document.querySelector('.offline-queue-badge');
      expect(badge).toBeTruthy();
      expect(badge!.textContent).toContain('pending');
    });
  });

  it('shows Sync All button', async () => {
    mockListAllOffline.mockResolvedValue([makeQueueItem()]);
    mockPendingOfflineCount.mockResolvedValue(3);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Sync All')).toBeTruthy();
    });
  });

  it('renders the detailed queue status summary with counts and timestamps', async () => {
    mockListAllOffline.mockResolvedValue([makeQueueItem()]);
    mockPendingOfflineCount.mockResolvedValue(3);
    mockOfflineQueueStatusSummary.mockResolvedValue({
      pendingCount: 3,
      syncedCount: 41,
      failedCount: 2,
      conflictCount: 1,
      lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(), // 5m ago
      oldestPendingAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), // 2h ago
    });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('offline-queue-summary')).toBeInTheDocument();
    });
    // Counts from the summary DTO
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    // Relative timestamps
    expect(screen.getByText(/Last synced/)).toBeInTheDocument();
    expect(screen.getByText(/Oldest pending/)).toBeInTheDocument();
  });

  it('shows "never synced" / "queue empty" in the summary when timestamps are missing', async () => {
    mockListAllOffline.mockResolvedValue([]);
    mockPendingOfflineCount.mockResolvedValue(0);
    // Summary with no timestamps (fresh queue)
    mockOfflineQueueStatusSummary.mockResolvedValue({
      pendingCount: 0, syncedCount: 0, failedCount: 0, conflictCount: 0,
      lastSyncedAt: null, oldestPendingAt: null,
    });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('offline-queue-summary')).toBeInTheDocument();
    });
    expect(screen.getByText(/Never synced/)).toBeInTheDocument();
    expect(screen.getByText(/Queue empty/)).toBeInTheDocument();
  });

  it('renders the pro plan row from the server', async () => {
    mockGetSyncPlan.mockResolvedValue({ ok: true, plan: 'pro', status: 'ok' });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('offline-queue-plan-row')).toBeInTheDocument();
    });
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.queryByText(/Upgrade to sync/)).toBeNull();
  });

  it('renders the free plan row with the upgrade hint', async () => {
    mockGetSyncPlan.mockResolvedValue({ ok: true, plan: 'free', status: 'ok' });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('offline-queue-plan-row')).toBeInTheDocument();
    });
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText(/Upgrade to sync/)).toBeInTheDocument();
  });

  it('does NOT render a plan row when the plan read failed (ok=false)', async () => {
    // A 404 from an old server or a network error resolves with ok:false,
    // plan:null — the UI must not paint that as a known "Free" plan.
    mockGetSyncPlan.mockResolvedValue({
      ok: false,
      plan: null,
      status: 'Server returned 404 Not Found',
    });
    renderScreen();

    await waitFor(() => {
      expect(mockGetSyncPlan).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('offline-queue-plan-row')).toBeNull();
    expect(screen.queryByText('Free')).toBeNull();
    expect(screen.queryByText(/Upgrade to sync/)).toBeNull();
  });

  it('shows a stale notice after repeated poll failures (ERR-07)', async () => {
    vi.useFakeTimers();
    try {
      // Initial list load succeeds (empty queue); the 10s status poll fails.
      mockListAllOffline.mockResolvedValue([]);
      mockPendingOfflineCount.mockRejectedValue(new Error('poll fail'));
      mockOfflineQueueStatusSummary.mockResolvedValue({
        pendingCount: 0, syncedCount: 0, failedCount: 0, conflictCount: 0,
        lastSyncedAt: null, oldestPendingAt: null,
      });

      renderScreen();

      // Flush the initial load + the first poll attempt (fails once).
      await act(async () => { await Promise.resolve(); });
      expect(screen.queryByText('Queue status may be out of date.')).toBeNull();

      // Two more 10s cycles → three consecutive failures → stale notice.
      // Assert synchronously after each advance (waitFor does not advance
      // fake timers on its own).
      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
      });
      expect(screen.queryByText('Queue status may be out of date.')).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
      });
      expect(screen.getByText('Queue status may be out of date.')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps rows visible and announces refreshing during a reload (ERR-09)', async () => {
    // First load resolves with rows.
    mockListAllOffline.mockResolvedValueOnce([makeQueueItem()]);
    mockPendingOfflineCount.mockResolvedValue(1);
    // The reload (via Sync All → load) stays pending so the `refreshing`
    // phase is observable.
    mockListAllOffline.mockImplementationOnce(() => new Promise(() => {}));
    mockRetryOfflineSync.mockResolvedValue({ syncedCount: 0, failedCount: 0, totalCount: 1 });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('sale.create')).toBeTruthy();
    });

    // Trigger a reload while rows are on screen.
    const user = userEvent.setup();
    await user.click(screen.getByText('Sync All'));

    // Rows stay visible (no skeleton), and an accessible refreshing status
    // announces the retry intent.
    await waitFor(() => {
      expect(screen.getByText('sale.create')).toBeTruthy();
      const refreshing = document.querySelector('.offline-queue-refreshing');
      expect(refreshing).toBeTruthy();
      expect(refreshing?.getAttribute('role')).toBe('status');
      expect(refreshing?.getAttribute('aria-live')).toBe('polite');
    });
    expect(document.querySelector('.offline-queue-loading-skeleton')).toBeNull();
  });

  it('shows sync result after Sync All succeeds', async () => {
    mockListAllOffline.mockResolvedValue([makeQueueItem()]);
    mockPendingOfflineCount.mockResolvedValue(1);
    mockRetryOfflineSync.mockResolvedValue({ syncedCount: 1, failedCount: 0, totalCount: 1 });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Sync All')).not.toBeDisabled();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Sync All'));

    await waitFor(() => {
      expect(mockRetryOfflineSync).toHaveBeenCalled();
    });
    // During load() the skeleton table re-renders with <th>Synced At</th>,
    // which also matches /Synced/i — use a more specific check.
    await waitFor(() => {
      const syncMessages = screen.getAllByText(/Synced/i);
      expect(syncMessages.some((el) => el.textContent?.includes('items'))).toBe(true);
    });
  });

  it('renders the exact synced/failed counts from the Rust camelCase DTO (OFF-02)', async () => {
    // OFF-02: the UI must render the counts exactly as the Rust SyncResult
    // serializes them (syncedCount/failedCount/totalCount). A mismatched
    // contract would render undefined counts and mislead the operator.
    mockListAllOffline.mockResolvedValue([makeQueueItem()]);
    mockPendingOfflineCount.mockResolvedValue(1);
    mockRetryOfflineSync.mockResolvedValue({ syncedCount: 3, failedCount: 2, totalCount: 5 });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Sync All')).not.toBeDisabled();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Sync All'));

    // The localized message is "Synced { $synced } items, { $failed } failed."
    await waitFor(() => {
      const msg = screen.getByText(/Synced 3 items, 2 failed/);
      expect(msg).toBeTruthy();
    });
    // No undefined counts leak into the message.
    expect(screen.queryByText(/Synced undefined/)).toBeNull();
  });

  it('drains the queue once when Sync All is double-tapped', async () => {
    // retry_offline_sync is safe to replay, but two in-flight runs share one `syncResult`
    // and one `error`: the operator can be shown the loser's outcome, or an error over a
    // sync that succeeded, while the first run is still draining.
    mockListAllOffline.mockResolvedValue([makeQueueItem()]);
    mockPendingOfflineCount.mockResolvedValue(1);
    let release: (() => void) | undefined;
    mockRetryOfflineSync.mockReturnValue(new Promise((res) => {
      release = () => res({ syncedCount: 1, failedCount: 0, totalCount: 1 });
    }));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Sync All')).not.toBeDisabled());

    const btn = screen.getByText('Sync All').closest('button') as HTMLButtonElement;
    await act(async () => {
      btn.click();
      btn.click();
    });

    release?.();
    await waitFor(() => expect(mockRetryOfflineSync).toHaveBeenCalledTimes(1));
  });

  it('shows the localized plan-required prompt instead of a fake success on Sync All (ADR sync-plan-gating)', async () => {
    // A free tenant's retry_offline_sync resolves with planRequired:true.
    // The screen must surface the upgrade prompt — never a misleading
    // "Synced 0 items, 0 failed." success line.
    mockListAllOffline.mockResolvedValue([makeQueueItem()]);
    mockPendingOfflineCount.mockResolvedValue(1);
    mockRetryOfflineSync.mockResolvedValue({
      syncedCount: 0,
      failedCount: 0,
      totalCount: 0,
      planRequired: true,
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Sync All')).not.toBeDisabled();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Sync All'));

    await waitFor(() => {
      expect(screen.getByText('Cloud sync requires a paid plan')).toBeInTheDocument();
    });
    // The misleading success line must NOT render for a gated tenant.
    expect(screen.queryByText(/Synced 0 items, 0 failed/)).toBeNull();
  });
});
