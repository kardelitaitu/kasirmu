# The acceptance spec's clip rule, validated against a probe that lacked it (round 271)

## What this round set out to do

Round 270 strengthened the scan by separating mentions from selector uses. This round looked for
the next weakness in the same family: a spec that has one `expect` and might be asserting nothing.

A crude scan found **26 cases with two or fewer assertion calls**, and most were legitimate —
`expect.poll(...).toBe(...)` is one assertion written as two calls. But two of them were the
**acceptance specification** itself (`restaurant-memo-clearance.spec.ts`, round 255), which should
be the strongest file in the tree. So it was read rather than counted.

## The finding

Its receipts case asserts:

```ts
const occluded = await occludedControls(page);
expect(occluded.filter((id) => id.includes('receipts')), ...).toEqual([]);
```

A probe written to reproduce that case reported **both receipts controls as occluded**:

```
AFTER_RESET=["restaurant-receipts-preview-test-chit-btn","restaurant-receipts-test-drawer-btn"]
```

...while the spec **passes**. The difference is one block the spec has and my probe did not:

```ts
let clipped = false;
for (let n = el.parentElement; n; n = n.parentElement) {
  const cs = getComputedStyle(n);
  if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue;
  const nr = n.getBoundingClientRect();
  if (r.top >= nr.bottom - 1 || r.bottom <= nr.top + 1) { clipped = true; break; }
}
if (clipped) continue;
```

Adding it to the probe turned both results into `CLIPPED:...` — so the controls are **outside the
sticky column's own box**, not covered by the stack. The clip is the column's `overflow-y: auto`,
which is the clearance rule round 255 added: an operator scrolls the column to reach them.

**The spec was right and the probe was wrong.** Round 255's clip rule is not decoration; it is
what makes the acceptance test's claim true rather than vacuously strict.

## Why this is worth recording rather than moving past

It is the **fourth time in this session that a probe of the acceptance test disagreed with the
test**, and the third where the probe was the wrong one. The pattern across all four:

| Round | The probe lacked |
|---|---|
| 251 | the content-load wait |
| 260 | opening the cart |
| **271** | **the clip rule the spec carries in its own helper** |

**A probe written to reproduce a spec must copy the spec's instrument, not just its steps.** The
helper is not scaffolding around the assertion — for `occludedControls` the helper IS the
measurement, and reimplementing it from the shape of the call produced a different answer.

## Verified

| Item | Result |
|---|---|
| The acceptance spec | passes, and its clip rule is load-bearing |
| The probe without the rule | reports 2 false occlusions |
| The probe with the rule | reports both as `CLIPPED`, matching the spec |
| Probes | 3, all removed |
| Source changed | none |
| New tests | zero |

## The honest state of this round

**No defect found, no test added.** The round's output is a negative result with a reason: the
1-expect count was a false signal, the acceptance spec is sound, and the apparent contradiction was
an incomplete reproduction.

That is worth stating plainly because a round that ends with "nothing was wrong" reads the same as
a round that found nothing, and they are different: this one **checked a suspicion and retired
it**, which is what the round-254 specification asked of the CSS and what the same standard asks of
the tests.

> last audited 15-10-26 by docs-auditor