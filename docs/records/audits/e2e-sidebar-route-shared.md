# The restaurant sidebar route, shared instead of walked four times (round 162)

## The duplication, found by a survey not a guess

Round 161 consolidated the cart setup. Rather than assume that was the only one, this round
enumerated every local helper in `ui/e2e` and counted name collisions:

```
openPayments                 2  mock-payment-rails-persist, restaurant-payment-rails-persist
openRestaurantPosWithItem    2  (intentional wrappers added in round 161)
openRestaurantPos            2  (intentional wrappers added in round 161)
```

The two `openPayments` were **character-for-character identical**, including the `owner` role —
so unlike last round there was no role hazard to preserve. Both walked:

```
loginAs('owner') → selectWorkspace(RESTAURANT_POS) → wait for .restaurant-card
  → click .restaurant-sidebar-btn → click [data-testid=restaurant-sidebar-payments]
  → wait for the Save button
```

A wider grep showed four specs walking that route, not two:

| Spec | Row |
|---|---|
| `restaurant-settings-toggles` | settings |
| `restaurant-cart-capabilities` | settings |
| `restaurant-payment-rails-persist` | payments |
| `mock-payment-rails-persist` | payments |

## What landed

`openRestaurantSidebarRow(page, row, role = 'owner')` in `helpers.ts`: the login, the
workspace, the grid wait, the sidebar click, and the row click. Each spec keeps its own
**arrival assertion** — the route is shared, the thing being waited FOR is not, which is why
`openPayments` survives as a three-line wrapper rather than disappearing.

Diff: **+55 −41** over four files.

## The role question, handled deliberately

Round 161's lesson was that an extraction can silently promote a spec's privilege. So the role
was checked **before** touching each spec:

| Spec | Role | Why |
|---|---|---|
| the two rails specs | `owner` | identical to the helper's default — no change |
| `restaurant-settings-toggles` | `owner` | the Settings row gates on `settings:edit`; `staff` renders it disabled |

`restaurant-settings-toggles`'s comment explaining that moved **into the helper's docblock**, next
to the code that enforces it, so the next caller does not have to re-derive why owner is
required. That comment is the whole reason the role is a parameter rather than a default.

## One mistake, caught by the spec

`mock-payment-rails-persist` has a **reload** path that logs in again, and my import rewrite
removed `loginAs` while leaving that call site: `ReferenceError: loginAs is not defined`. The
reload block now calls `openRestaurantSidebarRow`, which is what it was doing by hand.

## Verified

| Item | Result |
|---|---|
| Four refactored specs together | **18 passed** |
| Full restaurant group + layout | 8 passed |
| Full UI suite | 12,680 passed (up 2) |
| Login roles | unchanged — checked per spec before editing |
| Diff | 4 files, +55 −41, no behaviour change |