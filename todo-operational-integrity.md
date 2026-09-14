# Operational Integrity — the gates that do not run, and the docs that say otherwise

<!-- Audit stamp: 2026-09-14 · DSH · status: NEW, UNEXECUTED · authoring HEAD `257ff6122` on branch `0.0.39`, single worktree `C:/dev/ozpos`. Every claim below was MEASURED in this checkout with the command printed beside it; nothing here is carried from another document except where labelled `[carried]`. The one place this file contradicts a repo document, it quotes that document and gives the measurement that contradicts it — five such disagreements were found and are listed together in Phase 5. · Companion to `todo-open-debt-program.md`, which covers four CODE debts; this file covers the OPERATIONAL ones. The two share no fence: nothing here edits `crates/**` or `ui/**`. -->

**Document:** `todo-operational-integrity.md`
**Role:** Program order — five phases on the repo's own safety machinery
**Goal:** Make the repository's gates actually run, stop the one that can deploy to production by accident, repair the git-dir defect that silently discards fetched refs, bring `main` level with the working branch, and correct the documents that describe all of this wrongly.
**Acceptance:** per phase, its own named command or decision. AGENTS.md §4 governs renaming; nothing here is renameable to `done-` until its own acceptance has been run.

---

## The thesis, stated once

**In this checkout, a green result proves less than it appears to.** Five independent reasons, each measured:

| Gate | Where it lives | Does it run here? |
|---|---|---|
| pre-commit — 7 named steps | `.githooks/pre-commit` | **NO** — `core.hooksPath` is unset |
| pre-push — path-aware router into `scripts/run-pre-push.py` | `.githooks/pre-push` | **NO** — same cause |
| commit-msg subject validation | `.githooks/commit-msg` | **NO** — same cause |
| `cargo fmt --all -- --check` | `scripts/run-pre-push.py:127`, CI, `check.sh`, `release.sh` | only if run by hand |
| release-profile tests (`--release`) | **nowhere in the repo** | **NO** — no runner builds release |
| Dev CI | `.github/workflows/dev-ci.yml` | **NO** on a `0.0.*` branch — `on.push.branches: [main]` |
| Release pipeline | `.github/workflows/release.yml` | only on a `v*` tag |
| the 20-check pre-push suite | `scripts/run-pre-push.py` | only if run by hand |

`git config --get core.hooksPath` → **exit 1, unset** (measured). So the three hooks above are files on disk, not behaviour. Everything that has been verified in this repo recently was verified because somebody *chose* to run it.

That is the honest framing for an orchestrator: **do not read "CI is green" or "the hooks pass" as evidence about this checkout.**

---

## Phase 1 — The hooks are inert. Decide, then act.

**Fence:** `.git/config` (`core.hooksPath`), `scripts/setup-dev.ps1`, `AGENTS.md` Quick Setup.
**Commit prefix:** `chore(dev):` · `docs(agents):`
**Acceptance:** `git config --get core.hooksPath` prints `.githooks`, and one deliberately bad commit is rejected by `commit-msg`.

### Measured state

- `git config --get core.hooksPath` → unset.
- `.githooks/` holds **four** executables: `commit-msg` (3,416 B), `post-commit` (13,497 B), `pre-commit` (14,074 B), `pre-push` (2,700 B).
- `pre-commit` contains **seven** named steps, by its own section headers: *Line-ending normalization · Bundle parity (staged) · FTL dedupe dry-run · Migration column-type lint · PG schema drift guard · Go gate (apps/license-server) · FTL orphan lint*.
- `pre-push` routes a **new-branch** push to `scripts/run-pre-push.py --all` and an ordinary push to path-aware flags (`--rust`, `--ui`, `--website`, `--i18n`).

### Why this is a decision, not a task

Enabling `core.hooksPath` is a **shared-config change**: one worktree, several live agent sessions, one `.git/config`. Turning it on makes every peer session's next commit subject to the 7-step hook — including the line-ending normalizer, which **rewrites staged files in the working tree** (step 1). That is the same class of intervention that got the mutating `cargo fmt --all` removed from pre-commit on 2026-09-13.

So the task is to decide, not to just run one command:

- [ ] **Decide the rollout.** Options, with their real costs: (a) enable it now and accept that every peer's next commit is rewritten-in-place by step 1; (b) enable it and announce first; (c) leave it off and make the pre-push suite a documented manual step for the orchestrator to run before any push; (d) leave it off and delete the hooks, so nobody assumes they run.
- [ ] **Whichever is chosen, record it in `AGENTS.md` Quick Setup** — the setup line `git config core.hooksPath .githooks` already exists there, but nothing says whether it has been run in this checkout. A reader currently cannot tell.
- [ ] **If enabled: verify the hook actually fires** rather than trusting the config. Stage a deliberate violation (a bad commit subject is the cheapest) and confirm `commit-msg` rejects it. `core.hooksPath` being set and the hook working are different claims.
- [ ] **A known cost to budget for if enabled:** the pre-push suite is not fast. `python3 scripts/run-pre-push.py --all` was measured at **193.8 s** on 2026-09-14 (18 pass / 2 fail), with the slowest single checks at 192.7 s and 178.0 s. `[carried]` That is a per-push cost on a shared machine.

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

- [ ] **Choose the invariant and enforce it in one place.** Either (a) drop the `0.0.*` arm so the deploy condition is `main`-only and matches the trigger, or (b) keep the arm and add an explicit `on.push.branches` entry for `0.0.*` **plus** a comment stating that release-branch pushes deploy. Do not leave a condition that is broader than its trigger with no comment saying why.
- [ ] **Add the guard comment regardless of which option wins.** This exact claim has rotted once already: the old one-liner "a push to `main` deploys" was true before `040435d11` and incomplete after it. A comment at `:695` naming the trigger it depends on is the cheap fix.
- [ ] **Check `docs/operations/ci-pipeline.md` against both.** A peer session had that file modified in the working tree earlier today, so re-read it rather than trusting either the doc or this file.
- [ ] **Do not test this by pushing.** Verify by reading the workflow and, if desired, `workflow_dispatch` — never by pushing a release branch to see what happens.

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

- [ ] **Establish the cause.** Not established on 2026-09-14 and not attempted since. The narrowing is already done: loose `refs/heads/**` and arbitrary `refs/**` writes succeed; only `refs/remotes/**` fails, silently, with exit 0. That points at something specific to the remote-tracking namespace rather than at the filesystem or permissions generally.
- [ ] **Do NOT "fix" it by hand-editing `.git/`.** `.git/config`, `.git/packed-refs` and `.git/refs/` are shared by every live session in this worktree. A hand-written ref that git would not have written is a hazard for peers, not a repair. Investigate read-only; if a repair needs a write, get it agreed first.
- [ ] **Document the workaround where it will be found.** The commit object for a fetched branch is already local even when its ref is not, so `git checkout -b <branch> <sha>` works with no tracking ref. That workaround belongs in `AGENTS.md` or `docs/records/`, not only in a journal.
- [ ] **Record it as a defect with a reproduction**, so a future session does not re-derive it from scratch the way this one had to.

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

- [ ] **Apply the same 26/6 fix to `main`.** This needs a branch switch, which AGENTS.md §1 forbids — so it is an **owner action or an explicit exemption**, not a worker lane. Name it as blocked rather than assigning it.
- [ ] **Confirm the fix is whitespace-only before it travels**, by the method already used once: strip `[ \t\n\r]` from both versions and `cmp` them. A reflowed literal would survive the strip and differ.

### 4b — 143 commits exist only on this machine

Measured this pass:

```bash
git ls-remote --heads origin refs/heads/main   # → ec2edf258…
git rev-parse origin/main                      # → ec2edf258…   (agree)
git rev-list --left-right --count origin/main...HEAD  # → 0  143
```

`origin/main` has **not moved since the clone**, locally or on the remote. The working branch is **143 commits ahead, 0 behind**. Those commits are unpushed by policy, and the policy is right — `dev-ci.yml:695` means a `main` push deploys — but the consequence is that a machine failure loses the work.

- [ ] **Decide the backup route.** Options: (a) push `main` and accept a production deploy (probably wrong); (b) push a backup branch — a `0.0.*` branch runs nothing today, per Phase 2's trigger, and a differently-named branch runs nothing either; (c) accept the risk explicitly in writing. Note the interaction: option (b) is only safe **while** `on.push.branches` stays `[main]`, which is Phase 2's subject. **Do Phase 2 before relying on (b).**
- [ ] **Do not push anything without an explicit order.** This box is a request for a decision, not authorisation.

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

- [ ] **Correct the four in this file's fence**, one commit each, live prose only. The two cross-listed rows belong to `todo-open-debt-program.md` Phase 4; do not fix them twice.
- [ ] **Sweep for the "ten gates" phrase** and make each occurrence say which set it means — the hook's 7, or CI's 10 jobs. `grep -rln "ten gates" --include=*.md .` currently hits only two archived plans (`.agents/archived/done-todo-global-saas-1.md`, `.agents/archived/done-todo-sync-conflict-agents-3.md`); the hyphenated `ten-gate` form additionally appears in `.workbuddy-ai/memory/2026-09-14.md`, which is gitignored. Both are historical, so the sweep is cheap now and will not be later — but note that a historical hit must be left alone if it is inside a dated record.
- [ ] **Do not rewrite any dated stamp.** If a stamp's number is wrong *for today*, that is the convention working as designed, not a defect.

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

- **Whether the hooks should run at all here.** Phase 1 is a decision with four options and no recommendation, because the right answer depends on how the owner wants to coordinate several live sessions — which is not a fact about the tree.
- **The cause of the `refs/remotes` defect.** Not established. Phase 3 narrows it and stops short of a fix on purpose, because every candidate repair writes into shared `.git/` state.
- **The backup route for 143 unpushed commits.** Phase 4b names three options and recommends none until Phase 2 lands.
- **Whether this file and `todo-open-debt-program.md` should be merged.** They are separate because their fences are disjoint and their acceptance commands share nothing; merge them only if the owner prefers one root document per orchestration round.

---

**Correction, dated 2026-09-14 (appended at the end; the rows above stand as written, per this file's own convention):** re-measured, the Phase 5 table carries **5** rows, not the "four" its checklist line "Correct the four in this file's fence" implies — two rows (the `todo-payment-agents-4.md:137-139` EDC-paths row and the `todo-payment.md` audit-stamp row) are cross-listed to `todo-open-debt-program.md` Phase 4, leaving **3** owned here (`AGENTS.md` §4 · `.githooks/pre-push:5` · the "ten gates" sweep, which needs nothing: `grep -rn 'ten gates' -- '*.md'` hits only archived plans and this table's own corrective row — neither live mirror asserts it). The table also predates and so does not carry the **3** pointer defects commit **`040435d11`** (2026-09-14 22:38, comment-only, +42/−15 to `.github/workflows/dev-ci.yml`) created in the live mirrors: `dev-ci.yml:662-664` plus its locating string "deliberately NOT a dependency" (the grep now exits 1, zero hits), the push-deploys comment at `:666-667` (now `:662-663`), and `northflank-deploy`'s `if:` at `:668` (now `:695`). All three were repointed the same day in both mirrors by the paired `docs(agents)` mirror commit, which also re-measured §4's plan-doc count (`ls todo-*.md | wc -l`: 16 → 18). This correction line itself stays in the working tree uncommitted — the file is untracked and its author commits their own file, per `AGENTS.md` §3.

