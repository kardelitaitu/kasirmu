// ── `+dirty` must mean modified, not merely untracked (F25) ───────────
//
// `computeBuildId` stamps the build `short-sha+dirty` when `git status --porcelain`
// is non-empty, and that command reports UNTRACKED paths too. On this very checkout
// — three untracked paths, ZERO modified tracked files — every build therefore stamps
// `+dirty` while the code IS the commit it names.
//
// Measured on the connected tablet 2026-10-09: the footer read `v0.0.41 ·
// 4316156+dirty` while `git status --porcelain --untracked-files=no` was EMPTY.
//
// Why it matters more than a cosmetic suffix: this module's own contract says the
// suffix means "this code is not in that commit" (build-id.node.ts:11-12) — the one
// signal that an APK is unreproducible. A warning that is always lit is not a warning,
// and it made F15's "is the device even running this build?" harder to answer than the
// question deserved.
//
// WHY THIS READS THE SOURCE rather than calling the function with a mocked
// `child_process`: `ui/vite.config.ts:5` imports this module at CONFIG-EVALUATION time,
// so it is already in the module graph before any `vi.mock` in a test file and
// `vi.resetModules()` cannot evict it — a mocked run silently used the cached
// instance and reported the OLD call shape. Reading the source is honest about what it
// checks (the command that is built) and cannot be defeated by import caching.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = ['ui/src/build-id.node.ts', 'ui/vite.config.ts'];
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (markers.every((m) => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the repo root from ' + process.cwd());
}

const SRC = fs.readFileSync(
  path.join(findRoot(), 'ui/src/build-id.node.ts'),
  'utf-8',
);

describe('computeBuildId asks git the right question (F25)', () => {
  it('excludes untracked files from the dirty check', () => {
    const m = SRC.match(/git\(\[\s*'status'\s*,\s*'--porcelain'[^\]]*\]/);
    expect(m, 'the dirty-check git invocation was not found — extraction has drifted')
      .not.toBeNull();
    expect(
      m![0],
      'the dirty check must pass --untracked-files=no. Bare `status --porcelain` also ' +
        'reports untracked paths, so any scratch file marks the build dirty even when ' +
        'every tracked file matches HEAD — which is what the tablet footer showed.',
    ).toContain('--untracked-files=no');
  });

  it('still asks git for something to compare against', () => {
    // Guards against "fixing" this by dropping the check entirely, which would make
    // the stamp permanently clean — the same uselessness in the other direction.
    // Matched LINE BY LINE, not against the whole file: the doc comment above the
    // function quotes the command it explains, so a whole-file regex can be satisfied
    // by prose. Only the executable lines may satisfy these.
    const code = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code, 'the SHA read was removed — the stamp can no longer name a commit')
      .toMatch(/\['rev-parse',\s*'--short=7',\s*'HEAD'\]/);
    expect(code, 'the dirty suffix was removed — a modified tree would stamp clean')
      .toMatch(/dirty\s*\?\s*`\$\{sha\}\+dirty`\s*:\s*sha/);
  });
});