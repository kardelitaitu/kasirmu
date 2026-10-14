# The fourth F4 latch is unreachable, and the mechanism is three lines (round 234)

## The answer round 233 asked for

Round 233 narrowed to one experiment: count invokes inside the card's effect. Done, and it
settled everything.

## The measurement

With the read forced to reject, naming every call through the app's own DEV log:

```
SETTING_CALLS = ["get_setting_scoped:started", "get_setting_scoped:failed"]
OUTCOMES      = 24 x 'failed'  (across three modal opens)
BANNER        = 0        RETRY = 0
```

**The read genuinely fails, repeatedly, and the banner never appears.** This eliminated round
233's first hypothesis (a read that never happens) and its second (a catch never reached).

## The mechanism

```ts
:98   if (reloadNonce === 0 && originalsLoadedForRef.current === sessionToken) return;
:99   originalsLoadedForRef.current = sessionToken;
:105  getSettingScoped(...).then(...).catch(() => { if (cancelled) return; setLoadFailed(true); })
:121  return () => { cancelled = true; };
```

`main.tsx:23` wraps the app in `<React.StrictMode>`, so an effect runs, is cleaned up, and runs
again:

| Step | What happens |
|---|---|
| run 1 | `:98` falls through (the ref is undefined) → `:99` SETS it → the read starts |
| cleanup | `cancelled = true` |
| run 2 | `:98` sees ref === token → **RETURNS**, so there is no second read |
| result | run 1's failure reaches `:117`, `cancelled` is true, so `:118` is **SKIPPED** |

**The latch is set before the read, and the read that runs belongs to the run that was
cancelled.** `setLoadFailed(true)` is unreachable.

## What it costs in production

The card shows `courseFiring: false` — its default — from a read that FAILED, and Save stays
ARMED. That is the F4 loss the comment at `:113-116` says the guard exists to prevent:

> Seeding `courseFiring: false` here was the F4 loss.

The seeding was removed; **the operator is still shown a default they cannot distinguish from a
real value, and can save it over the merchant's setting.**

## What the spec pins — 4 passed, both projects

| Case | Asserts |
|---|---|
| the defect | the read **genuinely fails** (counted from the app's own log), and the banner and retry are ABSENT |
| what the operator sees | the card's controls render normally over that failed read — the shape of the loss |

The failure count is asserted FIRST, for round 226's reason: an empty reading is evidence about
the instrument until the instrument is shown able to see a positive. Without it, the absence
assertion could pass on a read that never happened.

**The fix was not attempted.** It is a component-internals change — the latch must be set after
the read resolves, or the cleanup must not discard a failure whose arrival proves it was needed —
and the right fix depends on which semantics the card wants for a session switch. Establishing
the mechanism beyond doubt is what makes that a deliberate choice rather than a guess.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Failures observed | 24, across 3 modal opens |
| Mechanism | read from the source and consistent with every measurement |
| Source changed | none |
| eslint | 0 |
| Full UI suite | 12,713 passed |

## The F4 set, now fully explained

| Screen | Round | State |
|---|---|---|
| receipts | 223 | guard works, tested |
| payments | 227 | guard works, tested |
| settings | 230 | guard works, tested |
| **workspace card** | 231-234 | **guard CANNOT fire — mechanism named, defect pinned** |

Four screens, one pattern, and ONE implementation where the pattern does not work. That
distinction took four rounds to establish, and it is the kind that a coverage table would have
hidden: the card has an `loadFailed` state, a banner, a retry and a disabled-Save rule, and none
of them can ever run.