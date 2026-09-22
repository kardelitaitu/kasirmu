import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Keyboard-navigation invariants for the page chrome.
 *
 * These are source assertions because the subjects are `.astro` layouts, which
 * vitest cannot render — the same constraint the head invariants work under.
 * The behaviour that CAN be driven in a DOM (the search dialog's focus
 * containment and focus restore) is covered for real in
 * `components/__tests__/search-modal.test.tsx`.
 *
 * A measured keyboard pass found: no skip link on any page (the header alone is
 * ~12 tab stops, and docs pages add ~18 more in the sidebar), and a nav trigger
 * that removed its focus outline with no replacement.
 */
const ROOT = join(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf-8');

const BASE = read('layouts/Base.astro');
const DOCS = read('layouts/DocsLayout.astro');
const HEADER = read('components/Header.astro');
const EN = JSON.parse(read('i18n/en.json'));
const ID = JSON.parse(read('i18n/id.json'));

describe('skip-to-content link', () => {
  for (const [name, src] of [
    ['Base.astro', BASE],
    ['DocsLayout.astro', DOCS],
  ] as const) {
    it(`${name} offers a skip link targeting #main`, () => {
      expect(src).toContain('href="#main"');
      expect(src).toContain("nav.skipToContent");
    });

    it(`${name} gives <main> the id the skip link targets`, () => {
      // A skip link pointing at a non-existent id is worse than none: it
      // silently does nothing.
      expect(src).toMatch(/<main[^>]*\bid="main"/);
    });

    it(`${name} renders the skip link before the header`, () => {
      // It must be the first tab stop, so it cannot sit after the nav.
      expect(src.indexOf('href="#main"')).toBeLessThan(src.indexOf('<Header'));
    });

    it(`${name} keeps the skip link hidden until it is focused`, () => {
      expect(src).toContain('sr-only');
      expect(src).toContain('focus:not-sr-only');
    });
  }

  it('names the skip link in both locales', () => {
    expect(EN.nav.skipToContent).toBeTruthy();
    expect(ID.nav.skipToContent).toBeTruthy();
    expect(EN.nav.skipToContent).not.toBe(ID.nav.skipToContent);
  });
});

describe('the focus indicator has exactly one owner', () => {
  const GLOBAL_CSS = read('styles/global.css');

  it('global.css defines the shared :focus-visible indicator from a design token', () => {
    expect(GLOBAL_CSS).toMatch(/\n:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-primary\)/s);
  });

  it('offsets the outline so it stays visible on same-colour controls', () => {
    // Without the offset the ring disappears into a primary-blue button (the
    // OTP boxes, Sign in) and the active language pill.
    expect(GLOBAL_CSS).toMatch(/\n:focus-visible\s*\{[^}]*outline-offset/s);
  });

  it('declares the rule at the top level, not inside a cascade layer', () => {
    // Tailwind's utilities ship in `@layer utilities`, and layered rules lose
    // to unlayered ones — a top-level rule therefore cannot be switched off by
    // an `outline-none` utility someone adds later. The pattern requires no
    // leading whitespace, which is what "not nested in a block" looks like.
    expect(GLOBAL_CSS).toMatch(/\n:focus-visible/);
  });

  it('no component suppresses focus or hand-rolls its own indicator', () => {
    // The defect this replaces: components carried `outline-none` with (or
    // without) a private ring, and the nav's Solutions trigger ended up with no
    // indicator at all. One owner means nobody else touches it — so this bans
    // the whole vocabulary, not just the one spelling that happened to break:
    // Outline suppression in every Tailwind v4 form, plus per-component focus
    // rings (`focus:ring-*`), which are the other way a second owner appears.
    const SUPPRESSES = /outline-none|outline-hidden|outline-\[none\]|outline:\s*none|focus:outline|focus:ring|focus-visible:ring/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(rel);
        } else if (/\.(astro|tsx|ts|css)$/.test(entry.name)) {
          const code = read(rel)
            .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (keep `https://`)
          if (SUPPRESSES.test(code)) {
            offenders.push(rel);
          }
        }
      }
    };
    walk('components');
    walk('layouts');
    walk('pages');
    expect(offenders).toEqual([]);
  });

  it('the shared rule is the only outline declaration outside the stylesheet', () => {
    // `outline-offset` in global.css is fine; anything else redeclaring an
    // outline in a component means a second owner has appeared.
    expect(HEADER).not.toMatch(/outline/);
    expect(read('components/SearchModal.tsx')).not.toMatch(/outline/);
  });
});

describe('page chrome follows the page locale', () => {
  it('Header takes the locale Base resolved', () => {
    expect(HEADER).toContain('Astro.props.locale ?? Astro.currentLocale');
  });

  it('Header forwards that locale to the theme and language controls', () => {
    expect(HEADER).toContain('<ThemeToggle locale={locale} />');
    expect(HEADER).toContain('<LocaleSwitcher locale={locale} />');
  });

  it('Base passes the locale it resolved to the chrome', () => {
    // The locale-less 404 overrides the locale to `en`; without this the
    // document shipped an English <h1> inside Indonesian nav/footer copy.
    expect(BASE).toContain('<Header locale={locale} />');
    expect(BASE).toContain('<Footer locale={locale} />');
  });

  it('the chrome components accept a locale override', () => {
    for (const file of ['components/ThemeToggle.astro', 'components/LocaleSwitcher.astro', 'components/Footer.astro']) {
      expect(read(file)).toContain('Astro.props.locale ?? Astro.currentLocale');
    }
  });
});
