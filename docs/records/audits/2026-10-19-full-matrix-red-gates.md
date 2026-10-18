# Three red gates, and the one that was only ever red here — 2026-10-19

**Method:** ran the full `scripts/check.sh` matrix (161 steps) instead of a hand-picked subset.
That was the round-4 lesson applied: my own sweep was the weak link, not the repository.
**Result:** 3 real defects repaired, 1 environmental non-defect identified and defaulted around.
Steps 01–30 now pass; the matrix reaches step 31, which needs a Postgres this host does not have.

## Why this pass was different

Every earlier round in this session verified a deliberately chosen set of gates and reported
"all green". That set was chosen by me, from the checks I happened to know about — and it missed
`skill-drift-guard`, which my own footer drain had broken 260 ways (repaired earlier this round). A
gate you do not run is indistinguishable from a gate that passes, so this pass ran the matrix.

## Defect 1 — `clippy --workspace` was red (two causes)

- `crates/kasirmu-core/src/db/provisioning.rs:597` declared a six-field tuple inline as
  `&[(&str, &str, i64, i64, &str, Option<&str>)]`, tripping `clippy::type_complexity` under
  `-D warnings`. Fixed with the alias the lint itself suggests — `type SampleItem<'a> = (...)` —
  which also makes the call sites legible: a bare six-tuple does not tell a reader which `i64` is
  the price and which is the quantity.
- `apps/mobile-tauri/src/commands/pos_tests.rs:353` cloned a `CartId`, which derives `Copy`
  (`foundation/src/cart.rs:22`). Removed; the later use of `cart_id` at `:366` is unaffected
  precisely because it is `Copy`.

Published toolchain is `1.98.1` locally and in CI (`.github/workflows/dev-ci.yml` pins
`toolchain: 1.98.1`), so this would have failed CI, not just this host.

## Defect 2 — `rustdoc -D warnings` was red

`crates/kasirmu-bridge/src/pos/hold_orders.rs:311,342` linked a **private** helper from the docs of
two **public** functions, which is `rustdoc::private-intra-doc-links`. Made them plain code spans
rather than `pub`: widening the crate's API to satisfy a doc link is the wrong trade. The module
header at `:32` links it too and is accepted, because `//!` module docs are not subject to the same
public-API rule.

## Defect 3 — `ipc-parity` was red, and there were TWO call sites

`verify-ipc-parity.py` reported `PosScreen.tsx:893` reaching the tablet-only
`get_cart_deduction_location` from the desktop shell. The root cause is a truthiness test on an
empty string: `sessionToken` is `rawToken || ''` (`PosScreen.tsx:157`), so "no session" is `''`,
which is falsy, which takes the ambient branch that desktop does not register.

**The gate named one site; there were two.** `usePosCartActions.ts:128` had the identical bug, and
fixing only the reported one left the new test failing — which is how it was found. Both now gate on
`sessionToken || !isTabletShell()`, using the `isTabletShell()` helper the file already imported.

**The test that proved it.** A new case in `PosScreenDeductionLocation.test.tsx` asserts the desktop
with an empty token never calls the ambient wrapper. It was verified to **fail against the old code
and pass against the fix** by reverting both call sites in memory, running, and restoring — a test
that cannot fail is not evidence. The existing 7 cases all stubbed the *populated-token* path, which
is why 7/7 passed while the bug was live.

## The non-defect, and the one-line default

`check.sh` step 31 failed with 1516 `kasirmu-bridge` tests erroring at
`testing.rs:536: creating data dir ... Access is denied (os error 5)`. This is **not a code defect**:
`unique_store_dir()` is `std::env::temp_dir()`, and under a restricted sandbox the spawned test
*binary* is denied writes to the system temp dir even though the calling shell can write there.
Confirmed by pointing `TMP` inside the tree — **1516/1516 pass**. Fails identically under
`cargo test` and with `--test-threads=1`, so it is neither contention nor nextest.

`check.sh` now defaults `TMP`/`TEMP` into the gitignored `target/.tmp-check` when `TMP` is unset or
unwritable. An explicit `TMP` always wins, so this changes nothing on a normal host; it only removes
a failure that had no signal a caller could act on.

## Still red, and correctly so

Step 31 also fails `kasirmu-api pg::tests::pg_exchange_rates_roundtrip`, which needs a Postgres at
`localhost:15432`. That is **deliberate**: under `--all-features` the `pg-tests` feature is on, and
`pg_tests.rs:1604-1609` panics by design when the flagged test cannot reach its resource
("PG test enabled but the resource is unreachable"). `scripts/reset-dev-pg.sh` provisions it and
`docker ps` shows the daemon is not running on this host, so the matrix cannot pass here without it.
Recorded rather than skipped: a gate made green by omission is the failure mode this file exists to
name.

## Steps not yet reached

The matrix stops at the first failing step, so steps 32–161 have not run. Reachability of the rest
requires the PG container; that is the next real milestone, not a doc task.

> last audited 19-10-26 by docs-auditor
