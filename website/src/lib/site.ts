/**
 * Site-wide constants with more than one consumer.
 *
 * NON_PUBLIC_PAGES is the single source for "which locale pages are
 * deliberately kept out of search". Three surfaces must agree on that list —
 * the page's own `noindex` prop, the sitemap exclusion filter, and the
 * llms.txt page list — and they used to be three hand-synced copies that had
 * already drifted: llms.txt advertised /id/signup/ while the sitemap excluded
 * it and the page itself was `noindex` (the exact self-contradiction the SEO
 * audit named). Adding a gated page now means editing this one array;
 * `seo-head-invariants.test.ts` fails if any surface disagrees.
 *
 * Kept dependency-free so both Astro components and Node scripts
 * (scripts/sitemap-options.mjs) can import it.
 *
 * Consumers of NON_PUBLIC_PAGES:
 *   - src/scripts sitemap filter      — excludes them from sitemap-0.xml
 *   - src/pages/[locale]/*.astro      — each passes its slug to `isNonPublic`
 *     for the `noindex` prop, so a half-added page fails the invariant test
 *   - src/lib/llms-pages.ts           — keeps /llms.txt from advertising them
 *
 * Consumers of SITE: astro.config.mjs (`site`), worker.ts, llms.txt.ts.
 */

/** Canonical origin. Also astro.config's `site`, so the two cannot drift. */
export const SITE = 'https://kasir.mu';

/**
 * Locale-page slugs with no indexable content: session-gated (/account),
 * form-only (/login, /signup) or approval-gated (/enterprise-trial). Each
 * page passes its own slug to `isNonPublic` for the `noindex` prop, so
 * removing a slug from this list consciously re-indexes that page — and the
 * invariant test flags the half-state.
 */
export const NON_PUBLIC_PAGES = ['account', 'login', 'signup', 'enterprise-trial'] as const;

/** True when a page URL's last path segment is a non-public slug. */
export function isNonPublic(url: string): boolean {
  const last = url.replace(/\/+$/, '').split('/').pop() ?? '';
  return (NON_PUBLIC_PAGES as readonly string[]).includes(last);
}
