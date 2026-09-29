<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 212 lines, no audit stamp, no footer, no marker. It is a TDD implementation PLAN, and the useful audit question is not what it prescribes but what of its mechanism actually shipped. The answer is more than expected: the profile the plan's Fast Loop depends on is real — `[profile.tdd]` is configured at `Cargo.toml:294`, inheriting from dev with `debug = false, incremental = true` — and the script the plan tells authors to run, `scripts/test-tdd.sh`, exists. A plan whose central loop mechanism is in the manifest four months later has been acted on, whether or not every phase is complete. · THE HEADLINE NUMBER IS A FLOOR, NOT A DRIFT. The plan opens by saying the codebase has 32+ Rust crates; `cargo metadata` now reports 40. A `+` claim that the real figure still exceeds is not an inaccuracy — it is the one way to write a count in a growing repository, and correcting it to 40 would make the document wrong again by the next crate. Left as written. · STALE PATHS, IN THE CODE SAMPLES RATHER THAN THE PROSE: the Phase-1 harness macro imports `oz_core::{Store, migrations}` and the Current State table is headed `Core (oz-*)` with 11 crates. Those are pre-restructure names; the crates are now `kasirmu-core` and its siblings, and the core count is larger. This is the ordinary consequence of a crate rename on a document full of illustrative code, and the samples are the plan's teaching material rather than copy-paste targets — the surrounding commands correctly say `crates/kasirmu-core`. Left as written, and the project rule that the samples are illustrative is the thing to rely on if a reader is unsure. · The Success Metrics table (line coverage, branch coverage, mutation score, test execution time) is a set of targets for a campaign, not measurements, and no measurement in this pass would tell a reader whether they were met. The current test counts live in `docs/coverage/README.md`, audited in round 14, which is the file to read for the actual state. · Stamp and footer added; the file had neither. -->
# kasir.mu Rust Crate Testing Strategy — TDD Implementation Plan

## Executive Summary

The kasir.mu codebase has **32+ Rust crates** with varying test coverage. This plan implements a systematic Test-Driven Development (TDD) approach to improve reliability.

---

## Current State Analysis

### Test Coverage by Layer

| Layer | Crates | Modules with Tests | Integration Tests |
|-------|--------|-------------------|------------------|
| Core (`oz-*`) | 11 | ~72 | 30+ |
| Business Logic (modules) | 10 | ~25 | 0 |
| Platform | 4 | N/A | N/A |
| Apps | 6 | N/A | N/A |

### Key Findings

1. **Integration tests exist** but unit tests are sparse in many crates
2. **Business logic modules** (sales, inventory, loyalty) have minimal test coverage
3. **Money handling** is critical — needs comprehensive validation tests
4. **Database operations** should be transaction-tested at module level
5. **Error paths** need regression tests for each `thiserror` variant

---

## TDD Implementation Framework

### Phase 1: Foundation (Weeks 1-2)

#### 1. Fast TDD Loop Setup

```bash
# Use the existing test-tdd.sh script with watch mode
bash scripts/test-tdd.sh -p crates/kasirmu-core --watch
```

**Profile Configuration:**
- `[profile.tdd]` inherits from `dev`
- `debug = false, incremental = true`
- Reduces compile time to ~150ms per change

#### 2. Test Infrastructure

Create a test harness for each crate:

```rust
#[macro_export]
macro_rules! test_helpers {
    () => {
        use oz_core::{Store, migrations};
        use foundation::Money;

        fn fresh_db() -> Connection { migrations::fresh_db() }
        fn store(conn: &Connection) -> Store<'_> { Store::new(conn) }
        fn usd() -> Currency { "USD".parse().unwrap() }
        fn price(minor: i64) -> Money { Money { minor_units: minor, currency: usd() } }
    };
}
```

#### 3. Test Organization Convention

```text
src/
├── lib.rs                    // Public API + test module
├── error.rs                  // thiserror variants + tests
├── money.rs                  // Money struct + comprehensive tests
└── db/
    ├── sales.rs              // CRUD operations + transaction tests
    └── inventory.rs          // Stock management tests
```

---

### Phase 2: Money Safety Tests (Weeks 3-4) — CRITICAL PATH #1

#### Key Test Categories:

- `from_major()` overflow returns None (not panic)
- `checked_add()` currency mismatch returns None
- `checked_add()` arithmetic overflow returns None  
- `Money::zero()` with #[must_use] compile-time enforcement
- Serialization roundtrip preserves minor_units + currency
- Display formatting matches expected output

#### Example Tests:

```rust
#[test]
fn from_major_overflow_returns_none() {
    let usd = "USD".parse::<Currency>().unwrap();
    assert!(Money::from_major(i64::MAX, usd).is_none());
}

#[test]
fn checked_add_currency_mismatch_returns_none() {
    let usd = "USD".parse().unwrap();
    let eur = "EUR".parse().unwrap();
    assert!(Money { minor_units: 100, currency: usd }
        .checked_add(Money { minor_units: 200, currency: eur })
        .is_none());
}
```

---

### Phase 3: Database Transaction Tests (Weeks 5-6)

#### Key Test Categories:

- `create_sale()` rollback on validation error
- `complete_sale_deduction()` concurrent isolation
- `adjust_stock_batch()` atomicity across multiple tables
- `void_pending_sale()` correctly reverses all writes
- `find_stale_pending_sales()` uses partial index efficiently

#### Example Test:

```rust
#[test]
fn create_sale_rollback_on_validation_error() {
    let conn = fresh_db();
    let s = store(&conn);

    // Create sale with invalid data (negative qty)
    let bad_sale = Sale { ... lines: vec![SaleLine { qty: -5, .. }] };

    assert!(s.create_sale(&bad_sale).is_err());

    // Verify no sales were created (rollback worked)
    assert_eq!(s.list_sales().unwrap().len(), 0);
}
```

---

### Phase 4: Error Path Tests (Weeks 7-8)

#### Key Test Categories:

- All `thiserror` variants have at least one regression test
- Validation errors contain helpful field + message pairs
- NotFound errors include entity type and ID
- CurrencyMismatch shows both currency codes

#### Example Test:

```rust
#[test]
fn validation_errors_contain_helpful_messages() {
    let bad_sale = Sale { ... lines: vec![SaleLine { qty: -5, .. }] };

    if let CoreError::Validation { field, message } = s.create_sale(&bad_sale).unwrap_err() {
        assert_eq!(field, "qty");
        assert!(message.contains("negative"));
    }
}
```

---

### Phase 5: Integration Test Expansion (Weeks 9-10)

#### Key Test Categories:

- Full sales workflow: create → complete → finalize → void
- Multi-location stock deduction with ADR-19 resolution
- Payment split validation (MONEY-04) covers total exactly or over
- Backup/restore preserves all data integrity

---

### Phase 6: Test Quality Improvements (Ongoing)

#### Key Practices:

- Property-based tests for Money arithmetic
- Fuzz testing for SQL injection via sale lines
- Benchmark tests for critical paths
- Integration with `cargo nextest` for parallel execution

---

## Immediate Action Items

1. **Run existing tests to establish baseline:**
   ```bash
   cd crates/kasirmu-core && cargo nextest run --workspace
   ```

2. **Pick one business logic module** (e.g., `modules/sales`) and write a failing test first.

3. **Create the minimal implementation** to make it pass.

4. **Refactor while maintaining all tests passing.**

5. **Commit with message:** `'test: add Money overflow regression (MONEY-01)'`

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Line coverage | >80% for core crates |
| Branch coverage | >70% for critical paths |
| Mutation score | >90% (using cargo-llvm-cov)
| Test execution time | <30s per crate with `--watch`

> last audited 29-09-26 by docs-auditor
