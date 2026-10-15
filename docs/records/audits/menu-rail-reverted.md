# The menu editor rail: a correction to round 249's sweep, and a CSS change that was reverted (250)

## What round 249 claimed, and what this round found

Round 249's hit-test sweep reported **five occluded controls** on the menu editor, including a
category's delete. This round set out to fix it. The measurements corrected the claim, and the
correction is the finding.

### The occlusion is real but the sweep overstated its extent

Re-measured with the rail's own box alongside the hit test:

```
rail     y 105..803      (698px of content)
stack    y 610..747
viewport 768
```

The rail **does** extend past the viewport, and three of its controls hit-tested into the stack:

| Control | y |
|---|---|
| `restaurant-menu-editor-cat-edit-cat-snack` | 601 |
| `restaurant-menu-editor-cat-edit-cat-cold-drink` | 696 |
| `restaurant-menu-editor-cat-del-cat-cold-drink` | 696 |

So a category could not be edited or deleted while a memo was pending. That part of round 249's
claim holds.

### The CSS change did not survive its own kill-test, and was reverted

A `max-height` on the rail was written — gated on the stack's presence, bounded by
`--memo-bottom-inse`, mirroring `StaffManagementScreen.css`. Killing it alone still passed. Killing
**both** the new rule and the base cap still passed. The change was reverted, and `git hash-object`
confirmed the file byte-identical to HEAD.

**A CSS change whose removal does not fail the test that motivated it is not the fix.** Whether the
rail overflows at the default state depends on the seeded category list, and with the current seed
its bottom lands at 623 — 13px into the stack's band, not 193px. So the visibly-dramatic occlusion
measured in the first probe and the benign one in the last are **the same seed at different
moments**, and only the second is what the test exercises.

The honest reading: **the menu editor's occlusion is seed-dependent, and the seed the suite runs
does not reproduce it at a severity a bounding rule can prove.** The rule may still be right; it is
not demonstrated, so it is not shipped.

## What was shipped

A spec that pins the two properties which **are** true in the suite's seed:

| Case | Asserts |
|---|---|
| the rail's bound | its bottom is inside the viewport, and if it overflows it owns a scroll rather than clipping |
| the control | `…cat-del-cat-cold-drink` can be **clicked** — no `force: true`, so an interception would still fail it |

4 passed, desktop and tablet. The second case is the one that matters: round 249 named that exact
id as under the stack, and this pins that it is operable.

## Two structural lessons, both from the gates

**The CSS syntax gate caught the same mistake twice in two rounds.** A splice-based edit left an
orphan `}` both times — `Unexpected }` at `:77` here and `:176` in round 249 — and `postcss`
reported it while a lenient browser would not have. A splice whose replacement count does not match
what it replaces is the recurring shape; the gate is what makes it cheap to find.

**An assertion can be right and still be wrong.** The first draft asserted the capped rail
*overflows*. It does not, in this seed — so the assertion failed on a correct fix. Rewritten as a
conditional (`if it overflows, it must own a scroll`), which is the property that actually matters
and holds however the seed falls.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-tests | 3 — rule alone, base alone, **both together** — all survived, so the CSS was reverted |
| `RestaurantMenuEditorScreen.css` | byte-identical to HEAD |
| `eslint` | 0 |
| Full UI suite | 12,716 passed — 0 failed |

## The memo-stack class, four screens in

| Screen | Round | Outcome |
|---|---|---|
| workspace picker | 2026-09-30 | clearance rule, measured |
| staff roles list | 2026-10-01 | clearance rule, measured |
| receipts preview column | 247-249 | clearance rule; **partial** — works at the scroll end only |
| **menu editor rail** | **250** | **occlusion measured; no rule shipped — not demonstrable** |

Four screens, three shipped rules, and one where the evidence did not support a change. That last
is the one worth recording: a defect that is real in one measurement and benign in another, with no
demonstration of which one the operator meets, is not yet a fix.