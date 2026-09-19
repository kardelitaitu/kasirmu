// Sitemap options, extracted from astro.config.mjs so they can be unit-tested
// (src/__tests__/sitemap-options.test.ts). The config keeps only the wiring;
// the three rules below live here because each one has already regressed or
// been wrong once.
//
//   1. <lastmod> per URL, from a real content date — never a build timestamp.
//      Implementation and rationale: scripts/sitemap-lastmod.mjs.
//
//   2. x-default must agree with the HTML. Base.astro and DocsLayout.astro
//      both point x-default at the `id` variant of the page; @astrojs/sitemap
//      emits only the en/id pair and no x-default at all, so the sitemap
//      would otherwise contradict the page it describes.
//
//   3. The locale-detect root `/` must NOT be listed. `/` canonicalises to
//      /id/, so submitting it contradicts itself — and the plugin groups
//      alternates by *path*, and the root parses to path `/` with the default
//      locale, so listing it injects a third entry into the `/` group.
//      Measured before the fix: `/`, `/en/` and `/id/` each carried
//      hreflang="en" twice, the first pointing at the root itself. Duplicate
//      hreflang values in one <url> are invalid and get discarded.
import { createLastmodResolver } from './sitemap-lastmod.mjs';

/** Canonical origin. Also astro.config's `site`, so the two cannot drift. */
export const SITE = 'https://kasir.mu';

export function createSitemapOptions() {
  // Lazily reads the git log on first use, so `astro dev` never pays for it.
  const lastmodFor = createLastmodResolver();

  return {
    // Emit <xhtml:link rel="alternate" hreflang> pairs for both locales so
    // search engines treat /en/… and /id/… as translations of each other.
    // `defaultLocale` is only consulted for a URL with no locale prefix —
    // which, now that the root is excluded, is none of them. It says `id` to
    // match the site's actual default (root canonical, x-default, <html lang>).
    i18n: {
      defaultLocale: 'id',
      locales: {
        en: 'en',
        id: 'id',
      },
    },

    // Skip the auth and gated pages — no indexable content on /account
    // (session-gated), /login (form-only), /signup (form-only) or
    // /enterprise-trial (approval-code-gated) — and the locale-detect root
    // (rule 3 above).
    //
    // /signup was the odd one out: it carried no `noindex` meta (unlike
    // /login and /account) AND was submitted in the sitemap, i.e. the site
    // explicitly invited Google to index a page whose entire content is a
    // form. Measured on the live site before this change:
    // `https://kasir.mu/en/signup/` → 200, no robots meta, listed in
    // sitemap-0.xml. Both halves are fixed together — a sitemap entry for a
    // noindexed URL is a self-contradiction, and the noindex alone would
    // leave the contradiction in place.
    //
    // The docs hub (/en/docs/, /id/docs/) IS a real page (4-card landing,
    // src/pages/[locale]/docs/index.astro) so it stays in the sitemap; only
    // the locale-less bare /docs/ path is noise.
    filter: (page) =>
      page !== `${SITE}/` && !/\/(account|login|signup|enterprise-trial)\/$/.test(page),

    serialize: (item) => {
      const lastmod = lastmodFor(item.url);

      // `links` is undefined for a page with no sibling locale (the plugin
      // returns nothing when a path resolves to a single URL), so there is
      // nothing to annotate.
      const links = item.links?.length
        ? [...item.links, { url: idVariantOf(item), lang: 'x-default' }]
        : item.links;

      const next = { ...item, links };
      // Omit the field rather than claim "now" when no date is resolvable.
      if (lastmod) next.lastmod = lastmod;
      return next;
    },
  };
}

/**
 * The `id` variant of the same page — what the HTML layouts use for
 * x-default. Falls back to the URL itself if the group somehow has no `id`
 * member, so an x-default is always present rather than silently dropped.
 */
function idVariantOf(item) {
  return item.links.find((link) => link.lang === 'id')?.url ?? item.url;
}
