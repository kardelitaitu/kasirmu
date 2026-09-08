---
name: docs-auditor
description: Documentation-code audit and sync — keep technical docs accurate, traceable, and minimal with truth-anchor cross-referencing, drift classification, and repair rules. Use when auditing a doc (README, ARCHITECTURE.md, api-reference, spec, admin guide) against the current codebase, verifying that what a document claims still holds, or stamping a document as audited.
---

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE (rev 8 · .agents/skills/docs-auditor/scripts/check-orphans.py went red on a file that is not in the repository - an h2-to-h4 heading skip inside references/midtrans-nodejs-client/README.md, zero tracked entries, gitignored, a vendored third-party README. Its scanner now prefers git ls-files and falls back to the old directory walk only when git cannot be consulted, so the degraded mode is "scan more", never "scan nothing". Scope rule and caution are written into §Check table. 328 markdown files scanned became 321. Verified the narrowing did not disable the check by aiming --file at that same doc, which still reports the skip and exits 1 - my first attempt at that proof was worthless and nearly read as a broken tool: I appended a level-4 heading to a tracked guide whose nearest lower heading already included a level 3, which is legal, so the probe could only ever have found nothing. A self-test that cannot fail is not a self-test. · rev 7 · .agents/skills/docs-auditor/scripts/check-dead-refs.py burned to a clean exit the same day it was added: 62 files on the first sweep to 0 live findings across 332 docs, using git-ignore awareness (one batched git check-ignore decides, so .gitignore is the policy source and not my extension list) plus two pragma forms. The distinction it buys is the useful one: a gitignored missing path is absent by design, a NON-ignored missing path means something was never committed - which is how the gap in the iOS guides was found rather than asserted. Five silent bugs caught by self-testing it: a literal dot inside a placeholder character class (blind to every file), str.lstrip("./") eating leading dots, double-reporting from two regexes, capture_output piped stdio blocked in this sandbox, and a TemporaryFile read without seek(0). The last four all failed by returning nothing, i.e. by looking clean. )>

# Skill: docs-auditor

# Documentation-Code Audit & Sync (DCAS)

## 1. Objective

Keep technical documentation accurate, traceable, and minimal. Prefer verified facts over assumptions. A document is a **claim about the code** — when the code changes and the doc doesn't, the doc becomes a lie that future agents and humans read, then propagate.

This skill audits **any project document** (`README.md`, `ARCHITECTURE.md`, `docs/guides/api-reference.md`, `docs/guides/QUICKSTART.md`, spec files, admin guides, crate/app/module READMEs) against the **current codebase**. It is the sibling of `skill-drift-guard`, which audits the `.agents/skills/*/SKILL.md` files only — this skill covers everything else.

## 2. Trigger Conditions

- User requests a doc audit, sync, or integrity review.
- Code changes affect public APIs, config, schemas, or runtime flow.
- A refactor may have changed documented behavior.
- A skill-drift-guard run detected a path/type change referenced in a doc.
- Before stamping any document with `> last audited` (the footer convention enforced by `skill-drift-guard` Check 10).

## 3. Source of Truth

- Implemented behavior comes from **code**.
- Intended behavior comes from an approved spec or decision record.
- If both exist and conflict, follow the more specific approved source.
- If the source of truth is unclear, pause and ask the user.
- Do not invent missing behavior.

### Approved spec locations (by priority) — actual repo layout

1. `docs/specs/_active/` — in-progress specs (highest authority among specs)
2. `docs/specs/` root — standalone spec files and audit plans/reports
3. `docs/decisions/` — decision records (ADRs)
4. `docs/` root — reference docs (ARCHITECTURE.md, api-reference.md, admin-guide.md, user-guide.md, QUICKSTART.md, WHITEPAPER.md, ROADMAP.md)
5. `CONTRIBUTING.md` + `AGENTS.md` — conventions and golden rules

> **Note:** an `_approved/` folder under `docs/specs`, and an `adr/` folder, do NOT exist in this repo (agent templates sometimes invent them). Do not reference them; specs live in `docs/specs/` and `docs/specs/_active/`, decisions in `docs/decisions/`.

## 4. Audit Modes

### Shallow Audit
- Check only **file existence**: do referenced files, modules, functions still exist?
- Verify **headline claims**: does the doc say feature X exists? Does `cargo check` pass?
- **Structural orphan pass** (automatic): run `python3 .agents/skills/docs-auditor/scripts/check-orphans.py` — flags unversioned/orphan wrapper labels, `####` items without their `###` parent, and version headers stale against their own section body (§4b).
- **IPC surface reconciliation** (when the doc under audit is
  `docs/guides/api-reference.md`): run
  `python3 .agents/skills/docs-auditor/scripts/check-api-surface.py`. It parses
  `generate_handler!` in both clients, every `#[command]` fn under `src/`, and the entry
  lines of the page, then reports four separate drift classes — wrong availability marker,
  listed but never registered, listed and not defined anywhere, registered but
  undocumented. Reporting them separately is the point: a single "the numbers disagree"
  count hides that three of the four need different fixes.
- **Unresolved path references** (any doc): run
  `python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py`. It indexes the tree
  once (pruned) and reports path literals in markdown that resolve to nothing,
  separating live docs from dated records, plans and active specs — which are not drift,
  because a plan names files it intends to create. Burned down to **0 unresolved refs
  across 332 live docs (exit 0)** the same day, from 62 files on the first ad-hoc sweep.
  Two mechanisms did the work, and both decide from the repo's own rules rather than a
  hardcoded list:
  * **git-ignore awareness.** Unresolved candidates go through one batched
    `git check-ignore`. A gitignored path is ABSENT BY DESIGN (`*.pem`, `*.keystore`,
    Gradle build output) and is dropped; a non-ignored missing path is the real signal -
    a doc pointing at something that should have been committed. That distinction is what
    found the iOS gap below.
  * **Two pragma forms.** Inline: `<!-- dead-ref: ok: reason -->` on the line or the line
    above, for a reference that is deliberately wrong (an example commit subject, or the
    generic placeholder script name AGENTS.md uses in its own WSL warning - which is also
    the fourth time in this session that spelling a `scripts/`-relative example in prose
    tripped `detect.sh`, including three times inside the text warning about it).
    File-scoped: `<!-- dead-ref-prefix-ok: some/prefix/ -->`
    near the top, for a page whose whole subject is generated output. Scoped to a prefix
    so the rest of the page is still checked, and grep-able.
  An annotation in a `>` note block within 4 lines BELOW a claim also suppresses it,
  because that is how auditors write: the claim, then the caveat underneath.
  `--verbose` for every hit; `--include-bare` to also test bare filenames (noisy:
  `publish latest.json` names an artifact, not a repo path); `--include-historical` to
  see what is skipped and why.
  **Not wired into CI**, deliberately, though it is now green and could be: adding a
  `static-gates` step without a `gates.json` record and a `docs/operations/ci-pipeline.md`
  row is precisely the three-part omission this session's audit kept finding - a gate the
  drift checker cannot see because the checker never learned it exists. Wiring it up
  needs all three changed together, which is a CI change rather than a doc repair.
  ⚠️ **Give it a self-test before trusting a clean run.** Building it this session, the
  tool reported *zero* unresolved references across 333 docs while its placeholder
  character class contained a bare `.`, so every path with an extension was being
  skipped as a placeholder. A deliberately-broken test file caught it: two injected dead
  paths, a glob, a placeholder, a negative-context line. If you write a checker and its
  first result is clean, feed it something you know is broken.
  ⚠️ **Name every script by its full path, including inside a stamp or a sentence.**
  `detect.sh` Check 1 re-anchors a token on its `scripts/…` segment rather than using the
  whole path it was given, so writing the short form of this skill's own scripts
  (`check-audit-stamps.py`, `check-dead-refs.py`, `check-orphans.py`) in prose fails the
  gate even though each file exists under `.agents/skills/docs-auditor/scripts/`. This bit
  the author of this bullet three times in one session — the third was this very
  sentence, which reached for the short form as its own example of the trap and tripped
  it. That is why the names above are spelled without the prefix.
  A `CODE FINDING` for detect.sh: it should take the longest path-looking run on the
  line, not the last `scripts/` segment it finds.
- Duration: ~1-2 minutes. No per-line cross-reference.

### Full Audit
- Every truth anchor is cross-referenced against code.
- CLI signatures, struct fields, config keys, env vars, error variants.
- Runtime flows are traced end-to-end where possible.
- Duration: 5-15 minutes depending on doc size.

**Default is Full Audit.** User can request `--shallow` to skip deep verification.

## 4b. Shallow structural check (orphaned-content detector)

`.agents/skills/docs-auditor/scripts/check-orphans.py` automates the manual orphan-content hunt (the CHANGELOG P80–P251 "Unversioned backfill blocks" incident) into a reusable shallow-mode pass. It scans every `*.md` outside `.git`, `.agents`, `node_modules`, `target`, `dist`, and `graphify-out` (`.agents/skills` content is skill-drift-guard's scope) and reports three classes of structural drift:

| # | Check | Detects | Example |
|---|-------|---------|---------|
| A | Wrapper labels | `## Unversioned …` / `### Orphaned …` / `… backfill blocks` section headers — content parked under an unversioned bucket | `## Unversioned backfill blocks (P80–P251…)` |
| B | Heading orphans | `####`/`#####` items whose nearest lower heading is not their `###`/`####` parent; non-benign level skips (h2→h4, h3→h5) | `#### Re-audit instructions` directly under an `##` |
| C | Stale version headers | `##`/`###` header whose top cited version (`0.0.X`, or a range like `0.0.22 / 0.0.23`) trails its own section body's highest `0.0.Y` | `## 7. Prioritized 0.0.5 release-blocker order` with 0.0.22/0.0.23 closures in the body |
> **Scope: tracked files only.** The scanner asks `git ls-files` first, so vendored and
> gitignored markdown in the working tree is not policed. On 08-09-26 it reddened on an
> `h2 -> h4` heading skip inside `references/midtrans-nodejs-client/README.md` - a path
> with zero tracked entries, excluded by `.gitignore`. A docs gate that a directory
> nobody committed can fail is a gate people learn to ignore. Git unavailable, or the
> call fails, -> plain directory walk, so the failure mode is "scan more", never
> "scan nothing". Prove the check still fires with `--file <a doc you know is bad>`
> rather than trusting a clean tree run - a scope change is exactly the edit that can
> silence a gate while leaving it green.


### Usage

```bash
python3 .agents/skills/docs-auditor/scripts/check-orphans.py            # all checks, repo-wide
python3 .agents/skills/docs-auditor/scripts/check-orphans.py --check=b  # one check (a|b|c)
python3 .agents/skills/docs-auditor/scripts/check-orphans.py --file docs/guides/api-reference.md
python3 .agents/skills/docs-auditor/scripts/check-orphans.py --quiet    # findings only
```

Exit codes: `0` clean · `1` findings (triage before stamping) · `2` usage/scan error. Every finding prints `file:line` plus the offending heading, ready to paste into the §11 report.

### Triage rules

- **A — wrapper label**: real orphan wrappers re-parent like the CHANGELOG fix; git history is the evidence source for the original association. `backfill` alone (DB migrations) is NOT flagged — only section headers pairing it with a bucket noun (block/section/entries).
- **B — heading orphan**: usually cosmetic — demote/promote the heading or add the missing parent. Some are intentional appendices (an `####` under an `##`, like desktop-app-audit §10's re-audit instructions) — judge before "fixing".
- **C — stale version header**: update the header's version anchor (or drop the version from the header) to match the section's content — the CHANGELOG P-block re-parenting and the desktop-app-audit §7 refresh (`## 7. Prioritized release-blocker order (ALL RESOLVED — 0.0.22 / 0.0.23)`, 2026-08-08) are the done examples. A range citation like `0.0.22 / 0.0.23` is judged by its top version, so it stays clean while the section body is current.

False positives are possible in all three — this is a **detector**, not a verdict. Every hit is a candidate finding for §7/§11 triage; never auto-repair a hit without reading the surrounding section.

## 5. Golden rules

| # | Rule |
|---|------|
| 1 | The code is the source of truth. A doc that disagrees with code is wrong until proven otherwise. |
| 2 | Never invent missing behavior to make a doc pass — flag it `Ambiguous` and ask. |
| 3 | Record the exact doc location (heading + paragraph) and code location (file:line) for every finding. |
| 4 | Keep changes minimal — one drift = one edit where possible. |
| 5 | Patch the doc to match verified code state; flag code drift and **stop** — only patch code when the user explicitly asks. |
| 6 | Add the audit stamp only after verification completes and repairs are applied. Never stack stamps. |
| 7 | If a truth anchor belongs to another skill's domain, delegate to that skill (see §9) — do not duplicate verification. |

## 6. Truth Anchor Reference

| Doc Category | Truth Anchors To Extract |
|---|---|
| API reference | function names, params, return types, error variants, route paths |
| Config guide | env var names, config keys, default values, valid ranges |
| Schema docs | table names, column names, types, constraints, indexes |
| Flow / guide | step sequence, CLI flags, expected I/O, side effects |
| Architecture | module paths, crate names, trait/struct names, dependency direction |
| CLI help | subcommands, flags, arg count, exit codes |

For each anchor record the **exact doc location** (heading + paragraph) and the **code location** (file:line).

## 7. Classification with Severity

| Classification | Severity | Meaning |
|---|---|---|
| Match | — | Claim matches code exactly |
| Doc Drift (minor) | Low | Typo, outdated example, stale file path (still resolves) |
| Doc Drift (major) | High | Wrong API signature, wrong config key, feature removed |
| Code Drift | High | Code behaviour differs from approved spec intent |
| Ambiguous | Medium | Cannot verify — no spec, no code, or contradictory signals |

### Drift failure thresholds
- **Blocking**: ≥1 major doc drift or ≥1 code drift — report immediately, stop audit
- **Warning**: ≥3 minor drifts — report but continue
- **Pass**: All Match or ≤2 minor drifts

## 8. Pre-flight Checks

Before starting any verification:

1. Ensure the working tree is clean (`git status --porcelain`).
2. Ensure `cargo check` passes on the current HEAD.
3. If the doc has a `last audited` stamp, run `git diff <stamp-date> -- <doc-path>` to see what changed since then.
4. If #1 or #2 fail, abort and report the blocker.

## 9. Verification Tools (by priority)

| Tool | When |
|---|---|
| `cargo check` / `cargo check -p <crate>` | Verify public API surface compiles |
| `rg` (ripgrep) | Find function/struct/type definitions |
| `git log -S <symbol>` | Trace when a symbol changed |
| `git diff <stamp> -- <path>` | See changes since last audit |
| `cargo test -p <crate>` | Run tests for the affected crate |
| `npm run typecheck` (from `ui/`) | Verify TS/React claims in UI docs |
| `rg` over `ui/src/locales/*.ftl` | Verify Fluent IDs referenced by docs |
| `scripts/check.sh` | Full local validation mirroring CI |
| `python3 .agents/skills/docs-auditor/scripts/check-orphans.py` | Shallow-mode structural pass: unversioned wrappers, heading orphans, stale version headers (§4b) |
| `python3 .agents/skills/docs-auditor/scripts/check-audit-stamps.py` | Compare every stamp date against its footer date across all `*.md`; flags the under-reporting direction and impossible footer dates (`detect.sh` accepts `31-13-26` on shape). Exit 1 on drift. |
| `python3 .agents/skills/docs-auditor/scripts/check-api-surface.py` | Reconcile `docs/guides/api-reference.md` against both clients' `generate_handler!` registries; exit 1 on any of four drift classes (not wired into CI — the page is red against it by design) |
| `python3 .agents/skills/docs-auditor/scripts/check-nav-paths.py` | Reconcile every bolded **X → Y** nav path in `website/src/content/docs/{en,id}` against the nav registry |

> **`.agents/skills/docs-auditor/scripts/check-nav-paths.py`** exists because a wrong menu
> pointer is invisible to the other checks: every word in the path is real, and only their
> *containment* is false. `website/src/content/docs/en/user-roles.md` said **Settings →
> Staff**, but `ui/src/features/staff/register.tsx` registers that item with
> `section: 'tools'`, and `ui/src/features/settings/` contains no reference to the staff
> route at all. Two design rules came out of building it:
> * **Widen the model before blaming the doc.** Version one flagged
>   `**Settings → License**`, which is *correct* — License is a node at
>   `ui/src/features/settings/SettingsNavTree.tsx:92`, not a `registerNavItem` entry — and it
>   flagged all four Indonesian paths because it resolved labels from `shared.ftl` alone,
>   missing per-domain bundles such as `settings.id.ftl` (`settings-nav-license = Lisensi`).
>   Both were fixed in the checker and the docs were left alone: a nav checker that misfires
>   on legitimate children is worse than none, because the reader learns to ignore it.
> * **A self-test must not edit the tree.** The first `--self-test` mutated a tracked
>   customer doc to prove it could fail, then died on a Python error (a missing `%`,
>   reported as *`str` is not callable*) *between* that mutation and its restore — leaving a
>   page that had just been repaired broken again on disk, caught only because `git status`
>   was checked afterwards (`git checkout --` reverted it). `check_docs()` is now a pure
>   function over `(name, text)` pairs and the self-test feeds synthetic strings, so it
>   cannot damage what it polices.
>
> Two near-misses worth keeping, because both are the shallow-probe family this skill already
> warns about. A sweep that tested whether each of the repo's 116 stamps ends in `-->`
> reported five broken plus a SKILL.md tail reading `)>`; all six are healthy long
> multi-line stamps, and reading only line 1 of a wrapped comment invents corruption. And
> the same nesting cuts the other way: **this file's own stamp contains a literal
> `<!-- … -->` example**, so any parser closing at the first `-->` reads a truncated stamp —
> 6111 characters instead of the whole block. It costs nothing today only because the
> parseable fields (`date · auditor · status`) sit in the first ~150 characters. **Rule:
> keep machine-read fields before any literal comment example in a stamp**, since a stamp
> that documents pragma syntax is documented *by* that syntax.

Use fast local search and file reads first. Run the narrowest relevant validation step before stamping.

## 10. Cross-Skill Protocol

When a truth anchor belongs to a domain covered by another skill:

- **`rust-backend`** — for Money struct usage, transaction patterns, error types, `oz-*` crate conventions
- **`ui-components`** — for React component props, ARIA, Fluent IDs
- **`tauri-ipc`** — for Tauri command names, `#[tauri::command]` signatures, `ui/src/api/` wrappers
- **`hal-drivers`** — for device driver trait impls, mock coverage (`crates/oz-hal/src/drivers/mock.rs`)
- **`skill-drift-guard`** — for drift in the `.agents/skills/*/SKILL.md` files themselves, and for audit-footer format enforcement across all `*.md`

Delegate the verification to subagent calls and wait for results. Do not duplicate verification work.

## 11. Output Report Format

```text
Audit target: <file-path>
Mode: shallow / full
Result: PASS / BLOCKED / WARNING
Findings: N major, N minor, N ambiguous

=== MAJOR ===
1. [DOC DRIFT] <heading> — <claim>
   Doc says: <quote from doc>
   Code has: <verified state>
   Fix: <one-line suggested patch>
   Code ref: <file:line>

=== MINOR ===
1. [DOC DRIFT] <heading> — <claim>
   Doc says: <quote>
   Code has: <verified state>

=== AMBIGUOUS ===
1. <heading> — <claim>
   Reason: <why unverifiable>
```

## 11b. Worked example (full audit of one anchor)

Doc under audit: `docs/guides/api-reference.md` — heading "Sessions", paragraph 2 claims `create_shift` returns a `Shift` struct with a `total` field of type `Money`.

```bash
# 1. Find the command implementation and its return type
rg -n "fn create_shift" apps/desktop-client/src/commands/ ui/src/api/

# 2. Confirm the total field and its type on the actual struct
rg -n "struct Shift" crates/oz-core/src/
rg -n "total:" crates/oz-core/src/shift.rs

# 3. Trace when this API last changed (was the doc written before a refactor?)
git log -S "struct Shift" --oneline -- crates/oz-core/src/
```

Resulting finding:

```text
=== MINOR ===
1. Sessions — "create_shift returns a Shift with a Money total"
   Doc says: returns `total: Money`
   Code has: `total: i64` (minor units) — `Money` was flattened during the 0.0.21
   money-safety refactor; `crates/oz-core/src/shift.rs:41`
   Fix: change the doc to "`total: i64` minor units"
```

Two anchors verified, one drift found, one-line patch — that is the whole loop. Do not stop at the report; apply the patch (§12) and only then stamp (§13).

## 12. Repair Rules

- If the doc is outdated, patch the doc to match verified state.
- If the code is outdated, flag the code drift clearly and **stop**.
- Only patch code when the user explicitly asks for code changes or the task scope includes code remediation.
- Keep changes minimal — one drift = one edit where possible.
- Preserve the document's structure and detail unless accuracy requires otherwise.
- After patches, re-run `cargo check` (Rust) or `npm run typecheck` (TS) if any Rust/TS files were changed.

## 13. Audit Stamp

- Add one audit stamp at the top of the audited document only after verification is complete and all repairs applied.
- Format: `> last audited <DD-MM-YY> by docs-auditor` as a blockquote footer. The DD-MM-YY shape (no year prefix, `by <name>` clause) is what `skill-drift-guard` Check 10 enforces project-wide — the in-doc stamp must match `^> last audited [0-9]{2}-[0-9]{2}-[0-9]{2} by <name>$` exactly. (Note: the standalone `scripts/` folder holds no copy of the orphan checker — the script lives at `.agents/skills/docs-auditor/scripts/check-orphans.py`.)
- Replace any existing stamp. **Do not stack stamps.** Measured 08-09-26 after repair:
  **124 stamped files, 124 stamps, zero stacked** — the invariant now holds across the whole
  repo, so treat any stack you meet as a defect to merge, not a style to continue. The
  earlier reading was 116 of 122; the six exceptions were five §SKILL.md files under
  `.agents/skills/··/SKILL.md that a 2026-09-03 audit had stamped as "rev 2" *beneath* the
  2026-08-31 original, plus one in docs/releases/, and three more had been created by this
  session pattern-matching "newest-first history" from an earlier note instead of reading
  this line. Merging is mechanical and lossless: parse every stamp, sort by date, keep the
  newest as the stamp, and append the superseded bodies verbatim under
  "STAMPS MERGED INTO THIS ONE". Never delete an older audit's evidence to satisfy the
  count — the rule asks for one place to look, not a shorter file.
- If you re-stamp a file you already stamped earlier the same day, replace again; do not
  append a "rev 5". `.agents/skills/docs-auditor/SKILL.md itself had accumulated four.
- **The footer must never be older than the newest stamp.** They answer different questions
  — the stamp is the evidence, the footer is the machine-read freshness signal that
  `detect.sh` Check 9/10 parses — so a footer behind the stamp makes a freshly audited doc
  look stale and gets its work discounted. `check-audit-stamps.py` below reports that class
  as drift; a footer *ahead* of the stamp is legitimate (a re-check that changed nothing
  needs no new evidence line) and is reported informationally only.
- If the audit was not completed (blocked or ambiguous with no user answer), do not stamp.
- If a stamp already exists, compute `git diff <last-date> -- <path>` and mention what changed in the report.

## 14. Operational Guidelines

- Run the entire audit synchronously and immediately in the current chat turn — never schedule it for later.
- Prefer fast local search and file reads first.
- Run the narrowest relevant validation step before stamping when behavior changed.
- Report exactly what was synced.
- If evidence is incomplete or ambiguous, stop and ask.
- Do not guess.
- Keep the report and any patches minimal; the reader should be able to see exactly which claim was verified against which code line.

## 15. Common pitfalls

1. **Auditing against a dirty tree.** A `last audited` stamp against uncommitted code can't be reproduced. Pre-flight check #1 exists for a reason.
2. **Treating a `_approved/` folder under `docs/specs`, or an `adr/` folder, as real paths.** They do not exist in this repo — specs live in `docs/specs/` and `docs/specs/_active/`, decisions in `docs/decisions/`.
3. **Stacking stamps.** One stamp per doc, most recent wins. `skill-drift-guard` Check 10 flags shape violations (`> last audited DD-MM-YY by <name>`) — keep the footer shape exact.
4. **Patching code during a doc audit.** The default repair direction is doc → code. Only touch code when the user explicitly asked.
5. **Inventing behavior for an `Ambiguous` claim.** If you can't verify it, report it as ambiguous and ask — don't guess to make the doc pass.
6. **Duplicating domain verification.** If the anchor is a Tauri command, React prop, or HAL trait, delegate to `tauri-ipc`, `ui-components`, or `hal-drivers` instead of hand-verifying.
7. **Forgetting `skill-drift-guard` after a doc patch.** If your patch touches a path, type, or convention that a skill describes, run `.agents/skills/skill-drift-guard/scripts/detect.sh --report` before opening the PR.
8. **Skipping the structural orphan pass.** Since the CHANGELOG backfill-blocks incident, every shallow audit should start with `.agents/skills/docs-auditor/scripts/check-orphans.py` — it flags unversioned wrappers, orphaned headings, and stale version headers that a prose read alone misses. It is a detector, not a repairer: re-parent/re-head per §4b, re-run to confirm the finding is gone, then stamp.

---

> last audited 08-09-26 by DSH
