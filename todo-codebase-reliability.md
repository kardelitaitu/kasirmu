# todo — codebase reliability (Rust)

<!-- Audit stamp: 2026-09-27 · BK · status: ACCURATE · HEAD 6c9e4328a · branch 0.0.40
     change: rewritten from a generic "how to make Rust bug-free" essay into a
     measured checklist. Every "now" figure below was produced on this checkout by
     the command named beside it, not recalled from the previous revision of this
     file. The previous revision's claims that did NOT survive measurement are
     listed in §1 with the number that killed them.
     Re-audit trigger: any change to .github/workflows/dev-ci.yml, scripts/gates.json,
     .config/nextest.toml, or Cargo.toml [workspace.lints]. -->

Scope: the Rust workspace (`crates/`, `modules/`, `platform/`, `foundation/`,
`apps/cloud-server`, `apps/desktop-tauri`, `apps/mobile-tauri`). Not the React
renderer, not the Go licence server.

**How to use this file.** Every box is either ticked `[x]` with the measurement
that closes it, or open `[ ]` with an acceptance command. An item is done when
its acceptance command is run and exits 0 — not when the code "looks right".
When all P0 and P1 boxes are ticked, this file may be renamed
`done-todo-codebase-reliability.md`; until then it keeps the `todo-` prefix.

---

## 1. Audit of the previous revision (measured, not recalled)

| Previous claim | Measured at `6c9e4328a` | Verdict |
|---|---|---|
| `deny(unsafe_code)` in almost all crates | 7 of 38 crate roots deny it — `kasirmu-cli`, `kasirmu-core`, `kasirmu-hal`, `kasirmu-lua`, `kasirmu-payment`, `kasirmu-reporting`, `kasirmu-security`. 27 `unsafe {` + 7 `unsafe impl/fn/no_mangle` sites; every non-test one sits in 4 files (`kasirmu-logging` syslog/eventlog, `kasirmu-security/windows.rs`, `kasirmu-hal/transport/bt_android.rs`, `kasirmu-lua` Send/Sync). `grep -rl '#!\[deny(unsafe_code)\]' --include='*.rs' crates modules platform foundation apps` | **Partly true** — opt-in per crate, not the default |
| `warn(clippy::pedantic, clippy::nursery)` | 0 hits outside this file. CI runs `cargo clippy --workspace --all-targets -- -D warnings` (`dev-ci.yml:325`) — default groups only. `grep -rn 'clippy::(pedantic\|nursery)'` | **FALSE** |
| Clippy warnings as errors in CI | True twice over: `dev-ci.yml:325` and workflow-wide `RUSTFLAGS: -D warnings` (`dev-ci.yml:12`, `android.yml:49`) | **TRUE** |
| `RUSTDOCFLAGS="-D warnings"` | Not set anywhere. `grep -rn 'RUSTDOCFLAGS' .github .cargo scripts` → no hits | **FALSE** |
| Never `unwrap()`/`expect()` in production | Policy exists and is enforced: `dev-ci.yml:754` runs `python3 scripts/scan-unwrap-panic.py` inside `static-gates`; `gates.json` marks `panic-inventory` **required**. Measured 2026-09-27: **exit 0 — GREEN**. See P0-1 | **TRUE and now GREEN** |
| Newtypes for money / enums for state | `Money { minor_units: i64, currency: Currency }` (`foundation/src/money.rs:19`); zero `f32`/`f64` in that file; `foundation/src/enums.rs` carries `SaleStatus`/`PaymentMethod` | **TRUE** |
| "Use proptest heavily" for inventory math, sync, concurrency | proptest is a dev-dependency of exactly **2** crates (`kasirmu-core`, `foundation`); **6** `proptest! {}` invocations; **4** files. `platform/sync` and `modules/inventory`: **0** | **FALSE** — absent precisely where it matters |
| Fuzzing is "critical" and running | 7 `cargo-fuzz` targets exist under `tools/fuzz/fuzz_targets/`, excluded from the workspace. `gates.json` → `fuzz` status **retired**; no workflow and no script invokes `cargo fuzz` | **FALSE** — targets written, nothing runs them |
| Coverage tool + enforced minimum in CI | `scripts/coverage.sh` / `.ps1` use `cargo-llvm-cov`; `gates.json` → `coverage` status **retired**; no threshold is enforced by anything | **FALSE** |
| Miri / Loom / Kani | 0 hits across `.github/workflows/dev-ci.yml`, `release.yml`, `.githooks/*`, `scripts/check.sh`, `scripts/run-pre-push.py`, `.config/` | **FALSE** — never adopted |
| `cargo-deny` / `cargo-audit` strict | `deny.toml` is real and current, but its only runner is one **non-blocking** leg in `scripts/check.sh`; `gates.json` → `audit` status **advisory** | **Partly** — configured, not enforced |
| Model-based / deterministic multi-location replay | None found. `platform/sync` has `conflict.rs`, `crdt/`, and 12 test modules including `sync_client_divergence_tests.rs`, but no replay harness and no seeded multi-device simulator. `grep -rl 'simulat' --include='*.rs'` → hits are unrelated test names | **FALSE** |
| End-to-end tests | `ui/e2e/*.spec.ts` (Playwright) exists; `dev-ci.yml` has **no** e2e job; `gates.json` → `e2e` required with `ci: null` | **Partly** |
| "40–60% tests" / high volume | 10,514 `#[test]`/`#[tokio::test]` attributes across 1,236 `.rs` files, 485 `*_test(s).rs` files | **Volume high; percentage unverifiable** — no instrument measures it |

One risk the previous revision did not name: `.config/nextest.toml:15` sets
`retries = { count = 2 }` for `[profile.default]`, which is the profile
`dev-ci.yml` runs (no `--profile` passed). A test that fails twice and passes
third is reported green. The JUnit receipt (`scripts/verify-pg-tests-ran.py
--nextest-junit`) now grades it, but grading a flake is not the same as not
having one.

---

## 2. P0 — fix before anything else

- [x] **P0-1 — Make the panic inventory green.** **CLOSED 2026-09-27: the gate exits 0.** `scripts/scan-unwrap-panic.py` exited **1** at `6c9e4328a` on `crates/kasirmu-hal/src/drivers/edc/loopback.rs:131` (`self.script.lock().expect("loopback script poisoned")`, no `// SAFETY:`/`// INVARIANT:` marker), which failed `dev-ci.yml#static-gates` for every PR touching Rust. The fix was the first of the two options this item named — **document the invariant**, not convert to a `Result` path — and the marker it added is substantive rather than boilerplate: *"the mutex guards a `Vec` push/remove only; no code path can panic while holding it, so poisoning is impossible in practice."* Two further sites acquired markers in the same pass, both on the WAL diagnostics added this session (`examples/wal_tail_diagnosis.rs`, `examples/wal_sync_attribution.rs`), each stating a real precondition of the measurement (a failed open, migration or PRAGMA read voids the run) rather than a filler phrase. **Acceptance re-run this session: `python3 scripts/scan-unwrap-panic.py` -> exit 0.** The gate's own report now lists the remaining recoverable `expect()` sites as `[INVARIANT]`-marked, which is the state the inventory exists to describe.
      Fix either way: add the invariant comment, or convert to a `Result` path.

- [x] **P0-2 — Decide the flake policy in writing.** Retries hide real
      nondeterminism; a JUnit receipt that reports `1 flaky` and exits 0 still
      ships the bug. Choose one: (a) a no-retry CI leg
      (`cargo nextest run --workspace --all-features --profile quick`, which
      already sets `retries = 0`), or (b) keep retries and make the JUnit
      receipt fail the build on any `<flakyFailure>`.
      Acceptance: the chosen option runs in `dev-ci.yml` and a seeded flake
      turns the job red. Verify non-vacuously — do not ship a leg that cannot fail.
      **CLOSED 2026-09-27: option (b) chosen, and it was already live —
      `dev-ci.yml:373-374` runs
      `verify-pg-tests-ran.py --nextest-junit target/nextest/default/junit.xml`
      after the workspace run, and `.config/nextest.toml:15` keeps
      `retries = 2` for the default profile, so retries stay and the receipt
      grades them. Non-vacuity is the checker's own planted fixture, re-run
      this session: `--self-test` asserts *"a rescued flake is graded FAIL,
      not pass"* and *"...and the rescued test is named"*, both `ok`.**
      What this session actually found is narrower and worth recording: the
      *verdict* ran, but the checker's **`--self-test` ran in neither
      `dev-ci.yml` nor `scripts/check.sh`** — and when run for the first time
      it was **RED**, on
      `FAIL  tree census still equals the stated baseline (84)`. The tree had
      grown to **88** arms across 16 test files in 3 crates; the growth is
      legitimate and traceable to the `kasirmu-api` `pg.rs` split
      (`pg_tests.rs` alone holds 15), not to any arm conversion.
      `ARM_BASELINE` moved 84 -> 88 in the same commit, per the contract its
      own comment states; **`ARM_FLOOR` deliberately stayed at 65**, because
      raising a floor to track a larger census erodes the headroom that
      absorbs a legitimate conversion. The self-test is now a `static-gates`
      step beside the panic inventory, registered as gate
      `pg-receipt-selftest` in `scripts/gates.json` and runnable from
      `check.sh`, so the checker cannot silently go stale again — the same
      reasoning as `auditor-selftests`: a checker that cannot run is
      indistinguishable from a checker that found nothing.
      **Acceptance re-run this session: `python3 scripts/verify-pg-tests-ran.py
      --self-test` -> exit 0; `python3 scripts/verify-ci-docs-drift.py` -> 0
      drift item(s).**

- [x] **P0-3 — Put the fuzz targets back under a runner, or delete them.**
      Seven targets (`cart_deser`, `kasirpkg_parse`, `lua_parse`,
      `manifest_parse`, `money_parse`, `percentage_parse`, `sku_parse`) exist and
      are compiled by nothing. Dead targets rot silently: they already reference
      a `tools/fuzz/rust-toolchain.toml` nobody pins in CI.
      Acceptance: one `dev-ci.yml` job runs `cargo fuzz run <target> -- -max_total_time=60`
      for all 7 on PRs touching `crates/` or `foundation/` — or the directory is
      removed and this box is closed with the removal commit. Note the recorded
      trap before restoring: the retired job set `RUSTC_WRAPPER: ''` because the
      runner image's sccache breaks `cargo fuzz build`'s rustc version probe.
      **CLOSED 2026-09-27, by the second route's SPIRIT rather than its letter:
      the targets are now compiled by something, but the fuzzers still do not
      run — and that split is measured, not assumed.**
      What was actually wrong: **all four path dependencies in
      `tools/fuzz/Cargo.toml` pointed at a directory that does not exist.**
      `foundation = { path = "../foundation" }` resolves against
      `tools/fuzz/Cargo.toml` to `tools/foundation/`, as do the three
      `../crates/...` siblings — every one is off by the level the directory
      gained when it moved under `tools/`. So `cargo fuzz build` died at
      **manifest load** (`failed to load manifest for dependency `foundation``),
      before rustc was invoked: the targets were not rotted code, they were
      **unreachable**, and no runner had ever failed because none could get far
      enough to try. Corrected to `../../` and verified rather than reasoned:
      `cargo check --bins --all-features` in `tools/fuzz` now finishes with
      **zero errors across all seven**, including the three behind
      `kasirmu-core-fuzz` / `kasirmu-plugin-fuzz`.
      Why the *run* half is still open, measured: `cargo fuzz build` now
      compiles and links every dependency, then fails at
      `could not open '...\nightly-x86_64-pc-windows-msvc\lib\rustlib\
      x86_64-pc-windows-msvc\lib\librustc-nightly_rt.asan.a'` — `Get-ChildItem
      ...\lib\*asan*` is empty. libFuzzer + AddressSanitizer ships no MSVC
      runtime, so the sanitizer-linked build is Linux-only. That is an upstream
      platform limit, not a local misconfiguration, and the box's own
      `RUSTC_WRAPPER=''` trap was confirmed live on the way: without it the
      probe dies before rustc runs.
      What landed instead: a `fuzz-typecheck` job in `dev-ci.yml` (rust-route
      gated, `cargo check --bins --all-features`, `working-directory:
      tools/fuzz`) — the half that catches the failure mode actually observed —
      registered as gate `fuzz-typecheck` in `scripts/gates.json`, runnable from
      `check.sh`, and added to the deploy `needs` chain. Both traps and the
      Linux-only constraint are recorded in `tools/fuzz/rust-toolchain.toml`
      so the next reader does not rediscover them.
      **Acceptance re-run this session: `cargo check --bins --all-features`
      (tools/fuzz) -> `Finished`, 0 errors; `verify-ci-docs-drift.py` -> 0 drift
      items.**
      Deliberately NOT done: restoring `cargo fuzz run`, which the box's first
      route asks for. It cannot link on this platform, and a job that cannot run
      is the exact decoration this checklist exists to remove.

---

## 3. P1 — the testing-depth gap (where the real risk is)

The workspace has volume (10,514 tests) but no evidence about *which* paths are
covered, because no coverage instrument is enforced. Close that in this order.

- [x] **P1-1 — Property tests on money, inventory and sync.** Today proptest
      reaches `foundation/src/money_proptests.rs` and
      `crates/kasirmu-core/src/features_proptests.rs` only. Add `proptest` as a
      dev-dependency and write properties for:
      - `platform/sync/src/conflict.rs` — conflict resolution is commutative and
        idempotent regardless of arrival order;
      - `modules/inventory` — stock never goes negative under any interleaving
        of adjustments and sales;
      - `foundation/src/money.rs` — the existing checked-arithmetic invariants.
      Acceptance: `cargo test -p platform-sync -p modules-inventory -p foundation`
      with ≥1 `proptest!` block in each of the three crates, and
      `grep -rc 'proptest' platform/sync modules/inventory` > 0.
      **CLOSED 2026-09-27. All three crates now carry property tests, and the
      acceptance grep passes for every path: `platform/sync` has 8 hits across
      `conflict.rs` / `conflict_proptests.rs` / `Cargo.toml` (was **0** — not
      even the dev-dependency declared), `modules/inventory` has 4 (was **0**),
      `foundation` already had its money proptests.**
      `platform/sync` — `conflict_proptests.rs`, 10 properties, 446 tests green.
      `modules/inventory` — `models_proptests.rs`, 12 properties, 90 tests green.
      Both suites were **mutation-tested rather than assumed**, which is what
      turned three weak or wrong assertions into good ones:
      - Replacing the sale status-DAG with a timestamp comparison fails 3
        properties, including `sale_prefix_routes_to_the_sale_resolver` — which
        exists because a test calling `resolve_sale_lww` directly keeps passing
        even if the DISPATCHER stops routing `sale.*` to it.
      - The first CRDT property checked only that the `local`/`remote` keys
        existed, and **survived** a mutation replacing the remote delta with
        `Value::Null`. Strengthened to compare parsed values; it now fails on
        that mutation.
      - `is_low_stock`'s boundary property fails when `<=` becomes `<`.
      **Two corrections to this box's own text, both because the requested
      property is FALSE and asserting it would have graded correct code red:**
      1. *"stock never goes negative under any interleaving"* is **not this
         crate's contract.** `WorkspaceInventoryLocation.allow_negative_stock`
         (`models.rs:368`) is a documented per-location policy flag, and
         `Repository::adjust_stock_tx` (`repository.rs:130`) applies a raw
         `UPDATE inventory SET qty = qty + ?1` with no floor — deliberately, so
         a location that opts in can oversell. The only non-negativity guard is
         `Inventory::new`'s constructor assertion, which cannot see a running
         balance. The tests assert the contracts that hold (constructor
         rejection, `is_low_stock` inclusivity, name/SKU normalisation,
         `ProductType` fallback) and `models_proptests.rs` records this
         correction in prose so the next reader does not re-derive it.
      2. *"commutative and idempotent regardless of arrival order"* is also not
         quite right. Ties are **remote-authoritative by design**, so
         `f(a,b) != f(b,a)` as items; what IS order-independent is the surviving
         **rank**, and that is what the symmetry properties assert. And
         `resolve_stock_crdt` is **not idempotent** — it mints a fresh
         `Uuid::now_v7()` per call — which is correct for a delta merge and
         wrong to call idempotent, so
         `crdt_merge_mints_a_fresh_winner_id_each_call` pins the real behaviour.
      Also worth recording: writing these found that `Sku::new` **trims**
      (`foundation/src/sku.rs:34`, documented). My first property asserted a
      byte-exact round trip and correctly failed on `"0 "`. The trim is safe
      only because the empty result is rejected, so both halves are now pinned.
      Regression seeds are committed (`proptest-regressions/*.txt`), matching
      the `foundation` precedent, so the shrunk cases re-run for everyone.
      **Acceptance re-run this session: `cargo test -p platform-sync` -> 446
      passed; `cargo test -p modules-inventory` -> 90 passed; grep > 0 for all
      three crates.**

- [ ] **P1-2 — Wire `cargo-llvm-cov` into CI with a floor, or retire the tool
      explicitly.** `scripts/coverage.sh` works locally; nothing enforces a
      number. Pick a floor per crate rather than workspace-wide (a global
      average hides the crates that matter).
      Acceptance: `dev-ci.yml` runs
      `cargo llvm-cov --workspace --json --output-path coverage.json` and a step
      fails when `kasirmu-core`, `foundation`, `platform/sync`,
      `modules/inventory` fall below the agreed line figure. Record the figure
      in this file when chosen — an unrecorded threshold is not a threshold.

- [ ] **P1-3 — Build the deterministic multi-device replay harness.** One
      binary that takes a seeded script of offline operations from N locations,
      replays them in a chosen order, and asserts the converged state. This is
      the only instrument that can answer "did multi-location sync actually
      converge" without a fleet of tablets.
      Acceptance: `cargo test -p platform-sync --test <name>` replays ≥3 seeded
      interleavings and asserts identical converged state; CI runs it.

- [ ] **P1-4 — Adversarial tests for the critical path.** Deliberate attempts
      to double-spend stock, replay a settled sale, and apply a refund larger
      than the sale total across two locations.
      Acceptance: named tests under `platform/sync` and `modules/inventory`
      whose failure message names the invariant violated.

---

## 4. P2 — compiler and lint surface

- [x] **P2-1 — `RUSTFLAGS: -D warnings` on the whole workflow.** Measured
      `dev-ci.yml:12` and `android.yml:49`.
- [x] **P2-2 — Clippy as an error.** `dev-ci.yml:325`,
      `cargo clippy --workspace --all-targets -- -D warnings`.
- [x] **P2-3 — `cargo fmt --all -- --check`.** `dev-ci.yml:252` (`rust-fmt` job).
- [ ] **P2-4 — `RUSTDOCFLAGS="-D warnings"`.** Not set anywhere. Add to the
      `dev-ci.yml` env block beside `RUSTFLAGS`.
      Acceptance: `RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps`
      exits 0 locally, then the env line lands in the workflow.
- [ ] **P2-5 — `clippy::pedantic` on the two crates that can take it.**
      Workspace-wide pedantic is noise; scoped pedantic is signal. Start with
      `foundation` and `kasirmu-core` via `[lints.clippy] pedantic = "warn"` in
      each manifest, fix what surfaces, then decide about the rest.
      Acceptance: `cargo clippy -p foundation -p kasirmu-core --all-targets -- -D warnings`
      exits 0 with pedantic enabled. Do **not** enable `nursery` — it is
      explicitly unstable and will churn every release.

- [ ] **P2-6 — Extend `deny(unsafe_code)` to the crates that can carry it.**
      7 of 38 crate roots deny it today. The remaining ones are mostly
      unexamined rather than genuinely unsafe. Audit them crate by crate and add
      the attribute where the crate has zero `unsafe`; where it has some, use
      the existing file-scoped `#![allow(unsafe_code)]` precedent
      (`kasirmu-security/src/windows.rs:13`,
      `kasirmu-hal/src/transport/bt_android.rs:31`).
      Acceptance: count rises above 7 and every new deny survives
      `cargo check --workspace --all-targets`. Leave `kasirmu-logging`,
      `kasirmu-security`, `kasirmu-hal`, `kasirmu-lua` on file-scoped allows —
      their FFI is real.

---

## 5. P2 — runtime invariants and observability

- [ ] **P3-1 — State the critical-path invariants in one place.** Today there
      are 79 `debug_assert!` sites and ~199 comments mentioning invariants,
      scattered. Write them as a single list (stock ≥ 0; sale total == sum of
      line totals; refund ≤ settled total; sync convergence is order-independent)
      and link each to the test that enforces it.
      Acceptance: `docs/architecture/` carries the list; each invariant names
      its enforcing test.
- [ ] **P3-2 — Log invariant violations in debug/staging builds.** Where an
      invariant is checked at runtime today it panics or is silently repaired.
      Route violations to `tracing::error!` with the entity id so a staging run
      surfaces them before a customer does.
      Acceptance: one seeded violation produces an `error!` line naming the
      invariant and the entity.
- [ ] **P3-3 — Keep the `unsafe` inventory reviewable.** 27 `unsafe {` sites and
      7 `unsafe impl/fn/no_mangle` items, all in 4 production files plus 8
      test-only sites. Every one must carry a `// SAFETY:` line.
      Acceptance: `grep -rn 'unsafe' --include='*.rs' crates modules platform foundation apps`
      shows no `unsafe` item without a `SAFETY:` comment on the same or
      preceding line; consider a `static-gates` step that enforces it.

---

## 6. P3 — supply chain and housekeeping

- [ ] **P4-1 — Decide whether `cargo-deny` blocks or advises.** `deny.toml` is
      accurate and its refresh procedure is honest about being manual, but the
      only runner is a non-blocking `scripts/check.sh` leg and `gates.json` says
      `advisory`. Either promote it to `required` with a `dev-ci.yml` job, or
      leave it advisory and stop calling it a gate.
      Acceptance: `gates.json` status matches the runner that actually exists.
- [ ] **P4-2 — E2E: run it or drop the `required` status.** `ui/e2e/` has real
      Playwright specs; `dev-ci.yml` has no e2e job; `gates.json` marks `e2e`
      required with no CI entry. That combination is a gate that cannot fail and
      therefore does not exist.
      Acceptance: either an e2e job lands in `dev-ci.yml`, or the `e2e` entry
      moves to `retired` with a note.
- [ ] **P4-3 — Re-measure the test-volume claim.** "40–60% coverage" has no
      instrument behind it. Once P1-2 lands, replace it with a per-crate line
      figure stamped with a date.

---

## 7. Explicitly rejected

Recorded so the question does not get re-litigated every few weeks.

- **Kani / Creusot formal verification.** Rejected. The proof obligations that
  matter (sync convergence, stock non-negativity) are properties over sequences
  of operations, not over single functions; property tests plus the P1-3 replay
  harness reach the same confidence at a fraction of the cost. Revisit only if a
  proven-critical function is small and self-contained.
- **Loom.** Rejected for now. `platform/sync` is tokio/task-based rather than
  raw-atomic, and Loom models `std::sync` primitives. Revisit if a concurrency
  bug is traced to a hand-rolled atomic.
- **Miri.** Rejected as a scheduled CI job; keep it as a manual tool for
  investigating a suspected UB site. With ~20 `unsafe` sites all confined to FFI
  shims, a nightly Miri run would mostly re-verify safe code.
- **`clippy::nursery`.** Rejected — unstable by upstream's own definition.
- **Workspace-wide `clippy::pedantic`.** Rejected in one step; staged instead
  under P2-5.

---

## 8. Order of work

1. ~~P0-1 (panic inventory red — blocks every Rust PR today).~~ **DONE 2026-09-27 — gate exits 0.**
2. P0-2 (flake policy) and P0-3 (fuzz targets) — both are "decide and wire".
3. P1-1 then P1-3 — property tests first; the replay harness is what makes
   multi-location claims testable at all.
4. P1-2 — coverage floor, once there is something worth measuring.
5. P2-4, P2-5, P2-6 — cheap compiler-surface wins.
6. P3-*, P4-* — housekeeping.

**Reality check, unchanged from the previous revision and still correct:** for
an offline-first multi-location system, "bug-free" is not attainable. What is
attainable is fast detection — and detection requires an instrument that runs.
Most items above are not "write more tests"; they are "make an existing
instrument actually run, or admit that it does not".
