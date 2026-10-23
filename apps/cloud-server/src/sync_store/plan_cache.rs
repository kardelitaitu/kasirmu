//! Short-TTL, capacity-bounded per-tenant cache in front of
//! `SyncStore::get_tenant_plan` (debt entry O-H09).
//!
//! `plan_middleware` reads a tenant's plan on EVERY `/api/sync/*` request, and the
//! Postgres arm of `get_tenant_plan` spends four round trips on that read (pool
//! checkout -> transaction -> `set_config('oz.tenant_id', ...)` -> `SELECT plan ...`),
//! none of them cached. At 200+ terminals heartbeating `/api/sync/status` that is
//! a constant background query load for a value that changes roughly never.
//!
//! # What is cached, and what is not
//!
//! The cache stores a `Result<Option<TenantPlan>, String>`, so the distinction the
//! gate depends on survives the round trip:
//!
//! - `Ok(Some(plan))` -- the tenant has a plan row.
//! - `Ok(None)` -- the tenant has NO row. This is a real, successful answer
//!   ("unassigned, therefore free") and MUST be cacheable; if `None` were treated
//!   as a miss, every free tenant would re-query the database on every request
//!   forever, which is the exact cost this module exists to remove.
//! - `Err(_)` -- the read failed. Never cached: an error is the absence of an
//!   answer, not an answer, and caching it would turn a transient pool hiccup into
//!   a TTL-long outage. The caller (`plan_middleware`) still turns it into a 500.
//!
//! Nothing here can make a request pass that would have been refused: a cache hit
//! returns a value a successful read produced, a miss performs that read, and an
//! error from either path is returned as `Err` for the middleware to reject. There
//! is no "stale-while-error" arm and no default on failure.
//!
//! # Bounds
//!
//! - TTL: [`PLAN_CACHE_TTL`] (5s), checked on every read.
//! - Capacity: [`MAX_CACHED_TENANTS`] entries, evicted nearest-expiry-first, in
//!   the house style of `kasirmu_core::rate_limiter::DEFAULT_MAX_TRACKED_USERNAMES`.
//!
//! # Locking
//!
//! The map is a `std::sync::Mutex` and the guard is NEVER held across an `await`:
//! [`PlanCache::get_or_load`] takes the lock, answers or drops the guard, awaits
//! the loader outside it, then takes the lock once more to insert. Two concurrent
//! misses on the same tenant both load (no single-flight); that is intentional --
//! both reads return the same answer and the second insert simply overwrites the
//! first, so the worst case is one redundant query per cold-start burst, not a
//! correctness problem.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use kasirmu_core::TenantPlan;

/// How long one tenant's plan answer is trusted before the database is read again.
///
/// 5 seconds, deliberately below the 60s a "cache it for a minute" instinct
/// suggests. The plan gate is security-adjacent: the TTL is the window in which a
/// tenant downgraded off `pro` can keep reaching `/api/sync/*` while the database
/// already says `free`. Five seconds bounds that window to about one client
/// retry, while still collapsing a heartbeat burst -- a terminal polling every few
/// seconds, times every terminal on the same tenant -- into a single read. A
/// minute-long TTL would buy nothing measurable (the read is already gone from
/// the hot path) and would multiply the exposure window twelvefold.
///
/// The direction of the staleness is what makes the short TTL affordable: an
/// UPGRADE (free -> pro) waits at most this long before it works, and a DOWNGRADE
/// takes effect at most this long after the operator asked for it.
pub const PLAN_CACHE_TTL: Duration = Duration::from_secs(5);

/// Maximum number of tenants cached at once.
///
/// Same house pattern and the same ceiling as
/// `kasirmu_core::rate_limiter::DEFAULT_MAX_TRACKED_USERNAMES` (10,000): the cap
/// exists so that unbounded tenant growth -- or a stream of distinct tenant ids --
/// cannot grow this map without limit over the process lifetime. Each entry holds
/// one `String` id and a `Copy` plan, so the ceiling is a few hundred kilobytes,
/// comfortably above any realistic tenant count and small enough to be harmless.
pub const MAX_CACHED_TENANTS: usize = 10_000;

/// The result of one tenant-plan read, cached verbatim.
///
/// `Err` is representable only so the type matches what
/// [`SyncStore::get_tenant_plan`](super::SyncStore::get_tenant_plan) returns at the
/// call site; [`PlanCache::get_or_load`] never STORES one (see the module docs).
pub type PlanLookup = Result<Option<TenantPlan>, String>;

/// One cached answer: when it was loaded, and what the read said.
#[derive(Debug, Clone, Copy)]
struct Entry {
    /// Load time, compared against [`PLAN_CACHE_TTL`] on every read.
    loaded_at: Instant,
    /// The successful answer. `None` is a real answer (no plan row), not a miss.
    plan: Option<TenantPlan>,
}

/// Short-TTL, capacity-bounded per-tenant plan cache.
///
/// Cheap to share through an `Arc`; holds no I/O and no runtime handle, so it can
/// live on the sync router as an axum extension like the store it fronts.
#[derive(Debug)]
pub struct PlanCache {
    /// tenant_id -> last successful answer. Guard never held across an `await`.
    entries: Mutex<HashMap<String, Entry>>,
    /// How long an entry is trusted.
    ttl: Duration,
    /// Capacity ceiling, enforced before each insert.
    max_entries: usize,
}

impl Default for PlanCache {
    /// Production defaults: [`PLAN_CACHE_TTL`] and [`MAX_CACHED_TENANTS`].
    fn default() -> Self {
        Self::new(PLAN_CACHE_TTL, MAX_CACHED_TENANTS)
    }
}

impl PlanCache {
    /// Build a cache with an explicit TTL and capacity ceiling.
    ///
    /// Explicit values are for tests (a zero TTL proves expiry, a capacity of 1
    /// proves eviction); production code uses [`PlanCache::default`].
    #[must_use]
    pub fn new(ttl: Duration, max_entries: usize) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            ttl,
            max_entries: max_entries.max(1),
        }
    }

    /// Return the cached plan for `tenant_id`, loading it through `load` on a miss.
    ///
    /// A hit inside the TTL returns immediately without touching `load`, including
    /// a cached `Ok(None)`. A miss awaits `load` with no lock held and caches the
    /// answer only when it is `Ok`; an `Err` is returned to the caller uncached, so
    /// the next request retries the database instead of inheriting the failure.
    ///
    /// The error path is preserved verbatim from `plan_middleware`: this function
    /// never converts an `Err` into `Ok(None)`. `None` gates the request as `free`
    /// (403) and an error is a 500, so collapsing the two would silently change the
    /// status the gate returns for a broken database.
    pub async fn get_or_load<F, Fut>(&self, tenant_id: &str, load: F) -> PlanLookup
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = PlanLookup>,
    {
        if let Some(plan) = self.cached(tenant_id) {
            return Ok(plan);
        }

        // No guard is live here: `cached` released it before returning.
        let looked_up = load().await;

        if let Ok(plan) = looked_up {
            self.insert(tenant_id, plan);
        }

        looked_up
    }

    /// Read one entry, treating an expired one as absent.
    ///
    /// Takes and releases the lock inside the call, so the caller may safely
    /// await afterwards. An expired entry is removed rather than left to be
    /// re-checked, so it cannot outlive its value in memory.
    fn cached(&self, tenant_id: &str) -> Option<Option<TenantPlan>> {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        let fresh = entries
            .get(tenant_id)
            .filter(|entry| entry.loaded_at.elapsed() < self.ttl)
            .map(|entry| entry.plan);

        if fresh.is_none() {
            entries.remove(tenant_id);
        }

        fresh
    }

    /// Store one successful answer, evicting first if the cache is full.
    fn insert(&self, tenant_id: &str, plan: Option<TenantPlan>) {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        // Dead entries cost nothing to drop and free a slot before the cap check,
        // so a burst of one-shot tenant ids does not evict a live neighbour while
        // its own expired entries sit in the map.
        let ttl = self.ttl;
        entries.retain(|_, entry| entry.loaded_at.elapsed() < ttl);

        // Capacity ceiling: evict the entry closest to expiry (its remaining
        // usefulness is the smallest), which never discards a just-loaded entry
        // in favour of a nearly-expired one.
        if !entries.contains_key(tenant_id) && entries.len() >= self.max_entries {
            let victim = entries
                .iter()
                .min_by_key(|(_, entry)| entry.loaded_at)
                .map(|(id, _)| id.clone());
            if let Some(victim) = victim {
                entries.remove(&victim);
            }
        }

        entries.insert(
            tenant_id.to_string(),
            Entry {
                loaded_at: Instant::now(),
                plan,
            },
        );
    }

    /// Number of entries currently held, expired ones included.
    ///
    /// Exposed so the capacity ceiling can be asserted in a test rather than
    /// merely described, the way `LoginRateLimiter::tracked_usernames` does.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len()
    }

    /// Whether the cache currently holds no entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
#[path = "plan_cache_tests.rs"]
mod tests;
