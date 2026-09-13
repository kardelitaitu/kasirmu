# Phase 0d — `setting_updated` Delta Ledger + `write_setting_delta` IPC

- **Status:** IMPLEMENTED (ADR #22 unified workspace settings shipped in 0.0.19; re-audited 2026-08-08 by docs-auditor)
- **Phase:** 0d of 11 (Workspace Settings Architecture — ADR #22)
- **Parent:** `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md`
- **Severity:** PREREQUISITE (blocks Phase 2)
- **Owner:** TBD
- **Est. effort:** 3-5 days (largest single refactor in the ADR)

## Summary

Add a `setting_updated` SQLite table with per-key LWW version tracking and a `write_setting_delta` IPC command. Instrument all ~50 existing `Settings::set_*` methods in `platform/core/src/settings.rs` to also write a delta row with the changed key, new value, terminal ID, timestamp, and monotonically incrementing per-key version. This enables the concurrent-edit conflict detection (edge case #8) and the `settings_updated` event used by `SettingsContext` (Phase 0b).

## Baseline (pre-fix)

- `platform/core/src/settings.rs`: `Settings` struct with raw `get`/`set`/`set_batch`/`load_all` on a flat `settings` table (`key TEXT PRIMARY KEY, value TEXT`)
- ~50 typed helpers (`set_store_name`, `set_receipt_footer`, `set_brand_primary_colour`, `set_credit_enabled`, etc.) that call `Settings::set()` directly — none write a delta record
- No `setting_updated` table exists
- No `write_setting_delta` IPC command exists

## SQLite Migration

```sql
CREATE TABLE IF NOT EXISTS setting_updated (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    terminal_id TEXT NOT NULL DEFAULT 'unknown',
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_setting_updated_key_version
    ON setting_updated(key, version DESC);

CREATE INDEX IF NOT EXISTS idx_setting_updated_terminal
    ON setting_updated(terminal_id, created_at DESC);
```

**Version strategy — per-key counter:**
```sql
SELECT COALESCE(MAX(version), 0) + 1
FROM setting_updated
WHERE key = ? AND terminal_id = ?
```

## Acceptance criteria

### Delta ledger table
- [ ] New migration `crates/oz-core/migrations/XXX_setting_updated.sql` creates the table and indexes
- [ ] Migration conditionally creates table with `IF NOT EXISTS`
- [ ] Registered in `migrations.rs`
- [ ] `version` is per `(key, terminal_id)` pair (not global) — per-key counter via `MAX(version) + 1`

### `write_setting_delta` function
- [ ] `Settings::write_delta(conn, key, value, terminal_id) -> Result<(), PlatformError>`
- [ ] Computes `version = MAX(version) + 1` for the `(key, terminal_id)` pair
- [ ] Inserts a row into `setting_updated`
- [ ] All operations run inside the caller's transaction (no implicit transaction)
- [ ] Unit test: version increments correctly per key (2 writes to `receipt.footer` → versions 1, 2)
- [ ] Unit test: different keys track separate versions (write `store.name` v1, `receipt.footer` v1 — both version 1)

### Instrumentation of existing setters
- [ ] **All ~50 `Settings::set_*` methods** call `write_setting_delta` after their existing `Settings::set()` call
- [ ] Terminal ID passed through from the Tauri command layer (stored in `session.terminal_id` or app config)
- [ ] Delta write is best-effort: if it fails, the error is logged but the main `set()` is not rolled back (delta loss is non-fatal; the sync layer can reconstruct from the settings table)
- [ ] Transactional consistency: the `set()` and `write_delta()` share the same `rusqlite::Transaction`

### `get_setting_version` accessor
- [ ] `Settings::get_version(conn, key, terminal_id) -> Result<Option<i64>, PlatformError>`
- [ ] Returns the latest `version` for a `(key, terminal_id)` pair — used by shared cards to detect concurrent edits (edge case #8)
- [ ] Returns `None` if no deltas exist for that key/terminal pair

## Plan

1. Create migration: `crates/oz-core/migrations/XXX_setting_updated.sql`
2. Register migration in `crates/oz-core/src/db/migrations.rs`
3. Add `write_delta()` and `get_version()` methods to `Settings` struct in `platform/core/src/settings.rs`
4. Instrument `Settings::set()` (the raw method) to call `write_delta()` — catches ALL typed helpers automatically
   - **Better approach**: Instrument the base `Settings::set()` method itself. Since all ~50 typed helpers call `Settings::set()`, adding the delta write there covers everything with a single code change. However, `Settings::set()` doesn't have access to `terminal_id`. Two options:
     - (A) Add `terminal_id: Option<&str>` parameter to `Settings::set()`. Simple but requires updating all 50 call sites.
     - (B) Add `Settings::set_with_terminal(conn, key, value, terminal_id)` and keep `set()` unchanged. Typed helpers that know the terminal ID call `set_with_terminal`; legacy callers use `set()`. Phase 0d does (A) — update all call sites.
5. Add `get_version()` method for concurrent-edit detection
6. Write unit tests for version tracking and concurrent-edit scenario
7. Update Tauri command layer to pass `terminal_id` to `Settings::set_*` calls

## Verification

| Check | Expected |
|-------|----------|
| `cargo build --workspace --lib` | exit 0 |
| `cargo clippy --workspace --lib -- -D warnings` | 0 warnings |
| `cargo test -p oz-core -- settings` | all passing |
| `cargo test --workspace --lib` | all passing |
| Unit: `write_delta` → version increments | v1, v2, v3 per key |
| Unit: `get_version` for missing key | `None` |
| Unit: concurrent edit detection | write v1 on terminal A → write v2 on terminal B → terminal A checks version → sees v2 (stale) |
| Manual: `SELECT COUNT(*) FROM setting_updated` after full save from SettingsPage | rows present for every changed setting |

## Residual / follow-ups

- Delta ledger is write-only during Phases 1–5 — the sync layer reads it in a future phase
- Delta row cleanup/pruning is not implemented here (rows accumulate indefinitely until a retention policy is added)
- The `settings_updated` event (Phase 0e) reads the latest delta to populate `changed_keys` — this spec provides the data source

## References

- `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md` §Pillar D, §Edge Case #8, §Phase 0d
- `platform/core/src/settings.rs`
- `crates/oz-core/migrations/` (existing migration pattern)

> (status corrected to IMPLEMENTED).
>
> last audited 08-08-26 by docs-auditor
