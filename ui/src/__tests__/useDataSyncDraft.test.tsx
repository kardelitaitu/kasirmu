// ── useDataSyncDraft ───────────────────────────────────────────────
//
// The page-owned half of SyncSection: the flat-IA rebuild removed the sync form
// fields and the props went with them, so Settings → Data Sync has rendered
// "This page is being rebuilt." since (same shape as General → useStoreDraft).
//
// The cases pin what the section depends on: the draft seeds from the context
// read, edits mark it dirty, save writes the DRAFT through the scoped command
// and asks the context to refetch, and — the one that matters most — the API
// KEY is omitted from the write unless the user actually typed one, because the
// DTO never echoes it and a blind send would clear a stored credential.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const markSettingsUpdated = vi.fn();
const addToast = vi.fn();
let contextSync = { serverUrl: 'https://sync.example', hasApiKey: true, enabled: true, resolvedOrigin: 'https://sync.example', resolvedOriginSource: 'main' };

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: { sync: contextSync, store: {}, currencies: [], receipt: {}, brand: {}, preferences: {} },
    loading: false, error: null, hasPartialError: false, refetch: vi.fn(),
    lastChangedKeys: [], markSettingsUpdated,
  }),
  SettingsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok', switchStore: vi.fn() }),
}));
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

import { LocalizationProvider } from '@fluent/react';
import { createEnUsLocalization } from '@/i18n/createEnUsLocalization';
import { useDataSyncDraft } from '@/features/settings/hooks/useDataSyncDraft';

const wrapper = ({ children }: { children: ReactNode }) => (
  <LocalizationProvider l10n={createEnUsLocalization()}>{children}</LocalizationProvider>
);

describe('useDataSyncDraft', () => {
  beforeEach(() => {
    invokeMock.mockClear().mockResolvedValue(undefined);
    markSettingsUpdated.mockClear();
    addToast.mockClear();
    contextSync = { serverUrl: 'https://sync.example', hasApiKey: true, enabled: true, resolvedOrigin: 'https://sync.example', resolvedOriginSource: 'main' };
  });

  it('seeds the draft (and its URL field) from the context sync read', async () => {
    const { result } = renderHook(() => useDataSyncDraft(), { wrapper });
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example'));
    expect(result.current.sync.enabled).toBe(true);
    expect(result.current.isDirty).toBe(false);
  });

  it('never seeds the api-key field, because the server does not return it', async () => {
    const { result } = renderHook(() => useDataSyncDraft(), { wrapper });
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example'));
    // hasApiKey is true, yet the field is empty: the key is write-only.
    expect(result.current.sync.hasApiKey).toBe(true);
    expect(result.current.syncApiKey).toBe('');
    expect(result.current.isDirty).toBe(false);
  });

  it('marks the draft dirty when the URL or the enabled flag changes', async () => {
    const { result } = renderHook(() => useDataSyncDraft(), { wrapper });
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example'));

    act(() => { result.current.setSyncServerUrl('https://other.example'); });
    expect(result.current.isDirty).toBe(true);
  });

  it('omits apiKey from the write when the user typed none', async () => {
    const { result } = renderHook(() => useDataSyncDraft(), { wrapper });
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example'));

    await act(async () => { await result.current.save(); });

    const call = invokeMock.mock.calls.find((c) => String(c[0]).includes('update_sync_settings'));
    expect(call, 'expected an update_sync_settings* invoke').toBeTruthy();
    const args = (call![1] as { args: Record<string, unknown> }).args;
    expect(args).not.toHaveProperty('apiKey');
    expect(args['serverUrl']).toBe('https://sync.example');
  });

  it('sends apiKey when the user typed one, then clears the field', async () => {
    const { result } = renderHook(() => useDataSyncDraft(), { wrapper });
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example'));

    act(() => { result.current.setSyncApiKey('  fresh-key  '); });
    await act(async () => { await result.current.save(); });

    const call = invokeMock.mock.calls.find((c) => String(c[0]).includes('update_sync_settings'));
    const args = (call![1] as { args: Record<string, unknown> }).args;
    expect(args['apiKey']).toBe('  fresh-key  ');
    await waitFor(() => expect(result.current.syncApiKey).toBe(''));
  });

  it('tells the context which keys changed after a successful save', async () => {
    const { result } = renderHook(() => useDataSyncDraft(), { wrapper });
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example'));

    await act(async () => { await result.current.save(); });
    expect(markSettingsUpdated).toHaveBeenCalledWith(['sync.serverUrl', 'sync.enabled']);
  });

  it('re-seeds when the context reports different sync settings', async () => {
    const { result, rerender } = renderHook(() => useDataSyncDraft(), { wrapper });
    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://sync.example'));

    contextSync = { serverUrl: 'https://other.example', hasApiKey: false, enabled: false, resolvedOrigin: 'https://other.example', resolvedOriginSource: 'pinned' };
    rerender();

    await waitFor(() => expect(result.current.syncServerUrl).toBe('https://other.example'));
    expect(result.current.sync.enabled).toBe(false);
  });
});
