import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';

/**
 * Documentation collection (GitBook-style, website-plan §docs).
 * Files: src/content/docs/*.md — category + order drive the sidebar.
 */
const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    category: z.enum(['gettingStarted', 'guides', 'reference']),
    order: z.number().default(0),
    updated: z.string().optional(),
  }),
});

/**
 * Legal collection (Privacy Policy / Terms of Service).
 * Files: src/content/legal/<locale>/{privacy,terms}.md.
 * The page <h1> comes from i18n (legal.privacyTitle / legal.termsTitle);
 * frontmatter carries the last-updated date shown under it.
 */
const legal = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/legal' }),
  schema: z.object({
    title: z.string(),
    version: z.string().optional(),
    effective: z.string().optional(),
  }),
});

/**
 * Guides collection — the informational layer (website SEO plan, track A).
 * Files: src/content/guides/<locale>/<slug>.md.
 *
 * `target` is the query the page exists to compete for. It is required, and it
 * must be unique across the site: two pages declaring the same target are two
 * pages competing with each other, which is the one content defect no amount of
 * copy can fix. `scripts/check-seo.mjs` enforces both (check 15).
 *
 * `commercialParent` is the locale-less slug of the page this guide supports
 * (`kasir-gratis`, `warung`, `pricing`). Unlike docs, a guide is allowed —
 * obliged — to point at the product: it is how the traffic this layer earns
 * reaches a page that converts.
 */
const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    /** The search query this page exists to answer. Unique site-wide. */
    target: z.string(),
    /** Locale-less slug of the commercial page this guide supports. */
    commercialParent: z.string(),
    /** ISO date the advice last changed — drives the sitemap's <lastmod>. */
    updated: z.string().optional(),
    order: z.number().default(0),
  }),
});

export const collections = { docs, legal, guides };
