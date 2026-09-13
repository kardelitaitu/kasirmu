// ── Cache: app cache directory resolution ──────────────────────

/**
 * Resolve the platform app-cache directory (`$APPCACHE`), or `null` when
 * it is unavailable.
 *
 * Golden rule 5: components must not import `@tauri-apps/api/*` directly,
 * so the path wiring lives here. `@tauri-apps/api/path` is loaded via
 * dynamic import (avoids bundling the full path module in dev-mock).
 * Outside a Tauri webview — dev-mock, tests, plain browser — the import
 * or the call fails and this resolves to `null`, letting callers fall
 * back, mirroring the previous in-component guard.
 */
export const getAppCacheDir = async (): Promise<string | null> => {
  try {
    const pathModule = await import('@tauri-apps/api/path');
    return await pathModule.appCacheDir();
  } catch {
    // Not in a Tauri webview (dev-mock, test) — cache dir is unavailable.
    return null;
  }
};
