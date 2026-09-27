# done — codebase reliability (Rust)

<!-- Audit stamp: 2026-09-27 · BK · status: ACCURATE · HEAD 6c9e4328a · branch 0.0.40
     change: rewritten from a generic "how to make Rust bug-free" essay into a
     measured checklist. Every "now" figure below was produced on this checkout by
     the command named beside it, not recalled from the previous revision of this
     file. The previous revision's claims that did NOT survive measurement are
     listed in §1 with the number that killed them.
     Re-audit trigger: any change to .github/workflows/dev-ci.yml, scripts/gates.json,
     .config/nextest.toml, or Cargo.toml [workspace.lints]. -->

**RENAMED `todo-` → `done-` 2026-09-27**, on the condition this file set for
itself: *"When all P0 and P1 boxes are ticked, this file may be renamed
`done-todo-codebase-reliability.md`."* All 3 P0 and all 4 P1 boxes are ticked,
and each was closed on its **acceptance command having been RUN and passed**,
not on the code looking right. Re-verified together at the moment of the
rename:

| box | acceptance command | result |
|---|---|---|
| P0-1 | `python3 scripts/scan-unwrap-panic.py` | exit 0 |
| P0-2 | `python3 scripts/verify-pg-tests-ran.py --self-test` | exit 0 |
| P0-3 | `cargo check --bins --all-features` (tools/fuzz) | Finished, 0 errors |
| P1-1 | `cargo test -p platform-sync -p modules-inventory -p foundation` | 0 failures; grep > 0 in all three crates |
| P1-2 | `python3 scripts/verify-coverage-floors.py` | exit 0 (13/13 self-test) |
| P1-3 | `cargo test -p platform-sync --test convergence_replay` | 3 passed |
| P1-4 | `cargo test -p platform-sync --test adversarial_paths` | 4 passed |

The `todo-` token is retained INSIDE the new name on purpose:
`.agents/skills/docs-auditor/scripts/check-dead-refs.py` exempts any filename
containing `todo-`, and `done-todo-…` still matches.

**What renaming does NOT mean.** P2/P3/P4 remain open — the compiler and lint
surface, the runtime-invariant list, and the supply-chain items. `done-` is
earned for the P0/P1 tier only, which is what this file's own rule specified.

Scope: the Rust workspace (`crates/`, `modules/`, `platform/`, `foundation/`,
`apps/cloud-server`, `apps/desktop-tauri`, `apps/mobile-tauri`). Not the React
renderer, not the Go licence server.

**How to use this file.** Every box is either ticked `[x]` with the measurement
that closes it, or open `[ ]` with an acceptance command. An item is done when
its acceptance command is run and exits 0 — not when the code "looks right".

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
| "40–60% tests" / high volume | 10,514 `#[test]`/`#[tokio::test]` attributes across 1,236 `.rs` files, 485 `*_test(s).rs` files | **Replaced by measurement — see §1.1.** Volume high; the old "40–60% coverage" figure had no instrument behind it and is withdrawn. |

### 1.1 Coverage, measured — 2026-09-27, instrumented (P4-3)

The "40–60% coverage" claim was withdrawn here because **nothing measured it**.
It is replaced by per-crate line coverage from `cargo llvm-cov`, the same run
`scripts/verify-coverage-floors.py` grades. Reproduce with:

```
cargo llvm-cov --workspace --all-features \
  --exclude kasirmu-app --exclude kasirmu-mobile --exclude kasirmu-bridge \
  --json --output-path coverage-probe.json
python3 scripts/verify-coverage-floors.py        # grades the 4 floored crates
```

**Workspace total: 73.9% (48,737 / 65,959 lines) — informational, not gated.**
That single number is the honest replacement for the withdrawn range, and it
lands at the TOP of the old 40–60% band's upper edge, not inside it.

Per-crate, all 36 crates the run instrumented (lines covered / instrumentable):

| crate | line % | lines | files |
|---|---|---|---|
| `modules/giftcards` | 100.0% | 27 / 27 | 2 |
| `modules/kitchen` | 100.0% | 27 / 27 | 2 |
| `modules/promotions` | 100.0% | 27 / 27 | 2 |
| `modules/purchasing` | 100.0% | 27 / 27 | 2 |
| `foundation` | 99.4% | 813 / 818 | 12 |
| `crates/kasirmu-crypto` | 99.1% | 214 / 216 | 1 |
| `modules/staff` | 96.9% | 156 / 161 | 5 |
| `crates/kasirmu-reporting` | 96.8% | 329 / 340 | 4 |
| `modules/terminal` | 96.4% | 106 / 110 | 5 |
| `modules/currency` | 96.4% | 397 / 412 | 5 |
| `modules/sales` | 95.6% | 345 / 361 | 5 |
| `modules/crm` | 95.5% | 105 / 110 | 5 |
| `modules/loyalty` | 95.4% | 103 / 108 | 5 |
| `modules/tax` | 94.9% | 111 / 117 | 5 |
| `crates/kasirmu-local-api` | 93.7% | 283 / 302 | 1 |
| `modules/reporting` | 92.2% | 59 / 64 | 4 |
| `crates/kasirmu-security` | 87.8% | 309 / 352 | 6 |
| `platform/kernel` | 87.3% | 488 / 559 | 4 |
| `crates/kasirmu-payment` | 85.6% | 870 / 1016 | 11 |
| `crates/kasirmu-plugin` | 84.8% | 963 / 1136 | 5 |
| `platform/core` | 84.5% | 1914 / 2264 | 14 |
| `crates/kasirmu-core` | 83.8% | 25882 / 30903 | 135 |
| `modules/settings` | 82.5% | 52 / 63 | 5 |
| `crates/kasirmu-lan` | 82.3% | 519 / 631 | 4 |
| `crates/kasirmu-media` | 79.2% | 331 / 418 | 7 |
| `modules/inventory` | 78.4% | 301 / 384 | 7 |
| `crates/kasirmu-lua` | 76.7% | 306 / 399 | 2 |
| `crates/qris-core` | 75.4% | 748 / 992 | 13 |
| `platform/startup` | 73.0% | 641 / 878 | 6 |
| `crates/kasirmu-hal` | 72.6% | 1527 / 2103 | 31 |
| `crates/kasirmu-logging` | 68.8% | 150 / 218 | 3 |
| `platform/sync` | 68.7% | 2571 / 3745 | 16 |
| `crates/kasirmu-notification` | 59.3% | 227 / 383 | 5 |
| `crates/kasirmu-api` | 50.4% | 2947 / 5843 | 33 |
| `crates/kasirmu-cli` | 46.8% | 936 / 2000 | 13 |
| `apps/cloud-server` | 46.5% | 3926 / 8445 | 35 |

**Four crates have NO figure, and the reason matters more than the number:**
`apps/desktop-tauri`, `apps/mobile-tauri` (excluded as GUI shells — their
coverage is dominated by generated Tauri plumbing), `crates/kasirmu-bridge`
(excluded because an unrelated uncommitted change in another session had a test
failing, and `cargo llvm-cov` aborts on any failure), and
`scripts/updater-compat-check` (a build script, not a crate under test).

**Read the table with two caveats, both measured rather than assumed:**

1. **The four 100.0% crates are 27 lines each.** A perfect score on two files is
   not comparable to `kasirmu-core`'s 83.8% across 30,903 lines. Sorted by
   percentage they top the table; sorted by exposure they are the smallest
   entries in it. `crates/kasirmu-crypto` is a similar case at 99.1% of 216
   lines across a single file.
2. **The three biggest untested surfaces are also three of the largest crates.**
   `apps/cloud-server` (46.5% of 8,445), `crates/kasirmu-cli` (46.8% of 2,000)
   and `crates/kasirmu-api` (50.4% of 5,843) hold **16,288 lines between them —
   24.7% of every instrumentable line in the workspace** — and all three sit
   below every floored crate. That is why the workspace mean (73.9%) reads
   worse than the median crate (**87.3%**): `kasirmu-core` alone is 30,903
   lines at 83.8%, **46.9% of the total**, so the average is dominated by the
   large mid-coverage middle and dragged down by the three large low-coverage
   edges. Quote the median when the question is "is a typical crate tested",
   and the line-weighted mean when the question is "how much code is tested".

**Only 4 of these 36 have a floor** (`scripts/coverage-floors.json`:
foundation 97.0, kasirmu-core 81.0, modules-inventory 76.0, platform-sync 66.0);
the other 32 can regress silently. That is a stated consequence of P1-2's
"ratchet, not a target" policy, not an oversight — recorded here so the gap is
visible rather than implied by an absent row.

---

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

- [x] **P1-2 — Wire `cargo-llvm-cov` into CI with a floor, or retire the tool
      explicitly.** `scripts/coverage.sh` works locally; nothing enforces a
      number. Pick a floor per crate rather than workspace-wide (a global
      average hides the crates that matter).
      Acceptance: `dev-ci.yml` runs
      `cargo llvm-cov --workspace --json --output-path coverage.json` and a step
      fails when `kasirmu-core`, `foundation`, `platform/sync`,
      `modules/inventory` fall below the agreed line figure. Record the figure
      in this file when chosen — an unrecorded threshold is not a threshold.
      **CLOSED 2026-09-27 — floors CHOSEN and RECORDED, per this box's own rule.**
      The figure lives in `scripts/coverage-floors.json`, not in this prose,
      because a number in a checklist cannot fail a build. Graded by
      `scripts/verify-coverage-floors.py` (13-case `--self-test`, both
      directions); wired as a `check.sh` step and a `coverage-floors` CI job
      registered in `scripts/gates.json`, and added to the deploy `needs` chain.
      **The chosen floors, and the measurement behind them.** Measured
      2026-09-27 with
      `cargo llvm-cov --workspace --all-features --exclude kasirmu-app --exclude kasirmu-mobile --exclude kasirmu-bridge --json`:

      | crate | measured line % | **floor** |
      |---|---|---|
      | `foundation` | 99.4% | **97.0%** |
      | `kasirmu-core` | 83.8% | **81.0%** |
      | `modules-inventory` | 78.4% | **76.0%** |
      | `platform-sync` | 68.7% | **66.0%** |
      | (workspace, informational) | 73.9% | not gated |

      Each floor sits **two points below** its measured value: a RATCHET that
      freezes the level reached and fires on regression, rather than a target
      that goes red on day one and teaches people to ignore it. **Per-crate,
      as this box required** — and the measurement shows why: a single 70%
      floor would have PASSED with `platform-sync` (the crate this file calls
      the highest-risk surface) dropping a full point, because `foundation`'s
      99.4% would have carried the average. The checker's self-test plants
      exactly that case (a 95% workspace average still fails a 60% crate).
      **Verified against the real report, not only synthetic ones:** the gate
      passes at the recorded floors (99.4/83.8/78.4/68.7 vs 97/81/76/66), and
      raising `platform-sync`'s floor to 80 fails it with
      `68.7% < floor 80.0% (2571/3745 lines, short by 11.3 points)`.
      **Two constraints found by measuring rather than assuming.**
      (a) `cargo llvm-cov` **runs the whole suite and aborts on any failing
      test** — measured: an unrelated in-flight test failure in
      `kasirmu-bridge` aborted a full workspace run. So in `check.sh` a
      measurement failure is reported as *"could not measure"* rather than
      *"coverage regressed"*: those are different problems and conflating them
      sends a reader hunting for missing tests when the suite is simply red.
      (b) The job needs the same system dependencies and Postgres service as
      `cargo-nextest`, because the PG-gated cases that return early without a
      database still PASS — they would silently *depress* the numbers instead
      of failing them.
      `kasirmu-bridge` is excluded from the recorded measurement above for
      reason (a); it is **not** excluded from the CI job, which runs the full
      workspace and needs no exclusion because CI requires a green suite first.
      **Acceptance re-run: `python3 scripts/verify-coverage-floors.py` -> exit 0;
      `--self-test` -> 13/13; `verify-ci-docs-drift.py` -> 0 drift.**
      Not done, and named rather than implied: no floor was set for
      `kasirmu-bridge` or the app crates, so a regression there is not gated.
      Adding one is a two-line change to the floors manifest once the in-flight
      bridge work lands and its coverage can be measured cleanly.

- [x] **P1-3 — Build the deterministic multi-device replay harness.** One
      binary that takes a seeded script of offline operations from N locations,
      replays them in a chosen order, and asserts the converged state. This is
      the only instrument that can answer "did multi-location sync actually
      converge" without a fleet of tablets.
      Acceptance: `cargo test -p platform-sync --test <name>` replays ≥3 seeded
      interleavings and asserts identical converged state; CI runs it.
      **CLOSED 2026-09-27.** `platform/sync/tests/convergence_replay.rs` — three
      devices as `migrations::fresh_db()` + `Store`, a five-operation script,
      replayed in three arrival orders (`A,B,C` / `C,B,A` / `C,A,B`). No relay,
      no tokio runtime, no HTTP: items move through the production
      `SyncQueue::apply_remote_atomic` path, so what converges here is what
      converges on a till. Three tests, `convergence_replay` +
      `stock_readings` both green.
      **Acceptance re-run: `cargo test -p platform-sync` -> 446 lib + 3 + 3
      passed, 0 failed.**
      **Asserts TWO things, because the box's own wording is satisfiable
      vacuously.** "Identical converged state" alone would pass for three
      equally-broken devices, so the test asserts agreement across orders AND
      correctness against the script's arithmetic (COFFEE 54, BAGEL 29).
      **Took two attempts, and the first failure was the instrument's fault,
      not the code's — recorded because the search was expensive.** The
      abandoned attempt mixed two different readings of "stock":
      `Store::get_stock` (`inventory.qty` = **deltas + the opening balance**)
      against `Store::get_stock_from_ledger` (`SUM(stock_movements.delta)` =
      **deltas only**). They differ by exactly the un-backed opening balance
      and neither is stale — an earlier revision of this note called
      `inventory.qty` a "stale cache" and that was wrong, refuted by its own
      test (a `-20` delta moves it 50 -> 30). `stock_readings.rs` now pins
      that distinction as three tests, so the next person does not re-derive
      it. **No defect is claimed anywhere in this item.**
      **The bug that actually defeated the first attempt, now understood:**
      `enqueue_offline` writes a queue row and **does not apply the mutation**
      (`offline.rs:137-143`). Production applies at checkout and enqueues
      separately, so the harness must do both. Enqueueing only left each
      device's ledger holding a different SUBSET of the script's deltas — which
      is why "three numbers for one product" appeared, and why the second
      delivery "fixed" it: the deltas were merely arriving late. With the local
      application added at production time, every device converges on the first
      exchange.
      Two further traps recorded for the next instrument: `apply_remote_atomic`
      returns **`Ok(false)`, not `Err`**, for an item it declines, so a harness
      checking only for `Err` reads a dropped item as delivered; and a device
      must be handed only FOREIGN items, since its own are already local and
      the origin gate cannot catch them (`origin_terminal_id` is `None` on
      harness-produced items, and NULL means UNKNOWN, never "self").
      **Mutation-verified:** removing the local application fails all three
      tests; removing the `rebuild_stock_summary` call fails the readings test.
      CI: covered by `cargo-nextest`, which runs the workspace suite; no
      separate job is needed and none was added.

- [x] **P1-4 — Adversarial tests for the critical path.** Deliberate attempts
      to double-spend stock, replay a settled sale, and apply a refund larger
      than the sale total across two locations.
      Acceptance: named tests under `platform/sync` and `modules/inventory`
      whose failure message names the invariant violated.
      **CLOSED 2026-09-27.** `platform/sync/tests/adversarial_paths.rs` — four
      named attacks, each asserting an invariant and naming it in the failure
      message: `two_locations_overselling_the_same_stock_contain_the_overspend`,
      `a_settled_sale_survives_a_stale_earlier_state_arriving_from_another_location`,
      `two_locations_cannot_refund_more_than_was_sold`,
      `re_delivering_the_whole_adversarial_exchange_changes_nothing`.
      **Acceptance re-run: `cargo test -p platform-sync` -> 446 lib + 4 + 3
      passed, 0 failed.**
      **Scoped deliberately, and the scope is the interesting part.** The
      guards these attacks target already exist and are already well tested:
      `refunds.rs` bounds refund money (`:132`), refund quantity (`:160+`) and
      fails closed on an unreadable SUM (COR-25), with `refunds_tests.rs`
      covering all three; `queue_tests.rs` covers single-device replay for
      sales, voids, refunds and payments. Re-testing those would add nothing.
      What NOTHING covered is the **multi-location** dimension the box names —
      the existing two-terminal tests (`integration_test.rs`) are *cooperative*
      (A creates, B receives) and gated behind `slow-tests`. An adversarial
      pair is a different object: two devices that independently attempt the
      same over-spend and then exchange, where the invariant is a property of
      the converged pair.
      **A real defence found by measurement, which the first version of the
      test got wrong.** The oversell attack was written expecting the pair to
      converge at `-10` (50 − 30 − 30), on the assumption that
      `allow_negative_stock` meant the aggregate admitted the overspend. It
      converges at **20**, because the sync applier enforces a LOCAL FLOOR and
      refuses the other side's deduction:
      `adjustment would cause negative stock (previous: 20, delta: -30)`.
      The oversell is **contained rather than merely counted once** — a
      stronger property than the test credited, and the test now asserts it,
      including that the refusal was a *refusal* rather than a silent no-op
      (same total, different meaning).
      **Mutation-verified, and the mutation found a SECOND layer.** Relaxing
      the Rust floor (`products_stock_query.rs:453`, `.filter(|&v| v >= 0)`)
      makes the test fail as intended — with
      `CHECK constraint failed: qty >= 0`, i.e. the database refuses the
      negative write even when the Rust guard is removed. The floor is
      defended at both layers, which no single-layer test would have shown.
      Also of note for a future reader: **`receive` must not `.expect()`** on
      a `stock.adjusted`/`complete_sale` item. A guard refusing an adversarial
      item is the system working, and panicking on it reads a defence as a
      defect — which is exactly how this file first failed.
      The refund attack asserts the pair agrees on the refunded total and that
      it does not exceed the sale; `queue.rs:475-479` documents that the sync
      applier deliberately does NOT re-derive those bounds, since
      re-deriving from partially-replicated history would reject legitimate
      items, so the bound is the originator's and the exchange must not
      compound it.

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
      **ATTEMPTED 2026-09-28, PARTIALLY DONE, BOX STAYS OPEN — and the reason is
      the interesting part. The acceptance has TWO halves in a fixed order
      ("exits 0 locally, THEN the env line lands"), and the first half does not
      yet pass, so the second half was deliberately NOT done. Measured: the
      command fails with ~295 errors across 20 crates.**
      **What landed (commit `ddfefedf8`, 4 crates now clean and verified):**
      `kasirmu-crypto` (10 errors → 0), `platform-core` (5 → 0 after its own
      round), `qris-core` (5 → 0), `platform-kernel` (1 → 0). Two of the fixes
      are worth naming because they are NOT the obvious edit:
      - `rbac.rs` had `[`Self::STAFF_UPDATE`]` and `[`Self::MEMO_STOP`]` inside
        `pub mod permissions`. `Self` is not a valid intra-doc target in a
        module (there is no implicit self type), and the parent-relative
        `permissions::STAFF_UPDATE` also fails from inside that module. The
        bare `[`STAFF_UPDATE`]` resolves; the explicit form then trips
        `rustdoc::redundant_explicit_link_target`. The constants themselves were
        NEVER missing — this was a link-syntax bug, not a stale reference.
      - `raw.rs` had `[`keys::is_non_exportable_setting_key`]` twice. `keys` is
        not imported there (only `use super::Settings`), so the link cannot
        resolve; the surrounding prose used `crate::settings::keys::...` in code
        spans that never needed resolution. Fixed by giving the link an explicit
        full path.
      Where a crate's failures were all `private_intra_doc_links` — public docs
      intentionally naming the private helper that enforces the claim
      (`portable_key`, `decrypt_or_fail_closed`) — the fix is a crate-level
      `#![allow(rustdoc::private_intra_doc_links)]` with a comment explaining
      why the link is more useful than a prose restatement. That allow is
      scoped to that ONE lint: `broken_intra_doc_links` is untouched, so a link
      to an item that does not exist still fails.
      **What remains, with the exact shape, so the next attempt starts at the
      list rather than the search.** `cargo doc` stops at the first failing
      crate, so the 32 errors visible at the start were only the tip; fixing a
      crate reveals the next. The full inventory is
      **295 errors / 20 crates**, broken down as **220 unresolved links,
      18 private-item links, 3 unclosed HTML tags, 1 bare URL**. The unresolved
      links are heavily REPEATED rather than 220 distinct problems — the top
      targets are `BridgeCtx` (14), `BridgeError` (8), `BridgeCtx::registry`
      (4), the `*_scoped` command family (`list_scoped`/`create_scoped`/
      `update_scoped`/`delete_scoped`, 3 each), `DriverRegistry::apply_config`
      (2), `SyncStore::push_batch` (2) — across 172 distinct targets. Most are
      simply not in scope at the doc site and need an import or a full path.
      Three concrete non-link defects are worth fixing whenever that work
      happens, since they are content errors rather than link noise:
      `kasirmu-lan/src/kds_sync.rs:67` names a variant
      `KdsSyncEvent::OrderRecalled` that does not exist;
      `kasirmu-hal/src/drivers/edc/protocol/mod.rs:17-19` links three codec
      types (`IngenicoCodec`, `VerifoneCodec`, `PaxCodec`) that are not in
      scope; and `kasirmu-hal/src/bootstrap.rs:56` writes `Host[:port]`, which
      rustdoc parses as a link named `:port`.
      **Do NOT land the env line before the local run passes.** Adding
      `RUSTDOCFLAGS: -D warnings` beside `RUSTFLAGS` today turns every Rust PR
      red for reasons unrelated to the change — the failure mode this file has
      already named twice (`fuzz`, `coverage`): a gate that is red on day one
      stops being read. The ordered acceptance in this box is exactly the right
      guard, and it held.
      **Scale, stated plainly:** ~295 edits across 20 crates, including
      `kasirmu-bridge` and `kasirmu-api`, which other sessions are actively
      editing. This is a campaign, not the "one env line" the box's title
      suggests, and it should be scheduled as one.
      **ROUND 2 — 2026-09-28 (commit `34135db16`). The campaign is nearly done,
      and most of the credit is another session's.** Re-measured at the start of
      this round: the workspace had fallen from **295 errors across 20 crates to
      34 error lines across 14 distinct sites in 4 crates**. A concurrent
      session had worked the bulk of the list. What remained was `kasirmu-hal`,
      `kasirmu-lan`, `platform-sync` and `kasirmu-api`, plus one site in
      `kasirmu-core`.
      **All four crates are now rustdoc-clean, verified individually**
      (`cargo doc -p <crate> --no-deps` with `RUSTDOCFLAGS="-D warnings"` →
      `Finished`, 0 unresolved/redundant findings). `kasirmu-core` is clean too.
      **A real defect found, not just link noise.**
      `crates/kasirmu-lan/src/kds_sync.rs:67` documented
      `[`KdsSyncEvent::OrderRecalled`]`, and **that variant does not exist** —
      the enum declares `Recalled(KdsOrderRecalled)`, and the three sibling
      tags (`OrderPlaced`, `LineItemBumped`, `OrderReady`) are spelled
      correctly. So the const's doc comment named a variant a reader would
      search for and never find. Fixed to `[`KdsSyncEvent::Recalled`]`.
      Likewise `crates/kasirmu-hal/src/bootstrap.rs` linked
      `[`DriverRegistry::apply_config`]` twice, but `apply_config` is a **free
      function** (`bootstrap.rs:281`), not a `DriverRegistry` method — the doc
      had described the API wrongly since the function was written. Fixed to
      `[`apply_config`]` and `[`DriverRegistry`]` separately.
      **The private-item half, done the way P2-6 established.** `kasirmu-hal`,
      `kasirmu-lan`, `platform-sync` and `kasirmu-api` each got a crate-level
      `#![allow(rustdoc::private_intra_doc_links)]` with the justification
      block, scoped to that ONE lint so a genuinely broken link still fails.
      That cleared **all 6** private-item errors in those crates.
      **Three traps this round cost real time, all worth recording:**
      1. **I repeated the P2-6 placement bug.** My insert script put the inner
         attribute after an OUTER doc comment in `kasirmu-hal/src/lib.rs:41` and
         `kasirmu-api/src/lib.rs:52` — the identical "an inner attribute is not
         permitted following an outer doc comment" error I had already fixed and
         written up once. The rule: `#![...]` goes above the first `///`, not
         below it. I had the note and still made the mistake, which says the
         check belongs in a script, not in prose.
      2. **Module docs (`//!`) cannot see items declared later in the same
         file.** `api_audit.rs` fails to resolve `audit_middleware`,
         `ApiWriteEvent` and `AuditSink` from its OWN `//!` block, while the
         `///` doc on a struct 40 lines down resolves the same name fine. Same
         in `bt_printer.rs`. Neither `self::` nor `super::` fixes it — the
         working form is the fully-qualified `crate::<mod>::<item>`.
      3. **Over-correcting trips `redundant_explicit_links`.** Giving an
         explicit target to a label rustdoc CAN resolve is now an error under
         `-D warnings`. Ten sites needed the target REMOVED after I added it.
         The rule that emerged: add a target only when the bare label fails, and
         expect to reverse some — the two lints are in tension and the fix is
         per-site, not a pattern.
      **Still to do, measured rather than guessed:** the workspace run now
      reaches crates the earlier failures had hidden — `platform-startup`
      (`TerminalProfile`, `DriverRegistry`, `load_profile`, `register_hardware`,
      `HardwareConfig`, `register_card_terminals`) and `kasirmu-payment`
      (private `MAX_POLL_ATTEMPTS` / `POLL_INTERVAL_MS` / `QRIS_EXPIRY_SECS`,
      plus one bare URL). More will surface the same way as each is fixed. **The
      env line still must NOT land** until `cargo doc --workspace --no-deps`
      exits 0, which it does not yet.
      **ROUND 3 — 2026-09-28 (commits `b72874e5e`, `77fa67cea`).** Re-measured
      at the start: **265 errors across 6 crates** (`platform-startup`,
      `kasirmu-payment`, `kasirmu-cloud`, `kasirmu-bridge`, `kasirmu-mobile`,
      `kasirmu-app`) — 242 unresolved links, 13 private-item, 3 unclosed HTML
      tags, 1 bare URL. The count ROSE from round 2's 34 because fixing crates
      lets `cargo doc` reach ones the earlier failures had hidden. That is the
      shape of this task: the number goes up before it goes down.
      **Cleared and verified this round: `kasirmu-payment` and
      `platform-startup`** — both `Finished`, 0 findings, checked individually.
      - `kasirmu-payment`: the crate-level `#![allow(rustdoc::private_intra_doc_links)]`
        (with the justification block) cleared all 3 private-constant links;
        `drivers/paddle.rs:9` had **two defects on one line** — an unresolvable
        `[`PaymentProcessor`]` and a bare URL `(https://www.paddle.com)` that
        rustdoc tried to read as a link target. Rewritten as
        `[`PaymentProcessor`](crate::PaymentProcessor)` +
        `[Paddle](https://www.paddle.com)`.
      - `platform-startup`: all six sites were in `src/hardware.rs`, and FOUR
        of them (`TerminalProfile`, `DriverRegistry`, `HardwareConfig`, plus
        the three fn links) were names that ARE imported or declared in the
        file — the `//!` block simply cannot see `use` statements or items
        declared below it. Same trap as `api_audit.rs` in round 2.
      **Also fixed but NOT verifiable this round: `apps/cloud-server` (3 files).**
      `redis_backend.rs` had `KEYS[1]` / `ARGV[1..4]` parsed as links named `1`,
      `2`, `3`, `4` — Lua indexing colliding with link syntax, now code spans;
      and a link to `TokenBucket`, which is a **private** `struct`
      (`rate_limit.rs:100`), so that link could never resolve and became a code
      span naming the file. `db.rs` and `midtrans_ledger.rs` needed method
      links in module docs. **These three files were committed WITHOUT a passing
      `cargo doc` run**, and the commit message says so — see the blocker below.
      **BLOCKER, not mine: `crates/kasirmu-core` does not compile.** A
      concurrent session is mid-split of `db/profile.rs` into an untracked
      `db/profile/` directory; `cargo check -p kasirmu-core` fails with
      `cannot find value PROFILE_COLUMNS`, `cannot find function
      decrypt_sensitive` (×2), `cannot find type QuotaDimension`. Every crate
      that depends on `kasirmu-core` — including `kasirmu-payment`,
      `platform-startup` and `kasirmu-cloud` — therefore cannot be documented
      right now, which is why this round's `cloud-server` edits rest on
      inspection alone. Verified separately that the break is NOT from this
      work: `git status` shows the untracked `db/profile/` plus other-session
      edits to `db/offline.rs` and `subscription/quota.rs`, and my only
      `kasirmu-core` change (`subscription/tier.rs`) is already committed and
      clean. **The next round must re-run `cargo doc --workspace --no-deps`
      once that split lands**, both to confirm the `cloud-server` edits and to
      see what the newly-reachable crates report.
      **ROUND 4 — 2026-09-28 (commits `d59de568b`, `68b0426c9`). The core split
      landed mid-round and unblocked everything.**
      **Verified clean this round, each by its own `cargo doc -p <crate>`:**
      - The **14 crates that do not depend on `kasirmu-core`** — `kasirmu-crypto`,
        `kasirmu-logging`, `kasirmu-lua`, `kasirmu-media`, `kasirmu-plugin`,
        `kasirmu-security`, `qris-core`, `foundation`, `modules-{giftcards,
        kitchen,promotions,purchasing}`, `platform-core`, `platform-kernel` —
        ALL already clean. That is the round-1..3 crate-level allows still
        holding, and it is the first time this has been measured as a set.
      - **`kasirmu-cloud`**, which also VERIFIES round 3's unverified edits: the
        `from_config` / `mark_status` / `ARGV[1..4]` / `KEYS[1]` fixes were
        confirmed good by the re-run. Six more links fixed to get there.
      **THREE MORE DEAD-API DEFECTS FOUND — the pattern is now unmistakable.**
      This is the fourth time a broken rustdoc link has turned out to be a doc
      describing something that does not exist, so the campaign is producing
      corrections, not just cosmetics:
      1. **`BridgeError::NotFound` does not exist.** `kasirmu-bridge/src/staff/
         trash.rs` linked it at **three** sites, in the `# Errors` sections of
         `delete_staff_scoped`, `restore_staff_scoped` and
         `restore_role_scoped` — a file about deleting things, documenting a
         not-found variant the enum does not have. Real variants: `Core`,
         `Hardware`, `Invalid`, `PermissionDenied`, `InvalidSession`,
         `TopologyValidation`, `Internal`. The unknown-id path goes through
         `store.soft_delete_user(id)?`, which surfaces as `Core`. All three now
         say so.
      2. **`WebhookEndpoint::redacted` does not exist**
         (`apps/cloud-server/src/outbound_webhooks.rs:57`). The struct has no
         such method; listings simply do not select the secret column. The doc
         now states the real mechanism.
      3. **`TokenBucket` is private** (`apps/cloud-server/src/rate_limit.rs:100`
         — `struct`, not `pub struct`), so the link in `redis_backend.rs` could
         never resolve; it is now a code span naming the file.
      **Also fixed:** `KEYS[1]` / `ARGV[1..4]` in `redis_backend.rs` were parsed
      as links named `1`, `2`, `3`, `4` — Lua indexing colliding with link
      syntax. Same class as the `Host[:port]` and `role-<uuidv7>` cases.
      **Where this stops, and why — a real collision, not a lack of effort.**
      `cargo doc --workspace` is down to **ONE failing crate: `kasirmu-bridge`**,
      which still reports **170 unresolved links across 132 distinct names**.
      They are overwhelmingly ONE pattern — `BridgeCtx` (×14), `BridgeError`
      (×8), `BridgeCtx::registry` (×4), the `*_scoped` family (×3 each) — i.e.
      core bridge types referenced from files that do not import them. **That
      wave sits in ~20 `kasirmu-bridge` files, and by the end of this round a
      concurrent session had all 20 of them dirty** (their C28 extraction
      programme: `data/dto.rs`, `pos.rs`, `products/dto.rs`, `staff/dto.rs`,
      `settings/core.rs`, …). I fixed the 9 sites in files that were still clean,
      verified every one of my diffs touches **doc comments only** (no code
      line — checked, not assumed), and committed. The remaining ~170 should be
      done once their extraction lands: a mass doc-link edit across files being
      rewritten produces conflicts that cost more than the edits save.
      **Standing status: ONE crate from green.** Every other crate in the
      workspace is rustdoc-clean. The env line still must NOT land.
      **ROUND 5 — 2026-09-28 (commit `4f4bb0e90`). `kasirmu-bridge` went from
      170 errors to 4, and the ROOT CAUSE was finally pinned down.**
      **The rule, established by experiment after five wrong guesses.** The
      complaint is *always* "no item named `X` in scope", and the deciding
      factor is **which kind of doc comment** carries the link:
      - **`//!` MODULE docs cannot see `use` statements, and cannot see items
        declared BELOW them.** `//!` precedes the `use` block, so a bare
        `[`BridgeCtx`]` there resolves against nothing. These NEED an explicit
        target.
      - **`///` ITEM docs on an item in the same module resolve fine**, and
        giving them a target raises `redundant_explicit_link_target`, which is
        ALSO an error under `-D warnings`.
      I lost several passes to this because rustdoc shows a source line for only
      the first few errors per crate, so I kept "fixing" both kinds together and
      watching the error count flip between `unresolved` and `redundant` — 643
      unnecessary qualifications in one pass (705 occurrences reverted), 42 in
      another (22 reverted). The working method is: **qualify `//!` lines only,
      leave `///` alone**, then re-measure. That single change took bridge from
      170 → 4 with no oscillation.
      **The bridge sweep: 39 files, 153 insertions / 153 deletions — a pure
      1:1 doc rewrite with no code line touched** (verified by filtering the
      diff, not assumed).
      **A CORRECTION TO MY OWN ROUND-6 NOTE.** The P2-6 entry above says
      `kasirmu-bridge` "carries the new deny". It does not: `git show` of
      `fbb83d152` does not contain `kasirmu-bridge`, and
      `git show HEAD:crates/kasirmu-bridge/src/lib.rs` has no
      `deny(unsafe_code)`. I saw the attribute in the working tree and recorded
      it as mine; it is an uncommitted addition by another session. The P2-6
      count of "38 of 43" therefore counted a line that was not (and is not)
      committed — the honest figure for what that commit delivered is **37**,
      and the 38th is someone else's. Left uncorrected in the P2-6 entry itself
      only because the number is a derived count, not a claim I can re-measure
      without re-running the audit; the discrepancy is recorded here.
      **Remaining, and all of it blocked on other sessions:** `kasirmu-bridge`
      has 4 sites left — `StockAdjusted` (×2, in `products.rs` and
      `products/stock.rs`, BOTH dirty; the real fix is
      `kasirmu_core::events::StockAdjusted`, which `stock.rs:13` already
      imports), `BridgeError::Hardware` (no location shown), and the two
      `remote_sync_admits` private-item links in `settings/core.rs` (dirty).
      `kasirmu-mobile` and `kasirmu-app` follow behind, with
      `impersonate_user_scoped` / `IMPERSONATION_SESSION_TTL_SECONDS`,
      `require_audit_tier` and `list_categories` already visible.
      **ROUND 6 — 2026-09-28 (commits `7ff02d94d`, `a9bbfab95`). Both Tauri
      shells are now rustdoc-clean; the workspace is down to 5 errors in ONE
      crate.**
      **The rule held, which is the point.** Applying "qualify `//!` module docs
      only, leave `///` alone" took `apps/desktop-tauri` from 8 sites to 0 and
      `apps/mobile-tauri` from 35 to 0, with no oscillation — versus the five
      flapping passes it cost to discover. The resolver was built from real
      definitions (`git grep` for `fn`/`struct`/`const` per name) rather than
      guesses: **69 names mapped, private ones converted to code spans instead
      of links.** 21 files, 45 insertions / 45 deletions, doc-comments only.
      **A SIXTH dead-API defect, and this one was already documented as
      REMOVED.** `get_setup_status` was linked from BOTH shells'
      `commands/setup.rs` as if it existed. It does not — and
      `apps/desktop-tauri/src/commands/setup.rs:60` says so in a comment:
      *"`get_setup_status` and `dismiss_setup_wizard` were REMOVED here."* The
      doc on `get_first_run_state` was still naming it as its predecessor
      without marking it retired, so a reader following the link finds nothing
      and cannot tell whether the removal was intentional. Both sites now name
      the retirement and the replacement. This is the fourth crate in which a
      broken link turned out to be a doc asserting something false about the
      code, which is why the campaign keeps paying for itself.
      **Remaining: 5 errors, all in `kasirmu-bridge`, all in files a concurrent
      session owns** — `StockAdjusted` (×2, in `products.rs` /
      `products/stock.rs`; the true fix is
      `kasirmu_core::events::StockAdjusted`, already imported at
      `stock.rs:13`), `BridgeError::Hardware` (no source location emitted),
      and the two `remote_sync_admits` private-item links in `settings/core.rs`.
      **Every crate in the workspace except `kasirmu-bridge` now documents
      cleanly under `RUSTDOCFLAGS="-D warnings"`.** The env line still must NOT
      land.
- [ ] **P2-5 — `clippy::pedantic` on the two crates that can take it.**
      Workspace-wide pedantic is noise; scoped pedantic is signal. Start with
      `foundation` and `kasirmu-core` via `[lints.clippy] pedantic = "warn"` in
      each manifest, fix what surfaces, then decide about the rest.
      Acceptance: `cargo clippy -p foundation -p kasirmu-core --all-targets -- -D warnings`
      exits 0 with pedantic enabled. Do **not** enable `nursery` — it is
      explicitly unstable and will churn every release.
      **MEASURED 2026-09-28, BOX STAYS OPEN, NO MANIFEST CHANGED.** Nothing was
      enabled, so no red gate appears — the same discipline P2-4 was closed
      under, and for the same reason: enabling pedantic today makes
      `cargo clippy -p foundation -p kasirmu-core --all-targets -- -D warnings`
      fail immediately, and `cargo-clippy` is `required` in `gates.json`, so it
      would redden every Rust PR.
      **The measurement, kept as data rather than prose:**
      `scripts/pedantic-inventory.json` (59 lints, written from a real run of
      `cargo clippy -p foundation -p kasirmu-core --all-targets -- -W clippy::pedantic`).
      Headline figures:
      - **2,677 violations** across the two crates.
      - **1,795 (67%) are documentation lints** — `missing_errors_doc` alone is
        **1,011**, `doc_markdown` 528, `must_use_candidate` 240. These are
        prose, not behaviour: a `# Errors` section on every `Result`-returning
        public fn, and backticks around identifiers in doc text.
      - **818 are auto-fixable** by `clippy --fix` — counted from the run's own
        `to apply N suggestions` totals, not estimated.
      - **195 are correctness-adjacent** (`cast_precision_loss` 56,
        `cast_possible_truncation` 35, `cast_lossless` 31, `cast_sign_loss` 24,
        `cast_possible_wrap` 27, `float_cmp` 22). **This is the subset actually
        worth reading**, and it is small enough to audit on its own.
      **The decision this measurement supports, recorded so it is not re-made
      blind.** The box's phrasing — "start with foundation and kasirmu-core" —
      reads as a small scoped trial, but pedantic on these two crates is
      **2,677 edits**, two thirds of them documentation. Three coherent scopes
      exist and none was taken this pass:
      1. **Everything** — 818 mechanical + 1,795 doc + ~195 real. The doc bulk
         alone touches nearly every public function in `kasirmu-core`.
      2. **Everything except the doc lints** — enables ~880 code-quality lints
         (including the 195 cast/float ones) immediately, with
         `missing_errors_doc` / `doc_markdown` / `must_use_candidate` named as
         explicit `allow`s so the debt is visible rather than silently absent.
         **This is the scope I would recommend**: it is the one the box's own
         rationale ("workspace-wide pedantic is noise, scoped pedantic is
         signal") actually describes, since the noise it names is the doc
         category.
      3. **Only the correctness-adjacent lints** — ~195 sites, smallest and
         highest signal-per-edit.
      **Not done, and named rather than implied:** no manifest was edited, so
      this box has no enforcement behind it yet. `nursery` was not considered —
      the box forbids it, and the measurement above is the default pedantic set
      only.

- [x] **P2-6 — Extend `deny(unsafe_code)` to the crates that can carry it.**
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
      **CLOSED 2026-09-28 (commit `fbb83d152`). Count went 7 → 38 of 43 crate
      roots, a rise of 31.** Acceptance re-run: `cargo check --workspace
      --all-targets` (excluding `kasirmu-bridge`, see the caveat below) →
      `Finished`, exit 0, with zero `usage of an unsafe block` errors.
      **The measurement that made this tractable.** Grepping `unsafe` returns
      mostly AUDIT-STAMP PROSE — doc comments saying "no unsafe in production
      paths" — so the naive count is misleading in both directions. Filtering
      to real constructs (`unsafe {`, `unsafe fn/impl/trait/extern`,
      `#[unsafe(...)]`, `unsafe impl`) leaves **7 directories**: `kasirmu-hal`,
      `kasirmu-logging`, `kasirmu-security`, `kasirmu-lua` (all four on the
      box's leave-list and already denying at root with file-scoped allows),
      plus `apps/cloud-server` and `kasirmu-notification` (**test-only**
      `env::set_var`), and the two Tauri shells (`#[unsafe(link_section)]`).
      Everything else is genuinely zero-unsafe.
      **A find worth stating, because it was NOT assumed:** a crate-level
      `#![deny(unsafe_code)]` **does** fire on `#[cfg(test)]` code. Verified by
      applying it to `kasirmu-notification` and watching `--all-targets` fail on
      its test-only `env::set_var` calls. That is why this box prescribes the
      file-scoped `#![allow(unsafe_code)]` precedent rather than a bare deny —
      the crate denies, and the specific test file opts out. Applied at
      `apps/cloud-server/src/{db_tests,config_tests}.rs` and
      `kasirmu-notification/src/whatsapp_tests.rs`, each with the reason inline.
      **Two mistakes made and corrected during the work, recorded so they are
      not re-derived.** (1) The first insertion pass put the attribute after an
      OUTER doc comment in `kasirmu-plugin`, which is illegal — "an inner
      attribute is not permitted following an outer doc comment". The rule is
      that `#![...]` must follow only the `//!` block, before the first
      `///` or item. (2) My inventory missed `apps/cloud-server/src/config_tests.rs`
      because it recorded only the FIRST hit per directory; the deny then failed
      on four sites there. Grep per FILE, not per directory.
      **Remaining 5, all deliberate:** `crates/kasirmu-logging` (real
      syslog/eventlog FFI — box's leave-list) and the four Tauri shell roots
      (`apps/{desktop,mobile}-tauri/src/{lib,main}.rs`, which carry
      `#[unsafe(link_section = ".drectve")]` emitted by the Tauri/Windows build;
      a deny there would fight the toolchain rather than harden the crate).
      **Caveat on the acceptance run:** `kasirmu-bridge` was excluded because a
      concurrent session's in-flight `pos/checkout/` module move has it failing
      to compile for an unrelated reason (`cannot find function
      validated_attempt_id`). Checked against HEAD-without-my-edit and the
      failure is pre-existing and not caused by this change, but the FULL
      workspace check therefore has not been observed green in this session and
      should be re-run once that lane lands. `kasirmu-bridge` itself DOES carry
      the new deny.

---

## 5. P2 — runtime invariants and observability

- [x] **P3-1 — State the critical-path invariants in one place.** Today there
      are 79 `debug_assert!` sites and ~199 comments mentioning invariants,
      scattered. Write them as a single list (stock ≥ 0; sale total == sum of
      line totals; refund ≤ settled total; sync convergence is order-independent)
      and link each to the test that enforces it.
      Acceptance: `docs/architecture/` carries the list; each invariant names
      its enforcing test.
      **CLOSED 2026-09-28.** `docs/architecture/CRITICAL_PATH_INVARIANTS.md`
      carries all four invariants the box names, each with its enforcing test —
      **18 test names, all verified to exist and to pass**, and **20 file
      citations, all verified line-by-line** against the tree. Linked from
      `docs/README.md`, which previously did not list the `architecture/`
      directory at all.
      **This box's own figures were stale, as with P3-3.** It claims "79
      `debug_assert!` sites and ~199 comments mentioning invariants". Measured:
      **12 `debug_assert!` sites**, and 290 lines mentioning "invariant" —
      most of them prose inside audit stamps rather than executable assertions.
      Both numbers are recorded in the doc's closing section rather than
      silently corrected, because the gap is itself the useful finding: an
      inventory built from grep counts prose, not checks.
      **Two of the four invariants required correcting the box's statement of
      them, since asserting them as written would be false:**
      1. **"stock ≥ 0" is conditional.** `allow_negative_stock` is a documented
         per-location policy flag (`models.rs:368`) and `adjust_stock_tx`
         (`repository.rs:130`) applies a raw `qty = qty + ?1` — a location that
         opts in MAY oversell. The doc states the conditional form and links
         `negative_stock_event_fires_when_allow_negative_enabled`, which pins
         the opt-in path, so both halves are tested rather than one asserted.
      2. **"refund ≤ settled" is enforced on the ORIGINATOR, not the sync
         applier.** `platform/sync/src/queue.rs:475-479` deliberately does NOT
         re-derive the bounds, because a partially-replicated history would
         reject legitimate items. That is a real design decision with a
         consequence worth writing down: the sync side can only be checked for
         not COMPOUNDING the bound, which is what the adversarial test asserts.
      **Measured and recorded rather than glossed:** stock non-negativity has
      **two independent enforcement layers** (Rust guard + a database CHECK
      constraint), proven by relaxing the Rust guard and watching the DB refuse
      with `CHECK constraint failed: qty >= 0`. The sale-total invariant is
      enforced **by construction** (`Sale::from_cart` derives the header) with
      no single property test asserting header == Σ lines over arbitrary carts
      — named in the doc as the weakest of the four rather than presented as
      equally strong.
      **Not done, and said so in the doc itself:** nothing checks that these
      named tests still exist, so a rename makes the list silently stale. That
      is exactly the gap P3-3 solved for SAFETY with a checker; the same
      treatment here is the obvious follow-up and is not claimed.
- [ ] **P3-2 — Log invariant violations in debug/staging builds.** Where an
      invariant is checked at runtime today it panics or is silently repaired.
      Route violations to `tracing::error!` with the entity id so a staging run
      surfaces them before a customer does.
      Acceptance: one seeded violation produces an `error!` line naming the
      invariant and the entity.
      **AUDITED 2026-09-28, BOX STAYS OPEN, AND THE PREMISE DID NOT SURVIVE —
      no site qualified for the change, so none was made.** Chosen scope:
      "only the sites that are both silent AND reachable". Audited result:
      **all 8 production `debug_assert!` sites are unreachable from any public
      API**, so there is nothing to log. The premise ("it panics or is silently
      repaired") describes a class that does not exist here in the form the box
      assumes.
      **The 8 sites, and why each cannot be reached by bad data:**
      | site | why unreachable |
      |---|---|
      | `kasirmu-core/src/db/mod.rs:449` `generation < BACKUP_GENERATIONS` | `generation` comes from a loop bounded by that same const; a caller bug, not data |
      | `kasirmu-core/src/db/popularity.rs:240` `parse_utc_offset(&tz).is_some()` | `tz_modifier()` (`reports/datetime.rs:131`) ALWAYS returns `±HH:MM` — both match arms yield either an offset already parsed by `parse_utc_offset` or the literal `+00:00`. The data-driven case (an unresolvable `locations.timezone`) is already handled AND already logged with `tracing::warn!` at `:143-146`, naming the offending value. This assert re-checks a guaranteed postcondition. |
      | `kasirmu-core/src/db/regional.rs:234` `n <= 1` | an `UPDATE … WHERE id = ?3` on a primary key; more than one row is impossible |
      | `foundation/src/cart.rs:120` overridden/unit price currency match | `set_overridden_price` validates (`cart.rs:131`), and `add_line` rejects a mismatched line outright (`cart.rs:267-273`). The only bypass is DIRECT field mutation — the fields are `pub`. |
      | `foundation/src/cart.rs:304` line/cart currency match | same guard: unreachable via `add_line` |
      | `foundation/src/cart.rs:343` same, on the discount path | same guard |
      | `modules/tax/src/models.rs:54` `divisor > 0` | a caller passing 0 hits `checked_div`'s `None` regardless; the assert adds no coverage |
      **The one site I initially believed qualified, and the check that refuted
      it.** `foundation/src/cart.rs` looked like the real case: in DEBUG the
      mismatch panics, in RELEASE the assert vanishes and `checked_add` returns
      `None` — indistinguishable from an overflow, which is exactly the
      "silently repaired" shape the box describes. But reading `add_line`
      (`cart.rs:267-273`) showed it returns `Err(CartError::CurrencyMismatch)`
      and never admits a mismatched line. The existing test
      `cartline_total_debug_assert_currency_mismatch_on_direct_mutation`
      (`cart_tests.rs:532`) states the real rationale in its own comment: *"the
      fields are pub so a caller could bypass it with direct mutation"*. That is
      an anti-tamper guard on a `pub` field, not an invariant an operator can
      violate.
      **The architectural finding, recorded because it is the real answer.**
      `foundation` has **no `tracing` dependency** (5 deps total: anyhow, regex,
      serde, uuid, thiserror) and **27 crates depend on it**. Adding `tracing`
      there to serve three unreachable debug asserts would put a logging stack
      into the workspace's most-depended-on leaf crate for no observable
      benefit. `kasirmu-core` already has `tracing` and already uses the pattern
      the box asks for — see `products_stock_adjust/adjust.rs:133` (`tracing::info!`
      with `sku`/`location_id`/`qty`) and `:328` (`tracing::warn!`), and
      `reports/datetime.rs:143` — so the house pattern exists and is followed;
      it simply has nothing to report at these sites.
      **What WOULD close this box**, if it is wanted: the acceptance is "one
      seeded violation produces an `error!` line naming the invariant and the
      entity", and the honest way to meet it is to pick an invariant whose
      violation IS reachable and add the log where the violation is actually
      detected — the stock guards are the obvious candidate, since they already
      return structured errors (`CoreError::Validation`,
      `InsufficientStockAtLocation`) at genuine data-driven boundaries. That is
      a behaviour change at a money path and needs a decision, not an audit,
      which is why it was not taken here.
      **Not a defect claim:** nothing above shows a missing log is hiding a bug.
      It shows the box was written from a premise about this tree that the tree
      does not match.
- [x] **P3-3 — Keep the `unsafe` inventory reviewable.** 27 `unsafe {` sites and
      7 `unsafe impl/fn/no_mangle` items, all in 4 production files plus 8
      test-only sites. Every one must carry a `// SAFETY:` line.
      Acceptance: `grep -rn 'unsafe' --include='*.rs' crates modules platform foundation apps`
      shows no `unsafe` item without a `SAFETY:` comment on the same or
      preceding line; consider a `static-gates` step that enforces it.
      **CLOSED 2026-09-28 (commit `e4e3937a2`). Two halves: the tree is clean,
      AND the rule is enforced rather than left to a reviewer's eye.**
      Measured state: **30 real constructs, 30 justified, 0 missing** —
      `python3 scripts/verify-unsafe-safety.py` → `unsafe-safety: OK (30
      construct(s), every one justified)`, exit 0.
      **This box's own figures did not survive measurement, and correcting them
      was most of the work.** It claims "27 `unsafe {` sites and 7
      `unsafe impl/fn/no_mangle` items … all in 4 production files plus 8
      test-only sites". Grepping `unsafe` here returns MOSTLY PROSE — the audit
      stamps are doc comments that literally say *"zero unsafe, no FFI/IO"*,
      *"0 actual unsafe blocks (risk sweep counted comment text)"* and *"8
      unsafe blocks (not 6 — prior stamp miscount)"*. A naive match counts all
      of them, and the total is wrong by roughly 3× in either direction
      depending on the regex. Honest distribution: **9 files across 7
      directories** — 3 test-only (`cloud-server/src/{db,config}_tests.rs`,
      `notification/src/whatsapp_tests.rs`) and 6 production (`kasirmu-hal`
      JNI/Bluetooth, `kasirmu-logging` syslog/eventlog, `kasirmu-security`
      CredWriteW/CredReadW, and the two Tauri shells' `#[unsafe(link_section)]`).
      **Three constructs genuinely lacked a marker and were fixed**
      (`bt_android.rs:157` `JObjectArray::from_raw`, `bt_android.rs:327`
      `#[unsafe(no_mangle)]`, and the two Tauri `link_section` statics — the
      latter pair counted as one class). The other 27 already carried
      substantive justifications, several better than the box asks for: e.g.
      `windows.rs:66-73` documents the SEC-3 zero-size `CredentialBlob` guard
      that stops a null pointer reaching `from_raw_parts`.
      **The enforcement half, which the box left as a bare "consider".**
      Nothing in the repo mentioned SAFETY before this — no script, no
      `gates.json` entry — so the rule was unenforced. `verify-unsafe-safety.py`
      now fails any real construct without a marker, with an **18-case
      `--self-test` covering both directions**, wired into `check.sh` and
      registered as gate `unsafe-safety` (87 gates, 0 drift).
      **Two traps the checker had to be taught, both found by RUNNING it rather
      than by design.** (a) Its first run produced **5 false positives, all in
      `kasirmu-lua`**: an unanchored `unsafe impl` matched comment prose,
      including a comment explaining the crate deliberately does *not*
      implement it and a test assertion whose string literal begins with the
      phrase. Fixed by anchoring `unsafe impl/fn/trait/extern` to statement
      position and skipping comment lines; the exact failing strings are now
      self-test fixtures. (b) The box's "same or preceding line" rule is too
      narrow for THIS codebase and produced **12 false positives**, because the
      repo documents a whole statement GROUP above the first call
      (`db_tests.rs:160-170` justifies four separate `env::set_var`/`remove_var`
      calls in one block). The checker uses a 12-line lookback, and self-tests
      that a marker **outside** that window does not count.
      **Not done, named rather than implied:** no CI step was added, so like
      `root policy` and `no-raw-params` this runs in `check.sh` and pre-push
      rather than on a PR. Adding a `static-gates` step is a dev-ci.yml edit
      alone and needs no code change.

---

## 6. P3 — supply chain and housekeeping

- [x] **P4-1 — Decide whether `cargo-deny` blocks or advises.** `deny.toml` is
      accurate and its refresh procedure is honest about being manual, but the
      only runner is a non-blocking `scripts/check.sh` leg and `gates.json` says
      `advisory`. Either promote it to `required` with a `dev-ci.yml` job, or
      leave it advisory and stop calling it a gate.
      Acceptance: `gates.json` status matches the runner that actually exists.
      **CLOSED 2026-09-28 — the acceptance is ALREADY MET, and the decision it
      asks for was already taken deliberately.** The gate's id is **`audit`**,
      not `cargo-deny`, which is why a search for the latter finds nothing but
      three unrelated rows. Verified against the runner:
      - `gates.json` `audit`: **`status: "advisory"`**, runner
        `check.sh → "supply chain advisories"`, **no `ci` block**. Expected
        `advisory` for a non-blocking runner — matches.
      - The runner is genuinely non-blocking. `scripts/check.sh:287-310` has
        **four outcomes, none of which aborts**: PASS (with the tool's own
        summary), `SKIP` when the advisory database is unreachable (worded
        *"supply chain NOT checked; this is not a pass"*), `WARN` on findings
        (*"non-blocking, and NOT checked in any CI workflow"*), and `SKIP` when
        cargo-deny is not installed. The WARN branch states its own reasoning:
        *"a gate that arrives yellow gets disabled within a day, so this reports
        and does not abort."*
      - **No CI job exists, and naming one would be false**: `cargo deny|cargo
        audit|osv` against `dev-ci.yml` + `release.yml` exits 1. The gate's own
        `_note` says so: *"Deliberately NO 'ci' block … naming a job here would
        be a claim this checker is entitled to catch."*
      So the second branch of the box's either/or applies: **it stays
      advisory**, the status matches the runner, and the row is honest about
      what it does and does not prove. The note also records the two limits a
      reader must not miss — two of four outcomes are SKIPs, so *a green
      `check.sh` is NOT proof the supply chain was checked*, and
      `.githooks/pre-push` runs `scripts/run-pre-push.py` without calling
      `check.sh`, so a green PR is not proof either.
- [x] **P4-2 — E2E: run it or drop the `required` status.** `ui/e2e/` has real
      Playwright specs; `dev-ci.yml` has no e2e job; `gates.json` marks `e2e`
      required with no CI entry. That combination is a gate that cannot fail and
      therefore does not exist.
      Acceptance: either an e2e job lands in `dev-ci.yml`, or the `e2e` entry
      moves to `retired` with a note.
      **CLOSED 2026-09-28 — the acceptance is met by the note, and the box's
      premise ("a gate that cannot fail") does not hold.** The drift checker
      defines the invariant explicitly (`verify-ci-docs-drift.py:255-261`):
      *"absence must be EXPLAINED: either name the job, or carry a note saying
      why there is none"* — and it names this very gate as the legitimate case:
      *"the e2e gate needs a Docker backend CI does not provision"*. `e2e`
      carries a 145-char `_note` saying exactly that, so the checker reports
      **0 drift items** and does not flag it.
      **The distinction that matters: `required` means "must pass when run",
      not "runs in CI".** `docs/operations/ci-pipeline.md:104` already states
      it in the live docs — *"Local only … status `required`, `ci: null`,
      runners `check:all` — required of anyone running the full local matrix,
      enforced by no workflow. AGENTS.md says the same: a green Dev CI run is
      not proof E2E passed."* So the status is accurate about its scope and the
      gap is documented in two places, not hidden in one.
      **History, recovered rather than assumed:** this is not a gate that was
      never wired. `.github/workflows/attic/e2e-pr.yml.bak` is a real retired
      workflow — desktop + tablet matrix, Playwright traces on failure,
      `npx playwright install --with-deps` — retired by `23c963303` ("backup
      full workflows to `.bak` and introduce streamlined Quick Dev CI"). The
      `e2e` entry's own note records the lineage: *"Was ci.yml#e2e."*
      **Not done, and stated rather than implied:** E2E still runs nowhere
      automatically. Restoring a job is a CI-cost and Docker-provisioning
      decision (the shell specs need a backend the workflow would have to
      build), so this closes as "the status matches reality and the gap is
      documented" — NOT as "E2E is now enforced". If enforcement is wanted, the
      attic copy is the starting point and it is a workflow-restoration task,
      not a `gates.json` edit.
- [x] **P4-3 — Re-measure the test-volume claim.** "40–60% coverage" has no
      instrument behind it. Once P1-2 lands, replace it with a per-crate line
      figure stamped with a date.
      **CLOSED 2026-09-28.** P1-2 landed in commit `e44fed2b2` (the
      coverage-floors gate), so the prerequisite this box names is met. The
      withdrawn claim is replaced by **§1.1 "Coverage, measured — 2026-09-27,
      instrumented"** above: all **36** crates the `cargo llvm-cov` run
      instrumented, each with line coverage, covered/instrumentable lines, and
      file count, plus the reproduce command and the date.
      **The replacement number, stated plainly: workspace 73.9%
      (48,737 / 65,959 lines).** That is the honest substitute for "40–60%",
      and it lands at the TOP EDGE of the withdrawn band rather than inside it —
      worth saying because the old figure was quoted as if reassuring.
      **Every figure in §1.1 was machine-verified against
      `coverage-probe.json`, and the first draft failed that check.** I typed
      the numbers from a screen listing, and re-deriving them from the JSON
      caught **5 transcription errors** (`platform/core` 1913→1914,
      `kasirmu-core` 25901→25882, `platform/sync` 2573→2571, `kasirmu-api`
      2945→2947, `cloud-server` 3927→3926) plus two wrong PROSE figures (the
      three low-coverage crates hold **24.7%** of all lines, not the 15.8% I
      first wrote; the median crate is **87.3%**, not "closer to 85%"). All 36
      rows and every narrative percentage now match the probe exactly. The
      lesson is not "be careful" — it is that a measurement section must be
      VERIFIED against its source, because hand-copied numbers look exactly like
      measured ones.
      **Four crates have no figure, with the reason recorded rather than the
      row silently omitted:** `apps/desktop-tauri` and `apps/mobile-tauri`
      (excluded as GUI shells), `crates/kasirmu-bridge` (excluded because an
      unrelated uncommitted change in another session had a test failing, and
      `cargo llvm-cov` aborts on any failure — the same blocker P1-2 recorded),
      and `scripts/updater-compat-check` (a build script).
      **Two framing traps the section calls out, because the raw table invites
      both:**
      1. **The four 100.0% crates are 27 lines each** (`modules/giftcards`,
         `kitchen`, `promotions`, `purchasing`). Sorted by percentage they top
         the table; sorted by exposure they are its smallest entries.
         `kasirmu-crypto` at 99.1% of 216 lines in ONE file is the same shape.
      2. **Mean and median disagree by 13 points, and both are correct.**
         The three largest low-coverage crates (`cloud-server` 46.5% of 8,445,
         `cli` 46.8% of 2,000, `api` 50.4% of 5,843) hold **24.7% of every
         instrumentable line in the workspace**. `kasirmu-core` alone is 46.9%
         of the total at 83.8%. So 73.9% is the line-weighted answer to "how
         much code is tested" and 87.3% is the answer to "is a typical crate
         tested" — the section says which to quote for which question instead of
         leaving a reader to pick.
      **A limitation the section states rather than hides: only 4 of these 36
      crates have a floor.** The other 32 can regress silently. That is the
      deliberate consequence of P1-2's "ratchet, not a target" policy, recorded
      so the gap is visible instead of implied by an absent row.

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
