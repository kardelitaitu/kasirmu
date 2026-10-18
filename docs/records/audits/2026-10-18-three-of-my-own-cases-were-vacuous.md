# Three of my own cases were passing vacuously — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 200 · status: audited my OWN round-196
     suite for the control discipline I had spent three rounds enforcing on others; three of
     seven cases passed against a no-op handler and proved nothing · commit: 393f7dd3e -->

<!-- Scope: round 200. Check the goal, then audit my own recent work by its own standard. -->

## What prompted it

Rounds 196-199 established a discipline: before trusting a scan or a suite, run a positive
control. Round 199 ended with *"a validated instrument plus a suspicious hit is a contradiction
to resolve"*. So the obvious question this round was whether MY OWN suites from that stretch
satisfy it. They did not.

## The measurement

Auditing `useCartKeyboardNav.test.tsx` (written in round 196, 7 cases): it has
**no positive control**, and **four of seven cases assert only negatives**
(`not.toHaveBeenCalled`). If the handler never ran, those four would pass.

I replaced `handleCartPanelKeyDown` with an immediate `return` and re-ran:

```
BEFORE the fix:   4 failed | 3 passed
  × ArrowDown moves focus…            <- positive case, correctly died
  × ArrowUp from nothing…             <- positive case, correctly died
  ✓ ignores every key while focus is in an INPUT      <- VACUOUS
  × Enter pays, but ONLY when…        <- positive case, correctly died
  × resolves the line from data-line-id…              <- positive case, correctly died
  ✓ does nothing for + / - / Delete…                  <- VACUOUS
  ✓ does not preventDefault on a key it does not handle <- VACUOUS
```

**Three of seven cases proved nothing.** They passed against a handler that does literally
nothing, which is the failure mode this session had already corrected twice in other people
files and never once checked in its own.

## The fix

Each vacuous case now opens with a POSITIVE CONTROL that presses a key the handler DOES act on,
asserts that it acted, then clears the spy before the negative assertion:

| case | control added |
|---|---|
| input guard | press + on the ROW first; assert a quantity DOES change |
| no line under the key | press + INSIDE a row first; assert it DOES act |
| unhandled key | press ArrowDown first; assert it IS consumed |

After the patch the same no-op mutation kills **7 of 7**:

```
AFTER the fix:    7 failed (7)
```

So the suite now has the property it claimed to have — every case depends on the handler being
live. Production is unchanged; only the test file moved.

## Two intermediate errors, both worth naming

1. **My first mutation never applied.** I ran a regex replace, saw 7/7 still passing, and
   briefly concluded the whole suite was vacuous. The anchor did not match the file actual
   indentation, so `replace` was a silent no-op and I was testing unmutated code. **A
   mutation that does not apply reads identically to a suite that ignores it** — the same
   false-negative shape as the broken controls in rounds 198 and 199. I now verify the mutation
   landed before reading any result.
2. **The correct reading was in between.** Not "all 7 vacuous" and not "0 vacuous": exactly the
   three cases that only assert negatives. Which is what you would predict, and what measuring
   rather than reasoning told me.

## Verified

| check | result |
|---|---|
| suite after the fix | **7 passed** |
| no-op kill-test after the fix | **7 failed** (was 4 failed / 3 passed) |
| production file | restored byte-identical (`8a1ad07cf994831b`), unchanged |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors |

## The rule, now applied to my own output

**A case that asserts only a negative must include a positive control in the same case.**
"It did not do the wrong thing" is satisfied by a component that does nothing at all — and a
no-op is exactly what a broken mock, a renamed prop, or a handler that never mounted produces.
Rounds 191-193 applied this to screens I did not write; round 200 found it three times in one
file I did.

Also worth carrying: **verify the mutation landed before reading the result.** A failed
`replace` and an ignored mutation produce the same green suite, which is how a
self-audit can report the opposite of the truth.

> last audited 18-10-26 by docs-auditor
