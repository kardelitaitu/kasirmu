// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tests for Footer.astro link integrity.
 *
 * Footer renders sitemap columns (features/pricing/download, 5 business
 * verticals, docs/support) plus 2 legal links, all driven by
 * `getRelativeLocaleUrl`. A broken href or missing i18n key sends users
 * to 404s on revenue-critical pages.
 *
 * Strategy: read the raw .astro source and verify the link structure is
 * correct and all target pages exist on disk.
 */

const FOOTER_SRC = readFileSync(
  join(import.meta.dirname, '..', '..', 'components', 'Footer.astro'),
  'utf-8',
);

// ─── Link structure tests ────────────────────────────────────────────

describe('Footer link structure', () => {
  it('renders 2 legal links (privacy and terms)', () => {
    expect(FOOTER_SRC).toContain("'legal/privacy'");
    expect(FOOTER_SRC).toContain("'legal/terms'");
  });

  it('renders the sitemap columns', () => {
    for (const slug of ['features', 'pricing', 'download', 'kasir-gratis', 'kasir-murah', 'kasir-qris', 'aplikasi-kasir-android', 'warung', 'cafe', 'restaurant', 'minimarket', 'warehouse', 'docs', 'support']) {
      expect(FOOTER_SRC).toContain(`'${slug}'`);
    }
  });

  it('uses getRelativeLocaleUrl for navigation links', () => {
    const matches = FOOTER_SRC.match(/getRelativeLocaleUrl\(/g);
    expect(matches).toHaveLength(16);
  });

  it('has aria-label on the legal nav', () => {
    expect(FOOTER_SRC).toContain("aria-label={t(locale, 'footer.legal')}");
  });

  it('has aria-label on the sitemap nav', () => {
    expect(FOOTER_SRC).toContain('aria-label="Sitemap"');
  });

  it('has footer-link class on navigation links', () => {
    const footerLinkMatches = FOOTER_SRC.match(/class="footer-link/g);
    expect(footerLinkMatches).toHaveLength(16);
  });
});

// ─── Target page existence tests ─────────────────────────────────────

describe('Footer link targets exist', () => {
  const pagesDir = join(import.meta.dirname, '..', '..', 'pages', '[locale]');

  it('cafe page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'cafe.astro'))).not.toThrow();
  });

  it('minimarket page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'minimarket.astro'))).not.toThrow();
  });

  it('warung page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'warung.astro'))).not.toThrow();
  });

  it('restaurant page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'restaurant.astro'))).not.toThrow();
  });

  it('warehouse page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'warehouse.astro'))).not.toThrow();
  });

  it('features page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'features.astro'))).not.toThrow();
  });

  it('pricing page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'pricing.astro'))).not.toThrow();
  });

  it('download page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'download.astro'))).not.toThrow();
  });

  it('support page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'support.astro'))).not.toThrow();
  });

  it('docs hub page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'docs', 'index.astro'))).not.toThrow();
  });

  it('kasir-gratis landing page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'kasir-gratis.astro'))).not.toThrow();
  });

  it('kasir-murah landing page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'kasir-murah.astro'))).not.toThrow();
  });

  it('kasir-qris landing page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'kasir-qris.astro'))).not.toThrow();
  });

  it('aplikasi-kasir-android landing page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'aplikasi-kasir-android.astro'))).not.toThrow();
  });

  it('legal/privacy page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'legal', 'privacy.astro'))).not.toThrow();
  });

  it('legal/terms page exists', () => {
    expect(() => readFileSync(join(pagesDir, 'legal', 'terms.astro'))).not.toThrow();
  });
});

// ─── i18n key tests ──────────────────────────────────────────────────

describe('Footer i18n keys', () => {
  const enJson = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'en.json'), 'utf-8'),
  );
  const idJson = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'id.json'), 'utf-8'),
  );

  it('en footer has all required keys', () => {
    expect(enJson.footer).toBeDefined();
    expect(enJson.footer.rights).toBeTruthy();
    expect(enJson.footer.privacy).toBeTruthy();
    expect(enJson.footer.terms).toBeTruthy();
    expect(enJson.footer.legal).toBeTruthy();
    expect(enJson.footer.business).toBeTruthy();
  });

  it('id footer has all required keys', () => {
    expect(idJson.footer).toBeDefined();
    expect(idJson.footer.rights).toBeTruthy();
    expect(idJson.footer.privacy).toBeTruthy();
    expect(idJson.footer.terms).toBeTruthy();
    expect(idJson.footer.legal).toBeTruthy();
    expect(idJson.footer.business).toBeTruthy();
  });

  it('en footer vertical labels are non-empty', () => {
    const verticalKeys = ['kafe', 'minimarket', 'warung', 'restoran'] as const;
    for (const key of verticalKeys) {
      expect(enJson.vertical[key].label).toBeTruthy();
    }
  });

  it('id footer vertical labels are non-empty', () => {
    const verticalKeys = ['kafe', 'minimarket', 'warung', 'restoran'] as const;
    for (const key of verticalKeys) {
      expect(idJson.vertical[key].label).toBeTruthy();
    }
  });

  it('en and id have the same footer keys', () => {
    const enKeys = Object.keys(enJson.footer).sort();
    const idKeys = Object.keys(idJson.footer).sort();
    expect(idKeys).toEqual(enKeys);
  });

  it('en and id vertical labels differ (translated)', () => {
    const verticalKeys = ['kafe', 'minimarket', 'warung', 'restoran'] as const;
    const differences = verticalKeys.filter(
      (key) => enJson.vertical[key].label !== idJson.vertical[key].label,
    );
    expect(differences.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Copyright year test ─────────────────────────────────────────────

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
