import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import id from '../i18n/id.json';

/**
 * The promise has to be made in words the reader already owns.
 *
 * Measured 2026-09-23: "offline-first" appeared 48 times across the marketing
 * pages, on nearly every one of them, and on `/id/` it sat inside an Indonesian
 * sentence in English — the first sentence a visitor reads was "dengan inti
 * offline-first ultra-ringan". "SOTA" appeared twice as an unexplained acronym
 * ("SOTA Rust engine"). Neither term is wrong, and both are what a POS vendor
 * says to another vendor; neither is what a warung owner searching "aplikasi
 * kasir tanpa internet" says. The plain phrasing is also the better search
 * match, so this is one fix serving both goals.
 *
 * THE RULE. A bare compound is not allowed. A string may still use the term if
 * it explains it in the same breath — "Works offline: never lose a sale during
 * an outage" teaches the term instead of assuming it. That is the difference
 * this test encodes: jargon-with-its-meaning, never jargon alone.
 *
 * THE BOUNDARY, and why it is not "everywhere". `src/content/docs/**` keeps the
 * term: those pages explain the architecture and need its name. `src/content/
 * legal/**` keeps it too — that is contract wording, not marketing copy, and a
 * plain-language pass is not a reason to edit a contract unilaterally.
 *
 * A value-level test is the right instrument because `audit-i18n.mjs` only sees
 * key presence and parity: every one of those 48 strings was a present, parity-
 * checked, correctly translated key. Being in the dictionary is not the same as
 * being understandable.
 */

const SRC = join(import.meta.dirname, '..');
const COMPOUND = /offline[-\s]?first/i;
/**
 * What counts as explaining it, in the same string or the same line.
 *
 * Deliberately NOT the bare word "offline": it is a substring of the compound
 * itself, so a pattern like `/offline\b/` matches "offline-first" and the rule
 * would gloss the very phrase it exists to catch — the first version of this
 * file did exactly that and passed with the jargon restored. A gloss has to say
 * what happens to the shop, not repeat the term.
 */
const GLOSS = /without internet|tanpa internet|internet mati|tanpa koneksi|koneksi mati|no internet/i;
const ACRONYM = /\bSOTA\b/;

type Entry = { key: string; value: string };

function strings(node: unknown, path = '', out: Entry[] = []): Entry[] {
  if (typeof node === 'string') {
    out.push({ key: path, value: node });
  } else if (Array.isArray(node)) {
    node.forEach((item, index) => strings(item, `${path}[${index}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      strings(value, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}

const dictionaries = { en, id } as Record<string, Record<string, unknown>>;
const SCANNED = /\.(?:astro|tsx|ts|json|mjs)$/;
const SKIPPED_DIRS = [
  `${sep}content${sep}docs${sep}`,
  `${sep}content${sep}legal${sep}`,
  `${sep}__tests__${sep}`,
  `${sep}i18n${sep}`,
];
const isComment = (line: string) => /^\s*(?:\/\/|\/\*|\*|<!--)/.test(line);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SCANNED.test(name)) out.push(path);
  }
  return out.filter((path) => !SKIPPED_DIRS.some((part) => path.includes(part)));
}

const relativeToSrc = (path: string) => relative(SRC, path).split(sep).join('/');

describe('plain language', () => {
  it.each(['en', 'id'] as const)(
    'never states the offline promise as a bare compound (%s)',
    (locale) => {
      const offenders = strings(dictionaries[locale])
        .filter(({ value }) => COMPOUND.test(value) && !GLOSS.test(value))
        .map(({ key, value }) => `${key}: ${value}`);
      expect(
        offenders,
        'say what it does instead — "works without internet", "tetap jualan tanpa internet"',
      ).toEqual([]);
    },
  );

  it.each(['en', 'id'] as const)('never sells an unexplained acronym (%s)', (locale) => {
    const offenders = strings(dictionaries[locale])
      .filter(({ value }) => ACRONYM.test(value))
      .map(({ key, value }) => `${key}: ${value}`);
    expect(offenders, '"SOTA" names nothing to the reader it is aimed at').toEqual([]);
  });

  it('keeps the compound out of component and page copy too', () => {
    // `perbandingan.astro` and the locale-detect stub carry copy that never
    // passes through the dictionary, so the dictionary arm alone would not see
    // them — and both said "offline-first" until this pass.
    const offenders: string[] = [];
    for (const path of walk(SRC)) {
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (isComment(line) || !COMPOUND.test(line) || GLOSS.test(line)) return;
          offenders.push(`${relativeToSrc(path)}:${index + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it.each(['en', 'id'] as const)('makes the promise plainly in the home hero (%s)', (locale) => {
    const dict = dictionaries[locale] as { hero: { subtitle: string } };
    const plain = locale === 'id' ? /tanpa internet/ : /without internet/;
    expect(dict.hero.subtitle).toMatch(plain);
  });

  it('makes the promise plainly in the features page description', () => {
    const desc = (d: Record<string, unknown>) =>
      (d.pageDesc as Record<string, string>).features;
    expect(desc(dictionaries.en)).toMatch(/without internet/);
    expect(desc(dictionaries.id)).toMatch(/tanpa internet/);
  });
});

describe('root locale stub', () => {
  const stub = readFileSync(join(SRC, 'pages', 'index.astro'), 'utf8');

  it('defines its title and description once', () => {
    // They were spelled out seven times — four titles, three descriptions, one
    // per social tag — so wording could drift between the <title> and the card
    // a social platform renders. Nothing compared them.
    const title = /const TITLE = '([^']+)'/.exec(stub)?.[1];
    const description = /const DESCRIPTION =\s*\n?\s*'([^']+)'/.exec(stub)?.[1];
    expect(title, 'the stub has no TITLE const').toBeTruthy();
    expect(description, 'the stub has no DESCRIPTION const').toBeTruthy();
    expect(stub.split(title as string)).toHaveLength(2);
    expect(stub.split(description as string)).toHaveLength(2);
  });

  it('carries none of that prose as a second literal', () => {
    // The tags that a reader or a crawler actually reads back. A literal
    // `content="…"` on any of them is a second copy waiting to drift;
    // `content={TITLE}` is not. Directives (viewport, og:locale, og:image)
    // are values rather than copy and are not in this list.
    const PROSE_META =
      /(?:name|property)="(?:description|og:title|og:description|twitter:title|twitter:description|twitter:image:alt)"/;
    const literals = [...stub.matchAll(/<meta\b[^>]*>/g)]
      .filter((m) => PROSE_META.test(m[0]) && /\scontent="/.test(m[0]))
      .map((m) => m[0].trim());
    expect(literals, 'reference TITLE / DESCRIPTION instead of repeating them').toEqual([]);
  });
});
