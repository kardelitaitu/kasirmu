# SEO audit — kasir.mu marketing site (on-page, technical, content)

**Date:** 2026-09-19 · **HEAD at audit:** `4d5e32cbf` · **Scope:** `website/` — the Astro 7 static
marketing site (81 built pages, `https://kasir.mu`), its Worker (`worker.ts`), headers, sitemap,
and the Social/schema head of both layouts.
**Method:** every number below is measured from the built output (`website/dist`) or the live host,
not read off the source. Re-run recipe in §7.

> **Status: 11 findings fixed** — F1–F9 (§1) plus **O4** and **T1** (§3/§4). All of it is **committed
> and deployed to production** and re-verified against the live host rather than the deploy log — see
> §7 for the versions and the observed values. **10 items remain for a decision** (§5); each needs
> copy, brand, or hosting input — or a deliberate medium-risk code change (**D11**) — not a quick edit. Every finding in §3 and §4 carries its location, why it
> hurts, the concrete fix, and a high/medium/low impact rating.
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
3. **A page that ships its dictionary to the browser.** Every page with a React island paid **55 KB
   (gzip) of React renderer**, and the island pages with translated copy a further **19 KB
   (gzip) for the complete `en` + `id` dictionary** — for the handful of keys the island reads.

All three are fixed, the third last and most expensively: the islands now receive their strings as
props and the homepage no longer loads React at all, which took `/en/` from 68.2 to **6.3 KB gzip**
(§7). What is left is content depth and the hosting/architecture calls in §5.

---

## 1. Fixed in this pass

| # | Finding | Location | Impact | Verification |
|---|---|---|---|---|
| **F1** | `Offer.price` emitted display strings (`"$0"`, `"$4.99"`, `"Custom"` / `"Kustom"`) — invalid per schema.org, so the `Product` rich result is discarded | `src/pages/[locale]/pricing.astro`, new `src/lib/schema-price.ts` | **High** | offers now `0 / 4.99 / 9.99 / 39.99` (USD) and `0 / 49000 / 99000 / 399000` (IDR); the quote-only Enterprise tier is omitted rather than emitted as `"Custom"` |
| **F2** | `Organization.sameAs` was `["https://kasir.mu"]` — a self-reference, the one value that can never be a valid `sameAs` target | `src/layouts/Base.astro` | **Medium** | now `["https://discord.gg/NdWDgEzNxx"]`, the only profile this project actually owns (see **D4**) |
| **F3** | Pricing page jumped **h1 → h3** (plan names were `h3` with no `h2` above them) | `src/components/PricingGrid.tsx` | **Medium** | heading sequence `h1 h2 h2 h2 h2 h2`; heading-level skips site-wide **2 → 0** |
| **F4** | The Features page's comparison section had **no heading at all**; `features.comparisonTitle` existed in both dicts and was rendered nowhere | `src/pages/[locale]/features.astro` | **Medium** | section now leads with `<h2>kasir.mu vs Conventional Cloud POS</h2>` — the exact query the section answers |
| **F5** | The comparison subtitle (98 chars) carried a no-wrap utility, so on a phone the line overflowed its own box — **722 px of text in a 288 px box at 320 px wide** | `src/pages/[locale]/features.astro` | **Medium** | utility removed; text wraps. **Corrected 2026-09-19 after rendering it in Chromium (§7):** there was never a *scrollbar* — `body` carries `overflow-x: clip` (`src/styles/global.css`, pre-existing, there for the parked carousel slides), so the sentence was **clipped instead**: unreadable, but not scrollable. The fix stands; the original "horizontal scrollbar at every phone width" claim does not |
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

## 3. Findings — technical SEO

### T1 — Pages with a React island shipped 55 KB (gzip) of React, and translated islands another 19 KB (gzip) of dictionary · **fixed in this pass**

- **Impact:** was **High** — these are the LCP- and conversion-critical pages.
- **Location:** `website/src/i18n/index.ts` statically imports `en.json` and `id.json`, so any hydrated island that calls `t()` pulls both dictionaries — the consumers were `website/src/components/PricingGrid.tsx` and its siblings; the renderer cost was `website/src/components/HeroCarousel.tsx`, loaded by `website/src/pages/[locale]/index.astro`. <!-- dead-ref: ok: names the pre-rework renderer, since replaced by HeroCarousel.astro -->
- **Why it hurts:** 55–90 KB of gzip JS on top of a ~30 KB gzip document is the dominant INP/TBT cost on these pages, and on a mid-range Android phone it is most of the “time to interactive” budget.
- **Fix (applied 2026-09-19):** every island now receives the strings it reads as a `labels` prop built server-side by `labelMap`, and resolves them through the dictionary-free `website/src/i18n/labels.ts`; each island root exports its own key list (`PRICING_LABELS`, `AUTH_FORM_LABELS`, `ACCOUNT_LABELS`, …) so the keys have one owner, and `src/__tests__/island-label-coverage.test.ts` fails if a call site and its list drift apart or a dictionary creeps back into the client graph. The carousel became static markup (`HeroCarousel.astro`) plus `src/lib/hero-carousel.ts`, a 1.4 KB vanilla module with its own jsdom tests, so the homepage loads **no React at all**.
- **Measured result:** `/en/` and `/id/` **68.2 → 6.3 KB gzip**; every other island page **−18.7 to −19.0 KB gzip** (pricing 88.8 → 69.9, support 86.3 → 67.4, docs 88.8 → 69.8, login 90.3 → 71.6, signup 90.4 → 71.6, account 96.0 → 77.3); island-free pages unchanged at 6.3 KB. The strings now ride in the document instead — **+0.24 to +1.41 KB gzip** of island props per page.

**Evidence** — total blocking JS per page, gzipped, measured from the actual module graph (`component-url` +
`renderer-url` + each chunk's own imports):

| Page | JS gzip before | JS gzip after | What went away |
|---|---|---|---|
| `/en/`, `/id/` | **68.2 KB** | **6.3 KB** | React renderer (55 KB) + hydration runtime; the carousel is static markup now |
| `/en/pricing/`, `/id/pricing/` | **88.8 KB** | **69.9 KB** | the 19 KB dictionary |
| `/en/support/` | **86.3 KB** | **67.4 KB** | the 19 KB dictionary |
| `/en/docs/*` | **88.8 KB** | **69.8 KB** | the 19 KB dictionary (the search island) |
| `/en/login/`, `/en/signup/` | **90.3 / 90.4 KB** | **71.6 KB** | the 19 KB dictionary |
| `/en/account/` | **96.0 KB** | **77.3 KB** | the 19 KB dictionary |
| `/en/features/`, `/id/cafe/`, `/en/download/` (no island) | **6.3 KB** | **6.3 KB** | nothing — this is the floor: `ClientRouter` + `LocaleSwitcher` |

Two distinct wastes, both now closed:

1. **`website/src/i18n/index.ts` statically imported `en.json` and `id.json`**, so any hydrated
   component that calls `t()` pulled **both locales' entire dictionaries** — measured 58 KB raw /
   **19 KB gzip**, including all landing-page copy, FAQs and vertical feature lists — to read maybe
   five keys. `PricingGrid.tsx` was the clearest case: it already received `tiers` and `locale` as
   props and needed only `pricingPage.mostPopular` and `pricingPage.billing.*`. The dictionaries are
   now server-only (`index.ts` and its `labelMap`), and no production `.ts`/`.tsx` under `components/`
   or `lib/` imports one.
2. **The React renderer (55 KB gzip) was loaded on the homepage** so `HeroCarousel.tsx` could animate
   a CSS `transform` and five pill buttons. Its first slide was already static markup and the other
   four are placeholders, so the whole thing is static markup now: the built homepage contains **0**
   `astro-island` tags.

### T2 — HTML is never cacheable and carries the whole stylesheet on every page

- **Impact:** **Medium**.
- **Location:** `website/public/_headers` (`/*` → `Cache-Control: public, max-age=0, must-revalidate`) and `website/astro.config.mjs` (`build: { inlineStylesheets: 'always' }`).
- **Why it hurts:** `/en/` is 141.5 KB raw / **31 KB gzip**, and that inlined stylesheet is repeated in all 81 documents while every navigation revalidates — so repeat visits and back-navigation pay to re-render CSS they already downloaded.
- **Fix:** a `stale-while-revalidate` on HTML, or `inlineStylesheets: 'auto'` for the largest pages, recovers most of it.
- **Nuance worth keeping:** both choices are deliberate and documented (the inline CSS kills a documented FOUC regression; `max-age=0` makes deploys instantly visible), and the inline CSS removes a render-blocking request on first visit, so the first-visit cost is roughly neutral. This is a trade-off, not a defect — the comment in `_headers` that “HTML must never be cached” is the constraint to argue with, not a rule.

### T3 — Mermaid diagrams are invisible to crawlers and cost 165 KB of HTML

- **Impact:** **Medium**.
- **Location:** `website/astro.config.mjs` (`rehype-mermaid` with `strategy: 'img-svg'`); the affected diagrams are the fenced mermaid blocks under `website/src/content/docs/`, worst on `/en/docs/docs-authoring/`.
- **Why it hurts:** each diagram is emitted as `<img src="data:image/svg+xml,…" alt="">`, so its text — node labels like “Checkout”, “Paddle webhook”, “Lisensi ada?” — exists **only inside the image**, and the empty `alt` gives a crawler and a screen reader nothing. Measured: `/en/docs/docs-authoring/` is **164.7 KB raw**, the largest page on the site, almost entirely two base64 diagrams.
- **Fix:** mermaid's own `accTitle:` / `accDescription:` directives (or a `title` on the fenced block) give the image real alternative text, and `strategy: 'inline-svg'` puts the labels into the DOM as crawlable text while removing the base64 bloat. The content half of this is **D5**.

### T4 — Trailing-slash requests get a `307`, not a `301`

- **Impact:** **Low**.
- **Location:** platform behaviour, not code (Cloudflare trailing-slash normalisation); `website/public/_redirects` is empty and correctly so — there are no legacy URLs to migrate.
- **Why it hurts:** measured in the previous review, `/id/pricing` → `307` → `/id/pricing/`. A temporary redirect passes no ranking signal and does not consolidate; a permanent one does. Every canonical form on this site carries the trailing slash, so this is the only redirect class in play.
- **Fix (hosting — D6):** serve that normalisation as a `301`.

### T5 — `www.kasir.mu` resolves to nothing

- **Impact:** **Low**.
- **Location:** DNS / hosting — `kasir.mu` has no `www` record.
- **Why it hurts:** measured, `https://www.kasir.mu/` times out with zero bytes and `nslookup` returns no record. That is *fine for SEO* — no duplicate host, no split authority — but it means there is nothing catching a `www` link, so one appearing externally dead-ends for both users and crawlers.
- **Fix (hosting — D6):** if a `www` record is ever added, redirect it to the apex with a `301` in the same change.

### T6 — `llms.txt` is Indonesian-only

- **Impact:** **Low** (informational — already a recorded decision).
- **Location:** `website/public/llms.txt` ships a single `id` document for both locales. <!-- dead-ref: ok: the audited file was retired; llms.txt is now a generated route (website/src/pages/llms.txt.ts) -->
- **Why it hurts:** an English-language answer engine reading `llms.txt` gets Indonesian prose. No ranking effect; a discoverability one for AI answer engines only.
- **Fix:** none — recorded as deliberate in the previous review (§6, L5), so this stays a decision rather than an oversight.

### T7 — `FAQPage` markup is now a weak rich-result bet

- **Impact:** **Low** (informational).
- **Location:** the `FAQPage` JSON-LD in `website/src/pages/[locale]/support.astro`, `website/src/pages/[locale]/cara.astro` and `website/src/components/LandingPage.astro`.
- **Why it hurts:** Google restricted FAQ rich results to authoritative government/health sites in 2023, so the blocks on `/support/`, `/cara/` and the four landing pages are unlikely to render as rich results at all.
- **Fix:** none — they remain valid and harmless (and are useful to AI answer engines), so keep them, but do not count them as a ranking lever.

### T8 — Two different support addresses in the same page

- **Impact:** **Low**.
- **Location:** `website/src/pages/[locale]/pricing.astro` (the Enterprise “contact us” CTA renders `mailto:adikaradwiatmaja@gmail.com`) against the site-wide `ContactPoint` in `website/src/layouts/Base.astro`, `website/src/components/Footer.astro` and `website/src/pages/[locale]/support.astro` (`support@kasir.mu`).
- **Why it hurts:** a personal Gmail address on a commercial pricing page undercuts the brand and the entity signals the rest of the site builds.
- **Fix:** a decision rather than code — choose the canonical address (**D3**), after which it is a one-string change.

---

## 4. Findings — on-page

### O1 — Seven titles exceed 60 characters

- **Impact:** **Medium**.
- **Location:** the seven `pageTitle.*` keys in `website/src/i18n/en.json` + `website/src/i18n/id.json` (subtitle half only — the `kasir.mu — ` prefix costs 11 characters of the budget).
- **Why it hurts:** Google rewrites and truncates titles past ~60 characters, so the discriminating tail — the part carrying the keyword — is the part that disappears.
- **Fix (copy — **D1** decides whether the brand should lead at all):** shorten the subtitle half of those seven titles.

Measured (rendered length):

| URL | len | Title |
|---|---|---|
| `/id/restaurant/` | 68 | `kasir.mu — Aplikasi Kasir Restoran: Dapur, Meja & QRIS Tetap Sinkron` |
| `/id/cafe/` | 66 | `kasir.mu — Aplikasi Kasir Kafe: Pesanan, Dapur & QRIS Tetap Lancar` |
| `/id/aplikasi-kasir-android/` | 65 | `kasir.mu — Aplikasi Kasir Android & Tablet: Ringan untuk HP Murah` |
| `/en/aplikasi-kasir-android/` | 65 | `kasir.mu — Android & Tablet POS App: Lightweight for Cheap Phones` |
| `/id/kasir-murah/` | 65 | `kasir.mu — Aplikasi Kasir Murah: Mulai Rp0, Plus Rp49rb per Bulan` |
| `/id/kasir-gratis/` | 61 | `kasir.mu — Aplikasi Kasir Gratis untuk Warung, Kafe, dan Toko` |
| `/en/restaurant/` | 61 | `kasir.mu — Restaurant POS App: Kitchen, Tables & QRIS in Sync` |

### O2 — 72 meta descriptions fall short of the ~120-character mark

- **Impact:** **Medium**.
- **Location:** the `pageDesc.*` keys in `website/src/i18n/en.json` + `website/src/i18n/id.json` (27 marketing pages) and the `description:` front matter of `website/src/content/docs/**` (36 docs pages).
- **Why it hurts:** the description is the field that wins the click once the ranking is set, and 72 of 81 pages leave roughly a third of that snippet blank — including money pages.
- **Fix (copy — **D2**):** extend each to 120–160 characters that restates the page's target query.

Measured — every page has a description (a real strength) and **none is over-long** (0 of 81 exceed
160 characters), but 72 of 81 are under 120:

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

### O3 — The root `/` has no `H1`, no content, and redirects client-side

- **Impact:** **Medium**.
- **Location:** `website/src/pages/index.astro` — a deliberate locale-detect stub whose inline script calls `window.location.replace()` to `/id/` or `/en/`, with a `<noscript>` meta-refresh fallback; the fix itself belongs in `website/worker.ts`.
- **Why it hurts:** the stub has a title, description, canonical (→ `/id/`) and correct `hreflang`, but an **empty `<body>`** — so no `H1` and no crawlable content. It is excluded from the sitemap and canonicalises to `/id/`, so Google should consolidate it; but `/` is the strongest URL in the domain's history and the one external links are most likely to point at, and it currently depends on the crawler rendering JS to reach real content.
- **Fix (code-side, deliberate — D11):** a server-side `302` on the Worker for `/` — a route `worker.ts` does not handle today — based on `Accept-Language` with a `Vary: Accept-Language`, makes the entry point a real redirect instead of a JS handoff. Rated medium impact, medium risk: the `Vary` interacts with the edge cache key, and the current stub already works for users and for a JS-rendering Googlebot. A cheaper stopgap is a `<noscript>` block with an `H1` and links to both locales — not applied, because it only helps non-JS agents and adds no crawl benefit for Googlebot.

### O4 — The 404 page declared the wrong `lang` · **fixed in this pass**

- **Impact:** **Low** — a 404 is not indexed, but the document lied about its own language.
- **Location:** `website/src/pages/404.astro` (hard-codes `const locale = 'en'` for its copy) and `website/src/layouts/Base.astro` (derived `<html lang>` from `Astro.currentLocale`, which for the locale-less `/404` is the site default `id`).
- **Why it hurts:** the page rendered **`<html lang="id">` around English text** (and `og:locale = id_ID`) — a document misreporting its language to screen readers, translation tooling and search engines (WCAG 3.1.1). Confirmed live before the fix: HTTP **404**, `<html lang="id">`, `<h1>Page not found</h1>`.
- **Fix (applied, commit `138a77c46`):** `Base.astro` takes an optional `locale` prop that overrides `Astro.currentLocale`, and only `404.astro` passes it (`locale={locale}`, `en`) — so no other page's `lang` can change. Verified over all 81 built pages: the 40 `en` and 40 `id` documents and the root stub are **byte-identical** to before, and the 404 now emits `lang="en"` / `og:locale = en_US`. Live re-check in §7.

### O5 — Brand-first title pattern

- **Impact:** **Low** (informational — a positioning call).
- **Location:** all 81 `pageTitle.*` strings in `website/src/i18n/en.json` + `website/src/i18n/id.json` (every title is `kasir.mu — <page>`).
- **Why it hurts:** brand-first trades keyword prominence for brand recognition, and for a brand this young the keyword is usually the better first characters.
- **Fix:** none applied — it is a positioning call and consistency across 81 pages has real value (**D1**).

---

## 5. Necessarily deferred — content & hosting decisions

None of these can be resolved by a low-risk, high-impact code edit; each needs a decision or copy. D11 is the one code-side item — listed here because the change is deliberate (cache/`Vary` interaction), not because it needs new infrastructure.

| # | Decision needed | Why it matters | Where |
|---|---|---|---|
| **D1** | **Title strategy** — keep `kasir.mu — <keyword>` or move to `<keyword> \| kasir.mu`? | Sets whether O1 is fixed by trimming the tail or by moving the brand to the end | 81 titles |
| **D2** | **Description copy pass** — 63 indexable pages carry a description under 120 chars (36 docs + 27 marketing) | Reclaims the rest of the most valuable free real estate in the SERP | `src/i18n/*.json` `pageDesc.*`, docs front matter |
| **D3** | **Which support address is canonical** — `support@kasir.mu` or the personal Gmail currently in the Enterprise CTA? | Entity consistency + brand trust (**T8**) | `src/pages/[locale]/pricing.astro` |
| **D4** | **Real social profile URLs** — the footer's X, Instagram, Facebook and Telegram icons point at *the platforms' own homepages* (`https://x.com`, `https://www.instagram.com`, …), not at kasir.mu accounts. Only the Discord invite is real | Today they are dead ends for users, and they are the reason `sameAs` can only list Discord (**F2**) | `src/components/Footer.astro` |
| **D5** | **Diagram accessibility** — add `accTitle:` / `accDescription:` to the mermaid blocks (or accept `alt=""`) | Recovers diagram text for crawlers and screen readers (**T3**) | docs content, `astro.config.mjs` |
| **D6** | **Hosting behaviour** — a `301` instead of the platform's `307` for trailing slashes; a `www` → apex `301` if a `www` record is ever added | Redirect strength, duplicate-host safety (**T4, T5**) | Cloudflare |
| **D7** | **`/docs/` hub depth** — 24 words of body copy on a page that is in the sitemap and is the doorway to 17 docs pages | Thin but *indexable* hub; worth 150–250 words of real orientation copy | `src/pages/[locale]/docs/index.astro` |
| **D8** | **Vertical/landing depth** — measured body copy: `/en/` 480 words, `/en/features/` 325, `/en/pricing/` 265, `/en/restaurant/` 251, `/en/warehouse/` 162, `/en/cafe/` 157, `/en/kasir-gratis/` 151, `/en/warung/` 146, `/en/minimarket/` 138, `/en/cara/` 132, `/en/download/` 132; 47 of 81 pages are under 300 words | These are the money pages for commercial queries and they compete against competitors' long-form pages. The copy that exists is good and specific — there is just not much of it | `src/i18n/*.json` `vertical.*`, `landing.*` |
| **D9** | **Whether `FAQPage` blocks stay** (weak rich-result bet, useful to AI answer engines) | Effort/benefit call | `support.astro`, `cara.astro`, `LandingPage.astro` |
| **D11** | **Root `/` locale handoff** — keep the client-side JS redirect or replace it with a server-side `302` on the Worker (`Accept-Language` + `Vary`) | Code-side option, not hosting: `worker.ts` has no `/` route today; makes the entry point a real redirect (**O3**). Medium impact, medium risk — the `Vary` interacts with the edge cache key | `worker.ts` |

**D10 — resolved.** Both passes are deployed and live-verified — `bash scripts/wrangler-deploy.sh`
(Worker `oz-pos`): version `1b9f4bd3-a793-4a7f-85b4-1a3fc8270f45` from commit `138a77c46` (the
`404`/SEO pass), then version `bb17ba9a-2645-4d9b-96d2-177b97a4d35f` from commit `c688c55d9` (the
island payload). Observed values in §7.

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

Rows marked † record the state at the pass that introduced them and are kept as history — later passes
re-ran the same gates (most recently: 156 files checked, 854 tests, 86 pages, build clean; see the
single-ownership section at the end). Page counts differ by design: **81** is the Astro-built pages,
**86** is everything served from `dist/` (81 + `404.html`, the two `admin/*.html`, the two `dev/`
prototypes).

| Check | Command | Result |
|---|---|---|
| Full gate (i18n audit + password policy + vitest + `astro check`) | `cd website && npm run check` | **exit 0**, 0 errors, 152 files † |
| Production build | `cd website && npm run build` | **exit 0**, 81 HTML files † |
| Internal links | `cd website && npm run check:links` | `NO BROKEN INTERNAL LINKS` (86 pages checked) |
| Asset budget / orphan rule | `python3 scripts/verify-website-assets.py` | exit 0, orphan rule active |
| New unit tests | `npx vitest run src/lib/__tests__/schema-price.test.ts src/__tests__/seo-head-invariants.test.ts src/__tests__/sitemap-options.test.ts src/lib/__tests__/hero-carousel.test.ts src/__tests__/hero-carousel-contract.test.ts src/__tests__/island-label-coverage.test.ts` | 55 passed † |
| Whole suite | `npx vitest run` | **839 passed** (48 files) † |
| 404 `lang` fix introduced no other page change † | diff of all 81 built documents before/after | 40 `en` + 40 `id` documents and the root stub **byte-identical**; only `404.html` changed |
| Island refactor changed no visible copy † | visible text of all 86 built pages, before vs after (`scripts` under §7 “how the two refactors were measured”) | **identical on every page**, 0 characters differ |
| Island refactor removed the renderer from the homepage † | `grep -c '<astro-island' dist/en/index.html` | **0** (was 1) |
| Rendered in Chromium (`playwright` 1.61.1) | `.tmp-browser-check.mjs` → local `dist` over HTTP, 320/360/390 px + 1280 px | no horizontal overflow; carousel verified by interaction (below) |

### How the two refactors were measured

**Payload.** Total blocking JS per page, gzipped, resolved through the real module graph — the
`/_astro/*.js` references in the built HTML, plus each chunk's own `import` specifiers, transitively —
run against the tree before the change and after it. Results in §3 T1. The strings the islands now
receive ride in the document instead: measured +0.24 KB gzip (`/en/docs/`, a 4-key map) to +1.41 KB
(`/en/account/`, 65 keys), leaving each island page **≈17.5 KB gzip lighter** than before.

**Copy.** Because a missing label renders as the raw key text (`t(labels, key)` falls back to the key),
the strongest available check is the rendered output itself: the visible text of all 86 built pages was
extracted (`<script>`/`<style>` and tags stripped, whitespace collapsed) before and after the change and
diffed character by character. **Zero pages differ.** That covers both locales, every island, and the
fourteen test fixtures updated for the new prop.

### Browser evidence — Chromium, not source reading

Both claims below were re-tested in a real engine (Playwright 1.61.1, Chromium) against the built site,
because the audit's original F5 claim was made from source alone:

| Claim | What Chromium observed |
|---|---|
| **F5 — phones had a horizontal scrollbar** (`/en/features/`, 320 / 360 / 390 px) | `documentElement.scrollWidth == clientWidth` at all three widths: **overflow 0 px, today and before the fix**. The utility really did make the text unreadable — with `white-space: nowrap` restored, the subtitle's own box reports **722 px of text in a 288 px box** (320 px viewport) — but an ancestor clips it: `body { overflow-x: hidden; overflow-x: clip }` in `src/styles/global.css` (pre-existing, documented there for the carousel's parked slides). So the copy was **clipped, never scrollable**. F5's fix stands; its “scrollbar” framing does not |
| **The carousel still behaves** (`/en/`) | 5 slides, 5 pills, slide 1 current with `translateX(-0%)` and a 700 ms transition; clicking pill 4 → `aria-current` on pill 4, `translateX(-300%)`, 400 ms transition, `aria-hidden` moved to slide 4; hovering the pill bar for 11 s → still slide 1 (paused); leaving it and waiting 11 s → slide 2 (`retail`), i.e. auto-advance resumed |

### Live verification after the deploy

Every value below was fetched from the live host with `Cache-Control: no-cache` — an edge-cached copy
served a stale `/en/signup/` for the first probe after the previous deploy, so no row here trusts a
plain request or the deploy log.

| # | Check | Observed |
|---|---|---|
| **A** | 404 document language matches its copy | `https://kasir.mu/definitely-missing-9f3a-verify/` → **HTTP 404**, `<html lang="en">`, `<title>404 — kasir.mu</title>`, `og:locale = en_US`, `<h1>Page not found</h1>`, and the body's `sha256` (`af574503a83548c9…`) is **identical to `website/dist/404.html`**, so the live page is the committed artifact. The same URL returned **`lang="id"`** before this pass |
| **B** | Pricing offers numeric | `/en/pricing/` → Free **0**, Plus **4.99**, Pro **9.99**, Premium **39.99**, all `typeof number`, `USD`, with `Product.url` and `image` present, Enterprise omitted. `/id/pricing/` → Gratis **0**, Plus **49000**, Pro **99000**, Premium **399000**, `IDR` |
| **C** | Signup still `noindex` | `/en/signup/` and `/id/signup/` both **HTTP 200** with `<meta name="robots" content="noindex">` |
| **D** | Sitemap | `sitemap-0.xml` **HTTP 200**, `application/xml`, 25,910 bytes — **72 `<loc>`, 72 `<lastmod>`, 72 `x-default`, 0 occurrences of `signup`** |
| **E** | `robots.txt` | **HTTP 200**, `text/plain`, 1,192 bytes — `User-agent: *`, `Allow: /`, `Disallow: /__oz/`, `Sitemap: https://kasir.mu/sitemap-index.xml` |
| **F** | Checkout did not regress | The build-time Paddle token is still in the live bundle: `/_astro/midtrans.Dpvf2sGA.js` carries a `test_`-prefixed 32-character token whose `sha256` (`3f7d7c75f2a5…`) matches the repo's `PUBLIC_PADDLE_CLIENT_TOKEN` exactly |
| **G** | Subdomain routes reissued by the deploy | Probed before and after, since redeploying the Worker also reissues its triggers: `admin.kasir.mu/` → **200**, `lang="en"`, `kasir.mu Admin — Sign in`, 3,751 bytes **identical**; `dashboard.kasir.mu/` → **1 redirect** → `https://kasir.mu/en/account/` → **200**, `lang="en"`, `kasir.mu — Account`, 105,946 bytes **identical**. No change on either host |

### Live verification after the island refactor (version `bb17ba9a-…`)

Same discipline: Chromium against `https://kasir.mu` and `Cache-Control: no-cache` fetches, not the
deploy log.

| # | Check | Observed |
|---|---|---|
| **H** | JS actually downloaded per page | `performance.getEntriesByType('resource')` script entries plus inline `<script>` bytes: `/en/` and `/id/` **6.8 KB** external JS with **0** `astro-island` elements (the no-island floor is also 6.8 KB, `/en/features/`); island pages **70.1 KB** (`/en/support/`), 72.4 (`/en/docs/welcome/`), 72.5 (`/en/pricing/`), 74.4 (`/en/signup/`), 74.5 (`/en/login/`), **81.0** (`/en/account/`) — all ≈18–19 KB below the same pages before |
| **I** | The carousel, on the live homepage | 5 slides / 5 pills; slide 1 current with `translateX(-0%)` and a 700 ms transition; clicking pill 4 → `translateX(-300%)` in 400 ms with `aria-current` and `aria-hidden` moved to slide 4; hovering the pill bar for 11 s → **no advance**; leaving it → slide 2 (`retail`) after the dwell, i.e. auto-advance resumed |
| **J** | F5, on the live host | `/en/features/` at 320 / 360 / 390 px: `scrollWidth == clientWidth`, **0 px** overflow at all three; the comparison subtitle computes `white-space: normal` |
| **K** | No copy changed | Visible text of all **84** live pages is identical to the pre-refactor live site, and identical again to the local build afterwards — the chain old-live = new-build = new-live holds character for character |
| **L** | Nothing else regressed | `/en/signup/` + `/id/signup/` still `noindex`; sitemap still 72 `<loc>` / 72 `<lastmod>` / 0 `signup`; offers still numeric (`0/4.99/9.99/39.99` USD, `0/49000/99000/399000` IDR); `robots.txt` 200 `text/plain`; the 404 still `lang="en"`; the checkout token still present in the live `/_astro/midtrans.Dpvf2sGA.js` (`sha256 3f7d7c75f2a5…`, matching `.env`) |
| **M** | Subdomain routes | `admin.kasir.mu/` **unchanged** (200, 3,751 bytes). `dashboard.kasir.mu/` still one redirect → `kasir.mu/en/account/` (200) — but its document went **105,946 → 111,564 bytes**: that is the account island now carrying its 65 strings as props instead of downloading them, i.e. the intended trade, visible on the one route that renders it |

**Deploy note (the trap that costs the most).** `dist/` can be fresh by timestamp and still be the
wrong artifact: a build made *without* `PUBLIC_PADDLE_CLIENT_TOKEN` / `PUBLIC_PADDLE_ENVIRONMENT` in
the environment produces a site with no checkout, and deploying it removes checkout silently.
`scripts/wrangler-deploy.sh` rebuilds with those variables, so `.env` must be sourced before calling
it — check **F** is the guard that proves it worked. The second trap is the edge: the first probe
after a deploy can still be the previous version, which is why every row above sends
`Cache-Control: no-cache`.

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
mobile wrapping, numeric offers, signup `noindex`),
`src/__tests__/sitemap-options.test.ts` extended to the full gated-page set, and two for the island
payload: `src/__tests__/island-label-coverage.test.ts` (every key an island reads is declared in its
own list, every declared key resolves in both locales, and no production `.ts`/`.tsx` under
`components/` or `lib/` imports a dictionary) and `src/__tests__/hero-carousel-contract.test.ts`
(the carousel is not a hydrated island, the three React mockups stay deleted, and the Astro markup
keeps the `data-` hooks the behaviour module queries). The carousel's own behaviour moved with it:
`src/lib/__tests__/hero-carousel.test.ts` (jsdom) covers advance, wrap, jump, dwell reset, hover-pause
and dispose.

### To re-measure

```bash
cd website && npm run build
# titles, descriptions, H1 count, heading skips, canonical, JSON-LD validity, orphaning:
node -e "…"   # the audit passes in this review were one-off scripts over dist/**/index.html
python3 ../scripts/verify-website-assets.py
npm run check:links
```

Client JS per page (the T1 numbers): walk the built HTML for `/_astro/*.js` references, follow every
`import` inside those chunks transitively, and gzip each module — 30 lines of Node, no dependencies;
the same script run before and after is what produced the before/after column. Rendered checks
(F5, the carousel) need a real engine: `website` depends on `playwright`, so a throwaway script can
serve `dist/` over loopback and drive Chromium at any viewport — that is how the F5 claim above was
settled and how the carousel was exercised end to end.

### Single-ownership pass — one head, one de-index list (version `0176d238-…`)

The audit's own DESIGN findings were structural: the `<head>` existed in three hand-synced copies and
"which pages are de-indexed" in four. Both consolidations are now in place, **proven output-identical**:

- **`src/components/SiteHead.astro`** owns the shared head (canonical, hreflang + x-default, OG/Twitter
  cards, theme script, sitemap/describedby/icon links, runtime-config). `Base.astro` and
  `DocsLayout.astro` now render it; each keeps only its own JSON-LD in a slot. Two latent bugs fixed by
  the move: the docs theme script read only the legacy `oz_theme` key (Base had migrated to
  `kasirmu_theme`), and docs pages now also get the Cloudflare-insights `preconnect` (Base had it, docs
  didn't). Docs pages also stop requesting `/__oz/runtime-config.js` — the one island they hydrate
  (the header search trigger) never imported it, so the request was pure overhead there.
- **`src/lib/site.ts`** owns `SITE` + `NON_PUBLIC_PAGES`; the sitemap filter, the four gated pages'
  `noindex` (via `isNonPublic`), and `llms.txt`'s page list (`llms-pages.ts` re-exports it) all derive
  from that one array. This also fixed **real drift**: `llms.txt` advertised `/id/signup/` while the
  sitemap excluded it and the page is `noindex` — the exact self-contradiction class this audit named.
  Sitemap output is unchanged (72 URLs, verified byte-set-equal to live); the `llms.txt` signup line is
  gone. Docs pages stop requesting `/__oz/runtime-config.js`: they hydrate only the header search
  island (`SearchTrigger`, Header.astro), whose chunks never imported runtime-config — so the request
  was pure overhead there, unlike on the checkout/auth islands that read it at hydration time.
- **Proof:** normalized tag-by-tag head comparison (comments/whitespace stripped, chunk hashes
  normalized) of all built pages against the live pre-refactor host — every Base-layout page
  **identical**; docs pages differ only by the two intentional additions above; `admin/*.html` diffs are
  only the deploy-time `{{VERSION}}` cache-bust stamps. All gates re-run green (854 tests, check/links/
  assets/build). <!-- dead-ref: ok: wrapped fragment of the gates list above ("check/links/ assets/build"), not a path -->

### Follow-up housekeeping
