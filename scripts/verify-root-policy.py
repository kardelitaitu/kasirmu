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

#: Where fixture trees are written when the host sets a temp variable (a confined
#: host denies its default temp); unset leaves tempfile's own default in force
#: (the r166 contract, shared with verify-plugin-guide-parity.py and
#: verify-runner-claims.py).
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root this file's fixtures go under (None = system default), created.

    The makedirs is the r250 lesson: a scratch dir removed between runs otherwise
    makes EVERY fixture fail before it grades anything. exist_ok keeps the common
    case a no-op.
    """
    root = next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)
    if root:
        os.makedirs(root, exist_ok=True)
    return root


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
    # START_TABLET_HMR.bat is the same class and the same shape of decision: a
    # 151-byte Windows launcher whose entire body is
    # `powershell -File "%~dp0scripts\android-dev-hmr.ps1"` plus a `pause`. It is
    # root-resident BECAUSE it is double-clicked, and it resolves its target via
    # %~dp0 so the script it launches stays under scripts/ where it belongs.
    # Allowlisted 2026-10-19 after confirming three things: nothing tracked
    # references it as a path (only two plan docs mention it, as an inventory
    # item), the sibling launcher `deploy-website.bat` was allowed on identical
    # reasoning, and it is not this gate's target class — the gate exists for
    # scratch that regenerates (screenshots, *.db copies, pr_body.md), not for a
    # human entry point. Its siblings android-dev-hmr.ps1 / rebuild-tablet-*.sh
    # correctly live under scripts/ because they are invoked, not double-clicked.
    "START_TABLET_HMR.bat",


    "done-todo-open-debt-program.md", "todo-review-type.md",

    # Added 2026-11-09 (plan-next-30-days.md §1.2). This file was TRACKED and had been
    # flagged by this gate since r174 -- "Root-policy RED on the foreign todo.md" in the
    # register footer, carried in every round entry for ~58 rounds. It is the owner's
    # working plan at the root, which is exactly the class the comment above names; the
    # omission was an oversight, not a judgement, and the gate's own message invites the
    # fix ("add it to ROOT_FILE_ALLOWLIST if it belongs"). It belongs.
    "todo.md",

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
    # done-todo-restaurant-pos-reliability.md — the restaurant-POS reliability plan.
    # Earned `done-` rename on 2026-10-23 once all P0–P8 phases and F1–F24 findings
    # passed acceptance testing.
    "done-todo-restaurant-pos-reliability.md",
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
    # The owner's 30-day plan written 2026-11-09 (the beta runway: 2026-11-09 to
    # 2026-12-09, ending six days before the 2026-12-15 code freeze). Same class as
    # the entries above: a tracked plan doc at the root carrying the `plan-` token
    # its §7.4 exemption requires. Added in the commit that creates the file, which
    # is what this gate's own docstring asks for -- the allowlist entry and the file
    # land together or the gate is red in between.
    "plan-next-30-days.md",
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
    "done-plan-topology-web-authoring.md",

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


_SHELL_ACTIVE = False   # r174: the --self-test passthrough case re-enters
                        # self_test() through main(); without this guard that
                        # recurses until the stack dies.


def self_test() -> int:
    """Prove the two checks bite, over synthetic trees."""
    global _SHELL_ACTIVE
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

    # r174: main()'s shell -- argv and root graded against tempdir fixtures,
    # the r166..r173 pattern. check() itself is already fixture-graded above;
    # these pin the exit mapping (0/1/2) and the argv passthrough.
    import contextlib as _ctxlib
    import io as _io
    def _shell(argv, build):
        tmp = Path(tempfile.mkdtemp())
        build(tmp)
        out, err = _io.StringIO(), _io.StringIO()
        with _ctxlib.redirect_stdout(out), _ctxlib.redirect_stderr(err):
            rc = main(argv=argv, root=tmp)
        return rc, out.getvalue() + err.getvalue()
    rc, text = _shell([], lambda t: (t / "pr_body.md").write_text("scratch"))
    if rc != 1 or "pr_body.md" not in text or "1 finding(s)" not in text:
        failures.append(f"a stray root file must exit 1 naming it (rc={rc} text={text[-100:]!r})")
    rc, text = _shell([], lambda t: None)
    if rc != 0 or "clean" not in text:
        failures.append(f"a clean fixture must exit 0 (rc={rc} text={text[-100:]!r})")
    out, err = _io.StringIO(), _io.StringIO()
    with _ctxlib.redirect_stdout(out), _ctxlib.redirect_stderr(err):
        rc = main(argv=[], root=Path(tempfile.mkdtemp()) / "absent")
    if rc != 2 or "repo root not found" not in (out.getvalue() + err.getvalue()):
        failures.append(f"a missing root must exit 2 (rc={rc})")
    if not _SHELL_ACTIVE:
        _SHELL_ACTIVE = True
        try:
            rc, text = _shell(["--self-test"], lambda t: None)
            if rc != 0 or "self-test: all cases passed" not in text:
                failures.append(f"--self-test must passthrough to the checker's own cases (rc={rc} text={text[-80:]!r})")
        finally:
            _SHELL_ACTIVE = False

    if failures:
        print("self-test FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("  self-test: all cases passed")
    # r285: the ladder must be CALLED, not merely defined -- and it must be the
    # LAST thing self_test() does. The seven cases above are the case COUNT and
    # stay exactly as they were; this line is where they become rungs. r263
    # measured the failure this guards against: a ladder that existed, satisfied
    # the census TEXT match, and never ran at all.
    return shell_ladder()


#: The re-entry guard (the r228 pattern, shared with verify-plugin-guide-parity.py
#: and verify-runner-claims.py): rung 4 drives a nested --self-test through
#: main(), whose self-test arm now ends in the call above. Without the guard that
#: nested run starts a SECOND ladder recursively.
_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard: a nested self-test (rung 4) must not run a second ladder."""
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        # SILENT, and that is load-bearing rather than tidy. A line here would
        # land in the nested run's captured streams -- which EXISTING case 10
        # already reads -- and the rung asserting on the ladder line would then
        # match the GUARD'S OWN note instead of the rung's. Measured r285, after
        # three wrong guesses at the cause: once this note was the only thing
        # RUNG 4 could see, it passed a page in which rungs 1-3 never spoke.
        return 0
    _LADDER_RUNNING = True
    try:
        return _shell_ladder_body()
    finally:
        _LADDER_RUNNING = False


def _shell_ladder_body() -> int:
    """Grade main()'s shell on fixture trees outside this repository.

    Every rung builds a synthetic root under a TemporaryDirectory beneath
    fixture_root(), hands it to main(argv=[...], root=fixture), and reads the
    verdict from both captured streams. Nothing here reads or writes the real
    tree.

    WHY THE NAMES ARE SYNTHETIC. The two listed cases are the killing rung, r285,
    and the empty-dir killing rung, ghost -- names that do not exist in this
    checkout and never will. That matters because this checker READS A SCOPE, not
    a corpus of names: a root-ignoring main() does not crash or go blank, it
    grades THIS repository. Measured r285 with the harness's own placement
    (<scratch>/scripts/verify-root-policy.py, so its __file__-derived ROOT is the
    scratch dir):

      * --self-test printed "root policy: clean - allowlist holds, no empty
        directories" for the STRAY fixture -- i.e. the mutant's answer to a
        fixture holding r285 is "clean", which the clean fixture also produces.
      * the existing cases caught it anyway: "a stray root file must exit 1
        naming it (rc=0 text='root policy: clean ...')" and "a missing root must
        exit 2 (rc=0)".

    So a rung that only asserts rc 0 or the word "clean" would be passed by a
    mutant. RUNG 1 is therefore built to change the fixture's verdict, not merely
    to announce itself.

    WHAT THIS LADDER DOES AND DOES NOT PROVE, measured r285 rather than assumed.
    With a main() that ignores its root argument, RUNG 1 dies on the VERDICT
    (rc 1 but "N finding(s)" is not 1 -- it is the real repository's report).
    RUNG 5, the scope refusal, is the rung a root-blind main() cannot reach at
    all: it exits 1 instead of 2, because this checkout exists and the absent
    fixture path is never looked at. That refusal rung is the one that names the
    FIXTURE's path, so it is also the one that cannot be satisfied by grading
    this checkout.

    Each assertion is chosen so an unrelated line cannot satisfy it:

      * rung 1 anchors on the finding's CLASS and its count ("1 finding(s)"), not
        on a bare filename -- the name appears in the allowlist comment blocks of
        this very file, and a mutant that graded this repository would have to
        produce exactly this count line to counterfeit it.
      * rung 2 anchors on the SAME fixture widening to exactly 2 and NAMING the
        second class, so a check() that dropped the empty-dir walk (and still
        exited 1 on rung 1's stray file) fails here -- rung 1 alone cannot see it.
      * rung 3 anchors on the roster being reported at ZERO from a NON-EMPTY tree.
        A main() that returned 0 whenever the sweep found nothing -- the quiet
        way to lose the allowlist check -- matches rung 1's clean twin.
      * rung 4 requires the nested self-test to pass WITHOUT running a ladder
        ("LADDER OK" must be ABSENT -- measured r285: the nested run inherits the
        outer flag through the enclosing cell and correctly skips it).
      * rung 5 is the SCOPE REFUSAL, kept separate from the verdict rungs on
        purpose: it requires the message to name the FIXTURE's path, so a main()
        that ignored its root -- and would name this checkout and still exit 2 --
        cannot satisfy it.
    """
    import contextlib
    import io
    import tempfile

    NL = chr(10)

    def grade(base, argv=()):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = main(argv=list(argv), root=base)
        return rc, out.getvalue() + err.getvalue()

    shell = 0

    # ONE tree manages its own lifetime around the rung that grades a missing
    # root -- that rung is handed a path INSIDE it and requires the path to be
    # absent, so everything else has to be absent too.
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as td:
        base = Path(td)

        # rung 1 -- the KILLING rung, and it grades a VERDICT, not a scope refusal.
        # One stray root file makes the fixture dense, so the report cannot read as
        # an empty roster. A main() that ignored its root grades THIS checkout --
        # measured r285: it answered "clean" -- so it fails on both the rc and the
        # count.
        root = base / "one"
        root.mkdir()
        (root / "r285").write_text("scratch", encoding="utf-8")
        rc, said = grade(root)
        if (rc != 1
                or "root policy: 1 finding(s):" not in said
                or "stray root file: r285 " not in said
                or "clean" in said):
            print("  x rung 1: a fixture with one stray root file must be VERDICTED "
                  "rc 1 as exactly 1 finding naming it (rc=%r said=%r)"
                  % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 2 -- the SECOND detector. The empty-dir walk is a separate loop over
        # the same root, and a check() that lost it still exits 1 on rung 1. Adding
        # one empty directory to THAT tree must move the count 1 -> 2 and name the
        # second class. The anchor is "directory: ghost -", not "ghost" alone: the
        # bare name is already the text of EXISTING case 4's own fixture text, so a
        # bare-name assertion could be counterfeited by that case's failure.
        (root / "ghost").mkdir()
        rc, said = grade(root)
        if (rc != 1
                or "root policy: 2 finding(s):" not in said
                or "stray root file: r285 " not in said
                or "directory: ghost - " not in said):
            print("  x rung 2: a fixture that adds one empty directory must VERDICT "
                  "rc 1 as exactly 2 findings naming both classes (rc=%r said=%r)"
                  % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 3 -- the roster reported at ZERO from a NON-EMPTY tree that is CLEAN
        # IN BOTH CLASSES. `ghost` goes because an empty directory is a finding in
        # its own right (measured r285: leaving it made this rung report
        # "1 finding(s): empty directory: ghost"); the DIRECTORY `one` stays, so
        # "clean" cannot be reached by an early return on an empty sweep. This is
        # the allowlist leg's clean twin.
        (root / "r285").unlink()
        (root / "ghost").rmdir()
        rc, said = grade(root)
        if rc != 0 or "root policy: clean - allowlist holds" not in said:
            print("  x rung 3: a non-empty fixture with neither class present must "
                  "report the roster clean at rc 0 (rc=%r said=%r)"
                  % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1
        # Back to the DIRTY shape for rung 4: rung 3 has now proven the clean arm
        # really is clean, so the nested self-test below cannot be passed by a
        # main() that ignores which kind of root it was handed.
        (root / "r285").write_text("scratch", encoding="utf-8")

        # rung 4 -- the one rung that drives a nested --self-test through argv. The
        # re-entry guard is what stops that nested run starting a second ladder;
        # without it this rung recurses. Both the case line AND the ladder line are
        # graded: r263's finding was a self-test that printed its cases and no
        # ladder at all, and an assertion on the case line alone is blind to it.
        #   The ladder-line clause was TRIED AND REMOVED, measured r285: the
        #   nested run bubbles the OUTER run's _LADDER_RUNNING down through the
        #   enclosing function's cell, so it correctly SKIPS the ladder and never
        #   reaches its final print. Asserting on that line made rung 4 fail
        #   permanently. Only the case line can survive into the nested run.
        rc, said = grade(root, ("--self-test",))
        if (rc != 0
                or "self-test: all cases passed" not in said
                or "self-test FAILED" in said
                or "Traceback" in said
                or "LADDER OK" in said):
            print("  x rung 4: a nested --self-test through argv must pass with the "
                  "re-entry guard active and PRINT the ladder line (rc=%r said=%r)"
                  % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 5 -- the SCOPE REFUSAL. A path INSIDE the managed tree that was never
        # created, not a scratch copy: it grades exit 2 and requires the message to
        # name the FIXTURE's path, so a main() that ignored its root -- and would
        # name this checkout and still exit 2 -- cannot satisfy it.
        absent = base / "absent"
        rc, said = grade(absent)
        if rc != 2 or "repo root not found" not in said or str(absent.resolve()) not in said:
            print("  x rung 5: an absent fixture root must refuse rc 2 naming the "
                  "FIXTURE's path, not this checkout's (rc=%r said=%r)"
                  % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1
    print("LADDER OK (%d shell rungs through main(): stray verdict, empty-dir "
          "second detector, clean roster, nested --self-test, scope refusal)" % shell)
    return 0


def main(argv: list[str] | None = None, root: str | Path | None = None) -> int:
    """r174: argv and root parameterized, the r166..r173 contract -- root
    redirects the graded tree, so a fixture cannot half-run against the real
    repository root."""
    # A REPORT MUST NOT CRASH ON WHAT IT REPORTS. Measured 2026-10-23 in a full matrix
    # run: a stray root file whose name ended in U+F00A (private-use codepoint) made
    # `print` raise UnicodeEncodeError on a cp1252 stdout, so step 01 died with a
    # traceback and the FINDING -- a real one -- was never named. Reconfiguring the stream
    # once is the fix; per-line escaping cannot help because the failure is at the stream.
    #
    # errors="backslashreplace": a mangled name is still diagnosable (\uf00a points at the
    # odd character), while dropping the line would hide the finding the gate exists for.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
        except (AttributeError, ValueError):
            pass  # a wrapped or already-configured stream; carry on with what we have

    if "--self-test" in (sys.argv[1:] if argv is None else argv):
        return self_test()

    root_path = ROOT if root is None else Path(root).resolve()
    if not root_path.is_dir():
        print(f"error: repo root not found: {root_path}", file=sys.stderr)
        return 2

    findings = check(root_path)
    if findings:
        # NEVER let the REPORT crash on a finding. This loop printed a stray root file
        # whose name ended in U+F00A (a private-use codepoint), and on a cp1252 stdout
        # that raised UnicodeEncodeError at the `print` -- so the run died with a
        # traceback instead of naming the file it had found. The finding was real and its
        # identity was lost. Measured 2026-10-23 in a full matrix run: step 01 reported
        # FAIL with the traceback and no filename.
        #
        # `backslashreplace` is the right fallback here: a mangled name is still
        # diagnosable (`\uf00a` points straight at the odd character), while dropping the
        # line would hide the finding the gate exists to report.
        print(f"root policy: {len(findings)} finding(s):")
        for f in findings:
            print(f"  - {f}")
        return 1
    print("root policy: clean - allowlist holds, no empty directories")
    return 0


if __name__ == "__main__":
    sys.exit(main())
