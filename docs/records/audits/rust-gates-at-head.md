# Rust-side CI gates, re-verified at HEAD (2026-10-13, round 75)

## Why this note exists

Round 33 recorded that every `static-gates` step passes on this tree. The RUST legs were
verified then too, but they have moved since — round 74 cleared six clippy warnings in
`kasirmu-core` and `kasirmu-hal`, and round 75 found a seventh that only `--all-targets`
could see. This records the state after that work, so the next reader does not re-run
17-minute suites to find out what is already known.

## What was run, at HEAD

| Command | Result |
|---|---|
| `cargo clippy --workspace --all-targets` | **clean** — 0 warnings, 0 errors |
| `cargo doc --workspace --no-deps` | **clean** — 0 warnings |
| `cargo fmt --all -- --check` | clean |
| `cargo test -p kasirmu-core --lib` | 3622 passed, 0 failed |
| `cargo test -p kasirmu-hal` | 373 + 21 + 1 + 6 passed, 0 failed |
| `cargo test -p kasirmu-bridge --lib` | see `kasirmu-bridge-suite-runtime.md` — 1509 passed, 0 failed, ~17 min |

`clippy --workspace --all-targets` is exactly the command `dev-ci.yml#cargo-clippy` runs
with `-D warnings` appended, so a clean run here is the job's own assertion.

## The gap that round 74 left, and round 75 closed

Round 74 checked `-p kasirmu-core -p kasirmu-hal --lib` and reported 6 → 0. CI runs
`--all-targets`, which also compiles TESTS, and one warning lived only there:

```
crates/kasirmu-hal/src/drivers/receipt_tests.rs:520  collapsible_if
```

**The lesson is the flag, not the fix.** A crate-clean `--lib` run is not the CI gate; the
difference is precisely the test targets, which is where a large share of this repo's Rust
lives (`*_tests.rs` siblings). Any future check of this gate must pass `--all-targets` or it
is measuring something else.

## Two of the seven were NOT mechanical

The round-74 merge in `products.rs` was **semantically wrong** and a test caught it:
the inner `else` returns `true`, which is not the same as falling through to the outer
`else`, so merging makes an untracked product's availability depend on ledger stock it does
not use. It carries `#[allow(clippy::collapsible_if, clippy::if_not_else)]` with the
reason and the test that catches a re-merge.

The `receipt_tests.rs` merge (round 75) IS mechanical — both arms fall through to the same
no-op — which is why it was applied rather than suppressed. **The two sites look identical
to a linter and are opposites to a reader.**

## What this does NOT cover

The UI gates (tsc, eslint, vitest, i18n) are separate and recorded elsewhere. `cargo test
--workspace` was not run as one command: the bridge suite alone takes ~17 minutes, so the
crates were checked individually. A workspace-wide run is the thing this note approximates,
not the thing it performed.

> last audited 14-10-26 by docs-auditor
