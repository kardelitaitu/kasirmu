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
//      (the same convention `scripts/sitemap-options.mjs` emits), and
//      RECIPROCAL: the counterpart must be a built page and must point back.
//   3. sitemap ⇄ built public pages, both directions — nothing submitted that
//      is not a public built page (the gated NON_PUBLIC_PAGES, the locale-detect
//      root, /404, /pair, /admin, /dev), and nothing public left unsubmitted.
//   4. noindex discipline — the gated locale pages and the standalone /pair/
//      page carry the meta tag; no other content page does (a stray noindex
//      silently de-indexes a live page); the headless /admin/ and /dev/ trees
//      are covered by `X-Robots-Tag: noindex` in _headers, which is their only
//      possible mechanism.
//   5. JSON-LD — every block parses, declares @context/@type, carries the types
//      its page class owes (docs = BreadcrumbList + Article, pricing =
//      SoftwareApplication/Organization/WebSite + Product, marketing =
//      SoftwareApplication/Organization/WebSite), and describes only visible
//      content: an Offer price must be a finite number (not "$0"/"Custom"), an
//      Article's mainEntityOfPage must be this page, and every FAQPage question
//      must appear as text in the body.
//   6. titles and descriptions — present on every page that can be indexed, and
//      unique site-wide.
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
//   • llms.txt is noindexed via _headers for the same reason (it is a
//     machine-facing summary, not a page) but is not a HTML surface, so it is
//     out of scope here.
//
// SPEED: reads 89 files and 2 XML files — ~30 ms. It is a post-build step, not a
// crawler.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { NON_PUBLIC_PAGES, SITE, isNonPublic } from '../src/lib/site.ts';

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
const STATIC_DIRS = ['/admin/', '/dev/'];

function classify(url) {
  if (SELF_HEAD_PAGES[url]) return { url, ...SELF_HEAD_PAGES[url] };
  if (STATIC_DIRS.some((dir) => url.startsWith(dir))) {
    return { url, kind: 'static headless', canonicalPath: null };
  }
  const locale = url.match(/^\/(en|id)\//)?.[1];
  if (locale) return { url, kind: 'content', locale, canonicalPath: dirUrl(url) };
  return null;
}

const isDocsContent = (url) => /^\/(?:en|id)\/docs\/[^/]+\/$/.test(url);
const isPricing = (url) => /^\/(?:en|id)\/pricing\/$/.test(url);
/** Pages that ship a shared <head> (SiteHead): the ones the head checks apply to. */
const hasHead = (rec) => rec.kind === 'content' || rec.kind === 'root stub' || rec.kind === '404';

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
  return {
    file,
    url,
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
    body,
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
  if (rec.kind !== 'content') {
    // The root stub and /404 have no locale of their own — their alternates are
    // the locale homes (SiteHead falls back to `/` so hreflang never points at
    // /en/404/). Only the targets existing is checkable for them.
    for (const { lang, href } of alternates) {
      if (href?.startsWith(`${SITE}/`) && !byCanonical.has(href)) {
        add('hreflang', page.url, `hreflang="${lang}" points at ${href}, which is not the canonical of any built page`);
      }
    }
    continue;
  }
  const rest = page.path.slice(`/${rec.locale}`.length); // '/cafe/'
  for (const lang of ['en', 'id']) {
    const expected = `${SITE}/${lang}${rest}`;
    const actual = alternates.find((a) => a.lang === lang)?.href;
    if (actual !== expected) {
      add('hreflang', page.url, `hreflang="${lang}" is ${actual} but the ${lang} variant of this page is ${expected}`);
    }
  }
  const xDefault = alternates.find((a) => a.lang === 'x-default')?.href;
  const idVariant = alternates.find((a) => a.lang === 'id')?.href;
  if (xDefault !== idVariant) {
    add('hreflang', page.url, `x-default is ${xDefault} but must be the id variant (${idVariant}), matching scripts/sitemap-options.mjs`);
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
try {
  readFileSync(sitemapIndex, 'utf8');
} catch {
  add('sitemap', '/sitemap-index.xml', 'is missing from the build; robots.txt points crawlers at it');
}
for (const file of sitemapFiles) {
  const xml = readFileSync(file, 'utf8');
  const name = builtUrl(file);
  if (!readFileSync(sitemapIndex, 'utf8').includes(`${SITE}${name}`)) {
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
    .filter((p) => p.rec?.kind === 'content' && !isNonPublic(`${SITE}${p.path}`))
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
  if (rec.kind === 'content') {
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
  page.rec.kind !== 'content'
    ? page.rec.kind
    : isDocsContent(page.path)
      ? 'docs content'
      : isPricing(page.path)
        ? 'pricing'
        : 'marketing';

const requiredTypes = (rec) => {
  if (rec.kind === '404') return ['SoftwareApplication', 'Organization', 'WebSite'];
  if (rec.kind === 'root stub') return [];
  if (isDocsContent(rec.path)) return ['BreadcrumbList', 'Article'];
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
  if (types.includes('FAQPage') && page.rec.kind === 'content' && isDocsContent(page.path)) {
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

// 6. Titles and descriptions: present, and unique across the site.
const titled = pages.filter((p) => p.rec?.canonicalPath);
for (const page of titled) {
  if (!page.title.trim()) add('titles', page.url, 'has an empty <title>');
  if (!page.description.trim()) {
    add('titles', page.url, 'has no <meta name="description">');
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

// ── Report ──────────────────────────────────────────────────────────────────
const byCheck = new Map();
for (const finding of findings) {
  if (!byCheck.has(finding.check)) byCheck.set(finding.check, []);
  byCheck.get(finding.check).push(finding);
}

const checks = ['page classes', 'canonical/og:url', 'hreflang', 'sitemap', 'noindex', 'structured data', 'titles'];
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
