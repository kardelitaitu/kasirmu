#!/usr/bin/env python3
"""verify-root-policy.py — gate the repo root against regrowth (P8).

Why this exists. The root-junk census (todo-project-folder-restructure.md §5,
Pile C) found scratch artifacts that survive precisely because they are
gitignored: `git status` stays clean, so nothing ever prompts a look — and on a
branch where several agents commit in parallel, clean status output is a
coordination primitive. Worse, EMPTY directories are invisible to git even
unignored: git neither tracks nor reports them, so no git-based check can see
that class at all. This gate is the only detector for both.

What it enforces (§5 "Root holds only files a tool discovers by name at the
project root, plus the four human entry points"):

  1. every FILE directly in the repo root must be in the static allowlist
     below. A new root file is a conscious policy decision: extend the list in
     the same commit that adds the file. Gitignored regrowth of the deleted
     Pile C artifacts (`pr_body.md`, `skill-drift-report.md`, `.dsh-*.log`,
     root `__pycache__/`) fails here even though git stays silent about it.
     `.env` is deliberately allowed: it is the gitignored local secrets file
     documented in AGENTS.md, not scratch.
  2. no EMPTY directory anywhere the sweep walks (the plan's own `find`
     exclusions: `.git`, `node_modules`, and any `target` directory — build
     output is not structure). `find` is the only detector for this class, so
     the gate performs the walk itself.

Local-only by design: it inspects the working tree, so it runs from check.sh
and pre-commit is deliberately not lengthened. Not in CI — a runner's checkout
may legitimately carry ephemera this repo does not own.

Run:  python3 scripts/verify-root-policy.py [--self-test]
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path, PurePath

ROOT = Path(__file__).resolve().parent.parent

# §5 Pile A (tool discovery by filename at the root) + the four human entry
# points + the owner's working `.md` files (P5: deliberately at the root) +
# `.env` (gitignored local secrets, documented in AGENTS.md). Names, not
# patterns: a root file must be named here to exist.
ROOT_FILE_ALLOWLIST = frozenset({
    # Tool contracts — root lookup by filename, moving one breaks the tool.
    "Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "deny.toml",
    ".gitignore", ".gitattributes", ".dockerignore", ".editorconfig",
    ".gitleaks.toml", ".trivyignore", ".cbmignore", ".mcp.json",
    ".tarpaulin.toml", ".env.example",
    # .nvmrc is a tool contract in the strictest sense: `nvm use` looks for it BY
    # NAME in the current directory and walks UP, so at the root it is what a
    # contributor gets standing in the repo. Three sources cite it as "the root
    # .nvmrc" (deploy-website.bat:17, scripts/wrangler-deploy.sh:88,
    # website/scripts/prebuild.mjs:87), so moving it would invalidate them.
    ".nvmrc",
    # Human entry points.
    # README-technical.md is the developer-facing technical README (repository
    # structure, technology stack, commands). It was README-3.md until
    # 2026-10-02 -- a merge-conflict suffix -- and it is the ONLY document in the
    # repo carrying a Technology Stack table or a repo-root Repository Structure
    # tree, so it belongs with the entry points, not beside README.md.
    "README.md", "README-technical.md", "CHANGELOG.md", "CONTRIBUTING.md",
    "LICENSE", "AGENTS.md", "ARCHITECTURE.md", "DSH.md",
    # deploy-website.bat is a human entry point: a Windows operator double-clicks it
    # or runs it bare from the repo root. docs/operations/website-auth-nav-deploy.md:51
    # documents it AS root-resident ("prefer `deploy-website.bat` (repo root)"), and
    # sibling build scripts that are not entry points live with their apps
    # (apps/mobile-tauri/build-android-frontend.bat). Moving it would invalidate that
    # doc and the invocation it teaches.
    "deploy-website.bat",


    "todo-open-debt-program.md", "todo-review-type.md",

    # Owner plan docs, same class as the two above: named individually on purpose,
    # because the allowlist is names-not-patterns so adding one is a decision.
    "done-todo-android-4gb-optimization-audit.md", "todo-optimize-crates.md",
    # Added 2026-10-02. Both were committed to the repo without the list being
    # extended, which is the oversight the comment at the top of this file
    # describes: the rule is "extend the list in the same commit that adds the
    # file". The decision to have them at the root was made when each landed,
    # so adding them here enforces the stated invariant rather than making a
    # new one. Both are tracked and clean. One carries the `todo-` token AGENTS.md 7.4
    # requires; the other was renamed to `done-todo-` on 2026-10-14 once its §29
    # acceptance criteria were all evidenced and the three gates it names (android-soak.sh,
    # bundle:check:mobile, clippy/test) were confirmed to exist. See its own §31.
    # (original line: "both carry the `todo-` token AGENTS.md 7.4" -- true when written)
    # gives plan docs, and are plans in substance (20 and 36 open checkboxes).
    # `todo-android-updater.md` was here and is GONE: renamed to
    # `done-todo-android-updater.md` when its acceptance was met, and listed in the
    # 2026-10-12 group below. A stale name here is harmless to the gate (it is a
    # set membership test) but it makes the list lie about what exists.
    "todo-beta-testing-january-2027.md",
    # todo-docs-restructure.md — the docs/ restructure plan (A1-A5, B0-B4). Same
    # class: an owner plan doc at the root, added deliberately per AGENTS.md 7.4,
    # which puts plan files at the root and exempts `todo-` names in check-dead-refs.
    "todo-docs-restructure.md",
    # todo-restaurant-pos-reliability.md — the restaurant-POS reliability plan.
    # Same class again, and flagged by ANOTHER lane before this one: the
    # docs-restructure plan's step-6 note identified it as tracked, clean,
    # carrying the `todo-` token, and an owner plan doc (5,752 lines,
    # 2026-10-09) — exactly the class ROOT_FILE_ALLOWLIST lists by name —
    # and left it alone because that plan may not edit a script and the file
    # was not its own. It landed 2026-10-12, after the last edit to this list,
    # so it was simply never added.
    #
    # Adding it enforces the invariant stated at the top of this file
    # ("extend the list in the same commit that adds the file") rather than
    # making a new decision — the same reasoning as the 2026-10-02 group above.
    "todo-restaurant-pos-reliability.md",
    "manager-codebase-review-checklist.md",
    "manager-codebase-review-decisions.md",
    "manager-codebase-review.md",
    # Two in-flight plan docs that were left out of their own commits, which made
    # this gate the only thing reporting them. Both are the class named above, not
    # scratch: `plan-c1-install-key-s2b-s2c.md` is TRACKED (landed with 461b04c25 /
    # 73109ee91) and carries the `plan-` token its §7.4 exemption requires;
    # `done-todo-modular-scaffolding.md` is the same shape and still carries the
    # `todo-` token its §7.4 exemption needs. It was renamed on 2026-10-02 once
    # its own acceptance command ran and passed (3543 core tests, all governance
    # gates green), which is what §7.4 says earns the `done-` prefix.
    "plan-c1-install-key-s2b-s2c.md",
    # The 2026-10-12 plan-doc sweep. Fourteen tracked plan documents at the root
    # that were never added to this list, plus one STALE entry: `todo-android-
    # updater.md` was renamed to `done-todo-android-updater.md` when its own
    # acceptance was met (§7.4: the header says so verbatim), and the rename did
    # not touch this list — so the gate named a file that no longer existed while
    # the file that did exist went unlisted.
    #
    # Why these belong rather than being moved: AGENTS.md §7.4 puts plan files at
    # the root and exempts `todo-`/`plan-`/`prd-` names from check-dead-refs, and
    # the `done-` prefix is earned per §7.4, not a new location. Every one below is
    # tracked, clean, and a plan in substance — the same class as the two groups
    # above, added for the same stated reason: the decision to have them at the
    # root was made when each landed, so listing them enforces the invariant at the
    # top of this file rather than making a new one.
    "done-plan-tablet-checkout-kds.md",
    "done-plan-tablet-homescreen-settings.md",
    "done-todo-android-device-identity.md",
    "done-todo-android-hardware-thermal-printing.md",
    "done-todo-android-updater.md",
    "done-todo-audit-enhancement-plan.md",
    "done-todo-audit-upgrade-plan.md",
    "done-todo-consolidate-core-integration-tests.md",
    "done-todo-demo-fixtures-sellable.md",
    "done-todo-multi-terminal-sync-kds.md",
    "done-todo-restaurant-recipe-authoring.md",
    "done-todo-retail-vs-restaurant-product-model.md",
    "done-todo-tablet-provisioned-workspaces-invisible-to-picker.md",
    "plan-topology-web-authoring.md",

    # Measured exception (§5): not a duplicate of scripts/stats.json —
    # scripts/stats.ps1 and scripts/check.ps1 read this name.
    "stats.json",
    # Tracked Tauri updater public key (Pile D: rename pending with its owner).
    "kasirmu-updater.key.pub",
    # Gitignored local secrets — sanctioned, not scratch.
    ".env",
    # Gitignored output of `.agents/skills/skill-drift-guard/scripts/detect.sh`,
    # which writes it at the repo root by design (its own `REPORT` constant).
    # Nothing here is committed; like `.env`, it is sanctioned tool state.
    "skill-drift-report.md",
    # The codebase-memory MCP indexes the workspace with its path sanitised into the
    # filename, so this checkout's two indexes land here. Gitignored derived tool state,
    # the same class as skill-drift-report.md above, and settled 2026-09-28 by naming them
    # rather than by deleting a 210 MB index or teaching the gate a pattern it refuses.
    "C-dev-kasirmu.db",
    "C-dev-encapsule.db",
    # Owner plan docs that earned their `done-` rename; same class as the done-todo-*
    # names above, added when the sweep caught them (2026-09-28).







})

# Directories the empty-dir sweep must not descend into. `.git` is git's own;
# `node_modules` and `target*` are build/dependency output the plan's find
# exclusions name; `.vscode` is editor-recreated by VS Code on open; `.wrangler`
# is Cloudflare tool state, the same tool-owned ephemera class as `.freebuff`.
SWEEP_SKIP_DIRS = {".git", "node_modules", "target", "target-release", ".vscode",
                   ".wrangler"}


def gitignored_dirs(root: Path) -> set[str]:
    """Directories git ignores outright, as posix relpaths under `root`.

    The empty-dir rule exists because git cannot track an empty directory, so
    one inside a *tracked* tree silently vanishes from the repo. A tree git
    already ignores wholesale is the opposite case: git sees nothing there
    whether it is empty or not, so flagging it is noise. Measured 2026-09-19 —
    112 of that day's 116 findings were empty Gradle output under
    `apps/mobile-tauri/gen/android/**/build/`, ignored by
    `apps/mobile-tauri/gen/android/.gitignore:11`.
    """
    try:
        proc = subprocess.run(
            ["git", "ls-files", "--others", "--ignored",
             "--exclude-standard", "--directory"],
            cwd=str(root), capture_output=True, text=True, check=False,
        )
    except OSError:
        return set()
    if proc.returncode != 0:
        return set()
    return {line.rstrip("/") for line in proc.stdout.splitlines() if line.strip()}


def check(root: Path) -> list[str]:
    """Pure over a root path. -> findings, one per violated policy."""
    findings: list[str] = []
    ignored = gitignored_dirs(root)

    for entry in sorted(root.iterdir(), key=lambda p: p.name):
        if entry.name in (".git",) or not entry.is_file() or entry.is_symlink():
            continue
        if entry.name in ROOT_FILE_ALLOWLIST:
            continue
        findings.append(
            f"stray root file: {entry.name} - root holds only name-resolved "
            f"tool contracts and the owner's entry files (plan section 5); add "
            f"it to ROOT_FILE_ALLOWLIST in scripts/verify-root-policy.py if it belongs"
        )

    for dirpath, dirnames, filenames in os.walk(root, topdown=True):
        rel = PurePath(dirpath).relative_to(root)
        parts = rel.parts
        dirnames[:] = [
            d for d in dirnames
            if d not in SWEEP_SKIP_DIRS
            and (rel / d).as_posix() not in ignored
        ]
        # A directory is empty when it holds no files and no surviving
        # subdirectories; checking bottom-up would be equivalent, but with
        # topdown pruning every empty leaf reports exactly once, here.
        if parts and not dirnames and not filenames:
            findings.append(f"empty directory: {rel.as_posix()} - git cannot see it; remove it")

    return findings


def self_test() -> int:
    """Prove the two checks bite, over synthetic trees."""
    failures: list[str] = []

    def tree(build) -> Path:
        tmp = Path(tempfile.mkdtemp())
        build(tmp)
        return tmp

    clean = tree(lambda t: None)
    if check(clean):
        failures.append("clean fixture reported findings — the gate is always-on")

    stray = tree(lambda t: (t / "pr_body.md").write_text("scratch"))
    if "pr_body.md" not in "".join(check(stray)):
        failures.append("a Pile C regrowth at the root was not flagged")

    allowed = tree(lambda t: (t / ".env").write_text("K=V"))
    if check(allowed):
        failures.append(".env, a sanctioned gitignored file, was flagged")

    empty = tree(lambda t: (t / "ghost").mkdir())
    if not any("empty directory: ghost" in f for f in check(empty)):
        failures.append("an empty directory was not flagged")

    nested = tree(lambda t: (t / "a/target/b").mkdir(parents=True))
    if any(f.startswith("empty directory: a/target") for f in check(nested)):
        failures.append("the sweep walked into a target/ tree it must skip")

    tool_owned = tree(lambda t: (t / ".wrangler/tmp/x").mkdir(parents=True))
    if any(".wrangler" in f for f in check(tool_owned)):
        failures.append("the sweep walked into tool-owned .wrangler state")

    if failures:
        print("self-test FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("  self-test: all 6 cases passed")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()

    if not ROOT.is_dir():
        print(f"error: repo root not found: {ROOT}", file=sys.stderr)
        return 2

    findings = check(ROOT)
    if findings:
        print(f"root policy: {len(findings)} finding(s):")
        for f in findings:
            print(f"  - {f}")
        return 1
    print("root policy: clean - allowlist holds, no empty directories")
    return 0


if __name__ == "__main__":
    sys.exit(main())
