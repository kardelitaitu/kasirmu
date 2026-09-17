---
name: pr-create-pull-request
description: Systematic workflow for creating comprehensive, high-quality pull requests in kasir.mu using GitHub CLI (gh). Covers inspecting git history (last 50-100 commits), branch-prefixed naming conventions, generating structured PR descriptions, and safe push authorization.
---

<!-- Audit stamp: 2026-09-03 · DSH · status: ACCURATE (rev 3 — version lock corrected 0.0.31 → 0.0.35; poll-pr-checks.ps1 corrected to the real scripts/poll-pr-checks.sh; title examples moved to the current release branch; the feat/ branch example removed per the never-create-branches repo policy; the crates/oz-* glob prose reworded — rev 3 only respells that phrase so the skill-drift scanner's crate-name grep no longer reads it as a missing crate) · verified this pass: scripts/poll-pr-checks.sh, scripts/lint-i18n.sh, scripts/verify-bundle-parity.py exist; gh pr create/edit/checks workflow unchanged -->

# PR Create — Creating Pull Requests with History-Driven Descriptions

This skill defines the standardized workflow for opening new pull requests against the kasir.mu repository using the GitHub CLI (`gh`). It enforces the branch-prefixed PR title convention and guides generating a comprehensive PR description by analyzing the recent 50 to 100 commits.

---

## When to use

- A feature, bugfix, refactor, or CI repair is completed, committed, and verified locally.
- You are preparing to open a new Pull Request targeting `main`.
- You need to summarize a large batch of commits (up to 50–100 commits) into a structured, reviewable PR body.

---

## Golden Rules

| # | Rule | Why |
|---|------|-----|
| 1 | **Title format: `<branch_name> <summarized title>`.** | Must always prefix with the current branch name (e.g. `0.0.39 fix(ci): repair Trivy SARIF upload, KDS E2E tests...`). |
| 2 | **Comprehensive descriptions from commit history.** | Always inspect the last 50 to 100 commits (`git log -n 100 --oneline` or `git log origin/main..HEAD --oneline`) and summarize key changes grouped by domain. |
| 3 | **Base branch is always `main`.** | All PRs in kasir.mu target `main` unless the user explicitly specifies another target. PRs are opened **from the current active branch only** — the repo policy forbids creating or switching branches. |
| 4 | **Never `git push` without explicit user permission.** | Before pushing local commits or branch to remote, you MUST present the plan to the user and obtain explicit push authorization. |
| 5 | **Local verification first.** | Ensure relevant tests (`cargo test`, `npm run typecheck`, `scripts/lint-i18n.sh`) and pre-commit gates pass before creating the PR. |
| 6 | **Version is locked at `0.0.39`.** | Never bump or change version numbers in manifest files. |

---

## The 6-Phase Creation Loop

```
┌───────────────────┐     ┌───────────────────────┐     ┌───────────────────────┐
│ 1. Verify Clean   │ ──> │ 2. Inspect History    │ ──> │ 3. Generate PR Body   │
│ & Target Branch   │     │    (50–100 Commits)   │     │    File (pr_body.md)  │
└───────────────────┘     └───────────────────────┘     └───────────────────────┘
                                                                    │
                                                                    ▼
┌───────────────────┐     ┌───────────────────────┐     ┌───────────────────────┐
│ 6. Verify & Track │ <── │ 5. Create PR with     │ <── │ 4. Ask User for Push  │
│    CI Checks      │     │    `gh pr create`     │     │    Authorization      │
└───────────────────┘     └───────────────────────┘     └───────────────────────┘
```

---

### Phase 1 — Verify Clean State & Target Branch

Confirm your current branch and ensure all changes are committed:

```powershell
# 1. Determine current active branch
$CURRENT_BRANCH = git branch --show-current
Write-Host "Current branch: $CURRENT_BRANCH"

# 2. Check working tree status
git status
```

> [!WARNING]
> If there are uncommitted changes or unstaged files, review and commit them first. Do not open a PR with uncommitted work pending.

---

### Phase 2 — Inspect Git History (Last 50–100 Commits)

To produce an accurate, detailed PR description, examine both the recent commit history and the overall file diff:

```powershell
# 1. Extract the last 50 to 100 commits on this branch
git log -n 100 --oneline --no-merges

# 2. Alternatively, inspect commits that are ahead of origin/main
git log origin/main..HEAD --oneline --no-merges

# 3. Inspect high-level file diff statistics
git diff origin/main..HEAD --stat
```

Categorize the findings into the following domains:
- **Rust Backend:** Changes across the `kasirmu-*` crates under `crates/`, `apps/desktop-tauri/src/commands/`, `apps/cloud-server/`, database migrations.
- **Frontend / UI:** Changes in `ui/src/features/`, `ui/src/components/`, styles, React state, or `@fluent/react` translations (`.ftl`).
- **CI / DevOps & Infrastructure:** Changes in `.github/workflows/`, `scripts/`, Dockerfiles, or security scanning configs.
- **Documentation & Architecture:** Changes in `docs/`, `AGENTS.md`, or `.agents/skills/`.

---

### Phase 3 — Generate PR Title and PR Body File

#### 1. Title Convention
Format: `<branch_name> <type>(<scope>): <summary>`

Examples:
- `0.0.39 fix(ci): repair Trivy SARIF upload, KDS E2E tests, tablet touch targets, and CI docs drift`
- `0.0.39 feat(payment): add QRIS payment processor and terminal fallback`
- `0.0.39 docs(agents): revise ui-components skill with design-language reference`

#### 2. Body Structure (`pr_body.md`)
Create a markdown file (e.g. `pr_body.md` at repo root) containing structured sections:

```markdown
## Summary
A concise executive summary (2-4 sentences) explaining what this pull request introduces or fixes, and the motivation behind it.

## Key Changes
Detailed, domain-specific bullet points synthesized from the commit history:

### 1. Rust Backend & Database
- Detail change A (e.g. Added transaction safety to SQLite sync worker).
- Detail change B.

### 2. UI & Frontend (React / TypeScript)
- Detail change C (e.g. Updated touch target dimensions from 40px to 44px in `StaffLoginScreen.css`).
- Detail change D (e.g. Added Fluent localization keys for receipt refund actions).

### 3. CI, Scripts & Infrastructure
- Detail change E (e.g. Upgraded Trivy security action to v0.42.0 to resolve SARIF upload errors).
- Detail change F.

## Commit History Highlights
A curated chronological list of the most impactful commits from the 50–100 commit analysis:
- `<hash>` - `<commit title>`: Brief note on why this was done.
- `<hash>` - `<commit title>`: Brief note on why this was done.

## Verification & Testing
Checklist of local test suites and verification gates passed:
- [x] Rust unit / integration tests: `cargo test -p <crate>`
- [x] UI unit / typecheck: `npm run typecheck`, `npm run test`
- [x] Localization parity: `bash scripts/lint-i18n.sh` & `python scripts/verify-bundle-parity.py`
- [x] Formatting: `cargo fmt --all -- --check`

## Files Changed
- High-level list of key files modified, added, or deleted.
```

---

### Phase 4 — Request Push Authorization

> [!IMPORTANT]
> **REPOSITORY RULE: NEVER run `git push` without an explicit direct instruction from the user.**
> Even when local verification is 100% complete and `pr_body.md` is ready, stop and present the generated title, summary, and push command to the user for approval.

Present the proposed PR details:
> *"I have prepared the PR title and comprehensive description based on the last 100 commits. Please confirm if I should push branch `<branch_name>` to remote and create the PR."*

---

### Phase 5 — Push & Create Pull Request

Once the user explicitly confirms to push, run:

```powershell
# 1. Push branch to remote
git push origin $(git branch --show-current)

# 2. Create the Pull Request using gh CLI
gh pr create `
  --base main `
  --head $(git branch --show-current) `
  --title "$CURRENT_BRANCH <summarized title>" `
  --body-file pr_body.md
```

If an active PR already exists for this branch, update it instead of creating a duplicate:
```powershell
# Update title and body of existing PR
gh pr edit <PR_NUMBER> --title "$CURRENT_BRANCH <summarized title>" --body-file pr_body.md
```

---

### Phase 6 — Post-Creation Verification & CI Tracking

After creation, verify the PR metadata and track CI progress:

```powershell
# 1. View the newly created PR
gh pr view

# 2. Inspect CI workflow execution status
gh pr checks

# 3. Monitor checks with 30s interval, failing fast on early failure:
gh pr checks --watch --fail-fast -i 30
# Or: bash scripts/poll-pr-checks.sh
```

---

## Quick Reference CLI Commands

| Task | Command |
|---|---|
| Read last 100 commits | `git log -n 100 --oneline --no-merges` |
| Read branch commits vs main | `git log origin/main..HEAD --oneline --no-merges` |
| View file change stats | `git diff origin/main..HEAD --stat` |
| Create PR from body file | `gh pr create --base main --head <branch> --title "<branch> <title>" --body-file pr_body.md` |
| Update existing PR body | `gh pr edit <PR_NUMBER> --body-file pr_body.md` |
| Check PR CI status | `gh pr checks <PR_NUMBER>` |

> last audited 18-09-26 by Budak-Korporat
