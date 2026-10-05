//! Build-time half of the build identity -- RUNS git, and is imported ONLY by
//! the vite configs.
//!
//! Split from `build-id.ts` deliberately. That module is bundled into the browser
//! app, so a `node:*` import there is stubbed by Vite and breaks the bundle.
//! Keeping the two halves apart lets the app share the constant and the display
//! helper while only the build config touches the filesystem.
//!
//! `+dirty` marks a tree that was not clean when the bundle was built. That
//! matters more than it looks: an APK built from uncommitted edits can never be
//! reproduced from the commit its SHA names, so a bare SHA would be a confident
//! lie. The suffix says "this code is not in that commit".
//!
//! NEVER THROWS. A missing or unreadable `.git` is normal -- CI tarballs, a
//! packaged source drop, a shallow clone -- and a build must not fail because the
//! identity is unavailable. It degrades to 'unknown', which is honest and still
//! better than a version string that pretends to identify the build.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { UNKNOWN_BUILD_ID } from './build-id';

// `import.meta.url` is this file at `ui/src/build-id.node.ts`, so the repo root
// is TWO levels up: src, then ui, then the repo. This was wrong twice before it
// was right -- first `..` from `ui/`, then `../..` from `ui/`, which resolved to
// C:\dev. Both FAILED SILENTLY: git could not run, the catch returned 'unknown',
// and every build looked fine while stamping nothing. Measured, not reasoned.
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
 * `unknown` when git is unavailable for any reason.
 */
export function computeBuildId(): string {
  try {
    const sha = git(['rev-parse', '--short=7', 'HEAD']);
    if (!sha) return UNKNOWN_BUILD_ID;
    // `--porcelain` prints one line per changed path; empty output is clean.
    const dirty = git(['status', '--porcelain']).length > 0;
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    // No git, not a repository, no HEAD, or a permission failure. All four mean
    // "cannot name this build", which is what the constant says. Deliberately
    // silent: a log line here would be noise on every CI run without a .git.
    return UNKNOWN_BUILD_ID;
  }
}

/**
 * The `define` payload both vite configs spread, pairing the constant the app
 * reads with the value it should hold.
 */
export function buildIdDefine(): Record<string, string> {
  return { __BUILD_ID__: JSON.stringify(computeBuildId()) };
}
