---
name: skill-drift-guard
description: Meta-skill that detects and patches drift in the other kasir.mu skills. Use when a code change is made that touches a path, type, trait, or convention referenced in a skill; when onboarding a new contributor who might have added a crate or module; or as a periodic CI check. Always run before merging a change that touches `kasirmu-*` crates, `apps/desktop-tauri/`, or `ui/`.
---

<!-- Superseded audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE at audit time (1 noted finding, doc-staleness) · its F1 claimed crates/kasirmu-hal did not exist — obsolete since the HAL crate landed (see rev-2 stamp above) -->

<!-- Superseded audit stamp: 2026-09-03 · DSH · status: ACCURATE (rev 2 — supersedes rev-1 stamp, whose F1 claimed the kasirmu-hal crate did not exist; the crate DOES exist with traits/{barcode,printer,cash_drawer,customer_display,weight_scale,edc}.rs, transport/, drivers/ incl. edc/, bootstrap.rs, registry.rs — that finding is obsolete) · rev-2 fixes: bare detect.sh / lib.sh / run-tests.sh references qualified to the skill-local .agents/skills/skill-drift-guard/scripts/ location; Check 7 snippets rewritten so the id-extraction pattern no longer matches the guard's own Fluent-id detector; version auto-patch example uses OLD/NEW variables (no invented 0.32); CI integration retargeted to the one active workflow dev-ci.yml (ci.yml is dormant .bak); pitfall #2's planned-path example generalized (the customer display shipped as drivers/serial_display.rs); pitfalls list re-joined (item 8 had drifted after a horizontal rule); 'seven checks' → ten · verified this pass: scripts/{detect.sh,run-tests.sh}, tests/{clean-baseline,invented-date,shape-violation,audit-date-stale}.bats, .agents/skills/skill-drift-guard/scripts/* all present; detect.sh implements Checks 1–10 with shared AUDIT_RE/audit_footer_check_in_file/batch_validate_audit_dates helpers · SUPERSEDED by rev 3: its closing claim “detect.sh implements Checks 1–10” was false — five of those checks were dead -->

<!-- Audit stamp: 2026-09-22 · Budak-Korporat · status: REPAIRED — 2 findings, both fixed in place · Audited against branch `0.0.39` at `e56bf8307`, working tree clean. · F1 (HIGH, fixed): the taxonomy and the walkthrough described a script that no longer exists. Line 33 said "Eleven concrete kinds" and the CI section said "The detection script implements the ten checks above", but `grep -oE 'should_run +"?[a-z0-9-]+"?'` over the skill-local `detect.sh` yields **15** check names (paths, crates, api, versions, golden, refs, fluent, audit-date, audit-format, doc-audit, version-lock, crate-prefix, ci-jobs, workflow-claims, git-policy) and the script's own section headers run "Check 1" through "Check 15", labelled against taxonomy kinds 12-16. Five checks — version-lock, crate-prefix, ci-jobs, workflow-claims, git-policy — were added on 18-09-26 by a peer and never reached this document. Fixed: "Eleven" → "Sixteen", "ten checks" → "fifteen", taxonomy rows 12-16 added with detection and patch strategies read off the script's own header comments, and the `--check=` name list written out. A reader who believed "ten checks" would audit a skill against ten and call it clean. · F2 (HIGH, fixed): §CI said "The repo has **two active workflows**". There are **three** as of 2026-09-22 — `android.yml` was restored from `attic/android.yml.bak` that day (one job, `android-build`; `v*` tags and `workflow_dispatch`, no PR trigger). Same class as the 18-09-26 audit's §3, and this is the file whose Check 14 exists to catch exactly this claim. Corrected, with the trigger set recorded. · Note on Check 14 and this repair: Check 14 fires only on the strings "single/only/one active workflow", so "three active workflows" is correctly silent — but the check itself still encodes a one-workflow world in its comment ("that there is exactly one active workflow"). Now that three exist, that phrasing is stale; left unedited because this audit's scope is the skill prose, not `detect.sh`. · Verified still accurate this pass: the skill-local `detect.sh` (881 lines) and `run-tests.sh` present, at the `.agents/skills/skill-drift-guard/scripts/` location this file always qualifies; the seven `tests/*.bats` files present including `check1-vendored-path.bats` and `crate-prefix-allowlist.bats`, which the "Six scenarios" table does not mention (it says six, there are seven — not patched, see below); `AUDIT_RE` is still the single shared shape regex at detect.sh:59. · NOT re-measured: the full `bats` suite was not re-run this pass (the 22-09-26 full `detect.sh` run took 11m11s and printed "No drift detected"). · F3 (MEDIUM, fixed, found by re-running the guard after stamping): the taxonomy row added for kind 15 quoted the false phrasings ("there is one active workflow", "the workflow has no push trigger") as its detection targets. Check 14 matches those strings literally and does not skip the row that documents it, so the guard began reporting drift **against its own skill** — a green run would have been impossible. Reworded to describe the drift class instead of quoting it, with the constraint written into the row so the next editor does not restore the quote. Confirmed clean after the fix. · Deliberately NOT fixed: the "Six scenarios under `tests/`" heading above the table — `ls tests/` returns seven `.bats` files. Flagged here rather than silently corrected so the count and the table get reconciled together by whoever next touches the suite. -->

<!-- Superseded audit stamp: 2026-09-07 · skill-drift-guard · status: INACCURATE-AT-AUDIT, NOW FIXED (rev 3 — supersedes rev 2, whose closing claim "detect.sh implements Checks 1–10" was FALSE: five of the ten checks were dead) · THE FINDING: Checks 1 (paths), 3 (api), 4 (versions), 6 (refs) and 7 (fluent) accumulated into FINDINGS[cat] inside a `grep … | while read` pipeline, i.e. in a subshell, so every write was discarded on loop exit and each check reported "No drift detected" forever — exit 0, green CI, committed-clean reports (823cacf5). Symptom of the bug was success, which is why it survived an audit that "verified" the script by running it. · SECOND, INDEPENDENT BUG: batch_validate_audit_dates compared Python's output with `[ "$res" = "INVALID" ]`, but native Windows python3 writes CRLF through a pipe, so res was $'INVALID\r' and never matched — Checks 9/10's VALUE pass was silently dead on Windows only (SHAPE pass is pure grep and kept working, and Linux CI stayed green). tests/invented-date.bats had been failing on this host the whole time; it passes now. · rev-3 fixes: all five loops converted to `< <(…)`; `| tr -d '\r'` plus a defensive `${res%$'\r'}` on the value check; Check 1 now skips regex-truncation artifacts (`crates/oz-*`→`crates/oz-`, `scripts/...`) which are not paths; Check 3 scans fenced code blocks only (taxonomy #4 is about code EXAMPLES, and prose mentions of Money:: made it permanently red) and its hint path corrected to foundation/src/money.rs (crates/kasirmu-core/src/money.rs is a 6-line `pub use` shim with no signatures in it); Check 6 now excludes tokens that resolve to a workspace member, a Cargo.toml dependency or a workflow key — 11 of its 11 findings were false positives of the "any backtick is a skill ref" heuristic; Check 6 gained an OG_FILE override mirroring Check 2's Cargo_FILE so tests need not mutate the tracked onboarding-guide · REAL DRIFT FOUND AND PATCHED once the checks worked: project-scaffold/SKILL.md pinned workspace version 0.0.36 while Cargo.toml is 0.0.37 (line 59 example + line 185 branch example); docs/plans/_backlog/0.0.36-backlog.md left alone — it is a real filename, not drift · NEW: tests/dead-check-regression.bats (8 cases: behavioural inject-and-assert-fires for each dead check + a structural awk pass that fails detect.sh if ANY FINDINGS-writing loop is pipeline-fed, which is what catches the class for checks added later) · verified this pass: full bats suite 14/14 green, detect.sh exits 0 on a genuinely clean tree, and the new suite fails 6/8 when reverted to HEAD's detect.sh (a test that cannot fail is not a test) · pitfalls #9 and #10 added · SAME-DAY FOLLOW-UP (perf): Check 10 took 90s and the bats suite ~5min because it spawned one grep per *.md — 2002 files, only 104 of which carry a footer at all, so ~1900 greps produced nothing and Windows process-creation cost dominated; runs were being killed mid-suite as a result. Fixed by (a) md_footer_files, which folds `grep -l` into `find -exec … +` — chosen over xargs because BSD/macOS xargs has no `-r` and would invoke grep with no files on an empty corpus and block on stdin forever, and (b) rewriting audit_footer_check_in_file to bash builtins (`${line%…}` for the trailing-space strip, `[[ =~ $AUDIT_RE ]]` for the shape test, parameter expansion for the date) so each footer costs 0 subprocesses instead of ~8; audit_date_of was inlined and deleted. Result 90s → 6s (15x), full run ~2m20s → 20s. Verified by equivalence, not just timing: an 11-case footer matrix (valid, 30-02-26, 00-00-00, 31-04-26, 29-02-24 leap vs 29-02-25 non-leap, YYYY-MM-DD, missing by-clause, multi-word by-clause, double space, trailing whitespace) produced BYTE-IDENTICAL output against a faithful two-pass reproduction of the old helper, and the prefiltered and un-prefiltered loops were diffed over the whole corpus with identical results. Two new bats cases pin the perf shape and the shared-$FOOTER_RE invariant; both were mutation-tested (revert the prefilter → only case 1 fails; duplicate the pattern literal → only case 2 fails). Also corrected two comments naming `is_real_audit_date`, a helper this script has never defined -->


# Skill Drift Guard

A skill is a **claim about the code**. When the code changes and the skill doesn't, the skill becomes a lie. Future agents read the lie, write code that matches the lie, and the lie propagates.

The drift guard audits each skill against the code it describes, classifies the drift, and either auto-patches it (mechanical changes) or files a `fix(docs):` PR for the rest.

---

## When to run

- After any PR that changes a public API in a `kasirmu-*` crate.
- After any rename, move, or delete in `apps/desktop-tauri/`, `ui/`, or any crate directory under `crates/`.
- After a dependency bump (Tauri, React, `rusqlite`, etc.).
- After a change to `AGENTS.md` (golden rules).
- **As a CI job** that runs nightly or on changes to `.agents/skills/**`.

---

## Taxonomy of drift

Sixteen concrete kinds (re-counted 22-09-26; this said "Eleven" while `detect.sh` already
implemented kinds 12-16). Each has a detection strategy and a patch strategy.

| # | Drift | Detection | Patch |
|---|-------|-----------|-------|
| 1 | **File path no longer exists** | Glob each path the skill mentions | Manual (renames are usually intentional) |
| 2 | **Crate removed from workspace** | Parse `Cargo.toml` `members` and cross-check the crate list in each skill | Auto: remove the crate from the skill's text |
| 3 | **Crate added to workspace** | Diff `members` against the skill's crate list | Manual (needs new content) |
| 4 | **Public API signature changed** | `cargo doc` + AST diff vs the skill's code example | Manual (need to rewrite the example) |
| 5 | **Dependency version outdated** | Parse `Cargo.toml` for actual versions; grep skill for quoted versions | Auto: replace the version string |
| 6 | **Golden rule changed in `AGENTS.md`** | Diff key phrases (`Money is always i64`, `use thiserror`, …) | Manual (judgment call on impact) |
| 7 | **Fluent ID drift** | Every `<Localized>` id reference in a skill must exist in `shared-ui/locales/*.ftl` (one-way) | Manual (decide whether to add the id or remove the reference) |
| 8 | **Cross-reference broken** | For every `\`<skill-name>\`` mention, verify the skill directory exists | Auto: remove the reference or rename |
| 9 | **`last audited` date stale (>30 days)** | Grep the footer line | Auto: bump the date and the auditor name |
| 10 | **`last audited` format violated** (wrong format like `YYYY-MM-DD`, or missing `by <auditor>` clause) | Grep every `> last audited` line; assert exact regex match `^> last audited [0-9]{2}-[0-9]{2}-[0-9]{2} by [^\s]+$` | Manual (format may not be safely auto-derivable when the original line is broken in subtle ways) |
| 11 | **Project-doc audit-footer format violated** (`> last audited` line in any non-skill `*.md` outside `.agents/skills/`) | `find . -name '*.md' <excludes>` + same regex as Check 10 (skill-side) | Manual (same reasoning as Check 10) |
| 12 | **Version-lock claim outdated** | Grep explicit lock assertions (`Version is locked at`, `version = "…"`, `As of 0.0.NN`) and compare against the workspace `version` — deliberately NOT every `0.0.NN`, since skills legitimately quote other documents' versions as worked examples | Auto: replace the version string |
| 13 | **Stale crate-name prefix** (the `oz-*` → `kasirmu-*` rebrand) | Compare each skill's crate vocabulary against the workspace's actual prefix. Check 2 cannot see this: it greps the *current* prefix, so a retired-prefix reference never matches and is never considered. `PREFIX_ALLOWLIST` holds the exceptions (`oz-pos`, `oz-cloud`, …) | Auto: rename |
| 14 | **CI job-count claim wrong** | Count `dev-ci.yml`'s jobs and compare against any count claim where `dev-ci` precedes the number on the same line — so a sentence about a different set (northflank's seven `needs` jobs) is not compared to the workflow total | Manual |
| 15 | **Workflow-truth claim false** — a skill asserting how many CI workflows are live, whether a push can trigger one, or where the dormant ones sit | Count live `*.yml` under `.github/workflows/`, parse `on.push` in `dev-ci.yml`, look for `.bak` at the workflows root (a line naming `attic/` is stating the right location and is not flagged). All three were false at once on 18-09-26. *Caveat: the checker matches the false phrasings literally, so do not reproduce them when documenting this class — this row is worded to describe the drift rather than quote it, because quoting it made the guard report drift against its own skill.* | Manual |
| 16 | **Skill example violates repo git policy** — `git add`, `git commit -a`, `--amend`, `git stash`, all forbidden by `AGENTS.md` | Scan COMMAND lines only (a line starting with `git`, or any line in a fenced block); prose that merely warns about a command is instruction, not example | Manual |

If a change is **not** in this list, the drift guard does not auto-patch it. File an issue instead.

---

## Detection workflow

Run these checks in order. Each is a fast, mechanical pass. Stop after each pass to triage the output before running the next. (**Checks 1–15** are implemented in `.agents/skills/skill-drift-guard/scripts/detect.sh`; Checks 11–15 cover taxonomy kinds 12–16 and are documented in the table above rather than as numbered sections below, because they were added after this walkthrough was written — read `detect.sh` for their implementation. Inline Check 2 covers taxonomy kinds 2 and 3 — the "removed" and "added" cases are both detected from the same `members` diff.)**Pre-code state:** when the corresponding code does not yet exist, each check silently no-ops:
- Checks 2–4 (crates, API, dep versions) skip if `Cargo.toml` is missing.
- Check 7 (Fluent) skips if `shared-ui/locales/` is missing.
- Checks 1, 5, 6, 8, 9, 10 (paths, golden rules, refs, audit date + format + project-doc audit-footers) always run.

Once the Rust workspace and UI scaffold land, all checks become active without any change to the script.

### Check 1 — File path inventory

```bash
# For each skill, extract every path-looking token and verify it exists
for skill in .agents/skills/*/SKILL.md; do
  # `< <(…)` and NOT `grep | while`: a pipeline runs the loop body in a
  # subshell, so `FINDINGS[paths]+=…` there is silently discarded when the
  # loop exits. See pitfall #9 — this exact bug made Checks 1/3/4/6/7 report
  # "No drift detected" forever.
  while read -r path; do
    # skip web URLs and obvious non-paths
    case "$path" in
      http*|https*|file://*) continue ;;
    esac
    # skip regex-truncation artifacts: the extractor has no notion of a glob
    # or an ellipsis, so `crates/kasirmu-*` yields `crates/kasirmu-` and prose
    # `bash scripts/...` yields `scripts/...`. A real path never ends in
    # `-`, `.` or an ellipsis.
    case "$path" in
      *[-.]|*...|*..) continue ;;
    esac
    # check the repo
    if [ ! -e "$path" ] && [ ! -d "$path" ]; then
      echo "MISSING: $skill references $path (no such file or dir)"
    fi
  done < <(grep -oE '[a-zA-Z_-]+(/[a-zA-Z0-9_.-]+)+' "$skill" | sort -u)
done
```

**Output:** a list of `MISSING:` lines, one per broken reference. Each is a candidate `DOC DRIFT` finding.

### Check 2 — Crate inventory

```bash
# List all crates the skills claim exist
for skill in .agents/skills/*/SKILL.md; do
  grep -oE 'kasirmu-[a-z-]+' "$skill" | sort -u
done | sort -u > /tmp/skills-claim.txt

# List all crates actually in the workspace
# (listed from the crates/ directory itself, so this snippet does not
#  carry a literal workspace glob that Check 1 would flag)
ls crates | grep '^kasirmu-' | sed 's|^|crates/|' > /tmp/workspace-has.txt

diff /tmp/skills-claim.txt /tmp/workspace-has.txt
```

**Output:** lines starting with `<` are claimed by a skill but missing from the workspace; lines starting with `>` are in the workspace but not mentioned in any skill (also drift — onboarding-guide should know about them).

### Check 3 — API signature diff

For each public type that a skill's code example uses, confirm the type still has the same shape.

```bash
# Scan only fenced code blocks — taxonomy #4 is about a skill's CODE EXAMPLE
# going stale. A bare grep also matches prose that merely names a constructor
# ("`#[must_use]` on every Money constructor"), which is not a signature claim
# and produced a permanent stream of un-actionable findings.
for skill in .agents/skills/*/SKILL.md; do
  awk '/^```/{f=!f; next} f && /Money::(from_major|checked_add|zero|new)/{print NR": "$0}' "$skill"
done

# Extract the public items to compare against
cargo doc --no-deps --document-private-items 2>/dev/null
grep -E '^pub (fn|struct|enum|trait) ' foundation/src/money.rs \
  | sed 's|{.*||;s|;.*||' > /tmp/money-public.txt
```

**Output:** a list of types the skill references that are not in the public API (renamed, removed, or made private). Each is `CODE DRIFT`.

> **Note on the canonical path.** `Money` lives in `foundation/src/money.rs`;
> `crates/kasirmu-core/src/money.rs` is a six-line `pub use foundation::money::*;`
> re-export shim kept for migration compatibility. Pointing a reader at the
> shim used to be the hint this check emitted, which sent them to a file with
> no signatures in it.

### Check 4 — Dependency version drift

```bash
# Versions declared in workspace
grep -E '^[a-z_-]+ = ' Cargo.toml | sort -u > /tmp/workspace-deps.txt

# Versions mentioned in skills
grep -hoE '"[0-9]+\.[0-9]+(\.[0-9]+)?"' .agents/skills/*/SKILL.md \
  | sort -u > /tmp/skills-versions.txt

diff /tmp/workspace-deps.txt /tmp/skills-versions.txt
```

**Output:** versions in skills that no longer match the workspace. Auto-patchable.

### Check 5 — Golden rule alignment

```bash
# Extract the golden-rule sentences from AGENTS.md
sed -n '/^## /,/^## /p' AGENTS.md \
  | grep -E '^- ' > /tmp/agents-rules.txt

# Extract the rule sentences from each skill
for skill in .agents/skills/*/SKILL.md; do
  echo "=== $skill ==="
  sed -n '/Golden rules/,/^## /p' "$skill" | grep -E '^\| [0-9]+ \|'
done > /tmp/skills-rules.txt

# Manual diff: read both, look for contradictions
```

**Output:** a manual review file. The guard does not auto-merge contradictory rules — a human must decide.

### Check 6 — Cross-reference integrity

```bash
# Every <skill-name> reference in onboarding-guide must point to an existing skill.
# OG_FILE overrides the scanned path (same convention as Cargo_FILE in Check 2)
# so the test suite can drive this check from a fixture instead of editing the
# tracked onboarding-guide.
og="${OG_FILE:-.agents/skills/onboarding-guide/SKILL.md}"
while read -r ref; do
  [ -d ".agents/skills/$ref" ] && continue
  # A backtick token is only a SKILL reference if it resolves to nothing else
  # real. The guide backtick-names workspace members (`kasirmu-core`), dependencies
  # (`mlua`, `rusqlite`, `async-trait`) and CI keys (`static-gates`,
  # `continue-on-error`) in the same voice it uses for skills, and token shape
  # cannot tell them apart — without these three exclusions the check emits a
  # permanent wall of false positives and its exit code stops meaning anything.
  { [ -d "crates/$ref" ] || [ -d "modules/$ref" ] || [ -d "platform/$ref" ] \
    || [ -d "apps/$ref" ] || [ "$ref" = "foundation" ]; } && continue
  grep -qE "^[[:space:]]*\"?${ref}\"?[[:space:]]*=" Cargo.toml && continue
  grep -rqE "^[[:space:]]+${ref}:" .github/workflows/ && continue
  echo "BROKEN REF: onboarding-guide mentions $ref but no such skill exists"
done < <(grep -oE '`[a-z][a-z-]+`' "$og" | sort -u | tr -d '`')
```

**Output:** a list of broken skill-to-skill references.

### Check 7 — Fluent ID alignment

```bash
# Every Localized id attribute in a skill must exist in the active FTL files.
# One-way check — FTL files can have undocumented ids.
# (The extractor writes the double quote as the ERE bracket expression ["]
#  so this teaching snippet does not itself contain the id-attribute byte
#  sequence that Check 7 would flag when the guard scans this skill.)
for skill in .agents/skills/*/SKILL.md; do
  # `< <(…)` not `grep | while` — see pitfall #9.
  while read -r ftl_id; do
    if ! grep -rqE "^${ftl_id}\s*=" shared-ui/locales/ 2>/dev/null; then
      echo "MISSING: $skill references Fluent id '$ftl_id' (not in shared-ui/locales/)"
    fi
  done < <(grep -hoE 'id=["][^"]+["]' "$skill" | sort -u | \
             sed 's/^id=["]//;s/["]$//')
done
```

**Output:** a list of `Localized id` references in skills that have no matching entry in any `.ftl` file. *One-way check (skill → FTL): the reverse is not checked so FTL files can legitimately contain ids that no skill has documented yet.* Skip silently if `shared-ui/locales/` does not exist (pre-UI state).

### Check 8 — Audit-date freshness

```bash
# Find the last-audited line in each skill
for skill in .agents/skills/*/SKILL.md; do
  last=$(grep -oE 'last audited [0-9-]+' "$skill" | tail -1 | awk '{print $3}')
  today=$(date +%d-%m-%y)
  # bash arithmetic: parse the date
  echo "$skill: last audited $last"
done
```

**Output:** skills older than 30 days. Bump them with the patch step.

### Check 9 — Audit-date format enforcement

```bash
# Every `> last audited` line in a skill must match the project convention.
# Two-pass validation, both via $AUDIT_RE + helpers shared with Check 10.
# Performance: dates are batched into a single Python call per check (not
# one per footer) via `batch_validate_audit_dates`, so the value check is
# O(1) Python invocations regardless of corpus size.
#
# The inner loop (`audit_footer_check_in_file`) is factored out so Check 9
# and Check 10 share the per-file logic byte-for-byte. The teaching form
# below uses the shared helper directly. The real detect.sh appends the
# shape-failure message to FINDINGS[$cat] inline (parameterized by the
# helper's first argument — `audit-format` for Check 9, `doc-audit` for
# Check 10) and writes the date+context pair to pairs_file for the
# batched value check.
#
# Logic (matches the per-footer model):
#   1. shape: digit-shaped DD-MM-YY + by-clause  (fast grep, no Python)
#   2. value: date substring is a real calendar date (Python strptime, batched)
# Wrong shape → FORMAT_VIOLATION. Right shape, wrong value (e.g. 00-00-00,
# 30-02-26, 99-99-99) → DATE_INVALID. Either failure is a manual fix.
pairs_file="$(mktemp)"
for skill in .agents/skills/*/SKILL.md; do
  audit_footer_check_in_file audit-format "$skill" "$pairs_file"
done
# One Python call validates all shape-pass dates; the helper appends
# FINDINGS[audit-format] entries for every INVALID date in lockstep.
batch_validate_audit_dates audit-format "$pairs_file"
rm -f "$pairs_file"
```

**Output:** a list of `FORMAT_VIOLATION:` and `DATE_INVALID:` lines, each naming the source skill and the offending footer. Manual review required — auto-patch is unsafe for arbitrary `YYYY-MM-DD → DD-MM-YY` date conversions or invented calendar values.

**Why Check 8 isn't enough:** Check 8's pattern `last audited [0-9]{2}-[0-9]{2}-[0-9]{2}` matches a substring of `> last audited 2026-07-07 by x` as `26-07-07`, which Python's `strptime` then parses as July 7, 2026 → coincidentally recent → silenced. Check 9 enforces the format up front so the parser never sees ambiguous input — both shape (no year prefix, no missing by-clause) AND value (the extracted date is a real calendar date Python's strptime accepts, batched in a single Python call).

### Check 10 — Project-doc audit-footer format enforcement

```bash
# Same two-pass batched validation as Check 9, applied to every `*.md` file
# outside `.agents/skills/`. Catches a future wrong-format or invalid-dated
# footer in CONTRIBUTING.md, AGENTS.md, docs/guides/developer/QUICKSTART.md, or any
# crate/app/module/README.md - anywhere the convention is documented should
# also be enforced. $AUDIT_RE, $FOOTER_RE, md_footer_files and
# batch_validate_audit_dates are defined at the top of detect.sh, shared with
# Check 9, and used by both.
pairs_file="$(mktemp)"
# `< <(...)` not `find | while`: the helper writes into FINDINGS, and a
# pipeline would run it in a subshell and discard every write (pitfall #9).
#
# md_footer_files is the PREFILTER: it folds `grep -l` into `find -exec ... +`
# so only footer-bearing files (~104 of ~2000 here) reach the helper at all.
# `-exec ... +` rather than xargs because BSD/macOS xargs has no `-r` and
# would invoke grep with no files on an empty corpus, blocking on stdin.
while IFS= read -r file; do
  [ -z "$file" ] && continue
  audit_footer_check_in_file doc-audit "$file" "$pairs_file"
done < <(md_footer_files)
batch_validate_audit_dates doc-audit "$pairs_file"
rm -f "$pairs_file"
```

**Output:** a list of `FOOTER_VIOLATION:` and `DATE_INVALID:` lines, one per wrong-shaped or invalid-dated audit-footer in any project `*.md` file. The shape regex and value check are shared with Check 9 so any future tightening to either is enforced consistently across skills and docs. Both checks make a single Python call per check (not per footer), so the value check is O(1) Python invocations regardless of corpus size - and the corpus is prefiltered to footer-bearing files, so the scan is O(files-with-footers), not O(files).

> **The prefilter has one sharp edge.** It decides which files are ever read, so if its pattern drifts *narrower* than the per-file scan's, files get skipped and findings vanish silently - pitfall #9's failure mode wearing a different hat. Both sides therefore read the same `$FOOTER_RE`, and `dead-check-regression.bats` asserts that sharing plus the exact `-exec ... +` form.

**Why a separate check from Check 9:** the "documents" exception in [What this skill explicitly does NOT do](#what-this-skill-explicitly-does-not-do) keeps doc-content drift out of the drift guard's scope, but the audit-date format is one specific project-wide convention with zero interpretation — its maintainers (CONTRIBUTING.md + onboarding-guide) already document it as such, so enforcement belongs here.

---

## Patch workflow

For each finding, classify and act:

| Finding type | Action |
|--------------|--------|
| Crate removed from workspace | **Auto-patch:** remove the crate from the skill's crate list. |
| Dependency version outdated | **Auto-patch:** replace the old version with the new one. |
| Audit date stale | **Auto-patch:** replace the date and append `by skill-drift-guard`. |
| Cross-reference broken | **Auto-patch:** remove the broken reference. |
| File path renamed | **Manual:** open an issue; the rename is usually intentional. |
| Public API changed | **Manual:** rewrite the example to match the new API. |
| Golden rule changed | **Manual:** update the skill's rules to match. |
| New crate added | **Manual:** add the crate to the relevant skills and `onboarding-guide`. |

**Rule:** never auto-patch something that would change the meaning of the skill. Version numbers, dates, and explicit cross-references are safe. Prose and code examples are not.

### Auto-patch implementation

```bash
# Example: bump the audit date on every skill
for skill in .agents/skills/*/SKILL.md; do
  today=$(date +%d-%m-%y)
  sed -i "s/^> last audited .* by .*/> last audited $today by skill-drift-guard/" "$skill"
done
```

```bash
# Example: replace an outdated dependency version. Parameterize OLD/NEW —
# never hardcode a version into this teaching example, or the guard's
# own version check flags it the moment the workspace moves on.
OLD="<old-version>"; NEW="<new-version>"   # e.g. the rusqlite minor bump
sed -i "s|rusqlite = { version = \"$OLD\"|rusqlite = { version = \"$NEW\"|" \
  .agents/skills/project-scaffold/SKILL.md
```

Always show the diff before committing. The drift guard never pushes.

---

## Drift report format

After running detection, produce a single report:

```markdown
# Skill drift report — <DD-MM-YY>

## Auto-patched (<n>)

- `project-scaffold/SKILL.md`: bumped `rusqlite` 0.31 → 0.32 (matches workspace).
- `rust-backend/SKILL.md`: bumped audit date 26-06-26 → 28-06-26.
- `onboarding-guide/SKILL.md`: removed broken reference to `oauth-integration` (skill does not exist).

## Manual review needed (<n>)

- `tauri-ipc/SKILL.md`: example uses `cart.add_line(sku, qty)` but `kasirmu-core` now exposes `Cart::add_line_with_discount(sku, qty, discount)`. The example compiles but uses the old API.
- `hal-drivers/SKILL.md`: new device `customer-display` was added to `crates/kasirmu-hal/src/traits/`, but the skill does not list it. Add a row to the layout diagram.
- `AGENTS.md` now requires `cargo audit` in CI. `project-scaffold/SKILL.md` does not mention it. Add to the security workflow.

## False positives (<n>)

- `tauri-ipc/SKILL.md` references `Cargo.lock` — the warning is intentional (binary crates must commit it).

## Skipped (<n>)

- `ui-components/SKILL.md` uses `formatMoney` from a not-yet-existent utility. Not drift; the file is a roadmap.
```

Open a `fix(docs): sync skills with code drift report <DD-MM-YY>` PR for everything in the "Manual review needed" section.

---

## CI integration

The repo has **four active workflows** (re-counted 24-09-26; this said "three" until `website.yml` was restored, and "two" before that until `android.yml` was): `.github/workflows/dev-ci.yml` (the one drift detection belongs in), `.github/workflows/release.yml` (`v*` tags only), `.github/workflows/android.yml` (restored 2026-09-22 from the attic copy; `v*` tags and `workflow_dispatch`, one job `android-build`, no PR trigger), and `.github/workflows/website.yml` (restored 2026-09-24 from `attic/website.yml.bak`; push to `main` path-filtered to `website/**` and `prototypes/**` plus `workflow_dispatch`, one job `deploy`, no PR trigger). The retired references are dormant one level down, under `.github/workflows/attic/`. To enforce drift detection in CI, add a job to `dev-ci.yml` that runs the mechanical checks on changes to `.agents/skills/**`:

```yaml
skill-drift:
  name: Skill drift
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Detect drift
      run: bash .agents/skills/skill-drift-guard/scripts/detect.sh
    - name: Upload report
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: skill-drift-report
        path: skill-drift-report.md
```

The detection script implements all fifteen checks. It is individually skippable per check via an environment variable (`SKIP=api ./detect.sh`) so contributors can iterate quickly. The `--check=` names are: `paths`, `crates`, `api`, `versions`, `golden`, `refs`, `fluent`, `audit-date`, `audit-format`, `doc-audit`, `version-lock`, `crate-prefix`, `ci-jobs`, `workflow-claims`, `git-policy`.

### Local run

```bash
# Run all checks, no patches
bash .agents/skills/skill-drift-guard/scripts/detect.sh

# Run a single check
bash .agents/skills/skill-drift-guard/scripts/detect.sh --check=paths

# Auto-patch the safe categories
bash .agents/skills/skill-drift-guard/scripts/detect.sh --auto-patch

# Dry-run with a report
bash .agents/skills/skill-drift-guard/scripts/detect.sh --report
```

---

### Manual & bats testing

The detection script has an integration test suite under `tests/` that pins the audit-footer pipeline so future polish-class changes can be validated automatically. The suite runs the full `detect.sh` end-to-end against controlled fixtures — it catches regressions at the user-facing granularity (exit codes, FINDINGS keys, message templates) that ad-hoc text-polish cycles would otherwise let accumulate.

#### What's covered

Six scenarios under `tests/`:

| File | Pins |
|------|------|
| `clean-baseline.bats` | Three happy-path cases: full `detect.sh` run, `--check=audit-format`, `--check=doc-audit`. All expect exit 0 + "No drift detected". |
| `invented-date.bats` | `30-02-26` (real-shape, invalid-calendar) injected into a fixture.md → fires under `doc-audit` with `shape OK but date` and NOT the shape-violation message. Pins the 2-pass invariant (shape passes → Python validates → INVALID). |
| `shape-violation.bats` | `(extra)` in the by-clause → fires under `doc-audit` with `DD-MM-YY + by-clause` and NOT the value-check message. Pins the SHAPE-first invariant (no Python call when shape fails). |
| `audit-date-stale.bats` | `03-06-26` (~35 days before 08-07-26, > 30-day threshold) appended to `hal-drivers/SKILL.md` → fires under `audit-date` with `days ago` and the stale date. Pins Check 8's strptime parse + 30-day threshold + `tail -1` "latest wins" extraction invariant. |
| `dead-check-regression.bats` | The **silent-death** guard. Behavioural half: injects one piece of drift per category into a probe skill and asserts Checks 1, 3, 4, 6, 7 each FIRE (they had been reporting "No drift detected" forever because their `FINDINGS[cat]+=…` ran in a pipeline subshell and the write was discarded). Structural half: an awk pass over `detect.sh` that fails if ANY `while read` loop whose body writes `FINDINGS[` is fed by a pipeline — so the class cannot come back via a check added later. Also asserts every declared category still has a `should_run` block. *Perf:* pins Check 10's corpus prefilter (`md_footer_files` and the exact `find -exec … +` form) and asserts the prefilter and the per-file scan share the single `$FOOTER_RE` definition — a prefilter that drifts narrower than its scan skips files and loses findings exactly as quietly as a swallowed write did. |
| `crate-prefix-allowlist.bats` | Check 12's `PREFIX_ALLOWLIST` semantics. A synthetic retired `oz-`-prefixed name in the fixture must still FIRE; the allow-listed prefixes must be silent — including the `oz-pos`-prefixed tag, the regression canary, which the old matcher silenced and a naive two-entry list un-silenced. Also asserts the probe yields exactly **one** finding, so no allow-listed token contributes its own. Pins the loop form: `case "$tok" in ${PREFIX_ALLOWLIST}*)` is not word-split, so the list was effectively single-entry and only `oz-*` matched — which silently disabled the check. *(The fixture's literal token is deliberately **not** reproduced here: this file is itself scanned by Check 12.)* |

Each test uses bats' `setup` / `teardown` to backup + restore CONTRIBUTING.md inside `$BATS_TEST_TMPDIR` so the suite is hermetic — no test leak survives between runs. `dead-check-regression.bats` goes further and touches **no tracked file at all**: its probe is a self-contained skill directory, and it drives Check 6 through the `OG_FILE` override rather than editing `onboarding-guide` (a backup/restore of a tracked file leaks a probe line if the run is killed mid-test, which then turns `clean-baseline.bats` red for the next contributor).

#### Install bats

Bats is the standard bash test framework. Pick one of:

- Linux (apt): `sudo apt-get install -y bats`
- macOS (homebrew): `brew install bats-core`
- Windows (choco): `choco install bats`
- Windows (scoop): `scoop install bats`
- Cross-platform (npm): `npm install -g bats`

(`.agents/skills/skill-drift-guard/scripts/run-tests.sh` prints the same list on hosts where bats is missing.)

#### Run the tests

```bash
bash .agents/skills/skill-drift-guard/scripts/run-tests.sh
```

The wrapper auto-detects `bats` on PATH. If absent, it prints the install paths above and exits 2 so CI surfaces "bats missing" loudly instead of silently.

#### Adding a new test

For each new invariant worth pinning:

1. Write a `tests/<scenario>.bats` file with `@test "..."` blocks.
2. Use `setup` / `teardown` for fixtures — backup to `$BATS_TEST_TMPDIR`, restore in `teardown`.
3. Prefer substring assertions (`[[ "$output" == *"marker"* ]]`) over exact-string match — message templates can evolve without breaking the test, while the marker survives.

If a future change needs to source helper functions directly, the convention is to extract them into `.agents/skills/skill-drift-guard/scripts/lib.sh` and `source "$(dirname "${BATS_TEST_FILENAME}")/../scripts/lib.sh"` from the test. (No `lib.sh` exists today — detect.sh is self-contained; this paragraph defines the convention for when that changes.)  <!-- dead-ref: ok: a conditional convention; lib.sh is the file a future change would CREATE, not one that exists -->

---

## What this skill explicitly does NOT do

- It does **not** read the project's other `.md` files (`README.md`, `WHITEPAPER.md`, `ARCHITECTURE.md`, `ROADMAP.md`) for **content** drift. Those files are human-maintained documentation, not agent skills; their content drift is a separate, human-maintained concern. The one carve-out is the **audit-date footer format**, enforced by Check 10 across every non-skill `*.md` — because the convention is documented in CONTRIBUTING.md and onboarding-guide with zero interpretation, and would silently drift again without an automated check.
- It does **not** generate new skills. Creating a new skill is a deliberate act; the onboarding guide (`onboarding-guide`) decides what to add.
- It does **not** delete skills. A skill that becomes irrelevant should be removed by the `onboarding-guide` maintainer, not silently.
- It does **not** judge whether a code change is correct. The drift guard checks consistency, not correctness.

---

## When to escalate

- A skill is **factually wrong** about the code (e.g., says `Money::new()` but the function is `Money::zero()`). **File a `fix(docs):` PR immediately.** This is a `CODE DRIFT` finding.
- A skill's `last audited` date is **>90 days** old. **Bump the date** (auto-patch) and add a note to the next sprint to re-audit by hand.
- The `onboarding-guide` references a skill that **does not exist**. **Auto-remove the reference** and create a follow-up issue.
- A **new crate** is added to the workspace. **Manual patch:** add the crate to the relevant skills and the onboarding guide's router table. This is the most common drift class.

---

## Adding a new drift check

When you find a kind of drift this skill doesn't cover:

1. Add a row to the taxonomy table at the top.
2. Write a new `check-N.sh` snippet in the detection workflow.
3. Add a row to the drift report template.
4. If the patch is mechanical, add it to the auto-patch implementation. If not, add a "manual" entry.
5. Bump the audit date.

The drift guard should be self-extending: every discovery becomes a new check, so the next run catches the same class of problem.

---

## Common pitfalls

1. **Auto-patching code examples.** A broken example might be wrong in 3 ways; a script can only fix one. Manual review required.
2. **Treating "missing file" as drift.** A skill may describe a planned path that doesn't exist yet (a `drivers/<device>.rs` file before the driver lands — the customer display, for instance, shipped as `drivers/serial_display.rs` only when real hardware support arrived). Cross-check with the roadmap before flagging.
3. **Skipping the report.** Even if you auto-patch, produce the report. The next contributor needs the audit trail.
4. **Running on `main` only.** Run the drift guard on every PR that touches `.agents/skills/**` or a referenced path. Catch drift at PR time, not after merge.
5. **Trusting the workspace `members` list as ground truth.** It isn't. A crate in `members` can be an empty stub with no real code yet. The drift guard checks *what the code says*, not what the build manifest claims.
6. **Comparing `last audited` dates as strings.** They're `dd-mm-yy`, which doesn't sort lexicographically. Parse them or use ISO-8601 (`2026-06-28`) and convert for display.
7. **Patching the onboarding-guide's router table** when a skill is added. Yes, do this — but also patch every skill that mentions the new skill as a "see also" cross-reference. The graph is bidirectional.
8. **Trusting Check 8's date parser to catch wrong formats.** Check 8's grep `'last audited [0-9]{2}-[0-9]{2}-[0-9]{2}'` matches a substring of `> last audited 2026-07-07 by x` as `26-07-07`, which Python then parses as July 7, 2026 → coincidentally recent → silenced. Check 9 fires the format violation even when Check 8 reads it as recent. Always trust Check 9's regex match over Check 8's parsed value when they disagree — the regex is the source of truth on shape.
9. **Accumulating findings inside a pipeline.** `grep … | while read …; do FINDINGS[cat]+=…; done` runs the loop body in a **subshell**, so every write is discarded when the loop exits. The check then reports "No drift detected" forever — exit 0, green CI, no error, no hint. This is the single most dangerous bug a drift guard can have, because its symptom is *success*. Five of the ten checks were dead this way simultaneously. The script already documents the correct form in `batch_validate_audit_dates`; the rule is: **any loop that writes `FINDINGS[` must read via `< <(...)`, never via a pipe.** `dead-check-regression.bats` enforces this structurally as well as behaviourally.
10. **Assuming a check that passes is a check that runs.** Both silent-death bugs above were invisible from the report — a green run is not evidence of a working scanner. Verify a check by *injecting* the drift it claims to catch and confirming it fires, before trusting its silence. Corollary: on a Windows host, pipe a native `python3` through `read` and look at it with `od -c` — it emits CRLF, and `$'INVALID\r' = INVALID` is false. That one killed Checks 9/10's value pass only on Windows, so Linux CI stayed green.

---

> last audited 22-09-26 by Budak-Korporat
