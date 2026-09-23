/**
 * The commercial landing pages, and how deep each one owes to be.
 *
 * These nine pages per locale (five industry landings, four keyword landings)
 * exist to be found by someone searching for a POS for their business, and they
 * were the thinnest pages on the site: measured 2026-09-23, between 147 and 271
 * words of body copy against 526 on the home page. A page that thin cannot
 * explain anything to someone deciding, and it is the page a search engine
 * reads when it decides whether the site is worth ranking for "aplikasi kasir
 * minimarket".
 *
 * `scripts/check-seo.mjs` is the authority — it measures the RENDERED page,
 * because that is what a visitor and a crawler get, and counts words in
 * `<main>` only so the header and footer sitemap (about 130 words on every
 * page) cannot stand in for content of the page's own.
 *
 * FLOORS. Each one sits roughly 10% below the lowest page in its class on the
 * day the copy was deepened, so ordinary editing does not trip it while a
 * return to a stub does. Raise them when the pages grow; do not lower them to
 * make room for a shorter page — shorten the copy instead, or take the page out
 * of the list and out of the footer.
 */
export interface LandingContract {
  /** Locale-less path, e.g. `/warung/`. */
  slug: string;
  /** Dictionary branch this page reads, so the gate can see what was authored. */
  copyKey: string;
  /** Minimum words of rendered `<main>` text. */
  minWords: number;
  /** Minimum rendered FAQ entries — one `<details class="faq-item">` each. */
  minFaq: number;
  /**
   * Minimum authored step-by-step lines (`day` for the industry landings, `how`
   * for the keyword ones). Zero is a deliberate answer, not a gap: the Android
   * landing is a STATUS page — the build is not published, so a walkthrough
   * would describe software nobody can install. It owes explanation and FAQ
   * instead, and the word floor still applies to it.
   *
   * `content-depth.test.ts` asserts this count pre-build; `check-seo` asserts
   * the other direction on the rendered page — that steps which ARE authored
   * actually appear.
   */
  minSteps: number;
}

export const LANDING_CONTRACTS: LandingContract[] = [
  // Industry landings. Floor 320 against a measured low of 359.
  { slug: '/warung/', copyKey: 'vertical.warung', minWords: 320, minFaq: 4, minSteps: 4 },
  { slug: '/cafe/', copyKey: 'vertical.kafe', minWords: 320, minFaq: 4, minSteps: 4 },
  { slug: '/restaurant/', copyKey: 'vertical.restoran', minWords: 320, minFaq: 4, minSteps: 4 },
  {
    slug: '/minimarket/',
    copyKey: 'vertical.minimarket',
    minWords: 320,
    minFaq: 4,
    minSteps: 4,
  },
  { slug: '/warehouse/', copyKey: 'vertical.warehouse', minWords: 320, minFaq: 4, minSteps: 4 },
  // Keyword landings. Floor 210 against a measured low of 229.
  { slug: '/kasir-gratis/', copyKey: 'landing.gratis', minWords: 210, minFaq: 5, minSteps: 3 },
  { slug: '/kasir-murah/', copyKey: 'landing.murah', minWords: 210, minFaq: 5, minSteps: 3 },
  { slug: '/kasir-qris/', copyKey: 'landing.qris', minWords: 210, minFaq: 5, minSteps: 3 },
  {
    slug: '/aplikasi-kasir-android/',
    copyKey: 'landing.android',
    minWords: 210,
    minFaq: 5,
    minSteps: 0,
  },
];
