<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 major correction to the prior stamp) · THE PRIOR STAMP'S CENTRAL NEGATIVE WAS WRONG, AND THE CORRECT ANSWER IS STRONGER THAN IT CLAIMED. It reported 'WHAT IS NOT FOUND: the `Settings::write_delta` / `write_setting_delta` API the spec names, under any spelling'; it had searched `settings.rs` and `settings/mod.rs` and missed `settings/raw.rs`, into which the module was split. At HEAD: `Settings::write_delta(conn, key, value, terminal_id) -> Result<(), PlatformError>` exists with EXACTLY the specified signature at `platform/core/src/settings/raw.rs:172`; `Settings::get_version` (the spec's `get_setting_version`) at :295; the instrumentation doors `set_tracked` :473 and `set_tracked_in_tx` :521 write value + delta with a deliberately NON-FATAL delta failure (the spec's criterion); `next_delta_version` :263 implements `MAX(version)+1` with a `BEGIN IMMEDIATE` retry loop. The table is in the base schema, not a numbered migration: `setting_updated` at `crates/kasirmu-core/migrations/20260813_init.sql:624`, with the two spec'd indexes plus a UNIQUE `idx_setting_updated_unique_version` (:1256) the spec did not anticipate. Tests cover version increments, per-key and per-terminal independence, nesting, concurrent collisions and index use. WHAT THE PRIOR STAMP GOT RIGHT AND STILL MATTERS: the ledger covers only the tracked doors — `raw.rs:463-472` states that every typed setter (52 `set_*` helpers in `settings/typed.rs`, plus the bridge's receipt/store/credit saves) writes with NO delta row, and `get_version` has ZERO production callers as of 2026-09-12, so the concurrent-edit detection is implemented and tested but not yet consumed by any UI. A wiring gap, not a missing deliverable. Still stale and left as historical: `platform/core/src/settings.rs`, `crates/oz-core/migrations/XXX_setting_updated.sql`, `cargo test -p oz-core`. NOT re-measured: the runtime concurrent-writer behaviour (a test run). · Superseded 2026-09-29 body preserved below as plain quoted text (delimiters stripped so it cannot nest):

Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · MIXED, and reported with deliberate precision because the obvious conclusion is wrong. The `setting_updated` table is real — `crates/kasirmu-core/migrations/20260813_init.sql:624` and the PG mirror at `20260813_init.pg.sql:1552` — and it is ACTIVELY maintained, not vestigial: `crates/kasirmu-cli/src/commands/credential_deltas.rs` prunes rows from it, and a test there inserts rows with explicit `version` values. A unique-version index (`idx_setting_updated_unique_version`) is referenced in that file's own header, which is consistent with the per-key-counter design this spec describes. So the ledger exists and something writes to it. WHAT IS NOT FOUND: the `Settings::write_delta` / `write_setting_delta` API the spec names, under any spelling — a repo-wide search for `write_setting_delta` and `write_delta` returns nothing, and `platform/core/src/settings/mod.rs` exports no `set`/`write` method matching the spec's signature. I am explicitly NOT concluding "not implemented": the spec's Plan chose between (A) adding a `terminal_id` parameter to `Settings::set()` and (B) a `set_with_terminal` variant, and the writer may have landed under either name or been folded into the raw setter when the module was restructured. What can be stated is narrower and still useful: the table shipped and is pruned by the CLI, and the specific function name in this spec no longer resolves. · ALSO STALE: `crates/oz-core/migrations/XXX_setting_updated.sql` and `platform/core/src/settings.rs` are pre-restructure paths; the migration is now folded into the date-stamped base schema and the settings module is a directory. · The Residual section's own note that "delta row cleanup/pruning is not implemented here (rows accumulate indefinitely)" is now out of date in the best way — `credential_deltas.rs` exists precisely to address that. Worth the phase owner noting. · Same unchecked-criteria note as siblings. · No house stamp existed at the top of this file before this pass. -->
<!-- dead-ref-prefix-ok: crates/oz-core/migrations -->
<!-- Pre-restructure crate name in a Baseline/References pointer; the setting_updated table shipped in the date-stamped base schema. -->
# Phase 0d — `setting_updated` Delta Ledger + `write_setting_delta` IPC

- **Status:** IMPLEMENTED (ADR #22 unified workspace settings shipped in 0.0.19; re-audited 2026-08-08 by docs-auditor)
- **Phase:** 0d of 11 (Workspace Settings Architecture — ADR #22)
- **Parent:** `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md`
- **Severity:** PREREQUISITE (blocks Phase 2)
- **Owner:** TBD
- **Est. effort:** 3-5 days (largest single refactor in the ADR)

## ✅ Audit correction (2026-10-11) — the API this spec names DOES exist

The 2026-09-29 stamp concluded: "WHAT IS NOT FOUND: the `Settings::write_delta` /
`write_setting_delta` API the spec names, under any spelling — a repo-wide search for
`write_setting_delta` and `write_delta` returns nothing". **That conclusion is wrong**, and the
right one is stronger than the stamp was willing to claim. It was searching the wrong two files
(`settings.rs` and `settings/mod.rs`); the settings module had been split into a directory and
the API landed in `settings/raw.rs`.

**`Settings::write_delta` exists with exactly the specified signature** —
`pub fn write_delta(conn: &Connection, key: &str, value: &str, terminal_id: &str) -> Result<(), PlatformError>`
at `platform/core/src/settings/raw.rs:172` — together with:

- **`Settings::get_version`** (`raw.rs:295`), the accessor the spec's `get_setting_version` criterion
  describes, returning the max version for a `(key, terminal_id)` pair.
- **The instrumentation door**: `set_tracked` (`raw.rs:473`) and `set_tracked_in_tx` (`raw.rs:521`)
  write the value and the delta row atomically, with a failed delta write deliberately
  **non-fatal** (warned, value stands) — exactly the spec's "delta write is best-effort" criterion.
- **The table and indexes**, in the date-stamped base schema rather than a numbered migration:
  `setting_updated` at `crates/kasirmu-core/migrations/20260813_init.sql:624`, with
  `idx_setting_updated_key_version` (:1250), `idx_setting_updated_terminal` (:1253) and a UNIQUE
  `idx_setting_updated_unique_version` (:1256) that the spec did not anticipate and that makes
  concurrent version allocation safe.
- **A per-key counter** via `next_delta_version` (`raw.rs:263`), matching the spec's
  `MAX(version) + 1` strategy, with a `BEGIN IMMEDIATE` retry loop for standalone callers.
- **Extensive tests**: `platform/core/src/settings/tests.rs` and `raw_tests.rs` cover version
  increments, per-key independence, per-terminal counters, nesting inside a caller's transaction,
  constraint collisions between two writers, case sensitivity and index use.

**What IS true from the stamp, and matters:** the ledger covers only the **tracked doors**.
`raw.rs:463-472` states it plainly — every typed setter (all 52 `set_*` helpers in
`settings/typed.rs`, plus the receipt/store/credit saves in `crates/kasirmu-bridge/src/settings.rs`)
writes its value with **no delta row**, and **`get_version` has zero production callers as of
2026-09-12**. So the concurrent-edit detection this phase was built to enable is implemented and
tested but **not yet consumed** by any UI. That is a wiring gap, not a missing deliverable, and it
is recorded in the source (with its rationale in
`crates/kasirmu-cli/src/commands/credential_deltas.rs` `SAFETY_BASIS`).

**Still stale, left as historical:** the Baseline and Plan name `platform/core/src/settings.rs`
(now a directory), `crates/oz-core/migrations/XXX_setting_updated.sql` (the numbered series was
retired into `20260813_init.sql`) and `cargo test -p oz-core` (the package is `kasirmu-core`).
The Residual line "delta row cleanup/pruning is not implemented" was already out of date in the
best way — `crates/kasirmu-cli/src/commands/credential_deltas.rs` prunes them.

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
> last audited 11-10-26 by docs-auditor
