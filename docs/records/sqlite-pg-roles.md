# SQLite / Postgres Roles

<!-- 2026-08-31 · DSH · companion to the guards in AGENTS.md §4 -->

**SQLite is the source of truth. Postgres is a generated replica.**

- Every schema change is a migration file under
  `crates/oz-core/migrations/` plus a registry entry in
  `crates/oz-core/src/migrations.rs` (registry order is canonical — not
  filename order). Terminals (desktop/tablet) run SQLite only.
- `20260813_init.pg.sql` is **generated** from the fully-migrated SQLite
  schema by `scripts/generate-pg-migration.py`. Never hand-edit it — pre-commit
  step 7 and the `generate-pg-migration.py --check` step inside
  `dev-ci.yml#static-gates` fail on drift. (`pg-schema-drift` is the **gate id** in
  `scripts/gates.json`, not a CI job name; searching `.github/workflows/` for a job by
  that name finds only a comment.)
  After any migration change: run the generator, re-stage the file.
  The cloud auto-applies it on boot (`PG_INIT`), so it must stay
  idempotent and deterministic.
- A table's data "migrates to PG" when a cloud query (REST layer,
  analytics, sync transport) starts reading it. Until then it exists in
  the PG schema as a faithful port but is not populated. Row-Level
  Security coverage is curated (`RLS_TABLES` in the generator): add a
  table only once its write path demonstrably populates `tenant_id`.
- Exact-decimal values (money, rates, multipliers) are fixed-point
  integers — `*_minor`, `*_millionths` — never `REAL`/`DOUBLE`.
  `scripts/verify-migration-column-types.py` enforces this on every
  migration; new floats need a justified whitelist entry (LOYALTY-01,
  MONEY-01).
- After changing the PG schema, re-sync the shared dev container:
  `bash scripts/reset-dev-pg.sh` (or the `.ps1` twin), then
  `cargo test -p oz-api --lib pg`.

> last audited 08-09-26 by docs-auditor
