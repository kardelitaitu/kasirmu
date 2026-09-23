import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import id from '../i18n/id.json';
import { LANDING_CONTRACTS } from '../lib/landings';

/**
 * The other half of the landing-page depth guard.
 *
 * `scripts/check-seo.mjs` measures the RENDERED page — that is the authority on
 * whether a landing page is substantial, because it counts what a visitor and a
 * crawler actually get. What it cannot do is notice a page it was never told
 * about: the contract list (src/lib/landings.ts) is hand-kept, so a new landing
 * page, a renamed slug or a quiet drop of a floor would leave the gate green
 * while the page shipped thin. That is what this test covers, pre-build, since
 * the test suite runs before the build in CI.
 */

const SRC = join(import.meta.dirname, '..');
const dictionaries = { en, id } as unknown as Record<string, Record<string, unknown>>;

/** Dotted-path lookup, matching how check-seo resolves a contract's copyKey. */
function resolveKey(dict: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], dict);
}

describe('landing depth contract', () => {
  it('covers every vertical and keyword landing page in the dictionary', () => {
    const covered = LANDING_CONTRACTS.map((contract) => contract.copyKey).sort();
    const expected = [
      ...Object.keys(en.vertical)
        .filter((key) => (en.vertical as Record<string, unknown>)[key] !== null)
        .map((key) => key)
        // Section-level strings (positioning, whyTitle, …) are not landings.
        .filter((key) => (en.vertical as Record<string, { title?: string }>)[key]?.title)
        .map((key) => `vertical.${key}`),
      ...Object.keys(en.landing).map((key) => `landing.${key}`),
    ].sort();
    expect(covered, 'add a contract in src/lib/landings.ts for every landing page').toEqual(expected);
  });

  it('points every contract at a page that exists in both locales', () => {
    for (const contract of LANDING_CONTRACTS) {
      const page = join(SRC, 'pages', '[locale]', `${contract.slug.replace(/\//g, '')}.astro`);
      expect(existsSync(page), `${contract.slug} has no page file at ${page}`).toBe(true);
    }
  });

  it('resolves every copyKey in both dictionaries', () => {
    for (const contract of LANDING_CONTRACTS) {
      for (const [locale, dict] of Object.entries(dictionaries)) {
        expect(resolveKey(dict, contract.copyKey), `${locale}: ${contract.copyKey}`).toBeDefined();
      }
    }
  });

  it('keeps enough authored copy behind every floor', () => {
    // The dictionary count equals the rendered count for FAQ entries — one
    // `<details>` per item — so the rendered floor in check-seo and this check
    // agree on the same number.
    for (const contract of LANDING_CONTRACTS) {
      for (const [locale, dict] of Object.entries(dictionaries)) {
        const branch = resolveKey(dict, contract.copyKey) as {
          faq?: unknown[];
          day?: unknown[];
          how?: unknown[];
        };
        const counts = {
          faq: branch.faq?.length ?? 0,
          day: branch.day?.length ?? 0,
          how: branch.how?.length ?? 0,
        };
        expect(counts.faq, `${locale} ${contract.copyKey} FAQ entries`).toBeGreaterThanOrEqual(
          contract.minFaq,
        );
        expect(
          counts.day + counts.how,
          `${locale} ${contract.copyKey} step-by-step copy`,
        ).toBeGreaterThanOrEqual(contract.minSteps);
      }
    }
  });

  it('does not lower a floor below the home page bar by accident', () => {
    // Floors are set just under the copy as written, so a stub cannot pass.
    for (const contract of LANDING_CONTRACTS) {
      expect(contract.minWords, `${contract.slug} floor`).toBeGreaterThanOrEqual(200);
    }
  });
});
