// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOOTER_COLUMNS, FOOTER_LINKS } from '../../lib/footer-nav.ts';

/**
 * Tests for Footer.astro: the sitemap it renders, and the language it renders
 * it in.
 *
 * Two jobs. First, link integrity — a wrong href or a missing page sends users
 * to 404s on revenue-critical pages, and every target is checked against the
 * pages on disk. Second, LOCALIZATION, which is what this file gained after the
 * footer shipped hard-coded Indonesian link text ("Fitur", "Harga", "Unduh",
 * "Warung", …) with no locale branch at all: every English page rendered an
 * Indonesian sitemap under English column headings. The footer now renders
 * `t(locale, key)` from the shared `FOOTER_COLUMNS` data, so these tests assert
 * over that data — the slugs, the keys, and whether the two locales actually
 * read differently — instead of re-typing the markup.
 */

const FOOTER_SRC = readFileSync(
  join(import.meta.dirname, '..', '..', 'components', 'Footer.astro'),
  'utf-8',
);

const enJson = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'en.json'), 'utf-8'),
);
const idJson = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'id.json'), 'utf-8'),
);

const DICTS = { en: enJson, id: idJson } as const;
const LOCALES = ['en', 'id'] as const;

/** Resolve a dotted i18n key against a dictionary; undefined when absent. */
function resolve(dict: Record<string, unknown>, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
      dict,
    );
}

/** Every i18n key the footer renders: five headings, twenty-one links, one nav name. */
const COPY_KEYS = [
  'footer.sitemap',
  ...FOOTER_COLUMNS.map((column) => column.heading),
  ...FOOTER_LINKS.map((link) => link.label),
];

/**
 * Keys whose two locales are deliberately the SAME string.
 *
 * "Media Kit" is a loanword in Indonesian and is what press contacts there
 * write, so translating it would invent a term nobody searches for. Spelled
 * out here rather than by loosening the shared-label assertion below: any other
 * key that stops differing is still a bug, and an empty exception list was the
 * expectation until this page existed.
 */
const SHARED_LABEL_OK = ['footer.link.mediaKit'];

// ─── Sitemap data ────────────────────────────────────────────────────

describe('footer sitemap data', () => {
  it('has five columns and twenty-one links', () => {
    expect(FOOTER_COLUMNS).toHaveLength(5);
    expect(FOOTER_LINKS).toHaveLength(21);
  });

  it('has no duplicate slug (two links to one page read as a broken column)', () => {
    const slugs = FOOTER_LINKS.map((link) => link.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('covers the product, solutions, business, help and company groupings', () => {
    for (const slug of [
      'features',
      'pricing',
      'download',
      'kasir-gratis',
      'kasir-murah',
      'kasir-qris',
      'aplikasi-kasir-android',
      'warung',
      'cafe',
      'restaurant',
      'minimarket',
      'warehouse',
      'docs',
      'support',
      'cara',
      'perbandingan',
      'about',
      'media-kit',
      'contact',
      'legal/terms',
      'legal/privacy',
    ]) {
      expect(FOOTER_LINKS.map((link) => link.slug), `missing ${slug}`).toContain(slug);
    }
  });

  it('renders each link through getRelativeLocaleUrl and the footer-link class', () => {
    // The render is a single loop over the data, so the href must come from the
    // slug rather than a literal that could point at the wrong locale.
    expect(FOOTER_SRC).toContain('getRelativeLocaleUrl(locale, link.slug)');
    expect(FOOTER_SRC).toContain('class="footer-link relative w-fit');
    expect(FOOTER_SRC).toContain('{t(locale, link.label)}');
    expect(FOOTER_SRC).toContain('FOOTER_COLUMNS');
  });

  it('keeps Privacy and Terms in the Company column, and only there', () => {
    // They used to sit in a second <nav> under the sitemap with their own
    // aria-label. That row is gone; the destinations moved into the Company
    // column, so this asserts the data — not the markup — is what carries them,
    // and that no other column duplicates them.
    const company = FOOTER_COLUMNS.find((column) => column.heading === 'footer.col.company');
    expect(company, 'the Company column is gone').toBeDefined();
    expect(company?.links.map((link) => link.slug)).toEqual([
      'about',
      'media-kit',
      'contact',
      'legal/terms',
      'legal/privacy',
    ]);
    const legalLinks = FOOTER_LINKS.filter((link) => link.slug.startsWith('legal/'));
    expect(legalLinks.map((link) => link.slug)).toHaveLength(2);
  });

  it('no longer renders a separate legal nav', () => {
    // The row's own accessible name (`footer.legal`) is gone with it; a
    // leftover <nav> would be a second landmark naming the same two links.
    expect(FOOTER_SRC).not.toContain("'footer.legal'");
    expect(FOOTER_SRC).not.toContain("'legal/privacy'");
    expect(FOOTER_SRC).not.toContain("'legal/terms'");
  });
});

// ─── Target pages exist ──────────────────────────────────────────────

describe('footer link targets exist', () => {
  const pagesDir = join(import.meta.dirname, '..', '..', 'pages', '[locale]');

  it.each(FOOTER_LINKS.map((link) => link.slug))('%s page exists', (slug) => {
    const candidates = [join(pagesDir, `${slug}.astro`), join(pagesDir, slug, 'index.astro')];
    const found = candidates.some((path) => {
      try {
        readFileSync(path);
        return true;
      } catch {
        return false;
      }
    });
    expect(found, `no page for footer slug "${slug}"`).toBe(true);
  });

  it('docs hub page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'docs', 'index.astro'))).not.toThrow();
  });

  it('legal pages exist', () => {
    expect(() => readFileSync(join(pagesDir, 'legal', 'privacy.astro'))).not.toThrow();
    expect(() => readFileSync(join(pagesDir, 'legal', 'terms.astro'))).not.toThrow();
  });
});

// ─── Localization ────────────────────────────────────────────────────

describe('footer copy is localized', () => {
  it('defines every rendered key in both dictionaries', () => {
    for (const locale of LOCALES) {
      for (const key of COPY_KEYS) {
        const value = resolve(DICTS[locale], key);
        expect(typeof value, `${locale} ${key} must be a string`).toBe('string');
        expect(String(value).trim(), `${locale} ${key} must not be empty`).not.toBe('');
      }
    }
  });

  it('never falls back to the key itself (an unresolved label is the bug this pins)', () => {
    for (const locale of LOCALES) {
      for (const key of COPY_KEYS) {
        expect(resolve(DICTS[locale], key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });

  it('shares no label between the locales, except the ones named here', () => {
    // The regression this catches: the footer rendering one language for every
    // locale — which it did, in Indonesian, until the label keys landed. An
    // empty list is the expectation; a label that is deliberately the same in
    // both languages is named in SHARED_LABEL_OK rather than the assertion
    // being loosened to a count.
    const shared = COPY_KEYS.filter((key) => resolve(enJson, key) === resolve(idJson, key));
    expect(shared).toEqual(SHARED_LABEL_OK);
  });

  it('keeps localized column headings (they were inline ternaries before)', () => {
    expect(FOOTER_SRC).not.toContain("locale === 'id' ?");
    expect(FOOTER_SRC).toContain("{t(locale, column.heading)}");
    expect(enJson.footer.col.business).toBe('Business types');
    expect(idJson.footer.col.business).toBe('Jenis bisnis');
  });

  it('localizes the sitemap nav accessible name', () => {
    expect(FOOTER_SRC).toContain("aria-label={t(locale, 'footer.sitemap')}");
    expect(enJson.footer.sitemap).toBe('Sitemap');
    expect(idJson.footer.sitemap).toBeTruthy();
    expect(enJson.footer.sitemap).not.toBe(idJson.footer.sitemap);
  });
});

// ─── Copyright & socials ─────────────────────────────────────────────

describe('Footer copyright', () => {
  it('uses dynamic year via Date constructor', () => {
    expect(FOOTER_SRC).toContain('new Date().getFullYear()');
  });

  it('has the kasir.mu brand name', () => {
    expect(FOOTER_SRC).toContain('kasir.mu');
  });

  it('has Discord social link', () => {
    expect(FOOTER_SRC).toContain('discord.gg');
    expect(FOOTER_SRC).toContain('aria-label="Discord"');
  });

  it('links no platform homepage — only profiles this project owns', () => {
    // The X, Instagram, Facebook and Telegram icons were removed on 2026-09-24:
    // they pointed at the platforms' own homepages, so they were dead ends for
    // users and the reason Organization.sameAs could name nothing but Discord
    // (SEO audit T8/D4). This is the rot guard, inverted: it now fails if
    // someone re-adds a platform rather than if someone removes one. Add a real
    // profile URL to the footer AND to this list AND to sameAs in one change.
    for (const homepage of [
      'https://x.com',
      'https://www.instagram.com',
      'https://www.facebook.com',
      'https://telegram.org',
    ]) {
      expect(FOOTER_SRC, `${homepage} is a platform homepage, not a kasir.mu profile`).not.toContain(homepage);
    }
    for (const label of ['X (Twitter)', 'Instagram', 'Facebook', 'Telegram']) {
      expect(FOOTER_SRC, `no icon may claim to be ${label}`).not.toContain(`aria-label="${label}"`);
    }
  });

  it('all social links open safely in a new tab', () => {
    // Every social anchor carries target=_blank + rel=noopener noreferrer.
    const socials = ['Discord'];
    for (const label of socials) {
      const anchorMatch = FOOTER_SRC.match(
        new RegExp(`href="[^"]*"\\s+target="_blank"\\s+rel="noopener noreferrer"[^>]*aria-label="${label.replace(/[()]/g, '\\$&')}"`),
      );
      expect(anchorMatch, `missing safe-anchor attrs on ${label}`).not.toBeNull();
    }
  });

  it('social links use brand-color hover tints', () => {
    // Same effect as Discord: muted gray -> brand color on hover.
    // Discord is the only profile left; the other four tints went with them.
    const tints = [['Discord', '#5865F2']] as const;
    for (const [, color] of tints) {
      expect(FOOTER_SRC).toContain(`hover:text-[${color}]`);
    }
  });
});
