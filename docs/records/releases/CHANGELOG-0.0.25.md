<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 55 lines, no audit stamp, no footer, no docs-auditor marker. It is a dated release record — Released 2026-08-09 — and the correct treatment for one is to leave the body exactly as written: a changelog is a statement about what a specific build contained, and editing it to match a later tree destroys the only reason it exists. · WHAT IS STILL CHECKABLE, and holds: the release gate it names, `scripts/check.sh`, exists; the architecture-boundary validation it credits as added is live as both the rule set in `scripts/verify-architecture-boundaries.py` and the `architecture-boundaries` gate id in `scripts/gates.json`; and the atomic remote-item application, expired-anchor recovery and delta-ledger work it describes is the same machinery this campaign has verified repeatedly in the sync ADR series and in `docs/specs/_active/0044-critical-delivery-and-sync-replay-safety/validation.md` (round 1), whose acceptance criteria — a remote item applied twice changing stock once, a malformed mutation leaving no receipt — are exactly the behaviours this changelog claims to ship. A release note whose claims can be traced to a still-passing acceptance suite is worth more than one that cannot. · NOT re-measured, and correctly so: the per-gate counts (13/13 E2E, 2/2 PostgreSQL, 14/14 boundary tests, 17 tracked findings) and the `bash scripts/check.sh` pass. Those are results of one run on 2026-08-09; re-running them produces a different set of numbers that would tell a reader nothing about this release. The Upgrade notes at the end — particularly that snapshot import and durable-anchor reset remain separate database commits, so a crash between them may repeat an idempotent import — are operational warnings that stay true as long as the code does, and are the most useful thing in the file. · No stamp or footer existed; both added. -->
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

> last audited 29-09-26 by docs-auditor
