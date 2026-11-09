# A suspected data-loss defect, refuted — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 180 · status: E2E sweep green (27/27),
     one suspected HIGH-severity draft-loss defect found and TRACED TO FALSE; no code change
     was warranted and none was made · branch: 0.0.41 · commit: none -->

<!-- Scope: hunt real reliability defects in the restaurant POS rather than polish. -->

## E2E sweep: 27 of 27 green

Ran two batches of restaurant specs, single-worker, desktop project:

| batch | result |
|---|---|
| order-lifecycle, open-bills-cycle, payment-modal, course-firing | 13 passed |
| kitchen-chit, kitchen-dispatch-race, cart-capabilities, cart-panel-controls, table-merge, table-move | 14 passed |

Zero failures. That is a real negative result and it is the reason this round is not a fix
round: the highest-traffic restaurant paths are covered and holding. Note the deliberate
exclusion of `restaurant-menu-editor.spec.ts`, whose one failure is the OPEN round-177 defect
blocked on `PosScreen.tsx`.

## The suspected defect, and why it dissolved

A new untracked module, `ui/src/features/sales/utils/draftCart.ts`, landed in another lane's working
tree with its test. Reading it with the restore effect, I believed I had a HIGH-severity
data-loss bug:

>`reviveDraftLines` returns `null` when a draft's currency disagrees, and the caller removes
>`BOTH keys. But the persist effect writes the cart back to `ACTIVE_DRAFT_KEY` in the same
>`mount — so the refusal is undone, the next mount refuses again, and the operator
> loses the sale every time. The draft is un-restorable and un-discardable at once.

That is a good bug shape, and it is wrong. I killed it by tracing the effect order instead
of assuming it:

1. `draftRestoreSettledRef` is set at `:327`, AFTER the `if (!currencyReady) return;` at
   `:326`. So on the render where the currency is still loading, the restore returns
   early AND the flag stays false.
2. The persist effect's first act (`:410`) is `if (!draftRestoreSettledRef.current) return;` —
   so while the currency loads, it deletes nothing. This is exactly the guard the comment
   above it claims, and it holds.
3. On the refusal render, the restore calls `setLines` ONLY when `revived !== null`. The
   refusal returns before that. So `lines` is still empty when the persist effect runs in that
   commit, and it takes the `else` arm: `removeItem(ACTIVE_DRAFT_KEY)`.
4. Both keys are therefore gone, and the refusal is durable. A retry finds nothing.

The missing piece my first reading skipped: **the refusal branch never populates the cart,** so
there is no state for persistence to resurrect. The two effects are ordered restore-then-persist
and the settle flag makes the ordering explicit rather than accidental.

## What I am recording, and why it is worth a record

A refuted hypothesis is a result. The module states its own invariant in a long header —
"losing a draft is recoverable, ringing up the wrong price is not" — and the surrounding
lifecycle genuinely upholds it across the currency-loading, refusal, and persistence paths.
Recording the trace means the next reader does not have to re-derive it, and it marks the
draft-revival lifecycle as REVIEWED rather than merely new.

It also closes the loop on the discipline: I have twice this session written a fix that
measurement refused (round 177's editor handler, round 178's citation rewriter). The version of
that discipline for a defect that does not exist is to trace it to the end and say so, rather
than ship a defensive change against a bug that was never there.

## Evidence

- 27/27 E2E passed, two batches, command shape
  `npx playwright test --config e2e/playwright.config.ts <specs> --project=desktop --workers=1`.
- Every step of the refutation is a line number in the working tree: `:326`, `:327`,
  `:333-345`, `:410`, `:443-445`.
- "persist runs before the flag" is the refuted claim, and `:410` is the line that refutes it.
- **No file was changed this round.** Verified: no `zz-*` probes remain and no new untracked file
  is mine.

## Carried forward

1. `draftCart.ts` and its test are UNTRACKED — untested by CI until the owning lane commits
   them. The module reviewed clean here; it should not be edited by me while untracked.
2. The round-177 Escape defect remains the top open reliability item, still blocked on the
   dirty `PosScreen.tsx`. Re-check that file every round.
3. The restaurant E2E surface is healthy at 27/27 sampled; do not re-run these as a habit.

> last audited 18-10-26 by docs-auditor
