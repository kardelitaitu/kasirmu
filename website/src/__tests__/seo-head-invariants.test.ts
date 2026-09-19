import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SEO head + heading invariants that the built HTML cannot assert cheaply
 * (that would need a full `astro build` in the test run). Each case below was
 * a real defect found by the SEO audit — the test exists so it cannot come
 * back silently, the same way docs-layout-features.test.ts guards the docs
 * scroll-spy selectors.
 *
 * What is asserted here is deliberately structural (does this tag/level
 * exist, is this value self-referential) rather than copy, which changes.
 */

const SRC = join(import.meta.dirname, '..');
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');

const BASE = read('layouts', 'Base.astro');
const DOCS_LAYOUT = read('layouts', 'DocsLayout.astro');
const FEATURES = read('pages', '[locale]', 'features.astro');
const PRICING = read('pages', '[locale]', 'pricing.astro');
const SIGNUP = read('pages', '[locale]', 'signup.astro');
const PRICING_GRID = read('components', 'PricingGrid.tsx');

describe('social cards describe their image', () => {
  it('Base.astro emits og:image:alt and twitter:image:alt', () => {
    expect(BASE).toContain('property="og:image:alt"');
    expect(BASE).toContain('name="twitter:image:alt"');
  });

  it('DocsLayout.astro emits both image alts too', () => {
    expect(DOCS_LAYOUT).toContain('property="og:image:alt"');
    expect(DOCS_LAYOUT).toContain('name="twitter:image:alt"');
  });
});

describe('llms.txt discovery is on every layout', () => {
  it('the docs layout points at /llms.txt like Base.astro does', () => {
    // The docs <head> is a separate document head; it was missing the link, so
    // the entire /docs/ subtree had no discovery path to the file.
    expect(BASE).toContain('rel="describedby" href="/llms.txt"');
    expect(DOCS_LAYOUT).toContain('rel="describedby" href="/llms.txt"');
  });
});

describe('Organization structured data', () => {
  it('never lists kasir.mu in sameAs', () => {
    const sameAs = BASE.match(/"sameAs":\s*\[([^\]]*)\]/)?.[1] ?? '';
    expect(sameAs).not.toContain('kasir.mu');
  });

  it('still lists the community Discord profile', () => {
    const sameAs = BASE.match(/"sameAs":\s*\[([^\]]*)\]/)?.[1] ?? '';
    expect(sameAs).toContain('discord.gg');
  });
});

describe('heading hierarchy', () => {
  it('pricing plan cards are h2, so the page never jumps h1 → h3', () => {
    expect(PRICING_GRID).toContain('<h2 className="text-lg font-semibold">{tier.name}</h2>');
    expect(PRICING_GRID).not.toContain('<h3');
  });

  it('the features comparison section has a real heading', () => {
    // `features.comparisonTitle` existed in both dicts and rendered nowhere.
    expect(FEATURES).toMatch(/<h2[^>]*>\{t\(locale, 'features\.comparisonTitle'\)\}<\/h2>/);
  });
});

describe('mobile layout', () => {
  it('the comparison subtitle is allowed to wrap', () => {
    // whitespace-nowrap on a ~98-character sentence forced a horizontal
    // scrollbar at every phone width.
    const line = FEATURES.split('\n').find((l) => l.includes("features.comparisonSubtitle"));
    expect(line).toBeDefined();
    expect(line).not.toContain('whitespace-nowrap');
  });
});

describe('Product offers carry numeric prices', () => {
  it('pricing.astro converts display strings instead of emitting them', () => {
    // Emitting tier.prices.monthly.price directly shipped "$0" / "Custom" as
    // Offer.price, which Google drops — taking the Product rich result with it.
    expect(PRICING).toContain('schemaPrice(');
    expect(PRICING).not.toContain('"price": tier.prices');
  });
});

describe('auth pages are de-indexed', () => {
  it('signup.astro sets noindex, like login and account', () => {
    expect(SIGNUP).toMatch(/<Base[^>]*\bnoindex\b/);
  });
});
