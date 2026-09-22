import { describe, expect, it } from 'vitest';
import en from '../en.json';
import id from '../id.json';

/**
 * Copy that must be WRITTEN in each language, not copied between them.
 *
 * `scripts/audit-i18n.mjs` already fails the build on a missing key or on
 * en/id key-parity drift, so a dictionary can be complete and still wrong: the
 * nine `features.items` headings on the Indonesian home page were the English
 * strings, verbatim, inside id.json. Nothing noticed — every key existed, both
 * dictionaries agreed, and the page rendered a grid of English jargon
 * ("No Hardware Barrier", "Lua Scripting") under an Indonesian heading.
 *
 * These are value-level assertions over the real dictionaries, on the copy a
 * visitor reads first: the home page feature grid, the vertical landings and
 * the keyword landings. Section titles and subtitles are included where they
 * are prose.
 */
type Item = { title: string; description: string };

const enDict = en as unknown as Record<string, any>;
const idDict = id as unknown as Record<string, any>;

describe('home feature grid', () => {
  const enItems = enDict.features.items as Item[];
  const idItems = idDict.features.items as Item[];

  it('has the same number of cards in both locales', () => {
    expect(idItems).toHaveLength(enItems.length);
    expect(enItems.length).toBeGreaterThanOrEqual(9);
  });

  it('writes every card heading in the locale, not once for both', () => {
    const copied = enItems
      .map((item, index) => [item.title, idItems[index]?.title])
      .filter(([enTitle, idTitle]) => enTitle === idTitle);
    expect(
      copied,
      'these feature headings are the English string in id.json — translate them',
    ).toEqual([]);
  });

  it('writes every card description in the locale, not once for both', () => {
    const copied = enItems
      .map((item, index) => [item.description, idItems[index]?.description])
      .filter(([enDesc, idDesc]) => enDesc === idDesc);
    expect(copied, 'these feature descriptions are copied from en.json').toEqual([]);
  });

  it('describes each card in both locales', () => {
    for (const item of [...enItems, ...idItems]) {
      expect(item.title.trim()).not.toBe('');
      expect(item.description.trim()).not.toBe('');
    }
  });
});

describe('landing page copy', () => {
  it('translates every vertical landing title and tagline', () => {
    for (const key of Object.keys(enDict.vertical)) {
      const enValue = enDict.vertical[key];
      const idValue = idDict.vertical[key];
      if (!enValue || typeof enValue !== 'object' || !('title' in enValue)) continue;
      expect(idValue, `id.vertical.${key} missing`).toBeDefined();
      expect(idValue.title, `vertical.${key}.title is the English string`).not.toBe(enValue.title);
      expect(idValue.tagline, `vertical.${key}.tagline is the English string`).not.toBe(enValue.tagline);
    }
  });

  it('translates every keyword landing title and description', () => {
    for (const key of Object.keys(enDict.landing)) {
      const enValue = enDict.landing[key];
      const idValue = idDict.landing[key];
      expect(idValue, `id.landing.${key} missing`).toBeDefined();
      expect(idValue.title, `landing.${key}.title is the English string`).not.toBe(enValue.title);
      expect(idValue.description, `landing.${key}.description is the English string`).not.toBe(
        enValue.description,
      );
    }
  });
});
