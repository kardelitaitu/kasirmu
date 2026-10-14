# Course firing: the half round 205 left (round 206)

## Why

Round 205 covered the course CHIP — how a line goes ON hold. This covers the firing ACTION
that takes it off hold to the kitchen. Together they are the whole `restaurant.course_firing`
mechanic:

```
assign a course  ->  coursingStatus 'hold'   (round 205)
fire the course  ->  coursingStatus 'fired'  (this round)
```

The gates are precise and worth pinning because the cost of getting them wrong is physical:
firing the wrong course sends food early, firing nothing leaves a table waiting.

```ts
fireCourse      ((usePosState.ts:215-223))  line.courseId === courseId && coursingStatus === 'hold'
fireAllCourses  ((usePosState.ts:228-236))  coursingStatus === 'hold'
```

Both use the FUNCTIONAL updater (`setLines(prev => prev.map(...))`) — the same form round 201
fixed the dispatch record to use, already correct here.

## What the spec pins — 3 passed

`ui/e2e/restaurant-course-firing.spec.ts`, desktop (portrait skips for the round-201 reason):

| Case | Asserts |
|---|---|
| the bar and its count | no holds means NO fire button at all; one Main hold makes `fire-course-main` appear carrying `1`; firing clears it |
| per-course isolation | firing Main leaves **Dessert on hold** — the whole point of per-course firing |
| batch fire | Fire All clears both courses AND the batch button itself, which renders only while something is on hold |

The first case's opening assertion is the one that grounds the rest: the bar is **a function of
the holds**, not a permanent fixture. A suite that only ever tested it WITH holds would not
notice if it became always-present.

**Kill-tested**: dropping the `courseId` comparison from `fireCourse` makes it fire every held
line, and fails exactly the isolation case. Restored byte-identical.

## The seed, carried forward

Course firing is **off by default** (`restaurantSettingsModel.ts:60`), so this spec seeds
`restaurant.course_firing` the same way round 205 does. Two specs now depend on that default
being documented — which is the argument for the seed living in a shared helper if a third
appears.

## Verified

| Item | Result |
|---|---|
| New spec | 3 passed, 3 skipped (portrait) |
| Kill-test | 1 failed, the isolation case |
| `usePosState.ts` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,707 passed |

## Coursing coverage now

| Surface | Round |
|---|---|
| the setting that enables it | 105, 189 |
| assign a course (the chip) | 205 |
| fire a course / fire all | **206** |

> last audited 14-10-26 by docs-auditor
