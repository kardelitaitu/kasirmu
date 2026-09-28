//! Diagnostic: attribute the WAL write tail to fsync versus other causes.
//!
//! # Why this exists
//!
//! `examples/wal_tail_diagnosis.rs` disproved the checkpoint hypothesis:
//! across 20,000 inserts the WAL never shrank once, so no auto-checkpoint
//! ran during the measured region — yet the p99 was still ~2.4 ms and the
//! max 144 ms. Something else produces the tail.
//!
//! # The experiment
//!
//! Run the same workload under different `synchronous` settings. The only
//! thing that changes between them is whether SQLite issues an fsync before
//! reporting the commit as durable:
//!
//! | Setting | fsync per commit? |
//! |---|---|
//! | `OFF`    | no — the OS flushes on its own schedule |
//! | `NORMAL` | no — WAL mode defers fsync to checkpoint time (what ships) |
//! | `FULL`   | yes — fsync on every commit |
//!
//! If `OFF` and `NORMAL` have similar tails, fsync is not the cause. If
//! `FULL` has a dramatically worse tail, fsync *can* produce a tail of this
//! shape — which matters, because `NORMAL` should not be paying it.
//!
//! A subtlety worth stating up front: in WAL mode, `NORMAL` is documented to
//! skip the per-commit fsync, so `NORMAL` and `OFF` are expected to be close.
//! If they are NOT close, the difference is informative — it means WAL is
//! syncing more than the documentation implies for this workload.
//!
//! # Running
//!
//! ```text
//! cargo run -p kasirmu-core --release --example wal_sync_attribution
//! ```

#![allow(clippy::print_stdout)]
// P2-5: float casts here are the measurement (percentile ranks as `p * n`, and
// a mean of microsecond durations), not a correctness risk. Diagnostic tool, not
// shipped code — same rationale as `print_stdout` above.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]

use kasirmu_core::db::Store;
use kasirmu_core::migrations;
use rusqlite::Connection;
use std::path::PathBuf;
use std::time::{Duration, Instant};

/// Inserts per configuration. Matches the tail diagnosis so the `NORMAL`
/// row here is directly comparable to that run.
const INSERTS: usize = 20_000;

fn usd() -> kasirmu_core::Currency {
    // SAFETY: "USD" is a literal ISO-4217 code; parse cannot fail.
    "USD".parse().unwrap()
}

fn price(minor: i64) -> kasirmu_core::Money {
    kasirmu_core::Money {
        minor_units: minor,
        currency: usd(),
    }
}

/// Nearest-rank percentile.
fn percentile(sorted: &[Duration], p: f64) -> Duration {
    if sorted.is_empty() {
        return Duration::ZERO;
    }
    let rank = (p * sorted.len() as f64).ceil() as usize;
    sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
}

/// Latency distribution summary for one configuration.
struct Dist {
    label: &'static str,
    lat: Vec<Duration>,
}

impl Dist {
    fn stats(&mut self) -> (Duration, Duration, Duration, Duration, Duration) {
        self.lat.sort_unstable();
        let total: Duration = self.lat.iter().sum();
        let mean = if self.lat.is_empty() {
            Duration::ZERO
        } else {
            total / self.lat.len() as u32
        };
        (
            mean,
            percentile(&self.lat, 0.50),
            percentile(&self.lat, 0.95),
            percentile(&self.lat, 0.99),
            self.lat.last().copied().unwrap_or(Duration::ZERO),
        )
    }
}

/// Open a file-backed database and apply `synchronous = <mode>` **after**
/// `migrations::run`, so the production PRAGMA set is the baseline and only
/// the sync mode differs between configurations.
fn open_with_sync(path: &std::path::Path, mode: &str) -> Connection {
    // INVARIANT: a diagnostic cannot continue without its database; a failed
    // open or migration voids the run and the panic names the reason.
    let mut conn = Connection::open(path).expect("open sqlite");
    // INVARIANT: migrations must apply or the schema is wrong and every
    // number this tool produces would describe a database that cannot exist.
    migrations::run(&mut conn).expect("apply migrations with production PRAGMAs");
    // SAFETY: setting a PRAGMA on an open connection cannot fail.
    conn.pragma_update(None, "synchronous", mode)
        .expect("set synchronous");
    // SAFETY: `synchronous` always returns exactly one row.
    let got: i64 = conn
        .query_row("PRAGMA synchronous", [], |r| r.get(0))
        .expect("read synchronous");
    // OFF=0, NORMAL=1, FULL=2, EXTRA=3.
    let expected = match mode {
        "OFF" => 0,
        "NORMAL" => 1,
        "FULL" => 2,
        _ => panic!("unexpected sync mode {mode}"),
    };
    assert_eq!(
        got, expected,
        "synchronous={mode} did not take effect (pragma reads {got})"
    );
    // SAFETY: `journal_mode` always returns exactly one row.
    let jm: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .expect("read journal_mode");
    assert_eq!(jm.to_lowercase(), "wal", "not in WAL mode (got {jm:?})");
    conn
}

/// Run `INSERTS` product inserts, returning per-insert latencies.
fn run_workload(conn: &Connection, tag: &str) -> Vec<Duration> {
    let store = Store::new(conn);
    let mut lat = Vec::with_capacity(INSERTS);
    for i in 0..INSERTS {
        let start = Instant::now();
        let sku = format!("{tag}-{i:09}");
        // INVARIANT: SKUs are unique per iteration, so a failed insert means
        // the database is broken and the measurement is void.
        store
            .create_product(&sku, "Sync Product", price(1000), None, None, 0, None)
            .expect("insert");
        lat.push(start.elapsed());
    }
    lat
}

/// Remove the scratch directory on exit.
struct Cleanup(PathBuf);

impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn main() {
    let dir: PathBuf =
        std::env::temp_dir().join(format!("kasirmu-wal-sync-{}", std::process::id()));
    // INVARIANT: without a scratch directory there is nothing to measure.
    std::fs::create_dir_all(&dir).expect("create temp dir");
    let _cleanup = Cleanup(dir.clone());

    println!("WAL write tail: fsync attribution");
    println!("  inserts per configuration: {INSERTS}");
    println!("  journal_mode: WAL (all configurations)");
    println!();

    let modes = ["OFF", "NORMAL", "FULL"];
    let mut results: Vec<Dist> = Vec::new();

    for mode in modes {
        let db = dir.join(format!("sync-{mode}.db"));
        let conn = open_with_sync(&db, mode);
        let lat = run_workload(&conn, mode);
        results.push(Dist { label: mode, lat });
    }

    println!(
        "  {:<8} {:>11} {:>11} {:>11} {:>11} {:>11}",
        "sync", "mean", "p50", "p95", "p99", "max"
    );
    println!("  {}", "-".repeat(66));
    for d in &mut results {
        let (mean, p50, p95, p99, max) = d.stats();
        println!(
            "  {:<8} {:>11.3?} {:>11.3?} {:>11.3?} {:>11.3?} {:>11.3?}",
            d.label, mean, p50, p95, p99, max
        );
    }
    println!();

    // The decisive ratios. p99 over p50 measures how heavy the tail is;
    // comparing that ratio across sync modes isolates fsync's contribution.
    println!("Tail heaviness (p99 / p50) by configuration");
    for d in &mut results {
        let (_, p50, _, p99, _) = d.stats();
        let ratio = if p50.as_nanos() > 0 {
            p99.as_nanos() as f64 / p50.as_nanos() as f64
        } else {
            f64::NAN
        };
        println!("  {:<8} p99/p50 = {:.1}x", d.label, ratio);
    }
    println!();

    // Interpretation, stated against what the numbers show.
    let (_, off_p50, _, off_p99, _) = results[0].stats();
    let (_, norm_p50, _, norm_p99, _) = results[1].stats();
    let (_, full_p50, _, full_p99, _) = results[2].stats();

    println!("Interpretation");
    println!(
        "  OFF     p50={off_p50:.3?} p99={off_p99:.3?}\n  \
         NORMAL  p50={norm_p50:.3?} p99={norm_p99:.3?}\n  \
         FULL    p50={full_p50:.3?} p99={full_p99:.3?}"
    );
    println!();

    // Compare NORMAL to OFF: in WAL mode both are documented to skip the
    // per-commit fsync, so a large gap means WAL is syncing more than the
    // docs imply for this workload.
    let normal_vs_off = if off_p99.as_nanos() > 0 {
        norm_p99.as_nanos() as f64 / off_p99.as_nanos() as f64
    } else {
        f64::NAN
    };
    let full_vs_normal = if norm_p99.as_nanos() > 0 {
        full_p99.as_nanos() as f64 / norm_p99.as_nanos() as f64
    } else {
        f64::NAN
    };

    if normal_vs_off < 1.5 {
        println!(
            "  NORMAL p99 is within {normal_vs_off:.2}x of OFF — consistent with WAL skipping the\n  \
             per-commit fsync, as documented. The p99 tail you ship is therefore NOT\n  \
             fsync. Look at the median path instead: the cost is spread across\n  \
             ordinary inserts, not concentrated in a durable-commit spike."
        );
    } else {
        println!(
            "  NORMAL p99 is {normal_vs_off:.2}x OFF's — WAL is syncing more than a skipped\n  \
             per-commit fsync would explain. Investigate what NORMAL is flushing."
        );
    }
    println!();
    if full_vs_normal > 2.0 {
        println!(
            "  FULL p99 is {full_vs_normal:.2}x NORMAL's, confirming per-commit fsync CAN produce\n  \
             a tail of this shape. This is the upper bound you avoid by shipping\n  \
             synchronous=NORMAL."
        );
    } else {
        println!(
            "  FULL p99 is only {full_vs_normal:.2}x NORMAL's — per-commit fsync does NOT dominate\n  \
             the tail on this filesystem. The tail is coming from something else."
        );
    }
}
