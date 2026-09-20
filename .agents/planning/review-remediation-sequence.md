# Remediation Sequence - Codebase Review, 2026-09-12

Derived from the review's own findings plus a sequencing pass by spawn_thinker (f05fe3dc). Every claim below carries the
evidence in `.agents/manager-journal-codebase-review.md` (3,897 lines; kept on disk and gitignored, not a tracked path — it is
cited here by location, not as repo history) and the report in
`.agents/review-backlog-codebase-review.md`. *** NOTHING IN THIS REVIEW WAS COMPILED, TESTED, OR RUN AGAINST A DATABASE - THE
ONE EXCEPTIONS ARE LISTED IN SECTION D. READ THAT BEFORE ACTING ON ANY OF IT. ***

## ON FIRE / SAFE TO IGNORE TODAY

**On fire.** An unreviewed second agent is editing this tree faster than the review can cite it: SEVEN COMMITS LANDED IN ~20
MINUTES WHILE WORKERS WERE STILL READING THE FILES THEY CHANGED, AND 23 ENTRIES REMAIN DIRTY WITH FIVE MID-EDIT. The one fact that
could have made HEAD itself uncompilable (a committed `include_str!` pointing at an untracked migration) *** WAS CHECKED AT 02:40
AND IS RESOLVED - 707ab6889 ADDED THE .sql AND ITS REGISTRY ENTRY IN THE SAME COMMIT. HEAD IS NOT BROKEN. *** The remaining live
risk is `offline.rs:238`, STILL UNCOMMITTED, which is the one change that would turn a silent-but-latent defect into merchant
data loss. It is also the only fix in this review that is cheap to make correctly - **though it has been uncommitted since ~21:40
yesterday, so 'cheap' means 'nobody has claimed it', not 'nobody is about to ship it'.**

**Safe to ignore today.** The sync-never-on chain, the remote-poisonable `/status` write, and the whole wire-mismatch class - all
three are latent by default (behind a flag no production build can set; a trust decision about your own server; and a question a
two-minute manual test settles anyway). None of them is made safer by attention before the ledger, the HEAD check, and the commit
freeze are done.

## A. THE 23 DIRTY ENTRIES - PARKED FOR OWNER, RECOMMENDATION: HOLD-AND-TRIAGE

| Option | Consequence |
|---|---|
| COMMIT-AS-IS | Ships the one behaviour-changing hunk that makes things worse (`offline.rs:238`, placed *after* `create_sale` +
  `Completed`, turns a latent never-syncs into a live sale-recorded-sync-refused) - and drags in five files another agent is
  mid-edit, inheriting whatever they had staged. This is the exact `3b10ea3a` failure AGENTS.md documents. |
| COMMIT-IN-PARTS | Correct end state, wrong tonight: freezes `:238` at its bad position, and each part needs an explicit pathspec
  on a tree where five files are being edited under you - a race not winnable by being careful. |
| REVERT | *** WORST OPTION - destroys work you have not read: *** the *uncommitted* half of the refund remediation
  (`offline_tests.rs`, `quota_gate.rs`, the PG generator, the ADR) and any still-untracked migration. The cumulative refund bound
  itself is already committed (`53fffa8c1`), so this loses only the parts nobody has reviewed yet. |
| **HOLD-AND-TRIAGE (recommended)** | Zero commits until the three measurements in B land. Preserves the one asset this review
  produced - `:238` is *not yet shipped*, so the bad placement is still a proposal, not a regression. Cost: the tree stays unsafe
  to build from for a few more hours. **CORRECTED 02:44:** the five `MM` files are NOT mid-edit - their mtimes are 09:38/09:48
  yesterday and 04:41 today, so `MM` meant *index differs from worktree since yesterday morning*, not *being edited this second*.
  The reason to hold is now weaker and stranger: **the `:238` hunk has sat uncommitted for ~5 hours**, so it may be parked,
  abandoned, or forgotten - and if it is forgotten it lands whenever the dirty set is, with nobody ever reviewing its placement. |

**Why HOLD, as reasoning not preference.** Every option's risk is dominated by a fact outside the dirty set: `0d0c1eda5` (committed)
mints a checkout idempotency key, and its migration was briefly untracked while `migrations.rs` `include_str!`d it. **Had that
held, HEAD would not have compiled for anyone who cloned it** - which is not an input to a commit decision, it is a P0 that
outranks all four options. It resolved on check, and the check was ten seconds of `git ls-tree` + `git show` that neither worker
nor I had run until the thinker promoted the question and handed me the command.

**Hazards to name explicitly.** (1) The build break is one-directional: committing `migrations.rs` without adding the `.sql` bricks
the build, and `git add -A` commits another agent's mid-edit files - the only safe move is both paths in one explicit-pathspec
commit. (2) A migration dated `20261001` on a 2026-09-12 clock sorts after every existing migration in registry order; the file's
own comment says that is deliberate (`Date 20261001 sorts after the last`), but it means an existing till migrates it last or
never. (3) `git stash` and `--amend` are both forbidden on this tree by AGENTS.md - there is no park-it-sideways move. (4)
`manager-2-journal.md` is TRACKED and MODIFIED: the next commit turns another agent's private notes into product history. (5) The
license-server dirty files (`main.go`, `web_otp.go`, `web_password.go`) are the vendor side of the `/status` finding and belong to
a different owner's decision - they may be REMOVING the property this report publishes.

## B. THE SEQUENCE - no code fix before a measurement

**Phase 1 - STOP FURTHER DATA LOSS (60 min, zero edits).**
- **B-1 (10 s, decides everything else, DONE at 02:40 - CLEAN):** `git ls-tree HEAD -- crates/oz-core/migrations/ | grep
  idempotency` and `git show HEAD:crates/oz-core/src/migrations.rs | grep idempotency`. Both now yes, in the same commit.
  **LOOSE END CLOSED 20 MINUTES LATER, NOT BY ME:** commit `5ebffa391` (02:57) wired it - `pg.rs:1693-1760` now carries
  `claim_sale_idempotency`/`release_sale_idempotency` (7 references), `routes/sales.rs` 7, plus a new `sales_idempotency_tests.rs`
  (313 lines). `git grep -c sale_idempotency HEAD` returning only `migrations.rs` was true at 02:40 and false by 03:00: the tree
  outran the review again. **NEW OPEN QUESTION, DISPATCHED AT 03:05, ANSWER PENDING:** `pg.rs:1791` inserts `VALUES ($1, NULL, $2)`
  - a literal NULL key - and a PostgreSQL UNIQUE index does not treat two NULLs as equal. So either the design is correct (a partial
  index, or a deliberate no-key path) or a retry without an `Idempotency-Key` header is exactly the double-post the table was added
  to stop. Separately unconfirmed: whether the guard is cloud-only, since the SQLite side still shows no `sale_idempotency`
  reference outside `migrations.rs` - on an offline-first POS, a cloud-only idempotency guard does not cover the till.
- **B-2 (2 min, a human, no tooling): ring one real desktop sale on a built till, and one tablet sale.** This is the only
  measurement in the room where the wire-mismatch question's two branches predict *different* outcomes (`saleId`/`cartId`
  undefined vs readable). Nothing else separates them - every file read all night is consistent with both. Proof: a screenshot or
  the logged `loggedInvoke` response. *** IF IT CANNOT BE DONE TONIGHT (NO BUILDABLE ARTIFACT), THE PARADOX STAYS UNRESOLVED AND THE
  FINDING MUST PUBLISH WITH THE PARADOX ATTACHED, NOT SMOOTHED. ***
- **B-3 (15 min, read-only):** grep one till's actual log store for the two strings that already exist in the code: `"sync
  enqueuer: failed to enqueue completed sale"` and `"event handler failed"`. Separates *live* from *latent* for the enqueue
  finding without touching code. *** DEPENDS ON AN UNCHECKED PREMISE: nobody in this review verified that the `error!` lines reach
  a persisted sink rather than a console. If console-only in release, B-3 returns nothing even when it fired - AND THAT IS ITSELF
  THE FINDING. ***

**Phase 2 - RESTORE VISIBILITY (half a day, still no behaviour change).**
- Publish the ledger in D as an artifact, not a habit: every finding carries *how it was known* (path-read vs executed).
- Make the invisible classes observable. The wire mismatch is invisible because `PaymentModal.tsx:1061-1063` eats the re-fetch
  error and the dev-mock answers both spellings at `tauri-api.ts:3581` and neither at `:3630`; the enqueue is invisible because
  `event_bus.rs:259-267` maps it to a log line. *** FIX = A LOG OR AN ASSERT, NOT A REDESIGN: TWO LINES EACH. *** Proof: B-2's
  response JSON and B-3's log grep, both re-runnable.

**Phase 3 - FIX CODE, in this order, each with a falsifiable proof.**
1. *** DECIDE EXPLICITLY WHETHER THE UNCOMMITTED `offline.rs:238` HUNK IS WANTED AT ALL, AND IF IT IS, MOVE IT BEFORE
   `create_sale` *** (or make it refuse the *sale*, not the sync). Proof: a test showing an expired subscription leaves NO
   `Completed` row. **The only item that prevents new damage - but as of 02:44 it has been sitting in the working tree since ~21:40
   yesterday, so this is not 'catch it before it ships', it is 'nobody has decided it exists'. Whoever owns that hunk is unknown,
   which is the review's process finding in miniature.**
2. **Make the enqueue failure non-silent** - the queue row's existence must be observable to the caller, not logged. Proof: an
   *integration* test asserting a queue row after `finalize_sale`, not a unit test of the handler.
3. **The checkout wire contract** - only after B-2 says which spelling ships. Proof: B-2 re-run shows `saleId` populated.
4. **Then** the sync enable-flag writer. **Last** the unsigned `/status` chain - *** WHICH IS A TRUST DECISION ABOUT YOUR OWN
   SERVER, NOT A BUG, AND SHOULD NOT BE PATCHED AS IF IT WERE ONE. ***
5. **Cheap and independent, from the authz pass:** 46 callable commands that authenticate a session and check no permission. One
   line each, `ctx.require_user_permission_scoped(..., permissions::X)`, with keys the registry already has (`products:read`,
   `payments:card`, `settings:edit`, `terminals:read`, `workspaces:switch`) plus two new keys for the hardware and license
   families, which have no vocabulary to check against at all.

## C. PROCESS - for the report's methodology section

An agent acted on this review's findings inside 17 minutes, without the review's constraints (no compile, no test run, no DB) and
without authorisation, and it *accidentally* satisfied the load-bearing placement constraint I had written down - its quantity
block landed at `+118`, after the fail-closed sum read at `:85-91`, which is where I would have put it. The author read my
journal, not my steer. **Prose in a journal is a to-do list with no owner, no gate, and no verification discipline attached, and
anyone who reads it inherits your conclusions without inheriting your constraints.** The consequence for an owner who leaves agents
running overnight on a shared tree is not that an agent made a bad fix - the fixes look good, and one of them bit a test, which is
more than this review managed. It is that *** THE REVIEW'S EVIDENTIARY STATUS BECOMES UNRECOVERABLE: *** `dc148cb73`-anchored
citations may or may not describe `707ab6889` plus 23 dirty entries, so you cannot tell which findings are history and which are
in flight, and cannot attribute any of it - a `+326/-4` commit implementing a review finding carries neither the reviewer's
constraints nor the reviewer's name. Two durable rules follow: **a constraint that matters must exist as a script that fails** (the
repo already demonstrates the pattern - `verify-ipc-parity.py`'s `rule_present` guard at `:166-170` exists precisely because a gate
that re-derives its own assumption checks nothing), and **no shared tree gets two unfettered writers.**

## D. RUN vs READ LEDGER

- **RUN by others:** the seven commits exist (git metadata is a run). `99aa0817d` changing a seeded qty 2 to 3 is the strongest
  evidence in the session that a human-executed test failed and was diagnosed - **a predicted failure does not tell you what the
  fixture used to hold.**
- **RUN by this review, and only these:** text-analysis scripts, and `python3 scripts/verify-ipc-parity.py` printing `IPC parity:
  OK` - a real program, run, at this HEAD.
- **READ-ONLY (unexecuted) - i.e. EVERYTHING THAT IS A CLAIM ABOUT BEHAVIOUR:** all path math (arm reaches, gate placement, rename
  effects, which file the daemon reads, serde spelling). **Including the enqueue finding.** Nobody has observed a sale fail to
  queue.

⇒ **Under-trust nothing here that says "will"; over-trust nothing that says "does".** The enqueue finding publishes as *"the code
has no way to report this failure"*, not *"sales are being lost"*.

## OPEN QUESTIONS (asked, not researched - EXCEPT WHERE MARKED ANSWERED, WHICH I CHECKED MYSELF)

1. *** ANSWERED AT 02:44 BY ME, NOT LEFT OPEN: YES, AN AGENT IS LIVE RIGHT NOW - BUT NOT THE ONE THE `MM` FILES POINTED AT. *** The
   five `MM` files are STALE: `locations.rs` last written 09:38, `workspaces.rs`/`workspaces_tests.rs` 09:48, `WorkspaceHome.tsx`
   04:41, and **`offline.rs` 21:40 YESTERDAY, `quota_gate.rs` 21:40, `offline_tests.rs` 21:41** - so `MM` meant *index differs from
   worktree since yesterday morning*, not *being edited this second*. My 'five files mid-edit while I looked' sentence was an
   INFERENCE FROM A GIT STATUS CODE, AND THE MTIMES CONTRADICT IT: *** `MM` IS NOT A LIVENESS SIGNAL AND I READ IT AS ONE. *** What
   IS live, modified inside the last 8 minutes at 02:44: `crates/oz-api/src/routes/sales.rs`, `crates/oz-api/src/pg.rs`,
   `crates/oz-core/migrations/20260813_init.pg.sql`, `crates/oz-core/src/migrations.rs`, `platform/sync/src/queue_tests.rs`,
   `platform/sync/src/transport_tests.rs`, `apps/license-server/admin_auth_session_test.go`, `web_otp_test.go`,
   `scripts/dev-up.sh`. *** I.E. SOMEONE IS WORKING THE CLOUD/PG + SYNC-QUEUE + LICENSE-SERVER SIDE, WHICH IS EXACTLY WHERE MY TWO
   LOOSE ENDS ARE: THE UNQUERYABLE `sale_idempotency` TABLE (B-1) AND THE SERVER SIDE OF THE `/status` FINDING (Q5). BOTH MAY BE
   FIXED WHILE YOU READ THIS, AND NEITHER FIX WILL BE MINE. ***
2. **Does HEAD build and migrate?** Checked at 02:40 - not broken - but the table-not-wired loose end in B-1 remains, **and the
   live agent is editing `oz-api/src/routes/sales.rs` and `migrations.rs` right now - re-check before acting on it.**
3. **Which artifact do the tills in the shop actually run** - installed v0.0.37, or a build of this tree? Every live-vs-latent
   judgement above is worth nothing without this.
4. **Is the `20261001` migration date deliberate** (a sort-order trick, per its own comment) **or a skewed clock?** It decides
   whether it ever runs for an existing till.
5. **Do you own the license-server edits, or are they also unauthorised?** They are the server side of the `/status` finding.
6. **ANSWERED AT 03:00 - AND THE ANSWER IS THE PART THAT MAKES THE LOCK A P0.** Two production writers move
   `tenant_subscription.status` off `expired`, and **both need the network**: `store_subscription` (signed, from `activate_license`
   / `renew_license`, `license_verification.rs:601-618`) and `refresh_subscription_status_from_server`
   (`:649-656`) - **which is the unsigned one, sole caller `check_license_status:497`**. The migration seed is `INSERT OR IGNORE`
   (`init.sql:1513`) so it cannot overwrite, and `pause`/`resume` (`license.rs:717-749,:755-784`) never write the row.
   **So there is no offline cure, and the only remote cure is the same unsigned write that can cause the lock: the recovery
   authority and the attack surface are one mechanism.** On the till itself `check_license_status` is registered desktop-only
   (`desktop lib.rs:1129-1130`; 0 `commands::license` registrations in tablet `lib.rs`) - which suggests **the cashier may have no
   operator-reachable re-verify at all**, but that is an inference from a registration grep, not a traced UI, and is listed as
   unmeasured.

## E. ONE FIX SHIPPED DURING THE REVIEW - CORRECTLY, AND IT COVERS NOTHING THE TILL DOES

`5ebffa391` (02:57) landed a tenant-scoped `Idempotency-Key` guard on `POST /api/v1/sales` (+690 lines, 313 of them tests). It was
audited at 03:05 and **the design is sound**: `key` is nullable with an ordinary unique index on `(tenant_id, key)`
(`20261001_sale_idempotency.sql:39-47`), and the migration header states the consequence in advance - *"Absent, empty and
whitespace-only are all UNGUARDED. Those rows store NULL, and NULL is distinct in a SQL unique index in both engines"* (`:13-17`),
with `:27-31` explaining why it is not a PRIMARY KEY. My suspicion that the NULL-key insert at `pg.rs:1791` was a hole was wrong:
it is `record_unguarded_sale`, which its own comment calls **"bookkeeping, never a guard"** (`:1775`). **I was one grep away from
publishing a finding against a design note that had already answered it.**

Two things are nevertheless worth a line:
1. **The guard protects a surface the product does not use.** `git grep sale_idempotency -- apps` returns **zero files**: tills
   check out through Tauri IPC (`start_sale_scoped`/`complete_sale_scoped`, `ui/src/api/sales.ts:106,:190,:337`) into the local
   `Store`, never via `POST /api/v1/sales`, and the in-tree HTTP client sends no key (`ui/src/api/client/sales.ts:29-31`). No
   server-side mint, no rejection (`routes/sales.rs:119-125,:309-329`; `spec/paths.rs:462` *"clients that never send the header are
   unaffected"*). **On an offline-first POS, a cloud-endpoint-only, client-opt-in idempotency guard does not cover the till.**
2. **A small real window:** the claim transaction commits at `pg.rs:1735` *before* the sale is written (`create_sale` at
   `routes/sales.rs:319`, claim at `:311`), so a concurrent duplicate landing between them resolves to a `sale_id` that does not
   exist yet and answers 404 *"idempotency key holds no readable sale"* (`:225-229`) - a comment there blames only "since been
   deleted", not "not yet written", and `pg.rs:1683-1685` overstates the guarantee. **The authors decline the race test themselves**
   (`sales_idempotency_tests.rs:3-15`: SQLite branch only, "NOT two transactions racing on one unique index, which needs a live
   pool and is not claimed here"); `concurrent_same_key_yields_one_sale_and_no_500` (`:143`) is serialised behind a mutex, so it is
   not a concurrency test. SQLite maps zero-insert-plus-no-winner to `Held` (`:178-181`) where PG errors (`:1732`).

This is **not** a P0 and not an indictment - it is what a fix shipped in a hurry at 02:57 looks like when read at 03:05: mostly
right, honest in its own comments, and aimed at the wrong shell.

_Baselines: review ran from `dc148cb73`; tree moved to `245e969d5` (02:25), `707ab6889` (02:40), `2391a5009` (03:08) and fourteen or
more commits by 03:15, none of them mine. Cite file:line against `2391a5009` or re-check._