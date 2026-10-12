# Writing a guard that can actually fail (2026-10-12)

## Why this note exists

Across rounds 3-11 of the restaurant-POS work, **six guards were written wrong**. Every
one had the same root: the test was keyed to the **form** of the defect rather than its
**behaviour**. Each reported a good tree as broken, or a broken tree as good — and a
guard in the second category is worse than no guard, because it certifies the thing it
was built to watch.

| Round | The misfire | What it did |
|---|---|---|
| 3 | anchored on the bug's **shape** | stopped matching the moment the fix was applied, so a fixed tree read as broken |
| 4 | keyed to a **count** | asserted the rule appeared exactly once; two more sites shipped beside it and it stayed green |
| 8 | coupled to **line layout** | searched for `}, [` on one line; a comment above the deps split it and the guard reported the fix as a failure |
| 9 | keyed to a **field** | swept `tableNumber`; the identical defect on `guestCount` was invisible |
| 10 | keyed to **proximity** | a 16-line lookback excused a REVERTED guard because a neighbouring line carried the rule |
| 10 | keyed to **depth** | a brace-depth walk mis-read a gate reached through a nested callback |

## The rule that fixes all six

**Before trusting a guard's PASS, make it FAIL on purpose.** Concretely, in this order:

1. **Write the check.**
2. **Mutate a COPY** so the property is violated — revert the fix, or inject a fresh
   instance — and confirm the guard fails. Never mutate the working tree: round 45 of
   this session did that and had to restore a production file by hand because another
   agent was editing it at the same time.
3. **Score it against hand-built cases with known answers** before running it on the
   real tree, whenever the check *finds* things rather than *asserts a value*.
4. **Assert non-vacuity.** A scan that matches nothing reports exactly what a clean tree
   reports. Every scanning guard here needs a companion case proving it found
   *something*.

## The detector-under-test pattern

Step 3 is the one that changed the outcome. Round 10 attempted an enclosing-block
detector twice and both versions were wrong; neither was caught, because only the
whole-tree result was asserted. Round 11 built **eight hand-built cases** first —
including the two shapes that had defeated the earlier attempts — and scored each
model against them. The first two scored 3/5; the trace output showed exactly where
they were wrong. The third reached 8/8.

The cases now live **in the test file**, so the detector cannot silently regress:

```
ui/src/__tests__/OrderTypeDependentValueRule.test.ts   -> 8 detector cases + 6 source cases
```

That file is the worked example. Two details from it generalise:

- **Two questions, two tests.** On the derivation line the rule appears as a
  *ternary*, so any mention gates it. On an enclosing line it must be an
  *`if (…)`*, because only an `if` opens a scope. Round 10 used one test for both.
- **A brace STACK, not a depth counter.** Depth cannot say *which* line opened the
  scope you are in, and that is the question being asked.

## When a guard genuinely must be narrower than the ideal

Round 10 shipped a hand-written allowance for one block-gated case, because the
general check was not yet trustworthy. That was the right call **provided the
limitation is stated in the file** — it was, and round 11 removed it. The failure mode
to avoid is a narrow guard presented as a broad one.

## Where this sits beside the repo's existing practice

The Python guards already use a `--self-test` flag for exactly this reason
(`scripts/check-client-type-drift.py`, `allowlist-schema.py`, `check-merged-lines.py`,
and others). The UI-side guards had no such norm, which is why six of them shipped
form-coupled. This note is that norm, written down where the next UI guard author will
find it.

## A note on what counts as behaviour

The distinguishing question is not "is this test specific?" but "**what would have to
change for this to stop catching the defect?**" A guard that stops matching when the fix
lands, or when a comment moves, or when a second instance appears, is keyed to form. A
guard that keeps failing while any instance of the behaviour exists is keyed to the
behaviour.
