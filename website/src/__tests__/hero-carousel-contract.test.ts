import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SLIDE_IDS } from '../lib/hero-carousel';

/**
 * The homepage carousel is static markup plus a ~1 KB behaviour module. That is
 * a performance property, not just an implementation detail: re-adding
 * `client:load` to it puts the React renderer (measured ~55 KB gzip) back on the
 * homepage for every visitor. These assertions fail if that happens, or if the
 * `data-` hooks the behaviour module queries stop being rendered.
 */
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

const carousel = read('../components/HeroCarousel.astro');
const hero = read('../components/Hero.astro');

describe('homepage carousel contract', () => {
  it('is not a hydrated island any more', () => {
    expect(hero).toContain("import HeroCarousel from './HeroCarousel.astro'");
    expect(hero).toMatch(/<HeroCarousel\s+labels=/);
    expect(hero).not.toMatch(/<HeroCarousel[^>]*client:/);
    for (const gone of [
      '../components/HeroCarousel.tsx',
      '../components/mockups/SlideWindow.tsx',
      '../components/mockups/RestaurantMockup.tsx',
    ]) {
      expect(existsSync(new URL(gone, import.meta.url))).toBe(false);
    }
  });

  it('renders every slide and pill from the module that owns the ids', () => {
    // Two maps — one for the track, one for the pill bar — over the same ids.
    expect(carousel.match(/SLIDE_IDS\.map\(/g)).toHaveLength(2);
    for (const hook of [
      'data-carousel',
      'data-carousel-track',
      'data-carousel-pills',
      'data-carousel-pill',
      'data-slide-id',
    ]) {
      expect(carousel).toContain(hook);
    }
    expect(SLIDE_IDS).toHaveLength(5);
  });

  it('keeps one owner for the pill classes so markup and script cannot disagree', () => {
    expect(carousel).toContain('pillClass(');
    expect(carousel).toContain('initHeroCarousels');
    expect(carousel).toContain("from '../lib/hero-carousel'");
  });

  it('ships the resting state and the first-slide transform in the markup', () => {
    // The static document must look right before the script runs: no flash of
    // five stacked slides, and the auto-advance transition already armed.
    expect(carousel).toContain('transform: translateX(-0%)');
    expect(carousel).toContain('transform ${AUTO_MS}ms');
    expect(carousel).toContain("aria-hidden={i === 0 ? 'false' : 'true'}");
  });

  it('still renders the rich first slide and the placeholder captions', () => {
    expect(carousel).toContain('<RestaurantMockup />');
    expect(carousel).toContain('{descriptions[id]}');
    expect(carousel).toContain('{comingSoon}');
    // The money screen inside slide 1 — a regression here is a visual loss.
    expect(read('../components/mockups/RestaurantMockup.astro')).toContain('Bayar · QRIS');
  });
});
