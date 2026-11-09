# The dine-in rule is complete, the tables screen correctly exempt, and a full-surface
# measurement (round 305)

## What this round set out to do

Rounds 302-304 closed the open-bill gate across all five held-cart commands. This round applied
the same question — *is this rule enforced wherever the same data can be reached?* — to a
**different** cross-cutting rule, to see whether the pattern generalised into a new defect or
whether that axis is genuinely closed.

**It found no defect.** Two negative results, both worth recording with the reasoning that
produced them, plus a full-surface measurement.

## Result 1: the dine-in rule is complete

The codebase marks this rule at **17 sites** across 8 files, counting them in the source
("the SEVENTH site of this rule", "the EIGHTH", "the NINTH", "the TWELFTH").
`RestaurantOrderTypeFieldConsumers.test.ts` already guards the consumer side, and it is unusually
well built — its own comments record two past blind spots: a count pinned as "appears once" that
went blind when a second site landed, and a 3000-character search window that broke when a comment
was inserted between the handler head and the rule.

The thing I checked that the guard does **not**: whether a producer is missing from its file list.

`TableManagementScreen` writes `tableNumber` at **six** sites (`:541`, `:589`, `:679`, `:751`,
`:802`, …) and is **not** among the seven files the guard reads. That looked like the round-302
shape.

It is not:

```
$ grep 'orderType' crates/../TableManagementScreen.tsx
(no matches)
```

The rule is "a table number is only valid on a dine-in order". `TableManagementScreen` never
writes `orderType`, so its payloads cannot **self-contradict** — and a table operation is
inherently dine-in by definition. The rule does not apply, and the guard's file list is right.

## Result 2: the tables backend is not the held-cart shape

The nine table commands are gated on **permissions** (`TABLES_CLOSE`, `TABLES_ASSIGN`), not on
workspace type — a different and coherent model, since a table is not a vertical-specific concept
the way an open bill is. Reading the two destructive ones:

- `release_table` is transactional, treats `rows == 0` as `NotFound`, and does its read-back
  inside the same transaction; it is explicitly tested, including joining a caller's transaction.
  Status is validated (`update_table_status_invalid_rejected`).
- `update_table_status` and `assign_table_order` follow the same shape.

Both `list_tables_scoped` and `get_table_scoped` carry `// ungated-ok: read by design (module
header) - floor-plan data, not tenant secrets` — the exemption is **annotated at the call site**,
which is what makes it reviewable rather than an omission.

## The full-surface measurement

Seventeen rounds of changes had accumulated since the last complete run, so:

| Check | Result |
|---|---|
| **Full UI vitest suite** | **798 files, 12,737 passed, 0 failed** |
| **Restaurant e2e fleet, desktop** | **144 passed, 0 failed** (64 spec files) |
| Earlier-round guards re-run by name | all pass — order-type (39), lease conflict (2), held carts (13), open-tab shift guard (4) |
| Rust `kasirmu-bridge` + `kasirmu-core` full run | **still in flight when this was written** — see below |

The unit total moved 12,736 → 12,737 since round 301, and the e2e total 144 → 144 with one new
file: the growth is this session's own tests and nothing regressed around them.

## What is NOT claimed

The full Rust run was still executing when this record was written — the bridge crate has ~1500
tests including slow crypto and DB cases, and it had been running for several minutes past the
point where the record needed to be written. **It is reported as unverified rather than assumed
green.** Every Rust suite actually run this round and in rounds 302-304 passed:

- `cargo test -p kasirmu-bridge --lib pos::` → 63 passed
- `cargo test -p kasirmu-bridge --lib store_pos` → 5 passed
- `cargo test -p kasirmu-core --lib held_cart` → 6 passed
- `cargo clippy -p kasirmu-core -p kasirmu-bridge --all-targets -- -D warnings` → clean

## The shape of a quiet round

Rounds 300 and 305 both produced negative results; rounds 301 and 304 produced limits rather than
defects. Four of the last six rounds found nothing to fix, and that is what a maturing audit looks
like — the loud findings are behind it.

The useful thing to carry forward is **which questions are still productive**, because "look
harder" is not one:

1. *Where is this rule enforced, and is it enforced at every place the same data can be reached?*
   — paid three times (302, 303, 304), and closed the held-cart axis.
2. *Which inputs can reach this, and is it correct on those?* — paid once (301), and needs a
   caller-side reachability argument to be worth anything.
3. *Is the guard itself discriminating?* — paid once (304), catching a completeness check that
   passed on a tree with the gate deleted.

A rule that name-drops its own site count in the source, as the dine-in rule does, is a strong
hint it is already well audited — which is why checking it produced a negative result rather than
a fourth finding.

> last audited 16-10-26 by docs-auditor
