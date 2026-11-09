# Not a product defect — a harness one, and three rounds of evidence said otherwise — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 204 · status: the admin-tool-route defect
     from rounds 202-203 is CLOSED and was never user-visible; the six failing specs are fixed
     · branch: 0.0.41 · commit: dea2d356c -->

<!-- Scope: prove the instrumentation reaches the browser, then locate the clearing. -->

## The control, run first, as round 203 said it must be

Round 203 ended with three instrumented context setters that logged NOTHING, and refused to
choose between "a second source decides the workspace" and "my instrument never reached the
bundle". So this round started with the control:

```
console.log("WS_PROVIDER_RENDERED")   // unconditional, in the provider body
CONTROL=RENDERED n=24 -> INSTRUMENT REACHES BROWSER
```

**The instrument works.** That made the three silent setters a valid negative — and it also let
me log the value itself:

```
PROBE=ALL len=24 unique=["null"]
```

**The provider own `activeWorkspace` is null for its entire life** — 24 renders, one unique
value — while the admin workspace visibly renders. That is the contradiction that broke the
investigation open.

## The answer, and an apology to rounds 202-203

`AppShell` has two render gates and they disagree:

```
AppShell.tsx:669   if (pageRegistration?.fullscreen)  -> renders WITHOUT a workspace
AppShell.tsx:708   if (!activeWorkspace)              -> otherwise, the PICKER
```

Line 665 states it outright: *"Fullscreen pages render without the AppLayout wrapper and
without requiring an active workspace."*

So the rule is: **a non-fullscreen page needs an active workspace; a raw hash write never
establishes one.** Measured across three routes from the same state:

| route | fullscreen? | result |
|---|---|---|
| `settings` | **yes** | `.workspace-fullscreen: 1`, picker 0 — renders |
| `shifts` | no | `.workspace-home-wrapper: 1` — PICKER |
| `terminals` | no | same — PICKER |

**Rounds 202-203 called this a product defect. It is not.** I tested the real user path this
round — clicking the Shifts tool card — and it works:

```
VERIFY=CLICK{"cards":1,"st":{"mgmt":1,"home":0}}
```

An operator can reach Shifts, Audit, Terminals and Memo perfectly well. **The specs were
navigating in a way no user does.** The three rounds of evidence that pointed at a real routing
bug were all consistent with that, and the distinction only appeared when I stopped probing the
hash path and asked whether the CARD works.

## The fix

A new helper, `openToolCard(page, label)`, clicks the real tool card. Its docstring
records the full route/fullscreen table so the next author does not re-derive it. `shift.spec.ts`
and `e2e-shift-reconciliation.spec.ts` now use it — and the first also had to STOP calling
`selectWorkspace(ADMIN)`, because that clicks the Settings card and consumes the picker
the tool cards live on.

## Verified

| check | result |
|---|---|
| control sentinel | n=24 — instrument reaches the browser |
| `shift.spec.ts` | **5 passed** (was 5 failed) |
| `e2e-shift-reconciliation.spec.ts` | **1 passed** (was 1 failed) |
| the full previously-failing batch | **13 passed, 1 failed**, 5 skipped — was **7 passed, 6 failed** |
| user path (click the card) | works — `mgmt: 1`, picker 0 |
| `WorkspaceContext.tsx` | restored byte-identical (`edc9bcf817d3c8cf`) |
| `npx tsc --noEmit` | 0 errors |
| stray probes | none |

## The one remaining failure, and it is not this

`refund.spec.ts` still fails, on a DIFFERENT selector: `.retail-product-btn` within an
8s timeout. Probed directly, the store POS grid **does** load (18 buttons) given time — so it is
a timing budget, not the navigation defect. Left alone: it is a separate issue and the retail
area is dirty with another lane edit.

## What the three rounds actually cost, recorded honestly

Rounds 202 and 203 were spent locating a product defect that does not exist. Both were
methodologically careful — round 203 explicitly refused to guess and ran the control first, which
is exactly what produced this round answer. But the framing was wrong from the first probe: I
asked "why does the workspace clear?" instead of "is this path one a user takes?". **A failing
test names a SYMPTOM; whether it names the PRODUCT is a separate question, and it is cheaper to
ask first.**

> last audited 18-10-26 by docs-auditor
