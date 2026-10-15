# Covering the reservation workflow, and the ids I guessed wrong (round 240)

## Why this round

Round 239 closed the F4 class. The coverage scan then showed something the earlier rounds had not:
**another lane's table-reservation feature had landed and been committed** (`d7147648c` — the same
in-flight work round 227 saw uncommitted and round 228 recorded as blocking a colleague's test).

Its testids were new — `tables-open-reserve-btn`, `tables-reservation-card`,
`tables-seat-guests-btn` — and uncovered. This round covered the entry point and its gate.

## What the spec pins — 4 passed, both projects

| Case | Asserts |
|---|---|
| the entry | Reserve Table is offered for a free table, and the form seeds **party size from the table's capacity** with an empty name |
| the gate | an empty name and **whitespace-only** leave Confirm disabled; a real name arms it |

The seeded party size is the usability half: the form arrives with a sensible default rather than
an empty box, so the operator fills only what is actually specific to this booking.

The gate is the reliability half, and it is a **three-state** pair — empty, whitespace, valid —
because the handler trims (`:1877`). A gate that accepted `\"   \"` would let the operator confirm an
unnamed booking, which is the same class as the name-gated Save Table round 220 covered.

**Kill-tested**: removing the gate fails the case. Restored byte-identical to HEAD.

## Three errors on the way, each of the round-226 kind

The first version guessed rather than measured — three times:

| I wrote | The truth |
|---|---|
| `openRestaurantSidebarRow(page, 'tables')` | the sidebar row does not reach the tables screen; `Shift+L` does (rounds 219, 221) |
| `#reserve-modal-party-size` | `#reserve-modal-party` |
| `#reserve-modal-guest-name` | `#reserve-modal-name` |

The first was the substantive one: **the helper I had used on other screens does not compose here**,
and the failure surfaced as *`restaurant-sidebar-tables` not found* — a missing element rather than
a wrong route. The F10 probe style that settled rounds 231-234 was needed again: read the reason
the test reports before assuming the product is at fault.

All four assertions that survive are now ones the measurements support.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-test | 1 failed on the name gate |
| `TableManagementScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 (after hoisting the `Page` type import — 2 warnings first) |
| Full UI suite | 12,716 passed |

## Tables coverage, now that the reservation feature is in it

| Surface | Round |
|---|---|
| form + Save gate | 165, 167 |
| floor plan | 177 |
| release, delete, move, merge | 193-195 |
| toolbar, arrange, assign | 219 |
| edit form + prefill | 220 |
| Print Bill | 221 |
| **reservation entry + gate** | **240** |

Left on that screen, named for next: `tables-seat-guests-btn` and `tables-reservation-card` — the
**seating** transition, which is the other half of the workflow and the one an operator performs
when the party actually walks in. Also still uncovered: the section badges and the tab-conflict
banner (which needs a second terminal, the round-216 constraint).

> last audited 15-10-26 by docs-auditor
