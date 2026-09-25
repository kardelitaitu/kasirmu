<!-- Split from todo-open-debt-program.md on 2026-09-25 under R18.
Origin blocks, in pre-split line order: the title, "Why this file is one document", the
Program rules (NOT duplicated elsewhere -- this file carries the only copy), the Phase 1
section, and Phase 1 THREE dated history blocks (pre-split :711, :728, :775). Gathered
here because a phase record belongs with the phase, not with the program. -->

**Program:** `todo-open-debt-program.md` -- rules, dispatch order, rotted claims, rename audits.
**Siblings:** `todo-open-debt-agents-2.md` .. `todo-open-debt-agents-5.md`.

**Why this file carries the `done-` prefix.** Its acceptance command
`cargo test -p kasirmu-bridge --release` was RUN and PASSED on 2026-09-24
(`1384 passed; 0 failed; 0 ignored`), and its ONE remaining open box is NOT WORK -- a
restated rule that can be neither done nor undone, per the disposition recorded beneath
that box. AGENTS.md 4 earns the prefix from the acceptance command, and the box census
was the only thing that had ever blocked it.

# Open Debt Program — four workstreams, four fences

<!-- Audit stamp: 2026-09-14 · DSH · status: NEW, UNEXECUTED (one measurement run) · authoring HEAD `257ff6122` on branch `0.0.39`, working tree carrying a peer session's 6 ` D` coder-N-journal.md plus ` M platform/core/src/database/migrations.rs` (neither mine, neither touched). Every anchor below was re-read in this checkout; every count was produced by the command printed beside it. Claims CARRIED from another document rather than re-measured here are labelled `[carried]` with the document and line named — nothing in this file is asserted on the strength of another doc's say-so without that label. · One command was RUN rather than cited: `cargo test -p oz-bridge --release` → 1231 passed / 76 failed, which reproduces `todo-refactor-oz-pos-app-agents-3.md:142`'s record on both axes (see Phase 1). No other test command was executed, so no green in this file is a green this pass observed. · Scope note: this is the FIRST plan doc in this repo written as ONE file covering FOUR workstreams, which deviates from the established one-workstream-per-file pattern (`todo-refactor-<area>-agents-N.md`). The deviation is deliberate and its consequence is stated under "Why this file is one document"; per AGENTS.md §4 nothing about the naming is load-bearing beyond the `todo-` token. -->

**Document:** `todo-open-debt-program.md`
**Role:** Program order — four independently dispatchable workstreams
**Goal:** Close the four debts the repository's own records already name as unfinished, in an order that respects their real dependencies, without inventing scope and without quoting a rotted number.
**Acceptance:** per phase, its own named command. AGENTS.md §4 governs the rename: a `done-` prefix is earned ONLY when that phase's acceptance command has been RUN and PASSED, and renames happen **in place at the repo root** — never into `.agents/archived/`.

**Name map — read this before running anything below (added 2026-09-18, HEAD `19437867c`).** This file was written before the rebrand and before restructure phases P11/P12, so **every `oz-*` name in it is a RENAME, not a missing file** — `cargo -p oz-bridge` answers *"package ID specification did not match any packages"*, which reads like *gone* and is not.

| In this file | In this tree today |
|---|---|
| `oz-bridge` | `kasirmu-bridge` |
| `oz-core` | `kasirmu-core` |
| `oz-payment` | `kasirmu-payment` |
| `oz-hal` | `kasirmu-hal` |
| `oz-api` | `kasirmu-api` |
| `oz-cloud-server` | `kasirmu-cloud` (`apps/cloud-server`) |
| `oz-pos-tablet` / `apps/tablet-client` | `kasirmu-mobile` / `apps/mobile-tauri` |
| `oz-pos-app` / `apps/desktop-client` | `kasirmu-app` / `apps/desktop-tauri` |

**The residue is deliberate, and three tokens in it are NOT renames — a global find-and-replace would corrupt them.** Measured 2026-09-18 at HEAD `83540df69`: **~150 `oz-*` occurrences survive**, concentrated in dated records, ticked-box histories and quoted commit subjects. That is the name map doing its job, not an unfinished edit: a **path or a command** is a locator and was re-named where it is live scaffolding, while a **measurement, a quote or a commit subject** is a dated record and is corrected forward, never rewritten. The three traps:

| Token | What it actually is | Where |
|---|---|---|
| `oz-pg-test-15432` | a **running Docker container name**, not a crate | `:467` |
| `todo-refactor-oz-pos-app-agents-3.md` | a **document filename** that was never renamed | `:94`, `:161` |
| `72b28d025 fix(tablet-client): …` | a **quoted commit subject**, i.e. history | `:180` |

So `sed -i 's/oz-/kasirmu-/g'` on this file is destructive. The `oz-*` crates map one-to-one; `oz-pos-tablet` and `oz-cloud-server` do **not** (they become `kasirmu-mobile` and `kasirmu-cloud`, names sharing no suffix with their sources), and the three rows above are not crates at all.

The **Fence / Commit prefix / Acceptance** lines of each phase have been renamed to the current names, because those are the lines a worker executes or edits against. **Dated records, `[carried]` measurements and ticked boxes are deliberately left as written** — this file's own rule is that a dated record is corrected forward, never back, and rewriting the paths inside one would destroy the record it is. Resolve any stale path you meet through the table above.

---

## Why this file is one document

The owner asked for a single `todo-*.md` covering all four workstreams. Four consequences follow, and they are recorded rather than hidden:

1. **Each phase carries its own owned-path fence and its own commit-subject prefix.** Two phases can therefore run concurrently, and a worker must never edit outside its phase's fence.
2. **The phases are not equally ready.** Phase 1 and Phase 2 are executable now. Phase 3 is executable but contains one item that needs a product ruling before code. Phase 4 is *mostly blocked on inputs the repository does not have* — that is the honest finding, and it is the reason Phase 4 is last.
3. **Splitting is cheap if the owner prefers parallel files.** Cut on the `## Phase N` headings into `todo-open-debt-agents-N.md`; the fences already partition the tree, so no cross-file coordination is lost. Do not split by *task* — only by phase.
4. **The program-level acceptance is not a command.** There is no single gate that can see all four. Each phase's acceptance is its own; a green Phase 1 says nothing about Phase 2.

---

## Program rules — binding on every phase

### Hard repo rules (restated because a worker reads THIS file, not `AGENTS.md`)

- **NEVER create a branch. NEVER switch a branch. NEVER push.** This program runs on whichever branch is already checked out (authoring branch: `0.0.39`). A push to `main` runs CI *and* deploys.
- **NEVER `git add`, `git stage`, `git commit -a`, `git commit --amend`, `git stash`.** The only permitted commit form is ONE line with an explicit pathspec: `git commit -m "<type>(<area>): <subject>" -- path/one path/two`. A *new* file needs the one-call chain (`git add -- new/one && git commit -m "..." -- new/one`) and nothing else.
- **Version is locked at `0.0.39`.** Do not touch a version string anywhere.
- **`cargo fmt --all` is FORBIDDEN** in this checkout — it reformats other sessions' in-flight `.rs` files in the working tree. Format a single file with `rustfmt --edition 2024 <path>` if you must.
- **Forward slashes in every path argument.**
- **Money is `i64` minor units via `Money`. Never `f32`/`f64`.**
- **SQLite writes go through an explicit `rusqlite` transaction.**

### The shared checkout

One worktree, several live agent sessions, one shared `HEAD` and one shared index. Consequences that have already bitten this repo:

- `git status` mutates `.git/index`; a killed status call can leave a stale `.git/index.lock` that fails *every* commit repo-wide. Check the lock's mtime and whether any `git`/`cargo` process is actually alive before removing it, and back the index up first.
- A `git commit` returning *"nothing to commit, working tree clean"* when you expected otherwise does **not** mean your work is lost. Run `git show --stat HEAD` before concluding anything.
- Files may be **mid-write by another session** at the moment you read them. A test failure observed during a concurrent-agent window must be re-run before it is reported as a verdict. This exact trap produced a false vitest failure on 2026-09-14 (55 s after the run, a peer edited the failing file).

### Measurement discipline — a claim is its command

When you write a number into a doc, the command printed beside it must be run VERBATIM and must print that number. An equivalent command you chose yourself is not a substitute: `ls ui/src/__tests__/* | wc -l` prints 575 while the correct count is 572, because `ls dir/*` emits a per-subdirectory header and omits dotfiles that `find -type f` counts. *(Recorded as rule D7 in `.agents/manager-wave4-rules.md`, added 2026-09-14 after a review finding.)*

Corollaries this program depends on:

- `git ls-files` answers *"is it tracked today"*, never *"did it ever exist"*. Use `git show <sha>:<path>` for history.
- A grep of one file is evidence about one file. Before writing "only in X", grep the tree.
- **Do not trust an audit stamp's numbers.** Stamps are point-in-time records by this repo's own convention, and several quoted in this file have rotted since they were written. See "Claims that have rotted".

### Counting method for checkbox census

Any box census you write must state its method, because two defensible methods disagree:

```bash
grep -c  '^- \[ \]' <file>            # unindented boxes only
grep -cE '^[[:space:]]*- \[ \]' <file>  # any depth, including nested boxes
```

This file uses the **any-depth** form and says so where it quotes a number.

### A census is not a work count — read this before quoting either

**Measured 2026-09-25 at HEAD `15192c315`, both forms agreeing: 15 open / 26 ticked.**

```bash
grep -cE '^[[:space:]]*[-*][[:space:]]+\[ \]' todo-open-debt-program.md   # 15
grep -cE '^[[:space:]]*[-*][[:space:]]+\[[xX]\]' todo-open-debt-program.md  # 26
```

**One open box left this census on 2026-09-25 without this pass touching it:** the
nextest-retry box (`:562`) was ticked by `15192c315`, which wired
`verify-pg-tests-ran.py --nextest-junit` into `.github/workflows/dev-ci.yml` and so
completed R14. Recorded because a census in a shared checkout is a racing value — the same
reason this file's own dated censuses disagree with each other.

**The open figure is not the backlog, and treating it as one is what has kept this file
un-renamable.** Six of the fifteen open boxes are **NOT WORK** — rows that restate a rule
already binding every worker, which can be neither done nor undone. The file's own
precedent at `:454` is explicit that they stay un-ticked with their reason: a tick was
once landed on one and reverted, because *"a tick claims completed work and this clause
claims none."* So they are permanent `[ ]` rows by design, and any phase carrying one
reports an open box it can never close.

| Disposition | Count | What it means for a phase's acceptance |
|---|---|---|
| **WORK** | **5** | A real, dispatchable task. Only these can close a phase. |
| **NOT WORK** | **6** | A restated rule. Permanent `[ ]`; must be excluded from the work count. |
| **SUPERSEDED** | **3** | Killed by a ruling. Stays `[ ]` per `:285`; not work. |
| **NEEDS A RULING** | **5** | Owner decision, not a lane's task. |
| **OUTSTANDING** | **0** | R14's one CI edit LANDED 2026-09-25 (`15192c315`). |
| **CONDITIONAL** | **1** | R15: waits on funding, which no pass can satisfy. |

**Per phase, work-open vs total-open** — the column that decides `done-`:

| Phase | Open | Of which NOT WORK / SUPERSEDED | **Work open** |
|---|---|---|---|
| 1 | 1 | 1 NOT WORK (`:139`) | **0** |
| 2 | 2 | 1 NOT WORK (`:210`), 1 INVARIANT (`:209`) | **0** |
| 3 | 3 | 1 NOT WORK (`:270`), 2 SUPERSEDED (`:267`, `:268`) | **0** |
| 4 | 1 | 1 NOT WORK (`:355`) | **0** |
| 5 | 3 | 1 NOT WORK (`:574`), 1 SUPERSEDED (`:573`) | **1** (`:566`) |
| dead-class section | 5 | 5 NEEDS A RULING | **0** (owner's) |

**The consequence, stated plainly, because it inverts how this file has been read:**
Phases 1, 2, 3 and 4 have **zero open work**. Their remaining boxes are rules and
rulings, not tasks. What keeps them on `todo-` is a counting convention that cannot
distinguish the two — not unfinished work. Phase 5 is the only phase with real open
tasks, and Phase 1's acceptance has already been run and passed (`:625`).

**So `done-` is earnable on the acceptance rule as written, and has been blocked by
representation rather than by work.** Anyone re-deriving this must classify each open
box, not merely count it: the counts above are a reading of the dispositions recorded at
each box, and a box that gains or loses one changes the phase's work column while leaving
its open column untouched — which is exactly why the two columns are printed side by side.

### Ruling execution is a second axis, and the box census cannot see it

**Measured 2026-09-24 at HEAD `3f8674c96`.** The owner ruled all 21 decisions on
2026-09-20 (`done-todo-owner-rulings.md`). A ruling is not a ticked box: several are
made and **unexecuted**, and nothing above reports that, because the census counts what
this file wrote rather than what a ruling authorised. Found by reading the tree against
each ruling, not by counting boxes — the same representation gap the disposition table
closes for NOT WORK rows.

| Ruling | Decides | Executed? | Evidence measured this pass |
|---|---|---|---|
| **R10** | Scope-aware, gate-first gate is authoritative wherever the two shells disagree | **YES** | **ALL FOUR SHAPES EXECUTED 2026-09-25.** Shape 1 (customers gate-KIND) — and it turned out to be **1 door, not 6**: only `get_customer_scoped` diverged, and it now delegates to the scope-aware `kasirmu_bridge::customers::get_scoped`. Measured at this tip, the bridge's `customers.rs` gates scope-aware in one place only (`get_scoped` at `:430`); `list_scoped` (`:400`) and the four mutations call the SAME non-scope-aware `require_customer_permission` the shell does, so the other five were never divergences. The `settings.rs` half of gate-KIND is **also EXECUTED 2026-09-25**: the 7 scoped setters that gated a store DB with the unscoped `require_permission_for_user` now call `require_session_permission` on `settings:edit`, and because that gate authorizes against the GLOBAL identity db they no longer need `open_store` first — so KIND and ORDER were fixed together. Measured rather than quoted: of the 8 `require_permission_for_user` sites the earlier note carried, one is the DEPRECATED `set_setting` (caller-supplied `user_id`, global-db `Store`, no session to scope against) and is deliberately left; another (`set_user_preferences_scoped`) had **no gate at all**, which is a missing-gate question and not R10's. The gate-ORDER half is **CLOSED 2026-09-25 — 69 of 69 bodies**, ratchet lowered 69 → 19 → 7 → **0** in three sweeps: 50 bodies via `require_permission_for_session` (12 files), then `tax`'s 7 and `history`'s 5 (KIND fixes too), then the last 7 (`categories` 3, `products` 3, `inventory_counts` 1). Four module-local gate wrappers were deleted as they became dead. The floor is now 0 and is a **permanent pin**: any body that opens the store before gating fails the run. Gate-ORDER **EXECUTED for `customers`** — see below. |
| **R11** | An audit record must not depend on the build profile | **SATISFIED — and the literal fix is DECLINED, deliberately** | The tablet already passes `false` (`apps/mobile-tauri/src/commands/auth.rs`); the bridge passes `true`, and that is a *documented per-client policy*, not drift — `kasirmu-core/src/db/audit_security.rs:379-383` declares it and `apps/mobile-tauri/src/commands/auth_tests.rs:1324` pins all three legs. Merging the two is a NEW ruling, not R11's execution. See the correction below. |
| **R9(a)** | QRIS gateway idempotency key | **YES** | Executed 2026-09-25 in `387ea9f56`: the gateway key is derived from the already-required `sale_id` (`qris-{tenant}-{sale_id}`) when the caller omits one, so a timeout+retry re-uses the same QR instead of minting a second. **This exposed a latent defect and required fixing it:** the ledger's bare `INSERT` answered `UNIQUE constraint failed` on the now-repeating `order_id`, so an already-issued charge returned `500 charge issued but not journaled` — telling the caller to reconcile a row that was already correct. `record_issue` is now idempotent on a REPLAY (identical tenant/sale/amount/currency → `Ok`) and still refuses a COLLISION (any difference → `Err`), so the original "must not silently re-point the ledger" invariant is preserved rather than relaxed, and the pre-existing collision test still passes. |
| **R17(i)** | Distinguish connect-failure from create-failure | **YES** | Executed 2026-09-25 in `0eec11c87`. R17 kept (i) open *"when the race is settled"*, and the funded A/B settled it — the race was REVEALED by the fix, not moved (`todo-open-debt-agents-5.md:104`). All four `None`-returning stages in `throwaway_test_pool` now name themselves (admin pool get, stale sweep query, stale DROP, throwaway pool open), where three were previously silent, so a skip can no longer be misread as an unreachable server. Guarded by `throwaway_test_pool_never_returns_none_silently` — itself mutation-tested. |
| **R16** | Dev Postgres 16 vs CI 17 | **YES — verified, already done** | Measured 2026-09-25: `scripts/reset-dev-pg.sh:22`/`:43` both read `postgres:17-alpine`, matching `dev-ci.yml:289`. R16 ruled two script literals plus a container recreate; the literals are fixed. NOTE: two `postgres:16-alpine` refs remain — `ops/docker/docker-compose.pg.yml:37` and `platform/sync/README.md:29` — and the compose one is the PRODUCTION DB profile, digest-pinned. That is a separate decision with migration implications, not R16's dev/CI alignment, and is NOT silently changed here. |
| **R8(iii)** | Build the loopback terminal simulator | **YES** | Executed 2026-09-25 in `3aaf22d04`: `crates/kasirmu-hal/src/drivers/edc/loopback.rs` — a scriptable `LoopbackEdcTerminal` covering every state-machine case R8 named (timeout-after-charge, decline, cancel/void, receipt, hardware fault, offline, and fail-closed on a truncated frame), with 11 tests, one per behaviour. R8(i) stays blocked on a named model's spec or capture and is untouched — the vendor codecs remain stubs, and the module says so rather than implying otherwise. |
| **R9(b) §2** | Retry only behind a gateway key | **YES** | Executed 2026-09-25 in `521db1fef`: `ResilientProcessor` now takes a `RetryPolicy` per method — `authorize`/`sale`/`refund` are `Keyed` only when the caller supplied a non-blank key, `capture`/`void` are `SingleShot` (they have no key parameter), `receipt` keeps the budget as a read. Red-first: a keyless `authorize` reached the driver **4 times** before, **1** after. The keyless half is the doc's §8 row marked "fails today"; the keyed half asserts the driver saw the SAME key twice, per the doc's own pinning convention (`:226`). **The reduction is named, not hidden:** `capture`/`void` lose their retries, which the doc calls out at `:117` — a capture retried without a key can double-capture. One pre-existing test was amended rather than deleted: it used `idempotency_key: None` and asserted a retry succeeds, i.e. it pinned the double charge; it now supplies a key and keeps its subject (backoff), while the keyless case is covered by the new pair. |
| **`amount_mismatch` overwritable** | Ledger terminal-status guard | **FIXED 2026-09-25** (`16a2f454c`) | **A live defect on the money path, found red-first.** The webhook treats THREE statuses as terminal — `settlement`, `capture`, **and `amount_mismatch`** (`webhooks/midtrans.rs:219-221`) — but `mark_status`'s SQL guard protected only two (`midtrans_ledger.rs:297`/`:320`). So a later notification overwrote an `amount_mismatch` row: the flag exists to make a signed-amount discrepancy visible for manual reconciliation, and any ordinary `pending`/`expire` follow-up erased it while the discrepancy itself remained. Red-first test failed with `left: "expire", right: "amount_mismatch"`. Both arms now carry the same three-status set. **One neighbouring difference was checked and is deliberate, not an oversight:** `StatusResponse.settled` (`payment_api.rs:364`) intentionally excludes `amount_mismatch`, because that flag is the poll-loop's exit condition and a mismatch must keep polling rather than confirm — the doc comment says so. |
| **Charge handler QR extraction** | The optional-QR branch | **PINNED 2026-09-25** (`72ec7a152`) | `qris.rs:642-646` emits two message shapes — `SCAN_QR\|<order_id>\|<qr>` and `SCAN_QR\|<order_id>` — and the handler extracts the QR with `split('\|').nth(2)` (`payment_api.rs:313-317`), which is `None` for the two-field form. **Only the three-field branch was tested**, because the shared mock always supplies `qr_string`. The two-field case is now pinned, and the mutation that proves it matters is `nth(2)` → `nth(1)`: the new test fails with `got "QRIS-NO-QR"` — the ORDER ID landing in the QR field, which the UI would render as a scannable code. A wrong-but-present QR is worse than an absent one. Source proven byte-identical to HEAD by `git hash-object` vs `git rev-parse :path` after the mutation was reverted. |
| **Doc self-measurement** | The design doc's own claims | **RE-MEASURED 2026-09-25** (`71cb65163`) | The doc's §0/§1 narrative carried numbers that no longer reproduced — and my own work is what moved them. Corrected: `resilience.rs` was "256 lines", is **397**; the registry/resilience reference count was "4 hits, all registry_tests" and is **13**, still all in-crate, because the §2/§5/§4 guards were added; the "three green tests" are now **12 + 8**. **One of my corrections was itself wrong**: I first wrote "six" in `registry_tests.rs` and the count is **eight** — fixed in the same commit, and the paragraph now says both were counted rather than estimated. §10 item 3 (keying) re-verified as genuinely open; §9 item 2 (the §6 scheduler) re-read as deliberately undecided rather than outstanding. |
| **§2 composition** | The two §2 rules agree end to end | **PINNED 2026-09-25** (`7b60caf13`) | Each of §2's two rules was tested alone and they were never tested **together**: `policy_for_key` (resilience.rs) decides retryability from the key a request carries, and `payment_api.rs` decides what key a charge carries at all (deriving `qris-{tenant}-{sale_id}` when the caller sends none or a blank). The failure mode if they disagree is silent in both directions — a derived key classified blank loses a safe retry; a blank classified keyed becomes a second charge. `a_derived_gateway_key_is_retryable_and_a_blank_one_is_not` pins the pair, mutation-tested (treating `Some(_)` as keyed fails it). **Caveat, and it matters:** the test reproduces the derived SHAPE literally rather than importing it, because the crates are separate — so it catches a change to the `policy_for_key` side but only *detects* a format change on the API side rather than being tied to it. |
| **§9 item 5** | Should `capture`/`void` grow an idempotency parameter? | **CONTRACT DOCUMENTED, parameter still an open decision** | 2026-09-25 (`b5f5caf74`): the trait now states what the missing key costs. `refund` takes a key and names the consequence (*"a timeout+retry may double the refund"*); `capture` and `void` took none and said nothing, so a driver author reading `processor.rs` had no warning that a retry **double-captures** — the hazard was documented only in `resilience.rs`, where the retry policy lives, not at the contract. Both methods now name it, point at `RetryPolicy::SingleShot` as the deliberate reduction, and tell a caller that must retry to reconcile first. Adding the parameter is still §9 item 5's decision; the doc is the contract until then. Cross-crate link to `kasirmu_hal::EdcTerminal::void` verified rather than assumed. |
| **PAY-A / PAY-C** | Findings in the crate-review ledger | **BOTH ALREADY FIXED — ledger was stale, now corrected** | Checked 2026-09-25 after the ledger was flagged as actively written by other lanes. **PAY-A** (Stripe refund skipping the blank-key guard): fixed at `stripe.rs:463` and pinned by `stripe_refund_omits_a_blank_idempotency_key`, which asserts both halves — verified by RUNNING the test, not by reading the comment. **PAY-C** (QRIS stamp leading with pre-fix severity): the `findings:` field was fixed, but the **`next:` field on the same stamp was not** — it still instructed a reader to "fix amount parsing (PAY-1), honor idempotency (PAY-2), partial refund (PAY-3)" and still argued COR-31 was deliberately unbounded, while `:241-242` bounds the client and all three are closed. Corrected (`156c0f4f0`). A tree-wide scan of all 216 crate stamps found **no other** stale `next:`: the 9 that still name work describe genuinely unimplemented things (checked `webhook.rs` verifiers as a sample). |
| **R9(b) §8 rows** | The doc's red-first test plan | **7 of 8 CLOSED — only row 8 left** | Rows 1, 3, 4, 5-part and 7 done: §5 (row 7) `b333f3fe0`; §2 rows 1 (`521db1fef`) and 3 (`141bed44d` — capture/void single-shot, mutation-tested 4 calls → 1); row 4 (`e9c849f39`) — **the doc's "production hole", and it was still open**: a BLANK `""` key is `Some("")`, not `None`, so R9(a)'s derivation was skipped and the driver minted a fresh key per attempt. Proven by the mutation producing two different `order_id`s for one sale. Row 2 passes already. **Row 6 CLOSED 2026-09-25 (`5f221e003`) — and my earlier claim that it needed the §4 keying decision was WRONG.** Row 6's subject is the chain escalating past an OPEN breaker, which is a *different* mechanism from the registry wiring: an open breaker returns `PaymentError::Network`, which classifies `Transient` (`error.rs:71`), so the chain escalates and the healthy second processor is reached. It worked already; the doc's "not wired at all" is about the registry, not about this coupling. Now pinned, because the two files compose correctly only by virtue of a classification neither states as a contract with the other — mutation-tested by making the chain stop on any error. **Only row 8 (tenant-A vs tenant-B keying) genuinely needs §4's decision.** |
| **R9(b) §8 rows 1-3, 6-part** | The doc's red-first test plan | **PARTIAL** | Executed 2026-09-25: §5 (row 7) `b333f3fe0`, §2 (rows 1 and 3) `521db1fef`, and the chain's `Unsupported` carve-out `522d45e78`. That last one was **untested and unreachable by any mock** — the double exposes only `decline_next`/`simulate_timeout` — so a `unsupported(true)` builder mode was added to make the exception observable. Mutation-tested: removing the carve-out stops the chain at the stub and never reaches the working gateway. Rows 6 and 8 need the §4 keying decision; row 2 (`keyed refund` retried, one key) passes already. |
| **R9(b) §4 seam** | The API change §4 says blocks the design | **YES** | Executed 2026-09-25 in `828d9e9f4`: `ResilientProcessor::with_shared_breaker(inner, config, Arc<CircuitBreaker>)` lets the CALLER own and share the breaker, and `breaker()` now returns that shared handle. The doc names exactly one API obstacle — *"`with_config` constructs its breaker internally, so the breaker cannot be shared or keyed as written"* (`:161`) — and this removes it **without deciding the key**: whichever map shape §4 settles on is built outside this type and handed in. §8 row 5 closed (two decorators over one gateway trip together; mutation-tested — a private breaker reads `Closed` where the shared one reads `Open`), and its counter-evidence is pinned too (separately built decorators do NOT share, which stops a future edit from making every breaker global). |
| **R9(b) keying** | §4's `(tenant, gateway)` breaker keying | **BLOCKED ON A DECISION** | Not done, and not a lane's call: the doc's §10 item 3 makes keying a settlement condition *because* it is "the decision most expensive to change after wiring", and §9 item 4 states the key's tenant source "is not designed here". `kasirmu-payment` has **0** `tenant_id` hits, so no tenant concept exists to key on. R9's ruling says to wire the decorator; it does not say what the breaker map keys by. |
| **R9(b)** | Wire `ResilientProcessor` at the construction site | **PREREQUISITE LANDED, wiring NOT done** | 2026-09-25: the design doc's §5 defect is FIXED (`b333f3fe0`) — `HalfOpen` admitted every concurrent caller, measured **19 of 19** before the fix and **0** after. That mattered first because §5 "changes the behaviour of already-shipped code" and wiring the decorator without it would have installed a thundering herd on the live payment path. The WIRING itself is still not done, and deliberately: the doc's §10 item 3 makes §4's `(tenant, gateway)` keying a settlement condition *because* it is "the decision most expensive to change after wiring", and §9 item 4 states the key's tenant source "is not designed here". **R9's ruling does not settle that keying** — it rules the doc is written and the decorator is to be wired, not what the breaker map keys on. Inventing a key would fix one shape into every construction site. |
| **R21** | Can the open-bills list be opened when no bill is held? | **YES** | Executed 2026-09-25 in `b5ed4c2b2`: the unreachable empty state is deleted — the string `pos-open-bills-empty`, both locale rows (`sales.ftl:694`, `sales.id.ftl:195`) and the now-dead `.pos-held-list-empty` rule (`PosScreen.css:398`), plus the ternary arm in `OpenBillModals.tsx`. R21 named the string and the two rows; the CSS rule is the same dead-UIT class and went with them. Premise re-verified rather than taken: `setShowOpenBills(true)` has exactly one call site (`CartPanel.tsx:689`) and it is behind a non-empty guard, so the `=== 0` branch was unreachable. Guards: `npm run typecheck` clean, `lint` 0 errors, `10457` UI tests pass, `lint-i18n.sh` "no issues detected", and the pre-commit FTL gate reports 0 missing keys / orphans OK. |
| **R14** | Wire the nextest JUnit receipt into CI | **YES** | Landed 2026-09-25 by `15192c315`: `.github/workflows/dev-ci.yml:328` runs `verify-pg-tests-ran.py --nextest-junit target/nextest/default/junit.xml`. Ticked by that lane, not this one. |
| **R18** | Split this file by phase | **YES** | Executed 2026-09-25 in `757aae99f` + `314173266`: the five phase sections moved to `done-todo-open-debt-agents-1.md` and `todo-open-debt-agents-2.md` .. `-5.md`, with the program-level record staying in `todo-open-debt-program.md`. Coverage proved line-for-line against the pre-split original (0 unassigned lines) and the census conserved exactly (15 open / 26 ticked before and after). |
| **R3** | Default-role seeding in `complete_setup` | **YES** | Both options executed 2026-09-25. **(i) was already satisfied, by a later design than the ruling assumed:** ADR #56 §2.2/§2.3 retired `complete_setup`/`write_setup` outright, and the replacement `provision_device` seeds inside its own transaction (`kasirmu-core/src/db/provisioning.rs:443`, step 2, before the owner that references them) — so the fresh-install hole R3 measured is closed without a one-line mirror. **(ii)** was still open and is now closed: `seed_default_roles_scoped` was registered on the desktop only (`apps/desktop-tauri/src/lib.rs:1196`), so the tablet had no re-seed path; it is now a shim over the same bridge body and is registered at `apps/mobile-tauri/src/lib.rs:759`. Guarded by `seed_default_roles_scoped_is_reachable_and_gated_on_the_tablet`, which asserts both the registration and the `staff:manage_roles` refusal. |

**What R10's gate-order half covered when it was executed — and how much is left.**
Fixed 2026-09-24 in `43c0154be`: the five `customers` commands now run
session → gate → store instead of opening the store first. That mattered because
`open_store` is not free — on a cache miss it creates the data directory, creates the
database file and runs migrations (`platform/core/src/database/manager.rs:73-103`) — so an
**unauthorized** caller triggered filesystem work and read `Internal("opening store db")`
where the bridge answers `PermissionDenied`. **The population is far larger than the six
commands R10's text named: a ratchet in `apps/mobile-tauri/src/commands/registration_gate_tests.rs`
(`drift_pin_open_before_gate_population_matches_its_floor`) pins the remaining **69 bodies**
across 18 files, with `settings.rs` alone holding 13.** That number is the honest size of
R10's gate-order half, measured rather than quoted, and the ratchet fails on any addition.

**The R11 correction is the more useful finding, because it is a ruling that must NOT be
executed as written.** Read on its face — *"an audit record must not depend on the build
profile, so the recorder stops depending on a debug-only tier promotion and the bridge
changes"* — it says to flip `crates/kasirmu-bridge/src/auth.rs`'s `debug_upgrade: true` to
`false`. That change was made and **two tests failed**, both asserting the divergence on
purpose: `staff_login_on_free_records_only_because_a_debug_build_promotes_it` and
`the_debug_upgrade_policy_is_per_client_by_design`. The second is explicit — it pins the
asymmetry as text on all three legs and states that *"flipping one call site is not a
decision about the other"*. So R11's actual requirement (the tablet must not mirror the
desktop divergence) was **already satisfied**; what the ruling's wording invites is a
different decision — merging a two-shell policy — which needs its own ruling and its own
edit to the store's per-client paragraph. The change was reverted and the reason recorded
at the call site (`3f8674c96`).

**R9 split cleanly into (a) executed and (b) still open, and (a) turned out to be hiding a
second defect.** R9 ruled two halves and said the first "proceeds independently": **(a)**
derive the *gateway* idempotency key from the already-required `sale_id` at
`apps/cloud-server/src/payment_api.rs`, and **(b)** wire `ResilientProcessor` at the single
construction site rather than the registry.

**(a) is done (`387ea9f56`), and it is a real double-charge fix rather than a tidy-up.** The
key was copied straight off the request body, so a caller that omitted it gave `None` — and
`drivers/qris.rs:347-351` mints a FRESH `order_id` for a `None` key. A timeout followed by a
retry of the same sale therefore produced **two live QRs against one sale**, with no client bug
required. The key is now `qris-{tenant_id}-{sale_id}`. Two details cost real measurement:
the separator is `-` and not `:` because the driver **sanitises** the key
(`drivers/qris.rs:338-346` keeps only `[A-Za-z0-9_-]` and truncates to 44), so a colon would
be *deleted* and collapse `tenant-A/sale-1` onto `tenant-AB/sale1`; and the tenant is
prefixed because `sale_id` is device-generated and unique only within a tenant.

**Executing (a) surfaced a latent defect that had to be fixed for the fix to be safe.** With the
key now stable, the retry arrives with the **same** `order_id` — and the ledger's bare
`INSERT` answered `UNIQUE constraint failed: midtrans_transactions.order_id`, so the endpoint
returned `500 charge issued but not journaled (reconcile order …)` for a charge that was live
*and correctly journaled*. The caller was being told to reconcile manually a row that was already
right. My first test run caught this exactly: `call 1 answered 500 … UNIQUE constraint failed`.
`record_issue` is now idempotent on a **replay** (identical tenant/sale/amount/currency →
`Ok(())`) while still refusing a **collision** (any difference → `Err`), so the invariant its
own doc states — *"a retry that must not silently re-point the ledger"* — is preserved, not
relaxed. The pre-existing `duplicate_order_id_is_rejected_not_merged` still passes untouched,
and a new `identical_retry_is_absorbed_as_a_replay` covers the other half; the pair is the rule,
and the doc now says so, because "idempotent" silently becoming "overwrite" is the failure a
future edit would introduce.

**The guard asserts the WIRE body, not the derived string.** `sent_charge_body`-style
inspection of `transaction_details.order_id` across two identical requests: same key, contains
the sale id, contains the tenant. Asserting the `format!` alone would pass while the value
reaching Midtrans differed, because the driver sanitises and truncates after the handler runs.

**(b) is NOT executed, and the reason is that it is a different kind of change.** Verified at
this tip: `registry.rs` and `payment_api.rs` still contain **0** references to `resilience` or
`Resilient`, so the breaker still sits beside the dispatch path. R9(b) alters payment *routing*
— which processor handles which method, and with what fallback chain — rather than the key a
single charge carries. (a) was safe to land alone because it fixes retries that are unsafe
today; (b) decides new behaviour on the money path and needs its own pass with its own tests.

**R11 is CLOSED as `SATISFIED — enforcement declined, deliberately`, and the pins it leaves
behind are the deliverable.** Re-read at this tip, all four legs of
`the_debug_upgrade_policy_is_per_client_by_design` (`auth_tests.rs:1325`) hold exactly as
written: the tablet passes `false` (1 site), the bridge passes `true` (1 site), the tablet
passes `true` **nowhere** (0 sites, which is what makes the shell's single definition real),
and the store's per-client paragraph still gives the difference its reason
(`kasirmu-core/src/db/audit_security.rs:379-383`). So R11's *requirement* — an audit record
must not depend on the build profile, and the tablet must not mirror the desktop divergence —
is met, and was met before this pass began.

**What is NOT done is the thing R11's wording invites, and it is declined on the pin's own
instructions rather than on my judgement.** The literal reading says flip the bridge's
`debug_upgrade: true` to `false`. That was attempted
(`3f8674c96`) and **two tests failed**, both asserting the divergence on purpose — the second
being this very pin, whose failure message names the precondition: *"If the policies are
genuinely being merged, change `crates/kasirmu-core/src/db/audit_security.rs`'s per-client
paragraph and T5-3 in `.agents/reviews/done-todo-refactor-oz-pos-app-agents-3.md` in the same
pass — flipping one call site is not a decision about the other."* That sentence is an owner
instruction, not a lane's to satisfy: merging the two shells' audit policy is a **new
ruling**, and the store doc's own words ("the flag is the caller's per-client policy, passed
through unchanged") say the current split is the design rather than drift.

**The pin earns its keep by naming its own blind spot, which is why it is cited here rather
than merely counted.** It does not and cannot assert the runtime *effect* of the flag: that
needs a validly-signed Active Free subscription row, and the only fixture that mints one lives
behind the bridge's private `#[cfg(test)] mod testing`, unreachable from the mobile crate. The
effect is pinned on the bridge side instead, by
`staff_login_on_free_records_only_because_a_debug_build_promotes_it`. A reader who finds one
test and assumes it proves the behaviour should read that second citation — the pair is the
assertion, not either half.

**No code changed for R11 this pass, and that is the correct outcome.** It is recorded as a
closed ruling so a future lane does not re-derive the same failed attempt from the same
wording; the revert at `auth.rs` already carries the reason at the call site.

**R3 was already half-executed by work that superseded its premise, and finding that out was
the whole task.** Both options were ruled on 2026-09-20
(`done-todo-owner-rulings.md:100`): (i) mirror the bridge's leading `seed_default_roles()`
into `write_setup` as leg 0, and (ii) register `seed_default_roles_scoped` on the mobile
shell. Re-read at this tip:

* **(i) needs no work, because its subject no longer exists.** ADR #56 §2.2/§2.3 **retired**
  `write_setup` and `complete_setup` outright — the file now carries a "Retired by ADR #56"
  block where those bodies were — and the replacement `provision_device` seeds inside the
  provisioning transaction (`kasirmu-core/src/db/provisioning.rs:443`, step 2, commented as
  "roles before the owner who references them"). So the fresh-install hole R3 measured is
  closed, and closed by the *right* mechanism: not a mirrored line in a shell, but one shared
  implementation both shells call.
* **(ii) was genuinely still open, and it is a reachability defect.** Measured:
  `seed_default_roles_scoped` was registered at `apps/desktop-tauri/src/lib.rs:1196` and
  absent from the tablet's handler list. The bridge body and its `staff:manage_roles` gate
  were already correct and shared; only the second shell's registration was missing. Added as
  a shim (`apps/mobile-tauri/src/commands/setup.rs:175`) and registered at
  `apps/mobile-tauri/src/lib.rs:759`.

**The guard is on the shell surface, and that is deliberate, not incidental.** A bridge-side
test of `seed_default_roles_scoped` would have passed for the entire period the tablet could
not reach it, because the defect was never in the body — it was in which shells wired it up.
`seed_default_roles_scoped_is_reachable_and_gated_on_the_tablet` therefore asserts two
things: the name appears in this shell's own handler list, and a cashier session is refused
with `PermissionDenied`. Mutation-tested both ways — removing the registration fails the run
with *"R3 (ii): the tablet must register seed_default_roles_scoped, or it has no re-seed path
at all while the desktop has one"*, and the deny leg covers the gate.

**One thing this did NOT do, stated so it is not mistaken for finished work.** `ui/src/api/settings.ts:243`
already exports `seedDefaultRolesScoped` and **nothing in the UI calls it** — the client was
written against the desktop surface. Registering the command makes that client functional
rather than dead on the tablet, but *surfacing* a re-seed action in the tablet UI is a product
decision that R3 did not ask for and this pass did not take.

**The general lesson, worth carrying past this file:** a ruling is a claim about intent,
and executing one still requires reading the code it lands on. Two of the five above
moved under re-measurement — R10's population is 69 bodies where its text named 6, and
R11's literal reading contradicts a pinned policy. Neither is visible from the ruling.

**The R10 gate-KIND half is now EXECUTED, and it was smaller than its own census said.**
The table above carried it as "the tablet still calls the non-scope-aware
`require_customer_permission` at 6 sites", reading the six commands as six divergences.
Measured at this tip, that was wrong in the same way R10's gate-ORDER text was wrong in
the other direction: **five of those six call sites are not divergences at all**, because
their bridge twins gate with the *same* non-scope-aware helper.
`crates/kasirmu-bridge/src/customers.rs` gates scope-aware in exactly **one** place —
`get_scoped` at `:430` — while `list_scoped` (`:400`) and the four mutations
(`:461`, `:491`, `:519`, `:548`, `:582`) call `require_customer_permission`,
the identical shape to the shell's. So the honest size of R10's gate-KIND half is
**1 door**, and R10's own shape 1 (`done-todo-owner-rulings.md:258`) named exactly that
one. Executed by **delegating** `get_customer_scoped` to `kasirmu_bridge::customers::get_scoped`
rather than by re-implementing the scope-aware gate shell-side: the two shells now agree by
construction, which is what ADR #49 §4 actually protects, and the body shrank. A scoped
member whose session is out of scope is denied fail-closed on the tablet exactly as on the
desktop.

**The guard is a new test, because the existing one could not see the change.**
`get_customer_scoped_denies_user_without_view_permission` was already green before this
work and stays green after it — both gate forms produce `PermissionDenied` for a role that
lacks the permission, so that test cannot distinguish the delegation from the body it
replaced, and a revert would leave it passing. `get_customer_scoped_denies_view_holder_out_of_scope`
is the test with teeth: the caller holds `customers:view` outright and is denied only
because their scoped assignment covers a different branch. **Mutation-tested rather than
assumed** — restoring the non-scope-aware gate at `customers.rs:430` makes it fail with
`got Ok(None)`, i.e. the customer was returned to an out-of-scope caller, and reverting the
mutation makes it pass. The other test passes in both states, which is the point.

**The `settings.rs` half of gate-KIND, executed the same day, and its census was wrong in a
third way.** The table carried it as "the bridge's `settings.rs` setters still call the
unscoped `require_permission_for_user` at 8". Re-read, the 8 are three different things:

* **7 are genuine gate-KIND divergences** and are now migrated:
  `set_receipt_settings_scoped`, `set_store_settings_scoped`, `set_credit_settings_scoped`,
  `settle_credit_scoped`, `set_hardware_settings_scoped`, `set_setting_scoped`,
  `set_settings_scoped`. Each gated `settings:edit` with the non-scope-aware helper over a
  store `Store` it could only obtain **after** `open_store`, while this module's own readers
  ran `require_session_permission`. So the same two lines carried both halves of R10 at
  once: the wrong KIND *and* the wrong ORDER. Because the scope-aware gate authorizes against
  the GLOBAL identity db, the temporary store-open that existed only to supply a `Store` for
  the check is gone from all seven — the gate now runs before anything touches the
  filesystem.
* **1 is the DEPRECATED `set_setting`**, deliberately left. It takes a caller-supplied
  `user_id`, gates a GLOBAL-db `Store`, and has no session to scope against; migrating it
  would be inventing a session, not adopting a gate. Retiring the door is a separate
  decision.
* **1 was counted as a setter at all by mistake.** `set_user_preferences_scoped` has **no
  gate** — it resolves the session and writes `session.user_id`'s own preferences. That is
  a *missing* gate, the same open question as the ungated readers above it, and R10 is about
  the FORM of gates that exist. It is not folded in, and the module header now says so
  rather than leaving it to be inferred.

**The settings guard needed a sharper assertion than the customers one, and finding that out
is the point.** `scoped_settings_writer_denies_a_settings_edit_holder_out_of_scope` was first
written to `matches!` the `PermissionDenied` variant — and it passed **under the mutation**,
i.e. with no teeth. The reason is worth recording: the unscoped gate runs
`require_permission` against the STORE db, and store dbs carry no `users` rows (identity
lives only in the global db — the rule `ctx.rs:429-435` documents), so it denies with
`"user not found"` and the variant matches anyway. Both forms return the same variant for
different reasons. The assertion now requires the message to name the scope, which is what
`kasirmu-core/src/db/staff.rs:322` emits only on the scope-aware path. Mutation-tested:
restoring the unscoped gate fails with `got "user not found"`, and reverting makes it pass.

**R10's gate-ORDER half: 50 of 69 bodies executed, and the ratchet did its job.** The
population was MEASURED rather than taken from the note, and it split by gate shape:
**50 bodies gate via `require_permission_for_session`**, 9 via a caller-supplied-`user_id`
helper, and 10 via a domain wrapper. The 50 share one exact textual form —
`let (session, conn_arc) = state.resolve_scope(&session_token)?;` immediately followed by
the gate — and they share it for a structural reason worth naming: **`resolve_scope` IS
`resolve_session` + `open_store`** (`apps/mobile-tauri/src/state.rs:290-300`), so the
gate-first order cannot be expressed without splitting the call. The fix is therefore
mechanical and uniform: `resolve_session` → GATE → `resolve_store`. All 50 were converted
across 12 files, and none needed a bespoke edit — which is the evidence that the shape was
as uniform as the census claimed.

**The floor moving 69 → 19 is the ratchet working, not a formality.** Running the suite
before touching the constant produced exactly the failure the test was written to produce:
*"the open-before-gate sweep found 19 bodies, below the pinned floor of 69. A sweep that
finds fewer has stopped matching, not had its subject repaired: if you FIXED bodies, lower
the floor in the same commit."* That two-sided bound is why the drop could not be banked
silently, and the per-file census it printed is what confirmed the 19 were the expected
ones (`tax` 7, `history` 5, `categories` 3, `products` 3, `inventory_counts` 1).

**The order guard is a new test, and the existing permission tests could not see the
change.** `scoped_promotion_writes_deny_a_session_without_promotions_grants` passes with the
gate before *or* after `resolve_scope`, because both orders reach `PermissionDenied` when
the store opens normally. Order is only observable when the store **cannot** open, so
`scoped_promotion_write_gates_before_it_opens_the_store` puts a FILE where the store
manager expects its directory and asserts an unauthorised caller is still refused for the
authorisation reason. Mutation-tested: restoring `resolve_scope` fails it with
`got Err(Internal("opening store db: … Cannot create a file …"))` — which is the leak
R10 describes, reproduced exactly (an authorisation failure surfacing as an infrastructure
error, after filesystem work). The test also carries a control asserting the store really is
unopenable, so it cannot pass because the fixture silently succeeded.

**The remaining 19 are a different job, and the reason is not size.** They gate through a
helper that takes a `user_id` or a domain-specific wrapper, so reordering them means
changing *what the helper authorises against* — a behaviour question per site, not a
mechanical move. Folding them into the same sweep would have hidden that behind a uniform
diff.

**Second sweep, 19 → 7: `tax` and `history`, and both were KIND fixes as well as ORDER.**
`crates/kasirmu-bridge/src/tax.rs` already gates with the non-scope-aware helper, so the
tablet and the bridge **agreed** on tax's KIND and only its ORDER was wrong — a useful
negative result, because it is the opposite of what the `history` pair shows.
`crates/kasirmu-bridge/src/history.rs` gates all five doors with the scope-aware
`require_session_permission` (`:68`, `:169`, `:227`, `:248`, `:306`), while the tablet
gated them with `require_permission_for_user` against the **store** db — a db that carries
no `users` rows, because identity lives only in the global db. So the tablet's history gate
could not succeed for any user; it could only ever deny. That is R10 shape 3
(*"`history`'s five export doors … both differ"*) reproduced in the shell, and the fix is
the bridge's own form: session → scope-aware gate → store.

**The fixture had been arranged to match the broken gate, and the fix is what exposed it.**
Six `history_tests` cases failed after the change, all on their *allow* leg, with
`PermissionDenied("user not found")`. The cause is not the gate: `history_state()` seeded
`user-full`/`role-full` into the **store** database, which is the only place the old
store-db gate would have found them and is not where the product keeps identity. The
identities moved to the global db, and the allow leg now proves the door finds them there.
**Worth stating plainly because "the test failed so I moved the data" is exactly how a
fixture gets weakened to fit**: the assertion that changed is not the one asserting the
behaviour — the deny legs are untouched and still deny. The evidence that the tests did not
get weaker is the mutation below.

**Mutation-tested, and it caught something better than a pass/fail flip.** Removing
`list_sales_scoped`'s gate entirely (leaving the store open and the body otherwise intact)
fails the **deny** leg with a full `SaleListResponse` containing the seeded sale — i.e. a
session without `sales:view` was served the store's sales. The test that guards this door
is a guard on the gate's existence, not merely on its spelling, so the retargeting did not
soften it. Reverted; `history.rs` carries its five gates.

**Two tax tests were retargeted rather than deleted, and the reason is that the subject was
never the wrapper.** `require_tax_permission` was a module-local five-line helper that the
seven tax bodies called; the migration deleted it because the shared
`authz::require_permission_for_session` does the same job plus scope. Two tests called the
deleted helper directly and would not compile. Their actual subject was *"does a tax door
find the user's role in the GLOBAL db"*, so they now drive the shared helper the commands
call — the subject preserved, the spelling discarded.

**Third sweep, 7 → 0: R10's gate-ORDER half is CLOSED, and the floor is now a permanent
pin rather than a countdown.** The last seven were exactly the two groups the previous
round predicted, and both collapsed into the same edit once read: every helper they called
was a module-local wrapper that took a `user_id` and asked the **global** db, so replacing
the call with the shared `authz::require_permission_for_session` preserved the permission
and added the scope — and the wrapper became dead. Four wrappers were deleted as they went:
`require_tax_permission` (previous sweep), `require_category_permission`,
`require_inventory_count_permission`, plus the direct `require_permission_for_user` calls
in `products` and `history`.

**One KIND divergence was left in this group, and it was `products`, not `categories`.**
`crates/kasirmu-bridge/src/products.rs` gates its three write doors scope-aware
(`:668`, `:674`, `:889`, `:895`, `:1006`) while the shell asked the store db, so those
three are KIND+ORDER fixes. `categories` was the opposite: the bridge's own write doors use
the same **non**-scope-aware helper (`kasirmu-bridge/src/categories.rs:193`, `:221`, `:251`),
so only the order moved. Guessing from the module name would have got that backwards.

**Two module headers carried premises this change falsifies, and both are corrected rather
than deleted.** `inventory_counts.rs` said the port was ledger-neutral *because* the gate
kind matched on both sides and that a scope-aware form "would have tightened a gate and been
refused" — true when written, false now, and the header now says the surviving door is
deliberately **stricter** than the nine delegated ones until the bridge's helper is migrated.
`categories.rs` carried an ADR #49 parity reading of **1 / 6** whose numerator was the shared
gate helper; that helper no longer exists on the shell side, so the figure reads **0 / 6**
today. The reading is left as the dated record it was and the correction is recorded forward,
per this file's own rule.

**The zero pin is regression-tested, which is the only thing that makes a zero worth having.**
Reintroducing `resolve_scope` in `delete_product_scoped` fails the run immediately:
*"1 bodies open the store before gating, above the pinned floor of 0 … Per-file census:
{"products.rs": 1}"*. At zero the upper bound is the whole test, so the ratchet stops being a
countdown and becomes the guard it was always aiming at; the lower bound stays as
documentation of the broken-pattern hazard even though `bodies >= 0` is now trivially true.

---

## Phase 1 — The release profile is red and no gate can see it

**Fence:** `crates/kasirmu-bridge/src/**`, `crates/kasirmu-core/src/**`, the release-path runners (`scripts/check.sh`, `scripts/check.ps1`, `scripts/coverage.sh`, `scripts/coverage.ps1`, `scripts/release.sh`, `.github/workflows/release.yml`).
**Commit prefix:** `test(kasirmu-bridge):` · `fix(kasirmu-bridge):` · `test(kasirmu-core):` · `ci(release):`
**Acceptance:** `cargo test -p kasirmu-bridge --release` → **0 failed**, plus a runner that can see this failure set.

### The debt

`cargo test -p kasirmu-bridge --release` does not pass, and **no runner in this repo builds these crates in release**, so nothing reports it.

| Figure | Value | Source |
|---|---|---|
| release result, **measured at authoring HEAD `257ff6122`** | **1231 passed / 76 failed / 0 ignored**, `finished in 181.69s`, command wall time 5m49s including the release compile | **run this pass** — `cargo test -p oz-bridge --release`, result line verbatim |
| release result, earlier record | 1228 passed / 76 FAILED / exit 101 | `[carried]` `todo-refactor-oz-pos-app-agents-3.md:142`, a dated record of one real run |
| debug result | 1305 passed / 0 failed | `[carried]` same |
| release test in `scripts/check.sh` | `grep -c -- --release scripts/check.sh` → **0** | `[carried]` same, re-run 2026-09-14 |
| release test in CI | `dev-ci.yml:244` is `cargo nextest run --workspace --all-features` — no `--release` | measured this pass |

**The re-run confirms the earlier record on both axes, and the confirmation is the interesting part.** The predicted values were 1228 + 3 = **1231 passed** and **76 failed, unchanged**; the measured values are exactly that. So:

- The **failure count did not move** — nothing has landed since the record that adds or removes a release-only failure.
- The **passed count moved by exactly +3**, which is `68e6dd356`'s three `#[tokio::test]` cases, exactly as the record predicted.
- **The per-module breakdown reproduces exactly** — subscription 21 · auth 18 · audit 11 · pos 7 · staff 6 · workspaces 5 · inventory 4 · terminals 2 · locations 2 = 76. (Counted from the failing-test name list, which the runner truncates to the tail; the 20 names not shown are the audit 11 plus the remaining auth 9, which is what makes the visible 56 sum to 76.)

**One observation the classification task must handle, and it crosses into Phase 3.** Among the failures are the *scope* tests: `subscription::subscription_tests::verdict_scope_clears_inside_the_assigned_location`, `…verdict_scope_denies_when_the_assignment_excludes_the_session_location`, `…verdict_scope_denies_when_the_workspace_dimension_excludes_the_session_type`, plus `workspaces::workspaces_tests::scoped_assignment_branch_dimension_denies_out_of_scope_store_for_session`, `…scoped_assignment_filters_session_workspace_listing`, `…scoped_assignment_workspace_dimension_filters_for_store_listing`. **Phase 3's branch/workspace scope surface is currently red in release.** The likeliest cause is the same sentinel fixture dishonesty (these tests need a verifying signature), which would make it Phase 1's problem rather than a scope-logic defect — but that is a hypothesis, not a finding. Classify it before Phase 3b writes anything against that surface.

**Environmental note, not a repo defect:** the build's stderr carried a sandbox security-policy block on `wmic.exe` and `reg.exe`. The release build and the whole test run completed regardless, and the result is consistent with the prior record, so the block is recorded as an environment characteristic of this sandbox rather than a cause of anything.

Failure families, `[carried]` from the same record and **not** re-classified by the re-run above: 39× `InvalidSubscriptionSignature … Invalid symbol 95, offset 9`; ~16× `assertion left == right`; ~10× `PermissionDenied("audit log requires the Premium plan or above (current tier: Free)")`. The re-run confirms the *counts*; it does not confirm the *causes*, which is the classification box below.

### What is already established — do not re-derive

- **The 39 base64 reds are a test-fixture defect, not a broken signature path.** `crates/kasirmu-core/src/license_verification.rs:391-394` returns `Ok(())` for the sentinel `BOOTSTRAP_FREE` under `#[cfg(debug_assertions)]` only; in release the same string reaches a standard base64 decode at `:398` and fails on the `_` in the sentinel's own text. Producer and consumer alphabets agree (`apps/license-server/main.go:1113` `base64.StdEncoding.EncodeToString`), and a forged non-sentinel signature still fails closed in BOTH profiles. `[carried]`
- **The sentinel is also the production seed.** `crates/kasirmu-core/migrations/20260813_init.sql:1512-1514` writes `BOOTSTRAP_FREE` into every fresh install; the PG twin repeats it at `20260813_init.pg.sql:2100-2101` and is **generated** by `scripts/generate-pg-migration.py`, never hand-edited. Activation rewrites the row (`crates/oz-bridge/src/license.rs:175` → `crates/oz-core/src/license_verification.rs:625` `INSERT OR REPLACE`), so an activated install never sees the sentinel. `[carried]`
- **The 1305 → 1304 gap is one `#[test]` compiled out of release**, not a miscount: `crates/kasirmu-bridge/src/sync_tests.rs:35-37` is `#[cfg(debug_assertions)]`. `[carried]`
- **The both-profile assertion idiom already exists here and is proven to fail.** `crates/kasirmu-core/src/db/audit_security_tests.rs:418` (`assert_eq!(recorded, cfg!(debug_assertions))`) and `crates/oz-bridge/src/subscription_tests.rs:26/39-48`, with `crates/oz-bridge/src/license_tests.rs:475-479` as its first use inside `oz-bridge`. So the absence of such an assertion at a site is a coverage gap, not a language limitation. `[carried]`

### Tasks

- [x] **Reproduce and record.** `cargo test -p oz-bridge --release` at HEAD `257ff6122` → **1231 passed / 76 failed**, `finished in 181.69s`. Reproduces the earlier record exactly (see the table above). Done in this pass; the numbers are in "The debt".
- [x] **Classify each of the 76.** Per failing test, decide (a) *fixture is profile-dishonest* — it seeds the sentinel and asserts a debug-only outcome, or (b) *genuine profile difference*. The count 76 must not be "corrected" by a passing test: a test that passes in both profiles lands in `passed` and cannot move the failure count.  RE-SCOPED, not done. The per-test arm now sits downstream of ONE root cause the owner page carries as **item 14, "Is a seeded sentinel debt at all if no CI leg ever compiles the profile that rejects it?"** (`docs/plans/notes.md:1380`), and the population is stated there as 368 test-shaped sites rather than 76 independent failures. Box stays open: the classification verdict table was never written.
  - Start with the six scope tests named above — they are the ones Phase 3b will build on.
  - `crates/kasirmu-bridge/src/locations_tests.rs:147-148` is a worked example of the failure mode in the other direction: *"Plus is used instead of Free because debug builds upgrade only the bootstrap Free tier"* — i.e. the author routed AROUND the bypass rather than asserting it in either profile.
- [x] **Close the one bypass still unreachable under test: `crates/kasirmu-bridge/src/locations.rs:231-236`.** All three calling tests currently die one line earlier at `:227` `sub.verify_signature()?` on the sentinel. Determine whether a release-side assertion is reachable at all; **if it is not, record it as a parked arm beside `license.rs:670-683` rather than weakening production or faking a test.** Do not apply a shared bootstrap/Free helper to the ~21 token-required sites — that would convert a loud forged-row error (pinned in both profiles at `crates/oz-bridge/src/auth_tests.rs:400-402`) into a silent Free run.  ANCHORS HOLD, live: `crates/oz-bridge/src/locations.rs:231-236` is still the `#[cfg(debug_assertions)]` tier swap ahead of `store.enforce_location_quota(&tier)?` at `:237`, and `crates/oz-bridge/src/sync_tests.rs:35-37` is still `#[cfg(test)]` + `#[cfg(debug_assertions)]`.
- [x] **Fix the profile-dishonest fixtures** using the existing both-profile idiom, so each assertion is true in debug AND release rather than weakened in one. Prove each fix is *failable*: mutate the line, confirm the opposite profile goes red, restore.
- [x] **Decide `crates/kasirmu-bridge/src/sync_tests.rs:35-37`.** Either it should run in release (drop the `cfg`) or the doc should stop presenting the debug/release total gap as unexplained.
- [x] **Add a `--release` runner.** The recorded options are `scripts/release.sh:62,65` and `.github/workflows/release.yml:149` — note both currently carry `--exclude kasirmu-app --exclude kasirmu-mobile`. Do **not** drop those excludes on the strength of a green debug run. A cheap alternative that satisfies "some gate can see it" without touching the release path is a dedicated release-test step in `dev-ci.yml` or `scripts/check.sh`.  STILL A LIVE DEFECT, re-measured tonight: `git grep -n -e '--release' -- .github/workflows/dev-ci.yml` → NOMATCH, and the three recorded runners still exclude by crate — `scripts/release.sh:62,65`, `.github/workflows/release.yml:149` and the `test workspace (nextest)` step in `scripts/check.sh` (`grep -n 'test workspace (nextest)' scripts/check.sh`) each carry `--exclude oz-pos-app --exclude oz-pos-tablet` with no `--release`. No leg compiles the profile that rejects the seed.
- [x] **Owner ruling required — the parked arm.** `crates/kasirmu-bridge/src/license.rs:670-683` (expired past grace → `is_active: false` + `Expired`) cannot be executed from this crate: reaching it needs a payload whose signature verifies, and `license_verification.rs:36` embeds only the public half. Both ways to cover it change production (an injected verifier on the call path, or a `#[cfg(test)]` key compiled in). **Recommendation on record: leave it parked rather than weakening production to make a test reachable.** Get the ruling; do not decide it in a worker lane.  STILL PARKED, anchor verified at `crates/oz-bridge/src/license.rs:670-673` (`#[cfg(not(debug_assertions))]` → `is_active: false`). Blocked on the ruling named in this row, not on code.
- [ ] **Commit milestones** — one per logical step, e.g. `test(kasirmu-bridge): assert the location-quota bypass in both build profiles`.
  - **2026-09-15, docs audit at HEAD `460e33285`:** NOT WORK. The box restates a rule that already binds every worker (`AGENTS.md` §3, one pathspec commit per logical step; this file's own Program rules at `:23`) — it can be neither done nor undone, so it is counted here as not-work rather than as a debt.

**Ticked 2026-09-20 (authoring HEAD `42c7d1e43`) — the six Phase 1 boxes above, each with its evidence.** The owner ruled on all 21 open decisions (`done-todo-owner-rulings.md`, the `RULING (owner, 2026-09-20)` lines); these are the ones that land in this phase. **No test suite was re-run to justify these ticks, and none needed to be:** every one is paid by **a file that now exists** or by **the owner's own instruction to tick**, not by a green borrowed from a dirty tree. What was run is the compile gate for the one code change — `cargo check -p kasirmu-bridge` → `Finished dev profile ... in 48.91s`, 0 errors. The phase acceptance is unaffected and still reads `cargo test -p kasirmu-bridge --release` → 0 failed, recorded at `:577` and re-verified at `:648`.

- **`:131` (classify each of the 76) — OBVIATED, not done.** The set to classify is empty: `--release` reaches 0 failed, so no failing test is left to sort into *profile-dishonest fixture* vs *genuine difference*. The 76 did not reach 0 by weakening an assertion — the **mechanism** was fixed by the 2026-09-19 ruling (`:565-573`: `verify_signature` honours `BOOTSTRAP_FREE` for a `free` tier in both profiles), so the box's own guard ("the count must not be 'corrected' by a passing test") is respected rather than dodged.
- **`:134` (the location-quota parked arm) — PAID in the code.** `crates/kasirmu-bridge/src/locations.rs:236-247` reads *"Dev shim, and a deliberately PARKED release arm (`todo-open-debt-program.md:109`)"* and names the same structural reason this pass's R1 comment names.
- **`:135` (fix the profile-dishonest fixtures) — PAID, and this file already said so.** `:560` recorded that the fixtures "were fixed elsewhere". The receipt is the fixture vocabulary: `crates/kasirmu-bridge/src/testing.rs` now carries `seeded_row_loads()`, `seeded_row_reaches_a_paid_tier()` and `seeded_row_verdict_for_tier(stamp)` (`:598-605`), and the migrations landed in `fd925d5c7` / `b1d7118` (`:572`).
- **`:136` (the `sync_tests.rs` debug gate) — RULED, AND TICKED ON THE OWNER'S INSTRUCTION.** R2 = *"keep the `cfg` gate, declare the debug/release gap explained, and tick the box."* The tree went further than the ruling asked: `crates/kasirmu-bridge/src/sync_tests.rs:43-92` is now a **two-profile pair** — `sync_probe_falls_back_to_cloud_url_when_unconfigured` (`#[cfg(debug_assertions)]`, `:60-73`) and `sync_probe_does_not_fall_back_to_cloud_url_in_release` (`#[cfg(not(debug_assertions))]`, `:82-92`) — and the file's own comment records that **debug total minus release total is now 0, not 1**, with *"a gap of 1 now means a real test is missing from one side"*. The release arm pins a security property — production must never probe a URL the operator did not configure — that had **no test in either profile** before it existed.
- **`:137` (add a `--release` runner) — PAID.** `.github/workflows/dev-ci.yml:290` defines the `release-bridge-test` job and `:311` runs `cargo nextest run -p kasirmu-bridge --release`. The `libudev-dev pkg-config` fix from the 2026-09-18 pass (`:649`) is in the same job, so the gate reaches its own tests instead of dying in a build script. Its comment block (`:255-289`) is the durable explanation of the release-profile story, including R2's outcome.
- **`:138` (the parked arm) — RULED, and the reason is now in the code, which is exactly what R1 asked for.** R1 = *"(i) — leave the arm parked and record the reason in the doc comment. No production change."* The comment did not exist; it does now, at `crates/kasirmu-bridge/src/license.rs:670-686`. It carries the structural reason — reaching the arm needs a payload whose signature **verifies**, `verify_license_signature` takes no key parameter and reads a build-time `include_str!` public key (`kasirmu-core/src/license_verification.rs:36`), and the private half is gitignored and absent from the checkout — and it records the ruling's refusal of both alternatives: a verification seam would put a substitution point on the one code path whose job is to refuse forged licences, and a `#[cfg(test)]` key would ship a private key in the source tree.
- **`:139` (commit milestones) — still NOT WORK**, unchanged, per `:140`'s own 2026-09-15 note. Deliberately left unticked: a rule that binds every worker can be neither done nor undone.

**Census by this file's own any-depth method (`:78-87`), measured at the moment of this edit: 28 open / 13 ticked** (`grep -cE '^[[:space:]]*- \[ \]' todo-open-debt-program.md` and its `[x]` twin). The six ticks above move it to **22 open / 19 ticked**. `:636`'s 29/12 is a dated record and is left as written; it differs from the pre-edit count because another lane ticked one box in between.

**Both of `:655`'s conditions are now satisfied, so Phase 1's boxes are closed — and the file still cannot be renamed.** `:655` named two things that would change the rename verdict: the `:138` owner ruling on the parked arm, and the Phase 3b product ruling on the organisation axis. Both landed 2026-09-20 — R1 and R5 — and `:565` had already met Phase 1's acceptance. What keeps this file on `todo-` is Phases 2 to 5, exactly as `:634` describes: a `done-` prefix would be *"a claim about one phase wearing the filename of five"*.

### Why this phase is first

It is the only one of the four where the repository is **already failing a command**, and its blast radius includes Phase 2: the failure is *live* on the tablet shell, which registers zero license commands (`grep -c license apps/tablet-client/src/lib.rs` → **0**, measured) and has no licence gate in `ui/src/frontend/shell/tablet/TabletAppShell.tsx:64-84`. `[carried]` Reachable today only via a hand-built release APK, because `android.yml`/`ios.yml` are `.bak` and no live workflow builds mobile.

---

## Phase 1 re-measured 2026-09-16 (HEAD `0289509b8`) — the 76 is now 1, and the 1 is deliberate

Both profiles run by this lane on the same tree, with the proxy unset (`env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy`, per the localhost-HTTP trap that otherwise fails every binding test here):

```bash
cargo test -p oz-bridge              # 1317 passed; 0 failed   (234.85s)
cargo test -p oz-bridge --release    # 1315 passed; 1 failed   (195.65s)
```

- **The headline has rotted from 76 to 1.** `:105` records **1231 passed / 76 failed** at HEAD `257ff6122`; measured now it is **1315 passed / 1 failed**. Other lanes closed 75 of them in the two days since. The classification box at `:106` is *re-scoped* rather than done, and one reason is now visible: the population moved underneath it twice.
- **The sanity check holds: debug total − release total = 1** (1317 − 1316), which is the single `#[cfg(debug_assertions)]` test at `crates/oz-bridge/src/sync_tests.rs:35-37`. The anchor was re-verified live this pass and is still `#[cfg(debug_assertions)]` + `#[test]`, so the gap is fully explained and is not a miscount.
- **The survivor is deliberately red, and the code says so.** `staff::security_events_tests::a_rejected_create_records_no_security_event` panics at `crates/oz-bridge/src/staff_security_events_tests.rs:209` with `InvalidSubscriptionSignature … Invalid symbol 95, offset 9` — symbol 95 is `_`, the underscore in `BOOTSTRAP_FREE`, i.e. exactly the release/base64 mechanism `:98` describes. Its own comment reads: *"DELIBERATELY LEFT RED in the release profile … Forking here would turn the test green while its subject — the recorder staying silent on a rejected mutation — stops being exercised … A green that asserts nothing is worse than a red with a reason; the honest fix is a verifying seeded row, which is an owner decision and not a fixture edit."* **That pattern occurs exactly once in the tree** (`grep -rc "DELIBERATELY LEFT RED" crates/ --include=*.rs | grep -v ":0"` → 1 file, 1 occurrence), so it is a decision, not a class.
- **The dispatch consequence is the useful part: Phase 1's remaining work is one owner ruling, not 76 fixture fixes.** `:110` (fix the profile-dishonest fixtures) and `:106` (classify each of the 76) have almost nothing left to bite on — the fixtures were fixed elsewhere, and the one survivor refuses a fixture edit on principle. What remains is the *verifying seeded row* its comment names: the same shape as the parked arm at `:113`, and like it, blocked on the owner rather than on code. **Until that ruling lands, `--release` cannot reach 0 failed, so Phase 1's acceptance stays unmet and a `--release` gate (`:112`) would land red** — which is the house rule's reason for ordering cleanup before enforcement.
- **Nothing here was fixed by this pass.** No source file was touched; the two commands above are the whole of the work, and the census is unchanged at **29 open / 11 ticked** (any-depth, per `:53`). <!-- CENSUS ROT, corrected forward 2026-09-24 at HEAD `e4476d9f4`: re-derived with this file's own canonical pair, the live figure is **16 open / 25 ticked**. The figure above is a dated record and is left verbatim; it drifted because boxes were ticked by other lanes after it was written. See the disposition split at `:89`. -->

---

## Phase 1 closed 2026-09-19 (HEAD `31aa530fe`) — the ruling landed and `--release` is 0 failed

The owner ruled on the question the block above parks: **the schema-seeded Free row must load in EVERY
profile, and the sentinel is honoured only for a Free tier.** Landed in
`crates/kasirmu-core/src/subscription.rs` — `TenantSubscription::verify_signature` accepts `BOOTSTRAP_FREE`
whenever `tier_key()` is `free`, in debug and in release alike; a sentinel-signed row claiming a PAID tier
still falls through to the base64 decode and is rejected there, which is the security property the old
debug-only arm was protecting. Commits: `fd925d5c7` (fix + bridge fixture migration) · `b1d7118` (tablet twin
+ its fixture migration) · `4761f1bd9` (cross-reference note) · `31aa530fe` (comment repair).

```bash
cargo test -p kasirmu-bridge              # 1346 passed; 0 failed
cargo test -p kasirmu-bridge --release    # 1346 passed; 0 failed
cargo test -p kasirmu-mobile --lib        #  677 passed; 0 failed
cargo test --release -p kasirmu-mobile --lib   #  677 passed; 0 failed
```

- **The acceptance this file was waiting on is met.** `--release` reaches **0 failed**, so the sentence at
  `:558` ("Until that ruling lands, `--release` cannot reach 0 failed") is now the opposite of the truth, and
  the gate at `:112` would no longer land red.
- **The survivor named above is no longer red, and no longer needs to be.**
  `grep -rn "DELIBERATELY LEFT RED" crates/ apps/ --include=*.rs` now returns **nothing**. The test it named,
  `staff::security_events_tests::a_rejected_create_records_no_security_event`, was re-cut so the refusal under
  test is a *permission* one, with its duplicate-username half moved to the forked sibling
  `a_duplicate_username_create_records_no_security_event` — a fixture edit the parked comment had refused
  *precisely because the verifying seeded row it wanted did not exist*. It exists now, which is the whole
  point of the ruling.
- **Two behaviour changes fell out and are correct, not regressions.** A Free tenant's login audit row is now
  **1 in debug / 0 in release** (was 1 in both): the skip at `db/audit_security.rs:389` is
  `ent.loaded && audit_retention_days().is_none()`, and release used to write *because the row was
  unverifiable*. And `create_location_profile_scoped_end_to_end_owner` is now refused in release by the **Free
  store quota** (`SubscriptionLimitExceeded`) rather than at the signature — the signature refusal *was* the
  bug the ruling fixed.
- **The fixture vocabulary split in two, and that is the part a re-run must know.**
  `crates/kasirmu-bridge/src/testing.rs` now carries `seeded_row_loads()` (true in **both** profiles),
  `seeded_row_reaches_a_paid_tier()` (`== cfg!(debug_assertions)`), and
  `seeded_row_verdict_for_tier(stamp)` for the shared guards. A fixture that restamps a paid tier must fork on
  the second, not the first; the guards must be passed the **stamp**, not a bool. The tablet cannot import
  them (`kasirmu_bridge::testing` is a private `mod`), so `apps/mobile-tauri/src/commands/testing.rs` is a
  hand-kept twin — the bridge's copy is the authority. Traps and the full procedure:
  `ozpos-release-profile-fork`.
- **The pre-rebrand paths this file quotes throughout (`crates/oz-bridge/…`, `crates/oz-core/…`) still resolve
  to nothing.** They are `kasirmu-*` today; that class is tracked in the rotted-claims table above, and the
  four commands in this block are the current form. `[carried]`

---

## Phase 1 CLOSED 2026-09-16 — the deliberately-red survivor is green, and the "verifying seeded row" it asked for was the wrong fix

Two commits, both measured in **both** profiles:

```bash
cargo test -p oz-bridge              # 1318 passed; 0 failed   (219.06s)
cargo test -p oz-bridge --release    # 1317 passed; 0 failed   (187.73s)
```

- **`--release` now reaches 0 failed**, so the acceptance the block above said was unmet is met, and a `--release` gate (`:112`) no longer lands red. The sanity check still holds: **1318 − 1317 = 1**, the single `#[cfg(debug_assertions)]` test at `crates/oz-bridge/src/sync_tests.rs:35-37`.
- **The "verifying seeded row" was not the fix — it is not available, and the earlier block was wrong to adopt the test's own framing.** That phrase came from the test's comment, and it reads like a fixture edit; it is not one. `verify_license_signature` takes no key parameter and reads a build-time `include_str!` public key, while the private half is git-ignored (`*.key`) and absent — `ls crates/oz-core/*.key*` returns only `oz-license.key.pub`. **No fixture in this crate can mint a signature that verifies**, so no seeded row lets a release create through. A verification seam would be a production change, and making release accept the sentinel instead would move a licence bypass into the shipped binary. The no-seam proof is at `crates/oz-bridge/src/testing.rs:103-148`; the one-command check above is the whole verification.
- **The actual fix moves the claim upstream of the subscription read.** `create_staff_scoped` gates `staff:create` at `staff.rs:1073` and only reaches `sub.verify_signature()` at `:1080` — so a *permission* refusal is live in both profiles while a *duplicate-username* one is not. `a_rejected_create_records_no_security_event` (`2dc500382`) now refuses at the permission gate, which is upstream of `:1080`, and additionally pins that no user row was written so the refusal cannot pass as a passport stamp. Its subject — a refused create writes no audit row — is therefore genuinely exercised in release instead of going green on `0 == 0`.
- **The duplicate half survives as its own test**, `a_duplicate_username_create_records_no_security_event`, forked on `seeded_row_loads()`: debug asserts it against a **non-zero** baseline (`before == 1`, so it is never `0 == 0`), release asserts the seeded-row refusal with row existence pinned and stops. Coverage was not traded away to get the green.
- **3a.2's default is ruled FAIL CLOSED (owner 2026-09-16).** An unknown role floor on an admin-tool gate must deny. `roleAtLeast` (`ui/src/utils/role.ts:72`) demands `Number.MAX_SAFE_INTEGER` for an unrecognised floor; the inline `?? 0` in `WorkspaceHome.canAccessTool` demanded **0**, so every role cleared it — a latent fail-open on an admin surface. The gate now routes through `roleAtLeast` (`a8c1fb4c5`), collapsing two consumers of one table onto one default. Type-blocked today (`ToolRole` is `owner|admin|manager`, all in the table), so it is behaviour-neutral now and removes the latent case. Pinned by two new tests in `role.test.ts`: an unknown floor denies every role, and a **custom role clears no preset floor** — the second is the property the doctrine exists to protect, and it is what 3a.2's remaining work (replacing rank comparisons with permission checks) must be measured against. `role.test.ts` 27 → **29**; the Tools parity surface re-measured at **39/39** across `WorkspaceHomeTools.test.tsx` (9) + `WorkspaceHomeTools.navParity.test.tsx` (2) + `pageRegistry.test.ts` (28) — that figure was recorded as *run* at `:217` with an explicit "re-run before relying on it", and it is now actually re-run.
- Census unchanged at **29 open / 11 ticked**; no box was ticked by this pass, so the counters are preserved rather than massaged. <!-- CENSUS ROT, corrected forward 2026-09-24 at HEAD `e4476d9f4`: re-derived with this file's own canonical pair, the live figure is **16 open / 25 ticked**. The figure above is a dated record and is left verbatim; it drifted because boxes were ticked by other lanes after it was written. See the disposition split at `:89`. -->

**Method note for whoever takes the next release-profile fixture.** The transferable move is *read the command body for a gate before the subscription read*. `2dc500382` did not make the signature verify; it changed what the test refuses at, so the claim landed on a gate both profiles can reach. Check that before concluding a case is parked, and before forking anything on `seeded_row_loads()` — a fork is the right answer only when no upstream gate exists.

---
