# The guide hreflang rule accepts a one-sided pair

**Date:** 2026-10-23 · **Severity:** low (latent; not reachable on today's tree) · **Status:** CLOSED 2026-10-23 by `297a9a429` (the resolution is recorded at the end)

## The rule

`website/scripts/check-seo.mjs` requires every guide page to name its other-locale
counterpart, because the slugs and the segment are both translated (`/en/guides/` ↔
`/id/panduan/`), so the hreflang rule cannot be computed by swapping a prefix.

`guideCounterpart()` (around :488) decides that by asking the guides corpus, and its
inner test is:

```js
const otherPaired = other.pair ?? other.slug;
const selfPaired  = self.pair  ?? slug;
if (otherPaired === slug || selfPaired === other.slug) return url;
```

Read the two halves carefully. The SECOND half is the correct one: THIS page names that
slug, so the pair is declared by the page being checked. The FIRST half compares the
OTHER page's `pair` against THIS page's own `slug` — it asks whether the other page
claims to pair with us, and accepts the pair even when we never claimed it.

**Verified by driving the real function, 2026-10-23.** `lang` is the TARGET locale (the
one whose path cannot be derived by prefix-swapping — see `check-seo.mjs`:763-768).

The difference between the two halves is one specific input, measured:

| input | `otherPaired === slug` (first half) | `selfPaired === other.slug` (second half) |
|---|---|---|
| `a` names `x`, and `x` names `a` | holds | holds |
| `a` names `x`, `x` names someone else | — | holds (so the pair is still accepted) |
| **`a` names NOBODY, `x` names `a`** | **holds** | does not hold |

That third row is the defect, and it is the only row where the halves disagree. Driven
directly: with `a` carrying no `pair` and the ID page carrying `pair: "a"`, the shipped
rule returns `/id/panduan/x/` while the second half alone returns `null`.

It matters because the ROUTE uses `guide.data.pair ?? slug` — each page emits the
counterpart IT declares. So a page that declares nothing has no `hreflang` on the real
site, while this checker reports the pair as satisfied by the OTHER page's declaration.
The checker is greener than the product.

> A first attempt at this probe used two files of DIFFERENT locales while passing
> `lang` as if it meant "the page's own locale", and reported the rule as correct. The
> function filters `other.locale !== lang`, so that probe skipped every candidate and
> returned `null` — a measurement shaped by the wrong assumption, not by the code.

## Why it has not bitten

Measured 2026-10-23: the tree has exactly one guide pair, and both files declare each
other:

```
website/src/content/guides/en/offline-pos-app.md       pair: "aplikasi-kasir-offline"
website/src/content/guides/id/aplikasi-kasir-offline.md pair: "offline-pos-app"
```

So no current page is mispaired. The defect is latent: it first bites when a guide is
added whose sibling is later renamed or re-pointed, and the effect is that the gate stays
green while the two pages' hreflang now point at different partners — a duplicate-content
signal to search engines, which is the exact thing this rule exists to prevent.

## The asymmetry worth knowing

The ROUTE that renders a guide uses `guide.data.pair ?? slug`
(`website/src/pages/[locale]/[guideSegment]/[...slug].astro:46`) — one-sided by design:
each page emits the counterpart IT declares. The checker's first half instead lets the
OTHER page's declaration satisfy this page, so the two files disagree about what a
counterpart is. That disagreement is the defect.

## Not fixed here, deliberately

Removing the first half is a one-line change but it changes the gate's VERDICT for any
non-reciprocal pair, and which direction is intended is an authoring decision: either the
checker should demand reciprocity (and the fix is to delete `otherPaired === slug`), or
the route should honour the other page's declaration too (and the fix is in the route).
Those are opposite behaviours and only one of them is wanted.

Recorded rather than guessed at, in the same spirit as the surrounding gates: a finding
an owner can rule on beats a silent change to what the gate reports.

## Resolution (2026-10-23)

Fixed in `297a9a429`: the first half was deleted, so only THIS page's own
`pair ?? slug` can satisfy the check. That is one line, and it was safe to apply
because the strict form was measured against the live tree FIRST — the site still
reported `SEO/HEAD OK` and the gate's own 23 cases still passed before the change was
committed, so no existing page changed verdict.

A 24th case (`guide-counterpart-one-sided`) now pins both directions. Verified by
mutation: restoring the deleted half makes exactly that case fail with
`["/id/panduan/x/","/id/panduan/x/"]` — the one-sided input accepted twice.

## Provenance

- Found 2026-10-23 while writing `check-seo.mjs`'s self-test; the case that would pin it
  could not be made to redden, and the reason turned out to be the rule, not the case.
- The self-test's own comment records that no fixture can distinguish the halves, which
  is true of the CURRENT rule and is the evidence for this finding rather than a gap in
  the cases.
