#!/usr/bin/env python3
"""check-chokepoints.py -- name the companions a shared-surface change must carry.

WHY THIS EXISTS
A shared repo with several lanes rarely fails from file collisions; it fails from
CHOKEPOINTS. One lane adds an IPC command, and the registration, capability, census pin and
allowlist entry that belong with it land in a different commit -- or never. The gate then
goes red for everyone, and the lane that caused it is not the lane that notices.

Measured 2026-09-20: one added command (create_backup_to) turned static-gates red in three
rounds -- ipc-parity, then scoped-reads, then the desktop gate census -- costing about four
CI cycles before the tree was green again.

WHAT IT DOES
For every rule in RULES whose TRIGGER matches this diff it (1) runs the authoritative gate
for that surface where a cheap one exists -- reusing the existing checker instead of
re-deriving its parsing -- (2) checks the rule's COMPANION files are in the SAME diff, and
(3) prints a verdict. In --strict mode an unaccompanied, unacknowledged rule exits 1.

It reports by default (exit 0) so it cannot block a lane before it has earned trust. It
never edits anything.

USAGE
  python scripts/check-chokepoints.py                  # working tree vs HEAD, report only
  python scripts/check-chokepoints.py --range A..B     # a commit range instead
  python scripts/check-chokepoints.py --strict         # exit 1 on a missing companion
  python scripts/check-chokepoints.py --ack census-pin # accept one rule for this diff
  python scripts/check-chokepoints.py --self-test      # assert the rules' own shapes

Exit codes: 0 report/clean, 1 strict and incomplete, 2 self-test failure.
"""

import argparse
import fnmatch
import os
import re
import subprocess
import shutil
import sys
import tempfile

# ---------------------------------------------------------------------------
# The chokepoint table. Adding a rule is a data edit, not a code edit.
#
#   trigger_paths  a changed path matching any arm applies the rule.
#   trigger_added  additionally an ADDED line matching any arm. Empty = path alone is enough.
#   companions     paths that belong in the same diff (glob, matched against changed paths).
#   gate           authoritative command run from the repo root, or None to skip.
#   hand           the command printed when the gate is too slow to run here.
# ---------------------------------------------------------------------------
RULES = (
    {
        "id": "ipc-command",
        "why": "a new or changed IPC command needs its registration, capability, census pin and "
               "(for a shell that does not register it) an allowlist entry, in one commit",
        "trigger_paths": ("apps/*-tauri/src/lib.rs", "apps/*-tauri/src/commands/**",
                          "crates/kasirmu-bridge/src/**", "ui/src/api/**"),
        "trigger_added": (r"#\[tauri::command\]", r"generate_handler!",
                          r"\b(?:loggedInvoke|invoke)\s*[<(]"),
        "companions": ("apps/*/capabilities/*.json",
                       "apps/desktop-tauri/tests/gate_audit.rs",
                       "scripts/ipc-parity-allowlist.json"),
        "gate": ("python", "scripts/verify-ipc-parity.py"),
    },
    {
        "id": "census-pin",
        "why": "the gate census counts gate( calls per module, so a changed count or a new module "
               "is a pin edit -- the pin is the review signal, never silent",
        "trigger_paths": ("apps/*-tauri/src/commands/**", "crates/kasirmu-bridge/src/**"),
        "trigger_added": (r"\bgate\s*\(",),
        "companions": ("apps/desktop-tauri/tests/gate_audit.rs",),
        "gate": None,
        "hand": ("cargo", "test", "-p", "kasirmu-app", "desktop_command_census_matches_pin"),
    },
    {
        "id": "pg-schema",
        "why": "init.pg.sql is generated from the sqlite migrations and is never hand-edited",
        "trigger_paths": ("crates/kasirmu-core/migrations/**",),
        "trigger_added": (),
        "companions": ("crates/kasirmu-core/migrations/*.pg.sql",),
        "gate": ("python", "scripts/generate-pg-migration.py", "--check"),
    },
    {
        "id": "ftl-strings",
        "why": "a user-visible string must resolve in every locale, with no orphan on either side",
        "trigger_paths": ("ui/**/*.ftl",),
        "trigger_added": (),
        "companions": (),
        "gate": ("python", "scripts/verify-bundle-parity.py", "--include-getstring",
                 "--include-nav-keys", "--include-key-fields", "--include-dynamic-literals",
                 "--include-id-maps", "--check-domain-pairs",
                 "--scan-dirs", "features,components,app,theme,registries,contexts,hooks"),
    },
    {
        "id": "gates-and-ci",
        "why": "gate counts, step names, job lists and the registry are mirrored across the hooks, "
               "the workflows, gates.json and the docs, and those mirrors are policed",
        "trigger_paths": (".githooks/**", ".github/workflows/**", "scripts/gates.json",
                          "scripts/check.sh", "scripts/check-ui.mjs"),
        "trigger_added": (),
        "companions": ("docs/operations/agent-gates.md", "docs/operations/ci-pipeline.md"),
        "gate": ("python", "scripts/verify-agents-mirrors.py"),
    },
    {
        "id": "skills",
        "why": "the drift guard reads every skill, so a path or crate named in one is a claim the "
               "tree must still satisfy",
        "trigger_paths": (".agents/skills/**",),
        "trigger_added": (),
        "companions": (),
        "gate": ("bash", ".agents/skills/skill-drift-guard/scripts/detect.sh", "--report"),
    },
)

GIT_BASH = "C:/Program Files/Git/bin/bash.exe"


def repo_root(cwd=None):
    """Absolute root of the work tree containing `cwd` (default: this process's cwd).

    ENCODING IS NOT OPTIONAL here either -- see _git() below, which explains the silent
    CP-1252 mismatch in full. `--show-toplevel` prints the path as UTF-8 bytes; decoded with
    the locale codec on Windows a non-ASCII checkout path becomes mojibake, `_git` then runs
    against a directory that does not exist, and the failure surfaces as "git diff failed"
    naming neither the encoding nor the path. errors="replace" keeps a bad byte visible in the
    message instead of killing the reader thread.
    """
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if out.returncode != 0:
        raise SystemExit("not a git work tree")
    root = out.stdout.strip()
    if not root:
        # rev-parse exiting 0 with nothing on stdout is not a root: every _git() call would
        # then run with -C "" and fail later with a message about the diff, not the cause.
        raise SystemExit("git rev-parse returned an empty root")
    return root


def _git(root, *args):
    # ENCODING IS NOT OPTIONAL ON WINDOWS, and its absence is SILENT. With text=True and no
    # encoding, Python decodes with the locale codec (cp1252 here) and a diff containing a byte
    # it cannot map — a box-drawing character in a comment, which this tree has many of — makes
    # the reader thread die. subprocess then returns stdout=None with returncode 0 and an EMPTY
    # stderr, so the caller crashes on `stdout.splitlines()` with an AttributeError that names
    # neither the encoding nor the commit. Measured 2026-10-25 (round 198): `--range
    # 1abbdae32..HEAD` (16 commits, 5,240 diff lines) died this way while the working-tree mode
    # was fine, because the working tree is small.
    return subprocess.run(
        ["git", "-C", root] + list(args),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def collect_diff(root, range_spec):
    """Return (changed_paths, added_lines) for a range, or the working tree against HEAD."""
    added = {}
    paths = []
    diff_args = (["diff", "--unified=0", range_spec] if range_spec
                 else ["diff", "HEAD", "--unified=0"])
    res = _git(root, *diff_args)
    if res.returncode != 0:
        raise SystemExit("git diff failed: " + res.stderr.strip()[:200])
    current = None
    for line in res.stdout.splitlines():
        if line.startswith("+++ "):
            current = line[4:].strip()
            if current == "/dev/null":
                current = None
                continue
            if current.startswith("b/"):
                current = current[2:]
            paths.append(current)
            added.setdefault(current, [])
        elif line.startswith("+") and not line.startswith("+++") and current:
            added[current].append(line[1:])
    if not range_spec:
        # Untracked files are additions too, and a brand-new command module is exactly the shape
        # that used to escape every check.
        untracked = _git(root, "ls-files", "--others", "--exclude-standard").stdout.split()
        for rel in untracked:
            paths.append(rel)
            added.setdefault(rel, [])
            try:
                with open(os.path.join(root, rel), encoding="utf-8", errors="replace") as fh:
                    added[rel] = fh.read().splitlines()
            except OSError:
                pass
    return list(dict.fromkeys(paths)), added


def matches_any(path, arms):
    p = path.replace("\\", "/")
    return any(fnmatch.fnmatch(p, a) for a in arms)


def rule_applies(rule, paths, added):
    touched = [p for p in paths if matches_any(p, rule["trigger_paths"])]
    if not touched or not rule["trigger_added"]:
        return touched
    hits = []
    for p in touched:
        for line in added.get(p, ()):
            if any(re.search(arm, line) for arm in rule["trigger_added"]):
                hits.append(p)
                break
    return hits


def missing_companions(rule, paths):
    missing = []
    for glob in rule["companions"]:
        if not any(matches_any(p, (glob,)) for p in paths):
            missing.append(glob)
    return missing


def gate_command(gate):
    """Route bash through Git's bash on Windows -- a bare bash is WSL here, and it hangs."""
    cmd = list(gate)
    if cmd[0] in ("bash", "sh") and os.name == "nt" and os.path.exists(GIT_BASH):
        cmd = [GIT_BASH, "-c", " ".join(cmd)]
    return cmd


def run_gate(root, gate, timeout=300):
    try:
        res = subprocess.run(gate_command(gate), cwd=root, capture_output=True, text=True,
                             timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, "could not run (%s)" % type(exc).__name__
    tail = (res.stdout or res.stderr).strip().splitlines()
    return res.returncode, (tail[-1][:120] if tail else "")


def evaluate(root, range_spec, acks):
    """Return (blocks, incomplete): the per-rule verdicts and how many are unaccompanied."""
    paths, added = collect_diff(root, range_spec)
    blocks = []
    incomplete = 0
    for rule in RULES:
        touched = rule_applies(rule, paths, added)
        if not touched:
            continue
        missing = missing_companions(rule, paths)
        acked = rule["id"] in acks
        lines = ["[%s] %s" % (rule["id"], rule["why"])]
        for p in touched[:4]:
            lines.append("    touched:   " + p)
        if rule["gate"]:
            code, note = run_gate(root, rule["gate"])
            verdict = {0: "OK", None: "SKIPPED"}.get(code, "FAILED")
            suffix = (" (%s)" % note) if note and code else ""
            lines.append("    gate:      %s -> %s%s" % (" ".join(rule["gate"]), verdict, suffix))
        if rule.get("hand"):
            lines.append("    run:       " + " ".join(rule["hand"]))
        for c in missing:
            lines.append("    companion: %s -- NOT in this diff" % c)
        if missing:
            if acked:
                lines.append("    accepted:  --ack %s" % rule["id"])
            else:
                incomplete += 1
        blocks.append("\n".join(lines))
    return blocks, incomplete


def self_test():
    """Assert the rules' own shapes: what fires, what stays quiet, what counts as accompanied."""
    cases = (
        ("a new tauri command fires ipc-command and census-pin, both unaccompanied",
         {"apps/mobile-tauri/src/commands/data.rs": ["#[tauri::command]", "    gate(permissions::X);"]},
         ("ipc-command", "census-pin"), ("ipc-command", "census-pin")),
        ("the same command with its companions present is accompanied",
         {"apps/mobile-tauri/src/commands/data.rs": ["#[tauri::command]"],
          "apps/mobile-tauri/capabilities/mobile.json": ["{}"],
          "apps/desktop-tauri/tests/gate_audit.rs": ["x"],
          "scripts/ipc-parity-allowlist.json": ["{}"]},
         ("ipc-command",), ()),
        ("a ui invoke string fires ipc-command",
         {"ui/src/api/data.ts": ["  return loggedInvoke<BackupResult>('create_backup_to', {});"]},
         ("ipc-command",), ("ipc-command",)),
        ("an untouched website file fires nothing",
         {"website/src/components/AccountView.tsx": ["const effectiveTier = 'free';"]},
         (), ()),
        ("a ui component with no invoke string fires nothing",
         {"ui/src/components/Cart.tsx": ["export const Cart = () => null;"]},
         (), ()),
        ("an ftl bundle change fires its gate and needs no companion",
         {"ui/src/features/cart/en.ftl": ["cart-title = Cart"]},
         ("ftl-strings",), ()),
        ("a gates.json edit asks for the docs it mirrors",
         {"scripts/gates.json": ["  {\"id\": \"x\"}"]},
         ("gates-and-ci",), ("gates-and-ci",)),
        ("a migration edit asks for the generated pg schema",
         {"crates/kasirmu-core/migrations/20260920_x.sql": ["ALTER TABLE t ADD COLUMN c TEXT;"]},
         ("pg-schema",), ("pg-schema",)),
        ("a skill edit fires the drift guard",
         {".agents/skills/tdd/SKILL.md": ["# TDD"]},
         ("skills",), ()),
    )
    failures = 0
    for label, files, expect_fired, expect_missing in cases:
        paths = list(files)
        fired = tuple(r["id"] for r in RULES if rule_applies(r, paths, files))
        missing = tuple(r["id"] for r in RULES
                        if rule_applies(r, paths, files) and missing_companions(r, paths))
        ok = fired == tuple(expect_fired) and missing == tuple(expect_missing)
        print("    %s %s" % ("ok  " if ok else "FAIL", label))
        if not ok:
            print("         fired=%s (want %s) missing=%s (want %s)"
                  % (fired, expect_fired, missing, expect_missing))
            failures += 1

    # repo_root() -- the one function that decides WHERE every other read happens, and it had
    # no case: --self-test builds its file dicts in memory and never calls it, so blanking it
    # (return None / "") was invisible to the sweep (2026-11-06). Graded against a scratch git
    # repository, so the self-test still needs no checkout: init -> the root IS the scratch dir;
    # a nested cwd -> the root is the parent (proves it asks git rather than echoing cwd);
    # a plain temp dir -> SystemExit (proves the refusal, not a silent "").
    def _root_case(label, expected, **kwargs):
        try:
            got = repo_root(**kwargs)
        except SystemExit:
            raise
        except Exception as exc:                     # a mutation that returns a non-path
            print("    FAIL %s: raised %s: %s" % (label, type(exc).__name__, exc))
            return False
        if not isinstance(got, str) or not got:
            print("    FAIL %s: returned %r, not a non-empty path" % (label, got))
            return False
        if os.path.normcase(os.path.realpath(got)) != os.path.normcase(os.path.realpath(expected)):
            print("    FAIL %s: got %r want %r" % (label, got, expected))
            return False
        print("    ok   " + label)
        return True

    scratch = tempfile.mkdtemp(prefix="chokepoints-root-")
    try:
        sub = os.path.join(scratch, "nested", "deeper")
        os.makedirs(sub)
        git_init = subprocess.run(["git", "init", "-q", scratch], capture_output=True, text=True)
        if git_init.returncode != 0:
            print("    FAIL repo_root cases: git init failed in the scratch dir")
            failures += 1
        else:
            if not _root_case("repo_root returns the scratch root", scratch, cwd=scratch):
                failures += 1
            if not _root_case("repo_root ascends from a nested cwd", scratch, cwd=sub):
                failures += 1
        # The non-repo fixture must sit OUTSIDE the work tree for the refusal to be
        # testable at all. tempfile's default no longer guarantees that: 7e11b664c
        # pointed TMP at target/.tmp-check, INSIDE this repo, and rev-parse from there
        # answers with this very root, so the refusal branch was unreachable and the
        # self-test went red under the matrix (measured 2026-11-08, step 131). Fall
        # back to the repo's own parent when the temp dir is inside the tree; mkdtemp
        # still makes a unique directory there and the finally below removes it.
        tmp_base = tempfile.gettempdir()
        try:
            if os.path.commonpath([os.path.abspath(tmp_base),
                                   os.path.abspath(repo_root())]) == os.path.abspath(repo_root()):
                tmp_base = os.path.dirname(os.path.abspath(repo_root()))
        except ValueError:
            pass  # different drives: the temp dir cannot be inside the repo
        plain = tempfile.mkdtemp(prefix="chokepoints-nogit-", dir=tmp_base)
        try:
            try:
                repo_root(cwd=plain)
            except SystemExit:
                print("    ok   repo_root refuses a directory that is not a work tree")
            except Exception as exc:
                print("    FAIL repo_root raised %s instead of refusing a non-repo dir"
                      % type(exc).__name__)
                failures += 1
            else:
                print("    FAIL repo_root accepted a directory that is not a work tree")
                failures += 1
        finally:
            os.rmdir(plain)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    return failures



def shell_ladder() -> int:
    """r220: the root contract, graded on fixture GIT repositories.

    Unlike the rest of the arc's fixtures, these are real work trees -- git init,
    an empty HEAD commit, then either untracked files (working-tree mode) or
    committed ones (--range mode). The killing rung is rung 1: an untracked
    command file with no companions is incomplete, and --strict must exit 1; a
    root-dropping main grades THIS checkout, which is currently quiet, and exits
    0. Rung 5 grades --range against the fixture's own history, proving the git
    base moves with the root and not just the working tree.
    """
    import contextlib
    import io

    def run(root, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=str(root))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    def git(root, *args):
        res = subprocess.run(["git", "-C", root] + list(args),
                             capture_output=True, text=True, encoding="utf-8")
        return res.returncode

    def build(tmp, *, commits=(), untracked=(), label=None):
        base = tempfile.mkdtemp(dir=tmp, prefix=(label or ("mini%d_" % next(rung_n))))
        if git(base, "init", "-q") != 0:
            raise RuntimeError("git init failed in " + base)
        commit_args = ["-c", "user.email=fx@example", "-c", "user.name=fx",
                       "commit", "-q", "--allow-empty", "-m", "init"]
        if git(base, *commit_args) != 0:
            raise RuntimeError("empty HEAD commit failed in " + base)
        # fixture values are LINE LISTS, the self-test's own dict shape -- the
        # rule's trigger_added regexes match per added LINE, so the lines must
        # land as separate lines, not one blob
        for rel, lines in commits:
            path = os.path.join(base, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write("\n".join(lines) + "\n")
            if git(base, "add", "-A") != 0 or git(
                    base, "-c", "user.email=fx@example", "-c", "user.name=fx",
                    "commit", "-q", "-m", "c2") != 0:
                raise RuntimeError("fixture commit failed in " + base)
        for rel, lines in untracked:
            path = os.path.join(base, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write("\n".join(lines) + "\n")
        return base

    rung_n = iter(range(1000))
    COMMAND = {"apps/mobile-tauri/src/commands/data.rs":
               ["#[tauri::command]", "    gate(permissions::X);"]}
    COMPANIONS = {"apps/mobile-tauri/capabilities/mobile.json": ["{}"],
                  "apps/desktop-tauri/tests/gate_audit.rs": ["x"],
                  "scripts/ipc-parity-allowlist.json": ["{}"]}

    shell = 0
    with tempfile.TemporaryDirectory() as tmp:
        # rung 1 IS the killing rung: an unaccompanied IPC command, strict
        root = build(tmp, untracked=COMMAND.items())
        rc, said = run(root, "--strict")
        if rc != 1 or "[ipc-command]" not in said or "[census-pin]" not in said \
                or "NOT in this diff" not in said \
                or "2 rule(s) need a companion" not in said:
            print("  x rung 1: an unaccompanied command must be incomplete rc 1 "
                  "under --strict (rc=%r said=%r)" % (rc, said[-220:]),
                  file=sys.stderr)
            return 1
        shell += 1
        # rung 2: the same command WITH its companion files in the same diff
        root = build(tmp, untracked={**COMMAND, **COMPANIONS}.items())
        rc, said = run(root, "--strict")
        if rc != 0 or "all touched chokepoints carry their companions." not in said:
            print("  x rung 2: an accompanied command must read complete rc 0 "
                  "(rc=%r said=%r)" % (rc, said[-200:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3: --ack census-pin accepts exactly that rule and only that one
        root = build(tmp, untracked=COMMAND.items())
        rc, said = run(root, "--strict", "--ack", "census-pin")
        if rc != 1 or "accepted:  --ack census-pin" not in said \
                or "1 rule(s) need a companion" not in said:
            print("  x rung 3: --ack census-pin must accept only census-pin "
                  "(rc=%r said=%r)" % (rc, said[-220:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4: a website file touches no chokepoint surface -- quiet even strict
        root = build(tmp, untracked={"website/src/components/AccountView.tsx":
                                     ["const effectiveTier = 'free';"]}.items())
        rc, said = run(root, "--strict")
        if rc != 0 or "no chokepoint surface touched" not in said:
            print("  x rung 4: an off-surface diff must stay quiet rc 0 (rc=%r "
                  "said=%r)" % (rc, said[-200:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5: --range grades the fixture's own history -- the git base moves
        # with the root, not just the working-tree read
        root = build(tmp, commits=COMMAND.items())
        rc, said = run(root, "--range", "HEAD~1..HEAD", "--strict")
        if rc != 1 or "check-chokepoints: HEAD~1..HEAD" not in said \
                or "[ipc-command]" not in said:
            print("  x rung 5: --range must diff the FIXTURE's history rc 1 "
                  "(rc=%r said=%r)" % (rc, said[-220:]), file=sys.stderr)
            return 1
        shell += 1

    print("CHOKEPOINTS SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % shell)
    return 0


def main(argv=None, root=None):
    # r220: the r166 contract. argv is explicit; root names the WORK TREE to
    # grade from code -- a fixture git repo. None keeps repo_root(), which asks
    # git for this process's cwd. collect_diff, evaluate and run_gate already
    # take the root as a parameter, so the seam is one branch wide.
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--range", dest="range_spec", default=None,
                        help="commit range, e.g. HEAD~3..HEAD (default: working tree vs HEAD)")
    parser.add_argument("--strict", action="store_true",
                        help="exit 1 when a companion is missing and not acknowledged")
    parser.add_argument("--ack", action="append", default=[], metavar="RULE_ID",
                        help="accept one rule for this diff; repeatable")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        print("  check-chokepoints self-test")
        failures = self_test()
        print("  self-test: %s" % ("PASS" if not failures else "FAIL (%d)" % failures))
        if failures:
            return 2
        return shell_ladder()

    base = repo_root() if root is None else os.path.abspath(root)
    blocks, incomplete = evaluate(base, args.range_spec, set(args.ack))
    print("check-chokepoints: %s" % (args.range_spec or "working tree vs HEAD"))
    if not blocks:
        print("  no chokepoint surface touched -- nothing to carry.")
        return 0
    for block in blocks:
        print(block)
    if incomplete:
        print("\n%d rule(s) need a companion in this change. Add it, or accept it with"
              " --ack <rule> and say why in the commit message." % incomplete)
        return 1 if args.strict else 0
    print("\nall touched chokepoints carry their companions.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
