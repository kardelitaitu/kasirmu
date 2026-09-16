---
name: database
description: The OZ-POS database system — SQLite via rusqlite, the migration runner, the PostgreSQL replica, backup/restore, and the DB-NN invariants. Use when adding or changing a migration, editing anything under crates/oz-core/migrations/, touching connection setup or PRAGMAs, writing SQL that reads or writes money columns, regenerating the PG schema, or debugging a startup failure that mentions migrations, checksums, or drift.
---

<!-- Audit stamp: 2026-09-15 · Budak-Korporat · status: ACCURATE (new skill, rev 1 — no predecessor) · verified this pass, by direct measurement rather than by reading another doc: registry entry count 58 (`grep -c 'Migration {'` in crates/oz-core/src/migrations.rs) against 58 non-`.pg.sql` files and 59 total `*.sql` in crates/oz-core/migrations/; `pub const ALL` opens at crates/oz-core/src/migrations.rs:43; the PRAGMA block is crates/oz-core/src/migrations.rs:352-362 (WAL, busy_timeout 5000, synchronous NORMAL, foreign_keys ON); `fresh_db` at crates/oz-core/src/migrations.rs:377-423 (LazyLock snapshot cloned via rusqlite::backup::Backup); `schema_migrations` DDL at platform/core/src/database/migrations.rs:174-178 (id/applied_at/checksum); `resolve_db_path` at apps/desktop-client/src/state.rs:757-763; the column-type rules and the 12-entry whitelist at scripts/verify-migration-column-types.py:109-170; the generator's single DST at scripts/generate-pg-migration.py:66 and its `--check` branch at :611; the footer convention across all 13 pre-existing skills. Every connection-opener row in the PRAGMA table below was read out of a repo-wide `PRAGMA|journal_mode|busy_timeout|foreign_keys` grep, not inferred from one example. All 23 filesystem paths cited in this document were tested for existence before publication. · NOT verified this pass, and flagged as such: the count of `unchecked_transaction` sites and the `Store` module count in §10 come from the RUST-08 note at the top of crates/oz-core/src/db/mod.rs, which I read but did not independently recount. · DB-06, DB-07 and DB-09 are absent from the repository; see §6. -->

# OZ-POS Database

OZ-POS is **offline-first**: the terminal's SQLite file is the system of record, and
everything else — the cloud, analytics, the PostgreSQL replica — is downstream of it.
A migration that misbehaves does not degrade a feature; it stops the till from opening.

This skill is the map of that database. `rust-backend` covers the *language* rules
(Money, error types, transactions); this skill covers the *system*: where the file
lives, how connections are configured, how the migration runner works, which invariants
are named and enforced, and how the PostgreSQL replica is generated.

---

## When to use

- Adding, editing, or reviewing a file under `crates/oz-core/migrations/`.
- Adding or changing an entry in the registry (`crates/oz-core/src/migrations.rs`).
- Changing connection setup or any `PRAGMA`.
- Writing SQL that reads or writes a money, rate, or multiplier column.
- Regenerating the PostgreSQL schema, or seeing the PG drift gate fail.
- Debugging a startup failure whose message names migrations, a checksum, drift,
  `duplicate column name`, or `already exists`.
- Adding a backup, restore, or export path.
- Writing tests for anything under `crates/oz-core/src/db/`.

---

## 1. Where things live

| What | Where |
|---|---|
| The SQL migrations (source of truth) | `crates/oz-core/migrations/*.sql` |
| The registry that orders and embeds them | `crates/oz-core/src/migrations.rs` |
| The generic runner (no domain knowledge) | `platform/core/src/database/migrations.rs` |
| The migration test corpus | `crates/oz-core/src/migrations_tests.rs` |
| The generated PostgreSQL schema | `crates/oz-core/migrations/20260813_init.pg.sql` |
| The `Store` facade over all domain tables | `crates/oz-core/src/db/` |
| Per-store database files | `platform/core/src/database/manager.rs` |
| Desktop/tablet connection + path resolution | `apps/desktop-client/src/state.rs`, `apps/tablet-client/src/state.rs` |
| Cloud (SQLite + PostgreSQL) | `apps/cloud-server/src/db.rs` |
| The column-type lint | `scripts/verify-migration-column-types.py` |
| The PG generator | `scripts/generate-pg-migration.py` |
| The SQLite/PG role contract | `docs/records/sqlite-pg-roles.md` |

---

## 2. Where the database file lives

Two different resolution stories, and they do not share code:

- **Desktop and tablet clients** — `<app_data_dir>/oz-pos.db`, unconditionally.
  `resolve_db_path` (`apps/desktop-client/src/state.rs:757-763`) joins the Tauri
  app-data directory with the literal file name. The tablet twin is
  `apps/tablet-client/src/state.rs`. **There is no env-var override and no dev/prod
  variant on this path** — if you need a different file in a test, construct the state
  directly rather than looking for a switch that does not exist.
- **Server and CLI processes** — the `OZ_DB_PATH` environment variable, defaulting to
  the relative `oz-pos.db`. The Dockerfiles set it to `/data/oz-pos.db`.
- **Per-store files** — `store-<store_id>.sqlite`, beside the global database, via
  `store_db_path` in `platform/core/src/database/manager.rs`. Each store gets its own
  connection, lazily opened and cached.

---

## 3. Connection setup and PRAGMAs

**There is no single shared opener.** Each process repeats the pattern, so a new
entry point must set the PRAGMAs itself. The full set observed in the repository:

| Opener | PRAGMAs |
|---|---|
| `oz_core::migrations::run` (`crates/oz-core/src/migrations.rs:352-362`) | `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL`, `foreign_keys=ON` |
| Desktop `AppState::new` (`apps/desktop-client/src/state.rs:225-227`) | `foreign_keys=ON`, `journal_mode=WAL` |
| Tablet `AppState::new` (`apps/tablet-client/src/state.rs:112-114`) | `foreign_keys=ON`, `journal_mode=WAL` |
| `platform/startup` (`platform/startup/src/lib.rs:62-63`, `:293-294`) | `foreign_keys=ON`, `journal_mode=WAL` |
| `Pool::open` (`platform/core/src/database/pool.rs:42-43`) | `journal_mode=WAL`, `foreign_keys=ON` |
| `Pool::open_in_memory` (`platform/core/src/database/pool.rs:52`) | `foreign_keys=ON` only — no WAL |
| `StoreDatabaseManager::open_or_create_connection` (`platform/core/src/database/manager.rs:106-111`) | `foreign_keys=ON` always; `journal_mode=WAL` **only when the file is new** |
| `oz_api::serve` (`crates/oz-api/src/lib.rs:453-456`) | `foreign_keys=ON`, `journal_mode=WAL` |
| CLI `open_db` (`crates/oz-cli/src/commands/mod.rs:57-60`) | `foreign_keys=ON`, `journal_mode=WAL` |
| Cloud `DbPool::connect_sqlite` (`apps/cloud-server/src/db.rs:131-133`) | `foreign_keys=ON`, `journal_mode=WAL` |
| `open_api_store_connection` (`crates/oz-local-api/src/lib.rs:162-167`) | `foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout` 5s |

**The rule that matters: `foreign_keys` is per-connection and SQLite's default is OFF.**
It is not inherited, not persisted in the file, and not implied by another connection
having set it. Every opener sets it explicitly, and the reason is written down at
`crates/oz-core/src/migrations.rs:360-362`. A new connection that forgets it will
silently accept orphaned child rows.

`busy_timeout` is set in only two places (`crates/oz-core/src/migrations.rs:353` and
`crates/oz-local-api/src/lib.rs:166`). Its absence elsewhere is intentional, not an
oversight: without it, SQLite fails immediately on write-lock contention instead of
waiting.

There is **no `cache_size` PRAGMA anywhere** in the repository.

---

## 4. The runtime handle

**One connection, behind a mutex. There is no pool.**

- Desktop: `pub db: Arc<Mutex<Connection>>` in `apps/desktop-client/src/state.rs` —
  a **`tokio::sync::Mutex`**, so commands lock it with `.lock().await`.
- Tablet: a bare `tokio::sync::Mutex<Connection>`, not wrapped in `Arc`.
- Per-store: `Arc<std::sync::Mutex<HashMap<String, Arc<Mutex<Connection>>>>>` in
  `platform/core/src/database/manager.rs` — note this one is **`std::sync::Mutex`**,
  not tokio's. Mixing the two up is an easy compile error.
- `platform/core/src/database/pool.rs` defines a `Pool` type, but it has **no
  production call site** — it is referenced only by its own tests. Do not treat it as
  the runtime path.

Tauri commands receive `State<'_, AppState>` and reach the database through
`state.db.lock().await`, or through `AppState::resolve_scope` / `resolve_store` when the
work is store-scoped. Most domain work is then delegated to `oz_bridge`.

---

## 5. The migration system

### The registry is the source of truth

Migrations are `.sql` files embedded at compile time and run in **array order, which is
canonical and deliberately not filename order** (`crates/oz-core/src/migrations.rs:12-15`).
`pub const ALL` opens at `crates/oz-core/src/migrations.rs:43` and holds **58 entries**.
Each entry is two fields:

```rust
Migration {
    id: "20260813_init.sql",
    sql: include_str!("../migrations/20260813_init.sql"),
},
```

There is **no `down` field** — the registry carries no reverse SQL, by design (DB-03).

> **The count trap.** `crates/oz-core/migrations/` contains **59** `*.sql` files but the
> registry has **58** entries. The extra file is the generated `20260813_init.pg.sql`,
> which is *not* a migration and must never be added to the registry. A doc or gate that
> quotes "59 migrations" is quoting a **file count**, not a registry count. The parity
> test excludes `.pg.sql` for exactly this reason.

### The tracking table

`schema_migrations`, created by the runner (`platform/core/src/database/migrations.rs:174-178`):

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    id         TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    checksum   TEXT
)
```

**`id` is the migration's file name**, not a number and not a timestamp prefix. A
database whose `schema_migrations` rows read `20260813_init.sql` is behaving correctly.

Databases created before checksum tracking existed lack the `checksum` column; the
runner adds it and backfills once.

### What `run` does

`platform_core::database::run(conn, migrations)` — note it takes `&mut Connection`,
because `Connection::transaction` requires it. `oz_core::migrations::run` wraps it and
then applies the runtime PRAGMAs of §3.

For each migration, in registry order:

1. **Not applied** → apply it, and insert its tracking row *inside the same
   transaction*, so there is no partial DDL.
2. **Applied, no stored checksum** → backfill the checksum once.
3. **Applied, checksum matches** → nothing.
4. **Applied, checksum differs** → log `migration definition drift detected`, re-apply
   the script, then rewrite the stored checksum.

Checksums are SHA-256 over the SQL **after line-ending canonicalisation**, with a legacy
CRLF form accepted and rewritten on sight. This is why editing a committed migration is
never harmless, even to fix a typo in a comment: it changes the checksum and forces the
re-apply path.

The drift re-apply tries the whole script first and, only on a duplicate-object error,
falls back to executing statement by statement and skipping the statements whose effect
is provably already present. It cannot rescue a migration that consumes the state it
transforms — a column converted then dropped, a table renamed — which is the DB-03 class.
`cosmetic_edit_to_any_migration_re_applies_cleanly` in `crates/oz-core/src/migrations_tests.rs`
pins which migrations are in which set.

---

## 6. The named invariants

These identifiers are real and each is enforced somewhere. They are the vocabulary to
use in a commit message or a review comment.

| ID | Requirement | Enforced by |
|---|---|---|
| **DB-01** | Registry ↔ filesystem parity: every non-`.pg.sql` file has exactly one registry entry, and every entry resolves to a real file | `migration_registry_matches_filesystem` in `crates/oz-core/src/migrations_tests.rs` |
| **DB-02** | Every applied migration records a SHA-256 checksum; a changed definition fails closed, after first re-applying | `platform/core/src/database/migrations.rs` |
| **DB-03** | Forward-only. No ad-hoc down SQL; destructive or data-consuming changes need a backup-plus-forward-repair procedure | `crates/oz-core/src/migrations.rs` module doc |
| **DB-04** | Store-scoped isolation: a store-scoped read or write must never leak across stores and must never touch the NULL global sentinel | four audits in `crates/oz-core/src/migrations_tests.rs` |
| **DB-05** | Foreign-key isolation: `foreign_keys` is disabled at the connection level around each apply and rollback, then the caller's previous setting is restored | `platform/core/src/database/migrations.rs` |
| **DB-08** | Settings delta-ledger concurrency: a UNIQUE index on `(key, terminal_id, version)`, each attempt in its own `BEGIN IMMEDIATE`, retried on collision | `platform/core/src/settings/raw.rs` |

> **DB-06, DB-07 and DB-09 do not exist.** The numbering has gaps. Do not infer a
> missing invariant from a neighbouring one, and do not "fill in" an identifier you have
> not found — there is no single canonical list document, and each identifier is defined
> only in the source file that enforces it.

---

## 7. Schema conventions

**Exact-decimal values are fixed-point integers. Never `REAL` or `DOUBLE`.**

| Kind | Suffix | Meaning |
|---|---|---|
| Money | `*_minor` | Minor units, `i64` — cents, sen, paise |
| Rates, multipliers, ratios | `*_millionths` | Scaled by 10^6, `i64` |

`scripts/verify-migration-column-types.py` enforces this on every `*.sql` under
`crates/oz-core/migrations/` (the PG file included). It strips comments first, then
looks for a column-name-plus-float-type pair, so naming a float in a comment cannot trip
it. The gate is wired into `.githooks/pre-commit` as the migration column-type lint and
runs with `--staged-only` there.

Its whitelist (`scripts/verify-migration-column-types.py:142-170`) has **12 entries**,
each anchored to a file, table, column *and a reason*:

- `loyalty_tiers.earn_multiplier` — historical column, converted to
  `earn_multiplier_millionths` by a later migration.
- `products.popularity_score` — an analytics score recomputed from sales history,
  display-ranked, never money. (Also whitelisted in the PG twin and in the
  per-tenant-uniqueness rebuild's `products_new`.)
- `tables.pos_x`, `pos_y`, `width`, `height` — floor-plan canvas geometry, display-only.
  (Also whitelisted in the PG twin.)

**A whitelist entry that matches nothing is itself a failure.** If you remove or rename
one of those columns, the gate fails until you remove its entry — stale exemptions are
treated as drift, not as harmless leftovers. Adding a float of your own requires a
justified whitelist entry, which is a deliberate speed bump: the reviewer sees your
reason in the diff.

Indexes follow `idx_<table>_<purpose>` by observation, but **no lint enforces it** —
unlike the fixed-point rule, which is machine-checked. Do not cite a naming lint that
does not exist.

---

## 8. The PostgreSQL replica

**SQLite is the source of truth. Postgres is a generated replica.** The contract is
`docs/records/sqlite-pg-roles.md`; read it before touching anything PG-shaped.

- `crates/oz-core/migrations/20260813_init.pg.sql` is **generated**, by
  `scripts/generate-pg-migration.py`. Its single output path is fixed at
  `scripts/generate-pg-migration.py:66`, and the file it writes carries a
  `DO NOT EDIT BY HAND` header. **Never hand-edit it.**
- The generator parses registry order out of `crates/oz-core/src/migrations.rs`, applies
  every migration to a throwaway in-memory SQLite database, dumps the resulting
  `sqlite_master` state, and translates it: `INTEGER` → `BIGINT`, `REAL` →
  `DOUBLE PRECISION`, autoincrement to identity, `STRICT` dropped, tables emitted in
  foreign-key topological order, triggers ported through a hand-written plpgsql map, and
  a curated RLS appendix appended.
- **It fails closed in both directions on trigger parity** — a trigger with no plpgsql
  entry is an error, and so is an entry with no trigger — and on stale RLS coverage or
  exemption lists.
- `--check` (branch at `scripts/generate-pg-migration.py:611`) **renders twice and
  compares the two renders** to prove determinism, then compares the result against the
  committed file and exits non-zero on drift **without touching the working tree**. The
  pre-commit hook runs it whenever a migration, the registry, or the generator is staged.

**After any migration change, run the generator and re-stage the PG file.** Forgetting
this is the most common way to turn a clean migration into a red gate. The cloud server
auto-applies the PG schema on boot, so it must stay idempotent and deterministic — which
is why a hand-edit that "works" locally is still wrong.

To re-sync a shared dev database after a PG schema change, use `scripts/reset-dev-pg.sh`.

---

## 9. Backup, restore, and recovery

- **Backup** uses rusqlite's online `Backup` API (`Store::backup` in
  `crates/oz-core/src/db/mod.rs`), not `VACUUM INTO` — it is safe against a live
  connection.
- **Integrity** is `PRAGMA integrity_check`; there is also a tenant-integrity check that
  fails loudly on foreign-tenant rows and runs at desktop boot.
- **Restore** is `crates/oz-cli/src/commands/backup.rs`. It is order-sensitive: it
  checkpoints the WAL with `PRAGMA wal_checkpoint(TRUNCATE)`, **deletes the `-wal` and
  `-shm` sidecars**, and only then copies the file in. Skipping the sidecar deletion
  produces a torn restore — the copied file is silently re-mixed with the previous
  database's write-ahead log. Store deletion removes the same sidecars.
- **Shell wrappers**: `scripts/backup-db.sh` and `scripts/restore-db.sh`.
- **The one recovery journal** is the cross-database topology Apply journal in
  `crates/oz-bridge/src/topology/persistence.rs`. It is deliberately retained until
  *both* databases are restored, which is what makes compensation retryable after a
  crash. Do not "tidy it up" on a successful apply.
- **Stock-ledger self-healing** writes one deterministic compensating movement per
  shortfall (`crates/oz-core/src/db/products_stock_adjust/ledger.rs`), rather than
  mutating the ledger in place.

Integration coverage lives in `crates/oz-core/tests/backup_restore_integration.rs` and
`crates/oz-core/tests/corruption_recovery_integration.rs`.

---

## 10. Transaction discipline — and the deviation you must know about

`rust-backend` states the rule as: *all writes happen in a transaction*, and *a function
that writes must take `&mut Connection`, never `&Connection`*.

The `Store` facade in `crates/oz-core/src/db/mod.rs` **deliberately deviates from the
second half**, and documents why: `Store` borrows `&Connection`, because checked
transactions require `&mut Connection`, which would force every caller to hold a mutable
borrow of the shared connection for the whole write. So `Store` uses
`Connection::unchecked_transaction()` instead.

The facade's four rules, which are the contract the code actually follows:

1. Standalone atomic commands **own** their transaction.
2. Composable methods **never nest** — a nested `unchecked_transaction()` fails at
   runtime with `cannot start a transaction within a transaction`.
3. Read-only methods **never** open a transaction.
4. Error paths **roll back**.

If you follow `rust-backend` literally and change a `Store` method to take
`&mut Connection`, you break the facade. If you add a new composable method and open
your own transaction, you break rule 2 at runtime rather than at compile time. Both
statements are true; the facade contract is the one the code obeys.

`PRAGMA foreign_keys` is a **no-op inside a transaction**. That is the whole reason DB-05
exists: rebuild migrations that toggle foreign keys in their own SQL were silently
running with enforcement ON, risking cascade deletion on populated child tables. The
runner now reads the current setting, turns enforcement off *before* opening the
transaction, and restores the previous value afterwards — and a failure to restore is
logged without masking the original error.

---

## 11. Testing database code

- Tests live in sibling `*_tests.rs` files wired at the bottom of the production file:
  ```rust
  #[cfg(test)]
  #[path = "mod_tests.rs"]
  mod tests;
  ```
  Never inline. This is a repository-wide rule, not a database one.
- **Use `oz_core::migrations::fresh_db()`** for a migrated in-memory database. It builds
  a `LazyLock` snapshot once, runs all 58 migrations into it, then clones it per test
  through the SQLite `backup::Backup` API — orders of magnitude faster than re-running
  `execute_batch` per test. It is `#[doc(hidden)]` and test-only.
- For a database you intend to migrate yourself, open in memory and run migrations
  explicitly, the way `crates/oz-core/src/migrations_tests.rs` does.
- `platform/core/src/database/manager_tests.rs` uses `tempfile::tempdir()` for the
  per-store-file tests, which need real files.
- Tauri state has test constructors (`AppState::for_test` and friends) in
  `apps/desktop-client/src/state.rs`; the cloud has an in-memory connector in
  `apps/cloud-server/src/db.rs`.

---

## 12. Verification

Fast, targeted:

```bash
cargo test -p oz-core migrations
python scripts/verify-migration-column-types.py
python scripts/generate-pg-migration.py --check
```

Before pushing (these are also pre-commit and pre-push gates):

```bash
bash scripts/check.sh
```

The pre-commit hook runs the migration column-type lint when migrations are staged and
the PG drift guard when a migration, the registry, or the generator is staged. The
staged-scoped form is what the hook uses; the whole-tree form is what CI uses.

---

## 13. Common pitfalls

1. **Editing an applied migration.** It changes the checksum and forces a re-apply. Add a
   new migration instead — this is what "forward-only" means in practice.
2. **Adding the PG file to the registry.** `20260813_init.pg.sql` is generated output, not
   a migration. Adding it breaks DB-01 parity and applies the entire PG schema to SQLite.
3. **Assuming registry order is filename order.** It is not. Several entries are ordered
   deliberately against their names, and inserting a new migration at the end of the array
   is not always the same as inserting it last in time.
4. **Quoting "59 migrations".** That is a file count. The registry holds 58.
5. **Forgetting `foreign_keys = ON` on a new connection.** SQLite's default is OFF, per
   connection. Nothing else turns it on for you.
6. **Toggling `PRAGMA foreign_keys` inside a transaction.** It is a silent no-op. This is
   the bug DB-05 was written to contain.
7. **Using a float for money or a rate.** The lint catches it, but only if the column name
   precedes the type keyword in a form the regex recognises. `*_minor` and
   `*_millionths` are the only sanctioned shapes.
8. **Leaving a whitelist entry behind** after removing the column it exempts. The gate
   fails on stale entries deliberately.
9. **Hand-editing the `.pg.sql` file.** Run the generator and re-stage.
10. **Restoring without deleting the `-wal` and `-shm` sidecars.** Produces a torn restore
    that looks like corruption later.
11. **Opening a transaction inside a composable `Store` method.** Fails at runtime, not at
    compile time, and only on the path that nests.
12. **Inventing a DB-NN identifier.** DB-06, DB-07 and DB-09 do not exist.

---

## See also

- **[`rust-backend`](../rust-backend/SKILL.md)** — the language-level rules this skill
  assumes: the `Money` struct, `thiserror`/`anyhow`, clippy, doc comments, and the
  sibling-test convention. Read it first if you are new to the crates.
- **[`tauri-ipc`](../tauri-ipc/SKILL.md)** — how a Tauri command reaches the database
  handle and how domain types cross the IPC boundary.
- **[`tdd`](../tdd/SKILL.md)** — the red-green-refactor loop to use when fixing a
  migration or a `Store` bug.
- **[`codebase-memory`](../codebase-memory/SKILL.md)** — graph-first discovery, which
  `AGENTS.md` requires before grepping for symbols. Useful for tracing every caller of a
  `Store` method before you change its signature.
- **[`skill-drift-guard`](../skill-drift-guard/SKILL.md)** — run it after a migration
  rename, a column change, or any edit that invalidates a path or count quoted here.

---

> last audited 15-09-26 by Budak-Korporat
