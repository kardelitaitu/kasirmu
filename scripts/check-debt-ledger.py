#!/usr/bin/env python3
"""Cross-check todo-optimize-crates.md against commits that claim to close entries.

WHY THIS EXISTS
---------------
The journal is the source of truth for what debt is still open, and five entries have been
caught ranked as open work after they were already fixed:

    O-H23, O-H24, O-H26   fixed 2026-09-27 by other lanes, never marked
    O-H03, O-H04, O-H08   said "Fixed:" in their own text, still counted as open
    O-H22                 committed as 49a304b97 with no section at all

Two more failure modes were found in the same pass and are graded here too:

    a section DELETED by a later edit   (49a304b97 removed 11Z body, leaving a bare ---)
    a section with no matching entry    (a typo would otherwise read as a close)

THE RULE
--------
A commit whose subject names an entry AND uses a closing verb must correspond to a
"## 11<letters>" section naming that entry. A commit that merely touches or discusses an
entry does not have to. The verb list is deliberately narrow: resolve / fix / close / finish.

This is a LEDGER check, not a correctness check. It cannot tell whether the code change was
good; only whether the journal noticed a commit claiming to close something.

EXIT CODES
    0  every closing commit has its section; every section names a defined entry
    1  at least one mismatch (printed with the action needed)
    2  the checker's own cases failed -- do not trust the report below

WHY THERE IS A SELF-TEST
------------------------
Every false positive this script has had is recorded inline as a comment above the rule
that fixed it, and every one of those rules is a predicate over a string. A predicate can
be edited back into its wrong form by someone tidying, or simply stop matching, and the
gate keeps printing OK. The cases below pin the exact shapes that once fooled it:

  * "still open" / "remain" veto      -- a status report is not a resolution
  * "fixed-size batches" in a body    -- a fix DESCRIPTION is not a fix RECORD
  * INLINE_CLOSE_RE case sensitivity  -- lowercase "fixed" alone must not close an entry
  * the two section-heading shapes    -- "## 11XX" AND the older "## 11. Round 6"
  * a bare filename beside its dir    -- a ref relative to the full path cited with it

Run from the repo root:  python scripts/check-debt-ledger.py
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LEDGER = REPO / "todo-optimize-crates.md"

ID_RE = re.compile(r"\bO-[HMLT]\d+\b")
CLOSING_VERBS = ("resolve", "fix", "close", "finish")
# Two heading shapes have carried a resolution in this journal, and both are honoured:
#   "## <sect>11XX -- O-XXX resolved: ..."   the numbered-sect convention
#   "## 11. Round 6 (...) -- O-T05 executed" the older round convention
# The second is what O-T05 shipped under. A checker that knew only the first reported a
# real, documented close as a gap -- the same false positive this script exists to avoid,
# just in the other direction.
SECTION_RE = re.compile(r"^## (?:\u00a711[A-Z]*|11\.)\s.*$", re.MULTILINE)


def git(*args: str) -> str:
    """Run a git command from the repo root and return stdout (empty on failure)."""
    out = subprocess.run(
        ["git", *args],
        cwd=REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return out.stdout if out.returncode == 0 else ""


def defined_entries(text: str) -> set[str]:
    """Every id that has an entry header in the journal."""
    return {
        m.group(1)
        for line in text.splitlines()
        for m in [re.match(r"^\*\*?(O-[HMLT]\d+)", line)]
        if m
    }


def sections(text: str) -> list[tuple[str, str]]:
    """Split the journal into (heading, body) pairs for every numbered section."""
    matches = list(SECTION_RE.finditer(text))
    out = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        out.append((m.group(0), text[m.end():end]))
    return out


# Words that UNDO a closing claim. "recount after thirteen closes, leaving only O-H12 and O-H17
# open at High" names two entries and contains "closes", but the ids it names are the ones that
# are STILL OPEN -- it is a status report, not a resolution. Without this veto the gate demanded
# a section for both, which is the noisy direction: a false positive here teaches a reader to
# ignore the gate, which is worse than the gap it closes.
NOT_CLOSING = ("open", "remain", "remaining", "still", "not closed", "re-anchor",
               "defer", "todo", "backlog")


def is_closing_subject(subject: str) -> bool:
    """True when a commit subject names an entry AND claims to close it.

    The verb must be present AND no not-closing word may be, because a subject that
    names ids while saying they "remain open" is a status report. Both halves are
    needed: `resolve O-H01` closes; `recount, leaving O-H12 open` does not.
    """
    lowered = subject.lower()
    if not ID_RE.search(subject):
        return False
    if not any(v in lowered for v in CLOSING_VERBS):
        return False
    return not any(w in lowered for w in NOT_CLOSING)


# A resolved entry may be marked TWO ways in this journal, and both are legitimate:
#   (a) a "## <sect> -- O-XXX resolved: ..." section, the original convention;
#   (b) an inline marker in the entry body: "PAID", "resolved", "Fixed:" ...
# Convention (b) appeared later and is what O-H03/O-H04/O-H08 used. A checker that
# only knew (a) would flag those three as gaps forever, and one that only knew (b)
# would miss a commit whose section was never written. Both are read here.
# A bare \b word is NOT evidence: O-H02's own text says "chunk the image lookup into
# fixed-size batches", and that matched \bFIXED\b and marked a live entry closed. The
# markers that actually appear in this journal are either uppercase (PAID, MOOT,
# RESOLVED, FIXED, DONE) or the literal "Fixed:" form that O-H03/O-H04/O-H08 used.
# Matching them CASE-SENSITIVELY, and requiring the colon for the lowercase form, is
# what keeps a fix DESCRIPTION from reading as a fix RECORD.
INLINE_CLOSE_RE = re.compile(r"\b(PAID|RESOLVED|FIXED|DONE|MOOT)\b|[Ff]ixed:")


def entries_marked_inline(text: str) -> set[str]:
    """Ids whose own entry body carries a close marker within its first few lines."""
    out: set[str] = set()
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = re.match(r"^\*\*?(O-[HMLT]\d+)", line)
        if not m:
            continue
        body = "\n".join(lines[i:i + 8])
        if INLINE_CLOSE_RE.search(body):
            out.add(m.group(1))
    return out


FILE_REF_RE = re.compile(r"`([A-Za-z0-9_./-]+\.(?:rs|ts|tsx|sql|go|ftl))(?::[0-9][0-9-]*)?"+"`")


def entries_with_dead_file_refs(text: str) -> list[tuple[str, list[str]]]:
    """Entries whose FIRST citation names a file that no longer exists.

    This class is why the gate was extended: three entries were caught by hand on
    2026-10-21 pointing at files deleted weeks earlier (O-M57/O-M58 at syslog.rs and
    eventlog.rs, O-H25 at modules/reporting/src/repository.rs). A dead path is not a
    style nit -- it means the entry can no longer be acted on as written, and a
    reader who trusts it wastes the pass.

    Only the first TWO citations are graded, and only entries NOT already marked
    closed: a resolved entry legitimately cites the file its fix created (O-H09
    names plan_cache.rs, O-H11 names pg/sales.rs), and a long entry often cites many
    files of which some are historical. The first citation of an OPEN entry is the
    one a worker would open first.
    """
    closed = entries_marked_inline(text)
    for heading, _body in sections(text):
        closed |= set(ID_RE.findall(heading))

    bad: list[tuple[str, list[str]]] = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = re.match(r"^\*\*?(O-[HMLT]\d+)", line)
        if not m:
            continue
        entry = m.group(1)
        if entry in closed:
            continue
        chunk = "\n".join(lines[i:i + 4])
        refs = FILE_REF_RE.findall(chunk)[:2]
        if not refs:
            continue
        # Only flag when EVERY graded ref is missing: one surviving path means the
        # entry is still anchored somewhere a reader can reach.
        # A bare filename is relative to the full path cited beside it.
        dirs = [str((REPO / r).parent.relative_to(REPO)) for r in refs if "/" in r]
        missing = []
        for r in refs:
            if (REPO / r).exists():
                continue
            if "/" not in r and any((REPO / d / r).exists() for d in dirs):
                continue
            missing.append(r)
        if missing and len(missing) == len(refs):
            bad.append((entry, missing))
    return bad


#: Commit subjects: (subject, should_read_as_closing). These are the strings that have
#: actually appeared in this repo's log, plus the neighbours each rule must not swallow.
SUBJECT_CASES = (
    # --- closes ---
    ("fix(core): resolve O-H23 stale receipt pointer", True),
    ("chore(journal): close O-M57 and O-M58", True),
    ("refactor(db): finished O-T05 cache-rebuild", True),
    # --- does NOT close, and each line names the rule it pins ---
    # The NOT_CLOSING veto: this subject names O-H12 and O-H17, which are the ones
    # STILL OPEN. Without the veto the gate demanded a section for both and taught
    # a reader to ignore it.
    ("chore(journal): recount after thirteen closes, leaving only O-H12 open", False),
    ("docs(journal): O-H12 remains open pending an owner ruling", False),
    ("chore(journal): defer O-H17 to the backlog", False),
    # No id at all, and no closing verb at all -- the two cheap negatives.
    ("fix(core): resolve the stale receipt pointer", False),
    ("chore(journal): touch up O-H23 wording", False),
)


#: Journal bodies: (name, entry header line + body, should the marker close it).
INLINE_CASES = (
    # The uppercase markers, and the lowercase "Fixed:" form O-H03/O-H04/O-H08 used.
    ("**O-H03 received-amount rounding**\nFixed: by the Minor units pass.", True),
    ("**O-H04 stock recount**\nPAID. See the section below.", True),
    ("**O-H09 plan cache**\nRESOLVED: the cache is keyed per store.", True),
    # The false positive: O-H02's own text says "chunk the image lookup into fixed-size
    # batches". A \bFIXED\b match with re.IGNORECASE read that as a fix RECORD and
    # marked a live entry closed.
    ("**O-H02 image lookup**\nChunk the image lookup into fixed-size batches.", False),
    # Lowercase "fixed" without the colon is a description, not a record.
    ("**O-H02 image lookup**\nThis was fixed upstream, we only track it.", False),
)


#: Section headings: (heading, should_be_recognised_as_a_section).
SECTION_CASES = (
    # The numbered-sect convention.
    ("## \u00a711XX -- O-H23 resolved: stale receipt pointer", True),
    # The older round convention, which is what O-T05 shipped under. A checker that
    # knew only the first form reported a real, documented close as a gap.
    ("## 11. Round 6 (2026-10-21) -- O-T05 executed", True),
    # Not a section: these are entry headers and prose headings.
    ("### 11XX nested, not a top-level section", False),
    ("## Debt ledger -- open items", False),
)


def self_test() -> int:
    """Run the rule cases; report EVERY failure rather than stopping at the first."""
    bad: list[str] = []
    for subject, expected in SUBJECT_CASES:
        got = is_closing_subject(subject)
        if got != expected:
            bad.append("  subject %r: expected closing=%s, got %s" % (subject, expected, got))
    for body, expected in INLINE_CASES:
        got = bool(INLINE_CLOSE_RE.search(body))
        if got != expected:
            bad.append("  inline %r: expected marked=%s, got %s"
                       % (body.splitlines()[0], expected, got))
    for heading, expected in SECTION_CASES:
        got = bool(SECTION_RE.match(heading))
        if got != expected:
            bad.append("  heading %r: expected section=%s, got %s" % (heading, expected, got))
    # A section split is a SET operation, which is the shape that once reported "sets
    # agree" over two empty sets. Pin that the split actually produces one section.
    split = sections(SECTION_CASES[0][0] + "\nbody text here\n")
    if len(split) != 1:
        bad.append("  sections(): expected 1 split for a single heading, got %d" % len(split))
    # The SUMMARY TABLE, which nothing verified until 2026-10-23 (it drifted 22 entries
    # with every gate green). A miniature journal with a known correct table, then the
    # two shapes that rot: a wrong total, and a row carried forward from an older file.
    fixture = "\n".join([
        "| Tier | Defined | Marked closed | Still open |",
        "|---|---|---|---|",
        "| **High** | 1 | **1** | **0** |",
        "| Medium | 1 | **1** | **0** |",
        "| Low | 0 | 0 | **0** |",
        "| Test (O-T) | 0 | 0 | **0** |",
        "| **Total** | **2** | **2** | **0** |",
        "",
        "**O-H01 thing**",
        "PAID.",
        "",
        "**O-M01 other**",
        "DONE.",
    ])
    if table_findings(fixture):
        bad.append("a correct summary table must produce no finding, got %r"
                   % (table_findings(fixture),))
    if not any("Total" in f for f in table_findings(fixture.replace("**2** | **2**", "**9** | **9**"))):
        bad.append("a wrong Total must be a finding")
    if not any("Medium" in f for f in table_findings(fixture.replace(
            "| Medium | 1 | **1** |", "| Medium | 7 | **7** |"))):
        bad.append("a row that disagrees with the entries must be a finding")
    if not any("missing" in f for f in table_findings(fixture.replace(
            "| **High** | 1 | **1** | **0** |\n", ""))):
        bad.append("a missing tier row must be a finding")

    # THE DEAD-REF RULE, which no case reached before 2026-10-24. Its docstring records
    # why it exists: three entries were caught by hand on 2026-10-21 pointing at files
    # deleted weeks earlier, so an entry that cannot be opened wastes a reader's pass.
    # Blanking entries_with_dead_file_refs left this self-test green.
    #
    # Three arms, each a way the obvious implementation is wrong: only the FIRST TWO
    # citations are graded; CLOSED entries are exempt (a resolved entry legitimately
    # cites the file its fix created); and an entry is flagged only when EVERY graded
    # ref is missing -- one surviving path keeps it anchored.
    # Paths are BACKTICKED, per FILE_REF_RE at :154 -- the first draft of this fixture
    # wrote them bare and every case passed vacuously, because a regex that matches
    # nothing finds no refs and "no refs" skips the entry. A self-test whose fixture
    # cannot reach the rule is the failure mode this whole file is about.
    dead_fixture = "\n".join([
        "**O-H01 dead entry**",
        "See `crates/ghost-does-not-exist/src/lib.rs` for the whole story.",
        "",
        "**O-H02 live entry**",
        "See `crates/kasirmu-core/src/lib.rs` for the whole story.",
        "",
        "**O-H03 mixed refs, one survives**",
        "See `crates/ghost-does-not-exist/src/lib.rs` and",
        "`crates/kasirmu-core/src/lib.rs` together.",
        "",
        "**O-H04 closed but dead**",
        "PAID against `crates/ghost-does-not-exist/src/lib.rs`.",
        "",
        "**O-H05 dead third ref**",
        "See `crates/kasirmu-core/src/lib.rs`, `Cargo.toml`, and",
        "`crates/ghost-does-not-exist/src/lib.rs`.",
    ])
    dead_hits = {entry for entry, _refs in entries_with_dead_file_refs(dead_fixture)}
    for label, entry, expect in (
        ("an entry whose first ref is dead is flagged", "O-H01", True),
        ("a live first ref is not flagged", "O-H02", False),
        ("one surviving ref keeps the entry anchored", "O-H03", False),
        ("a closed entry is exempt even when its ref is dead", "O-H04", False),
        ("a dead THIRD ref is out of scope", "O-H05", False),
    ):
        if (entry in dead_hits) is not expect:
            bad.append("  dead-ref %s: %s flagged=%s" % (label, entry, entry in dead_hits))
    if entries_with_dead_file_refs("**O-H06 bare**\nnothing cited here\n"):
        bad.append("  dead-ref: an entry citing nothing must not be flagged")

    # The git plumbing -- every ledger number flows out of it, so a gutted wrapper
    # must turn the self-test red. Graded against a throwaway repo; REPO is patched
    # for the duration and restored in finally.
    global REPO
    import shutil as _shutil
    import tempfile
    extra = 0
    if _shutil.which("git"):
        with tempfile.TemporaryDirectory() as td:
            g = Path(td)
            subprocess.run(["git", "init", "-q"], cwd=g, capture_output=True)
            _saved_repo = REPO
            try:
                REPO = g
                extra += 1
                top = (git("rev-parse", "--show-toplevel") or "").strip()
                if Path(top).resolve() != g.resolve():
                    bad.append("  git rev-parse: expected the throwaway repo, got %r" % (top,))
                extra += 1
                if git("status", "--porcelain") != "":
                    bad.append("  git status in a clean repo: expected empty stdout")
                extra += 1
                if git("definitely-not-a-git-command") != "":
                    bad.append("  a failing git command must return empty stdout")
            finally:
                REPO = _saved_repo
    else:
        print("  (git unavailable: the plumbing cases are skipped)")

    if bad:
        sys.stderr.write("SELF-TEST WRONG:\n" + "\n".join(bad) + "\n")
        return 2
    # +1 for the sections() split case, +4 for the summary-table cases, +6 for the
    # dead-ref rule. Counted explicitly because a case that runs but is not counted
    # reads as coverage it is not -- the same shape as a gate that cannot fail.
    print("SELF-TEST OK (%d cases, no file read)"
          % (len(SUBJECT_CASES) + len(INLINE_CASES) + len(SECTION_CASES) + 1 + 4 + 6 + extra))
    return 0


#: The summary table's tier rows, and the tier letter each one counts.
TABLE_ROWS = (
    ("High", "H"),
    ("Medium", "M"),
    ("Low", "L"),
    ("Test", "T"),
)


def table_findings(text: str) -> list[str]:
    """The summary table must agree with the entries the file actually contains.

    It did not, for 22 entries. The table read 143/76/24 while the file held 165, and
    nothing noticed because NO checker read the table at all -- this gate verified
    closing commits against sections, and sections against entry headers, but the one
    piece of the journal a reader sees FIRST was unverified prose. Measured 2026-10-23
    by rewriting the total to "999 defined, 999 closed, 7 open": every gate stayed green.

    The numbers are recomputed from the SAME functions the checks above use
    (`defined_entries` and `entries_marked_inline` plus the section headings), so the
    table cannot agree with the gate by coincidence -- it agrees by construction or not
    at all.
    """
    defined = defined_entries(text)
    closed = entries_marked_inline(text)
    for heading, _body in sections(text):
        closed |= set(ID_RE.findall(heading))

    counts: dict[str, list[int]] = {tier: [0, 0] for _label, tier in TABLE_ROWS}
    for entry in defined:
        tier = entry.split("-")[1][0]
        if tier not in counts:
            continue
        counts[tier][0] += 1
        if entry in closed:
            counts[tier][1] += 1

    out: list[str] = []
    for label, tier in TABLE_ROWS:
        want_d, want_c = counts[tier]
        row = re.search(
            r"^\|\s*\*{0,2}" + re.escape(label) + r"[^|]*\|\s*\*{0,2}(\d+)\*{0,2}\s*\|"
            r"\s*\*{0,2}(\d+)\*{0,2}\s*\|",
            text, re.M)
        if not row:
            out.append("the %s row is missing from the summary table" % label)
            continue
        got_d, got_c = int(row.group(1)), int(row.group(2))
        if (got_d, got_c) != (want_d, want_c):
            out.append("%s row says %d defined / %d closed; the file holds %d / %d"
                       % (label, got_d, got_c, want_d, want_c))

    want_total_d = sum(c[0] for c in counts.values())
    want_total_c = sum(c[1] for c in counts.values())
    total = re.search(
        r"^\|\s*\*{0,2}Total\*{0,2}\s*\|\s*\*{0,2}(\d+)\*{0,2}\s*\|"
        r"\s*\*{0,2}(\d+)\*{0,2}\s*\|", text, re.M)
    if not total:
        out.append("the Total row is missing from the summary table")
    else:
        got_d, got_c = int(total.group(1)), int(total.group(2))
        if (got_d, got_c) != (want_total_d, want_total_c):
            out.append("Total row says %d defined / %d closed; the file holds %d / %d"
                       % (got_d, got_c, want_total_d, want_total_c))
    return out


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()
    # Grade the four predicates BEFORE grading the journal. Each of them has been wrong
    # once already; a rule that stops matching reports a clean ledger over a dead scan.
    rc = self_test()
    if rc:
        sys.stderr.write("RULES WENT DEAF: not trusting the ledger report below.\n")
        return rc

    try:
        text = LEDGER.read_text(encoding="utf-8")
    except FileNotFoundError:
        print("check-debt-ledger: todo-optimize-crates.md not found")
        return 1

    defined = defined_entries(text)
    heads = sections(text)
    inline_marked = entries_marked_inline(text)

    # Check 1: a closing commit must have its section.
    log = git("log", "--format=%h\x01%s", "-n", "4000")
    missing: dict[str, list[str]] = {}
    for line in log.splitlines():
        if "\x01" not in line:
            continue
        sha, subject = line.split("\x01", 1)
        if not is_closing_subject(subject):
            continue
        for entry in set(ID_RE.findall(subject)):
            if entry in inline_marked:
                continue
            if not any(entry in heading for heading, _ in heads):
                missing.setdefault(entry, []).append(sha + " " + subject)

    # Check 2: every section should name a defined entry.
    unknown: list[tuple[str, str]] = []
    for heading, _body in heads:
        ids = set(ID_RE.findall(heading))
        if not ids:
            unknown.append((heading, "names no entry id at all"))
        for entry in sorted(ids - defined):
            unknown.append((heading, "names " + entry + ", which has no entry header"))

    # Check 3: effectively-empty bodies (the deletion shape).
    gutted = [
        (heading, body)
        for heading, body in heads
        if len(re.sub(r"[-\s]", "", body)) < 40
    ]

    # Check 4: an open entry whose graded citations all point at deleted files.
    dead_refs = entries_with_dead_file_refs(text)

    # Check 5: the summary table agrees with the file. Nothing read it before, so it
    # drifted 22 entries behind while every gate stayed green.
    table_bad = table_findings(text)

    ok = True

    if table_bad:
        ok = False
        print("FAIL: " + str(len(table_bad)) + " summary-table row(s) disagree with the file:")
        for line in table_bad:
            print("  " + line)
        print("  -> recompute the table from the entries; do not carry the numbers forward.")

    if dead_refs:
        ok = False
        print("FAIL: " + str(len(dead_refs)) + " open entr(y/ies) cite file(s) that no longer exist:")
        for entry, refs in sorted(dead_refs):
            print("  " + entry + " -> " + ", ".join(refs))
        print("  -> re-anchor to the current path, or mark the entry MOOT if the target was deleted.")

    if missing:
        ok = False
        print("FAIL: " + str(len(missing)) + " entr(y/ies) closed by a commit with no section:")
        for entry, commits in sorted(missing.items()):
            print("  " + entry)
            for c in commits[:3]:
                print("      " + c)
        print("  -> add a section naming it, or the entry keeps reading as open.")

    if unknown:
        ok = False
        print("")
        print("FAIL: " + str(len(unknown)) + " section problem(s):")
        for heading, why in unknown:
            print("  " + heading[:70])
            print("      " + why)

    if gutted:
        ok = False
        print("")
        print("FAIL: " + str(len(gutted)) + " section(s) with an effectively empty body:")
        for heading, body in gutted:
            print("  " + heading[:70])
            print("      body is " + str(len(body.strip())) + " chars")

    if ok:
        print("check-debt-ledger: OK - " + str(len(defined)) + " entries defined, "
              + str(len(heads)) + " sections, every closing commit has its section.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
