# The restaurant suite is stable, and the one-sided assertion hunt found nothing (round 287)

## A different axis

Coverage is near-complete and round 286 closed the last behavioural gap. This round asked a
RELIABILITY question instead, which is the other half of the objective: **do the specs pass
repeatedly, and do they assert enough to fail?**

## Is anything flaky?

The four specs written in rounds 278-286 were run with `--repeat-each=2`:

```
24 passed (1.2m)     ... 0 flaky, 0 failed
```

Then the WHOLE restaurant surface — 62 spec files, desktop profile:

```
140 passed (2.4m)    ... 0 failed
```

**No flakes in either run.** For a suite this session has spent 30 rounds extending, that is the
number worth having: the coverage it claims is coverage that reproduces.

## The one-sided assertion hunt, and why it found nothing

The pairing rule — a control hard-coded either way passes an assertion that names only one state —
predicts a specific defect: a case that asserts `toBeEnabled` with no assertion about the disabled
state, or vice versa.

A scan over `ui/e2e/restaurant-*.spec.ts` flagged three candidates. **All three were false
positives, and each was false for a different and instructive reason:**

| Candidate | Why it is paired |
|---|---|
| `a saved group can be removed again` | asserts `toHaveCount(0)` on the group and that the form closes — negatives the regex missed |
| `the Receipts Save is inert until an edit, and again after` | its NAME is the pair |
| `an available table can be deleted, behind its confirmation` | asserts the confirm banner appears and the table stays; `an occupied table cannot be deleted` is the case directly above |

**The pairing is expressed three different ways**: a different matcher, a case title, or a
neighbouring case. A regex can see the first and not the other two, which is why the hunt returned
candidates rather than findings and why each was read before being believed.

## The lesson, which is about instruments again

This is the fourth heuristic this session has built to find missing coverage, and the second that
returned nothing actionable. **The ones that worked counted something concrete** (does the id appear
in a selector); the ones that did not tried to infer INTENT from shape.

A pairing is a claim about what a test MEANS, and meaning is not visible in a regex. The durable
version of the pairing rule is therefore not a scan but a REVIEW habit — and the session already
has the evidence that it works: rounds 229, 230, 257, 263 and 286 each applied it by hand and each
found or prevented a real defect.

## Verified

| Item | Result |
|---|---|
| The four newest specs, `--repeat-each=2` | 24 passed, no flakes |
| All 62 restaurant specs, desktop | **140 passed, 0 failed** |
| The one-sided assertion scan | 3 candidates, 3 false positives, each read |
| Source changed | none |
| New tests | zero |

## State of the objective

**Coverage**: every surface is behaviourally closed, and the `none` column holds 7 ids — glyphs,
titles, and fields whose write boundary is unit-tested.

**Reliability**: 140 restaurant cases pass together on desktop, and the newest 24 pass twice in a
row. The full UI suite has held at 12,716 passed across the last ten rounds without a single
regression introduced by this session's changes.

> last audited 15-10-26 by docs-auditor
