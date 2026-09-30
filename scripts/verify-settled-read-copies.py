#!/usr/bin/env python3
"""verify-settled-read-copies.py -- one implementation of the settled-read verdict.

WHY
===
A read has three outcomes, not two: it ANSWERED, it found nothing, or it FAILED.
The last two both surface as `null`/`[]` to a caller that just awaits, which is how a
throw keeps turning into a claim the screen makes out loud -- "no shift is open",
"this sale was never refunded", "this store has one cashier". The fix that took
root here is ui/src/utils/settle-read.ts: a DISCRIMINATED UNION whose failure arm
carries no value at all, so there is nothing to mistake for an answer, and each
caller decides for its own state what an unanswered read means.

That contract was worth copying, and copying it is what this file exists to stop.
It had FOUR hand-copied implementations by the time it was noticed: AppShell.tsx,
StockTransfersScreen.tsx and WarehouseCountFlow.tsx each declared a local
`type BootRead<T>`/`type Read<T>` alongside a private `settle()` (consolidated in
round 15, commit cefee06fa), and ui/src/utils/boot-retry.ts declared
`export type BootReadResult<T>` with the same two arms. Each copy carried its own
console prefix and its own idea of where the comment explaining it should point;
two of the three feature files documented the contract by citing `app/AppShell.tsx`
-- a copy, at a line range that had already moved. None of that is visible to the
compiler, to the test suite, or to any existing gate: the four copies were all
type-correct and all passed everything. Nothing in scripts/ referenced settleRead
at all, so the fifth copy would have been as acceptable as the first four were.

WHAT IT GRADES
==============
Every `type X = { ok: true; value: T } | { ok: false }` declaration under ui/src
outside ui/src/utils/settle-read.ts. It does NOT police call sites -- a caller may
legitimately name the type in a signature -- and it does not decide whether a second
verdict shape is warranted: ui/src/utils/boot-retry.ts needs one because its read
has to be re-issued rather than awaited, and what it is allowed to do is IMPORT the
shared union rather than re-declare it. So the finding is always 'this file
re-declares the union', and the repair is always the same one: import the type.

The check is deliberately SHAPE-based, not name-based. Naming the copies (`BootRead`,
`BootReadResult`, `Read`) in a list would have made the gate report zero findings the
day after it was written and stay there while a sixth copy arrived under a fourth
name -- which is precisely how the first four got here.

Exit 0 clean, 1 finding(s), 2 self-test or usage failure.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UI_SRC = ROOT / "ui" / "src"
# The one file allowed to declare the union. Anything else that spells it out is a copy.
OWNER = "ui/src/utils/settle-read.ts"

# `{ ok: true; value: T } | { ok: false }`, with any whitespace and any type parameter
# name. Both arms must appear, in order, on one line.
UNION_RE = re.compile(
    r"\bok\s*:\s*true\b[^\n|]*\|\s*\{\s*ok\s*:\s*false"
)
# A declaration only: `type`/`export type`, optional `declare`, an identifier, then `=`
# and an opening brace. A function's return annotation cannot match this.
DECL_RE = re.compile(r'^\s*(?:export\s+)?(?:declare\s+)?type\s+(\w+)[^=\n]*=\s*\{')
SOURCE_SUFFIXES = frozenset({".ts", ".tsx"})

# Dependency and build trees, which never hold application source.
SKIP_DIRS = frozenset({"node_modules", "dist", "build", "__snapshots__"})


def ui_sources() -> list[Path]:
    """Every source file under ui/src, skipping dependency and build trees."""
    out: list[Path] = []
    for p in sorted(UI_SRC.rglob("*")):
        if not p.is_file() or p.suffix not in SOURCE_SUFFIXES:
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        out.append(p)
    return out


def rel(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def find_copies(root: Path) -> list[dict]:
    """Every re-declaration of the union outside the owning module.

    `root` is the directory to sweep, so the self-test can point this at a fixture
    tree rather than the live repository.
    """
    owner = (root / "utils" / "settle-read.ts").resolve()
    findings: list[dict] = []
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.suffix not in SOURCE_SUFFIXES:
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.resolve() == owner:
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            findings.append({
                "file": rel(p, root),
                "line": 0,
                "type": None,
                "detail": "unreadable source file",
            })
            continue
        for n, line in enumerate(text.splitlines(), 1):
            m = DECL_RE.match(line)
            if not m or not UNION_RE.search(line):
                continue
            findings.append({
                "file": rel(p, root),
                "line": n,
                "type": m.group(1),
                "detail": "re-declares the settled-read verdict union",
            })
    return findings


def report(findings: list[dict], swept: int) -> str:
    if not findings:
        return (f"settled-read copies: OK -- {swept} file(s) swept, "
                "the union is declared once, in " + OWNER)
    lines = [f"settled-read copies: {len(findings)} re-declaration(s) outside {OWNER}"]
    for f in findings:
        where = f["file"] + (":" + str(f["line"]) if f["line"] else "")
        kind = f["type"] or "?"
        lines.append(f"  {where}  type {kind}  {f['detail']}")
    lines += [
        "  repair: import SettledRead from @/utils/settle-read and delete the"
        "  local alias. A second verdict shape is fine; a second DECLARATION of one is not."
    ]
    return chr(10).join(lines)

# Cases that prove the rule FIRES. A gate that cannot fail teaches its reader to
# trust it, and this one exists precisely because four copies of the union already
# passed every other gate in the repo. `root` is a parameter so the cases can point
# the sweep at a fixture tree instead of the live repository.
def self_test() -> int:
    import tempfile

    cases = []
    OWNER = "export type SettledRead<T> = { ok: true; value: T } | { ok: false };"
    A = "type BootRead<T> = { ok: true; value: T } | { ok: false };"
    B = "export type BootReadResult<T> = { ok: true; value: T } | { ok: false };"
    RENAMED = "type Settled<T> = { ok: true; value: T } | { ok: false };"
    SPACED = "type Read<T> =   { ok: true;   value: T }   |   { ok: false };"
    ONE_ARM = "export type Answer<T> = { ok: true; value: T };"
    WRONG_ORDER = "type V<T> = { ok: false } | { ok: true; value: T };"
    USE = (
        "export async function f<T>(r: Promise<T>): Promise<SettledRead<T>> {",
        "  return { ok: true, value: await r };",
        "}",
    )
    VALUE = (
        "const settled = { ok: true, value: 1 };",
        "interface Answer { ok: true }",
    )

    def sweep(files):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "ui" / "src"
            for name, text in files.items():
                dest = base / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(text + chr(10), encoding="utf-8")
            return find_copies(base)

    def case(name, files, want):
        flat = {k: (v if isinstance(v, str) else chr(10).join(v)) for k, v in files.items()}
        got = sweep(flat)
        cases.append((name, len(got) == want))
        if len(got) != want:
            print("      (wanted " + str(want) + ", got " + str(len(got)) + ")")

    # 1. the owning module alone is clean
    case("the owner alone is clean", {"utils/settle-read.ts": OWNER}, 0)

    # 2. the exact pre-round-15 AppShell alias
    case("a local alias is a finding",
         {"utils/settle-read.ts": OWNER, "app/AppShell.tsx": A}, 1)

    # 3. the exact pre-round-16 boot-retry export
    case("an exported alias is a finding",
         {"utils/settle-read.ts": OWNER, "utils/boot-retry.ts": B}, 1)

    # 4. a copy under a FOURTH name is still a copy: the rule is shape-based
    case("a renamed copy is still a finding",
         {"utils/settle-read.ts": OWNER, "features/x/Thing.tsx": RENAMED}, 1)

    # 5. the owner NAME alone must not exempt a copy elsewhere
    case("the basename does not exempt a copy",
         {"utils/settle-read.ts": OWNER, "app/x/Settle.ts": OWNER}, 1)

    # 6. odd spacing inside the arms still matches
    case("odd spacing still matches",
         {"utils/settle-read.ts": OWNER, "features/x/Thing.tsx": SPACED}, 1)

    # 7. ONE arm alone is not the union
    case("one arm alone is not the union",
         {"utils/settle-read.ts": OWNER, "features/x/Thing.tsx": ONE_ARM}, 0)

    # 8. arms in the WRONG order are a DIFFERENT type and must not match
    case("wrong arm order does not match",
         {"utils/settle-read.ts": OWNER, "features/x/Thing.tsx": WRONG_ORDER}, 0)

    # 9. a function RETURNING the union is a use, not a declaration
    case("a return-type use is not a declaration",
         {"utils/settle-read.ts": OWNER, "features/x/Thing.tsx": USE}, 0)

    # 10. a value literal is not a type declaration
    case("a value literal is not a declaration",
         {"utils/settle-read.ts": OWNER, "features/x/Thing.tsx": VALUE}, 0)

    failed = 0
    for name, ok in cases:
        mark = "ok  " if ok else "FAIL"
        print(f"  {mark}  {name}")
        if not ok:
            failed += 1
    print(f"settled-read copies self-test: {len(cases) - failed}/{len(cases)} passed")
    return 1 if failed else 0


def main(argv):
    ap = argparse.ArgumentParser(
        description='one implementation of the settled-read verdict')
    ap.add_argument("--self-test", action="store_true",
                    help="prove the rule can still fail")
    ap.add_argument("--json", action="store_true", help="machine-readable findings")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()
    swept = len(ui_sources())
    findings = find_copies(UI_SRC)
    if args.json:
        print(json.dumps({"owner": OWNER, "swept": swept, "findings": findings}, indent=2))
        return 1 if findings else 0
    print(report(findings, swept))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
