# Agent Ops Handbook — Source Citation Drift

> For the rule, read root `AGENTS.md`. This page is the measurement behind whether a
> guard is worth building, and the answer is more nuanced than "yes" or "no".

## The question

Source comments in this repo cite each other by `file.tsx:1234`. Nothing checks those
numbers. Two separate repairs (rounds 93 and 96-97) found **every** citation in two
hazard-pin test headers stale — one file cited `TabletAppShell.tsx:196` for an
expression that had moved to `:527`, and every number in its prose pointed at
unrelated code. That raised the obvious question: should a guard exist?

## The measurement (2026-10-07)

Scanned every `.ts`/`.tsx` under `ui/src` for `\b[\w./-]+\.(tsx?|css):(\d+)`:

| | count |
|---|---|
| citations total | **548** |
| written with a path (`features/kds/KdsScreen.tsx:12`) | 157 |
| bare filename, resolves to exactly one file | 371 |
| bare filename, **ambiguous** (several files share it) | 20 |
| **a checker could resolve** | **528 (96%)** |

So the mechanical half is cheap: 96% of citations name something resolvable.

## Why "resolvable" is not the same as "checkable"

Of the resolvable set, a line-range test flags only a handful — and **almost all of the
flagged ones are correct as written**, because the citation is not a pointer to current
code. It is one of three different things:

| kind | example | a line check says |
|---|---|---|
| **Pointer** | `PosScreen.tsx:1442 onClick={() => …}` | correct — must stay true |
| **Provenance** | `Extracted verbatim from KdsScreen.tsx:967-1081` | **false positive** — the line is gone *because the code moved to this file* |
| **Historical defect** | `RetailPosScreen.css:3631 — prose glob … (fixed 12a54b3d4)` | **false positive** — records a state deliberately destroyed |

Measured 2026-10-07: **5%** of citations are provenance-shaped, and in the final pass
**all** out-of-range hits were proven false positives on inspection (two were provenance
phrases split across a line break, which is what defeated a naive sentence-level regex).

**Genuine stale pointers found: 0.** The four real breaks found across rounds 93-97 were
all in text that read as a live pointer and had drifted — the fix each time was to
re-point by *searching for the code the comment describes*, never by guessing an offset.

## Recommendation

A line-existence guard is **not worth building as specified**, because its signal-to-noise
would be dominated by intended-historical citations, and a guard that cries wolf trains
people to ignore it — the same failure mode this handbook names elsewhere (a check that
cannot fail is replaced by a check that always fails).

If it is ever wanted, it needs a **syntactic marker** separating the two kinds first, so
the check becomes mechanical. Two workable conventions:

- provenance says so in the line: `was at KdsScreen.tsx:967` / `(moved)`
- or the citation is written without a line at all when only the file matters:
  `moved out of KdsScreen.tsx`

Applying that to the ~5% provenance sites is a one-pass edit, but it must come **before**
the guard, not after. Until then: re-point by search, and record the search, not the offset.

## What is checked instead

Nothing automated. The compensation is that every repair in this campaign re-verified its
numbers against source by **reading the target line**, and said so in the commit. That is
manual, and this page exists so the next agent does not re-derive the measurement.
