<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 major, 0 minor) — was BLOCKING, now ACCURATE · Audited on branch 0.0.40. MAJOR, proven by running the command rather than reading it: both `cargo test -p oz-core` lines below named a package that does not exist. `cargo test -p oz-core db::offline::tests::sync_applied_items_tracks_ids --no-run` → **exit 101, "error: package ID specification \`oz-core\` did not match any packages"** (cargo even suggests the unrelated `csv-core`). The workspace was restructured under `crates/*`/`platform/*`/`modules/*`; `cargo metadata --no-deps` lists `kasirmu-core` (manifest `crates/kasirmu-core/Cargo.toml`) and no `oz-core`, so both lines were unrunnable as written. Repaired to `-p kasirmu-core`, which resolves. Everything else re-measured and MATCHES: `platform/sync/src/queue.rs:808`, `platform/sync/src/daemon.rs:783` and `crates/kasirmu-core/src/db/offline.rs:620` each declare `mod tests;`, so `queue::tests::apply_remote`, `daemon::tests` and `db::offline::tests` are live filter paths; the named test `sync_applied_items_tracks_ids` exists at `crates/kasirmu-core/src/db/offline_tests.rs:865`; `crates/kasirmu-core/src/db/mod.rs:122` declares `pub mod products;` and `products.rs:463` declares `mod tests;`, so the `db::products::tests` filter is live too. The doc's parenthetical "(or the focused stock tests available in the current test module)" is left as written — it is the spec hedging on its own scope, not a factual claim about the code. -->

# Validation plan

## Required checks

- `cargo fmt --all -- --check`
- `cargo test -p platform-sync queue::tests::apply_remote -- --nocapture`
- `cargo test -p platform-sync daemon::tests -- --nocapture`
- `cargo test -p kasirmu-core db::offline::tests::sync_applied_items_tracks_ids -- --nocapture`
- `cargo test -p kasirmu-core db::products::tests -- --nocapture` (or the focused
  stock tests available in the current test module)

## Acceptance criteria

- A remote item applied twice changes local stock only once.
- A duplicate remote stock movement does not create a second ledger row after
  the first atomic application is committed.
- A malformed or insufficient-stock remote mutation returns an error, leaves no
  receipt, and does not advance the pull anchor.
- The daemon uses the atomic path; no production daemon path performs a separate
  mutation followed by a best-effort receipt.
- Existing EventBus behavior and checkout publication contracts remain unchanged
  in this slice.
- Existing architecture-boundary pilot and pending CHANGELOG edit remain
  untouched except for explicitly documented additions.

## Follow-up acceptance criteria

- Critical and best-effort event handlers are classified in a reviewed ADR.
- A durable outbox or equivalent retry mechanism exists for critical post-commit
  effects.
- Event delivery and sync operations carry stable operation IDs and expose
  operator-visible retry/dead-letter state.

> last audited 29-09-26 by docs-auditor
