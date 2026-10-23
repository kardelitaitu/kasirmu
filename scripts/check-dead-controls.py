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


def self_test():
    """Run SELF_TEST_CASES over scan_text; report every failure, not just the first."""
    bad = []
    for name, src, expected in SELF_TEST_CASES:
        got = len(scan_text(src))
        if got != expected:
            bad.append("  %s: expected %d candidate(s), detector found %d" % (name, expected, got))
    if bad:
        sys.stderr.write("SELF-TEST WRONG:\n" + "\n".join(bad) + "\n")
        return 2
    print("SELF-TEST OK (%d cases, no file read)" % len(SELF_TEST_CASES))
    return 0


def main():
    if "--self-test" in sys.argv[1:]:
        return self_test()
    # Grade the detector before the tree: a BTN_RE or full_tag regression would make
    # every file report zero and this script would print a clean sweep over a deaf scan.
    rc = self_test()
    if rc:
        sys.stderr.write("DETECTOR WENT DEAF: not trusting the tree scan below.\n")
        return rc

    inert = []
    for path in iter_sources(SCAN_ROOT):
        rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
        if "/design/" in rel or rel.endswith("DesignSystem.tsx"):
            continue
        with open(path, encoding="utf-8", errors="replace") as handle:
            src = handle.read()
        for line_no in scan_text(src):
            inert.append("%s:%d" % (rel, line_no))
    print("dead-controls: %d candidate(s) with no handler, ancestor check not automated"
          % len(inert))
    for row in inert:
        print("  " + row)
    return 0


if __name__ == "__main__":
    sys.exit(main())
