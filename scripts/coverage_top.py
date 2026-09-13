#!/usr/bin/env python3
"""Per-file coverage for feature modules from cargo-llvm-cov JSON.

Usage:
    python3 scripts/coverage_top.py [path/to/coverage.json]

If no path is given, scans coverage/rust/ for .json files and uses
whichever is newest (typically coverage.json from cargo-llvm-cov).

The input is read as UTF-8 and nothing else. Two ways this script stops and says so, in
different voices because they mean different things: "MISSING: <path>" on stdout with exit 0
(there is no report to make, which is not an error), and "UNREADABLE: <path> ..." on stdout
with exit 1 (bytes arrived that this reader cannot decode, so no ranking exists and a zero
would read as an empty one). Neither prints a traceback.
"""
import json
import os
import sys
from pathlib import Path

# cargo-llvm-cov --output-path produces a JSON whose top-level is
# {"version": ..., "type": ..., "cargo_llvm_cov": ..., "data": [...]}.
# The 'data' array typically contains one entry scoped to the run; its
# 'files' array holds per-source-file coverage data.

DEFAULT_DIR = Path(__file__).resolve().parent.parent / "coverage" / "rust"

if len(sys.argv) > 1:
    path = sys.argv[1]
else:
    if DEFAULT_DIR.is_dir():
        candidates = sorted(DEFAULT_DIR.glob("*.json"), key=os.path.getmtime)
        if candidates:
            path = str(candidates[-1])
        else:
            print(f"MISSING: no .json files in {DEFAULT_DIR}")
            sys.exit(0)
    else:
        print(f"MISSING: directory not found: {DEFAULT_DIR}")
        sys.exit(0)

if not os.path.exists(path):
    print(f"MISSING: {path}")
    sys.exit(0)

# THE READ, and what is asked of it. The path above was settled by asking the argument
# what it is (exists, then not a directory); this is the first fact about the bytes, so it
# belongs here and nowhere earlier. encoding= is named at the open rather than left to the
# platform: an unnamed text read inherits the locale codec, which measures cp1252 on this
# machine and UTF-8 on CI, so the same coverage file can rank rows, die in a
# UnicodeDecodeError, or die one step later in a JSONDecodeError depending only on where the
# script was run. A reporting script whose answer moves with the locale is not reporting.
#
# One arm, for one failure, caught by name. A decode error is NOT called a bad parse, because
# it is not one: the bytes may be perfectly good JSON written in UTF-16 (an editor re-saving
# a cargo-llvm-cov export does exactly that), and this script's job is to say plainly that it
# could not read the file, not to transcode the world by guessing at another codec. So there
# is no second open() below with a different encoding. UnicodeDecodeError is a ValueError and
# so is JSONDecodeError; catching the broad one would swallow a decoder bug and would also
# take over the malformed-JSON case, which is untouched here and still exits as it always did.
#
# The refusal reuses the voice just above it: one line on stdout naming the path, no
# traceback, and its own token, because this file is not MISSING (it is there and readable as
# bytes) and because a ranking that was never read cannot exit 0 the way a missing input does
# -- 0 would tell the next caller the report is simply empty. Falling through instead would
# print the header and die mid-loop, which reads as a partial ranking being the whole one.
try:
    with open(path, encoding="utf-8") as f:
        top = json.load(f)
except UnicodeDecodeError as exc:
    print(f"UNREADABLE: {path} is not UTF-8, so no ranking was read from it: {exc}. "
          f"This is a property of this reader, not a verdict on the file -- it may be valid JSON "
          f"in an encoding this script will not guess. Re-export it as UTF-8 and pass that "
          f"path.")
    sys.exit(1)

cwd = os.getcwd().replace("\\", "/")
keys = ("gift_card", "stock_count", "stock_transfer", "supplier", "purchase_order")

rows = []
for entry in top.get("data", []):
    for f in entry.get("files", []):
        # prefer 'filename'; fall back to 'name' in case of older layouts
        fn = f.get("filename") or f.get("name") or ""
        if not any(k in fn for k in keys):
            continue
        s = f.get("summary") or {}
        # cargo-llvm-cov summary uses 'line' / 'lines', 'region', 'function'
        # depending on version. Try both spellings.
        lines = s.get("line", s.get("lines", {}))
        funcs = s.get("function", s.get("functions", {}))
        lc = lines.get("covered", 0)
        lm = lines.get("missed", 0)
        ln = lc + lm
        pct = (100.0 * lc / ln) if ln else 0.0
        fc = funcs.get("covered", 0)
        fm = funcs.get("missed", 0)
        fn_total = fc + fm
        fpct = (100.0 * fc / fn_total) if fn_total else 0.0
        short = fn.replace(cwd, "").lstrip("/").lstrip("\\")
        rows.append((pct, short, lc, lm, fpct, fc, fm))

if not rows:
    print(f"NO MATCHES: scanned {sum(len(e.get('files', [])) for e in top.get('data', []))} files; none matched {keys}")
    sys.exit(0)

rows.sort(key=lambda r: r[0])
print("Per-file coverage for new feature modules")
print("=" * 90)
print(f"  {'LINES':>10}  {'FUNCS':>10}  PATH")
for pct, fn, c, m, fpct, fc, fm in rows:
    print(f"  L {pct:6.2f}% {c:4d}/{c + m:4d}  F {fpct:6.2f}% {fc:3d}/{fc + fm:3d}  {fn}")
