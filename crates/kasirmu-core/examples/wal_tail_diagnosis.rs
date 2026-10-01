//! Diagnostic: isolate the cause of the WAL write tail.
//!
//! # Why this exists
//!
//! `benches/wal_ondisk.rs` found that commit latency has a long tail on the
//! WAL path — median ~50 µs, p99 in the low milliseconds, worst observed
//! 174 ms — while reads stay clean (p99 ~54 µs). Criterion reports the
//! distribution but cannot say what produces the spikes.
//!
//! That file's own checkpoint detector was inconclusive: it sampled WAL size
//! and looked for shrinkage, and it never fired (`observed checkpoints=0`)
//! even though size peaked at 4 MB. So "the tail is checkpointing" is a
//! hypothesis, not a finding. This program tests it.
//!
//! # What it does
//!
//! Runs the same insert workload as the benchmark, but records per insert:
//!
//! - exact latency
//! - WAL file size before the insert
//! - whether that insert crossed an auto-checkpoint boundary
//! - whether the WAL *shrank* during the insert (a checkpoint drained it)
//!
//! It then reports the latency distribution **conditioned** on those
//! events. If checkpointing causes the tail, the spikes will cluster on
//! boundary-crossing inserts and the conditioned distributions will
//! separate cleanly. If they do not cluster — if spikes are spread
//! uniformly across non-crossing inserts — then the checkpoint hypothesis
//! is dead and the cause is elsewhere (fsync, allocator, OS scheduling).
//!
//! # Running
//!
//! ```text
//! cargo run -p kasirmu-core --release --example wal_tail_diagnosis
//! ```
//!
//! Writes real files to a temp directory; takes tens of seconds.
//!
//! # Panic policy
//!
//! INVARIANT: this is a diagnostic tool, not shipped code. Every `expect`
//! below cannot fail in a way the operator would want to continue past — a
//! failed DB open, migration, PRAGMA read or create-dir means the run is
//! void, and a panic with the named reason is the correct outcome. Each
//! call site carries its own `INVARIANT`/`SAFETY` marker for the gate.

#![allow(clippy::print_stdout)]
// P2-5: the float casts here are the MEASUREMENT, not a mistake. A percentile
// rank is `p * n` by definition (p in 0.0..=1.0), `n` is a sample count that
// cannot approach 2^53, and the durations being ranked are microsecond-scale so
// `as f64` retains far more precision than the three decimals this prints.
// Converting them to checked forms would add error paths to a diagnostic that
// has no way to act on them. Same rationale as `print_stdout` above: this is a
// tool, not shipped code.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]

use kasirmu_core::db::Store;
use kasirmu_core::migrations;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Inserts to perform. Large enough to cross the default 1000-page
/// auto-checkpoint threshold several times.
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

/// One observed insert.
struct Sample {
    latency: Duration,
    wal_size_before: u64,
    /// A checkpoint ran during this insert (the WAL shrank).
    shrank: bool,
    /// This insert's start position was at or past the auto-checkpoint
    /// threshold, so SQLite would consider checkpointing it.
    past_threshold: bool,
}

/// Nearest-rank percentile, matching the benchmark's definition.
fn percentile(sorted: &[Duration], p: f64) -> Duration {
    if sorted.is_empty() {
        return Duration::ZERO;
    }
    let rank = (p * sorted.len() as f64).ceil() as usize;
    sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
}

/// Print a latency summary for one conditioned bucket.
fn report(label: &str, mut lat: Vec<Duration>) {
    if lat.is_empty() {
        println!("  {label:<28} (no samples)");
        return;
    }
    lat.sort_unstable();
    let total: Duration = lat.iter().sum();
    let mean = total / lat.len() as u32;
    println!(
        "  {label:<28} n={:<6} mean={:>10.3?} p50={:>10.3?} p95={:>10.3?} p99={:>10.3?} max={:>10.3?}",
        lat.len(),
        mean,
        percentile(&lat, 0.50),
        percentile(&lat, 0.95),
        percentile(&lat, 0.99),
        lat.last().copied().unwrap_or(Duration::ZERO),
    );
}

/// Remove the scratch directory when the diagnostic exits.
///
/// Stands in for `tempfile::TempDir`, which examples cannot use: it is a
/// dev-dependency, and dev-dependencies are not linked into examples.
struct Cleanup(PathBuf);

impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Open a file-backed DB with the production PRAGMA set.
fn open_wal(path: &Path) -> Connection {
    // INVARIANT: a diagnostic cannot continue without its database; a failed
    // open or migration voids the run and the panic names the reason.
    let mut conn = Connection::open(path).expect("open sqlite");
    // INVARIANT: migrations must apply or the schema is wrong and every
    // number this tool produces would describe a database that cannot exist.
    migrations::run(&mut conn).expect("apply migrations");
    // SAFETY: reading a PRAGMA on a just-migrated connection cannot fail.
    let mode: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .expect("read journal_mode");
    assert_eq!(mode.to_lowercase(), "wal", "not in WAL mode (got {mode:?})");
    conn
}

/// Read the auto-checkpoint page threshold (default 1000).
fn autocheckpoint(conn: &Connection) -> i64 {
    // SAFETY: `wal_autocheckpoint` always returns exactly one row.
    conn.query_row("PRAGMA wal_autocheckpoint", [], |r| r.get(0))
        .expect("read wal_autocheckpoint")
}

/// Read the page size in bytes, needed to convert pages to file bytes.
fn page_size(conn: &Connection) -> u64 {
    // SAFETY: `page_size` always returns exactly one row.
    conn.query_row("PRAGMA page_size", [], |r| r.get(0))
        .expect("read page_size")
}

fn main() {
    // `tempfile` is a dev-dependency and so is not visible to examples.
    // A process-unique subdirectory of the OS temp dir is equivalent here:
    // the directory must merely be writable and not shared with other runs.
    let dir: PathBuf =
        std::env::temp_dir().join(format!("kasirmu-wal-tail-{}", std::process::id()));
    // INVARIANT: without a scratch directory there is nothing to measure.
    std::fs::create_dir_all(&dir).expect("create temp dir for diagnosis");
    let db_path: PathBuf = dir.join("tail.db");
    let conn = open_wal(&db_path);
    let store = Store::new(&conn);
    let _cleanup = Cleanup(dir.clone());

    let threshold_pages = autocheckpoint(&conn);
    let page_sz = page_size(&conn);
    let threshold_bytes = threshold_pages as u64 * page_sz;

    // SQLite names the write-ahead log "<db>-wal".
    let wal_path = PathBuf::from(format!("{}-wal", db_path.display()));

    println!("WAL tail diagnosis");
    println!("  database          : {}", db_path.display());
    println!("  journal_mode      : WAL, synchronous=NORMAL (via migrations::run)");
    println!(
        "  wal_autocheckpoint: {threshold_pages} pages ({threshold_bytes} bytes at {page_sz} B/page)"
    );
    println!("  inserts           : {INSERTS}");
    println!();

    let mut samples: Vec<Sample> = Vec::with_capacity(INSERTS);

    for _ in 0..INSERTS {
        let before = std::fs::metadata(&wal_path).map(|m| m.len()).unwrap_or(0);

        let start = Instant::now();
        let sku = format!("T-{:09}", samples.len());
        // INVARIANT: SKUs are unique per iteration, so a failed insert means
        // the database is broken and the measurement is void.
        store
            .create_product(&sku, "Tail Product", price(1000), None, None, 0, None)
            .expect("insert");
        let latency = start.elapsed();

        let after = std::fs::metadata(&wal_path).map(|m| m.len()).unwrap_or(0);

        samples.push(Sample {
            latency,
            wal_size_before: before,
            // A checkpoint drained pages: the file got smaller across the insert.
            shrank: after < before,
            past_threshold: before >= threshold_bytes,
        });
    }

    let shrunk = samples.iter().filter(|s| s.shrank).count();
    let past = samples.iter().filter(|s| s.past_threshold).count();
    let peak = samples.iter().map(|s| s.wal_size_before).max().unwrap_or(0);

    println!("Observed events");
    println!("  peak WAL size before insert : {} KiB", peak / 1024);
    println!(
        "  inserts that shrank the WAL  : {} ({:.2}%)  <- checkpoint fired during the insert",
        shrunk,
        shrunk as f64 * 100.0 / samples.len() as f64
    );
    println!(
        "  inserts starting past threshold: {} ({:.2}%)",
        past,
        past as f64 * 100.0 / samples.len() as f64
    );
    println!();

    // The decisive comparison: latency conditioned on whether a checkpoint
    // ran. If the hypothesis holds, these two rows separate sharply.
    println!("Latency conditioned on checkpoint activity");
    let all: Vec<Duration> = samples.iter().map(|s| s.latency).collect();
    report("ALL inserts", all);

    let with_ckpt: Vec<Duration> = samples
        .iter()
        .filter(|s| s.shrank)
        .map(|s| s.latency)
        .collect();
    report("WAL shrank (checkpoint)", with_ckpt);

    let without_ckpt: Vec<Duration> = samples
        .iter()
        .filter(|s| !s.shrank)
        .map(|s| s.latency)
        .collect();
    report("WAL steady (no checkpoint)", without_ckpt);
    println!();

    // Correlate the slowest inserts against the events. If the tail is
    // checkpoint-driven, the slowest inserts should be checkpoint inserts.
    let mut by_latency: Vec<&Sample> = samples.iter().collect();
    by_latency.sort_by_key(|a| std::cmp::Reverse(a.latency));

    let top_n = 20.min(by_latency.len());
    let top_shrank = by_latency.iter().take(top_n).filter(|s| s.shrank).count();
    println!("Slowest {top_n} inserts");
    println!(
        "  of the {top_n} slowest, {top_shrank} involved a checkpoint ({:.0}%)",
        top_shrank as f64 * 100.0 / top_n as f64
    );
    println!(
        "  base rate of checkpoint inserts: {:.2}%",
        shrunk as f64 * 100.0 / samples.len() as f64
    );
    println!();

    // Verdict, stated as the data supports it — not as a hope.
    let base_rate = shrunk as f64 / samples.len() as f64;
    let top_rate = top_shrank as f64 / top_n as f64;
    println!("Interpretation");
    if shrunk == 0 {
        println!(
            "  No checkpoints were observed at all ({INSERTS} inserts, peak WAL {} KiB).\n  \
             The checkpoint hypothesis is UNTESTED by this run, not confirmed.\n  \
             The tail must have another cause (fsync, allocator, OS scheduling).",
            peak / 1024
        );
    } else if top_rate > base_rate * 3.0 {
        println!(
            "  Checkpoint inserts are strongly over-represented in the tail\n  \
             ({:.0}% of the slowest vs {:.2}% base rate). The checkpoint hypothesis\n  \
             is SUPPORTED: spikes cluster on checkpointing inserts.",
            top_rate * 100.0,
            base_rate * 100.0
        );
    } else {
        println!(
            "  Checkpoint inserts are NOT over-represented in the tail\n  \
             ({:.0}% of the slowest vs {:.2}% base rate). The checkpoint hypothesis\n  \
             is NOT supported: spikes are spread across ordinary inserts.\n  \
             Look elsewhere — fsync batching, allocator, or OS scheduling.",
            top_rate * 100.0,
            base_rate * 100.0
        );
    }
}
