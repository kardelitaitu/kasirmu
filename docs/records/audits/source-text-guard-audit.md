# Twenty-eight source-text guards audited; one family was weak, one was exemplary (round 171)

Round 170 found a guard that asserted on source text and passed for the wrong reason. The
systemic question is how many others do the same, so this round answered it rather than
assuming the answer.

## The audit

Tests under `ui/src/__tests__` that both `readFileSync` a production file and assert with
`.includes(...)`: **28 of them**. Grouped by what they were FOR, they fall into three kinds:

| Kind | Example | Verdict |
|---|---|---|
| A defect is known to exist and the guard records it | `edcDefaultPropCaller.test.ts` (round 113's F49: the EDC default prop has no caller) | **correct** — asserting the defect's presence is the claim |
| A property is graded over a corpus | `screenExtraction.test.ts` | **exemplary** — see below |
| A single spelling is required | `posDraftStoreScoping.test.ts` (`scopedKey`) | **weak before round 170**; the per-key spelling is now required |

## `screenExtraction` is the model this round measured against

323 tests, and the part worth recording is that it defends itself against VACUITY explicitly —
five self-checks in the shape `expect(index.size).toBeGreaterThan(100)`, whose message names
the failure (*"no selectorOnlyClasses name is silently excusing…"*, *"inert-prefix arm graded
only…"*). Asserting a corpus size is what makes an empty corpus fail loudly instead of passing
silently — the exact opposite of round 170's substring that matched the same text either way.

Proved, not assumed: raising the three thresholds to `9999` fails **2 of the 3** sites, restoring
the suite to 323 passed. So those guards bind to real corpus sizes rather than to any number.

## What this did NOT establish

No guard other than `posDraftStoreScoping`'s `scopedKey` arm was kill-tested. The 28 were read
and classified, not each mutated — a full audit would be 28 rounds' worth of kill-tests, and the
classification above is the cheap part. The conclusion is therefore **the weak pattern is
rare**, not that it is absent.

One case is worth a second look rather than closed: `salesLiteralSingleSource.test.ts` (4
includes) and `tabletWorkspaceGrid.test.ts` (4) are the next two to check, because a
single-spelling claim is exactly the shape round 170's was.

## Verified

| Item | Result |
|---|---|
| Source-text guards found | **28** |
| Kinds classified | three |
| `screenExtraction` vacuity arm | **2 of 3 thresholds killed**, then restored to 323 passed |
| Kill-tests performed this round | 2 (on screenExtraction only) |
| Tree | no source changed this round |
| Full UI suite | 12,688 passed |