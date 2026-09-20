// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import rehypeCallouts from './src/plugins/rehype-callouts.mjs';
import rehypeMermaidClass from './src/plugins/rehype-mermaid-class.mjs';
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
    // Astro 7: remark/rehype plugins now live on the unified() processor
    // (top-level markdown.rehypePlugins is deprecated and prints a warning).
    // rehypeMermaid renders ```mermaid blocks to inline SVG at build time
    // (Playwright, browser at build only — zero client JS; see
    // src/content/docs/en/docs-authoring.md → Charts & diagrams).
    // rehypeMermaidClass must run first: Astro's shiki marks the block with
    // data-language="mermaid" and no class, which rehype-mermaid won't match.
    //
    // cache: true writes rendered SVGs to node_modules/.cache/rehype-mermaid
    // so unchanged diagrams skip the Chromium launch on subsequent builds.
    // strategy img-svg embeds the SVG inline (no extra HTTP request).
    processor: unified({ rehypePlugins: [rehypeCallouts, rehypeMermaidClass, [rehypeMermaid, { strategy: 'img-svg', cache: true }]] }),
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
