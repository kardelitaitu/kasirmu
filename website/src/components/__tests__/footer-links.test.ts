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

/** Every i18n key the footer renders: four headings, sixteen links, one nav name. */
const COPY_KEYS = [
  'footer.sitemap',
  ...FOOTER_COLUMNS.map((column) => column.heading),
  ...FOOTER_LINKS.map((link) => link.label),
];

// ─── Sitemap data ────────────────────────────────────────────────────

describe('footer sitemap data', () => {
  it('has four columns and sixteen links', () => {
    expect(FOOTER_COLUMNS).toHaveLength(4);
    expect(FOOTER_LINKS).toHaveLength(16);
  });

  it('has no duplicate slug (two links to one page read as a broken column)', () => {
    const slugs = FOOTER_LINKS.map((link) => link.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('covers the product, solutions, business and help groupings', () => {
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

  it('renders 2 legal links (privacy and terms)', () => {
    expect(FOOTER_SRC).toContain("'legal/privacy'");
    expect(FOOTER_SRC).toContain("'legal/terms'");
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

  it('shares no label between the locales', () => {
    // The regression this catches: the footer rendering one language for every
    // locale — which it did, in Indonesian, until the label keys landed. An
    // empty list is the expectation; if a future label is deliberately the same
    // in both languages (a proper noun, say), name it here explicitly rather
    // than loosening the assertion to a count.
    const shared = COPY_KEYS.filter((key) => resolve(enJson, key) === resolve(idJson, key));
    expect(shared).toEqual([]);
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

  it('has X, Instagram, Facebook, and Telegram social links', () => {
    // General platform web URLs — real profiles not created yet.
    expect(FOOTER_SRC).toContain('https://x.com');
    expect(FOOTER_SRC).toContain('aria-label="X (Twitter)"');
    expect(FOOTER_SRC).toContain('https://www.instagram.com');
    expect(FOOTER_SRC).toContain('aria-label="Instagram"');
    expect(FOOTER_SRC).toContain('https://www.facebook.com');
    expect(FOOTER_SRC).toContain('aria-label="Facebook"');
    expect(FOOTER_SRC).toContain('https://telegram.org');
    expect(FOOTER_SRC).toContain('aria-label="Telegram"');
  });

  it('all social links open safely in a new tab', () => {
    // Every social anchor carries target=_blank + rel=noopener noreferrer.
    const socials = ['Discord', 'X (Twitter)', 'Instagram', 'Facebook', 'Telegram'];
    for (const label of socials) {
      const anchorMatch = FOOTER_SRC.match(
        new RegExp(`href="[^"]*"\\s+target="_blank"\\s+rel="noopener noreferrer"[^>]*aria-label="${label.replace(/[()]/g, '\\$&')}"`),
      );
      expect(anchorMatch, `missing safe-anchor attrs on ${label}`).not.toBeNull();
    }
  });

  it('social links use brand-color hover tints', () => {
    // Same effect as Discord: muted gray -> brand color on hover.
    const tints = [
      ['Discord', '#5865F2'],
      ['Instagram', '#E4405F'],
      ['Facebook', '#1877F2'],
      ['Telegram', '#229ED9'],
    ] as const;
    for (const [, color] of tints) {
      expect(FOOTER_SRC).toContain(`hover:text-[${color}]`);
    }
  });
});
