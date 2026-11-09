#!/usr/bin/env python3
"""Grade `path:LINE` citations in LIVE documentation against the tree.

WHY THIS EXISTS
    Every other checker in this directory resolves a *path*. None grades a
    *line number*. A citation can therefore point at the right file and the
    wrong hundred lines forever while every gate stays green — measured on
    2026-10-19: 23 of 150 sampled live citations were on the wrong line, the
    worst 333 lines out. `docs/records/audits/2026-10-19-line-number-
    citation-residual.md` records that first survey and why a hand pass could
    not finish it (396 citations across 29 files).

WHAT IT GRADES, AND WHAT IT REFUSES TO GUESS
    A citation is only testable when the doc line names a SYMBOL. So for each
    `path:N` this tool looks for a symbol token on the same doc line and asks
    whether that symbol is near line N. Three verdicts:

      OK          symbol found within WINDOW lines of N
      DRIFTED     symbol is in the file, but not near N (report the real line)
      SYMBOL-GONE symbol appears nowhere in the file
      NO-ANCHOR   the doc line names no symbol -> NOT GRADED, not a pass

    NO-ANCHOR is counted separately on purpose. Reporting it as clean would be
    the exact failure this file exists to prevent: a green that can not be made
    red. The summary prints the ungraded count so a reader can see the ceiling
    of the check.

    ADJACENT-LINE ANCHORS (added 2026-10-19, after measuring that 73 of 98
    NO-ANCHOR citations had their symbol on the line above or below): a prose
    citation usually ends one line and names its symbol on the next. So when the
    doc line carries NO OTHER backticked token, the neighbours are consulted. It
    is deliberately narrow -- a line that already names something is its own
    evidence, and borrowing a neighbour then recovers the WRONG symbol. That
    exact failure was measured twice before the gate existed:
    `main.rs:630` ("the field is `db`") picked up `db_kind` from the next line,
    and `mobile/lib.rs:1331` picked up a fiscal command from the line below;
    both citations were correct.

    A citation that is deliberately wrong — a "Repaired:" note quoting what a
    file USED to cite, a documented historical coordinate — must not be
    "fixed". Two pragma forms suppress one, matching check-dead-refs.py's
    convention: an inline `dead-ref: ok:` on the line, or on the line above.

EXIT CODES
    0  no DRIFTED and no SYMBOL-GONE findings (NO-ANCHOR citations may remain)
    1  findings
    2  usage or scan error

USAGE
    python3 .agents/skills/docs-auditor/scripts/check-cite-lines.py
    python3 .agents/skills/docs-auditor/scripts/check-cite-lines.py --verbose
    python3 .agents/skills/docs-auditor/scripts/check-cite-lines.py --file README.md
    python3 .agents/skills/docs-auditor/scripts/check-cite-lines.py --self-test

SCOPE
    LIVE docs only. `docs/records/`, `docs/specs/_done/`, `docs/plans/` and any
    `todo-`/`plan-`/`done-`/`prd-` named file are dated records: their
    coordinates describe the tree at their own commit, and grading them against
    HEAD would manufacture findings no one can act on. The same rule
    check-dead-refs.py applies to paths.
"""
import argparse
import pathlib
import re
import sys

# path:N — the file extension list is deliberately explicit. A bare `docs/x:12`
# is usually a heading number, not a line citation.
CITE = re.compile(
    r"`([A-Za-z0-9_/.-]+\.(?:rs|ts|tsx|sql|py|mjs|sh|go|css|json|ftl|toml|md)):(\d+)(?:-(\d+))?`")

# A symbol is a backticked token or a bare snake_case/camelCase identifier.
BACKTICK = re.compile(r"`([^`\n]+)`")
IDENT = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]{5,})\b")

PRAGMA = "dead-ref: ok:"

# Rust/TS keywords are not symbols. Without this, `pub mod` on a doc line
# anchors to the first `pub` anywhere in the file and produces a confident
# DRIFTED against a citation that was fine.
KEYWORDS = frozenset("""
pub mod fn const static impl struct enum trait use let mut async await match if
else for while loop return self Self super crate type where dyn move ref unsafe
extern as in break continue
""".split())

# Directories whose contents are dated records, not live claims.
HIST_DIRS = ("docs/records/", "docs/specs/_done/", "docs/plans/", ".agents/")
HIST_NAME = re.compile(r"(^|/)(todo-|plan-|done-|prd-)")

WINDOW = 8

# A doc line longer than this is prose (an audit stamp, a paragraph), not a
# citation, so bare identifiers on it are not trusted as anchors.
BARE_LINE_MAX = 160

LIVE_ROOTS = ["README.md", "README-technical.md", "ARCHITECTURE.md",
              "AGENTS.md", "CONTRIBUTING.md", "DSH.md"]
LIVE_DIRS = ["docs/architecture", "docs/security", "docs/operations", "docs/guides"]


def repo_root():
    """<root>/.agents/skills/docs-auditor/scripts/ -> four parents up.

    Resolved from __file__ rather than `git rev-parse` because under a
    restricted sandbox subprocess.PIPE cannot be created (WinError 5) and the
    git call dies with PermissionError, which reads as a broken checker.
    """
    guess = pathlib.Path(__file__).resolve().parents[4]
    if (guess / ".git").exists() or (guess / "Cargo.toml").is_file():
        return guess
    raise SystemExit("cannot resolve repo root from %s" % __file__)


def is_historical(rel: str) -> bool:
    if any(rel.startswith(d) or ("/" + d) in ("/" + rel) for d in HIST_DIRS):
        return True
    return bool(HIST_NAME.search(rel))


def live_docs(root: pathlib.Path):
    out = []
    for name in LIVE_ROOTS:
        p = root / name
        if p.is_file():
            out.append(p)
    for d in LIVE_DIRS:
        base = root / d
        if base.is_dir():
            out.extend(sorted(base.rglob("*.md")))
        elif base.is_file():
            out.append(base)
    seen, uniq = set(), []
    for p in out:
        r = p.relative_to(root).as_posix()
        if r in seen or is_historical(r):
            continue
        seen.add(r)
        uniq.append(p)
    return uniq


def suppressed(lines, idx) -> bool:
    here = lines[idx]
    above = lines[idx - 1] if idx > 0 else ""
    return PRAGMA in here or PRAGMA in above


def anchors_on(line: str, cite: str):
    """Symbol candidates on a doc line, excluding the citation itself.

    Filters, each learned by getting it wrong:

    * BACKTICKED tokens are the only trusted signal. An author who wrote
      `list_sales_with_history_cap` next to a path is naming that symbol.
    * Bare identifiers are NOT trusted at all. A first version accepted them on
      "short" lines and produced a confident OK for
      `apps/desktop-tauri/src/state.rs:279 (AppState::new)` because the prose
      `AppState` happens to appear at :32 in a 1005-line file — a false pass,
      which is the worst failure this tool can emit.
    * ORDER MATTERS and is NEAREST-FIRST from the citation, not longest-first.
      A cell like `` `adjust.rs:249` | `.filter(...)` ... `adjust_stock_at__
      location_with_reason` `` cites the filter at :249; picking the longest
      token instead anchored on the function defined at :190 and reported a
      correct citation as DRIFTED. The token an author places adjacent to the
      line number is the one the line number refers to.

    Returns (symbol, distance_in_chars) pairs, nearest first.
    """
    rest = line.replace(cite, " ")
    cands = []
    for m in BACKTICK.finditer(rest):
        tok = m.group(1).strip()
        # a backticked token that is itself a path is not a symbol
        if re.search(r"[/\\]", tok) or tok.endswith((".rs", ".ts", ".tsx", ".sql")):
            continue
        # `AppState::new` -> AppState ; `pub mod` -> nothing (keywords dropped)
        for part in re.split(r"[^A-Za-z0-9_]+", tok):
            if len(part) >= 4 and part not in KEYWORDS:
                # distance from this token to the citation itself
                cands.append((part, abs(m.start() - (line.find(cite) + len(cite)))))
    return sorted(set(cands), key=lambda t: t[1])


def grade(root: pathlib.Path, doc: pathlib.Path, verbose=False):
    text = doc.read_text(encoding="utf-8", errors="replace")
    lines = text.split("\n")
    rel = doc.relative_to(root).as_posix()
    results = []
    for i, line in enumerate(lines):
        for m in CITE.finditer(line):
            target, n = m.group(1), int(m.group(2))
            full = m.group(0)
            tp = root / target
            if not tp.is_file():
                continue  # a missing PATH is check-dead-refs.py's job, not ours
            if suppressed(lines, i):
                results.append((rel, i + 1, target, n, "SUPPRESSED", "", full))
                continue
            tlines = tp.read_text(encoding="utf-8", errors="replace").split("\n")
            own = anchors_on(line, full)
            # A prose citation usually puts the symbol on the NEXT line — or the
            # previous one when the coordinate ends the sentence and the symbol
            # starts the continuation. Measured 2026-10-19: 73 of 98 previously
            # NO-ANCHOR citations have a backticked symbol on an adjacent line,
            # so refusing to look there left most of the corpus ungraded.
            #
            # The neighbour is only a FALLBACK: own-line anchors are tried first
            # and win, so a line carrying its own symbol can never be re-pointed
            # by something adjacent. Neighbour anchors carry a large distance
            # penalty for the same reason.
            nbrs = []
            if i > 0:
                nbrs.append((-1, lines[i - 1]))
            if i + 1 < len(lines):
                nbrs.append((1, lines[i + 1]))
            # A neighbour anchor is used ONLY when the doc line carries no other
            # backticked token at all. Without this gate the neighbour recovers
            # the WRONG symbol: `apps/cloud-server/src/main.rs:630` ("the field
            # is `db`") picked up `db_kind` from the next line and was reported
            # SYMBOL-GONE, and `mobile/lib.rs:1331` picked up a fiscal command
            # from the line below. Both citations were exactly right. A line that
            # already names something is its own evidence; only a line that names
            # nothing may borrow from a neighbour.
            rest_of_line = full and line.replace(full, " ")
            has_other_backtick = bool(BACKTICK.search(rest_of_line))
            if not own and (has_other_backtick or not any(anchors_on(nb, full) for _, nb in nbrs)):
                results.append((rel, i + 1, target, n, "NO-ANCHOR", "", full))
                continue
            verdict, hit = "SYMBOL-GONE", 0
            lo, hi = max(1, n - WINDOW), n + WINDOW
            # Test EVERY anchor and let a near hit anywhere win. An earlier
            # version broke on the first symbol it found present in the file,
            # so a citation of `.filter(...)` at :249 lost to a function name
            # 55 chars further along the same cell that is defined at :190 —
            # and a correct citation was reported as drift. The question is
            # "is ANY named symbol near line N", not "is the closest-named one".
            far = None
            search = list(own)
            if not own:
                for off, nb in nbrs:
                    for sym, dist in anchors_on(nb, full):
                        search.append((sym, dist + abs(off) * 100000))
            for sym, _dist in search:
                pat = re.compile(r"\b%s\b" % re.escape(sym))
                where = [j + 1 for j, l in enumerate(tlines) if pat.search(l)]
                if not where:
                    continue
                near = [w for w in where if lo <= w <= hi]
                if near:
                    verdict, hit, far = "OK", n, None
                    break
                cand = min(where, key=lambda w: abs(w - n))
                if far is None or abs(cand - n) < abs(far - n):
                    far = cand
            if far is not None and verdict != "OK":
                verdict, hit = "DRIFTED", far
            results.append((rel, i + 1, target, n, verdict, hit, full))
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="grade one doc instead of the live set")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument(
        "--list-no-anchor",
        action="store_true",
        help="list the citations no symbol anchors (read-only; they are NOT a pass)",
    )
    args = ap.parse_args()

    root = repo_root()

    if args.self_test:
        # Synthetic strings only: a self-test must never touch the tree it
        # polices. Each case feeds grade-like logic a known-bad input.
        tmp = root / "crates/kasirmu-core/src/lib.rs"
        if not tmp.is_file():
            print("SELF-TEST SKIPPED: fixture %s missing" % tmp)
            return 2
        tlines = tmp.read_text(encoding="utf-8", errors="replace").split("\n")
        nline = len(tlines)
        # Find a line that really does name a known symbol, so the OK case is
        # anchored on fact rather than on an assumed line number.
        ok_line, ok_sym = None, None
        for idx, l in enumerate(tlines, 1):
            m = re.search(r"^pub mod ([a-z_][a-z0-9_]+);", l)
            if m:
                ok_line, ok_sym = idx, m.group(1)
                break
        if ok_line is None:
            print("SELF-TEST SKIPPED: no `pub mod NAME;` line to anchor on")
            return 2
        okc = "crates/kasirmu-core/src/lib.rs:%d" % ok_line
        cases = [
            ("`crates/kasirmu-core/src/lib.rs:%d` `%s`" % (ok_line, ok_sym), "OK"),
            ("`crates/kasirmu-core/src/lib.rs:%d` `%s`" % (nline + 50, ok_sym), "DRIFTED"),
            ("`crates/kasirmu-core/src/lib.rs:1` `zz_no_such_symbol_here`", "SYMBOL-GONE"),
            ("`crates/kasirmu-core/src/lib.rs:1`", "NO-ANCHOR"),
            # A keyword-only anchor must NOT be graded: `pub mod` is not a symbol.
            ("`crates/kasirmu-core/src/lib.rs:%d` `pub mod`" % ok_line, "NO-ANCHOR"),
            # A BARE identifier must NOT anchor. This is the false-OK this tool
            # shipped for one run: prose `attestation` appears early in the file,
            # so a citation naming it on a long line graded "OK" against a line
            # that has nothing to do with it. Backticks only.
            ("`crates/kasirmu-core/src/lib.rs:%d` attestation" % (nline + 50), "NO-ANCHOR"),
            # ADJACENT-LINE anchor, the prose shape: the coordinate ends one line
            # and the symbol starts the next. Must grade OK, not NO-ANCHOR.
            ("Replaying a refund (`%s`):\n`%s` is the module that owns it." % (okc, ok_sym), "OK"),
            # ...but a neighbour must never OVERRIDE an own-line symbol: this
            # line carries `ok_sym` for a wrong line, and a neighbour naming a
            # symbol that happens to sit at that line must not rescue it.
            ("`crates/kasirmu-core/src/lib.rs:%d` `%s`\n`%s`"
             % (nline + 50, ok_sym, ok_sym), "DRIFTED"),
        ]
        bad = 0
        for line, want in cases:
            doc = root / "SELFTEST.md"
            doc.write_text(line + "\n", encoding="utf-8")  # `\n` in a case is a real line break
            try:
                got = grade(root, doc)[0][4]
            finally:
                doc.unlink()
            mark = "ok " if got == want else "BAD"
            if got != want:
                bad += 1
            print("  %s want=%-12s got=%-12s  %s" % (mark, want, got, line[:60]))
        print("SELF-TEST %s (%d cases, no tracked file touched)"
              % ("OK" if bad == 0 else "FAILED", len(cases)))
        return 0 if bad == 0 else 1

    docs = [root / args.file] if args.file else live_docs(root)
    counts = {"OK": 0, "DRIFTED": 0, "SYMBOL-GONE": 0, "NO-ANCHOR": 0, "SUPPRESSED": 0}
    findings = []
    for doc in docs:
        if not doc.is_file():
            continue
        for row in grade(root, doc, args.verbose):
            counts[row[4]] = counts.get(row[4], 0) + 1
            if row[4] in ("DRIFTED", "SYMBOL-GONE"):
                findings.append(row)
            if args.list_no_anchor and row[4] == "NO-ANCHOR":
                findings.append(row)

    graded = counts["OK"] + counts["DRIFTED"] + counts["SYMBOL-GONE"]
    print("check-cite-lines: %d live doc(s), %d citation(s)"
          % (len(docs), sum(counts.values())))
    print("  graded      : %d" % graded)
    print("    OK        : %d" % counts["OK"])
    print("    DRIFTED   : %d   <- right file, wrong line" % counts["DRIFTED"])
    print("    SYMBOL-GONE: %d" % counts["SYMBOL-GONE"])
    # TWO DIFFERENT THINGS, and summing them was a reporting error measured 2026-10-25
    # (round 183). NO-ANCHOR is a GAP: the doc line names no backticked symbol, so this
    # tool cannot grade it and a reader should treat the number as a floor. SUPPRESSED is
    # a DECISION: the author wrote `dead-ref: ok:` on the line (or the one above), so the
    # citation is deliberately historical and needs no grading. Adding them printed 72 as
    # though all of it were ungraded, and --list-no-anchor could then never list the
    # suppressed half, because the loop only appends NO-ANCHOR rows. A reader trying to
    # work through the gap was handed a number it could not enumerate.
    print("  NOT graded  : %d  (no symbol on the doc line; not a pass)"
          % counts["NO-ANCHOR"])
    print("  suppressed  : %d  (explicit `dead-ref: ok:` -- a decision, not a gap)"
          % counts["SUPPRESSED"])

    if findings:
        print("")
        for rel, dl, target, n, verdict, hit, full in findings:
            if verdict == "DRIFTED":
                print("  %s:%d  %s  %s -> actually :%d" % (rel, dl, full, target, hit))
            elif verdict == "NO-ANCHOR":
                print("  %s:%d  %s  no symbol on the doc line" % (rel, dl, full))
            else:
                print("  %s:%d  %s  symbol absent from %s" % (rel, dl, full, target))
        print("")
        if args.list_no_anchor:
            # A listing is a query, not a verdict: NO-ANCHOR rows are not failures.
            print("LISTED %d citation(s); NO-ANCHOR is a gap, not a pass."
                  % len(findings))
            return 0
        print("DRIFT: re-derive with grep -n '\\bfn <name>\\b' <file>, or add")
        print("`dead-ref: ok:` when the citation is deliberately historical.")
        return 1
    print("")
    print("OK: no graded citation is on the wrong line.")
    print("    UNGRADED: %d citation(s) name no backticked symbol and cannot be"
          % counts["NO-ANCHOR"])
    print("    checked by this tool. Read this as a floor, not a certificate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
