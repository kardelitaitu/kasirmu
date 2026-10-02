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
- [ ] **I6** No doc loses its `todo-`/`plan-`/`prd-`/`done-` token. `check-dead-refs.py` keys its
      exemption off the filename, and `verify-debt-markers.py` enforces it.

## 3. DO NOT TOUCH

- [ ] **D1** `docs/src/` + `docs/book.toml` + `scripts/build-docs.sh` / `.ps1` — **17 tooling hits.**
      `docs/src/` is a **generated** directory (`ui/package.json` runs `typedoc --out ../docs/src/api/ts`)
      and the mdBook portal's source. [docs/README.md:114-118](docs/README.md:114) records that the
      mdBook config was archived once and then **restored**; this has already been got wrong.
- [ ] **D2** `docs/archived/manager-2-journal.md` and `manager-2-journal-posscreen.md` — move to
      `records/campaigns/` **together and separately**. Their own stamps: *"NEVER write the sibling's
      file"*, *"must not merge, rename or 'tidy' the two files together"*. Two agents both signed
      "Manager-2" and split the work between them. **Do not batch these with anything.**
- [ ] **D3** `.agents/skills/**` — that is `skill-drift-guard`'s scope, not this plan's.
- [ ] **D4** `docs/records/README.md` — **generated, never hand-edited.** Its new home is decided by the
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

- [ ] `docs/coverage/README.md` (1 file, 66 lines) — **deferred to Phase B.** A *generated* report
      (*"Generated: 2026-07-20"*) carrying a `dead-ref-prefix-ok` pragma, cited by 2 other docs. A5
      says "fold into `record/`" — but that directory does not exist until Phase B (and B0 later
  renamed the target to `records/`), so this is a
      **sequencing bug in this plan**, not a judgement call. Folds in at B4.

- [ ] `docs/audit-receipt-settings.md` (1 file, 80 lines) — **deferred to Phase B.** A real audit
      report (a BLOCKER finding, 9 KB) sitting loose at the `docs/` root with **zero inbound
      references** — it should have been in `docs/audits/` all along. That is a B2 move.

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

### B3 — the remaining `docs/records/` files (6 files) · **much cheaper after B0**

- [ ] `audit-open-findings.md`, `audit-closed-findings.md` → `records/findings/`
- [ ] `snapshots/` (8) → `records/snapshots/`: `2026-09-12-sync-settings-ingest-and-redirect-census.md`,
      `2026-09-13-adr51-admitted-set-and-blind-sides.md`, `2026-09-15-frontend-architecture-todo-appraisal.md`,
      `2026-09-20-audit-android-shell.md`, `2026-09-21-license-ratelimit-collapse.md`,
      `2026-09-21-migration-init-drift-bricked-startup.md`, `2026-09-21-tablet-ui-driving-method.md`,
      `2026-09-28-rustfmt-gate-red.md`
- [ ] `sqlite-pg-roles.md`, `statutory-rounding-and-estimate-stamps.md`, `adr7-conditional-scoping-fallback-class.md`
      → **stay at `records/`** — already the record home, no move needed
- [x] ~~`README.md` → the generator's output path changes; it is never `git mv`d~~ — **retired by B0**.
      The output path no longer moves, so **D4 is satisfied by doing nothing**, and the largest item
      in §6 (`generate-records-index.mjs`, 31 hardcoded hits) needs **no edit at all** — only its scan
      list grows by the new subfolders, which it already walks recursively.
- [ ] **`JOURNAL.md` + the 8 parts move as ONE set** (split 2026-10-02, §4 A1) → `records/journal/`.
      The parts are only useful next to their index; the index's line map is useless without them.
- [ ] Depths are unchanged, so `../decisions/…` and `../../scripts/…` inside the generated index keep
      resolving. Only `../audits/…` and `../archived/…` need regenerating — which the generator does.

### B4 — remaining splits

- [ ] `docs/security/` (9 of 12) → `records/audits/security/`: `audit-2026-07-20.md`,
      `audit-admin-login-flow.md`, `audit-login-flow-final.md`, `hardening-2026-07-20.md`,
      `license-audit-2026-07-20.md`, `lua-sandbox-audit.md`, `review-admin-dashboard-long-term.md`,
      `sast-2026-07-20.md`, `security-audit-completion.md`
      — **stays live (3):** `INCIDENT_RESPONSE.md`, `PCI-DSS_CHECKLIST.md`, `data-residency-and-retention.md`
- [ ] `docs/observability/` (2) → `records/audits/observability/`: `error-handling-2026-07-20.md`, `logging-2026-07-20.md`
- [ ] `docs/benchmarks/` (4) → `records/benchmarks/`
- [ ] `docs/releases/` (10) → `records/releases/`
- [ ] `docs/architecture/` (11 of 17) → `records/superseded/`: `MODULAR_APP_PLAN.md`, `handler-census-phase0.md`,
      `namespaced-store-api-draft.md`, `phase1-implementation-tickets.md` … `phase5-implementation-tickets.md`,
      `reporting-facade-inventory.md`, `workspace-editor-implementation.md`, `workspace-instance-analysis.md`
      — **stays live (6):** `ARCHITECTURE.md`, `CRITICAL_PATH_INVARIANTS.md`, `UX_GUIDELINES.md`,
      `module-boot-sequence.md`, `module-namespace-firewall.md`, `module-namespace-governance.md`

## 6. Tooling checklist

31 files carry a hardcoded `docs/<dir>/`. **Each must be confirmed individually** — the measurement
below used one combined pattern, so the per-file hit count is not yet attributed to a specific directory.

### 6a — Must change (confirmed load-bearing)

- [ ] `scripts/generate-records-index.mjs` — **31 hits**, a third of all tooling risk. Directory list,
      `AREA_KEYWORDS`, and the **output path** (D4).
- [ ] `scripts/gen-summary.py` — 10
- [ ] `scripts/test-records-index-escaping.sh` — 6 · **guards the generator; not in the §9 tools table**
- [ ] `scripts/verify-debt-markers.py` — 5 · **this is what enforces the §7.4 plan-token rule**
- [ ] `scripts/check.sh` — 4
- [ ] `scripts/gates.json` — 4
- [ ] `scripts/verify-doc-uniqueness.py` — 4
- [ ] `scripts/verify-ci-docs-drift.py` — 3
- [ ] `scripts/__tests__/verify-ci-docs-drift.test.mjs` — 2 · **guards the guard**
- [ ] `scripts/check-mapper-alignment.py` — 2 · `scripts/find-oldest-md.sh` — 2
- [ ] `scripts/profile.ps1` — 2 · `scripts/test-ci-routing.sh` — 2 · `scripts/release.sh` — 2
- [ ] `scripts/bump-version.ps1` — 1
- [ ] `.agents/skills/docs-auditor/SKILL.md` — names `docs/audits/frontend/css-verification.md`,
      `docs/operations/agent-gates.md`, `docs/records/sqlite-pg-roles.md`
- [ ] **AGENTS.md §5.1** — names `docs/audits/frontend/css-verification.md`
- [ ] `docs/README.md` — the curated directory table (9 hits)

### 6b — Confirmed incidental, no change

- [ ] `scripts/build-docs.sh` (8) and `scripts/build-docs.ps1` (8) — **D1, mdBook, must not change**
- [ ] `docs/book.toml` (1) — **D1**
- [ ] `ui/package.json` (1) — `typedoc --out ../docs/src/api/ts`. Points *into*`docs/src/` (D1), not a moving dir.
- [ ] `crates/kasirmu-api/Cargo.toml` (1) — a **provenance comment**, not metadata. Goes stale; harmless.
- [ ] `website/public/robots.txt` (1) — a **comment**, and already stale: it cites
      `docs/records/seo-robots-llms-review-19-09-26.md`, which does not exist (the file is at
      `docs/audits/seo/…`). **No published URL is at risk.** Fix opportunistically.
- [ ] 1-hit scripts to confirm individually: `apply-fluent-patch.py`, `verify-bundle-parity.py`,
      `scan-locale-crossings.py`, `scan-fluent-hardcoded.py`, `test-runner-labels.py`,
      `translate-stub.py`, `verify-ipc-parity.py`, `verify-scoped-coverage.sh`, `verify-ftl-orphans.py`,
      `verify-scoped-reads.py`, `verify-fluent-dynamic-families.py`

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

**Hand-fixes required (7 links, 6 files)** — measured, not exhaustive-to-completion:

- [ ] `docs/guides/platform/windows-launch-test.md` (2)
- [ ] `docs/guides/platform/linux-launch-test.md` (2)
- [ ] `docs/decisions/README.md` (1)
- [ ] `docs/decisions/2026-09-11-adr49-headless-command-bridge.md` (1)
- [ ] `docs/decisions/2026-09-11-adr51-sealed-settings-ingest-policy.md` (1)
- [ ] `docs/archived/2026-08-30-glm-5.3-tauri-app-review.md` (1)

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
& 'C:Program FilesGitinash.exe' -c 'bash scripts/check.sh';          if ($LASTEXITCODE) { exit 1 }
```

`bash scripts/check.sh` must go through Git's bash by full path (AGENTS.md §5) — bare `bash` resolves
to WSL and hangs.

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
3. **`docs/coverage/` and `docs/src/`** — `docs/src/` is settled (D1, generated, leave it). `coverage/`
   is one generated report; delete or move.

## 11. Incident — a concurrent session switched branches mid-plan

Recorded because it changes what "done" means here, and because **AGENTS.md §7.1 forbids switching
branches.** I did not switch; another session did.

```
05dcb632b HEAD@{0}  docs(records): split engineering journal   <- on 0.0.41, SAFE
6b0548f38 HEAD@{1}  checkout: moving from 0.0.40 to 0.0.41     <- ANOTHER SESSION
5cf046caa HEAD@{2}  docs(plans): add restructuring plan        <- stranded on 0.0.40
044cba1ec HEAD@{6}  docs(plans): archive 14 done-* docs        <- stranded on 0.0.40
```

- **Not in this branch's history, recoverable on `0.0.40`** (both verified ancestors of `0.0.40`,
  objects intact): the 14 `done-*.md` → `docs/plans/_done/` move, and the original copy of this plan.
  On `0.0.41` the 14 files are **back at the repo root** and `docs/plans/_done/` holds 1 file.
  **Not re-applied unilaterally** — §10 Q1 is unanswered, and redoing a move the owner may resolve
  differently is not a call this plan should make alone. Flagged for the owner instead.
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
