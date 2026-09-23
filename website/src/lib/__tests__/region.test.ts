// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getRegion, getExplicitRegion, setRegion, isIndonesia } from '../region';

describe('region helpers (localStorage get/set)', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns "global" when no value is stored (default)', () => {
    expect(getRegion()).toBe('global');
    expect(getExplicitRegion()).toBeNull();
  });

  it('returns the stored region after setRegion', () => {
    setRegion('id');
    expect(getRegion()).toBe('id');
    expect(getExplicitRegion()).toBe('id');
  });

  it('overwrites a previously stored region', () => {
    setRegion('global');
    expect(getRegion()).toBe('global');
    expect(getExplicitRegion()).toBe('global');
    setRegion('id');
    expect(getRegion()).toBe('id');
    expect(getExplicitRegion()).toBe('id');
  });

  it('reads the oz_region key from localStorage', () => {
    localStorage.setItem('oz_region', 'id');
    expect(getRegion()).toBe('id');
  });

  it('isIndonesia returns true only when region is "id"', () => {
    expect(isIndonesia()).toBe(false);
    setRegion('id');
    expect(isIndonesia()).toBe(true);
    setRegion('global');
    expect(isIndonesia()).toBe(false);
  });

  it('falls back to "global" for an unrecognized value', () => {
    localStorage.setItem('oz_region', 'eu');
    // getRegion returns whatever is in localStorage (cast to Region),
    // but isIndonesia checks strictly for 'id'.
    expect(isIndonesia()).toBe(false);
  });
});

/**
 * `oz_region` is the write side of the pricing/payment routing decision, so a
 * second spelling of it is worse than untidy: SignupForm persists the choice
 * and the checkout path reads it, and a reader and a writer naming different
 * keys silently routes an Indonesian customer to Paddle (USD) or the reverse.
 * The value is unchanged, so anything already stored keeps being read.
 */
describe('the region storage key has exactly one owner', () => {
  const SRC = join(import.meta.dirname, '..', '..');
  const OWNER = 'lib/region.ts';

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
      Array.from(readFileSync(join(SRC, file), 'utf-8').matchAll(/['"]oz_region['"]/g), () => file),
    );
    expect(spellings).toEqual([OWNER]);
  });

  it('is what every module that persists a region goes through', () => {
    // SignupForm persists the chosen region on verification; LocaleSwitcher
    // mirrors the language switch into it. Both must call the owner rather than
    // reaching for localStorage themselves.
    for (const file of ['components/SignupForm.tsx', 'components/LocaleSwitcher.astro']) {
      const source = readFileSync(join(SRC, file), 'utf-8');
      expect(source, `${file} must import the region owner`).toContain('setRegion');
      expect(source, `${file} must not spell the key itself`).not.toMatch(
        /localStorage\.(get|set)Item\(\s*['"]oz_region['"]/,
      );
    }
  });
});
