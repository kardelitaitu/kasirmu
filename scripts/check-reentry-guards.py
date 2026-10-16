#!/usr/bin/env python3
"""check-reentry-guards.py -- list write handlers whose only busy-guard is state.

WHY THIS EXISTS
Rounds 136-144 of the restaurant-POS work found the same defect eight times, one file per
round, always by hand: a handler sets a busy flag (setSaving(true)), awaits an IPC write,
and has NO synchronous re-entry guard. The flag is STATE, and React commits state on the
NEXT render -- after the second dispatch of a real double tap. So a double tap sends the
write twice. Measured on four separate screens, in one act() batch: expected 2 to be 1.

What the double tap costs depends entirely on the BACKEND, and that is what makes a raw
list of candidates useless -- so this script only reports the SHAPE and does NOT claim a
defect:

  * a unique index REFUSES the replay (suppliers, purchase orders, staff, shift
    open/close, stock-count complete) -> the write is safe, but the rejection lands in the
    same catch that reports genuine failures, so the operator is told it FAILED when it
    succeeded;
  * no unique index -> a DUPLICATE ROW (customers, cash payouts, memos), or worse, a
    fixed-path overwrite where the last write wins (the restore request).

The point of the list is that it is SHORT: filtering to handlers that (a) await something
other than a list/get read and (b) have a write-shaped name narrows ~143 raw busy-flag
sites to a handful. Two of the three in the first run were settings upserts -- idempotent
by construction -- which is exactly why the backend question cannot be skipped.

WHAT IT DOES NOT DO
It is a heuristic over text, not a type-aware analysis. It misses a guard written as
anything other than <name>Ref.current, and it does not read the backend at all. Treat the
output as a reading list, never as a finding.

USAGE
  python3 scripts/check-reentry-guards.py            # report, exit 0
  python3 scripts/check-reentry-guards.py --strict   # exit 1 on any candidate
"""

import argparse
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCAN_ROOT = os.path.join(ROOT, "ui", "src")
SKIP_DIRS = {"node_modules", "dist", "__tests__", "__mocks__"}

# setFoo(true); alone on a line -- the busy-flag set. A `setFoo(true)` inside an
# expression (a modal-open flag, an argument) is deliberately not matched.
BUSY_RE = re.compile(r"^\s*set([A-Z]\w*)\(true\);\s*$")
# The enclosing handler: `const name = useCallback(async (...` or `async function name(`.
HANDLER_RE = re.compile(r"const\s+(\w+)\s*=\s*(?:useCallback\(\s*)?(?:async\s*)?\(")
FUNCTION_RE = re.compile(r"(?:async\s+)?function\s+(\w+)")
# A ref read is the only guard this recognises -- see WHAT IT DOES NOT DO.
REF_GUARD_RE = re.compile(r"\w+Ref\.current")
AWAIT_RE = re.compile(r"\bawait\s+(\w+)\s*\(")
# Reads are not writes, so a handler that only re-reads cannot double-write.
READ_PREFIX = re.compile(r"^(list|get|load|refresh|fetch)", re.I)
# A write-shaped handler name, so a generic `handleConfirm` in a pure-read screen drops out.
WRITE_NAME = re.compile(
    r"(create|save|confirm|submit|issue|apply|void|refund|deactivate|delete|move|merge|bind|"
    r"clear|override|pause|resume|reset|activate|end|start|open|close|complete|sync|pull|"
    r"requeue|mark|stamp|send|receive|import|export|install|switch|rotate|adjust|post|"
    r"record|dispatch)",
    re.I,
)


def _enclosing_handler(lines, index):
    """Name and first line of the handler body enclosing `index`, best effort."""
    indent = len(lines[index]) - len(lines[index].lstrip())
    for n in range(index - 1, max(-1, index - 80), -1):
        stripped = lines[n].strip()
        if not stripped or stripped.startswith("//") or stripped.startswith("*"):
            continue
        this_indent = len(lines[n]) - len(lines[n].lstrip())
        if this_indent >= indent:
            continue
        m = HANDLER_RE.search(lines[n]) or FUNCTION_RE.search(lines[n])
        if m:
            return n, m.group(1)
        return None, None
    return None, None


def _handler_body(lines, start):
    """From the handler head to its dependency array (or EOF)."""
    body = []
    for n in range(start, len(lines)):
        body.append(lines[n])
        if n > start and re.match(r"^\s*\}, \[", lines[n]):
            break
    return "\n".join(body)


def scan_file(path):
    with open(path, encoding="utf-8", errors="replace") as handle:
        lines = handle.read().splitlines()
    found = []
    for i, line in enumerate(lines):
        m = BUSY_RE.match(line)
        if not m:
            continue
        start, name = _enclosing_handler(lines, i)
        if start is None:
            continue
        body = _handler_body(lines, start)
        if REF_GUARD_RE.search(body):
            continue
        awaited = AWAIT_RE.findall(body)
        writes = [a for a in awaited if not READ_PREFIX.match(a)]
        if not writes or not WRITE_NAME.search(name):
            continue
        found.append({
            "file": os.path.relpath(path, ROOT).replace(os.sep, "/"),
            "line": i + 1,
            "flag": "set%s" % m.group(1),
            "handler": name,
            "calls": ", ".join(sorted(set(writes))),
        })
    return found


def iter_sources(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if not name.endswith((".ts", ".tsx")):
                continue
            if ".test." in name or ".spec." in name:
                continue
            yield os.path.join(dirpath, name)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--strict", action="store_true", help="exit 1 on any candidate")
    args = parser.parse_args()

    findings = []
    for path in iter_sources(SCAN_ROOT):
        findings.extend(scan_file(path))

    if not findings:
        print("reentry-guards: 0 candidate(s) in ui/src")
    else:
        print("reentry-guards: %d write handler(s) whose only guard is a state flag."
              % len(findings))
        print("Each is a CANDIDATE, not a defect: the cost of the replay depends on the"
              " backend.")
        print("Ask first whether a unique index REFUSES it, then whether the UI still"
              " reports success.")
        print()
        for f in findings:
            print("  %s:%d  %s  in %s()  -> %s"
                  % (f["file"], f["line"], f["flag"], f["handler"], f["calls"]))
    return 1 if (args.strict and findings) else 0


if __name__ == "__main__":
    sys.exit(main())
