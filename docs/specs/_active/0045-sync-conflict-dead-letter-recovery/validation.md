<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 major, 1 minor — both repaired here) · Audited on branch 0.0.40. MAJOR, proven by execution: `cargo test -p oz-core` (line 9) and `cargo check -p platform-sync -p oz-core` (line 10) both name a package that no longer exists — `cargo pkgid -p oz-core` returns "error: package ID specification `oz-core` did not match any packages", while `cargo pkgid -p kasirmu-core` returns `crates/kasirmu-core#0.0.40`. The workspace moved to `crates/*`/`platform/*`/`modules/*`; repaired to `-p kasirmu-core`. MINOR: "Migration 119" names a sequential numbering this repo abandoned — `crates/kasirmu-core/migrations/` is date-stamped (`20260813_init.sql` through `20261015_gift_cards_drop_pin.sql`, the current ceiling) and no file or registry entry carries 119. Repaired to name the artifact the criterion was reaching for. The substance of that criterion is TRUE and now verified: the dead-letter store is the `sync_remote_failures` table, `dead_lettered INTEGER NOT NULL DEFAULT 0 CHECK (dead_lettered IN (0, 1))` at `crates/kasirmu-core/migrations/20260813_init.sql:851` with `idx_sync_remote_failures_dead_lettered` at `:1327-1328`, and expected-table coverage genuinely passes because `migrations::tests::migrations_create_expected_tables` lists both `"sync_remote_failures"` (`crates/kasirmu-core/src/migrations_tests.rs:638`) and `"sync_applied_items"` (`:637`). That test is reachable as written — `crates/kasirmu-core/src/migrations.rs:610` declares `mod tests;`. · MATCH, re-measured: both named daemon tests exist — `daemon_applies_replayed_remote_item_only_once` at `platform/sync/src/daemon_tests.rs:773` and `daemon_retains_anchor_until_remote_item_is_dead_lettered` at `:1126`, reached through `mod tests;` at `platform/sync/src/daemon.rs:783`; the `queue::tests::apply_remote_atomic` filter is live via `platform/sync/src/queue.rs:808` and matches the `apply_remote_atomic_*` family. · NOT re-measured: the retry-count ladder behind "third failure becomes dead-lettered" — a behaviour claim, covered by the named test rather than re-derived here. -->

# Validation

## Focused checks

- `cargo fmt --all -- --check`
- `cargo test -p platform-sync queue::tests::apply_remote_atomic -- --nocapture`
- `cargo test -p platform-sync daemon::tests::daemon_applies_replayed_remote_item_only_once -- --nocapture`
- `cargo test -p platform-sync daemon::tests::daemon_retains_anchor_until_remote_item_is_dead_lettered -- --nocapture`
- `cargo test -p kasirmu-core migrations::tests::migrations_create_expected_tables -- --nocapture`
- `cargo check -p platform-sync -p kasirmu-core`

## Acceptance criteria

- Same-SKU catalog conflicts fail without a receipt.
- Remote failures are retained with attempts and payload.
- Third failure becomes dead-lettered; later replay is skipped.
- Retryable failure retains the old pull anchor.
- Successful replay is idempotent and clears stale failure state.
- The `sync_remote_failures` dead-letter table is created by the registered
  migration set and expected-table coverage passes.

> last audited 29-09-26 by docs-auditor
