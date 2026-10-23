# The guide hreflang rule accepts a one-sided pair

**Date:** 2026-10-23 · **Severity:** low (latent; not reachable on today's tree) · **Status:** open

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
claims to pair with us, and accepts the pair even when we never claimed it. Nothing then
requires the claim to be reciprocal: A may say `pair: b` while B says `pair: c`, and A is
still reported as having a counterpart.

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

## Provenance

- Found 2026-10-23 while writing `check-seo.mjs`'s self-test; the case that would pin it
  could not be made to redden, and the reason turned out to be the rule, not the case.
- The self-test's own comment records that no fixture can distinguish the halves, which
  is true of the CURRENT rule and is the evidence for this finding rather than a gap in
  the cases.
