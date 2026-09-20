import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NON_PUBLIC_PAGES, isNonPublic } from '../lib/site';

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
const SITE_HEAD = read('components', 'SiteHead.astro');
const FEATURES = read('pages', '[locale]', 'features.astro');
const PRICING = read('pages', '[locale]', 'pricing.astro');
const SIGNUP = read('pages', '[locale]', 'signup.astro');
const PRICING_GRID = read('components', 'PricingGrid.tsx');

describe('social cards describe their image', () => {
  it('the shared head emits og:image:alt and twitter:image:alt once', () => {
    // og:image:alt and twitter:image:alt used to be duplicated in two hand-
    // rolled heads (Base + DocsLayout) that had to be kept in sync by hand.
    expect(SITE_HEAD).toContain('property="og:image:alt"');
    expect(SITE_HEAD).toContain('name="twitter:image:alt"');
    expect(BASE).not.toContain('og:image:alt');
    expect(BASE).not.toContain('twitter:image:alt');
  });
});

describe('llms.txt discovery is on every layout', () => {
  it('Base.astro emits the describedby link via the shared head', () => {
    expect(BASE).toContain('<SiteHead');
    // The link itself lives in SiteHead — asserting it here too would be a
    // source-shape test; the built-HTML invariant is covered by the
    // dist-manifest check in the single-ownership verification.
    expect(SITE_HEAD).toContain('rel="describedby" href="/llms.txt"');
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
  it('signup.astro derives noindex from the shared list, like login and account', () => {
    expect(SIGNUP).toMatch(/<Base[^>]*\bnoindex=/);
  });

  it('every non-public page derives noindex from NON_PUBLIC_PAGES', () => {
    // The old failure mode: a page added to the de-index list in the sitemap
    // regex but not noindexed (or vice versa) — two hand-synced copies that
    // had already drifted once (/signup was submitted to the sitemap while
    // carrying no robots meta). The behavioral half of this rule is asserted
    // by sitemap-options.test.ts (the filter consumes the list) and by the
    // built output itself; what still needs pinning is the one structural
    // edge — Base renders the `robots` meta from the same prop the pages set —
    // plus the exact set membership.
    expect(isNonPublic('/en/signup/')).toBe(true);
    // One structural edge: SiteHead — the shared head — renders the robots
    // meta from the same noindex prop the gated pages set. Every layout gets
    // it by construction, so a hand-rolled second head cannot forget it.
    expect(SITE_HEAD).toMatch(/\{noindex\s*&&\s*<meta name="robots" content="noindex"\s*\/>\}/);
  });

  it('NON_PUBLIC_PAGES covers exactly the four gated pages', () => {
    expect([...NON_PUBLIC_PAGES].sort()).toEqual(['account', 'enterprise-trial', 'login', 'signup']);
  });
});
