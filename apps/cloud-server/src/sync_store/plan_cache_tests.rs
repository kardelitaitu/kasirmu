//! Tests for the per-tenant plan cache (debt entry O-H09).
//!
//! The cache is exercised through `get_or_load` with a COUNTING loader closure,
//! which is what proves the property that matters: a second call inside the TTL
//! does not reach the store. Every test uses an explicit TTL (`ZERO_TTL` or a
//! short one) so expiry is deterministic rather than a sleep race.

use super::*;

/// A TTL that has already elapsed by the time it is checked.
const ZERO_TTL: Duration = Duration::from_millis(0);

/// A TTL comfortably longer than the gaps the tests below leave between calls,
/// so a live entry is never expired by accident.
const ONE_HOUR: Duration = Duration::from_secs(3600);

/// The production TTL stays a SHORT one.
///
/// The gate is security-adjacent: the TTL is exactly how long a tenant
/// downgraded off `pro` can keep syncing. Raising it is a decision someone has
/// to make on purpose, so this asserts the documented ceiling rather than
/// letting the constant drift.
#[test]
fn production_ttl_stays_under_a_minute() {
    assert!(
        PLAN_CACHE_TTL <= Duration::from_secs(60),
        "a plan-gate TTL above 60s widens the downgrade window for no measurable gain"
    );
    assert!(
        !PLAN_CACHE_TTL.is_zero(),
        "a zero TTL is the test-only shape; production must actually cache"
    );
}

// -- The property O-H09 exists for ------------------------------------------

/// A second call inside the TTL must NOT re-hit the store.
///
/// This is the acceptance test for O-H09: before the cache, every
/// `/api/sync/*` request ran `get_tenant_plan` and the Postgres arm spent
/// four round trips on it.
#[tokio::test]
async fn second_call_within_ttl_does_not_reload() {
    let cache = PlanCache::new(ONE_HOUR, MAX_CACHED_TENANTS);
    let loads = std::sync::atomic::AtomicUsize::new(0);

    let load = || async {
        loads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(Some(TenantPlan::Pro))
    };

    assert_eq!(
        cache.get_or_load("tenant-a", load).await,
        Ok(Some(TenantPlan::Pro))
    );
    assert_eq!(loads.load(std::sync::atomic::Ordering::SeqCst), 1);

    assert_eq!(
        cache.get_or_load("tenant-a", load).await,
        Ok(Some(TenantPlan::Pro))
    );
    assert_eq!(
        cache.get_or_load("tenant-a", load).await,
        Ok(Some(TenantPlan::Pro))
    );
    assert_eq!(
        loads.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "two further calls inside the TTL must be served from the cache"
    );
}

/// An EXPIRED entry must be reloaded.
#[tokio::test]
async fn expired_entry_is_reloaded() {
    let cache = PlanCache::new(ZERO_TTL, MAX_CACHED_TENANTS);
    let loads = std::sync::atomic::AtomicUsize::new(0);

    let load = || async {
        loads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(Some(TenantPlan::Pro))
    };

    assert_eq!(
        cache.get_or_load("tenant-a", load).await,
        Ok(Some(TenantPlan::Pro))
    );
    assert_eq!(
        cache.get_or_load("tenant-a", load).await,
        Ok(Some(TenantPlan::Pro))
    );
    assert_eq!(
        loads.load(std::sync::atomic::Ordering::SeqCst),
        2,
        "a zero-TTL entry must never be served twice"
    );
}

/// The TTL is checked on READ: a value that changes behind the cache is picked
/// up once the entry expires, never before.
#[tokio::test]
async fn ttl_expiry_observes_a_changed_plan() {
    let cache = PlanCache::new(Duration::from_millis(20), MAX_CACHED_TENANTS);

    assert_eq!(
        cache
            .get_or_load("tenant-a", || async { Ok(Some(TenantPlan::Pro)) })
            .await,
        Ok(Some(TenantPlan::Pro))
    );
    // Still inside the TTL: the cache says pro even though the store now says free.
    assert_eq!(
        cache
            .get_or_load("tenant-a", || async { Ok(Some(TenantPlan::Free)) })
            .await,
        Ok(Some(TenantPlan::Pro)),
        "a live entry must not be re-read"
    );

    tokio::time::sleep(Duration::from_millis(40)).await;

    assert_eq!(
        cache
            .get_or_load("tenant-a", || async { Ok(Some(TenantPlan::Free)) })
            .await,
        Ok(Some(TenantPlan::Free)),
        "after expiry the changed plan must be visible"
    );
}

// -- None is a cacheable answer, errors are not -----------------------------

/// A tenant with NO plan row (`Ok(None)`) is cached like any other answer.
///
/// Without this, every free tenant re-queries forever, which is the failure
/// mode that would make the cache useless for the majority of tenants.
#[tokio::test]
async fn successful_none_is_cached() {
    let cache = PlanCache::new(ONE_HOUR, MAX_CACHED_TENANTS);
    let loads = std::sync::atomic::AtomicUsize::new(0);

    let load = || async {
        loads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(None)
    };

    assert_eq!(cache.get_or_load("tenant-free", load).await, Ok(None));
    assert_eq!(cache.get_or_load("tenant-free", load).await, Ok(None));
    assert_eq!(
        loads.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "a cached no-plan-row is an answer, not a miss"
    );
}

/// An ERROR is returned unchanged and NEVER cached: the next call reloads.
///
/// This is the fail-closed half of the gate. `plan_middleware` turns `Err` into
/// a 500, so the cache must neither swallow it into `Ok(None)` (403) nor store
/// it and keep answering 500 for the whole TTL after the database recovers.
#[tokio::test]
async fn error_is_passed_through_and_not_cached() {
    let cache = PlanCache::new(ONE_HOUR, MAX_CACHED_TENANTS);
    let loads = std::sync::atomic::AtomicUsize::new(0);

    let failing = || async {
        loads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Err(String::from("pool exhausted"))
    };

    assert_eq!(
        cache.get_or_load("tenant-a", failing).await,
        Err(String::from("pool exhausted")),
        "the error must reach the caller verbatim, never as Ok(None)"
    );
    assert!(
        cache.is_empty(),
        "a failed read must not populate the cache"
    );

    assert_eq!(
        cache.get_or_load("tenant-a", failing).await,
        Err(String::from("pool exhausted"))
    );
    assert_eq!(
        loads.load(std::sync::atomic::Ordering::SeqCst),
        2,
        "the second call must retry the store, not replay a cached error"
    );

    // And a recovered store is believed immediately.
    assert_eq!(
        cache
            .get_or_load("tenant-a", || async { Ok(Some(TenantPlan::Pro)) })
            .await,
        Ok(Some(TenantPlan::Pro))
    );
}

// -- Keying and bounds ------------------------------------------------------

/// The key is `tenant_id`: one tenant's answer never serves another.
#[tokio::test]
async fn entries_are_keyed_by_tenant_id() {
    let cache = PlanCache::new(ONE_HOUR, MAX_CACHED_TENANTS);

    assert_eq!(
        cache
            .get_or_load("tenant-a", || async { Ok(Some(TenantPlan::Pro)) })
            .await,
        Ok(Some(TenantPlan::Pro))
    );
    assert_eq!(
        cache.get_or_load("tenant-b", || async { Ok(None) }).await,
        Ok(None),
        "tenant-b has no row and must not inherit the pro plan of tenant-a"
    );
    assert_eq!(cache.len(), 2);
}

/// The capacity ceiling evicts instead of growing without bound.
#[tokio::test]
async fn capacity_ceiling_evicts_and_never_exceeds_the_cap() {
    let cache = PlanCache::new(ONE_HOUR, 2);

    for tenant in ["t1", "t2", "t3", "t4", "t5"] {
        cache
            .get_or_load(tenant, || async { Ok(Some(TenantPlan::Pro)) })
            .await
            .expect("load succeeds");
        assert!(
            cache.len() <= 2,
            "the cache must never hold more than its cap (held {})",
            cache.len()
        );
    }
}

/// An error does not consume a slot: the cap counts cached ANSWERS only.
#[tokio::test]
async fn errors_do_not_occupy_capacity() {
    let cache = PlanCache::new(ONE_HOUR, 1);

    assert!(
        cache
            .get_or_load("t1", || async { Err(String::from("boom")) })
            .await
            .is_err()
    );
    assert!(cache.is_empty());

    cache
        .get_or_load("t2", || async { Ok(None) })
        .await
        .expect("load succeeds");
    assert_eq!(cache.len(), 1);
}

// -- The wiring the middleware depends on -----------------------------------

/// `plan_middleware` must go through the cache, and must keep mapping a
/// cache or DB error to a 500.
///
/// Asserted on the SOURCE for the first half, because "does not call the store"
/// is the absence of a call: no runtime value can distinguish a cached answer
/// from an identical uncached one. The error-path half is asserted on the same
/// slice so a future edit cannot re-introduce a fail-open default.
#[test]
fn plan_middleware_reads_through_the_cache() {
    // Comment lines are stripped first: the function explains IN PROSE why it no
    // longer calls the store directly, and a raw slice would count that sentence
    // as the call the last assertion forbids.
    let src = include_str!("../sync_api.rs");
    let middleware = src
        .split("pub async fn plan_middleware(")
        .nth(1)
        .expect("plan_middleware must exist in sync_api.rs");
    // Cut the slice at the end of the function (a line closing the body with no
    // leading whitespace) so the assertion cannot be satisfied by a neighbouring
    // item that happens to use the cache.
    let raw = middleware
        .split("\n}\n")
        .next()
        .expect("plan_middleware body must terminate");
    let body = raw
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");

    assert!(
        body.contains("get_or_load"),
        "plan_middleware must read the plan through PlanCache::get_or_load"
    );
    assert!(
        body.matches("get_tenant_plan(").count() == 1,
        "the store read must survive only as the cache loader argument: exactly one occurrence, inside get_or_load, is the whole point of O-H09"
    );
    assert!(
        body.contains("INTERNAL_SERVER_ERROR"),
        "a cache or DB error must still be a 500, never a pass-through or a 403"
    );
    // The hazard is an ERROR being defaulted into a plan, not the word
    // `unwrap_or` appearing at all. Two legitimate uses sit in this body:
    // `claims.tenant_id...unwrap_or("default")` (tenant resolution) and
    // `plan.unwrap_or(TenantPlan::Free)` on the SUCCESS arm — the latter is the
    // pre-existing gate rule that a successful read of "no plan row" is a 403,
    // which is fail-CLOSED, and rewriting it would change the semantics O-H09
    // was told not to touch.
    //
    // So the assertion targets the real fail-open shape: the cache result being
    // unwrapped in a way that swallows the Err before map_err can turn it into a
    // 500. That means a default landing between the `get_or_load(` call and its
    // `map_err` — not any default anywhere in the function.
    let after_cache = body.split("get_or_load").nth(1).unwrap_or("");
    let up_to_map_err = after_cache.split("map_err").next().unwrap_or("");
    assert!(
        !up_to_map_err.contains("unwrap_or"),
        "the plan must not be defaulted on an error path (fail-open): get_or_load's Err must reach map_err, never unwrap_or"
    );
    assert!(
        body.contains("map_err"),
        "the cache Err must be converted to a 500 by map_err"
    );
}
