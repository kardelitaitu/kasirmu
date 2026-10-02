# todo-docs-restructure.md — split `docs/` into claims and records

**Status:** OPEN · **now on branch `0.0.41`** · updated 2026-10-02
**Token:** `todo-` — `done-` is earned only when §8's acceptance command is RUN and PASSED (AGENTS.md §7.4).
**⚠️ Read §11 first.** A concurrent session ran `git checkout 0.0.40 → 0.0.41` mid-plan, which left
this plan and the 14 `done-*.md` moves on `0.0.40` only. This copy is the `0.0.41` continuation.

---

## 0. Scope card

| | |
|---|---|
| **Goal** | Make "can I act on this?" answerable from the file's path. |
| **Not the goal** | A prettier tree. Topic reorganisation is explicitly rejected — see §9. |
| **Files moved** | 93 |
| **Link fixes by hand** | 7 links in 6 files (30 of the 38 breaking links are in a generated file) |
| **Tooling files touched** | ~20 of 31 (11 confirmed incidental) |
| **Batch count** | 4, each independently committable and revertible |
| **Blast radius** | Enumerable. Measured, not estimated — §6. |

## 1. What is actually wrong

Three defects, in descending order of cost.

**1.1 — Weight, not layout.** AGENTS.md E4 mandates *read whole files, one call, ≤2,000 lines*. Four files
make that impossible:

| File | Size | State |
|---|---:|---|
| `docs/records/JOURNAL.md` | **1,338 KB** | ✅ **split — §4 A1** |
| `docs/archived/manager-2-journal.md` | **690 KB** | ⏸ **deferred — §4 A1** |
| `docs/plans/_active/notes.md` | 343 KB | open — §4 A2 |
| `docs/plans/_backlog/0.0.36-backlog.md` | 294 KB | open — §4 A2 |

2.6 MB of markdown where the rule is *read it all*. Every agent either breaks E4 or spends its whole
context on a file it needed one paragraph from. This is a running cost and it is the highest-value
thing on this list.

**1.2 — "Record" is a state, not a directory.** `check-dead-refs.py` asks *live doc or dated record?*
The tree asks *what topic?*. The layout and the gates answer different questions. Concretely:
audits have **six homes** (`audits/`, `security/`, `observability/`, `architecture/`, `archived/`,
`records/`); the generator already calls them *"Scattered Audit Reports"*
(`docs/records/README.md:147`); and "finished" is spelled four ways — `archived/`,
`decisions/archived/`, `plans/_done/`, `specs/_done/`.

**1.3 — Two name collisions across the archive boundary.** Both files exist; neither path says which
is current:
- `docs/archived/ci-pipeline.md` vs `docs/operations/ci-pipeline.md` — **RESOLVED 2026-10-02, A4**
- `docs/archived/benchmarks.md` vs `docs/benchmarks/` — **RESOLVED 2026-10-02, A4**

## 2. Invariants — what must stay true

- [x] **I1** Every move is a `100%` rename. No file's bytes change during the move phase.
      *(Phase A does not move; A1's split is a split, not a move — see its conservation figures.)*
- [x] **I2** `check-dead-refs.py` reports 0 unresolved references, **and its `--self-test` passes**
      before that number is believed — a checker whose first run is clean may be silently blind, and
      this repo has been bitten by exactly that five times in `check-dead-refs.py`'s own history.
      **A1: self-test OK, 41 cases, run first. Real run: 0 unresolved.**
- [x] **I3** `node scripts/generate-records-index.mjs --check` exits 0.
      **A1: exit 0 — 22 records, up from 13.**
- [x] **I4** Nothing is left staged. **A1: `git diff --cached --name-only` empty.**
- [ ] **I5** `bash scripts/check.sh` passes on the final commit.
- [x] **I6** No doc loses its `todo-`/`plan-`/`prd-`/`done-` token. **Verified 2026-10-02:**
      91 token-bearing tracked files, **0 missing from the working tree** — nothing was lost by any of
      the 93 moves. `check-dead-refs.py` keys its exemption off the filename, and
      `verify-debt-markers.py` enforces it (exit 0 after the §6d scope fix).
      *Incidental confirmation:* `done-todo-modular-scaffolding.md` is at the root, which is exactly the
      name I had to correct a wrong link to in B4c — I guessed the rename, got it backwards, and the
      correction was confirmed rather than assumed.

## 3. DO NOT TOUCH

- **D1 (standing constraint, not a task)** `docs/src/` + `docs/book.toml` + `scripts/build-docs.sh` / `.ps1` — **17 tooling hits.**
      `docs/src/` is a **generated** directory (`ui/package.json` runs `typedoc --out ../docs/src/api/ts`)
      and the mdBook portal's source. [docs/README.md:114-118](docs/README.md:114) records that the
      mdBook config was archived once and then **restored**; this has already been got wrong.
- **D2 (standing constraint, not a task)** `docs/archived/manager-2-journal.md` and `manager-2-journal-posscreen.md` — move to
      `records/campaigns/` **together and separately**. Their own stamps: *"NEVER write the sibling's
      file"*, *"must not merge, rename or 'tidy' the two files together"*. Two agents both signed
      "Manager-2" and split the work between them. **Do not batch these with anything.**
- **D3 (standing constraint, not a task)** `.agents/skills/**` — that is `skill-drift-guard`'s scope, not this plan's.
- **D4 (standing constraint, not a task)** `docs/records/README.md` — **generated, never hand-edited.** Its new home is decided by the
      generator's output path, not by `git mv`.

## 4. Phase A — zero-move fixes

Independent of the reorg. Four small commits, all reversible, none needing the §6 checklist.

### A1 — Split the two giant journals

**1 of 2 done.**

- [x] **`docs/records/JOURNAL.md` — SPLIT, `05dcb632b`, 2026-10-02.** ✅
  - **Not by year, and the plan's original by-year intent was wrong.** The file is **not**
    chronologically ordered: it descends 2026-10-02 → 2026-07-02 by line 2389, then jumps *back* to
    2026-08-07 and climbs to 2026-10-06. It is a **merge of several source journals**. A by-month
    split would have required *reordering*, which risks invalidating the `file:line` citations the
    entries themselves make. **Contiguous and order-preserving instead**, at `##` boundaries:
    **8 parts**, `docs/records/JOURNAL-part-{1..8}.md`, max **1,996 lines** (E4's cap is 2,000).
    `JOURNAL.md` remains as a **33-line index** carrying the line→part map.
  - **Conservation:** body **1,369,815 → 1,369,814 bytes (delta 1)**; body lines **13,429 → 13,429**.
    The 1-byte delta is a single `###`→`##` promotion at old line 5077, *forced* because old lines
    3089–6265 contain **no `##` at all** (202 `###` instead) — a pure-`##` split would have left a
    3,177-line part, over the cap.
  - Whole-journal audit stamp (old lines 1–3) and the `> last audited` footer (old line 13433) moved to
    the **index**, not left stranded inside part 1 and part 8.
  - **20 external `JOURNAL.md:<line>` citations deliberately NOT repointed.** 8 of their 11 citing
    files are other sessions' records under `.agents/planning/`, `.agents/reviews/` and
    `.agents/archived/`. On a shared checkout, editing another agent's journal to suit a docs reorg is
    the wrong trade. **They still resolve** — the index carries the line→part map and a worked example
    (`JOURNAL.md:11057` → part 7, line 889). This map is now the plan's standing mechanism for the
    whole move, not a one-off.
  - **Verified:** self-test OK (41 cases) *before* the real run · `check-dead-refs.py` exit 0 ·
    `check-orphans.py --file` exit 0 on all 9 files · `generate-records-index.mjs --check` exit 0 ·
    `git show --stat` = exactly our 10 files · nothing left staged.
  - Two pre-existing control characters (2× `0x08` in old part 6, 2× `0x09` in old part 5) were
    **confirmed present at HEAD before the split** and carried through untouched. I1 holds.
  - The pre-commit line-ending hook rewrote the parts to LF on disk; `git diff --stat` against HEAD is
    **empty**, so this is not an outstanding change.

- [ ] **`docs/archived/manager-2-journal.md` — DEFERRED 2026-10-02, not cancelled.** Measured:
  2,752 lines / 690 KB. It clears **neither** test that justified splitting `JOURNAL.md`:
  - It is a **single completed campaign's ledger**, cited by 12 files (vs 40+ for `JOURNAL.md`), and
    **no tooling reads it**. Its size costs nothing on a normal task.
  - It carries a **prior auditor's explicit warning against tidying it**, and the ownership note that
    keeps the two agents' work apart lives in its *sibling*. Splitting one while leaving the other
    whole is precisely the asymmetry that warning guards.
  - **6 external `manager-2-journal.md:<line>` citations** (4 in `.agents/`, 2 in
    `docs/records/audit-open-findings.md`) would each need a line-map lookup — indirection in a
    document whose stated purpose is to be re-read precisely, every turn.
  - Structure resists a clean cut: `##` boundaries leave a **1,830-line gap** (h2 at 512 → 2342).
  **Revisit only if a live need appears** — e.g. an agent that must re-read it mid-task. D2 still
  governs: it and `manager-2-journal-posscreen.md` move to `records/campaigns/` **together in Phase B,
  and never in the same batch as each other.**

### A2 — Resolve `docs/plans/_active/notes.md` · **BLOCKED ON OWNER**

**The premise was wrong on measurement, and the remaining fix is a rename, which §7.4 puts in the
"ask first" column. Not done unilaterally.**

- **It does not need splitting: 1,821 lines, already under E4's 2,000 cap.** The 343 KB is long
  *lines*, not many of them. Splitting it would treat a number that was never a violation.
- **It must not move to `_backlog/`: its own header says otherwise** — *"this file stays a live index
  rather than a stale backlog."* Moving it would contradict the document being moved.
- **It has zero markdown links.** 20 files merely *mention* the string. A rename breaks no link, and
  being a pure rename it would **preserve every line number** — 16 files cite `notes.md:NNNN`.
- **It is not a plan:** 109 `##` sections, **125 ✅ markers, 0 open checkboxes**. It is an accumulated
  cross-lane findings index. Its own H1 — *"Analytics cards — deferred items needing visual
  confirmation"* — is **itself stale**: the file has grown to 44+ items covering `TabletAppLayout`,
  release-branch collisions and a `STALE-CLEANING SWEEP`.
- **So the real defect is the name and the stale H1** — and `notes.md` carries **no lifecycle token**,
  which is why `check-dead-refs.py` audits it as a live claim instead of exempting it.

**Owner decision needed:** rename to something like
`todo-audit-and-analytics-deferred-index.md` (token-bearing, so `check-dead-refs` exempts it) and
retitle the H1. §7.4: *"the name is shared state, like the index."*

- [ ] **Verify once renamed:** `verify-debt-markers.py` exit 0 · `check-dead-refs.py` exit 0 · the 16
      line-number citations still resolve (a pure rename keeps them valid) · 20 bare mentions updated.

### A3 — Kill the numbering collisions · **NOT DONE: wrong trade on measurement**

The collisions are real. **Renumbering them is not the fix**, for reasons unknown when this was written:

- **ADR #43 is already a documented, tolerated state, not an undiscovered bug.**
  [docs/decisions/README.md:31-36](docs/decisions/README.md) names both files and explains the
  collision in prose, and `check-adr-status.py` **resolves table rows by file path** so each `#43` row
  checks its own file — it exits **0 by design**, not despite the duplicate.
- **A published ADR number is an immutable identifier.** Renumbering React-only → `#16` would break
  **33 references across 12 files** — `ARCHITECTURE.md`, `CHANGELOG.md`, the decision's own file, and
  two files under `.agents/` that belong to other sessions.
- **The spec collision is worse: 134 references**, 33 of them in `JOURNAL-part-4.md` and **18 in
  `CHANGELOG.md`** — a historical record that must not be rewritten to tidy a number.

**Nothing was renumbered, and nothing was left silently broken**: the ADR half is already documented
where a reader looks, and the spec half is now recorded here. The original suggestion was a
surface-level reaction to a repeated number and is **withdrawn**.

- [x] **Verified current state:** `check-adr-status.py` → *"0 status drift finding(s) across 57
      hand-table row(s)"*, exit 0. The duplicate row the generator emits is a **documented quirk it
      reproduces on purpose**, not a defect to remove — so nothing in `docs/README.md` needed to change
      for A3, and this bullet's old note about "updating the same commit" is **withdrawn with the plan**.

### A4 — Remove the two ambiguous filenames · **DONE, date-stamped not deleted**

**Deletion was rejected on measurement.** Both files carry audit stamps and supersession markers —
`archived/ci-pipeline.md` is stamped *"HISTORICAL RECORD — describes a CI shape that no longer
exists"*, and `docs/operations/ci-pipeline.md` declares itself the *"single source of truth"*.
Deleting a stamped record destroys audit history — the same trade refused in A5.3.

- [x] `docs/archived/ci-pipeline.md` → **`docs/archived/2026-08-17-ci-pipeline.md`** (its own
      *"Last updated: 2026-08-17"*). Content **byte-identical**: `083407ad5` before and after.
- [x] `docs/archived/benchmarks.md` → **`docs/archived/2026-07-22-benchmarks.md`** (its supersession
      marker date). Content **byte-identical**: `f4305617` before and after.
      Date-**prefix** chosen to match the dominant convention in `docs/archived/` — these two were
      the exceptions.
- [x] Repointed the **one** external reference, `docs/guides/product/ROADMAP.md:536`.
- [x] **Collision resolved:** `ci-pipeline.md` now resolves to exactly one file
      (`docs/operations/ci-pipeline.md`); the bare basename `benchmarks.md` no longer exists.
- [x] **Verified:** both sources clean before moving · `git mv` exit 0 ×2 · post-move hashes equal
      pre-move hashes · `check-dead-refs.py` exit 0 · `git show --stat` shows two 100% renames.

### A5 — Resolve the three loose ends · **1 of 3 done**

- [x] **Hand-counted numbers in `docs/README.md` — FIXED, `9138b15c2`, 2026-10-02.** Three stale
      facts, not one:
      - `archived/` claimed **26 files**, actually **28**.
      - the ADR bullet claimed **"13 of the 66 files … the other 53"**, actually **30 of 81**.
      - the same bullet claimed **"Highest number in use: adr47"**, actually **`adr63`**.
      **All three were replaced with derivation commands, not restated** — `ls docs/decisions/*.md |
      wc -l`, `ls docs/decisions/ | grep -c 'adr[0-9]'`, and a `sort -n | tail -1` for the highest.
      Restating "28" would have been the third value to rot; the repo already uses this pattern
      (*"Re-derive both numbers rather than quoting these"*, README tech table).
      The counts **inside the dated audit notes were deliberately left alone** — they record what past
      audits measured, and rewriting them would falsify the audit history. A dated correction block was
      appended in the file's established `> **Correction (02-10-26):**` style.
      **Verified:** self-test OK (41 cases) first · `check-dead-refs.py` exit 0 ·
      `check-orphans.py --file docs/README.md` exit 0 (clean).

- [x] `docs/coverage/README.md` → **`docs/records/benchmarks/coverage-report-2026-07-20.md`** (`82186f28e`, 100% rename).
      It was **date-stamped on the way in**, applying A4's lesson: a bare `README.md` inside a records
      folder is a name that says nothing, and this is a point-in-time measurement.
      ~~**deferred to Phase B.** A *generated* report
      (*"Generated: 2026-07-20"*) carrying a `dead-ref-prefix-ok` pragma, cited by 2 other docs. A5
      says "fold into `record/`" — but that directory does not exist until Phase B (and B0 later
  renamed the target to `records/`), so this is a
      **sequencing bug in this plan**, not a judgement call. Folds in at B4.

- [x] `docs/audit-receipt-settings.md` → **`docs/records/audits/audit-receipt-settings.md`**
      (`82186f28e`, 100% rename). A real audit report — a BLOCKER finding, 80 lines — sitting loose at
      the `docs/` root with **zero inbound references**. It belonged under `audits/` from the start;
      B2 was where it should have gone and A5 is where it actually landed.

**A5 is now 3 of 3.** Both deferred items were blocked by a **sequencing bug in this plan**, not by a
judgement call: §4 said "fold into `record/`" while §5 created `records/` three batches later. Phase B
had to finish before the last two boxes could be ticked — the cost of numbering steps before the steps
they depend on exist.

## 5. Phase B — the move

> ### ⚠️ B0 — a naming collision the plan did not anticipate, settled 2026-10-02
>
> §5 originally named the target **`docs/record/`** (singular) while the live directory it is meant
> to absorb is **`docs/records/`** (plural). B1 would create `record/` while B3 still needs
> `records/` — a window where `docs/records/audits/` and `docs/record/audits/` are two different
> directories one letter apart, both holding record trees, in a shared checkout.
>
> **Settled: the parent stays `docs/records/`.** It already exists, it already fronts the generated
> index, and it *is* the top-level record boundary §1.2 asked for. The lifecycle subfolders go
> **under** it rather than beside it:
>
> ```
> docs/records/
> ├── README.md          generated — output path UNCHANGED
> ├── audits/  findings/  snapshots/  benchmarks/
> ├── releases/  journal/  campaigns/  superseded/
> ```
>
> Strictly less disruptive, removes the one-letter hazard, and **leaves the generator's output path
> alone** (D4) — which retires the single largest tooling risk in §6 (`generate-records-index.mjs`,
> 31 hardcoded hits) without editing that file at all. The thesis is unchanged: *can I act on this?* is
> answered by the path, and `docs/records/audits/` answers it as well as `docs/record/audits/`.

Target shape:

```
docs/
├── README.md              the live/record contract, stated once
├── architecture/  guides/  operations/  security/  legal/  decisions/     CLAIMS
├── specs/  plans/                                                        IN FLIGHT
└── record/                                                              RECORDS
    ├── README.md          generated
    ├── audits/ findings/ snapshots/ benchmarks/ releases/
    ├── journal/ campaigns/ superseded/
```

Batch order is by ascending tooling entanglement. Each batch is one commit.

### B1 — `docs/archived/` → `docs/records/` (28 files) · **DONE, folder removed**

**Split into commits, not one** — D2 forbids the two manager journals sharing a batch with *each
other*. Executed as four commits: 26 files, then each journal alone, plus one repair (below).

- [x] → `records/audits/` (14) · [x] → `records/superseded/` (12) · **all 26 byte-identical**
      (post-move hashes equal pre-move, I1 holds) · commits `1cd644b82` + `1cc5c7b1f`
- [x] → `records/campaigns/` (2, **D2 — one commit each**): `manager-2-journal.md` (`2daaabdfe`,
      100% rename) and `manager-2-journal-posscreen.md` (`74c42d4b8`, 100% rename)
- [x] `docs/archived/` emptied — **but kept as a tombstone**, see below. "Archived" is no longer a
      location; it is a state, expressed by which `records/` subfolder a file occupies.

**Removing the directory outright turned the gate red — and that was the useful signal.** Three
docs still referenced `docs/archived/`: `docs/README.md` (its own audit stamp),
`docs/observability/logging-2026-07-20.md` (an audit stamp), and
**`manager-codebase-review-checklist.md`** — another session's actively-growing file (line 1092),
which is not mine to edit. Rather than either leaving a red gate or editing someone else's working
file, `docs/archived/README.md` was added as a **tombstone**: it names where each group went and
explains why the folder was retired. All three references resolve through it, the gate is green,
and no other session's file was touched. `check-dead-refs.py` → **0 unresolved, exit 0**.

**Relative-link analysis (the real risk of a 2-level-deep move):** 5 relative links existed across
3 of the 26 files. **3 survived untouched** — the two GLM audits link to each other with `./` and
moved to the same folder together. **2 needed fixing:**
- `records/audits/2026-08-15-unify-auth-and-sync.md:12` — `../operations/runbook.md` → `../../`
- `records/audits/2026-08-30-glm-5.3-tauri-app-review.md:15` — `../records/audit-open-findings.md`
  → `../audit-open-findings.md`

**A judgement call worth recording:** the second link points at `audit-open-findings.md`, which B3
moves to `records/findings/`. Pulling that move forward to keep one link valid would have cost
**10 hand-fixes** (2 sibling links each way inside the pair, `docs/README.md` ×2, `adr49` ×1, this
one) — more work than B1 itself. It was left for B3, and the link written in a form that is correct
today. B3 updates it when the target moves.

**A mistake worth recording — I broke my own invariant I4.** The first commit's pathspec captured
only the 26 *new* paths, so the 26 *deletions* of the old paths were left staged and the commit
landed as `create mode` rather than renames. Caught immediately by the protocol's step 6
(`git diff --cached --name-only`), repaired with a follow-up commit naming the old paths —
**never amend** (§7.3). Net result across the two commits is a correct move, and the journal moves
that followed did land as proper 100% renames. The lesson: for a `git mv` batch, the pathspec must
name **both** sides; git's staged rename is not automatically carried by a pathspec commit.

### B2 — `docs/audits/` → `records/audits/` (14 files) · **DONE, `a0c4f7b90`**

- [x] 14 files moved, **all 14 recorded as `100%` renames in a single commit**, subfolder structure
      preserved (`frontend/`, `seo/`, `setup/`, `skills/`). `docs/audits/` removed.
- [x] **0 relative links needed fixing.** Only 2 existed: one inside a `<!-- dead-ref: ok -->` pragma
      example (not a real reference), and one sibling `./seo-robots-llms-review-19-09-26.md` between
      two `seo/` files that moved to the same folder together.
- [x] **11 path literals repointed across 8 files**, including **AGENTS.md §5.1** and
      `docs/operations/agent-gates.md`, which name `frontend/css-verification.md`. Because these are
      **repo-root-relative literals**, one repoint is correct regardless of where the *citing* file
      later lives — so `audit-closed-findings.md` (moving in B3) and `MODULAR_APP_PLAN.md` (B4) were
      fixed now and need no second pass.
- [x] **Correction to §6:** this plan claimed `css-verification.md` is named in
      `.agents/skills/docs-auditor/SKILL.md`. **It is not** — grep found it in `AGENTS.md` §5.1 and
      eight other files, but not in the skill. Only AGENTS.md needed the paired update.
- [x] **A silent failure caught:** a PowerShell `Select-String` bulk scan over `git ls-files` returned
      **0** references to `docs/audits/` where grep found **29**. The scan had been failing silently
      and reporting a clean result. Per the plan's own rule — *never trust a zero-reference claim* —
      it was re-measured with the grep tool before anything was moved. **A scan reporting zero is a
      claim, not a finding.**
- [x] **Side effect recorded:** `generate-records-index.mjs` classified audits by scanning
      `docs/audits/`, so its dedicated *Audit Reports* section is now **empty** and the files appear
      under **Engineering Records** instead — records went **48 → 64** (48 + 14 audits + 2 campaigns).
      All 28 rows are still indexed; only the section heading changed. Noted in the `docs/README.md`
      table rather than left for a reader to puzzle over.

**The I4 lesson from B1 held.** The commit pathspec named **both** the new and the old paths, so all
14 landed as `100%` renames in one commit and `git diff --cached --name-only` was empty afterwards.

### B3 — `docs/records/` subfolders · **DONE, `2a9b73e22`**

- [x] `audit-open-findings.md`, `audit-closed-findings.md` → `records/findings/`
- [x] **`JOURNAL.md` + the 8 parts → `records/journal/`** as one set. 11 files, **10 at `100%` rename**
      and `audit-open-findings.md` at `99%` (it carried the one link repair). All 11 **byte-identical**
      pre/post move, I1 held.
- [x] `snapshots/` (8) → **already at `records/snapshots/`** — no move was ever needed; the original
      enumeration listed work that did not exist.
- [x] `sqlite-pg-roles.md`, `statutory-rounding-and-estimate-stamps.md`, `adr7-conditional-scoping-fallback-class.md`
      → **stay at `records/`** — already the record home, no move needed.
- [x] ~~`README.md` → the generator's output path changes; it is never `git mv`d~~ — **retired by B0**.
      The output path never moved, so **D4 is satisfied by doing nothing**, and the largest item in §6
      (`generate-records-index.mjs`, 31 hardcoded hits) needed **no edit at all** — only its scan list
      grew, which it already walks recursively.

**Five link fixes, and one of them was a pre-existing defect.** B1 deferred this move precisely
because the pair looked expensive; in the event it cost **5**, not the 10 estimated:
- `records/findings/audit-open-findings.md:184` — `./fluent-page-audit.md` →
  `../audits/frontend/fluent-page-audit.md`. **This link was already broken before either move** —
  the file has been at `audits/frontend/` since B2 and before that at `docs/audits/frontend/`, so the
  bare `./` form never resolved. It survived `check-dead-refs.py` only because everything under
  `docs/records/` is skipped as a dated record. Found by reading the file, not by a gate.
- `docs/README.md` ×2 (directory table + Conventions) → `./records/findings/audit-open-findings.md`
- `records/audits/2026-08-30-glm-5.3-tauri-app-review.md:15` — the link B1 wrote as
  `../audit-open-findings.md` and deliberately deferred updating to this batch → `../findings/…`
- `docs/decisions/2026-09-11-adr49-headless-command-bridge.md:108` → `../records/findings/…`

The 7 internal links between the pair (`./audit-closed-findings.md` ×5, `./audit-open-findings.md` ×2)
needed no change — they are siblings and moved together. The 5 links inside the **generated** index
self-healed on regeneration.

**The B1 deferral was the right call and cost nothing.** Deferring one link for a round in order to
measure the real blast radius is cheaper than guessing it at 10.

### B4 — remaining splits · **DONE — Phase B complete**

Run as three sub-batches, because one 36-file batch would have put every failure mode in a single commit.

- [x] **B4a** `cd8d671a6` — `docs/security/` (9 of 12) → `records/audits/security/`, and
      `docs/observability/` (2) → `records/audits/observability/`. **All 11 at `100%` rename.**
      `docs/observability/` removed. `docs/security/` retains its 3 policy docs.
- [x] **B4b** `afca83144` — `docs/benchmarks/` (4) → `records/benchmarks/`, `docs/releases/` (10) →
      `records/releases/`. 13 at `100%`, `CHANGELOG-0.0.36.md` at `99%` (2 links). Both folders removed.
- [x] **B4c** `45e1cd520` — `docs/architecture/` (11 of 17) → `records/superseded/`. 10 at `100%`,
      `reporting-facade-inventory.md` at `97%` (3 links). `docs/architecture/` retains its 6 live docs.

**Two of the seven originally-predicted hand-fixes landed here, exactly as forecast.** §6's
blast-radius measurement named `guides/platform/windows-launch-test.md` (2) and `linux-launch-test.md`
(2) as links that would break on the `releases/` move. Both fired — at **3 occurrences each**, not 2.
The original measurement was right about the files and about the count *class*, and the checker found
the extras. That is the argument for measuring a blast radius first and then letting a gate confirm it.

**A method that earned its keep: move, then ask the checker.** Predicting which of ~110 references
would break was repeatedly wrong (B1: 10 estimated, 5 real; B3: 10 estimated, 5 real). Moving first
and running `check-dead-refs.py --verbose` named every break exactly, for a fraction of the effort.
B4a broke **3** links out of 53 mentions of `docs/security/` — because most pointed at the 3 files that
stayed, or at files that never existed (`EMERGENCY_CONTACTS.md`, `COMMS_TEMPLATES.md`,
`LICENSE-ENCRYPTION.md`).

**One self-inflicted error, caught by reading rather than by a gate.** Repointing
`reporting-facade-inventory.md:214`, I rewrote the target as `todo-modular-scaffolding.md` on the
assumption the file had been renamed. It had not — it is still `done-todo-modular-scaffolding.md`, and
my edit made the link text and its target disagree. Found by re-reading the line before the gate ran,
not by the gate.

**Recorded side effect:** the generator's *System Analysis / Observability* section is emitted from the
directory name `docs/observability/`, which no longer exists, so that section is now **empty** and the
report reports `0 observability`. Cosmetic, noted in `docs/README.md` rather than left unexplained.

## 6. Tooling checklist

31 files carry a hardcoded `docs/<dir>/`. **Each must be confirmed individually** — the measurement
below used one combined pattern, so the per-file hit count is not yet attributed to a specific directory.

### 6a — originally a prediction; reconciled in §6e. **8 of 15 changed, 7 needed nothing.**

- [x] `scripts/generate-records-index.mjs` — `48fad0afa` (stale `scattered` list retired; the
      **output path never moved**, which is why its 31 predicted hits cost one edit)
- [x] `scripts/gen-summary.py` — `85501cc3b` · **the 5th functional break, found last round**
- [x] `scripts/verify-debt-markers.py` — `eab1c09f9` (dead `CITATION_DIRS` entries dropped)
- [x] `scripts/verify-ci-docs-drift.py` — `bb82984a9` (prose only; **another session had already
      fixed the logic** with a dual-path `RELEASE_CHECKLIST`)
- [x] `scripts/test-ci-routing.sh` — `e85eaf368` (added a case pinning the legacy release path)
- [x] `scripts/release.sh` — `9fd33e279` · `scripts/bump-version.ps1` — `9fd33e279`
- [x] `.agents/skills/docs-auditor/SKILL.md` — `afca83144` (one stale path. It does **not** name
      `css-verification.md`, contrary to this list — see §6e)
- [x] **AGENTS.md §5.1** — repointed in B2 (`a0c4f7b90`) · `docs/README.md` — repointed in B2
- [x] Needed **nothing**: `test-records-index-escaping.sh`, `check.sh`, `gates.json`,
      `verify-doc-uniqueness.py`, `__tests__/verify-ci-docs-drift.test.mjs`,
      `check-mapper-alignment.py`, `find-oldest-md.sh`, `profile.ps1`

**Not on this list, and both had to change:** `.github/workflows/dev-ci.yml` and
`scripts/verify-root-policy.py`. See §6e.

### 6c — FOUND AFTER the moves: 51 stale script refs, and ONE real functional break

§6a's list was written as a *prediction*. Measured after B1–B4 and A5, `scripts/` carries **51 stale
`docs/` path references across 18 files**, plus 2 in CI workflows. Most are harmless; **one is not**:

- 🔴 **`scripts/build-docs.sh:51` — `cp "$WORKSPACE_ROOT"/docs/releases/*.md "$BOOK_SRC/releases/" 2>/dev/null || true`.**
  `docs/releases/` **no longer exists** (B4b). The mdBook portal's releases section is now silently
  empty, and `2>/dev/null || true` swallows the failure exactly as designed — which is precisely why
  it went unnoticed. This is the only *functional* break in the whole move, and it is in a file §3's
  **D1** marks *do not touch*. D1 protects `docs/src/` from being *moved*; it does not exempt a
  **consumer** that must be repointed.
- ✅ **FIXED `d00c08653` — proved, not assumed.** The old path yields **0 files**; the new
  `docs/records/releases/` yields **10**; and executing the fixed copy actually landed **10 files**
  in a simulated book source. `build-docs.ps1` got the same one-token fix, plus a stale
  `docs/archived/` comment. This was the **only functional break in the entire move** — every other
  stale reference found was a comment or a self-healing dead list.
- 🟡 **`scripts/generate-records-index.mjs` — 14 of its 21 hits were a hardcoded `scattered` list**
  (`docs/archived/*.md`, lines 410–423), every path stale. That is why every run reported **0 scattered**.
  **FIXED `48fad0afa`** — the list is now empty, with the reasoning recorded in a comment beside it.
  **Why emptied rather than repointed:** all 14 files now live under `docs/records/`, which the
  records scan already walks **recursively**. They were verified present in the index *before* the
  change, so repointing would have indexed all 14 **twice**. Two independent proofs it cost nothing:
  the record count held at **102** across the change, and `docs/records/README.md` did not appear in
  the commit at all — regenerating produced byte-identical output.
  **Why it never broke:** the old code carried `.filter((p) => existsSync(…))`, so stale paths were
  **silently dropped**. Self-healing, and therefore invisible to every gate. The remaining 7 hits in
  that file are comments and section headers — including the now-empty *Audit Reports
  (`docs/audits/`)* and *System Analysis / Observability (`docs/observability/`)* headings, both
  emitted from directory names that no longer exist. Left as recorded artefacts rather than turned
  into new behaviour this late in the plan.
- 🟢 Comments and stale prose in `gen-summary.py` (3), `verify-debt-markers.py` (4),
  `verify-doc-uniqueness.py` (3), `verify-ci-docs-drift.py` (3) + its test (2), `find-oldest-md.sh` (2),
  `profile.ps1` (2), `release.sh` (2), `test-ci-routing.sh` (2), and 5 one-line scripts — **no gate
  fails on any of them**, but they now name directories that do not exist.
- ⚪ `.github/workflows/release.yml:7` and `dev-ci.yml:206` — **comments**.
- ⚪ `.github/workflows/attic/nightly.yml.bak` — inert backup, excluded by the repo's own convention.

### 6d — THREE functional breaks, not one — all found by reading, none by a gate

The 🔴 was not a single defect. Auditing the 21 *non-comment* stale references (rather than assuming
comments were the residue) turned up **two more**, both more serious than the first:

- 🔴 **`scripts/release.sh:111` — FIXED `9fd33e279`.** `CHANGELOG_FILE="docs/releases/CHANGELOG-${NEW_VERSION}.md"`
  then `cat > "$CHANGELOG_FILE"`. The directory was emptied in B4b, so **the release redirect
  failed**, and `git add … "$CHANGELOG_FILE" 2>/dev/null || true` at line 162 swallowed the
  missing file exactly as `build-docs` had swallowed its own. **Proved:** the redirect was executed
  for real against `docs/records/releases/` and the probe file was written, then removed.
  `bump-version.ps1:243` emits the same stale path as *text* into every `CHANGELOG.md` heading it
  inserts — also repointed, because that text lands in git history permanently.
- 🔴 **`.github/workflows/dev-ci.yml:206` — FIXED `e85eaf368`.** The **release-readiness bucket**
  keyed on `^docs/releases/`. With release docs moved to `docs/records/releases/`, **editing any
  release document would have stopped triggering the release job** — the signing chain and
  updater-compat checks would go unexercised, on exactly the changes most likely to break them.
  The `docs` bucket keys on `^docs/` and was unaffected. Widened to `^docs/(records/)?releases/`.
  **Verified through the real router**, not a regex: `scripts/test-ci-routing.sh` extracts the
  Route step body out of the live workflow file and runs each case through it — **25/25 correct**
  (was 24/24; the added case pins the legacy path so a future revert cannot silently un-route it).
  **This is the one that mattered most.** The other two produce an empty copy or a failed write;
  this one would have quietly switched off a gate in CI, which is precisely the failure
  `dev-ci.yml`'s own comment at line 147 calls *"worse than no gate"*.

- 🔴 **`scripts/verify-runner-claims.py` — FIXED `13ff89458`. THE FOURTH, AND THE ONLY ONE THAT
  TURNED A GATE RED.** `SKIP_DIRS` prunes by **directory name** during `os.walk`, and its list
  contained `"archived"`. When B1 moved 28 documents out of `docs/archived/` into
  `docs/records/`, the prune stopped matching — and a **dated audit's** CI-enforcement claim
  started being graded as a live one. The checker went **RED** on
  `docs/records/audits/2026-08-31-glm-5.3f-crates-audit.md`. Fixed by pruning
  `records` too, which is the tool's own stated intent: *a record of what was true on a given day
  is not drift.* Back to **5 CI-enforcement claims checked, all hold**, self-test OK.
  **This one is the exception that proves the pattern.** The other three stayed green while being
  wrong, which is why they took reading to find. This one announced itself — and it is still the most
  valuable finding in this section, because **a red gate is information and a green gate is not.**

- 🔴 **`scripts/gen-summary.py` — FIXED `85501cc3b`. THE FIFTH, AND THE ONE A GREEN EXIT CODE
  ALMOST HID.** Its `releases()` globbed `docs/releases/`, which B4b emptied, so the
  `is_dir()` guard returned `[]` and the mdBook portal's **SUMMARY index** silently lost all 10
  release chapters. The tool printed **`0 releases` and exited 0** — a green run with the wrong
  answer, which is this whole section's theme in one line. Caught by *reading its own output* rather
  than its exit code. Now **`10 releases`**.
  **The uncomfortable part: this is the same portal `build-docs.sh` feeds, and I had already fixed
  that half one round earlier without noticing the index half.** Both write into `docs/src/`, both
  were broken by the same move, and fixing one gave no signal about the other — because the fix's
  verification (`10 files copied`) could only ever see its own output. **Two consumers, one
  breakage, and no gate covers either.**

**Why no gate caught the first three.** Every gate in §2 was green throughout. `check-dead-refs`
audits *markdown*, not shell or YAML. `generate-records-index --check` compares the index against
its own generator, so a generator whose input list is stale produces a *self-consistent* wrong
answer. And `test-ci-routing.sh` passed 24/24 **with a path that no longer existed** — it was
testing the router's shape, not the repo's reality. **The lesson is not "add more gates"; it is
that a green board was never evidence about scripts and workflows, and only reading them found
this class.**

**A process note, recorded because it nearly cost a commit.** The `dev-ci.yml` fix was applied and
the routing test then *appeared* to hang — twice. The cause was **another session's concurrent git
activity**, not the change: four unrelated processes were alive (a `git fsmonitor--daemon`, the
website `npm run dev` server, and a git chain spawned seconds earlier by a different session).
Running the test in the background returned **25/25 PASS**. **The lesson: a hang under concurrency
is not evidence of a defect in your change** — and the processes were left alone, because three of
the four were not mine to kill.

### 6g — the index was publishing two empty sections, and both were my debt

`generate-records-index.mjs` guarded its `docs/audits/` section with `if (docsAudits.length)` but
left `scattered` and `observability` **unguarded**. Both then rendered a heading over nothing:
`## Scattered Audit Reports` with zero lines, and `## System Analysis / Observability` as a table
header with no data rows. Neither was pre-existing breakage — `scattered` went empty because **I**
emptied that list in `48fad0afa`, and `docs/observability/` was retired by **my** B4a. Both fixed
in `95b9c8603`; the index goes from 6 sections to 4, all carrying content, `--check` exit 0, record
count unchanged at 102.

Worth stating plainly: *an empty section is worse than an absent one*, because a reader cannot
distinguish "nothing qualified" from "this class no longer exists". That is the same
self-healing-silence family as §6c's `.filter(existsSync)` — a generator that emits structure for
input that is gone, and reports success while doing it.

Also repointed one prose citation of a moved document: `scripts/translate-stub.py:7` cited
`docs/archived/i18n-todo.md`, which is now `docs/records/superseded/i18n-todo.md`.

### 6f — the fourth *scope* fix, and what it does and does not do

`scripts/verify-doc-uniqueness.py` had the same disease as §6d's three, in a fourth place. Its
`archived` classifier matched `/archived/`, which after B1 is a **one-file tombstone** — so the
24 superseded copies now living in `docs/records/superseded/` and `docs/records/audits/` read as
**live documents** to the duplicate-authority check. Fixed `980c97c00` by widening the prefix set.

**What this does NOT change, stated plainly: whether something is caught.** A superseded/live pair
where both copies claim authority is flagged either way. I checked this rather than assuming it —
the two branches are different code paths (one reports *"an archived copy and a live copy both claim"*,
the other *"both claim to be THE source of truth but their content differs"*).

**What it DOES change: the diagnosis, and therefore the remedy.** With the widening the tool reports
the archive/live case correctly, whose fix is *"mark the archive copy historical in its first lines"*.
Without it the same pair is reported as two live docs, whose fix reads *"one must be marked superseded
or deleted"* — which is wrong advice for a file that is *meant* to sit beside the live one. Modest,
but it is the difference between a message that names the problem and one that does not.

**Also honest about how it was verified, because the first two attempts were worthless:**
1. Creating two untracked probe files proved nothing — `scan()` iterates `tracked_files()`, which
   is `git ls-files`; untracked files are invisible to it. And `git add` on a shared checkout is
   barred by §7.3.
2. The second attempt declared a probe path and then never created the file, so it hit *"unreadable
   duplicate"* — which the harness filtered out, producing a clean-looking **false negative**.
3. What worked: import the real module, monkeypatch `tracked_files()` to return real on-disk paths,
   and read the branch that fires. **A self-test that cannot fail is not a self-test** — the second
   attempt could not have failed, and would have "passed" while proving the opposite.

### 6e — §6a reconciled against what actually happened: the list over-claimed, and missed the worst one

§6a was written in round 3 as a *static* prediction — "these ~15 script files must change". Measured
against the nine commits that carried the tooling work, the record is:

| | Count |
|---|---:|
| §6a script files predicted to need changing | 15 |
| …that actually needed changing | **8** |
| …that needed nothing | 8 |
| **Tooling files that DID need changing and were NOT in §6a** | **2** |

The 8 that needed nothing were harmless: `gen-summary.py`, `test-records-index-escaping.sh`,
`check.sh`, `gates.json`, `verify-doc-uniqueness.py`, `check-mapper-alignment.py`,
`find-oldest-md.sh`, `profile.ps1`. B0 is why — settling the target directory at
`docs/records/` meant the generator's *output path* never moved, and with it the single largest
item on the list evaporated without an edit.

**The two §6a missed are the two that mattered, and one of them is the most consequential find in
this plan:**

- **`.github/workflows/dev-ci.yml`** — the release-readiness route bucket keyed on
  `^docs/releases/`, so editing any moved release document would have **stopped triggering the
  release job**. A static scan of *scripts* never looked at CI, and §6 — written before the moves —
  listed workflows only as *"add a gates.json record and a ci-pipeline row"*, never as *"this pattern
  will match nothing"*.
- **`scripts/verify-root-policy.py`** — named this very plan doc as a stray root file.

**What this says about a predicted blast radius.** §6a was right about *breadth* being the risk and
wrong in **both directions**: it named 8 files that were fine and missed 2 that were not, one of them
load-bearing for a CI gate. A list derived from reading scripts is a hypothesis about scripts. The
three breaks that mattered — `dev-ci.yml`, `release.sh`, `verify-runner-claims.py` — were all
found by *asking what breaks* after each move, never by the list. **Keep the list as a checklist of
where to look; do not treat it as the set of places that are broken.**

### 6b — Confirmed incidental, no change

- [x] `scripts/build-docs.sh` (8) and `scripts/build-docs.ps1` (8) — **D1 said "must not
      change" and this plan CHANGED them, correctly.** D1 protects `docs/src/` from being *moved*; it
      does not exempt a **consumer** that must be **repointed**. Both had a functional break
      (`docs/releases/*.md` copy) — fixed in `d00c08653`, proved by *executing* the copy and counting
      the 10 files that now land. This is the clearest case in the plan of a guardrail that reads
      absolute and is not.
- [x] `docs/book.toml` — **0 hits.** D1; the mdBook config never moved.
- [x] `ui/package.json` — **0 hits.** `typedoc --out ../docs/src/api/ts` points *into* `docs/src/`
      (D1), which is not a moving directory. The original "1 hit" was this plan's own pattern
      matching a path it was never going to move.
- [x] `crates/kasirmu-api/Cargo.toml` — **repointed.** Its single hit was a **provenance comment**
      citing a doc that moved; now `docs/records/audits/2026-08-15-unify-auth-and-sync.md`.
- [x] `website/public/robots.txt` — **0 hits** for the moving directories. Its stale comment (a
      citation of a `seo-robots-llms-review` path that never resolved) is **not** a published URL and
      not a link, so nothing in the served site depends on it. Left alone deliberately: editing
      content that is served verbatim, to tidy a citation, is not a trade worth making unasked.
- [x] **The "1-hit scripts" list — confirmed individually, and the list itself was wrong.** All
      eleven measured: `apply-fluent-patch.py`, `verify-bundle-parity.py`,
      `scan-locale-crossings.py`, `scan-fluent-hardcoded.py`, `verify-ipc-parity.py`,
      `verify-scoped-coverage.sh`, `verify-ftl-orphans.py`, `verify-scoped-reads.py`,
      `verify-fluent-dynamic-families.py` — **nine of eleven have ZERO hits** and never held a
      moving-directory reference. The two that do (`test-runner-labels.py`, `translate-stub.py`) are a
      test-scenario string and a docstring citation, both prose.
      **Honest total for the whole list: 2 prose mentions, 0 functional references.** A plan section
      that names eleven files for individual confirmation when nine have nothing to confirm is its own
      kind of drift. The original "1 hit each" came from a broader round-1 pattern that also matched
      `docs/src/`.

## 7. Per-file verification protocol

**Per file, every time.** This is the core of the plan — no file moves without all six.

1. `git --no-optional-locks status --porcelain -- <src>` → **empty**. Dirty means another session owns it; stop.
2. Scan for inbound links: `\]\([^)]*<basename>\)` and bare `docs/…/<basename>`. Record every hit.
3. `git mv -- <src> <dst>`
4. `git hash-object <dst>` **== the hash captured in step 1**. Proves I1 — bytes unchanged.
5. `git show --stat HEAD` shows `rename <src> => <dst> (100%)`.
6. `git diff --cached --name-only` → **empty** (I4 — never leave anything staged, not even your own).

**Per batch, after the last file.**

7. `python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py --self-test` → **OK** (I2 — run this
   *first*; it is 41 cases and takes seconds)
8. `python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py` → **0 unresolved**
9. `python3 .agents/skills/docs-auditor/scripts/check-orphans.py` → **exit 0**
10. `node scripts/generate-records-index.mjs --check` → **exit 0** (I3)
11. `git show --stat HEAD` → the file list is **exactly** the batch's, nothing else

**Hand-fixes required (7 links, 6 files)** — measured, not exhaustive-to-completion.
**All six done**, proven rather than asserted: `check-dead-refs.py` reports **0 unresolved references
across 13 live docs** and has done so since B2. Counts below are what the *original* blast radius
predicted, not what was needed — the two launch-test guides carried **3** occurrences each, not 2.

- [x] `docs/guides/platform/windows-launch-test.md` (3) — fixed in `afca83144`
- [x] `docs/guides/platform/linux-launch-test.md` (3) — fixed in `afca83144`
- [x] `docs/decisions/README.md` (1) — fixed in `a0c4f7b90`
- [x] `docs/decisions/2026-09-11-adr49-headless-command-bridge.md` (1) — fixed in `2a9b73e22`
- [x] `docs/decisions/2026-09-11-adr51-sealed-settings-ingest-policy.md` (1) — the link was already
      valid; B3 left it alone, correctly
- [x] ~~`docs/archived/2026-08-30-glm-5.3-tauri-app-review.md`~~ (1) — moved to
      `records/audits/` in B1 and repointed twice since (B1 depth, B3 findings path)
- [x] `docs/decisions/2026-09-11-adr51-sealed-settings-ingest-policy.md` — **never needed a fix.**
      Its link pointed at a file that did not move; B3 left it alone, correctly. Closed as a *correct
      decision*, not as a task performed.
- [x] ~~`docs/archived/2026-08-30-glm-5.3-tauri-app-review.md`~~ — **the path in this list no longer
      exists.** The file is `docs/records/audits/2026-08-30-glm-5.3-tauri-app-review.md` (B1) and has
      been repointed twice since: once for depth in B1, once for the findings path in B3.

The other 30 breaking links are in `docs/records/README.md` and are **regenerated, not fixed**.

## 8. Acceptance

The command that must be RUN and PASSED before this file may be renamed `done-todo-docs-restructure.md`:

```powershell
$py = (Get-Command python3 -ErrorAction SilentlyContinue) ? 'python3' : 'python'
& $py .agents/skills/docs-auditor/scripts/check-dead-refs.py --self-test; if ($LASTEXITCODE) { exit 1 }
& $py .agents/skills/docs-auditor/scripts/check-dead-refs.py;              if ($LASTEXITCODE) { exit 1 }
& $py .agents/skills/docs-auditor/scripts/check-orphans.py;                 if ($LASTEXITCODE) { exit 1 }
& $py .agents/skills/docs-auditor/scripts/check-adr-status.py;              if ($LASTEXITCODE) { exit 1 }
node scripts/generate-records-index.mjs --check;                           if ($LASTEXITCODE) { exit 1 }
& 'C:\Program Files\Git\bin\bash.exe' -c 'bash scripts/check.sh';          if ($LASTEXITCODE) { exit 1 }
```

`bash scripts/check.sh` must go through Git's bash by full path (AGENTS.md §5) — bare `bash` resolves
to WSL and hangs. *(That line was itself wrong until 2026-10-02: the path had been written
without its backslashes, so the acceptance command **as printed could not have run at all** — the
`b` in `bin` and `bash` had become literal backspace bytes. Found only because the run below
was attempted. Fixed first, then run.)*

### 8a — RUN 2026-10-02: **5 of 6 pass. The 6th fails on findings that are not this plan's.**

| # | Step | Result |
|---|---|---|
| 1 | `check-dead-refs.py --self-test` | **PASS** — 41 cases |
| 2 | `check-dead-refs.py` | **PASS** — 0 unresolved across 13 live docs |
| 3 | `check-orphans.py` | **PASS after `fddbf72de`** (was FAIL) |
| 4 | `check-adr-status.py` | **PASS** — 0 drift across 59 rows |
| 5 | `generate-records-index.mjs --check` | **PASS** — 102 records |
| 6 | `scripts/check.sh` | FAIL — exit 1, aborts at step 01 in 1.3s |

**Step 3 — one cause was mine to clear, and I did: `fddbf72de`.** It had two parts:
- **3 pre-existing findings** in `plan-c1-install-key-s2b-s2c.md` (h2→h4 skips at :167, :193, :237).
  Triaged per the skill's own rule — *judge before fixing* — and they were genuine, not intentional
  appendices: each `####` had a **bold paragraph** for a parent rather than a real heading, so the
  file had exactly three h4s and all three were orphans. Promoted them to `###` — the skill's
  first-listed remedy — for a **3-line diff in a file clean for three days**. `check-orphans.py
  --file` now exits **0**. I had written them off last round as "another session's file"; that was
  the wrong call, because the rule §7.4 actually protects *renaming or moving* an uncommitted plan
  file, not a committed and clean one.
- **3 scan errors** for `docs/decisions/2026-10-04-adr63-event-sink-seam.md` — a tracked file another
  session deleted and has still not committed. **These are reported but do not fail the run**; the
  exit 1 came entirely from the three findings above. So step 3 now passes *despite* them.

**Step 6 — investigated, and NOT a bug. `verify-root-policy.py` is working as designed.**
It sweeps gitignored files on purpose; its own header distinguishes the two cases — *"gitignored:
`git status` stays clean, so nothing ever prompts a look"* — and it ships a `gitignored_dirs()`
helper plus an explicit `.env` exemption. So `kasir.db`, `ser.txt` and `kasir.pre-migration.bak`
counting as root junk is the **intended** behaviour: the policy governs the working tree, not only
the committed tree. **I nearly "fixed" this and was wrong to** — the gate was correct and the files
are genuinely clutter on someone's machine. Not mine to delete, and not mine to allowlist:
allowlisting scratch would make a gate permanently approve of junk.

**Step 6 aborts at step 01, `verify-root-policy.py`: 7 stray root files.** One of the original eight
**was mine** — `todo-docs-restructure.md` itself. That allowlist is **names-not-patterns** (*"adding
one is a decision"*) and already carries nine plan docs, so the correct fix was to name this one
beside them: **`0aa3528ca`, 8 findings to 7.** The seven left are `todo-android-updater.md`
and `todo-beta-testing-january-2027.md` (pre-existing root plan docs), plus `SENTINEL_STASH.txt`,
`ser.txt`, `kasir.db` and `kasir.pre-migration.bak` (another session's scratch and local
artifacts). **Those belong deleted or gitignored, not allowlisted** — allowlisting scratch would
make a gate permanently approve of junk.

**Correction, 2026-10-02:** the seventh entry was `README-3.md`, and this plan twice called it *"a
duplicate of README.md"* without ever comparing the two. **It is not a duplicate.** `README.md` is
the investor-facing product overview; `README-3.md` was the **developer-facing technical README**,
and it is the **only** document in the repository carrying a Technology Stack table or a repo-root
Repository Structure tree. Worse, it had **zero inbound links** — an actively-maintained
(measured 2026-09-29) document, unreachable, under a merge-conflict name (`README-2` had been
deleted), flagged by the root policy. Renamed to **`README-technical.md`** and cross-linked from
`README.md` (`c6b06dbae`, 100% rename, 4 links repointed). **Lesson: I asserted a duplicate
relationship twice without measuring it — the same error this plan has repeatedly corrected
elsewhere.**

**So this file stays `todo-docs-restructure.md`.** §7.4: `done-` is earned only when the acceptance
command is RUN **and PASSED**. It ran, and it did not pass. What blocks it is a pre-existing heading
structure, a concurrent session's uncommitted deletion, and five root files that are not a docs
problem at all.

## 9. Out of scope — rejected on purpose

- **No topic reorganisation.** The tree is already organised by function ([docs/README.md:6](docs/README.md:6)).
  Re-cutting it by subject would churn all 292 files, break the most links, and buy nothing §1.2 does not
  already give.
- **No move of the 8 live `todo-*`/`plan-*` docs at the repo root.** AGENTS.md §7.4 says plan renames
  happen in place at the root; `docs/plans/_active/` is the other half of that question and it is the
  owner's call. **See §10.**
- **No move of `manager-codebase-review{,-checklist,-decisions}.md`.** The stamps on
  [docs/archived/manager-2-journal.md](docs/archived/manager-2-journal.md) record that two agents both
  signed "Manager-2" and split files between them, with an explicit *never merge, rename or tidy these
  together*. That hazard annotation is honoured.
- **No renumbering of ADRs or specs.** See §4 A3: the ADR #43 duplicate is already documented in
  `docs/decisions/README.md` and already handled by `check-adr-status.py`, which resolves rows by file
  path; the spec-number overlap carries 134 references including 18 in `CHANGELOG.md`. Both are
  recorded rather than renumbered, because a published identifier is not ours to renumber.

## 10. Open questions for the owner

1. **Do the 8 live root `todo-*`/`plan-*` docs also move to `docs/plans/_active/`?** This decides
   whether AGENTS.md §7.4's "renames happen in place at the repo root" survives or is rewritten. Blocking
   for nothing in Phase A or B; it is the same two-homes problem this plan's §1.2 addresses elsewhere.
2. **Confirm `docs/audits/` is a record folder, not a live one.** Phase B2 moves all 14 files. The
   alternative is that audits stay a claim surface and only `archived/` folds into `records/` — which is
   a materially smaller plan.
3. **`docs/coverage/` and `docs/src/`** — both settled 2026-10-02: `docs/coverage/` moved to
   `records/benchmarks/coverage-report-2026-07-20.md` (`82186f28e`), and `docs/src/` is generated
   (D1, leave it).
4. **Two allowlist edits in `scripts/verify-root-policy.py`, outstanding:**
   - **add `README-technical.md`** — renamed from `README-3.md` on 2026-10-02 (`c6b06dbae`). It is a
     legitimate root human-entry file; without the entry the root-policy gate keeps flagging it.
   - **remove `README-2.md`** — that file was deleted long ago and the entry is stale. I found it in
     the stale-allowlist sweep and left it as "not mine"; it is now confirmed dead.
   **Not done because that file had another session's uncommitted changes at the time**, and
   AGENTS.md §7.3 forbids editing a path dirty with someone else's content — a pathspec commit takes
   the working-tree copy and would have swept their work into mine.

## 11. Incident — a concurrent session switched branches mid-plan

Recorded because it changes what "done" means here, and because **AGENTS.md §7.1 forbids switching
branches.** I did not switch; another session did.

```
05dcb632b HEAD@{0}  docs(records): split engineering journal   <- on 0.0.41, SAFE
6b0548f38 HEAD@{1}  checkout: moving from 0.0.40 to 0.0.41     <- ANOTHER SESSION
5cf046caa HEAD@{2}  docs(plans): add restructuring plan        <- stranded on 0.0.40
044cba1ec HEAD@{6}  docs(plans): archive 14 done-* docs        <- stranded on 0.0.40
```

- **~~Not in this branch's history~~ — REDONE ON `0.0.41`, `0ebaf1d31`.** The 15 `done-*.md`
  are now in `docs/plans/_done/` (16 files there). All **15 byte-identical**, all **15 `100%` renames**
  in one commit, nothing left staged. **2 links fixed:** `README-3.md:169` and its `:165` tree comment,
  and `docs/records/superseded/reporting-facade-inventory.md:214`. `done-todo-rebrand.md`'s sibling
  link to `done-todo-rebrand-2.md` needed nothing — both moved together. `check-dead-refs.py`:
  **0 unresolved**, self-test run first.
  **Why it was deferred and then done.** §10 Q1 (do live plan docs belong at the root?) was unanswered,
  so redoing it unilaterally was the wrong call *at the time*. The owner then asked for it directly,
  which is a different act entirely: §7.4 bars moving **another session's uncommitted** plan file,
  and all 15 were committed and clean. **Asking is not stalling** — the first pass declined on the
  merits; the second was an instruction.
  The set grew from 14 to 15 while this plan was paused: another session renamed
  `todo-modular-scaffolding.md` → `done-todo-modular-scaffolding.md`.
- **Safe on this branch:** the journal split `05dcb632b`. Its baseline was verified rather than
  assumed — `0.0.41`'s `JOURNAL.md` is **byte-identical** to `0.0.40`'s (13,433 lines each), so the
  split preserved the correct source and the index's line map is valid here.
- **This branch is `0.0.41`, not the `0.0.40` the plan was authored against. No version number was
  edited by this work** — the bump belongs to the concurrent session.
- **Another session currently has uncommitted work** in `modules/inventory/src/repository{,_tests}.rs`,
  `scripts/bump-version.ps1`, `ui/src/app/tablet/tablet.css`. Do not sweep these into a docs commit.
- **Standing rule adopted:** if the branch moves mid-plan, re-verify the reachability of the plan's own
  commits before continuing, and **never switch branches to recover them** (§7.1).

---

> Phase A is independent, reversible, and pays for itself. **A1 is done; A1b is deferred with
> reasons; A2 is next.**
