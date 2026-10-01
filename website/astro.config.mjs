// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
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
    // NOTE, measured in round 139: these MUST use the flat `rehypePlugins` key, even
    // though it is marked deprecated in favour of `markdown.processor: unified(...)`.
    // The docs/guides/legal collections are loaded by the CONTENT LAYER
    // (src/content.config.ts, the `glob` loader), and that pipeline does NOT read
    // `markdown.processor` -- a plugin registered there is never invoked. This was
    // silent: `rehype-callouts` had been configured but inert, which is why built
    // blockquotes carry no `callout` class, and it is why an earlier attempt to strip
    // the audit footer via `processor` had no effect at all while appearing to work.
    // The flat key reaches the content layer; the processor key does not.
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
    rehypePlugins: [
      rehypeStripAuditFooter,
      rehypeCallouts,
      rehypeMermaidClass,
      [rehypeMermaid, { strategy: 'img-svg', cache: true }],
    ],
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
