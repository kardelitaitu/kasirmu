#!/usr/bin/env python3
"""Detect positional row.get(N) mappers whose field order disagrees with their SELECT.

WHY THIS EXISTS
===============

A row mapper that reads columns by POSITION -- `name: row.get(3)?` -- is coupled to
the SQL it is paired with, and nothing in Rust checks that coupling. Reorder the
SELECT list, insert a column, or copy a mapper to a new structure and the fields
silently take each other's values. Every value stays present, correctly typed, and
WRONG, so no test that only exercises the type can see it.

`run_list_credit_sales` (crates/kasirmu-bridge/src/settings/core.rs) carried exactly
this defect into production: index 1 of its projection is `p.gateway_reference` and
the field it feeds is `customer_name`, which the retail credit list renders in a
Customer column. The pin that already covered that type built the DTO from
hand-written values, so it pinned the wire shape and never ran the query. Measured
and recorded in docs/records/JOURNAL.md (2026-10-04, commit a3c871787).

WHAT IT CHECKS
==============

For each mapper block (a run of `field: row.get(N)` reads beginning at index 0), the
script finds the SELECT that feeds it and compares the Nth column against the field
name. A disagreement is reported unless the column is aliased (`... AS x`) or the
field is a documented rename.

It is a HEURISTIC and is written to over-report rather than miss: a finding is a
prompt to read the two lists side by side, not proof of a bug. Known legitimate
renames are listed in KNOWN_RENAMES with the reason each is legitimate.

Exit code 0 = no unaliased disagreement found.
Exit code 1 = at least one mapper reads a column whose name does not match its field.
Exit code 2 = a REFUSED command line: a named root resolved to no directory, so the
             scan would report a starved corpus as though it were the whole surface.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# The SELECT list ends at the FIRST top-level FROM -- not at the first FROM token,
# which is what a naive non-greedy match finds: `SELECT ... FROM (SELECT ... FROM x)`
# truncates at the inner FROM and reports every column past it as missing
# (stock_variance.rs was the case that exposed this). The paren depth walk below
# is why this cannot be a single regex.
SELECT_HEAD_RE = re.compile(r"SELECT\s", re.IGNORECASE)
FROM_RE = re.compile(r"\bFROM\b", re.IGNORECASE)


def select_column_list(chunk: str) -> str | None:
    """Return the text between SELECT and its matching top-level FROM, or None."""
    m = SELECT_HEAD_RE.search(chunk)
    if not m:
        return None
    depth = 0
    i = m.end()
    while i < len(chunk):
        ch = chunk[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0:
            fm = FROM_RE.match(chunk, i)
            if fm:
                return chunk[m.end() : i]
        i += 1
    return None
# The turbofish can nest: `row.get::<_, Option<String>>(1)`. A `[^>]*` body stops at
# the first `>`, so that form silently failed to match -- which made the checker
# report a clean tree while skipping exactly the fields most likely to be
# misaligned (the nullable ones). Match balanced-ish angle brackets instead.
FIELD_RE = re.compile(r"^\s*(\w+):\s*row\.get(?:::<(?:[^<>]|<[^<>]*>)*>)?\((\d+)\)")

# Field names that intentionally read a differently-named column. Each entry must
# carry the reason it is legitimate, so a reviewer can judge a suppression.
KNOWN_RENAMES = {
    # workspace instances hold the location in `location_id`; the DTO calls it
    # `store_id` because every workspace lives in one store.
    ("store_id", "location_id"),
    ("store_id", "sp.id"),
    # a stored receipt count is exposed to callers as `count`.
    ("count", "receipt_count"),
}

# SQL assembled from a format!/const template cannot be analysed statically.
TEMPLATE_MARKERS = ("{profile_columns}", "{user_id_param}", "{columns}", "{where_clause}")


def split_top_level_commas(text: str) -> list[str]:
    out, cur, depth = [], "", 0
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return [c.strip() for c in out if c.strip()]


def column_base(col: str) -> str:
    """The bare column name: strip alias, table prefix, parens and casts."""
    body = col.split()[-1] if " AS " in col.upper() else col
    body = body.strip().strip(chr(34)).strip()
    body = re.sub(r"^[\w]+\.", "", body)
    body = body.split("(")[0].strip().strip(chr(34))
    return body.lower()


def scan(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if any(m in text for m in TEMPLATE_MARKERS):
        return []
    lines = text.splitlines()
    findings: list[str] = []

    for i, line in enumerate(lines):
        head = FIELD_RE.match(line)
        if not head or head.group(2) != "0":
            continue

        # FIND THE STATEMENT THE MAPPER BELONGS TO. Neither "nearest SELECT" nor
        # "outermost SELECT" is right on its own:
        #   * nearest-only stops inside a subquery (`FROM (SELECT ...`), whose
        #     column list is not the one the mapper reads -- stock_variance.rs;
        #   * outermost-only walks up past the statement into an unrelated earlier
        #     query, and every field then looks misaligned -- analytics.rs,
        #     fiscal.rs and workspaces.rs all produced exactly that false report.
        # So: take the nearest preceding line that opens a statement (first token
        # SELECT), and require its column list to be at least as long as the
        # highest index the mapper reads. An inner subquery fails that length
        # test; an unrelated earlier query is never reached, because the nearest
        # candidate is examined first.
        want = 0
        for j in range(i, min(len(lines), i + 25)):
            fm = FIELD_RE.match(lines[j])
            if fm:
                want = max(want, int(fm.group(2)) + 1)
            elif want:
                break

        cols: list[str] = []
        for j in range(i, max(-1, i - 80), -1):
            # Tolerate the SQL string's own opening quote and leading whitespace:
            # `            "SELECT s.id, ...`.
            stripped = lines[j].strip().lstrip(chr(34)).strip()
            if not re.match(r"SELECT\b", stripped, re.IGNORECASE):
                continue
            chunk = " ".join(lines[j : j + 30])
            raw = select_column_list(chunk)
            if raw is None:
                continue
            cand = split_top_level_commas(raw.replace(chr(34), " ").replace("\\", " "))
            if len(cand) >= max(3, want):
                cols = cand
                break
        if len(cols) < 3:
            continue


        fields: list[tuple[str, int]] = []
        for j in range(i, min(len(lines), i + 25)):
            fm = FIELD_RE.match(lines[j])
            if fm:
                fields.append((fm.group(1), int(fm.group(2))))
            elif fields:
                break
        if len(fields) < 3:
            continue

        bad: list[str] = []
        for name, idx in fields:
            if idx >= len(cols):
                bad.append(f"{name}[{idx}] reads past the projection ({len(cols)} columns)")
                continue
            col = cols[idx]
            if re.search(r"\bAS\b", col, re.IGNORECASE):
                continue  # an explicit alias is a deliberate rename
            base = column_base(col)
            lname = name.lower()
            if base.endswith(lname) or lname.endswith(base):
                continue
            if any(lname == f and base == c for f, c in KNOWN_RENAMES):
                continue
            bad.append(f'{name}[{idx}] <- "{col.strip()[:50]}"')

        if bad:
            findings.append(f"{path.as_posix()}:{i + 1}" + chr(10) + "    " + (chr(10) + "    ").join(bad))

    return findings


def main() -> int:
    ap = argparse.ArgumentParser(description="Check positional row-mapper alignment")
    ap.add_argument("--roots", nargs="+",
                    default=["crates/kasirmu-core/src", "crates/kasirmu-bridge/src"])
    args = ap.parse_args()

    files: list[Path] = []
    missing: list[str] = []
    for root in args.roots:
        p = Path(root)
        if not p.is_dir():
            missing.append(root)
            continue
        files.extend(sorted(f for f in p.rglob("*.rs") if not f.name.endswith("_tests.rs")))
    if missing:
        print(f"refused: no such root(s): {', '.join(missing)}", file=sys.stderr)
        return 2

    findings: list[str] = []
    for f in files:
        findings.extend(scan(f))

    print(f"scanned {len(files)} production .rs files")
    if not findings:
        print("no positional mapper disagrees with its SELECT")
        return 0
    print(f"{len(findings)} mapper(s) read a column whose name does not match the field:" + chr(10))
    print((chr(10) + chr(10)).join(findings))
    return 1


if __name__ == "__main__":
    sys.exit(main())
