# The bridge suite gets 2.2x SLOWER in parallel, and the cause is a mutex round the
# test-database snapshot (round 307)

## Correcting round 19 twice over

Round 19 published an explanation for the slow bridge suite and then corrected it once. **The
correction was also wrong.** Both versions, and the measurement that settled it:

| Round | Claim | Status |
|---|---|---|
| 306 | "Argon2 explains the suite" | **wrong** — `auth` only; `staff` inserts the literal `'hash'` |
| 306 correction | "132 tests x a full migration chain each" | **wrong** — `fresh_db` caches a snapshot |
| this round | **lock contention on that snapshot** | measured, reproducible |

## What `fresh_db` actually does

Round 19's correction assumed `temp_conn()` re-runs the migrations. It does not — `fresh_db`
(`migrations.rs:698`) is already carefully optimised:

```rust
static SNAPSHOT: LazyLock<Mutex<rusqlite::Connection>> = LazyLock::new(|| { ... });
let mut fresh = rusqlite::Connection::open_in_memory()?;
{
    let snapshot = SNAPSHOT.lock().unwrap();
    let backup = rusqlite::backup::Backup::new(&snapshot, &mut fresh)?;
    backup.run_to_completion(100, Duration::from_millis(0), None)?;
} // MutexGuard dropped here
```

The schema is built **once** into a cached in-memory connection and each test gets a **copy** via
SQLite's backup API. Good design. But the copy happens **inside the mutex**, so every test's
database construction is serialised across all threads.

## The measurement

`staff` — the module round 19 identified as the most expensive — run five times:

| Configuration | Elapsed |
|---|---|
| `--test-threads=1` | 78.65s |
| `--test-threads=1` (repeat) | 78.26s |
| `--test-threads=1` (repeat) | 78.81s |
| **default (multi-threaded)** | **172.20s** |

Three single-threaded runs agree within 0.6s, and the parallel run is **2.2x slower**. That is the
signature of a serialised resource: adding threads adds contention, not throughput. Round 19 had
already noticed the same inversion on `auth` (41.5s single-threaded against 93s parallel) without
recognising what it meant.

## Why the mutex is not removable

The obvious fix — shorten the critical section, since the backup only READS the snapshot — does
not compile. rusqlite implements `Send` for `Connection` but **not `Sync`**
(`rusqlite-0.31.0/src/lib.rs:382`); `Backup::new` takes `from: &Connection`
(`backup.rs:187`), and a `&Connection` cannot be shared across threads. The mutex is **required for
soundness**, not conservatism. Only one thread may hold a borrowed handle to that snapshot at a
time, so the construction is serial by construction.

## The precedent is already in the repo

`.config/nextest.toml` serialises the **other** shared resource explicitly:

```toml
[test-groups.shared-postgres]
max-threads = 1
```

with a long comment recording that those tests were never flaky, they **raced**, and the fix is to
serialise them rather than pay for retries. The SQLite snapshot is the same shape — one shared
resource, N threads — with a gentler failure mode: the mutex makes tests *wait* instead of *fail*,
so nothing is ever red and nothing points at the cost. 405 `temp_conn()` call sites across 52 files
all queue on the one lock.

## What was NOT done, and why

**No change.** Three remedies exist and each trades something a round should not trade unilaterally:

- `--test-threads=1` for these suites — measured 2.2x faster, but slows any suite that *is*
  parallel-safe, and nextest's default profile is shared.
- per-thread snapshots — removes contention, costs N x the database memory.
- shorten the critical section — **impossible**, per the `Sync` bound above.

A test-harness performance change is not a reliability defect, and the config that would carry it
(`.config/nextest.toml`) is read by every crate. Recorded, with numbers, so the decision can be
made deliberately by whoever owns CI time.

## Verified

| Item | Result |
|---|---|
| `staff` single-threaded, three runs | **78.65s / 78.26s / 78.81s** |
| `staff` multi-threaded | **172.20s** |
| All 132 staff tests | pass in every configuration |
| `fresh_db` source | read: `LazyLock<Mutex<Connection>>` + `Backup` |
| Mutex removal | **not viable** — `Connection: !Sync`, verified in the crate source |
| `temp_conn()` call sites | 405 across 52 files, one test binary |
| Source changed | **none** |

## The lesson, which is round 19's turned on itself

Round 19 concluded *"a plausible mechanism is not a measured one"* and then produced a second
plausible mechanism — "a migration chain per test" — that was also unmeasured. The difference this
time is that the claim was checked against the code: `fresh_db`'s body shows the snapshot cache, and
the crate source shows the `Sync` bound. **A mechanism counts as measured only when the code is read
and the numbers reproduce.** Three runs inside 0.6s, against a 2.2x inversion, is the part that
makes this one stick.

> last audited 16-10-26 by docs-auditor
