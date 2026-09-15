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
        for number, line in enumerate(text.splitlines(), 1):
            if PROSE_LINE.match(line) or re.match(r"^\s*pub (?:async )?fn\b", line):
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

    registered = set(vip.extract_handlers(lib))
    ui = set(vip.extract_ui_commands().keys())
    prod = [(p.relative_to(src).as_posix(), p.read_text(encoding="utf-8", errors="replace"))
            for p in sorted(src.rglob("*.rs")) if not p.name.endswith("_tests.rs")]
    tests = [(p.name, p.read_text(encoding="utf-8", errors="replace"))
             for p in sorted(src.rglob("*.rs")) if p.name.endswith("_tests.rs")]
    ledger = (src / "commands" / ".registration_gate_debt.generated.rs")
    ledger_text = ledger.read_text(encoding="utf-8", errors="replace") if ledger.exists() else ""

    text = mod.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    names = sorted(vip.command_fns_in(text))
    cands = [n for n in names
             if n not in registered and n not in ui and not vip.fn_call_sites(n, prod)]
    if args.only:
        wanted = {s.strip() for s in args.only.split(",") if s.strip()}
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
        tref = vip.fn_call_sites(name, tests)
        if tref:
            test_hits.append(f"{name} ({','.join(sorted({t.split(':')[0] for t in tref}))})")
        in_ledger = bool(re.search(r'"{0}"'.format(re.escape(name)), ledger_text))
        print(f"  {name:34s} lines {sp[0] + 1}-{sp[1] + 1}  "
              f"tests={'yes:' + ','.join(sorted({t.split(':')[0] for t in tref})) if tref else 'no'}"
              f"  ledger={'YES (do not delete)' if in_ledger else 'no'}")
    if path_hits and args.apply and not args.force:
        print(f"abort: {len(path_hits)} path mention(s) of a candidate name -- a bare "
              f"`::name` with no parenthesis is not a call, so the uncalled verdict rests "
              f"on evidence that is not there. Read each one above; --force overrides once "
              f"you have. Nothing written.")
        return 2
    if path_hits:
        print(f"  note: {len(path_hits)} path mention(s) reported above; a dry run shows "
              f"them and continues, --apply will refuse until --force says you read them")
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
        old = re.compile(r"^[ \t]*/// Session-scoped variant of `" + re.escape(name) + r"`\.[ \t]*$",
                         re.M)
        base = raw[0].upper() + raw[1:] if raw else name.replace("_", " ")
        new = f"/// {base} resolved from a session token. ADR #7."
        out, n = old.subn(new, out)
        rewritten += n
    print(f"  twin doc lines rewritten: {rewritten} (of {len(spans)} retired fns)")

    # The prose the mechanical rewrite above cannot reach: a comment that still names a
    # function this run deletes. Hand-written batch notes found three different shapes of
    # this on 2026-09-16 -- a twin's `Session-scoped variant of` line (handled above), a
    # block comment arguing about the legacy variants (needs an author's sentence, not a
    # template), and a quoted error string inside a test's doc comment (which changes only
    # when the message itself changes). Reporting is deliberate: the tool does not invent
    # prose it has no business writing.
    residue: list[str] = []
    for name in spans:
        for i, line in enumerate(out.splitlines(), 1):
            if not re.match(r"^\s*(///|//)", line):
                continue
            if re.search(r"(?<![\w:])" + re.escape(name) + r"\b(?!_scoped)", line):
                residue.append(f"    :{i}: {line.strip()}")
    if residue:
        print(f"  stale prose naming a retired fn, {len(residue)} line(s) -- rewrite by hand:")
        print("\n".join(sorted(set(residue))))
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
    attrs_before = len(re.findall(r"^\s*#\[command\]", text, re.M))
    attrs_after = len(re.findall(r"^\s*#\[command\]", out, re.M))
    if attrs_before - attrs_after != len(spans):
        print(f"abort: attribute count fell by {attrs_before - attrs_after}, expected {len(spans)}")
        return 2
    for name in spans:
        if re.search(r"^\s*pub (?:async )?fn " + re.escape(name) + r"\b", out, re.M):
            print(f"abort: {name} survived its own deletion")
            return 2

    print(f"  {len(lines)} -> {len(out.splitlines())} lines "
          f"(-{len(lines) - len(out.splitlines())}), attributes {attrs_before} -> {attrs_after}")
    print("  imports are NOT touched: run clippy --all-targets -- -D warnings and drop what "
          "it reports as unused")
    if not args.apply:
        print("dry run: nothing written. Re-run with --apply.")
        return 0
    mod.write_text(out, encoding="utf-8", newline="\n")
    print(f"applied to {mod.relative_to(REPO).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
