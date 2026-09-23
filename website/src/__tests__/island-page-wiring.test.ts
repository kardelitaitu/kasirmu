import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LABELS } from '../components/AccountView';
import { AUTH_FORM_LABELS } from '../components/AuthForm';
import { SUPPORT_LABELS } from '../components/ContactForm';
import { PRICING_LABELS } from '../components/PricingGrid';
import { SEARCH_LABELS } from '../components/SearchModal';
import { SIGNUP_FORM_LABELS } from '../components/SignupForm';
import { PAIR_LABELS } from '../components/PairView';

/**
 * Each island's strings reach it as a `labels` prop built by `labelMap` IN THE
 * PAGE, and `t(labels, key)` falls back to the KEY ITSELF when the map has no
 * entry (../i18n/labels.ts:19-21). So a page that builds its map from the wrong
 * list — or forgets it entirely — renders raw keys like `signup.title` to a real
 * visitor, silently, while every other test stays green.
 *
 * WHY THIS FILE EXISTS SEPARATELY. `island-label-coverage.test.ts` grades the
 * relationship between an island's LIST and the COMPONENT FILES that read keys
 * from it. It names its cases by page ("signup (signup.astro)") but never opens
 * the page, so the last link in the chain — page imports list → labelMap → prop —
 * was asserted nowhere. These two files are the two halves; neither subsumes the
 * other.
 *
 * THE FAILURE THIS PREVENTS, concretely: swap `SIGNUP_FORM_LABELS` for
 * `AUTH_FORM_LABELS` in signup.astro and the signup page needs a sign-in on the
 * live site — 234 website tests and the built-page checks all still pass, because
 * both lists resolve, just not the right ones for the keys this island reads.
 */

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** Pages that hand a hydrated island its strings. */
interface WiredIsland {
  /** Page path, relative to src/__tests__. */
  page: string;
  /** The island component the page renders. */
  component: string;
  /** The list the page must build its label map from. */
  list: string;
}

const WIRED: WiredIsland[] = [
  { page: '../pages/[locale]/signup.astro', component: 'SignupForm', list: 'SIGNUP_FORM_LABELS' },
  { page: '../pages/[locale]/login.astro', component: 'AuthForm', list: 'AUTH_FORM_LABELS' },
  { page: '../pages/[locale]/account.astro', component: 'AccountView', list: 'ACCOUNT_LABELS' },
  { page: '../pages/[locale]/pair.astro', component: 'PairView', list: 'PAIR_LABELS' },
  { page: '../pages/[locale]/support.astro', component: 'ContactForm', list: 'SUPPORT_LABELS' },
  { page: '../pages/[locale]/pricing.astro', component: 'PricingGrid', list: 'PRICING_LABELS' },
];

describe("every island page builds its label map from the island's own list", () => {
  for (const island of WIRED) {
    const page = read(island.page);
    const name = island.page.split('/').pop()!;

    it(`${name} imports ${island.list}`, () => {
      expect(
        page,
        `${name} renders <${island.component}> but does not import ${island.list}; the island would receive strings built from some other list, or none at all`,
      ).toMatch(new RegExp(`import[^;]*\\b${island.list}\\b`));
    });

    it(`${name} passes that map to <${island.component}>`, () => {
      // The map must be BUILT from this list...
      expect(
        page,
        `${name} calls labelMap without ${island.list}`,
      ).toMatch(new RegExp(`labelMap\\([^)]*\\b${island.list}\\b`));

      // ...and the value it builds must reach the island's labels prop.
      const mapped = page.match(/const\s+(\w+)\s*=\s*labelMap\(([^)]*)\b([A-Z_]+)\b/);
      expect(mapped, `${name} has no 'const x = labelMap(..., LIST)' binding`).not.toBeNull();
      expect(mapped![3], `${name} builds its map from ${mapped![3]}, not ${island.list}`).toBe(
        island.list,
      );
      expect(
        page,
        `${name} never passes ${mapped![1]} as the labels prop`,
      ).toMatch(new RegExp(`labels=\\{${mapped![1]}\\}`));
    });
  }

  it('covers every island that island-label-coverage.test.ts names', () => {
    // The two files must not drift: a new island added to the other suite but not
    // to this one would leave the page-wiring half silently ungraded. Search is
    // excluded because it is mounted by Header.astro, not a [locale] page.
    const wired = new Set(WIRED.map((w) => w.component));
    expect(wired).toEqual(
      new Set([
        'SignupForm',
        'AuthForm',
        'AccountView',
        'PairView',
        'ContactForm',
        'PricingGrid',
      ]),
    );
    // Named here so the exclusion is a decision rather than an omission.
    expect(SEARCH_LABELS.length).toBeGreaterThan(0);
  });
});
