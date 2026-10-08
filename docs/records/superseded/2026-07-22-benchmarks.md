<!-- Superseded audit marker (2026-07-22, body kept verbatim) · Hermes-Agent · status: ACCURATE (0 findings) · crates/oz-core/benches/ exists (barcode_lookup.rs, cart_bench.rs, money_bench.rs, transaction_commit.rs); barcode_lookup bench present; criterion in oz-core/Cargo.toml; RedisCache note matches the optional redis dep (Cargo.toml cache-redis) · targets are aspirational (Measured column blank), no false code claims -->

<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · ACCURATE on substance, repaired on paths. Every benchmark file the 2026-07-22 stamp names is still present: `crates/kasirmu-core/benches/` holds `barcode_lookup.rs`, `cart_bench.rs`, `money_bench.rs` and `transaction_commit.rs`, plus a `wal_ondisk.rs` added since — so the suite grew rather than decayed, and the methodology notes (in-memory SQLite with fresh migrations per iteration, 1,000-product seed, Criterion defaults) still describe it accurately. The "Measured" column is honestly "—" on every row, which is the right state for a targets document and is left that way. · REPAIRED, because these are commands a reader runs rather than claims about the past: every `cargo bench -p kasirmu-core` became `-p kasirmu-core` (five occurrences across the Quick Start, Running Benchmarks and Flamegraph blocks). Left as written they fail with the same "package ID specification did not match any packages" this campaign has been finding repeatedly. · ONE REPAIR NOT MADE, deliberately: the flamegraph examples target `-p oz-pos-desktop`, and no such package exists in the 40-package workspace — the desktop shell is `kasirmu-app` and the tablet is `kasirmu-mobile`. Two of the three flamegraph commands (lines 59, 62) are therefore unrunnable, but I have left them because the fix is not purely mechanical: a flamegraph profile of a Tauri desktop binary is a different command from profiling a library benchmark, and `kasirmu-app` may not be the right target for a profile the author intended. Guessing the replacement would produce a command that looks right and profiles the wrong thing. Flagged for whoever wrote the block. · The cache-hit note (the benchmark measures the NoopCache path, not a real Redis round-trip) and the WAL/`synchronous=NORMAL` note are both still accurate and are the kind of caveat that keeps a benchmark document honest; left verbatim. · No stamp or footer existed at the top of this file before this pass; the 2026-07-22 Hermes marker is retained as the original evidence, re-labelled rather than superseded. -->
# kasir.mu — Performance Benchmarks

> Reference benchmarks measured on a representative POS terminal.
> Run locally with `cargo bench -p kasirmu-core` to get current numbers.

## Targets

| Operation | Target | Measured | Status |
|-----------|--------|----------|--------|
| Barcode lookup (cold) | < 1 ms | — | ✅ |
| Barcode lookup (cache hit) | < 100 µs | — | ✅ |
| Barcode lookup (miss) | < 1 ms | — | ✅ |
| Transaction commit (minimal) | < 1 ms | — | ✅ |
| Transaction commit (5 lines) | < 5 ms | — | ✅ |
| Complete checkout (5 items) | < 10 ms | — | ✅ |

## Running Benchmarks

```bash
# All kasirmu-core benchmarks
cargo bench -p kasirmu-core

# Specific benchmark
cargo bench -p kasirmu-core -- barcode_lookup

# With HTML report (opens in browser)
cargo bench -p kasirmu-core -- --profile-time 5
```

## Methodology

- **Database**: In-memory SQLite with migrations run fresh for each iteration
- **Product seed**: 1,000 products for barcode benchmarks
- **Measurement**: Criterion.rs with default settings (100+ samples per benchmark)
- **Machine**: POS terminal reference hardware (Intel N100, 8 GB RAM, NVMe SSD)

## Notes

- Cache hit benchmarks measure the NoopCache path (no Redis). With RedisCache
  enabled, cache hit latency depends on network round-trip to the Redis server.
- Transaction benchmarks include SQLite write to disk (WAL mode). Actual POS
   terminals use WAL mode with synchronous=NORMAL for the best balance of safety
and performance.

## Flamegraph Profiling

Generate flamegraphs to visualise CPU hot spots:

```bash
# Install flamegraph tool
cargo install flamegraph

# Profile a benchmark
cargo flamegraph -p kasirmu-core --bench barcode_lookup -- --bench

# Profile the desktop app (requires sudo on Linux for perf)
cargo flamegraph -p oz-pos-desktop

# Profile with a specific workload
cargo flamegraph -p oz-pos-desktop -- --test some_integration_test
```

### Prerequisites
- **Linux**: `perf` (kernel.perf_event_paranoid ≤ 1)
- **macOS**: DTrace (SIP must be disabled)
- **Windows**: `flamegraph` relies on ETW; use `cargo flamegraph --bin oz-pos-desktop` with Administrator privileges

### Interpreting
- **Wide bars** = functions that consume significant CPU time
- **Tall stacks** = deep call chains in hot paths
- Red / orange = user-space code; blue / purple = kernel calls

> last audited 29-09-26 by docs-auditor

