//! Build identity stamp for the UI bundles.
//!
//! WHY THIS EXISTS. The app's version string is a RELEASE number: every build
//! from `v0.0.41` through the next tag reports `0.0.41`, so two APKs built
//! twelve hours apart are indistinguishable on the device. That is not
//! hypothetical -- on 2026-10-04 a tablet was running an APK built at 05:08
//! while HEAD was twelve hours and several features ahead, and the on-screen
//! version could not tell the difference. The commit is what distinguishes one
//! build from another, so this module stamps it at build time.
//!
//! `+dirty` marks a working tree that was not clean when the bundle was built.
//! That matters more than it looks: an APK built from uncommitted edits can
//! never be reproduced from the commit its SHA names, so a bare SHA would be a
//! confident lie. The suffix says "this code is not in that commit".
//!
//! NEVER THROWS. A missing or unreadable `.git` is normal -- CI tarballs, a
//! packaged source drop, a shallow clone -- and a build must not fail because
//! the identity is unavailable. It degrades to 'unknown', which is honest and
//! still better than a version string that pretends to identify the build.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** Value stamped when git cannot answer. Never a SHA-shaped guess. */
export const UNKNOWN_BUILD_ID = 'unknown';

/**
 * The repo root, derived from this file's own location.
 *
 * Script-relative rather than hardcoded, so a worktree or a checkout at a
 * different path stamps its own commit instead of the original clone's.
 */
// `import.meta.url` is this file at `ui/src/build-id.ts`, so the repo root is
// TWO levels up: src, then ui, then the repo. This line was wrong twice before
// it was right -- first `..` from `ui/`, then `../..` from `ui/` which resolved
// to C:\dev. Both versions FAILED SILENTLY: git could not run, the catch
// returned 'unknown', and every build looked fine while stamping nothing. It is
// measured, not reasoned, for that reason.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * `short-sha` for a clean tree, `short-sha+dirty` for a modified one, and
 * {@link UNKNOWN_BUILD_ID} when git is unavailable for any reason.
 */
export function computeBuildId(): string {
  try {
    const sha = git(['rev-parse', '--short=7', 'HEAD']);
    if (!sha) return UNKNOWN_BUILD_ID;
    // `--porcelain` prints one line per changed path; empty output is clean.
    const dirty = git(['status', '--porcelain']).length > 0;
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    // No git, not a repository, no HEAD (an empty repo), or a permission
    // failure. All four mean "cannot name this build", which is what the
    // constant says. Deliberately silent: a build log line here would be
    // noise on every CI run that legitimately has no .git.
    return UNKNOWN_BUILD_ID;
  }
}

/**
 * The `define` payload both vite configs spread, pairing the constant the
 * app reads with the value it should hold.
 */
export function buildIdDefine(): Record<string, string> {
  return { __BUILD_ID__: JSON.stringify(computeBuildId()) };
}

/**
 * The stamped build id, for app code.
 *
 * Reads the `define` constant through a `typeof` guard rather than bare: in a
 * plain `node` context (or a test that does not load vite's define) the global
 * does not exist, and an unguarded read would be a ReferenceError that takes
 * the whole footer down. Guarded, it degrades to {@link UNKNOWN_BUILD_ID} --
 * the same honest answer a missing .git produces.
 */
export function buildId(): string {
  return typeof __BUILD_ID__ === 'string' && __BUILD_ID__ ? __BUILD_ID__ : UNKNOWN_BUILD_ID;
}

/**
 * `v<version> · <build>` for display, with either half omitted when unknown.
 *
 * ONE formatter so the login footer, the setup footer, the staff footer and
 * the updater card cannot drift into four different spellings of the same
 * fact -- which is exactly how the five hardcoded `v0.0.41` literals came to
 * exist in the first place.
 *
 * `preferredVersion` lets a caller that has a BETTER version source win (the
 * updater card's own probe), while still sharing the build-id suffix and the
 * unknown handling.
 */
export function formatDisplayVersion(
  preferredVersion?: string | null,
  fallbackVersion?: string | null,
  build?: string | null,
): string {
  const version = preferredVersion || fallbackVersion || '';
  const stamp = build && build !== UNKNOWN_BUILD_ID ? build : '';
  // The separator belongs to the JOIN, not to the stamp: with no version to
  // precede, a stamped-only result would otherwise render as a leading
  // '· abc'. Measured -- that is what the first version of this did.
  if (version && stamp) return `v${version} · ${stamp}`;
  if (version) return `v${version}`;
  return stamp;
}
