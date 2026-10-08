/**
 * useDataSyncDraft - the cloud-sync draft contract.
 *
 * This hook had NO dedicated suite: 233 lines owning `hasApiKey`, `save`,
 * `isDirty` and the four sync actions, consumed by DataSyncScreen.tsx and
 * SyncStatusScreen.tsx. Its only indirect exercise was 22 `it.skip` cases in
 * CloudSyncSettings.test.tsx that mount the whole SettingsPage and fail on a
 * navigation step removed by the flat-IA rebuild -- so the layer below
 * SyncSection was, in practice, ungraded.
 *
 * Why the hook is testable where the page was not: every dependency is a
 * module-scope mock or a context whose shape is one object, so a case here is a
 * statement about a VALUE (what Save tried to persist, what a token-less call
 * returns) rather than about which IPC command happened to run.
 *
 * The three properties worth pinning, all of them data-loss shaped:
 *   1. A token-less call reaches NO door and returns a failed result, never a
 *      fabricated success.
 *   2. Save sends the api key ONLY when one was typed -- the DTO never echoes it
 *      back, so an unconditional send clears a stored credential.
 *   3. A failed queue-summary read keeps the previous value instead of claiming
 *      zero pending.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import type { SyncSettingsDto } from '@/api/offline';

// ── module-scope fakes ─────────────────────────────────────────────────
const api = vi.hoisted(() => ({
  getSyncPlan: vi.fn(),
  getQueueSummary: vi.fn(),
  requestToken: vi.fn(),
  pull: vi.fn(),
  run: vi.fn(),
  testConnection: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/api/offline', () => ({
  getSyncPlanScoped: (...a: unknown[]) => api.getSyncPlan(...a),
  getOfflineQueueStatusSummaryScoped: (...a: unknown[]) => api.getQueueSummary(...a),
  requestSyncTokenScoped: (...a: unknown[]) => api.requestToken(...a),
  syncPullScoped: (...a: unknown[]) => api.pull(...a),
  syncRunScoped: (...a: unknown[]) => api.run(...a),
  testSyncConnectionScoped: (...a: unknown[]) => api.testConnection(...a),
  updateSyncSettingsScoped: (...a: unknown[]) => api.update(...a),
}));

// ── context fakes ──────────────────────────────────────────────────────
const ctx = vi.hoisted(() => ({
  sessionToken: 'tok-1' as string | null,
  contextSync: null as SyncSettingsDto | null,
  markSettingsUpdated: vi.fn(),
  addToast: vi.fn(),
}));

const isTablet = vi.hoisted(() => ({ value: false }));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: ctx.sessionToken }),
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: ctx.contextSync ? { sync: ctx.contextSync } : { sync: undefined },
    markSettingsUpdated: ctx.markSettingsUpdated,
  }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: ctx.addToast }),
}));

vi.mock('@/utils/shellKind', () => ({
  isTabletShell: () => isTablet.value,
}));

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({ l10n: { getString: (id: string) => id } }),
}));

import { useDataSyncDraft } from '../hooks/useDataSyncDraft';

// ── fixtures ───────────────────────────────────────────────────────────
const SEEDED: SyncSettingsDto = {
  serverUrl: 'https://sync.example.com',
  hasApiKey: true,
  enabled: true,
  resolvedOrigin: 'https://license.kasir.mu',
  resolvedOriginSource: 'main',
};

const OK_TOKEN = { ok: true, token: 'fresh-token', status: 'Token generated', expiresAt: null };
const OK_PING = { ok: true, status: 'pong', latencyMs: 12 };
const OK_ATTEMPT = { synced: 3, failed: 0, error: null };
const OK_PULL = { productsPulled: 1, taxRatesPulled: 2, usersPulled: 3, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  ctx.sessionToken = 'tok-1';
  ctx.contextSync = SEEDED;
  isTablet.value = false;
  api.getSyncPlan.mockResolvedValue(null);
  api.getQueueSummary.mockResolvedValue(null);
  api.update.mockResolvedValue(undefined);
});

function mount() {
  return renderHook(() => useDataSyncDraft());
}

// ── 1. seeding ─────────────────────────────────────────────────────────

describe('seeding from the context read', () => {
  it('seeds the draft from the context sync value', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.sync.serverUrl).toBe('https://sync.example.com'));
    expect(result.current.sync.enabled).toBe(true);
    expect(result.current.sync.hasApiKey).toBe(true);
    expect(result.current.syncServerUrl).toBe('https://sync.example.com');
  });

  it('never seeds the api-key field from the read, because the DTO never carries one', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.sync.hasApiKey).toBe(true));
    // `hasApiKey` is a boolean, not the key: seeding it would fabricate a credential.
    expect(result.current.syncApiKey).toBe('');
  });

  it('is not dirty immediately after seeding', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example.com'));
    expect(result.current.isDirty).toBe(false);
  });
});

// ── 2. isDirty ─────────────────────────────────────────────────────────

describe('isDirty', () => {
  it('becomes true when the server URL is edited', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example.com'));
    act(() => result.current.setSyncServerUrl('https://other.example.com'));
    expect(result.current.isDirty).toBe(true);
  });

  it('becomes true when the enabled flag is toggled', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.sync.enabled).toBe(true));
    act(() => result.current.setSync((prev) => ({ ...prev, enabled: false })));
    expect(result.current.isDirty).toBe(true);
  });

  it('becomes true when a real api key is typed', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example.com'));
    // The URL and the flags are untouched, so ONLY the typed-key branch of
    // isDirty can make this true. Without this case that branch can be deleted
    // and the suite stays green -- proven by mutation.
    act(() => result.current.setSyncApiKey('sk-typed'));
    expect(result.current.isDirty).toBe(true);
  });

  it('stays clean for a whitespace-only api key', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example.com'));
    act(() => result.current.setSyncApiKey('   '));
    // Trimmed, so an accidental space is not a credential the user typed.
    expect(result.current.isDirty).toBe(false);
  });
});

// ── 3. save: the api-key rule ──────────────────────────────────────────

describe('save', () => {
  it('omits apiKey entirely when the user typed nothing', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example.com'));

    await act(async () => { await result.current.save(); });

    expect(api.update).toHaveBeenCalledTimes(1);
    const payload = api.update.mock.calls[0]![1] as Record<string, unknown>;
    // THE data-loss guard: the DTO never echoes the key, so sending an empty
    // string would clear a stored credential on every unrelated save.
    expect(payload).not.toHaveProperty('apiKey');
    expect(payload['serverUrl']).toBe('https://sync.example.com');
    expect(payload['enabled']).toBe(true);
  });

  it('sends apiKey when the user typed one', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example.com'));
    act(() => result.current.setSyncApiKey('sk-new'));

    await act(async () => { await result.current.save(); });

    const payload = api.update.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload['apiKey']).toBe('sk-new');
  });

  it('clears the api-key field and the dirty flag on success', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example.com'));
    act(() => result.current.setSyncApiKey('sk-new'));

    await act(async () => { await result.current.save(); });

    expect(result.current.syncApiKey).toBe('');
    expect(result.current.isDirty).toBe(false);
  });

  it('marks the sync keys updated so other screens refetch', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example.com'));
    await act(async () => { await result.current.save(); });
    expect(ctx.markSettingsUpdated).toHaveBeenCalledWith(['sync.serverUrl', 'sync.enabled']);
  });

  it('returns false and keeps the field when the write fails', async () => {
    api.update.mockRejectedValue(new Error('disk full'));
    const { result } = mount();
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example.com'));
    act(() => result.current.setSyncApiKey('sk-new'));

    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.save(); });

    expect(ok).toBe(false);
    // A failed write must not look like a successful one.
    expect(result.current.syncApiKey).toBe('sk-new');
    expect(ctx.addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('with no session token reaches no door and reports failure', async () => {
    ctx.sessionToken = null;
    const { result } = mount();

    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.save(); });

    expect(ok).toBe(false);
    expect(api.update).not.toHaveBeenCalled();
  });
});

// ── 4. the four actions ────────────────────────────────────────────────

describe('actions', () => {
  it('passes through each successful action result', async () => {
    api.testConnection.mockResolvedValue(OK_PING);
    api.run.mockResolvedValue(OK_ATTEMPT);
    api.pull.mockResolvedValue(OK_PULL);
    api.requestToken.mockResolvedValue(OK_TOKEN);
    const { result } = mount();
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example.com'));

    await expect(result.current.testSyncConnection()).resolves.toEqual(OK_PING);
    await expect(result.current.syncRun()).resolves.toEqual(OK_ATTEMPT);
    await expect(result.current.syncPull({ confirmDestructive: true })).resolves.toEqual(OK_PULL);
    await expect(result.current.requestSyncToken()).resolves.toEqual(OK_TOKEN);
    // The destructive-confirm flag is forwarded, not dropped: a pull that lost it
    // would stop asking before overwriting local data.
    expect(api.pull).toHaveBeenCalledWith('tok-1', { confirmDestructive: true });
  });

  it('coerces a null transport answer into a failed result, not a success', async () => {
    // Every read is coerced before it reaches state: a transport resolving
    // undefined must not become "pong".
    api.testConnection.mockResolvedValue(null);
    api.run.mockResolvedValue(undefined);
    api.pull.mockResolvedValue(null);
    api.requestToken.mockResolvedValue(null);
    const { result } = mount();
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example.com'));

    await expect(result.current.testSyncConnection()).resolves.toEqual({ ok: false, status: '', latencyMs: null });
    await expect(result.current.syncRun()).resolves.toEqual({ synced: 0, failed: 0, error: null });
    await expect(result.current.syncPull({ confirmDestructive: false })).resolves.toEqual({ productsPulled: 0, taxRatesPulled: 0, usersPulled: 0, error: null });
    await expect(result.current.requestSyncToken()).resolves.toEqual({ ok: false, token: null, status: '', expiresAt: null });
  });

  it('with no session token reaches none of the four doors', async () => {
    ctx.sessionToken = null;
    const { result } = mount();

    await result.current.testSyncConnection();
    await result.current.syncRun();
    await result.current.syncPull({ confirmDestructive: true });
    await result.current.requestSyncToken();

    expect(api.testConnection).not.toHaveBeenCalled();
    expect(api.run).not.toHaveBeenCalled();
    expect(api.pull).not.toHaveBeenCalled();
    expect(api.requestToken).not.toHaveBeenCalled();
  });
});

// ── 5. the supporting reads ────────────────────────────────────────────

describe('queue summary and plan', () => {
  it('reads both once for the token', async () => {
    api.getQueueSummary.mockResolvedValue({ pending: 2 });
    api.getSyncPlan.mockResolvedValue({ plan: 'pro' });
    const { result } = mount();

    await waitFor(() => expect(result.current.queueSummary).toEqual({ pending: 2 }));
    expect(result.current.syncPlan).toEqual({ plan: 'pro' });
    expect(api.getQueueSummary).toHaveBeenCalledTimes(1);
    expect(api.getSyncPlan).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous summary when a later read fails, instead of claiming zero pending', async () => {
    api.getQueueSummary.mockResolvedValue({ pending: 7 });
    const { result } = mount();
    await waitFor(() => expect(result.current.queueSummary).toEqual({ pending: 7 }));

    api.getQueueSummary.mockRejectedValue(new Error('offline'));
    await act(async () => { await result.current.refreshQueueSummary(); });

    // A failed read is not an answered-empty one.
    expect(result.current.queueSummary).toEqual({ pending: 7 });
  });

  it('does not open the queue-summary door on the tablet shell', async () => {
    isTablet.value = true;
    api.getQueueSummary.mockResolvedValue({ pending: 1 });
    const { result } = mount();

    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example.com'));
    await act(async () => { await result.current.refreshQueueSummary(); });

    // The tablet registers no door for this read and ADR #49 forbids adding one.
    expect(api.getQueueSummary).not.toHaveBeenCalled();
    expect(result.current.queueSummary).toBeNull();
  });

  it('clears the plan when the plan read fails', async () => {
    api.getSyncPlan.mockRejectedValue(new Error('no plan'));
    const { result } = mount();
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example.com'));
    expect(result.current.syncPlan).toBeNull();
  });
});
