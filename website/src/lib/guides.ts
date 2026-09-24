/**
 * The guides layer — one owner for its URL shape and its contract.
 *
 * WHY THIS FILE EXISTS. Guides are the site's informational content: articles
 * that answer a question a buyer asks *before* they know they want a POS. They
 * are deliberately NOT docs (which describe this product) and NOT landing pages
 * (which sell it), so they get their own collection, their own route and their
 * own page class in the gate.
 *
 * THE ONE ASYMMETRY. The path segment is translated — `/id/panduan/`,
 * `/en/guides/` — because the audience for these queries reads Indonesian and
 * the word "panduan" is what an Indonesian reader expects. That breaks the
 * assumption every other page on this site makes, which is that the same
 * locale-less path exists under both locales. So a guide page must tell
 * `SiteHead` what its counterpart's path is (`guideAlternatePath`); without it
 * the hreflang arm would point `/id/panduan/x/` at `/en/panduan/x/`, a page
 * that does not exist, and the reciprocity check would fail the build.
 *
 * Consumed by: src/pages/[locale]/[guideSegment]/… (the routes),
 * scripts/check-seo.mjs (page class + the commercial-parent rule),
 * scripts/sitemap-lastmod.mjs (per-URL lastmod from front matter).
 */

/** URL segment per locale. A locale with no entry falls back to `guides`. */
export const GUIDE_SEGMENT: Record<string, string> = { id: 'panduan', en: 'guides' };

/** Repo-relative source directory, for the sitemap's lastmod resolver. */
export const GUIDE_SOURCE_PREFIX = 'website/src/content/guides/';

export function guideSegment(locale: string): string {
  return GUIDE_SEGMENT[locale] ?? 'guides';
}

/** `/id/panduan/aplikasi-kasir-offline/` — the built URL of one guide. */
export function guidePath(locale: string, slug: string): string {
  return `/${locale}/${guideSegment(locale)}/${slug}/`;
}

/** `/id/panduan/` — the hub for one locale. */
export function guideHubPath(locale: string): string {
  return `/${locale}/${guideSegment(locale)}/`;
}

/**
 * The locale-less path of this guide's counterpart in `otherLocale`, for
 * `SiteHead`'s hreflang arm: `panduan/x` from English, `guides/x` from
 * Indonesian.
 */
export function guideAlternatePath(otherLocale: string, slug: string): string {
  return `${guideSegment(otherLocale)}/${slug}`;
}

/**
 * What every guide owes. A floor, not a target: the competitor set for these
 * queries publishes long-form, so 600 words of rendered `<main>` text is the
 * least that can be called an answer rather than a stub.
 *
 * `requiresParentLink` is the rule that makes this content earn its keep — see
 * the header of scripts/check-seo.mjs, check 15.
 */
export const GUIDE_CONTRACT = {
  minWords: 600,
  /** Every guide must link, in its body, to the commercial page it supports. */
  requiresParentLink: true,
} as const;
