#!/usr/bin/env python3
"""Every debt marker in the tree must resolve to a live definition.

A TODO carrying an ID -- "TODO 2a", "TODO 3e", "TODO C3.2" -- is a POINTER. Its
whole value is that somebody can look up the item it names and see what is
actually outstanding. This gate checks the pointer, not the work, because the
work cannot be checked mechanically and the pointer can be checked exactly.

What it reports
  * unresolvable    the ID is used somewhere but DEFINED nowhere in the tree
  * resolved marker the ID is defined, and every site is annotated as done
  * live marker     the ID is defined and something still points at it

Why unresolvable is the load-bearing finding
--------------------------------------------
An unresolvable ID is not a cosmetic wart. It means the marker asks for work
against a document that is gone, so the work it describes can never be read,
checked, or closed by anyone. Four real markers in crates/kasirmu-core/src/db
were in that state, and each one sat directly above the code it claimed was
still to be written.

What it deliberately does NOT do
  It does not decide whether a marker is still LIVE. That judgement needs a
  reader, and a tool that guesses trains people to mute the tool. A live marker
  is reported as live and left alone; the gate only fails on a pointer that
  resolves to nothing, plus a defined-but-done marker, which is a marker
  claiming work that is already in the tree.

Exit codes
  0  every debt ID resolves, and no marker claims work that is already done
  1  an unresolvable ID, or a marker already annotated as done
  2  a REFUSED command line, or the marker corpus is empty (a starved scan
     that printed "OK" would be indistinguishable from a clean tree)

"""


import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

# Directories that hold first-party source. Deriving this from the workspace
# rather than typing a list is the same discipline the other gates use: a list
# of package names is a list that rots.
ROOTS = ["crates", "apps", "platform", "modules", "foundation", "scripts", "ui/src",
         "shared-ui", "docs", ".agents", "ops"]

# Files a marker lives in. Kept broad on purpose -- a debt marker in a .md is
# as real as one in a .rs, and the plan that defines an ID is usually a .md.
#
# .ftl was MISSING for the whole life of the first version, and the cost was
# real rather than theoretical: shared-ui is a declared root, so the gate
# claimed to be reading it while silently skipping every file in it. The two
# (TODO 3f) locale banners were invisible for exactly that reason. This is the
# same failure mode as a stale package name in a CI claim -- the tool reports
# what it knows, and the gap is where the bug lives.
#
# .json is absent ON PURPOSE. scripts/gates.json carries this gate's own _note
# quoting TODO 2a and TODO 4e as examples, and a manifest that cites the
# markers it polices must not be graded for them.
SOURCE_SUFFIXES = {".rs", ".go", ".ts", ".tsx", ".js", ".mjs", ".sh", ".ps1",
                   ".py", ".md", ".toml", ".yml", ".yaml", ".sql", ".css", ".bat",
                   ".ftl"}

# Directory NAMES skipped wherever they appear in the path, not just at the
# root. git ls-files is used rather than os.walk so the corpus is exactly what is
# committed: a marker in an untracked scratch file is not yet the repository's
# debt. But ls-files was doing the real filtering by accident -- being prefix
# anchored, this list never matched crates/x/vendor/ or ui/node_modules/, which
# is why SKIP_DIRS is matched segment-wise below. The suffix test alone would let
# a vendored .rs through the moment one of those trees was tracked.
SKIP_DIRS = ("node_modules", "target", ".git", "vendor", "dist",
             "build", "coverage")
# Kept as a name so the self-test can assert the boundary directly; matching is
# done on whole segments, never on a bare prefix.
SKIP_PREFIXES = tuple(d + "/" for d in SKIP_DIRS)

# The marker itself. Three shapes exist in this repo and all three are real:
#   TODO 2a           a section-local plan ID
#   TODO C3.2         a document-local ID with a dotted sub-item
#   TODO(L-1)         a parenthesised ID, used for licence/licensing work
# The ID is OPTIONAL: a bare "TODO: do the thing" is a live note to a human and
# has no pointer to resolve, so it is inventoried, never failed.
#
# The separator is a SPACE or nothing -- never a hyphen, and never an underscore.
# That single choice is what keeps the gate quiet on the tree it ships against:
# "TODO-shadow-audit.md" is a filename, "TODO - Analytics JSX" is a heading and
# "TODO/allowlist in an audit note" is a slash, none of which is a debt pointer.
#
# A word boundary before the ID is NOT enough for the alphabetic branch, because
# Python and Rust both treat "_" as a word character. Requiring the separator to
# be a space or a close-paren is what makes that branch safe.
MARKER_ID = r"(?:\d+(?:\.\d+)*[a-z]?|[A-Z]-\d+|[A-Z][A-Z0-9]*(?:\.\d+)?)"
MARKER_RE = re.compile(r"\bTODO\b[ \t]*(?:\(\s*|\s)(?P<id>" + MARKER_ID + r")(?=[\s).,:/]|$)")

# A definition: a line that ASSIGNS an ID. The discriminator that does all the
# work is a structural mark the line OWNS -- a heading dash, a bullet, or a list
# enumerator -- followed by a hard delimiter. Without both, prose invents plans
# and a marker satisfies itself, which is the one error that would make this gate
# worse than not having one:
#   "### 2a. Enrich sale_lines"       assigns 2a
#   "- [x] **5.3.1 [Multi-Stage ...]" assigns 5.3.1 by shape, but not by promise
#   "  3.2a PHANTOM premise, 3.2b"    assigns nothing
#   "  0 failed). The ADR 3 covers"   assigns nothing
#   "          ADR #47 non-goals."    assigns nothing
#   "### Phase 1 - Schema + Backend"  assigns nothing
DEF_LABEL_RE = re.compile(
    r"^\s*(?:>\s*)?"
    r"(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s*)?)(?:\*\*|__)?"
    r"(?P<id>" + MARKER_ID + r")"
    r"(?![0-9A-Za-z_])"
    r"(?=[ \t]*(?:[\u2014\u2013.,:)\[]|$))"
)
DEF_ENUM_RE = re.compile(
    r"^\s*(?:>\s*)?(?P<id>\d+(?:\.\d+)*(?!\.\d)[a-z]?)(?=[.)][ \t]|$)"
)

# A ticked checkbox. "- [x] **5.3.1** ..." has the exact SHAPE of a definition,
# so the box is the only thing that separates shipped work from a promise.
TICKED_RE = re.compile(r"^\s*(?:>\s*)?[-*+]?\s*\[[xX]\]")

# Files that are a RECORD OF THE PAST, not a description of the present, and that
# are barred from both roles: they neither assert a debt nor assign an ID. A
# changelog entry and a finished debt plan both say what someone believed on a
# past date. Rewriting one destroys the only copy of the claim.
ROOT_RECORDS = {"CHANGELOG.md", "JOURNAL.md", "SUMMARY.md"}

# The two roles of a record have to be separated, because a dated document can do
# one of them and must not do the other. It can ORIGINATE a debt ID:
# docs/archived/tauri-security-audit.md:162 is the plan that makes
# `TODO(L-1)` in apps/mobile-tauri/src/lib.rs:884 resolvable, so exempting
# that directory outright would convert a live, correctly cited security marker
# into a finding and send someone to "fix" a citation that is already right.
# It cannot ASSERT one. docs/records/JOURNAL.md:1961 quotes
# "(TODO 3f)" in a dated entry about work since completed, and the only way to
# satisfy the gate there is to edit the journal, which destroys the evidence
# and changes what happened on 2026-08-06 into what happens today.
#
# So a citation is exempt from MARKERS and keeps its power to DEFINE. The
# asymmetry is the whole point: quoting a debt is not owing it.
CITATION_DIRS = ("docs/records/", "docs/archived/", "docs/decisions/",
                 "docs/releases/", "docs/specs/_done/", "docs/specs/_archive/",
                 ".agents/planning/", ".agents/reviews/")
CITATION_FILES = ("orchestrator-journal.md", "pr_body.md", "skill-drift-report.md")

# The tool that hunts a marker is the one file in the tree that MUST contain one
# in every shape it recognises: its docstring shows what a marker looks like, its
# comments cite the real findings it was built from, and its self-test cases are
# string literals of the very lines being hunted. Exempting the checker by name
# would have been the easy version, and it is the version that cannot be checked.
# So the exemption is DERIVED instead: a file that defines the shape of the thing
# it searches for is describing markers, not asserting debts, which is the same
# reasoning scripts/gates.json gets from the .json exclusion in SOURCE_SUFFIXES.
#
# This was not hypothetical. The first corpus run reported five unresolvable IDs
# and THREE of them were this file's own docstring, comments and fixtures.
TOOL_FILES = ("scripts/verify-debt-markers.py",)

# An HTML comment, which is where every audit stamp in this repository lives.
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)

DONE_RE = re.compile(r"\bdone\b|\bshipped\b|\bresolved\b|\bclosed\b|"
                      r"\bcompleted\b|\bfinished\b|\bfixed\b|\u2713|\u2714",
                      re.IGNORECASE)



# A markdown fence. A marker inside a fenced block is the gate's own grammar
# being illustrated in a docstring, not a debt a reader must resolve, so fenced
# lines are skipped. An unclosed fence does not matter: a document that never
# closes one has, by definition, no non-fenced content after it either.
FENCE_RE = re.compile(r"^`{3,}|^~{3,}")



def root_present(repo: Path) -> list[str]:
    return [r for r in ROOTS if (repo / r).exists()]


def is_scannable(rel: str) -> bool:
    """True for a tracked file this gate is able to read a marker out of.

    Split out of tracked_files so the corpus boundary is a thing the self-test
    can assert on directly. A filter that can only be exercised by running a
    git subprocess is a filter nothing tests, and an untested corpus boundary
    is exactly how a whole directory of first-party source -- every .ftl in
    shared-ui -- went unread for the life of the first version.
    """
    if not rel:
        return False
    if any(part in SKIP_DIRS for part in rel.split("/")):
        return False
    return Path(rel).suffix.lower() in SOURCE_SUFFIXES


def tracked_files(repo: Path) -> list[str]:
    """Every tracked source file, relative to repo, build output excluded."""
    try:
        out = subprocess.run(["git", "ls-files"], cwd=str(repo),
                             capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError("git ls-files failed: %s" % exc) from exc
    if out.returncode != 0:
        raise RuntimeError("git ls-files exited %d: %s"
                           % (out.returncode, out.stderr.strip()))
    keep = []
    for line in out.stdout.splitlines():
        rel = line.strip().replace("\\", "/")
        if is_scannable(rel):
            keep.append(rel)
    return sorted(keep)


def is_record(rel: str) -> bool:
    """True for a file that RECORDS the past rather than describing the present.

    A changelog entry, a dated journal, an archived audit and a finished debt
    plan are all evidence of what someone believed on a past date. Grading them
    produces a finding no one can act on, because the fix -- rewriting the
    record -- destroys the only copy of the claim. The same files are excluded
    from ASSIGNING an ID for the mirror reason: a done-todo archive that happens
    to contain a heading shaped like "3.2a" must not retire a live marker aimed
    at today's plan.

    The list is deliberately narrow. It is not "anything historical-sounding":
    docs/architecture and docs/plans grade live, so a stale ID inside a plan
    that is still being read still gets reported.
    """
    if rel in ROOT_RECORDS:
        return True
    name = rel.rsplit("/", 1)[-1]
    return name.startswith("done-todo") or name.startswith("todo-open-debt")


def is_citation(rel: str) -> bool:
    """True for a file that may QUOTE a debt but does not OWE it.

    This is deliberately a different question from is_record, and the difference
    is the design. A dated document can be the place an ID was coined -- and
    usually is, because the audit that found the gap is what writes it down --
    so it must keep the power to DEFINE. What it must not do is ASSERT: a
    journal entry that mentions "TODO 3f" in a sentence about tests that have
    since landed is quoting its own history, and the only way to satisfy the
    gate there is to edit the journal, which changes what happened on
    2026-08-06 into what happens today.

    Exempting the directory outright, the obvious version of this rule, is
    wrong in the other direction and was caught before it shipped: it would have
    left apps/mobile-tauri/src/lib.rs:884 unresolvable, because
    docs/archived/tauri-security-audit.md:162 is the only definition of L-1
    anywhere in the tree. A live, correctly cited security marker would have been
    reported as a dangling pointer, which is the finding that trains people to
    mute the tool.
    """
    if is_record(rel):
        return True
    if rel in TOOL_FILES:
        return True
    return rel.startswith(CITATION_DIRS) or rel.rsplit("/", 1)[-1] in CITATION_FILES


def blank_comments(text: str) -> str:
    """Blank out HTML comments, keeping every newline so line numbers hold.

    A stamp is metadata ABOUT a document, not an instruction inside it. This
    gate's own repairs quote the marker they removed in order to record the
    removal, so grading a stamp reports the fix as the fault -- the first
    corpus run did exactly that, four times, in a file written hours earlier.
    """
    def blank(m):
        return "".join(c if c == chr(10) else " " for c in m.group(0))
    return HTML_COMMENT_RE.sub(blank, text)


def markers_in(text: str, rel: str) -> list[dict]:
    """Every debt marker in one document, with the line it sits on.

    The WHOLE line is searched, comment included: "TODO 2a" above a function is
    the only place the marker exists, and stripping the comment first hides
    every Rust, Go and TypeScript marker in the tree. What is excluded instead
    is material that is quoted rather than acted on: a fenced block illustrating
    the syntax, an HTML stamp, and a file that only cites the past.
    """
    if is_citation(rel):
        return []
    found = []
    fenced = False
    for n, raw in enumerate(blank_comments(text).split(chr(10)), 1):
        if FENCE_RE.match(raw.strip()):
            fenced = not fenced
            continue
        if fenced:
            continue
        for m in MARKER_RE.finditer(raw):
            found.append({
                "file": rel,
                "line": n,
                "id": m.group("id"),
                "text": raw.strip()[:160]
            })
    return found


def definitions_in(text: str, rel: str) -> list[dict]:
    """Every line that ASSIGNS an ID: a heading, a bullet, or a list enumerator.

    Prose that merely mentions an ID is not a definition. If any mention
    counted, a marker would satisfy itself and the gate would be permanently
    quiet, which is the one error that would make it worse than not having one.

    Two rules were bought with real false definitions found on the first corpus
    run. A definition must OWN a structural mark -- a heading dash, a bullet, or
    an enumerator -- instead of sitting in the middle of a sentence, because an
    archived journal line "  3.2a PHANTOM premise" was reading as the plan that
    assigns 3.2a. And its ID must contain a DIGIT, because "R: AsyncRead" in a
    Rust generic bound is a type variable, not a plan section. A false
    definition is the only thing that can silence a real finding.

    A line that says the item is done -- in words, or with a ticked box -- is
    NOT a definition, and that is the subtle one: a plan of finished work that
    keeps its old headings would otherwise clear every marker pointed at it. A
    ticked item is no longer a promise anyone can be held to.

    The exemption here is is_record and NOT is_citation, which is the whole
    asymmetry this gate is built on. An archived audit is where a debt ID is
    usually coined, so exempting it from DEFINING would invent findings against
    citations that are already correct. See is_citation for the other half.
    """
    if is_record(rel):
        return []
    found = []
    fenced = False
    for n, raw in enumerate(blank_comments(text).split(chr(10)), 1):
        if FENCE_RE.match(raw.strip()):
            fenced = not fenced
            continue
        line = raw.strip()
        if not line or fenced:
            continue
        if DONE_RE.search(line) or TICKED_RE.match(line):
            continue
        m = DEF_LABEL_RE.match(line) or DEF_ENUM_RE.match(line)
        if not m:
            continue
        ident = m.group("id")
        if not any(c.isdigit() for c in ident):
            continue
        found.append({"file": rel, "line": n, "id": ident})
    return found


def analyse(files: dict) -> dict:
    """Grade every marker in a corpus against the IDs the corpus defines.

    A marker is UNRESOLVABLE when its ID is defined nowhere in the tree. It is
    LIVE when the ID has a definition, and DONE when the marker itself claims the
    work is finished. The grader never decides whether a live marker should still
    be done: that needs a reader, and a tool that guesses it trains people to mute it.
    """
    markers, defs = [], {}
    for rel, text in files.items():
        markers.extend(markers_in(text, rel))
        for d in definitions_in(text, rel):
            defs.setdefault(d['id'], []).append(d)

    unresolvable, live, done = [], [], []
    for m in markers:
        if m['id'] not in defs:
            unresolvable.append(m)
        elif DONE_RE.search(m['text']):
            done.append(m)
        else:
            live.append(m)
    return {'markers': markers, 'definitions': defs,
            'unresolvable': unresolvable, 'live': live, 'done': done}


def report(result: dict, verbose: bool) -> None:
    """Print the inventory. Unresolvable is the verdict; the rest is context."""
    n_bad = len(result["unresolvable"])
    if n_bad:
        print("DEBT IDS THAT RESOLVE TO NOTHING -- %d marker(s):" % n_bad)
        print("  Each points at a plan section that no longer exists, so the work it")
        print("  names can never be read, checked off or closed by anyone.")
    else:
        print("DEBT IDS THAT RESOLVE TO NOTHING: none.")

    shown = result["unresolvable"] if verbose else result["unresolvable"][:10]
    for m in shown:
        print("  %s:%d  TODO %s" % (m["file"], m["line"], m["id"]))
    if n_bad > len(shown):
        print("  ... %d more (use --verbose)" % (n_bad - len(shown)))

    print("")
    n_live = len(result["live"])
    if n_live:
        print("LIVE markers whose ID resolves to a definition -- %d. Reported, NOT" % n_live)
        print("  counted as a failure: whether the work is still wanted is a human")
        print("  decision, and a tool that guesses it trains people to mute the tool.")
        shown = result["live"] if verbose else result["live"][:10]
        for m in shown:
            where = result["definitions"][m["id"]][0]
            print("  %s:%d  TODO %s  -> assigned at %s:%d"
                  % (m["file"], m["line"], m["id"], where["file"], where["line"]))
        if n_live > len(shown):
            print("  ... %d more (use --verbose)" % (n_live - len(shown)))
    else:
        print("LIVE markers whose ID resolves to a definition: none.")

    if result["done"]:
        print("")
        print("markers claiming work that is ALREADY DONE -- %d. Stale in the other"
              % len(result["done"]))
        print("  direction: the definition is still open, so claim and plan disagree.")
        for m in result["done"]:
            print("  %s:%d  %s" % (m["file"], m["line"], m["text"]))


def load_corpus(repo: Path, roots: list[str]) -> tuple[dict[str, str], list[str]]:
    """Every tracked source file under the named roots, plus the gaps.

    git ls-files rather than os.walk: the debt this gate grades is debt that is
    COMMITTED, and a marker in an untracked scratch file is not yet the
    repository's problem.

    A tracked file that is absent from the working tree is SKIPPED and counted,
    not raised. That case is real and routine here -- a parallel session mid-way
    through deleting a module leaves the index ahead of the disk -- and a gate
    that refuses on it is a gate that never runs, which is worse than not having
    one. Skipping is sound because such a file has no current content and so can
    hold no current marker; the count is printed so the gap is never invisible.
    """
    files: dict[str, str] = {}
    skipped: list[str] = []
    for rel in tracked_files(repo):
        if not any(rel == r or rel.startswith(r.rstrip("/") + "/") for r in roots):
            continue
        try:
            files[rel] = (repo / rel).read_text(encoding="utf-8", errors="replace")
        except FileNotFoundError:
            skipped.append(rel)
        except OSError as exc:
            raise RuntimeError("cannot read %s: %s" % (rel, exc)) from exc
    return files, skipped


def refuse_nothing_to_scan() -> int:
    """A scan of zero files must not print a verdict it did not earn.

    Silence and clean and indistinguishable in CI output, so an empty corpus is a
    refusal (exit 2) and prints no count on any stream. A count is what a clean scan
    looks like, and printing one from an empty corpus is a false pass.
    """
    print("verify-debt-markers: REFUSED -- no source file was scanned, so there is"
          " no debt inventory to report. A clean run looks identical from here.",
          file=sys.stderr)
    return 2


def refuse_starved_roots(repo: Path, named: list[str]) -> int | None:
    """Refuse when only SOME of the named roots exist.

    A partial scan reports a starved corpus as though it were the whole surface, and
    the difference is invisible in the output. Naming a root that is not there is a
    command-line error, so it is reported as one rather than quietly narrowing the scan.
    """
    missing = [r for r in named if not (repo / r).exists()]
    if not missing:
        return None
    print("verify-debt-markers: REFUSED -- named root(s) not present: %s"
          % ", ".join(missing), file=sys.stderr)
    print("          Scanning the rest would report a partial corpus as the whole"
          " surface, and the difference is invisible in the output.", file=sys.stderr)
    return 2



def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="every debt marker ID must resolve to a definition")
    ap.add_argument("--roots", nargs="*", default=None,
                    help="explicit corpus roots; all must exist or the run is refused")
    ap.add_argument("--verbose", action="store_true", help="list every finding")
    ap.add_argument("--self-test", action="store_true",
                    help="run synthetic cases only; touches no file")
    ap.add_argument("--json", action="store_true",
                    help="machine-readable result, for the self-test sweep")
    return ap


def self_test() -> int:
    """Cases, not a corpus.

    Every case is a string, so the rule is proved by construction and a tree that
    moves cannot quietly turn a live case vacuous. The cases encode the judgements
    this gate actually had to make, all learned from real files in this repository
    rather than invented up front.
    """
    cases: list[tuple[str, bool]] = []

    # 1. The load-bearing rule. A marker whose ID nothing assigns is the finding this
    #    gate exists for, and it is exactly what crates/kasirmu-core/src/db had:
    #    "TODO 2a" above code that already implemented 2a.
    orphan = {"crates/x/src/a.rs": "// wire the fanout (TODO 2a).\n"}
    cases.append(("an ID no list item assigns is a finding",
                  [m["id"] for m in analyse(orphan)["unresolvable"]] == ["2a"]))

    # 2. The complement, so the two can never be confused: a definition in the same
    #    corpus clears the marker. That is the difference between a pointer and a
    #    dangling one.
    resolved = {"docs/plan.md": "## 2. Schema\n\n### 2a. enrich\n",
                "crates/x/src/a.rs": "// TODO 2a\n"}
    cases.append(("an ID a heading assigns is not a finding",
                  analyse(resolved)["unresolvable"] == [] and
                  len(analyse(resolved)["live"]) == 1))

    # 3. A list item assigns just as a heading does. Headings alone would leave every
    #    todo.md list item in the tree looking unresolvable.
    listed = {"docs/plans/_active/todo.md": "1. first\n2a. second\n",
              "src/a.rs": "// TODO 2a\n"}
    cases.append(("a numbered list item assigns too",
                  analyse(listed)["unresolvable"] == []))

    # 4. The false-definition trap. If any MENTION counted as a definition, the
    #    marker would satisfy itself and the gate would be permanently quiet -- the
    #    one error that would make it worse than not having it.
    mention = {"crates/x/src/a.rs": "// the plan calls this 2a, see the plan\n"}
    cases.append(("a mention in prose is not a definition",
                  analyse(mention)["unresolvable"] == []))

    # 5. A bare TODO has no pointer, so it is never failed. Only an ID can dangle.
    bare = {"src/a.rs": "// TODO: tidy this up\n"}
    cases.append(("a bare TODO carries no ID and is never a finding",
                  analyse(bare)["unresolvable"] == []))

    # 6. A marker that says it is done while its definition is open is stale the
    #    other way, and is graded apart from a dangling pointer.
    finished = {"docs/plan.md": "### 2a. enrich\n",
                "src/a.rs": "// TODO 2a -- done, the lookup landed\n"}
    cases.append(("a marker claiming done is graded apart from a dangling one",
                  analyse(finished)["unresolvable"] == [] and
                  len(analyse(finished)["done"]) == 1))

    # 7. A definition whose own line says it is DONE is not a promise, so it must
    #    not clear a marker pointed at it -- otherwise a plan of finished work
    #    would quietly retire every debt marker aimed at it. The marker stays a
    #    finding, which is the only reading a reader can act on.
    ticked = {"docs/plan.md": "### 2a. enrich -- done\n",
              "src/a.rs": "// TODO 2a\n"}
    cases.append(("a definition already ticked done does not assign the ID",
                  [m["id"] for m in analyse(ticked)["unresolvable"]] == ["2a"]))

    # 8. An empty corpus is a refusal, not a clean run: in CI output, silence and
    #    "clean" are the same string, and a gate that reports OK from nothing would
    #    be the most expensive false pass in the set.
    cases.append(("an empty corpus is refused rather than reported clean",
                  refuse_nothing_to_scan() == 2))

    # 9. The corpus boundary itself, which the first version had no way to test.
    #    .ftl was absent from SOURCE_SUFFIXES for the whole life of the gate
    #    while shared-ui stayed a declared root, so the run reported a healthy
    #    file count over a tree it had silently stopped reading -- and two real
    #    (TODO 3f) banners went unseen. A boundary nothing can assert on is a
    #    boundary that will drift again, so it gets the same treatment as every
    #    other rule here. The .json case is the mirror half: the manifest cites
    #    the markers it polices, so it must stay out.
    cases.append(("a locale file is scannable and the gate manifest is not",
                  is_scannable("shared-ui/locales/kds.ftl") and
                  not is_scannable("scripts/gates.json") and
                  not is_scannable("ui/node_modules/x/index.js") and
                  is_scannable("shared-ui/locales/kds.id.ftl")))
    cases.append(("a backtick-quoted citation is not a marker",
                  markers_in("# a gate note: A `TODO 2a` in a comment\n",
                             "README.md") == []))

    # 10. The exemption for the tool itself, and the guard against it becoming a
    #     blanket mute. A file that names the shape of what it searches for is
    #     describing markers; anything else is still graded. The second half of
    #     the case is the one that matters: the exemption is scoped to the exact
    #     path, so a second checker at scripts/verify-something-else.py, and this
    #     file seen under a different name, are both still graded normally.
    cases.append(("the tool describing markers is exempt, its neighbour is not",
                  markers_in("# TODO 3f\n", "scripts/verify-debt-markers.py") == []
                  and markers_in("// TODO 2a\n", "scripts/verify-anything.py")
                  and is_citation("scripts/verify-debt-markers.py") and
                  not is_citation("scripts/verify-runner-claims.py")))

    bad = [name for name, ok in cases if not ok]
    if bad:
        print("SELF-TEST WRONG: " + ", ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (%d cases, no files touched)" % len(cases))
    return 0


def main() -> int:
    ap = build_parser()
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    repo = Path(__file__).resolve().parent.parent
    named = args.roots if args.roots is not None else ROOTS
    starved = refuse_starved_roots(repo, named)
    if starved is not None:
        return starved

    try:
        files, skipped = load_corpus(repo, named)
    except RuntimeError as exc:
        print("verify-debt-markers: REFUSED -- %s" % exc, file=sys.stderr)
        return 2
    if not files:
        return refuse_nothing_to_scan()

    result = analyse(files)
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        report(result, args.verbose)

    if args.json:
        print("")
    print("verify-debt-markers: %d unresolvable debt ID(s), %d live marker(s) with a"
          % (len(result["unresolvable"]), len(result["live"])))
    print("  definition, %d marker(s) claiming work that is done, over %d file(s)."
          % (len(result["done"]), len(files)))
    if skipped:
        print("  %d tracked file(s) are absent from the working tree and were NOT"
              % len(skipped))
        print("  scanned; a marker in a deleted file is not current debt.")
    return 1 if (result["unresolvable"] or result["done"]) else 0


if __name__ == "__main__":
    sys.exit(main())
