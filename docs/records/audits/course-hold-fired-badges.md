# The hold-to-fired transition on the line chip (round 208)

## Why this round

Rounds 205 and 206 covered the course chip and the firing bar, and round 207 consolidated the
helpers around them. The one piece left was the STATUS BADGE the chip itself renders — the 2026
equivalent of round 204's Sent/New pair, one layer up:

```tsx
{line.coursingStatus === 'fired' && <span data-testid="cart-line-course-status-fired">✓</span>}
{line.coursingStatus === 'hold'  && <span data-testid="cart-line-course-status-hold">⏸</span>}
```

Both were unreferenced. They are the waiter's at-a-glance answer to "is this course with the
kitchen yet?", which is the whole reason coursing exists.

## What the spec pins — 4 passed

Added as a fourth case in `restaurant-cart-line-course.spec.ts`, so the chip's whole lifecycle
sits in one file:

| Step | Asserts |
|---|---|
| no course | NEITHER badge — a badge appears only once the state it reports exists, the same gating round 204 found on Sent/New |
| assign | the line is ON HOLD (⏸) and not fired |
| fire | the badge flips to FIRED (✓) and hold is gone |

The middle assertion matters as much as the last: without it, a chip that rendered ✓ immediately
on assign would pass a spec that only checked the end state.

**Kill-tested**: making `fireCourse` write `'hold'` instead of `'fired'` fails **three cases across
two specs** — this one plus both firing cases in `restaurant-course-firing`. Restored byte-identical.

## Verified

| Item | Result |
|---|---|
| Course spec | 4 passed, 4 skipped (portrait) |
| Kill-test | 3 failed across 2 specs |
| `usePosState.ts` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,707 passed |

## Coursing, now complete

| Surface | Round |
|---|---|
| the setting that enables it | 105, 189 |
| assign a course (the chip) | 205 |
| fire a course / fire all (the bar) | 206 |
| the chip's hold / fired badges | 208 |
| shared setup helpers | 207 |

**`CartLineItem` coverage moved 2 -> 12 of 17** across rounds 204, 205 and 208. What remains is
the modifier pair (`add-modifier-btn`, `edit-modifiers-btn`, `modifiers`) and the price-override
button — a coherent next slice rather than a scattering.