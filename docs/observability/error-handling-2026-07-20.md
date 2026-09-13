# Error Handling Audit — 0.0.14

## P32-1: Production `unwrap()`/`expect()` Audit

### Finding: Production code is clean

- **Tauri commands** (`apps/desktop-client/src/commands/`): 191 `unwrap()` calls, **all in `#[cfg(test)]` blocks**. Production command functions use `Result<_, AppError>` with `?` propagation.
- **Cloud server** (`apps/cloud-server/src/`): **0** `.expect()` calls in `main.rs` — the file was refactored since this audit; DB init now propagates `Result` (startup-only fail-fast remains acceptable). Remaining `expect()`/`unwrap()` are test code.
- **Sync engine** (`platform/sync/src/`): 123 `unwrap()` calls, **all in tests**. Production functions use `Result` + `?`.

### Acceptable Production `expect()` Calls

> Updated 2026-08-08: the 0.0.14-era table referenced `main.rs:94/123/151/155`, but `main.rs` has since been refactored and contains **no** `expect()` calls. The pattern (startup-only fail-fast) remains valid where applied.

**Verdict:** ✅ Zero panics possible in production request-handling code paths.

## P32-2: User-Facing Error Codes

All Tauri commands return `Result<T, AppError>`. AppError maps to user-facing messages via Fluent i18n keys.

### Error Code Pattern

```rust
// commands return AppError which is serialized to the frontend
#[command]
pub async fn create_sale(...) -> Result<SaleResult, AppError> {
    // Internal errors use ? to propagate
    let cart = store.validate_cart(&input)?;  // maps to AppError::BadRequest
    ...
}
```

### Error Categories (existing)

> Updated 2026-08-08: the variants below are the **current** `AppError` enum in `apps/desktop-client/src/error.rs:20`. The 0.0.14-era table (`NotFound`/`BadRequest`/`Conflict`/`Internal`/`Unauthorized`/`RateLimited`) described an API that no longer exists.

| AppError variant | Frontend handling |
|-----------------|-------------------|
| `Core(#[from] oz_core::Error)` | Toast with message |
| `Hardware(#[from] oz_hal::HalError)` | Toast: hardware error |
| `Invalid(String)` | Toast with field message |
| `PermissionDenied(String)` | Permission-denied screen / toast |
| `InvalidSession` | Redirect to login / lock |
| `TopologyValidation(String)` | Topology editor validation toast |

**Verdict:** ✅ Error codes already mapped. No changes needed.

## P32-3: Retry with Backoff

### Existing Retry Patterns

| Component | Retry | Backoff | Jitter | Timeout |
|-----------|-------|---------|--------|---------|
| Sync engine (`platform/sync`) | 3 | Exponential (2^x seconds) | Yes (random 0-1s) | 30s total |
| Payment gateway retries | Configurable | Configurable | No | 30s |
| License check | 1 retry | Fixed 5s | No | 10s |
| nextest CI | 2 | Exponential | Yes | 120s |

### Recommendation

- Add jitter to payment gateway and license check retries — trivial change to add `+ rand::random::<f64>()` to delay
- ✅ Sync engine already has proper jitter

## P32-4: Graceful Degradation

### Offline-First Design (Verified)

The POS is designed for offline operation:

| Operation | Works offline? | Notes |
|-----------|---------------|-------|
| Cart (add/remove items) | ✅ | Pure in-memory + local DB |
| Product lookup | ✅ | Local SQLite cache |
| Shift open/close | ✅ | Queued for sync |
| Receipt printing | ✅ | Local ESC/POS driver |
| Payment processing | ⚠️ | Cash works; card/QRIS needs connectivity |
| Sync (push/pull) | ⚠️ | Queued locally, retried when online |
| License validation | ⚠️ | 14-day grace period after last check |

**Verdict:** ✅ Core POS operations work offline. Payment + sync gracefully degrade. License validation runs on a per-tier offline grace period (`SubscriptionTier::offline_grace_days()` in `crates/oz-core/src/subscription.rs` — Free 7 days, Plus/Pro 14, Premium 30, Enterprise custom; the 0.0.14-era flat "30-day" figure is stale).

### Already implemented in UI:
- `OfflineQueueScreen`: shows pending sync items
- `ConnectionStatus`: green/yellow/red indicator in status bar
- `useGatewayStatus` hook: monitors payment gateway connectivity

---

> last audited 08-08-26 by docs-auditor
