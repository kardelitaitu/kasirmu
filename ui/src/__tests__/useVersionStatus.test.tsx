// ── useVersionStatus tests ───────────────────────────────────────
//
// Covers: initial 'checking' state, 'latest' when the updater returns
// null or the plugin is unavailable (browser/dev), 'update' when an
// update exists, version fallback on getVersion failure, unmount
// safety (late resolutions must not touch state), and the shared
// in-flight check (concurrent consumers issue ONE `check()`).
//
// Mocks: @/api/tauri (getVersion) and @tauri-apps/plugin-updater
// (check — vi.mock intercepts the hook's dynamic import too).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useVersionStatus, resetVersionStatus } from '@/hooks/useVersionStatus';
import { getVersion } from '@/api/tauri';
import { check as updaterCheck } from '@tauri-apps/plugin-updater';

vi.mock('@/api/tauri', () => ({
  getVersion: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

// ── Tests ────────────────────────────────────────────────────────────

describe('useVersionStatus', () => {
  beforeEach(() => {
    // The probe is module-level, so a case that leaves one unsettled would
    // otherwise hand its promise to the next case.
    resetVersionStatus();
    vi.mocked(getVersion).mockReset();
    vi.mocked(updaterCheck).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in the checking state with version 0.0.0', () => {
    vi.mocked(getVersion).mockReturnValue(new Promise(() => {}));
    vi.mocked(updaterCheck).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useVersionStatus());
    expect(result.current.state).toBe('checking');
    expect(result.current.currentVersion).toBe('0.0.0');
    expect(result.current.availableVersion).toBeNull();
  });

  it('reports latest when the updater check returns null', async () => {
    vi.mocked(getVersion).mockResolvedValue('0.0.37');
    vi.mocked(updaterCheck).mockResolvedValue(null);

    const { result } = renderHook(() => useVersionStatus());
    await waitFor(() => expect(result.current.state).toBe('latest'));

    expect(result.current.currentVersion).toBe('0.0.37');
    expect(result.current.availableVersion).toBeNull();
  });

  it('reports latest when the updater plugin is unavailable (throws)', async () => {
    vi.mocked(getVersion).mockResolvedValue('0.0.37');
    vi.mocked(updaterCheck).mockRejectedValue(new Error('plugin missing'));

    const { result } = renderHook(() => useVersionStatus());
    await waitFor(() => expect(result.current.state).toBe('latest'));

    expect(result.current.currentVersion).toBe('0.0.37');
  });

  it('reports update with the available version when an update exists', async () => {
    vi.mocked(getVersion).mockResolvedValue('0.0.36');
    vi.mocked(updaterCheck).mockResolvedValue({ version: '0.0.37' } as Awaited<ReturnType<typeof updaterCheck>>);

    const { result } = renderHook(() => useVersionStatus());
    await waitFor(() => expect(result.current.state).toBe('update'));

    expect(result.current.currentVersion).toBe('0.0.36');
    expect(result.current.availableVersion).toBe('0.0.37');
  });

  it('falls back to version 0.0.0 when getVersion fails', async () => {
    vi.mocked(getVersion).mockRejectedValue(new Error('not tauri'));
    vi.mocked(updaterCheck).mockResolvedValue(null);

    const { result } = renderHook(() => useVersionStatus());
    await waitFor(() => expect(result.current.state).toBe('latest'));

    expect(result.current.currentVersion).toBe('0.0.0');
  });

  it('ignores late resolutions after unmount', async () => {
    vi.mocked(getVersion).mockResolvedValue('9.9.9');
    vi.mocked(updaterCheck).mockResolvedValue(null);

    const { result, unmount } = renderHook(() => useVersionStatus());
    unmount();

    // Let the pending promises resolve — the hook must not setState.
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.state).toBe('checking');
    expect(result.current.currentVersion).toBe('0.0.0');
  });

  // ── Shared probe (one per app session) ─────────────────────────
  //
  // `updater.check()` walks every endpoint in tauri.conf.json and logs one
  // error per endpoint that does not answer with a success status. A
  // per-component probe multiplied that noise by the number of mounted
  // consumers — and by StrictMode's double-invoke in dev. One probe now
  // serves every consumer, which is what lets the update banner stop
  // issuing a second one of its own.

  it('shares one check between simultaneous mounts', async () => {
    vi.mocked(getVersion).mockResolvedValue('0.0.39');
    // Never settles: the assertion is about how many requests the two
    // consumers ISSUE, so the window must stay open across the flush.
    vi.mocked(updaterCheck).mockReturnValue(new Promise(() => {}));

    renderHook(() => useVersionStatus());
    renderHook(() => useVersionStatus());

    // Flush getVersion + the dynamic import for BOTH hooks, so the count is
    // read only once each consumer has had every chance to call check().
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(vi.mocked(updaterCheck)).toHaveBeenCalledTimes(1);
  });

  it('reuses the settled answer for a later mount', async () => {
    vi.mocked(getVersion).mockResolvedValue('0.0.39');
    vi.mocked(updaterCheck).mockResolvedValue(null);

    const first = renderHook(() => useVersionStatus());
    await waitFor(() => expect(first.result.current.state).toBe('latest'));
    first.unmount();

    const second = renderHook(() => useVersionStatus());
    // No waitFor: a cached answer must be readable synchronously on the
    // very first render, or the banner would flash its "checking" state.
    expect(second.result.current.state).toBe('latest');
    expect(second.result.current.currentVersion).toBe('0.0.39');

    expect(vi.mocked(updaterCheck)).toHaveBeenCalledTimes(1);
  });

  it('runs a fresh check after an explicit reset', async () => {
    vi.mocked(getVersion).mockResolvedValue('0.0.39');
    vi.mocked(updaterCheck).mockResolvedValue(null);

    const first = renderHook(() => useVersionStatus());
    await waitFor(() => expect(first.result.current.state).toBe('latest'));
    first.unmount();

    resetVersionStatus();

    const second = renderHook(() => useVersionStatus());
    await waitFor(() => expect(second.result.current.state).toBe('latest'));

    expect(vi.mocked(updaterCheck)).toHaveBeenCalledTimes(2);
  });

  it('exposes the update handle so a second consumer can install it', async () => {
    vi.mocked(getVersion).mockResolvedValue('0.0.36');
    const update = { version: '0.0.37' } as Awaited<ReturnType<typeof updaterCheck>>;
    vi.mocked(updaterCheck).mockResolvedValue(update);

    const { result } = renderHook(() => useVersionStatus());
    await waitFor(() => expect(result.current.state).toBe('update'));

    // The banner needs `downloadAndInstall()` off this object; exposing it
    // is what lets it stop calling `check()` for itself.
    expect(result.current.instance).toBe(update);
  });
});
