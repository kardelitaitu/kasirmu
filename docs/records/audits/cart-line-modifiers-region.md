# The modifiers region and the override permission (round 209)

## Why this round

Round 208's record named the remaining `CartLineItem` testids — the modifier pair and the
price override — as *"a coherent next slice rather than a scattering"*. This closed it.

The override gate is the interesting half because it is a **permission, not a role**:

```ts
canOverridePrice: hasPermission('sales:override_price', isManager)   // PosScreen.tsx:1765
```

`CartPanel.tsx:258-269` explains why that distinction matters: the backend refuses
`override_cart_line_price` without the permission, **not** without a manager ROLE — and custom
roles ship, so the two can disagree in either direction. A role-based gate would show the `$` to
a manager the backend rejects, or hide it from a cashier whose custom role grants it.

## Probed before writing anything

All three testids were confirmed present on a seeded line rather than assumed:

```
ADD_MOD=1  MOD_REGION=1  OVERRIDE=1
AFTER_CLICK_HAS_NO_MODIFIERS=true   MODAL_OPEN=0
```

The seeded menu carries no modifier groups, so pressing the add button meets the REPORTING path
— `handleEditModifiers` (`PosScreen.tsx:1483-1486`) toasts instead of opening an editor with
nothing in it. That is the behaviour an operator actually meets here, and the spec pins it.

## What the spec pins — 4 passed, BOTH projects

| Case | Asserts |
|---|---|
| affordances | the region renders, the add button is offered, and the `$` override is present for an owner holding `sales:override_price` |
| no modifiers | pressing add on a product with none SAYS SO rather than opening an empty editor — a silent no-op leaves the operator tapping a dead control |

Unlike rounds 204-208, these run on **tablet too**: nothing here needs the product grid while the
cart is visible, so the portrait constraint does not apply. Worth noting because five consecutive
rounds had trained the reflex that cart-line specs skip on tablet.

**Kill-tested**: clearing `canOverridePrice` fails the affordance case on both projects.
Restored byte-identical.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (desktop + tablet) |
| Kill-test | 2 failed, both projects |
| `PosScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,707 passed |

## CartLineItem, closed

**Coverage moved 2 -> 14 of 17** across rounds 204, 205, 208 and 209. The three that remain are
all *conditional render* paths with no seeded trigger — `edit-modifiers-btn` (needs a line that
HAS modifiers), `cart-line-modifiers` showing CHIPS rather than the region, and
`cart-line-draft-badge`'s counterpart states. Reaching them needs a seeded menu item WITH
modifier groups, which is a fixture change of the kind round 193 showed must be scoped to the
spec rather than the shared mock.

> last audited 14-10-26 by docs-auditor
