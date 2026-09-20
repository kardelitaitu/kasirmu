#!/usr/bin/env python3
"""Read a plan row in full, or audit which rows are too long for a clipped reader.

WHY THIS EXISTS. The read tool clips a line at 2000 characters, and a row in these work-order files
is ONE markdown line: `todo-refactor-oz-pos-agents-3.md` row 213 (T10) is **7,257 characters**. This
lane read that row three times this session, saw the first 2000 -- which is the task statement --
and never saw the tail, which is the disposition: "(c) NOT DONE: the two live ones, now T11". The row
was therefore effectively finished for four rounds while it read as open, and every earlier "I read
that row" claim made through a clipped view is a claim about the first ~27% of it.

The root AGENTS.md mirror already warns about exactly this for AGENTS.md itself ("compose a clause
from filesystem bytes, never from a read, because a single markdown line here runs to about fourteen
thousand characters while a read clips it at one thousand"). This is the same hazard, one file over,
and it generalises: the warning was written about prose this lane edits, and never applied to prose
this lane TICKS.

Usage:
    python .agents/scripts/plan-row.py [row-number] [--file PATH]      # print that row, whole
    python .agents/scripts/plan-row.py --audit [--file PATH] [--min N] # which rows outstrip a clip?
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

# Windows consoles default to cp1252 and these rows carry arrows and em dashes; a UnicodeEncodeError
# mid-print is itself a partial read, which is the thing being fixed.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CLIP = 2000  # what a `read` tool call returns for one long line
ROW_RE = re.compile(r"^[ \t]*[-*][ \t]+\[[ x]\][ \t]+\*\*(.+?)\*\*")

# Three levels up: this file lives in `.agents/scripts/`, so `.parent.parent` would be
# `.agents`. The default is anchored here rather than left relative to the CWD, because the
# work-order it names has moved once already (`.agents/` -> `.agents/reviews/`, plus the
# rebrand's `kasirmu` -> `oz-pos` and a `done-` prefix), and a bare relative default resolves
# to nothing from anywhere but the directory it used to sit in — which is how this tool came
# to answer `--audit` with "not found" instead of the row census it exists to print.
ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
DEFAULT_PLAN = ROOT / ".agents" / "reviews" / "done-todo-refactor-oz-pos-app-agents-3.md"


def rows(path: pathlib.Path) -> list[tuple[int, str]]:
    return [(i, line) for i, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1)
            if line.strip()]


def label_of(line: str) -> str:
    m = ROW_RE.match(line)
    return m.group(1)[:52] if m else line[:52]


def main() -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("row", nargs="?", type=int)
    ap.add_argument("--file", default=str(DEFAULT_PLAN))
    ap.add_argument("--audit", action="store_true")
    ap.add_argument("--min", type=int, default=CLIP)
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--span", type=int, default=6000)
    ap.add_argument("--tails", action="store_true")
    ap.add_argument("--tail-chars", type=int, default=360)
    a = ap.parse_args()
    path = pathlib.Path(a.file)
    if not path.exists():
        print(f"{path}: not found")
        return 1

    if a.tails:
        # A row's disposition is written at its END, in a `<!-- ... -->` note or a trailing
        # "(c) NOT DONE" clause -- which is precisely the part a clipped read never returns. So for
        # every still-open row, show its tail: this is how you find out that the work is already
        # landed, or was reassigned, without doing it twice. T10 is the case that motivated it.
        open_rows = [(i, l) for i, l in rows(path)
                     if re.match(r"^[ \t]*[-*][ \t]+\[[ ]\]", l)]
        print(f"{path.name}: {len(open_rows)} open rows; tails below (last "
              f"{a.tail_chars} chars each)")
        words = re.compile(r"DONE|CLOSED|WITHDRAWN|NOT DONE|SUPERSEDED|RETIRED|IMPLEMENTED|RESOLVED|"
                           r"no longer|reassigned|moved to|stays open|PARKED", re.I)
        flagged = 0
        for i, line in open_rows:
            tail = line[-a.tail_chars:]
            hits = sorted({m.group(0).upper() for m in words.finditer(tail)})
            mark = "  <== disposition-shaped words in tail" if hits else ""
            if hits:
                flagged += 1
            print(f"\n  line {i}  {len(line):6d} chars  {label_of(line)}{mark}")
            print(f"    words: {', '.join(hits) if hits else '-'}")
            print(f"    tail: ...{tail[-300:]}")
        print(f"\n{flagged} of {len(open_rows)} open rows end in language that may already settle "
              f"them; a clipped reader cannot see any of it.")
        return 0

    if a.audit:
        all_rows = [(i, l) for i, l in rows(path) if re.match(r"^[ \t]*[-*][ \t]+\[[ x]\]", l)]
        over = [(i, l) for i, l in all_rows if len(l) > a.min]
        print(f"{path.name}: {len(all_rows)} checkbox rows; {len(over)} of them are longer than a "
              f"clipped reader can see (the cap is {CLIP} characters PER ROW, not shared between "
              f"rows)")
        total_seen = sum(min(len(l), CLIP) for _, l in all_rows)
        total_len = sum(len(l) for _, l in all_rows)
        print(f"  characters present: {total_len}   characters a clipped read returns: {total_seen} "
              f"({100 * total_seen / total_len:.1f}% of the file's row text is reachable without "
              f"this tool)")
        for i, l in sorted(over, key=lambda x: -len(x[1]))[:20]:
            done = "x" if re.match(r"^[ \t]*[-*][ \t]+\[x\]", l) else " "
            print(f"  [{done}] line {i:5d}  {len(l):6d} chars  unseen {len(l) - CLIP:6d}  {label_of(l)}")
        if len(over) > 20:
            print(f"  ... and {len(over) - 20} more over the threshold")
        print("  (unseen counts are per row AT THE THRESHOLD -- a row shorter than the clip has no "
              "hidden tail; rows past it may carry a disposition, as row 213 did)")
        return 0

    if a.row is None:
        print(__doc__)
        return 0
    for i, line in rows(path):
        if i == a.row:
            print(f"row {i} total length: {len(line)} characters; showing [{a.start}:"
                  f"{a.start + a.span}]")
            print("-" * 72)
            print(line[a.start:a.start + a.span])
            print("-" * 72)
            rest = len(line) - (a.start + a.span)
            print(f"STILL UNSEEN: {rest} characters (next: --start {a.start + a.span})"
                  if rest > 0 else "END OF ROW reached -- this is the whole thing.")
            return 0
    print(f"no row at line {i}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
