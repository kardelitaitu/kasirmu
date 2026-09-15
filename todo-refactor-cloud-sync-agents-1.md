# Orchestrator Agent 1: Cloud Sync Engine & Protocol Handler

<!-- Audit stamp: 2026-09-14 · DSH · status: INACCURATE -> CORRECTED · corrections applied: 12 · the fence named `apps/cloud-server/src/bin/migrate_sqlite_to_pg.rs`, a single file that does not exist — it became a module DIRECTORY at `2c35ec1a2` — and the `sync_store.rs` baseline was ~578 lines stale; both found by globbing `apps/cloud-server/src/**/*.rs` and re-measuring with `wc -l` instead of trusting the prose. -->

> **Line-number drift from the sizing pass (2026-09-14): the bullets that pass cites by line have
> moved, so both forms appear in this file and this is the map as of THIS pass's final write —
> `:51` now `:59` · `:58` now `:67` · `:64` now `:76` · `:68` now `:94` · `:74` now `:100`. Re-derive before quoting one of these pointers
> after any further edit: a line reference is only true of the revision it was taken from, which is
> the failure class every note below exists to prevent.**

**Document:** `todo-refactor-cloud-sync-agents-1.md`  
**Role:** Orchestrator Agent 1 (Sync Protocol & Conflict Architect)  
**Goal:** Decompose `apps/cloud-server/src/sync_store.rs` (1,412 lines — it read 1,757 until `7a310e013` took 345 out) and `sync_api.rs` (800 lines) to streamline conflict resolution and SQLite-to-Cloud replication.  <!-- 2026-09-15 fourth pass: that first clause is CLOSED and the second has never been opened by any phase in this plan. sync_store.rs reads 408 (wc -l) across itself + four child modules, so it is under the 1,000-line ceiling in AGENTS.md:181 AND under that file's own "preferably < 600" preference; sync_api.rs still reads 800, is named in the Goal and in the path fence at `:45`, and is the subject of ZERO boxes in this checklist — see §7 at EOF. -->

> ⚠️ **Honesty pass 2026-09-14 (measured): this Goal line oversells. It is left exactly as written so that no coder is dispatched to re-do shipped work.** Conflict resolution has **already moved out of the file** — `apps/cloud-server/src/conflict_resolution.rs`, 401 ln, pure (no I/O), imported at `sync_store.rs:42`, created by `230642b64` (2026-09-13, *feat(sync-cloud): classify concurrent sync mutations and persist conflict rows*) on the sync-conflict lane, not under this work order. Version vectors are **real and in use**: `use platform_sync::crdt::VersionVector;` at `sync_store.rs:53`, **26** `VersionVector` references across `apps/cloud-server/src/` (`grep -rn VersionVector apps/cloud-server/src | wc -l` = 26), over `platform/sync/src/crdt/version_vector.rs` (146 ln). **What this document still owns is `:68`, and `:68` is a STRUCTURAL / POLICY split: funding it buys `AGENTS.md` §2 compliance — `wc -l apps/cloud-server/src/sync_store.rs` = **1,412** against the 1,000-line production-file ceiling — it does not buy a better sync. That is the honest sales pitch, and no phase here changes replication behaviour (where behaviour work lives: the closing note).**

> ⚠️ **Baseline correction (audit 2026-09-14, measured):** the Goal named "1,179 lines" for
> `sync_store.rs`. `wc -l apps/cloud-server/src/sync_store.rs` = **1,412** today. 1,757 was true only at `7a310e013^`, which read 1,685 non-blank, so that figure was already a non-blank/blank mismatch as much as a drift. It was **1,232**
> at `1af143f23` (the commit that added this document), so the quoted figure matched no revision of
> the file. Counts here are `wc -l`; a ±1 difference against a split-on-newline measure is method,
> not error.
> The Goal also named a mechanism that does not exist: **"revision diffing"** — the string
> `revision` appears **0 times** anywhere in `apps/cloud-server/`. The pull path pages by a `since`
> timestamp plus an opaque `cursor`/`next_cursor` (`sync_api.rs:357-361`), which the following
> sentence now says instead.
> **"Vector clock resolution"** was nearly deleted by an earlier audit pass on the grounds that
> `vector_clock` returns 0 hits. That correction is **rejected**: the mechanism is real and is called
> a **version vector** — `platform/sync/src/crdt/version_vector.rs` (146 ln), imported at
> `sync_store.rs:53` (`use platform_sync::crdt::VersionVector;`) and consumed by
> `conflict_resolution.rs` (26 `VersionVector` references across `apps/cloud-server/src/`).
> Vocabulary differing from the doc is not absence of the feature.

**Target Crate:** `apps/cloud-server/src/` (Cargo package name is `oz-cloud-server`)  
**Sibling Documents:**
- `done-todo-refactor-cloud-sync-agents-2.md` (Agent 2 — Email PG Daemon & Outbound Dispatch) — **finished and archived**. Its slice has landed: `email_pg.rs` is now a 75-line module header over four children (`analytics.rs` 712, `popularity.rs` 401, `queue_worker.rs` 373, `settings_store.rs` 114), split by `01e62dec1`.
- `done-todo-refactor-cloud-sync-agents-3.md` (Agent 3 — Tenant Migration & Schema Synchronization) — **finished and archived**.

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(cloud-sync): ...`
2. **Owned Path Fence (Exclusive to Agent 1):**
   - `apps/cloud-server/src/sync_store.rs` (1,412 ln, 1,757 before `7a310e013`) & `sync_store_tests.rs` (1,386 ln) · `sync_store/pg.rs` (378 ln) sits inside this fence by parentage — see the 2026-09-15 block at EOF <!-- 2026-09-15 fourth pass: the fence now covers FIVE files by that same parentage — sync_store.rs (408) + sync_store/{pg 378, conflicts 509, sqlite 332, tenant 233}. All four `mod` lines are registered in the parent at `:34`-`:37`. Nothing outside this list was touched by the three commits that landed it. -->
   - `apps/cloud-server/src/sync_api.rs` (800 ln) & `sync_api_tests.rs` (2,525 ln)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `email_pg.rs` **or the `email_pg/` module directory** (owned by Agent 2 — already decomposed by `01e62dec1`).
   - DO NOT edit `src/bin/migrate_sqlite_to_pg/` — a **directory** (`main.rs` 215, `copy.rs` 168, `rows.rs` 324, `schema.rs` 125, `migrate_sqlite_to_pg_tests.rs` 441) — or `db.rs` (431 ln). Owned by Agent 3.
     > ⚠️ This fence previously named `bin/migrate_sqlite_to_pg.rs` as a single file. It is not one:
     > `2c35ec1a2` (2026-09-13) split the bin into the module directory above, so the Agent 3
     > decomposition this roadmap anticipated has already happened.
   - DO NOT edit `conflict_resolution.rs` (401 ln) — created on the sync-conflict lane by `230642b64`, not by this agent. See Phase 1.1.

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [ ] Run `cargo test -p oz-cloud-server sync` to establish baseline.
  > Package name verified: `apps/cloud-server/Cargo.toml:2` declares `name = "oz-cloud-server"`, so
  > the command is well-formed, and the suite exists (`sync_store_tests.rs`: 20 `#[tokio::test]`,
  > 0 plain `#[test]`). **The test run itself was NOT performed by this docs audit** (it is a cargo
  > build, out of scope here), so the box stays unticked: valid command, unknown result.
  > **Sizing pass 2026-09-14 — and the command as written cannot be honestly ticked whatever the pass count reads.** Of the 20 `#[tokio::test]` cases in `sync_store_tests.rs`, **SEVEN** `pg_integration_*` cases (`:272`, `:451`, `:515`, `:576`, `:1016`, `:1115`, `:1185`) open with `let Some((pool, db_name)) = throwaway_pool().await else { eprintln!("… skipped: cannot create throwaway DB"); return; };` — at `:273`, `:452`, `:516`, `:577`, `:1017`, `:1116`, `:1186`. **A `return` inside the `else` arm is a PASS to cargo, not a test that ran: "20 passed" can mean "13 ran".** Condition for a tick: container **`oz-pg-test-15432`** up (`scripts/reset-dev-pg.sh` names it; the suite dials `postgres://postgres:postgres@localhost:15432/postgres` unless `OZ_TEST_PG_URL` is set — `sync_store_tests.rs:15-16`), **and** the captured output must show **ZERO `skipped:` lines** — grep the log, do not eyeball the summary. Not theoretical: `sync_store_tests.rs:42-44` records that the hex-only `.simple()` DB names exist because UUID `Display` hyphens made `CREATE DATABASE` a syntax error and *"silently skipped every sync-store PG test"*. This exact suite has already been green while skipping everything. <!-- 2026-09-15 fourth pass: THE STATED CONDITION IS UNSATISFIABLE AS WRITTEN. A passing test's eprintln! is captured and discarded by libtest, so a default run shows ZERO skip lines even when every PG case skipped — measured: `cargo test -p oz-cloud-server sync` printed "84 passed; 0 failed" with 12 skips in it and a grep for the skip text returned only a test NAME (sqlite_unstamped_payload_is_skipped_not_flagged). The condition is only checkable as `cargo test -p oz-cloud-server sync -- --nocapture`, and its counts are 84 / 12-skipped, not 20 / 7, because the `sync` filter matches sync_api_tests.rs and main_tests.rs too — see §5 at EOF. -->

### Phase 1.1: Decompose `sync_store.rs`
- [x] Separate storage backend adapters from conflict resolution logic.
  > **Landed — but not by this agent, and only halfway.** `conflict_resolution.rs` (401 ln, pure, no
  > I/O) is imported at `sync_store.rs:42` (`use crate::conflict_resolution::{…}`), registered at
  > `main.rs:31`, added by `230642b64` (2026-09-13). What moved out is the *classifier*; the storage
  > *adapters* are still in the same file (26 `sqlite_`/`pg_` references — 16 `sqlite_` + 10 `pg_`), which is
  > what the unchecked bullet below is for. Re-counted 2026-09-14: `grep -o -E 'sqlite_|pg_' apps/cloud-server/src/sync_store.rs | wc -l` = **35**, and it was right then; re-measured 2026-09-15 it is **26** (16 + 10) — the 9 gone are 8 `pg_` names that moved into `sync_store/pg.rs` plus 1 `sqlite_` mention.
  > **So this `[x]` means CLASSIFIER OUT, ADAPTERS STILL IN — the classifier moved while the adapters
  > did not. It is PARTIAL-BY-OTHERS and must not be read as "split done"; the split is the unchecked
  > `:68` below, and it is still open.**
- [ ] Extract batch mutation application into dedicated transaction chunks.
  > Pre-existing partial: `sqlite_push_batch_multirow` (`sync_store.rs:621` today, `:615` at `7a310e013^`) and
  > `pg_push_batch_multirow` (`sync_store/pg.rs:35`, was `:691` here) were pulled out of `push_batch` (`:188`) by `0e52f1d46`
  > (2026-09-01) as a **perf** change, not as this refactor. `push_batch` still owns the dispatch.
  > **Sizing pass 2026-09-14 — read this as MOSTLY IN, not NOT STARTED. It stays unticked, because what
  > remains is ownership, not code.** Anchors re-measured 2026-09-15: `push_batch` at `sync_store.rs:188`;
  > `sqlite_push_batch_multirow` defined at `:621`, `pg_push_batch_multirow` now at `sync_store/pg.rs:35`, called
  > from `push_batch`'s two arms at **`:232`** and **`:276`**. The code's own header audit block at
  > `sync_store.rs:1-6` already states the landed state — *CS-3 FIXED — the SQLite push_batch arm now
  > runs in one transaction. PERF 2026-09: push_batch multi-row fast path …* — and `0e52f1d46`
  > (*perf(cloud): multi-row push insert fast path (PG + SQLite)*, 2026-09-01) predates **this
  > document**, which was added 2026-09-10 by `1af143f23`. **What remains, exactly:** `push_batch`
  > still owns the conflict-detection pre-pass (`:203`-`:225`), the `match self` backend dispatch
  > (`:227`), the fast-path-then-fallback decision in BOTH arms, and the whole fallback inline — the
  > SQLite loop (`:239`-`:270`) and the PG SAVEPOINT-per-item loop from `:280` — all of these moved +6 when `7a310e013` landed.
  > Ticking this box needs either that ownership extracted behind a named chunk type both adapters
  > share, or a recorded ruling that the `0e52f1d46` shape **is** the transaction chunks and the bullet
  > retires as done-by-perf. Two extracted functions are not that; do not tick on their strength.
- [x] Split the SQLite and PostgreSQL adapters out of `sync_store.rs`. **[TICKED by the fourth pass, 2026-09-15, at HEAD `503591a10` — BOTH halves are now out: `wc -l apps/cloud-server/src/sync_store.rs` = 408, and `grep -c 'fn sqlite_\|fn pg_'` over it = 0. See §2 at EOF; the note below it is superseded but kept verbatim.**
  > **Bullet added by this audit (wrong-by-omission).** The file is 1,412 ln against the 1,000-line
  > production-file ceiling in `AGENTS.md` §2, and `grep -n 'mod ' sync_store.rs` returned exactly one
  > hit (`mod tests;`, `:1757`). **Re-measured 2026-09-15: TWO hits — `mod pg;` at `:34` and `mod tests;` at `:1412` — so the claim that there is no submodule structure to inherit a split is FALSE: `sync_store/pg.rs` IS one. Three
  > separate `impl SyncStore` blocks (`:90`, `:927`, `:1112`; `:84`/`:1272`/`:1457` were their `7a310e013^` positions) confirm the file has grown by
  > accretion, not by decomposition. **2026-09-15: this box is HALF SHIPPED and the plan did not know it — `sync_store/pg.rs`, 378 ln, landed in `7a310e013` under this plan own `refactor(cloud-sync)` prefix (`:42`). NO TICK: the box asks for both halves, and the SQLite half is what remains; detail at EOF.** <!-- 2026-09-15 fourth pass: "the SQLite half is what remains" and "NO TICK" were true when written and are FALSE now — sqlite.rs landed in 8193fd3d5 the same morning, and the box is TICKED at :94. Kept verbatim as the record of what the third pass could see. Two other claims in this same note are superseded: "TWO hits" for `mod ` is now FIVE (:34 pg, :35 conflicts, :36 sqlite, :37 tenant, :408 tests), and the "three separate impl SyncStore blocks" at :90/:927/:1112 are now ONE in the parent (:99) plus three in the children (conflicts.rs:30, :215, tenant.rs:21). -->
- [ ] Verify `cargo test -p oz-cloud-server sync` passes.
  > **Sizing pass 2026-09-14 — the same condition as `:51` above, and it is the whole point of this box:**
  > "passes" is not "ran". Tick only on a run against a live `oz-pg-test-15432` whose captured output
  > contains **zero `skipped:` lines**. With the container down, 7 of the 20 cases `return` as a pass,
  > so on a default developer machine this box is greenest exactly when it has verified least.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(cloud-sync): decouple conflict resolution from sync storage backend"
  ```
  > Not exercised: `git log --format=%s | grep -c 'refactor(cloud-sync)'` = **0** (measured 2026-09-14; re-measured 2026-09-15 = **1**, the hit being
  > `7a310e013`). **[2026-09-15: the two clauses that follow were true when written and are FALSE now; they stand verbatim as evidence — the prefix HAS been used, by this plan's own `:94` work.]** No commit in this repository has used this agent's declared prefix, so none of
  > Phase 1.1's landed work was done under this work order. ← superseded: see the 2026-09-15 block at EOF.

---

> 📌 **REAL BEHAVIOUR WORK IS ELSEWHERE — named so nobody opens it here (paths verified 2026-09-14,
> all four exist).** `docs/specs/_active/p1-sync-batching-compression-retention.md`,
> `docs/specs/_active/p2-sync-priority-concurrency.md`,
> `docs/specs/_active/p3-sync-pagination-snapshot-observability.md`, and
> `docs/decisions/2026-09-02-adr43-cloud-sync-performance-scaleout-roadmap.md` (*ADR #43: Cloud Sync
> Performance & Scale-Out Roadmap*). This file is a **file-size and ownership decomposition plan**:
> Phases 1.0–1.1 move code between files and change no sync semantics. Two cautions on those links —
> the three specs carry `2026-07-22` / `2026-07-24` audit stamps reading **STALE**, re-measure before
> costing from them, and ADR43's own status line already reads *Implemented (D1–D4, D7, D9-ready) —
> remaining items deferred or infra-only* (2026-09-02). **Every box in this plan is left as found:
> `:58` ticked as partial-by-others, all others unticked, and no line target here is retired — the
> 1,412-line file still has to be split — the SQLite half of it; the Postgres half shipped in `7a310e013` without this plan knowing.** <!-- 2026-09-15 fourth pass: this sentence is now FALSE on three counts and is kept verbatim as the evidence. (a) "every box left as found" — one box was ticked by this pass, :94. (b) "still has to be split — the SQLite half of it" — the SQLite half shipped in 8193fd3d5, and two further cuts the plan never modelled shipped in f26c1afa6 (conflicts) and 846940e29 (tenant). (c) "no line target here is retired" — the line target IS retired: the ceiling this plan existed to close is closed, sync_store.rs reads 408. The failure mode named at :149-:151 ("nothing ever re-ran its own acceptance greps") has now recurred once more, at an interval of hours rather than days: this sentence was committed in 57bca12f8 and overtaken by three commits on the same date. -->

---

## Third pass — 2026-09-15 (measured; figures corrected above; ZERO ticks)

> Provenance: every figure below was measured in this checkout at HEAD `92e752666`
> (branch `0.0.39`, nothing pushed) with `wc -l` / `grep -n` / `git show`, and each is
> quoted with its command so a reader can re-run it instead of trusting it. The
> corrections above were made figure-for-figure **and line-for-line** — no line was
> added or removed inside the checklist region — so the drift map at `:5`-`:9` and the
> box lines `:59` `:67` `:76` `:94` `:100` `:105` still resolve to what they name. This
> block is at EOF, below every pointer in the file, which is the only safe place for it.

### 1. The commit this plan never saw

- `7a310e013` (2026-09-14 18:28) — **`refactor(cloud-sync): move the Postgres adapters
  into sync_store/pg.rs behind a pub(super) boundary`**. Numstat: `sync_store.rs`
  **+6 / −351**, `sync_store/pg.rs` **+378 / −0 (new file)**; 1,757 − 351 + 6 = **1,412**,
  which is the whole of the 345-line gap this pass closed. It landed under **this plan's
  own declared commit prefix** (`:42`), and neither the path `sync_store/pg.rs` nor the
  SHA `7a310e013` appeared **anywhere** in this file before this block (`git show
  HEAD:todo-refactor-cloud-sync-agents-1.md | grep -c 'sync_store/pg'` = **0**, same for
  `7a310e013` = **0**). A plan that owns a path fence, states a commit prefix, and does
  not notice the commit that used it is not out of date by carelessness: it is out of
  date because nothing ever re-ran its own acceptance greps.

### 2. `:94` is HALF SHIPPED — no tick, and here is the split line

- **Done, and unknown to the plan:** the PostgreSQL half. `sync_store/pg.rs`, **378 ln
  (358 non-blank)**, registered by `mod pg;` at `sync_store.rs:34`. Seven functions,
  measured: five `pub(super)` — `pg_push_batch_multirow:35`, `pg_pull_items:122`,
  `pg_snapshot_products:217`, `pg_snapshot_tax_rates:307`, `pg_snapshot_users:347` — and
  two module-private helpers, `pg_row_to_item:193` and `pg_bool:212`. (It is therefore
  wrong to call it "seven `pub(super)` functions": the surface is five, the file is
  seven. The difference is what a future reader will grep for.)
- **Left:** the SQLite half, still in `sync_store.rs` — seven free functions,
  `sqlite_push_batch_multirow:621`, `sqlite_pull_items:699`, `sqlite_collect_pull_rows:748`,
  `sqlite_row_to_item:767`, `sqlite_snapshot_products:787`, `sqlite_snapshot_tax_rates:856`,
  `sqlite_snapshot_users:893`.
- The split line is written in the moved file itself, `pg.rs:3`-`:5`: *"The SQLite mirrors
  of these functions, [`SyncStore`] itself and the public API stay in `sync_store.rs`,
  which still owns the [`MULTIROW_CHUNK`] constant this module batches with."* The
  coupling it names is real and measured: `use super::MULTIROW_CHUNK;` at `pg.rs:27`,
  against `const MULTIROW_CHUNK: usize = 500;` at `sync_store.rs:61`.
- **Why no tick:** the box asks for *both* adapters out. One is out, one is in, and the
  box is still 100% correct as an instruction. A tick here would send the next lane to
  the wrong half and let the ceiling (1,412 > 1,000) go unchallenged.
- The two premises this bullet rested on are now false and were corrected in place:
  `grep -n 'mod '` returns **two** lines (`:34`, `:1412`), not one; and `sync_store/pg.rs`
  **is** the "submodule structure to inherit a split" — the premise corrected at `:97`.

### 3. The `:105` milestone premise is now false, and its command text stays wrong on purpose

- The note at `:110`-`:111` asserted that **no** commit had used the `refactor(cloud-sync)`
  prefix and therefore that **none** of Phase 1.1's landed work was done under this work
  order. Both halves are superseded: `git log --format=%s | grep -c 'refactor(cloud-sync)'`
  = **1**, and that one commit is `7a310e013` — Phase 1.1 work (`:94`), done under this
  plan's own prefix. The box stays unticked and the milestone command at `:106`-`:108` is
  left **verbatim**, because a stale command line inside a milestone is *evidence* of how
  the plan drifted; silently rewriting it destroys the only trace of the mistake. The
  dated correction sits beside it instead, per the ruling established on another plan the
  same night.

### 4. What the drift did to every other coordinate (the ±6 / −345 rule)

- `7a310e013` added 6 lines to the import block (`mod pg;` at `:34`, the `use pg::{ … }` group at `:49`-`:52`) and
  deleted the PG bodies from `:691` down. So every anchor **above** the deletion moved
  **+6** and every anchor **below** it moved **−345**. Measured pairs, old → new:
  `push_batch` `:182`→`:188`; `sqlite_push_batch_multirow` `:615`→`:621`; arms
  `:226`/`:270`→`:232`/`:276`; dispatch `:221`→`:227`; pre-pass `:197-219`→`:203`-`:225`;
  fallbacks `:233-264`→`:239`-`:270`, `:274`→`:280`; `impl SyncStore` `:84`→`:90`,
  `:1272`→`:927`, `:1457`→`:1112`; `mod tests;` `:1757`→`:1412`. `pg_push_batch_multirow`
  `:691` has **no** counterpart line — it left the file.
- Consequence for anyone reading an old copy of this plan: a coordinate is not a hint, it
  is a claim about a revision. `git show <sha>:<path>` is how you keep one.

### 5. Method trap: `wc -l` totals vs non-blank ordinals

- `sync_store.rs` reads **1,412** by `wc -l` and **1,357** non-blank (55 blank lines); at
  `7a310e013^` the same file read **1,757** / **1,685**. So "1,757" was never a fabricated
  number — it was the correct `wc -l` of a real revision — but the 72-line blank gap means
  any figure in prose that does not name its method is ambiguous by that much. `:20`-`:21`
  already promises "a ±1 difference against a split-on-newline measure is method, not
  error"; ±55-72 is not ±1, and the difference is why this section exists.
- The same trap produced part of the incoming correction list. Its figures `push_batch:176`,
  `sqlite_push_batch_multirow:598` and pg.rs `:32 / :112 / :180 / :202 / :290 / :328` are
  **non-blank ordinals**, not file lines: they reproduce exactly as the non-blank position
  of the real `grep -n` lines `:188` / `:621` and `:35 / :122 / :193 / :217 / :307 / :347`.
  Recorded so nobody re-derives them: quote `grep -n`, or say "non-blank". Both are
  defensible; an unlabelled one is a coin flip for the next reader.

### 6. The sequence for the remaining half — measured seams, and the arithmetic that forces two briefs

- Four seams, read off the banners and `impl` blocks in `sync_store.rs` at `92e752666`:
  1. `:1`-`:605` — module header, imports, `MULTIROW_CHUNK:61`, and `impl SyncStore:90`
     (constructors + the public store API: `get_tenant_plan`, `push_item`, `push_batch`,
     `oldest_created_at`, `pull_items`, `pending_count`, `distinct_tenant_count`,
     `snapshot_all`, `snapshot_version`). Dispatch and shared state; it is what stays.
  2. `:607`-`:918` (**312 ln**) — the SQLite adapters. Banners `:607` *Multi-row push fast
     path* and `:691` *SQLite implementations*; the seven `sqlite_*` functions listed above.
  3. `:919`-`:1110` (**192 ln**) — conflict-row CRUD. Banner `:919`, `impl SyncStore:927`,
     `insert_conflict:929`, `list_conflicts:994`, `resolve_conflict:1060`.
  4. `:1112`-`:1406` (**295 ln**) — conflict detection + entity-vector I/O.
     `impl SyncStore:1112`, `detect_conflict:1128`, `load_entity_vector:1201`,
     `load_entity_payload:1256`, `save_entity_vector:1307`, then the two row decoders
     `conflict_row_from_sqlite:1367` and `conflict_row_from_pg:1388`. `:1408`-`:1412` is the
     `#[cfg(test)] #[path = "sync_store_tests.rs"] mod tests;` wiring.
- **One slice cannot retire the ceiling.** 1,412 − 312 (take seam 2 out to `sync_store/sqlite.rs`) =
  **1,100 — still over 1,000**. Then − 192 (seam 3 to `sync_store/conflict_rows.rs`) = **908 —
  under**. Two briefs minimum, and the order matters: seam 2 first, because `pg.rs` is its
  template and the SQLite block is the direct mirror of what already moved.
- **The template is `pg.rs`, four properties, all measured:** bodies moved unchanged; the
  surface is `pub(super)`; the shared constant comes back through `use super::MULTIROW_CHUNK`
  (`pg.rs:27`); and exactly one `mod` line is added to the parent (`sync_store.rs:34`).
- **Do NOT take the fourth cut** (seam 4 away from seam 3). The two row decoders are defined
  in seam 4 (`:1367`, `:1388`) and called from seam 3 (`:1018`, `:1050`), so that split
  creates a cross-dependency between two brand-new files instead of a seam; and the type
  they both speak, `SyncConflictRow`, belongs to `conflict_resolution.rs`, which this plan
  puts on its **forbidden list** at `:52`. A cut that needs a fenced file to compile is not
  a mechanical move.
- **Sizing, so the next dispatcher does not slot this wrong:** each of the two cuts is a
  45-90 minute mechanical move — too big for the short lane box this plan has been fed into,
  and each one touches the parent, a new child file, and the `mod` registration, so it also
  needs a cargo run to prove the crate still links. The one thing in this whole area that
  does fit a lane box is the prose correction — which is what this pass was.

### 7. Two boxes are blocked on infrastructure, not on work — `:59` and `:100` are the same leg

- Both ask for `cargo test -p oz-cloud-server sync` against a live Postgres, and the condition
  was **probed** rather than assumed — by two different hands, so the split is recorded:
  measured **in this pass**, a TCP connect to `127.0.0.1:15432` returns **Connection refused**
  (`timeout 3 bash -c '</dev/tcp/127.0.0.1/15432'` → "connect: Connection refused"). Measured
  by the **triage read that commissioned this pass**, `docker ps` fails with *"failed to
  connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine"* — this pass did
  not re-run it, being under a no-docker fence. Both readings agree: no container, therefore
  no `oz-pg-test-15432`, therefore no live Postgres for either box.
- What that does to the result: the seven `pg_integration_*` cases — `sync_store_tests.rs:272`,
  `:451`, `:515`, `:576`, `:1016`, `:1115`, `:1185` (re-verified by `grep -n 'async fn
  pg_integration'` this pass) — each take their `else { eprintln!("… skipped …"); return; }`
  arm, and a `return` inside that arm is a **pass** to cargo. "20 passed" can mean 13 ran.
  The file documents its own history of exactly that failure at `sync_store_tests.rs:42`-`:44`
  (hyphenated DB names "silently skipped every sync-store PG test").
- Therefore **`:100` is unsatisfiable here, and greener the less it verifies** — the sentence
  at `:102`-`:104` stands and is the reason neither box may be ticked from a summary line.
  `:59` inherits the identical condition; the only honest state for both is *valid command,
  unrunnable environment*.
- **`:76` is blocked on a ruling, not on a lane.** It needs the owner to say whether the
  `0e52f1d46` multirow extraction (`sqlite_push_batch_multirow` + `pg_push_batch_multirow`)
  already **is** the "dedicated transaction chunks" answer, in which case the bullet retires
  as done-by-perf; or whether `push_batch` must give up the pre-pass, the dispatch at `:227`
  and both inline fallbacks (`:239`-`:270`, `:280`+) behind a named chunk type. `:93` already
  forbids ticking on the strength of the two extracted functions, so a lane cannot resolve
  this — it can only produce the diff that makes the ruling cheap.

### 8. Counts, and the things that did **not** go stale

- Boxes before and after this pass, both grep forms (`grep -cE '^[[:space:]]*- \[ \]'` and
  `grep -cE '^- \[ \]'`; same pair for `\[[xX]\]`): **open 5 / 5 → 5 / 5** (`:59`, `:76`,
  `:94`, `:100`, `:105`), **ticked 1 / 1 → 1 / 1** (`:67`, partial-by-others). Zero ticks
  were made here. The file was **126 ln** by `grep -c ''` before this block as well.
- Re-measured and **still true**, so nobody "fixes" them: `sync_api.rs` **800**,
  `sync_api_tests.rs` **2,525**, `sync_store_tests.rs` **1,386**, `conflict_resolution.rs`
  **401**, **20** `#[tokio::test]` / **0** plain `#[test]` in `sync_store_tests.rs`, **26**
  `VersionVector` references across `apps/cloud-server/src`, `conflict_resolution` registered
  at `main.rs:31`, and the header audit block still at `sync_store.rs:1`-`:6`. Only the
  `sync_store.rs` coordinates moved — exactly what one commit touching that file and its new
  child should do.
- **Is this plan now an accurate description of `apps/cloud-server/src/sync_store*`?** Its
  **figures** are, at `92e752666`, each with its command and its revision. Its **structure**
  is: `sync_store.rs` (1,412) + `sync_store/pg.rs` (378) + `sync_store_tests.rs` (1,386)
  wired by `#[path]` at `:1410`-`:1412`. Its **status** is not, and cannot be made so here:
  `:59`/`:100` are unrunnable on this machine, `:76` waits on a ruling, `:94` is half open,
  and `:105`'s milestone has never been exercised. A plan can be corrected into accuracy
  about the tree and still be wrong about what is left to do — that is the remaining gap, and
  it is now written down instead of being discovered.

---

## Fourth pass — 2026-09-15 (measured at HEAD `503591a10`; **ONE tick**)

> Provenance: every figure below was measured in this checkout at HEAD `503591a10`
> (*fix(sales): center the empty cart state in the cart lines area*, 2026-09-15 21:00 +0700,
> branch `0.0.39`), each quoted with the command that re-derives it. In-place edits made by
> this pass were **character-level only** — one `[ ]`→`[x]` and five `<!-- -->` clauses appended
> to existing lines — so the file stood at **301 ln after every in-place edit** (547 with this
> block appended below them), the drift map at `:5`-`:9` and the box
> lines `:59` `:67` `:76` `:94` `:100` `:105` all still resolve to what they name (re-checked),
> and this block sits at EOF, below every pointer in the file. The working tree was NOT clean
> while this pass ran (`crates/oz-payment/*` and three sibling plan docs carried other sessions'
> uncommitted edits), so code figures are a read of a dirty tree — except that
> `git status --porcelain -- apps/cloud-server` was **empty**, which is what makes the
> `sync_store*` numbers safe to quote as HEAD facts.

### 1. Three commits landed after the pass that measured this file

The third pass was committed as `57bca12f8` and stated its measurements at HEAD `92e752666`.
Three more commits landed *after* `57bca12f8`, all on 2026-09-15, all inside this plan's own path
fence, all under this plan's own declared prefix (`:42`) — verified by
`git merge-base --is-ancestor 57bca12f8 <sha>` (exit 0 for all three):

| SHA | time | subject | numstat (`sync_store.rs` → child) |
|---|---|---|---|
| `f26c1afa6` | 08:12 | move the conflict rows out of the sync store behind a submodule | `+2 / −494` → `sync_store/conflicts.rs` **+509 (new)** |
| `8193fd3d5` | 09:36 | move the sqlite seam behind a second submodule of the sync store | `+8 / −313` → `sync_store/sqlite.rs` **+332 (new)** |
| `846940e29` | 10:02 | move the five per-tenant bookkeeping queries into sync_store::tenant | `+5 / −212` → `sync_store/tenant.rs` **+233 (new)** |

The arithmetic closes exactly, and this is the only figure set in this document that does *not*
require a revision to interpret: 1,412 − 494 + 2 = 920 · 920 − 313 + 8 = 615 · 615 − 212 + 5 =
**408**, against `wc -l apps/cloud-server/src/sync_store.rs` = 408. A companion
`style(cloud-sync)` commit, `821c16592`, sits between the first two and rustfmt'd the moved
imports. `git log --format=%s | grep -c 'refactor(cloud-sync)'` reads **4**, against the **1**
recorded at `:182`-`:183`.

The recurrence is the point. `:149`-`:151` diagnosed this plan's staleness as *"nothing ever re-ran
its own acceptance greps"*. The re-check was written down, and then the same drift happened again
**within the same calendar day, at an interval of hours.** Note what the third pass got *right*:
`:234` already names the target file by the name it actually got — *"take seam 2 out to
`sync_store/sqlite.rs`"* — and that file landed with that name eight hours after the sentence was
committed. What it never recorded, because nothing re-grepped: `conflicts.rs`, `tenant.rs`,
`f26c1afa6`, `8193fd3d5`, `846940e29` each occur **0 times** in this file outside §1 above.

### 2. `:94` is TICKED — both halves are out, and the split line is not the one this plan drew

`wc -l` at HEAD, with non-blank from `grep -c '[^[:space:]]'`:

| file | ln | non-blank | surface |
|---|---|---|---|
| `sync_store.rs` | **408** | 390 | dispatch enum, 2 constructors, `push_item:120`, `push_batch:163`, `pull_items:342`, `snapshot_all:370` |
| `sync_store/conflicts.rs` | 509 | 492 | two `impl SyncStore` blocks (`:30`, `:215`), 4 `pub` fns, 2 row decoders (`:470`, `:491`) |
| `sync_store/pg.rs` | 378 | 358 | 5 `pub(super)` + 2 private |
| `sync_store/sqlite.rs` | 332 | 314 | 5 `pub(super)` + 2 private |
| `sync_store/tenant.rs` | 233 | 226 | one `impl SyncStore` (`:21`), **zero** `pub(super)` |

`grep -n 'mod ' apps/cloud-server/src/sync_store.rs` → **five** hits (`:34` `pg`, `:35`
`conflicts`, `:36` `sqlite`, `:37` `tenant`, `:408` `tests`), against the two the note at `:97`
records. And the parent holds **no adapter definition at all**: `fn sqlite_` / `fn pg_` → 0
matches; the 14 lines / 20 matches (`grep -o -E 'sqlite_|pg_'`, 10 of each) are import names
(`:56`-`:57`, `:61`-`:62`) and call sites (`:207`, `:251`, `:352`, `:360`, `:384`-`:386`,
`:395`-`:397`). That is what the box asks for, so it is ticked.

The SQLite half is the **exact mirror** of `pg.rs`, down to the surface arithmetic the third pass
flagged as a future grep trap at `:159`-`:161` — seven functions, five `pub(super)`, two
module-private (`sqlite_collect_pull_rows:163`, `sqlite_row_to_item:182`) — and its own header
states the same "the parent calls five of them" reasoning (`sqlite.rs:10`-`:12`).

**But two of the three new cuts do not follow `pg.rs`'s shape at all**, and the third pass's §6 called that shape
"the template, four properties, all measured" (`:238`-`:240`). `conflicts.rs` and `tenant.rs` move
`impl SyncStore` *blocks*, not free functions: no `pub(super)` surface exists to declare and no
`use super::…` back-import. `tenant.rs:8`-`:10` says so deliberately — *"nothing is re-exported: a
method resolves through the type, not through the module path, and each of the five was already
`pub`."* `conflicts.rs:12`-`:13` records the one visibility question the split really raised, with
its answer: *"`detect_conflict` is the single edge back into the parent's `push_batch`; it is `pub`,
so the seam needs no widened visibility."* Of the four template properties, only "exactly one `mod`
line is added to the parent" held across all three cuts. The `MULTIROW_CHUNK` coupling named at
`:169`-`:170` is real and now **doubled** — the constant moved `:61`→`:70`, and both `pg.rs:27` and
`sqlite.rs:20` carry `use super::MULTIROW_CHUNK;` — while `conflicts.rs` and `tenant.rs` reference
it **0** times, which is precisely why those two were separable without touching it.

### 3. The ceiling this plan existed to close is closed; `:76` is all that's left of the work order

`AGENTS.md:181` reads *"Keep production `.rs` files under 1,000 lines (preferably < 600 lines)"* —
quoted with its line because the checklist cites it as "§2" without one. Every one of the five
files above is **under 600**, so this plan now satisfies the preference, which no box here ever
asked for. The largest *production* file in the crate is no longer a sync-store file: `webhooks.rs`
at **927**. The files still over 1,000 in `cloud-server/src` are all test files — `sync_api_tests`
2,525, `sync_store_tests` 1,386, `webhooks_tests` 1,348, `email_pg_tests` 1,300, `openapi_tests`
1,160, `main_tests` 1,116 — and `:181` scopes its ceiling to *production* files, so none is a
violation. **`:15`'s sales pitch ("funding it buys §2 compliance") is therefore spent**: there is
no line-count target left for this plan to own.

The one box that remains genuinely open is `:76`, and its coordinates moved again. At `503591a10`:
`push_batch` defined at `:163` (was `:188`), conflict pre-pass `:178`-`:200`, `match self` dispatch
at `:202`, SQLite arm `:203` with fast path called at `:207` and its single-transaction fallback
inline at `:214`-`:245` (`tx.commit()` `:244`), PG arm `:247` with fast path at `:251` and its
SAVEPOINT-per-item loop from `:255` to commit at `:333`. The ownership described at `:87`-`:93` is
**unchanged in substance** — pre-pass, dispatch and both fallbacks are still `push_batch`'s — and
the ruling `:76` waits on is still unmade. That pass's §6 arithmetic is now moot rather than wrong: it
forecast "two briefs minimum" and three landed, and it forecast a 908-line parent against a real
408.

One prediction of that §6 *was* tested and held. `:241`-`:246` forbade taking seam 4 away from seam 3,
because the row decoders are defined in seam 4 and called from seam 3. `f26c1afa6` moved **both**
seams into **one** file (192 + 295 ≈ 487, against 509 with its header), so the decoders
(`conflicts.rs:470`, `:491`) travelled with their callers and no cross-dependency between two new
files was created. That prohibition was a real constraint read off real code, and the executing
lane honoured it.

### 4. What the third pass's §6 seam model missed: a fifth seam, and an order it had backwards

`:221`-`:224` describes seam 1 (`:1`-`:605`) as *"Dispatch and shared state; **it is what stays**"*
and then builds the two-brief arithmetic on that. `tenant.rs` came out of it — five read-only
per-tenant queries (`get_tenant_plan`, `oldest_created_at`, `pending_count`,
`distinct_tenant_count`, `snapshot_version`) that are neither adapters nor conflict rows nor batch
application, and so had no seam in this plan's map. A four-seam decomposition of a file is a claim
about where the banners are, not about what is removable.

The order prediction failed harmlessly. `:236`-`:237`: *"the order matters: seam 2 first, because
`pg.rs` is its template."* Actual order was **conflicts → sqlite → tenant** — the
template-following cut went second, and nothing broke. Order mattered for the *line-number
bookkeeping* (that pass's §4 ±6 / −345 rule) and not for correctness; the sentence conflated the two.

The honest total: the module is **1,860 ln** across five files against the **1,790** measured at
`92e752666`, so the decomposition has cost **+70 lines** of headers, import blocks and `mod`
wiring — the real price of the compliance this plan was funded to buy, and it appears in no
estimate here.

### 5. The tick conditions at `:59` and `:100` are **unsatisfiable as written** — this pass ran the command

`:64` and `:102`-`:104` both condition a tick on *"the captured output must show **ZERO `skipped:`
lines** — grep the log, do not eyeball the summary"*. **That grep cannot fail.** libtest captures
and discards a *passing* test's stdout/stderr, and each of these cases prints its skip message and
then `return`s — a pass. Measured at this HEAD, container down:

```
$ cargo test -p oz-cloud-server sync 2>&1 | grep -c 'skipped'
1        # …and the single hit is a TEST NAME: sqlite_unstamped_payload_is_skipped_not_flagged
$ cargo test -p oz-cloud-server sync 2>&1 | grep 'test result'
test result: ok. 84 passed; 0 failed; 0 ignored; 0 measured; 267 filtered out; finished in 51.17s
```

Zero skip lines, exit 0, and **twelve cases did not run**. With the flag that makes the messages
visible, the same command reports itself honestly:

```
$ cargo test -p oz-cloud-server sync -- --nocapture     # → 12 "test skipped" lines, 84 ok
7 × "cannot create throwaway DB"        sync_store_tests.rs  (the 7 this plan enumerates)
4 × "Connection error: … pool.get() …"  sync_api_tests.rs:931, :1831/:1845/:1866, :2419
1 × "Connection error: … pool.get() …"  main_tests.rs:1002
```

**84 passed, 12 skipped, 72 actually ran.** Three corrections to the plan's own account, and the
third is the finding rather than a figure:

1. The `sync` **substring filter is crate-wide**, not the file-scoped 20 cases of `:61`-`:64`. It
   selects `sync_store::tests::*`, `sync_api::tests::*`, `tests::sync_*`, and
   `tests::pg_integration_health_last_sync_query_is_indexed`. "20 passed can mean 13 ran" is true
   of that file and understates that command: **84 can mean 72**.
2. **Twelve cases skip, not seven.** The third pass's §7 enumerated one file and never looked at
   the other two the same command runs. Its seven are right *for `sync_store_tests.rs`* — still `:272`, `:451`,
   `:515`, `:576`, `:1016`, `:1115`, `:1185`, re-verified by `grep -n 'async fn pg_integration'`.
3. **The acceptance condition is vacuous and must be rewritten with `-- --nocapture` or dropped.**
   A lane that follows `:64` to the letter on a machine with no Postgres gets the greenest possible
   reading out of the run that verified the least: the plan's own trap at `:103`-`:104`, armed by
   the plan's own instruction for escaping it.

Both boxes stay **unticked**, but the reason changed — not "valid command, unrunnable environment"
but *"valid command, ran, 84 passed / 0 failed, and 12 of its cases verified nothing."* The
container is still down: TCP connect to `127.0.0.1:15432` **refused** (probed twice this pass),
`OZ_TEST_PG_URL` unset.

What this pass *can* certify, and it is the part of `:59`/`:100` that never needed Docker:
`cargo check -p oz-cloud-server --all-targets` → **exit 0** (7.08s). `--all-targets` compiles the
`#[cfg(test)]` wiring too, so this proves `sync_store_tests.rs` still typechecks as a `#[path]`
child of a file that has since given away four modules (wiring at `:406`-`:408`). That pass's §6 asked for "a
cargo run to prove the crate still links" for each cut. **It links.**

### 6. Coordinates: the third pass's §4 ±6 / −345 rule is obsolete; the whole map is now wrong

Every `sync_store.rs` pointer in this file predates three more commits, so the ±6 / −345 rule at
`:193`-`:199` describes a shift that has since been overlaid twice. Do not apply it — use this
table (`old` = the coordinate printed in this plan's checklist and its §6 text):

| item | old (in-text) | new at `503591a10` |
|---|---|---|
| `MULTIROW_CHUNK` | `:61` | **`:70`** |
| `mod` lines | `:34` | **`:34`-`:37`** (four children) + `:408` |
| `impl SyncStore` (parent) | `:90` | **`:99`** (plus `conflicts.rs:30`, `:215`, `tenant.rs:21`) |
| `push_batch` | `:188` | **`:163`** |
| conflict pre-pass | `:203`-`:225` | **`:178`-`:200`** |
| backend dispatch | `:227` | **`:202`** |
| SQLite fast-path call / arm | `:232` / `:239`-`:270` | **`:207`** / **`:203`-`:245`** |
| PG fast-path call / arm | `:276` / `:280`+ | **`:251`** / **`:247`-`:333`** |
| `sqlite_push_batch_multirow` | `sync_store.rs:621` | **`sync_store/sqlite.rs:36`** |
| `pull_items` / `snapshot_all` | — | **`:342` / `:370`** |
| `mod tests;` | `:1412` | **`:408`** (wiring `:406`-`:408`) |
| seams 2 / 3 / 4 as ranges | `:607`-`:918` / `:919`-`:1110` / `:1112`-`:1406` | **the ranges no longer exist** — they are three child files (§2) |

**Still true, re-measured, so nobody "fixes" them:** `sync_api.rs` **800**, `sync_api_tests.rs`
**2,525**, `sync_store_tests.rs` **1,386**, `conflict_resolution.rs` **401**, `main.rs`
registrations (`conflict_resolution:31`, `sync_api:47`, `sync_store:48`), **20** `#[tokio::test]` /
**0** plain `#[test]` in `sync_store_tests.rs`, the header audit block still at `sync_store.rs:1`-
`:6`, and the seven `pg_integration` anchors at `:64`. One figure needs its unit stated, per §5 of
the last pass: `VersionVector` in `apps/cloud-server/src` is **26** by
`git grep -n VersionVector apps/cloud-server/src | wc -l` — unchanged — but **27** by `grep -o`
match count (`conflict_resolution.rs` 10 + `conflict_resolution_tests.rs` 12 +
`sync_store/conflicts.rs` 5), because one line carries two. The distribution moved: those 5 left
`sync_store.rs` in `f26c1afa6`.

### 7. The Goal's second file has never been tasked, and it is the only live work here

`sync_api.rs` is 800 ln — **under** the 1,000 ceiling, so no compliance pressure — but **200 over**
the `:181` "preferably < 600" preference, and it has no submodule (`apps/cloud-server/src/sync_api/`
does not exist; the file's only `mod` line is `mod tests;` at `:800`). It appears in the Goal
(`:13`) and in the owned fence (`:45`) and **in zero boxes**: the plan states a two-file objective
and phases one of them. If this plan stays live, the `sync_api` decomposition is its remaining
scope and needs a phase written for it. If not, the Goal should say so and the file should sit
beside its two siblings.

### 8. Status of every box, and the disposition this pass recommends

| box | was | now | basis |
|---|---|---|---|
| `:59` baseline | open | **open; condition rewritten** | ran: 84 passed / 12 skipped / 72 real — `--nocapture` required |
| `:67` classifier out | `[x]` partial-by-others | **unchanged** | `conflict_resolution.rs` still 401, still imported |
| `:76` tx chunks | open | **open; still a ruling, not a lane** | `push_batch` still owns pre-pass + dispatch + both fallbacks (§3) |
| `:94` split adapters | open ("half shipped") | **TICKED `[x]`** | both halves out, parent 408 ln, 0 adapter definitions |
| `:100` verify passes | open | **open; same rewritten condition** | exit 0 but 12 vacuous passes; port 15432 refused |
| `:105` milestone | open | **open and void** | 4 `refactor(cloud-sync)` commits, none with this subject — and the command at `:106`-`:108` carries **no pathspec**, which `AGENTS.md` §3 forbids; a milestone a lane may paste is a milestone that teaches the violation |

Open/ticked, both grep forms (`grep -cE '^[[:space:]]*- \[ \]'` and `…'\[[xX]\]'`), before → after:
**open 5 → 4** · **ticked 1 → 2**. One tick was made here, at `:94`, and it is the first tick in
this document's history — every prior pass recorded "ZERO ticks".

**Disposition.** This plan has delivered the only thing `:15` said it was for, so it should be
either **retired** — renamed to `done-todo-refactor-cloud-sync-agents-1.md` beside Agents 2 and 3,
with `:76` handed to the owner as a one-line ruling and the `--nocapture` fix applied to
`:64`/`:102` on the way out — or **re-scoped** onto `sync_api.rs` with a real phase. What it must
not be is left standing as a live work order whose headline figure (1,412), whose central box
("half shipped"), whose §6 seam map and §7 skip count — both drawn by the pass before this one — are now all false, because the next
reader costs the work from those numbers, and there is nothing left to cost. This pass touched no
code and no test file: it ticked one box, appended five dated clauses, and ran one `cargo check`,
four `cargo test` invocations — the fourth being a malformed `--lib` request that errored, since
this package has no library target and all its unit tests live in the binary — and one TCP probe
run twice.
