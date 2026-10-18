# A store-pos terminal could list the restaurant's open bills, and only the UI stopped it
# (round 302)

## The first look at the Rust side

Rounds 294-301 worked the TypeScript restaurant surface. This round went to the boundary those
fixes call into — `kasirmu-bridge/src/pos/hold_orders.rs`, the five held-cart commands behind
every tab operation the UI performs.

## What is well built there

Two gates already existed and are both tested:

| Command | Gate |
|---|---|
| `hold_cart_scoped` | refuses to CREATE an `open_bill` off a non-restaurant session |
| `list_open_bills_scoped` | refuses to LIST open bills off a non-restaurant session |

`pos_tests.rs` pins both (`store_pos_cannot_create_open_bill`, `store_pos_cannot_list_open_bills`),
plus the over-correction case `store_pos_can_still_hold_a_plain_cart`. All three pass at HEAD — I
ran them. The module doc also records why the gate is on the SESSION type rather than the request
`bill_type`: that field "was previously trusted exactly as sent".

## The third door had neither

`list_held_carts_scoped` sat between those two commands with **no workspace gate at all**, and it
returns `Store::list_held_carts()` — an unfiltered query over every held cart **including
`open_bill` rows**.

Measured rather than argued, with a probe added to `pos_tests.rs` (two sessions on one bridge,
differing only in `type_key`, which is the field the gate reads):

```text
PROBE total=1 open_bills_visible=1 our_id_visible=true
```

A store-pos session receives the restaurant's open bill, id and all.

## Why it was invisible, which is the transferable part

`RetailPosScreen.tsx:1341` filters the rows itself:

```ts
const held = carts.filter((c) => c.bill_type === 'hold');
```

So the UI never showed the open bill, and the behaviour looked correct from every screen. **A
front-end filter is not an authorization boundary** — it is a UI convenience that any *other*
caller of the same command inherits none of: a new screen, a script, a future shell, an integration
test. The backend's own doc records this class causing a bug once already, which is why the other
two doors were gated in the first place.

This is the same cross-layer shape this session kept finding, now on the layer below the UI:
**enforcement present at two doors, absent at the third.**

## The fix, and where it lives

A new `Store::list_held_carts_excluding_open_bills()` filters in SQL, and the bridge picks between
the two queries on the session's vertical:

```rust
let carts = if is_restaurant_pos_workspace(&session) {
    store.list_held_carts()?
} else {
    store.list_held_carts_excluding_open_bills()?
};
```

**In SQL, not in the caller**, so the exclusion cannot be lost by a future caller that reads the
full list and forgets to filter — which is exactly how this one arose. Restaurant POS is
unchanged: the open bills are its own, and it still receives every row.

## Reproduction first, then the fix

The probe was **converted into a permanent regression test** rather than deleted, and run against
the unfixed code before anything changed:

```text
panicked at pos_tests.rs:1100:5:
a store-pos session received an open bill from the general held-cart list
test store_pos_does_not_see_open_bills_in_the_general_list ... FAILED
```

It carries the over-correction half too — after the exclusion, a plain `hold` written by the same
store-pos session must still appear. A fix that hid every row would break retail's own held carts,
which is the capability the gate exists to protect rather than remove.

## Verified

| Item | Result |
|---|---|
| New regression test, BEFORE the fix | **FAILED** with the defect named |
| New regression test, after the fix | **passed** |
| `store_pos_*` gate tests (4) | **all passed** — the two pre-existing gates are undisturbed |
| `cargo test -p kasirmu-core --lib held_cart` | **6 passed** |
| `cargo test -p kasirmu-bridge --lib pos::` | **61 passed** |
| `cargo clippy -p kasirmu-core -p kasirmu-bridge --all-targets -- -D warnings` | **clean** |
| UI suites touching held carts | **679 passed, 46 files, 0 failed** |
| Held-cart e2e specs (5 files) | **9 passed** |
| pre-commit rustfmt gate | caught real drift; formatted and re-committed |
| Commit | `e1d96a98c` |

## A note on the gate that caught me

The first commit attempt was **rejected by the pre-commit rustfmt step** — `rustfmt --check failed
for .rs files staged in this commit`. That is the eighth step AGENTS.md names, doing its job on
the first Rust change this session has made. Worth recording because the previous fourteen rounds
were TypeScript, where the equivalent gates ran clean every time; a new language meant a new gate,
and it fired on the first attempt rather than after a push.

## The shape, stated once more

Three rounds have now turned on the same question at three different layers — the UI guard
(rounds 297-299), the pure function's domain (round 301), and now the backend command surface. The
form that keeps paying is: **find where a rule is enforced, then check whether it is enforced at
every place the same data can be reached.** Two doors were gated; the third was not; and the only
thing covering the third was a filter in a different language, in a different process, that no
other caller of the command would inherit.

> last audited 16-10-26 by docs-auditor
