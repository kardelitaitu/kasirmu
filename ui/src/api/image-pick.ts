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
// Nothing on the Rust side can open that as a path. The consumer is
// `kasirmu_bridge::products_images::ingest_to_store`, which reads the picked
// file with `tokio::fs::read(source_path)`
// (`crates/kasirmu-bridge/src/products_images.rs:113`) — a `content://` string
// is not a filesystem path, so the read fails and the ingest rejects.
//
// ## Why this bridge is `@tauri-apps/plugin-fs` and not a Rust change
//
// `plugin-fs` is content-URI-aware on Android: it resolves a URI through the
// platform content resolver rather than the filesystem
// (`tauri-plugin-fs android/.../FsPlugin.kt:63` —
// `contentResolver.openAssetFileDescriptor(uri, mode)`). So the bytes can be
// read out of the URI and written to a real path that Rust can open.
//
// The alternative — teaching the bridge to accept a `content://` URI — would
// need JNI content-resolver plumbing inside `kasirmu-bridge`, a crate whose
// stated invariant is that no tauri type enters it (see
// `apps/mobile-tauri/src/state.rs:66-68`, which resolves `media_cache_dir` in
// the shell for exactly this reason). Bridging here keeps that invariant and
// costs one read and one write per picked image.
//
// ## This module is SHARED by both shells
//
// `PosScreen` is mounted by the desktop shell (`ui/src/app/AppShell.tsx:39`)
// and the tablet shell (`ui/src/app/tablet/TabletAppShell.tsx:24`), and the
// same is true of the retail screens that mount `EditProductModal`. So a
// desktop pick must pass through UNTOUCHED: only a `content://` value is
// bridged, and everything else is returned as the path it already is.

import { isTauriWebview } from '@/api/tauri';

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

/** Android's Storage Access Framework scheme. */
const CONTENT_SCHEME = 'content://';

/** Extensions the picker offers, and the set the ingest pipeline accepts. */
const IMAGE_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg'];

/** A picked image, resolved to a path the Rust ingest commands can open. */
export interface PickedImageFile {
  /** A real filesystem path — `tokio::fs::read`-able, on either shell. */
  path: string;
  /**
   * Delete the bridged temp file.
   *
   * Call once the ingest has settled, success or failure. A no-op on desktop,
   * where the path is the user's own file and must NOT be deleted. Safe to call
   * more than once, and never rejects.
   */
  release: () => void;
}

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
 * where there is no picker to show at all — `@tauri-apps/plugin-dialog` would
 * otherwise throw `__TAURI_INTERNALS__.invoke is not a function` out of the
 * dev preview's deliberately partial stub (`ui/index.html:146`).
 *
 * Throws only for a genuine failure (plugin missing, permission refused,
 * unreadable URI). Callers should surface that as an error.
 */
export async function pickImageFile(): Promise<PickedImageFile | null> {
  if (!isTauriWebview()) return null;

  // Dynamic imports so neither plugin lands in the browser bundle — the same
  // treatment `api/browser.ts` gives `@tauri-apps/plugin-opener`, and for the
  // same reason: the dev preview never reaches these lines.
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
  if (!source.startsWith(CONTENT_SCHEME)) {
    return { path: source, release: () => {} };
  }

  const { readFile, writeFile, remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
  const { appCacheDir, join } = await import('@tauri-apps/api/path');

  const name = `${TEMP_FILE_STEM}${crypto.randomUUID()}${extensionOf(source)}`;

  // Read through the content resolver, write to the app cache.
  const bytes = await readFile(source);
  // Relative name + baseDir, rather than an absolute path: the plugin resolves
  // it with the same `path().app_cache_dir()` the capability's `$APPCACHE`
  // pattern expands from, so the scope match cannot drift. The absolute form is
  // needed only for the Rust side, below.
  await writeFile(name, bytes, { baseDir: BaseDirectory.AppCache });

  // Rust needs the ABSOLUTE path — `ingest_to_store` hands it to
  // `tokio::fs::read`, which has no notion of a base directory.
  const absolutePath = await join(await appCacheDir(), name);

  return {
    path: absolutePath,
    release: () => {
      // The file may already be gone (Android reclaimed the cache, or a retry
      // path released twice); a failed cleanup is not worth surfacing.
      void remove(name, { baseDir: BaseDirectory.AppCache }).catch(() => {});
    },
  };
}
