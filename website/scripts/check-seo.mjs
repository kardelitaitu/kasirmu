// SEO / <head> audit of the built dist/ output — a FAILING gate on the
// rendered head. Run: node scripts/check-seo.mjs (after `npm run build`;
// wired into CI as `npm run check:seo`). Exits 1 when any page is wrong.
//
// WHY THIS EXISTS. Every other SEO invariant in this repo is asserted against
// SOURCE (`src/__tests__/seo-head-invariants.test.ts`, `astro check`) because
// the test suite runs BEFORE the build in CI — `npm test` then `npm run build`
// (dev-ci.yml, website job) — so a test that read `dist/**` would fail on a
// clean checkout. That left the one thing that actually reaches a crawler, the
// emitted HTML, verified by nothing: the only post-build gate was
// `check:links`. This is that missing half. It reads the real files, so a tag
// that is dropped by a component refactor, a canonical that points at another
// locale, or a page that quietly stops being submitted is a red build.
//
// WHAT IS ASSERTED, per page and naming the page when it fails:
//   1. canonical ⇄ og:url — exactly one of each, equal to each other, and equal
//      to this page's own URL. A canonical that names a different page is the
//      worst possible defect here (it de-indexes the page it is on), and it is
//      invisible to every source-level test.
//   2. hreflang alternates — exactly {en, id, x-default} on every locale page,
//      each href on the canonical origin, x-default equal to the `id` variant
//      (the same convention `scripts/sitemap-options.mjs` emits), every target a
//      page the build actually produced, and RECIPROCAL: the counterpart must
//      point back. The existence arm is what catches a page that exists in only
//      one locale — an href computed from the page's own path always looks
//      right, so nothing else would notice the dangling id/x-default pointer.
//   3. sitemap ⇄ built public pages, both directions — nothing submitted that
//      is not a public built page (the gated NON_PUBLIC_PAGES, the locale-detect
//      root, /404, /pair, /admin, /dev, /docs-portal), and nothing public left
//      unsubmitted.
//   4. noindex discipline — the gated locale pages and the standalone /pair/
//      page carry the meta tag; no other content page does (a stray noindex
//      silently de-indexes a live page); the headless /admin/ and /dev/ trees
//      are covered by `X-Robots-Tag: noindex` in _headers, which is their only
//      possible mechanism.
//   5. JSON-LD — every block parses, declares @context/@type, carries the types
//      its page class owes (docs articles = BreadcrumbList + Article — the class
//      comes from the content collection, so a doc at any depth is held to it —
//      pricing = SoftwareApplication/Organization/WebSite + Product, marketing =
//      SoftwareApplication/Organization/WebSite), and describes only visible
//      content: an Offer price must be a finite number (not "$0"/"Custom"), an
//      Article's mainEntityOfPage must be this page, and every FAQPage question
//      must appear as text in the body.
//   6. titles and descriptions — present on every page that can be indexed,
//      unique site-wide, and inside the SERP budget (TITLE_BUDGET /
//      DESCRIPTION_BUDGET from src/lib/seo.ts). Length is measured on the
//      decoded text, so an `&amp;` counts as the one character a searcher
//      sees. `SiteHead` drops the brand prefix from an over-long title rather
//      than trimming the page name, so what this catches is a page name that
//      cannot fit on its own — a copy decision, flagged rather than guessed.
//   7. the docs corpus ⇄ the build — every doc in src/content/docs has a page.
//      The collection is what the sidebar, the ⌘K index and this gate's docs
//      class are all derived from, so a doc that stops building disappears
//      from the site without any other check being able to see it.
//   8. locale copy — the rendered footer sitemap speaks the page's locale, in
//      both directions: every label the locale's dictionary defines is present,
//      and every label rendered is one of them. This is a VISITOR check rather
//      than an SEO one, and it lives here for the same reason the rest of the
//      file does — it needs the emitted HTML. The defect it catches shipped for
//      months: the footer's link text was hard-coded Indonesian with no locale
//      branch, so every /en/ page served "Fitur / Harga / Unduh / Warung / …"
//      under English column headings. No source-level test could see it (the
//      component agreed with itself) and no head check could either (the head
//      was correct).
//   9. docs next step — every docs article's body offers the locale's download
//      and pricing page, with the dictionary's own label text. The docs are the
//      site's most search-aligned content, and 30 of the 36 articles used to
//      link to no commercial page at all in the body: a reader who arrived from
//      "how do I …" had no route into the product, and no internal-link equity
//      flowed to the pages that pay for the site. This asserts the block is
//      rendered, is in the right language, and points at the reader's locale.
//  10. retired brand — no page names the product by a name it no longer has.
//      Both install guides told the reader to run
//      `OZ-POS_<version>_x64-setup.exe` a full year of versions after the app
//      was renamed to kasir.mu (apps/desktop-tauri/tauri.conf.json productName),
//      so anyone who followed the install steps went looking for a file that is
//      never published under that name. Source-level tests cannot see it either:
//      the string was correct prose in a markdown file. Checked against the
//      rendered body of every page that owes a head, with the GitHub repository
//      path excepted — the repo kept its name, so `kardelitaitu/oz-pos` is not a
//      finding whether it appears as an href or as visible text.
//  11. content depth — the five industry landings and four keyword landings
//      carry the words a first-time visitor needs. Measured before this check
//      existed (2026-09-23): 147–271 words of body copy against 526 on the home
//      page. Depth is counted on rendered `<main>` text, so the ~130 words of
//      header and footer on every page cannot stand in for it, and the floors
//      live in src/lib/landings.ts — which also names the dictionary branch
//      each page reads, letting this check assert that copy which was AUTHORED
//      actually renders. It did not always: `/kasir-qris/` held four `how`
//      steps in the dictionary behind a wrapper condition that never tested for
//      them, so the section was written and invisible.
//  12. headings — exactly one h1 and no level skipped, on EVERY built page
//      rather than only the Astro ones. The outline is how a screen-reader user
//      navigates and how a search engine reads a page's shape, and both read it
//      as a sequence. Read from RENDERED markup: a heading inside `<noscript>`,
//      `<template>` or a comment is part of no outline a consumer receives, so
//      a page whose only h1 sits in one has no heading at all. Four pages
//      failed on the first run — two locale-detect stubs, the admin dashboard
//      (all its content is rendered by JS into the region its skip link
//      targets), and a prototype that began at h3 — and all four are fixed
//      rather than exempted. The one exemption is by page class rather than a
//      URL literal: `vendored portal` is generated by mdBook/rustdoc/TypeDoc
//      and staged from public/.
//
// DELIBERATELY NOT CHECKED (each a decision, not an omission):
//   • The root locale-detect stub (src/pages/index.astro) is a redirect document
//     with a hand-rolled minimal head. It carries no JSON-LD on purpose, so it
//     owes none; it is excluded from the sitemap by sitemap-options rule 3; and
//     its canonical is /id/ because that is what "/" resolves to.
//   • The standalone /pair/ page is `noindex` and has no canonical/alternates by
//     design — it is a device-pairing screen, not a public page. It is therefore
//     outside the titles/descriptions check too (it ships no meta description).
//   • /admin/ and /dev/ are static trees copied from public/ with no Astro head:
//     their noindex lives in _headers (X-Robots-Tag) and is asserted there.
//   • /docs-portal/ is the generated mdBook/rustdoc/TypeDoc tree, staged from
//     public/ by scripts/import-portal.sh and therefore present or absent
//     depending on the tools (the same presence-dependence check-links.mjs
//     handles). It is deliberately PUBLISHED — the docs hub links to it — and
//     has no Astro head, so it owes no canonical/hreflang/JSON-LD and, unlike
//     /admin/ and /dev/, must NOT be de-indexed. It is classified apart for
//     exactly that reason.
//   • llms.txt is noindexed via _headers for the same reason (it is a
//     machine-facing summary, not a page) but is not a HTML surface, so it is
//     out of scope here.
//
// SPEED: reads every built page, the sitemap and the docs corpus — ~40 ms. It is
// a post-build step, not a crawler.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANDING_CONTRACTS } from '../src/lib/landings.ts';
import { NON_PUBLIC_PAGES, SITE, isNonPublic } from '../src/lib/site.ts';
import { DESCRIPTION_BUDGET, TITLE_BUDGET } from '../src/lib/seo.ts';
import { FOOTER_COLUMNS } from '../src/lib/footer-nav.ts';

const DIST = 'dist';
// Cap the printed list so a catastrophic break floods neither the terminal nor
// the CI log — group counts are always printed in full.
const MAX_PRINTED = 100;

function walkAll(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkAll(p, out);
    else out.push(p);
  }
  return out;
}

const builtUrl = (file) => '/' + relative(DIST, file).split(sep).join('/');
/** `/en/cafe/index.html` → `/en/cafe/`; non-index files keep their path. */
const dirUrl = (url) => (url.endsWith('/index.html') ? url.slice(0, -'index.html'.length) : url);

// ── Page classes ────────────────────────────────────────────────────────────
// Every built HTML file must land in exactly one class. A page that matches
// none is itself a finding: an unclassified page is how a surface ends up
// outside every check (the /signup half-state was exactly that).
const SELF_HEAD_PAGES = {
  '/index.html': { kind: 'root stub', canonicalPath: '/id/' },
  '/404.html': { kind: '404', canonicalPath: '/404/' },
  '/pair/index.html': { kind: 'standalone pair page', canonicalPath: null },
};
// Headless trees copied verbatim from public/, with no Astro head of their own.
// They are split by intent rather than lumped together because one pair owes a
// noindex header and the other must not be judged by it at all.
const HEADLESS_TREES = [
  { prefix: '/admin/', kind: 'static headless' },
  { prefix: '/dev/', kind: 'static headless' },
  { prefix: '/docs-portal/', kind: 'vendored portal' },
];

// The docs-article set is NOT a URL pattern — it is the content collection.
// `src/content.config.ts` loads `src/content/docs/**/*.md` and
// `[locale]/docs/[...slug].astro` builds exactly one page per entry at
// `/<locale>/docs/<id minus the locale prefix>`. Reading those same files here
// is what makes a doc at ANY depth the same class as a top-level one: the
// loader's glob is `**/*.md`, so `en/guides/deep.md` really does build
// `/en/docs/guides/deep/`, and a one-segment pattern would have called that
// page "marketing" and demanded the wrong structured data from it. It also
// means a doc that no longer builds is a finding rather than a silent gap.
const DOCS_SOURCE = new URL('../src/content/docs/', import.meta.url);

/**
 * Every doc the collection loads, keyed by the URL `[...slug].astro` builds for
 * it: the file's first directory is its locale prefix and the rest is its slug,
 * so `en/guides/deep.md` → `/en/docs/guides/deep/` at any depth.
 *
 * Note what is NOT here: a locale list. Whether a doc's URL is really served is
 * decided by the build in the check below, not by a list this script would have
 * to keep in step with src/i18n — so a doc filed under a locale the site does
 * not serve is a finding instead of a doc that silently exists nowhere.
 */
function readDocsCorpus() {
  const docs = new Map(); // built URL path -> source file, so findings can name it
  const unbuildable = []; // loaded by the collection, but no route can build it
  for (const name of readdirSync(DOCS_SOURCE, { recursive: true })) {
    const relative = String(name).split(sep).join('/');
    if (!relative.endsWith('.md')) continue;
    const source = `src/content/docs/${relative}`;
    const segments = relative.slice(0, -'.md'.length).split('/');
    if (segments.length < 2) {
      unbuildable.push({ source, because: 'it sits outside any locale directory' });
      continue;
    }
    docs.set(`/${segments[0]}/docs/${segments.slice(1).join('/')}/`, source);
  }
  return { docs, unbuildable };
}

// Fail loudly rather than classify every docs page as marketing if the corpus
// cannot be read: without it this gate cannot tell a docs article from a
// marketing page, and guessing would produce exactly the false positives this
// class exists to prevent.
const { docs: docsCorpus, unbuildable } = (() => {
  try {
    return readDocsCorpus();
  } catch (error) {
    throw new Error(
      `cannot read the docs corpus at ${fileURLToPath(DOCS_SOURCE)} (${error.message}) — ` +
        'check:seo expects to run from the website package against a checkout that has src/content/docs',
    );
  }
})();

function classify(url) {
  if (SELF_HEAD_PAGES[url]) return { url, ...SELF_HEAD_PAGES[url] };
  const tree = HEADLESS_TREES.find((entry) => url.startsWith(entry.prefix));
  if (tree) return { url, kind: tree.kind, canonicalPath: null };
  const locale = url.match(/^\/(en|id)\//)?.[1];
  if (!locale) return null;
  const path = dirUrl(url);
  // A docs article is one the corpus builds. The docs hub (/xx/docs/) is a page
  // in its own right and stays a plain content page.
  return { url, kind: docsCorpus.has(path) ? 'docs article' : 'content', locale, canonicalPath: path };
}

const isPricing = (url) => /^\/(?:en|id)\/pricing\/$/.test(url);
/** A page served under a locale prefix: the ones the locale rules apply to. */
const isLocalePage = (rec) => rec.kind === 'content' || rec.kind === 'docs article';
/** Pages that ship a shared <head> (SiteHead): the ones the head checks apply to. */
const hasHead = (rec) => isLocalePage(rec) || rec.kind === 'root stub' || rec.kind === '404';

// ── Head parsing ────────────────────────────────────────────────────────────
const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const all = (html, re) => [...html.matchAll(re)].map((m) => m[0]);

const decode = (text) =>
  text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const collapse = (text) => text.replace(/\s+/g, ' ').trim();

function parsePage(file) {
  const html = readFileSync(file, 'utf8');
  const url = builtUrl(file);
  const rec = classify(url);
  // The directory form is what the head checks compare against; carrying it on
  // the record keeps every check agreeing on "this page's own URL".
  if (rec) rec.path = dirUrl(url);
  const links = all(html, /<link\b[^>]*>/g);
  const metas = all(html, /<meta\b[^>]*>/g);
  const canonical = links.filter((t) => attr(t, 'rel') === 'canonical').map((t) => attr(t, 'href'));
  const ogUrl = metas.filter((t) => attr(t, 'property') === 'og:url').map((t) => attr(t, 'content'));
  const alternates = links
    .filter((t) => attr(t, 'rel') === 'alternate')
    .map((t) => ({ lang: attr(t, 'hreflang'), href: attr(t, 'href') }));
  const robots = attr(metas.find((t) => attr(t, 'name') === 'robots') ?? '', 'content') ?? '';
  // The body as a crawler's structured-data validator would read it: no scripts,
  // no tags, whitespace collapsed — used to prove structured data describes
  // content that is actually on the page.
  const body = collapse(
    decode(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')),
  );
  // `<main>` only, for check 11. The body also carries the header nav and the
  // footer sitemap — about 130 words that are on every page — so measuring
  // depth on it would let a stub pass on chrome alone.
  // Every heading the page RENDERS, in document order, for check 12.
  // `<h1>`-`<h6>` only — an `<hgroup>` or an ARIA role is not a heading level,
  // and this is a structural check, not a semantic one.
  //
  // Non-rendered markup is stripped first, because the outline is what a
  // consumer receives and not what the file happens to contain: `<noscript>` is
  // not rendered when scripting is on (and `template` is not rendered until it
  // is cloned), while a comment is not rendered at all. Counting headings inside
  // them is how a page with no heading anywhere passes a check for having one —
  // which is what `/` and `/pair/` did, their only h1 sitting in a `<noscript>`
  // block that the 0-second meta refresh beside it also made unreadable.
  const rendered = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/g, '');
  const headings = [...rendered.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({
    level: Number(m[1]),
    text: collapse(decode(m[2].replace(/<[^>]+>/g, ' '))),
  }));
  const mainHtml = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? html;
  const main = collapse(
    decode(mainHtml.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')),
  );
  return {
    file,
    url,
    main,
    // The page's own URL as a crawler sees it (`/en/cafe/`, not the file path
    // `/en/cafe/index.html`) — what canonical and hreflang must agree with.
    path: dirUrl(url),
    rec,
    canonical,
    ogUrl,
    alternates,
    robots,
    title: html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '',
    description: attr(metas.find((t) => attr(t, 'name') === 'description') ?? '', 'content') ?? '',
    ld: [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(
      (m) => m[1],
    ),
    faqItems: (html.match(/class="faq-item/g) ?? []).length,
    headings,
    body,
    // Footer markup only, for check 8. Everything before the first `<footer` is
    // the page proper, which has no locale-copy invariant of its own here.
    footer: html.slice(html.indexOf('<footer')),
    // The docs article proper, for check 9 — the shared docs layout wraps the
    // rendered markdown in <article>, so this is the reader's body text and not
    // the sidebar, header or footer that surround it.
    articleHtml: html.slice(html.indexOf('<article'), html.indexOf('</article>') + 1),
  };
}

// ── _headers (the only noindex mechanism for the static trees) ──────────────
// Cloudflare's format: a path line, then indented `Name: value` lines. The
// paths in public/_headers are themselves indented, so indentation alone cannot
// distinguish them — a `Name:` prefix is what marks a header line.
function parseHeaders() {
  const lines = readFileSync(join(DIST, '_headers'), 'utf8').split('\n');
  const rules = [];
  let current = null;
  for (const line of lines) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    if (/^[A-Za-z0-9-]+:\s/.test(text)) {
      if (current) current.headers.push([text.split(':')[0].toLowerCase(), text.slice(text.indexOf(':') + 1).trim()]);
      continue;
    }
    current = { path: text, headers: [] };
    rules.push(current);
  }
  return rules;
}

/** Vercel/Pages-style path patterns: `*` matches within the string. */
const pathMatches = (pattern, url) =>
  new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(url);

function headerValue(rules, url, name) {
  return rules.filter((rule) => pathMatches(rule.path, url)).flatMap((rule) => rule.headers.filter(([n]) => n === name)).map(([, v]) => v).at(-1);
}

// ── Checks ──────────────────────────────────────────────────────────────────
const files = walkAll(DIST).filter((f) => f.endsWith('.html')).sort();
const pages = files.map(parsePage);
const findings = [];
const add = (check, page, message) => findings.push({ check, page, message });

const byCanonical = new Map();
for (const page of pages) if (page.canonical?.length === 1) byCanonical.set(page.canonical[0], page);

// 0. Every built page must be a class this gate knows how to vet.
for (const page of pages) {
  if (!page.rec) {
    add('page classes', page.url, 'is not a page class this gate knows — decide how it is indexed and classify it in check-seo.mjs');
  }
}

// 0b. The collection and the build must agree. The sidebar, the llms.txt page
// list and the ⌘K index are all derived from this same collection, so a doc that
// produces no page disappears from the entire site at once — and nothing else
// here would notice, because a page that was never written leaves no trace in
// dist/ to check.
const builtPaths = new Set(pages.map((page) => page.path));
for (const [url, source] of docsCorpus) {
  if (!builtPaths.has(url)) {
    add('page classes', source, `is loaded as a doc (the route would build ${url}) but the build produced no page for it — is its directory a locale the site serves?`);
  }
}
for (const { source, because } of unbuildable) {
  add('page classes', source, `is loaded by the docs collection but can never be built: ${because}`);
}

// 1. canonical ⇄ og:url.
for (const page of pages.filter((p) => p.rec && hasHead(p.rec))) {
  const { canonical, ogUrl, rec } = page;
  if (canonical.length !== 1) {
    add('canonical/og:url', page.url, `has ${canonical.length} <link rel="canonical"> tags, expected exactly 1`);
  }
  if (ogUrl.length !== 1) {
    add('canonical/og:url', page.url, `has ${ogUrl.length} og:url tags, expected exactly 1`);
  }
  if (canonical.length === 1 && ogUrl.length === 1 && canonical[0] !== ogUrl[0]) {
    add('canonical/og:url', page.url, `canonical is ${canonical[0]} but og:url is ${ogUrl[0]}`);
  }
  if (canonical.length !== 1) continue;
  const expected = `${SITE}${rec.canonicalPath}`;
  if (canonical[0] !== expected) {
    add('canonical/og:url', page.url, `canonical is ${canonical[0]} but this page's own URL is ${expected}`);
  }
}

// 2. hreflang alternates, including x-default, and their reciprocity.
for (const page of pages.filter((p) => p.rec && hasHead(p.rec))) {
  const { alternates, rec } = page;
  const langs = alternates.map((a) => a.lang);
  const duplicate = langs.filter((lang, i) => langs.indexOf(lang) !== i);
  if (duplicate.length) {
    add('hreflang', page.url, `declares a duplicate hreflang (${duplicate.join(', ')}); duplicates are discarded by crawlers`);
  }
  const expectedLangs = ['en', 'id', 'x-default'];
  for (const lang of expectedLangs) {
    if (!langs.includes(lang)) add('hreflang', page.url, `has no hreflang="${lang}" alternate`);
  }
  for (const lang of langs) {
    if (!expectedLangs.includes(lang)) add('hreflang', page.url, `declares hreflang="${lang}", which is not a locale this site serves`);
  }
  for (const { lang, href } of alternates) {
    if (!href?.startsWith(`${SITE}/`)) {
      add('hreflang', page.url, `hreflang="${lang}" points off the canonical origin: ${href}`);
    }
  }
  // Every alternate must name a page the build actually produced. This is the
  // only arm that catches a dangling pointer: the en/id hrefs below are computed
  // from this page's own path, so a page that exists in one locale only ships a
  // perfectly well-formed `id` and `x-default` pointing at URLs that were never
  // generated (there is no astro i18n `fallback` configured, so nothing does
  // generate them).
  for (const { lang, href } of alternates) {
    if (!href?.startsWith(`${SITE}/`)) continue; // off-origin hrefs are reported above
    if (!byCanonical.has(href)) {
      add('hreflang', page.url, `hreflang="${lang}" points at ${href}, which is not the canonical of any built page`);
    }
  }
  const xDefault = alternates.find((a) => a.lang === 'x-default')?.href;
  const idVariant = alternates.find((a) => a.lang === 'id')?.href;
  if (xDefault !== idVariant) {
    add('hreflang', page.url, `x-default is ${xDefault} but must be the id variant (${idVariant}), matching scripts/sitemap-options.mjs`);
  }
  // The root stub and /404 have no locale of their own — their alternates are
  // the locale homes (SiteHead falls back to `/` so hreflang never points at
  // /en/404/) — so for them the existence and x-default arms above are all that
  // can apply.
  if (!isLocalePage(rec)) continue;
  const rest = page.path.slice(`/${rec.locale}`.length); // '/cafe/'
  for (const lang of ['en', 'id']) {
    const expected = `${SITE}/${lang}${rest}`;
    const actual = alternates.find((a) => a.lang === lang)?.href;
    if (actual !== expected) {
      add('hreflang', page.url, `hreflang="${lang}" is ${actual} but the ${lang} variant of this page is ${expected}`);
    }
  }
  // Reciprocity: the other locale's page must point back at this one.
  const otherLang = rec.locale === 'en' ? 'id' : 'en';
  const counterpart = byCanonical.get(alternates.find((a) => a.lang === otherLang)?.href);
  if (counterpart) {
    const back = counterpart.alternates.find((a) => a.lang === rec.locale)?.href;
    if (back !== page.canonical[0]) {
        add('hreflang', page.url, `is not reciprocal: ${counterpart.path} declares hreflang="${rec.locale}" ${back}, not ${page.canonical[0]}`);
    }
  }
}

// 3. sitemap ⇄ built public pages, both directions.
const sitemapFiles = walkAll(DIST).filter((f) => /sitemap-\d+\.xml$/.test(f));
const sitemapIndex = join(DIST, 'sitemap-index.xml');
const submitted = [];
// Read the index ONCE, and guard the read: a missing index is a finding, not a
// crash. Reading it inside the per-file loop below let its ENOENT escape before
// the report printed, so a build with no sitemap-index.xml failed with a stack
// trace instead of the diagnostic this check had already recorded.
let sitemapIndexBody = null;
try {
  sitemapIndexBody = readFileSync(sitemapIndex, 'utf8');
} catch {
  add('sitemap', '/sitemap-index.xml', 'is missing from the build; robots.txt points crawlers at it');
}
for (const file of sitemapFiles) {
  const xml = readFileSync(file, 'utf8');
  const name = builtUrl(file);
  // Only meaningful when there is an index to be absent from — otherwise every
  // sitemap file is also reported as unlisted, burying the one finding that
  // explains why.
  if (sitemapIndexBody !== null && !sitemapIndexBody.includes(`${SITE}${name}`)) {
    add('sitemap', name, 'is not listed in sitemap-index.xml, so no crawler follows it');
  }
  for (const [, loc] of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) submitted.push({ loc, file: name });
}
const seen = new Map();
for (const { loc, file } of submitted) {
  if (seen.has(loc)) add('sitemap', file, `submits ${loc} twice (also in ${seen.get(loc)})`);
  seen.set(loc, file);
}
const expectedSubmissions = new Set(
  pages
    .filter((p) => p.rec && isLocalePage(p.rec) && !isNonPublic(`${SITE}${p.path}`))
    .map((p) => `${SITE}${p.path}`),
);
for (const { loc, file } of submitted) {
  if (expectedSubmissions.has(loc)) continue;
  const reason = isNonPublic(loc)
    ? `is one of NON_PUBLIC_PAGES (${NON_PUBLIC_PAGES.join(', ')}) and must not be submitted`
    : loc === `${SITE}/`
      ? 'is the locale-detect root, which canonicalises to /id/ — submitting it contradicts its own canonical'
      : 'is not an indexable built page (it is a gated, standalone, static or chrome page)';
  add('sitemap', file, `submits ${loc}, which ${reason}`);
}
for (const loc of expectedSubmissions) {
  if (!seen.has(loc)) add('sitemap', loc, 'is an indexable built page but is missing from the sitemap');
}

// 4. noindex discipline.
const headerRules = parseHeaders();
for (const page of pages) {
  const { rec } = page;
  if (!rec) continue;
  if (isLocalePage(rec)) {
    const gated = isNonPublic(`${SITE}${page.path}`);
    const noindexed = /noindex/.test(page.robots);
    if (gated && !noindexed) {
      add('noindex', page.url, `is one of NON_PUBLIC_PAGES but carries no <meta name="robots" content="noindex">`);
    }
    if (!gated && noindexed) {
      add('noindex', page.url, `carries robots "noindex" but is not a gated page — this de-indexes a live page`);
    }
  }
  if (rec.kind === 'standalone pair page' && !/noindex/.test(page.robots)) {
    add('noindex', page.url, 'is the device-pairing screen but carries no <meta name="robots" content="noindex">');
  }
  if (rec.kind === 'static headless') {
    const tag = headerValue(headerRules, page.url, 'x-robots-tag');
    if (!tag || !/noindex/i.test(tag)) {
      add('noindex', page.url, 'has no Astro head, so it must be de-indexed by `X-Robots-Tag: noindex` in _headers — no matching rule found');
    }
  }
}

// 5. JSON-LD: parses, declares a type, carries its class's types, describes
//    visible content.
/** How a page is described in a failure message, by the rules it is held to. */
const pageClass = (page) =>
  page.rec.kind === 'content'
    ? isPricing(page.path)
      ? 'pricing'
      : 'marketing'
    : page.rec.kind;

const requiredTypes = (rec) => {
  if (rec.kind === '404') return ['SoftwareApplication', 'Organization', 'WebSite'];
  if (rec.kind === 'root stub') return [];
  // Every docs article renders through DocsLayout, which emits these two — at
  // any depth, because the class comes from the collection rather than a URL
  // shape.
  if (rec.kind === 'docs article') return ['BreadcrumbList', 'Article'];
  const base = ['SoftwareApplication', 'Organization', 'WebSite'];
  return isPricing(rec.path) ? [...base, 'Product'] : base;
};

for (const page of pages.filter((p) => p.rec && hasHead(p.rec))) {
  const blocks = [];
  for (const raw of page.ld) {
    try {
      blocks.push(JSON.parse(raw));
    } catch (error) {
      add('structured data', page.url, `has a JSON-LD block that does not parse: ${error.message} — ${collapse(raw).slice(0, 80)}…`);
    }
  }
  for (const block of blocks) {
    if (!block['@type']) add('structured data', page.url, 'has a JSON-LD block with no @type');
    if (block['@context'] !== 'https://schema.org') {
      add('structured data', page.url, `has a JSON-LD block with @context ${JSON.stringify(block['@context'])}, expected https://schema.org`);
    }
  }
  const types = blocks.map((b) => b['@type']);
  for (const required of requiredTypes(page.rec)) {
    if (!types.includes(required)) {
      add('structured data', page.url, `is a ${pageClass(page)} page but ships no ${required} block (found: ${types.join(', ') || 'none'})`);
    }
  }
  if (types.includes('FAQPage') && page.rec.kind === 'docs article') {
    add('structured data', page.url, 'ships an FAQPage block, which does not belong on a docs article');
  }
  for (const product of blocks.filter((b) => b['@type'] === 'Product')) {
    if (product.url !== page.canonical[0]) {
      add('structured data', page.url, `Product.url is ${product.url}, not this page's canonical ${page.canonical[0]}`);
    }
    if (!Array.isArray(product.offers) || !product.offers.length) {
      add('structured data', page.url, 'Product carries no offers');
    }
    for (const offer of product.offers ?? []) {
      if (typeof offer.price !== 'number' || !Number.isFinite(offer.price)) {
        add('structured data', page.url, `Offer "${offer.name}" has a non-numeric price (${JSON.stringify(offer.price)}); Google drops the rich result`);
      }
      if (!offer.priceCurrency) add('structured data', page.url, `Offer "${offer.name}" has no priceCurrency`);
    }
  }
  for (const article of blocks.filter((b) => b['@type'] === 'Article')) {
    if (article.mainEntityOfPage !== page.canonical[0]) {
      add('structured data', page.url, `Article.mainEntityOfPage is ${article.mainEntityOfPage}, not this page's canonical ${page.canonical[0]}`);
    }
  }
  for (const faq of blocks.filter((b) => b['@type'] === 'FAQPage')) {
    const questions = faq.mainEntity ?? [];
    if (!questions.length) add('structured data', page.url, 'ships an FAQPage with no questions');
    for (const question of questions) {
      if (!question.name || !question.acceptedAnswer?.text) {
        add('structured data', page.url, 'has an FAQPage question without both a name and an acceptedAnswer.text');
        continue;
      }
      if (!page.body.includes(collapse(decode(question.name)))) {
        add('structured data', page.url, `marks up the question "${collapse(decode(question.name))}" as FAQ content, but that text is not visible on the page`);
      }
    }
  }
  if (page.faqItems > 0 && !types.includes('FAQPage')) {
    add('structured data', page.url, `renders ${page.faqItems} FAQ item(s) but ships no FAQPage block`);
  }
}

// 6. Titles and descriptions: present, unique, and inside the SERP budget.
const titled = pages.filter((p) => p.rec?.canonicalPath);
for (const page of titled) {
  if (!page.title.trim()) add('titles', page.url, 'has an empty <title>');
  if (!page.description.trim()) {
    add('titles', page.url, 'has no <meta name="description">');
  }
  // Length on the decoded text: the rendered character count is what truncates.
  const titleText = decode(page.title);
  if (titleText.length > TITLE_BUDGET) {
    add(
      'titles',
      page.url,
      `has a ${titleText.length}-character <title> (budget ${TITLE_BUDGET}) — the tail is ellipsised in a SERP; shorten the page name rather than relying on the brand to be dropped`,
    );
  }
  // The brand belongs in a title once. "kasir.mu — Unduh kasir.mu" is what a
  // composed prefix produces when the page name already names the brand, and a
  // searcher reads the repeat as a mistake — three pages shipped that until the
  // page-title strings were moved into the dictionaries whole.
  const brandMentions = (titleText.match(/kasir\.mu/g) ?? []).length;
  if (brandMentions > 1) {
    add(
      'titles',
      page.url,
      `names the brand ${brandMentions} times: ${JSON.stringify(titleText)} — the page name already carries it, so the composed prefix must go`,
    );
  }
  const descText = decode(page.description);
  if (descText.length > DESCRIPTION_BUDGET) {
    add(
      'titles',
      page.url,
      `has a ${descText.length}-character description (budget ${DESCRIPTION_BUDGET}) — the tail is ellipsised in a SERP snippet`,
    );
  }
}
for (const [field, of] of [
  ['<title>', (p) => p.title],
  ['description', (p) => p.description],
]) {
  const first = new Map();
  for (const page of titled) {
    const value = of(page);
    if (!value.trim()) continue;
    if (first.has(value)) {
      add('titles', page.url, `shares its ${field} with ${first.get(value)}: ${JSON.stringify(collapse(value))}`);
    } else {
      first.set(value, page.url);
    }
  }
}

// 8. Locale copy: the rendered footer sitemap must speak the page's locale.
//    Expected string sets come from the page's own dictionary, resolved through
//    the same key list the component renders (FOOTER_COLUMNS), so a label added
//    to one locale only is a finding rather than a silent fallback.
const DICTS = {
  en: JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')),
  id: JSON.parse(readFileSync(new URL('../src/i18n/id.json', import.meta.url), 'utf8')),
};

/** Dotted-path lookup against a dictionary; `undefined` when absent. */
function resolveKey(dict, key) {
  return key.split('.').reduce((acc, part) => acc?.[part], dict);
}

const FOOTER_EXPECTED = Object.fromEntries(
  Object.keys(DICTS).map((locale) => {
    const dict = DICTS[locale];
    return [
      locale,
      {
        aria: resolveKey(dict, 'footer.sitemap'),
        headings: FOOTER_COLUMNS.map((column) => resolveKey(dict, column.heading)),
        labels: FOOTER_COLUMNS.flatMap((column) => column.links.map((link) => resolveKey(dict, link.label))),
      },
    ];
  }),
);

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const textOf = (markup) => collapse(decode(markup.replace(/<[^>]+>/g, ' ')));

for (const page of pages.filter((p) => p.rec && isLocalePage(p.rec))) {
  const expected = FOOTER_EXPECTED[page.rec.locale];
  const nav = page.footer.match(new RegExp(`<nav[^>]*aria-label="${escapeRe(expected.aria)}"[^>]*>([\\s\\S]*?)</nav>`));
  if (!nav) {
    add('locale copy', page.url, `has no footer sitemap nav whose accessible name is "${expected.aria}" (the ${page.rec.locale} dictionary's footer.sitemap)`);
    continue;
  }
  const rendered = {
    headings: [...nav[1].matchAll(/<span class="font-semibold text-ink">([\s\S]*?)<\/span>/g)].map((m) => textOf(m[1])),
    labels: [...nav[1].matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map((m) => textOf(m[1])),
  };
  for (const field of ['headings', 'labels']) {
    const expectedSet = expected[field];
    for (const text of rendered[field]) {
      if (!expectedSet.includes(text)) {
        add('locale copy', page.url, `footer renders the ${field === 'headings' ? 'column heading' : 'link'} "${text}", which is not a ${page.rec.locale} label — wrong locale, or copy that drifted out of the dictionary`);
      }
    }
    for (const text of expectedSet) {
      if (!rendered[field].includes(text)) {
        add('locale copy', page.url, `footer is missing the ${page.rec.locale} ${field === 'headings' ? 'column heading' : 'label'} "${text}"`);
      }
    }
  }
}

// 9. Docs articles ⇄ the commercial pages: the reader's next step.
//    Both hrefs must be the page's OWN locale (`/en/docs/x/` → `/en/download/`)
//    and both labels must be that locale's dictionary strings, so a layout that
//    renders one language for every locale — the defect the footer had — is a
//    finding here too.
const DOCS_NEXT_STEP = [
  ['download', 'docs.nextStep.download'],
  ['pricing', 'docs.nextStep.pricing'],
];

for (const page of pages.filter((p) => p.rec?.kind === 'docs article')) {
  const locale = page.rec.locale;
  const links = [...page.articleHtml.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1],
    text: textOf(m[2]),
  }));
  for (const [slug, key] of DOCS_NEXT_STEP) {
    const href = `${SITE}/${locale}/${slug}/`;
    // `getRelativeLocaleUrl` emits a root-relative path (`/id/download/`) while
    // the canonical/alternate arms compare absolute URLs, so both forms are
    // accepted here — the locale is what this check is about, not the spelling.
    const link = links.find(
      (candidate) => candidate.href === href || candidate.href === `/${locale}/${slug}/`,
    );
    if (!link) {
      add(
        'docs next step',
        page.url,
        `has no link to ${href} in its body — a reader who finishes this article has no route into the product`,
      );
      continue;
    }
    const label = resolveKey(DICTS[locale], key);
    if (link.text !== label) {
      add(
        'docs next step',
        page.url,
        `links to ${href} as ${JSON.stringify(link.text)}, but the ${locale} label is ${JSON.stringify(label)}`,
      );
    }
  }
}

// 10. Retired brand: no page may name the product by a name it no longer has.
//     Scanned on `body` — the script-stripped, tag-stripped text — so an href to
//     the repository (which still contains `oz-pos`) is not a finding, and only
//     words the visitor actually reads are judged.
const RETIRED_BRAND = /\bOZ[-_ ]?POS/i;
// The GitHub repository kept its name through the rebrand; naming it is correct.
const KEPT_REPOSITORY = /kardelitaitu\/oz-pos/g;

for (const page of pages.filter((p) => p.rec && hasHead(p.rec))) {
  const visible = page.body.replace(KEPT_REPOSITORY, ' ');
  const match = visible.match(RETIRED_BRAND);
  if (!match) continue;
  const from = Math.max(0, (match.index ?? 0) - 45);
  add(
    'retired brand',
    page.url,
    `names the product ${JSON.stringify(match[0])} — the app (and its installer) have been kasir.mu since the rebrand; context: "…${visible.slice(from, from + 110).trim()}…"`,
  );
}

// 11. Content depth, on the pages organic search actually lands on.
//     Two failures are possible per landing page and they are different
//     problems: too few words means the page cannot explain anything (these
//     ran 147–271 words before the copy was deepened), and an authored section
//     that never renders means someone wrote the copy and nothing showed it —
//     which was true of `/kasir-qris/`, whose four `how` steps sat in the
//     dictionary behind a wrapper condition that did not test `v.how`.
for (const page of pages.filter((p) => p.rec && isLocalePage(p.rec))) {
  const contract = LANDING_CONTRACTS.find(
    (candidate) => page.rec.path === `/${page.rec.locale}${candidate.slug}`,
  );
  if (!contract) continue;

  const words = page.main.split(' ').filter(Boolean).length;
  if (words < contract.minWords) {
    add(
      'content depth',
      page.url,
      `has ${words} words of body copy (floor ${contract.minWords}) — a landing page this thin cannot explain the product to someone deciding`,
    );
  }

  if (page.faqItems < contract.minFaq) {
    add(
      'content depth',
      page.url,
      `renders ${page.faqItems} FAQ entries (floor ${contract.minFaq}) — src/lib/landings.ts sets the floor for this page`,
    );
  }

  // Every authored step must reach the page. The dictionary is the source of
  // truth for what was written, so a section it defines but the rendered body
  // does not contain is copy that never shipped.
  const authored = resolveKey(DICTS[page.rec.locale], contract.copyKey) ?? {};
  for (const field of ['how', 'day']) {
    const steps = authored[field];
    if (!Array.isArray(steps)) continue;
    const missing = steps.filter((step) => !page.main.includes(step));
    if (missing.length) {
      add(
        'content depth',
        page.url,
        `does not render ${missing.length} of its ${steps.length} \`${field}\` steps, starting with ${JSON.stringify(collapse(missing[0]).slice(0, 70))} — authored copy that never reaches the page`,
      );
    }
  }
}

// 12. Heading structure — exactly one h1 per page, and no level skipped.
//     A heading outline is how a screen-reader user navigates a page, and how
//     a search engine reads its shape; both read it as a sequence, so an h3
//     that arrives before any h2 is a real defect rather than a style choice.
//     These headings come from rendered markup (see the extractor above), so an
//     outline can no longer be satisfied by a `<noscript>` or commented-out
//     heading — which is exactly how the two stubs passed while being headless
//     on every path a reader or crawler takes.
//     Four pages failed the first run, each for a different reason, and each is
//     fixed rather than exempted: /index.html and /pair/index.html (locale-detect
//     stubs whose body was EMPTY, so a reader with scripting off got a blank
//     page and the document had no heading at all), /admin/index.html (no
//     headings anywhere — every panel is rendered by admin.js into #content,
//     which is also where the skip link points), and /dev/kds-prototype.html
//     (started at h3).
//     The exemption is read off the page class rather than a second literal for
//     the same tree: `vendored portal` is generated by mdBook/rustdoc/TypeDoc.
for (const page of pages) {
  if (page.rec?.kind === 'vendored portal') continue;
  const h1s = page.headings.filter((h) => h.level === 1);
  if (h1s.length === 0) {
    add('headings', page.url, 'has no <h1> — the document has no title in its outline');
  } else if (h1s.length > 1) {
    add(
      'headings',
      page.url,
      `has ${h1s.length} <h1>s (${h1s.map((h) => JSON.stringify(h.text.slice(0, 40))).join(', ')}) — a page has one`,
    );
  }
  let previous = null;
  for (const heading of page.headings) {
    if (previous !== null && heading.level > previous + 1) {
      add(
        'headings',
        page.url,
        `skips from h${previous} to h${heading.level} at ${JSON.stringify(heading.text.slice(0, 40))} — a level may not be skipped`,
      );
    }
    previous = heading.level;
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const byCheck = new Map();
for (const finding of findings) {
  if (!byCheck.has(finding.check)) byCheck.set(finding.check, []);
  byCheck.get(finding.check).push(finding);
}

const checks = [
  'page classes',
  'canonical/og:url',
  'hreflang',
  'sitemap',
  'noindex',
  'structured data',
  'titles',
  'locale copy',
  'docs next step',
  'retired brand',
  'content depth',
  'headings',
];
const classes = {};
for (const page of pages) {
  const kind = page.rec?.kind ?? 'unclassified';
  classes[kind] = (classes[kind] ?? 0) + 1;
}
console.log(
  `pages checked: ${pages.length} (${Object.entries(classes).map(([k, n]) => `${n} ${k}`).join(', ')}) · sitemap urls: ${submitted.length}`,
);
for (const check of checks) {
  const found = byCheck.get(check) ?? [];
  console.log(`  ${found.length ? `FAIL ${found.length}` : 'ok  '} ${check}`);
}

if (findings.length) {
  console.log(`\nSEO/HEAD PROBLEMS: ${findings.length}`);
  for (const check of checks) {
    const found = byCheck.get(check) ?? [];
    if (!found.length) continue;
    console.log(`\n${check}:`);
    for (const { page, message } of found.slice(0, MAX_PRINTED)) console.log(`  ${page} ${message}`);
    if (found.length > MAX_PRINTED) console.log(`  …and ${found.length - MAX_PRINTED} more (capped at ${MAX_PRINTED})`);
  }
  process.exitCode = 1;
} else {
  console.log('\nSEO/HEAD OK');
}
