# The completeness check that was itself incomplete, and the kill-test that caught it (round 304)

## Where this started

Rounds 302 and 303 each closed a held-cart command that shipped without the open-bill
workspace gate. Round 303 closed with a claim: *"if a sixth held-cart command is ever added,
the five existing gates are the checklist it has to pass."*

A checklist in prose is what failed the first two times. This round made it mechanical — and
the first version of that check was **itself** the bug.

## The stale invariant, fixed first

The module doc read:

```text
//! Invariant: an open bill is a Restaurant POS concept, so
//! [`is_restaurant_pos_workspace`] gates creation AND listing fail-closed
```

Accurate when two of five commands were gated — and that is exactly what made the other three
look unremarkable. A doc naming two doors is how the third goes unnoticed. It now lists **all
five** with the shape of each gate, and says plainly that a sixth command must pick its shape
from that table.

## The check, and the failure the kill-test exposed

`every_held_cart_command_carries_the_workspace_gate` reads `pos/hold_orders.rs` and asserts each
command spells its gate. Run against a healthy tree: **passed**.

Then the kill-test — delete `get_held_cart_scoped`'s gate and see whether it notices:

```text
test every_held_cart_command_carries_the_workspace_gate ... ok
```

**It passed with the gate removed.** The first version searched the whole file for each gate
string, and `delete_held_cart_scoped` spells the identical call — so the file-wide search found
`delete`'s line and counted it as `get`'s. A completeness check that cannot tell *which*
function carries the gate is worth nothing, and it would have gone on reporting green while the
exact defect rounds 302-303 fixed walked back in.

The fix scopes each search to its own function body, sliced by declaration. The same kill-test
now gives:

```text
panicked: get_held_cart_scoped no longer carries its workspace gate
  (refuse_cross_vertical_open_bill(&store, &session, &id)?) IN ITS OWN BODY.
```

## A second floor, because the fix could fail silently too

Scoping introduces its own way to be vacuous: a slicing bug that returns the *last* match for
every name would satisfy all five checks with one body. So the guard also asserts the five
slices are **distinct**, and that the declared public-function count exceeds the graded
command count — a sixth command raises the count above the list and fails.

Three floors, each covering the way the one below it can lie: enough commands found, each
found in its own body, and the bodies not all the same one.

## Verified

| Item | Result |
|---|---|
| Completeness guard, healthy tree | **passed** |
| Kill-test: `get`'s gate deleted | **first version PASSED — the guard was broken** |
| Kill-test, after scoping | **FAILED**, naming the command and the missing gate |
| `store_pos_*` gate tests (5) | **all passed** |
| `cargo test -p kasirmu-bridge --lib pos::` | **63 passed** |
| `cargo clippy -p kasirmu-bridge --all-targets -- -D warnings` | clean (caught `int_plus_one` in the new guard; fixed) |
| pre-commit rustfmt | formatted before commit |
| Commit | `75ed14acd` |

## The lesson, which is the same one at one remove

Rounds 229/230 established it for tests: *a guard is unproven until it has been shown to fail
against the thing it claims to catch.* Round 303 applied it to the by-id gate. This round
applied it to the completeness check — and the check failed its own test.

The specific shape is worth naming, because it will recur: **a source scan that searches a
whole file cannot attribute what it finds to a particular function, so any string two functions
share makes the check satisfiable by either one.** The remedy is to slice by declaration and
assert the slices are distinct — and to kill-test the slicing, not just the search.

## State of this seam

All five held-cart commands are gated, the invariant names all five, and a mechanical check
fails when one loses its gate or a sixth arrives without one. That is as far as this axis goes:
the remaining questions about the restaurant path are behavioural, not about enforcement
coverage, and the full restaurant surface has been green at every layer — unit, integration and
browser — since round 296.

> last audited 16-10-26 by docs-auditor
