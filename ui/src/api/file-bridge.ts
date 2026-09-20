// ── The Android content-URI bridge (shared core) ───────────────────
//
// Android's Storage Access Framework hands back `content://` URIs, and nothing
// on the Rust side can open one as a filesystem path. This module is the two
// halves of the crossing:
//
//   * `copyUriToCache`  — inbound. A picked `content://` URI → a real cache
//                         path that `tokio::fs::read` can open. Used by the
//                         image pickers and by `.kasirpkg` import.
//   * `copyCacheToUri`  — outbound. A cache path the Rust side wrote → the
//                         `content://` URI the user chose in the save dialog.
//                         Used by export. There is no inbound equivalent
//                         because Rust cannot write to a URI at all.
//
// Both go through `@tauri-apps/plugin-fs`, which on Android resolves a URI with
// the platform content resolver rather than the filesystem
// (`tauri-plugin-fs android/.../FsPlugin.kt:63` —
// `contentResolver.openAssetFileDescriptor(uri, mode)`).
//
// ## The scope asymmetry, which is the trap in this file
//
// The two halves are on OPPOSITE sides of `tauri-plugin-fs`'s mobile scope
// check, and reading either one alone gives the wrong answer:
//
//   * a `content://` URI is `SafeFilePath::Url`, and the mobile `resolve_file`
//     returns from the `Url` arm WITHOUT consulting the scope
//     (`tauri-plugin-fs src/commands.rs:1448-1477`);
//   * a cache path is `SafeFilePath::Path`, which takes the scope-checked arm
//     (`:1474-1479` → `resolve_path` → `is_allowed` at `:1573`).
//
// So every READ or WRITE of a URI needs no `fs:scope` entry, and every READ or
// WRITE of a cache path needs one. Each `stem` below therefore has a matching
// allow-pattern in `apps/mobile-tauri/capabilities/mobile.json`; adding a stem
// without its pattern is a runtime `forbidden path` error on the cache leg, not
// a type error and not a test failure.
//
// ## Why the bridge lives in JS and not in Rust
//
// Teaching `kasirmu-bridge` to accept a `content://` URI would need JNI
// content-resolver plumbing inside a crate whose stated invariant is that no
// tauri type enters it (`apps/mobile-tauri/src/state.rs:66-68` resolves
// `media_cache_dir` in the shell for exactly this reason). Bridging here keeps
// that invariant and costs one read and one write per file.

import { isTauriWebview } from '@/api/tauri';

/** Android's Storage Access Framework scheme. */
export const CONTENT_SCHEME = 'content://';

/**
 * True when a picked value is a URI rather than a filesystem path.
 *
 * The same string arrives as a path on desktop and as a URI on Android, so
 * every caller has to ask which one it got. Exported because callers that only
 * need to *label* a selection (rather than read it) must not bridge at all.
 */
export function isContentUri(value: string): boolean {
  return value.startsWith(CONTENT_SCHEME);
}

/** A cache copy of a picked file, plus the means to remove it. */
export interface BridgedFile {
  /** Absolute path — `tokio::fs::read`-able, and the value Rust must receive. */
  path: string;
  /**
   * Delete the cache copy. Call once the consuming command has settled,
   * success or failure. Safe to call more than once, and never rejects.
   */
  release: () => void;
}

/**
 * Copy a picked `content://` URI into the app cache and return the real path.
 *
 * `stem` must match an `fs:scope` allow-pattern in the tablet capability — see
 * the scope note at the top of this file. It is also what distinguishes the
 * temp files of one caller from another's, so two concurrent bridges cannot
 * collide. `suffix` is appended after the generated id, for callers that want
 * to preserve an extension.
 *
 * Throws only for a genuine failure (plugin missing, permission refused,
 * unreadable URI). Callers surface that as an error.
 */
export async function copyUriToCache(
  source: string,
  stem: string,
  suffix = '',
): Promise<BridgedFile> {
  const { readFile, writeFile, remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
  const { appCacheDir, join } = await import('@tauri-apps/api/path');

  const name = `${stem}${crypto.randomUUID()}${suffix}`;

  // Relative name + baseDir, rather than an absolute path: the plugin resolves
  // it with the same `path().app_cache_dir()` the capability's `$APPCACHE`
  // pattern expands from, so the scope match cannot drift. The absolute form is
  // needed only for the Rust side, below.
  await writeFile(name, await readFile(source), { baseDir: BaseDirectory.AppCache });

  // Rust needs the ABSOLUTE path — `tokio::fs::read` has no base directory.
  const absolutePath = await join(await appCacheDir(), name);

  return {
    path: absolutePath,
    release: () => {
      // The copy may already be gone (Android reclaimed the cache, or a retry
      // released twice); a failed cleanup is not worth surfacing.
      void remove(name, { baseDir: BaseDirectory.AppCache }).catch(() => {});
    },
  };
}

/**
 * Copy a cache file the Rust side wrote out to the URI the user chose.
 *
 * The outbound leg of an export: `export_data` takes a destination *path*, and
 * a `content://` URI is not one, so the command is pointed at a cache path and
 * the bytes are moved to the user's real destination here.
 *
 * The cache file is removed once it has been copied — the user's destination is
 * now the only copy, which is the same end state a desktop export produces.
 *
 * Throws on failure. A destination that cannot be written is a failed export
 * and must be reported as one, not swallowed.
 */
export async function copyCacheToUri(cachePath: string, destinationUri: string): Promise<void> {
  const { readFile, writeFile, remove } = await import('@tauri-apps/plugin-fs');

  const bytes = await readFile(cachePath);
  await writeFile(destinationUri, bytes);

  // `write_file` also enables `open`/`write`, so an explicit remove is still
  // required to drop the cache copy; there is no truncate-on-move here.
  await remove(cachePath).catch(() => {
    // Best-effort: the export itself already succeeded.
  });
}

/**
 * Absolute path for a new cache file with the given `stem`.
 *
 * Used by callers that need to tell Rust *where* to write before any bytes
 * exist (export), rather than handing it bytes (import).
 */
export async function cachePathFor(stem: string, suffix = ''): Promise<string> {
  const { appCacheDir, join } = await import('@tauri-apps/api/path');
  return join(await appCacheDir(), `${stem}${crypto.randomUUID()}${suffix}`);
}

/**
 * True when a real webview is reachable, so a picker can be shown at all.
 *
 * Re-exported through this module so callers bridging a file have one import
 * for both the guard and the bridge. Outside a webview
 * `@tauri-apps/plugin-dialog` throws
 * `__TAURI_INTERNALS__.invoke is not a function` out of the dev preview's
 * deliberately partial stub (`ui/index.html:146`).
 */
export { isTauriWebview };
