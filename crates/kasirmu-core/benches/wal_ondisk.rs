//! Criterion benchmarks for the on-disk WAL storage path.
//!
//! # Why this file exists
//!
//! The sibling benches (`barcode_lookup`, `transaction_commit`) open
//! `Connection::open_in_memory()`. That is the right choice for measuring
//! query and commit *logic*, but it means they never exercise the
//! production storage configuration: `migrations::run` sets
//! `journal_mode = WAL`, and SQLite silently keeps an in-memory database in
//! `memory` mode. The in-memory numbers therefore describe a durability
//! regime that no deployed terminal uses.
//!
//! This file measures the file-backed path instead, under exactly the
//! PRAGMAs production sets (WAL + `synchronous = NORMAL` + `busy_timeout`
//! + `foreign_keys`), and adds the three things the in-memory harness
//! structurally cannot see:
//!
//! 1. **WAL-vs-memory delta** — how much durability actually costs.
//! 2. **Contention** — N threads sharing one `Mutex<Connection>`, which is
//!    the production shape (`AppState::db`). A single-threaded `b.iter()`
//!    loop has no second thread and so can never contend.
//! 3. **Tail latency** — p50/p95/p99/max via a manual histogram, because a
//!    cashier UI is a tail-latency problem: Criterion's mean and MAD cannot
//!    answer "does the screen stutter".
//!
//! # Reading the results
//!
//! These numbers are only comparable to each other on the same machine and
//! on a quiet filesystem. `wal_*` rows are meaningful *relative* to
//! `mem_*` rows measured in the same run; they are not absolute disk
//! throughput figures. In particular the `sync_normal_*` group is the
//! deployment-representative one — `synchronous = FULL` would be slower by
//! design and is not what ships.
//!
//! # Cost
//!
//! Every WAL group writes real files into a `tempfile` directory and fsyncs
//! through the OS. Full run is minutes, not seconds, and it is I/O-heavy on
//! the host disk. Run with
//! `cargo bench -p kasirmu-core --bench wal_ondisk` and expect noise on a
//! busy machine or a network-mounted temp directory.

// `criterion_group!` expands to a public function it does not document, so
// the workspace-wide `missing_docs` warning cannot be satisfied here.
#![allow(missing_docs)]

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use kasirmu_core::db::Store;
use kasirmu_core::migrations;
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Number of products seeded for the read-path benchmarks.
///
/// Matches `barcode_lookup`'s 1,000 so the two files are directly
/// comparable, which is the point of the `mem_*` mirror group.
const SEED_PRODUCTS: usize = 1000;

/// Commits per contention thread per measured round.
const CONTENTION_COMMITS_PER_THREAD: usize = 50;

/// Number of concurrent writer threads in the contention group.
///
/// Three is deliberate: it is enough to create real lock contention on one
/// connection, while staying a plausible terminal shape (a cashier command,
/// the sync daemon, and a background report). It is not a stress test.
const CONTENTION_THREADS: usize = 3;

fn usd() -> kasirmu_core::Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> kasirmu_core::Money {
    kasirmu_core::Money {
        minor_units: minor,
        currency: usd(),
    }
}

/// Open a file-backed database with the full production PRAGMA set.
///
/// This is the whole point of the file: `migrations::run` applies WAL,
/// `synchronous = NORMAL`, `busy_timeout = 5000` and `foreign_keys = ON`.
/// Using it here (rather than a hand-rolled `execute_batch`) means the
/// benchmark cannot drift from the settings `run` ships — if production
/// changes a PRAGMA, these numbers change with it.
///
/// The caller owns the returned `TempDir` and must keep it alive: dropping
/// it deletes the database files out from under the open connection.
fn open_wal(path: &Path) -> Connection {
    let mut conn = Connection::open(path).expect("open file-backed sqlite");
    migrations::run(&mut conn).expect("apply migrations with production PRAGMAs");
    conn
}

/// Open an in-memory database, mirroring the sibling benches exactly.
///
/// Included so the WAL-vs-memory delta is measured in the same process,
/// same run, same machine — comparing against numbers recorded yesterday
/// from another file would fold machine variance into the result.
fn open_memory() -> Connection {
    let mut conn = Connection::open_in_memory().expect("open in-memory sqlite");
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrations::run(&mut conn).unwrap();
    conn
}

/// Seed `count` products through the normal `Store` API.
fn seed(conn: &Connection, count: usize) {
    let store = Store::new(conn);
    for i in 0..count {
        let sku = format!("SKU-{:05}", i);
        store
            .create_product(
                &sku,
                &format!("Product {}", i),
                price(1000),
                None,
                None,
                0,
                None,
            )
            .expect("seed product");
    }
}

/// Assert the connection really is in WAL mode.
///
/// Guard against the trap this file exists to avoid: SQLite *accepts*
/// `journal_mode = WAL` on a `:memory:` database and silently stays in
/// `memory` mode. A benchmark that assumed WAL without checking would
/// produce plausible, entirely wrong numbers.
fn assert_wal(conn: &Connection) {
    let mode: String = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .expect("read journal_mode");
    assert_eq!(
        mode.to_lowercase(),
        "wal",
        "file-backed benchmark is not in WAL mode (got {mode:?}) — \
         the numbers would describe the wrong durability regime"
    );
}

/// Latency samples collected from one manual measurement pass.
///
/// Criterion reports mean/median/MAD and its own outlier classification. It
/// does not report p95/p99, and a terminal UI stutters on the tail, not the
/// mean. This records every sample so the tail can be reported directly.
#[derive(Default)]
struct Latencies {
    samples: Vec<Duration>,
}

impl Latencies {
    fn record(&mut self, d: Duration) {
        self.samples.push(d);
    }

    /// Nearest-rank percentile of the recorded samples.
    ///
    /// Nearest-rank rather than interpolated: with a few hundred samples,
    /// interpolation invents a latency no request actually experienced.
    /// `p` is a fraction (0.95 for p95).
    fn percentile(&self, p: f64) -> Duration {
        if self.samples.is_empty() {
            return Duration::ZERO;
        }
        let mut sorted = self.samples.clone();
        sorted.sort_unstable();
        let rank = (p * sorted.len() as f64).ceil() as usize;
        let idx = rank.saturating_sub(1).min(sorted.len() - 1);
        sorted[idx]
    }

    fn max(&self) -> Duration {
        self.samples.iter().copied().max().unwrap_or(Duration::ZERO)
    }

    fn mean(&self) -> Duration {
        if self.samples.is_empty() {
            return Duration::ZERO;
        }
        let total: Duration = self.samples.iter().sum();
        total / self.samples.len() as u32
    }

    /// Print p50/p95/p99/max for this sample set.
    ///
    /// Emitted to stderr so it does not collide with Criterion's own
    /// stdout estimate blocks.
    fn report(&self, label: &str) {
        eprintln!(
            "    {label:<34} n={:<6} mean={:>9.3?} p50={:>9.3?} p95={:>9.3?} p99={:>9.3?} max={:>9.3?}",
            self.samples.len(),
            self.mean(),
            self.percentile(0.50),
            self.percentile(0.95),
            self.percentile(0.99),
            self.max(),
        );
    }
}

/// Build a temp directory plus a seeded WAL database inside it.
///
/// Returns the `TempDir` guard — dropping it removes the files, so callers
/// must bind it for as long as the connection lives.
fn wal_fixture() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().expect("create temp dir for WAL benchmark");
    let conn = open_wal(&dir.path().join("bench.db"));
    assert_wal(&conn);
    (dir, conn)
}

/// A SKU generator that is unique across the whole process, not per-cycle.
///
/// Criterion calls the `b.iter()` closure many times — warmup, then every
/// sample — and a counter declared *inside* the closure restarts at zero on
/// each cycle. That re-inserts the same SKUs and trips the product
/// uniqueness constraint on the second cycle. A process-wide atomic avoids
/// the reset without needing a cleanup step between cycles.
fn next_sku(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    format!("{prefix}-{:09}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

// ── Group 1: read path, WAL vs memory ────────────────────────────────

fn bench_read_wal(c: &mut Criterion) {
    let (_dir, conn) = wal_fixture();
    seed(&conn, SEED_PRODUCTS);
    let store = Store::new(&conn);
    let _ = store.get_product("SKU-00000");

    c.bench_function("wal_barcode_lookup_1000_products", |b| {
        b.iter(|| black_box(store.get_product(black_box("SKU-00500"))))
    });
}

fn bench_read_memory(c: &mut Criterion) {
    let conn = open_memory();
    seed(&conn, SEED_PRODUCTS);
    let store = Store::new(&conn);
    let _ = store.get_product("SKU-00000");

    c.bench_function("mem_barcode_lookup_1000_products", |b| {
        b.iter(|| black_box(store.get_product(black_box("SKU-00500"))))
    });
}

// ── Group 2: write path, WAL vs memory ───────────────────────────────
//
// This is where the durability cost actually shows up. Reads rarely touch
// the WAL; every commit here appends to it and, under NORMAL, is not
// fsynced per-commit.

fn bench_write_wal(c: &mut Criterion) {
    let (_dir, conn) = wal_fixture();

    c.bench_function("wal_sync_normal_product_insert", |b| {
        let store = Store::new(&conn);
        b.iter(|| {
            let sku = next_sku("W");
            black_box(
                store
                    .create_product(&sku, "WAL Product", price(1000), None, None, 0, None)
                    .expect("insert"),
            )
        })
    });
}

fn bench_write_memory(c: &mut Criterion) {
    let conn = open_memory();

    c.bench_function("mem_product_insert", |b| {
        let store = Store::new(&conn);
        b.iter(|| {
            let sku = next_sku("M");
            black_box(
                store
                    .create_product(&sku, "Mem Product", price(1000), None, None, 0, None)
                    .expect("insert"),
            )
        })
    });
}

// ── Group 3: contention on one Mutex<Connection> ─────────────────────
//
// The production shape is a single connection behind a mutex
// (`AppState::db`). The sibling benches are single-threaded `b.iter()`
// loops and therefore cannot contend even in principle: there is no second
// thread to contend with. This group is the only place that question is
// actually exercised.
//
// NOTE ON SCOPE: this measures lock *and* SQLite write-lock contention
// together, under a pure-write load — an upper bound, not a typical mix. A
// real terminal is read-dominated, so treat these as worst-case numbers.

fn bench_contention(c: &mut Criterion) {
    let dir = tempfile::tempdir().expect("temp dir");
    let conn = open_wal(&dir.path().join("contention.db"));
    assert_wal(&conn);
    let db = Arc::new(Mutex::new(conn));

    c.bench_function(
        &format!("wal_contention_{CONTENTION_THREADS}x{CONTENTION_COMMITS_PER_THREAD}_writes"),
        |b| {
            b.iter(|| {
                let mut handles = Vec::with_capacity(CONTENTION_THREADS);
                for _ in 0..CONTENTION_THREADS {
                    let db = Arc::clone(&db);
                    handles.push(std::thread::spawn(move || {
                        for _ in 0..CONTENTION_COMMITS_PER_THREAD {
                            // Scope the guard so the lock is released per
                            // insert, which is what a Tauri command does.
                            let sku = next_sku("C");
                            let guard = db.lock().expect("lock db");
                            let store = Store::new(&guard);
                            store
                                .create_product(
                                    &sku,
                                    "Contended Product",
                                    price(1000),
                                    None,
                                    None,
                                    0,
                                    None,
                                )
                                .expect("contended insert");
                        }
                    }));
                }
                for h in handles {
                    h.join().expect("contention thread panicked");
                }
            })
        },
    );

    // Manual per-operation latency pass, reported as percentiles.
    let mut lat = Latencies::default();
    for _round in 0..20 {
        let mut handles = Vec::with_capacity(CONTENTION_THREADS);
        for _ in 0..CONTENTION_THREADS {
            let db = Arc::clone(&db);
            handles.push(std::thread::spawn(move || {
                let mut local = Vec::with_capacity(CONTENTION_COMMITS_PER_THREAD);
                for _ in 0..CONTENTION_COMMITS_PER_THREAD {
                    let sku = next_sku("L");
                    let start = Instant::now();
                    let guard = db.lock().expect("lock db");
                    let store = Store::new(&guard);
                    store
                        .create_product(&sku, "Latency Product", price(1000), None, None, 0, None)
                        .expect("latency insert");
                    local.push(start.elapsed());
                }
                local
            }));
        }
        for h in handles {
            lat.samples
                .extend(h.join().expect("latency thread panicked"));
        }
    }
    eprintln!("  -- contention latency (lock wait + write) --");
    lat.report("contention_write");
}

// ── Group 4: WAL growth and checkpoint behavior ──────────────────────
//
// Under WAL, commits append to the -wal file. SQLite auto-checkpoints at
// 1000 pages by default, and a checkpoint must sync. That means the cost
// per commit is not constant: most are cheap appends, and periodically one
// absorbs the checkpoint. A benchmark that pre-seeded and then measured a
// flat loop would average that spike away — the same tail-latency problem,
// one level down.
//
// This group measures the spike directly by watching WAL size across a
// sustained write run.

fn bench_wal_growth(c: &mut Criterion) {
    let dir = tempfile::tempdir().expect("temp dir");
    let db_path = dir.path().join("growth.db");
    let conn = open_wal(&db_path);
    assert_wal(&conn);
    let store = Store::new(&conn);

    let wal_path = db_path.with_extension("db-wal");
    let mut lat = Latencies::default();
    let mut n = 0usize;
    let mut peak_wal = 0u64;
    let mut checkpoint_crossings = 0usize;
    let mut prev_size = 0u64;

    // 5,000 inserts: enough to cross the default auto-checkpoint threshold
    // (1000 pages) several times on a realistic page size.
    for _ in 0..5_000 {
        n += 1;
        let start = Instant::now();
        let sku = format!("G-{n:06}");
        store
            .create_product(&sku, "Growth Product", price(1000), None, None, 0, None)
            .expect("growth insert");
        lat.record(start.elapsed());

        // WAL size is sampled, not measured under lock — this is
        // observability for the report, not part of the timed region.
        if let Ok(md) = std::fs::metadata(&wal_path) {
            let size = md.len();
            peak_wal = peak_wal.max(size);
            // A decrease means a checkpoint truncated the WAL.
            if size < prev_size {
                checkpoint_crossings += 1;
            }
            prev_size = size;
        }
    }

    eprintln!(
        "  -- WAL growth: peak={} KiB, observed checkpoints={}, samples={} --",
        peak_wal / 1024,
        checkpoint_crossings,
        lat.samples.len()
    );
    lat.report("wal_insert_under_growth");

    // Criterion functions must still register a benchmark; measure the
    // steady-state cost of an insert in an already-large WAL.
    c.bench_function("wal_insert_after_growth", |b| {
        b.iter(|| {
            let sku = next_sku("H");
            black_box(
                store
                    .create_product(&sku, "Post Growth", price(1000), None, None, 0, None)
                    .expect("insert"),
            )
        })
    });
}

// ── Group 5: tail latency of a realistic read/write mix ──────────────
//
// A terminal is read-dominated: many barcode lookups per sale, one commit
// per sale. This group measures that mix's tail on the WAL path, which is
// the closest thing here to the "does the UI stutter" question.

fn bench_tail_latency(c: &mut Criterion) {
    let (_dir, conn) = wal_fixture();
    seed(&conn, SEED_PRODUCTS);
    let store = Store::new(&conn);

    let mut read_lat = Latencies::default();
    let mut write_lat = Latencies::default();

    for i in 0..2_000 {
        let start = Instant::now();
        let _ = store.get_product(black_box("SKU-00500"));
        read_lat.record(start.elapsed());

        // Roughly one commit per 20 lookups — a sale with a 20-item cart.
        if i % 20 == 0 {
            let start = Instant::now();
            let sku = format!("T-{i:06}");
            store
                .create_product(&sku, "Tail Product", price(1000), None, None, 0, None)
                .expect("tail insert");
            write_lat.record(start.elapsed());
        }
    }

    eprintln!("  -- realistic mix latency (WAL, sync=NORMAL) --");
    read_lat.report("read_lookup");
    write_lat.report("sale_commit");

    c.bench_function("wal_realistic_mix_lookup", |b| {
        b.iter(|| black_box(store.get_product(black_box("SKU-00500"))))
    });
}

criterion_group!(
    wal_benches,
    bench_read_wal,
    bench_read_memory,
    bench_write_wal,
    bench_write_memory,
    bench_contention,
    bench_wal_growth,
    bench_tail_latency,
);
criterion_main!(wal_benches);
