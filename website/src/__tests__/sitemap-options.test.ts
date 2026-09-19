import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { SITE, createSitemapOptions } from '../../scripts/sitemap-options.mjs';

/**
 * Tests for the sitemap rules that are easy to regress silently, because the
 * only other instrument is the built `dist/sitemap-0.xml`:
 *
 *   1. the locale-detect root `/` must not be listed (it canonicalises to
 *      /id/, and listing it also corrupts the alternate set of /en/ and /id/);
 *   2. every alternate group must carry an `x-default` that agrees with the
 *      HTML layouts;
 *   3. `<lastmod>` stays a real content date, never a build timestamp.
 */

const WEBSITE = join(import.meta.dirname, '..', '..');

type Link = { url: string; lang: string };
type Item = { url: string; links?: Link[]; lastmod?: string };

let opts: ReturnType<typeof createSitemapOptions>;

beforeAll(() => {
  // One instance: the resolver caches the git log, and each call to
  // createSitemapOptions() would re-read it.
  opts = createSitemapOptions();
});

/** A page that exists in both locales, shaped as @astrojs/sitemap emits it. */
const bilingual = (path: string): Item => ({
  url: `${SITE}/en${path}/`,
  links: [
    { url: `${SITE}/en${path}/`, lang: 'en' },
    { url: `${SITE}/id${path}/`, lang: 'id' },
  ],
});

describe('filter', () => {
  it('excludes the locale-detect root', () => {
    expect(opts.filter(`${SITE}/`)).toBe(false);
  });

  it('keeps both locale homes', () => {
    expect(opts.filter(`${SITE}/en/`)).toBe(true);
    expect(opts.filter(`${SITE}/id/`)).toBe(true);
  });

  it('excludes the gated pages in both locales', () => {
    // /signup belongs to this set for the same reason as /login: its whole
    // content is a form, so it is noindexed (signup.astro) and must not also
    // be submitted here — a sitemap entry for a noindexed URL contradicts
    // itself. It was missing from both halves until the SEO review.
    for (const path of ['account', 'login', 'signup', 'enterprise-trial']) {
      expect(opts.filter(`${SITE}/en/${path}/`), path).toBe(false);
      expect(opts.filter(`${SITE}/id/${path}/`), path).toBe(false);
    }
  });

  it('keeps the docs hub and ordinary pages', () => {
    expect(opts.filter(`${SITE}/en/docs/`)).toBe(true);
    expect(opts.filter(`${SITE}/id/docs/welcome/`)).toBe(true);
    expect(opts.filter(`${SITE}/id/pricing/`)).toBe(true);
  });
});

describe('i18n', () => {
  it('declares the default locale the rest of the site actually uses', () => {
    // Root canonical, x-default, <html lang> and the noscript fallback all say
    // `id`. The sitemap's defaultLocale must not be the lone dissenter.
    expect(opts.i18n.defaultLocale).toBe('id');
  });

  it('maps both locales', () => {
    expect(opts.i18n.locales).toEqual({ en: 'en', id: 'id' });
  });
});

describe('serialize — x-default', () => {
  it('points x-default at the id variant when describing the en page', () => {
    const out = opts.serialize(bilingual('/pricing'));
    expect(out.links.at(-1)).toEqual({ url: `${SITE}/id/pricing/`, lang: 'x-default' });
  });

  it('points x-default at itself when describing the id page', () => {
    const out = opts.serialize({
      url: `${SITE}/id/pricing/`,
      links: [
        { url: `${SITE}/en/pricing/`, lang: 'en' },
        { url: `${SITE}/id/pricing/`, lang: 'id' },
      ],
    });
    expect(out.links.at(-1)).toEqual({ url: `${SITE}/id/pricing/`, lang: 'x-default' });
  });

  it('adds exactly one x-default, and never duplicates an existing hreflang', () => {
    const out = opts.serialize(bilingual('/pricing'));
    const langs = out.links.map((l: Link) => l.lang);
    expect(langs).toEqual(['en', 'id', 'x-default']);
    expect(new Set(langs).size).toBe(langs.length);
  });

  it('leaves a single-locale item untouched', () => {
    // The plugin returns no links when a path resolves to one URL; there is
    // nothing to annotate, so no x-default should be invented.
    const out = opts.serialize({ url: `${SITE}/id/only-here/` });
    expect(out.links).toBeUndefined();
  });
});

describe('serialize — lastmod', () => {
  it('keeps the authored docs date', () => {
    const out = opts.serialize({ url: `${SITE}/id/docs/welcome/` });
    expect(out.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('never stamps a build timestamp', () => {
    // Either a real ISO date or the field absent. A `new Date()` here would
    // look like every page changed on every deploy, which Google discards.
    for (const url of [`${SITE}/id/pricing/`, `${SITE}/id/legal/privacy/`]) {
      const { lastmod } = opts.serialize({ url });
      expect(lastmod === undefined || /^\d{4}-\d{2}-\d{2}T/.test(lastmod), url).toBe(true);
    }
  });
});

describe('agreement with the HTML', () => {
  it('every layout points x-default at the id variant, as the sitemap does', () => {
    for (const layout of ['Base.astro', 'DocsLayout.astro']) {
      const src = readFileSync(join(WEBSITE, 'src', 'layouts', layout), 'utf8');
      const line = src.split('\n').find((l) => l.includes('hreflang="x-default"'));
      expect(line, `${layout} must declare an x-default alternate`).toBeTruthy();
      expect(line, `${layout} x-default must target the id variant`).toContain(
        "getAbsoluteLocaleUrl('id'",
      );
    }
  });

  it('the root page agrees too', () => {
    const src = readFileSync(join(WEBSITE, 'src', 'pages', 'index.astro'), 'utf8');
    const line = src.split('\n').find((l) => l.includes('hreflang="x-default"'));
    expect(line).toContain(`${SITE}/id/`);
  });
});
