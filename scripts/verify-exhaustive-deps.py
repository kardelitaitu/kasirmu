#!/usr/bin/env python3
"""Ratchet on react-hooks/exhaustive-deps warnings.

Why this exists
---------------
`ui/package.json` runs `eslint .` with no `--max-warnings 0`, so eslint exits 0 while reporting 58
warnings. One rule in that set is not cosmetic: `react-hooks/exhaustive-deps` is the only automated
check for a stale closure, and in this codebase a stale closure has a specific dangerous shape -- a
callback that reads `sessionToken` (or any store-scoped value) but does not list it captures the
value from the render that built it. Item 69 found five callbacks whose deps listed `userId`, a prop
no component body ever read, while two of the same arrays omitted `promotionIds`, which IS sent in
the checkout payload. Neither was caught by any gate.

So this does not try to clear the debt. It freezes it: the count may go down, never up. That keeps
the 12 -> 7 improvement made in item 69 from silently eroding, and it makes a newly introduced
stale-closure warning a build failure rather than a line in a report nobody reads.

The failure mode this script is written against
-----------------------------------------------
A zero from a tool that did not run is worse than no tool. Every measurement here therefore has to
prove the run happened before its number is believed:

  * eslint's own exit code is captured without a pipe (a pipe resets $LASTEXITCODE in PowerShell and
    has already produced a false "exit=0" alongside four real errors in this repo's history).
  * the human-readable summary line ("N problems (X errors, Y warnings)") must be present and
    parseable. Its absence means eslint never got as far as linting -- a bad flag, a missing
    dependency, a crash -- and that is reported as an error, never as a clean bill of health.
  * the exhaustive-deps count is cross-checked against the parsed warning total: a count larger than
    the total warnings is arithmetically impossible and means the parsing is wrong.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(REPO, "ui")
STATE = os.path.join(REPO, "scripts", "exhaustive-deps-baseline.json")

SUMMARY_RE = re.compile(r"(\d+)\s+problems?\s+\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)")
RULE_RE = re.compile(r"react-hooks/exhaustive-deps")


def load_baseline(state=None) -> int:
    """r194: the ratchet file follows the contract root."""
    path = STATE if state is None else state
    with open(path, encoding="utf-8") as fh:
        return int(json.load(fh)["max_exhaustive_deps"])


def run_eslint(ui=None) -> tuple[int, str]:
    """Invoke the project-local eslint over the whole UI tree and return (exit_code, output).

    r194: the UI tree follows the contract root -- binary resolution and
    cwd together, never half (a root redirecting the binary but not the
    working directory would lint a tree that exists nowhere).
    """
    ui_root = UI if ui is None else str(ui)
    bin_eslint = os.path.join(
        ui_root, "node_modules", ".bin", "eslint.cmd" if os.name == "nt" else "eslint"
    )
    if not os.path.exists(bin_eslint):
        raise SystemExit(
            f"eslint not found at {bin_eslint}\n"
            "This gate cannot certify anything without the linter, so it fails rather than "
            "reporting clean. Run `npm ci` in ui/ first."
        )
    proc = subprocess.run(
        # Default (stylish) formatter on purpose. `--format compact` and `--format unix` are no
        # longer part of core ESLint in this version: they exit 2 with a usage error, which is
        # exactly the "tool did not run but reported a number" trap this script is built to refuse.
        [bin_eslint, "."],
        cwd=ui_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def measure(output: str, exit_code: int = 0) -> tuple[int, int]:
    """Return (warning_total, exhaustive_deps_count) or raise if the run is not trustworthy.

    EMPTY OUTPUT IS THE CLEAN CASE, and this function used to fail on it. ESLint 9 prints its
    "✖ N problems" summary ONLY when there is something to report; a tree with zero
    findings produces no stdout at all and exits 0. The old rule -- "no summary line means
    the run cannot be trusted" -- therefore reported every perfectly clean tree as
    UNTRUSTWORTHY, which is what `check.sh` step 21 did on 2026-10-23: rc 0, zero bytes on
    stdout and stderr, and the gate demanding a summary it could never get.

    The absence of a summary is still suspicious when it contradicts the exit code (a
    non-zero run that printed nothing) or when there is output that does not parse. Both
    still fail, and those are the cases the guard was written for: a bad flag, a config
    error, a changed output format. What it must not do is read "nothing to report" as
    "reported nothing".
    """
    m = SUMMARY_RE.search(output)
    if not m:
        if not output.strip():
            if exit_code == 0:
                # eslint ran, found nothing, and said nothing. A real zero.
                return 0, 0
            raise SystemExit(
                "eslint exited %d and printed nothing -- the run cannot be trusted, so this "
                "gate fails instead of reporting clean." % exit_code
            )
        raise SystemExit(
            "eslint produced output but no parseable summary line -- the run cannot be "
            "trusted, so this gate fails instead of reporting clean.\nFirst 400 chars of "
            "output:\n" + output[:400]
        )
    _problems, _errors, warnings = (int(g) for g in m.groups())
    deps = len(RULE_RE.findall(output))
    if deps > warnings:
        raise SystemExit(
            f"inconsistent parse: {deps} exhaustive-deps mentions exceed {warnings} total "
            "warnings; the output format changed and the count is meaningless."
        )
    return warnings, deps

# A realistic eslint tail: the summary line plus per-file findings.
ESLINT_WITH_DEPS = """
/ui/src/a.tsx
  12:7  warning  React Hook useEffect has a missing dependency: 'token'  react-hooks/exhaustive-deps
  18:7  warning  React Hook useCallback has a missing dependency: 'id'    react-hooks/exhaustive-deps

/ui/src/b.tsx
  30:1  warning  React Hook useMemo has an unnecessary dependency: 'x'  react-hooks/exhaustive-deps

✖ 3 problems (0 errors, 3 warnings)
"""

ESLINT_NO_DEPS = """
✖ 12 problems (0 errors, 12 warnings)
"""


def self_test() -> int:
    """Liveness for measure(), which is the leg this ratchet cannot self-detect.

    This gate runs in dev-ci (static-gates) and check.sh and had no test of any
    kind. Its whole comparison is a regex count against a cap, so the failure that
    hides is narrow and total: if RULE_RE stops matching, measure() returns deps == 0,
    0 is under any cap, and the ratchet reports CLEAN on a tree full of the warnings
    it exists to hold down. Nothing else here would notice -- the gate would not
    fail, it would simply stop counting.

    So the first case is the anti-zero case: realistic eslint output MUST yield a
    non-zero exhaustive-deps count. Proven by mutation -- pointing RULE_RE at a
    pattern that cannot match turns it red with deps == 0, which is the exact silent
    state. The rest cover the fail-closed branches measure() already has, because a
    self-test that only tests the happy path proves nothing about the guard rails.

    Pure measure() cases, plus run_eslint() graded end-to-end against a FAKE linter in
    a scratch tree (created under tempfile.mkdtemp, removed in a finally; the UI module
    global is repointed for them and restored). The real eslint is never invoked: the
    self-test would then depend on node_modules and take as long as the gate itself.
    """
    bad: list[str] = []

    def want(name: str, got, expect) -> None:
        if got != expect:
            bad.append(f"{name}: expected {expect!r}, got {got!r}")

    # The anti-zero case. deps must be 3, not 0.
    want("exhaustive-deps counted, not missed", measure(ESLINT_WITH_DEPS), (3, 3))
    # Output carrying warnings but none of THIS rule must read 0, not N.
    want("other rules do not inflate the count", measure(ESLINT_NO_DEPS), (12, 0))
    # Fail-closed branch 1: no parseable summary must raise, never return.
    try:
        measure("some output with no summary line at all")
        bad.append("unparseable output: expected SystemExit, got a value")
    except SystemExit:
        pass
    # THE CLEAN CASE, which this self-test could not previously express and which the
    # gate therefore could not distinguish from a broken run: eslint 9 prints no summary
    # when there is nothing to report, so ("", 0) must read as a real zero.
    want("a clean tree reports a real zero", measure("", 0), (0, 0))
    # ...but silence from a NON-ZERO exit is still not a zero.
    try:
        measure("", 1)
        bad.append("silent failure: expected SystemExit, got a value")
    except SystemExit:
        pass
    # Fail-closed branch 2: deps > warnings means the format changed.
    try:
        measure("1 problems (0 errors, 1 warnings)\n"
                 "react-hooks/exhaustive-deps\nreact-hooks/exhaustive-deps\n"
                 "react-hooks/exhaustive-deps")
        bad.append("inconsistent parse: expected SystemExit, got a value")
    except SystemExit:
        pass

    # run_eslint() -- the only leg that touches the real world, and no case reached it:
    # everything above feeds measure() strings directly, so the sweep blanked the runner
    # invisibly (2026-11-06). A blanked stub crashes main() on the tuple unpack, but the
    # quiet mutations are scope ones: dropping cwd=UI lints the WRONG TREE, dropping the
    # stderr concat loses config errors, and dropping the existence guard turns the
    # friendly refusal into a raw FileNotFoundError. Graded against a fake eslint that
    # types a marker (proving WHERE it ran), pings stderr, emits one real-shaped finding
    # and exits 1 -- exit codes must be captured, per the module docstring's own history.
    # The UI global is repointed and restored in a finally.
    def ok(name, cond):
        if not cond:
            bad.append(name)

    def case(name, got, expect):
        if got != expect:
            bad.append(f"{name}: expected {expect!r}, got {got!r}")

    MARKER = "MARKER-exhdeps-7f3a"
    scratch = tempfile.mkdtemp(prefix="exhdeps-")
    real_ui = UI
    try:
        bin_dir = os.path.join(scratch, "node_modules", ".bin")
        os.makedirs(bin_dir)
        with open(os.path.join(scratch, "marker.txt"), "w", encoding="utf-8") as fh:
            fh.write(MARKER + "\n")
        with open(os.path.join(bin_dir, "eslint.cmd"), "w", encoding="ascii") as fh:
            fh.write("@echo off\r\n"
                     "type marker.txt\r\n"
                     "echo STDERR-PING 1>&2\r\n"
                     "echo c.tsx 1:7 warning Hook has a missing dependency "
                     "react-hooks/exhaustive-deps\r\n"
                     "echo 2 problems ^(0 errors, 2 warnings^)\r\n"
                     "exit /b 1\r\n")
        with open(os.path.join(bin_dir, "eslint"), "w", encoding="ascii") as fh:
            fh.write("#!/bin/sh\n"
                     "cat marker.txt\n"
                     "echo STDERR-PING >&2\n"
                     'echo "c.tsx 1:7 warning Hook has a missing dependency '
                     'react-hooks/exhaustive-deps"\n'
                     'echo "2 problems (0 errors, 2 warnings)"\n'
                     "exit 1\n")
        os.chmod(os.path.join(bin_dir, "eslint"), 0o755)
        try:
            # r194: the scratch tree is passed EXPLICITLY -- the UI-global
            # repointing-and-restoring dance is gone with the contract
            code, output = run_eslint(scratch)
            case("run_eslint captures the fake linter's exit code", code, 1)
            case("it runs IN the repointed UI (marker typed) and keeps stderr",
                 (MARKER in output, "STDERR-PING" in output), (True, True))
            want("the full pipeline measures the fake run", measure(output, code), (2, 1))

            bare = os.path.join(scratch, "bare")
            os.makedirs(bare)
            try:
                run_eslint(bare)
                bad.append("missing eslint: expected the SystemExit refusal, got a value")
            except SystemExit:
                pass
            except Exception as exc:
                bad.append("missing eslint: expected the SystemExit refusal, got "
                           + type(exc).__name__)
        finally:
            pass
    finally:
        shutil.rmtree(scratch, ignore_errors=True)

    # r194: main()'s shell -- argv and root graded against a tempdir fixture
    # carrying a ui/ tree with a FAKE project-local eslint, the r166..r193
    # pattern. The over-cap and missing-eslint cases kill a root-dropping
    # main: the real tree runs its real eslint clean under the real cap, so
    # it returns 0 where the fixture demands 1 or the refusal.
    import contextlib as _ctx
    import io as _io
    from pathlib import Path  # r194: this module is os.path-native otherwise
    shell = 0
    STUB = ("#!/bin/sh" + chr(10)
            + "echo \"c.tsx 1:7 warning Hook has a missing dependency react-hooks/exhaustive-deps\"" + chr(10)
            + "echo \"1 problem (0 errors, 1 warnings)\"" + chr(10)
            + "exit 0" + chr(10))
    STUB2 = ("#!/bin/sh" + chr(10)
             + "echo \"eslint: config error\"" + chr(10)
             + "exit 2" + chr(10))
    # the .cmd twin needs BATCH syntax -- an sh body under a .cmd name prints
    # its quotes and mangles the summary line (the fixture must speak the
    # language of the file name the runner will actually execute)
    STUB_CMD = ("@echo off\r\n"
                + "echo c.tsx 1:7 warning Hook has a missing dependency react-hooks/exhaustive-deps\r\n"
                + "echo 1 problem (0 errors, 1 warnings)\r\n"
                + "exit /b 0\r\n")
    STUB2_CMD = ("@echo off\r\n"
                 + "echo eslint: config error\r\n"
                 + "exit /b 2\r\n")
    def _shell(files, argv=()):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            for rel, content in files.items():
                dst = base / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding="utf-8")
            (base / "scripts").mkdir(parents=True, exist_ok=True)  # the gate writes here
            bin_eslint = base / "ui" / "node_modules" / ".bin" / ("eslint.cmd" if os.name == "nt" else "eslint")
            bin_eslint.parent.mkdir(parents=True, exist_ok=True)
            if os.name == "nt":
                bin_eslint.write_text(STUB2_CMD if "usage" in argv else STUB_CMD, encoding="utf-8")
            else:
                bin_eslint.write_text(STUB2 if "usage" in argv else STUB, encoding="utf-8")
            try:
                os.chmod(bin_eslint, 0o755)
            except OSError:
                pass
            cap = 0 if "cap0" in argv else 2
            (base / "scripts" / "exhaustive-deps-baseline.json").write_text(
                '{"max_exhaustive_deps": ' + str(cap) + '}', encoding="utf-8")
            out, err = _io.StringIO(), _io.StringIO()
            try:
                with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                    rc = main(argv=list(argv and [a for a in argv if not a.startswith(("cap0", "usage"))]), root=base)
            except SystemExit as se:
                return se.code, out.getvalue() + err.getvalue()
            return rc, out.getvalue() + err.getvalue()
    shell += 1
    rc, text = _shell({"ui/src/c.tsx": "// linted\n"}, argv=("cap0",))
    if rc != 1 or "exceed the cap of 0" not in text:
        print("  x an over-cap count must fail naming the cap (rc=%r text=%r)" % (rc, text[-90:]),
              file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({"ui/src/c.tsx": "// linted\n"})
    if rc != 0 or "below cap -- consider lowering it to 1" not in text:
        print("  x a below-cap count must read ok with the suggestion (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({"ui/src/c.tsx": "// linted\n"}, argv=("--set-baseline",))
    if rc != 0 or "baseline set to 1" not in text:
        print("  x --set-baseline must record the current count (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    # the post-condition lives INSIDE the tempdir with, per the fixture rules
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        for rel, content in {"ui/src/c.tsx": "// linted\n"}.items():
            dst = base / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_text(content, encoding="utf-8")
        bin_eslint = base / "ui" / "node_modules" / ".bin" / ("eslint.cmd" if os.name == "nt" else "eslint")
        bin_eslint.parent.mkdir(parents=True, exist_ok=True)
        bin_eslint.write_text(STUB_CMD if os.name == "nt" else STUB, encoding="utf-8")
        try:
            os.chmod(bin_eslint, 0o755)
        except OSError:
            pass
        # main() LOADS the cap before --set-baseline can write one: the fixture
        # must already carry a baseline, exactly like the real tree does
        (base / "scripts").mkdir(parents=True, exist_ok=True)
        (base / "scripts" / "exhaustive-deps-baseline.json").write_text(
            '{"max_exhaustive_deps": 5}', encoding="utf-8")
        rc = main(argv=["--set-baseline"], root=base)
        written = json.loads((base / "scripts" / "exhaustive-deps-baseline.json").read_text(encoding="utf-8"))
        if written.get("max_exhaustive_deps") != 1:
            print("  x the baseline file must carry the measured count, got %r" % (written,),
                  file=sys.stderr)
            return 1
    shell += 1
    rc, text = _shell({}, argv=("usage",))
    if not (isinstance(rc, str) and rc.startswith("eslint exited 2")):
        print("  x a usage-error lint must fail closed on the run itself (rc=%r)" % (rc,),
              file=sys.stderr)
        return 1
    shell += 1
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)  # a ui/ with NO eslint binary at all
        (base / "scripts").mkdir(parents=True, exist_ok=True)
        (base / "scripts" / "exhaustive-deps-baseline.json").write_text(
            '{"max_exhaustive_deps": 2}', encoding="utf-8")
        try:
            main(argv=[], root=base)
            print("  x a missing linter must refuse, not pass", file=sys.stderr)
            return 1
        except SystemExit as se:
            if "eslint not found" not in str(se.code):
                print("  x the missing-linter refusal must name the path (rc=%r)" % (se.code,),
                      file=sys.stderr)
                return 1
    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (10 cases: 6 pure + 4 through a fake eslint + %d shell cases, "
          "one scratch tree removed)" % shell)
    return 0


def main(argv=None, root=None) -> int:
    """r194: argv and root parameterized, the r166..r193 contract -- root
    redirects the UI tree AND the ratchet file together."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--set-baseline", action="store_true", help="record the current count as the cap")
    ap.add_argument("--self-test", action="store_true",
                    help="Run this checker's measure() cases and exit. Pure: reads no file.")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()
    base = Path(REPO) if root is None else Path(root).resolve()

    code, output = run_eslint(base / "ui")
    # eslint exits 1 when there are problems and 2 on a usage/config error; both mean the number
    # below may be garbage, so surface it. Exit 0 is the only fully clean case.
    if code == 2:
        raise SystemExit(f"eslint exited 2 (usage or config error), output:\n{output[:600]}")

    warnings, deps = measure(output, code)
    baseline = load_baseline(base / "scripts" / "exhaustive-deps-baseline.json")
    print(f"  warnings total: {warnings}   exhaustive-deps: {deps}   cap: {baseline}")

    if args.set_baseline:
        with open(base / "scripts" / "exhaustive-deps-baseline.json", "w",
                  encoding="utf-8", newline="\n") as fh:
            json.dump(
                {
                    "max_exhaustive_deps": deps,
                    "_note": (
                        "Ratchet cap for react-hooks/exhaustive-deps warnings. Lower it whenever a "
                        "stale closure is fixed; never raise it to make the build pass -- each unit "
                        "is a callback that can capture a stale sessionToken and read or write the "
                        "wrong store (item 69)."
                    ),
                }
                | {},
                fh,
                indent=2,
                sort_keys=False,
            )
            fh.write("\n")
        print(f"  baseline set to {deps}")
        return 0

    if deps > baseline:
        offenders = [
            ln.strip() for ln in output.splitlines() if RULE_RE.search(ln)
        ]
        print(f"  FAIL: {deps} exhaustive-deps warnings exceed the cap of {baseline}")
        for ln in offenders:
            print(f"    {ln[:150]}")
        print(
            "\n  Each of these is a callback or effect that reads a value it does not list. In this\n"
            "  codebase the dangerous instances are the ones that read sessionToken or another\n"
            "  store-scoped value: the closure keeps the token from the render that built it, so the\n"
            "  next store switch leaves the handler writing to the previous store. Fix the deps\n"
            "  array; do not raise the cap."
        )
        return 1
    if deps < baseline:
        print(f"  ok (below cap -- consider lowering it to {deps} to lock in the improvement)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
