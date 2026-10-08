//! Build identity for APP code -- the stamped commit, and one display helper.
//!
//! Deliberately free of `node:*` imports. This module is bundled into the
//! browser app, so a `node:path` or `node:child_process` import here is resolved
//! to Vite's browser-external stub and fails the bundle with
//! `"dirname" is not exported by "__vite-browser-external"` -- measured.
//! The build-time half that RUNS git lives in `build-id.node.ts`, which only the
//! vite configs import.
//!
//! WHY THE STAMP EXISTS. The app version is a RELEASE number: every build from
//! `v0.0.41` until the next tag reports `0.0.41`, so two APKs built twelve hours
//! apart are indistinguishable on a device. On 2026-10-04 a tablet was running
//! an APK from 05:08 while HEAD was hours and several features ahead, and the
//! on-screen version could not tell the difference. The commit can.

/**
 * The commit stamped by `define` in both vite configs.
 *
 * Declared here as well as in `vite-env.d.ts`: this module is also imported by
 * the vite configs, which compile under `tsconfig.node.json` -- a separate
 * project that does not include the app's ambient declarations.
 */
declare const __BUILD_ID__: string;

/** Value stamped when git cannot answer. Never a SHA-shaped guess. */
export const UNKNOWN_BUILD_ID = 'unknown';

/**
 * The stamped build id, e.g. `334f7f1` or `334f7f1+dirty`.
 *
 * `+dirty` means the tree had uncommitted edits, so the code is NOT what that
 * commit contains. Guarded with `typeof` because in a plain node context (or a
 * test that does not run vite's define) the global does not exist, and an
 * unguarded read would be a ReferenceError taking the whole footer down.
 */
export function buildId(): string {
  return typeof __BUILD_ID__ === 'string' && __BUILD_ID__ ? __BUILD_ID__ : UNKNOWN_BUILD_ID;
}

/**
 * `v<version> · <build>` for display, with either half omitted when unknown.
 *
 * ONE formatter so the login footer, the setup footer, the staff footer and the
 * updater card cannot drift into four spellings of the same fact -- which is how
 * five hardcoded `v0.0.41` literals came to exist in the first place.
 *
 * `preferredVersion` lets a caller with a BETTER source win (the updater card's
 * own probe) while still sharing the build-id suffix and unknown handling.
 */
export function formatDisplayVersion(
  preferredVersion?: string | null,
  fallbackVersion?: string | null,
  build?: string | null,
): string {
  const version = preferredVersion || fallbackVersion || '';
  const stamp = build && build !== UNKNOWN_BUILD_ID ? build : '';
  // The separator belongs to the JOIN, not the stamp: with no version, a
  // stamped-only result would otherwise render as a leading '· abc'.
  if (version && stamp) return `v${version} · ${stamp}`;
  if (version) return `v${version}`;
  return stamp;
}
