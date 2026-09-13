// ── IPC/contract tests for cache.ts ─────────────────────────────
//
// Verifies getAppCacheDir resolves the platform app-cache directory
// through the mocked @tauri-apps/api/path dynamic import, and that it
// falls back to null when the path module is unavailable (outside a
// Tauri webview / dev-mock / plain browser) rather than throwing.
//
// The @tauri-apps/api/path module is stubbed GLOBALLY in
// ui/src/test-setup.ts (a per-file vi.mock cannot intercept cache.ts's
// dynamic import). This file drives that global stub's appCacheDir
// implementation to exercise both the resolved and the fallback paths.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as pathMod from '@tauri-apps/api/path';
import { getAppCacheDir } from '@/api/cache';

describe('cache.ts contract', () => {
  beforeEach(() => {
    vi.mocked(pathMod.appCacheDir).mockResolvedValue('/mock/appcache');
  });

  it('resolves the app cache dir from the path module', async () => {
    const dir = await getAppCacheDir();
    expect(dir).toBe('/mock/appcache');
    expect(pathMod.appCacheDir).toHaveBeenCalledTimes(1);
  });

  it('falls back to null when the path module call is unavailable', async () => {
    vi.mocked(pathMod.appCacheDir).mockRejectedValue(new Error('not in a webview'));
    const dir = await getAppCacheDir();
    expect(dir).toBeNull();
  });
});
