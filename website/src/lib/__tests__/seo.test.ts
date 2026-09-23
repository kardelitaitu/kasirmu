import { describe, expect, it } from 'vitest';
import { BRAND, TITLE_BUDGET, fitDocumentTitle } from '../seo.ts';
import en from '../../i18n/en.json';
import id from '../../i18n/id.json';

/**
 * The document-title budget (`src/lib/seo.ts`), plus the property that matters
 * for the live pages: every page name the dictionaries compose a title from
 * fits the budget once the brand prefix is dropped.
 *
 * That property is the fix for seven pages that shipped over-long titles
 * (restaurant 72, cafe 70, android 69 characters as rendered). It reads the
 * real dictionaries, so adding a page name longer than the budget fails here —
 * before the build, which is the only other place it would surface.
 */
describe('fitDocumentTitle', () => {
  it('keeps a title that already fits, brand and all', () => {
    const title = `${BRAND} — Features`;
    expect(title.length).toBeLessThanOrEqual(TITLE_BUDGET);
    expect(fitDocumentTitle(title)).toBe(title);
  });

  it('drops the brand prefix when the branded title would be truncated', () => {
    const name = 'Aplikasi Kasir Restoran: Dapur, Meja & QRIS Sinkron';
    const branded = `${BRAND} — ${name}`;
    expect(branded.length).toBeGreaterThan(TITLE_BUDGET);
    expect(fitDocumentTitle(branded)).toBe(name);
  });

  it('never shortens the page name itself', () => {
    // The name is the part that tells a searcher what to click, so an over-long
    // name passes through untouched even when it still exceeds the budget:
    // shortening it is a copy decision, and check-seo.mjs reports it at build
    // time instead of this function guessing.
    const name = 'x'.repeat(TITLE_BUDGET + 20);
    expect(fitDocumentTitle(`${BRAND} — ${name}`)).toBe(name);
    expect(fitDocumentTitle(name)).toBe(name);
  });

  it('leaves an unbranded over-long title alone', () => {
    const title = `${'y'.repeat(TITLE_BUDGET + 5)}`;
    expect(fitDocumentTitle(title)).toBe(title);
  });

  it('treats the budget as an inclusive limit', () => {
    const exactly = `${BRAND} — ${'z'.repeat(TITLE_BUDGET - BRAND.length - 3)}`;
    expect(exactly.length).toBe(TITLE_BUDGET);
    expect(fitDocumentTitle(exactly)).toBe(exactly);
    const oneOver = `${exactly}q`;
    expect(fitDocumentTitle(oneOver)).toBe(oneOver.slice(BRAND.length + 3));
  });

  it('only strips a brand prefix, not a coincidental occurrence', () => {
    const title = `Selling with ${BRAND} ${'w'.repeat(TITLE_BUDGET)}`;
    expect(fitDocumentTitle(title)).toBe(title);
  });
});

describe('page names fit the title budget', () => {
  /** Every vertical and landing page name, both locales — the seven offenders. */
  const names: [string, string][] = [];
  for (const [locale, dict] of [
    ['en', en],
    ['id', id],
  ] as const) {
    for (const [key, value] of Object.entries(dict.vertical)) {
      if (value && typeof value === 'object' && 'title' in value) {
        names.push([`${locale} ${key}`, String((value as { title: string }).title)]);
      }
    }
    for (const [key, value] of Object.entries(dict.landing)) {
      if (value && typeof value === 'object' && 'title' in value) {
        names.push([`${locale} ${key}`, String((value as { title: string }).title)]);
      }
    }
  }

  it('collects a name for every vertical and landing page in both locales', () => {
    expect(names).toHaveLength(18);
  });

  it('every composed title fits the SERP budget', () => {
    for (const [label, name] of names) {
      expect(name.length, `${label} name length`).toBeLessThanOrEqual(TITLE_BUDGET);
      expect(fitDocumentTitle(`${BRAND} — ${name}`).length, `${label} composed title`).toBeLessThanOrEqual(
        TITLE_BUDGET,
      );
    }
  });
});
