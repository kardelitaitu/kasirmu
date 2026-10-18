# Three POS hypotheses, all refuted — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 164 - status: 0 defects found,
     3 hypotheses TESTED and refuted with evidence, 0 code changes - branch: 0.0.41 -
     commit: none (no edits to commit) -->

<!- - Scope: the restaurant POS reliability lane, per the active goal and the carry-forward
     from rounds 162-163. Reported as a negative result rather than padded into a fix. -->

## Why this round changed nothing

The last four rounds each found a real defect, which is a run worth not mistaking for a trend.
This round tested three hypotheses in the POS lane and **all three were refuted by running
code**, so the honest output is the refutations. Adding a change to have something to commit
would be the same error as bending code to satisfy a scanner, one step earlier.

## Hypothesis 1: the routing model trim and its validator could disagree

`kdsRoutingRulesModel.ts` has two pure helpers that must agree: `toSavePayload` (`:75`) trims
`matcher_value` and `target_station`, and `incompleteRowKeys` (`:86`) trims the same two fields
and flags blanks. If the trim were dropped from one, rows would pass validation and save blank
— and the store is a WHOLE-SET REPLACE, so one blank rule rejects the entire set.

Kill-tested directly: removing both `.trim()` calls from `toSavePayload` turns
`toSavePayload renumbers priority by position and trims values` RED (1 failed | 16 passed). The
trim is pinned. Both helpers are also pinned independently (`KdsRoutingRulesEditor.test.tsx:370`
and `:382`), so the invariant has coverage on both sides.

The related worry — that an INACTIVE blank row blocks a save the operator expects to succeed —
is also refuted, and by the backend rather than the UI. `db/kds_rules.rs:69-82` validates every
rule in the set and checks `matcher_value.trim().is_empty()` and `target_station.trim().is_empty()`
**without consulting `is_active`**. So an inactive blank rule genuinely is rejected by the store,
and the editor refusing it is faithful, not over-strict. The frontend and the store agree on the
same predicate.

## Hypothesis 2: the engine tie-break is unreachable

`kds.rs` ranks a line matching rules by `(priority, matcher_rank, index)`, where `matcher_rank`
orders SKU (0) above Category (1) above Tag (2). The editor renumbers `priority` to 1..n on every
save, so ties looked impossible and the tie-break looked like dead code — and the table has no
`UNIQUE (restaurant_pos_id, priority)` constraint to force the question either way.

Refuted: `kds_tests.rs:615` `sku_matcher_outranks_category_at_equal_priority` builds two rules
at priority 3 — a category rule listed FIRST and an SKU rule second — and asserts the SKU rule
wins. So the behaviour is deliberate, reachable from any writer that is not this editor, and
already pinned. Correctly not dead code.

## Hypothesis 3: the split-bill arithmetic might not conserve the bill

`SplitBillModal` partitions a bill into two carts, and a lost or duplicated unit is a money
error at the till. Audited as a class against `SplitBillModal.money.test.tsx`, which pins it
from five directions: every unit sent exactly once on select-all (`:86`), refusal to select more
units than a line holds (`:116`), the auto-select default not defeating the select-all tap
(`:138`), the remainder kept when only part of a line is selected (`:164`), and `dispatchedQty`
clamped per partition so it never exceeds `qty` (`:184`). The last one is the case a naive
implementation gets wrong. Nothing to add.

## What the dither lead turned out to be

Rounds 162-163 carried "grade the dither walk through the element name" as the open lead with
recurring evidence. Reading it properly this round: the file names **two candidate remedies and
explicitly declines to choose between them**, because either one "changes what the gate demands
of a stylesheet, which is an owner decision" (`:644-651`). It also documents the live example —
`.kds-slider-knob`, waived through the `:hover` door — and that surface is a 20x20px circular
control, which is exactly the small-area case remedy (2) argues banding cannot affect.

So this is not a defect I can fix; it is a recorded decision with a named owner. Taking it would
mean changing what the gate demands of other lanes stylesheets. Left alone deliberately, and the
reason is now written here rather than re-derived next round.

## Evidence

- Hypothesis 1: kill-tested, 1 failed | 16 passed with the trim removed; restored with
  `git checkout --` and confirmed clean against HEAD. Backend predicate read at
  `db/kds_rules.rs:69-82`.
- Hypotheses 2 and 3: refuted by reading the pinning cases at `kds_tests.rs:615` and
  `SplitBillModal.money.test.tsx:86-184`, each of which asserts the exact behaviour in question.
- Suite: **815 files passed, 12966 passed, 3 skipped, 3 todo, 0 failed.** No regression, because
  nothing was changed.
- Working tree: **zero edits of mine.** `git status` on `crates`, `ui`, `scripts`, `prototypes`
  and `website/src` shows only other lanes in-flight files, verified by path-scoped status.

## Carried forward

The POS lane is in a genuinely different state from where this goal started. Rounds 136-164
closed the double-tap class, the dead-handler class, the order-type class, the cart-scope class,
and the three red guards; the suite is green; and this round could not find a defect in the
routing model, the routing engine, or the split-bill arithmetic. **Continuing to grep this lane
for defects is now low-yield**, and I would rather say that than keep reporting rounds of
refutations as if they were progress.

Two things still look genuinely unexplored, and both are BEHAVIOURAL rather than static — which
is the gap, because every class I have closed was found by static analysis:

1. The E2E specs. `ui/e2e/` holds `e2e-kds-critical-path.spec.ts` and
   `restaurant-cart-panel-controls.spec.ts`, both currently modified by another lane, and
   `npm run e2e` is the one gate in `AGENTS.md` I have not run this session. It is the only
   thing here that exercises a real browser against a real backend.
2. The restaurant POS on the actual tablet — there is a documented `android-ui-automation`
   path over CDP for reading what the device really renders, which is the one evidence source
   that can contradict a green unit suite.

> last audited 18-10-26 by docs-auditor
