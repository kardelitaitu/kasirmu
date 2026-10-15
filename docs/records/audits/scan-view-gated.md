# The scan reported a designed relocation as a coverage gap (round 261)

## The question this round asked

`CartPanel` sat at 5 of 10 with two ids permanently "missing". Round 260's rule applies before
anything else: **a control that cannot be found may be in a view that is not on screen, or it may
genuinely not exist here.**

Measured, both halves:

```
on the restaurant cart panel     0   (never renders)
in the sidebar popover           1 row, "Deducting: …"   — round 243's spec, passing
```

## Why they cannot appear on the cart panel

`CartPanel.tsx:573`:

```tsx
{deductionLocationName && !sidebarOwnsTerminalActions && ( … )}
```

`sidebarOwnsTerminalActions` is `activeWorkspace === 'restaurant-pos'` (`:445`), so the restaurant
tier moves these two controls into the sidebar popover (`RestaurantSidebar.tsx:441-461`). The
restaurant cart panel is not where they live, by design.

## The instrument fix

The scan now separates **view-gated** ids from genuine gaps:

```python
VIEW_GATED = { 'deduction-location-badge', 'deduction-override-indicator' }
```

Both are recorded with the reason and the spec that covers the relocated control. CartPanel's
report changes from:

```
before   5/10   missing: [deduction-location-badge, deduction-override-indicator, 3 more]
after    5/10   missing: [3 more]   view_gated: [the two relocated ids]
```

The percentage does not move — which is the point. **The scan was never wrong about coverage; it
was reporting a designed absence as if it were a gap**, and a reader counted it as work remaining.

## Two mistakes made while editing, both self-inflicted

The first edit dropped the `'covered': len(hit),` entry from the row dict, and the scan exited 1
with `KeyError: 'covered'` — which the run itself reported. The second attempt to read the JSON
through PowerShell mangled the quoting.

Both are the **verify-the-frame-after-edit** shape rounds 255-259 established: an edit that is
nearly right reads as a passing change until something forces a run.

## Verified

| Item | Result |
|---|---|
| The scan's self-test | still passes — it can still see, so its numbers stay meaningful |
| `restaurant-coverage.py` | exit 0, `view_gated` reported separately |
| `CartLineItem` | **17/17, 100%** — round 259/260's spec closed it |
| Round 243's deduction spec | 2 passed, both profiles — the relocated control is covered |
| Probes | 2, both removed |
| New tests | zero |
| Source changed | the scan only |

## CartPanel, final state

| State | Ids |
|---|---|
| covered | tab banner, new tab, held badge, resize handle, deduction (via the sidebar) |
| view-gated by design | the two cart-panel deduction ids |
| **genuinely open** | `pos-cart-conflict-alert`, `pos-cart-conflict-takeover-btn`, `pos-cart-kds-btn` |

Two of the three open ones need a **second terminal** (`getConflict` requires
`lease.terminalId !== currentTerminalId`) — verified again round 258, now across five
examinations. `pos-cart-kds-btn` is absent by design in the restaurant tier, the same gate that
`sidebarOwnsTerminalActions` imposes.

**CartPanel has no remaining unreachable-but-behavioural work.** What is left there is blocked by
architecture, not by tests, and the scan now says so instead of implying otherwise.

> last audited 15-10-26 by docs-auditor
