// Sync-conflict review screen — the Phase 3.4 coverage the work order asked
// for and the original implementation shipped without: the severity filter
// wiring (tabs and resolved-history toggle reaching the IPC args exactly as
// the screen computes them) and the resolve action wiring (each viewer
// button sending the right payload, the refresh that follows, and the
// rejected-resolve branch).
//
// The mock seam is `@/utils/logged-invoke` — the single Tauri boundary — so
// the real `@/api/syncConflicts` client runs end to end: a command rename or
// an args-shape drift breaks here, not only in dev-mock. The tests also
// render against the real `sync.ftl` bundle, so a tab label renamed without
// its key fails too.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import syncFtl from '@/locales/sync.ftl?raw';
import type { SyncConflictDto } from '@/api/syncConflicts';

import { SyncConflictReviewScreen } from '@/features/sync/SyncConflictReviewScreen';

const SESSION_TOKEN = 'tok-conflicts';

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: SESSION_TOKEN }),
}));

const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

/** Every `list_sync_conflicts_scoped` call, with its args object. */
function listCalls(): Array<{ sessionToken: string; args: Record<string, unknown> }> {
  return mockInvoke.mock.calls
    .filter((c) => c[0] === 'list_sync_conflicts_scoped')
    .map((c) => c[1] as { sessionToken: string; args: Record<string, unknown> });
}

function stubListRows(rows: SyncConflictDto[]) {
  mockInvoke.mockImplementation((cmd: string) =>
    cmd === 'list_sync_conflicts_scoped'
      ? Promise.resolve(rows)
      : Promise.resolve({ id: 'sc-1', status: 'resolved', resolution: 'local' }),
  );
}

function makeConflict(overrides: Partial<SyncConflictDto> = {}): SyncConflictDto {
  return {
    id: 'sc-1',
    tenant_id: 'tenant-1',
    entity_type: 'stock.adjusted',
    entity_id: 'SKU-42',
    local_terminal_id: 'T-A',
    local_vector: '{"T-A":2}',
    remote_vector: '{"T-B":1}',
    local_payload: '{"quantity":-5}',
    remote_payload: '{"quantity":3}',
    severity: 'high',
    status: 'open',
    resolution: null,
    resolved_by: null,
    resolved_at: null,
    created_at: '2026-09-13T08:00:00.000Z',
    ...overrides,
  };
}

function renderScreen() {
  return renderWithFluentSync(<SyncConflictReviewScreen />, syncFtl);
}

beforeEach(() => {
  mockInvoke.mockReset();
  stubListRows([]);
});

describe('SyncConflictReviewScreen — severity filter wiring', () => {
  it('loads open High-severity conflicts with the session token on mount', async () => {
    stubListRows([makeConflict()]);
    renderScreen();

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('list_sync_conflicts_scoped', {
        sessionToken: SESSION_TOKEN,
        args: { status: 'open', severity: 'high' },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('conflict-diff-viewer')).toBeInTheDocument(),
    );
  });

  it('re-queries with the clicked severity, and "All" drops the severity filter', async () => {
    renderScreen();
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'Medium' }));
    await waitFor(() =>
      expect(listCalls().at(-1)?.args).toEqual({ status: 'open', severity: 'medium' }),
    );
    expect(screen.getByRole('tab', { name: 'Medium' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'High' })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    await user.click(screen.getByRole('tab', { name: 'All' }));
    await waitFor(() =>
      expect(listCalls().at(-1)?.args).toEqual({ status: 'open', severity: undefined }),
    );
  });

  it('the resolved-history toggle drops the status filter and keeps resolved rows', async () => {
    stubListRows([
      makeConflict({
        id: 'sc-old',
        status: 'resolved',
        resolution: 'remote',
        resolved_by: 'manager-1',
        resolved_at: '2026-09-13T09:00:00.000Z',
      }),
    ]);
    renderScreen();
    await waitFor(() => expect(listCalls()).toHaveLength(1));

    // Even if a resolved row slips back from the server, the default open-only
    // view hides it client-side — the checkbox is the only way to see history.
    expect(screen.queryByTestId('conflict-diff-viewer')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /Show resolved history/i }));
    await waitFor(() =>
      expect(listCalls().at(-1)?.args).toEqual({ status: undefined, severity: 'high' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('conflict-diff-viewer')).toBeInTheDocument(),
    );
  });

  it('promotes an unrecognised server severity label to the High bucket', async () => {
    // `asSeverity` is the real client function here: a typo'd or newer
    // severity must make a conflict MORE visible, never hide it under a tab
    // that filters to nothing.
    stubListRows([
      makeConflict({ severity: 'urgent' as SyncConflictDto['severity'] }),
    ]);
    renderScreen();

    await waitFor(() => expect(listCalls()).toHaveLength(1));
    const severity = document.querySelector('.conflict-diff__severity');
    expect(severity?.textContent).toBe('high');
    expect(severity?.className).toContain('conflict-diff__severity--high');
  });
});

describe('SyncConflictReviewScreen — resolve action wiring', () => {
  it('Accept Store A sends the local payload and refreshes the list', async () => {
    stubListRows([makeConflict()]);
    // After the manager resolves, the next refresh comes back empty.
    let listCallsSeen = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd !== 'list_sync_conflicts_scoped') {
        return Promise.resolve({ id: 'sc-1', status: 'resolved', resolution: 'local' });
      }
      listCallsSeen += 1;
      return Promise.resolve(listCallsSeen === 1 ? [makeConflict()] : []);
    });
    renderScreen();
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Accept Store A' }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('resolve_sync_conflict_scoped', {
        sessionToken: SESSION_TOKEN,
        args: { id: 'sc-1', resolution: '{"quantity":-5}' },
      }),
    );
    await waitFor(() =>
      expect(screen.getByText('No conflicts to review.')).toBeInTheDocument(),
    );
    expect(listCalls()).toHaveLength(2);
  });

  it('Accept Cloud sends the remote payload', async () => {
    stubListRows([makeConflict()]);
    renderScreen();
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Accept Cloud' }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('resolve_sync_conflict_scoped', {
        sessionToken: SESSION_TOKEN,
        args: { id: 'sc-1', resolution: '{"quantity":3}' },
      }),
    );
  });

  it('Custom Merge sends the custom marker', async () => {
    stubListRows([makeConflict()]);
    renderScreen();
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Custom Merge' }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('resolve_sync_conflict_scoped', {
        sessionToken: SESSION_TOKEN,
        args: { id: 'sc-1', resolution: 'custom' },
      }),
    );
  });

  it('a resolve rejected because another terminal won shows the notice and still refreshes', async () => {
    stubListRows([makeConflict()]);
    // The command succeeded over the wire but the row was already gone —
    // the scoped command resolves falsy.
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'resolve_sync_conflict_scoped'
        ? Promise.resolve(null)
        : Promise.resolve([makeConflict()]),
    );
    renderScreen();
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Accept Cloud' }));
    await waitFor(() =>
      expect(
        screen.getByText(/already resolved elsewhere/i),
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(listCalls().length).toBeGreaterThanOrEqual(2));
  });
});
