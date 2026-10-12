---
name: docs-auditor
description: Documentation-code audit and sync — keep technical docs accurate, traceable, and minimal with truth-anchor cross-referencing, drift classification, and repair rules. Use when auditing a doc (README, ARCHITECTURE.md, api-reference, spec, admin guide) against the current codebase, verifying that what a document claims still holds, or stamping a document as audited.
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 1 minor) · Full audit of the skill that defines this audit; the 2026-09-22 and 2026-09-08 stamps are merged at the bottom as original evidence. · MAJOR: §13's stranded-footer sweep command was WRONG, and wrong in the worst direction — it reported 579 hits across every markdown file in the repo. The awk guard `{n=NR}` was paired with an unguarded `NR>n`, so on a file with NO footer `n` stayed empty, `NR>n` was true for every line, and each file printed as `file:  <line-count>` with a blank line number. A checker that cannot tell "no footer" from "stranded content" is the loudest false positive this file could have shipped, and it is the same family as the placeholder-character-class bug §4 records: a new checker whose first output was never sanity-checked against something known-clean. FIXED by gating both the counter and the print on `n &&`; the corrected command now returns exactly 8 files, all exempt dated records, cross-checked against an independent JS re-measurement. The near-miss is itself recorded in the body, because the next author of a sweep will write this arm. · MINOR: §13's measurement paragraph was STALE IN ITS OWN TEXT — it stated "9 live docs carry real stranded content" when the number is now 0, because the campaign that discovered the class repaired all nine in the same session (`adr53-ui-vocabulary-boundary` 192 lines, `2026-07-20-sync-conflict-resolution-strategy` 224, `0.0.36-backlog` 156, `2026-09-15-frontend-architecture-todo-appraisal` 123, and five smaller). A rule that cites a count is citing a reading, and this one outlived its reading by hours; the paragraph now records both the discovery measurement (29 total / 12 benign / 9 live) and the post-fix measurement (19 / 11 / 0) and names the trap. · VERIFIED AND LEFT ALONE: all 9 scripts this file names exist under `.agents/skills/docs-auditor/scripts/` (check-nav-paths, check-orphans, check-dead-refs, check-api-surface, check-adr-status, check-site-links, check-audit-stamps, check-env-docs, check-ci-claims); `scripts/check-auditor-selftests.sh` and `scripts/check.sh` exist; all 15 doc/code paths resolve; §4b's six exclusion names all appear in the scanner source; the "standalone `scripts/` folder holds no copy of the orphan checker" note is TRUE (no such file lives directly under scripts/); `scripts/verify-agents-mirrors.py` exits 0; `detect.sh --check=audit-format` reports no drift; the footer is the last non-empty line with no trapped footer. The older counts ("332 live docs", "333 docs", "124 stamped files", "116 stamps") are DATE-STAMPED readings and are left as evidence, not corrected — the same rule the file states for ADRs. · NOT re-measured: the taxonomy's behaviour against a live document, the self-test suites' verdicts, and the site-links/API-surface checkers' output (they need their own inputs, not this file). · Prior evidence retained verbatim below: -->

# Skill: docs-auditor

# Documentation-Code Audit & Sync (DCAS)

## 1. Objective

Keep technical documentation accurate, traceable, and minimal. Prefer verified facts over assumptions. A document is a **claim about the code** — when the code changes and the doc doesn't, the doc becomes a lie that future agents and humans read, then propagate.

This skill audits **any project document** (`README.md`, `ARCHITECTURE.md`, `docs/guides/developer/api-reference.md`, `docs/guides/developer/QUICKSTART.md`, spec files, admin guides, crate/app/module READMEs) against the **current codebase**. It is the sibling of `skill-drift-guard`, which audits the `.agents/skills/*/SKILL.md` files only — this skill covers everything else.

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
  `docs/guides/developer/api-reference.md`): run
  `python3 .agents/skills/docs-auditor/scripts/check-api-surface.py`. It parses
  `generate_handler!` in both clients, every `#[command]` fn under `src/`, and the entry
  lines of the page, then reports four separate drift classes — wrong availability marker,
  listed but never registered, listed and not defined anywhere, registered but
  undocumented. Reporting them separately is the point: a single "the numbers disagree"
  count hides that three of the four need different fixes.
- **ADR status-table drift** (when the audit touches `docs/decisions/` or its index):
  run `python3 .agents/skills/docs-auditor/scripts/check-adr-status.py`. It compares
  each hand-table row's status *word* in `docs/decisions/README.md` against the linked
  ADR's own frontmatter `status:` — the contract that file's Conventions state — with
  frontmatter over the header line (#53's header still reads `Proposed` while its
  frontmatter says `Adopted`), rows resolved by file path so the documented duplicate
  #43 checks each file against its own row, and the Trial & Billing cross-reference
  table excluded (prose cells, not status words). Added 2026-09-24 (audit open item 2)
  after three hand-reconciliations; blocking in `check.sh` (`adr status drift`,
  gates.json `adr-status`) with `--self-test` in `scripts/check-auditor-selftests.sh`.
- **Site-aware website links** (when the audit touches `website/src/content/`): run
  `python3 .agents/skills/docs-auditor/scripts/check-site-links.py`. Content docs link
  each other with Astro ROUTES (`../cloud-sync/`, `../../pricing/`, `/en/docs/…`) — a
  filesystem lens flagged ~90 of them in the 2026-09-23 audit while every one resolved,
  and cannot see a ghost slug either way. This checker builds the route table the site
  actually serves — `i18n.locales` from `astro.config.mjs` × `website/src/pages/` (`[locale]`
  expanded, directory-format URLs) × content routes enumerated the way
  `[...slug].astro` emits them × `public/` files and `_redirects` sources — and
  resolves each markdown link against it, fence- and backtick-aware (an authoring
  guide's example link is not a claim), `#fragment`s graded against the target page's
  real heading ids (github-slugger rules: duplicate `-1/-2` suffixes, explicit HTML
  ids; component-rendered routes skipped — since 2026-09-24, same rules as dead-refs),
  fail-loud when the route table cannot be built. Added
  2026-09-24 (audit open item 4); blocking in `check.sh` (`site links`, gates.json
  `site-links`) with `--self-test` in `scripts/check-auditor-selftests.sh`.
- **Unresolved path references** (any doc): run
  `python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py`. It indexes the tree
  once (pruned) and reports path literals and markdown link targets that resolve to
  nothing — link targets against the source file's directory first, with `./` and `../`
  targets anchored there (no repo-root retry, no basename fallback) since 2026-09-24 —
  and a `#fragment` on any resolved markdown target must name a real id on that page
  (github-slugger rules, duplicate `-1/-2` suffixes, explicit HTML `id=`/`name=`;
  same-page `#links` too — since 2026-09-24, the docstring carries the rules and the
  skip list) — separating live docs from dated records, plans and active specs — which are not drift,
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
python3 .agents/skills/docs-auditor/scripts/check-orphans.py --file docs/guides/developer/api-reference.md
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
| `rg` over `shared-ui/locales/*.ftl` | Verify Fluent IDs referenced by docs |
| `scripts/check.sh` | Full local validation mirroring CI |
| `python3 .agents/skills/docs-auditor/scripts/check-orphans.py` | Shallow-mode structural pass: unversioned wrappers, heading orphans, stale version headers (§4b) |
| `python3 .agents/skills/docs-auditor/scripts/check-audit-stamps.py` | Compare every stamp date against its footer date across all `*.md` (gitignored scratch is skipped — one `git check-ignore --stdin` per run, since 2026-09-23); flags the under-reporting direction and impossible footer dates (`detect.sh` accepts `31-13-26` on shape). Exit 1 on drift. |
| `python3 .agents/skills/docs-auditor/scripts/check-api-surface.py` | Reconcile `docs/guides/developer/api-reference.md` against both clients' `generate_handler!` registries; exit 1 on any of four drift classes (not wired into CI — the page is red against it by design) |
| `python3 .agents/skills/docs-auditor/scripts/check-nav-paths.py` | Reconcile every bolded **X → Y** nav path in `website/src/content/docs/{en,id}` against the nav registry |
| `python3 .agents/skills/docs-auditor/scripts/check-env-docs.py` | Fail when a variable the license server reads is named in no doc — closes the gap `verify-ci-docs-drift.py` cannot see (it compares docs to gates, not to config surface) |
| `python3 .agents/skills/docs-auditor/scripts/check-ci-claims.py` | Fail when a live doc states CI facts the workflow files contradict: cites a `.yml` that exists only as inert `.bak`, names a workflow that exists nowhere, or asserts "the `x` job" for a job no live workflow defines. Read-only-informational baseline today (informational today: introduced at 33 findings in 15 docs on 09-09-26, all triaged to 0 the same day (12 cleared by pragma on dated-record text, 20 by repairing the claim)), not wired into CI. Suppress historical prose with `<!-- ci-claim: ok: reason -->` |

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

### Citation traps that survive every automated check

Both were found repeatedly between 2026-10-11 batches (the oldest-markdown campaign):
two-thirds of the findings in that campaign were coordinates that were *correct when
written* and moved afterwards, and `check-dead-refs.py` cannot see either of these.

1. **A module that was a FILE is now a DIRECTORY.** `db/tax.rs` -> `db/tax/rates.rs`,
   `sync_store.rs` -> `sync_store/tenant.rs`, `subscription.rs` ->
   `subscription/tier.rs`, `pg.rs` -> `pg/users.rs`, `commands/pos.rs` ->
   `commands/pos/checkout.rs`. The old path resolves to **nothing**, or (worse) the
   shim file still exists and no longer holds the symbol. Confirmed three times in one
   batch alone. Sweep target: any doc citing `<module>.rs` where that path is now a
   directory.

2. **A stale citation that names a REAL file is more dangerous than a dead path,** because
   a grep finds the file and stops. `docs/security/data-residency-and-retention.md`
   cited `subscription.rs` for `audit_retention_days`; that file exists and does not
   hold the function, which actually lives in `subscription/tier.rs`. A reader grepping
   the named file concludes the claim is unsupported and moves on. **When repairing, check
   that the cited FILE still contains the cited SYMBOL**, not merely that the path resolves.

A third, related class: **a copy-pasteable command is not the same as a prose reference.**
An ADR's baseline definition — the line that says no phase starts on a red baseline — carried
a `cargo test` invocation against a package that no longer exists; it fails with *"package ID
specification did not match any packages"*. Prior passes logged that as "stale paths left as
written", which under-states a command a reader runs verbatim. `cargo metadata` is the
authority on package names (`apps/desktop-tauri` is package **`kasirmu-app`**, not
`desktop-tauri`).

**And a re-audit rule that follows from all of it:** a prior stamp's *"not found under any
spelling"* can be a **search-scope error, not a gap** — `Settings::write_delta` was
recorded as missing while it sat in `platform/core/src/settings/raw.rs`, a file the
earlier search never opened because the module had split into a directory. Search the whole
module DIRECTORY, and prefer pinning evidence by TEST NAME over line number when the target
is a large file.


> **Discipline for traps 1 and 2: grep the SYMBOL, not the pattern.** A module that split
> leaves the old file in place as a partial, so the path resolves while the symbol has moved
> (`subscription.rs` survives but `SubscriptionTier` is at `subscription/tier.rs:20`;
> `auth.rs` survives as a directory but `invalidate_all_sessions` is at `auth/session.rs:94`).
> And the reverse error is real: one auditor repointed `payload_feature_grant` to
> `subscription/quota.rs` on the assumption the split moved it, then found it still at
> `subscription.rs:677`. Confirm the new file **contains** the symbol before repointing.

**3. A gate that was "wired to nothing" can be PROMOTED later.** A record asserting a gate is
unwatched must be re-checked against the gate's **status in `scripts/gates.json`**, not just
against the hook it was missing from. Found 2026-10-11: `.agents/gates/hook-gate-removal-1c59fea5f5.md`
correctly diagnosed that the `typecheck-tripwire` gate had no runner — and the diagnosis was
acted on, because the gate is now `status: required` (promoted 2026-09-30) and wired at
`dev-ci.yml:1314` and `check.sh:1072`. The record's diagnosis stayed true; only its
present-tense "nothing reads it" half went stale. Repair with a **dated addendum**, not a
rewrite: the finding was right and the fix is the news.

**4. A guard that GREW can falsify a skill's "it does not check X" claim with no path going
dead.** `check-dead-refs.py` stays green because the path still resolves — the scope changed, not
the location. Found 2026-10-11: a skill asserted a checker "validates manifest COPYs and dummy src
dirs only … It does NOT look at apt lists"; the script had since gained an `apt_divergence()` check,
an exemption table, per-package reporting and a `--self-test`, and reported 43 members rather than
42. The docstring now names the omission as its reason to exist — the unified image was unbuildable
for five days because two Dockerfiles disagreed and nothing compared them. **Any doc describing a
guard's SCOPE must be re-read against the script's own functions, not just its exit code.**

**5. Spliced prose — an edit that inserts a note between the two halves of an existing sentence.**
The signature: a continuation line starting lowercase immediately after a line ending in terminal
punctuation, or a sentence whose ends do not join. Found five live instances in two ADRs on
2026-10-11, on top of eight already repaired in their history — these files are built by many small
"record the shipped X" commits, which is exactly the shape that produces it. Two of the five left a
**direct self-contradiction** (a section still saying "unresolved" about an item another section
records as RESOLVED). Repair by REJOINING when both halves carry unique true content, and by
deleting the orphan when a superseding bullet already restates it — then check the original commit
to recover the intended sentence. **When a note supersedes prose, delete the superseded half.**

**6. Stranded footers are endemic in the record corpus.** Of five footered `.agents/reviews/` files
audited in one pass, FOUR had 59–379 lines of dated content below their footer — and the hidden
part is always the newest. One file carried **two** footers. Any record with a `> last audited`
line is worth the same one-line check.

**7. A "verbatim from <file>:<line>" quote can go wrong while the PATH still resolves.** If the
file was split into a directory, the old path survives as a router or a partial and the quote is
simply no longer there. Found 2026-10-11: a guide quoted a dev-mock handler "verbatim from
`tauri-api.ts:2089`" — that file is now a 369-line router and the handler moved to
`handlers/system.ts:661` with a changed body. A path-only check passes and the reader gets the
wrong code. **For any quoted code block, re-read the quoted lines, not just the file.**

**8. A stamp that CLAIMS a repair the file does not contain — in three shapes.** Measured
2026-10-11: (a) an ADR stamp asserted it had repointed a crate path, and a guide stamp asserted it
had renamed `oz` to `kasir` — both claims absent from the file; (b) **the stamp is RIGHT ABOUT THE
CODE and wrong about the file it sits on**: the Windows launch guide's stamp correctly cited
`build-exe-release.ps1:211` and `kasirmu-app.exe`, while the guide body below it still said
`kasir.mu.exe` in nine places; (c) **the file's own MATCHED SIBLING disagrees**: the Linux guide
already used `kasirmu-app` twenty times for the same binary. A stamp is evidence of intent, not of
outcome. **When you read a stamp, spot-check the repairs it names — and diff the file against its
matched sibling, which is often the cheapest test that something drifted one-sidedly.**

**9. A guard whose reported number is the DOC'S OWN gate can be red at HEAD.** `check-api-surface.py`
compares registered IPC commands against the guide's table. Found 2026-10-11: it reported
`DRIFT: 6` — six registered commands had no row, three of them in a section that did not exist.
The dev-guides audit restored it to CLEAN (519 documented / 519 distinct, all buckets zero). **Run
a guide's own gate before auditing the prose; the number it prints is a finding, not a nuisance.**

**10. A status WORD in an ADR front matter is shared state with two generated files.** Changing the
word turns two correctness gates red: `check-adr-status.py` (the hand table in
`docs/decisions/README.md` mirrors the word) and `generate-records-index.mjs --check`
(`docs/records/README.md` is generated from front matter). Any status edit must be paired with
the table cell and a regeneration, in the same commit. Measured 2026-10-11.

**11. "Shipped, but not under the name the plan gives."** A plan's work can land in a DIFFERENT
shell, package, crate or layer than the plan specified, and the plan's own paths are then simply
absent — so a path-only checker (and `check-dead-refs`, which exempts `docs/plans/`) sees nothing.
Found 2026-10-11: a QRIS listener plan specified the pre-rename `apps/<tablet>-client` and `mu.kasir.<tablet>` identities while the
Kotlin service shipped in `apps/mobile-tauri` packaging `mu.kasir.mobile`; a payment-methods plan
designed a settings-key axis while the shipped form is a rails system plus a
`local_payment_methods` migration on the regional-configuration track. **Only re-deriving the
SUBJECT surfaces it** — grep for what the feature DOES, not for where the plan said it would live.
The repair is a dated STATUS UPDATE naming the shipped home; never rewrite the plan's design.

**12. A plan's own correction block can go wrong in BOTH detail and remedy.** A remedy that copies
from a directory is only as good as the directory: one plan prescribed `docs/archived/*.md` as the
fix for an empty docs category, but that directory became a tombstone and the build script had
already been reworked to copy `docs/guides/` instead — so the flagged defect was RESOLVED and the
prescribed remedy pointed at nothing. Re-check a correction's remedy, not just its claim.

**13. Writing a stamp is itself a mutation risk — three ways a stamp edit broke a file on
2026-10-11.** (a) **Unterminated comment**: a new `<!-- Audit stamp:` written without its closing
`-->` swallows everything after it, including the H1 — the depth check reports 1 and you will not
see it in a casual read. Two auditors hit this in one batch. (b) **Replaced instead of merged**: a
rebuild that overwrites the prior stamp body loses the older audit's evidence — re-extract the
prior body from `git show HEAD:<path>` and rebuild, rather than writing over it. (c) **Merged as
`>`-quoted blockquotes**: prior text wrapped in `>` renders as visible page text below the
footer. Merge prior bodies as plain text inside the ONE comment. **Always verify, after writing:
`d=0 m=1`, one footer as the last non-empty line, and — render-aware — that the file's first
VISIBLE line is its own H1 and no stamp text leaks.**

**14. A frozen spec's Status line can go stale in the gate's FAVOUR.** A spec that says
"TODO (not implemented)" may describe a gate that has since shipped, because nothing reads a spec's
status. Found 2026-10-11: `docs/plans/_done/done-testid-checker-spec.md` read "Status: TODO (not
implemented)" while the script, its tests, its baseline, its `gates.json` entry (`required`), its
npm script and its `check-ui.mjs` leg all existed — and running the checker exited 0, satisfying
the spec's own acceptance row. **Sweep target: any spec or plan with a Status line, cross-checked
against `scripts/gates.json`.** Note the asymmetry with trap 3: there a guard grew and a doc's
"it does not check X" went false; here the gate arrived and a doc's "it does not exist" went false.

**15. A checked box can name a gate that NEVER existed.** Distinct from trap 14 (a gate that
shipped late) and trap 3 (a guard that grew): here the named artifact is not merely stale but was
never created, so `git log --all -- <path>` is empty. Found 2026-10-11: a plan's `[x]` row claimed
"Fail if secrets appear in release assets (naming a check-secrets script)" — that script never existed at any
commit; the real artifact is `.gitleaks.toml`, and it is **referenced by one script and wired into
no workflow at all**, so the row was a green tick over a gate that does not run under either name.
This is the FOURTH instance of the `[x]`-without-evidence class in this campaign. **For every
checked row that names a script or a gate: test the path AND test that something invokes it.**

**16. A loose path-extraction regex INVENTS dead paths.** A sweep pattern that stops at the first
`.` reports `manifest.js` for `manifest.json` and then "finds" that it does not exist. An auditor
caught this in their own extraction on 2026-10-11 (6 apparent dead paths, 5 real). **Require a
closing delimiter (`\.(rs|md|json|ts|tsx|toml|sh|py)` at a word boundary) and spot-check one hit
from each file before reporting a count.**

**17. When a named file is gone, test the SUBSTANCE before annotating it away.** A finding can
survive a module's deletion under a different name. Found 2026-10-11: an O-M54 item named
`kasirmu-reporting/src/daily_summary.rs` (deleted) — but the *defect it described* (a non-sargable
`DATE(col)` predicate with no `LIMIT`) is still live in `menu_engineering.rs` and `margin.rs`, so
the item stayed actionable under new names. A neighbouring item's module had been reimplemented
away entirely, carrying none of the named defects. **Repoint when the substance survives; record a
retirement when it does not.** Same discipline in reverse for trap 12.

**18. A doc can PREDICT its own decay — and be right.** `docs/architecture/CRITICAL_PATH_INVARIANTS.md`
carries a "Not a gate" note saying nothing checks its citations and that drift there would be silent.
Measured 2026-10-11: six of eleven cited test line numbers had moved, two source anchors had moved, and
one cited test never existed under its given name — while every named test still existed and every
invariant still held. **A page that declares itself unchecked is a high-yield audit target; audit it
first, not last.** The same pass found eleven drifted anchors in `module-boot-sequence.md` with the
sequence itself unchanged — coordinates age, substance does not.

**19. A documented ceiling with a RED gate: report, never re-baseline.** `module-namespace-firewall.md`
§6 states a conscious core-size ceiling of 37,176 lines and says the ratchet fails if core grows past
it. At HEAD it IS failing: `scripts/verify-core-size.py` reports 38,703 (+1,527), exit 1, with the
baseline file committed-clean and only a README dirty under `crates/kasirmu-core/` — so it is MERGED
work that never got the deliberate ceiling edit the section itself demands. The gate's own message
says the ceiling is lowered "deliberately … in a commit that says why". **Lowering a ceiling is a code
owner's act, not a documentation repair.** Report it with the exact command and numbers; do not edit
the baseline. This is the same red-gate class as a guard that grew (trap 4), but the fix belongs to
someone else.

**20. "Green at a NUMBER" is the row that rots — and one gate can be cited by many docs.**
A plan or architecture page that certifies a gate green **with a specific ceiling or count** is
falsified the moment the number moves, while every path in it still resolves. Measured 2026-10-11:
`scripts/verify-core-size.py` is RED (38,703 vs a 37,176 ceiling) and TWO separate documents still
certify it green — `docs/architecture/module-namespace-firewall.md` §6 (batch 21) and
`docs/plans/_done/done-todo-modular-scaffolding.md` Phase 5 (batch 22). **Sweep target: grep for a
quoted ceiling/count attached to a gate name; re-run the gate, not just the path check.** When one
red gate is found, search the tree for other docs quoting the same number — the second doc is
cheap to find and expensive to miss.

**21. `_done/` plans have TWO conventions and neither is the footer.** Of four `docs/plans/_done/`
files audited together, two carried an inline `<!-- Audit stamp:` comment and two carried no stamp
at all (0 of 4 had a `> last audited` footer). **Match the file as found; do not add a footer or a
stamp to a `_done/` plan.** A completed plan is a record of work, and inventing a footer would
misrepresent it as a live claim doc — the same reasoning as the `.agents/` record corpus, which is
why the two are separate traps: the `.agents/` rule is by directory, this one is by prefix.

**22. A stamp that records a repair whose before/after paths render IDENTICALLY.** Distinct from
trap 8 (a repair claimed but absent) and from trap 1 (a path that moved): here the repair WAS made,
and the sentence describing it is garbled so a reader cannot see what changed. Found 2026-10-11:
`modal-audit-checklist.md`'s stamp said it fixed pointers aimed at "`ui/src/theme/tokens.css`" because
"that directory no longer exists. The token sheet is now `ui/src/theme/tokens.css`" — both halves
the same path, so the sentence proves nothing. The real move was the old styles-directory token sheet -> 
`ui/src/theme/tokens.css` (six commits under the old path). **When a stamp quotes a before/after
pair, check the two are actually different** — and recover the truth from `git log -- <oldpath>`.
The shape has at least THREE wordings, and a sweep must match all of them: (a) `from X to X`;
(b) `X … and that directory does not exist — it is X`; (c) `X does not exist anywhere in the tree; the
<thing> is X`. Measured 2026-10-11: a single 7-file corpus held THREE instances of this class
(`a11y.md`: the true old path was `ui/src/styles/tokens.css`; `i18n-todo.md`: the pre-move
locales directory under `ui/src/`; `api-client.md`: the true old name was `OZPosClient`) after one more in batch 23. **Any corpus of
2026-09-29 stamps is worth scanning with all three patterns** — the sentence is a no-op and a reader
cannot tell what changed.

**23. Counts of HOOK STEPS and GATE SETS rot the same way ceilings do.** The pre-commit hook gained
an eighth step on 2026-10-09, and a "steps 2–7 are extension-locked" range (or a "seven steps" count)
was found stale in FOUR separate documents across this campaign. **Trap 20's shape generalizes: any
doc quoting a step count, a step range, or a suite count should be re-derived against the hook's own
`# ──` section headings, not read.**

**24. Read a heading's SCOPE before calling a count wrong.** A page headed "five walker suites" whose
command block names six files is not contradicting itself if it labels the sixth "a separate shape the
five do not grade". Measured 2026-10-11: the same "five vs six" concern was raised from a batch-16
reading of the heading alone, and THREE independent auditors re-deriving it in full all concluded NOT A
DEFECT — the five are one family and the sixth is a deliberately separate run. Its companion complaint
("the page never mentions orientation") was literally true and beside the point: orientation is graded by
a different suite outside that page's declared scope. **A page that states its own scope and its own
boundary is usually right; check whether the thing you are missing is simply out of scope.**

**25. An INCOMPLETE enumerated range is different from a FALSE one — and both differ from a wrong
count.** The hook gained an eighth step, so "steps 2–7 are extension-locked" understated the range; but
step 8 is `.rs`-locked, cannot match a `.css` path, and the pre-commit has no `.css` reference, so the
page's conclusion still held. **Qualify the range in place; do not rewrite the conclusion, and say which
half changed.** Deciding between "incomplete" and "false" is the whole repair.

**26. A RECORDS RELOCATION invalidates the LOCATION SENTENCES inside old stamps.** When a batch of
records moves directory, every stamp written before the move that names **its own location** becomes
false — while every path in the BODY still resolves, so no checker sees anything. The tell is a stamp
saying "this file lives in X", "the only such record in Y", or "placed among Z". Measured 2026-10-11:
`cd8d671a6` (2026-10-02) moved nine security audits from `docs/security/` to
`docs/records/audits/security/`, four days AFTER their 2026-09-29 stamps were written — and
`docs/security/` still EXISTS holding three entirely different files, so the claim named the wrong
directory's contents rather than merely a stale path. **Sweep target: grep a corpus for stamps naming
a DIRECTORY, then confirm the file is still there.** Distinct from trap 8 (a repair claimed but
absent) and trap 22 (a before/after pair that renders identically).

**27. A relocation commit can repoint SOME references and miss others in the same corpus.** The same
class of move leaves internal cross-links dead: `a0c4f7b90` (2026-10-02, "move 14 audit reports …
and repoint 11 references") listed and fixed eleven, and missed at least one more
(the setup-wizard audit, cited by its OWN companion plan under its pre-move audit path, and the journal's
mentions, which are historical and correctly left). **When a commit's subject says "repoint N
references", verify N covered the corpus — the misses are the ones left behind.** This is why the
by-hand sibling grep is mandatory for these corpora: `check-dead-refs` exempts them outright.

**28. A live-set COUNT with no owner rots at every value.** Found 2026-10-11 in a skill audit that
had already recorded the same claim rotting TWICE: "N active workflows" read one, then two, then three
— and `ls .github/workflows/*.yml` now returns **four** (`android.yml`, `dev-ci.yml`, `release.yml`,
`website.yml`; 11 more sit under `attic/`). Every restoration and retirement moves the total, and no
commit owns it. **The durable row names each member and its trigger; the total is the part that rots.**
Sweep target: any "there are N active <live set>" claim — re-derive with the lister, not the prose.

**29. A quotation of a file is not a claim BY the document — check the FENCE before repointing.** A
record that quotes a shipped file verbatim will contain that file's own paths, including any that have
since moved. Found 2026-10-11: a review's §5.1 reproduced `website/public/robots.txt` exactly,
carrying its `# Rationale: docs/records/<name>.md` comment — and the record itself had moved into
`docs/records/audits/seo/`. **The fenced line is correct as written and must NOT be repointed;
rewriting it would make the quotation false.** Repair by adding a dated note that names the real
location, and report the genuine stale citations separately — here six of the seven were in shipped
**code comments** (`robots.txt`, `_headers`, `worker.ts`, `SiteHead.astro`), which is a code owner's
call, not a documentation edit.

**30. The 2026-10-02 records restructure is a MULTI-CORPUS sweep target, and it hit 3 batches running.**
Four commits moved whole corpora into subfolders on that day, each leaving LOCATION SENTENCES in the stamps
written four days earlier plus dead paths inside runnable command sequences: `afca83144` (benchmarks +
releases), `cd8d671a6` (security + observability), `a0c4f7b90` (14 audit reports), `2daaabdfe`
(campaign journals). Measured across 2026-10-11: batches 24 and 25 found the same class in security,
setup, benchmarks, findings and campaigns. **Expect it in `docs/records/releases/**` and
`docs/records/findings/**` for whatever remains.** The highest-value variant is not the stamp's prose but
a **runnable command**: `regression-tracking.md` told a reader to `cp …` into the benchmarks directory
under `docs/` — a directory that no longer exists at that path, so the instruction whose whole job is
updating a baseline writes nowhere.

**31. A record can cite a commit that matches NO object — and still be right.** Three restore SHAs in an
I18N-05 evidence list (`ecbcc635`, `af246396`, `6e270d70`) match no object anywhere: `git cat-file` fails,
`rev-list --all` prefix matching returns nothing, they are not 8-hex role ids, not checksums, and not within
Hamming 2 of any real commit. **The finding's SUBSTANCE still held** — both gates the entry describes are
restored and the checker exits 0 today. **Record the SHA problem; do not call the finding false.** Compare
trap 15 (a gate that never existed) and trap 3 (a guard that grew): here the evidence pointer is broken while
the conclusion is sound.

> **Authoring note — documenting a trap can itself trip a checker.** Four times on 2026-10-11 a
> path written into this file ONLY as an example (a deleted directory, a pre-rebrand crate, a
> pre-rename app dir) was read by `check-dead-refs.py` as a live claim, because this file is a LIVE
> doc and is scanned. **When a trap needs to show a path that no longer exists, spell it
> non-literally** (a prose description, or a placeholder like `apps/<tablet>-client`) **or mark it
> explicitly as a historical spelling.** Run `check-dead-refs.py .agents/skills/docs-auditor/SKILL.md`
> after any edit that adds an example path.

### The dated-record corpus: default to ZERO edits

Two corpora are **records by convention**, and the correct audit outcome for them is usually
*verify and report, change nothing*:

| Corpus | Footer convention | Tooling |
|---|---|---|
| `.agents/planning/**`, `.agents/reviews/**` | **none** — inline HTML-comment stamps only | `check-dead-refs.py` lists these in its `SCRATCH` tuple (not `HIST_DIR_PREFIXES`) and skips them |
| `.agents/archived/**`, `.agents/management-journal/**`, `.agents/gates/**`, `.agents/incidents/**` | **none** | skipped by the dated-record rules |
| `docs/records/**`, `docs/specs/_done/**`, `docs/plans/**`, any `todo-`/`plan-`-named file | mixed | in `HIST_DIR_PREFIXES`, skipped |
| `.agents/skills/**`, `.agents/management/` | the SKILL footer convention | **SCANNED** — deliberately not exempt, because these are live contracts |

**Do not read a scoped checker run on this corpus as coverage.** Running
`check-dead-refs.py <an .agents/planning file>` prints `scanned 0 markdown files` and
`dated records skipped: 0` while the file is in fact exempt via the `SCRATCH` list — the
counter tracks the other list. A real blind spot follows from that: verify `cargo -p` package
names in these records with `cargo metadata`, not with the checker's exit code. Measured
2026-10-11: a record cited `-p oz-cloud-server` 25 times (the package is `kasirmu-cloud`) and
the scoped run still exited 0.

Do NOT add a `> last audited` footer to these. It would misrepresent a completed record as a
live claim document. A record citing a pre-rebrand path, a moved corpus, a consolidated
migration or a pre-reorg `.agents/<name>.md` is **expected drift**: name the live equivalent in
your report, do not rewrite the record. Edit only when (a) a claim is false **about the
present**, or (b) an **internal cross-link between records is broken** — and then append a
dated correction under the corpus's own convention if it has one.

**Three `.agents/` traps found on 2026-10-11:**

- **An internal cross-link is invisible to the checker.** `check-dead-refs.py` treats the
  corpus as records, so a broken pointer like `.agents/naked-read-sync-conflicts.md` (moved to
  `.agents/planning/`) passes every automated check. Grep sibling pointers by hand.
- **A moved target reads as alive.** The checker falls back to whole-tree **basename** matching,
  so `.agents/egress-surface.md` resolves even though the file is at `.agents/planning/egress-surface.md`.
  A reader pasting the literal path fails. Any doc citing a sibling by absolute path is a sweep target.
- **8-hex tokens in these journals are AGENT ROLE IDS, not commit SHAs** (`ops 7cca72fe`,
  `writer W1 6d5670ed`, `coder C1 737bd54c`). Exclude the 8-hex role-id form from any SHA sweep
  over `.agents/`, or it reports a dozen false dead commits. Measured on one 6,495-line journal:
  42 of 247 hex tokens were role ids.
- **32-hex and 12-hex tokens can be md5/sha1 CHECKSUMS**, not commits — and some journals cite
  non-resolving SHAs **on purpose** (a superseded round-log tip, a documented typo, or a token
  carrying its own `dead-ref: ok` pragma). Before reporting a non-object as drift, read the
  surrounding line: in the same 6,495-line file all six odd-length non-objects were self-explained
  by the record's own text, giving **0 unexplained dead SHAs** out of 247.

The 2026-09-13 reorg (`edd97e5c0`) moved or deleted 40+ files, including `.agents/AGENTS.md`
(206 lines, deleted with no rename destination). **Assume a bare `.agents/<name>.md` citation
has moved until you check.**

---

## 10. Cross-Skill Protocol

When a truth anchor belongs to a domain covered by another skill:

- **`rust-backend`** — for Money struct usage, transaction patterns, error types, `kasirmu-*` crate conventions
- **`ui-components`** — for React component props, ARIA, Fluent IDs
- **`tauri-ipc`** — for Tauri command names, `#[tauri::command]` signatures, `ui/src/api/` wrappers
- **`hal-drivers`** — for device driver trait impls, mock coverage (`crates/kasirmu-hal/src/drivers/mock.rs`)
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

Doc under audit: `docs/guides/developer/api-reference.md` — heading "Sessions", paragraph 2 claims `create_shift` returns a `Shift` struct with a `total` field of type `Money`.

```bash
# 1. Find the command implementation and its return type
rg -n "fn create_shift" apps/desktop-tauri/src/commands/ ui/src/api/

# 2. Confirm the total field and its type on the actual struct
rg -n "struct Shift" crates/kasirmu-core/src/
rg -n "total:" crates/kasirmu-core/src/shift.rs

# 3. Trace when this API last changed (was the doc written before a refactor?)
git log -S "struct Shift" --oneline -- crates/kasirmu-core/src/
```

Resulting finding:

```text
=== MINOR ===
1. Sessions — "create_shift returns a Shift with a Money total"
   Doc says: returns `total: Money`
   Code has: `total: i64` (minor units) — `Money` was flattened during the 0.0.21
   money-safety refactor; `crates/kasirmu-core/src/shift.rs:41`
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
  2026-08-31 original, plus one in docs/records/releases/, and three more had been created by this
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

### The footer must be the LAST non-empty line — check it, do not assume it

A `> last audited` line that is not at end-of-file makes everything appended after it
**invisible** to the two tools that read that line: `detect.sh` Checks 9/10
(`skill-drift-guard`) and `.agents/skills/docs-auditor/scripts/check-audit-stamps.py`.
Both take the footer as the document's freshness signal, so an addendum parked below it is
read as if it did not exist — the same class as an unversioned backfill block, one level
down. Found 2026-10-11 during the oldest-markdown campaign in two distinct shapes:

* **Footer placed early, body after it.** `docs/decisions/2026-09-15-adr53-ui-vocabulary-boundary.md`
  carried its footer at line 18, directly under the header blockquote and *above* the entire
  body — so the machine-read date described a document that had not been written yet at that
  point. A 192-line gap.
* **Addendum appended below the footer.** `docs/decisions/2026-07-20-sync-conflict-resolution-strategy.md`
  had a 2026-10-04 section added under a 29-09-26 footer. A 224-line gap. Same pattern in
  `docs/decisions/2026-07-10-crdt-delta-ledger-offline-sync.md` (17), `docs/decisions/2026-09-02-adr43-cloud-sync-performance-scaleout-roadmap.md` (7),
  `docs/guides/developer/admin-guide.md` (9) and `docs/guides/product/SYSTEM_DESIGN_AND_INCUMBENT_ANALYSIS.md` (10).

Both are repaired by MOVING the footer to the true end of file, never by deleting the
appended content — the content is usually the newest and most correct part.

Re-derive the whole class with this one-liner (prints `file:line  N` for each doc whose
footer has N non-empty, non-blockquote-continuation lines after it):

```bash
git ls-files '*.md' | while read -r f; do
  awk '/^> last audited /{n=NR} {if(n && NR>n && $0 !~ /^[[:space:]]*>/ && $0 !~ /^[[:space:]]*$/) c++} END{if(n && c) print FILENAME ":" n "  " c}' "$f"
done
```

> ⚠️ **The `n &&` guard is load-bearing, and its absence shipped for a few hours on
> 2026-10-11.** The first version of this command omitted it, so on a file with no footer at
> all `n` stayed empty, `NR>n` was true for every line, and the command reported **579
> "hits"** — every markdown file in the repo, including the 500-odd with nothing after any
> footer, each printed as `file:  <line-count>` with a blank line number. A checker that
> cannot distinguish "no footer" from "stranded content" is the loudest possible false
> positive, and it is the same family as the placeholder-character-class bug recorded in §4:
> **the first result of a new checker must be sanity-checked against something you know is
> clean.** Fixed here; the corpus below is the guard-applied reading.

**Measured 2026-10-11, twice — and the second reading is the one to trust.** On discovery,
  with the guard applied: **29** tracked `.md` files had *something* after a footer, **12** of
  those benign (only `>`-continuation lines, i.e. the footer is a multi-line blockquote), and
  **9 live docs** carried real stranded content — `adr53-ui-vocabulary-boundary` (192 lines),
  `2026-07-20-sync-conflict-resolution-strategy` (224), `0.0.36-backlog` (156),
  `2026-09-15-frontend-architecture-todo-appraisal` (123), `2026-07-10-crdt-delta-ledger-offline-sync` (17),
  `SYSTEM_DESIGN_AND_INCUMBENT_ANALYSIS` (10), `admin-guide` (9),
  `2026-09-02-adr43-cloud-sync-performance-scaleout-roadmap` (7), `website/…/id/inventory` (1).

  All nine were then repaired in the same campaign (footers moved, content kept), so the
  **live count is now 0**. Re-measured after the fix: **19** files have something after a
  footer, **11** benign, **0 live** — every remaining hit is an exempt dated record
  (`.agents/`, `todo-`, `done-`, `plan-`): a plan appending after a footer is a plan. Do not
  exempt `docs/`. **A count in a rule is a reading, not an invariant** — this paragraph said
  "9 live docs" for hours after there were none, which is the drift this skill exists to catch,
  in the skill's own text.

---

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

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim below as original evidence:

> Audit stamp: 2026-09-22 · Budak-Korporat · status: ACCURATE — 0 findings · Audited against branch `0.0.39` at `e56bf8307`, working tree clean. Re-measured this pass: both helper scripts exist (`.agents/skills/docs-auditor/scripts/check-nav-paths.py`, `check-orphans.py`); all 12 other paths the file cites exist, including `docs/guides/developer/QUICKSTART.md`, `docs/operations/ci-pipeline.md`, `docs/specs/_active/`, `website/src/content/docs/en/user-roles.md`, `ui/src/features/staff/register.tsx` and `crates/kasirmu-hal/src/drivers/mock.rs`. The `oz-*` cross-skill-protocol drift the 18-09-26 audit found at `:260` is confirmed repaired. Left alone deliberately, as the previous pass did: this stamp's predecessor closes with `)>` rather than `-->`, which the file documents in-file as intentional and benign. · NOT re-measured: the audit-classification taxonomy's behaviour against a live document.

> Superseded audit stamp: 2026-09-08 · DSH · status: ACCURATE at audit time (0 findings on 22-09-26) (rev 8 · .agents/skills/docs-auditor/scripts/check-orphans.py went red on a file that is not in the repository - an h2-to-h4 heading skip inside references/midtrans-nodejs-client/README.md, zero tracked entries, gitignored, a vendored third-party README. Its scanner now prefers git ls-files and falls back to the old directory walk only when git cannot be consulted, so the degraded mode is "scan more", never "scan nothing". Scope rule and caution are written into §Check table. 328 markdown files scanned became 321. Verified the narrowing did not disable the check by aiming --file at that same doc, which still reports the skip and exits 1 - my first attempt at that proof was worthless and nearly read as a broken tool: I appended a level-4 heading to a tracked guide whose nearest lower heading already included a level 3, which is legal, so the probe could only ever have found nothing. A self-test that cannot fail is not a self-test. · rev 7 · .agents/skills/docs-auditor/scripts/check-dead-refs.py burned to a clean exit the same day it was added: 62 files on the first sweep to 0 live findings across 332 docs, using git-ignore awareness (one batched git check-ignore decides, so .gitignore is the policy source and not my extension list) plus two pragma forms. The distinction it buys is the useful one: a gitignored missing path is absent by design, a NON-ignored missing path means something was never committed - which is how the gap in the iOS guides was found rather than asserted. Five silent bugs caught by self-testing it: a literal dot inside a placeholder character class (blind to every file), str.lstrip("./") eating leading dots, double-reporting from two regexes, capture_output piped stdio blocked in this sandbox, and a TemporaryFile read without seek(0). The last four all failed by returning nothing, i.e. by looking clean.
-->


### Merging a stamp must not NEST a comment

A preserved superseded stamp carries its own comment delimiters. Dropping that text inside a
new comment nests the two, and **markdown comments do not nest** — the FIRST close ends the
comment, so the merge note and every preserved body after it render as **visible page text**.
Measured 2026-10-11: **45 files nested and 5 were unbalanced**, and **9 leaked** the literal
string "STAMP MERGED INTO THIS ONE" onto the page. Every batch of this campaign contributed;
it is not one author's error.

**The repair is a close-counted, per-shape edit — but it IS mechanizable if you verify each
file.** Three shapes occur, and each needs its own handling:

| Shape | Example | Fix |
|---|---|---|
| `<!-- merge marker` … `<!-- old stamp -->` … `-->` | `docs/decisions/2026-01-15-*` | de-delimit the nested opens AND strip the preserved bodies' trailing closes; keep ONE close |
| blockquote merge note (`> **STAMP MERGED …**`) over bodies with `<!--` | `docs/specs/_active/c4-*` | replace the whole blockquote region with a single comment; bodies as plain quoted text |
| plain-text merge marker above preserved bodies | `docs/decisions/2026-08-11-adr37-*` | wrap the region in one comment; de-delimit the bodies |

**Verify after every file; write only when the result is clean.** A transform that overshoots
drives `finalDepth` negative, and that is a *worse* file than the nest it replaced — two bulk
attempts on 2026-10-11 had to be abandoned for exactly that reason before the third, which
checked each output, fixed 42 of the 45.

**The checker must be line-wise, fence-aware, AND inline-code-aware.** Two false-positive
sources bit this campaign:

- **Mermaid arrows.** A non-greedy fence-strip regex (````.*?`````) mis-pairs when an
  *inline* triple-backtick appears in prose, and then counts `-->` flowchart arrows as
  comment closes — it reported `finalDepth=-4` on a clean file. Toggle fence state on a line
  that STARTS with three backticks instead.
- **Inline code.** A `-->` inside backticks (a diagram arrow in a sentence, or a doc
  documenting its own syntax) is not a delimiter. Strip `\`[^\`]*\`` spans before counting.

```bash
python3 - <<'PY'
import re, sys, pathlib
for f in sys.argv[1:]:
    lines = pathlib.Path(f).read_text(encoding='utf-8', errors='replace').replace('\r\n','\n').split('\n')
    fence = False; depth = maxd = 0
    for raw in lines:
        if raw.lstrip().startswith('```'):
            fence = not fence; continue
        if fence: continue
        line = re.sub(r'`[^`]*`', '', raw)          # drop inline code
        pos = 0
        while pos < len(line):
            o = line.find('<!--', pos); c = line.find('-->', pos)
            if o >= 0 and (c < 0 or o < c): depth += 1; maxd = max(maxd, depth); pos = o + 4
            elif c >= 0: depth -= 1; pos = c + 3
            else: break
    print(('OK ' if depth == 0 and maxd <= 1 else '!!'), f, 'finalDepth=%d maxDepth=%d' % (depth, maxd))
PY
```

`finalDepth == 0` and `maxDepth <= 1` is the only pass. A negative depth is a stray close; a
`maxDepth of 2` is a nest. **Then render-check**: strip `<!-- … -->` and confirm the first
non-blank visible line is the document's own title, not a stray `-->` or merge-note text.

**Two rules that are always safe, and worth stating because both were violated here:** never
write a comment-open token literally inside a comment (not even to explain this hazard), and
never nest a preserved stamp — quote its text, or wrap the whole region in one comment.

> last audited 11-10-26 by docs-auditor
