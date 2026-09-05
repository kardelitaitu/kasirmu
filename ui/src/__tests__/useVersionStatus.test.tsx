// ── useVersionStatus tests ───────────────────────────────────────
//
// Covers: initial 'checking' state, 'latest' when the updater returns
// null or the plugin is unavailable (browser/dev), 'update' when an
// update exists, version fallback on getVersion failure, and unmount
// safety (late resolutions must not touch state).
//
// Mocks: @/api/tauri (getVersion) and @tauri-apps/plugin-updater
// (check — vi.mock intercepts the hook's dynamic import too).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useVersionStatus } from '@/hooks/useVersionStatus';
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
});
