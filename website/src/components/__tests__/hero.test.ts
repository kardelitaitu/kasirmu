import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The hero's funding badge.
 *
 * It parodies a Y Combinator badge to say the opposite, and it was a hard-coded
 * English string in the markup — so on `/id/` the first sentence an Indonesian
 * visitor read was English, above an Indonesian headline. The badge now comes
 * from `hero.badge`. The English wording is pinned deliberately: it is the
 * joke, and a copy edit should have to be explicit about changing it.
 */

const HERO_SRC = readFileSync(join(import.meta.dirname, '..', 'Hero.astro'), 'utf-8');
const enJson = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'en.json'), 'utf-8'),
);
const idJson = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'i18n', 'id.json'), 'utf-8'),
);

describe('hero funding badge', () => {
  it('reads the badge from the dictionary', () => {
    expect(HERO_SRC).toContain("t(locale, 'hero.badge')");
    expect(HERO_SRC).not.toContain('Not backed by Y Combinator');
  });

  it('keeps the English wording (it is the joke)', () => {
    expect(enJson.hero.badge).toBe('Not backed by Y Combinator');
  });

  it('tells the joke in Indonesian on the Indonesian page', () => {
    expect(idJson.hero.badge).toBeTruthy();
    expect(idJson.hero.badge).not.toBe(enJson.hero.badge);
    expect(idJson.hero.badge).toContain('Y Combinator');
  });
});
