# Orchestrator Agent 1: Cloud Sync Engine & Protocol Handler

<!-- Audit stamp: 2026-09-14 · DSH · status: INACCURATE -> CORRECTED · corrections applied: 12 · the fence named `apps/cloud-server/src/bin/migrate_sqlite_to_pg.rs`, a single file that does not exist — it became a module DIRECTORY at `2c35ec1a2` — and the `sync_store.rs` baseline was ~578 lines stale; both found by globbing `apps/cloud-server/src/**/*.rs` and re-measuring with `wc -l` instead of trusting the prose. -->

> **Line-number drift from the sizing pass (2026-09-14): the bullets that pass cites by line have
> moved, so both forms appear in this file and this is the map as of THIS pass's final write —
> `:51` now `:59` · `:58` now `:67` · `:64` now `:76` · `:68` now `:94` · `:74` now `:100`. Re-derive before quoting one of these pointers
> after any further edit: a line reference is only true of the revision it was taken from, which is
> the failure class every note below exists to prevent.**

**Document:** `todo-refactor-cloud-sync-agents-1.md`  
**Role:** Orchestrator Agent 1 (Sync Protocol & Conflict Architect)  
**Goal:** Decompose `apps/cloud-server/src/sync_store.rs` (1,412 lines — it read 1,757 until `7a310e013` took 345 out) and `sync_api.rs` (800 lines) to streamline conflict resolution and SQLite-to-Cloud replication.  

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
   - `apps/cloud-server/src/sync_store.rs` (1,412 ln, 1,757 before `7a310e013`) & `sync_store_tests.rs` (1,386 ln) · `sync_store/pg.rs` (378 ln) sits inside this fence by parentage — see the 2026-09-15 block at EOF
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
  > **Sizing pass 2026-09-14 — and the command as written cannot be honestly ticked whatever the pass count reads.** Of the 20 `#[tokio::test]` cases in `sync_store_tests.rs`, **SEVEN** `pg_integration_*` cases (`:272`, `:451`, `:515`, `:576`, `:1016`, `:1115`, `:1185`) open with `let Some((pool, db_name)) = throwaway_pool().await else { eprintln!("… skipped: cannot create throwaway DB"); return; };` — at `:273`, `:452`, `:516`, `:577`, `:1017`, `:1116`, `:1186`. **A `return` inside the `else` arm is a PASS to cargo, not a test that ran: "20 passed" can mean "13 ran".** Condition for a tick: container **`oz-pg-test-15432`** up (`scripts/reset-dev-pg.sh` names it; the suite dials `postgres://postgres:postgres@localhost:15432/postgres` unless `OZ_TEST_PG_URL` is set — `sync_store_tests.rs:15-16`), **and** the captured output must show **ZERO `skipped:` lines** — grep the log, do not eyeball the summary. Not theoretical: `sync_store_tests.rs:42-44` records that the hex-only `.simple()` DB names exist because UUID `Display` hyphens made `CREATE DATABASE` a syntax error and *"silently skipped every sync-store PG test"*. This exact suite has already been green while skipping everything.

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
- [ ] Split the SQLite and PostgreSQL adapters out of `sync_store.rs`.
  > **Bullet added by this audit (wrong-by-omission).** The file is 1,412 ln against the 1,000-line
  > production-file ceiling in `AGENTS.md` §2, and `grep -n 'mod ' sync_store.rs` returned exactly one
  > hit (`mod tests;`, `:1757`). **Re-measured 2026-09-15: TWO hits — `mod pg;` at `:34` and `mod tests;` at `:1412` — so the claim that there is no submodule structure to inherit a split is FALSE: `sync_store/pg.rs` IS one. Three
  > separate `impl SyncStore` blocks (`:90`, `:927`, `:1112`; `:84`/`:1272`/`:1457` were their `7a310e013^` positions) confirm the file has grown by
  > accretion, not by decomposition. **2026-09-15: this box is HALF SHIPPED and the plan did not know it — `sync_store/pg.rs`, 378 ln, landed in `7a310e013` under this plan own `refactor(cloud-sync)` prefix (`:42`). NO TICK: the box asks for both halves, and the SQLite half is what remains; detail at EOF.**
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
> 1,412-line file still has to be split — the SQLite half of it; the Postgres half shipped in `7a310e013` without this plan knowing.**

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
