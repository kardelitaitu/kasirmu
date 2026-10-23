#!/usr/bin/env python3
"""Detect tracked files in the DEPLOYED prototypes/ tree that nothing references.

WHY THIS EXISTS

`website/scripts/sync-dev-files.mjs` copies the whole repo-root `prototypes/` folder
into `website/public/dev/`, which Astro publishes at https://kasir.mu/dev/. The copy is
`cpSync(..., { recursive: true })` filtered only on `node_modules`, `.git` and `dist`,
so EVERY tracked file under `prototypes/` ships to a public origin -- including one no
page loads.

The file that motivated this: `prototypes/kds-prototype-plugin.js` (201 lines, exported
since the`dev/` -> `prototypes/` rename fc9155447 and untouched since). It exports
`apply(ctx)` and registers through `slots.inject('tool.view.cordis', ...)` -- a host
plugin API that exists NOWHERE ELSE in the repository. `git grep tool.view.cordis`
matches only inside this file. Neither `kds-prototype.html` nor `design-language.html`
references it, and neither does `app.js`, `manifest.json` or `sw.js`.

It also carries `window.confirm()`, which `ui/src/__tests__/nativeDialogCompliance.
test.ts` forbids in application code on the grounds that an OS dialog is off-design,
unlocalized and blocks the event loop. That guard scans `ui/src` only, so it cannot see
this file -- and the sibling HTML page already replaced the same consent step with a
styled modal ("P4" in its own comment), which means the two copies have diverged.

WHAT THIS CHECKS, AND WHAT IT DELIBERATELY DOES NOT

A reference is a text occurrence of the file's basename anywhere else in the tracked
tree. That is intentionally weak evidence of LIFE and strong evidence of ORPHANHOOD: a
file named nowhere cannot be loaded by anything, so a hit here is real. The converse is
not claimed -- a named file may still be dead -- and the report says so rather than
implying the tree has been proven reachable.

WHY DEV-ONLY CONTENT IS STILL WORTH CHECKING

These pages are dev-only in the sense that no app shell boots them, and the repo records
that boundary (`themeTokenCompliance.test.ts` excludes them from the boot-document font
rule with that reasoning). "Dev-only" is not the same as "not published", though: this
tree IS deployed, so an orphan here is dead weight on a public origin rather than a
private convenience.

Exit codes: 0 always (report only) unless --strict, then 1 when any orphan is found,
and 2 when the detector fails its own self-test (`--self-test` runs those cases alone).

WHY THERE IS A SELF-TEST

`orphans()` is two lines long and its whole answer is a set difference over a corpus.
That shape has failed silently on this project before: a regex that stops matching, or a
corpus that silently becomes the empty string, both make every file look REFERENCED, and
the gate prints "0 orphan(s)" with the same confidence as a real clean pass. The cases
below pin both directions -- a file nobody names IS reported, and a file named once IS
not -- plus the `+ 1` baseline direction that produced a false positive the first time
this was written.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TREE = "prototypes"

def tracked_files() -> list[str]:
    """Tracked paths, via git, so build output and gitignored copies never appear."""
    out = subprocess.run(
        ["git", "ls-files", TREE],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [line for line in out.splitlines() if line.strip()]

def all_tracked_text() -> str:
    """Every tracked file's text, so a reference from ANY path counts."""
    out = subprocess.run(
        ["git", "ls-files"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    blob = []
    for rel in out:
        if not rel.strip():
            continue
        path = REPO_ROOT / rel
        try:
            blob.append(path.read_text(encoding="utf-8", errors="ignore"))
        except (OSError, UnicodeDecodeError):
            continue  # binary or unreadable: cannot hold a text reference
    return "\n".join(blob)

def basename(path: str) -> str:
    return path.rsplit("/", 1)[-1]

def orphans(files: list[str], corpus: str) -> list[str]:
    """Files whose basename appears nowhere in `corpus` except their own path line.

    The corpus is the tracked file CONTENTS, so a file's own path is NOT part of it and
    the baseline is 0. This was measured after a first draft got it wrong: that draft
    assumed the `git ls-files` path output was in the corpus and tested `hits <= 1`,
    which reported `styles.css` as an orphan even though `design-language.html:10` loads
    it. A wrong baseline turns a referenced file into a false positive, so the count is
    asserted against measured reality rather than assumed.
    """
    found = []
    for rel in files:
        name = basename(rel)
        # Occurrences of the bare name, as a whole token so `plugin` does not match
        # `kds-prototype-plugin.js` by accident.
        hits = len(re.findall(re.escape(name), corpus))
        # Baseline is 0: the corpus holds file CONTENTS, and a file does not name itself.
        # Any occurrence at all is a reference from somewhere else. Measured, not assumed
        # -- see the docstring for the false positive that a `<= 1` reading produced.
        if hits == 0:
            found.append(rel)
    return found

#: Synthetic cases: (name, tracked files, corpus, expected orphan list).
#: Each is a SHAPE the detector must still classify correctly. If any stops matching,
#: the gate has gone deaf and must not be trusted for a clean report.
SELF_TEST_CASES = (
    # Direction 1: named nowhere -> an orphan. The whole reason the gate exists.
    ("unreferenced is an orphan", ["prototypes/a.js"], "nothing here", ["prototypes/a.js"]),
    # Direction 2: one mention anywhere in the tracked tree is enough.
    (
        "a single mention clears it",
        ["prototypes/a.js"],
        '<script src="a.js">',
        [],
    ),
    # Direction 3: the bug that the first draft shipped. Treating the git ls-files
    # PATH output as part of the corpus made every file hit at least once, so this
    # case pins that the corpus is CONTENTS ONLY by asserting the empty corpus is
    # correctly read as "nothing references anything".
    ("empty corpus reports every file", ["prototypes/a.js"], "", ["prototypes/a.js"]),
    # Direction 4: two files, only one named -- the difference, not a whole-set answer.
    (
        "reports the one file of two that is unnamed",
        ["prototypes/a.js", "prototypes/b.js"],
        "loads b.js only",
        ["prototypes/a.js"],
    ),
    # Direction 5: an empty file list is not a clean tree, it is a tree that was not
    # read. main() short-circuits on it; here the detector itself must not invent one.
    ("no files at all finds nothing", [], "anything", []),
)


def self_test() -> int:
    """Run :data:`SELF_TEST_CASES` and report every failure, not just the first."""
    bad = []
    for name, files, corpus, expected in SELF_TEST_CASES:
        got = orphans(list(files), corpus)
        if got != expected:
            bad.append(f"  {name}: expected {expected!r}, detector returned {got!r}")
    if bad:
        print("SELF-TEST WRONG:", file=sys.stderr)
        print("\n".join(bad), file=sys.stderr)
        return 2
    print(f"SELF-TEST OK ({len(SELF_TEST_CASES)} cases, no file read)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--strict", action="store_true", help="exit 1 when any orphan is found")
    ap.add_argument("--self-test", action="store_true", help="run this checker's cases and exit")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    # Grade the detector before grading the tree: a corpus read that silently returned
    # "" would make every file look referenced, and this gate would print 0 orphans
    # with full confidence. The cases above are what that reads as.
    rc = self_test()
    if rc:
        print("DETECTOR WENT DEAF: not trusting the tree scan below.", file=sys.stderr)
        return rc

    files = tracked_files()
    if not files:
        print(f"orphan-prototype-files: no tracked files under {TREE}/ -- nothing to check")
        return 0

    corpus = all_tracked_text()
    found = orphans(files, corpus)

    if not found:
        print(f"orphan-prototype-files: 0 orphan(s) among {len(files)} deployed file(s)")
        return 0

    print(f"orphan-prototype-files: {len(found)} orphan(s) among {len(files)} deployed file(s)")
    print("  These ship to https://kasir.mu/dev/ via website/scripts/sync-dev-files.mjs")
    print("  (a recursive copy of prototypes/) and are named in NO tracked file:")
    for rel in found:
        print(f"    {rel}")
    print("  Fix: delete it, or wire it into a page that loads it.")
    print("")
    print("  LIMIT, stated rather than hidden: a file whose name appears only in PROSE (a")
    print("  doc or comment) is counted as referenced, because a text scan cannot tell a")
    print("  mention from a load. `prototypes/kds-prototype-server.bat` is exactly that case")
    print("  today -- its one occurrence is a sentence in a completed plan doc, and no page")
    print("  loads it. The report is a floor on the orphans, not an exact count.")
    return 1 if args.strict else 0

if __name__ == "__main__":
    sys.exit(main())
