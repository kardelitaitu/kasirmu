# Move Table, driven for the first time (round 195)

## Why it was unreachable

Move and Merge a table's tab are gated on `activeBill` (`TableManagementScreen.tsx:1154`) —
they exist only for a table with an open bill. Round 192 found the seeded plan carries no bills,
so round 164 could verify their candidate filters only by READING, and recorded them as
unreachable-guarded. Round 193's spec-level bill seed makes them reachable; this round drives
them.

## What the spec pins — 4 passed

| Case | Asserts |
|---|---|
| destination list | Move exists for the billed table, opens its modal, and every offered destination is a table that is NOT occupied |
| the move completes | choosing the destination and confirming frees the SOURCE table to available |

The first is the safety property: `:1373` filters destinations to `status === 'available'`, and
moving a tab onto another occupied table would put two parties on one bill. The modal also has a
legitimate empty state ("No available tables to move to") which the spec accepts and asserts is
SAID rather than rendered blank — on a plan that is fully occupied, the branch is correct.

**Kill-tested**: dropping `t.status === 'available'` from the candidate filter fails the
destination case. Restored, byte-identical to HEAD.

## The error this round, and it is a good one

The first draft compared destinations to occupied tables with `String.includes`, and failed on:

```
destination Table 12 (4 seats · Patio) must not be the occupied table Table 1
```

`Table 12` contains `Table 1`. **The CODE was right — my assertion invented the collision.**

This is the exact false-positive class `matchesTableBill` avoids with a word boundary
(`tableLabel.ts:88-89`), and the fixture simply contains a plan where it bites. Fixed by reading
each option back to its `Table N` name and comparing exactly.

Worth recording because the failure message pointed at the product while the defect was in the
test: a substring check on identifiers that are prefixed numbers will collide, and the screen's
own matching code had already solved this problem.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed |
| Kill-test | 1 failed, the intended case |
| `TableManagementScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,703 passed |

## Table coverage, four rounds on

| Surface | Round |
|---|---|
| form + Save gate | 165, 167 |
| floor plan live | 177 |
| release confirmation | 193 |
| delete guard | 194 |
| move a tab | 195 |

Merge remains — same gate, same shape, and now reachable by the same fixture.

> last audited 14-10-26 by docs-auditor
