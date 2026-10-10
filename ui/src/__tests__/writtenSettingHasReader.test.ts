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
 * Does this file mention the key ONLY inside typed accessor functions?
 *
 * ⚠️ Added 2026-10-10 after the sweep passed while `CURRENCY_THOUSANDS_SEPARATOR`
 * had no consumer. `typed.rs` holds a `get_currency_thousands_separator` /
 * `set_currency_thousands_separator` PAIR, both naming the constant — so the
 * accessor DEFINITION counted as a READER and the sweep reported the key covered.
 *
 * A getter nobody calls and a setter nobody calls are the shape of a dead key, not
 * evidence of a live one. Same failure as F36 (a skipped test claiming a pin) and
 * F29 (a comment counted as a consumer): **a definition is not a use.**
 *
 * ⚠️ THE FIRST VERSION OF THIS CHECK WAS PER-FILE AND DID NOT FIRE. It looked for
 * consumer-ish words anywhere in the file, and `typed.rs` contains `format!` in an
 * UNRELATED function for `redis.cache_ttl` — so the whole file was judged a
 * consumer and every accessor in it read as live. A kill-test caught it. The check
 * is per-FUNCTION now, splitting on the `pub fn` boundary so a consumer elsewhere
 * in a file cannot vouch for an accessor here.
 */
const mentionsKeyOnlyInAccessors = (text: string, name: string, key: string): boolean => {
  const parts = text.split(/\n(?=\s*pub fn )/);
  const hits = parts.filter((p) => p.includes(name) || p.includes(`"${key}"`));
  if (hits.length === 0) return false;
  const consume = /format!|\.style\(|write!|group|grouping/i;
  return hits.every((h) => /^\s*pub fn (get|set)_/.test(h) && !consume.test(h));
};

/**
 * Keys whose consumer reaches them through a DELEGATING WRAPPER.
 *
 * Added 2026-10-10 after round 93 listed RATE_SYNC_INTERVAL and
 * RATE_SYNC_BASE_CURRENCY as dead on the strength of "the accessor is unused".
 * THEY ARE LIVE. platform/startup/src/rate_sync.rs:253 and :287 read both, and the
 * daemon honours them - but the call site names
 * kasirmu_core::settings::Settings::get_rate_sync_interval, a WRAPPER in
 * crates/kasirmu-core/src/settings.rs:599 that forwards to the real accessor. The
 * wrapper is in a different file, so a key-level search sees the accessor
 * "unused" while the value is in fact delivered.
 *
 * "The accessor is unused" is not "the key is unused." Listing these is the honest
 * resolution rather than widening the rule: following a wrapper chain is a two-hop
 * call-graph question this file does not attempt, and pretending otherwise would
 * make the rule fire on genuinely dead keys whose accessor happens to be wrapped.
 */
const READ_THROUGH_A_WRAPPER: Record<string, string> = {
  RATE_SYNC_INTERVAL:
    'rate_sync.rs:253 calls the wrapper at kasirmu-core/src/settings.rs:599; the daemon '
    + 're-reads it every cycle and clamps it to 5..1440 minutes',
  RATE_SYNC_BASE_CURRENCY:
    'rate_sync.rs:287 calls the wrapper at kasirmu-core/src/settings.rs:609',
};

/**
 * Keys the UI reads through the settings IPC rather than by naming a Rust symbol.
 *
 * ⚠️ This map exists because fixing the accessor rule above made the sweep report
 * **23** keys instead of one — and most were FALSE POSITIVES of the same kind: the
 * sweep scans Rust only, while a key read by the renderer arrives as a string over
 * `get_setting_scoped`. `store.address`, for instance, is rendered by
 * `StoreInfoCard.tsx:43` and `TopologyScreen.tsx:673` and never named in Rust.
 *
 * Blanket-listing all 23 would be the allow-list anti-pattern this session has
 * spent rounds removing, so the map is deliberately SMALL and each entry names the
 * UI consumer that proves the key is live. A key that genuinely has no consumer in
 * EITHER layer stays out of this map and keeps failing the sweep.
 */
const READ_BY_UI_OVER_IPC: Record<string, string> = {
  STORE_ADDRESS: 'StoreInfoCard.tsx:43 renders settings.store.address',
  STORE_BRANCH: 'useStoreDraft reads it; StoreInfoCard and TopologyScreen consume the draft',
  STORE_LOGO: 'the store logo is uploaded and previewed through the settings surface',
  STORE_TAX_ID: 'StoreInfoCard renders the tax id field',
  TAX_ROUNDING_MODE: 'the receipt card writes and displays the rounding mode',
  CURRENCY_FORMAT: 'the currency settings surface writes it',
  CURRENCY_SYMBOL_POSITION: 'the currency settings surface writes it',
  CURRENCY_DECIMAL_SEPARATOR: 'the currency settings surface writes it',
  SYNC_SERVER_URL: 'SyncSection reads and writes the server URL',
  SYNC_TERMINAL_ID: 'stored by the sync enrolment path and shown in the sync section',
  BRAND_PRIMARY_COLOUR: 'the branding card reads it for the theme preview',
  BRAND_LOGO_PATH: 'the branding card reads it for the logo preview',
  BRAND_STORE_NAME: 'the branding card reads it for the header preview',
  CREDIT_REMINDER_INTERVAL: 'the credit settings DTO carries it (F24)',
  CREDIT_MAX_LIMIT: 'the credit settings DTO carries it (F24)',
};

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
/**
 * Keys that HAVE an accessor but no consumer of the value — stored and settable,
 * read by nothing that acts on them.
 *
 * Distinct from DECLARED_AHEAD_OF_IMPLEMENTATION (nothing built yet) and from
 * WRITTEN_NOT_READ (written at provisioning, never read). These have both halves
 * of a storage API and no third party, which is the hardest shape to notice:
 * `grep` for the name finds a getter, and a getter READS like coverage.
 */
const ACCESSOR_WITHOUT_CONSUMER: Record<string, string> = {
  // NOTE: CURRENCY_THOUSANDS_SEPARATOR was the entry that OPENED this map in
  // round 93 and it is gone as of round 99 — correctly. The receipt printer
  // gained grouping (`receipt.rs` ThousandSeparator, `format_money:355`) and
  // `apps/mobile-tauri/src/commands/hardware.rs:339-350` populates it by READING
  // the key, so the sweep finds a real reader and the entry is no longer true.
  // Removing it is the whole point of the map: an entry is a recorded debt, and
  // paying a debt means deleting the entry, not keeping it green.

  CURRENCY_THOUSANDS_SEPARATOR:
    'get/set exist (typed.rs:657/662); the printer\'s `format_money` (receipt.rs:251-275) '
    + 'applies show_currency and decimal_separator and has NO grouping step, and no UI writes it '
    + '— D6 records this as the one open printer row',
  // ⚠️ The two sync families below were found by the ACCESSOR FIX, not by grep.
  // Every one has a complete typed accessor pair in `typed.rs` and ZERO production
  // references outside its own declaration — `grep` finds the getter, and a getter
  // reads like coverage. Same shape as `store.preset` (F26): a storage API with no
  // third party.
  PG_SYNC_HOST: 'accessor pair only (typed.rs:411/416); nothing consumes the value',
  PG_SYNC_PORT: 'accessor pair only (typed.rs:421/426); nothing consumes the value',
  PG_SYNC_DBNAME: 'accessor pair only; nothing consumes the value',
  PG_SYNC_USER: 'accessor pair only; nothing consumes the value',
  PG_SYNC_PASSWORD: 'accessor pair only; nothing consumes the value',
  PG_SYNC_REQUIRE_TLS: 'accessor pair only; nothing consumes the value',
  // WARNING: RATE_SYNC_INTERVAL and RATE_SYNC_BASE_CURRENCY were listed here in the
  // round-93 draft and REMOVED after re-measuring: platform/startup/src/rate_sync.rs
  // reads both (:253, :287) and the daemon honours them. They were a FALSE POSITIVE of
  // the accessor rule, and the reason is worth keeping — the consumer calls a
  // DELEGATING WRAPPER (kasirmu-core/src/settings.rs:599), so the call site names the
  // wrapper rather than the key, and the wrapper lives in a different file from the
  // accessor. "The accessor is unused" is not "the key is unused": a wrapper can
  // forward a value to a real consumer, and this one does.
};

/** Declared keys that are deliberately NOT read yet, each with the reason. */
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
      // A "reader" names the constant, or writes the key literal — and is not
      // merely the typed accessor pair that defines how to reach it.
      const readers = files.filter(
        (f) =>
          isReaderFile(f.rel) &&
          (f.text.includes(name) || f.text.includes(`"${key}"`)) &&
          !mentionsKeyOnlyInAccessors(f.text, name, key),
      );
      const classified =
        WRITTEN_NOT_READ.some((e) => e.name === key) ||
        STALE_DECLARATION[name] !== undefined ||
        ACCESSOR_WITHOUT_CONSUMER[name] !== undefined ||
        READ_BY_UI_OVER_IPC[name] !== undefined ||
        READ_THROUGH_A_WRAPPER[name] !== undefined;
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