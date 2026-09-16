#!/usr/bin/env python3
"""Do the paths cited by OPEN plan rows still exist in the tree?

Written for `todo-refactor-oz-pos-app-agents-3.md`, whose rows carry their receipts as backticked
paths and line numbers. A row whose cited file has been renamed or deleted is a row whose premise
has expired, and reading 14 long rows by eye to find out is not a check anyone repeats.

WHAT THIS CAN AND CANNOT SAY, stated because the first run answered its own question wrongly:
it grades EXISTENCE, never truth. Run against the current ledger it reported one absent path,
`ui/src/api/index.ts`, and that was a FALSE POSITIVE -- the row cites it precisely because it does
not exist ("`ui/src/api/index.ts` does not exist and no file in `ui/src/api` matches
`export * from` (0 files)"), the absence being the evidence for a caller-census claim. So a
citation inside a sentence carrying a negation cue is counted separately and never reported as
stale. That is a heuristic, it is labelled as one in the output, and it errs in the direction of
silence: the safe reading of any hit here is "go look", not "this row is wrong".

Line numbers cited in backticks (`file.rs:123`) are deliberately NOT checked. They were checked
once by hand this session and one of them had already rotted (a peer deleted a file and shifted
the rest), and a tool that reports stale line numbers on every row would drown the path findings in
noise this ledger's own convention already disowns: names carry, lines rot.

Usage:
    python .agents/verify-plan-citations.py [path/to/plan.md ...]
    python .agents/verify-plan-citations.py --self-test
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

ROW_RE = re.compile(r"^[ \t]*[-*][ \t]+\[[ \t]\][ \t]+(.*)$", re.M)
CITE_RE = re.compile(r"`((?:ui|apps|crates|scripts|docs|packages|modules|platform|tests)/[A-Za-z0-9_./+-]*)`")
# Cues that the sentence is ASSERTING an absence. Deliberately narrow: a lead worth reading is a
# path cited as present whose file is gone, and mis-firing in that direction costs a wasted look.
NEGATION_RE = re.compile(
    r"does not exist|doesn't exist|no such|not present|do not exist|absent|nowhere|deleted|"
    r"retired|removed|0 files|0 matches|returns nothing|cannot be found",
    re.I,
)


def classify(text: str, start: int, end: int) -> str:
    """Was this citation asserted as absent by its own sentence?"""
    lo = max(start - 240, text.rfind("\n", 0, start) + 1)
    hi = text.find(".", end)
    hi = len(text) if hi < 0 else min(hi + 1, len(text), end + 240)
    return "asserted-absent" if NEGATION_RE.search(text[lo:hi]) else "asserted-present"


def check(plan: pathlib.Path) -> tuple[int, int, int, list[str]]:
    body = plan.read_text(encoding="utf-8", errors="replace")
    rows = ROW_RE.findall(body)
    cited = present = absent_cues = 0
    stale: list[str] = []
    for m in CITE_RE.finditer(body):
        # Only count citations that live inside an OPEN row; a closed row is a historical record
        # and its paths are allowed to have moved, which is what "historical" means here.
        line_start = body.rfind("\n", 0, m.start()) + 1
        line = body[line_start:body.find("\n", line_start)]
        if not re.match(r"^[ \t]*[-*][ \t]+\[[ \t]\]", line):
            continue
        path = re.sub(r":\d+(?:-\d+)?$", "", m.group(1)).rstrip(".,;:")
        if "*" in path or " " in path or path.endswith("/"):
            continue
        cited += 1
        target = ROOT / path
        if target.exists():
            present += 1
            continue
        if classify(body, m.start(), m.end()) == "asserted-absent":
            absent_cues += 1
            continue
        stale.append(path)
    return len(rows), cited, present, (absent_cues, stale)  # type: ignore[return-value]


def self_test() -> int:
    """Fixtures, on a temp tree, for the four directions that matter.

    The case that earns the file its place is (c): an absent path inside a negated sentence must
    NOT be reported, because that is the exact false positive this tool produced on its first run
    against the real ledger.
    """
    import tempfile

    ok = bad = 0

    def case(label: str, cond: bool) -> None:
        nonlocal ok, bad
        if cond:
            ok += 1
            print(f"  ok    {label}")
        else:
            bad += 1
            print(f"  WRONG {label}")

    with tempfile.TemporaryDirectory() as td:
        root = pathlib.Path(td)
        (root / "ui" / "src").mkdir(parents=True)
        (root / "ui" / "src" / "real.ts").write_text("x\n", encoding="utf-8")
        plan = root / "plan.md"
        globals()["ROOT"] = root
        plan.write_text(
            "\n".join([
                "- [ ] **A · present path.** Calls `ui/src/real.ts` today.",
                "- [ ] **B · gone path.** Writes into `ui/src/gone.ts` and nothing else.",
                "- [ ] **C · asserted absence.** `ui/src/none.ts` does not exist, so no barrel hides a caller.",
                "- [x] **D · closed row.** Its `ui/src/gone2.ts` is history and not graded.",
                "- [ ] **E · not a path.** Mentions `some_local_var` and `docs/a *.ts` glob.",
            ]),
            encoding="utf-8",
        )
        n_rows, n_cited, n_present, (n_cues, stale) = check(plan)
        # 3, not 5: row D is closed, and row E's two backticked tokens are a bare identifier and a
        # glob, so neither is a repo path. The first version of this line asserted 4, which was a
        # guess about the fixture rather than a reading of it -- the same error the ledger records
        # at T28, where two of three control expectations were beliefs. Wrong expectation, right
        # tool: the assertion failed and the number printed beside it explained why.
        case(f"population is reported (rows={n_rows}, citations={n_cited})", n_rows == 4 and n_cited == 3)
        case("a present path is counted and not reported", n_present == 1 and "ui/src/real.ts" not in stale)
        case("an absent path in a positive sentence IS reported", stale == ["ui/src/gone.ts"])
        case("an absent path in a negated sentence is excluded, and the exclusion is counted",
             "ui/src/none.ts" not in stale and n_cues == 1)
        case("a closed row is not graded", "ui/src/gone2.ts" not in stale)
        case("non-path backticks are ignored", not any("some_local_var" in s for s in stale))
    return ok, bad  # type: ignore[return-value]


def main() -> int:
    if "--self-test" in sys.argv:
        ok, bad = self_test()
        print(f"\nverify-plan-citations self-test: {ok + bad} assertions, {bad} failed")
        return 1 if bad else 0

    plans = [pathlib.Path(a) for a in sys.argv[1:] if not a.startswith("-")] or [
        ROOT / "todo-refactor-oz-pos-app-agents-3.md"
    ]
    worst = 0
    for plan in plans:
        if not plan.exists():
            print(f"{plan}: not found")
            worst = 1
            continue
        n_rows, n_cited, n_present, (n_cues, stale) = check(plan)
        print(f"\n{plan.name}")
        print(f"  open rows: {n_rows}   repo-path citations inside them: {n_cited}")
        print(f"  present: {n_present}   asserted-absent (excluded by negation cue): {n_cues}")
        print(f"  coverage: {n_cited} citations is the denominator -- rows that cite no backticked "
              f"path contribute nothing here, so a clean run is not a clean ledger")
        if stale:
            worst = 1
            for p in sorted(set(stale)):
                print(f"  STALE  {p}  -- cited as if present, not on disk. GO LOOK; this tool reads "
                      f"existence, not intent.")
        else:
            print("  no citation asserts a path that is absent from the tree")
    print("\nnote: existence only. A path can be present and the sentence about it still wrong.")
    return worst


if __name__ == "__main__":
    sys.exit(main())
