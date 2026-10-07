# Documentation-Code Audit — 2026-10-08

**Scope:** the live documentation surface across the repo - top-level docs, `docs/{guides,architecture,operations,security}`, the API reference, the customer-facing `website/src/content/` (docs, pricing, legal), and `docs/legal/` - plus a review of the doc-relevant checkers in `.agents/skills/docs-auditor/scripts/`.
**Method:** the docs-auditor skill's nine automated detectors, then every reported hit verified by hand against code. Independent parses were delegated to subagents and re-checked before any repair.
**Branch:** `0.0.41`. Three pathspec-scoped commits: `4a97bdcad`, `fab810e48`, `f54bbc432` (40 files, 427 insertions, 236 deletions).

---

## 1. Checker results (final snapshot)

| Checker | Result | Note |
|---|---|---|
| `check-dead-refs.py` | **0 unresolved** | 513 md scanned, 185 live / 328 historical |
| `check-orphans.py` | **0 findings** | one heading-level skip repaired |
| `check-audit-stamps.py` | **0 OLDER** | several footers bumped to their newest stamp |
| `check-nav-paths.py` | **0 drift** | after the Settings-path repairs below |
| `check-site-links.py` | **0 unresolved** | 46 content docs |
| `check-ci-claims.py` | **0 findings** | |
| `check-env-docs.py` | **0 undocumented (45/45)** | `OZ_ALLOW_INERT_RLS` documented |
| `check-adr-status.py` | **0 drift** | 59 hand-table rows |
| `check-api-surface.py` | **1 discrepancy - OPEN** | `print_edc_settlement_slip_scoped` registered in a peer uncommitted work; see section 4 |

`verify-ci-docs-drift.py` and `verify-agents-mirrors.py` (the repo's own gates) both pass.

---

## 2. What drifted, and the three patterns behind it

Grouped by CAUSE rather than by file, because the causes are what recur.

### Pattern A - commands register faster than the docs that describe them

The largest defect class. A feature that adds a command to `generate_handler!` does not touch the reference page, so the page falls behind while its own audit stamp keeps claiming completeness.

- `docs/guides/developer/api-reference.md`, 64 discrepancies (commit `4a97bdcad`): **54 rows carried the wrong availability marker** - every one said `[D]` for a command registered in BOTH shells - and **10 registered commands had no row at all**, including the three Android updater commands, which got the page first `commands::updater` section. Root cause traced to `6fe57ba17` (tablet-parity registration), which added tablet registrations and no doc rows. One row prose was stale too: `get_active_market_profile_scoped` said "Desktop-only ... not in the tablet shell" while `apps/mobile-tauri/src/lib.rs:1250` registers it.
- Final state: `registered desktop=493 tablet=413 distinct=511`, `documented 511`, all four buckets 0 - re-derived independently by a second parser before the repair was trusted.
### Pattern B - counts rot wherever nothing re-derives them

Numbers asserted in prose with no script behind them. Checkable ones were corrected; un-derivable ones were FLAGGED rather than replaced with a guess.

- `README.md`: codebase size contradicted its own cited `stats.json` (1,334,821/5,954 vs actual 1,250,487/5,730); the per-language table was regenerated so its rows sum exactly to the stats totals; test counts 9,026/623 to 9,378 `#[test]` (11,078 with `#[tokio::test]`)/654.
- `ARCHITECTURE.md`: ADRs 74 to **79**; migrations 69 to **74**; the `platform/core` tree gained the two files it omitted.
- `docs/operations/ci-pipeline.md`: body said `dev-ci.yml` "defines fourteen" while its own stamp said eighteen; measured **18 jobs**, deploy `needs:` 13.
- `docs/security/PCI-DSS_CHECKLIST.md`: migration count 67 to 74.
- `docs/guides/developer/QUICKSTART.md` and `README-technical.md`: both claimed no live workflow runs Clippy; `dev-ci.yml#cargo-clippy` does (`:326`). `scripts/gates.json`'s `rust-clippy` note is ALSO stale and is flagged as a config-registry item, not edited.
- **Flagged, not replaced** (no deriving artifact exists): `README.md`'s ">508,000 lines of test code" and `docs/operations/agent-lanes.md`'s "9,922-test suite" - both annotated in place with the measurable bases.

### Pattern C - docs asserting software mechanisms that do not exist

- `docs/guides/developer/server_performance_analysis.md` + `.env.example`: `OZ_DB_POOL_SIZE` documented as 20 in six places; code default is **8** (`apps/cloud-server/src/config.rs:226`). The doc own prior stamp had FLAGGED this; this pass fixed it rather than carrying the flag.
- `docs/guides/developer/dev-checklist.md` sections 2c/2d: listed a screen `SetupWizard.tsx` that does not exist, quoted `PaymentModal`'s gate as its own inverse, and named a quota check no production screen performs.
- `docs/legal/**`: privacy policy described **bcrypt** (code uses **Argon2id**), export formats incl. **Excel** (no writer exists), **PBKDF2** (unused), a **5-year retention** presented as a mechanism (the code prunes sync data at 90 days), and mailboxes `privacy@`/`legal@`/`support@` that appear nowhere. Entity name was inconsistent (`PT Kasirmu` vs the placeholder `PT [Nama PT Anda]`) inside an unregistered entity governing-law clause.
- `website/src/content/legal/{en,id}/privacy.md`: same bcrypt error, customer-facing.

### The QRIS case - a DECISION, not drift

Recorded separately because it is the one finding that could NOT be repaired by matching code. Three surfaces disagreed on **dynamic QRIS on the Free plan**:

- code (`SubscriptionTier::supports_qris()`, `crates/kasirmu-core/src/subscription/tier.rs:217-222`) and `subscription-tiers.md:285`: **not on Free**
- `website/src/content/pricing/en.ts:181` and the website licensing pages: **yes on Free**

The website side is an **owner ruling of 2026-09-29**, ordered website-first and pinned by `website/src/components/__tests__/pricing-content-invariants.test.ts`, whose comment states a silent revert in either direction is a product change. The ENFORCEMENT has not moved while the DECISION has. The repair therefore went to the source-of-truth doc - `subscription-tiers.md` now records the decision AND that it is not yet enforced - and NOT to the pricing data. The website customer-visible claim was narrowed to the truth (static QR on all plans; dynamic needs Plus) with the decision recorded.
---

## 3. Checker review (disposition of Option A)

The hypothesis that `check-dead-refs.py` under-covers because it grades only "13 live docs" was tested and **refuted**.

- The tool scans **513 markdown files**, of which **185 are live** and 328 historical. The "13" in its summary line is the count of live docs **WITH FINDINGS** - the `live` list is built only from docs that had hits (`main()`, lines 1245-1246) - not the count examined. The initial reading confused the two.
- Verified by injection, not inspection: a dead path planted in `website/src/content/docs/en/quickstart.md` was reported as `1 live with hits` naming the exact path, then reverted. A green that cannot be made red is not evidence, so the green was re-earned this way.
- **No change made to the checker.** Its scope rule is sound, and the `HIST_DIR_PREFIXES` exemption is deliberate and documented in-file.

One gap remains un-actioned by design: dead-ref coverage excludes prose and fenced-code references, which the tool docstring lists as known limitations.

---

## 3b. Skill drift guard (separate tool, separate corpus)

`.agents/skills/*/SKILL.md` is **skill-drift-guard's** scope, not docs-auditor's, so it was run as its own pass: `bash .agents/skills/skill-drift-guard/scripts/detect.sh`, all sixteen checks.

**Result: 2 findings, both resolved.** Both were in `.agents/skills/codebase-memory/SKILL.md`, and both were the same defect: the journal index cited without its `journal/` directory segment (the real path is `docs/records/journal/JOURNAL.md`). One was a live teaching example in the "Noise you must filter" section; the other was a superseded stamp asserting the short form among "all nine paths the skill cites exist". The live example was repointed, and the stamp — normally kept verbatim — had that single token corrected in place with the change noted inline, because it carried a verifiably false path a reader would act on.

Found and fixed while triaging, from a manual probe rather than the detector (its version check matches explicit lock assertions and did not see these): **three stale version references**. `pr-create-pull-request/SKILL.md` used the `0.0.40` branch prefix in four examples (lines 28, 101-103) while its own golden rule 6 warns that "a number written in this file silently goes stale at the next bump"; `project-scaffold/SKILL.md:190` used `0.0.40` as the current version branch. All corrected to `0.0.41`. The workspace is at `0.0.41` (`Cargo.toml`).

**One deliberate non-change, recorded because it was nearly a fabrication:** triaging `codebase-memory`'s "Indexed branch `0.0.40`" table row, I first rewrote it to `0.0.41` — then reverted, because there is no evidence the graph was rebuilt at 0.0.41 (the last documented full rebuild was 2026-09-27). The row now says `0.0.40`, labelled "as of the last full rebuild", and tells the reader to re-read it from `list_projects` rather than quoting the cell. The skill's own rule 8 — "quote the index generation alongside any number you report" — is why the version in a stale cell must not be advanced by assumption.

**Checker observation (not fixed):** `detect.sh` Check 1 extracts path tokens with an `awk` pass that has **no comment context**, so a stamp that documents a broken path is flagged as if it were a live reference — and a correction note that QUOTES the bad path re-flags itself. This is the same trap taxonomy #15 records ("do not reproduce the false phrasing ... quoting it made the guard report drift against its own skill"). The note written here therefore describes the defect without spelling the short form as a token. A comment-aware extractor would remove the class; that is a change to `detect.sh`, so it is reported rather than made.

---

## 3c. Module / crate / platform / ops READMEs (31 files)

The last surface no pass had covered. 30 of the 31 carry audit stamps, **13 of them from 2026-07-22** — a date that predates the oz-* → kasirmu-* rebrand, the store→location rename and the tablet-parity work — so the question was staleness, not virginity.

**Mechanically clean:** the dead-refs checker over this corpus reports 0 unresolved references. The drift here is **semantic** — claims about what code does.

Fixed (commit `f408108c5` plus `ca43cd6d3`):

- **`modules/loyalty/README.md` — a BOOT contract, wrong.** Declared `dependencies: ["crm"]`; the manifest, `dependencies()` (`src/lib.rs:98`) and the drift test all carry `["crm", "giftcards"]`. Not cosmetic: `namespace_grants()` names `giftcards` so loyalty may read the `gift_cards` table, and the kernel refuses to boot if a grant names an undeclared dependency. Also corrected: it described `src/models.rs` as defining the type set, when the file is now a re-export stub (`pub use foundation::loyalty::*`, moved by ADR-61 on 2026-09-28).
- **`crates/kasirmu-core/README.md` — the structural map was six modules behind.** Heading said 66 `pub mod`, measured **72**; the table had 68 rows, measured **74**. Seven modules had no row (`attestation`, `build_fingerprint`, `desktop_link`, `kasirpkg`, `server_origin`, `stock_variance`, `workspace_type`) and one row still carried the retired name `ozpkg` for `kasirpkg`. The section's own two-count explanation had stale citations too (`sync_client.rs`, `lib.rs:254`); its reasoning was re-verified and holds.
- **`ops/packaging/mobile/README.md` — described a workflow that does not run.** Its §CI/CD described TWO live pipelines; `.github/workflows/ios.yml` has been `attic/ios.yml.bak` since `23c963303` (2026-09-02). The iOS half is now marked retired with its secret manifest kept as revival documentation; the Android half was corrected against the live file (**JDK 21** not 17, explicit **NDK 30.0.14904198**, **no `cargo tauri android init`** since the scaffold is committed, and `v*`/`workflow_dispatch` only with **no PR trigger**). An internal touch-target contradiction (48px stated vs a 44×44px table) was reconciled.
- **`ops/packaging/README.md` — a certified path that does not exist.** Its 2026-07-22 stamp claimed "all referenced paths exist", including `oz-pos-updater.key`; the real key is `kasirmu-updater.key.pub`. Corrected. `/var/lib/oz-pos/` was kept but annotated — it is accurate about what `postinst`/`prerm`/`kasir.mu.desktop` still do, so it is an unresolved rebrand in the packaging layer, not doc drift.
- **`modules/currency` + `modules/staff` — stub hooks described as live.** Both presented the lifecycle hooks in the present tense ("Validates configuration", "Prepares for … operations"); both are stubs that only log, the same defect `modules/sales` had already corrected. Fixed to match.
- `modules/settings` (kernel line `:97` → `:127`), `modules/reporting` (`SaleCompletedReporter` was REMOVED by MSL-11; the README implied it was merely wired elsewhere), `crates/qris-core` (retired "oz-pos project" name; this was also the one README with no stamp at all).

**PASS (24 files, verified clean):** every other module and crate README, `platform/sync`, `ops/install`, `ops/install/win`, and the qris feature flags / lua limits / HAL traits / CLI subcommands where spot-checked.

---

## 3d. Independent verification of the availability markers

The api-reference repair was the pass with the largest volume of mechanical change — **54 rows flipped `[D]` → `[D+T]`** and 10 rows added — and it carried a specific risk: if the checker and the independent parser used to confirm it shared a blind spot (for example, matching a name in a comment rather than in the actual handler list), all 54 would be wrong in the same way and **every detector would still be green**, because the checker would be validating against its own parse. This is the "a green you can't make red is not evidence" trap the skill warns about, and no tooling in the repository can catch it.

So the markers were re-verified by a **third**, deliberately different method, reading the source rather than any parser output: each `generate_handler![ … ]` block was extracted by **brace-depth matching** over the raw file, and the command names inside it collected with a single regex. The result:

| Measure | Raw extraction | Checker |
|---|---|---|
| desktop commands | **494** | 494 |
| tablet commands | **415** | 415 |
| in both | **396** | — |

Both figures match the checker exactly, reached by different means. Then, against those raw sets:

- **All 54 flipped commands** are genuinely present in **both** shells' handler blocks — 0 exceptions.
- **All 10 added rows** carry the marker their registration implies: seven `[D+T]`, and `check_app_update`, `start_apk_download`, `prepare_and_launch_update` correctly `[T]` (absent from desktop).
- `notify_memory_pressure` and `get_build_fingerprint` independently confirmed `[T]`-only.
- **Every one of the 513 documented rows** was cross-checked against the raw sets: **0 marker mismatches**.

The marker set is therefore correct on evidence that does not depend on the checker that produced it. This is the strongest verification in the audit: three independent instruments (the shipped checker, a subagent's parser, and direct brace-matched extraction) agree.

---

## 3e. Pattern A recurred the same day — the value of a re-runnable check

Four KDS commands landed on the tablet shell **after** this audit's repair was committed (tablet 415 → 419; `distinct` stayed 513, because all four already existed on desktop). Their reference rows were marked `[D]`.

Fixed in `5535ec01d`: `list_kds_devices_scoped`, `register_kds_device_scoped`, `get_kds_routing_rules_scoped` and `save_kds_routing_rules_scoped` are each present in BOTH `generate_handler!` blocks and are now `[D+T]`. Confirmed by brace-matched extraction of the raw files, not by the checker; the re-sweep gave **0 marker mismatches across all 513 rows** and **0 registered-but-undocumented**.

This is worth recording for what it demonstrates rather than as a finding: **the drift this audit fixed is not a one-off.** Pattern A ("commands register faster than the docs that describe them") reproduced within hours of the repair, from unrelated feature work by another session — which is the argument for the gate rather than the pass. `check-api-surface.py` caught it on the next run with no human intervention, and the page's own `CLEAN` claim is now a property a script re-establishes rather than a statement someone once verified.

## 3f. A checker change investigated and REJECTED on evidence

`detect.sh` Check 1 (paths) extracts tokens from a SKILL.md by piping the file straight into an `awk` pass (line 426). Its siblings — Checks 11–15 — instead run through `strip_skill_comments()` (line 713), which blanks HTML stamp comments. So Check 1, alone, has no comment context: a stamp that *documents* a broken path is read as a live reference to one.

This looked like the same "gate that cries wolf" class the script's own comments call its worst failure mode, and it had already bitten once in this audit — the correction note written for `codebase-memory/SKILL.md` had to be worded to avoid spelling the dead path as a bare token, because quoting it re-flagged the line. The obvious fix was to route Check 1 through the existing helper.

**The fix was measured before it was made, and the measurement says no.** Against a faithful copy of Check 1's extractor, comparing the tokens found with comments intact against those found with comments stripped:

| Question | Result |
|---|---|
| Does Check 1 flag anything today? | **No** — "No drift detected" |
| Tokens comment-stripping would remove from the flag-eligible set | **2**, both the same value: `crates/oz-` |
| What are those two? | A regex-truncation artifact of `crates/oz-*`, already suppressed by the skip at line 378 (`*[-.]|*...|*..`) — **not currently flagged** |
| What stripping would COST | It would blind Check 1 to **real repo paths cited only inside stamps** — `ui/src/theme/tokens.css`, `ui/src/contexts/ZoomContext.tsx`, `crates/kasirmu-core/src/money.rs`, `assets/branding/default/`… and the `docs-auditor` script paths all appear ONLY in comments and are validated today |

The change would trade **real coverage for zero benefit**: it suppresses no finding and hides several real paths from the one check that verifies them. That is exactly the weakening the script's own comment at lines 402–408 warns against — a shape-based sentinel was tried there and had to be removed because it "also swallowed real 4+-slash repo paths". Not weakened on this pass either.

**NOT CHANGED.** The residual issue is far narrower than it first appeared, and is stated here so the next reader does not re-investigate it: a stamp naming a genuinely dead path will be flagged, and the remedy is to describe the defect without writing the path as a bare token — which is how the `codebase-memory` correction note is now written.

## 3g. A process proposal investigated and NARROWED on evidence

The first pass of this audit repaired `cargo fmt` drift in CI (**17 files**). A second pass, after the branch moved 35 commits, repaired it again (**2 files**). Two occurrences in one session prompted a proposal: reinstate `cargo fmt --check` as a pre-commit step, which would catch the class at commit time instead of in CI.

**Reading the history first showed the original proposal was wrong.** The gate existed and was removed deliberately on 2026-09-13. The recorded reason is specific:

> Removed 2026-09-13: the `cargo fmt --all` pre-commit step (**reformatted other agents' in-flight files**).

and `.githooks/pre-commit:4-6` carries the same note. That is the shared-index hazard: this checkout has several agents committing concurrently, and a commit-time `--all` rewrite touches every `.rs` in the tree, including files another lane is mid-edit on. The removal was correct and this audit should not have assumed otherwise.

**A narrowed version does survive the objection, and was measured rather than argued:**

| Question | Measurement |
|---|---|
| Does `--check` mutate the working tree? | **No** — `git status --porcelain` before and after a run are byte-identical |
| Cost per invocation | **2.95s** |
| What the removed step ran | `cargo fmt --all` (the **write** form) |
| What it would run | `cargo fmt --all -- --check` (**read-only**) |

So the hazard the removal cites does not apply to the check-only form: it reports a file list and blocks, instead of rewriting anyone's in-flight work. Where it still differs from the status quo is that it moves a 2.95s cost onto **every Rust commit from every agent**, and would require editing `.githooks/pre-commit` and AGENTS.md §2 — and it re-opens a decision an owner already weighed once.

**NOT CHANGED.** Left as a recorded recommendation rather than applied, on the grounds that reversing a deliberate, documented process decision is the owner's call and not an audit's. The measurements above are the part worth keeping: whoever next considers this does not have to rediscover that `--check` is safe and that the removal concerned the write form. Both fmt repairs in this session are committed (`780b0d51a`, `cc557b083`).

---

## 4. Outstanding

- ~~**`check-api-surface.py` reports 1 discrepancy: `print_edc_settlement_slip_scoped`.**~~ **CLOSED** (commit `8c3e86eff`). The deferred rows were added once the peer's work landed in HEAD: `print_edc_settlement_slip_scoped` `[D+T]` and `notify_memory_pressure` `[T]`. **All nine docs detectors now pass.**
- ~~`website/src/content/docs/en/user-roles.md` has an internal contradiction (a "## The planned model" section vs a later line saying the four gaps are closed).~~ **CLOSED 2026-10-07** (commit `3f638ce6c`). It was not deliberate history: the matrix IS the shipped model — `platform/core/src/rbac_presets.rs:164` describes Staff as a "Checkout-operations role" with exactly the column the table shows and none of the management ones the old heading implied. Heading corrected to "The model in force" in BOTH languages (the `id/` copy carried the same defect), with the anchors re-verified (`#implementation-status`, `#status-implementasi`).
- ~~`scripts/gates.json`'s `rust-clippy` `_note` still asserts no live workflow runs Clippy.~~ **CLOSED 2026-10-07** (commit `d963b3bc9`). The note was self-refuting on the numbers it volunteered: it claimed "clippy occurs 0 times in both dev-ci.yml and release.yml", and `dev-ci.yml` has **11** with a live `cargo-clippy` job at `:326`. Corrected while keeping the half that is still true (the pre-push hook genuinely runs no clippy at any tier), so the note no longer trades one error for another.
- `docs/records/**`, `docs/decisions/**` and `docs/specs/**` were left alone: dated records are exempt by convention, and editing one falsifies it.

> last audited 08-10-26 by docs-auditor
