#!/usr/bin/env python3
"""Refuse a doc that reads the permission INVENTORY as a role preset.

WHY THIS EXISTS
---------------
`platform/core/src/rbac_presets.rs` holds two constructs in one file and one style:

    pub const ROLE_PRESETS: &[RolePreset] = &[   // :70   — the six roles
    pub const ALL_ENFORCED: &[&str] = &[        // :340  — every enforced key

Both are `permissions::X,` lists one-per-line, so a line number tells you nothing
about which one you are looking at. Reading the second as the first INVERTS the
fact: `ALL_ENFORCED` says a key EXISTS, while a preset says a ROLE GRANTS it.

This mistake was made FOUR times in this tree before it was guarded:

  1. `todo-orphan-module-dispositions.md` — "granted only to MANAGER/ADMIN/OWNER
     (:419)", where :419 is inventory. That sentence is the likely origin of the rest.
  2. `todo-gift-card-redemption-ordering.md` — the same claim, same line.
  3. `payment-methods-plan.md` — "the owner preset at :429-436", also inventory.
  4. A round-217 mutation probe of mine, which edited one migration believing it was
     the live definition — the same habit in a different file.

Every one of them was written by someone who had opened the right file. The defect
is not laziness; it is that the two lists are indistinguishable at a glance.

WHAT IT CHECKS
--------------
A doc line that names a preset (the word "preset", or a role name) together with a
`rbac_presets.rs:N` citation, where N falls in the `ALL_ENFORCED` span. The span is
COMPUTED from the file each run, never hardcoded — a hardcoded boundary would rot the
same way the citations did. Quoted corrections are exempt when the line also says the
line "is not a preset" (this file family documents its own corrections inline).

RULE 2 — A TABLE CELL CITING WITHOUT BACKTICKS IS INVISIBLE
----------------------------------------------------------
`check-cite-lines.py` only recognises a citation wrapped in backticks (its CITE
regex is `path:N` between two backticks). A markdown TABLE CELL usually writes the
citation bare, so `| Manager | yes | rbac_presets.rs:79-80 |` is not graded AT ALL —
and the checker still reports `298 citations / 228 graded`, because the count is of
what it SAW. Measured 2026-10-25: the runbook's five-row role table carried five
bare coordinates, every one stale, and all five were outside the graded population.
That is how a table can be wrong on every row while the audit reports OK.

This rule flags a TABLE ROW whose cell carries a `path:N` outside backticks, in a
LIVE doc. It does not judge the coordinate — it asks only that the citation be
reachable by the checker that would judge it. Audit stamps are exempt: they quote
coordinates from the past on purpose and carry their own `dead-ref: ok:`.

EXIT CODES
    0  no doc reads the inventory as a preset
    1  at least one does
    2  the scan broke (source file missing, span not found)

Usage, from the repo root:

    python scripts/check-rbac-citations.py
    python scripts/check-rbac-citations.py --self-test
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PRESETS_SRC = REPO / "platform" / "core" / "src" / "rbac_presets.rs"
DOC_ROOTS = ("docs",)

#: Generated or ignored trees under docs/. `/docs/src/operations/` and its five
#: siblings are mdBook BUILD OUTPUT (`.gitignore:149-155`), so a copy of a live doc
#: sits there untracked and this gate would report the same citation twice — once
#: for the source and once for a regenerated copy nobody can fix in a commit.
DOC_SKIP_PREFIXES = (
    "docs/src/api/",
    "docs/src/guides/",
    "docs/src/decisions/",
    "docs/src/releases/",
    "docs/src/operations/",
    "docs/html/",
    "docs/book/",
)

#: A citation of the presets file, with one or more line numbers.
#: A QUALIFIED citation of the presets file: `rbac_presets.rs:419`.
QUALIFIED_RE = re.compile(r"rbac_presets\.rs:([0-9]+)(?:-([0-9]+))?")
#: A BARE `:419` / `:429-436`, valid only when the SAME line also names the file.
#: Measured: accepting a bare number anywhere made this gate report eight findings
#: in one pass, every one an audit stamp or a checklist line whose `:N` referred to
#: some OTHER file — a stamped paragraph cites a dozen coordinates and mentions
#: `rbac_presets` nowhere. A gate that cries wolf on audit stamps is a gate that
#: gets suppressed, so the bare arm is scoped to lines that name the file.
BARE_RE = re.compile(r"(?<![0-9]):([0-9]{2,})(?:-([0-9]+))?")
FILE_MENTION_RE = re.compile(r"rbac_presets")
#: A line that is talking about a ROLE, not merely about the file.
PRESET_WORD_RE = re.compile(r"\bpreset\b|\bOwner\b|\bManager\b|\bStaff\b|\bAdmin\b|\bAuditor\b", re.IGNORECASE)
#: A correction that explicitly says the cited line is NOT a preset.
SELF_AWARE_RE = re.compile(r"is not a preset|not a preset line|inside `ALL_ENFORCED`", re.IGNORECASE)


def inventory_span() -> tuple[int, int]:
    """Line numbers where ALL_ENFORCED starts and the file ends.

    Computed, not hardcoded: the whole point of this gate is that line numbers in
    this file move. A hardcoded span would pass forever after the first refactor.
    """
    if not PRESETS_SRC.is_file():
        raise SystemExit(f"SCAN BROKE: {PRESETS_SRC} not found")
    lines = PRESETS_SRC.read_text(encoding="utf-8", errors="replace").splitlines()
    for i, line in enumerate(lines, start=1):
        if "pub const ALL_ENFORCED" in line:
            return i, len(lines)
    raise SystemExit("SCAN BROKE: ALL_ENFORCED declaration not found in rbac_presets.rs")


#: A file reference followed by its coordinate: `SyncSection.tsx:385-535`. Used to
#: decide which file a BARE `:N` belongs to, because a stamped paragraph cites
#: several files and a line-wide "names rbac_presets somewhere" test attaches the
#: wrong coordinate to the wrong file.
#: Two shapes count as "naming a file": `foo.rs:12` and a BARE `rbac_presets.rs`
#: with the coordinate attached further along the same sentence. The second is why
#: the pattern accepts a file name that is NOT immediately followed by a colon.
FILE_THEN_COORD_RE = re.compile(
    r"([A-Za-z0-9_./-]+\.(?:rs|tsx?|mjs|py|sh|sql|md|json|ftl))(?::|\b)"
)


def _nearest_file_before(line: str, index: int) -> str:
    """The file whose name most closely precedes `index` on this line."""
    best = ""
    for m in FILE_THEN_COORD_RE.finditer(line, 0, index):
        best = m.group(1)
    return best


def citations_reading_inventory(text: str, start: int, end: int) -> list[str]:
    """Descriptions of doc lines that cite a PRESET line inside the inventory span.

    The bare `:N` arm is attributed to the nearest PRECEDING file name on the line.
    Measured: a line-wide "mentions rbac_presets" test produced four false findings
    in this tree, the clearest being an audit stamp containing both `rbac_presets`
    and `SyncSection.tsx:385-535` -- the coordinate belonged to the second file and
    the first was named 200 characters earlier.
    """
    bad: list[str] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        if not PRESET_WORD_RE.search(line):
            continue
        if SELF_AWARE_RE.search(line):
            continue
        # One finding per COORDINATE, not per matching pattern: `rbac_presets.rs:420`
        # matches the qualified arm AND, via its own prefix, the bare arm -- which
        # reported the same citation twice.
        seen: set[tuple[int, int]] = set()
        for regex, needs_owner in ((QUALIFIED_RE, False), (BARE_RE, True)):
            for m in regex.finditer(line):
                if needs_owner and not _nearest_file_before(line, m.start()).endswith(
                    "rbac_presets.rs"
                ):
                    continue
                lo = int(m.group(1))
                hi = int(m.group(2)) if m.group(2) else lo
                if not (end >= lo >= start) or (lo, hi) in seen:
                    continue
                seen.add((lo, hi))
                bad.append(
                    f"{lineno}: cites :{lo}{'-' + str(hi) if hi != lo else ''} as a preset, "
                    "which is inside ALL_ENFORCED"
                )
    return bad

#: A `path:N` citation anywhere on a row. The BACKTICK test is done per row, not by a
#: lookbehind: `(?<!`)` inspects ONE character before the path, which in
#: "(`crates/x.rs:249`)" is the backtick that OPENED the span two characters earlier --
#: so a first version flagged a correctly-backticked table and reported four false
#: findings in CRITICAL_PATH_INVARIANTS.md. The question is whether the citation sits
#: INSIDE a backtick span, which is decided by counting backticks before it on the row.
CITE_ANY_RE = re.compile(
    r"([A-Za-z0-9_/.-]+\.(?:rs|ts|tsx|sql|py|mjs|sh|go|json|ftl|toml|md)):(\d+)"
)
#: Rows whose content is narrative rather than a claim about the live tree.
STAMP_RE = re.compile(r"Audit stamp|audit stamp|dead-ref: ok:", re.IGNORECASE)


def _inside_backticks(line: str, index: int) -> bool:
    """True when `index` falls inside an odd-numbered run of backticks."""
    return line.count("`", 0, index) % 2 == 1


def ungraded_table_citations(text: str) -> list[str]:
    """Table rows whose citation the cite-lines checker cannot see."""
    bad: list[str] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        if not line.lstrip().startswith("|"):
            continue
        if STAMP_RE.search(line):
            continue
        for m in CITE_ANY_RE.finditer(line):
            if _inside_backticks(line, m.start()):
                continue
            bad.append(
                f"{lineno}: table cell cites {m.group(0)} without backticks, "
                "so check-cite-lines.py cannot grade it"
            )
    return bad


def table_detector_still_fires() -> bool:
    """Grade rule 2 over synthetic rows before trusting a clean real scan."""
    must_flag = [
        "| **Manager** | yes | rbac_presets.rs:79-80 |",
        "| Staff | no | platform/core/src/rbac.rs:608 |",
    ]
    must_pass = [
        "| **Manager** | yes | `rbac_presets.rs:109` |",
        "| Rust guard | `crates/kasirmu-core/src/db/x.rs:249` | `.filter(v >= 0)` |",
        "| note | see the audit stamp, rbac_presets.rs:79-80 |",
        "Prose mentioning rbac_presets.rs:79-80 is not a table row.",
    ]
    if any(not ungraded_table_citations(s) for s in must_flag):
        return False
    return all(not ungraded_table_citations(s) for s in must_pass)

def scan() -> tuple[list[str], int]:
    """Find offending doc lines. Returns (findings, files_read)."""
    start, end = inventory_span()
    findings: list[str] = []
    read = 0
    for root in DOC_ROOTS:
        base = REPO / root
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*.md")):
            rel = path.relative_to(REPO).as_posix()
            if rel.startswith(DOC_SKIP_PREFIXES):
                continue
            read += 1
            body = path.read_text(encoding="utf-8", errors="replace")
            for problem in citations_reading_inventory(body, start, end):
                findings.append(f"{rel}:{problem}")
            # Dated records are evidence of what the tree looked like THEN; rule 2
            # asks for a backtick so a LIVE claim can be graded, which a record is
            # not. Rule 1 still runs on them, because reading the inventory as a
            # preset is a semantic error in a record too.
            if not rel.startswith("docs/records/"):
                for problem in ungraded_table_citations(body):
                    findings.append(f"{rel}:{problem}")
    return findings, read


def detector_still_fires() -> bool:
    """Grade the detector over synthetic lines before trusting a clean real scan."""
    start, end = inventory_span()
    inside = start + 5
    must_flag = [
        f"granted only to MANAGER/ADMIN/OWNER (rbac_presets.rs:{inside})",
        # The bare form counts ONLY when the same line names the file -- see BARE_RE.
        f"the owner preset at rbac_presets.rs:{inside}-{inside + 3}",
        f"rbac_presets.rs lists the preset at line :{inside} and following",
    ]
    must_pass = [
        f"the manager preset at rbac_presets.rs:{start - 10}",
        f"rbac_presets.rs:{inside} is not a preset line, it is inventory",
        "no citation or role word here at all",
        # A bare coordinate on a line that never names the file is NOT a claim
        # about this file: audit stamps cite a dozen coordinates from several.
        f"Status: audited; :{inside} and :{inside + 4} were re-verified",
    ]
    if any(not citations_reading_inventory(s, start, end) for s in must_flag):
        return False
    return all(not citations_reading_inventory(s, start, end) for s in must_pass)


def self_test() -> int:
    bad: list[str] = []
    cases = 0

    cases += 1
    if not detector_still_fires():
        bad.append("rule 1's detector no longer classifies the synthetic citations")

    cases += 1
    if not table_detector_still_fires():
        bad.append("rule 2's detector no longer classifies the synthetic table rows")

    # The span must be computed from the file, so a rename of the constant is a
    # SCAN BROKE rather than a silent empty scan.
    cases += 1
    start, end = inventory_span()
    if not (0 < start < end):
        bad.append(f"inventory span is not sane: {start}..{end}")

    cases += 1
    _findings, read = scan()
    if read == 0:
        bad.append("the live scan read 0 markdown files")

    if bad:
        sys.stderr.write("SELF-TEST WRONG:\n" + "\n".join(bad) + "\n")
        return 2
    print(f"SELF-TEST OK ({cases} cases; the last reads the real tree)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true", help="run this checker's cases and exit")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    if not detector_still_fires():
        print("DETECTOR WENT DEAF: rule 1 no longer matches a known offender.", file=sys.stderr)
        return 2
    if not table_detector_still_fires():
        print("DETECTOR WENT DEAF: rule 2 no longer matches a bare table citation.", file=sys.stderr)
        return 2

    findings, read = scan()
    if read == 0:
        print("SCAN READ NOTHING: no markdown under docs/. Refusing to report clean.", file=sys.stderr)
        return 2

    if findings:
        print("", file=sys.stderr)
        print("A DOC READS THE CONSTANT INVENTORY AS A ROLE PRESET:", file=sys.stderr)
        for line in findings:
            print(f"  {line}", file=sys.stderr)
        print("", file=sys.stderr)
        print("ALL_ENFORCED lists every enforced KEY; ROLE_PRESETS lists what a ROLE", file=sys.stderr)
        print("grants. Both are permissions::X, one-per-line in the same file, so a line", file=sys.stderr)
        print("number cannot tell them apart — read the declaration above it.", file=sys.stderr)
        return 1

    print(f"OK: no doc reads the inventory as a preset ({read} file(s) read)")
    return 0


if __name__ == "__main__":
    sys.exit(main())