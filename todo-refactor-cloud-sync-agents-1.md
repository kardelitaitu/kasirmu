# Orchestrator Agent 1: Cloud Sync Engine & Protocol Handler

<!-- Audit stamp: 2026-09-14 · DSH · status: INACCURATE -> CORRECTED · corrections applied: 12 · the fence named `apps/cloud-server/src/bin/migrate_sqlite_to_pg.rs`, a single file that does not exist — it became a module DIRECTORY at `2c35ec1a2` — and the `sync_store.rs` baseline was ~578 lines stale; both found by globbing `apps/cloud-server/src/**/*.rs` and re-measuring with `wc -l` instead of trusting the prose. -->

> **Line-number drift from the sizing pass (2026-09-14): the bullets that pass cites by line have
> moved, so both forms appear in this file and this is the map as of THIS pass's final write —
> `:51` now `:59` · `:58` now `:67` · `:64` now `:76` · `:68` now `:94` · `:74` now `:100`. Re-derive before quoting one of these pointers
> after any further edit: a line reference is only true of the revision it was taken from, which is
> the failure class every note below exists to prevent.**

**Document:** `todo-refactor-cloud-sync-agents-1.md` — **STATE, 2026-09-15 (fourth pass): sizing gate MET, acceptance UNRUN, and therefore deliberately NOT renamed.** `AGENTS.md` §4 is what decides this and it says the two halves plainly: `done-todo-*` "is earned ONLY when that file's own acceptance command was RUN and PASSED," and the states that are not that — parked, superseded, an audit that keeps items open — "belong in a **dated header line**, never in the filename." This plan's acceptance command is `cargo test -p oz-cloud-server sync` under the condition `:64`/`:102` set, and that condition fails: the run exits 0 at 84 passed / 0 failed, but 12 cases skipped (`§5` at EOF), and a zero-skip condition is not met by a run with twelve skips. So `:59`/`:100` stay open, the name stays `todo-`, and the four `refactor(cloud-sync)` commits plus the §9 ruling are what this file reports as done — not what it is renamed for. Renaming it now would put the *completed-decomposition* axis into a token that names the *acceptance-run* axis, which is exactly the category error §4's "one axis, five states" sentence exists to block. (A fourth-pass edit briefly wrote the `done-` name on this line before §4 was read; that claim is retracted here rather than committed, and §9's disposition is corrected to match.)  
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
  > **Sizing pass 2026-09-14 — and the command as written cannot be honestly ticked whatever the pass count reads.** Of the 20 `#[tokio::test]` cases in `sync_store_tests.rs`, **SEVEN** `pg_integration_*` cases (`:272`, `:451`, `:515`, `:576`, `:1016`, `:1115`, `:1185`) open with `let Some((pool, db_name)) = throwaway_pool().await else { eprintln!("… skipped: cannot create throwaway DB"); return; };` — at `:273`, `:452`, `:516`, `:577`, `:1017`, `:1116`, `:1186`. **A `return` inside the `else` arm is a PASS to cargo, not a test that ran: "20 passed" can mean "13 ran".** Condition for a tick: container **`oz-pg-test-15432`** up (`scripts/reset-dev-pg.sh` names it; the suite dials `postgres://postgres:postgres@localhost:15432/postgres` unless `OZ_TEST_PG_URL` is set — `sync_store_tests.rs:15-16`), **and** the captured output must show **ZERO `skipped:` lines** — grep the log, do not eyeball the summary. Not theoretical: `sync_store_tests.rs:42-44` records that the hex-only `.simple()` DB names exist because UUID `Display` hyphens made `CREATE DATABASE` a syntax error and *"silently skipped every sync-store PG test"*. This exact suite has already been green while skipping everything. <!-- 2026-09-15 fourth pass: THE STATED CONDITION IS UNSATISFIABLE AS WRITTEN. A passing test's eprintln! is captured and discarded by libtest, so a default run shows ZERO skip lines even when every PG case skipped — measured: `cargo test -p oz-cloud-server sync` printed "84 passed; 0 failed" with 12 skips in it and a grep for the skip text returned only a test NAME (sqlite_unstamped_payload_is_skipped_not_flagged). The condition is only checkable as `cargo test -p oz-cloud-server sync -- --nocapture`, and its counts are 84 / 12-skipped, not 20 / 7, because the `sync` filter matches sync_api_tests.rs and main_tests.rs too — see §5 at EOF. CORRECTED INSTRUCTION, supersedes the sentence above for any lane ticking this box: run `cargo test -p oz-cloud-server sync -- --nocapture` and require ZERO `test skipped` lines; on this repo's tip with the container down it reads 84 ok / 12 skipped, so 72 ran. `-- --nocapture` is already the house convention for exactly this — every `docs/specs/**/validation.md` command line carries it, and `apps/desktop-client/src/commands/registration_gate_tests.rs:1466` documents the same capture trap. -->

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
- [x] Extract batch mutation application into dedicated transaction chunks. **[RETIRED BY OWNER RULING, 2026-09-15 — the `0e52f1d46` shape IS the answer, so the bullet closes as done-by-perf. Ruling given by the human in the session that wrote the fourth pass, which is the only party entitled to give it: `:93` forbids a LANE from ticking here. Evidence and the safety argument at §9 at EOF.]**
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
  > so on a default developer machine this box is greenest exactly when it has verified least. <!-- CORRECTED 2026-09-15 fourth pass: the grep above cannot see a skip without `-- --nocapture`, and the count is 12 across three files, not 7 in one — see §5 at EOF. Box stays open: it needs the container, which is an owner action (`scripts/reset-dev-pg.sh:19`-`:21`), not a lane action. -->
> ~~**Commit Milestone:**~~ — **VOID · STRUCK FROM THE CENSUS, 2026-09-15 fourth pass. NOT WORK, and not ticked, because a tick claims a completion and this row was never completable.** Three reasons, in the order a reader will ask them. (1) *Its subject can never be earned:* the work it names landed as `230642b64` (*feat(sync-cloud): classify concurrent sync mutations and persist conflict rows*, the classifier) and `7a310e013` (the PG adapters), under two other prefixes, before this milestone was ever exercised — `git log --format=%s | grep -c 'decouple conflict resolution from sync storage backend'` = **0**. (2) *Its command text is a rule violation:* the line at `:107` carries **no pathspec**, which `AGENTS.md` §3 forbids — "the only permitted commit form is ONE line with an explicit pathspec" — so a milestone written to be pasted is a milestone that teaches the violation. (3) *A row that can be neither done nor undone is not a debt:* this is the disposition `todo-open-debt-program.md:115` already applies to its own "Commit milestones" box ("NOT WORK … it restates a rule that already binds every worker … counted here as not-work rather than as a debt"), and the same page's `:378` records the discipline that makes it safe — a retired row stays **un-ticked with its reason**, "exactly so a later reader cannot mistake a retired row for a paid one." That is why this row lost its checkbox rather than gaining an `[x]`, and why it is excluded from the census at §8/§9. **The fenced command at `:106`-`:108` and the note at `:109`-`:111` are left verbatim below, per this file's own rule at `:184`-`:186`:** a stale command inside a milestone is evidence of how the plan drifted, and rewriting it destroys the only trace of the mistake.
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

## Fourth pass — 2026-09-15 (measured at HEAD `503591a10`; **two ticks, one ruling, one strike — and NO rename, because `AGENTS.md` §4 blocks it**)

> Provenance: every figure below was measured in this checkout at HEAD `503591a10`
> (*fix(sales): center the empty cart state in the cart lines area*, 2026-09-15 21:00 +0700,
> branch `0.0.39`), each quoted with the command that re-derives it. In-place edits made by
> this pass were **line-count-neutral only** — two `[ ]`→`[x]` ticks, dated `<!-- -->` clauses on
> **six** existing lines (`:13`, `:44`, `:64`, `:99`, `:104`, `:126` — seven clauses, since `:64`
> carries two), and one box line **converted to a struck non-box row** at `:105`, which retires it
> from the census without claiming a completion — so the checklist region kept its height exactly:
> it still occupies **`:1`-`:301`**, which is where the third pass left it, so no pointer above this
> block moved an inch, and the drift map at `:5`-`:9` and the box
> lines `:59` `:67` `:76` `:94` `:100` all still resolve to what they name, with `:105` now
> resolving to its own strike (each re-checked after every edit),
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

### 8. Status of every box, and the disposition — recommended one way, then corrected by `AGENTS.md` §4

| box | was | now | basis |
|---|---|---|---|
| `:59` baseline | open | **open; condition rewritten** | ran: 84 passed / 12 skipped / 72 real — `--nocapture` required |
| `:67` classifier out | `[x]` partial-by-others | **unchanged** | `conflict_resolution.rs` still 401, still imported |
| `:76` tx chunks | open | **CLOSED BY OWNER RULING** | retired as done-by-perf; the safety case is §9 |
| `:94` split adapters | open ("half shipped") | **TICKED `[x]`** | both halves out, parent 408 ln, 0 adapter definitions |
| `:100` verify passes | open | **open; same rewritten condition** | exit 0 but 12 vacuous passes; port 15432 refused |
| `:105` milestone | open | **STRUCK — void, deliberately NOT ticked** | unsatisfiable: its subject has 0 hits in `git log --format=%s`, and its command at `:106`-`:108` carries **no pathspec**, which `AGENTS.md` §3 forbids. Reasoning and precedent at the row itself |

Open/ticked, by the canonical pair this tree names at `todo-open-debt-program.md:360`-`:361`
(`grep -cE '^[[:space:]]*[-*][[:space:]]+\[[[:space:]]\]'` for open, `…\[[xX]\]` for ticked — the
bracket-escaped forms, because an unescaped `[ ]` in ERE is a bracket expression matching one space
and silently returns 0): at the start of this pass **open 5 / ticked 1 / total 6**; after ticking
`:94`, **4 / 2 / 6**; after the §9 ruling on `:76`, **3 / 3 / 6**; after striking `:105`, **2 / 3 /
5**. Two ticks were made here, `:94` and `:76`, and they are the first and second in this document's
history — every prior pass recorded "ZERO ticks". **The strike is a different arithmetic from a
tick, and the difference is the whole point of §4's one-axis rule:** a tick moves open −1 / ticked
+1 / total unchanged, a strike moves open −1 / ticked +0 / total −1, so a completion and a
retirement look identical in an open count and cannot be confused in a census that prints its
denominator. `todo-open-debt-program.md:371` states the tick case; this row is the strike beside it.
  - **And that canonical pair is a BASH command — running it through a Windows shell is the next trap
    in this family, measured here rather than warned about generically.** PowerShell's
    `Select-String -Pattern '^[[:space:]]*[-*][[:space:]]+\[[[:space:]]\]'` returns **0** on this
    file, which holds **2** open boxes, because `[[:space:]]` is a POSIX class the .NET engine reads
    as a bracket expression over the literal characters `[:space]` — so it asks for a hyphen plus one
    of *those* characters and finds none. The `\s` form I ran beside it
    (`'^\s*[-*]\s+\[\s\]'` and `'…\[[xX]\]'`) reproduces the bash pair exactly: **2 open / 3 ticked**.
    Same silent zero, different cause from the unescaped-bracket artifact
    `todo-open-debt-program.md:364` documents — that one is escaping, this one is regex dialect — so a
    census from a PowerShell lane needs the engine named beside it, not just the pattern.

### 9. Rulings applied, the rename refused by §4, and the one repair that outgrew this plan

**`:76` — RETIRED AS DONE-BY-PERF, on the owner's ruling given in the session that wrote this
pass.** `:93` ruled that no lane may tick this box on the strength of the two extracted functions,
and it was right to write it that way: the thing `:93` was protecting against is a lane
*self-certifying* a design question closed. The ruling now on record is not a lane's. The
substantive case, which is what made the ruling cheap enough to get:

- The bullet asks for "dedicated transaction chunks," and `0e52f1d46` delivered exactly that
  reading — `MULTIROW_CHUNK`-sized statements (500 rows, `sync_store.rs:70`) each in one
  transaction, per backend, with per-item outcomes reconstructed from the returned-id multiset.
  The header audit block at `sync_store.rs:1`-`:6` already states it that way.
- What remains is `push_batch` owning its pre-pass (`:178`-`:200`), its dispatch (`:202`) and its
  two fallbacks (`:214`-`:245`, `:255`-`:333`). That is a **shape preference inside a 408-line
  file**, not a ceiling violation — §3 closed the only pressure that made this plan worth funding.
  A named chunk type would buy readability, and nothing else.
- **And it would be unsafe to buy here.** The PG SAVEPOINT fallback is guarded by exactly three
  tests: `pg_integration_push_batch_duplicate_in_middle_survives`,
  `…_commit_visible_to_new_connection`, `…_data_error_does_not_abort_batch`. All three are in the
  12 that skipped in §5's run. The SQLite fallback's guards —
  `sqlite_push_batch_commits_atomically_and_rejects_dups`, `…_matches_per_item_semantics` — did
  run. So in this checkout one fallback is testable and the other is not, and a mechanical-move
  brief against `:255`-`:333` would be a blind edit to the hottest write path in the crate. That
  asymmetry, not taste, is the reason to close the box rather than schedule it.

**`sync_api.rs` — NO SUCCESSOR PLAN, on the same ruling.** It stays in the Goal's shadow at 800
lines: under the 1,000 ceiling (no policy pressure), 200 over the `AGENTS.md:181` preference
(discretionary). This document's own `:15` honesty pass argues the general case — a file-size split
buys no better sync — so opening a phase to split `sync_api.rs` would contradict the one conclusion
this plan earned. If it is ever split, let it be pulled by a behaviour change that needs the seam.

**The durable repair, found here and filed elsewhere.** While sizing §5's fix, the sweep came
back much bigger than this plan. **Forty-seven** silent-skip arms — `else { eprintln!("… test
skipped …"); return; }`, the shape that reports a pass to cargo and hides its own message — across
**nine** files in `apps/cloud-server/src`: `email_pg_tests` 12, `db_tests` 9, `sync_store_tests` 7,
`prune_tests` 5, `sync_api_tests` 5, `webhooks_tests` 3, `main_tests` 2, `redis_backend_tests` 2,
`migrate_sqlite_to_pg_tests` 2. Only 12 of the 47 sit inside Agent 1's fence. **Scope of that number, so it is not over-read as the tree's:** 47 is `apps/cloud-server` alone, which is all this plan's sweep looked at. The wider query `git ls-files '*.rs' | Select-String 'eprintln!\("[^"]*[Ss]kipped'` returns **66 strings / 64 test arms across 12 files in 3 crates** — `crates/oz-api` adds 13 and `platform/sync` adds 4 — and Phase 5's own fence was widened to that figure by the sweep that found it.

And **the repair this pass first proposed was wrong in a harmful direction, which is why it was not
filed until it had been checked.** The draft claim was: *"the repo already owns the right mechanism
— `platform/sync/tests/pg_integration.rs:112`,`:146` use `#[ignore = "requires a disposable
PostgreSQL instance"]` — so convert the 47."* Two measurements killed it:

- **CI has a Postgres service.** `dev-ci.yml:205`-`:218` declares `postgres:17-alpine` with
  `ports: 5432:5432` and a `pg_isready` healthcheck, and `:219`-`:220` sets `OZ_TEST_PG_URL` at
  **job level**, reaching `cargo nextest run --workspace --all-features` at `:244`. The arms' own
  guard prefers that variable (`sync_store_tests.rs:15`-`:16`), so **in CI those arms connect and
  those tests run.** "Invisible" above is therefore a property of *this machine*, not of the
  repository, and every count in §5 and here is a local count.
- **`#[ignore]`ing them would delete them from CI.** `git grep -n -e '--run-ignored' -e
  'run-ignored' -- scripts .github` → **0**: nothing opts ignored tests back in, so the conversion is
  **−45 PG cases in the only environment that executes them** — including
  `pg_integration_conflict_tables_enforce_tenant_isolation` and the email/webhook RLS cases. A change
  that reads as tidiness and removes the crate's Postgres tenant-isolation surface is precisely the
  failure this file's own `:15` honesty clause exists to prevent: buying a better-looking report and
  selling behaviour.

So the filed item is narrower, and the defect is an **asymmetry** rather than the arms: Redis is
honestly `#[ignore]`d with the reason string "disabled in dev CI" (`redis_backend_tests.rs:96`,
`:127`,`:141`) because `dev-ci.yml` genuinely has no Redis service, while PG runs in CI and is
labelled nowhere. Converting the 47 is a cross-owner change to test semantics with a CI surface, not a
docs edit, and it belongs to no plan here — this one closes its decomposition mandate having *found*
it, and filed it where a lane can be dispatched against it: **Phase 5 of
`todo-open-debt-program.md`**, which carries the corrected premise, the crate-wide local measurement
(354 ok lines / 36 printed skips / 318 real), and the explicit instruction not to reach for
`#[ignore]`.

**Disposition — NOT a rename, on the convention, and this is the correction of this pass's own
recommendation.** The fourth pass first recommended retiring this file to
`done-todo-refactor-cloud-sync-agents-1.md` beside Agents 2 and 3, edited `:11` to say so, and then
read `AGENTS.md` §4 — which forbids it twice over, and the retraction is recorded at `:11` rather
than quietly unwritten:

- **§4's earning rule:** `done-todo-*` is earned "ONLY when that file's own acceptance command was
  RUN and PASSED," and "a plan whose … documented equivalent was never executed STAYS `todo-`,
  **however complete its code is**." This plan's acceptance command is `:59`/`:100`'s
  `cargo test -p oz-cloud-server sync` against the zero-skip condition at `:64`/`:102`. It was run,
  it exited 0, and **it does not satisfy its own documented condition** — 12 skips against a
  condition that demands none. So the rename is not available, and §5's finding is the reason, not
  an incidental.
- **§4's placement rule:** the states that are not "acceptance run" — parked on a ruling,
  superseded, an audit that keeps items open — "belong in a **dated header line**, never in the
  filename," because the `todo-`/`done-` pair names one axis and this file sits in a five-state
  population. The header line at `:11` is that mechanism, and it is now carrying the state.
- **The precedent I cited was the warning, not the model.** Agents 2 and 3 are not sitting at the
  root under `done-` names — `5798599a7` *moved* them into `.agents/archived/`, where 37 plan docs
  now are, and §4 names that move as something not to do "as a substitute for naming them": that
  directory is absent from `HIST_DIR_PREFIXES` (`check-dead-refs.py:74-76`), so those files hold
  their dead-ref exemption only because `cc382ef20` made `is_historical_doc()` a substring test.
  Pointing a future lane at that pair would have taught it the exception §4 calls unapproved.

What is genuinely executed by this pass, then, is narrower and all real: `:94` ticked on
measurement, `:76` closed on the owner's ruling (§9), the vacuous skip-grep instruction at
`:64`/`:102` rewritten to `-- --nocapture`, and the state declared in the header. `:59`/`:100`
stay open pending one owner action — bring up `oz-pg-test-15432` (`scripts/reset-dev-pg.sh:19`-`:21`)
and re-run with `-- --nocapture` until the log shows no `test skipped` line; that is the whole
distance to a renameable plan. `:105` has been **struck rather than ticked** — its milestone subject
has 0 hits in `git log --format=%s`, and the command at `:106`-`:108` carries no pathspec, which
`AGENTS.md` §3 forbids — so the box line no longer holds a checkbox; its stale command and its
`2026-09-14` note stand verbatim beneath the strike as the evidence the third pass's §3 says a stale
milestone should be. Striking it is what makes the remaining census honest: after it, **every open
box left in this plan is the same leg**, the one an owner clears with a container.

What this file gained, and what it did not touch. **No code, no test file, no build.** Two boxes
ticked (`:94` on measurement, `:76` on the owner's ruling), one box struck (`:105`), dated clauses on
six checklist lines, one live instruction rewritten to require `-- --nocapture`, and the state
declared in the header line at `:11` instead of in the filename. Measured with: one `cargo check`,
four `cargo test` invocations — the fourth a malformed `--lib` request that errored, since this
package has no library target and its unit tests live in the binary — a `git grep` sweep that became
the 47-arm finding in §9, a re-read of that sweep at the later tip `8eec36261` after another lane's
commit moved `HEAD` mid-pass, the canonical census pair run twice (once wrong, in §8's sub-bullet),
and one TCP probe run twice. **The one thing this plan could not retire by itself — §9's 47 invisible
skip arms — was filed where a lane can be dispatched against it: Phase 5 of
`todo-open-debt-program.md`**, in its own commit, which is the only other document this work touched.

---

## Fifth pass — 2026-09-15, tip `7e5eebe42`. The retirement found its own successor mechanism, and it was already in this repo.

This pass touched **no checklist line**, so the census is unchanged by construction and re-derives identically: open **2** / ticked **3** / total **5**, by the canonical pair `grep -cE '^[[:space:]]*[-*][[:space:]]+\[ \]'` and its `\[[xX]\]` counterpart, whose `.NET` equivalents `'^\s*[-*]\s+\[\s\]'` and `'^\s*[-*]\s+\[[xX]\]'` return the same two figures here. It exists because §9's finding was dispatched into `todo-open-debt-program.md` Phase 5 and came back with two things this plan did not have: a tool, and an idiom.

**1. A guard now exists, and `:59`/`:100` should run it the moment the container is up.**

`scripts/verify-pg-tests-ran.py`, built this session at `50c9052bc`, hardened at `914615d1f`. Where `:64`/`:102` currently tell a lane to run `cargo test -p oz-cloud-server -- --nocapture` and look for zero skip lines, the command that answers the same question without relying on a human to grep correctly is:

    python scripts/verify-pg-tests-ran.py --crate oz-cloud-server

It makes its own cargo call with `--all-features` and `--nocapture`, prints `RUN: <passed>; <failed>; <ignored>` read off libtest's own summary, names every skip event it finds, and exits 1. Its PASS requires two independent things — a tree-wide arm census above its floor **and** a proven `--nocapture` capture — so it cannot grade a suppressed log as a clean one. Until this pass, that last clause was the design's whole history: the first draft printed a warning about suppression and **then exited 0**, which is `:64`'s original error rebuilt inside the instrument meant to catch it. Fixed, and now asserted in both directions by `--self-test` (**29 cases, 0 red** at `1273ee7d7`; it was 21 when this paragraph was first written and 25 after the nextest-format diagnosis, and each later number is a case added to prove something this file had previously only asserted).

**2. What it measured, three crates, tonight, container down — all at `--all-features`, so all three are comparable to CI.** `oz-cloud-server` `354 passed; 0 failed; 4 ignored` → **36** skip events. `oz-api` `326 passed; 0 failed; 0 ignored` → **9**. `platform-sync` `405 passed; 0 failed; 3 ignored` → **2**. All three exit 1. Every one of those "0 failed" figures was already true before the guard existed; the guard's entire contribution is that they are now accompanied by a number that cannot be skimmed past. `oz-cloud-server` was run twice, before and after `--all-features` was added to the runner, and printed the *same* `354; 0; 4` and the same 36 events both ways — so the composition shift §4 found is `platform-sync`'s own feature design, not a general property of the flag, and this crate's figures do not need restating when it changes.

**3. The `47` collision, stated so it cannot be misread.** This file's §9 counts **47 skip arms in `apps/cloud-server` alone**; the tree holds **64 across three crates**; and **47 is also** the count of skip *events* observed tonight across all three (36 + 9 + 2). Three different quantities, one of which reuses another's digits by accident of arithmetic. The units are: arms-in-source (a site that *can* pass silently) versus events-observed (a site that *did*, this hour, with the container down). 64 − 47 = 17 arms never fired, which is the expected gap, not a discrepancy: two Redis arms sit behind three `#[ignore]`s, and some arms live in modules a given feature set does not compile.

**4. The finding that changes what a funded fix should look like.** `--all-features` was added to the runner to match CI, and re-running `platform-sync` both ways moved its composition while its total stayed put: default features `386 passed; 0 failed; 22 ignored`, all features `405 passed; 0 failed; 3 ignored` — 408 either way, 19 tests relocated. The cause is `platform/sync/tests/integration_test.rs`, which carries **19** sites of

    #[cfg_attr(not(feature = "slow-tests"), ignore)]

against `slow-tests = []` at `platform/sync/Cargo.toml:34`. That is this repo's own correct answer to "skip conditionally," and it beats the `OZ_REQUIRE_PG` env gate Phase 5 first recommended and then rejected on cost — because CI passes `--all-features`, the feature is on there, so the `ignore` attribute is *never applied* and every PG case keeps running against the service `dev-ci.yml:205`-`:220` provides. No coverage is removed, which was the disqualifying hazard of plain `#[ignore]`. And locally, where the container is absent, the cases land in the summary as `N ignored` — a channel that needs no `--nocapture`, which is precisely the trick `todo-topology-editor.md:200` already uses to make non-vacuity readable. **This plan does not propose adopting it**; it costs the same 64-site edit across three crates, so the decision stays where it was filed, in Phase 5's own box, now written as `Adopt the slow-tests idiom if this phase is ever funded`.

**5. One coupling to carry forward.** That migration deletes the `eprintln!` lines the guard's SOURCE census counts, so the census would fall from 64 toward 0 and `ARM_FLOOR = 55` would fire. That is the floor working, not a defect to route around, and the re-baseline belongs in the same commit as the migration — otherwise the next reader sees a red guard and a plausible story and cannot tell which they have.

**6. What this plan still cannot close.** `:59` and `:100` remain the same two boxes, still blocked on the same one thing, which is not analysis: `127.0.0.1:15432` still refuses, probed again this pass, and `bash scripts/reset-dev-pg.sh` (`:19`-`:21`) is the owner's action, not a lane's. `done-` is still not earned and §4 still forbids taking it early; the file stays named as it is, with its state on the header line at `:11`. When the container comes up, the acceptance is one command and it is written above — and if it prints `ok    LOG: zero skip events`, that line plus the census line is the evidence, not a green `cargo test` exit code.

**7. The write that nearly cost 660 lines, recorded because the mechanism is repeatable.** The block above was first placed with the file-write tool, which **replaces a file rather than appending to it** — and this document is a 675-line plan whose entire value is accumulated dated passes, so the result was a 28-line file: `git diff --numstat` read `13 660`, i.e. I had deleted the first four passes and every checklist line in them. Caught by checking the line count immediately after the call rather than trusting the tool's "updated" confirmation. Undo was `git restore --source=HEAD --worktree -- todo-refactor-cloud-sync-agents-1.md` (index untouched, the file was clean at HEAD, so nothing else was lost), verified by `git hash-object` matching `git rev-parse HEAD:<path>` at `f6f412ac32c89d3f9f5bcd7c7ac540a3fefa9208` and an empty `git diff`. The append was then done as a raw byte concatenation, because `Add-Content` on Windows writes CRLF and this file is LF-only by `.gitattributes:26` — measured, not assumed: `Set-Content -NoNewline` then `Add-Content` in a temp dir emitted the bytes `6F 6E 65 74 77 6F 0D 0A`, CR count **1**, under pwsh 7.5.5. The final file is 705 lines, `CR=0`, no BOM, ends in LF, and `git diff --numstat` read **30 insertions / 0 deletions**, which is the signature a genuine append must have and the check that distinguishes it from what the write call did. **The general rule this buys: for a document whose content is its history, an append is a byte operation, never a write-with-a-smaller-payload.**

**Addendum to the fifth pass, same day, tip `73c5e84fc` — the container arrived and the box still did not close, which is the part §6 could not know when it was written.**

The owner started `oz-pg-test-15432` (`postgres:16-alpine`, `0.0.0.0:15432->5432`, confirmed `Up` and `15432: OPEN`). §6 named the container as the single remaining blocker. It was a blocker, and it was not the whole cause: a listening Postgres is necessary and not sufficient, and the reason is in this plan's own file family.

**What the reset script is actually for.** `scripts/reset-dev-pg.sh:5`-`:9` already states it: the shared dev container **drifts from `20260813_init.pg.sql`**, and when it does, "every PG integration test silently skips with 'Migration error'". The base `postgres` DB here held **4 tables** — `offline_queue`, `products`, `tax_rates`, `users` — against PG_INIT's **123** (`Select-String '^\s*CREATE TABLE' crates/oz-core/migrations/20260813_init.pg.sql` → 123). So `bash scripts/reset-dev-pg.sh` was run, exit 0, and it reported `123 tables in public schema`. That number closing on the file's own `CREATE TABLE` count is the proof the reset did what it claims.

**The trajectory, one command, four runs, three crates each:** `47` events (no container) → `19` (container up, drifted base DB) → `2` (reset done, with this lane's own probe runs having left `oz_apply_schema_89360` and `oz_rls_closed_89360` behind — residue that had to be dropped, and it was this session's fault, not the environment's) → **`1`**, at `RUN: 1085 passed; 0 failed; 7 ignored`. From "every PG case is silently unrun" to one event, in three causes, none of which was visible before a guard existed to count them.

**The last event is a race, and it moved between runs.** Run 2 printed `PG migration volume test skipped: apply schema: db error`; run 3 printed `PG migration integration test skipped: apply schema: db error`. Same trailing error, **different victim** — `pg_integration_migrate_large_db` (`migrate_sqlite_to_pg_tests.rs:230`) and `pg_integration_migrate_and_verify` (`:96`), both of which call `connect_postgres(base_url)` → `schema.rs:41`-`:44`, which `batch_execute`s PG_INIT against the **shared base DB** with no lock, while every other arm builds a throwaway DB. A fixed defect does not change which test it hits; the loser of a race does. Both pass alone: 0.66s and 3.82s, `1 passed; 0 failed`. Filed as its own box, `Kill the migration-test race on the shared base DB`, with the note that the correct fix is in `schema.rs` — **production, in this plan's forbidden paths** — so it is an owner call and not something a lane should settle by editing.

**Two more things this addendum is for, because both would otherwise be re-derived from scratch.** (1) A real failure appeared in one run — `pg::tests::pg_isolates_locations_by_tenant` — and passed alone in 2.72s. An RLS tenant-isolation test flickering under parallel load is the single most consequential thing found all session, and it is exactly the class this file's whole argument was about: previously undetectable, because the case that could fail had always been silently skipping instead. (2) **CI would not have seen it.** `.config/nextest.toml:15` retries twice on `[profile.default]`, `dev-ci.yml:244` passes no `--profile`, and `--profile` appears **0 times** in that workflow — so CI runs the retrying profile, and `[profile.ci]` is used only by `scripts/release.sh:65`. Filed as `Decide whether nextest's retry policy is hiding real flakiness from CI`.

**State, unchanged and deliberately not negotiated.** `:59` and `:100` stay open and `done-` stays unearned: this phase set its own bar at **zero** events, and one event with an explained cause is still one event. The filename is still correct. What changed is the shape of the remaining work — from "bring up a database" to "give two migration tests their own database," which is smaller, has a name, and has a command that counts it: `python scripts/verify-pg-tests-ran.py`, now 32 self-test cases at `ec0bb4b55`, which is what turned "the suite is green" into the four numbers above.

**Second addendum to the fifth pass, same day, tip `527fc96cf` — the guard reached PASS, and this plan's two boxes stay open anyway.**

`python scripts/verify-pg-tests-ran.py --serialize` printed the first **PASS** this tool has ever produced: `harness: serialized (--test-threads=1)` · `RUN: 1085 passed; 0 failed; 7 ignored` · `ok LOG: zero skip events` · exit **0**. Every one of `:59` and `:100`'s stated conditions is now literally satisfiable — a PG-backed run, `--nocapture`, zero `test skipped`. **Neither box is ticked, and the reason is the distinction this whole plan has been about.**

**What the race measurement did to §6's claim.** §6 said `:59`/`:100` were blocked on "an absent container, not analysis." The container arrived, and the correct diagnosis turned out to be one level deeper, established by holding the harness as the only variable: the default parallel harness produced **exactly one skip event in 5 of 5** full `oz-cloud-server` runs, the serialized harness **0 in 2 of 2**, both printing an identical `test result: ok. 347 passed; 0 failed; 4 ignored`. In the parallel five, one of those 347 connected, failed to apply its schema, printed a line and `return`ed; in the serialized two, all 347 ran. **Same print, different truth, and the only number the summary offers never moved** — which is not an argument this plan has to make in the abstract anymore, because it is now a pair of run logs.

The victim alternated between `pg_integration_migrate_and_verify` and `pg_integration_migrate_large_db` across runs, and Phase 5's first read — that those two raced *each other* — was refuted the same day: run alone, the pair produced **0 events in 8 parallel attempts**. The collision is with the rest of the suite; **eleven** test files reference `localhost:15432/postgres` directly. The migration tests are simply the loudest, because `schema.rs:41`-`:44` applies a 123-table schema plus seed inserts on every connect.

**Why a serialized PASS does not discharge `:59`/`:100`.** Those boxes ask whether the sync-store refactor is verified, and verification is a claim about the harness that ships: `dev-ci.yml:244` and `scripts/check.sh:106` both run **parallel** (`--profile` occurs 0 times in the workflow, so CI uses `[profile.default]`), and `.config/nextest.toml:15` retries every test twice on that profile. A green obtained by `--test-threads=1` says the cases execute when nothing else is on the base DB; it says nothing about the configuration in which they will actually run, and the contention it removes is still live there. Ticking the boxes on that evidence would be the letter satisfied and the substance abandoned — the same shape as a `cargo test` exit code, approached from the opposite direction. So the boxes stay open, and what closes them is the fix, not another flag: Phase 5's `Kill the migration-test race` now carries it, along with the fact that the remedy is already written in this repo — `crates/oz-api/src/pg_tests.rs:55` `pg_ddl_guard()` serializes base-DB DDL behind `pg_advisory_lock`, holds across a full run — its `continuing unserialized` fallback (`:81`) printed exactly **once** in the three-crate capture at `$env:TEMP\raw_up.log`, though the number of acquisitions that single fallback is dividing is not counted anywhere, so "once seen" is the measurement and "14 of 15 held" would be an inference, and has **15 call sites** in that crate while `git grep -c pg_ddl_guard -- apps/cloud-server` returns **0**.

**What did move.** The tool side is finished and provable rather than asserted: Phase 5's both-directions box is ticked in its own commit, because that box asked whether the *mechanism* can fail and can pass, and both have now been observed. §1's command still stands as the acceptance to run, and `--serialize` is now an available flag on it (`79160064a`) — with the harness named in every verdict, in both directions, so a serialized zero can never be read as a parallel zero. `--self-test` is at **35 cases, 0 red**. Filename unchanged, `done-` still unearned, state still declared at `:11`.

**Third addendum to the fifth pass, minutes later, tip `2357cb6b8` — the PASS reproduced, and one causal sentence in the first addendum was wrong.**

**The confirmation.** `python scripts/verify-pg-tests-ran.py --serialize` a second time: exit **0**, `harness: serialized (--test-threads=1)`, `RUN: 1085 passed; 0 failed; 7 ignored`, `ok LOG: zero skip events`. So the green direction is **2 of 2**, byte-identical both times, against parallel's 5 of 5 producing exactly one event. The five-vs-two is the whole finding, and neither number is an n of one.

**What the second run also measured, and what it breaks.** After it finished, `select count(*) from pg_database where datname not in ('template0','template1','postgres')` → **0**. A complete run cleans up every throwaway database it makes. Therefore the two leftovers this file's first addendum blamed for the `19 → 2` step (`oz_apply_schema_89360`, `oz_rls_closed_89360`, named `format!("oz_…_{}", std::process::id())` at `db_tests.rs:390`/`:511`) cannot be explained by the tidy path, and the first addendum's confident provenance story was invented on the spot. **Its phrase "residue that had to be dropped, and it was this session's fault" is retracted.** What the data supports is narrower: the base-DB reset is the only intervention with a measured step behind it (`47 → 19`), and `19 → 2 → 1` is a sequence with at least three candidate causes entangled — a reset, a cleanup, and a race that is itself nondeterministic about which test it takes. Which run made those two databases, and whether it aborted, was not identified and is not claimed.

**A detector that does not work, recorded so nobody builds it.** If a skip leaks its throwaway database, then `pg_database` would be an oracle the summary line cannot fake — an out-of-band count of cases that aborted mid-flight. Tested directly, on a run with a known event: leftovers before **0**, one `PG migration volume test skipped: apply schema: db error` printed, leftovers after **0**. The mechanism fails for exactly the reason that makes it unsurprising in hindsight — that test dies *inside* `connect_postgres`, before it creates anything, and the migration tests use the base DB and never a throwaway one at all. So residue is a signal only for a site that allocates before it fails, which is a property of the individual test and not of the skip mechanism, and a zero leftover count licenses no conclusion whatsoever. The general form of the mistake was reaching for a clever second channel and validating it on the case where the first channel was already telling the truth.

**Boxes unchanged, deliberately.** `:59` and `:100` stay open on the reasoning in the second addendum: CI and `scripts/check.sh:106` both run parallel, and `.config/nextest.toml:15` retries twice on the profile CI actually selects, so a serialized zero answers a question the shipping harness does not ask. Census re-derived at this tip: this file **2 open / 3 ticked / 5 total**, `todo-open-debt-program.md` **29 open / 11 ticked / 40 total**, `--self-test` **35 cases 0 red**, guard at 732 lines.

**Fourth addendum to the fifth pass, same day, tip `0289509b8` — the race this plan's blocker turned out to be is fixed, and the two boxes are still open.**

**What landed.** `fix(cloud-migrate): give the bin's two PG tests their own database`. `pg_integration_migrate_and_verify` and `pg_integration_migrate_large_db` now create a throwaway database, point `connect_postgres` at it, and drop it at the end. `schema.rs` was **not** touched: it still applies `PG_INIT` unconditionally on connect, which is correct for a real cutover and was only ever wrong for a test. This is not new design — it is the fix this repo had already written twice and never applied to this bin. `sync_store_tests.rs:9`-`:11` names the mechanism verbatim ("isolated database to avoid **AccessExclusiveLock deadlocks from concurrent PG_INIT DDL on the shared base DB**"), and `db_tests.rs:377`-`:380` declines to apply schema on an admin connection for the same stated reason. The `pg_ddl_guard` port contemplated an hour earlier was **rejected** on that reading: an advisory lock would serialize DDL that isolation makes unnecessary, and `pg_ddl_guard`'s own fallback at `crates/oz-api/src/pg_tests.rs:78`-`:82` continues *unserialized* when the lock is not acquired — a shape that turns a lock failure into a passing test.

**Measured, same one-variable protocol that produced the diagnosis.** `cargo test -p oz-cloud-server --all-features -- --nocapture`, default parallel harness, six consecutive full runs: **`apply schema` events 0 in 6**, against **1 in 5 of 5** before the change, all six printing `test result: ok. 347 passed; 0 failed; 4 ignored` and a seventh 0 in a three-crate run. The pair passes alone (`2 passed; 0 failed`) and leaves `0` `oz_migrate_test_*` databases behind. Confound stated rather than buried: two paths in this crate carried another lane's uncommitted edits during those runs — one line each in `sync_store.rs` and `sync_store/conflicts.rs`, a `mod pg;` whitespace change and an import reorder — read and judged behaviourally nil, but these are readings of a dirty tree.

**Why `:59` and `:100` still say open.** Their stated condition is a log with **zero** `test skipped` lines, and zero is not what the suite prints. The migration event is gone and three others arrived in its place across those six runs — `PG ordered-push`, `PG push-batch commit`, `PG tenant-isolation`, each `skipped: cannot create throwaway DB` — whether displaced by this change or merely unmasked by it, which is undetermined and needs a revert-and-rerun A/B to settle. So the letter and the substance now point the same way for once: **there is still a silent skip in the suite**, which is exactly what those boxes exist to forbid. Nothing here is a regression claim; `3 events in 6 runs` against `1 event in 5 of 5` is a lower rate with a different cause, and the honest summary is that one contention was removed and a second, narrower one is now visible.

**One finding worth more than the arithmetic.** `crates/oz-api/src/pg_tests.rs:596`-`:598` prints `PG REST RLS test skipped (Postgres unreachable at {url})` from an arm that fires when `throwaway_test_pool()` returns `None`. In the run that fired it, Postgres was reachable — `1085 passed; 0 failed` printed around it and `psql` answered on that port the same minute. A skip whose message asserts an untested *network* cause for a *catalog* failure sends the next reader to the container and the firewall, which is this plan's central hazard arriving from a new direction: not a silent skip, but a skip that **points somewhere else**. Recorded in `todo-open-debt-program.md` as a new open box with that repair, which is prose.

**Census, and a gate that earned its keep.** Counting this plan's own acceptance commands now needs **66** arms across 12 files in 3 crates (64 before the fix — each of the two tests gained a second skip arm), **64** of them PG-gated, and `--self-test` is **35 cases 0 red** against a re-based `ARM_BASELINE = 66`. The tool's baseline assertion fired on my own edit the moment it was made, which is the only reason the number in this paragraph is correct rather than confidently stale. Filename unchanged, `done-` still unearned, state at `:11`. This file holds at **2 open / 3 ticked**; the program file's figures are being re-derived by another lane's in-flight commit at the moment this was written, so no number for it is quoted here.
