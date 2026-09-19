# SEO audit — kasir.mu marketing site (on-page, technical, content)

**Date:** 2026-09-19 · **HEAD at audit:** `4d5e32cbf` · **Scope:** `website/` — the Astro 7 static
marketing site (81 built pages, `https://kasir.mu`), its Worker (`worker.ts`), headers, sitemap,
and the Social/schema head of both layouts.
**Method:** every number below is measured from the built output (`website/dist`) or the live host,
not read off the source. Re-run recipe in §7.

> **Status: 9 findings fixed locally** (§1). **10 findings are left for a decision** (§5) — each one
> needs copy, brand, or hosting input, not code. **Nothing is deployed**; the live site still serves
> the state measured in §3.
>
> This audit is the second pass over the same site. The first
> ([`seo-robots-llms-review-19-09-26.md`](./seo-robots-llms-review-19-09-26.md)) covered
> `robots.txt`, `llms.txt`, the sitemap, and the subdomains. Where that review's conclusions are
> relevant here they are cross-referenced rather than repeated.

---

## 0. Verdict

The site is in good SEO shape — better than most commercial sites its size, and the previous review's
work is visible in the output. Unique titles and descriptions on **all 81 pages**, one `H1` per page,
self-referencing canonicals, correct `hreflang` **including `x-default`**, a 72-URL sitemap with
`<lastmod>` on every entry, rich JSON-LD, and an explicit crawler policy are all already correct.

The remaining problems were not missing infrastructure, they were **three classes of silent
breakage**:

1. **Structured data that parses but is invalid.** The pricing page's `Product` → `Offer` nodes
   carried display strings (`"price": "$0"`, `"price": "Custom"`) where schema.org requires a number.
   Google drops an unparseable offer and the Product rich result with it — the single most valuable
   rich result on a commercial site, silently forfeited.
2. **Crawl instructions that contradict themselves.** `/en/signup/` and `/id/signup/` carried no
   `noindex` *and* were submitted in the sitemap, while their siblings `/login/` and `/account/` were
   both excluded and `noindex`ed. Thin form pages were being actively advertised to Google.
3. **A page that ships its dictionary to the browser.** Every page with a React island pays **55 KB
   (gzip) of React renderer**, and the island pages with translated copy pay a further **19 KB
   (gzip) for the complete `en` + `id` dictionary** — for the handful of keys the island reads.

Those three are fixed. What is left is mostly content depth and two performance architectural calls
(§5, §4.1) that are bigger than a low-risk edit.

---

## 1. Fixed in this pass

| # | Finding | Location | Impact | Verification |
|---|---|---|---|---|
| **F1** | `Offer.price` emitted display strings (`"$0"`, `"$4.99"`, `"Custom"` / `"Kustom"`) — invalid per schema.org, so the `Product` rich result is discarded | `src/pages/[locale]/pricing.astro`, new `src/lib/schema-price.ts` | **High** | offers now `0 / 4.99 / 9.99 / 39.99` (USD) and `0 / 49000 / 99000 / 399000` (IDR); the quote-only Enterprise tier is omitted rather than emitted as `"Custom"` |
| **F2** | `Organization.sameAs` was `["https://kasir.mu"]` — a self-reference, the one value that can never be a valid `sameAs` target | `src/layouts/Base.astro` | **Medium** | now `["https://discord.gg/NdWDgEzNxx"]`, the only profile this project actually owns (see **D4**) |
| **F3** | Pricing page jumped **h1 → h3** (plan names were `h3` with no `h2` above them) | `src/components/PricingGrid.tsx` | **Medium** | heading sequence `h1 h2 h2 h2 h2 h2`; heading-level skips site-wide **2 → 0** |
| **F4** | The Features page's comparison section had **no heading at all**; `features.comparisonTitle` existed in both dicts and was rendered nowhere | `src/pages/[locale]/features.astro` | **Medium** | section now leads with `<h2>kasir.mu vs Conventional Cloud POS</h2>` — the exact query the section answers |
| **F5** | The comparison subtitle (98 chars) carried a no-wrap utility → **horizontal scrollbar at every phone width** (`≈750px` of unbreakable text at 16px) | `src/pages/[locale]/features.astro` | **Medium** | utility removed; text wraps |
| **F6** | `/en/signup/` + `/id/signup/` were **indexable and in the sitemap** (no `robots` meta; measured live) while `/login/` and `/account/` were excluded and `noindex`ed | `src/pages/[locale]/signup.astro`, `scripts/sitemap-options.mjs` | **Medium** | `<meta name="robots" content="noindex">` present; sitemap **74 → 72** URLs, no `/signup/`; the guard test now asserts the whole gated set |
| **F7** | `og:image:alt` / `twitter:image:alt` missing on **every** page | `src/layouts/Base.astro`, `src/layouts/DocsLayout.astro` | **Low** | both tags on all pages |
| **F8** | The `llms.txt` discovery link (`rel="describedby"`) existed on marketing pages but was **missing from the entire `/docs/` subtree** — `DocsLayout.astro` is a separate `<head>` | `src/layouts/DocsLayout.astro` | **Low** | present on docs pages |
| **F9** | `Product` had no `url` or `image` (both required for eligible product rich results) | `src/pages/[locale]/pricing.astro` | **Low** | `url` = the page's own URL, `image` = `/og-image.png` |

### 1.1 Why F1 was worth the most

Schema.org's `Offer.price` is a `Number`. The page emitted
`"offers":[{"@type":"Offer","name":"Free","price":"$0",…},{"name":"Enterprise","price":"Custom",…}]`.
A currency symbol makes the value unparseable; `"Custom"` is not a price in any reading. Google's
rich-result parser either invalidates the individual offer or the whole `Product`. Because the page
*also* emits a valid `SoftwareApplication` + `Offer` from `Base.astro`, the page looked fine in a
browser and in a naive "does the JSON parse" check — the failure is only visible to a validator.

The fix keeps **one source of truth**: the display string stays what the card renders, and the
conversion lives in `src/lib/schema-price.ts` with `src/lib/__tests__/schema-price.test.ts` reading
the *real* `content/pricing/{en,id}.ts` — so a future price format that the converter cannot read
fails a test instead of silently shipping an invalid offer. The currency selects the separator
convention (IDR uses `.` as the thousands separator, so `Rp 1.000.000` → `1000000`; USD keeps `.` as
the decimal point, so `$4.99` → `4.99`).

---

## 2. What was already right (preserve these)

These are load-bearing; several are the kind of thing a refactor quietly drops.

| Strength | Evidence |
|---|---|
| **Unique title + meta description on every page** | 81 pages, **0** duplicate titles, **0** duplicate descriptions |
| **Exactly one `H1` per page, no heading-level skips** | 80 of 81 pages (the exception is the locale-detect stub `/` — **O3**) |
| **Self-referencing canonicals + correct `hreflang`** | `canonical` → itself on every page; every page emits `en`, `id` **and** `x-default` → the `id` variant; **0** `hreflang` targets that do not exist in the build |
| **Sitemap** | 72 URLs, **72** with `<lastmod>` (real content dates, never a build stamp), **72** alternate groups with `x-default`; the root `/` is correctly excluded |
| **Crawler policy** | `robots.txt` serves `200 text/plain` at the authority root, absolute `Sitemap:`, an explicit "we accept every crawler" decision, `Disallow: /__oz/`, and a standing warning against `Disallow`-ing the `noindex` pages |
| **De-indexing done with the right tool** | `/admin/*`, `/dev/*` and `/llms.txt` use `X-Robots-Tag: noindex` in `public/_headers` — never a `robots.txt` `Disallow`, which would hide the signal instead |
| **Rich structured data** | `SoftwareApplication` + `Offer`, `Organization` + `ContactPoint`, `WebSite` site-wide; `Product` + `Brand` on pricing; `FAQPage` on support, how-to and the four landing pages; `BreadcrumbList` + `Article` on docs |
| **No orphan pages** | Every page except the root `/` has at least one internal inbound link; header nav, a 3-column footer and vertical cross-links give a shallow crawl depth |
| **Internal links are crawlable markup** | The header "Solutions" dropdown is CSS-hidden but present in the DOM, so its 8 links are followed |
| **Mobile basics** | `viewport` present on every page, no fixed widths, tables use `overflow-x-auto` |
| **Performance foundations** | Self-hosted fonts (no third-party origin, no blocking font CSS), content-hashed `/_astro/*` assets with `Cache-Control: immutable, max-age=31536000`, CSS inlined so nothing is render-blocking, `preconnect` to the analytics origin |
| **Error handling** | Unknown paths return a genuine **404** (verified live against the Worker); `www.kasir.mu` serves nothing, so there is no duplicate-host problem |
| **Security headers do not block crawlers** | CSP `default-src 'self'` does not prevent Googlebot rendering — verified: the JSON-LD, headings and links are all in the static HTML, not injected by the islands |

---

## 3. Findings left open — technical SEO

### T1 — Pages with a React island ship 55 KB (gzip) of React, and translated islands another 19 KB (gzip) of dictionary · **High**

Total blocking JS per page, gzipped, measured from the actual module graph (`component-url` +
`renderer-url` + their transitive imports):

| Page | JS (gzip) | Breakdown |
|---|---|---|
| `/en/`, `/id/` | **68 KB** | React renderer 55 KB + hydration runtime |
| `/en/pricing/` | **88 KB** | renderer 55 + **`i18n` 19** + island |
| `/en/support/` | **86 KB** | renderer 55 + `i18n` 19 + island |
| `/en/docs/*` | **89 KB** | renderer 55 + `i18n` 19 + `SearchTrigger` |
| `/en/login/` | **90 KB** | renderer 55 + `i18n` 19 + island |
| `/en/features/`, `/id/cafe/`, `/en/download/` | **6 KB** | `ClientRouter` + `LocaleSwitcher` only |

Two distinct wastes:

1. **`website/src/i18n/index.ts` statically imports `en.json` and `id.json`**, so any hydrated
   component that calls `t()` pulls **both locales' entire dictionaries** — measured 58 KB raw /
   **19 KB gzip**, including all landing-page copy, FAQs and vertical feature lists — to read maybe
   five keys. `PricingGrid.tsx` is the clearest case: it already receives `tiers` and `locale` as
   props and only needs `pricingPage.mostPopular`, `pricingPage.billing.*`.
2. **The React renderer (55 KB gzip) is loaded on the homepage** so `HeroCarousel.tsx` can animate a
   CSS `transform` and five pill buttons. Its first slide is static markup; the other four are
   placeholders.

**Why it hurts:** these are the LCP-critical and conversion-critical pages. 55–90 KB of gzip JS on
top of a ~31 KB gzip document is the dominant INP/TBT cost, and on a mid-range Android phone it is
most of the "time to interactive" budget.

**Fix (not applied — touches ≥5 components and their tests):** pass the strings each island needs as
props (they mostly already receive data as props), then drop the module-level `t` import from the
client components; and rewrite `HeroCarousel` as an Astro component with a tiny inline script (the
markup and mockups are already static). Removing React from the marketing pages would cut every
island page to roughly the 6 KB baseline. Given the repo's own numbers this is the highest-value
performance work available.

### T2 — HTML is never cacheable and carries the whole stylesheet on every page · **Medium**

`public/_headers` sets `Cache-Control: public, max-age=0, must-revalidate` for `/*`, and
`astro.config.mjs` sets `build: { inlineStylesheets: 'always' }`. Result: `/en/` is 141.5 KB raw /
**31 KB gzip**, of which the inlined stylesheet is repeated in all 81 documents, and every navigation
revalidates.

**Nuance worth keeping:** both choices are deliberate and documented (the inline CSS exists to kill a
documented FOUC regression; `max-age=0` exists so deploys are instantly visible). Repeat-visit cost is
one 304 round-trip, and the inlined CSS removes a render-blocking request on first visit. This is a
trade-off, not a defect — but a `stale-while-revalidate` on HTML, or `inlineStylesheets: 'auto'` for
the largest pages, would recover most of it. The comment in `_headers` that "HTML must never be
cached" is the constraint to argue with, not a rule.

### T3 — Mermaid diagrams are invisible to crawlers and cost 165 KB of HTML · **Medium**

`rehype-mermaid` is configured with `strategy: 'img-svg'`, which emits each diagram as
`<img src="data:image/svg+xml,…" alt="">`. The diagram's text — node labels like "Checkout",
"Paddle webhook", "Lisensi ada?" — exists **only inside the image**, and the empty `alt` gives a
crawler and a screen reader nothing. Measured: `/en/docs/docs-authoring/` is **164.7 KB raw**, the
largest page on the site, almost entirely two base64 diagrams.

**Fix:** mermaid's own `accTitle:` / `accDescription:` directives (or a `title` on the fenced block)
would give the image real alternative text, and `strategy: 'inline-svg'` would put the text into the
DOM as crawlable text while removing the base64 bloat. Content half of this is **D5**.

### T4 — Trailing-slash requests get a `307`, not a `301` · **Low** (hosting)

Measured in the previous review: `/id/pricing` → `307` → `/id/pricing/`. A temporary redirect passes
no ranking signal and does not consolidate; a permanent one does. Every canonical form on this site
has the trailing slash, so this is the only redirect class in play — but it is served by the platform,
not by code, so it belongs with hosting (**D6**). `public/_redirects` is currently empty (and
correctly so: there are no legacy URLs to migrate).

### T5 — `www.kasir.mu` resolves to nothing · **Low** (hosting)

`https://www.kasir.mu/` times out with zero bytes and `nslookup` returns no record. That is *fine for
SEO* — no duplicate host, no split authority — but it means there is nothing catching a `www` link.
If a `www` record is ever added, it must redirect to the apex with a `301` in the same change.
**(D6)**

### T6 — `llms.txt` is Indonesian-only · **Informational** (already a recorded decision)

Recorded as deliberate in the previous review (§6, L5). Leaving it as a decision rather than an
oversight. No action.

### T7 — `FAQPage` markup is now a weak rich-result bet · **Informational**

Google restricted FAQ rich results to authoritative government/health sites in 2023, so the
`FAQPage` blocks on `/support/`, `/cara/` and the four landing pages are unlikely to render as rich
results. They remain valid and harmless (and are useful to AI answer engines), so keep them — just do
not count them as a ranking lever.

### T8 — Two different support addresses in the same page · **Low**

`/en/pricing/` renders `mailto:adikaradwiatmaja@gmail.com` (`pricing.astro`, the Enterprise "contact
us" CTA) while the site-wide JSON-LD `ContactPoint`, the footer and `/support/` all use
`support@kasir.mu`. A personal Gmail address on a commercial pricing page undercuts the brand and
entity signals the rest of the site builds. **Fix is a decision (which address is real), not code —
see D3.**

---

## 4. Findings left open — on-page

### O1 — Seven titles exceed 60 characters · **Medium**

Google rewrites and truncates titles past ~60 characters, so the discriminating tail — the part
carrying the keyword — is the part that disappears. Measured (rendered length):

| URL | len | Title |
|---|---|---|
| `/id/restaurant/` | 68 | `kasir.mu — Aplikasi Kasir Restoran: Dapur, Meja & QRIS Tetap Sinkron` |
| `/id/cafe/` | 66 | `kasir.mu — Aplikasi Kasir Kafe: Pesanan, Dapur & QRIS Tetap Lancar` |
| `/id/aplikasi-kasir-android/` | 65 | `kasir.mu — Aplikasi Kasir Android & Tablet: Ringan untuk HP Murah` |
| `/en/aplikasi-kasir-android/` | 65 | `kasir.mu — Android & Tablet POS App: Lightweight for Cheap Phones` |
| `/id/kasir-murah/` | 65 | `kasir.mu — Aplikasi Kasir Murah: Mulai Rp0, Plus Rp49rb per Bulan` |
| `/id/kasir-gratis/` | 61 | `kasir.mu — Aplikasi Kasir Gratis untuk Warung, Kafe, dan Toko` |
| `/en/restaurant/` | 61 | `kasir.mu — Restaurant POS App: Kitchen, Tables & QRIS in Sync` |

**Fix:** shorten the subtitle half of those titles (the `kasir.mu — ` prefix is 11 characters of the
budget; see **D1** for whether the brand should lead at all). This is copy work.

### O2 — 72 meta descriptions fall short of the ~120-character mark · **Medium**

Every page has a description (a real strength) and **none is over-long** (0 pages exceed 160
characters), but 72 of 81 are under 120 — so roughly a third of the available SERP snippet is left
blank, including on money pages:

| Page | len | `description` |
|---|---|---|
| `/en/legal/terms/` | 43 | The terms that govern your use of kasir.mu. |
| `/en/legal/privacy/` | 52 | How kasir.mu collects, uses, and protects your data. |
| `/en/minimarket/` | 54 | Warehouses, multi-terminal, and live stock visibility. |
| `/en/warung/` | 58 | QRIS payments and a daily sales dashboard — free to start. |
| `/en/support/` | 80 | Get help with kasir.mu — email support and answers to the most common questions. |
| `/en/cafe/` | 83 | KDS, peak-hour analytics, and multi-terminal for your cafe — working fully offline. |
| `/en/pricing/` | 86 | Five plans — Free forever, Plus, Pro, Premium, and Enterprise. Yearly = 2 months free. |
| `/en/cara/` | 91 | Step-by-step kasir.mu how-to guides: install, first sale, QRIS, stock, and selling offline. |
| `/en/features/` | 95 | Offline-first point of sale: sales, shifts, and stock that keep working with zero connectivity. |
| `/en/download/` | 109 | Download the free POS app for Windows — lightweight and easy to install. Android and tablets are com… |

Plus **36 of the 37 `/docs/` pages**, which ship their front-matter summary verbatim
(`/en/docs/settings/` 47, `/en/docs/installation/` 45, `/en/docs/first-sale/` 50,
`/en/docs/offline-mode/` 50, `/en/docs/cloud-sync/` 51, `/en/docs/inventory/` 52, …).

The 8 noindexed auth pages (`/login/`, `/account/`, `/signup/`, `/enterprise-trial/` × 2 locales) and
the locale stub are excluded from that count — a short description there costs nothing.

**Fix:** extend the `description:` front matter of each docs page (and the `pageDesc.*` keys for
marketing) to 120–160 characters that restates the page's target query. Copy work (**D2**).

### O3 — The root `/` has no `H1`, no content, and redirects client-side · **Medium**

`src/pages/index.astro` is a deliberate locale-detect stub: an inline script does
`window.location.replace()` to `/id/` or `/en/`, with a `<noscript>` meta-refresh fallback. It has a
title, description, canonical (→ `/id/`) and correct `hreflang`, but an **empty `<body>`**, so it has
no `H1` and no crawlable content.

It is excluded from the sitemap and canonicalises to `/id/`, so Google should consolidate it — but
`/` is the strongest URL in the domain's history and the one external links are most likely to point
at, and it currently depends on the crawler rendering JS to reach real content.

**Fix (needs a hosting/architecture decision, D6):** a server-side `302` on the Worker for `/` based
on `Accept-Language` (with a `Vary: Accept-Language`) would make the entry point a real redirect
instead of a JS handoff. A cheaper stopgap is a `<noscript>` block with an `H1` and links to both
locales — not applied, because it only helps non-JS agents and adds no crawl benefit for Googlebot.

### O4 — The 404 page declares the wrong `lang` · **Low**

`src/pages/404.astro` hard-codes `const locale = 'en'` for its copy, but `Base.astro` derives
`<html lang>` from `Astro.currentLocale`, which for the locale-less `/404` is the default locale —
so the page renders **`<html lang="id">` with English text** (and `og:locale = id_ID`). Impact is
small (a 404 is not indexed) but it is a correctness bug and a one-line fix once `Base` accepts a
`locale` override.

### O5 — Brand-first title pattern · **Informational** (judgment)

Every title is `kasir.mu — <page>`. Brand-first trades keyword prominence for brand recognition, and
for a brand this young the keyword is usually the better first characters. Not changed: it is a
positioning call, and consistency across 81 pages has real value. **D1.**

---

## 5. Necessarily deferred — content & hosting decisions

None of these can be resolved by a low-risk code edit; each needs a decision or copy.

| # | Decision needed | Why it matters | Where |
|---|---|---|---|
| **D1** | **Title strategy** — keep `kasir.mu — <keyword>` or move to `<keyword> \| kasir.mu`? | Sets whether O1 is fixed by trimming the tail or by moving the brand to the end | 81 titles |
| **D2** | **Description copy pass** — 63 indexable pages carry a description under 120 chars (36 docs + 27 marketing) | Reclaims the rest of the most valuable free real estate in the SERP | `src/i18n/*.json` `pageDesc.*`, docs front matter |
| **D3** | **Which support address is canonical** — `support@kasir.mu` or the personal Gmail currently in the Enterprise CTA? | Entity consistency + brand trust (**T8**) | `src/pages/[locale]/pricing.astro` |
| **D4** | **Real social profile URLs** — the footer's X, Instagram, Facebook and Telegram icons point at *the platforms' own homepages* (`https://x.com`, `https://www.instagram.com`, …), not at kasir.mu accounts. Only the Discord invite is real | Today they are dead ends for users, and they are the reason `sameAs` can only list Discord (**F2**) | `src/components/Footer.astro` |
| **D5** | **Diagram accessibility** — add `accTitle:` / `accDescription:` to the mermaid blocks (or accept `alt=""`) | Recovers diagram text for crawlers and screen readers (**T3**) | docs content, `astro.config.mjs` |
| **D6** | **Hosting behaviour** — a `301` instead of the platform's `307` for trailing slashes; a `www` → apex `301` if a `www` record is ever added; a server-side `302` for the root `/` locale handoff | Redirect strength, duplicate-host safety, root entry point (**T4, T5, O3**) | Cloudflare / `worker.ts` |
| **D7** | **`/docs/` hub depth** — 24 words of body copy on a page that is in the sitemap and is the doorway to 17 docs pages | Thin but *indexable* hub; worth 150–250 words of real orientation copy | `src/pages/[locale]/docs/index.astro` |
| **D8** | **Vertical/landing depth** — measured body copy: `/en/` 480 words, `/en/features/` 325, `/en/pricing/` 265, `/en/restaurant/` 251, `/en/warehouse/` 162, `/en/cafe/` 157, `/en/kasir-gratis/` 151, `/en/warung/` 146, `/en/minimarket/` 138, `/en/cara/` 132, `/en/download/` 132; 47 of 81 pages are under 300 words | These are the money pages for commercial queries and they compete against competitors' long-form pages. The copy that exists is good and specific — there is just not much of it | `src/i18n/*.json` `vertical.*`, `landing.*` |
| **D9** | **Whether `FAQPage` blocks stay** (weak rich-result bet, useful to AI answer engines) | Effort/benefit call | `support.astro`, `cara.astro`, `LandingPage.astro` |
| **D10** | **Deployment** — none of this pass is live | The live site still serves the invalid `Offer.price`, the indexable `/signup/`, etc. | `website/` → `npm run deploy` (explicitly authorised step) |

---

## 6. Content assessment (keyword targeting & duplication)

**Targeting is deliberate and decent.** The site covers the commercial intent funnel rather than only
brand terms: head terms (`/en/features/`, `/en/pricing/`), price-qualified terms
(`/en/kasir-gratis/` "Free POS App for Warung, Cafes, and Shops", `/en/kasir-murah/`,
`/id/kasir-qris/`), device terms (`/en/aplikasi-kasir-android/`), vertical terms
(`/en/cafe/`, `/en/restaurant/`, `/en/warung/`, `/en/minimarket/`, `/en/warehouse/`), a comparison
page (`/en/perbandingan/`) and how-to content (`/en/cara/`). The `id` locale targets Indonesian
phrases (`Aplikasi Kasir Gratis`, `Kasir QRIS`) rather than translating the English keywords
literally, which is the right call. H1s, titles and descriptions reinforce each page's term, and the
comparison page names its competitors (Moka, Majoo, Olsera, Qasir, Pawoon) — the highest-value
content on the site for "vs" queries.

**Duplication risk is low and handled.** The two locales are properly separated by `hreflang` with
`x-default` pointing at the `id` variant; the five vertical pages share one layout but carry distinct
per-vertical copy; no two pages share a title or a description. The one genuinely duplicated block is
the "Compatible with Standard POS Hardware" panel plus the closing cross-link block, identical on all
five vertical pages (`src/components/VerticalLanding.astro`) — boilerplate, not a defect, and worth
rewording per vertical only if **D8** is picked up anyway.

**Depth is the gap.** The thinnest indexable pages are `/en/docs/` (24 words, **D7**) and the
vertical/conversion pages at 130–200 words (**D8**); the docs pages themselves are appropriately
focused and should not be padded.

---

## 7. Verification

| Check | Command | Result |
|---|---|---|
| Full gate (i18n audit + password policy + vitest + `astro check`) | `cd website && npm run check` | **exit 0**, 0 errors, 152 files |
| Production build | `cd website && npm run build` | **exit 0**, 81 HTML files |
| Internal links | `cd website && npm run check:links` | `NO BROKEN INTERNAL LINKS` (86 pages checked) |
| Asset budget / orphan rule | `python3 scripts/verify-website-assets.py` | exit 0, orphan rule active |
| New unit tests | `npx vitest run src/lib/__tests__/schema-price.test.ts src/__tests__/seo-head-invariants.test.ts src/__tests__/sitemap-options.test.ts` | 28 passed |

Build-output invariants after the fixes (measured over the 81 built pages):

| Metric | Before | After |
|---|---|---|
| Duplicate titles / descriptions | 0 / 0 | **0 / 0** |
| Pages with a heading-level skip | 2 (both pricing locales) | **0** |
| Pages with no `H1` | 2 (`/` and the noindexed admin page) | **1** (the root stub — **O3**) |
| JSON-LD blocks on the pricing page with invalid `Offer.price` | 4 of 5 | **0** (4 numeric offers, quote-only tier omitted) |
| `Organization.sameAs` self-reference | present | **absent** |
| Pages emitting `og:image:alt` | 0 | **all** |
| `/docs/` pages with the `llms.txt` discovery link | 0 | **all** |
| `/signup/` URLs in the sitemap | 2 | **0** |
| Sitemap URLs | 74 | **72** (all with `<lastmod>` and `x-default`) |
| `hreflang` targets not present in the build | 0 | **0** |

**New guards** (so the fixed findings cannot regress silently):
`src/lib/__tests__/schema-price.test.ts` (conversion, read against the real pricing content),
`src/__tests__/seo-head-invariants.test.ts` (image alts, `sameAs`, docs discovery, heading levels,
mobile wrapping, numeric offers, signup `noindex`), and `src/__tests__/sitemap-options.test.ts`
extended to the full gated-page set.

### To re-measure

```bash
cd website && npm run build
# titles, descriptions, H1 count, heading skips, canonical, JSON-LD validity, orphaning:
node -e "…"   # the audit passes in this review were one-off scripts over dist/**/index.html
python3 ../scripts/verify-website-assets.py
npm run check:links
```

### Follow-up housekeeping

`docs/records/README.md` is the generated index for this directory and **currently carries another
session's uncommitted edits**, so this record is not entered in it. Run
`node scripts/generate-records-index.mjs` to add it once that file is clean — the index is not gated,
so nothing fails in the meantime.
