# Contributing to OZ-POS

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (4 doc drifts fixed, 2 enforcement gaps recorded) · SUPERSEDES the 2026-07-22 stamp, whose two findings are carried forward here rather than stacked below it · FIXED: (1) F1 from 2026-07-22 — found and then never repaired for 48 days: `fix` was listed as a forbidden commit prefix while .githooks/commit-msg accepts it, `fix/<name>` is a documented branch prefix, and `fix(payment):` appears as a correct example in the same section, so the doc's own example violated its own rule and every agent reading it inherited a false constraint. (2) "type matches the branch prefix" restated against the live TYPES list (10 accepted types, 6 branch prefixes; style/perf/ci/audit have no prefix). (3) the skill-anatomy list now marks which of its six items a machine actually enforces — only the footer (Check 9) — and records that 4 of 13 skills lack "When to use" and 2 lack "Common pitfalls". · FLAGGED NOT FIXED: "the skill-drift-guard script will catch the omission on the next CI run" (a new skill missing from the onboarding router) is FALSE — Check 6 is one-directional; proved by creating a valid throwaway skill and getting exit 0 with no findings. Corrected to "by hand, because nothing checks it"; adding the reverse check to Check 6 is a code change and was not made. · verified accurate: all 8 quick-link targets resolve including the ui/README.md#install-script-approvals anchor (heading at ui/README.md:36); F2 from 2026-07-22 still holds — SECURITY.md remains absent and the reference stays hedged, so it is consistent rather than correct; PR commands still match AGENTS.md · RE-AUDITED 2026-09-09 by DSH (docs-auditor): the PR-gate section was wrong about CI and my own 09-08 pass missed it. CONTRIBUTING claimed the CI coverage job uploads coverage artifacts; no coverage job exists in either live workflow - it lived only in .github/workflows/ci.yml.bak, retired by 23c96330 on 09-02 and never restored, so nothing uploads them. The optional-and-not-a-gate sentence next to it was already correct, which is how the pair read as consistent. Warned about the near-miss too: dev-ci.yml#static-gates has a step named 'Scoped command coverage' running bash scripts/verify-scoped-coverage.sh, which checks IPC _scoped-command parity and emits no artifact - grepping the word coverage in dev-ci.yml finds it and would re-validate the false claim. Added the platform warning that bare bash on this Windows workstation is WSL and can hang rather than fail (AGENTS.md), since this section instructs bash scripts/coverage.sh, scripts/reset-dev-pg.sh and detect.sh; the pwsh reset-dev-pg.ps1 line is the unaffected Windows-native form. Re-confirmed true: scripts/coverage.sh, scripts/reset-dev-pg.sh, scripts/reset-dev-pg.ps1 and .agents/skills/skill-drift-guard/scripts/detect.sh all exist, detect.sh does accept --report (usage at :9, parsed at :38), coverage.sh takes rust|ui via target=\"${1:-all}\" as documented, and its preflight reports missing cargo-llvm-cov/llvm-cov/ui deps rather than half-running. --> · REV 2 (same day): a fourth drift, found while auditing docs/operations/ci-pipeline.md — §Flaky tests told contributors that "the flaky-quarantine job (required in CI) runs scripts/verify-flaky-quarantine.py". No such job exists in either live workflow (grep -ci flaky dev-ci.yml = 0), check.sh never calls it, and gates.json records the gate as retired with no runner. The script works; nothing runs it, so an expired quarantine entry fails nothing. Item 3 rewritten to say so and the closing sentence no longer promises a gate that will fire. · REV 3 (09-09-26, docs-auditor, CI-claim pass) — status: ACCURATE AFTER REPAIR (3 findings from .agents/skills/docs-auditor/scripts/check-ci-claims.py). Rev 2 fixed only the quarantine item; the section still asserted a nightly schedule two lines above it. Repaired: "The nightly `flaky-detect` job runs it on a schedule and uploads the report" — that job exists only in `.github/workflows/nightly.yml.bak` (job list at `nightly.yml.bak`, incl. `flaky-detect`), renamed `.bak` by `23c963303` on 2026-09-02; neither live workflow declares a `schedule:` trigger, so nothing runs `scripts/report-flaky.sh` any more, and `scripts/gates.json` records `nightly-flaky-detect` as retired with no `ci` block. Also re-flowed the rev-2 item 3 so its own refutation sits on the same line as the job name (the checker is line-scoped, so a claim split across wrapped lines read as an unhedged assertion), and corrected its step count: `static-gates` has 28 named steps, not 29 — re-measure with grep -c '^      - name:' on the static-gates block, since 0938af645 removed one gate step earlier this week. Verified true and left alone: all ten `dev-ci.yml` job names still match the workflow, `scripts/flaky-quarantine.json` + `scripts/verify-flaky-quarantine.py` + `scripts/report-flaky.sh` all exist (git ls-files), and the "an expired quarantine fails nothing" consequence is unchanged.

Thanks for your interest in OZ-POS! This project is a Rust + Tauri v2 POS framework built around a "wizard behind the curtain" philosophy: the merchant sees effortless checkout, and the lean Rust engine silently handles transactions, encryption, hardware, sync, and business logic.

This guide covers how to contribute effectively. The full project conventions live in `AGENTS.md` (the source of truth for coding standards) and the skills under `.agents/skills/` (the source of truth for how to do specific tasks).

---

## Quick links

| Document | What it's for |
|----------|---------------|
| [`AGENTS.md`](./AGENTS.md) | Project-wide coding standards (Rust, Tauri, UI, testing, Git) |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Directory layout and module responsibilities |
| [`ROADMAP.md`](./docs/guides/product/ROADMAP.md) | Phased milestones |
| [`WHITEPAPER.md`](./docs/guides/product/WHITEPAPER.md) | Design rationale, tech choices, database strategy |
| [`docs/guides/developer/QUICKSTART.md`](./docs/guides/developer/QUICKSTART.md) | First-time local setup and build |
| [`.agents/skills/onboarding-guide`](./.agents/skills/onboarding-guide/SKILL.md) | Meta-skill that routes you to the right specialized skill |
| [`.agents/skills/skill-drift-guard`](./.agents/skills/skill-drift-guard/SKILL.md) | Detects and patches skill drift — run before opening a PR |

---

## Code of conduct

Be respectful, assume good faith, and keep feedback focused on the work. We are building software that handles real money for real merchants — rigor and care matter more than speed.

---

## Before your first commit

1. **Read [`AGENTS.md`](./AGENTS.md)** — it defines the non-negotiables (Money struct, rusqlite transactions, thiserror/anyhow, clippy `-D warnings`, Conventional Commits, etc.).
2. **Read [`docs/guides/developer/QUICKSTART.md`](./docs/guides/developer/QUICKSTART.md)** — get the project building locally first.
3. **Read the relevant skill** under `.agents/skills/` (the onboarding guide will route you).
4. **Skim [`ROADMAP.md`](./docs/guides/product/ROADMAP.md)** so you know what's in scope and what's deferred.

If your change touches more than one layer (Rust core, Tauri IPC, UI, HAL, project structure), read each relevant skill in layer order: `rust-backend` → `tauri-ipc` → `ui-components` → `hal-drivers`.

---

## Branch naming

| Prefix | When to use | Example |
|--------|-------------|---------|
| `feat/<name>` | New feature, capability, or user-visible change | `feat/cart-line-discount` |
| `fix/<name>` | Bug fix | `fix/cart-overflow-on-coupon` |
| `docs/<name>` | Documentation only | `docs/i18n-contributor-guide` <!-- dead-ref: ok: an invented example subject, not a path claim --> |
| `chore/<name>` | Maintenance, deps, config, refactor with no behavior change | `chore/bump-tauri-v2.1` |
| `test/<name>` | Test additions or fixes | `test/integration-sales-flow` |
| `refactor/<name>` | Code restructuring, no behavior change | `refactor/extract-payment-port` |

`<name>` is kebab-case, short, and describes the change. The branch is deleted after merge.

---

## Commit messages (Conventional Commits)

```
<type>(<optional scope>): <short summary> [optional body] [optional footer(s)]
```

- `type` is one of the ten the commit-msg gate accepts: `feat`, `fix`, `docs`,
  `style`, `refactor`, `perf`, `test`, `ci`, `chore`, `audit` — read live from
  `.githooks/commit-msg` (`TYPES=\`), never from this page. Six of them have a matching
  branch prefix (see above); `style`, `perf`, `ci`, `audit` do not, so "type matches the
  branch prefix" is a guideline for feature work, not the acceptance rule.
- Summary is ≤ 72 characters, imperative mood ("add" not "added").
- Body explains *why*; the diff shows *what*.
- Footer for breaking changes: `BREAKING CHANGE: <description>`.

**Examples:**

```
feat(cart): apply line-level discounts before tax

Line-level discounts were applied after tax computation, producing
incorrect totals for high-tax jurisdictions. Apply discounts to the
line subtotal first, then tax the discounted amount.

Closes #142
```

```
fix(payment): retry once on transient network errors

Stripe occasionally returns 502 on authorization. A single retry with
a 250ms backoff recovers most cases without idempotency risk.
```

**Forbidden prefixes:** `update`, `changes`, `wip`, `minor`. These are too vague, and
the gate rejects them.

> **`fix` was on this list until 08-09-26 — it is not forbidden.** `.githooks/commit-msg`
> accepts it (`TYPES='feat|fix|docs|style|refactor|perf|test|ci|chore|audit'`),
> `fix/<name>` is a documented branch prefix two sections above, and `fix` is the most
> common type in the log. The list contradicted the gate it describes, and an agent
> following it would have reached for `refactor` or `chore` on a bug fix to avoid a
> rejection that was never coming.

---

## Adding a new skill

Skills are the project's living documentation. When you discover a pattern that the skills don't cover — a new crate convention, a new CI check, a new accessibility rule — write a new skill under `.agents/skills/<skill-name>/SKILL.md`.

**Anatomy of a good skill** — items 1–5 are convention, item 6 is the only one a
machine enforces:

| # | Element | Enforced? |
|---|---------|-----------|
| 1 | YAML frontmatter with `name` and `description` (the description is what the agent router matches against) | no |
| 2 | "When to use" section — explicit trigger conditions | no |
| 3 | "Golden rules" table — the non-negotiables for this area | no |
| 4 | Concrete examples with copy-pasteable code | no |
| 5 | "Common pitfalls" section at the end | no |
| 6 | Footer `> last audited <DD-MM-YY> by <who>` | **yes** — `detect.sh` Check 9 (shape + real calendar date + within 30 days) |

Measured on 08-09-26, 4 of the 13 skills have no "When to use" heading and 2 have no
"Common pitfalls", so the list above is a target, not a description of the corpus. If
you add a skill, matching items 1–5 is still the right thing to do — just do not assume
CI will tell you.

After adding a skill, update `.agents/skills/onboarding-guide/SKILL.md` so the router
table points to it — **by hand, because nothing checks it.** `skill-drift-guard` Check 6
runs in one direction only: it flags a router row whose token resolves to nothing. A
skill that exists and is never mentioned produces no token, so there is nothing to flag.
Verified 08-09-26 by creating a throwaway `.agents/skills/zz-probe-test/SKILL.md` with a
valid footer and running `detect.sh --check=refs`: **exit 0, no findings** (the probe was
deleted immediately after). The claim this paragraph replaces was that the script "will
catch the omission on the next CI run". Adding the reverse-direction check to Check 6
would make that claim true again; it has not been added, because that is a code change.

---

## Before opening a PR

Run the local checks (the CI matrix is the source of truth, but a local pass catches 90% of issues):

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
cargo audit
cargo deny check
```

For UI changes:

```bash
cd ui && npm run lint && npm run typecheck && npm run test && npm run build
```

> If `npm ci` warns about unapproved install scripts when adding or updating UI dependencies, see [`ui/README.md#install-script-approvals`](./ui/README.md#install-script-approvals) for how to approve them.

For coverage spot-checks (optional, not part of the PR gate yet):

```bash
bash scripts/coverage.sh         # rust + ui (default target: all)
bash scripts/coverage.sh rust    # just rust
bash scripts/coverage.sh ui      # just ui
```

Reports land in `coverage/{rust,ui}/index.html`.

> ⚠️ **There is no CI coverage job.** This sentence previously said the CI `coverage` job
> uploads these artifacts. It does not: a `coverage:` job exists in exactly one workflow file,
> `.github/workflows/ci.yml.bak`, which `23c96330` retired on 09-02 and never restored, and the
> three live workflows (`dev-ci.yml`, `release.yml`, `android.yml` — `ls .github/workflows/*.yml`) contain no such job. Nothing uploads coverage
> today, which is consistent with the line above calling coverage optional and "not part of the
> PR gate" — the gate sentence was right and the CI sentence was not.
>
> Do not be reassured by grepping for the word: `dev-ci.yml#static-gates` has a step named
> **"Scoped command coverage"** (`bash scripts/verify-scoped-coverage.sh`), and that checks
> whether every registered IPC command has a `_scoped` twin. It has nothing to do with test
> coverage and produces no artifact.

> ⚠️ **On this Windows workstation, run these through Git's bash by full path.** Bare `bash`
> resolves to `C:\Windows\System32\bash.exe` (WSL), which can hang instead of failing — see
> "Running CLI Tools on Windows" in `AGENTS.md`. Use
> `& 'C:\Program Files\Git\bin\bash.exe' scripts/coverage.sh` rather than assuming a timeout
> means the script is broken. The same applies to `scripts/reset-dev-pg.sh` and `detect.sh`
> below; the `pwsh` line for `reset-dev-pg.ps1` is the Windows-native alternative and is
> unaffected.s on every push to `main`. Use them to spot under-tested modules after refactors.

If a PostgreSQL integration test skips with `Migration error` (the dev DB drifted from the committed `PG_INIT` schema), reset the dev container before running the suite:

```bash
bash scripts/reset-dev-pg.sh          # bash (Linux/WSL/Git Bash)
pwsh scripts/reset-dev-pg.ps1        # Windows PowerShell
```

If your change touches something a skill describes (a path, a type, a trait, a dependency version, a golden rule), run the drift guard before opening the PR:

```bash
bash .agents/skills/skill-drift-guard/scripts/detect.sh --report
```

If the report surfaces findings, fix them in the same PR. If a finding is wrong or out of scope, open an issue.

---

## PR checklist

- [ ] `cargo fmt --all -- --check` passes
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` passes
- [ ] `cargo test --workspace --all-features` passes on Linux, Windows, macOS
- [ ] `cargo audit` and `cargo deny` are clean
- [ ] `cd ui && npm run lint && npm run typecheck && npm run test && npm run build` all pass (if UI changed)
- [ ] `skill-drift-guard` reports zero manual findings (or findings are addressed in this PR)
- [ ] No `.env`, `.db`, `*.key`, or `target/` files in the diff
- [ ] Commit messages follow Conventional Commits
- [ ] Branch name matches the change type
- [ ] If a spec was opened for this change, its folder was moved from `docs/specs/_active/` to `docs/specs/_done/`
- [ ] Public items have `///` doc comments
- [ ] New skills are added to `onboarding-guide`'s router table
- [ ] User-visible strings use `@fluent/react` (no hardcoded English in JSX)
- [ ] Money is `i64` minor units, never `f32`/`f64`
- [ ] All database writes happen inside a `rusqlite::Transaction`

---

## Reviewing a PR

When reviewing, focus on:

1. **Correctness first.** Does the change do what it claims? Are there edge cases the tests miss?
2. **Standards compliance.** Run `cargo fmt --check`, `cargo clippy -- -D warnings`, and the drift guard. Don't merge if they fail.
3. **Money safety.** Any change touching `Money`, currency, or totals gets a second look.
4. **Database writes.** Any new write path must use a `Transaction`. No exceptions.
5. **Public API surface.** Public items need `///` docs. Trait changes need an ADR or spec note.
6. **Skill alignment.** Does the change match what the relevant skill says? If not, either the change is wrong or the skill is.

Be specific in your review comments. "This is wrong" is not actionable; "This Money conversion can overflow when the cart total exceeds i64::MAX / 100" is.

---

## Flaky tests (AUDIT-27 CI-09)

Flaky tests are detected with `scripts/report-flaky.sh` (runs the suite N
`--runs` times and lists tests that fail intermittently). **Nothing runs it on a
schedule for you.** It used to be the nightly `flaky-detect` job, which lived in
`nightly.yml`; `23c963303` renamed that whole workflow to
`.github/workflows/nightly.yml.bak` on 2026-09-02 and GitHub never executes a
`.bak` file, so no scheduled workflow exists at all — `dev-ci.yml` triggers on
`pull_request` targeting `main` plus `workflow_dispatch`, `release.yml` on `v*`
tags, and neither declares a schedule. `scripts/gates.json` records the gate as
`nightly-flaky-detect`, status `retired`, no `ci` block. Run it by hand: from
Git bash on Windows, `& 'C:\Program Files\Git\bin\bash.exe' scripts/report-flaky.sh --runs 5`.

Quarantining a test is a **documented, temporary, enforced** action — it is
not a permanent exclusion:

1. **Investigate first.** Re-run the test a few times and look for a root
   cause (race, shared state, timing, network). Fixing is always preferred.
2. **Quarantine via the manifest only.** Add an entry to
   `scripts/flaky-quarantine.json` with `test`, `owner`, `issue` (URL or
   `#NN`), `reason`, `date`, and `expiry`. Optionally tag the test with
   `#[cfg_attr(feature = "slow-tests", ignore)]` as the report suggests.
3. **Nothing enforces the loop.** Until 08-09-26 this page presented the
   `flaky-quarantine` job as required in CI. It is not — no such job exists in
   either live workflow, and the file that made that statement true was itself
   retired: `ci.yml` defined the job (manifest check at
   `.github/workflows/ci.yml.bak:1061-1067`) and `23c963303` renamed that whole
   workflow to `.bak` on 2026-09-02 without a replacement. `dev-ci.yml`'s eleven jobs
   are `changes`, `website`, `cargo-check`, `cargo-nextest`, `ui-test`, `i18n`,
   `ci-docs-drift`, `static-gates`, `release-readiness`, `release-bridge-test`, `northflank-deploy`, and
   none of its 28 `static-gates` steps is it. Re-measure either claim with
   `grep -ci flaky .github/workflows/dev-ci.yml`, which returns **0**, and
   `check.sh` does not call it either. The script itself exists and works — run by hand it prints `PASS:
   quarantine manifest valid (0 entries, none expired)` — but nothing invokes it,
   and `scripts/gates.json` records the gate as **retired** with no CI runner.
   **The consequence is the part to internalise:** an expired quarantine entry
   will not fail anything. It will simply sit there, silently skipping a test
   past the date someone decided was the deadline. The registry's expiry field is
   a promise nobody keeps.
4. **Critical-path tests cannot be quarantined silently.** If a test
   covers a critical path, open the issue and get review sign-off on the
   quarantine before adding it.

A quarantined test is a debt item: it must be fixed before the entry's
`expiry`. Nothing will tell you when it passes — run
`python3 scripts/verify-flaky-quarantine.py` yourself, or add the call to
`check.sh` / `dev-ci.yml#static-gates` (a code change, deliberately not made here,
and it needs a `gates.json` record too or the drift checker will not see it).

---

## Reporting issues

Open a GitHub issue with:

- A clear, specific title
- Steps to reproduce (for bugs) or the user story (for features)
- Expected vs actual behavior
- Platform (Windows, Linux, macOS, Android, iPad) and version
- Relevant logs or screenshots
- A link to the relevant skill (if the issue is a skill/code mismatch)

For **security issues**, do **not** open a public issue. Email the maintainers directly (see `SECURITY.md` when it exists; until then, use the GitHub security advisory flow).

---

## License

By contributing, you agree that your contributions will be licensed under the same proprietary license as the project (see [`LICENSE`](./LICENSE)). OZ-POS is proprietary and confidential — copyright remains with the OZ-POS Contributors.

---

> last audited 09-09-26 by docs-auditor
