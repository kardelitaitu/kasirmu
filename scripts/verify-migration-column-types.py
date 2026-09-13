#!/usr/bin/env python3
"""Guard against float-typed columns for exact-decimal values.

Why this exists: REAL/DOUBLE PRECISION silently corrupt values that need
exact decimal semantics. The loyalty tier multiplier 1.4 was stored as
1.3999999999999999111, so a $22.50 sale at a 1.4x tier earned 31 points
where the owner's intent was 32 (LOYALTY-01, closed 2026-08-31 by the
earn_multiplier_millionths migration); the tender exchange rate had the
same class of bug at the compute site (MONEY-01). The repo convention is
fixed-point integers — `*_minor` (i64 cents) and `*_millionths` (i64
scaled decimals). This lint stops a NEW float column from entering the
schema without a conscious, written justification.

Scope: every .sql under crates/oz-core/migrations/ (SQLite side AND the
generated init.pg.sql — the PG file is where hand-ported drift historically
introduced DOUBLE PRECISION twins of flagged columns).

Rules:
  * A column definition whose type is REAL, FLOAT, DOUBLE, or DOUBLE
    PRECISION is a violation unless whitelisted.
  * Whitelist entries are content-anchored (file + table + column) and
    carry a justification. A whitelist entry that matches nothing is
    STALE and fails the check — the same discipline as the ERR-10
    error-policy whitelist: exemptions must die when the code dies.

Usage:
    python3 scripts/verify-migration-column-types.py                # full scan
    python3 scripts/verify-migration-column-types.py --staged-only  # only staged migration files
    python3 scripts/verify-migration-column-types.py --anything-else # REFUSED, exit 2, names the flag

An argument this script does not read is refused rather than ignored. Before that, `--self-test`
fell through to the whole-tree scan and exited 0: the caller asked for a self test, got a green,
and nothing self-tested. A flag is a request for a surface, so a flag that has no surface cannot
be answered with the verdict for another one.

THE EMPTY CORPUS
================

Every path -- clean, violating, and refused -- prints how many migration files it
scanned and the root it scanned. A count that appears only when it is non-zero is the
defect shape: a copy of this script in a throwaway directory used to find no .sql file,
print nothing, and exit 0, a clean verdict byte-for-byte indistinguishable from the real
thing (the same hollow-verdict class as verify-no-hardcoded-money-format.py at 1f7c2311c
and verify-flaky-quarantine.py at ae7f19c03).

A WHOLE-TREE scan that finds zero migration files therefore REFUSES with exit 2 -- there
is no corpus to be clean about. --staged-only does NOT refuse on zero: pre-commit step 4
triggers on a staged migration, but any commit that reaches this gate with a non-migration
staged set legitimately has an empty scope, and zero is the correct answer there. Failing
that run would fail every commit in the repository, so the refusal is conditional on the
mode and the message names the mode it refused.

EXIT CODES
==========

  * 0  no unwhitelisted float columns over the corpus this run scanned.
  * 1  at least one violation or stale whitelist entry (the CI / check.sh / hook gate).
  * 2  a whole-tree scan whose migration root yielded 0 files, or a --staged-only run that
       could not read the git index -- either way the verdict had no corpus, so this
       script refuses to print one rather than printing a hollow one. Also 2 on a dashed
       argument this script does not implement: a refused command line, not a failed check.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

# Repo-relative, never anchored to a hardcoded checkout (AGENTS.md).
ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "crates" / "oz-core" / "migrations"

# Column-name + float-type pair. The column name is the word before the
# type keyword; matches inside comments are impossible (comments are
# stripped first). Constraint-leading keywords can never be a column name
# because they are excluded below.
FLOAT_TYPE = r"(?:DOUBLE\s+PRECISION|DOUBLE|REAL|FLOAT)"
COL_RE = re.compile(rf"\b\"?([A-Za-z_]\w*)\"?\s+{FLOAT_TYPE}\b")
ALTER_RE = re.compile(
    rf"ALTER\s+TABLE\s+\"?([A-Za-z_]\w*)\"?\s+ADD\s+(?:COLUMN\s+)?\"?([A-Za-z_]\w*)\"?\s+{FLOAT_TYPE}\b",
    re.IGNORECASE,
)
# The trailing \s*\( is load-bearing: without it, `CREATE TABLE IF NOT
# EXISTS "products"` backtracks the optional IF-group (quoted name fails
# the bare capture) and reports the table as "IF".
CREATE_RE = re.compile(
    r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?\"?([A-Za-z_]\w*)\"?\s*\(", re.IGNORECASE
)
# Words that appear before a type but are not column names.
NOT_A_COLUMN = {"PRIMARY", "UNIQUE", "CHECK", "FOREIGN", "REFERENCES", "CONSTRAINT"}


@dataclass(frozen=True)
class Hit:
    file: str
    table: str
    column: str
    line: int


@dataclass(frozen=True)
class Allowed:
    file: str
    table: str
    column: str
    why: str


# Every exemption, with the reason it is not an exact-decimal value.
WHITELIST: tuple[Allowed, ...] = (
    Allowed(
        "20260813_init.sql", "loyalty_tiers", "earn_multiplier",
        "historical column: fresh-install replay target, converted to "
        "earn_multiplier_millionths by 20260831_loyalty_multiplier_fixedpoint.sql",
    ),
    Allowed(
        "20260813_init.sql", "products", "popularity_score",
        "analytics score recomputed from sales history; display-ranked, never money",
    ),
    Allowed(
        "20260813_init.pg.sql", "products", "popularity_score",
        "PG twin of the analytics score above",
    ),
    Allowed(
        "20260831_per_tenant_unique_rebuild.sql", "products_new", "popularity_score",
        "faithful copy of products.popularity_score during the uniqueness rebuild",
    ),
    # Floor-plan canvas geometry on the restaurant `tables` table —
    # display-only coordinates, never money.
    Allowed("20260813_init.sql", "tables", "pos_x", "floor-plan canvas geometry, display-only"),
    Allowed("20260813_init.sql", "tables", "pos_y", "floor-plan canvas geometry, display-only"),
    Allowed("20260813_init.sql", "tables", "width", "floor-plan canvas geometry, display-only"),
    Allowed("20260813_init.sql", "tables", "height", "floor-plan canvas geometry, display-only"),
    Allowed("20260813_init.pg.sql", "tables", "pos_x", "PG twin: floor-plan geometry"),
    Allowed("20260813_init.pg.sql", "tables", "pos_y", "PG twin: floor-plan geometry"),
    Allowed("20260813_init.pg.sql", "tables", "width", "PG twin: floor-plan geometry"),
    Allowed("20260813_init.pg.sql", "tables", "height", "PG twin: floor-plan geometry"),
)


def strip_comments(sql: str) -> str:
    """Blank out -- line comments and /* */ blocks, preserving line numbers."""
    sql = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), sql, flags=re.S)
    return re.sub(r"--[^\n]*", "", sql)


def refuse(mode: str, scanned: int, corpus: int, *, index_unreadable: bool = False) -> None:
    """Say what was looked for, where, and what came back.

    stdout, not stderr: scripts/run-pre-push.py surfaces only a child's stdout, and this
    is the sentence an operator most needs to see when a verdict goes missing.
    """
    head = (
        "verify-migration-column-types: REFUSED — the git index could not be read, so "
        "the --staged-only scope is unknown, and an unknown scope is not an empty one."
        if index_unreadable else
        "verify-migration-column-types: REFUSED — a gate that scanned no migration "
        f"files must not print clean, and in {mode} mode it scanned {scanned}."
    )
    print(head)
    print(f"  mode                     : {mode}")
    print(f"  migration root           : {MIGRATIONS}"
          + ("" if MIGRATIONS.is_dir() else "  (directory absent)"))
    print(f"  looked for               : *.sql directly under that root — "
          f"{corpus} file(s) found")
    print(f"  repo root resolved from  : {ROOT}  (parent of this script's directory, "
          "never a hardcoded checkout)")
    if index_unreadable:
        print("  reason                   : the git index could not be read, so the "
              "--staged-only scope is unknown — unknown is not empty.")
    else:
        print("  a copy of this script outside a checkout reaches this line instead of "
              "reporting a clean schema; run it from a tree that holds "
              "crates/oz-core/migrations/.")
    print("  note: --staged-only with nothing staged is NOT a refusal — there the empty "
          "set is the correct answer and the gate exits 0.")


def scan_file(path: Path) -> list[Hit]:
    text = strip_comments(path.read_text(encoding="utf-8"))
    hits: list[Hit] = []
    table = "?"
    for lineno, line in enumerate(text.splitlines(), start=1):
        m = CREATE_RE.search(line)
        if m:
            table = m.group(1)
        for am in ALTER_RE.finditer(line):
            hits.append(Hit(path.name, am.group(1), am.group(2), lineno))
        for cm in COL_RE.finditer(line):
            col = cm.group(1)
            if col.upper() in NOT_A_COLUMN:
                continue
            # ALTER ADD lines are already captured precisely by ALTER_RE;
            # COL_RE would double-report them with the wrong table context.
            if re.search(rf"ADD\s+(?:COLUMN\s+)?\"?{re.escape(col)}\"?\s+{FLOAT_TYPE}", line, re.IGNORECASE):
                continue
            hits.append(Hit(path.name, table, col, lineno))
    return hits


def staged_migration_paths() -> set[str] | None:
    """Repo-relative staged migration paths, or None when the index cannot be read.

    None is a REFUSAL condition, not an empty set: an unreadable index and an index with
    no migration staged both yield zero files, and only one of them is a correct answer.
    """
    try:
        proc = subprocess.run(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM", "-z", "--",
             "crates/oz-core/migrations/"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        )
    except Exception as exc:  # no repo, no git, non-zero exit
        print(
            f"error: cannot read the git index (git diff --cached) for {ROOT}: {exc}",
            file=sys.stderr,
        )
        return None
    return {p for p in proc.stdout.split("\0") if p}


# The complete set of dashed arguments this script implements. `main` below is its only
# reader, and it reads this one; keep the two together when a flag is added. Anything else
# that starts with a dash is a request for a surface this gate does not have, so it is
# refused rather than ignored -- an ignored flag used to print the whole-tree verdict.
KNOWN_FLAGS = ("--staged-only",)


def unknown_flag(argv: list[str]) -> str | None:
    """The first dashed argument missing from KNOWN_FLAGS, or None when all of them are known.

    Only dashed arguments are judged; a positional has never been read here and still is not.
    """
    for arg in argv:
        if arg.startswith("-") and arg not in KNOWN_FLAGS:
            return arg
    return None


def reject_unknown_flag(flag: str) -> int:
    """Name the flag this gate does not implement, list the ones it does, and stop.

    stdout, not stderr, for the reason `refuse()` documents: scripts/run-pre-push.py surfaces
    only a child's stdout. No scan result prints on this path -- the command line asked for a
    check that does not exist here, so the only honest output is the usage line.
    """
    print(f"verify-migration-column-types: REFUSED — unrecognised argument {flag}. This gate "
          "implements no such flag; the whole-tree scan it would otherwise run is not the "
          "surface that was asked for, and exiting 0 over it is a green for a check nobody ran.")
    print("  usage : python3 scripts/verify-migration-column-types.py"
          + "".join(f" [{f}]" for f in KNOWN_FLAGS))
    print(f"  flags this script implements: {', '.join(KNOWN_FLAGS)}")
    return 2


def main(argv: list[str]) -> int:
    flag = unknown_flag(argv)
    if flag is not None:
        return reject_unknown_flag(flag)
    staged_only = "--staged-only" in argv
    mode = "--staged-only" if staged_only else "whole-tree (no --staged-only)"
    corpus = sorted(MIGRATIONS.glob("*.sql"))
    files = corpus
    if staged_only:
        staged = staged_migration_paths()
        if staged is None:
            refuse(mode, 0, len(corpus), index_unreadable=True)
            return 2
        files = [f for f in corpus if str(f.relative_to(ROOT)).replace("\\", "/") in staged]

    scanned = len(files)
    # An empty WHOLE-TREE walk is not a clean schema, it is a gate that read nothing --
    # typically a copy of this file outside a checkout, whose script-relative root holds
    # no migrations at all. Refuse it. An empty STAGED set is a correct answer (pre-commit
    # step 4 can reach this gate from a commit that staged no migration), so it is exempt:
    # failing it would fail every commit in the repository.
    if scanned == 0 and not staged_only:
        refuse(mode, scanned, len(corpus))
        return 2

    hits: list[Hit] = []
    for f in files:
        hits.extend(scan_file(f))

    allowed = {(a.file, a.table, a.column) for a in WHITELIST}
    violations = [h for h in hits if (h.file, h.table, h.column) not in allowed]
    # Stale-entry detection only makes sense on a FULL scan: a staged-only
    # pass sees a subset of files, so exemptions for unscanned columns
    # would false-flag (the ERR-10 scoping lesson).
    seen = {(h.file, h.table, h.column) for h in hits}
    stale = [] if staged_only else [a for a in WHITELIST if (a.file, a.table, a.column) not in seen]

    rc = 0
    for v in violations:
        print(
            f"error: {v.file}:{v.line} — column {v.table}.{v.column} is float-typed. "
            "Exact-decimal values (money, rates, multipliers) must be fixed-point "
            "integers (*_minor, *_millionths) per LOYALTY-01/MONEY-01. If this "
            "column genuinely needs a float (geometry, analytics), add a "
            "justified WHITELIST entry to this script.",
            file=sys.stderr,
        )
        rc = 1
    for a in stale:
        print(
            f"error: stale whitelist entry {a.file} {a.table}.{a.column} "
            f"({a.why}) — the column no longer exists; remove the exemption.",
            file=sys.stderr,
        )
        rc = 1
    # The corpus size prints on EVERY path, including zero, so a reader who sees a
    # verdict can see the number of files it was computed over and the root they came from.
    scope = (
        f"{scanned} of {len(corpus)} staged migration file(s)"
        if staged_only else f"{scanned} migration file(s)"
    )
    scanned_line = (
        f"verify-migration-column-types: scanned {scope} under {MIGRATIONS} "
        f"({len(hits)} float-typed column(s) found)"
    )
    if rc == 0:
        print(f"ok: no unwhitelisted float columns ({scope} scanned under {MIGRATIONS}, "
              f"{len(hits)} float hits all exempt)")
    else:
        print(scanned_line)
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
