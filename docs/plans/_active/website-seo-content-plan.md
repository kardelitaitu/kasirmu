# Website SEO — content & coverage plan

<!-- Audit stamp: 2026-09-24 · BK (Budak Korporat) · status: MEASURED AT HEAD 9101184ca ·
Every number below was produced by a full `npm run build` (89 HTML files) plus
`npm run check:seo` and two ad-hoc walkers over `dist/` and `src/`. Nothing here is
estimated. Scope chosen by the owner on 2026-09-24: (A) new informational content,
(B) the technical/hosting leftovers. Deliberately out of scope: deepening the
existing commercial pages and the meta-description copy pass. -->

**Status: IN PROGRESS.** Phases 1–2 are implemented and committed (2026-09-24)
and the first Tier 1 article is live; the rulings that unblocked them are in §7a.
Next: §3.1 (the Search Console query export), which re-orders the remaining
eleven article targets — articles 2–12 are drafts, not facts, until it lands.

---

## 7a. Rulings taken (owner, 2026-09-24)

| # | Ruling | Consequence |
|---|---|---|
| **R1** | `/id/panduan/`, `/en/guides/` — the segment is translated | The two locales do NOT share a path, so `SiteHead` gained an `alternatePaths` prop: without it the hreflang arm would point `/id/panduan/x/` at a nonexistent `/en/panduan/x/` and fail the reciprocity check |
| **R2** | Guides are drafted in **both** locales together | Twice the copy per article; hreflang reciprocity is satisfiable on every guide |
| **R4** | `support@kasir.mu` everywhere; the X/Instagram/Facebook/Telegram icons are **removed** | Done in phase 1. `Organization.sameAs` still names only Discord — that is now true rather than a compromise |
| **R3** | Open — article 12 vs `/perbandingan/` | Blocks Tier 3 only |
| **R5** | Accepted implicitly ("let's do it") | — |

---

## 0. What the site already has, and why this plan is not a hygiene pass

The marketing site is the best-instrumented surface in this repo for on-page SEO.
`npm run check:seo` was run against a full build at HEAD and **all fourteen checks
pass on 89 pages**:

```
pages checked: 89 (1 404, 4 static headless, 48 content, 34 docs article,
                   1 root stub, 1 standalone pair page) · sitemap urls: 72
  ok  page classes · canonical/og:url · hreflang · sitemap · noindex
  ok  structured data · titles · locale copy · docs next step · retired brand
  ok  content depth · headings · accessibility · script controls
SEO/HEAD OK
```

Canonical/og:url agreement, hreflang reciprocity, sitemap⇄build agreement in both
directions, noindex discipline, JSON-LD validity, unique titles inside a 60-char
budget, one h1 and no skipped level on every page — all enforced, all green.

**Therefore: there is nothing to gain from another hygiene pass.** The gates are
green and they are the kind of gate that stays green. What they cannot see is the
question this plan is about: *does anything on this site compete for a query a
real Indonesian buyer types?*

---

## 1. The measured position

### 1.1 Content depth on the pages that are indexed

Rendered `<main>` word counts, indexable locale pages, ascending (72 pages):

| Words | Pages |
|---|---|
| 21–24 | `/id/docs/`, `/en/docs/` — the docs hub |
| 130–177 | `/cara/`, `/download/`, `/perbandingan/` (both locales) |
| 230–291 | `/aplikasi-kasir-android/`, `/support/`, `/kasir-murah/`, `/kasir-qris/`, `/kasir-gratis/` (id) |
| 300+ | the five vertical landings, `/features/`, `/pricing/`, the docs articles |

18 of 72 indexable pages are under 300 words. The floors in `src/lib/landings.ts`
(320 words for the industry landings, 210 for the keyword landings) hold — the
vertical and keyword pages cleared their own deepen pass on 2026-09-23. The thin
pages are the ones **not** in that contract: the docs hub, `/cara/`,
`/download/`, `/perbandingan/`, `/support/`.

### 1.2 The internal link graph is flat

Inbound internal link count per indexable page, measured over the built HTML:

- every marketing page: **42–43 inbound**
- every docs article: **18–19 inbound**
- `/en/`, `/id/`: 44

Every page gets the same header + footer sitemap and nothing else. There is no
*editorial* internal linking on this site — no page links to another page because
the two are about the same thing. A uniform link graph distributes equity evenly,
which is the same statement as: no equity is directed anywhere.

### 1.3 There is no informational content at all

`src/content.config.ts` defines two collections: `docs` (34 files, 17 per locale)
and `legal`. There is no blog, no guide, no editorial collection. The site's
entire indexable surface is: 9 commercial landing pages, 5 product/utility pages,
2 hubs, 34 product-documentation articles, 2 legal pages — per locale.

Nothing on the site addresses a question a buyer asks *before* they know they want
a POS.

### 1.4 Measured SERP reality (2026-09-24)

Searches run today for the commercial-investigation terms in this market return
**listicles and blog posts, and no kasir.mu page in any result**:

| Query | Who occupies the SERP |
|---|---|
| `aplikasi kasir terbaik untuk UMKM Indonesia perbandingan` | inticore.co.id, kostpos.com, rebill-pos.com, paper.id, qasio.id |
| `aplikasi kasir gratis android pilihan warung toko kecil` | ezeelink.co.id, bisnika.id, aplikasiandroid.com, posfoo.com |
| `aplikasi kasir offline tanpa internet warung toko` | bee.id, ottodigital.id, kasirberes.com, flagodna.com, kasflo.id |

Three observations that decide the plan:

1. **These SERPs are won by editorial content, not by product pages.** No amount
   of deepening `/kasir-gratis/` enters the second query.
2. **The offline wedge is unclaimed by kasir.mu.** "Offline-first" is the
   product's actual differentiator; it has a docs page (363 words) and no page
   that competes for `aplikasi kasir offline`. Five competitor/affiliate sites
   hold that SERP today.
3. **The `/perbandingan/` page already names the competitors** (Moka, Majoo,
   Olsera, Qasir, Pawoon) — the right instinct, and it is 173–177 words, which is
   roughly a tenth of what the listicles that rank for "vs" queries publish.

---

## 2. Strategy

**Add an editorial layer that answers pre-purchase questions in Indonesian, and
wire it into the commercial pages so the traffic it earns has somewhere to go.**
Alongside it, close the technical leftovers that are decisions rather than code.

Two constraints shape everything below:

- **Copy is authored by the agent and reviewed by the owner** (ruling, 2026-09-24).
  The plan therefore produces briefs and drafts, not just tickets.
- **Search Console is verified and the owner can see query data.** The keyword
  list in §4 is a *provisional* order derived from SERP evidence; it is to be
  re-ordered against the owner's GSC query export before any article is drafted
  (§3.1). Volume figures are deliberately absent from this document — I have no
  tool that measures Indonesian search volume, and inventing one would be worse
  than omitting it.

---

## 3. Track A — the informational content layer

### A0. Get the query data first (half a day, blocks everything)

The owner exports, from Search Console, **last 3 months → Queries** (with clicks,
impressions, position) for `kasir.mu`, and the **Pages** report. I then:

1. Split queries into *brand* (contain "kasir.mu") and *non-brand*.
2. Identify impressions-without-clicks: queries where the site is seen and not
   chosen. These are the cheapest wins on the whole plan — usually a title and
   description problem on a page that already ranks.
3. Identify *striking distance* queries (position 8–30, non-brand). These decide
   which articles get drafted first.
4. Re-order §4 by measured impressions, keeping strategic fit as the tiebreak.

No article is drafted before step 3. A content engine pointed at the wrong
queries is the most expensive way to do nothing.

### A1. The collection

New Astro content collection `guides`, mirroring `docs` exactly in shape:

```
src/content/guides/{en,id}/<slug>.md     front matter: title, description,
                                         target (the query), commercialParent,
                                         updatedAt, locale
src/pages/[locale]/panduan/index.astro   hub  (id)   /  /en/guides/
src/pages/[locale]/panduan/[...slug].astro
```

Decisions the owner rules on (**R1**): the path segment — Indonesian `/panduan/`
against `/blog/` (competitors all use `/blog/`; `/panduan/` reads better and does
not promise a cadence the site may not keep). And **R2**: whether guides are
authored `id`-first and translated to `en`, or written once in `id` and left
untranslated behind an `en` stub. Untranslated pages are a real option — the
queries are Indonesian, and a thin English translation of each guide is
duplication risk for no measured demand. My recommendation is `id`-only until
GSC shows non-zero impressions from an English-speaking market.

### A2. Extend the gates before the first article ships

A new page class that no gate recognises is how this site's invariants rot.
Before article one merges:

| Gate | Change |
|---|---|
| `scripts/check-seo.mjs` | classify `guide` as its own page class (like `docs article`): require a `BreadcrumbList` + `Article` block, a body link to its declared `commercialParent` **in the reader's locale**, a word floor, and hreflang reciprocity |
| `scripts/sitemap-options.mjs` | guides are public and must be submitted; `lastmod` comes from front-matter `updatedAt`, not git (a guide is edited for accuracy, and the git date of the repo is not the date the advice changed) |
| `src/lib/landings.ts` | a parallel `GUIDE_CONTRACTS` floor — word count and required sections per guide |
| cannibalisation check | **new**: one `target` query per page, unique across the whole site, and no `target` may equal another page's H1 or `pageTitle`. The failure mode being prevented: a guide about offline POS competing with `/docs/offline-mode/` and with a future `/kasir-offline/` landing |
| `scripts/check-links.mjs` | unchanged — it already walks `dist/`, so guides are covered |

The cannibalisation check is the one genuinely new invariant here. Every other
row is the existing gate learning a new page class.

### A3. Internal linking: spokes into commercial pages

Each guide carries, in its body (not a footer template that every page shares):

- one link to its declared commercial parent (`/id/kasir-gratis/`, `/id/warung/`,
  `/id/pricing/`, …), enforced by the gate in A2;
- one contextual link to a sibling guide where the topic genuinely overlaps.

And in the other direction — the half that fixes the flat graph — each commercial
page gains a "Baca juga / Pelajari lebih lanjut" block listing the guides whose
`commercialParent` it is. This is the mechanism by which the flat 42-inbound
graph becomes a directed one, and it is the part most likely to be skipped.

### A4. llms.txt and the search index

`src/pages/llms.txt.ts` and the ⌘K index are derived from the `docs` collection.
Extend both to include guides, or guides are invisible to two surfaces that
already work. Recovery note: the ⌘K index is a client bundle — adding 12+
articles has a payload cost, so guides go into the index **by reference**
(title, description, url), not by body text.

---

## 4. The first twelve articles (provisional order — §3.1 re-orders this)

Grouped by why each one earns its place. "Parent" is the commercial page the
guide must link to in its body.

**Tier 1 — the offline wedge (the product's actual differentiator)**

| # | Working title (id) | Target query | Parent |
|---|---|---|---|
| 1 | Aplikasi kasir offline: tetap jualan saat internet mati | aplikasi kasir offline | `/id/kasir-gratis/` |
| 2 | Kenapa warung dan toko kecil butuh kasir yang tidak bergantung internet | aplikasi kasir tanpa internet | `/id/warung/` |
| 3 | Apa yang terjadi pada data penjualan saat listrik atau internet padam | kasir offline sinkronisasi data | `/id/features/` |

Evidence: five competitor sites hold this SERP (§1.4) and kasir.mu has no page
competing for it.

**Tier 2 — pre-purchase questions with commercial intent**

| # | Working title (id) | Target query | Parent |
|---|---|---|---|
| 4 | Cara memilih aplikasi kasir gratis yang tidak membatasi transaksi | aplikasi kasir gratis (tanpa batas transaksi) | `/id/kasir-gratis/` |
| 5 | Berapa biaya aplikasi kasir untuk warung? (hitung totalnya) | biaya aplikasi kasir / harga aplikasi kasir | `/id/kasir-murah/` |
| 6 | Cara pakai QRIS di kasir untuk warung dan toko | cara pakai QRIS di kasir | `/id/kasir-qris/` |
| 7 | Perangkat apa yang dibutuhkan toko untuk mulai pakai kasir? | perangkat kasir toko / hp untuk kasir | `/id/aplikasi-kasir-android/` |

**Tier 3 — operational how-to (top of funnel, highest long-tail volume)**

| # | Working title (id) | Target query | Parent |
|---|---|---|---|
| 8 | Cara membuat laporan penjualan harian toko | cara membuat laporan penjualan | `/id/features/` |
| 9 | Cara mengelola stok toko kelontong tanpa kehabisan barang | cara mengelola stok toko | `/id/minimarket/` |
| 10 | Cara mencatat penjualan kafe saat jam sibuk | cara kasir kafe / KDS | `/id/cafe/` |
| 11 | Cara hitung omzet dan laba harian usaha kecil | cara hitung omzet harian | `/id/pricing/` |
| 12 | Moka vs Majoo vs Olsera vs kasir.mu: perbandingan jujur 2026 | moka vs majoo / perbandingan aplikasi kasir | `/id/perbandingan/` |

Tier 3 is where the volume is and where the competition is heaviest. It is also
where the site's own product knowledge is the weakest argument for ranking —
these are won on usefulness, not on being a POS vendor. Recommended sequencing:
Tier 1, then Tier 2, then re-measure before committing to Tier 3.

**A decision the owner should take now (R3):** article 12 and the existing
`/perbandingan/` page would compete for the same "vs" queries. Either the guide
is the comparison page and `/perbandingan/` becomes a summary that links to it, or
`/perbandingan/` is deepened into that role and article 12 is dropped. Leaving
both is the cannibalisation case A2 exists to prevent.

---

## 5. Track B — technical and hosting leftovers

Each of these is open in `docs/audits/seo/seo-audit-19-09-26.md` (D3–D6, D11).
Status re-measured today at HEAD.

| # | Item | Measured now | Proposed action | Risk |
|---|---|---|---|---|
| **B1** | Root `/` locale handoff is a client-side `window.location.replace()`; empty `<body>` | `/index.html` built, canonical → `/id/`, excluded from sitemap, no h1 | Server-side `302` from `worker.ts` on `/`, keyed on `Accept-Language` + `Vary: Accept-Language` | **Medium.** `Vary` changes the edge cache key; the current stub already works for Googlebot (it renders JS). Lowest benefit-to-risk ratio on this list — my recommendation is *defer* unless GSC shows `/` with impressions |
| **B2** | Trailing-slash normalisation returns `307`, not `301` | platform behaviour, `_redirects` empty | Cloudflare rule: serve the normalisation as `301` | Low. Hosting-side, no code |
| **B3** | No `www` record | measured in the prior audit: `www.kasir.mu` times out | Add `www` → apex `301` **only if** a `www` record is added | Low. Not an SEO defect today — no split authority |
| **B4** | Mermaid diagrams ship as base64 `<img alt="">` | **4 mermaid blocks, 0 with `accTitle:`/`accDescription:`**; `/en/docs/docs-authoring/` is 176.9 KB raw, the heaviest content page on the site | Add `accTitle:`/`accDescription:` to the 4 blocks; evaluate `strategy: 'inline-svg'` | Low, but `inline-svg` changes build output — measure page weight after |
| **B5** | Pricing page Enterprise CTA uses a personal Gmail | `mailto:adikaradwiatmaja@gmail.com` still present at HEAD; the rest of the site uses `support@kasir.mu` | One-string change to `support@kasir.mu` — **needs the owner to rule which address is canonical** (R4) | None |
| **B6** | Footer social icons point at platform homepages | `https://x.com`, `https://www.instagram.com`, `https://www.facebook.com`, `https://telegram.org`; only the Discord invite is real | Either supply real profile URLs (which also lets `Organization.sameAs` name more than Discord) or remove the three dead icons | None. A brand/entity signal, not a ranking lever |
| **B7** | `Organization.sameAs` lists only Discord | `"sameAs": ["https://discord.gg/NdWDgEzNxx"]` in `Base.astro` | Resolved by B6 | — |

B5, B6 and B7 are together the whole of this site's entity/brand signal, and
they are one decision (R4) followed by about six string edits. That is the
cheapest row on the plan and it is worth doing first while the content work is
being drafted.

---

## 6. Sequencing

| Phase | Contents | Gate |
|---|---|---|
| **0** | GSC query export → re-order §4 (A0). Owner rules on R1–R4 | Article list signed off, with measured impressions attached to each target |
| **1** | B5 + B6 + B7 (entity signals) — six strings | `npm run check:seo` green; `sameAs` names real profiles |
| **2** | A1 collection + A2 gate extensions, landing with **zero** articles | `check:seo` green with a `guide` class that has no members yet; the cannibalisation check passing on the existing 72 pages |
| **3** | B2 + B3 (hosting) | live `301` verified with curl |
| **4** | Tier 1 articles (3), drafted by the agent, reviewed by the owner | each clears the A2 floors; `check:seo` green; `check:links` green |
| **5** | A3 commercial-page link blocks | the link graph is no longer flat — measured: inbound counts stop being uniform |
| **6** | Tier 2 articles (4) | as phase 4 |
| **7** | B4 (mermaid), B1 (root redirect) only if GSC justifies it | page weight measured before/after |
| **8** | Re-measure: impressions, clicks, position per target query | Tier 3 is committed **only** on the strength of phases 4–6 |

Each phase ends with the full gate stack: `npm run check` then `npm run build`
then `npm run check:seo` then `npm run check:links`.

---

## 7. Rulings needed

| # | Question | Why it blocks |
|---|---|---|
| **R1** | Path segment for guides: `/id/panduan/` or `/id/blog/`? | Decides URLs before any article is written |
| **R2** | Guides `id`-only, or translated to `en`? | `id`-only halves the work and removes duplication risk; `en` costs a translation pass per article |
| **R3** | Article 12 vs `/perbandingan/` — one of them, not both | Prevents the cannibalisation A2 is built to catch |
| **R4** | Canonical support address, and are there real social profiles to link? | Unblocks phase 1 and the entity signals |
| **R5** | Accept that this is a 3–6 month play? | A new domain's editorial content does not rank in weeks; the measurement in §8 is quarterly, not weekly |

---

## 8. How we will know whether it worked

Measured, not asserted. Baseline to capture **before** phase 4:

- GSC: clicks, impressions, CTR, average position — brand vs non-brand split —
  for the last 3 months.
- The count of non-brand queries with ≥1 impression (today: unknown; this is the
  number the content layer exists to move).

Then, 30/60/90 days after each tier ships:

- impressions and position for each of the 12 target queries;
- inbound internal link distribution (§1.2) — the flatness metric;
- assisted conversions: `/panduan/…` → `/pricing/` or `/download/`, if the
  analytics in use can express it. Cloudflare Web Analytics is the only beacon
  on the site today, and it is not a funnel tool — **flagging rather than
  solving**: if funnel attribution matters, that is a separate decision.

Deliberately not promised: rankings. The competitor set in §1.4 is established,
publishes long-form, and has been at it for years. What this plan buys is *entry*
into queries the site currently cannot appear in at all, and a measured reading
of whether that entry converts.

---

## 8b. What phase 2 actually shipped (2026-09-24)

Scaffolding, deliberately with **zero articles** — a hub listing nothing would be
an indexable empty page, which is the defect this layer exists to remove. So
`getStaticPaths` emits no hub for a locale with no guides, and the build output
is unchanged at 89 pages.

- `src/lib/guides.ts` — the URL shape and the contract, one owner.
- `src/content.config.ts` — a `guides` collection whose schema *requires*
  `target` and `commercialParent`.
- `src/pages/[locale]/[guideSegment]/{index,[...slug]}.astro` — hub + article,
  `BreadcrumbList` + `Article` on top of the entity blocks from `Base`.
- `scripts/check-seo.mjs` — a `guide` page class, a word floor, and a new check
  **15 `guide contract`**: a unique `target` per locale (cannibalisation) and a
  body link to the declared `commercialParent`.
- `scripts/sitemap-lastmod.mjs` — a guide's `<lastmod>` comes from its own
  `updated` front matter, not from the git date of the repo.

Gate after the change: **89 pages, 15 checks ok, `SEO/HEAD OK`**; 1488 unit tests
pass; `astro check` 0 errors. The new checks are currently vacuous — they hold
nothing until article 1 lands, which is exactly why article 1 must land next:
an unexercised gate proves nothing.

**Article 1 shipped** — `/id/panduan/aplikasi-kasir-offline/` (690 words) and
`/en/guides/offline-pos-app/` (842 words), Tier 1, targeting the offline wedge.
Build after it: **93 pages, 76 sitemap urls, 15/15 checks ok, no broken internal
links.** Both new gate arms were proven by breaking them on purpose: removing the
parent link produced `guide contract: … its body never links to /id/kasir-gratis/`,
and a second guide with the same `target` produced `two id pages competing for one
query`.

**One defect the translated segment caused, and its fix.** `LocaleSwitcher.astro`
derived the other locale's URL by swapping the prefix, so it emitted
`/en/panduan/…` — four broken internal links, caught by `check:links` and nothing
else. It now takes the same `alternatePaths` map as `SiteHead`, threaded
`guide route → Base → Header → LocaleSwitcher`. Any future surface that builds a
locale counterpart URL from `Astro.url.pathname` needs the same treatment.

**Not yet done (track A4):** guides are absent from `llms.txt` and from the ⌘K
search index. Both are data-driven and listed in §3 A4; the llms.txt coverage
test now skips the `[guideSegment]` subtree on purpose.

**Known thin page.** The hub is 54 words (`/id/panduan/`) and 62 (`/en/guides/`)
with one guide. It grows with every article — roughly 25 words each — so it is
not worth a floor until the corpus is bigger; it is worth one by article six.

## 9. Open risks

- **Duplication with `docs`.** `/docs/offline-mode/` and guide 1 both address
  offline. The `target` field plus the cannibalisation check is the mitigation;
  if GSC later shows them swapping position, one has to be merged into the other.
- **Payload cost of the ⌘K index** if guides are added by body text. Mitigated
  in A4 (by reference only), but worth re-measuring after 12 articles.
- **Build time.** Mermaid already costs a Chromium launch per changed diagram
  (cached). Guides add markdown but no diagrams, so no expected change.
- **`inlineStylesheets: 'always'`** adds ~14 KB gzip per HTML document. With more
  documents entering the sitemap, this is worth revisiting — it is a trade-off
  documented in `astro.config.mjs` (it kills a real FOUC regression), not a bug.
