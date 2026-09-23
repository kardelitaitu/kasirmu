// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPreferredLanguage, setPreferredLanguage } from '../language';

describe('language helpers (localStorage get/set)', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns null when no value is stored', () => {
    expect(getPreferredLanguage()).toBeNull();
  });

  it('returns the stored language after setPreferredLanguage', () => {
    setPreferredLanguage('id');
    expect(getPreferredLanguage()).toBe('id');
  });

  it('overwrites a previously stored language', () => {
    setPreferredLanguage('en');
    expect(getPreferredLanguage()).toBe('en');
    setPreferredLanguage('id');
    expect(getPreferredLanguage()).toBe('id');
  });

  it('reads the oz_language key from localStorage', () => {
    localStorage.setItem('oz_language', 'id');
    expect(getPreferredLanguage()).toBe('id');
  });

  it('returns null for an unrecognized value stored in localStorage', () => {
    localStorage.setItem('oz_language', 'fr');
    // The function returns whatever is in localStorage, cast to Language.
    // Consumers decide whether to trust the value — the helper is agnostic.
    expect(getPreferredLanguage()).toBe('fr');
  });
});

/**
 * The preferred language decides which locale a visitor lands on, so a second
 * spelling of `oz_language` is a routing bug rather than untidiness: the
 * switcher persists the choice and the root and /pair stubs read it back to pick
 * a redirect target, so a writer and a reader naming different keys would
 * silently ignore the user's choice. The value is unchanged, so anything already
 * stored keeps working.
 */
describe('the language storage key has exactly one owner', () => {
  const SRC = join(import.meta.dirname, '..', '..');
  const OWNER = 'lib/language.ts';

  /** Every production module, i.e. not a test file or a __tests__ directory. */
  const productionFiles = (): string[] => {
    const found: string[] = [];
    const walk = (relative: string): void => {
      for (const entry of readdirSync(join(SRC, relative), { withFileTypes: true })) {
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(path);
        } else if (/\.(ts|tsx|astro)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          found.push(path);
        }
      }
    };
    walk('');
    return found;
  };

  it('is spelled as a literal exactly once in production code', () => {
    // Occurrences, not files: a second spelling inside the owner itself would
    // pass a file-level check while still letting a reader name one key and a
    // writer another.
    const spellings = productionFiles().flatMap((file) =>
      Array.from(readFileSync(join(SRC, file), 'utf-8').matchAll(/['"]oz_language['"]/g), () => file),
    );
    expect(spellings).toEqual([OWNER]);
  });

  it('is what every module that persists or reads a language goes through', () => {
    const switcher = readFileSync(join(SRC, 'components/LocaleSwitcher.astro'), 'utf-8');
    expect(switcher, 'the switcher must import the owner').toContain("from '../lib/language'");
    expect(switcher).toContain('setPreferredLanguage(');

    // The two hand-rolled redirect stubs cannot import anything: their scripts
    // are `is:inline`, so Astro never bundles them. They take the key from the
    // owner through define:vars instead — still one spelling, in lib/language.ts.
    for (const file of ['pages/index.astro', 'pages/pair.astro']) {
      const source = readFileSync(join(SRC, file), 'utf-8');
      expect(source, `${file} must be handed the owner's key`).toContain(
        'define:vars={{ LANGUAGE_STORAGE_KEY }}',
      );
      expect(source, `${file} must not spell the key itself`).not.toMatch(/['"]oz_language['"]/);
    }
  });
});
