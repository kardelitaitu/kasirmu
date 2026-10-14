# Four restaurant footer capabilities get E2E coverage, by sweeping the specs (round 147)

## The sweep

A round of coverage auditing rather than defect hunting. Five specs drive the restaurant
POS — payment modal, order lifecycle, portrait cart sheet, layout contract, and
`e2e-pos-to-kds` — and all **30 of their cases pass on both projects**. The subject is in
good shape.

What was missing showed up when the sweep asked which SURFACES the specs touch:

| Surface | Selector | Coverage |
|---|---|---|
| Send to Kitchen | `pos-cart-send-kitchen-btn` | **nothing** |
| Split Bill | `pos-cart-split-bill-btn` | **nothing** |
| Discount form | `.pos-cart-discount-btn` | **nothing** |
| Promotions | `.pos-cart-promotion-btn` | **nothing** |
| Receipt print | `receipt-preview` | covered |
| Cash presets | quick tender | covered |

All five had been driven by hand across rounds 118-141, so the behaviours were known; none
was pinned by a test.

## Fixme surfacing is not the same as a live gap

The same sweep rated every spec's disabled tests. `api.spec.ts` showed 10 disabled, which
looked alarming until read — they are `test.skip(!serverUp, ...)` conditionals with reasons,
correct by design, and they run whenever the cloud server is up. Only `product.spec.ts` had
genuinely dead tests, recorded in round 146.

## The new spec

`ui/e2e/restaurant-cart-capabilities.spec.ts`, four cases, each asserting what rounds
118-137 measured by hand:

| Case | Asserts |
|---|---|
| discount form | opens INLINE (not a dialog) and Apply arms only for a valid value |
| promotions | `.pos-cart-promotion-btn` opens a `[role=dialog]` |
| split bill | `pos-split-bill-modal` and its confirm control appear |
| send to kitchen | absent with no table, appears once one is named, then the line reads `Sent` |

The kitchen case carries knowledge from earlier rounds: `CartActionBar.tsx:190` gates the
button on a table OR an open bill, because a kitchen ticket is about a table — and the
**absence** is asserted, not just the presence.

Two selector mistakes were caught before running, by checking the source rather than the
record:

* the dispatched-line marker has **no class** — `CartLineItem.tsx:192-195` renders a bare
  `<span>Sent</span>`, so it is addressed by text;
* `.pos-cart-discount-btn` is shared by **two** buttons; the promotions one also carries
  `.pos-cart-promotion-btn` (`CartFooterTotals.tsx:136,:145`) — exactly the trap
  `restaurant-pos-cart-footer-live-controls.md` recorded in 2026-10-12.

## Verified, including a failed kill-test

| Run | Result |
|---|---|
| New spec | **8 passed** (4 cases x desktop/tablet), first run, no flake |
| Kill-test: remove the table gate | **fails**, so the assertion binds |
| Sister restaurant specs | 30 passed |
| Full UI suite | 12,665 passed |
| `tsc` | 0 |
| Source files touched | none — `CartActionBar.tsx` verified **identical to HEAD** after the kill-test |

## A process note worth keeping

**The first kill-test was invalid and I nearly recorded the test as unkillable.** The mutation
string matched a substring of the gate, so the replace DUPLICATED the clauses instead of
removing them — the file was left double-gated and the test passed for a trivial reason. The
sentinel was that the file after the mutation did not look like the intended mutation.

The check that caught it is the one used every time a kill-test *passes*: read the mutated
line back and confirm the file says what the mutation claims. Restored, re-applied as a
distinct replacement, and killed for real.