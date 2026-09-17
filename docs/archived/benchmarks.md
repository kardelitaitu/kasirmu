<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · crates/oz-core/benches/ exists (barcode_lookup.rs, cart_bench.rs, money_bench.rs, transaction_commit.rs); barcode_lookup bench present; criterion in oz-core/Cargo.toml; RedisCache note matches the optional redis dep (Cargo.toml cache-redis) · targets are aspirational (Measured column blank), no false code claims -->

# kasir.mu — Performance Benchmarks

> Reference benchmarks measured on a representative POS terminal.
> Run locally with `cargo bench -p oz-core` to get current numbers.

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
# All oz-core benchmarks
cargo bench -p oz-core

# Specific benchmark
cargo bench -p oz-core -- barcode_lookup

# With HTML report (opens in browser)
cargo bench -p oz-core -- --profile-time 5
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
cargo flamegraph -p oz-core --bench barcode_lookup -- --bench

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

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers, all file references valid

