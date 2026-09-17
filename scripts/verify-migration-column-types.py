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

Scope: every .sql under crates/kasirmu-core/migrations/ (SQLite side AND the
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
    python3 scripts/verify-migration-column-types.py --self-test    # pin every refusal below
    python3 scripts/verify-migration-column-types.py --anything-else # REFUSED, exit 2, names the flag

An argument this script does not read is refused rather than ignored. Before that, `--self-test`
fell through to the whole-tree scan and exited 0: the caller asked for a self test, got a green,
and nothing self-tested. A flag is a request for a surface, so a flag that has no surface cannot
be answered with the verdict for another one. `--self-test` is now implemented rather
than refused: it runs every refusal below as a child of this same file and prints a
CAUGHT/CLEAN tally, so a root guard that stops firing cannot go unnoticed.

A ROOT ON THE COMMAND LINE IS REFUSED WHERE IT RESOLVES, BEFORE THE WALK
========================================================================

This gate has no root argument — the corpus is `crates/kasirmu-core/migrations`, derived from
`__file__` — but its siblings (`scan-unwrap-panic.py`, `verify-no-hardcoded-money-format.py`)
do take `--roots`, so a caller typing a root list here is asking for a scoped scan. Nothing
used to read a positional, so:

    python3 scripts/verify-migration-column-types.py nope                 # exit 0, whole-tree verdict

one mistyped token, and the run walked all 59 migrations and printed a clean verdict for a
corpus nobody asked about. A typo in a root must never be able to produce a pass, so every
non-dashed token is now resolved against the repo root BEFORE the walk and refused (exit 2,
`error:` on stderr, naming the bad token and every path it looked at) when it is not a
directory — and also when it is one, because a scan this gate cannot scope is not the scan
that was requested. `--roots` keeps its unrecognised-flag refusal and gains the same root
diagnosis, so the message names `nope` and not merely `--roots`. A root list that resolves to
nothing — `--roots` with no values, or a blank one — refuses too: an empty set never
silently means "all", and "scan nothing" and "scan everything" are different requests.

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
       argument this script does not implement, and 2 on a root argument it cannot resolve
       (a path that is not a directory, a root list that resolves to nothing, or any path
       handed to a gate with no root argument): a refused command line, not a failed check.

Exit 1 is reserved for a verdict: a 1 here means a real scan of a real corpus found a float
column or a stale exemption. So a crash, a mistyped root, or a half-resolved root list must
never cost that code -- a refused run prints 2 and prints no count at all.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

# Repo-relative, never anchored to a hardcoded checkout (AGENTS.md).
ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "crates" / "kasirmu-core" / "migrations"

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
              "crates/kasirmu-core/migrations/.")
    print("  note: --staged-only with nothing staged is NOT a refusal — there the empty "
          "set is the correct answer and the gate exits 0.")


# -- root arguments ---------------------------------------------------------------
#
# This gate has one corpus: `crates/kasirmu-core/migrations`, resolved from __file__ above. It
# implements no root argument, so anything on the command line that looks like a root — a
# `--roots` list, or a bare path — is a request to scope this scan to paths it cannot honour.
# Sibling gates (`scan-unwrap-panic.py`, `verify-no-hardcoded-money-format.py`) DO take root
# lists, which is why typing one here is a likely mistake rather than an impossible one.
#
# Before this section a root-shaped token was simply never read, and never read is not the same
# as refused: `verify-migration-column-types.py crates/kasirmu-core/migratios` — one letter off —
# printed the ordinary whole-tree `ok:` line at exit 0. A PASS manufactured by a typo, about a
# corpus the caller did not name. So a root is now resolved where it resolves, BEFORE any walk,
# and an unresolvable one refuses at 2.

def named_roots(argv: list[str]) -> tuple[bool, list[str]]:
    """(a root argument was handed, the path tokens on the command line).

    Every non-dashed token counts, flagged or not: this gate has no other use for a path, so a
    bare positional is a root by the caller's intent even though no flag names it.
    """
    return "--roots" in argv, [a for a in argv if not a.startswith("-")]


def classify_roots(values: list[str]) -> tuple[list[str], list[str], list[str]]:
    """(directories, blanks, not-directories), resolved against ROOT before the walk.

    Three buckets because the three causes read differently to whoever typed them. A blank is
    NOT read as the current directory: Path("") is Path("."), so a blank value would widen a
    request to scan nothing into a scan of everything under wherever the gate happened to be
    launched — the opposite of what a root list is for. So a blank refuses, and never wildcards.
    """
    dirs: list[str] = []
    blanks: list[str] = []
    missing: list[str] = []
    for value in values:
        if not value.strip():
            blanks.append(value)
        elif (ROOT / value).is_dir():
            dirs.append(value)
        else:
            missing.append(value)
    return dirs, blanks, missing


def refuse_roots(flag: str | None, values: list[str]) -> int:
    """Name every root token this command line cannot honour, say where it looked, stop at 2.

    The voice is the `error:` line this file already uses for everything that is not a verdict
    — `staged_migration_paths` prints its unreadable-index failure that way, on stderr.

    Exit 2 and NEVER 1. In this family a 1 is a finding about somebody's migration file; a
    command line with no corpus behind it is not a failed check and must not impersonate one.
    No scan count prints on this path at all, so a refusal cannot be mistaken for a verdict —
    and nothing has been walked to produce it.
    """
    dirs, blanks, missing = classify_roots(values)
    source = flag or "a path argument with no flag in front of it"
    if not values:
        why = ("was handed no value at all, so the root list resolves to the empty set — and "
               "an empty set is never answered by scanning every root.")
    elif missing:
        why = "named no directory this gate can read, so there is no corpus behind it."
    elif blanks:
        why = ("named only blank value(s); a blank resolves to no root and is never read as "
               "the current directory.")
    else:
        why = ("named root(s) that all resolve, but this gate reads no root argument: its "
               "corpus is the migration root below, and a whole-tree verdict is not the answer "
               "to a scoped request.")
    print(f"error: {source} {why} A typo in a root must never be able to produce a pass, so "
          "this run refuses before walking anything.", file=sys.stderr)
    print(f"  command line            : {' '.join(([flag] if flag else []) + values)}",
          file=sys.stderr)
    if missing:
        print(f"  named but not a directory : {', '.join(repr(m) for m in missing)}",
              file=sys.stderr)
        for miss in missing:
            print(f"    it looked at         : {ROOT / miss}  (not a directory)",
                  file=sys.stderr)
    if blanks:
        print(f"  named but blank           : {len(blanks)} value(s)", file=sys.stderr)
    print(f"  named and a directory     : {', '.join(repr(d) for d in dirs) if dirs else '(none)'}",
          file=sys.stderr)
    print(f"  repo root resolved from   : {ROOT}  (parent of this script's directory, never a "
          "hardcoded checkout)", file=sys.stderr)
    print(f"  the only root this gate scans: {MIGRATIONS}", file=sys.stderr)
    print("  note: the whole-tree scan this command line would otherwise have printed is the "
          "verdict for a corpus nobody asked about; refusing it costs a run, not a schema.",
          file=sys.stderr)
    return 2


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
             "crates/kasirmu-core/migrations/"],
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
KNOWN_FLAGS = ("--staged-only", "--self-test")


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


# -- self-test ----------------------------------------------------------------------
#
# Every case runs THIS file as a child, from the repo root, with the two streams kept apart:
# a refusal that lands on stdout would not be caught by an assertion about stderr, and the
# difference is the whole point of the `error:` voice. Each case names the mutation that
# reddens it; a case with no such pair is not kept.

_SCANNED_RE = re.compile(r"(\d+) (?:of \d+ )?(?:staged )?migration file\(s\)")


def _verdict_printed(text: str) -> bool:
    """True when a run reported a count or an ok line — i.e. when it actually reached a verdict.

    The refusals must print neither. A gate that explains why it cannot answer and then prints
    `59 migration file(s) scanned` has answered, and the reader cannot tell which run to trust.
    """
    folded = text.replace("\\", "/")
    return bool(_SCANNED_RE.search(folded)) or "ok: no unwhitelisted float columns" in folded


def _run_gate(args: list[str]) -> tuple[int, str, str]:
    """(exit, stdout, stderr) for this file run as a child with `args`, from the repo root.

    A child, not a call into main(): the exit code and the stream a message lands on are
    properties of the command line, and a mutated copy of this file then tests itself.
    """
    proc = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), *args],
        cwd=str(ROOT), capture_output=True, text=True, errors="replace", timeout=180,
    )
    return proc.returncode, proc.stdout or "", proc.stderr or ""


def self_test() -> int:
    """Pin every refusal this gate owes its caller, and the one scan it owes the schema.

    CAUGHT = the gate refused, or reported, what it must. CLEAN = a real invocation still works.
    A red run exits 2, NEVER 1: a broken self-test is not a verdict about anyone's migration, and
    spending the verdict code here would be the same confusion this file exists to prevent.
    """
    caught = clean = red = 0

    def verdict(ok: bool, kind: str, desc: str, expected: str, seen: str) -> None:
        nonlocal caught, clean, red
        if ok:
            if kind == "CAUGHT":
                caught += 1
            else:
                clean += 1
            print(f"  {kind}  {desc}")
            return
        red += 1
        print(f"  MISSED  {desc}")
        print(f"          expected {expected}")
        print(f"          saw      {seen}")

    # (1) A mistyped root inside a --roots list.
    #     Mutation: drop the refuse_roots() call in main()'s unknown-flag arm. The exit code
    #     alone does NOT redden it — the flag refusal already exits 2 — so what this case pins is
    #     the token: the pre-fix message named only `--roots` and never the value that was wrong.
    rc, out, err = _run_gate(["--roots", "crates", "nope"])
    verdict(
        rc == 2 and "nope" in err and "not a directory" in err and not _verdict_printed(out + err)
        and "Traceback" not in out + err,
        "CAUGHT",
        "--roots crates nope: exit 2, the bad token and the path tried, no verdict line",
        "exit 2, stderr naming 'nope' and 'not a directory', no count and no ok line",
        f"exit {rc}, token named={'nope' in err}, verdict printed={_verdict_printed(out + err)}",
    )

    # (2) A --roots list whose every value really is a directory.
    #     Mutation: narrow the guard to `missing or blanks` only. The gate then answers a scoped
    #     request with the flag refusal and no root diagnosis, which is the half-answer (1)
    #     already covers — this case is what makes the "it reads no root argument" sentence load
    #     bearing, since a root list cannot be honoured here whether it resolves or not.
    rc, out, err = _run_gate(["--roots", "crates", "crates/kasirmu-core/migrations"])
    verdict(
        rc == 2 and "reads no root argument" in err and not _verdict_printed(out + err),
        "CAUGHT",
        "--roots crates crates/kasirmu-core/migrations: refused, and says this gate scopes to nothing",
        "exit 2 plus the 'reads no root argument' refusal, still no verdict line",
        f"exit {rc}, reason printed={'reads no root argument' in err}",
    )

    # (3) A root list that resolves to the empty set.
    #     Mutation: let an empty list fall through to the default. That is the "empty silently
    #     means all" failure: the caller asked for nothing and the gate answers with 59 files.
    rc, out, err = _run_gate(["--roots"])
    verdict(
        rc == 2 and "empty set" in err and "every root" in err and not _verdict_printed(out + err),
        "CAUGHT",
        "--roots with no values: exit 2, and the refusal says an empty set never means all",
        "exit 2 plus 'empty set'/'never … every root', no count line",
        f"exit {rc}, empty-named={'empty set' in err}, verdict printed={_verdict_printed(out + err)}",
    )

    # (4) A blank root.
    #     Mutation: read Path("") as Path("."). The scan would then run over wherever this was
    #     launched from — widened to everything by the narrowest possible argument.
    rc, out, err = _run_gate([""])
    verdict(
        rc == 2 and "blank" in err and not _verdict_printed(out + err),
        "CAUGHT",
        "a blank root: exit 2, named as blank, never widened to the current directory",
        "exit 2 plus the blank-value refusal, no count line",
        f"exit {rc}, blank named={'blank' in err}",
    )

    # (5) A mistyped root handed with no flag in front of it — the pass this file used to print.
    #     Mutation: delete the positional arm of main(). The run then falls through to the
    #     whole-tree scan and exits 0 with its ordinary ok line, which is the defect: one letter
    #     off in a path, and the gate certifies a corpus the caller did not name.
    rc, out, err = _run_gate(["crates/kasirmu-core/migratios"])
    verdict(
        rc == 2 and "migratios" in err and not _verdict_printed(out + err),
        "CAUGHT",
        "a typo'd root as a bare argument: exit 2, the token named, no verdict line",
        "exit 2 with the mistyped path in the message, and no 'ok:' line at all",
        f"exit {rc}, token named={'migratios' in err}, verdict printed={_verdict_printed(out + err)}",
    )

    # (6) Control: an unknown dashed argument is still refused as an unknown flag.
    #     Mutation: make the root guard swallow every refusal, or restore the pre-7b4c2bc5a
    #     fall-through. This is the earlier defect, kept pinned beside the new one.
    rc, out, err = _run_gate(["--report"])
    verdict(
        rc == 2 and "unrecognised argument --report" in out + err
        and not _verdict_printed(out + err),
        "CAUGHT",
        "--report (a flag this gate never had): still exit 2, still no verdict",
        "exit 2 naming the flag as unrecognised, no count line",
        f"exit {rc}",
    )

    # (7) The default root set still scans. CLEAN by design, and the case that proves the guard
    #     above is additive: no root argument, so the whole corpus must be walked and counted.
    #     Mutation: make the positional guard fire on an empty argv.
    rc, out, err = _run_gate([])
    folded = (out + err).replace("\\", "/")
    m = _SCANNED_RE.search(folded)
    scanned = int(m.group(1)) if m else -1
    default_ok = MIGRATIONS.is_dir()
    verdict(
        rc in (0, 1) and scanned > 0 and default_ok and "REFUSED" not in folded,
        "CLEAN",
        f"no root argument: the default root still scans ({scanned} migration file(s)) and "
        f"reaches a verdict (exit {rc})",
        "exit 0 or 1, a scanned count above zero, no refusal block",
        f"exit {rc}, scanned={scanned}",
    )

    # (8) The hook's own invocation is still a scope, not a refusal.
    #     Mutation: treat --staged-only as a root argument, or refuse an empty staged set; either
    #     one turns pre-commit step 4 red on every commit in the repository.
    rc, out, err = _run_gate(["--staged-only"])
    folded = (out + err).replace("\\", "/")
    staged_count = _SCANNED_RE.search(folded)
    verdict(
        rc in (0, 1) and "staged migration file(s)" in folded and staged_count is not None,
        "CLEAN",
        "--staged-only still reports its staged scope (exit "
        f"{rc}, {staged_count.group(1) if staged_count else '?'} file(s) in scope)",
        "exit 0 or 1 and a staged count line — never the exit 2 refusal",
        f"exit {rc}",
    )

    rc_out = 0 if red == 0 else 2
    print(f"  tally: {caught + clean} green = {caught} CAUGHT + {clean} CLEAN; {red} red; "
          f"exit {rc_out}")
    print("  LIMIT: nothing calls this flag. scripts/gates.json and dev-ci.yml sit outside this "
          "file, so a green tally is a developer tool, not enforcement — and cases (7) and (8) "
          "read the live tree, so their counts move with every migration by design.")
    if red:
        print("  a case slipped through: the behaviour it pins is no longer pinned (exit 2, not "
              "1 — a broken self-test must not impersonate a float-column finding)")
    return rc_out


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
    flag = unknown_flag(argv)
    roots_flag, root_values = named_roots(argv)
    if flag is not None:
        rc = reject_unknown_flag(flag)
        # The flag refusal says "no such flag". When the flag was a root list it must also say
        # WHICH of its values is not a directory, so `--roots crates nope` names `nope` and the
        # path it was tried at. Still before the walk, still exit 2 — this only diagnoses.
        if roots_flag or root_values:
            refuse_roots(flag, root_values)
        return rc
    if root_values:
        # A path with no flag in front of it. This is the case that used to print a PASS: a
        # mistyped root was ignored and the whole-tree verdict came back clean.
        return refuse_roots(None, root_values)
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
