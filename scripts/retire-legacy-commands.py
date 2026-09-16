#!/usr/bin/env python3
"""Retire one shell module's unreachable legacy commands, evidence first.

Built on 2026-09-16 after the first four T19 batches were done by hand-typed line ranges
and prose substitution. Two of those attempts broke the build in ways a compiler-only check
caught late: one batch's replacement strings were missing their `///` prefix, which turned
eight doc comments into bare prose and made the parser swallow the attributes below them
(the resulting `E0433: cannot find __cmd__*_scoped` flood named the victims, not the
cause), and the mechanical replacement that was meant to fix that derived 0 of 8 doc texts
because of a nested-loop `$Matches` clobber in PowerShell. So the logic lives here, in a
language with real regexes, and it uses the parity gate's own extractors rather than a
second implementation of the same questions -- the single-source-of-truth rule T13 filed.

What it refuses to do:

* It defaults to a dry run. Nothing is written without `--apply`.
* It refuses a file that is dirty in another lane, because the ranges it computes would be
  grading a tree that is not the one it read.
* It deletes only what the leg agrees is unreachable: not registered in this shell, not
  named by any UI code, and not called by any production code in this crate. It does NOT
  decide about ledger rows, tests, or dev-mock handlers -- it reports them and stops short
  of deleting them, because a test that references a dying fn is a decision, not a detail.

One limitation, because a tool that quietly cannot do something is worse: the prose audit
below runs only when there is something to retire, so `--module customers` after the
customers batch reports "nothing to retire" and says nothing about prose. It is a batch
tool, not a stale-document scanner -- checking a whole tree for comments that name
functions which no longer exist is a different question (which names to look for?) and
belongs to a gate, not here.

Every span is located by scanning back over attributes and doc comments from the function's
own signature line, and forward to the first column-zero `}`. That is a shape, not a line
number: line numbers move under concurrent commits, which is the reason this repo's own
records avoid quoting them.
"""

from __future__ import annotations

import argparse
import importlib.util
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent


def load_leg():
    """Import verify-ipc-parity.py as a module, so one parser answers every question."""
    spec = importlib.util.spec_from_file_location("vip", REPO / "scripts/verify-ipc-parity.py")
    vip = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(vip)
    return vip


def git_dirty(path: pathlib.Path) -> str:
    out = subprocess.run(
        ["git", "status", "--porcelain", "--", path.relative_to(REPO).as_posix()],
        capture_output=True, text=True, cwd=REPO, check=False,
    )
    return out.stdout.strip()


def signature_index(lines: list[str], name: str) -> int | None:
    """The single line defining `name`, or None if that is not exactly one line."""
    pat = re.compile(r"^\s*pub (?:async )?fn " + re.escape(name) + r"\b")
    hits = [i for i, line in enumerate(lines) if pat.match(line)]
    return hits[0] if len(hits) == 1 else None


PROSE_LINE = re.compile(r"^\s*(?://[/*]?|\*)")


def prose_flags(lines: list[str]) -> list[bool]:
    """Which lines are commentary, including the interiors of `/* … */` blocks.

    The apps carry docs-auditor stamps written as a C-style block at the top of a command
    module ("last audited … findings: staff IPC surface fail-closed … legacy unscoped
    commands (list_staff/create_staff/update_staff/list_roles) are permission-denied
    tombstones"). A line-based prefix test sees `findings: …` as CODE, which put that stamp
    on the path-mention gate as if it were a function pointer, and -- worse -- would hide a
    retired command named inside a stamp from the stale-prose report entirely. Both halves
    are fixed here: inside a block comment, prose; outside it, the prefix rules.
    """
    flags: list[bool] = []
    inside = False
    for line in lines:
        pre = inside
        if PROSE_LINE.match(line):
            flags.append(True)
        else:
            flags.append(pre)
        # Track only unambiguous openers/closers; a `///` line never opens a block.
        if not pre and "/*" in line and "*/" not in line:
            inside = True
        elif inside and "*/" in line:
            inside = False
    return flags


def plan_mentions(name: str) -> list[str]:
    """Lines in the repo's work-order files that name `name` -- the decision gate.

    A test reference is not the only reason a dead command is owed an argument. On
    2026-09-16 this tool retired the desktop's `create_exchange_rate` inside a batch, and
    the only thing standing in its way was that no desktop test happened to call it: the
    reason to keep it is written in the plan file (T20: ADR #48's global path exists in
    three unreachable copies and the owner has not ruled). A census cannot see a pending
    decision, so the work orders are read as a fourth signal. Top-level `todo-*.md` only --
    the durable records this programme writes its deferrals into.
    """
    hits: list[str] = []
    for path in sorted(REPO.glob("todo-*.md")):  # REPO, the module constant; `vip` is a local import
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        # A plan file writes command names in backticks (`create_exchange_rate`), and a
        # dotted form (repo.create_exchange_rate) is the *repository* method, not the
        # command, so allow the backtick and reject the dot and the path separator. The
        # first version of this pattern excluded backticks, which made the whole gate
        # match nothing in the only file it reads -- a refusal that never refuses.
        pat = re.compile(r"(?<![\w:.])" + re.escape(name) + r"\b(?!_scoped)")
        for number, line in enumerate(text.splitlines(), 1):
            if pat.search(line):
                hits.append(f"{path.name}:{number}")
    return hits


def path_refs(name: str, sources: list[tuple[str, str]]) -> list[str]:
    """Non-call, non-prose mentions of `name` -- the signal `fn_call_sites` cannot see.

    `fn_call_sites` looks for `name(`. A path mention has no parenthesis: a
    `generate_handler!` entry (`commands::hardware::print_sales_receipt,`), a function
    pointer handed to something, a re-export list. Those are the forms that would make an
    "uncalled" verdict wrong, so any survivor is reported and blocks the write -- deciding
    what a bare path means is a human call, not a regex's. Prose is excluded (a comment
    naming a retired fn is reported separately), as is the signature line itself.
    """
    word = re.compile(r"(?<![\w:])" + re.escape(name) + r"\b")
    call = re.compile(re.escape(name) + r"\s*\(")
    hits: list[str] = []
    for label, text in sources:
        body = text.splitlines()
        flags = prose_flags(body)
        for number, line in enumerate(body, 1):
            if flags[number - 1] or re.match(r"^\s*pub (?:async )?fn\b", line):
                continue
            if word.search(line) and not call.search(line):
                hits.append(f"{label}:{number}: {line.strip()[:90]}")
    return hits


def span_of(lines: list[str], sig: int) -> tuple[int, int] | None:
    """(first, last) inclusive: attributes and docs above, body down to column-zero `}`."""
    end = sig
    while end < len(lines) and lines[end].rstrip() != "}":
        end += 1
    if end >= len(lines):
        return None
    start = sig
    k = sig - 1
    while k >= 0 and re.match(r"^\s*(#\[|///|//!|//\s)", lines[k]):
        start, k = k, k - 1
    if end + 1 < len(lines) and lines[end + 1].strip() == "":
        end += 1
    return (start, end)


# Same spelling the retire path counts with: the desktop writes `#[tauri::command]`, the tablet
# imports `command` and writes `#[command]`, and a checker that only knew one of them would
# grade 20 of one shell's declarations and report the rest as gone.
ATTR_RE = re.compile(r"^\s*#\[(?:tauri::)?command\]", re.M)


def verify_on_disk(mod: pathlib.Path, planned: str, spans, attrs_after: int) -> list[str]:
    """Re-read `mod` and report every way it disagrees with the string we meant to write.

    Split out so it can be pointed at a file it was not written for: a check that has only
    ever run against its own success is not known to be able to fail. Passing a real file with
    a bogus expectation must return problems, and that is the control run in the commit
    message's body, not a claim made here.
    """
    back = mod.read_text(encoding="utf-8", newline=None)
    expected = len(planned.splitlines())
    got = len(back.splitlines())
    problems: list[str] = []
    if got != expected:
        problems.append(f"line count on disk is {got}, expected {expected}")
    for name in spans:
        if re.search(r"^\s*pub (?:async )?fn " + re.escape(name) + r"\b", back, re.M):
            problems.append(f"{name} is still defined on disk")
    attrs_now = len(ATTR_RE.findall(back))
    if attrs_now != attrs_after:
        problems.append(f"attribute count on disk is {attrs_now}, expected {attrs_after}")
    return problems


def main() -> int:
    vip = load_leg()
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--shell", default="tablet", choices=tuple(vip.SHELLS))
    ap.add_argument("--module", required=True, help="file name under commands/, no extension")
    ap.add_argument("--apply", action="store_true", help="write the file (default is dry run)")
    ap.add_argument("--force", action="store_true", help="allow a dirty file (not recommended)")
    ap.add_argument("--only", default="", help="comma-separated subset of candidates to retire")
    ap.add_argument("--allow-tests", action="store_true",
                    help="permit retiring names that only a test still references")
    args = ap.parse_args()

    lib = REPO / vip.SHELLS[args.shell]
    src = lib.parent
    mod = src / "commands" / f"{args.module}.rs"
    if not mod.exists():
        print(f"abort: no such module {mod}", file=sys.stderr)
        return 2
    if (dirty := git_dirty(mod)) and not args.force:
        print(f"abort: {args.module}.rs is dirty in another lane, so ranges computed now "
              f"would not match the tree that gets committed:\n  {dirty}", file=sys.stderr)
        return 2

    # Rust comments in this tree carry em dashes and section signs, and a Windows console
    # defaults to cp1252: printing one inside a residue report raised UnicodeEncodeError out
    # of the middle of the tool's own diagnosis (`print("\n".join(residue[:40]))`, on a line
    # naming `sync_run` whose comment carries a §). Re-open stdout as UTF-8 with replacement
    # rather than sanitising the text -- the report is about real source lines and should
    # show them as they are.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # exotic or already-closed streams
        pass

    registered = set(vip.extract_handlers(lib))
    ui = set(vip.extract_ui_commands().keys())
    prod = [(p.relative_to(src).as_posix(), p.read_text(encoding="utf-8", errors="replace"))
            for p in sorted(src.rglob("*.rs")) if not p.name.endswith("_tests.rs")]
    tests = [(p.name, p.read_text(encoding="utf-8", errors="replace"))
             for p in sorted(src.rglob("*.rs")) if p.name.endswith("_tests.rs")]
    # What this tool called `ledger=` for 127 retirements was a check that could not fire,
    # twice over. It read `.registration_gate_debt.generated.rs`, a file that does not exist
    # (the real one has no leading dot), so the text was empty; and even from the right path
    # it searched for `"<name>"` while every row is written `("pos::add_line_scoped",
    # "resolves_session_names_no_permission")`, a module-qualified string -- and that ledger's
    # population is *registered but not gate-accepted* commands, disjoint by construction from
    # a candidate set that requires the command to be unregistered. It printed the right answer
    # the whole time, which is the worst way to be wrong: `ledger=no` reads exactly like a
    # passed check. The signal that can actually fire for an unregistered, unnamed, uncalled
    # command lives in the parity allowlist's free text -- its `_comment` key names commands
    # kept on purpose ("the unscoped names stay, because the ADR #7 conditional still falls
    # back to them when no session token exists", of `create_backup` and `export_data` and
    # friends), and its `dev_mock` / `scoped_orphans` sections carry the pairing that makes an
    # unscoped name load-bearing for a scoped one. Read the whole file, not a parsed subset,
    # and read it through the gate's own function rather than a forked parser: the fork is
    # what produced the shape mismatch above.
    allowlist_lines = vip.read_allowlist_text().splitlines()

    text = mod.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    names = sorted(vip.command_fns_in(text))
    cands = [n for n in names
             if n not in registered and n not in ui and not vip.fn_call_sites(n, prod)]
    wanted: set[str] = {s.strip() for s in args.only.split(",") if s.strip()}
    if args.only:
        unknown = wanted - set(cands)
        if unknown:
            print(f"abort: --only names are not retirement candidates here: "
                  f"{', '.join(sorted(unknown))} -- refusing to guess which of them are "
                  f"registered, UI-named, or called by production code")
            return 2
        cands = [n for n in cands if n in wanted]
    if not cands:
        print(f"nothing to retire in {args.module}.rs: {len(names)} command fns, "
              f"all registered, UI-named, or called")
        return 0

    print(f"{args.shell}/{args.module}.rs: {len(cands)} of {len(names)} command fns are "
          f"unregistered, unnamed in the UI, and uncalled by production code")
    spans: dict[str, tuple[int, int]] = {}
    path_hits: list[tuple[str, str]] = []
    test_hits: list[str] = []
    decision_hits: list[str] = []
    doomed = False
    for name in cands:
        sig = signature_index(lines, name)
        if sig is None:
            print(f"  abort: {name} is not defined by exactly one line in this file")
            doomed = True
            continue
        sp = span_of(lines, sig)
        if sp is None:
            print(f"  abort: {name} has no column-zero closing brace after its signature")
            doomed = True
            continue
        spans[name] = sp
        bare = path_refs(name, prod)
        for b in bare:
            print(f"    PATH MENTION (not a call, so a human reads it): {b}")
        path_hits.extend((name, b) for b in bare)
        plan = plan_mentions(name)
        for pl in plan[:4]:
            print(f"    PLAN MENTION (a written decision may hang on this name): {pl}")
        if plan and not (args.only and name in wanted):
            decision_hits.append(f"{name} -> {', '.join(plan[:4])}")
        keep = [f"ipc-parity-allowlist.json:{i}: {ln.strip()[:100]}"
                for i, ln in enumerate(allowlist_lines, 1)
                if re.search(r"(?<![\w:.])" + re.escape(name) + r"\b(?!_scoped)", ln)]
        for k in keep[:2]:
            print(f"    KEEP MENTION (the parity allowlist names this command, often in its "
                  f"_comment as a deliberate fallback): {k}")
        if keep and not (args.only and name in wanted):
            decision_hits.append(f"{name} -> {', '.join(keep[:2])}")
        tref = vip.fn_call_sites(name, tests)
        if tref:
            test_hits.append(f"{name} ({','.join(sorted({t.split(':')[0] for t in tref}))})")
        print(f"  {name:34s} lines {sp[0] + 1}-{sp[1] + 1}  "
              f"tests={'yes:' + ','.join(sorted({t.split(':')[0] for t in tref})) if tref else 'no'}"
              f"  allowlist={'YES (' + str(len(keep)) + ' line(s))' if keep else 'no'}  "
              f"plan={'yes' if plan else 'no'}")
    if path_hits and args.apply and not args.force:
        print(f"abort: {len(path_hits)} path mention(s) of a candidate name -- a bare "
              f"`::name` with no parenthesis is not a call, so the uncalled verdict rests "
              f"on evidence that is not there. Read each one above; --force overrides once "
              f"you have. Nothing written.")
        return 2
    if path_hits:
        print(f"  note: {len(path_hits)} path mention(s) reported above; a dry run shows "
              f"them and continues, --apply will refuse until --force says you read them")
    if decision_hits and args.apply:
        print("abort: these candidates are named in a work-order file, so a written decision "
              "may be waiting on them; a census cannot see a deferral. Pass --only with the "
              "names you have actually read the decision for (that IS the human act), or "
              "update the plan file first:\n  " + "\n  ".join(decision_hits))
        return 2
    if test_hits and args.apply and not args.allow_tests:
        print(f"abort: {len(test_hits)} candidate(s) are still referenced by a test file, so "
              f"deleting them means deleting or re-homing cases -- a decision, not a detail "
              f"(T5-4 found the bridge already carried four identical cases under identical "
              f"names; check before overriding):\n  " + "\n  ".join(test_hits))
        return 2
    if doomed or len(spans) != len(cands):
        print("abort: span detection incomplete, nothing written")
        return 2
    if any(spans[a][0] <= spans[b][1] and spans[b][0] <= spans[a][1] for a in spans for b in spans if a < b):
        print("abort: spans overlap, nothing written")
        return 2

    # Wording for the surviving twins, harvested from the fns being removed, so no phrasing
    # is typed by hand and the deleted command's own name for itself is not lost.
    doctext: dict[str, str] = {}
    for name, (s, e) in spans.items():
        for line in "".join(lines[s:e + 1]).splitlines():
            m = re.match(r"^\s*///\s*(.+?)\s*$", line)
            if m and "Session-scoped" not in m.group(1):
                doctext[name] = m.group(1).rstrip(".")
                break

    keep = [True] * len(lines)
    for name, (s, e) in spans.items():
        for i in range(s, e + 1):
            keep[i] = False
    out = "".join(l for i, l in enumerate(lines) if keep[i])

    rewritten = 0
    for name, raw in doctext.items():
        # Both shells' idioms, which differ in CASE as well as wording: the tablet writes
        # "Session-scoped variant of `x`." and the desktop writes "Scoped variant of `x`
        # (ADR #7)." The first widening here required a capital S and quietly stopped matching
        # the tablet form -- a matcher got narrower while it was being made broader, and only
        # a "rewritten: 0 (of 6)" line on a module that had always rewritten all of them made
        # it visible. Count what a rewrite claims to have done, always.
        old = re.compile(r"^[ \t]*/// (?:Session-)?[Ss]coped variant of `" + re.escape(name)
                         + r"`(?: \(ADR #7\))?\.[ \t]*$", re.M)
        base = raw[0].upper() + raw[1:] if raw else name.replace("_", " ")
        new = f"/// {base} resolved from a session token. ADR #7."
        out, n = old.subn(new, out)
        rewritten += n
    print(f"  twin doc lines rewritten: {rewritten} (of {len(spans)} retired fns)")

    # The prose the mechanical rewrite above cannot reach: a comment that still names a
    # function this run deletes. Hand-written batch notes found four different shapes of
    # this on 2026-09-16 -- a twin's `Session-scoped variant of` line (handled above), a
    # block comment arguing about the legacy variants (needs an author's sentence, not a
    # template), a quoted error string inside a test's doc comment (which changes only when
    # the message itself changes), and a doc EXAMPLE in another module that used two
    # retired command names as illustration (`offline.rs`: "The action to perform (e.g.
    # \"complete_sale\", \"void_sale\")"). That last one is why the scan covers the whole
    # crate and not just the file being edited: prose about a command survives in whichever
    # comment found it interesting, and a per-module report cannot see across the seam.
    # Reporting is deliberate -- the tool does not invent prose it has no business writing.
    residue: list[str] = []
    scan: list[tuple[str, str]] = [(mod.name, out)]
    # `prod` labels are relative paths ("commands/purchasing.rs") while the entry above
    # is a bare basename, so compare suffixes: without this the same file is reported
    # twice, once with stale lines that are about to be deleted.
    scan += [(label, txt) for label, txt in prod + tests
               if not label.endswith(f"commands/{mod.name}") and label != mod.name]
    for name in spans:
        # `txt`, never `text`: the outer `text` holds this file's original contents and the
        # attribute-count assertion below compares against it. Python has no block scope, so
        # a loop that binds `text` here silently replaces it, and the run reported "fell by
        # -10" while comparing an unrelated file's attributes to the result. Same family as
        # the stale `lib_path` that made the F-006 leg grade the desktop's names against the
        # tablet's sources on 2026-09-16: a name in an enclosing scope, reused.
        for label, txt in scan:
            body = txt.splitlines()
            flags = prose_flags(body)
            for i, line in enumerate(body, 1):
                # Report commentary only -- but ALL commentary, including the interiors of
                # `/* … */` audit stamps, which a `///`-prefix test cannot see.
                if not flags[i - 1]:
                    continue
                if re.search(r"(?<![\w:])" + re.escape(name) + r"\b(?!_scoped)", line):
                    residue.append(f"    {label}:{i}: {line.strip()[:110]}")
    residue = sorted(set(residue))
    if residue:
        print(f"  stale prose naming a retired fn, {len(residue)} line(s) across the crate "
              f"-- rewrite by hand:")
        print("\n".join(residue[:40]))
        if len(residue) > 40:
            print(f"    ... and {len(residue) - 40} more")
    else:
        print("  stale prose: none")

    # The assertion that the last round's failure would have tripped: a Rust file must not
    # gain a bare English sentence. A lost `///` looks exactly like this.
    bare = [f"    :{i}: {l.rstrip()}" for i, l in enumerate(out.splitlines(), 1)
            if re.match(r"^[A-Z][A-Za-z]+ [a-z].*\.$", l)]
    if bare:
        print("abort: the result contains prose without a /// prefix (a comment lost its "
              "marker and would swallow the attributes below it):")
        print("\n".join(bare))
        return 2
    ATTR = r"^\s*#\[(?:tauri::)?command\]"  # both spellings: the desktop qualifies, the tablet imports
    attrs_before = len(re.findall(ATTR, text, re.M))
    attrs_after = len(re.findall(ATTR, out, re.M))
    if attrs_before - attrs_after != len(spans):
        print(f"abort: attribute count fell by {attrs_before - attrs_after}, expected {len(spans)}")
        return 2
    for name in spans:
        if re.search(r"^\s*pub (?:async )?fn " + re.escape(name) + r"\b", out, re.M):
            print(f"abort: {name} survived its own deletion")
            return 2

    verb = "planned" if not args.apply else "writing"
    print(f"  {verb}: {len(lines)} -> {len(out.splitlines())} lines "
          f"(-{len(lines) - len(out.splitlines())}), attributes {attrs_before} -> {attrs_after}")
    print("  imports are NOT touched: run clippy --all-targets -- -D warnings and drop what "
          "it reports as unused")
    if not args.apply:
        print("dry run: nothing written. Re-run with --apply.")
        return 0
    mod.write_text(out, encoding="utf-8", newline="\n")
    # Re-read from disk. The checks above grade the string this process intended to write, so
    # they can all pass while nothing reaches the file -- and on 2026-09-16 a filtered run of
    # this tool printed "644 -> 607 lines" for a tablet module whose write never happened
    # (an allowlist KEEP gate stopped it further down), and that planned number was reported
    # as a completed retirement. A number describing a plan is not evidence of a change; only
    # the disk is. Failure here is exit 3, not a warning: the tree is now in an unknown state.
    problems = verify_on_disk(mod, out, spans, attrs_after)
    if problems:
        print(f"!! WRITE DID NOT LAND AS PLANNED in {mod.relative_to(REPO).as_posix()}:")
        for p in problems:
            print(f"   - {p}")
        return 3
    print(f"VERIFIED on disk: {mod.relative_to(REPO).as_posix()} is now "
          f"{len(out.splitlines())} lines, {len(spans)} command fn(s) absent, "
          f"{attrs_after} attributes remain")
    return 0


if __name__ == "__main__":
    sys.exit(main())
