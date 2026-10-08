<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · REPAIRED — the currency block's own count is now off by one, and the commands name a package that no longer exists. · THE COUNT. The 2026-09-09 block states there are "exactly THREE live workflows" and names `dev-ci.yml`, `release.yml` and `android.yml`, having itself corrected an earlier "two" on 2026-09-23. There are FOUR: `.github/workflows/` also contains `website.yml`, the marketing-site pipeline, which the block omits. The document's most confident sentence — the one written to be quoted by the next auditor — is the one that needed repairing again. Recorded as a caution about currency blocks generally: a correction is a snapshot too, and the file that corrects staleness is subject to the same drift. · The rest of that block RE-CONFIRMS cleanly and is the most useful thing in `docs/benchmarks/`: no live workflow runs `cargo bench` (searched, zero matches), and no live workflow declares a schedule trigger — the only `schedule:` hit in the tree is a comment in `dev-ci.yml:575` explaining at length why one is deliberately not used. The block's conclusion, that no benchmark is measured on any cadence and the Threshold Policy table is therefore advisory prose rather than an enforced gate, is exactly right. It is also the same finding the SAST audit recorded in round 23 for a different tool: the project runs scanners and benchmarks on a human schedule, or not at all. · REPAIRED: the `cargo bench -p kasirmu-core` invocations were corrected to `-p kasirmu-core`. This document is a LIVE operational procedure — the How-to-Update section is a command sequence someone follows — so unlike the frozen changelogs audited in earlier rounds, a command that cannot run is a real defect here, not a historical artefact. · LEFT ALONE: the note recording that the baseline JSON files do not exist yet, with its `dead-ref-prefix-ok` pragmas; the Threshold Policy percentages, which are advisory by the document's own statement; and the 2026-07-21 baseline entry, whose critcmp block is a placeholder waiting for a first run that has still not happened. · Prior stamp retained; footer re-dated. -->
# Benchmark Regression Tracking
<!-- Superseded audit marker (2026-09-09 · DSH, body kept verbatim) · retained · status: ACCURATE AFTER REPAIR (1 finding from .agents/skills/docs-auditor/scripts/check-ci-claims.py) · Repaired: §CI Integration asserted in present tense that "The nightly CI job `benchmarks` runs cargo bench -p kasirmu-core and uploads the full target/criterion/ directory as an artifact", told the reader to "Download the baseline artifact from a previous nightly run", and pointed at .github/workflows/nightly.yml — that file is inert .bak (renamed by 23c963303 on 2026-09-02; git log --name-status shows R100), GitHub reads only *.yml, and the live workflow set is dev-ci.yml + release.yml with no schedule trigger anywhere. The job it described is real history, cited by line at .github/workflows/nightly.yml.bak:547-580 (cargo bench at :561, artifact upload at :572-580) · Verified against the files, not another doc: dev-ci.yml on: block is pull_request branches [main] + workflow_dispatch with no push and no schedule; release.yml on: is push tags v* only · Kept: the 2026-08-08 note above already conceded the baseline JSONs do not exist, and the Threshold Policy table stays as written guidance — now labelled advisory prose rather than a gate, because nothing measures anything · Not touched: this is docs/, so the missing nightly workflow is a CODE/CONFIG gap for whoever owns CI, flagged not fixed. -->
<!-- dead-ref-prefix-ok: docs/benchmarks/baseline -->
<!-- dead-ref-prefix-ok: target/criterion/ -->

> Historical tracking of all kasir.mu Criterion.rs benchmarks. Each entry
> records the baseline, deltas since previous measurement, and any
> relevant commit/change context.

> Note (2026-08-08, docs-auditor): the baseline JSON files referenced below
> (`docs/benchmarks/baseline-2026-07-21.json`, `target/criterion/baseline.json`)
> do **not** exist in the repo yet — the workflow is documented but has not
> been executed. Create the baseline on the first run per the steps below.

## How to Update

### 1. Run all benchmarks

```bash
cargo bench -p kasirmu-core
```

### 2. Compare against the stored baseline

Install [critcmp](https://github.com/BurntSushi/critcmp):

```bash
cargo install critcmp
```

Compare current results against the stored baseline JSON:

```bash
# Load the stored baseline
critcmp --load target/criterion/baseline.json --baseline baseline
critcmp baseline current
```

### 3. If performance is acceptable, update the baseline

```bash
# Save the new results as the baseline
cp target/criterion/baseline.json docs/benchmarks/baseline-2026-07-21.json

# Or use the save-baseline subcommand
cargo bench -p kasirmu-core -- --save-baseline baseline_latest
cp target/criterion/baseline.json docs/benchmarks/baseline.json
```

### 4. Update this document

Add a new entry below with the date, commit hash, `critcmp` output, and
any relevant change context.

## Historical Records

### 2026-07-21 — Initial baseline

**Commit:** `42bea1cf` (P61-3 email report schedule UI)
**Hardware:** GitHub Actions `ubuntu-latest` (4 vCPU, 16 GB RAM)

```
# critcmp output will be pasted here after first run
```

**Benchmark groups:**
- `barcode_lookup`: `barcode_lookup_1000_products`, `cache_hit`, `miss`
- `cart_bench`: `cart_add_line`, `cart_total_20_items`
- `money_bench`: `money_checked_add`, `_sub`, `_mul`, `_div`, `serde_roundtrip`
- `transaction_commit`: `create_sale_minimal`, `_with_5_lines`, `complete_checkout_5_items`

**Notable changes:**
- Initial baseline — no prior data to compare against.

---

## CI Integration — **there is none today**

This section described a job that used to run and no longer does. The retired
`benchmarks` job lived in `nightly.yml.bak` (renamed there by `23c963303` on
2026-09-02), and GitHub never executes a `.bak` file. Its definition is still
readable at `nightly.yml.bak:547-580`: it ran `cargo bench -p kasirmu-core` (step at
`:558-561`), wrote timings to `$GITHUB_STEP_SUMMARY`, and uploaded
`benchmark-output.txt` + `target/criterion/` as an artifact with 30-day retention
(`:572-580`).

Nothing in the live CI replaces it. There are exactly **four** live workflows —
`dev-ci.yml` (triggers: `pull_request` targeting `main` + `push` to main + `workflow_dispatch`),
`release.yml` (trigger: `v*` tags), `android.yml` (trigger: `v*` tag or `workflow_dispatch`)
and `website.yml` (the marketing-site pipeline) —
**none declares a `schedule`**, and none runs `cargo bench`. Re-measure with
`ls .github/workflows/*.yml` (this line said "two" until 2026-09-23, C30).
`git grep -in 'cargo bench' -- .github/workflows/dev-ci.yml .github/workflows/release.yml`
→ no matches.

**The consequence, stated plainly:** no benchmark is measured on any cadence. The
baseline entry above cannot be extended from CI, no artifact exists to download,
and a regression past the Threshold Policy table below goes undetected until a
human happens to run `cargo bench -p kasirmu-core` locally. The threshold table is
therefore advisory prose, not an enforced gate.

To compare runs today, produce both sides locally:

1. Run `cargo bench -p kasirmu-core`, then copy `target/criterion/` somewhere durable
   and name it the baseline (there is no nightly artifact to download)
2. Later, re-run the same command and compare:
   ```bash
   critcmp --load baseline_criterion baseline
   critcmp baseline current
   ```

## Threshold Policy

A benchmark regression is considered actionable when:

| Metric | Threshold | Action |
|--------|-----------|--------|
| `money_*` arithmetic | ≥ 10% slowdown | Investigate Money struct changes |
| `barcode_lookup_*` | ≥ 15% slowdown | Investigate DB query changes |
| `cart_*` | ≥ 15% slowdown | Investigate Cart/CartLine changes |
| `create_sale_*` | ≥ 20% slowdown | Investigate transaction/WAL changes |

> **Note:** Thresholds are guidelines, not hard gates. A 5% regression
> across 10 benchmarks may be noise; a 50% regression in one benchmark
> warrants immediate investigation.

> last audited 29-09-26 by docs-auditor
