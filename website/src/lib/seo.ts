/**
 * The document title's length budget, and the one function that enforces it.
 *
 * WHY A BUDGET EXISTS. Google truncates a SERP title by pixel width — roughly
 * 600px, which is ~60 characters of Latin script. Past that the tail is
 * replaced with an ellipsis, so whatever the page parked there (often the
 * qualifying clause, sometimes the brand) is not shown to the searcher, and a
 * title that varies in length across a site makes for an uneven result list.
 * Seven of this site's pages were over the limit before this module existed
 * (restaurant 72, cafe 70, android 69 in characters as rendered).
 *
 * WHY IT DROPS THE BRAND. Every title is composed as `kasir.mu — <page name>`,
 * and the brand prefix is 11 of the ~60 characters. When the pair does not fit,
 * something has to give, and the two candidates are not equivalent: the brand
 * is already carried by the URL, by `og:site_name` and by the site's own
 * navigation, whereas the page name is the part that tells a searcher which
 * result to click. So `fitDocumentTitle` removes the prefix and NEVER trims the
 * name. A name that cannot fit on its own is a copy decision for a human, so it
 * is deliberately left long here — `scripts/check-seo.mjs` fails the build on
 * the rendered `<title>` and names the page, which is where that decision
 * belongs.
 *
 * Applied in `SiteHead.astro`, the single owner of the document head, so every
 * page gets the same rule whether or not its author remembers one exists.
 *
 * Consumed by: src/components/SiteHead.astro (render), and
 * src/lib/__tests__/seo.test.ts (the budget and the prefix rule).
 */

/** Canonical brand, matching `SITE` in src/lib/site.ts and og:site_name. */
export const BRAND = 'kasir.mu';

/** Longest title emitted into `<title>` / `og:title`, in characters. */
export const TITLE_BUDGET = 60;

/**
 * Longest `<meta name="description">` worth emitting, in characters.
 *
 * Descriptions are not a ranking input, but they are the snippet copy most
 * often shown under the title, and Google ellipsises past roughly 920px
 * (~160 characters). No page was over this when it was added; it is enforced so
 * the tail of a longer description — again, usually the qualifying clause —
 * cannot be written and forgotten.
 */
export const DESCRIPTION_BUDGET = 160;

/** The composed form a branded title opens with. */
const BRAND_PREFIX = `${BRAND} — `;

/**
 * Return `title` unchanged when it fits the budget, else drop the brand prefix.
 *
 * The fallback for an over-long title that is NOT branded is the title itself:
 * every page renders through the same head, and silently cutting text out of a
 * name would change what the page claims to be in a way no reviewer would see
 * in the source. `check-seo.mjs` turns that case into a build failure instead.
 */
export function fitDocumentTitle(title: string): string {
  if (title.length <= TITLE_BUDGET) return title;
  if (!title.startsWith(BRAND_PREFIX)) return title;
  return title.slice(BRAND_PREFIX.length);
}
