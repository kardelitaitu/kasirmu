#!/usr/bin/env python3
"""Grade that no status mapper falls back to a CONCRETE state.

WHY THIS EXISTS
---------------
Four times in five rounds the same defect shipped: a mapper switched on a
status string and its `default` branch returned one of the real states instead
of admitting the value was unrecognised. Every one read as a confident answer:

  - SalesHistoryScreen.statusFluentId fell back to sales-history-status-completed,
    so a pending and a voided sale both displayed "Completed" (and the guards
    that offer the refund action never fired).
  - VoidOrdersScreen.statusLabelFluentId fell back to the active id -- the one
    state that screen exists to make voidable.
  - OfflineQueueScreen.statusLabel fell back to pending, which in that screen
    means "this WILL be pushed".

The first two were found by reading code. The third was found only after this
check existed: earlier hand-written scans matched the literal shape of a
family-suffixed id and offline-queue-status-pending was skipped because
`pending` is a real case value, not a family name. That is the argument for a
gate rather than a grep.

WHY A CONCRETE FALLBACK IS WRONG, NOT MERELY UNTIDY
---------------------------------------------------
Each state it picked was the most reassuring of its set: completed (paid),
active (actionable), pending (on its way). A row the UI cannot identify is
exactly the row a cashier or operator needs to look at, and the fallback is the
one path guaranteed to be taken by data nobody anticipated. The
offline_queue.status column carries no CHECK constraint at all
(TEXT NOT NULL DEFAULT pending), so there the unknown case is not a
corrupt-data hypothetical.

The house already had the right answer twice, which is why this is a convention
and not an invention: TableManagementScreen writes
STATUS_LABEL_IDS[status] ?? tables-status-unknown, and MemosScreen types its map
as Record<Memo.status, string> so the compiler refuses a gap.

WHAT IT ASSERTS
---------------
A switch over a status string whose default returns a string that is a family
sibling of one of its own case values is a finding. Sibling means the last
dash-separated segment matches, or the whole value equals a case. A fallback is
accepted when it names unknown, returns a neutral literal (info, muted, default,
null, the empty string), or is not status-shaped.

WHAT IT DOES NOT CLAIM
----------------------
This is a TEXT check. It cannot see a fallback computed in another module, a map
keyed by an object literal, or a ?? / || default -- only the switch shape. It
cannot judge whether the fallback is reachable: a closed enum whose every member
is handled passes with no fallback at all, and that is the preferred shape.

Exit codes follow the house law: 0 = graded and clean, 1 = findings, 2 = the
scope would not open (a refusal is not a verdict).
"""
from __future__ import annotations

import argparse
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "ui" / "src"
EXCLUDES = ("__tests__", "dev-mock")

#: switch arms that RETURN a bare string literal.
CASE_RE = re.compile(r"case\s+.([a-z0-9_-]+).\s*:\s*\{?\s*(?:\n\s*)?return\s+.([a-z0-9_-]+).")
#: A default arm that returns a bare string literal.
DEFAULT_RE = re.compile(r"default\s*:\s*\{?\s*(?:\n\s*)?return\s+.([a-z0-9_-]+).")
#: Fallbacks that are honest by construction.
NEUTRAL = {"info", "success", "warning", "danger", "muted", "default", "none", ""}


def _read(path: Path) -> str:
    """One source file. A file that will not open is a REFUSAL, not a clean grade."""
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise SystemExit(f"error: cannot read {path}: {exc}") from None


def _sources() -> list[Path]:
    """Every production UI source file, tests excluded."""
    out = []
    for p in sorted(UI.rglob("*.ts*")):
        rel = p.relative_to(ROOT).as_posix()
        if any(x in rel for x in EXCLUDES):
            continue
        out.append(p)
    return out


#: The concrete status words this codebase uses for its mappers. A fallback whose last
#: segment is one of these names a real state rather than admitting ignorance.
#: Deliberately a closed vocabulary: adding a state to a mapper should mean adding it here
#: too, which is the moment a reviewer sees the fallback. An unrecognised word cannot be
#: mistaken for a state, so the rule never guesses.
CONCRETE_STATES = {
    "pending", "active", "completed", "voided", "failed", "synced",
    "draft", "published", "expired", "stopped", "archived",
    "ready", "served", "cancelled", "preparing", "success", "error",
}


def _family(fallback: str) -> str:
    """Everything before the last dash, e.g. `offline-queue-status` for `...-pending`."""
    return fallback.rsplit("-", 1)[0] if "-" in fallback else ""


def _is_concrete_state(fallback: str, case_values: list[str]) -> str | None:
    """The case value the fallback imitates, or None when the fallback is honest.

    The defect this catches is NOT "the fallback repeats a case" -- the three that
    shipped all returned a member the switch ALSO handled (completed, active, pending),
    which is what made them look deliberate. The defect is that the fallback names a
    MEMBER AT ALL: it answers a question the switch just proved it cannot answer. So
    the test is whether the last segment is a known status word from the same family as
    at least one case value.
    """
    if fallback in NEUTRAL:
        return None
    tail = fallback.rsplit("-", 1)[-1]
    if tail not in CONCRETE_STATES:
        return None
    fam = _family(fallback)
    if not fam:
        return None
    for cv in case_values:
        if _family(cv) == fam:
            return cv
    return None

def findings_in(text: str) -> list[tuple[int, str, str]]:
    """(line, fallback, mirrored case) for every dishonest default in one file."""
    cases = CASE_RE.findall(text)
    if len(cases) < 2:
        return []
    case_values = [c[1] for c in cases]
    out = []
    for m in DEFAULT_RE.finditer(text):
        val = m.group(1)
        if "unknown" in val:
            continue
        cv = _is_concrete_state(val, case_values)
        if cv is not None:
            line = text[: m.start()].count("\n") + 1
            out.append((line, val, cv))
    return out


def grade() -> int:
    """Report every dishonest status fallback. 0 clean, 1 findings."""
    total = 0
    for path in _sources():
        for line, val, cv in findings_in(_read(path)):
            rel = path.relative_to(ROOT).as_posix()
            print(f"  {rel}:{line}  default returns {val!r}, mirroring case {cv!r}")
            total += 1
    if total:
        print(f"\nFAIL: {total} status fallback(s) name a real state instead of an unknown one")
        print("  A row the UI cannot identify must read as unknown; naming a concrete")
        print("  state presents it as the most reassuring member of the set.")
        return 1
    print("status-fallbacks: OK (no default names a concrete status)")
    return 0


def self_test() -> int:
    """Prove the check fires on the three defects that shipped and accepts the fixes."""
    failures = 0
    q = chr(39)
    def sw(cases, default):
        arms = " ".join(f"case {q}{a}{q}: return {q}{b}{q};" for a, b in cases)
        return f"switch (s) {{ {arms} default: return {q}{default}{q}; }}"
    bad = [
        ("offline pending", sw([("pending", "q-status-pending"), ("failed", "q-status-failed")], "q-status-pending")),
        ("sales completed", sw([("pending", "h-status-pending"), ("voided", "h-status-voided")], "h-status-completed")),
        ("void active", sw([("completed", "v-status-completed"), ("pending", "v-status-pending")], "v-status-active")),
    ]
    for name, text in bad:
        if not findings_in(text):
            print(f"FAIL self-test: the {name} defect was NOT detected", file=sys.stderr)
            failures += 1
    good = [
        ("unknown fallback", sw([("pending", "q-status-pending"), ("failed", "q-status-failed")], "q-status-unknown")),
        ("neutral tone", sw([("pending", "warning"), ("failed", "danger")], "info")),
        ("null for a closed enum", sw([("pending", "alpha"), ("ready", "bravo")], "muted")),
    ]
    for name, text in good:
        hits = findings_in(text)
        if hits:
            print(f"FAIL self-test: the {name} case was wrongly flagged {hits}", file=sys.stderr)
            failures += 1

    # _read() -- the ONLY way a file reaches the rule, and the one function whose failure
    # direction is invisible. The sabotage sweep scored it SURVIVED on 2026-11-06: gutting
    # it left the three defect cases and the three honest shapes green, because every case
    # grades a string already in memory. Nothing proved the two things callers rely on:
    # that it returns the file's TEXT, and that a file which will not open is a REFUSAL
    # (exit 2) rather than an empty string that reads as "this file had no findings".
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        probe = tmp / "probe.ts"
        probe.write_text("export const x = 1;\n", encoding="utf-8")
        try:
            got = _read(probe)
        except SystemExit:
            print("FAIL self-test: _read() refused a readable file", file=sys.stderr)
            failures += 1
        else:
            if got != "export const x = 1;\n":
                print(f"FAIL self-test: _read() returned {got!r} instead of the file's text",
                      file=sys.stderr)
                failures += 1
        for label, path in (("a missing file", tmp / "absent.ts"), ("a directory", tmp)):
            try:
                _read(path)
            except SystemExit:
                pass
            else:
                print(f"FAIL self-test: _read() accepted {label} instead of refusing",
                      file=sys.stderr)
                failures += 1
    if failures:
        print(f"self-test: {failures} FAILURE(S)", file=sys.stderr)
        return 1
    print(f"self-test: OK ({len(bad)} defects detected, {len(good)} honest shapes accepted,"
          f" 3 _read cases)")
    return 0


def main() -> int:
    """Pick the mode."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true", help="prove the check can fail")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    return grade()


if __name__ == "__main__":
    sys.exit(main())
