# Phase 0e — Async Event Bus Handler Support

- **Status:** IMPLEMENTED (ADR #22 unified workspace settings shipped in 0.0.19; re-audited 2026-08-08 by docs-auditor)
- **Phase:** 0e of 11 (Workspace Settings Architecture — ADR #22)
- **Parent:** `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md`
- **Severity:** PREREQUISITE (blocks Phase 3)
- **Owner:** TBD
- **Est. effort:** 1-2 days

## Summary

The current `EventBus` in `platform/kernel/src/event_bus.rs` dispatches handlers **synchronously** — the publisher blocks until every handler completes. The `settings_updated` handler must perform an IPC round-trip (Tauri `invoke()`) to refetch settings, which would freeze the UI thread for the duration of the SQLite read + IPC call. Phase 0e ensures `settings_updated` handlers run non-blocking.

## Baseline (pre-fix)

- `platform/kernel/src/event_bus.rs` line 7-8: "Handlers are dispatched synchronously — the publisher blocks until all handlers have run."
- `EventBus::publish()` iterates over handlers and calls each one inline on the publishing thread
- No `publish_async` API exists
- Tauri IPC bridge is not yet wired to the event bus (no frontend subscriber exists)

## Acceptance criteria

### Non-blocking handler dispatch
- [ ] `settings_updated` handler body spawns a non-blocking task via `tokio::spawn` or equivalent
- [ ] The backend `Settings::set_*` call that publishes `settings_updated` returns immediately — does not wait for UI refetch
- [ ] Integration test: publish `settings_updated` → measure time to `publish()` return → < 5ms regardless of handler duration

### Implementation approach (chosen: handler-side spawn)

**Option A — Handler wraps itself in `tokio::spawn`:**
```rust
bus.subscribe("settings_updated", move |event| {
    let settings = settings.clone();
    tokio::spawn(async move {
        settings.refetch_from_event(event).await;
    });
});
```
Simplest change. No API changes to `EventBus`. The handler itself is responsible for non-blocking behavior.

### Tauri IPC bridge
- [ ] Frontend `SettingsContext` (Phase 0b) registers a Tauri event listener for `settings_updated`
- [ ] Backend publishes `settings_updated` event to the bus after every `Settings::set_*` call
- [ ] The event payload includes `changed_keys: Vec<String>` and `terminal_id: String` (from Phase 0d delta ledger)
- [ ] Event is published after the SQLite transaction commits (not inside it — the handler shouldn't read uncommitted data)

### Performance validation
- [ ] Timing test: `publish()` returns < 5ms even with a handler that simulates a 200ms IPC round-trip
- [ ] No blocking on the main thread when settings are saved from the UI

## Plan

1. Add `tokio` as dependency to the settings module if not already present
2. In the module that publishes `settings_updated`, wrap the handler body in `tokio::spawn`
3. Wire the Tauri IPC event emission: after `Settings::set_*` commits the transaction, publish `settings_updated` with `changed_keys` and `terminal_id`
4. Add integration test: measure `publish()` return time with a slow handler
5. Add integration test: verify handler runs and completes even after `publish()` returns

## Verification

| Check | Expected |
|-------|----------|
| `cargo build --workspace --lib` | exit 0 |
| `cargo clippy --workspace --lib -- -D warnings` | 0 warnings |
| `cargo test -p platform-kernel` | all passing (existing EventBus tests) |
| Integration test: `publish()` with 200ms handler → returns < 5ms | Pass |
| Integration test: handler completes after `publish()` returns | Pass |
| Manual: save settings from UI → UI remains responsive during save | Pass |

## Residual / follow-ups

- A `publish_async` API on `EventBus` itself (spawning handlers automatically) could be added in a future refactor, but handler-side spawn is simpler and sufficient
- WebSocket-based event push for cloud-connected terminals is a separate future feature

## References

- `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md` §Pillar C, §Phase 0e
- `platform/kernel/src/event_bus.rs`
- `platform/core/src/settings.rs`
- ADR #2 (`docs/decisions/2026-02-01-event-bus-design.md`)

> (status corrected to IMPLEMENTED).
>
> last audited 08-08-26 by docs-auditor
