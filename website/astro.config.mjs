// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import rehypeCallouts from './src/plugins/rehype-callouts.mjs';
import rehypeMermaidClass from './src/plugins/rehype-mermaid-class.mjs';
import rehypeStripAuditFooter from './src/plugins/rehype-strip-audit-footer.mjs';
import rehypeMermaid from 'rehype-mermaid';
import { SITE, createSitemapOptions } from './scripts/sitemap-options.mjs';

// Static marketing site — two locales, path-prefixed (/en/, /id/), no
// server runtime. See website-plan.md §10 for the Cloudflare Pages settings.
// Canonical, og:url, sitemap, and hreflang all derive from `site`.
export default defineConfig({
  site: SITE,
  // Inline global.css into every page's <head> instead of emitting a
  // render-blocking <link rel="stylesheet">. A worker-side hack that
  // deferred the link (media="print" onload swap) caused a flash of
  // UNSTYLED content on mobile reloads (giant nav icons + UA-default
  // purple visited-link colors for a split second) — see git history,
  // 3b505842 (reverted). Inlining removes the external request entirely:
  // nothing render-blocking, no FOUC, no worker rewrite. Cost: each HTML
  // page grows ~14 KB gzip; acceptable for a static marketing site.
  build: { inlineStylesheets: 'always' },
  integrations: [
    react(),
    // Sitemap rules (per-URL <lastmod>, x-default, the excluded root, the
    // gated pages) live in scripts/sitemap-options.mjs so they are unit-tested
    // rather than buried in config. See that file for the rationale.
    sitemap(createSitemapOptions()),
  ],
  markdown: {
    // THESE MUST USE THE `processor` KEY. Measured both ways with the content cache
    // wiped (round 140): `processor` leaves 0 of the 20 pages leaking; the flat
    // `rehypePlugins` key leaves ALL 20, so it does not reach the content layer
    // (src/content.config.ts, the `glob` loader). The flat key is also the deprecated
    // one. Two earlier commits (1f4edbc9d, d32a58176) concluded the reverse from builds
    // that had REUSED A STALE CACHE -- website/.astro caches rendered content, so a
    // config change appears to do nothing, and a plugin made deliberately inert still
    // appears to work. Wipe website/.astro when measuring this.
    //
    // rehypeMermaid renders ```mermaid blocks to inline SVG at build time
    // (Playwright, browser at build only — zero client JS; see
    // src/content/docs/en/docs-authoring.md → Charts & diagrams).
    // rehypeMermaidClass must run first: Astro's shiki marks the block with
    // data-language="mermaid" and no class, which rehype-mermaid won't match.
    //
    // cache: true writes rendered SVGs to node_modules/.cache/rehype-mermaid
    // so unchanged diagrams skip the Chromium launch on subsequent builds.
    // strategy img-svg embeds the SVG inline (no extra HTTP request).
    //
    // rehypeStripAuditFooter drops the internal `> last audited …` marker that half
    // the copied docs pages carry; it is an audit artefact, not reader content. See
    // src/plugins/rehype-strip-audit-footer.mjs for why it is a build rule rather
    // than a one-off edit of those pages.
    processor: unified({ rehypePlugins: [rehypeStripAuditFooter, rehypeCallouts, rehypeMermaidClass, [rehypeMermaid, { strategy: 'img-svg', cache: true }]] }),
  },
  vite: {
    plugins: [tailwindcss()],
  },
  i18n: {
    // `id` is the site's default in every observable signal: `/` canonicalises
    // to /id/, x-default points at /id/, <html lang> is "id", the root page's
    // noscript fallback is /id/, and the marketing copy is Indonesian. This
    // used to say `en`, contradicting all five.
    defaultLocale: 'id',
    locales: ['en', 'id'],
    routing: {
      // Both locales are path-prefixed: /en/… and /id/…
      prefixDefaultLocale: true,
    },
  },
});
