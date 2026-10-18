# An OPEN heading that outlived its fix by 92 rounds — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 182 · status: F40 heading said OPEN for
     92 rounds; the fix landed ONE round later and its own block says so. Heading corrected and
     the fix re-verified in the tree · branch: 0.0.41 · commit: c492cb145 -->

<!-- Scope: keep working the restaurant reliability plan. -->

## The finding

The plan annotates 24 of its 78 items as CLOSED/FIXED/RESOLVED in the heading itself — which
makes one exactly-matchable string: `— OPEN`. One heading carried it:

```
### F40 — the payments screen rail toggles do not persist on the tablet (round 89) — OPEN
```

**Fifty lines below that heading sits this:**

```
### F40 — CAUSE FOUND AND FIXED (round 90) — 267e23e9e
```

The fix landed **one round after the finding**, and the file records it in full — mechanism,
fix, the two lint errors it produced, the kill-test that proves the guard is load-bearing. What
never happened is the heading being re-read. So the plan advertised, in its own index, a
permanently-broken payments screen that had actually been fixed 92 rounds earlier.

For a reader scanning headings to decide what to work on, that is the worst possible shape: an
item that looks open, cheap to grab, and is actually done — while the genuinely open item hides
among 77 others.

## Verified against the tree, not the prose

The whole point of the finding is that prose in this file cannot be trusted, so I checked code:

| claim | where it lives |
|---|---|
| the conditional baseline seed | `RestaurantPaymentsScreen.tsx:542-545` — `if (originalsRef.current.drafts.length === 0)` … `draftsRef.current.map(...)` |
| the regression cases | `RestaurantPaymentsScreen.test.tsx:1425+`, a describe named no-primary-location-still-tracks-dirty (F40) |
| the device exact condition | those cases mock `getPrimary -> null` — the condition round 89 mocks had supplied a location for |

That last row matters beyond F40. Round 89 tests passed *because they were more generous than
the device*, and the round-90 block says so: `getPrimary` returned `{ id: loc-1 }`, taking
the `if (primary)` path the tablet never takes. The corrected cases vary the variable that
actually differs. **A mock can stop the input reaching the code just as effectively as a wrong
fixture value** — which is why the heading, not just the test, needed re-checking.

## The pattern, which this file documents about itself six times over

The plan header lists five to six prior corrections, all with one cause: *a pin lands and the
summary is not re-read.* Every correction is a **body** being stale.

F40 is the sharper case, and it is a different mechanism: **the body was already correct.** The
round-90 block below the heading was accurate, complete, and committed. Only the heading — the
thing actually read — lagged. A stale body misleads a reader who gets that far; a stale heading
misdirects a reader who never gets there, and the heading is what an index, a grep, or an
agent query for open work returns.

The mechanism is worth naming precisely: `####` headings are appended as new rounds land, so
the ENTRY accumulates updates while its TITLE never does. The title is written once, at the
moment of discovery, when the finding genuinely is open — which is exactly when it is most
likely to be wrong later and least likely to be revisited.

## Evidence

- The two contradictory headings, 50 lines apart in one file, both quoted above.
- 60 tests green across three suites after the edit: the payments screen (49) plus
  `planStatusAccuracy` and `planHeaderMatchesPinnedDefects` — the two guards that police this
  file, re-run to confirm the correction does not fight them.
- Every row of the verification table is a line number in the working tree.
- Also green this round: `coreRailToggleReach` and `deadSettingsKey` — 16 tests.
- Committed as `c492cb145`, one file, 18 insertions / 2 deletions.

## Still open, re-checked not assumed

The round-177 Escape-cascade defect. `PosScreen.tsx` is **still dirty** (hash `ff144486f`),
unchanged since round 176 — the blocker genuinely holds, verified by `git status --porcelain` this
round rather than carried forward on trust.

Two F2 halves were also checked this round and are resolved: `CartPanel.tsx:837` no longer has
the workspace override on `orderTypePromptEnabled` (P1/D2 removed it and says so), and the
remaining `|| activeWorkspace === restaurant-pos` at `:898` carries an explicit
INTENTIONAL rationale — table capture is part of what a restaurant POS is, so it is an owner
decision, not a leftover.

> last audited 18-10-26 by docs-auditor
