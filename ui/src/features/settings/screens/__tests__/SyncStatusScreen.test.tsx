/**
 * SyncStatusScreen — the read-only half of the sync family.
 *
 * This screen had no suite of its own. 317 lines, consumed as Settings →
 * Sync Status, and the only files that named it were compliance scans
 * (cssCommentIntegrity, screenExtraction, PosToastLocalization) that assert a
 * stylesheet or an inventory row rather than what the screen RENDERS. Its data
 * layer was already graded — useDataSyncDraft.test.tsx exists precisely because
 * the hook beneath had gone ungraded — so the gap here is the render layer,
 * not the contract beneath it.
 *
 * Four branches are worth pinning, each a claim the screen makes to an operator:
 *
 *   1. With nothing configured it says so, and renders NO action buttons. A
 *      Test/Sync/Pull trio against a server that was never set up is an
 *      invitation to press them and get a failure the operator cannot explain.
 *   2. A run that FAILED prints the error, not the success wording. The dot
 *      carries the same fact in colour alone (aria-hidden), so the text is the
 *      only channel a screen reader has.
 *   3. A free plan shows its upgrade hint; a pro plan does not. The hint is
 *      the only place the screen explains why sync is limited.
 *   4. Pull is destructive and must go through ConfirmDialog — it never fires
 *      syncPull on the first click.
 *
 * Everything is driven through a mocked useDataSyncDraft, matching the pattern
 * its own suite established: the screen's job is to render a VALUE, so the
 * cases state values and read what appeared.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

const draftMock = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

vi.mock('@/features/settings/hooks/useDataSyncDraft', () => ({
  useDataSyncDraft: () => draftMock.value,
}));

import { SyncStatusScreen } from '@/features/settings/screens/SyncStatusScreen';

const baseDraft = () => ({
  sync: { enabled: true },
  syncServerUrl: 'https://sync.example',
  syncApiKey: '',
  queueSummary: null,
  syncPlan: null,
  isDirty: false,
  saving: false,
  setSync: vi.fn(),
  setSyncServerUrl: vi.fn(),
  setSyncApiKey: vi.fn(),
  save: vi.fn(),
  refreshQueueSummary: vi.fn().mockResolvedValue(undefined),
  testSyncConnection: vi.fn(),
  syncRun: vi.fn(),
  syncPull: vi.fn(),
  requestSyncToken: vi.fn(),
});

function render(overrides: Record<string, unknown> = {}) {
  draftMock.value = { ...baseDraft(), ...overrides };
  // renderWithProvidersSync, not renderWithFluentSync: the screen calls useToast(),
  // which throws outside a ToastProvider (measured -- 4/4 cases failed this way
  // before the switch, all at Toast.tsx:53 "useToast must be used within a
  // ToastProvider"). The provider stack is also why the Fluent bundles are passed
  // here rather than mounted separately.
  return renderWithProvidersSync(<SyncStatusScreen />, settingsFtl, sharedFtl);
}

describe('SyncStatusScreen', () => {
  beforeEach(() => {
    draftMock.value = baseDraft();
  });

  // A screen that offers actions against an unconfigured server invites a
  // failure the operator cannot diagnose.
  it('says sync is unconfigured and offers no actions when nothing is set up', () => {
    render({ syncServerUrl: '', sync: { enabled: false } });
    // The bundle copy, not the JSX fallback: settings.ftl:382 reads
    // "Sync is not configured. Enter a server URL and enable sync." while the
    // source renders "Cloud sync is not configured." as its <Localized> child.
    // Asserting the JSX text would pass against a bundle that never loaded.
    expect(screen.getByText(/^Sync is not configured\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /test connection/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /sync now/i })).toBeNull();
  });

  // The dot is aria-hidden, so this text is the only channel a screen reader
  // has for the run outcome.
  it('prints the run error instead of the success wording when a sync fails', async () => {
    const user = userEvent.setup();
    const syncRun = vi.fn().mockResolvedValue({ synced: 0, failed: 0, error: 'Server rejected the push' });
    render({ syncRun });
    await user.click(screen.getByRole('button', { name: /sync now/i }));
    await waitFor(() => {
      expect(screen.getByTestId('sync-status-indicator').textContent).toContain('Server rejected the push');
    });
  });

  it('shows the upgrade hint on a free plan and hides it on pro', () => {
    const { unmount } = render({ syncPlan: { ok: true, plan: 'free' } });
    expect(screen.getByTestId('sync-status-plan-row').textContent).toContain('Upgrade to sync to the cloud');
    unmount();
    render({ syncPlan: { ok: true, plan: 'pro' } });
    const row = screen.getByTestId('sync-status-plan-row');
    expect(row.textContent).toContain('Pro');
    expect(row.textContent).not.toContain('Upgrade to sync to the cloud');
  });

  // A pull overwrites local rows. One click must open the dialog, not act.
  it('never pulls on the first click — the destructive action needs confirmation', async () => {
    const user = userEvent.setup();
    const syncPull = vi.fn().mockResolvedValue({ productsPulled: 0, taxRatesPulled: 0, usersPulled: 0 });
    render({ syncPull });
    await user.click(screen.getByRole('button', { name: /pull from server/i }));
    expect(syncPull).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});