// ── Browser opening (ADR #38) ──────────────────────────────────────
//
// `openProductImagesScoped` asks the backend to open the OS default
// browser in a new tab at a Google Images search for the product's
// name (+ brand). The query is built server-side; the frontend only
// passes the SKU.

import { loggedInvoke } from '@/utils/logged-invoke';
import { isTauriWebview } from '@/api/tauri';

/**
 * Origin of the marketing site, for links that leave the app (pricing,
 * addon checkout). The app's own WebView origin is `https://tauri.localhost`
 * under `useHttpsScheme`, so an in-app relative path such as `/pricing/`
 * resolves to a 404 rather than to the website — external links must be
 * absolute.
 */
export const WEBSITE_ORIGIN = 'https://ozpos.my.id';

/**
 * Open an ABSOLUTE URL in the OS default browser, in both shells.
 *
 * `window.open()` cannot be used for this on the tablet. It needs either
 * `WebSettings.setSupportMultipleWindows(true)` or a `WebChromeClient.onCreateWindow`
 * override, and `wry` (0.55.1) has neither: `RustWebChromeClient.kt` overrides
 * onShowCustomView / onPermissionRequest / onJsAlert / onJsConfirm / onJsPrompt /
 * onGeolocationPermissionsShowPrompt / onShowFileChooser and nothing else. With
 * multi-window support off the WebView discards the request — no navigation, no
 * error, no log line. Desktop WebView2 happens to open the system browser for
 * the same call, which is exactly why this divergence went unnoticed.
 *
 * `tauri-plugin-opener` is registered in BOTH shells (mobile lib.rs:74,
 * desktop lib.rs:109) and `opener:allow-open-url` is granted in BOTH capability
 * files, so `openUrl` is the supported cross-shell route.
 *
 * Outside a real webview (dev preview, dev-mock, plain browser) `window.open`
 * is still correct and is what runs there.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriWebview()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch (err) {
      // Plugin missing or refused (unregistered shell, denied permission).
      console.warn('openUrl unavailable, falling back to window.open', err);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Open the default browser at a Google Images search for a product
 * (ADR #38 D2/D3: query = name + brand, built server-side).
 *
 * Returns `false` when the opener is unavailable (dev-mock fallback:
 * `openExternalUrl`), `true` when the backend accepted the request.
 */
export const openProductImagesScoped = async (
  sessionToken: string,
  sku: string,
): Promise<boolean> => {
  try {
    await loggedInvoke<void>('open_product_images_scoped', { sessionToken, sku });
    return true;
  } catch (err) {
    // Dev-mock / browser fallback: open a Google Images search directly.
    console.warn('open_product_images_scoped unavailable, using window.open fallback', err);
    const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(sku)}`;
    void openExternalUrl(url);
    return false;
  }
};
