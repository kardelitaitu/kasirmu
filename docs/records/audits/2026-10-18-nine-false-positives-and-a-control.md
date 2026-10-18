# Nine false positives and a control that finally fired — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 199 · status: swept 182 components for
     unused props; every hit was an artifact of MY parser, and the honest answer is zero real
     findings · branch: 0.0.41 · commit: none (no production change) -->

<!-- Scope: hunt the F19/F49 class — a control whose value reaches nothing. -->

## The target, and why it was worth a sweep

The F19/F49 class has produced real defects in this codebase: a control nothing reads, and a
branch nothing calls. A destructured-but-unused prop is the cheapest mechanical form of it, and
182 exported components in `features/` can be checked in one pass.

## Four wrong scans before a right one

This is the part worth recording. Each version looked reasonable and each was wrong:

| version | bug | what it reported |
|---|---|---|
| 1 | searched only the first 900 chars of the body | `RestaurantMenu.sidebarOpen` as unused |
| 2 | whole body, but no alias handling | still `sidebarOpen` — the destructure renames it to `controlledSidebarOpen` |
| 3 | alias handling, but split on `:` without consuming the type | `TopologyScreenProps` as a local variable |
| 4 | fixed the type, but not the `= {}` default | seven more type names as locals |

## The control, run at the right moment

After version 1 I ran a positive control — inject a genuinely unused prop and check the scan
fires. My first attempt injected into `MenuItemTile.tsx` and reported **CONTROL SETUP FAILED**
because that file does not match the destructure pattern at all. The honest move was to stop and
find a file the pattern DOES match (139 of them), not to skip the control and trust the result.

With the control injected into `AovTrendChart.tsx`:

```
names=7 unused=["totallyUnusedControlProp"]
CONTROL FIRES
restored sha=e69589947dbe289c (expected e69589947dbe289c)   <- byte-identical
```

Only then was the scan believable — and that is exactly what exposed versions 2-4, because a
validated instrument plus a suspicious hit is a contradiction worth resolving rather than a
finding worth reporting.

## The answer

**Zero real unused props in 182 components.** Every hit resolved to one of the parser bugs above:

| reported | reality |
|---|---|
| `RestaurantMenu.sidebarOpen` | aliased to `controlledSidebarOpen` and used in a full controlled/uncontrolled pattern (`:196-205`) |
| `TopologyScreenProps`, 7 more | the TYPE name, not a variable — my regex stopped before `= {}` |

The `RestaurantMenu` case is worth naming because it is the one that would have been
plausible: `sidebarOpen` IS a real prop that `PosScreen` passes, and reading only the first
900 chars of a 814-line component made a fully-wired controlled prop look inert. **The scan was
measuring my window, not the code** — the same shape as the filename-scoped queries in rounds
195 and 197.

## What this round is worth, stated plainly

No production change, and the defect hunt found nothing. That is a real result for this class:
the mechanical form of "a prop nothing reads" is **absent** in `features/`, which is
evidence about a class that has produced real bugs, not a shrug.

The four-iteration parser is the transferable part. A scan over source text is a program with its
own bugs, and every one of the four would have shipped a false finding if I had not (a) run the
control and (b) treated "validated instrument + suspicious hit" as a contradiction to resolve.

## Verified

| check | result |
|---|---|
| positive control (`AovTrendChart`) | **FIRES**, restored byte-identical |
| scan, final | 182 components, **0 real unused props** |
| the 4 false-positive causes | each identified by reading the named site, not assumed |
| production change | **none** |
| files touched | none — every probe restored byte-identically |

## Carried forward

1. **The F19/F49 class has no mechanical form in `features/`.** Do not re-sweep it without a
   new reason; the remaining instances are semantic (a value that reaches nothing downstream),
   which the project already tracks per finding.
2. **A control that cannot be set up is not a control.** When my injection target did not match
   the pattern I did not skip the step — I found a target that matched. Skipping it would have
   meant reporting version 1 as a real finding.

> last audited 18-10-26 by docs-auditor
