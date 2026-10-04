import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncConflictsPanel } from '../SyncConflictsPanel';
import {
  listRemoteFailuresScoped,
  requeueRemoteFailureScoped,
  type RemoteSyncFailureDto,
} from '@/api/offline';

vi.mock('@/api/offline', () => ({
  listRemoteFailuresScoped: vi.fn(),
  requeueRemoteFailureScoped: vi.fn(),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'test-token' }),
  useWorkspaceScope: () => null,
}));

const mockL10n = {
  getString: (id: string, vars?: Record<string, unknown> | null) => {
    const map: Record<string, string> = {
      'sync-conflicts-panel-title': 'Quarantined Sync Conflicts',
      'sync-conflicts-panel-empty': 'No dead-lettered conflicts.',
      'sync-conflicts-panel-table-aria': 'Quarantined conflicts table',
      'sync-conflicts-loading': 'Loading…',
      'sync-conflicts-col-action': 'Action',
      'sync-conflicts-col-attempts': 'Attempts',
      'sync-conflicts-col-error': 'Last Error',
      'sync-conflicts-col-actions': 'Actions',
      'sync-conflicts-retry': 'Retry',
      'sync-conflicts-retrying': 'Retrying…',
      'sync-conflicts-retry-aria': `Retry sync for item ${vars?.['id'] ?? ''}`,
      'sync-conflicts-requeue-all': 'Requeue All',
      'sync-conflicts-requeueing-all': 'Requeueing…',
      'sync-conflicts-requeue-all-aria': 'Requeue all quarantined sync conflicts',
      'sync-conflicts-payload-inspect': 'Inspect',
      'sync-conflicts-payload-hide': 'Hide',
      'sync-conflicts-payload-inspect-aria': `Inspect payload for item ${vars?.['id'] ?? ''}`,
      'sync-conflicts-payload-hide-aria': `Hide payload for item ${vars?.['id'] ?? ''}`,
      'sync-conflicts-payload-copy': 'Copy JSON',
      'sync-conflicts-payload-copied': 'Copied!',
      'sync-conflicts-badge-aria': `${vars?.['count'] ?? ''} quarantined sync conflicts`,
    };
    return map[id] ?? id;
  },
};

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({ l10n: mockL10n }),
  Localized: ({ children }: { children: React.ReactNode }) => children,
}));

describe('SyncConflictsPanel', () => {
  const mockFailures: RemoteSyncFailureDto[] = [
    {
      itemId: 'item-1',
      action: 'sale.create',
      payload: '{}',
      attempts: 5,
      lastError: 'Inventory constraint violated',
      deadLettered: true,
    },
    {
      itemId: 'item-2',
      action: 'stock.adjust',
      payload: '{}',
      attempts: 1,
      lastError: 'Connection timeout',
      deadLettered: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially and then empty state when no dead-letters exist', async () => {
    vi.mocked(listRemoteFailuresScoped).mockResolvedValueOnce([
      {
        itemId: 'item-transient',
        action: 'sale.create',
        payload: '{}',
        attempts: 1,
        lastError: null as unknown as string,
        deadLettered: false,
      },
    ]);

    render(<SyncConflictsPanel />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('No dead-lettered conflicts.')).toBeInTheDocument();
    });
  });

  it('renders dead-lettered conflicts table filtering out non-dead-lettered items', async () => {
    vi.mocked(listRemoteFailuresScoped).mockResolvedValueOnce(mockFailures);

    render(<SyncConflictsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Quarantined Sync Conflicts')).toBeInTheDocument();
    });

    expect(screen.getByText('sale.create')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getAllByText('Inventory constraint violated')[0]).toBeInTheDocument();

    // item-2 has deadLettered = false, so it should not appear in the dead-lettered list
    expect(screen.queryByText('stock.adjust')).not.toBeInTheDocument();
  });

  it('handles requeue action and reloads failure list', async () => {
    const user = userEvent.setup();
    const onRequeueSuccess = vi.fn();

    vi.mocked(listRemoteFailuresScoped)
      .mockResolvedValueOnce(mockFailures)
      .mockResolvedValueOnce([]); // empty after requeue

    vi.mocked(requeueRemoteFailureScoped).mockResolvedValueOnce(undefined);

    render(<SyncConflictsPanel onRequeueSuccess={onRequeueSuccess} />);

    await waitFor(() => {
      expect(screen.getByText('sale.create')).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: 'Retry sync for item item-1' });
    await user.click(retryBtn);

    expect(requeueRemoteFailureScoped).toHaveBeenCalledWith('test-token', 'item-1');

    await waitFor(() => {
      expect(onRequeueSuccess).toHaveBeenCalledTimes(1);
      expect(screen.getByText('No dead-lettered conflicts.')).toBeInTheDocument();
    });
  });

  it('renders error alert when loading fails', async () => {
    vi.mocked(listRemoteFailuresScoped).mockRejectedValueOnce(new Error('Network failure'));

    render(<SyncConflictsPanel />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Error: Network failure');
    });
  });

  it('renders error alert when requeue fails', async () => {
    const user = userEvent.setup();
    vi.mocked(listRemoteFailuresScoped).mockResolvedValueOnce(mockFailures);
    vi.mocked(requeueRemoteFailureScoped).mockRejectedValueOnce(new Error('Requeue failed'));

    render(<SyncConflictsPanel />);

    await waitFor(() => {
      expect(screen.getByText('sale.create')).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: 'Retry sync for item item-1' });
    await user.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Error: Requeue failed');
    });
  });

  it('toggles payload inspection for an item', async () => {
    const user = userEvent.setup();
    const failuresWithPayload: RemoteSyncFailureDto[] = [
      {
        itemId: 'item-payload',
        action: 'sale.create',
        payload: '{"orderId":"12345","amount":50000}',
        attempts: 3,
        lastError: 'Conflict',
        deadLettered: true,
      },
    ];
    vi.mocked(listRemoteFailuresScoped).mockResolvedValueOnce(failuresWithPayload);

    render(<SyncConflictsPanel />);

    await waitFor(() => {
      expect(screen.getByText('sale.create')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('payload-view-item-payload')).not.toBeInTheDocument();

    const inspectBtn = screen.getByRole('button', { name: 'Inspect payload for item item-payload' });
    await user.click(inspectBtn);

    expect(screen.getByTestId('payload-view-item-payload')).toBeInTheDocument();
    expect(screen.getByText(/"orderId": "12345"/)).toBeInTheDocument();

    const hideBtn = screen.getByRole('button', { name: 'Hide payload for item item-payload' });
    await user.click(hideBtn);

    expect(screen.queryByTestId('payload-view-item-payload')).not.toBeInTheDocument();
  });

  it('handles requeue all when multiple dead-lettered items exist', async () => {
    const user = userEvent.setup();
    const onRequeueSuccess = vi.fn();
    const multiDeadLetters: RemoteSyncFailureDto[] = [
      {
        itemId: 'dead-1',
        action: 'sale.create',
        payload: '{}',
        attempts: 5,
        lastError: 'Err 1',
        deadLettered: true,
      },
      {
        itemId: 'dead-2',
        action: 'stock.adjust',
        payload: '{}',
        attempts: 4,
        lastError: 'Err 2',
        deadLettered: true,
      },
    ];

    vi.mocked(listRemoteFailuresScoped)
      .mockResolvedValueOnce(multiDeadLetters)
      .mockResolvedValueOnce([]);

    vi.mocked(requeueRemoteFailureScoped).mockResolvedValue(undefined);

    render(<SyncConflictsPanel onRequeueSuccess={onRequeueSuccess} />);

    await waitFor(() => {
      expect(screen.getByText('Requeue All')).toBeInTheDocument();
    });

    const requeueAllBtn = screen.getByRole('button', { name: 'Requeue all quarantined sync conflicts' });
    await user.click(requeueAllBtn);

    expect(requeueRemoteFailureScoped).toHaveBeenCalledWith('test-token', 'dead-1');
    expect(requeueRemoteFailureScoped).toHaveBeenCalledWith('test-token', 'dead-2');

    await waitFor(() => {
      expect(onRequeueSuccess).toHaveBeenCalledTimes(1);
      expect(screen.getByText('No dead-lettered conflicts.')).toBeInTheDocument();
    });
  });

  it('calls onCountChange with the count of dead-lettered items', async () => {
    const onCountChange = vi.fn();
    vi.mocked(listRemoteFailuresScoped).mockResolvedValueOnce(mockFailures);

    render(<SyncConflictsPanel onCountChange={onCountChange} />);

    await waitFor(() => {
      expect(onCountChange).toHaveBeenCalledWith(1);
    });
  });
});

