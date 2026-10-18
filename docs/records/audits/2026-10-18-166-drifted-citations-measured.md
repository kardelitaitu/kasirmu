# 166 drifted citations: the population round 173 asked for — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 174 - status: the drift question is
     ANSWERED with a measurement (166 flagged, 75%, mostly real); 1 citation repaired and
     verified; the class deliberately NOT enforced, with the reason - branch: 0.0.41 -
     commit: 4769d0774 -->

<!- - Scope: settle the question round 173 left open — should the DRIFT half of
     featureCommentPaths be enforced? It said that needed a population measurement first. -->

## The measurement

```
[featureCommentPaths] same-file citations: 213 total, 53 in range, 160 to review
```

**75% of same-file citations are flagged.** Ranked by file:

| flagged | file |
|---|---|
| 26 | `features/sales/PosScreen.tsx` |
| 22 | `features/retail/RetailPosScreen.tsx` |
| 19 | `features/tables/TableManagementScreen.tsx` |
| 9 | `features/restaurant/screens/RestaurantPaymentsScreen.tsx` |
| 9 | `features/sales/SalesHistoryScreen.tsx` |

166 entries across 41 files; **92 of them in this lane** (sales/restaurant/tables/kds/payment/currency).

## Is the checker right, or is the heuristic noisy?

This is the question that decides the answer, so I hand-verified a sample rather than trusting
either side. Taking four flagged citations and reading both lines plus searching for where the
claim actually lives:

| cites | actually at | the claim |
|---|---|---|
| `ExchangeRateScreen.tsx:152` | `:219` | the catch arm of toggleAutoSync |
| `StockCountDetail.tsx:246` | elsewhere | the sc-badge family it names |
| `OfflineQueueScreen.tsx:157` | elsewhere | a specific `useEffect(() => { load(); }, [load])` |
| `TransactionLogScreen.tsx:256` | `:256` | CORRECT (my own round-155 comment) |

Three of four were genuinely drifted, one was a false positive. So the headline claim holds:
**the flagged set is mostly real drift, not heuristic noise.** The checker is measuring
something true.

## The answer: do NOT enforce it, and the reason is arithmetic

Enforcing drift means failing on 166 citations across 41 files. The file own docstring already
warned about exactly this ("failing the suite on 199 pre-existing citations would make this
guard noise, and the tree would learn to ignore it"), and the measurement now backs it: a gate
that is red on 75% of what it inspects from day one is a gate nobody reads. That is how the
E2E suite got into the state rounds 162-172 had to dig out of.

The productive instrument is therefore a BURNDOWN, not a gate: fix the citations in this lane
file by file, highest-count first, and revisit enforcement once the count is small enough that
red means something. Round 173 fixed four; this round fixed one; 92 remain here.

## The one repaired this round

`ExchangeRateScreen.tsx:156` cited `:152` for "the catch arm of toggleAutoSync".
`:152` is a comment about a DIFFERENT guard, and `toggleAutoSync` itself does not start until `:206` —
the citation was 54 lines off and pointed at unrelated prose. The catch arm is at `:219`.
Repaired and verified: line 219 is `} catch {`, exactly what the comment claims.

After the repair the checker reports **159 to review** (from 160) and no longer names
`ExchangeRateScreen` — which is the proof the fix landed, not merely that a file was touched.

## Evidence

- Population: the checker prints its own denominator; 213/53/160 is that output, not an
  estimate.
- The 166-entry per-file ranking is parsed from the same printed report.
- Hand-verification of four citations, three drift and one correct, is in the transcript with
  both the citing and cited lines shown.
- Repair verified by re-running the checker (160 -> 159, file no longer listed) AND by reading
  line 219 to confirm it holds the catch arm.
- Commit `4769d0774` -> exactly 1 changed line.

## Carried forward

1. The burndown is now SIZED and RANKED. Next round should take `RetailPosScreen.tsx` (22) or
   continue in the restaurant surfaces; do not attempt 92 in one round and do not gate on it.
2. `PosScreen.tsx` remains untouchable while another lane holds it — 3 dangling citations and
   parts of its 26 drifted ones will move under their edits, so re-measure after it lands.
3. Enforcement stays OFF until the count is small. The number to watch is the one the checker
   prints; a target under ~20 would make a gate meaningful without making it noise.

> last audited 18-10-26 by docs-auditor
