/**
 * @vitest-environment node
 *
 * The restaurant settings screen states, in a comment block at the top of the file,
 * exactly which `restaurant.*` keys it owns — because THREE surfaces write restaurant
 * settings and "which key each control owns is stated here rather than inferred".
 *
 * That inventory had drifted in BOTH directions: it still listed
 * `restaurant.hold_order` (removed with its toggle in round 42, so nothing writes it)
 * and it omitted the four keys added since. An inventory that is the file's own
 * statement of ownership is worse than absent when it names a key nothing writes —
 * the same header-lag mechanism the plan doc has corrected repeatedly.
 *
 * This guard reads both sides out of the source and compares them, so the next key
 * added or removed fails here instead of silently desynchronising the comment.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REL = 'ui/src/features/restaurant/screens/RestaurantSettingsScreen.tsx';

function findRoot(): string {
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (
      (fs.existsSync(path.join(dir, 'todo-restaurant-pos-reliability.md')) ||
       fs.existsSync(path.join(dir, 'done-todo-restaurant-pos-reliability.md'))) &&
      fs.existsSync(path.join(dir, REL))
    ) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the repo root from ' + process.cwd());
}

const SRC = fs.readFileSync(path.join(findRoot(), REL), 'utf-8');

/** Keys the inventory comment claims this screen owns. */
function listedKeys(): string[] {
  const out: string[] = [];
  for (const line of SRC.split('\n')) {
    const m = /^\/\/\s+restaurant\.([a-z_]+)\s+(owned|SHARED)/.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
}

/** Keys the save path actually writes to `setSettingsScoped`. */
function writtenKeys(): string[] {
  const start = SRC.indexOf('setSettingsScoped(sessionToken, {');
  expect(start, 'the save call moved — re-point this guard').toBeGreaterThan(-1);
  const body = SRC.slice(start, SRC.indexOf('});', start));
  return [...body.matchAll(/'(restaurant\.[a-z_]+)'/g)].map((m) => m[1]!.replace('restaurant.', ''));
}

describe('RestaurantSettingsScreen key inventory matches what it saves', () => {
  it('parses both sides (guards against a silently empty comparison)', () => {
    // A case over an empty population reads exactly like a clean tree.
    expect(listedKeys().length, 'no inventory entries parsed').toBeGreaterThan(5);
    expect(writtenKeys().length, 'no written keys parsed').toBeGreaterThan(5);
  });

  it('lists no key the save path does not write', () => {
    const written = new Set(writtenKeys());
    const phantom = listedKeys().filter((k) => !written.has(k));
    expect(
      phantom.sort(),
      'the comment names a restaurant.* key this screen does not save',
    ).toEqual([]);
  });

  it('omits no key the save path writes', () => {
    const listed = new Set(listedKeys());
    const missing = writtenKeys().filter((k) => !listed.has(k));
    expect(
      missing.sort(),
      'this screen saves a restaurant.* key the ownership comment omits',
    ).toEqual([]);
  });
});
