// ── Image picking, with the Android content-URI bridge ─────────────
//
// `open()` from `@tauri-apps/plugin-dialog` returns DIFFERENT THINGS on the two
// shells, and the difference is invisible until the value reaches Rust:
//
//   * desktop (Windows / macOS / Linux) — a filesystem path, e.g.
//     `C:\Users\me\Pictures\a.png`;
//   * Android — a `content://` URI, e.g.
//     `content://com.android.providers.media.documents/document/image%3A1234`.
//
// The Android branch is not a quirk of the dialog plugin, it is the Storage
// Access Framework: `DialogPlugin.kt:117`/`:121` put `uri.toString()` into the
// response, and the plugin's Rust side deserialises it straight into
// `FilePath::Url` (`tauri-plugin-dialog src/mobile.rs:49`).
//
// The consumer is `kasirmu_bridge::products_images::ingest_to_store`, which
// reads the picked file with `tokio::fs::read(source_path)`
// (`crates/kasirmu-bridge/src/products_images.rs:113`) — a `content://` string
// is not a filesystem path, so the read fails and the ingest rejects. The
// crossing itself lives in `@/api/file-bridge`; this module is the picker plus
// the image-specific bits.
//
// ## This module is SHARED by both shells
//
// `PosScreen` is mounted by the desktop shell (`ui/src/app/AppShell.tsx:39`)
// and the tablet shell (`ui/src/app/tablet/TabletAppShell.tsx:24`), and the
// same is true of the retail screens that mount `EditProductModal`. So a
// desktop pick must pass through UNTOUCHED: only a `content://` value is
// bridged, and everything else is returned as the path it already is.

import { isTauriWebview } from '@/api/tauri';
import { copyUriToCache, isContentUri, type BridgedFile } from '@/api/file-bridge';

/**
 * Leading part of the bridged copy's filename in the app cache.
 *
 * Mirrored by the `fs:scope` allow-pattern in
 * `apps/mobile-tauri/capabilities/mobile.json` (`$APPCACHE/image-pick-*`).
 * The two are coupled: renaming this without renaming that produces a runtime
 * `forbidden path` error on the write, not a type error and not a test failure,
 * because the scope is enforced in the Rust plugin at call time.
 *
 * NOT named `*_PREFIX`, deliberately. `__tests__/storageKeyPins.test.ts` treats
 * any module-level `const` whose name matches `_PREFIX` as a localStorage key
 * and fails the build on an unpinned one — its `KEY_DECL` regex cannot tell a
 * cache filename from a storage key, and this is not a storage key. Renaming
 * this back to a `_PREFIX` form re-breaks that test; the fix there is not to
 * add a filename to a storage-key registry, which would make the registry lie.
 */
const TEMP_FILE_STEM = 'image-pick-';

/** Extensions the picker offers, and the set the ingest pipeline accepts. */
const IMAGE_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg'];

/** A picked image, resolved to a path the Rust ingest commands can open. */
export type PickedImageFile = BridgedFile;

/**
 * Best-effort extension for the bridged copy.
 *
 * Cosmetic only: the ingest pipeline sniffs magic bytes and ignores the
 * extension outright (`crates/kasirmu-bridge/src/products_images.rs`, "Sniff
 * magic bytes (extension is ignored)"). It is preserved when the URI carries
 * one so that a temp file caught mid-flight by a debugger still looks like what
 * it is. A `content://` URI usually ends in an opaque document id such as
 * `image%3A1234`, which is why the fallback matters.
 */
function extensionOf(uri: string): string {
  const match = /\.(webp|png|jpe?g)$/i.exec(decodeURIComponent(uri));
  const ext = match?.[1];
  return ext ? `.${ext.toLowerCase()}` : '.img';
}

/**
 * Open the image picker and return a path the Rust ingest can read.
 *
 * Returns `null` when the user dismissed the picker. That is the documented
 * cancel path on BOTH shells and must NOT be reported as an error: Android's
 * Kotlin callback rejects with `"File picker cancelled"`
 * (`DialogPlugin.kt:98`, `:237`), but `tauri-plugin-dialog` absorbs that
 * rejection into `f(None)` (`src/mobile.rs:66-70`, `:100-104`), so the command
 * resolves to `null` rather than throwing. A caller that wraps a cancel in an
 * error toast therefore fires on every dismissed picker.
 *
 * Also returns `null` outside a real webview (browser dev preview, dev-mock),
 * where there is no picker to show at all.
 *
 * Throws only for a genuine failure (plugin missing, permission refused,
 * unreadable URI). Callers should surface that as an error.
 */
export async function pickImageFile(): Promise<PickedImageFile | null> {
  if (!isTauriWebview()) return null;

  // Dynamic import so the plugin stays out of the browser bundle — the same
  // treatment `api/browser.ts` gives `@tauri-apps/plugin-opener`, and for the
  // same reason: the dev preview never reaches this line.
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    multiple: false,
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
  });

  // `open` is typed `string | string[] | null`; single selection yields a string.
  if (!picked) return null;
  const source = Array.isArray(picked) ? picked[0] : picked;
  if (!source) return null;

  // Desktop: already a real path. Hand it straight back, and never delete it.
  if (!isContentUri(source)) {
    return { path: source, release: () => {} };
  }

  return copyUriToCache(source, TEMP_FILE_STEM, extensionOf(source));
}
