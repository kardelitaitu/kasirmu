# Thirteen more specs on the same admin route gate — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 206 · status: a 44-test batch found 13
     failures with ONE cause, the same non-fullscreen route gate rounds 202-205 kept meeting;
     the cause is now precisely characterised and the fix is NOT applied · commit: none -->

<!-- Scope: run the unexercised specs and triage every failure by the product-or-harness rule. -->

## The batch, and the perfect correlation

A 44-test batch over seven previously-unexercised spec files: **31 passed, 13 failed**.

The 13 are all screen-renders smoke tests across unrelated features — Inventory Adjustment,
Bundles, Void Orders, Sales Dashboard, EOD, Sales Report, Inventory Report, Menu Engineering,
Tables, Gift Cards, Customers, Categories, Loyalty. Unrelated features, so the first question was
whether there is one cause. There is, and the correlation is exact:

| route | fullscreen? | result |
|---|---|---|
| `dashboard` | **yes** | renders |
| `settings` | **yes** | renders |
| `analytics` | **yes** | renders |
| `kiosk` | **yes** | renders |
| the **13 failing** routes | **all no** | picker instead |

**Every failing route is non-fullscreen; every passing one is fullscreen.** That is the same
`AppShell` gate rounds 202-205 kept meeting (fullscreen pages render at `:669` without a
workspace; everything else is gated on one at `:708`).

## What this round adds: the workspace IS being cleared

Round 204 closed the shift specs by clicking the tool card, and it worked. That raised the
question worth asking — is the card path simply different, or does the workspace survive and
something clears it after? Measured, in one trace:

```
after clicking the Reports card -> #/dashboard, .workspace-home-wrapper 0   (workspace ACTIVE)
then navigateTo("reports")      -> #/reports,   .workspace-home-wrapper 1   (PICKER)
```

**The card establishes the workspace; the next hash write destroys it.** So the round-202
observation was right and the round-204 answer was incomplete: clicking the card works for a
SINGLE navigation, and a second hash-based move falls back to the picker. That is why the
one-hop shift specs went green while these multi-screen specs stayed red.

## What else was ruled out, by measurement

| hypothesis | result |
|---|---|
| stale selectors (the failure read like one) | **no** — every class is present: `sales-report` 54 tsx / 50 css, `void-orders` 77 / 83, `eod-report` 143 / 121 |
| the routes are not registered | **no** — all 15 resolve under `features/*/register` |
| `#/dashboard` is broken | **no** — `dash: 1, fullscreen: 1`, renders fine |
| going through `#/settings` first establishes the workspace | **no** — `home: 1, sr: 0`; and `#/settings` renders with `nav: 0`, so the admin shell never mounts on that path |
| the admin shell exposes a nav sidebar to drive | **no** — `.app-nav-item` count is 0 on the fullscreen paths |

## Why the fix is not applied

Same reason as rounds 202-203, now with better evidence: the clearing mechanism is
**characterised** (a hash write to a non-fullscreen route while the admin workspace is active)
but **not located**, and the candidate fixes are all behavioural on shared routing. Three rounds
of this session have measured what an unverified navigation change costs.

There IS a mechanical fix available and it is a HARNESS one: these 13 specs should reach their
screens the way a user does — through the admin shell — rather than by hash. That is what round
204 did for the shift specs. It needs a way to reach the admin shell nav from a test, and this
round measured that the shell renders **no** `.app-nav-item` on any path reached so far, so that route
is not yet known.

## Verified

| check | result |
|---|---|
| batch | 31 passed, **13 failed**, 44 total |
| failing routes are non-fullscreen | **13 / 13** |
| passing routes are fullscreen | 4 / 4 sampled |
| class names | all present, none stale |
| routes registered | 15 / 15 |
| card then hash | workspace active -> PICKER |
| production change | **none** |
| stray probes | none |

## Carried forward

1. **13 specs fail at HEAD**, all on the admin non-fullscreen route gate. This is the largest
   single-cause failure set found this session and it should be the next round subject.
2. The next question is narrow and testable: **how does a user move between admin screens?**
   The card reaches the shell (dashboard); the shell must offer some in-app nav, and that nav is
   the path the specs should use. Finding it is a probe, not a guess.
3. Note the shape: rounds 202-205 each fixed ONE spec on this cause while a dozen others waited.
   **When a cause is identified, the cheap next move is to grep for every spec that shares it** —
   I fixed two specs by hand and a batch then found eleven more.

> last audited 18-10-26 by docs-auditor
