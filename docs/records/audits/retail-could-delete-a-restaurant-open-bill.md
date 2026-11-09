# A retail terminal could read and delete a restaurant's open bill by id (round 303)

## Round 302's finding, completed

Round 302 gated `list_held_carts_scoped` so a store-pos session could no longer
**enumerate** the restaurant's open bills. It noted, without acting, that
`get_held_cart_scoped` and `delete_held_cart_scoped` were ungated — and this round went back
for them, because enumerating was never the requirement to reach a row by id.

Both commands took an arbitrary id with only a `SALES_PROCESS` permission check. Measured
before the fix, with the same two-session-on-one-bridge probe round 302 used:

```text
PROBE get_ok=true leaked=Some("{\"secret\":true}") delete_ok=true restaurant_still_has_it=false
```

Read across: a store-pos session **fetched** the restaurant's open bill including its full
`cart_data`, **deleted** it, and the restaurant's tab was **gone**. The last field is the one
that decides severity — this is not a disclosure, it is data destruction on the surface whose
entire purpose is holding a table's running order.

## The layer argument, which is now three rounds deep

The `open_bill` concept was refused to non-restaurant workspaces in **four** places before this
round, and every one of them was on the UI side:

| Where | What it does |
|---|---|
| `PaymentModal.tsx:368` | refuses the `open_bill` tender off a restaurant terminal |
| `RetailPosScreen.tsx:1341` | filters open bills out of its held-cart list |
| `hold_cart_scoped` (backend) | refuses to CREATE one |
| `list_open_bills_scoped` (backend) | refuses to LIST them |

Two of five backend commands were gated. The remaining three are the read, the delete, and the
general list — and round 302 closed the general list. **These two were the remainder.**

The reasoning that makes them worth closing even though the UI cannot currently reach them is
round 302's own: a front-end filter is a UI convenience, and the next caller of the command — a
new screen, a script, an integration test — inherits none of it. A UUIDv7 is guess-resistant,
not access-controlled; "no caller has the id" is a statement about today's callers.

## The fix

One helper, used by both commands:

```rust
fn refuse_cross_vertical_open_bill(store, session, id) -> Result<(), BridgeError> {
    if is_restaurant_pos_workspace(session) { return Ok(()); }
    let Some(row) = store.get_held_cart(id)? else { return Ok(()); };
    if row.bill_type == BILL_TYPE_OPEN_BILL { return Err(PermissionDenied(...)); }
    Ok(())
}
```

Three deliberate choices:

- **A missing row is not a breach.** `get` answers `None` and `delete` is a no-op, which are
  already the callers' expectations for an unknown id; turning those into errors would change
  behaviour for every caller to enforce nothing.
- **Only `open_bill` is gated.** A plain `hold` stays available to every vertical — the rule is
  about the restaurant concept, not about held carts.
- **Checked BEFORE the delete**, so a refusal leaves the row untouched rather than removing it
  and reporting afterwards.

## Reproduction first, then the fix — and the failure printed the leak

Run against the unfixed code before anything changed:

```text
panicked at pos_tests.rs:1101:5:
a store-pos session must not read a restaurant open bill by id; got Ok(Some(HeldCartFull {
  id: "01a14086-...", label: "Table 9", cart_data: "{\"secret\":true}",
  bill_type: "open_bill", ... }))
```

The panic message carries the whole leaked row. It is kept as a permanent regression test, with
the over-correction half included: **the restaurant must still read and delete its OWN open
bill** — a gate that blocked everyone would break the feature it protects.

## Verified

| Item | Result |
|---|---|
| New test, BEFORE the fix | **FAILED**, printing the leaked row |
| New test, after the fix | **passed** |
| `store_pos_*` gate tests (5) | **all passed** |
| `cargo test -p kasirmu-bridge --lib pos::` | **62 passed** |
| `cargo test -p kasirmu-core --lib held_cart` | **6 passed** |
| — incl. `integration_held_cart_same_workspace_shared` | passes: cross-terminal sharing WITHIN a workspace is preserved |
| `cargo clippy -p kasirmu-bridge --all-targets -- -D warnings` | clean |
| UI suites (POS, tables, retail, restaurant) | **927 passed, 60 files, 0 failed** |
| E2E: open-bills cycle, tab resume, tab conflict, table move, table merge, print bill | **12 passed** |
| Commit | `fe10fec9e` |

The e2e set is the load-bearing one for this change: Move Table and Merge Table **delete held
carts by id** through the command just gated, and both still pass — so the gate refuses the
cross-vertical case without disturbing the restaurant's own use of it.

## The form that keeps paying

Four rounds have now run the same sweep at four depths — the UI guard (297-299), a pure
function's domain (301), the list command (302), and the by-id commands (303). The question is
always the same and it is worth stating as the operative one:

> **Where is this rule enforced, and is it enforced at EVERY place the same data can be reached?**

Round 302 answered it for one door and left two named-but-unexamined. This round closed them. If a
sixth held-cart command is ever added, the five existing gates are the checklist it has to pass.

> last audited 16-10-26 by docs-auditor
