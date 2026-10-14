# The third F4 latch, and the strongest of the three (round 230)

## Why this round

The restaurant feature grew F4 load-failure guards on three screens **independently** — receipts
(covered round 223), payments (round 227) and settings. This was the third, and its comment states
the property most precisely:

> Shown INSTEAD of trusting the controls. The values below are the model's defaults, not the
> merchant's, so the banner says the read failed and Retry re-runs it. **Save is disabled above.**

And the guard behind it (`:205-208`):

> Refuse to present a loaded state we cannot vouch for: no values are seeded, so `originalsRef`
> keeps its previous contents, `dirty` cannot read a false "clean", and the Save button stays
> disabled. **Seeding defaults here is precisely the F4 bug.**

## Why this one is the strongest

On receipts and payments the guarded surface is a settings FORM; here the controls render **the
model's own defaults** when the read fails. An armed Save then writes those defaults over the
merchant's real settings — so the disabled-Save assertion is not defensive, it is the data-loss
guard itself.

## What the spec pins — 4 passed, both projects

| Case | Asserts |
|---|---|
| the failure | banner visible with `role="alert"`, **Save DISABLED**, Retry offered |
| the retry | the banner clears, Save is still disabled (nothing to save), and an edit arms it again |

The second case's last two assertions are what make the recovery real: a banner that cleared while
Save stayed disabled would leave the screen **read-only for the session**.

**Kill-tested**: dropping the `setLoadFailed(true)` latch fails **both** cases — without it there
is no banner and `dirty` reads a false clean, which is exactly the F4 bug the comment names.
Restored byte-identical.

## A write-time hazard worth recording

The file is **CRLF**, so a `str.replace()` on LF-joined text matched nothing and **silently
reported `anchor: false` while still writing**. The exit code said success; only the echoed
`anchor:` line said otherwise.

Splicing by line index worked, and `git hash-object` against `git show HEAD:<path>` confirmed the
restore. This is round 153's lesson from the other direction: that round **stripped** CRLF with
`writeFileSync`; this one nearly made a no-op look like a mutation. **A no-op mutation looks exactly
like a surviving kill-test** — which is why the anchor's truth value is echoed rather than assumed.

## The label-click pattern, fifth occurrence

`setting-toggle-course-firing` is a raw `role=switch` input styled out of the layout; the click has
to go through `label[for="resto-setting-course-firing"]`. Rounds 148, 170, 179, 228 and now 230 —
five times. It is the single most-repeated instrument fact of the session, and it is a property of
the design rather than a defect: the visible control is an `aria-hidden` sibling slider.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-test | 2 failed |
| `RestaurantSettingsScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,713 passed — 0 failed |

## F4 coverage, all three screens

| Screen | Round |
|---|---|
| receipts | 223 |
| payments + one-way latch | 227 |
| **settings, the defaults-over-real-settings case** | **230** |

Three screens, one pattern, three independent implementations — and now three specs. Whatever the
next restaurant screen is, its F4 guard should be the first thing to look for.