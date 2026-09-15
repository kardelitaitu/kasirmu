// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { unified } from '@astrojs/markdown-remark';
import rehypeCallouts from './src/plugins/rehype-callouts.mjs';
import rehypeMermaidClass from './src/plugins/rehype-mermaid-class.mjs';
import rehypeMermaid from 'rehype-mermaid';

// Static marketing site — two locales, path-prefixed (/en/, /id/), no
// server runtime. See website-plan.md §10 for the Cloudflare Pages settings.
// Canonical, og:url, sitemap, and hreflang all derive from `site`.
export default defineConfig({
  site: 'https://kasir.mu',
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
    sitemap({
      // Emit <xhtml:link rel="alternate" hreflang> pairs for both locales
      // so search engines treat /en/… and /id/… as translations of each other.
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en',
          id: 'id',
        },
      },
      // Skip the auth pages — no indexable content on /account (session-gated)
      // or /login (form-only). The docs hub (/en/docs/, /id/docs/) IS a real
      // page now (4-card landing, src/pages/[locale]/docs/index.astro) so it
      // stays in the sitemap; only the locale-less bare /docs/ path is noise.
      filter: (page) => !/\/account\/$/.test(page) && !/\/login\/$/.test(page),
    }),
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
    defaultLocale: 'en',
    locales: ['en', 'id'],
    routing: {
      // Both locales are path-prefixed: /en/… and /id/…
      prefixDefaultLocale: true,
    },
  },
});
