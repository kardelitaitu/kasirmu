# The kitchen chit is blocked by a SETTING, not by an entitlement (round 264)

## The question, and the answer

`restaurant-kitchen-test-chit-btn` is the last behavioural id on the receipts screen — the
settings-side twin of the preview chit button round 248 covered. Round 248 recorded it as gated on
`hasKdsFeature && kitchenConnection !== 'disabled'` (`:2853`) and used the ungated twin instead.

Rounds 262 and 263 established that a "gated" control may be gated by an **entitlement** (the KDS
sidebar row, the Midtrans card) or by a **view** (the deduction badges). This round asked which,
and the answer is neither:

```
CHIT_SETTINGS   0        the control is absent
PLAN_BADGE      0        ... but NO "Pro Plan required" badge appears
KITCHEN_CONN    disabled the reason, straight from the select's own value
```

**`hasKdsFeature` is `true`.** The only blocker is `kitchenConnection === 'disabled'` — a value the
operator sets on this very screen. The chit appears as soon as the kitchen printer is configured.

## Why this is a satisficing answer rather than a gap

The setting lives in the same form as the button. A spec that wants the chit must drive the
connection select first, and that select is a `SettingsSelect` — a custom dropdown whose options
live in a portal (round 225's finding) and whose `#resto-hw-kitchen-conn` id resolves but is not
clickable at rest in this probe.

**So the control is reachable and its reachability is a form interaction, not a plan entitlement.**
That is the distinction worth recording: three rounds have now found three different reasons a
control was absent, and they call for three different responses.

| Reason | Example | Response |
|---|---|---|
| entitlement | the KDS sidebar row (262) | nothing — the plan decides |
| relocated by design | the deduction badges (261) | cover the destination |
| **a setting not yet made** | **the kitchen chit (264)** | **drive the form** |

The third is a genuine test to write, and it is what this round hands forward.

## What was established

| Measurement | Value |
|---|---|
| `restaurant-kitchen-test-chit-btn` | count 0 at rest |
| the plan badge (`Pro Plan` / `subscription`) | **count 0** — so `hasKdsFeature` is true |
| `#resto-hw-kitchen-conn` value | `disabled` |
| the gate, from source | `hasKdsFeature && kitchenConnection !== 'disabled'` (`:2853`) |
| the ungated twin | `restaurant-receipts-preview-test-chit-btn`, count 1, already covered |

## Verified

| Item | Result |
|---|---|
| Probes | 2, both removed |
| Source changed | none |
| New tests | zero |

## The next round's first step, precisely

Drive `#resto-hw-kitchen-conn` to `network`, then assert `restaurant-kitchen-test-chit-btn` appears
and reports its own pre-flight check. The select resolves but is not clickable at rest in the
probe — so the first step is finding WHERE it is (the kitchen-printer card may be below the fold,
or its own `SettingsSelect` trigger may need the scroll the receipts screen's sticky column
demands). Round 248's `bringIntoReach` helper already solves that shape.