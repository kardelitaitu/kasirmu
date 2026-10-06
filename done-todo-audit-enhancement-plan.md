# Audit Logging — Enhancement Plan (Corrected)

**Status:** Done  
**Branch:** `0.0.41`  
**Date:** 2026-10-07  
**Based on:** All phases P1 (chain-hash), P2 (off-device shipping), P3 (rate limiting) completed and verified

---

## Background

An earlier audit (2026-10-03) claimed four critical gaps. Those claims were based on
grep commands that missed child-module files and had path-quoting issues. After
re-verification with correct file paths:

**All four "critical" gaps were already closed:**
- ✅ Stock adjustments (`adjust.rs`, `batch.rs`) — audited with `stock.adjust`
- ✅ Product CRUD (`products_crud.rs`) — audited with `product.create/update/delete`
- ✅ Settings changes (`kasirmu-bridge/settings/core.rs`) — audited with `setting.change`
- ✅ Catalog entries (`auditCatalog.ts`) — all actions mapped with Fluent labels

**The three real gaps are enhancements, not compliance fixes:**

---

## P1 — Tamper Detection (Chain-Hash) (Completed — `05d307ebb`)

**Why:** The audit log has no integrity mechanism. A compromised process or raw
filesystem edit can modify rows without detection. The DELETE/UPDATE triggers are
SQLite-level guards but don't protect against direct page edits or a process that opens
the DB with `PRAGMA ignore_check_constraints`.

**Status:** ✅ Completed and verified in commit `05d307ebb`.
- Added migration `crates/kasirmu-core/migrations/20261019_audit_chain_hash.sql` adding `previous_hash TEXT` and `hash TEXT NOT NULL DEFAULT ''` to `audit_log`.
- Regenerated `crates/kasirmu-core/migrations/20260813_init.pg.sql`.
- Added `compute_audit_entry_hash()` and `AuditChainVerificationResult` in `crates/kasirmu-core/src/db/audit.rs`.
- `insert_audit()` reads latest `hash != ''` and computes chained SHA-256 hash before inserting.
- Implemented `Store::verify_audit_chain()` walking the chronological chain and validating previous_hash continuity + hash integrity.
- Full unit tests in `crates/kasirmu-core/src/db/audit_tests.rs` covering hashing, field tampering detection, deletion/discontinuity detection, and grandfathered legacy rows.

**Design:**
1. **Schema migration** — Add `hash TEXT NOT NULL DEFAULT ''` and `previous_hash TEXT` to `audit_log`
2. **Hash on INSERT** — `SHA-256(previous_entry_hash || entry_fields)` computed in `insert_audit()` before every write
3. **Verification daemon / method** — `verify_audit_chain()` walks the chain, verifying continuity and integrity
4. **Existing rows** — Grandfathered with empty hash; the verifier starts from the first hashed row

**Migration SQL:**
```sql
ALTER TABLE audit_log ADD COLUMN previous_hash TEXT;
ALTER TABLE audit_log ADD COLUMN hash TEXT NOT NULL DEFAULT '';
```

**Key constraint:** The hash computation must happen inside `insert_audit()` BEFORE the
INSERT. Since `insert_audit()` is called from both `log_audit` and `log_audit_in_tx`,
the hash is computed in the shared body. The last row's hash is read via
`SELECT hash FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 1`.

**Files changed:**
- `crates/kasirmu-core/migrations/20261003_audit_chain_hash.sql` — new migration
- `crates/kasirmu-core/migrations/20260813_init.pg.sql` — regenerate with new columns
- `crates/kasirmu-core/src/db/audit.rs` — hash computation in `insert_audit()`
- `crates/kasirmu-core/src/db/audit.rs` — `verify_audit_chain()` method
- `crates/kasirmu-core/src/db/audit_tests.rs` — chain integrity tests
- `apps/mobile-tauri/src/lib.rs` or `platform-startup` — periodic verification daemon

**Budget:** 10–15 rounds

---

## P2 — Off-Device Audit Log Shipping (Completed)

**Why:** Audit entries live only on the local SQLite DB. If the tablet is lost,
stolen, or the DB corrupts, all audit data is gone. No off-device forensic copy exists.

**Status:** ✅ Completed and verified.
- Added `AUDIT_SHIP_ACTION = "audit.ship"` and `AuditShipPayload` with chain hash preservation in `crates/kasirmu-core/src/db/audit.rs`.
- `insert_audit()` invokes `enqueue_audit_for_sync()` best-effort into `offline_queue` with `SyncPriority::Low`.
- Atomic with transactional writes (`log_audit` and `log_audit_in_tx`) so rolled back audit entries roll back queue items.
- Resilient: failure to enqueue (e.g. missing offline_queue table) logs a warning and never fails the audit write.
- Unit tests in `crates/kasirmu-core/src/db/audit_tests.rs`.

**Implementation in `insert_audit()`:**
```rust
fn insert_audit(conn: &rusqlite::Connection, entry: &AuditEntry) -> Result<(), CoreError> {
    let details = sanitize_details(&entry.details);
    
    // Compute chain hash
    let (hash, previous_hash) = compute_chain_hash(conn, entry)?;
    
    conn.execute(
        "INSERT INTO audit_log (...) VALUES (...)",
        rusqlite::params![..., hash, previous_hash],
    )?;
    
    // Best-effort off-device shipping
    if conn.is_autocommit() {
        if let Err(e) = enqueue_audit_for_sync(conn, entry) {
            tracing::warn!(error = %e, "failed to enqueue audit entry for off-device shipping");
        }
    }
    
    Ok(())
}
```

**The catch:** `insert_audit()` takes a `&Connection`, not a `&Store`. The
`enqueue_offline_scoped` method needs a `Store`. Two options:
- Option A: Thread a `Store` or connection through to `insert_audit` (invasive)
- Option B: Do the enqueue at the `log_audit()` / `log_audit_in_tx()` level, not in
  the shared body (less invasive but two callers to maintain)

**Recommendation:** Option B — enqueue at the `log_audit()` level. The shared
`insert_audit()` stays pure INSERT logic; the caller (`log_audit`) adds the sync
enqueue as a best-effort side effect.

**Server-side:** Out of scope for this plan. The server needs a `POST /sync/audit`
endpoint that batch-receives shipped entries and appends them to its own `audit_log`.
The sync infrastructure already handles retries, idempotency, and conflict resolution.

**Files changed:**
- `crates/kasirmu-core/src/db/audit.rs` — add enqueue after successful insert
- `crates/kasirmu-core/src/db/offline.rs` or `offline/` — add `audit.ship` support
- `crates/kasirmu-core/src/db/audit_tests.rs` — test shipping enqueue
- Server-side: separate plan

**Budget:** 8–12 rounds (tablet side only)

---

## P3 — Rate Limiting on Audit Writes (Completed — `fca61fc4c`)

**Why:** No circuit breaker exists. A runaway process or bug could fill the disk with
audit entries at thousands per second.

**Status:** ✅ Completed and verified in commit `fca61fc4c`.
- Added `AUDIT_RATE_LIMIT = 1000`, `AUDIT_WINDOW_SECS = 60`, `check_audit_rate_limit()` in `crates/kasirmu-core/src/db/audit.rs`.
- Added `CoreError::RateLimited(String)` and `CoreErrorKind::RateLimited` in `crates/kasirmu-core/src/error.rs`.
- `insert_audit()` checks limit before INSERT; logs warning and drops entry without erroring callers.
- Full unit test coverage in `crates/kasirmu-core/src/db/audit_tests.rs` and `error_tests.rs`.

**Design:** In-memory atomic sliding window at `insert_audit()`. Non-fatal: when the
limit is hit, warn + skip the entry, but never fail the caller's operation.

```rust
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

const AUDIT_RATE_LIMIT: u64 = 1000;  // max entries per 60-second window
const AUDIT_WINDOW_SECS: u64 = 60;

fn check_audit_rate_limit() -> Result<(), CoreError> {
    static COUNT: AtomicU64 = AtomicU64::new(0);
    static WINDOW_START: AtomicU64 = AtomicU64::new(0);
    
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    
    let window_start = WINDOW_START.load(Ordering::Relaxed);
    if now - window_start >= AUDIT_WINDOW_SECS {
        WINDOW_START.store(now, Ordering::Relaxed);
        COUNT.store(1, Ordering::Relaxed);
        return Ok(());
    }
    
    let count = COUNT.fetch_add(1, Ordering::Relaxed);
    if count >= AUDIT_RATE_LIMIT {
        return Err(CoreError::RateLimited("audit write rate exceeded".into()));
    }
    Ok(())
}
```

**Rate limited behavior:** In `insert_audit()`, the rate limit is checked BEFORE the
INSERT. If exceeded, `log_audit()` returns `Ok(())` with a warning — the caller's
operation is never affected by a rate-limited audit slot.

**Resets on app restart** — the atomic counters are in-memory. If the app restarts,
the window resets. This is acceptable because a disk-fill scenario stops with the
app; on restart, the fresh window lets normal operations through.

**Files changed:**
- `crates/kasirmu-core/src/db/audit.rs` — add rate limit check
- `crates/kasirmu-core/src/error.rs` — add `RateLimited` variant
- `crates/kasirmu-core/src/db/audit_tests.rs` — rate limit tests

**Budget:** 3–5 rounds

---

## Order of execution

```
P1. Chain-hash ──► P2. Off-device shipping ──► P3. Rate limiting
(10-15r)           (8-12r)                      (3-5r)
```

**Rationale:** P1 (chain-hash) and P3 (rate limit) touch the same `insert_audit()`
function. Doing P1 first and P3 second means P3 integrates cleanly into the new hash
code rather than competing with it. P2 (off-device shipping) is independent and can
run after P1.

**Total estimate:** 21–32 rounds across all 3 items.

---

## Acceptance criteria

| Gate | Command |
|---|---|
| Rust backend | `cargo check -p kasirmu-core -p kasirmu-bridge` |
| Rust tests | `cargo test -p kasirmu-core` (audit tests) |
| TypeScript | `cd ui && npm run typecheck && npm run lint` |
| Bundle parity | `python3 scripts/verify-bundle-parity.py` |
