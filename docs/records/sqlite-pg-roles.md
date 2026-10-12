<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 minor) · Re-audit of the SQLite/PG roles contract; the 2026-09-29 stamp is merged at the bottom as original evidence. · MINOR, and it is the one class of claim a short contract document cannot afford: the prior stamp's own line number for the `pg-schema-drift` gate id had drifted — it cited `scripts/gates.json` line 238, which today is inside the unrelated `db-script-self-tests` gate ("db backup script self-test"). The real location is **gates.json:1087** (`"id": "pg-schema-drift"`), with `migration-column-types` at :1105 and `bundle-parity` at :1123. The claim that it IS a gate id (and not a CI job name) remains exactly right — that distinction is the point of the sentence and is preserved; only the coordinate moved, which is ordinary drift in a file that has grown to 1,690 lines. · VERIFIED AT HEAD, all still true: SQLite-is-truth / Postgres-is-generated holds (20260813_init.pg.sql present, scripts/generate-pg-migration.py present, and the pre-commit hook runs it in check mode at .githooks/pre-commit:190, failing with "regenerate with 'python3 scripts/generate-pg-migration.py' and re-stage"); pre-commit step 5 IS the PG schema drift guard, so the prior pass's repair to "step 5" is confirmed against this clone's eight sections rather than re-stated; `pg-schema-drift` is a real gates.json entry; `RLS_TABLES` exists in the generator (the curated-coverage claim); `PG_INIT` is read by the cloud server (32 hits under apps/cloud-server/src); `scripts/verify-migration-column-types.py` exists and carries the LOYALTY-01 / MONEY-01 whitelist references; and the dev-container resync pair `scripts/reset-dev-pg.sh` + `.ps1` both exist, so the instruction is runnable on either shell. · NOT re-measured: an actual generator run or drift detection (that needs a migration change), the PG container resync, and the `cargo test -p kasirmu-api --lib pg` suite. · Prior stamp preserved below as plain quoted text (delimiters stripped so it cannot nest):

Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · REPAIRED — one cross-reference points at the wrong numbered step, and this is the file other documents lean on hardest. First pass over this record: 34 lines, and it already carries a DSH provenance note and is already re-anchored to the current crate names (`crates/kasirmu-core/migrations/`, `crates/kasirmu-core/src/migrations.rs`), which is why almost all of its claims verify on the first try. The claim that matters most is the headline one — SQLite is the source of truth and Postgres is a generated replica — and the enforcement around it is real: `20260813_init.pg.sql` is present, `scripts/generate-pg-migration.py` exists, and the hook actually runs it in check mode (`.githooks/pre-commit:183-189`, failing with a regenerate-and-re-stage message). The `pg-schema-drift` gate id this record names is genuine — it is a real entry in `scripts/gates.json` at line 238, alongside `migration-column-types` and `bundle-parity`. The record is also right that it is a GATE ID and not a CI job name, a distinction several files in this campaign have gotten wrong. · REPAIRED: the cross-reference to pre-commit step 7 names the wrong step. The seven pre-commit steps are enumerated in `AGENTS.md` §2, and PG schema drift guard is step 5 there; step 7 is FTL orphan lint, and step 4 is the migration column-type lint that this very record sits next to in `gates.json`. A reader who trusted the step number would go looking in the FTL-orphan gate and find nothing to do with schema drift. Corrected to step 5. This is the only repair in the file and it is a cross-reference, not prose. · WHY A 34-LINE FILE DESERVES THIS ATTENTION: three documents audited in this campaign cite it as authoritative and all three lean on the registry-order-is-canonical rule — the statutory-rounding record names it directly for the rebuild-hazard rule, and ADR-18's own stamp cites it for the same reason. A short contract document that three other documents treat as a dependency is exactly where a wrong step number costs the most, because the error propagates silently rather than being caught by a reader who does not have `AGENTS.md` open. -->
# SQLite / Postgres Roles

<!-- 2026-08-31 · DSH · companion to the guards in AGENTS.md §4 -->

**SQLite is the source of truth. Postgres is a generated replica.**

- Every schema change is a migration file under
  `crates/kasirmu-core/migrations/` plus a registry entry in
  `crates/kasirmu-core/src/migrations.rs` (registry order is canonical — not
  filename order). Terminals (desktop/tablet) run SQLite only.
- `20260813_init.pg.sql` is **generated** from the fully-migrated SQLite
  schema by `scripts/generate-pg-migration.py`. Never hand-edit it — pre-commit
  step 5 and the `generate-pg-migration.py --check` step inside
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
  `cargo test -p kasirmu-api --lib pg`.

> last audited 11-10-26 by docs-auditor
