# The QRIS field mounts late, and the bisect is solid while the spec still fails (round 285)

## The question round 284 inherited

Round 284 bisected the failure and recorded the field as absent for 20 seconds. This round set out
to resolve the contradiction that measurement created: a probe finds the field in 1.2 seconds, and
the spec that follows it cannot find it in 20.

## The bisect, exactly

```
T0=0                 the field is absent the moment the helper returns
T1_after_header=0    asserting restaurant-payments-header does NOT add it
T2_after_wait=1      1.2 seconds later it mounts
T3_after_label=0     clicking the card's label toggle COLLAPSES it
```

So the field mounts late, the header is not the wait, and the toggle click is harmful. All three
findings are solid and reproducible.

## What did NOT resolve it

The corrected spec — same helper, header asserted, field awaited with a 20-second timeout — **still
fails on both profiles**, and it fails identically with `--workers=1`, so parallelism is not the
cause. The probes that succeeded and this spec share the helper, the route and the device; the
remaining difference is one of the following, and this round did not isolate which:

| Difference | Note |
|---|---|
| the probe asserted a DIFFERENT header anchor | the probe used `restaurant-payments-header` too, so this is not it |
| the probe waited 1.2s where the spec awaits a locator | plausible — a locator wait re-queries and may race the mount |
| the spec asserts `qris-mode-static` between the two waits | possible |

**A probe that cannot be made to fail alongside a spec that can is a difference not yet named.**
That is round 226's shape in a new form, and this round did not close it.

## The honest state

| Claim | Status |
|---|---|
| `qris-static-payload-input` writes through a unit-pinned transform | **verified (284)** |
| The field mounts late, after the rail read resolves | **measured this round** |
| The QRIS card is already expanded; a toggle click collapses it | **measured this round** |
| The e2e round trip | **NOT proven — the spec was removed uncommitted** |

## Why it was not committed

Round 284 withdrew the attempt as an instrument failure and this round confirmed that reading
rather than fixing it. **The spec is not shippable while a probe of the same route succeeds**,
because a test that cannot reach its own control is worse than a missing one — it reports a defect
on a screen that behaves correctly in a browser.

## Verified

| Item | Result |
|---|---|
| Bisect | 4 measurements, all reproducible |
| The corrected spec | fails on both profiles, fails alone |
| Probes | 2, both removed |
| The incomplete spec | removed — nothing unproven committed |
| Source changed | none |
| New tests | zero |

## The next round's first step

Replace the locator waits in the spec with the probe's fixed delay and assert ONLY the round trip —
no intermediate assertions. If it passes, add the intermediate guards back one at a time and the
failing one names itself. **Bisecting by removal is cheaper than bisecting by hypothesis**, which
is the mistake this round made.

> last audited 15-10-26 by docs-auditor