// ── A setting the app WRITES and never reads (F26) ────────────────────
//
// `store.preset` is written once at provisioning (`provisioning.rs:825`) and read by
// nothing in production — the only reads are in `*_tests.rs` files and the key's own
// declaration. Measured on the connected tablet 2026-10-09: it holds `'restaurant'`
// alongside TEN explicit `feature.*` rows, and it is the FEATURES the app reads
// (`features.rs:289`). The preset is a label recording how the device was provisioned;
// nothing derives behaviour from it.
//
// This is the write-side twin of the F1 dead-key class. F1 asked "is this key the UI
// shows actually read?"; this asks "is this key the backend WRITES actually read?" —
// and it is invisible from the UI, because a key with no control has no screen to
// notice it on. Only a read of the database shows it exists at all.
//
// PINNED, NOT REMOVED. Dropping the write is a data-format change across the
// provisioning path, and the key may be intended as a support/diagnostic record. What
// is wrong today is that nothing SAYS it is a record rather than an input — so this
// test says it, and fails if the situation changes in either direction.
//
// INVERT, DO NOT DELETE: if a production reader appears, this pin has done its job and
// should be replaced by a positive assertion that the key is honoured.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = ['platform/core/src/settings/keys.rs', 'crates/kasirmu-core/src/db/provisioning.rs'];
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

/** Every `.rs` file under a crate/app/platform/module dir, excluding tests and target. */
function rustFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      if (name.isDirectory()) {
        if (['target', 'node_modules', '.git'].includes(name.name)) continue;
        walk(path.join(dir, name.name));
      } else if (name.name.endsWith('.rs')) {
        out.push(path.join(dir, name.name));
      }
    }
  };
  for (const d of ['platform', 'crates', 'apps', 'modules', 'foundation']) {
    const full = path.join(ROOT, d);
    if (fs.existsSync(full)) walk(full);
  }
  return out;
}

/** A file that only DECLARES the key, or only tests it, is not a reader. */
const isReaderFile = (rel: string): boolean =>
  !/settings\/keys\.rs$/.test(rel) &&
  !/_tests\.rs$/.test(rel) &&
  !/\/tests\//.test(rel) &&
  !/tests\.rs$/.test(rel);

/**
 * Keys this app is known to WRITE but never READ, each with where it is written.
 * An entry is a recorded debt: it says the value is a record, not an input.
 *
 * ⚠️ `needles` lists EVERY spelling a reader could plausibly use, and that is not
 * belt-and-braces — my first version searched only `store_preset`, which appears NOWHERE
 * in Rust: the constant is `STORE_PRESET` and the key literal is `"store.preset"`. The
 * guard therefore passed against a planted production reader, i.e. it could never fail.
 * A kill-test caught it. Match the constant, the name as it appears in a `keys::` path,
 * and the raw key string.
 */
const WRITTEN_NOT_READ: Array<{
  name: string;
  needles: string[];
  /** The one file allowed to name it: the writer. */
  writer: string;
  why: string;
}> = [
  {
    name: 'store.preset',
    needles: ['STORE_PRESET', 'store.preset'],
    writer: 'crates/kasirmu-core/src/db/provisioning.rs',
    why: 'provisioning.rs:825 writes it; the app reads feature.* instead',
  },
];

describe('a written setting has a reader (F26)', () => {
  const files = rustFiles().map((f) => ({
    rel: path.relative(ROOT, f).split(path.sep).join('/'),
    text: fs.readFileSync(f, 'utf-8'),
  }));

  it('found the Rust tree (guards the guard)', () => {
    expect(files.length, 'the walk found no .rs files — every case below would be vacuous')
      .toBeGreaterThan(200);
  });

  it('each needle actually occurs somewhere (guards the guard, again)', () => {
    // A needle that matches NOTHING makes the case below unfalsifiable. This is exactly
    // how the first version of this file passed against a planted reader.
    for (const { name, needles } of WRITTEN_NOT_READ) {
      for (const n of needles) {
        expect(
          files.some((f) => f.text.includes(n)),
          `needle "${n}" for "${name}" appears in no Rust file — the check is vacuous`,
        ).toBe(true);
      }
    }
  });

  it('the recorded keys really are unread in production', () => {
    for (const { name, needles, writer, why } of WRITTEN_NOT_READ) {
      const reads = files.filter(
        (f) =>
          isReaderFile(f.rel) &&
          // The writer itself is not a reader — it is the file the key is recorded AS
          // being written from, so naming it there is expected, not a violation.
          f.rel !== writer &&
          needles.some((n) => f.text.includes(n)),
      );
      expect(
        reads.map((f) => f.rel),
        `"${name}" now HAS a production reader (${why}) — delete its entry and assert the ` +
          'key is honoured instead of pinning it as a record',
      ).toEqual([]);
    }
  });
});