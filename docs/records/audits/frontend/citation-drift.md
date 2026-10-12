<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 minor) · Re-audit of a live handbook page, and this pass closed the gap the page leaves open about itself: it was the ONLY file in docs/records/audits/frontend/ carrying neither an audit stamp nor a '> last audited' footer, while its same-series sibling css-verification.md carries both. Nothing in the body was rewritten - the measurement, the type taxonomy (pointer / provenance / historical defect), the AS OF convention and the 'not worth building as specified' recommendation all stand. · WHAT WAS RE-MEASURED RATHER THAN INHERITED. (a) THE AS OF CONVENTION IS ADOPTED, NOT MERELY PROPOSED: the page records 17 markers across 16 files applied 2026-10-07, and a grep for 'AS OF ' under ui/src returns 18 today, so the convention has been used again since and not reverted. Its own worked example is live: kdsOrdersDiff.ts:52 carries 'Extracted from KdsScreen.tsx:159-165 AS OF 1d0be5fdf^' and the SHAs it names resolve, so a reader can reproduce the range as the page promises. (b) ITS WORKED TRANSCRIPT IS STILL TRUE: KdsScreen.tsx:161-162 remains the currentIds/arrivedIds pair the page quotes as the extracted call now occupying the provenance range. (c) THE TOTAL HAS GROWN, which is the page's own premise rather than a defect: it measured 548 citations on 2026-10-07, and a raw sweep today is well above that (the exact figure depends on the pattern; the page states its own regex, and my run was a broader one). The page already says the sweep is a dated measurement and that the ~20 unroutable citations 'were not checked by hand here'. A grown total is the same class as trap 20 ('green at a NUMBER'): the durable half is the CONVENTION and the taxonomy, not the count. · WHAT WAS REPAIRED: the title names it an 'Agent Ops Handbook' entry, but unlike its sibling it never said who/when measured it or that it had been audited, so a reader arriving from the series could not tell a live measurement from an abandoned note. The stamp and footer now carry that; the body is otherwise unchanged. · SCOPE LIMIT, STATED PLAINLY: I did NOT re-run the three-way classification over the full corpus, and I did NOT re-verify the 'genuine stale pointers found: 0' conclusion across all resolvable citations - that is the page's own dated conclusion and re-deriving it is a sweep, not an audit. I verified the CONVENTION is live, the worked example reproduces, and the sibling-consistency gap is closed. · NOT re-measured: the per-kind provenance share, the ~20 unroutable citations, and whether any pointer has decayed since 2026-10-07. -->

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

## The failure mode a line-RANGE check misses entirely

A range check only tests the upper bound. The worse case is a provenance note whose
numbers still point INSIDE the target file, at code that is now something else. It passes
every mechanical test and is still wrong, because the reader lands on unrelated lines and
believes them.

This happens by construction when a refactor *replaces* the code it extracted: the call
site inherits the old line numbers. Three citations written during the 2026-10-07 KDS
passes hit exactly this — `kdsOrdersDiff.ts` said "Extracted from KdsScreen.tsx:159-165",
and `:159-165` is now the extracted call itself:

```ts
// KdsScreen.tsx today
161  const currentIds = orderIdSet(filtered);
162  const arrivedIds = arrivedOrderIds(prevOrderIdsRef.current, filtered);
```

Verified against history (`git show <sha>^:<path>`): the ORIGINAL numbers were correct —
`:303`, `:312`, `:393`, `:153` all matched before the extraction. So the note was
accurate when written and decayed the moment its own commit landed.

## The convention — adopted, and what it looks like

A provenance citation carries **the revision it describes**, so it can never be mistaken
for a live pointer even when its numbers happen to be in range:

```ts
// Before — true when written, silently false the moment the file shrinks
* Extracted verbatim from KdsScreen.tsx:519-566 by the KDS merged-lane

// After — read the number as history, and the reader can check it
* Extracted verbatim from KdsScreen.tsx:519-566 AS OF de165c118^ by the KDS merged-lane
```

The `^` matters: `<sha>^` is the commit **before** the extraction, so
`git show de165c118^:ui/src/features/kds/KdsScreen.tsx` reproduces the range, while
`<sha>` alone would already show the replacement.

### Where it was applied (2026-10-07)

**17 markers across 16 files** (`kdsOrderView.ts` carries two — its zone/filter and its
scope/filter notes were separate extractions), all in `ui/src`, found by the in-range
sweep described above:

| | |
|---|---|
| KDS components (`KdsHeaderLeft/Right/Tabs`, `KdsMainContent`, `KdsNoticeBanners`, `KdsZoneChips`) | 6 |
| KDS hooks and modules (`useKdsKeyboardShortcuts`, `useKdsFilterNav`, `useKdsRealtime`, `useKdsTabIndicator`, `kdsOrderView`, `kdsOrdersDiff`) | 6 |
| Test headers naming an extraction (`KdsBoardFiltered`, `KdsOrderFiltering`, `screenExtraction`) | 3 |
| `CartTaxWatcher` (the one non-KDS site) | 1 |

(The counts are files; `kdsOrderView.ts` contributes two markers, which is why the rows
sum to 16 and the marker count is 17.)

### Two suspects that were NOT edited, and why

The sweep flagged both; reading the target said otherwise.

- `pageLayoutRender.test.ts` cites `AppShell.tsx:341` — that line **is**
  `admin: 'settings'`, exactly as the note claims. Annotated `re-verified 2026-10-07`
  rather than `AS OF`, because it is a **current** pointer and should stay one.
- `kdsDensity.ts` cites `hooks/useTicketSla.ts:66-90` — that range **is** the SLA
  conversion. The word "extracted" in the surrounding prose is what tripped the matcher.

**A provenance marker and a live pointer must not be conflated.** The marker says *"this
number is history"*; adding it to a correct current pointer would make the pointer
unverifiable.

### Coverage limit

The sweep resolves **528 of 548** citations via `git grep` and basename lookup. The
remaining ~20 use a bare filename that matches several files and a script cannot route
them; they were **not** checked by hand here.

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

> last audited 11-10-26 by docs-auditor
