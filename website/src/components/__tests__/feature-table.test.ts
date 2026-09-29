import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The plan comparison table's structure.
 *
 * A source-level test, like hero.test.ts and docs-layout-features.test.ts: this
 * site has no Astro container harness, so what is asserted is the contract the
 * markup has to keep, not a render. What it CANNOT see, named so a green run is
 * not read as more than it is: whether the tinted cell actually paints (that is
 * `--color-plan-tint` in global.css and the built page), whether the sticky
 * offsets sit right under the site header, how the panel scrolls, and every
 * layout regression.
 *
 * WHAT IT IS ACTUALLY GUARDING. The redesign gives the featured plan a tinted
 * column, pins the header row and the feature column, and moves the price to a
 * row at the very bottom. Each of those is one class in one expression, which is
 * exactly the kind of thing a later edit deletes without noticing: drop
 * `c.highlight` from the tint branch and every column tints equally, with no
 * test failing anywhere.
 */

const DIR = join(import.meta.dirname, '..');
const SRC = readFileSync(join(DIR, 'FeatureTable.astro'), 'utf-8');
/**
 * The same source with every comment removed.
 *
 * Class-level assertions have to run against this, not `SRC`: this component's
 * own docstrings explain what was REMOVED ("capped at 44rem with a full
 * overflow", "a header row pinned to zero"), so a search for the retired token
 * finds the explanation of its retirement and the test fails on its own prose.
 * Comments are not shipped markup, so nothing is lost by excluding them.
 */
const MARKUP = SRC.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const GLOBAL_CSS = readFileSync(join(DIR, '..', 'styles', 'global.css'), 'utf-8');
const en = JSON.parse(readFileSync(join(DIR, '..', 'i18n', 'en.json'), 'utf-8'));
const id = JSON.parse(readFileSync(join(DIR, '..', 'i18n', 'id.json'), 'utf-8'));

describe('plan comparison table — featured column', () => {
  it('tints the column the tiers call highlighted, in header, rows and price row', () => {
    // Three CODE sites, all keyed on the same flag the card grid badges with:
    // the header cell (which falls back to the surface) and the two body sites
    // (row cells, then the price row). Asserted per class rather than by counting
    // the token in the file, because the component's own comment names it too.
    const tintSites = SRC.match(/c\.highlight \? 'bg-plan-tint'/g) ?? [];
    expect(tintSites).toHaveLength(3);
    expect(SRC).toMatch(/c\.highlight \? 'bg-plan-tint' : 'bg-surface'/);
    expect(SRC.match(/c\.highlight \? 'bg-plan-tint' : ''/g)).toHaveLength(2);
  });

  it('reads the tint from a theme token, never from a colour literal', () => {
    // Light @theme + the dark override; anything else is a raw hex in a component.
    expect(GLOBAL_CSS).toMatch(/@theme\s*\{[\s\S]*?--color-plan-tint:/);
    expect(GLOBAL_CSS).toMatch(/:root\[data-theme="dark"\]\s*\{[\s\S]*?--color-plan-tint:/);
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('uses a solid token, not a translucent utility, on the sticky cells', () => {
    // A translucent primary wash here would let the rows scrolling under the
    // pinned column show through it — the bug this token exists to prevent.
    expect(SRC).not.toMatch(/bg-primary\/\d/);
  });
});

describe('plan comparison table — the full-height panel and the pinned column', () => {
  it('is full height, with only the width able to scroll', () => {
    // No max-height: the panel used to cap the table at 44rem with
    // `overflow-auto`, which put a scrollbar inside the table and hid the last
    // rows behind it. The page scrolls vertically now.
    expect(MARKUP).not.toContain('max-h-');
    expect(MARKUP).not.toContain('overflow-auto');
    expect(MARKUP).toContain('overflow-x-auto');
  });

  it('pins the feature column, which is the only axis that still scrolls', () => {
    // The panel is a horizontal scrollport and no longer a vertical one, so
    // `sticky left-0` is the pin that still does work: scroll out to the
    // Enterprise column on a phone and the row label has to come with you. A
    // `sticky top-0` on the header row would now be dead markup — measured on
    // the built page, that row scrolls away with the page — so it is asserted
    // absent rather than left to read as a working pin.
    expect(MARKUP).toContain('sticky left-0');
    expect(MARKUP).not.toContain('sticky top-0');
    // The corner cell outranks the row headers it sits above.
    expect(MARKUP).toMatch(/sticky left-0 z-30/);
  });

  it('keeps the scroll region reachable from the keyboard', () => {
    expect(SRC).toContain('tabindex="0"');
    expect(SRC).toMatch(/role="group"/);
  });
});

describe('plan comparison table — the price row is the last row', () => {
  it('renders the price row after every feature row', () => {
    const bodyEnd = SRC.indexOf('</tbody>');
    const footStart = SRC.indexOf('<tfoot>');
    expect(bodyEnd).toBeGreaterThan(-1);
    expect(footStart).toBeGreaterThan(bodyEnd);
    expect(SRC.indexOf('</table>')).toBeGreaterThan(footStart);
  });

  it('takes monthly and yearly figures from the tier objects the cards use', () => {
    expect(SRC).toContain('c.prices.monthly.price');
    expect(SRC).toContain('c.prices.yearly.price');
    // The yearly statement is a claim about PAYING yearly: the free-forever and
    // quote-only tiers must not be told it.
    expect(SRC).toMatch(/BILLED_TIERS\.has\(c\.tierKey\)/);
  });
});

describe('plan comparison table — inclusion is said, not only drawn', () => {
  it('pairs every glyph with a word a screen reader can read', () => {
    expect(SRC).toContain("t(locale, 'pricingPage.included')");
    expect(SRC).toContain("t(locale, 'pricingPage.notIncluded')");
    // Both glyphs are decorative now that the word carries the meaning.
    expect(SRC.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('builds no HTML from strings (the old set:html cell renderer is gone)', () => {
    expect(SRC).not.toContain('set:html');
  });
});

describe('plan comparison table — every string is translated', () => {
  const KEYS = [
    'feature',
    'included',
    'notIncluded',
    'planPricing',
    'twoMonthsFree',
    'qrisNote',
    'midtransNote',
    'stripeNote',
  ];

  it('carries the new strings in both dictionaries', () => {
    for (const key of KEYS) {
      expect(en.pricingPage[key], `en pricingPage.${key}`).toBeTruthy();
      expect(id.pricingPage[key], `id pricingPage.${key}`).toBeTruthy();
      expect(id.pricingPage[key], `id pricingPage.${key} is translated`).not.toBe(
        en.pricingPage[key],
      );
    }
  });

  it('draws one legend line per asterisked row, in row order', () => {
    // All three payment rows share the `*` marker, so the legend is a list whose
    // entries each name their own subject. One note would silently orphan two
    // markers; the order is what ties a line back to its row.
    for (const key of ['qrisNote', 'midtransNote', 'stripeNote'] as const) {
      expect(SRC).toContain(`t(locale, 'pricingPage.${key}')`);
    }
    expect(SRC.indexOf('pricingPage.qrisNote')).toBeLessThan(SRC.indexOf('pricingPage.midtransNote'));
    expect(SRC.indexOf('pricingPage.midtransNote')).toBeLessThan(SRC.indexOf('pricingPage.stripeNote'));
  });

  it('hardcodes no user-visible English in the markup', () => {
    for (const key of KEYS) {
      expect(SRC).not.toContain(`>${en.pricingPage[key]}<`);
    }
    // Row labels and quota values are data (content/pricing/*.ts), not markup.
    for (const dataWord of ['Locations', 'Unlimited', 'Warehouse workspaces']) {
      expect(SRC).not.toContain(dataWord);
    }
    expect(SRC).toContain("from '../i18n'");
  });
});
