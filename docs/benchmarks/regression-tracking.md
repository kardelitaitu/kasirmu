# Benchmark Regression Tracking
<!-- dead-ref-prefix-ok: docs/benchmarks/baseline -->
<!-- dead-ref-prefix-ok: target/criterion/ -->

> Historical tracking of all OZ-POS Criterion.rs benchmarks. Each entry
> records the baseline, deltas since previous measurement, and any
> relevant commit/change context.

> Note (2026-08-08, docs-auditor): the baseline JSON files referenced below
> (`docs/benchmarks/baseline-2026-07-21.json`, `target/criterion/baseline.json`)
> do **not** exist in the repo yet — the workflow is documented but has not
> been executed. Create the baseline on the first run per the steps below.

## How to Update

### 1. Run all benchmarks

```bash
cargo bench -p oz-core
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
cargo bench -p oz-core -- --save-baseline baseline_latest
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

## CI Integration

The nightly CI job `benchmarks` runs `cargo bench -p oz-core` and uploads
the full `target/criterion/` directory as an artifact. To compare CI runs:

1. Download the baseline artifact from a previous nightly run
2. Extract `target/criterion/` to a local directory
3. Run:
   ```bash
   critcmp --load baseline_criterion baseline
   critcmp baseline current
   ```

See `.github/workflows/nightly.yml` for the CI job definition.

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
