import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LANDING_BY_SLUG,
  LLMS_LOCALE,
  LLMS_PAGE_SLUGS,
  NON_PUBLIC_PAGES,
  PAGE_LABELS,
  VERTICAL_BY_SLUG,
} from '../lib/llms-pages';

/**
 * Rot guard for `/llms.txt`.
 *
 * The URL list used to be hardcoded inside `llms.txt.ts` and rotted to 16 of 75
 * published URLs — 0 of the 37 English ones and 14 of the 17 docs pages missing
 * — with nothing failing. Docs now come from the `docs` content collection, so
 * they cannot drift. The marketing-page list is data in
 * `src/lib/llms-pages.ts`, and this test is what keeps that honest: it fails if
 * the list and the pages on disk disagree, in either direction.
 *
 * The list is data rather than a Vite glob walk on purpose — a dynamic
 * resolver under `website/src` makes
 * `scripts/verify-website-assets.py` disable its asset-orphan rule for the
 * whole tree. Guarding with a test instead keeps that gate active.
 *
 * Strategy matches `src/components/__tests__/footer-links.test.ts`: read the
 * filesystem and assert every target exists.
 */

const PAGES_DIR = join(import.meta.dirname, '..', 'pages', '[locale]');

/**
 * Slugs of every `.astro` page on disk, excluding the `docs` subtree (those
 * come from the content collection). `index.astro` becomes `''`; nested pages
 * keep their path (`legal/privacy`).
 */
function pageSlugsOnDisk(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'docs') continue;
        walk(p, `${prefix}${name}/`);
        continue;
      }
      if (!name.endsWith('.astro')) continue;
      const leaf = name.slice(0, -'.astro'.length);
      out.push(leaf === 'index' ? prefix.slice(0, -1) : `${prefix}${leaf}`);
    }
  };
  walk(PAGES_DIR, '');
  return out.sort();
}

const onDisk = pageSlugsOnDisk();

describe('llms.txt page coverage', () => {
  it('finds the locale page directory', () => {
    // Guards the walk itself: a moved directory would otherwise yield an empty
    // list and every other assertion here would pass vacuously.
    expect(existsSync(PAGES_DIR)).toBe(true);
    expect(onDisk.length).toBeGreaterThan(0);
    expect(LLMS_LOCALE).toBe('id');
  });

  it('accounts for every page on disk — listed or explicitly non-public', () => {
    const accounted = new Set<string>([...LLMS_PAGE_SLUGS, ...NON_PUBLIC_PAGES]);
    const unaccounted = onDisk.filter((s) => !accounted.has(s));
    expect(
      unaccounted,
      'new page(s) on disk: add each to LLMS_PAGE_SLUGS or NON_PUBLIC_PAGES in src/lib/llms-pages.ts',
    ).toEqual([]);
  });

  it('lists no slug that has no page on disk', () => {
    const missing = LLMS_PAGE_SLUGS.filter((s) => !onDisk.includes(s));
    expect(missing, 'listed in llms-pages.ts but absent from src/pages/[locale]').toEqual([]);
  });

  it('has no duplicate slugs', () => {
    expect(new Set(LLMS_PAGE_SLUGS).size).toBe(LLMS_PAGE_SLUGS.length);
  });

  it('does not advertise auth-gated pages', () => {
    for (const slug of NON_PUBLIC_PAGES) {
      expect(LLMS_PAGE_SLUGS, `${slug} is auth-gated and must not be listed`).not.toContain(slug);
    }
  });

  it('does not list docs pages — those come from the content collection', () => {
    const docs = LLMS_PAGE_SLUGS.filter((s) => s === 'docs' || s.startsWith('docs/'));
    expect(docs).toEqual([]);
  });

  it('maps only listed slugs in the label and i18n tables', () => {
    const referenced = [
      ...Object.keys(PAGE_LABELS),
      ...Object.keys(VERTICAL_BY_SLUG),
      ...Object.keys(LANDING_BY_SLUG),
    ];
    const strays = referenced.filter((s) => !LLMS_PAGE_SLUGS.includes(s));
    expect(strays, 'stale key(s) in llms-pages.ts — the page was renamed or removed').toEqual([]);
  });
});
