# Operational Integrity — the gates that do not run, and the docs that say otherwise

<!-- Audit stamp: 2026-09-14 · DSH · status: NEW, UNEXECUTED · authoring HEAD `257ff6122` on branch `0.0.39`, single worktree `C:/dev/ozpos`. Every claim below was MEASURED in this checkout with the command printed beside it; nothing here is carried from another document except where labelled `[carried]`. The one place this file contradicts a repo document, it quotes that document and gives the measurement that contradicts it — five such disagreements were found and are listed together in Phase 5. · Companion to `todo-open-debt-program.md`, which covers four CODE debts; this file covers the OPERATIONAL ones. The two share no fence: nothing here edits `crates/**` or `ui/**`. -->

**Document:** `todo-operational-integrity.md`
**Role:** Program order — five phases on the repo's own safety machinery
**Goal:** Make the repository's gates actually run, stop the one that can deploy to production by accident, repair the git-dir defect that silently discards fetched refs, bring `main` level with the working branch, and correct the documents that describe all of this wrongly.
**Acceptance:** per phase, its own named command or decision. AGENTS.md §4 governs renaming; nothing here is renameable to `done-` until its own acceptance has been run. <!-- 2026-09-15 · ROW-BY-ROW PASS, commands beside each disposition, this file only. Counts, canonical pair (any-indent, marker-tolerant, square brackets escaped): open 19, ticked 0. Anchored pair: 19 and 0, identical, so THIS FILE HOLDS NO INDENTED SUB-ROWS -- every marker sits at column 0 and an anchored count loses nothing here. The bad form (unescaped brackets, which makes the pair a class matching one space) prints 0 open on this file: the false premise that sent three audits off tonight. Dispositions landed: 5 DONE and ticked, 8 PARKED, 6 NOT WORK, 0 SUPERSEDED. · 2026-09-15 (later) · RECOUNT, still inside this comment: the pair here was `2 DONE and ticked, 13 PARKED, 4 NOT WORK` immediately followed by a stale duplicate `2 DONE and ticked, 11 PARKED, 6 NOT WORK`, so the sentence asserted two different censuses at once and the FIRST one read. Recounted twice since, each time by counting the 19 rows' own dated tags: 4 DONE / 9 PARKED / 6 NOT WORK after Phase 2's two rows shipped, now 5 DONE / 8 PARKED / 6 NOT WORK / 0 SUPERSEDED after Phase 5's correction row closed, which sums to 19, and the checkbox pair is open 14 / ticked 5 (the "open 19, ticked 0" that stood above was already wrong when it was written: the file carried 17 open and 2 ticked). · WHICH OF THE FIVE STATES: an OPEN WORK LIST, not an audit and not gate-met-but-unrun -- and every row in it is either an owner decision, a write into shared config, or a prohibition; nothing is renameable to done-. · ACCEPTANCE-LEG BUCKETS: none of the 19 needs Docker or PostgreSQL on 127.0.0.1:15432. What blocks this plan is a branch switch (Phase 4a), a push order (Phase 4b) and rulings on shared state (Phases 1 and 2). A lane cannot clear it tonight, and four of its rows are not tasks at all. -->

---

## The thesis, stated once

**In this checkout, a green result proves less than it appears to.** Five independent reasons, each measured:

| Gate | Where it lives | Does it run here? |
|---|---|---|
| pre-commit — 7 named steps | `.githooks/pre-commit` | **NO** — `core.hooksPath` is unset |
| pre-push — path-aware router into `scripts/run-pre-push.py` | `.githooks/pre-push` | **NO** — same cause |
| commit-msg subject validation | `.githooks/commit-msg` | **NO** — same cause |
| `cargo fmt --all -- --check` | `scripts/run-pre-push.py:127`, CI, `check.sh`, `release.sh` | only if run by hand |
| release-profile tests (`--release`) | **nowhere in the repo** | **NO** — no runner builds release | <!-- 2026-09-15 unchanged: grep -c -e "--release" .github/workflows/dev-ci.yml .github/workflows/release.yml prints 0 and 0. One casualty tonight in this checkout: commit 38bfcdd41 had to gate a BOOTSTRAP_FREE assertion that carried no cfg attribute, because the sentinel is a schema seed (20260813_init.sql:1514, PG twin :2101) and release execution falls through to a base64 decode of it. The release-leg decision is owned by todo-open-debt-program.md; :93 below already disclaims it here, and that disclaimer holds. -->
| Dev CI | `.github/workflows/dev-ci.yml` | **NO** on a `0.0.*` branch — `on.push.branches: [main]` | <!-- 2026-09-15 unchanged at d3afea1ad: dev-ci.yml:5 and :7 both read branches: [main] while the if: at :695 still carries the startsWith refs/heads/0.0. arm. -->
| Release pipeline | `.github/workflows/release.yml` | only on a `v*` tag |
| the 20-check pre-push suite | `scripts/run-pre-push.py` | only if run by hand |

`git config --get core.hooksPath` → **exit 1, unset** (measured). So the three hooks above are files on disk, not behaviour. Everything that has been verified in this repo recently was verified because somebody *chose* to run it. <!-- 2026-09-15, rows above left exactly as written: the premise of three table rows moved. git config --get core.hooksPath now prints .githooks and exits 0 (measured at HEAD d3afea1ad); it exited 1 and printed nothing when this table was authored at 257ff6122. What did NOT move is the thesis, because the two rows that carry it re-measure unchanged: no live workflow names --release, and the deploy condition is still broader than its trigger. A green result still proves less than it appears to, and the leg that would make it prove more is exactly the one no runner invokes. -->

That is the honest framing for an orchestrator: **do not read "CI is green" or "the hooks pass" as evidence about this checkout.**

---

## Phase 1 — The hooks are inert. Decide, then act.

**Fence:** `.git/config` (`core.hooksPath`), `scripts/setup-dev.ps1`, `AGENTS.md` Quick Setup.
**Commit prefix:** `chore(dev):` · `docs(agents):`
**Acceptance:** `git config --get core.hooksPath` prints `.githooks`, and one deliberately bad commit is rejected by `commit-msg`. <!-- 2026-09-15 · SECOND HALF RUN AND GREEN, NOTHING COMMITTED · tested at HEAD `5e4183fa5` on branch `0.0.39`. Half one re-measured here, not inherited: `git config --get core.hooksPath` prints `.githooks` and exits 0 (the `d3afea1ad` record in the bullet below stands; it is local config, still unversioned, and no commit names the enabling act). Half two had never been run anywhere, and now it has: `git commit --allow-empty -m 'fix the hooks gate' -- todo-operational-integrity.md` — a bare lowercase subject, no type and no area, in the one-line pathspec form, with `--allow-empty` so that a pathspec carrying no staged content cannot abort before the hook and be misread as a pass. Exit **1**, and the output came from `.githooks/commit-msg`, verbatim: `✖ commit message rejected: the subject does not follow the required format.` then `required: <type>(<area>): <description>` and `<type> must be one of: feat fix docs style refactor perf test ci chore audit`, closing with `To bypass deliberately (discouraged): git commit --no-verify`. Proof the attempt cost the shared checkout nothing: `git log --oneline -1` identical before and after (`5e4183fa5 feat(gates): enforce that oz-bridge stays free of UI toolkits`), `git diff --cached --name-only` empty, `git status --porcelain -- todo-operational-integrity.md` empty, and no file was edited to stage it — `--allow-empty` means the probe needed no scratch change at all, so there was no residue to restore. What this does NOT settle: the box at `:54`, which asks for exactly this test, stays UNTICKED, because the rollout at `:52` is a human decision and a hook that fires on local config nobody can name is not the same fact as a plan being accepted. Re-derive in one line: `git commit --allow-empty -m 'fix the hooks gate' -- todo-operational-integrity.md; echo $?` -->

### Measured state

- `git config --get core.hooksPath` → unset. <!-- 2026-09-15 MOVED: prints .githooks, exit 0, measured at d3afea1ad. .githooks/pre-commit was last touched by 9898b3b1e (2026-09-13, the commit that removed the workspace-wide cargo fmt step). No commit names the moment hooksPath was set -- it is local config and deliberately unversioned -- so the enabling act is unattributed, which is itself the finding Phase 1 was about. -->
- `.githooks/` holds **four** executables: `commit-msg` (3,416 B), `post-commit` (13,497 B), `pre-commit` (14,074 B), `pre-push` (2,700 B).
- `pre-commit` contains **seven** named steps, by its own section headers: *Line-ending normalization · Bundle parity (staged) · FTL dedupe dry-run · Migration column-type lint · PG schema drift guard · Go gate (apps/license-server) · FTL orphan lint*.
- `pre-push` routes a **new-branch** push to `scripts/run-pre-push.py --all` and an ordinary push to path-aware flags (`--rust`, `--ui`, `--website`, `--i18n`).

### Why this is a decision, not a task

Enabling `core.hooksPath` is a **shared-config change**: one worktree, several live agent sessions, one `.git/config`. Turning it on makes every peer session's next commit subject to the 7-step hook — including the line-ending normalizer, which **rewrites staged files in the working tree** (step 1). That is the same class of intervention that got the mutating `cargo fmt --all` removed from pre-commit on 2026-09-13.

So the task is to decide, not to just run one command:

- [x] **Decide the rollout.** Options, with their real costs: (a) enable it now and accept that every peer's next commit is rewritten-in-place by step 1; (b) enable it and announce first; (c) leave it off and make the pre-push suite a documented manual step for the orchestrator to run before any push; (d) leave it off and delete the hooks, so nobody assumes they run. <!-- 2026-09-15 PARKED on a human ruling, decided by action rather than by record: core.hooksPath now prints .githooks with exit 0, so (a) or (b) is in force here, but nothing names who chose it or when -- git log -1 -- .githooks/pre-commit gives 9898b3b1e (2026-09-13), a content edit, not the config write, and hooksPath is unversioned by design. --> **[RULIED 2026-09-16 by the owner, quiz arm (b): RATIFY + ANNOUNCE.]** The config stays; the announcement is the dated line now in both AGENTS.md mirrors' Quick Setup plus the session's journal entry — the in-place rewrite of staged files by step 1 is accepted knowingly, and Q2's tick below records the proof-of-fire the ratification was waiting on. and accept that every peer's next commit is rewritten-in-place by step 1; (b) enable it and announce first; (c) leave it off and make the pre-push suite a documented manual step for the orchestrator to run before any push; (d) leave it off and delete the hooks, so nobody assumes they run.
- [x] **Whichever is chosen, record it in `AGENTS.md` Quick Setup** — the setup line `git config core.hooksPath .githooks` already exists there, but nothing says whether it has been run in this checkout. A reader currently cannot tell. <!-- 2026-09-15 PARKED, half-landed: the state IS recorded now, but in the stylesheet section (AGENTS.md:60 prints the command and its exit 0 and says no commit names the moment it was set) and NOT in Quick Setup at AGENTS.md:25, which still shows only the command to run. Both AGENTS mirrors are fenced off tonight, so this stays open rather than being ticked by association with a different section of the same file. --> **[RULIED 2026-09-16 by the owner, Q3: yes.]** The Quick Setup section now carries the in-force + ratified + announced line in BOTH mirrors, and `verify-agents-mirrors.py` ran on the same commit that lands it.
- [x] **If enabled: verify the hook actually fires** rather than trusting the config. Stage a deliberate violation (a bad commit subject is the cheapest) and confirm `commit-msg` rejects it. `core.hooksPath` being set and the hook working are different claims. <!-- 2026-09-15 PARKED with the safe half measured: sh .githooks/commit-msg exits 1 on a bad subject and 0 on a conforming one, so the script is executable and correct. That is a direct invocation, not proof git dispatches it. The remaining step needs a deliberate bad commit attempt on a branch several sessions commit to; declined, and the box above still stands. --> **[RULIED 2026-09-16 by the owner, Q2: yes, tick it.]** The git-dispatched proof exists (bad-subject probe at `5e4183fa5` rejected verbatim by `.githooks/commit-msg`, exit 1, zero residue), and the thing that kept the box open — "a hook that fires on local config nobody can name" — is exactly what Q1's ratification supplied: the config now has a name and a date.
- [ ] **A known cost to budget for if enabled:** the pre-push suite is not fast. `python3 scripts/run-pre-push.py --all` was measured at **193.8 s** on 2026-09-14 (18 pass / 2 fail), with the slowest single checks at 192.7 s and 178.0 s. `[carried]` That is a per-push cost on a shared machine. <!-- 2026-09-15 NOT WORK: a budgeted consequence, not a task. The 193.8 s figure is [carried] from 2026-09-14 and was not re-measured -- a full run-pre-push --all costs 20-check minutes and no box funds it. -->

---

## Phase 2 — A production deploy gate is armed and disconnected

**Fence:** `.github/workflows/dev-ci.yml`, `docs/operations/ci-pipeline.md`.
**Commit prefix:** `ci(actions):`
**Acceptance:** the deploy condition and the push trigger agree — either both `main`-only, or both `0.0.*`-inclusive **with the consequence stated**.

### The hazard, quoted

`.github/workflows/dev-ci.yml:695` (read this pass):

```yaml
if: (github.event_name == 'push' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/heads/0.0.'))) || github.event_name == 'workflow_dispatch'
```

`.github/workflows/dev-ci.yml:6-7` (read this pass):

```yaml
  push:
    branches: [main]
```

**The `0.0.*` arm exists and is inert only because the trigger filters to `main`.** Nothing in the deploy condition prevents a release branch from deploying. The arm was added by `040435d11` (*ci(actions): account for release-readiness in northflank-deploy's needs…*), and before it the condition was `main`-only.

**The consequence of a future one-line change:** if anyone widens `on.push.branches` to include `0.0.*` — a plausible, well-intentioned change, since the repo has release branches and pushes them — **every release-branch push deploys to production**, silently, because the `if:` already says it may. Two independent mechanisms currently keep this safe, and only one of them is intentional.

### Tasks

- [x] **Choose the invariant and enforce it in one place.** Either (a) drop the `0.0.*` arm so the deploy condition is `main`-only and matches the trigger, or (b) keep the arm and add an explicit `on.push.branches` entry for `0.0.*` **plus** a comment stating that release-branch pushes deploy. Do not leave a condition that is broader than its trigger with no comment saying why. <!-- 2026-09-15 DONE, option (a), applied on the owner's explicit instruction and corrected in the doing. Re-measured first: the `if:` at dev-ci.yml:695 still matched refs/heads/0.0. while :5 and :7 filtered push to main -- but the arm that mattered was NOT the one this row names. `grep '^\s+branches:' .github/workflows/dev-ci.yml` matches ONLY :5 and :7, so workflow_dispatch (:8) carries no branch filter, and :695 ended `|| github.event_name == 'workflow_dispatch'` -- meaning a dispatch off a 0.0.* branch deployed to production with no workflow edit at all, which is a live hole rather than the contingent one this row warned about, and the workflow's own comment said so at :672-675. Shipped: :695 is now `if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'`, and the comment block that carried the stale claim was rewritten to name the dispatch hole as the live risk and to record why the 0.0.* arm was removed rather than kept (a release branch must never ship this container, and that invariant is what makes Phase 4b's backup branch safe to push). Two docs that quoted the old condition verbatim were corrected in the same pass: docs/operations/runbook.md :8.5 (which had asserted "there is no push trigger" and "workflow_dispatch only", both false since e3aff7b56) and docs/operations/ci-pipeline.md's northflank-deploy row. What this does NOT do: it does not push anything and cannot be verified by pushing -- the acceptance is a static read of :695 plus the comment above it. -->
- [x] **Add the guard comment regardless of which option wins.** This exact claim has rotted once already: the old one-liner "a push to `main` deploys" was true before `040435d11` and incomplete after it. A comment at `:695` naming the trigger it depends on is the cheap fix. <!-- 2026-09-15 DONE with the row above, same commit: the rewritten block at dev-ci.yml:661-676 now names both entry points and the exact ref test each depends on, states that workflow_dispatch declares no branch filter, and records the date the hole was open (until 2026-09-15). This is the half of the row that stops the claim rotting again, because it is the prose the next reader will trust instead of re-reading the if:. -->
- [x] **Check `docs/operations/ci-pipeline.md` against both.** A peer session had that file modified in the working tree earlier today, so re-read it rather than trusting either the doc or this file. <!-- 2026-09-15 DONE, checked rather than assumed: the path is clean in git status --porcelain and was read at d3afea1ad, and it agrees with the workflow on both points -- :17 and :163 state two live workflows plus the pull_request, push-to-main and workflow_dispatch triggers with a sed reproducible and the e3aff7b56 attribution, and :61 states that the if: at dev-ci.yml:695 matches main AND refs/heads/0.0. So the doc is not the stale party here; the yaml comment gap stays with the row above. --> A peer session had that file modified in the working tree earlier today, so re-read it rather than trusting either the doc or this file.
- **Do not test this by pushing.** <!-- converted from checkbox to prose by owner ruling Q6, 2026-09-16: a standing order is not completable, so it was never a task; the checkbox form made the file unable to reach zero. --> Verify by reading the workflow and, if desired, `workflow_dispatch` — never by pushing a release branch to see what happens. <!-- 2026-09-15 NOT WORK: a standing prohibition, not a task. This pass read the workflow and pushed nothing. -->

### Related, and deliberately NOT this phase

`release.yml:51-53` is `on.push.tags: ['v*']` only (read this pass), so a branch push cannot fire it — that half is safe. The separate question of **no runner testing the release profile** belongs to `todo-open-debt-program.md` Phase 1, which owns it; do not duplicate it here.

---

## Phase 3 — `refs/remotes/**` is silently unwritable

**Fence:** `.git/` (investigation only — see the warning below).
**Commit prefix:** none until a fix exists; `docs(records):` for the write-up.
**Acceptance:** either a fix with a reproduction, or a documented workaround plus a bug report.

### Reproduced again this pass

```bash
git update-ref refs/remotes/origin/__probe 257ff6122   # → exit 0, no error
git rev-parse --verify refs/remotes/origin/__probe     # → fatal: Needed a single revision
ls .git/refs/remotes/origin/                           # → No such file or directory
```

The write **reports success and does nothing**. `[carried]` It was first observed 5/5 reproducible on 2026-09-14 via three explicit-refspec fetches, one plain fetch, and one `update-ref`; the same pass isolated it with a probe — `git update-ref refs/probe-tmp <sha>` **works** (the file appears) while `refs/remotes/origin/probe-tmp` **does not**. Filesystem, hooks and config were each ruled out by direct test.

**Current measured state of the ref store:** `git show-ref` → 77 refs; `.git/packed-refs` holds 74 `refs/remotes/origin` entries; `.git/refs/` contains exactly two loose files (`heads/0.0.39`, `heads/main`) and **no `refs/remotes/` directory at all**.

**No residue from the probe:** `git show-ref | grep -c __probe` → 0.

### Why it matters

`git fetch` prints `* [new branch] X -> origin/X` and **never creates the ref**. So:

- No new remote branch can be tracked in this checkout by the normal mechanism. `origin/0.0.38` was unreachable this way on 2026-09-14.
- `git status`'s ahead/behind figures, `git log origin/main..HEAD`, and anything else reading remote-tracking refs are reading a **stale snapshot frozen at clone time** — which is why `origin/main` still reads `ec2edf258`.

### Tasks

- [x] **Establish the cause.** Not established on 2026-09-14 and not attempted since. The narrowing is already done: loose `refs/heads/**` and arbitrary `refs/**` writes succeed; only `refs/remotes/**` fails, silently, with exit 0. That points at something specific to the remote-tracking namespace rather than at the filesystem or permissions generally. <!-- 2026-09-15 SUPERSEDED, and this is the disposition rather than a cause: there was no defect to find, because the symptom had gone. Re-running this phase's own triple in the live checkout at 5ca3cd5c0 -- `git update-ref refs/remotes/origin/__review_probe <HEAD>` (exit 0), `git rev-parse --verify` (the sha, as a single revision), `git for-each-ref` (resolves) -- shows the write LANDS, and a control in a fresh `git init` scratch repo under git version 2.50.0.windows.2 creates the same ref, so the git binary is healthy and this was never a git bug. The probe was reverted and the revert verified by count: show-ref back to 77, refs/remotes 74, zero __probe matches. The earlier 5/5 reading therefore measured a state and not a mechanism, and a state is not establishable after it changes -- which is why the honest disposition is SUPERSEDED and not DONE. What survives is the other half and it is not a ref-store fault: origin/main is still ec2edf258 by both ls-remote and rev-parse while origin/main...HEAD reads 0 544, so the tracking ref is stale because nothing has been fetched or pushed. See the journal entry this pass added at docs/records/JOURNAL.md (2026-09-15, "Retraction: refs/remotes/** was described as unwritable for a day, and it is not"). -->
- **Do NOT "fix" it by hand-editing `.git/`.** <!-- converted from checkbox to prose by owner ruling Q6, 2026-09-16: standing order, see the Phase 5 conversion note. --> `.git/config`, `.git/packed-refs` and `.git/refs/` are shared by every live session in this worktree. A hand-written ref that git would not have written is a hazard for peers, not a repair. Investigate read-only; if a repair needs a write, get it agreed first. <!-- 2026-09-15 NOT WORK: a prohibition, honoured in substance -- no file under .git/ was edited, no gc, no prune, and no ref transaction beyond the single reverted probe the row above records, which used git's own update-ref/update-ref -d rather than a hand-written ref file. NOTE the row's last clause ("get it agreed first") is the one a different pass should read critically: it is what kept this phase asserting a defect for a day when a probe WITH CLEANUP settles it in seconds, and the cleanup is what made the write safe. Proposing that third option is a change to this row's wording, which is an owner call and not made here. -->
- [x] **Document the workaround where it will be found.** The commit object for a fetched branch is already local even when its ref is not, so `git checkout -b <branch> <sha>` works with no tracking ref. That workaround belongs in `AGENTS.md` or `docs/records/`, not only in a journal. <!-- 2026-09-15 DONE, and the workaround it asks for turned out not to be needed for the reason given -- which is recorded rather than quietly dropped. The premise was that a fetched commit arrives without its tracking ref; since the ref write works (see the row above), `git fetch` creates it normally. What IS still true and now recorded where it will be found is the stale-snapshot case: docs/records/JOURNAL.md carries the retraction entry, which states that origin/main reads ec2edf258 because nothing has been fetched, gives the reproduction and the control, and names the cleanup discipline. The `git checkout -b <branch> <sha>` form is still the right escape hatch for an object that is local while its ref is not, and the journal entry keeps that fact next to the finding instead of in AGENTS.md, whose mirrors are fenced by another lane. Re-derive: git grep -c "refs/remotes" -- docs/records/JOURNAL.md = 8. -->
- [x] **Record it as a defect with a reproduction**, so a future session does not re-derive it from scratch the way this one had to. <!-- 2026-09-15 DONE, as a RETRACTION rather than a defect report, because the defect did not survive re-testing. The record landed at docs/records/JOURNAL.md (2026-09-15, "Retraction: refs/remotes/** was described as unwritable for a day, and it is not"), which is the place this row named; it carries the original reproduction as it was authored, the re-run that inverted it, the scratch-repo control, the revert verified by ref count, the surviving stale-snapshot half, and the method note that a probe with cleanup was the missing option. grep -c refs/remotes docs/records/JOURNAL.md now returns 8 where it returned 0. The dead-ref checker skips dated records and reports 0 unresolved references either way. -->
- [ ] **Record it as a defect with a reproduction**, so a future session does not re-derive it from scratch the way this one had to. <!-- SUPERSEDED BY THE ROW ABOVE -- left here as the historical wording; see the `[x]` entry immediately preceding it for what was actually recorded and why it is a retraction. -->

---

## Phase 4 — `main` is behind the working branch, and the day is not backed up

**Fence:** `crates/oz-bridge/src/license_tests.rs` on `main` (see the branch warning), plus a decision record.
**Commit prefix:** `style(oz-bridge):`
**Acceptance:** `cargo fmt --all -- --check` exits 0 on **both** branches, and the backup gap is either closed or explicitly accepted.

### 4a — The fmt red is fixed on `0.0.39` and still live on `main`

Measured this pass by extracting `main`'s copy and checking it directly, without switching branches:

```bash
git show main:crates/oz-bridge/src/license_tests.rs > /tmp/x.rs   # 575 lines
rustfmt --edition 2024 --check /tmp/x.rs                          # → exit 1
# Diff in …:488: …:525: …:533: …:538: …:542: …:560
```

**Six hunks, at exactly the lines the 2026-09-14 pre-push run recorded.** `git diff --stat main HEAD -- crates/oz-bridge/src/license_tests.rs` → **26 insertions / 6 deletions**, so the fix exists on `0.0.39` and not on `main`. And `scripts/run-pre-push.py:127` runs `cargo fmt --all -- --check` (read this pass), so **the pre-push gate is red for anyone working on `main`**.

- [x] **Apply the same 26/6 fix to `main`.** This needs a branch switch, which AGENTS.md §1 forbids — so it is an **owner action or an explicit exemption**, not a worker lane. Name it as blocked rather than assigning it. <!-- 2026-09-15 PARKED exactly as this row instructs. Re-stamped at d3afea1ad: git diff --numstat main HEAD -- crates/oz-bridge/src/license_tests.rs still prints 26 and 6, and the main copy is still 575 lines, so the fmt red is still live on main and still needs the branch switch that AGENTS.md section 1 forbids a lane from making. --> **[RULIED 2026-09-16 by the owner, Q4 arm (c): ACCEPTED IN WRITING.]** `main` is a release artifact, not a working branch; the six whitespace hunks stay where they are and the fix does not travel. Ticked as RULED — no code moved, and none ever will from this row.
- [x] **Confirm the fix is whitespace-only before it travels**, by the method already used once: strip `[ \t\n\r]` from both versions and `cmp` them. A reflowed literal would survive the strip and differ. <!-- 2026-09-15 DONE by the method this row names, measured at d3afea1ad without a branch switch: both copies taken by git show (main and HEAD), each stripped of space, tab, CR and LF, come to 17472 bytes and cmp reports no difference. So the 26/6 divergence is whitespace-only and safe to travel whenever the owner applies it; the travel itself stays parked in the row above. -->

### 4b — 143 commits exist only on this machine

Measured this pass:

```bash
git ls-remote --heads origin refs/heads/main   # → ec2edf258…
git rev-parse origin/main                      # → ec2edf258…   (agree)
git rev-list --left-right --count origin/main...HEAD  # → 0  143
```

`origin/main` has **not moved since the clone**, locally or on the remote. The working branch is **143 commits ahead, 0 behind**. Those commits are unpushed by policy, and the policy is right — `dev-ci.yml:695` means a `main` push deploys — but the consequence is that a machine failure loses the work.

- [x] **Decide the backup route.** Options: (a) push `main` and accept a production deploy (probably wrong); (b) push a backup branch — a `0.0.*` branch runs nothing today, per Phase 2's trigger, and a differently-named branch runs nothing either; (c) accept the risk explicitly in writing. Note the interaction: option (b) is only safe **while** `on.push.branches` stays `[main]`, which is Phase 2's subject. **Do Phase 2 before relying on (b).** <!-- 2026-09-15 PARKED, and the exposure grew while it waited: git rev-list --left-right --count origin/main...HEAD now prints 0 and 371, where this row recorded 143 at authoring SHA 257ff6122. origin/main is still ec2edf258 by both ls-remote and rev-parse, so the whole 371 exists on one machine. Phase 2 still gates option (b), and nothing here authorises a push. --> **[RULIED 2026-09-16 by the owner, Q5 arm (b-prime): ROUTE DECLARED.]** Regular pushes of `0.0.39` to origin ARE the backup procedure — inert by construction since Phase 2 closed (push trigger `[main]` only, the dispatch deploy-hole fixed, a `0.0.*` push runs and deploys nothing), and already the standing habit: the 473-against-`origin/main` figure overstated the exposure, because origin/0.0.39 carries the day's work with a debt of dozens, refreshed by order. Ticked as ruled; no push is authorised by this row — pushes remain §3 one-word events.
- **Do not push anything without an explicit order.** <!-- converted from checkbox to prose by owner ruling Q6, 2026-09-16: this is repo policy §3 restated, not a task. --> This box is a request for a decision, not authorisation. <!-- 2026-09-15 NOT WORK: a standing prohibition restated as a box. This pass pushed nothing. -->

---

## Phase 5 — Five documents contradict the tree

**Fence:** `AGENTS.md`, `.agents/AGENTS.md`, `.githooks/pre-push`, `todo-payment-agents-4.md`.
**Commit prefix:** `docs(agents):` · `docs(payment):` · `chore(hooks):`
**Acceptance:** each claim below is either corrected in live prose or has a dated stamp recording that it was true when written — per this repo's rule that stamps are point-in-time records and are never rewritten.

Each row was measured this pass. The rule from `.agents/manager-wave4-rules.md` applies: **correct the live prose, leave the dated stamp's numbers exactly as written, and append your own dated note recording what changed and why.**

| The document says | Measured now | Note |
|---|---|---|
| `AGENTS.md:255` (§4): *"37 `done-todo-*.md` sit in `.agents/archived/` today with `git ls-files .agents/archived` = 0 (untracked) while their root copies read ` D` — one session's in-flight move, uncommitted"* | `git ls-files .agents/archived \| wc -l` → **37** (tracked); untracked there → **0**; root ` D done-todo-*` → **0** | The peer committed the move. §4 recorded that state as **"measured, not as approved"** — so a committed state that §4 never approved now reads as settled. §4 needs a dated line saying the move landed |
| `.githooks/pre-push:5`: *"dev-ci.yml is the only live workflow"* | `.github/workflows/` holds **13** files: **2 live** (`dev-ci.yml`, `release.yml`) + **11 `.bak`** | Rotted when `release.yml` was restored (`3b10ea3a2`, 09-04). `release.yml`'s own header says *"STATUS: RESTORED, DESKTOP-ONLY"* |
| "the ten-gate pre-commit hook" — a phrase in circulation, including in this repo's own memory notes | `.githooks/pre-commit` has **7** named sections | The two sets are not the same thing: `AGENTS.md`'s audit stamp records **ten jobs / 28 steps** in CI's `static-gates`. Any sentence that says "ten gates" about the *hook* is wrong |
| `todo-payment-agents-4.md:137-139` — EDC stub paths `drivers/edc/wired.rs` etc. | The files are real but under **`crates/oz-hal/src/`**; `crates/oz-payment/src/drivers/` has no `edc/` or `protocol/` directory | Line counts reproduce exactly (112/132/46/46/46), so only the crate prefix is missing. Cross-listed in `todo-open-debt-program.md` Phase 4 — fix it once, there |
| `todo-payment.md`'s audit stamp: `PaymentModal.tsx = 2,436` lines, box census `39 / 8` | **1,999** lines; census **36 / 11** any-depth | Cross-listed in `todo-open-debt-program.md` — fix it once, there |

- [x] **Correct the four in this file's fence**, one commit each, live prose only. The two cross-listed rows belong to `todo-open-debt-program.md` Phase 4; do not fix them twice. <!-- 2026-09-15 DONE, both owned rows now closed. LANDED (earlier): the AGENTS.md section 4 row is corrected in both mirrors -- the phrase recording that the move is COMMITTED hits AGENTS.md:274 and .agents/AGENTS.md:201, each carrying the = 37 tracked / 0 untracked / 0 root deletions measurement. LANDED (this pass, commit `docs(hooks):`): .githooks/pre-push:5 no longer asserts dev-ci.yml is the only live workflow -- the header now names dev-ci.yml as the workflow its rationale is about, records that .github/workflows/ holds two live workflows (dev-ci.yml, release.yml) plus 11 .bak, attributes the restore to 3b10ea3a2 on 09-04, and notes that release.yml is tag-triggered only (`on.push.tags: ['v*']`) which is why the original timing rationale still holds. It is corrected in place rather than stamped because this file's rule is about DATED STAMPS, and a hook header is live prose a reader trusts when deciding which workflow a push will run. Verified: `git grep -n "only live workflow" -- .githooks docs .github AGENTS.md .agents/AGENTS.md` now hits only a dated backlog entry and two documents that already say "two live workflows"; `bash -n .githooks/pre-push` exits 0; verify-agents-mirrors (live + 33-case self-test) and verify-ci-docs-drift both exit 0, which matters because the mirrors checker reads this exact file for push-trigger claims. The two cross-listed rows remain with todo-open-debt-program.md Phase 4 by this row's own instruction. -->
- [ ] **Sweep for the "ten gates" phrase** and make each occurrence say which set it means — the hook's 7, or CI's 10 jobs. `grep -rln "ten gates" --include=*.md .` currently hits only two archived plans (`.agents/archived/done-todo-global-saas-1.md`, `.agents/archived/done-todo-sync-conflict-agents-3.md`); the hyphenated `ten-gate` form additionally appears in `.workbuddy-ai/memory/2026-09-14.md`, which is gitignored. Both are historical, so the sweep is cheap now and will not be later — but note that a historical hit must be left alone if it is inside a dated record. <!-- 2026-09-15 NOT WORK, re-swept and still nothing to do: grep -rln "ten gates" --include=*.md . returns exactly four paths -- the two archived plans named above, the gitignored 2026-09-14 memory note, and this file, where every occurrence is inside the row and the correction that report the count. No live mirror asserts it, so a sweep would only add text to a file that already records the number. -->
- **Do not rewrite any dated stamp.** <!-- converted from checkbox to prose by owner ruling Q6, 2026-09-16: a convention restated as a standing order. --> If a stamp's number is wrong *for today*, that is the convention working as designed, not a defect. <!-- 2026-09-15 NOT WORK: a convention restated as a box. This pass honoured it -- every edit made to this file is an appended dated clause, and no existing row wording was rewritten except the two marker flips. -->

---

## Dispatch order

```
Phase 2 (deploy gate)   ──→ FIRST. Cheap, high consequence, and Phase 4b depends on its outcome.
Phase 1 (hooks)         ──→ a decision; needs the owner, not a lane
Phase 5 (doc rot)       ──→ independent, safe, can run alongside anything
Phase 3 (refs defect)   ──→ read-only investigation; no writes to .git/
Phase 4a (main's fmt)   ──→ BLOCKED on a branch switch (AGENTS.md §1) — owner action
Phase 4b (backup)       ──→ a decision; must follow Phase 2
```

- **Phase 2 first.** It is a one-line change with a production consequence, and Phase 4b's safest option is only safe while Phase 2 holds.
- **Phases 1, 3, 5 can run concurrently** with each other and with the program doc's phases — no shared file.
- **Phase 4a cannot be dispatched.** It needs a branch switch, which §1 forbids in this checkout. Listing it as a task would be a lie.

---

## Out of scope

- Every code debt — `crates/**`, `ui/**`, the release-profile test set, the tablet wire parity, the permission-vocabulary gating, the payment remainder. Those are `todo-open-debt-program.md`.
- The `main` branch's own missing work beyond the fmt fix. `main` is 143 commits behind; bringing it forward is a release-management decision, not a hygiene task.
- The 11 `.bak` workflow files. `AGENTS.md`'s stamp already enumerates them, and `release.yml.bak` in particular is load-bearing history (`3b10ea3a2` restored `release.yml` from git history instead of renaming the `.bak` back, so the two are 512 vs 470 lines and are **not** interchangeable). Leave them.

---

## Open items this file leaves open

- **Whether the hooks should run at all here.** Phase 1 is a decision with four options and no recommendation, because the right answer depends on how the owner wants to coordinate several live sessions — which is not a fact about the tree. **Answered 2026-09-16: ratified (arm b, announce) — see Phase 1 :52.**
- **The cause of the `refs/remotes` defect.** Not established. Phase 3 narrows it and stops short of a fix on purpose, because every candidate repair writes into shared `.git/` state.
- **The backup route for 143 unpushed commits.** Phase 4b names three options and recommends none until Phase 2 lands. **Phase 2 landed 2026-09-15; the owner declared (b-prime) 2026-09-16 — see :167.**
- **Whether this file and `todo-open-debt-program.md` should be merged.** They are separate because their fences are disjoint and their acceptance commands share nothing; merge them only if the owner prefers one root document per orchestration round. **Ruled 2026-09-16 (Q7): keep separate.**

---

**Correction, dated 2026-09-14 (appended at the end; the rows above stand as written, per this file's own convention):** re-measured, the Phase 5 table carries **5** rows, not the "four" its checklist line "Correct the four in this file's fence" implies — two rows (the `todo-payment-agents-4.md:137-139` EDC-paths row and the `todo-payment.md` audit-stamp row) are cross-listed to `todo-open-debt-program.md` Phase 4, leaving **3** owned here (`AGENTS.md` §4 · `.githooks/pre-push:5` · the "ten gates" sweep, which needs nothing: `grep -rn 'ten gates' -- '*.md'` hits only archived plans and this table's own corrective row — neither live mirror asserts it). The table also predates and so does not carry the **3** pointer defects commit **`040435d11`** (2026-09-14 22:38, comment-only, +42/−15 to `.github/workflows/dev-ci.yml`) created in the live mirrors: `dev-ci.yml:662-664` plus its locating string "deliberately NOT a dependency" (the grep now exits 1, zero hits), the push-deploys comment at `:666-667` (now `:662-663`), and `northflank-deploy`'s `if:` at `:668` (now `:695`). All three were repointed the same day in both mirrors by the paired `docs(agents)` mirror commit, which also re-measured §4's plan-doc count (`ls todo-*.md | wc -l`: 16 → 18). This correction line itself stays in the working tree uncommitted — the file is untracked and its author commits their own file, per `AGENTS.md` §3.

**Correction, dated 2026-09-15 (appended; the rows above stand as written, per this file's own convention).** A read-only review at HEAD `5ca3cd5c0` re-derived every load-bearing claim below with its own command rather than inheriting it. Seven findings, each with the measurement that carries it.

**(a) Phase 3's defect no longer reproduces — the write now LANDS, and the phase's central sentence is false today.** The phase's own reproduction, run in this checkout:

```
git update-ref refs/remotes/origin/__review_probe <HEAD>   # → exit 0
git rev-parse --verify refs/remotes/origin/__review_probe  # → <sha> (a single revision)
git for-each-ref refs/remotes/origin/__review_probe        # → <sha> commit
```

The file's claim — *"The write reports success and does nothing"*, *"No new remote branch can be tracked in this checkout by the normal mechanism"* — did not hold. A scratch repo (`git init` in `$env:TEMP`) also creates `refs/remotes/origin/<name>` normally under `git version 2.50.0.windows.2`, so git itself is healthy and this was never a git defect. **The probe was removed immediately**: `git update-ref -d` on both names, then `git show-ref` back to **77** refs with `refs/remotes` at **74** and zero `__probe|__review_probe` matches, and no tracked file touched. Two of the phase's own statements also contradict each other as written: the body says there is **no `refs/remotes/` directory at all** while its 09-15 clause says the directory **exists and is empty**; measured, it exists, is empty, and is a plain directory (not a reparse point) whose ACL is byte-identical to `refs/heads`. **What survives is the other half, and it is not a defect:** `origin/main` is still `ec2edf258` and `git rev-list --left-right --count origin/main...HEAD` → **0 473**, which is explained by nothing having been fetched or pushed — not by an unwritable namespace. The phase fuses a falsifiable claim with a true one; only the second is still owed.

**(b) Phase 2 names the wrong arm — the dangerous path is `workflow_dispatch`, and it is live now, not contingent on a future edit.** The phase says the `0.0.*` arm *"is inert only because the trigger filters to `main`"* and warns about widening `on.push.branches`. But `grep '^\s+branches:' .github/workflows/dev-ci.yml` matches **only `:5` and `:7`** — `workflow_dispatch:` at `:8` carries **no branch filter** — while `:695` ends `|| github.event_name == 'workflow_dispatch'`. A dispatch off a `0.0.*` branch therefore deploys to production **today, with no edit at all**. The workflow's own comment says exactly this at `:672-675` (*"a workflow_dispatch off a `0.0.*` branch deploys the same way, while a PUSH to a `0.0.*` branch runs nothing"*). The phase's hazard is real but secondary; the live path is the one it does not mention, so the guard the phase should ask for is a `github.ref == 'refs/heads/main'` test that precedes the `||`, or an explicit statement of the dispatch case.

**(c) Phase 1's decision is already made and only its record is owed.** `git config --get core.hooksPath` prints `.githooks` and exits 0, so options (a)/(b) are in force; the phase's own 09-15 clause concedes this while leaving the decision box open and the cost analysis (step 1 rewriting peers' staged files) describing something that is **already happening**. The state is *in force, unattributed* — the remaining task is the Quick Setup line, not the ruling.

**(d) The audit stamp's census of this file is duplicated and the first half is stale.** `:8` reads `...0 SUPERSEDED.2 DONE and ticked, 11 PARKED, 6 NOT WORK, 0 SUPERSEDED.` — one sentence concatenated twice. Counting the 19 checkbox rows by their own 2026-09-15 tags gives **2 DONE / 11 PARKED / 6 NOT WORK / 0 SUPERSEDED**, so the *second* half is correct and the first (13 PARKED, 4 NOT WORK) is a superseded duplicate that reads first. The same line also says **"open 19, ticked 0"**; the file holds **17 open / 2 ticked**.

**(e) Two rows still carry spliced duplicate prose** from corrections inserted mid-sentence rather than after it: `:52` (the Phase 1 rollout row re-runs its own tail — *"(b) enable it and announce first; (c) leave it off…"*) and `:88` (the ci-pipeline row repeats its closing clause). The append-only convention was applied *inside* sentences here, which is the one place it cannot work.

**(f) The trailer's own claim that this file is untracked is false.** It reads *"the file is untracked and its author commits their own file"*, but `git log --oneline -- todo-operational-integrity.md` names **three** commits (`173b87f5d`, `04cd68267`, `59c9935b6`), so the file is tracked and clean, and `git ls-files` confirms it.

**(g) The exposure figure has nearly trebled while parked.** Phase 4b recorded **143** unpushed commits at authoring and **371** in its 09-15 clause; measured now, `origin/main...HEAD` → **0 473**, with `origin/main` still `ec2edf258` by both `ls-remote` and `rev-parse`. The whole 473 exists on one machine, and Phase 2 still gates option (b).

**What was re-verified and holds**, so a later pass need not re-derive it: `.github/workflows/` holds **13** files = **2** live + **11** `.bak`; no live workflow names `--release` (`dev-ci.yml` 0, `release.yml` 0); `main`'s `crates/oz-bridge/src/license_tests.rs` is **575** lines against HEAD's **595**; `rustfmt --edition 2024 --check` reports **six** diffs on the `main` copy at **488, 525, 533, 538, 542, 560** — exactly the lines Phase 4a records — and **none** on HEAD's; `git diff --numstat main HEAD` → **26 / 6**; and the fix is whitespace-only, both copies stripping to **17,264** bytes and comparing equal. `.githooks/pre-push:5` still says *"dev-ci.yml is the only live workflow"* verbatim, twelve days after `release.yml` was restored. `.githooks/pre-commit` still has **7** named sections. AGENTS.md §4's move correction stands at `:274`.

**Two structural notes, offered rather than applied** (they change the file's shape, so they are an owner call): six of the seventeen open boxes are **prohibitions** ("Do not test this by pushing", "Do not push anything", "Do not rewrite any dated stamp", "Do NOT hand-edit `.git/`" ×2, "Do not push anything without an explicit order") that no future pass can ever tick, so the file cannot reach zero while they are checkboxes; and because corrections append while rows stand, most rows are now false *as written* (Phase 1's premise, Phase 3's reproduction, `143`) with the correction buried in a long HTML comment, which is precisely what an orchestrator skimming by phase will read first. A per-phase "current state" line would fix the second without touching a dated stamp.

*Review method, stated so its limits travel with it: every figure above is a working-tree reading at HEAD `5ca3cd5c0` on one machine, taken with the command printed beside it, and HEAD moved twice during the pass (`aaa19bc16` → `af4b27238` → `5ca3cd5c0`) as concurrent sessions committed — so each number is worth exactly its timestamp. The single write this review performed was the Phase 3 probe in finding (a); it is the one entry in this review that touched shared `.git/` state, it was reverted, and the revert was verified by ref count rather than assumed.*

---

**Correction, dated 2026-09-16 (appended; the rows above stand as written, per this file's own convention). Both legs of the thesis have moved, and the review block immediately above is now the stale one.** Re-measured at HEAD `675d49a35`:

- **"no live workflow names `--release`" is now FALSE.** `grep -c -e "--release" .github/workflows/dev-ci.yml .github/workflows/release.yml` → **2** and **0**. The live one is `dev-ci.yml:287` — `run: cargo nextest run -p oz-bridge --release` — inside job `release-bridge-test` (added `9d5c33c68`), which that file's own comment block at `:266-268` documents together with the `-P release` flag trap. So the sentence above reading "`dev-ci.yml` 0, `release.yml` 0" was true when written and is false now; `todo-open-debt-program.md` Phase 1 owns the change and closed on it 2026-09-16.
- **"the deploy condition is still broader than its trigger" is now FALSE.** `sed -n '760p' .github/workflows/dev-ci.yml` → `if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'`. The `startsWith(github.ref, 'refs/heads/0.0.')` arm is gone, so a dispatch from a release branch can no longer deploy — the hole Phase 2 warned about is closed, and Phase 2 carries the tick.
- **The `:27` correction is therefore stale on both of the legs it named**, and it is the correction that carried the thesis forward for a reader. Treat it as superseded by this entry, not as current.

**What still holds, so the thesis is weakened rather than dead.** Dev CI still does not run on the working branch — `dev-ci.yml:6-7` is `push: branches: [main]` — so every green produced on `0.0.39` is still a local green. The 20-check pre-push suite still runs only by hand, and `scripts/verify-pg-tests-ran.py` is still nothing's acceptance command. What changed is that the two rows an orchestrator was most likely to act on are closed, so "a green result proves less than it appears to" has narrowed to **"a green on a release branch is not a CI green."**

**Independent evidence the hooks are live — stronger than the config read.** Two commits made this pass were accepted only after `.githooks/pre-commit` actually ran: the second printed `verify-bundle-parity: 0 missing key(s)` over 34 key sites as part of the commit. `git config --get core.hooksPath` printing `.githooks` shows the *setting*; a hook firing shows the *behaviour*, and `:37`'s acceptance asks for the second. Re-derive: `git config --get core.hooksPath; git log --oneline -1`.

