# Removing the API I added for a fix that did not need it — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 190 · status: the speculative claimEscape
     flag from round 189 removed after PROVING it inert; the round-189 predicate verified to
     cover the whole class it was meant to · branch: 0.0.41 · commit: 470fc689f -->

<!-- Scope: the round-189 carry-forward — "remove claimEscape if nothing needs it". -->

## Closing my own loop, with a measurement rather than a judgement

Round 189 added `claimEscape` to `useFocusTrap` while chasing a diagnosis that turned out
to be wrong. It shipped with the honest note *"if no caller ever needs it, it should be removed
rather than kept as speculative API."* This round removed it — but only after MEASURING that it
was inert, not because the reasoning said so:

```
remove the 4th argument from the only call site  ->  toolbar spec 4/4 passed, unchanged
```

That is the kill-test for an API rather than for a behaviour: if deleting it changes no
observable result, it was never load-bearing. It was not, because the real fix is a different
mechanism entirely — `isAnyAriaModalOpen()` in `PosScreen`, not key consumption in the trap.

## What was removed, and what replaced it

- the `claimEscape` parameter, its docstring block, its ref, the `consumeShortcut` call, and the
  now-unused import (net **-13 lines**);
- **a stale comment that had become a lie.** The call site read *"`claimEscape: true` — the panel
  is the topmost Escape owner … Without it the key closed the panel AND the whole table view"* —
  attributing the fix to a flag that did not fix it. It now records the actual cause, and
  carries an explicit warning not to retry the failed approach: *"Do NOT try to fix this from
  here by calling `stopPropagation()`: both listeners sit on `document`, and propagation
  control does not reach a sibling listener on the SAME node. That mistake was made and
  measured in round 189."*

## The class, verified rather than assumed

Round 189 fixed a predicate: PosScreen stands down whenever any ARIA modal is open. That is
class-shaped, so this round checked how wide it actually reaches. Every PosScreen sub-screen:

| sub-screen | ARIA modals |
|---|---|
| Tables | **6** |
| SalesHistory | **3** |
| MenuEditor | 2 |
| Payments / Receipts / Settings | 0 |

Eleven modals across three sub-screens, all protected by construction — and, worth stating,
**PosScreen itself renders no ARIA modal at all**, so the predicate can only ever be true from a
sub-screen child. That is what makes the guard safely narrow rather than a blunt instrument.

SalesHistory in particular was never suspected: three focus-trapped overlays with **no Escape
coverage in any spec**. They now inherit the fix without a line of their own changing.

## Verified

| check | result |
|-|-|
| `useFocusTrap.test.ts` | **40 passed** (the stacked-trap contract is intact) |
| toolbar + menu-editor specs | **6 passed** — both Escape fixes still hold |
| modal-adjacent sweep (4 specs) | **14 passed** |
| `npm run lint` / `typecheck` | 0 errors (116 warnings, back to baseline) / clean |
| stray probes | none; `zz-*` removed |

One self-inflicted detour worth recording: my docstring removal cut the `*/` terminator with
the block, which typecheck caught immediately (`TS1010: */ expected`). Fixed in the next call.
Cheap, and the reason to run typecheck after every structural edit rather than at the end.

## Carried forward

1. SalesHistory three focus-trapped overlays have **no Escape coverage**. They are protected
   by the predicate, but nothing pins that Escape closes them rather than the screen they sit
   in. Worth a round if that surface is touched.
2. The two rules from rounds 187-189 now hold as a pair, and they are the reusable part:
   **a handler must CLAIM the key it consumes** (187), and **peers on one node cannot be
   ordered by propagation — they need a shared predicate** (189). Round 190 adds the third:
   **an API added for a failed diagnosis must be proven inert and then deleted, not kept**.

> last audited 18-10-26 by docs-auditor
