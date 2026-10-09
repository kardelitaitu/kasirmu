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

/**
 * Declared keys that are deliberately NOT read yet, each with the reason.
 *
 * These are the deliberate exceptions that keep the sweep honest: without them a
 * declared-ahead-of-implementation key would read as a defect, and the guard would be
 * noise. Each carries the evidence that the omission is INTENTIONAL.
 */
const DECLARED_AHEAD_OF_IMPLEMENTATION: Record<string, string> = {
  MEDIA_STORAGE_BACKEND: 'media pipeline is PLANNED stubs (crates/kasirmu-core/src/db/media.rs:1-12)',
  MEDIA_ROOT_PATH: 'media pipeline is PLANNED stubs (media.rs:1-12)',
  MEDIA_MAX_INPUT_BYTES: 'media pipeline is PLANNED stubs (media.rs:1-12)',
  MEDIA_MAX_PIXELS: 'media pipeline is PLANNED stubs (media.rs:1-12)',
  AUTH_TOKEN:
    'on the shared credential DENY LIST, so having no reader is the design — the test '
    + 'asserts the refusal instead (apps/mobile-tauri/src/commands/settings_tests.rs:458-483)',
};

/**
 * Keys whose behaviour MOVED elsewhere, leaving the declaration behind as a lie.
 *
 * This is the live defect class, not an exception: the constant stays and its doc
 * comment describes a mechanism that no longer reads it.
 */
const STALE_DECLARATION: Record<string, string> = {
  EDC_DEFAULT_TERMINAL:
    'moved to register LocalPrefs / terminal_profile.json '
    + '(docs/plans/_active/owner-question-2026-09-28-r4-r6-r7.md:51); key declared once, used nowhere',
};

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

  it('every declared settings key is either read, or classified here', () => {
    // The SWEEP, generalised from round 66: walk every `pub const … : &str = "key"` in
    // keys.rs and require each to be a production reader OR an entry in one of the two
    // maps above. A key that is neither is the defect this file exists for.
    const keysSrc = files.find((f) => f.rel.endsWith('settings/keys.rs'))?.text ?? '';
    const declared = [...keysSrc.matchAll(/pub const (\w+): &str = "([^"]+)"/g)];
    expect(declared.length, 'the key extraction found nothing — the regex has drifted')
      .toBeGreaterThan(50);

    const unclassified: string[] = [];
    for (const m of declared) {
      // Regex captures are `string | undefined` to the compiler; a matched group cannot
      // be undefined here, so narrow once rather than sprinkling assertions.
      const name = m[1];
      const key = m[2];
      if (name === undefined || key === undefined) continue;
      if (DECLARED_AHEAD_OF_IMPLEMENTATION[name]) continue;
      // A "reader" names the constant, or writes the key literal.
      const readers = files.filter(
        (f) => isReaderFile(f.rel) && (f.text.includes(name) || f.text.includes(`"${key}"`)),
      );
      const classified = WRITTEN_NOT_READ.some((e) => e.name === key) || STALE_DECLARATION[name];
      if (readers.length === 0 && !classified) {
        unclassified.push(`${name} (${key})`);
      }
    }

    expect(
      unclassified,
      'these declared settings keys have NO production reader and are not classified as '
        + 'declared-ahead-of-implementation or stale. Either read them, or add them to one of '
        + 'the maps with evidence: ' + unclassified.join(', '),
    ).toEqual([]);
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