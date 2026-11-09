# Four stale citations, and a checker that only enforces half its rule — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 173 - status: 4 stale line citations
     repaired in a CLEAN file; the remaining 3 attributed to another lane in flight - branch:
     0.0.41 - commit: 66312eb69 -->

<!- - Scope: verify round 172 fix held, then continue in the restaurant POS lane. The find was
     incidental to auditing a payment module. -->

## The module that provoked it, and why it deserves naming

`splitDistribution.ts` (the arithmetic behind Split Evenly) is an unusually well-built 84
lines, and auditing it is what led to the real finding. It documents its own law, its
`count === 0` choice, and — the part that matters — a **known limitation it pre-emptively
pinned**:

> THE DOMAIN IS NON-NEGATIVE ... Measured (round 301, probe since deleted):
> `distributeEvenly(-1, 2, 0)` returns `[ '-1', '-2' ]`, which sums to -3 rather than -1

The test file pins that with four negative-total cases under a case literally named
"KNOWN LIMIT: is not total-preserving for negative totals (unreachable today)". I verified both
of the caller clamps the safety argument rests on (`useTenderMath.ts:116` clamps at zero,
`:127` floors a parsed negative) — **both exist and do exactly what the doc claims**. So the
module is sound, and I am recording that rather than manufacturing a finding from it.

## The real finding: four citations the checker reports but does not enforce

The doc cites those two clamps at `:96` and `:170`. They are actually at `:116` and
`:127` — the argument holds, the line numbers drifted. That is a minor thing on its own, and
it is why I ran the checker: `featureCommentPaths.test.ts` **enforces** only citations
pointing at a blank line or past EOF, and merely REPORTS citations that land on wrong-but-real
content (its own docstring says so at :312-330). A drifted pointer to a real line is therefore
invisible to the gate.

Running it surfaced four citations that DO trip the enforced half — all caused by files
shrinking under other lanes.

## Attribution first, then the repair

`TableManagementScreen.tsx` is clean at HEAD, so its citation was mine to fix. `PosScreen.tsx` is
dirty — another lane is mid-edit on the restore effect — so its three are theirs, and I left
them alone. That split is the whole reason to check `git status` per file before editing: fixing
a file someone else is holding is how you sweep in their work.

In the clean file I found **four** stale citations, not the one the checker named — the same
lesson as round 170 (a failure message names a subset of what changed). All four were in the
two RE-ENTRY GUARD comments, and every one pointed at unrelated content:

| cited | actually at | the thing |
|---|---|---|
| `:1957` | `:2878` | the Reserving button disabled attribute |
| `:1880` | `:2801` | the reservation form onSubmit |
| `:773` | `:861` | the holdCartScoped call it names |
| `:2187` | `:2453` | the save-table form onSubmit |

The cross-file citation in the same comment (`kasirmu-core/src/db/tables.rs:130` for `create_table`)
was verified correct and left alone — three of four drifted is not a reason to assume the
fourth did.

## Evidence

- The clamps verified by read: `useTenderMath.ts:116` and `:127`.
- After the repair the checker reports **3** offenders, all `PosScreen.tsx` — down from 4, with
  `TableManagementScreen.tsx` gone. That is the proof the repair landed.
- `npm run typecheck` PASS (0 errors).
- Commit `66312eb69` -> exactly 4 changed lines in one file (4 insertions, 4 deletions),
  all four confirmed in the diff.

## Carried forward

1. `PosScreen.tsx` has 3 dangling citations that its OWNING lane should fix when it lands —
   its edits are what shrank the file. Re-check after it settles rather than editing under them.
2. The structural gap worth a future round: `featureCommentPaths` enforces dangling citations but
   only REPORTS drifted ones. This round found four drifted in one file by accident while
   fixing a dangling one. A drift report is printed today and read by nobody; whether it should
   be enforced is a real question, but not one settleable without first measuring the
   population (its docstring measured 199 flagged of 239 at round 131, and warns that failing
   on all of them "would make this guard noise").
3. The 197px scroll defect closed in round 172 stayed closed through this round gates.

> last audited 18-10-26 by docs-auditor
