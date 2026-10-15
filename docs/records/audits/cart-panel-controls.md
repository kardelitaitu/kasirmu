# The cart panel's reachable controls, and two that are not (round 216)

## Why this round

`CartPanel` is the coverage outlier — 2 of 10 through rounds 204-215, which concentrated on
`CartLineItem`. This round went after its own controls and found that most of the remainder is
gated by something the preview does not provide.

## What is now covered — 2 passed

| Case | Asserts |
|---|---|
| the customer field | it accepts input, and the name **survives a table edit** |
| the floor-plan button | it is **absent** while its feature is off, and an ungated control still renders |

The first is the round-201 class in a new place: the table and the customer are separate fields
of one order, and a re-render that dropped one when the other changed would lose the guest's
name. **Kill-tested**: clearing the customer on a table edit fails it. Restored byte-identical.

The second asserts a NEGATIVE deliberately. `pos-cart-open-tables-btn` sits behind
`isEnabled(FEATURES.TABLE_MANAGEMENT)` (`CartPanel.tsx:927`) and the dev-mock answers
`['sales', 'inventory', 'reporting', 'staff', 'settings']` (`dev-mock/handlers/system.ts:744`) —
**no `table-management`**. So the button is correctly hidden, and the assertion that it stays
hidden is what pins the gate. The paired positive (an ungated control still renders) is what
keeps it from passing on a screen that failed to load features at all.

## Two surfaces that cannot be covered from one page

### The multi-terminal conflict alert

`pos-cart-conflict-alert` and `pos-cart-conflict-takeover-btn` warn that ANOTHER terminal is
adding to the same tab. `getConflict` (`useTabLeases.ts:193-203`) reports one only when a live
lease belongs to a different terminal, and `leases` is `useState` over `memoryLeases` (`:58`) —
**in-memory, not persisted**, so a second terminal cannot be simulated from a single page.

### The floor-plan button, positively

Covering that it OPENS the tables screen would mean adding `table-management` to the mock's
feature set — a shared fixture every feature-gated surface reads. Round 193 established the rule;
the tables screens are reachable through the restaurant sidebar (`restaurant-sidebar-tables`) in
the specs that cover them, so nothing is lost by leaving this one out.

> **Denominator note, 2026-10-14 (docs-auditor).** The `of 10` above is a **literal-grep count**
> and cannot see a dynamically built testid: `CartPanel.tsx:843` is
> `data-testid={`pos-order-type-${opt.id}`}`, so the component's true surface is **11**, not 10.
> The substance (CartPanel is the outlier) holds either way; the denominator undercounts by one.

## Verified

| Item | Result |
|---|---|
| New spec | 2 passed, 2 skipped (portrait) |
| Kill-test | 1 failed, the field-independence case |
| `CartPanel.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,709 passed |

## CartPanel, accounted for

| Testid | State |
|---|---|
| `pos-cart-customer-input` | covered here |
| `pos-cart-open-tables-btn` | covered as a NEGATIVE, gate pinned |
| `pos-active-tab-banner`, `pos-cart-new-tab-btn`, `.pos-cart-held-badge` | round 215 |
| `pos-cart-conflict-alert`, `-takeover-btn` | **not reachable** — recorded |
| `deduction-location-badge`, `-override-indicator` | need a configured deduction source |
| `pos-cart-kds-btn` | **not reachable** — corrected 2026-10-14 by docs-auditor; see below |

> **CORRECTED 2026-10-14 (round 217, docs-auditor).** The `reachable` verdict on
> `pos-cart-kds-btn` is false. The button sits at `CartPanel.tsx:691` inside the cluster gated by
> `{!sidebarOwnsTerminalActions && (` at `:649`, and `sidebarOwnsTerminalActions` is
> `activeWorkspace === 'restaurant-pos'` (`:445`) — so in this workspace the cluster does not render
> at all, because `PosScreen` hands those controls to the sidebar popover. It is NOT the honest gap
> this record called it: the KDS route is covered through `restaurant-sidebar-kds`. The correction
> was already written into `ui/e2e/restaurant-tab-resume.spec.ts:7-16` by round 217, which noted
> that round 216 "read the second one as a feature gate (true, but not the whole story) and the
> first as reachable (false)".
>
> The record's earlier line, kept for its reasoning: that last one is the honest gap it is not — it
> is a one-line navigation button and it is reachable, so it is
a candidate for a round that wants a small win rather than another investigation.

> last audited 14-10-26 by docs-auditor
