// ── Every evidence anchor must still resolve (F33) ─────────────────────
//
// `todo-restaurant-pos-reliability.md` closes with an evidence index: one row per
// finding, each citing `file:line` anchors for a reviewer to check. **Those anchors
// rot silently.** Two were found dead inside three rounds:
//
//   · F1  claimed "repo-wide grep returns no reader for 7 keys" — P1 wired 8 of them
//         and removed the other 2 (round 76).
//   · F2  cited `CartPanel.tsx:612`/`:655` for two `|| activeWorkspace === 'restaurant-pos'`
//         overrides that P1 step 3 REMOVED — `order_type_prompt` no longer appears in
//         that file at all, and the line numbers now land on a comment (round 77).
//
// A dead anchor is worse than a missing one. It still LOOKS like evidence — a path, a
// line, a colon — so a reviewer checks it, finds plausible-looking code nearby, and
// moves on. The F2 case landed on an unrelated comment about the settings surface.
//
// This guard checks the mechanical half: every `path:NN` in the index must point at a
// file that exists and a line that exists. It deliberately does NOT try to judge
// whether the line proves the claim — that is a reading, not a check. What it catches
// is the drift that made F2's anchors wrong: the file moved on and the number stayed.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = ['todo-restaurant-pos-reliability.md'];
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (markers.every((m) => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the repo root from ' + process.cwd());
}

const ROOT = findRoot();
const PLAN = path.join(ROOT, 'todo-restaurant-pos-reliability.md');

/** The evidence index: the contiguous table whose first column is `| F<n> |`. */
function evidenceRows(): string[] {
  return fs
    .readFileSync(PLAN, 'utf-8')
    .split('\n')
    .filter((l) => /^\| F\d+ \|/.test(l));
}

/**
 * Anchors of the form `Some/Path.ext:123` inside a row.
 *
 * Only paths that RESOLVE under the repo are returned: rows legitimately name
 * bare files (`CartPanel.tsx`) and sibling anchors (`:655`) that carry no
 * directory, and guessing a directory for those would invent failures.
 */
function resolveAnchor(ref: string, row: string): string | null {
  const [file, lineStr] = ref.split(':');
  if (!file || !lineStr) return null;
  const candidates = [
    file,
    'ui/src/' + file,
    'ui/src/features/sales/components/' + file,
    'ui/src/features/restaurant/screens/' + file,
    'ui/src/features/restaurant/components/' + file,
    'ui/src/features/settings/workspace-cards/' + file,
    'crates/kasirmu-bridge/src/' + file,
  ];
  for (const c of candidates) {
    const full = path.join(ROOT, c);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return c;
  }
  void row;
  return null;
}

describe('the plan evidence index still resolves (F33)', () => {
  const rows = evidenceRows();

  it('found the evidence rows (guards the guard)', () => {
    expect(rows.length, 'the evidence index moved or changed shape').toBeGreaterThan(10);
  });

  it('every resolvable anchor points at a line that exists', () => {
    const broken: string[] = [];
    let checked = 0;
    for (const row of rows) {
      const finding = row.slice(0, row.indexOf('|', 2)).replace(/[|\s]/g, '');
      // `File.ext:123` and `File.ext:123-456`; skip anything inside backticks that
      // is not a path:line (bare names, greps, script paths).
      for (const m of row.matchAll(/`?([A-Za-z0-9_./-]+\.(?:rs|tsx|ts|ftl)):(\d+)(?:-(\d+))?`?/g)) {
        const rel = resolveAnchor(m[1] + ':' + m[2], row);
        if (!rel) continue;
        checked += 1;
        const total = fs.readFileSync(path.join(ROOT, rel), 'utf-8').split('\n').length;
        const start = Number(m[2]);
        const end = m[3] ? Number(m[3]) : start;
        if (start > total || end > total) {
          broken.push(`${finding} ${rel}:${m[2]}${m[3] ? '-' + m[3] : ''} (file has ${total} lines)`);
        }
      }
    }
    // A vacuous run would pass while checking nothing.
    expect(checked, 'no anchors were resolvable — the extraction has drifted').toBeGreaterThan(5);
    expect(
      broken,
      'these evidence anchors point past the end of their file — the code moved and the ' +
        'line number stayed. Re-read the file and update or withdraw the anchor:',
    ).toEqual([]);
  });
});