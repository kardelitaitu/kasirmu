# kasir.mu 0.0.25

Released 2026-08-09.

kasir.mu 0.0.25 is a production-hardening release focused on reliable synchronization, safer replay handling, typed multi-store topology management, browser-preview parity, and stricter delivery gates.

## Highlights

### Reliable synchronization and recovery

- Added PostgreSQL sync parity with the SQLite engine, including durable cursor pagination, replay protection, atomic remote-item application, retry/dead-letter handling, and operator requeue support.
- Added expired-anchor recovery through typed PostgreSQL snapshots. Successful recovery imports the snapshot and advances the durable anchor; failed recovery retains the stale anchor and reports the error.
- Added PostgreSQL stock-summary rebuilding and remote settings-update events.
- Added operator rewind protection so an in-flight pull cannot overwrite a deliberate anchor rewind.
- Added real PostgreSQL integration coverage for retention detection, timestamp and boolean decoding, and snapshot credential exclusion.

### Typed multi-store topology

- Added branch-scoped, typed topology graphs with canonical branch-location ownership, typed ports and relationships, live validation, and guarded Apply behavior.
- Added branch add, rename, and delete flows with workspace-instance reconciliation.
- Added marquee and multi-select editing, batch deletion, bend points, orthogonal routing, node finder, auto-layout, hardware-node inspection, viewport memory, and minimap preferences.
- Prevented deleted or unassigned branches from resurrecting stale cards, wires, or selections.
- Added dirty-state protection for branch switches and exact unsaved-change tracking for preset loading.

### Browser-preview parity

- Persisted active carts, completed sales, shifts, login lockout/history, KDS orders and line items, display counters, and held carts in the development mock.
- Added restart, resume, deletion, malformed-storage, and collision-resistant identifier coverage for persisted mock state.

### Security and data safety

- Hardened session minting and workspace selection so user identity, store scope, and permissions are resolved from trusted database state rather than caller claims.
- Added checked money, quantity, tax, payment, purchase-order, and BOM arithmetic at ledger and IPC boundaries.
- Rejected negative or overflowing values before persistence and preserved transaction rollback on invalid input.

## Quality and delivery

- Added architecture-boundary validation for Rust dependencies and production UI Tauri IPC usage, with a tracked baseline for existing findings.
- Restored strict formatting, Clippy, panic-inventory, architecture, i18n, release, Windows, plugin, and documentation-drift gates.
- Rescued the remaining pre-existing UI test and lint failures; the release gate reports zero blocking issues.

## Verification

- Full pre-push gate: `bash scripts/check.sh` — passed.
- Desktop topology E2E: 13/13 passed on an isolated Vite server.
- PostgreSQL integration coverage: 2/2 passed against a disposable PostgreSQL 16 instance.
- Architecture-boundary tests: 14/14 passed.
- Strict live boundary check: 17 tracked findings, 0 blocking findings.
- UI lint, typecheck, Vitest, i18n, Fluent dedupe, feature registry, plugin, release, Windows, and CI-documentation checks passed.

## Upgrade notes

- PostgreSQL deployments should validate tenant scoping for queue and snapshot queries before production rollout.
- Snapshot import and durable-anchor reset remain separate database commits. A crash between them may repeat an idempotent snapshot import on the next cycle.
- The PostgreSQL integration target is disposable and local; CI wiring and live daemon-level recovery coverage remain follow-up work.
