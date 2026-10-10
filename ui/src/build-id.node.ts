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

const UNKNOWN_BUILD_ID = 'unknown';

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
 *
 * ⚠️ `--untracked-files=no` is LOAD-BEARING, and its absence made this stamp useless
 * on the checkout it was written in. Bare `git status --porcelain` reports UNTRACKED
 * paths too, so a tree holding any scratch file — build logs, an editor's backup, the
 * tablet helper scripts this repo happens to keep untracked — stamped `+dirty` even
 * when EVERY TRACKED FILE matched HEAD. Measured on the connected tablet 2026-10-09:
 * the footer read `v0.0.41 · 4316156+dirty` while `status --porcelain
 * --untracked-files=no` was empty.
 *
 * That inverts the suffix's meaning. This module's contract is that `+dirty` says
 * "this code is NOT in that commit" — the one signal that a build is unreproducible.
 * A signal that is always lit is not a signal, and it cost real time: answering "is
 * the tablet even running the build under test?" required diffing commits by hand
 * because the stamp could not be trusted.
 *
 * The question this answers is "does the WORKTREE differ from the INDEX/HEAD for a
 * tracked path", which is exactly what `--untracked-files=no` asks git for. An
 * unrelated new file cannot make the compiled bytes differ from the named commit, so it
 * must not claim they do.
 */
export function computeBuildId(): string {
  try {
    const sha = git(['rev-parse', '--short=7', 'HEAD']);
    if (!sha) return UNKNOWN_BUILD_ID;
    // One line per changed TRACKED path; empty output is clean. Untracked files are
    // excluded deliberately — see the doc comment above.
    const dirty = git(['status', '--porcelain', '--untracked-files=no']).length > 0;
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
