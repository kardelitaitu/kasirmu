#!/usr/bin/env python3
"""check-dead-controls.py -- list <button>/<Button> with no handler of its own.

Two classes of "no onClick", and the difference is the whole point:

  * INERT   -- no ancestor handler either. The control renders, takes focus, is announced,
              and does nothing at all. FOUND TWICE: TransactionLogScreen.tsx "Details"
              (round 155) and WorkspaceHome.tsx "user profile" (round 156).
  * RESCUED -- an ancestor handles the click, so it works by bubbling. Also a defect, but a
              different one: an aria-nested-interactive violation, and it dies the moment
              any consumer stops propagation.

A grep for onClick finds NEITHER reliably: an inert control has no onClick to grep for, and
a rescued one has one on an ancestor that looks intentional. This script reads the FULL
opening tag (bracket-aware, so a multi-line onClick is not missed -- a line-window match
produced six false positives in round 155 before it was corrected) and reports both
classes separately.

KNOWN NOISE, measured after the round-156 sweep: features/design/* showcase buttons are
handler-less on purpose -- they demonstrate the component, they are not operated. 44 of the
48 that sweep found were that. The remaining 4 were comment lines inside explanatory
comments, which is why a tag whose line starts with // or * is skipped.

WHY THERE IS A SELF-TEST

Every defect this script has had was the same shape: a rule that was right for the
case in front of it and wrong for a neighbour, and the report stayed at "0
candidate(s)" while being deaf. Three are recorded above -- the line-window tag read,
the bare submit substring, and the tag inside a multi-line comment. The cases below
pin all three plus the two real defects it found, so a later edit to full_tag,
in_comment or the handler rule reddens here instead of quietly reporting a clean tree.

USAGE
  python3 scripts/check-dead-controls.py             # report
  python3 scripts/check-dead-controls.py --self-test # prove the detector still sees
"""

import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCAN_ROOT = os.path.join(ROOT, "ui", "src", "features")

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies files under its default temp (measured 2026-11-09 on the
#: agent host: every write into a TemporaryDirectory is EPERM) can point this at
#: a directory it allows; unset leaves tempfile's own default in force.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root this file's fixtures are written under (None = system default)."""
    return next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)
BTN_RE = re.compile(r"<(?:Button|button)\b")
QUOTES = ('"', '`')
#: Only the type="submit" ATTRIBUTE drives a form. A bare "submit" substring
#: matched aria-label="submit" and produced five false positives on the first run.
SUBMIT_TYPE_RE = re.compile(r'type\s*=\s*(?:"submit"|\'submit\')')


def full_tag(src, start):
    """The complete opening tag, bracket- and string-aware."""
    depth = 0
    quote = None
    i = start
    n = len(src)
    while i < n:
        c = src[i]
        if quote:
            if c == quote and src[i - 1] != chr(92):
                quote = None
            i += 1
            continue
        if c in QUOTES:
            quote = c
            i += 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c == ">" and depth == 0:
            return src[start:i + 1]
        i += 1
    return ""


def line_of(src, idx):
    return src.count(chr(10), 0, idx) + 1


def in_comment(src, idx):
    """True when `idx` sits inside a // line comment, a /* */ block, or a JSX {/* */}."""
    line_start = src.rfind(chr(10), 0, idx) + 1
    if re.match(r"\s*(//|\*)", src[line_start:idx]):
        return True
    block = src.rfind("/*", 0, idx)
    close = src.rfind("*/", 0, idx)
    return block > close


def iter_sources(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", "__tests__")]
        for name in filenames:
            if name.endswith(".tsx") and ".test." not in name:
                yield os.path.join(dirpath, name)


#: Synthetic sources: (name, tsx text, expected number of reported candidates).
#: Each is a SHAPE this detector has had to learn; the comment says which.
SELF_TEST_CASES = (
    # The defect that motivated the script (round 155, TransactionLogScreen "Details").
    ("inert button is reported", "<Button>Details</Button>", 1),
    # The rescued shape: no handler on the tag, one on an ancestor. Still reported --
    # bubbling works, but the nesting is an aria violation, so silence here is wrong.
    ("rescued by an ancestor is still reported", "<div onClick={f}><Button>x</Button></div>", 1),
    # A multi-line onClick. A line-window read missed this and produced six false
    # positives in round 155; the bracket-aware tag read is what fixed it.
    ("multi-line handler is not reported", '<Button\n  onClick={() => go()}\n  label="x"\n/>', 0),
    # Bare "submit" substring produced five false positives on the first run. Only the
    # type="submit" ATTRIBUTE is a handler.
    ("type=submit is a handler", '<button type="submit">Save</button>', 0),
    ("the word submit is not a handler", '<button aria-label="submit">Save</button>', 1),
    # A tag inside a multi-line block comment re-reported the two FIXED defects.
    ("tag inside a block comment is skipped", "/*\n <button>old</button>\n*/", 0),
    ("tag inside a JSX comment is skipped", "{/* <Button>x</Button> */}", 0),
    # href / disabled: a link has its own navigation, and a disabled control cannot fire.
    ("link is not a dead control", '<a href="/x">x</a>', 0),
    ("a plain <button> is matched the same as <Button>", "<button>x</button>", 1),
)


def scan_text(src):
    """Reported candidate line numbers for one source text. Shared by main and the cases."""
    found = []
    for m in BTN_RE.finditer(src):
        if in_comment(src, m.start()):
            continue
        tag = full_tag(src, m.start())
        if not tag:
            continue
        if "href=" in tag or "disabled" in tag:
            continue
        if "onSubmit=" in tag or "onClick=" in tag:
            continue
        if SUBMIT_TYPE_RE.search(tag):
            continue
        found.append(line_of(src, m.start()))
    return found


def sweep_verdict(scanned, candidates):
    """Exit code for a finished sweep: 2 read nothing, 1 found a dead control, 0 clean.

    WHY THIS IS A SEPARATE FUNCTION, and why it is new. Until 2026-11-06 main() printed the
    candidate list and then returned 0 unconditionally -- measured by planting an inert
    <Button> in a features/*.tsx and re-running: the row appeared on stdout and the step
    still exited 0. A wired step that prints a defect and passes is a report, not a gate,
    and the three recorded defects it exists for would each have shipped green. The
    candidates AND the corpus are both graded here, so the cases can pin the enforce half
    without a tree.
    """
    if scanned == 0:
        return 2
    return 1 if candidates else 0


_IN_SHELL = False   # r175: main() runs self_test() as a preflight before EVERY
                    # sweep, and the shell cases below call main(); without this
                    # guard that pair recurses until the stack dies. The nested
                    # preflight runs the detector cases only -- exactly what the
                    # preflight needs.


def self_test():
    global _IN_SHELL
    """Run SELF_TEST_CASES over scan_text; report every failure, not just the first."""
    bad = []
    for name, src, expected in SELF_TEST_CASES:
        got = len(scan_text(src))
        if got != expected:
            bad.append("  %s: expected %d candidate(s), detector found %d" % (name, expected, got))
    # The VERDICT half. Before 2026-11-06 these three relationships did not exist: a
    # candidate was printed and the run still exited 0, and a sweep of zero files exited 0
    # too. Both are silent passes of the shape this file's own history warns about.
    for scanned, candidates, expected in ((0, 0, 2), (0, 7, 2), (317, 0, 0), (317, 1, 1)):
        got = sweep_verdict(scanned, candidates)
        if got != expected:
            bad.append("  verdict(%d file(s), %d candidate(s)): expected %d, got %d"
                       % (scanned, candidates, expected, got))
    # r175: main()'s shell -- argv and root graded against a tempdir fixture,
    # the r166..r174 pattern. The design/ exemption and the empty-corpus
    # refusal are graded THROUGH main, not reimplemented in the cases.
    import contextlib as _ctxlib
    import io as _io
    import tempfile
    from pathlib import Path
    if _IN_SHELL:
        pass   # nested preflight: detector cases above suffice
    else:
      def _shell(files):
        global _IN_SHELL
        with tempfile.TemporaryDirectory(dir=fixture_root(),
                                             ignore_cleanup_errors=True) as td:
            root = Path(td)
            for rel, content in files.items():
                f = root / rel
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(content, encoding="utf-8")
            out, err = _io.StringIO(), _io.StringIO()
            with _ctxlib.redirect_stdout(out), _ctxlib.redirect_stderr(err):
                _IN_SHELL = True
                try:
                    rc = main(argv=[], root=root)
                finally:
                    _IN_SHELL = False
            return rc, out.getvalue() + err.getvalue()
      GOOD = "export const A = () => <Button onClick={go()}>ok</Button>\n"
      rc, text = _shell({"ui/src/features/x/Screen.tsx": GOOD})
      if rc != 0 or "0 candidate(s)" not in text or "1 file(s) read" not in text:
        bad.append("a handled button must sweep clean (rc=%d text=%r)" % (rc, text[-120:]))
      rc, text = _shell({"ui/src/features/x/Screen.tsx":
                       "export const A = () => <Button>Details</Button>\n"})
      if rc != 1 or "x/Screen.tsx:1" not in text:
        bad.append("an inert button must exit 1 naming file:line (rc=%d text=%r)"
                   % (rc, text[-120:]))
      rc, text = _shell({"ui/src/features/x/DesignSystem.tsx":
                       "export const D = () => <Button>show</Button>\n"})
      if rc != 0 or "0 candidate(s)" not in text:
        bad.append("a design showcase button must be exempt, not reported (rc=%d text=%r)"
                   % (rc, text[-120:]))
      with tempfile.TemporaryDirectory(dir=fixture_root(),
                                           ignore_cleanup_errors=True) as td:
        out, err = _io.StringIO(), _io.StringIO()
        with _ctxlib.redirect_stdout(out), _ctxlib.redirect_stderr(err):
            _IN_SHELL = True
            try:
                rc = main(argv=[], root=td)
            finally:
                _IN_SHELL = False
        if rc != 2 or "read no .tsx" not in (out.getvalue() + err.getvalue()):
            bad.append("an empty corpus must refuse with exit 2 (rc=%d)" % rc)

    if bad:
        sys.stderr.write("SELF-TEST WRONG:\n" + "\n".join(bad) + "\n")
        return 2
    print("SELF-TEST OK (%d detector cases + 4 verdict cases + 4 shell cases)"
          % len(SELF_TEST_CASES))
    return shell_ladder()


_LADDER_RUNNING = False


def shell_ladder():
    """Re-entry guard for the ladder (r239 -- the r228 lesson).

    Rung 4 drives --self-test through argv from INSIDE the ladder, and the
    self-test ends in this call, so without the guard that nested run would
    recurse. This file already carries a `_IN_SHELL` guard for its own shell
    cases; the two are independent, and neither substitutes for the other:
    `_IN_SHELL` stops main()'s PREFLIGHT from re-entering self_test(), while
    this one stops the self-test's TAIL from re-entering the ladder.
    """
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        print("  (ladder re-entry from a nested --self-test: skipped)")
        return 0
    _LADDER_RUNNING = True
    try:
        return _shell_ladder_body()
    finally:
        _LADDER_RUNNING = False


def _shell_ladder_body():
    """r239: the root contract, graded on fixture features trees through main().

    Rung 1 IS the killing rung. This checkout's features tree currently sweeps
    with no candidate (measured r239: exit 0 over 317 files), so a main() that
    ignored its root would print a clean sweep against a fixture holding an
    inert button. The fixture must exit 1 naming `x/Screen.tsx:1`.

    Rung 3 pins the exemption this gate's own history is about: the design/
    showcase exemption is matched against the ROOT-relative path, which main()
    computes with `ROOT if root is None else root`. A main that resolved the
    relative path against ROOT while sweeping the fixture would still exempt
    (the fixture path contains no /design/), but one that skipped the
    exemption entirely would report it -- the rung fails either way if the
    rule drifts, and the module comment at :260 says why that coupling exists.
    """
    import contextlib
    import io
    import tempfile

    def run(root_dir, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=str(root_dir))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    def build(tmp, files, label="fx"):
        """A fixture root holding the given {relative path: text} .tsx files."""
        base = tempfile.mkdtemp(dir=tmp, prefix=label + "_")
        for rel, text in files.items():
            p = os.path.join(base, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8", newline=chr(10)) as fh:
                fh.write(text)
        return base

    GOOD = "export const A = () => <Button onClick={go()}>ok</Button>\n"
    INERT = "export const A = () => <Button>Details</Button>\n"
    SHOWCASE = "export const D = () => <Button>show</Button>\n"

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: the fixture's inert button is reported.
        root = build(tmp, {"ui/src/features/x/Screen.tsx": INERT})
        rc, said = run(root)
        if rc != 1 or "x/Screen.tsx:1" not in said:
            print("  x rung 1: an inert fixture button must exit 1 naming file:line "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- a handled button sweeps clean, counting the fixture's corpus.
        root = build(tmp, {"ui/src/features/x/Screen.tsx": GOOD})
        rc, said = run(root)
        if rc != 0 or "0 candidate(s)" not in said or "1 file(s) read" not in said:
            print("  x rung 2: a handled fixture button must exit 0 counting one file "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- the design exemption is keyed on the root-relative path.
        root = build(tmp, {"ui/src/features/design/Show.tsx": SHOWCASE,
                           "ui/src/features/x/Screen.tsx": GOOD})
        rc, said = run(root)
        if rc != 0 or "2 file(s) read" not in said:
            print("  x rung 3: a design/ showcase must be exempt but still counted "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- --self-test dispatch flows through argv; re-entry is guarded.
        root = build(tmp, {"ui/src/features/x/Screen.tsx": GOOD})
        rc, said = run(root, "--self-test")
        if rc != 0 or "SELF-TEST OK" not in said or "ladder re-entry" not in said:
            print("  x rung 4: --self-test through argv must pass rc 0 and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5 -- the refusal floor: no features tree under the fixture root.
        empty = tempfile.mkdtemp(dir=tmp, prefix="empty_")
        rc, said = run(empty)
        if rc != 2 or "read no .tsx" not in said:
            print("  x rung 5: an empty corpus must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1

    print("DEAD-CONTROLS SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % shell)
    return 0


def main(argv=None, root=None):
    """r175: argv and root parameterized, the r166..r174 contract -- root
    redirects the sweep, so a fixture cannot half-run against the real ui tree."""
    if "--self-test" in (sys.argv[1:] if argv is None else argv):
        return self_test()
    # Grade the detector before the tree: a BTN_RE or full_tag regression would make
    # every file report zero and this script would print a clean sweep over a deaf scan.
    rc = self_test()
    if rc:
        sys.stderr.write("DETECTOR WENT DEAF: not trusting the tree scan below.\n")
        return rc

    scan_root = SCAN_ROOT if root is None else os.path.join(os.path.abspath(root), "ui", "src", "features")
    inert = []
    scanned = 0
    for path in iter_sources(scan_root):
        # Counted BEFORE the noise filter: this number measures the CORPUS, and a tree that
        # holds nothing but design/ showcases is a corpus this gate read, not an empty one.
        scanned += 1
        # rel stays ROOT-relative (fixture root when redirected): the design/
        # exemption below matches "/design/" IN the rel path, so a features-dir-
        # relative base would strip the prefix and report showcase buttons.
        rel = os.path.relpath(path, ROOT if root is None else os.path.abspath(root)).replace(os.sep, "/")
        if "/design/" in rel or rel.endswith("DesignSystem.tsx"):
            continue
        with open(path, encoding="utf-8", errors="replace") as handle:
            src = handle.read()
        for line_no in scan_text(src):
            inert.append("%s:%d" % (rel, line_no))
    if scanned == 0:
        sys.stderr.write(
            "error: swept %s and read no .tsx source file, so this run graded nothing and "
            "its verdict would be about an empty corpus rather than about the screens. "
            "The live tree reads 317.\n" % scan_root)
        return 2
    print("dead-controls: %d candidate(s) with no handler, ancestor check not automated "
          "(%d file(s) read)" % (len(inert), scanned))
    for row in inert:
        print("  " + row)
    if inert:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
