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
and recorded in docs/records/journal/JOURNAL.md (2026-10-04, commit a3c871787).

WHAT IT CHECKS
==============

For each mapper block (a run of `field: row.get(N)` reads beginning at index 0), the
script finds the SELECT that feeds it and compares the Nth column against the field
name. A disagreement is reported unless the column is aliased (`... AS x`) or the
field is a documented rename.

THE BLOCK IS MATCHED BY BRACES, not by lines, and that distinction is the difference
between this gate working and not. It previously walked forward from the anchor until
a line that was not a `row.get`, which stops early on any mapper with a bare shorthand
field (`sku,`, bound earlier) or a nested struct literal (`price: Money { ... },`).
`modules/inventory/src/repository.rs` has BOTH between its first field and
`image_hash`, so the walk ended at index 2 and the gate reported exit 0 over a mapper
that read `image_hash` from the `popularity_score` column -- a real misalignment, found
by hand, that this script exists to catch. Four lexical repairs were attempted first
and all failed: a line rule cannot tell a nested literal's closer from the end of the
block, and INDENTATION does not separate them either (the nested `},` sits at the same
column as the fields it follows). String literals are blanked before counting, so a
format string's braces do not desynchronise the depth.

`--roots` DEFAULTS TO THE WHOLE WORKSPACE (`crates`, `apps`, `platform`, `modules`),
which is a correction with a lesson in it. It used to name three directories, and
`modules` was added only after a real misalignment was found there BY HAND -- the gate
had never scanned that tree at all. Since both callers (`scripts/check.sh`,
`dev-ci.yml#static-gates`) invoke this with no `--roots`, the default IS the coverage,
and a default that needs widening after each miss makes coverage something an author
remembers rather than a property of the tool. It now scans 799 production files, up
from 267 when the brace-matching bug was fixed and 267+58 with the first widening.

ALIASED COLUMNS ARE CHECKED TOO, against their own alias. This section used to record
the opposite as an accepted limitation, and the reasoning that produced it was wrong:
an earlier revision skipped every aliased column entirely, which meant a reordered
aliased projection went unreported -- the gate's entire purpose, defeated by an
unrelated exemption. The alias IS the author's stated intent for that index, so
comparing the field to it is exactly as sound as comparing it to a bare column name.
Swapping `shift_count: row.get(1)` and `closed_shift_count: row.get(2)` in
`analytics_shift_rows` now fails at exit 1, verified.

The comparison is by WORDS, not by suffix, and that distinction was also learned by
running it: `COALESCE(...) AS closed_count` legitimately feeds `closed_shift_count`,
which interleaves `closed` + `shift` + `count`, so neither name is a suffix of the
other and a suffix rule reported a FALSE POSITIVE on correct code. An alias is
accepted when every one of its words appears in the field name, which tolerates that
reorder while still catching a genuinely different alias. A finding remains a prompt to
read two lists; the absence of one is not proof of correctness.

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
    # a user's display name IS the cashier name on the sales they rang up; it
    # arrives wrapped in COALESCE, which column_base() unwraps to `display_name`.
    ("cashier_name", "display_name"),
}

# SQL assembled from a format!/const template cannot be analysed statically.
TEMPLATE_MARKERS = ("{profile_columns}", "{user_id_param}", "{columns}", "{where_clause}")

# Acknowledged mismatches: real defects that are recorded but deliberately NOT
# repaired yet, because the repair is a product ruling rather than a fix. Keyed by
# (file, field). Each must name the record that carries the decision -- an entry
# without one is a suppression nobody can review, and the checker refuses that.
#
# These are REPORTED, not silently dropped: the run prints them under a heading and
# still exits 0, so the defect stays visible without making the tree permanently red.
ACKNOWLEDGED = {
    ("crates/kasirmu-bridge/src/settings/core.rs", "customer_name"): (
        "customers.name exists but the projection does not join it; choosing the "
        "source column changes what a cashier sees on a surface already repaired "
        "once. See docs/records/journal/JOURNAL.md (2026-10-04) and commit a3c871787."
    ),
}


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
    """The bare column name behind an alias, a function wrapper and a table prefix.

    `COALESCE(u.display_name, '')` must resolve to `display_name`, not to
    `coalesce`: the name a reader compares against a field lives INSIDE the
    wrapper. Taking the text before the first paren -- the obvious implementation --
    drops it, and then reports every COALESCE-wrapped column as a mismatch.
    """
    body = col.split()[-1] if re.search(r"\bAS\b", col, re.IGNORECASE) else col
    body = body.strip().strip(chr(34)).strip()
    while True:
        # Peel one outer wrapper: `COALESCE(x, y)` -> `x`; `CAST(x AS t)` -> `x`.
        wrapped = re.match(r"^([A-Z_]+)\s*\((.*)\)$", body, re.IGNORECASE | re.DOTALL)
        if not wrapped:
            break
        body = wrapped.group(2).split(",")[0].strip()
    body = re.sub(r"^[\w]+\.", "", body)
    body = body.split("(")[0].strip().strip(chr(34)).strip()
    return body.lower()


def strip_rust_strings(s: str) -> str:
    """Blank out Rust string literals so braces inside SQL text are not counted."""
    out: list[str] = []
    i, n = 0, len(s)
    while i < n:
        if s[i] == chr(34):
            i += 1
            while i < n and s[i] != chr(34):
                if s[i] == "\\":
                    i += 1
                i += 1
            i += 1
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def collect_mapped_fields(lines: list[str], anchor: int) -> list[tuple[str, int]]:
    """Every `field: row.get(N)` in the STRUCT LITERAL containing `anchor`.

    Brace matching, not line heuristics. The previous walk stopped at the first line
    that was not a `row.get`, which a mapper with a bare shorthand field (`sku,`)
    or a nested struct literal (`price: Money { ... },`) breaks on -- and
    `modules/inventory/src/repository.rs` has both between its first field and
    `image_hash`, so the walk ended at index 2 and the gate reported a clean tree
    over a real misalignment it exists to find.

    Four lexical repairs were attempted and each failed for the same reason: a line
    rule cannot tell a nested literal's closer from the end of the block, and
    INDENTATION does not separate them either (the nested `},` sits at the same
    column as the fields it follows). Depth counting is the only thing that
    distinguishes them, so that is what this does.

    String literals are blanked first: SQL text contains no unbalanced braces, but
    a Rust format string in the block would, and counting those would desynchronise
    the depth.
    """
    fields: list[tuple[str, int]] = []

    # 1. Walk BACK to the line that opens the enclosing literal.
    depth = 0
    start = None
    for j in range(anchor, max(-1, anchor - 80), -1):
        for ch in reversed(strip_rust_strings(lines[j])):
            if ch in ")]}":
                depth += 1
            elif ch in "([{":
                depth -= 1
        if depth < 0:
            start = j
            break
    if start is None:
        return fields

    # 2. Walk FORWARD from that opener until its depth returns to zero.
    depth = 0
    for j in range(start, min(len(lines), start + 120)):
        for ch in strip_rust_strings(lines[j]):
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                depth -= 1
        if j >= anchor:
            fm = FIELD_RE.match(lines[j])
            if fm:
                fields.append((fm.group(1), int(fm.group(2))))
        if depth == 0 and j > start:
            break
    return fields


def words_related(alias: str, field: str) -> bool:
    """True when every word of `alias` appears in `field`, in any order.

    A legitimate SQL alias and the Rust field it feeds may order their words
    differently: `COALESCE(...) AS closed_count` populates `closed_shift_count`.
    Suffix matching rejects that, which is a false positive; word containment
    accepts it while still catching an alias naming a different quantity
    (`AS shift_count` feeding `closed_shift_count` shares only `count`).
    """
    parts = [w for w in alias.split("_") if w]
    if not parts:
        return False
    return all(w in field for w in parts)


def scan(path: Path) -> tuple[list[str], list[str]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if any(m in text for m in TEMPLATE_MARKERS):
        return [], []
    lines = text.splitlines()
    findings: list[str] = []
    acked: list[str] = []

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
        # The mapped fields, gathered by matching the STRUCT LITERAL's braces.
        # A line-based walk cannot do this: a bare shorthand field (`sku,`) and a
        # nested literal (`price: Money { ... },`) are both neither a `row.get` nor
        # the end of the block, and indentation does not separate the nested closer
        # from the fields. See `collect_mapped_fields`.
        fields = collect_mapped_fields(lines, i)
        if len(fields) < 3:
            continue

        want = 0
        for _name, _idx in fields:
            want = max(want, _idx + 1)

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

        bad: list[str] = []
        for name, idx in fields:
            if idx >= len(cols):
                bad.append(f"{name}[{idx}] reads past the projection ({len(cols)} columns)")
                continue
            col = cols[idx]
            # AN ALIASED COLUMN IS NOW CHECKED AGAINST ITS OWN ALIAS, which closes
            # the blind spot the docstring used to record as uncovered. Skipping
            # every aliased column entirely meant a reordered aliased projection went
            # unreported -- the gate's whole purpose, defeated by an unrelated
            # exemption. The ALIAS is the author's stated intent for that index, so
            # comparing the field to the alias is exactly as sound as comparing it to
            # a bare column name, and it still tolerates the legitimate renames
            # (`closed_count` -> `closed_shift_count`).
            alias = re.search(r"\bAS\s+([A-Za-z_][A-Za-z0-9_]*)", col, re.IGNORECASE)
            base = alias.group(1).lower() if alias else column_base(col)
            lname = name.lower()
            if base.endswith(lname) or lname.endswith(base):
                continue
            if alias and words_related(base, lname):
                # An ALIAS is checked by its WORDS, not by suffix. A legitimate
                # rename may reorder them: `AS closed_count` feeding
                # `closed_shift_count` interleaves `closed` + `shift` + `count`, so
                # neither is a suffix of the other and a suffix rule reports it as a
                # defect -- a false positive loud enough to get the gate ignored.
                # Requiring the alias's words to all appear in the field accepts that
                # rename while still catching a genuinely different alias.
                continue
            if any(lname == f and base == c for f, c in KNOWN_RENAMES):
                continue
            if (path.as_posix(), name) in ACKNOWLEDGED:
                acked.append(
                    f"{path.as_posix()}:{i + 1}  {name}[{idx}] <- \"{col.strip()[:50]}\""
                    + chr(10)
                    + "      acknowledged: "
                    + ACKNOWLEDGED[(path.as_posix(), name)]
                )
                continue
            bad.append(f'{name}[{idx}] <- "{col.strip()[:50]}"')

        if bad:
            findings.append(f"{path.as_posix()}:{i + 1}" + chr(10) + "    " + (chr(10) + "    ").join(bad))

    return findings, acked


def _self_test() -> int:
    """Prove the block walker on the two shapes that broke the previous one.

    This checker shipped a clean report over a REAL misalignment because its walk
    stopped at the first line that was not a `row.get`. The repair is brace
    matching, and this pins that -- a self-test is the only way to show the walker
    still does the thing the fix was for, since the live corpus happens to be
    aligned and an exit-0 run proves nothing about the walker.
    """
    cases: list[tuple[str, list[str], list[tuple[str, int]]]] = []

    # The regression: a bare shorthand field BEFORE a nested struct literal. The old
    # line-walk stopped at the shorthand and never reached `image_hash`.
    cases.append((
        "a shorthand and a nested literal do not stop the walk",
        [
            "    let rows = items",
            "        .into_iter()",
            "        .map(|row| Thing {",
            "            sku,",
            "            name: row.get(0)?,",
            "            price: Money {",
            "                minor_units: row.get(1)?,",
            "                currency: row.get(2)?,",
            "            },",
            "            image_hash: row.get(3)?,",
            "        })",
        ],
        [("name", 0), ("minor_units", 1), ("currency", 2), ("image_hash", 3)],
    ))

    # The plain case must still work -- a repair that fixed the hard shape by
    # breaking the easy one would pass the first case alone.
    cases.append((
        "a plain mapper still collects every field",
        [
            "        Thing {",
            "            a: row.get(0)?,",
            "            b: row.get(1)?,",
            "        },",
        ],
        [("a", 0), ("b", 1)],
    ))

    bad = 0
    for name, lines, want in cases:
        anchor = next(i for i, l in enumerate(lines) if "row.get(" in l)
        got = collect_mapped_fields(lines, anchor)
        ok = got == want
        if not ok:
            bad += 1
            print("  %-52s FAIL" % name)
            print("      want %s" % want)
            print("      got  %s" % got)
        else:
            print("  %-52s ok" % name)
    print("SELF-TEST %s (%d cases, no files touched)"
          % ("FAILED" if bad else "OK", len(cases)))
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Check positional row-mapper alignment")
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the block walker on both directions, touch no files",
    )
    ap.add_argument(
        "--roots",
        nargs="+",
        # The WHOLE workspace, not a chosen subset. The default used to name three
        # directories, and `modules` was added to it only after a real misalignment
        # was found there by hand -- the gate had never scanned that tree at all.
        # A default that has to be widened after each miss makes coverage a thing
        # someone remembers rather than a property of the tool, and both callers
        # (`scripts/check.sh`, `dev-ci.yml#static-gates`) invoke this with no
        # `--roots`, so the default IS the coverage. Any directory holding row.
        # mappers belongs here; `tests/` dirs are excluded by the file walk below.
        default=["crates", "apps", "platform", "modules"],
    )
    args = ap.parse_args()

    if args.self_test:
        return _self_test()

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
    acknowledged: list[str] = []
    for f in files:
        bad, acked = scan(f)
        findings.extend(bad)
        acknowledged.extend(acked)

    print(f"scanned {len(files)} production .rs files")

    if acknowledged:
        print(f"{len(acknowledged)} acknowledged mismatch(es), recorded not repaired:")
        print((chr(10) + chr(10)).join(acknowledged))
        print()

    if not findings:
        print("no UNacknowledged positional mapper disagrees with its SELECT")
        return 0
    print(f"{len(findings)} mapper(s) read a column whose name does not match the field:" + chr(10))
    print((chr(10) + chr(10)).join(findings))
    return 1


if __name__ == "__main__":
    sys.exit(main())
