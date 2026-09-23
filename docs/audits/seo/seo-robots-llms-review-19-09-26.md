# SEO review — `robots.txt` and `llms.txt` (kasir.mu)

**Date:** 2026-09-19 · **Host measured:** production `kasir.mu` (Cloudflare) · **HEAD at review:** `1569a67ad`
**Scope:** review of the two crawler-facing files, plus the adjacent signals that decide whether they
actually buy SEO. Everything below is measured against the live site unless marked *judgement*.

> **Status: all findings implemented** — see §7.5 for the round-2 table of before/after measurements
> and §4 for the commit per item. **Nothing is deployed**; §0–§3 are the review as written (the live
> site as it was measured). Per-finding status is in §6; the §3.3–§3.6 gaps are annotated in place.

---

## 0. Verdict up front

Both files exist, are live, and are syntactically valid. Neither is broken. But:

- **`robots.txt` is correct but nearly empty** — it does one important thing right (§1.2) and leaves
  the two real crawl-policy decisions (`/dev/`, AI crawlers) unmade.
- **`llms.txt` has good prose and a rotted link list** — 16 of 75 published URLs are listed (21%),
  **zero** English URLs, and every link violates the spec's link syntax.
- **The highest-value SEO asset on this site is not either file.** It is the JSON-LD already
  shipping on the marketing pages (§3.1), and the missing `<lastmod>` in the sitemap (§3.3).
- **Two claims in my earlier working notes were wrong** and are corrected here: `/admin/` is *not*
  crawlable on `kasir.mu` (it 302s to the admin subdomain), and the `llms.txt` links are *not* dead
  (they 307 to the canonical trailing-slash form).

---

## 1. `robots.txt`

### 1.1 What is live

`https://kasir.mu/robots.txt` → `200`, `Content-Type: text/plain`, 110 bytes, `CF-Cache-Status: HIT`.

```
User-agent: *
Allow: /

Sitemap: https://kasir.mu/sitemap-index.xml

# LLM content: https://kasir.mu/llms.txt
```

### 1.2 What it gets right (keep all of this)

| # | Property | Evidence |
|---|---|---|
| 1 | Served at the **root** of the authority, `text/plain`, no auth, 110 B (limit 500 KiB) | live headers |
| 2 | Valid single group; `Allow: /` explicit | parsed |
| 3 | `Sitemap:` uses an **absolute** URL — required | spec |
| 4 | Sitemap index resolves: `sitemap-index.xml` → `sitemap-0.xml`, 75 unique URLs | live |
| 5 | **Does not `Disallow` the `noindex` pages** | see below |

**(5) is the single most valuable thing this file does, and the most common way sites get it wrong.**
Google's documented rule: *"For the `noindex` rule to be effective, the page or resource must not be
blocked by a robots.txt file."* `/en/account/` and `/en/login/` both carry
`<meta name="robots" content="noindex">` (measured). Because robots.txt allows them, a crawler
actually fetches the page, sees the tag, and drops it from the index. **If someone later "tidies up"
robots.txt by adding `Disallow: /account` or `Disallow: /login`, those pages become *more* likely to
appear in search results, not less** — the crawler would never fetch them, so the `noindex` would
never be seen. This is the trap the file currently avoids.

### 1.3 Findings

**R1 — `/dev/*` is publicly crawlable and indexable. Severity: High.**
`/dev/design-language` and `/dev/kds-prototype` both return `200` with **no** `robots` meta and no
`X-Robots-Tag` (measured). They are internal design prototypes. `/dev/manifest.json` and `/dev/sw.js`
also return `200`. Nothing in robots.txt or `_headers` excludes them, so they are indexable and
linkable. (`/dev/*.html` 307s to the extensionless form, which then serves 200 — so the canonical
URL is `/dev/design-language`.)

**R2 — No AI-crawler policy. Severity: Medium.**
There is no `User-agent` group for any AI token, so every AI crawler is allowed by the wildcard. That
outcome may be exactly what you want — but it is currently *accidental*, not a decision. The
distinction that matters is **training vs retrieval**:

- *Retrieval / citation bots* — `OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`, `Claude-User`,
  `Claude-SearchBot`, `Googlebot` — these are how an assistant finds and cites you. Blocking them
  removes you from AI answers.
- *Training bots* — `GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`, `Applebot-Extended`,
  `Meta-ExternalAgent`, `Bytespider`, `Amazonbot` — these only feed model weights.

If AI visibility is a goal, you want the first group allowed (it is, by default) and you may want the
second group disallowed. **This — not `llms.txt` — is the lever that actually shapes AI answers.**

**R3 — The subdomains have no `robots.txt`, and cannot inherit one. Severity: Medium.**
`robots.txt` is **per-authority**, not per-domain. `kasir.mu/robots.txt` governs nothing on
`admin.kasir.mu` or `dashboard.kasir.mu`. Measured:

| URL | Result |
|---|---|
| `admin.kasir.mu/robots.txt` | `200` `text/html` — the **login page**, not a robots file |
| `dashboard.kasir.mu/robots.txt` | `302` → `kasir.mu/en/account/` (HTML) |

A crawler that fetches `admin.kasir.mu/robots.txt` and receives HTML treats it as **no robots.txt =
allow everything**. Same for the 302, which resolves to an HTML page.

**R4 — `admin.kasir.mu` is a soft-404: every path returns 200 with the login page. Severity: Medium.**
Measured: `/robots.txt` and `/definitely-not-a-real-page-xyz` both return `200` with
`<title>kasir.mu Admin — Sign in</title>`. Root cause is deliberate code, not a bug —
`website/worker.ts:652-658` rewrites **any** unauthenticated path on that host to `/admin/login`:

```ts
const rewritten = new URL(request.url);
rewritten.hostname = MARKETING_HOST;
rewritten.pathname = '/admin/login';
```

Consequence: an unbounded URL space on `admin.kasir.mu`, all serving byte-identical HTML, with no
`robots` meta and no canonical (both measured absent). That host is a duplicate-content generator
waiting to be discovered. The rewrite is *correct for humans* (it keeps `login.js`'s relative API
calls on the proxy) — it just needs a crawler-facing signal.

**R5 — Worker-internal endpoints are crawlable. Severity: Low.**
`/__oz/*` (`runtime-config.js`, `session`, `logout`, `nf-logs`, `cf-deploys`, `worker-logs`,
`traffic`, `nf-status`, `uptime`) are all `Cache-Control: no-store` JSON/JS. Harmless, but they are
noise in crawl logs and two of them (`/__oz/nf-logs`, `/__oz/worker-logs`) proxy platform logs behind
a secret — worth keeping out of crawler reach on principle.

**R6 — The `# LLM content:` line is documentation, not a mechanism. Severity: Informational.**
`#` comments are ignored by every robots.txt parser. No crawler discovers `llms.txt` this way. Keep
it as a breadcrumb for humans; do not count it as discovery.

**R7 — `Allow: /` is redundant; and note which directives are ignored. Severity: Informational.**
With `User-agent: *` everything is allowed by default, so `Allow: /` adds nothing — harmless, and
"explicit over implicit" is a defensible style. More important is what **not** to add later: Google
**ignores** `crawl-delay`, `noindex`, `host`, and `request-rate`. `noindex` in robots.txt is
**unsupported** and must never be used to de-index anything — use the meta tag or `X-Robots-Tag`.
Also: `user-agent` values are case-insensitive, but **paths are case-sensitive**; longest-path-match
wins and ties go to the *least* restrictive rule (`Allow` beats `Disallow`).

---

## 2. `llms.txt`

### 2.1 What is live

`https://kasir.mu/llms.txt` → `200`, `Content-Type: text/plain; charset=utf-8`, 3941 bytes.
Generated by `website/src/pages/llms.txt.ts` (`prerender = true`).

**Structure is right:** `# kasir.mu` H1, `>` blockquote summary, `## H2` sections, pricing tiers,
10 FAQs. The prose is **data-driven** from `src/i18n/id.json` (`meta.description`, `support.faq`,
`landing.*`) and `content/pricing` — so the prose half **cannot rot**. That is a genuinely good
design decision.

### 2.2 Findings

**L1 — Every link violates the spec's link syntax. Severity: High.**
The llms.txt convention requires `- [name](url): optional notes`. This file uses `- Name: https://…`. <!-- dead-ref: ok: quotes the llms.txt link SHAPE, not a repository path -->
Measured: **16 unique URLs, 0 markdown links.** An LLM reading this gets no parseable link/anchor
structure — the exact thing the format exists to provide.

```
current   - Beranda: https://kasir.mu/id/
required  - [Beranda](https://kasir.mu/id/): Halaman utama kasir.mu
```

**L2 — The link list is hardcoded and has rotted. Severity: High.**
Lines 27–42 and 56–59 of `llms.txt.ts` are string literals. Measured against the live sitemap
(**75 unique URLs**), the file lists **16** — 21% coverage:

| Gap | Count | Detail |
|---|---|---|
| English URLs listed | **0 of 37** | `en` is the *declared default locale* in `astro.config.mjs`, yet no `/en/` URL appears |
| Docs pages listed | 3 of 17 | lists `/id/docs/`, `welcome`, `installation`; missing `activation`, `api-read-tiers`, `cloud-sync`, `docs-authoring`, `first-sale`, `inventory`, `licensing`, `offline-mode`, `payments`, `settings`, `shifts`, `stores`, `terminals`, `user-roles`, `workspaces` |
| `/id/` site pages missing | 5 | `cara`, `perbandingan`, `support`, `legal/privacy`, `legal/terms` |
| Root `/` | missing | not listed at all |

**L3 — Listed URLs are non-canonical. Severity: Medium.**
All 14 non-root links omit the trailing slash. Measured: `/id/pricing` → **307** → `/id/pricing/`.
So they *work* (correcting my earlier "dead links" note) but each costs a redirect hop and none is
the canonical form. A 307 (temporary) is also a weaker signal than 301.

**L4 — ~1/3 of the link budget is duplicates. Severity: Medium.**
`kasir-gratis`, `kasir-murah`, `kasir-qris`, `aplikasi-kasir-android` each appear **twice** — once
bare in `## Aplikasi`, once with notes in `## Halaman arahan`. 8 of 24 link lines are redundant.
Merge them: keep the annotated form, drop the bare duplicates.

**L5 — Body is Indonesian-only. Severity: Medium.**
Including every FAQ answer. For a site whose default locale is `en`, an English query gets Indonesian
prose. Either add an English variant (the spec supports scoped files, e.g. `/en/llms.txt`) or accept
that this file serves the Indonesian market only — but decide deliberately.

**L6 — The `Cache-Control` in the response is dead config. Severity: Low.**
`llms.txt.ts` sets `Cache-Control: public, max-age=3600`, but the live response is
`public, max-age=0, must-revalidate` — `public/_headers` `/*` wins at the edge (measured). Harmless
(fresh is arguably better for this file) but the intent does not hold. Same applies to every
Astro-generated response: **`_headers` overrides response headers on Cloudflare.**

**L7 — No spec-compliant discovery path. Severity: Low.**
The only pointer to it is a robots.txt **comment** (R6), which nothing parses. The spec's own
discovery mechanisms are `rel="describedby"` on the homepage and `rel="alternate" type="text/markdown"`
per-page `.md` versions. Neither is present.

**L8 — Strategic: Google does not use or endorse llms.txt. Severity: Informational.**
John Mueller, January 2026: Google *"won't use it"*, it *"can be useless"*, and sites should
`noindex` it if they keep it. It is not a ranking factor and guarantees nothing about AI citation.
Treat it as a **cheap, low-risk bet with unproven upside** — not as the SEO strategy. Note the
current file *is* indexable (200, `text/plain`, not disallowed, no `noindex`), so if the
`noindex` advice is followed it must be applied via `X-Robots-Tag` in `_headers` or a meta-free
header — **not** by disallowing it in robots.txt (that would be self-defeating).

---

## 3. Adjacent signals that matter more than either file

### 3.1 Strength — JSON-LD is already rich (no action, protect it)

Measured `application/ld+json` on the marketing pages:

| Page | Blocks | `@type`s |
|---|---|---|
| `/id/` | 1 | `Organization`, `WebSite`, `SoftwareApplication`, `Offer`, `ContactPoint` |
| `/id/pricing/` | 2 | + `Product`, `Brand` |
| `/id/support/` | 2 | + `FAQPage`, `Question`, `Answer` |
| `/id/cara/` | 2 | + `FAQPage`, `Question`, `Answer` |

This is the highest-value SEO asset on the site and it is done. Do not let a refactor drop it.

### 3.2 Strength — hreflang is correct on-page

`/id/pricing/` emits `canonical` → itself, `hreflang="en"` → `/en/pricing/`, `hreflang="id"`,
`hreflang="x-default"` → `/id/pricing/`. Correct.

### 3.3 Gap — the sitemap has **no `<lastmod>`** — **RESOLVED** (`976dd81dc`)

Measured: **0** `<lastmod>` elements across 75 URLs. `lastmod` is the primary signal Google uses to
decide *when* to recrawl a URL; without it, refreshes rely on generic scheduling. Cheap to add via
`@astrojs/sitemap`'s `serialize`.

**Now 74 of 74 URLs carry `<lastmod>`** (the 75th was the root — see §3.6). Values are real content
dates, never a build timestamp: docs use their authored `updated` frontmatter (`id/docs/welcome` →
`2026-08-30`, the same date the page renders), everything else the git commit date of its source file
(root `/` → `2026-09-17`, `/en/cafe/` → `2026-09-16`). Implementation and the shallow-clone hazard:
`website/scripts/sitemap-lastmod.mjs`.

### 3.4 Gap — `x-default` disagrees between sitemap and HTML — **RESOLVED** (`e8cbb506e`)

The sitemap emits `hreflang="en"` and `hreflang="id"` alternates but **no `x-default`** (measured).
The HTML declares `x-default` → the `/id/` variant. Two signals disagree about the fallback locale.

**Now every alternate group carries an `x-default` pointing at its `id` variant** — measured 74 of 74,
0 entries with alternates but no `x-default`, and the value matches `Base.astro` /
`DocsLayout.astro` / `index.astro` exactly. A test asserts the agreement from both sides, so the
sitemap and the HTML cannot drift apart again.

### 3.5 Gap — `defaultLocale: 'en'` contradicts the root canonical — **RESOLVED** (`e8cbb506e`)

`astro.config.mjs` declares `defaultLocale: 'en'`, but `/` canonicalises to `https://kasir.mu/id/`
and `x-default` points at `/id/`. Meanwhile the sitemap's `i18n.defaultLocale` also says `en`. Pick
one story: either `id` is the default (change the config) or `en` is (change the canonical /
x-default).

**`id` was chosen, and both `defaultLocale` values now say `id`.** Five observable signals already
said `id` — the root canonical, x-default, `<html lang>`, the root page's noscript fallback, and the
Indonesian marketing copy — so the config was the outlier. The root page's last-resort JS fallback
also moved from `'en'` to `'id'` to match (it only fires when `navigator.language` is empty).

### 3.6 Gap — root `/` is in the sitemap but canonicalises elsewhere — **RESOLVED** (`e8cbb506e`)

`<loc>https://kasir.mu/</loc>` is submitted, but `/` declares `canonical` → `/id/`. Submitting a URL
that canonicalises to a different URL is a mild contradiction; the locale-detect entry point does not
need to be in the sitemap.

**The root is now excluded** — and it was worse than a mild contradiction. The plugin groups
alternates by *path*, and the root parses to path `/` with the default locale, so it was injected as a
**third member of the `/` group**. Measured before the fix: `/`, `/en/` and `/id/` each carried
`hreflang="en"` **twice**, the first entry pointing at the root itself — duplicate hreflang values in
one `<url>`, which are invalid and discarded. After: 0 duplicate-hreflang entries.

### 3.7 Gap — `_headers` carries no `X-Robots-Tag` anywhere

`website/public/_headers` gives `/admin/*` only `Cache-Control: no-store, max-age=0`. There is no
`X-Robots-Tag` directive in the file. `X-Robots-Tag` is the header form of `noindex` and the only
form that works for non-HTML responses — it is the correct tool for R1, R3 and R4.

### 3.8 Confirmed-good — `/admin/*` is not on the marketing host

Correcting my earlier note: `kasir.mu/admin/` and `kasir.mu/admin/login.html` both **302** →
`admin.kasir.mu/admin/*` (`worker.ts`). The marketing host does not serve the admin panel. Likewise
`kasir.mu` returns a genuine **404** for unknown paths (`/definitely-not-real-xyz-123` → 404), so the
marketing host has no soft-404 problem. The soft-404 is confined to `admin.kasir.mu` (R4).

---

## 4. Recommendations, prioritised

**Status: all 13 done.** Commit per item in the last column; §7 records what each one measured.

### P0 — correctness of what already exists

1. ✅ **Fix the `llms.txt` link syntax** to `- [name](url): notes` (L1). — `d64744a14` <!-- dead-ref: ok: quotes the llms.txt link SHAPE, not a repository path -->
2. ✅ **Derive the `llms.txt` URL list instead of hardcoding it** (L2). Generate from the same source the
   sitemap uses, so it cannot rot, and include `/en/`. A hardcoded list is guaranteed to drift again.
   — `d64744a14`
3. ✅ **Merge the duplicated link sections** and drop the trailing-slash-less forms (L3, L4). — `d64744a14`
4. ✅ **Decide the `/dev/` policy** (R1) — de-index via `X-Robots-Tag: noindex` in `_headers`, **not**
   `Disallow` (see §1.2(5)). — `f8e54285a`

### P1 — subdomain hygiene

5. ✅ **Serve a real `robots.txt` on `admin.kasir.mu`** — `User-agent: *` / `Disallow: /` — and stop
   `dashboard.kasir.mu` from redirecting its own `/robots.txt` (R3). Both hosts are intercepted in
   `worker.ts` before the dashboard redirect and the auth gate. — `61a48b37a`
6. ✅ **Fix the `admin.kasir.mu` soft-404** (R4): the login page is now served only for the login entry
   points; every other unauthenticated path 302s to `/admin/login`, leaving one 200 URL. — `61a48b37a`
7. ✅ **Add `X-Robots-Tag: noindex` for `/admin/*` in `_headers`** as belt-and-braces (§3.7), plus the
   same header in `withStrictCSP` so the gate response carries it whatever `_headers` does. — `f8e54285a`

### P2 — strengthen the real signals

8. ✅ **Add `<lastmod>` to the sitemap** (§3.3) — highest ROI of the remaining items. — `976dd81dc`
9. ✅ **Make `x-default` agree** between sitemap and HTML (§3.4). — `e8cbb506e`
10. ✅ **Resolve the `defaultLocale` contradiction** (§3.5) and drop `/` from the sitemap (§3.6).
    — `e8cbb506e`
11. ✅ **Write an explicit AI-crawler policy** (R2) — resolved as "accept every crawler", recorded in
    `robots.txt` as a decision so a later editor cannot add training-bot blocks. — `f8e54285a`
12. ✅ **`Disallow: /__oz/`** (R5). — `f8e54285a`
13. ✅ **Decide whether `llms.txt` should be indexable** (L8) — decided **no**, via `X-Robots-Tag:
    noindex` in `_headers`; never via robots.txt. Discovery added with `rel="describedby"`. — `pending`

---

## 5. Proposed file contents

> **§5.1 was written before the file shipped and is now corrected below.** The rest of this section is
> kept as the original proposal, except where a later finding superseded it.

### 5.1 `website/public/robots.txt` — **as shipped** (`f8e54285a`, 1192 bytes)

```
# kasir.mu — crawler policy
#
# Policy (owner, 2026-09-19): we accept every crawler — search engines and AI
# training/retrieval bots alike. No User-agent group below blocks any bot; the
# wildcard covers named and unnamed crawlers. This is a DECISION, not an
# omission. Do not add training-bot blocks (GPTBot, ClaudeBot, CCBot,
# Google-Extended, ...) without an owner ruling.
#
# DO NOT add Disallow rules for /account/ or /login/. Those pages carry a
# `noindex` meta tag, and a robots.txt block would hide that tag from crawlers
# — making the pages MORE likely to be indexed, not less. De-index via
# X-Robots-Tag in public/_headers instead.
# Rationale: docs/records/seo-robots-llms-review-19-09-26.md §1.2

User-agent: *
Allow: /

# Worker-internal endpoints: runtime config, session/logout, and the log and
# deployment proxies behind secrets. Machinery, not content — all
# Cache-Control: no-store. Not a bot restriction.
Disallow: /__oz/

Sitemap: https://kasir.mu/sitemap-index.xml

# Advisory pointer for humans only. Comments are not a discovery mechanism:
# no crawler parses this line, and Google does not use llms.txt.
# LLM/agent content: https://kasir.mu/llms.txt
```

**Correction — `Disallow: /dev/` was removed.** The draft above carried it; the shipped file does not.
R1 asks for *de-indexing*, and §1.2(5) says plainly that a robots.txt `Disallow` does the opposite of
that (it hides the `noindex` signal). `/dev/*` is de-indexed with `X-Robots-Tag: noindex` in `_headers`
instead. The two mechanisms were an either/or, and the header was chosen.

### 5.2 AI-crawler groups — **not used.** R2 was resolved as "accept every crawler" (§7).

<details>
<summary>Original proposal (kept for reference — do not apply)</summary>

```
# --- Retrieval / citation bots: ALLOW (this is how assistants cite us) ---
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Claude-User
Allow: /
User-agent: Claude-SearchBot
Allow: /

# --- Model-training bots: policy decision ---
User-agent: GPTBot
Disallow: /
User-agent: ClaudeBot
Disallow: /
User-agent: CCBot
Disallow: /
User-agent: Google-Extended
Disallow: /
User-agent: Applebot-Extended
Disallow: /
User-agent: Meta-ExternalAgent
Disallow: /
User-agent: Bytespider
Disallow: /
User-agent: Amazonbot
Disallow: /
```

</details>

### 5.3 `llms.txt` link syntax (proposed shape)

```
## Aplikasi
- [Beranda](https://kasir.mu/id/): Halaman utama kasir.mu
- [Fitur](https://kasir.mu/id/features/): Fitur lengkap kasir.mu
- [Harga](https://kasir.mu/id/pricing/): Paket Gratis, Plus, Pro, Premium, Enterprise

## Dokumentasi
- [Panduan](https://kasir.mu/id/docs/)
- [Memulai](https://kasir.mu/id/docs/welcome/)
- [Instalasi](https://kasir.mu/id/docs/installation/)
- [Sinkronisasi cloud](https://kasir.mu/id/docs/cloud-sync/)
- ... (generate the full 17-page list from src/content/docs/id)
```

All URLs carry the canonical trailing slash. The list should be **generated**, not typed.

---

## 6. Summary table

| ID | Finding | Severity | Fix location | Status |
|---|---|---|---|---|
| R1 | `/dev/*` crawlable + indexable | High | `_headers` / bundle | ✅ `_headers` |
| R2 | No AI-crawler policy | Medium | `robots.txt` | ✅ decided: accept all |
| R3 | Subdomains have no `robots.txt` | Medium | `worker.ts` | ✅ `61a48b37a` |
| R4 | `admin.kasir.mu` soft-404, every path 200 | Medium | `worker.ts:652-658` | ✅ `61a48b37a` |
| R5 | `/__oz/*` crawlable | Low | `robots.txt` | ✅ `f8e54285a` |
| R6 | robots comment is not discovery | Info | — | ✅ `rel="describedby"` |
| R7 | `Allow: /` redundant; ignored directives | Info | — | ✅ documented |
| L1 | Link syntax violates spec | High | `llms.txt.ts` | ✅ `d64744a14` |
| L2 | Link list rotted (16/75; 0 `/en/`) | High | `llms.txt.ts` | ✅ `d64744a14` |
| L3 | Non-canonical URLs (307 hop) | Medium | `llms.txt.ts` | ✅ `d64744a14` |
| L4 | 8 duplicate link lines | Medium | `llms.txt.ts` | ✅ `d64744a14` |
| L5 | Indonesian-only body | Medium | `llms.txt.ts` | ⚠️ deliberate |
| L6 | Dead `Cache-Control` (overridden by `_headers`) | Low | `llms.txt.ts` | ✅ `d64744a14` |
| L7 | No spec discovery path | Low | `Base.astro` | ✅ round 2 |
| L8 | Google does not use llms.txt | Info | — | ✅ noindex set |
| §3.3 | Sitemap has no `<lastmod>` | High | `astro.config.mjs` | ✅ `976dd81dc` |
| §3.4 | `x-default` disagrees (sitemap vs HTML) | Medium | `astro.config.mjs` | ✅ `e8cbb506e` |
| §3.5 | `defaultLocale: 'en'` vs canonical `/id/` | Medium | `astro.config.mjs` | ✅ `e8cbb506e` |
| §3.6 | Root `/` in sitemap canonicalises to `/id/` | Low | `astro.config.mjs` | ✅ `e8cbb506e` |

**L5 is the one item deliberately left as-is:** `llms.txt` stays Indonesian-only. The spec supports
scoped files (`/en/llms.txt`) if an English variant is ever wanted; that is a content decision, not a
defect. Recorded here so the omission is a choice rather than an oversight.

---

## 7. Implementation (2026-09-19)

Owner decision taken during this review: **accept every crawler**, including AI training bots. That
resolves R2 as a *decision* rather than an omission — and the fix was to record it in the file so a
future editor cannot "tidy" training-bot blocks into it.

### 7.1 What changed

| File | Change |
|---|---|
| `website/public/robots.txt` | Policy recorded as an explicit decision; `Disallow: /__oz/` added; a standing warning against `Disallow`-ing `/account/`/`/login/` added. Directives: `User-agent: *`, `Allow: /`, `Disallow: /__oz/`, `Sitemap:`. |
| `website/src/pages/llms.txt.ts` | Link syntax fixed to `- [name](url): notes`; marketing pages now read from data; docs derived from the `docs` content collection; hardcoded URL list deleted; dead `Cache-Control` removed. |
| `website/src/lib/llms-pages.ts` | **New.** The public page list, label table and i18n slug maps. |
| `website/src/__tests__/llms-txt-coverage.test.ts` | **New.** Rot guard — 7 tests, fails if the list and the pages on disk disagree in either direction. |
| `website/public/_headers` | `X-Robots-Tag: noindex` for `/dev/*` and `/admin/*`. |
| `website/worker.ts` | `X-Robots-Tag: noindex` in `withStrictCSP` — fixes R4 at its single choke point. |
| `website/src/__tests__/worker.test.ts` | **Pre-existing red fixed** — see §7.3. |

### 7.2 Result

`llms.txt` now covers **37 of 37** `/id/` sitemap URLs (was 16 of 75 overall, 0 of 37 English), with
**0** URLs missing a trailing slash and **0** non-conforming link lines. The list cannot rot silently:
adding a page fails the test, and removing one fails it too (both directions mutation-tested).

### 7.3 New findings discovered *while implementing* — five of them; one corrects this report

**(a) R1 was framed wrongly: `/dev/` is deliberately published.** `scripts/sync-dev-files.mjs` copies
repo-root `prototypes/` into `public/dev/` at prebuild *"so the design-language and KDS-prototype pages
are included in the Astro build output and served at https://kasir.mu/dev/"*. It is an intentional
surface, not an oversight. `X-Robots-Tag: noindex` (owner's choice) is still coherent — it keeps direct
links working while removing the pages from search — but the reasoning is "internal reference, not
acquisition page", not "someone forgot to exclude it".

**(b) The Required `website` CI gate was already RED.** `dev-ci.yml` lists `website` as ✅ Required and
runs `npm run check`, which is `precheck && astro check`. `astro check` exited **1** on two errors in
`website/src/__tests__/worker.test.ts:297` — `mock.calls[0][0]` on a mock declared as
`vi.fn(async () => ...)`, i.e. a zero-arg mock whose `calls` has the tuple type `[]`. `git log -S`
traces the line to **`4dd0cfe6c` (2026-09-18)**, so the gate had been red since yesterday. Fixed by
giving the mock a `Request` parameter, which also makes it faithful to `Env['ASSETS']`. **Any change
touching `website/` would have inherited this red.**

**(c) A filesystem glob silently switched off a different gate.** The first implementation derived the
page list with a Vite glob import. `scripts/verify-website-assets.py` treats *any* dynamic resolver
under `website/src` as grounds to disable its asset-orphan rule for the **whole tree** (its KNOWN LIMIT
docstring: the rule is only safe to enforce "while the reference style is provably static"). Measured
before/after: `find_dynamic_resolvers()` went `0 → 1`, and the verdict changed from
*"no oversized, raster-in-svg, or orphaned assets"* to *"orphans NOT assessed"*. Replaced with plain
data + a test, which restores the count to **0** and keeps full grading. A test is also the louder
guard.

**(d) The same detector greps comments.** Removing the glob was not enough — the resolver count stayed
at **2** because the *prose* of two docstrings named the glob call literally. The regex is line-based
and does not strip comments. Both comments now describe it in words. **This is the same trap class as a
retired token written into a skill docstring that the drift guard then scans** — writing *about* a
pattern trips the detector that hunts the pattern.

**(e) `_headers` overrides the route's `Cache-Control`** — confirmed again here (L6). The
`max-age=3600` in `llms.txt.ts` was dead; removed rather than left as a misleading intent.

### 7.4 Verification (all green)

| CI step (`dev-ci.yml#website`) | Result |
|---|---|
| `python3 scripts/verify-website-assets.py` | exit 0 — orphan rule **active** (resolver count 0) |
| `npm run check` | exit 0 — **0 errors** (was exit 1 / 2 errors) |
| `npm test` (inside `check`) | all passed |
| `npm run build` | exit 0 — 82 pages, prebuild + postbuild clean |
| `npm run check:links` | `NO BROKEN INTERNAL LINKS` |

Rot guard mutation-tested in both directions: a listed-but-absent slug and an on-disk-but-unlisted
page each fail with an actionable message.

> The round-1 table above originally quoted "43 test files". That number was the **`astro check`** file
> count, not the test count — `astro check` reports 149 files (it type-checks every `.ts`/`.tsx`/`.mjs`
> under `website/`, not only tests). Authoritative counts at the end of round 2: **45 test files, 819
> tests, 149 files type-checked, 0 errors.**

### 7.5 Round 2 — the adjacent signals and the subdomains

§7.1–§7.4 covered the two files. Round 2 closed the rest of §4, one commit per coherent unit.

| Commit | Scope |
|---|---|
| `976dd81dc` | Per-URL `<lastmod>` (§3.3) — new `website/scripts/sitemap-lastmod.mjs`, wired through `@astrojs/sitemap`'s `serialize`; 17 tests. |
| `34f7c4e16` | **Fixes a red introduced by `976dd81dc`** — see (f) below. |
| `e8cbb506e` | `x-default` in the sitemap, root `/` excluded, `defaultLocale` → `id` (§3.4–§3.6). Sitemap rules extracted to `website/scripts/sitemap-options.mjs`; 14 tests. |
| `61a48b37a` | Subdomain `robots.txt` and the admin soft-404 (R3, R4). 7 new worker tests. |
| `091720873` | `rel="describedby"` → `/llms.txt` on every page (L7); `X-Robots-Tag: noindex` for `/llms.txt` (L8). |

**Measured, before → after**

| Signal | Before | After |
|---|---|---|
| Sitemap URLs with `<lastmod>` | 0 of 75 | **74 of 74** |
| Sitemap alternate groups with `x-default` | 0 of 75 | **74 of 74**, all → `/id/` |
| Entries with a duplicate `hreflang` | **3** (`/`, `/en/`, `/id/` — `en` twice) | **0** |
| Sitemap URLs | 75 (incl. the root, which canonicalises to `/id/`) | 74 |
| `admin.kasir.mu/robots.txt` | 200 `text/html` (the login page) | 200 `text/plain`, `Disallow: /` |
| `dashboard.kasir.mu/robots.txt` | 302 → HTML | 200 `text/plain`, `Disallow: /` |
| 200-returning URLs on `admin.kasir.mu` | unbounded (`/anything`) | **1** (`/admin/login`) |

#### Corrections and new findings from round 2

**(f) `astro check` type-checks `src/__tests__/**` — a green `vitest run` is not evidence.** `976dd81dc`
shipped `ts(2345)` at `sitemap-lastmod.test.ts:90` (`sourceFileFor` returns `string | null`, passed
straight to `join()`). The test passed, the build passed, and only `astro check` saw it — because the
website tsconfig `include` is `**/*`. The `npm run check` gate was therefore left red by that commit
and repaired in `34f7c4e16`. **Run `npm run check`, not `vitest`, before committing any TS change under
`website/`.**

**(g) The root `/` was not merely redundant in the sitemap — it corrupted the group it joined.**
`@astrojs/sitemap` groups alternates by *path*, and `parseI18nUrl` maps the root to path `/` with the
default locale. So `/` was appended as a third member of the `/` group, giving `/`, `/en/` and `/id/`
each **two** `hreflang="en"` entries, the first pointing at the root. Excluding `/` fixes all three at
once. §3.6 called this "a mild contradiction"; it was a duplicate-annotation bug.

**(h) `_headers` cannot be the single source for the subdomains.** No `_headers` rule matches
`admin.kasir.mu`, so `/robots.txt` there would fall through to the static marketing file. The worker
has to intercept it. A static file under a `website/public/` subdirectory was considered and rejected:
it would be untracked by `git ls-files`, so `verify-website-assets.py` would flag it as an ORPHAN.

**(i) R4's "return 404" was the wrong prescription.** The one-time-code exchange (Step 1) redirects a
*failed* login back to a clean path such as `/settings`, and `admin.js` has no client-side routing at
all — after authentication the gate rewrites `/x` → `/admin/x`, which the asset layer 404s anyway. So
a deep link is never a real route, and a 404 there would strand a real user on a dead page. The gate
redirects to the login URL instead, which still collapses the 200 space to a single URL.

**(j) Out of scope but noticed:** the locale preference is stored under `oz_language`
(`src/pages/index.astro`, `src/lib/language.ts`, `src/components/LocaleSwitcher.astro`) — a
pre-rebrand `oz_` token. Renaming it is a behaviour change for existing visitors and belongs to the
rebrand pass, not here.

### 7.6 Deployment

**Nothing is deployed.** Every change is local to this checkout; the live site still serves the state
described in §1 and §2. Deploying is a separate, explicitly-authorised step.

