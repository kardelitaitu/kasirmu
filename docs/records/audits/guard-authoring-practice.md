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
ui/src/__tests__/OrderTypeDependentValueRule.test.ts   -> 8 detector cases + 17 source cases
(includes 1 value-handler case; 26 total. Re-measured 2026-10-14: the source side has grown
from the 6 this note recorded as more files acquired a dine-in-only gate — the DETECTOR
side is unchanged at 8, which is the half that cannot silently regress.)
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

## The misfires kept coming — rounds 15-19, and how they were caught

The six above were found one at a time, each by tripping over it. Rounds 15-19 added
**four more**, and the way they surfaced is the point: after the third, the response
changed from reacting to **sweeping**. Round 19 kill-tested all ten guards the session
had written, in one pass, and two blind spots fell out of the same file.

| Round | The misfire | How it presented |
|---|---|---|
| 15 | whole-call boundary by **forward search** | searched for the next `});`; on a ONE-LINE call that skips into the next toast, so a localized neighbour excused an unlocalized line. The guard passed with the defect on disk. |
| 17 | **two guards, one rule** | a `.tsx`-only scan never opened the hooks, and a pattern-anchored scan did not match them. The file both were written for was read by neither. |
| 18 | per-file **exemption** | a blanket `EXEMPT` hid a freshly injected literal in an exempt file — the list suppressed exactly the new defect it existed to bound. |
| 19 | **proximity** (again) | a fixed 1200-char lookback reached past the payload into a neighbouring literal that still held the key. |
| 19 | matched the **comment** | the payload's own comment explains why the key exists, and contains its name — `/orderType/` matched the PROSE after the key was deleted. |
| 19 | asserted the **identifier**, not the apply | `toContain('setOrderType')` passed with the condition replaced by `if (false)`; the call was still typed, just unreachable. |

### The two that are easiest to reproduce, as worked examples

**Matching a comment.** This is the one worth remembering, because the file looked
correct and the guard looked correct:
```
// orderType rides with the cart: a takeaway restored as dine_in comes back
orderType,
```
Delete the key; the comment still contains the word. Any `/name/` test on a span that
includes comments is testing the documentation, not the code. **Strip comments before
asserting on structure** — and note that a guard whose message says "payloads omit
orderType" will confidently report the opposite of the truth.

**Exempting a file instead of a count.** `Set<file>` versus `Map<file, number>`:
the Set cannot tell "this file has one known offender" from "this file has five".
A count bounds the debt; a flag hides it. The generalised form: **an allowance should
carry the quantity it allows.**

## Verifying the verification — a fourth step

Rounds 19 and 18 each wasted a cycle on a kill-test that *looked* conclusive and was
not:

- A grep pattern matched the `Duration` line rather than the `Tests` summary, so two
  **sound** guards were reported `BLIND`. Reacting to that would have "fixed"
  working code.
- An injection whose anchor was absent reported `MISS` and was read as a pass.
  Separately, a mutation was applied but a **harness bug** meant the mutated text was
  never scanned.

So step 2 gains a precondition: **assert the mutation landed before drawing a
conclusion from the result.** A kill-test where the injection silently did nothing is
indistinguishable from a guard with teeth — and both directions have now occurred in
this session, three times in total.

The shape that works:

```
const mut = live.replace(find, replace);
if (mut === live) throw new Error('injection did not apply');   // BEFORE running
write(mut); run(guard);
expect(guardFailed, 'the guard must fail on this mutation').toBe(true);
restore(live);
expect(read() === live, 'restore must be byte-identical').toBe(true);   // AFTER
```

### Sweep the guards, do not wait to trip

Round 19's value was not any single finding — it was doing the ten at once. A guard
author who has just learned a new misfire class should re-run the kill-tests they
already have, because the misfire is usually a property of the AUTHOR's habits, not of
one file. Two of the four above were in the same guard, and neither would have been
noticed without the sweep.

**Coverage at the time of writing: 10 guards, 16 mutations, 0 blind.**

Every guard this session wrote is now mutation-verified, one mutation at minimum:

| Guard | Mutations |
|---|---|
| `PosScreenOrderTypePersistence` | 5 — three payload keys, the restore condition, the restore apply |
| `PosScreenKitchenChitTable` | 1 |
| `PosScreenTableSyncReporting` | 1 |
| `PosListenerScopeClass` | 1 |
| `PosToastLocalization` | 1 |
| `OrderTypeDependentValueRule` | 1 |
| `TableManagementFloorSyncScope` | 1 |
| `RestaurantOrderTypeFieldConsumers` | 1 |
| `RestaurantPaxPersistenceOrderType` | 1 |
| `PaymentHookLocalizationScope` | 1 |
| (incidental subjects mutated while probing another case) | 2 |

Re-measure rather than trusting this table: a count copied forward is how the round-4
count misfire started, and this file has already carried one wrong number.

> last audited 14-10-26 by docs-auditor
