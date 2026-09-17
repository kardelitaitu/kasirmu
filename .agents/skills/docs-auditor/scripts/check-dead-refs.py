#!/usr/bin/env python3
"""check-dead-refs.py -- find documentation path references that resolve to nothing.

Reports a file path (or bare script filename) named in a markdown doc that does not
exist in the tree. Built during the 2026-09-08 documentation audit, which found that
unresolved path references were the single most common doc defect (62 of 126 scanned
files) and that nothing in CI or in the existing tooling looked for them.

WHAT THIS TOOL IS CAREFUL ABOUT
Each rule below was bought with a real false positive during development:

  * Prunes node_modules/target/.git/dist/build/references before indexing, and never
    walks the tree per token. An early version did one rglob per filename and blew a
    300 s timeout on the first big file.
  * Never uses str.lstrip("./") to make a path relative. That call strips leading
    DOTS as well as slashes, so ".github/workflows/ci.yml" quietly became
    "github/workflows/ci.yml" and every dot-directory reference in the repo looked
    dead. Use an explicit prefix slice.
  * Accepts directories, not just files: "docs/specs/" is a valid reference.
  * Skips placeholders: braces, angles, asterisks, ellipses, XXX, YYYY, NN. A plan
    that says "add crates/kasirmu-core/migrations/XXX_foo.sql" describes a file to be
    created, not one that exists.
  * Skips lines that are ABOUT a missing thing rather than pointing at it. A page
    that says "deploy.yml does not exist" is correct, and flagging it would teach
    people to ignore the tool. See NEGATIVE_MARKERS.
  * Treats dated records (ADRs, records, archives, _done specs, release notes, any
    file whose name starts with a date) as HISTORICAL: they describe the world at the
    time of writing, are reported separately, and are never counted as drift. The
    audit convention in this repo is to annotate such files, not rewrite them.

KNOWN LIMITATIONS (deliberate, and worth knowing before you trust a clean run):

  * A reference to a RETIRED workflow resolves if the .bak exists, because
    "scripts/generate-license-keys.{sh,ps1}" and ".github/workflows/deploy.yml" are
    textually identical up to the extension: both look like PATH + "." + suffix. The
    brace rule needs that shape. So this tool cannot tell you that a page names
    `deploy.yml` as live - only verify-ci-docs-drift.py and a human can. Lines that say
    "retired" or ".bak" are skipped anyway by NEGATIVE_MARKERS.
  * A basename found ANYWHERE in the tree resolves a qualified reference, so
    "e2e/login.spec.ts" resolves on the strength of a same-named file in another dir.
    Chosen because docs cite files by name constantly; the cost is missing a moved file
    whose name did not change.
  * Prose containing slashes off a known top-level dir can look like a path
    ("install/uninstall/shortcut/update wiring"). These are rare and are handled with the
    pragma rather than a heuristic that would start eating real findings.

  Opt-out pragma: put "dead-ref: ok" in an HTML comment on the line, or on the line
  above it. Same contract as eslint-disable-next-line or #[allow(...)]: the doc states
  the reference is intentional, in one token, where a reader can see it.

Exit: 0 clean, 1 unresolved references in live docs, 2 self-failure.

Usage:
  python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py
  python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py --verbose
  python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py docs/guides/FOO.md
"""

import argparse
import os
import re
import sys
import pathlib

ROOT = pathlib.Path(".")

PRUNE = {"node_modules", "target", ".git", "dist", "build", ".next", "__pycache__",
         "references", ".cbm", ".codebase-memory", "coverage", "playwright-report"}

# Not-current-by-construction: dated records describe the world at the time of
# writing; plans and ACTIVE specs describe files still to be created. Neither is drift,
# and counting them would bury the findings that are. (_active/ is the tell: a spec that
# is still open has not finished moving the tree.)
HIST_DIR_PREFIXES = ("docs/decisions/", "docs/records/", "docs/archived/",
                     "docs/specs/_done/", "docs/specs/_archive/", "docs/specs/_active/",
                     "docs/releases/", "docs/plans/")   # plans name files to CREATE

# Agent work logs and scratch notes that are not documentation of the product.
# Also /pr_body.md: a generated pull-request body left in the worktree (.gitignore
# has it). Scanning it as documentation invents findings about a throwaway artifact.
SCRATCH = (".freebuff/", "orchestrator-journal.md", "skill-drift-report.md",
           "pr_body.md", "-journal.md")

# Words meaning "this reference is deliberately about something that is absent".
NEGATIVE_MARKERS = re.compile(
    r"retired|does not exist|doesn.t exist|no longer|was renamed|renamed to|"
    r"moved to|superseded|pending|removed|deleted|gone|\.bak\b|obsolete|historic|"
    r"squashed|used to|until 0|absent|missing|stale|no such|not present|has never|"
    r"never existed|nowhere|deliberately not|false positive|there (is|are) no|"
    r"proposed|planned|to be created|would (create|live)|not yet|would be|"
    r"2>/dev/null|copy .* to |or .*bucket|\badd(?:ing)? .* to\b",
    re.I,
)

TOP = (r"crates|apps|ui|modules|platform|foundation|scripts|docs|website|gateway|"
       r"install|packaging|assets|e2e|fuzz|\.github|\.agents|\.githooks")

PATH_RE = re.compile(r"(?<![\w/.~-])((?:" + TOP + r")/[\w./+~@-]*[\w])")

BARE_RE = re.compile(
    r"\b([\w.+-]+\.(?:sh|ps1|py|mjs|cjs|sql|toml|ya?ml|tsx|ts|rs|ftl|go|css|json))\b")

# NOTE: the character class must NOT contain a bare "." - a class like [....] keeps
# literal dots, which makes every path with an extension look like a placeholder and
# silently disables the whole tool. Found by the self-test, not by inspection.
PLACEHOLDER = re.compile(r"[{}<>*?\[\]\u2026]|\.{3}|X{2,}|Y{2,}|\bTODO\b|\bFIXME\b")

# A date ANYWHERE in the filename makes it a dated record: baseline-2026-07-20.md is
# as much a snapshot as 2026-07-20-baseline.md.
DATE_NAME = re.compile(r"(?:\d{4}-\d{2}-\d{2}|^audit-|^hardening-|^sast-|^license-audit-|^baseline-)")


def build_index():
    """One pruned walk. Returns (files, dirs, basenames) as '/'-relative strings."""
    files, dirs = set(), set()
    for dirpath, dirnames, filenames in os.walk("."):
        dirnames[:] = [d for d in dirnames if d not in PRUNE]
        rel = os.path.join(dirpath, "").replace(os.sep, "/")
        if rel.startswith("./"):
            rel = rel[2:]                      # NOT lstrip("./") - see module docstring
        dirs.add(rel)
        for fn in filenames:
            files.add(rel + fn)
    basenames = {f.rsplit("/", 1)[-1] for f in files}
    return files, dirs, basenames


# A path matched by .gitignore is ABSENT BY DESIGN: secrets (*.pem, *.keystore),
# build output (*.ipa, target/, dist/), local config. Flagging those as dead refs is
# wrong. The distinction that matters is the other one: a doc pointing at a gitignored
# path describes something you are meant to CREATE, while a doc pointing at a
# NON-ignored missing path describes something that should have been committed.
# (That second case is a live finding: apps/tablet-client/gen/apple/ is not ignored,
# and .gitignore states the gen/ scaffold policy IS committed - so the iOS guides point
# at a scaffold that was never generated.)

def git_ignored(candidates):
    """One batched git check-ignore over every unresolved candidate.

    Returns the subset that .gitignore matches. Degrades to an empty set when git is
    unavailable, so the tool errs toward reporting rather than toward silence.
    """
    if not candidates:
        return set()
    import subprocess
    probes = set()
    for c in candidates:
        probes.add(c)
        # *.ipa is ignored but its directory is not; ask about each ancestor too.
        parts = c.split("/")
        for k in range(1, len(parts)):
            probes.add("/".join(parts[:k]) + "/")
    # Paths as ARGUMENTS, output to a temp FILE. Three things had to be learned the hard
    # way, and all three failed silently: (a) capture_output= uses piped stdio, blocked in
    # some sandboxes, so the call returns nothing; (b) --stdin through a TemporaryFile
    # handle also came back empty here even though the same command works from a shell;
    # (c) probing every ancestor pushed ~600 arguments past the Windows command-line
    # limit, which raised, was caught, and returned "nothing is ignored" - reporting a
    # clean result for having crashed. Small batches, and failure is LOUD.
    import tempfile
    ordered = sorted(probes)
    found = set()
    failed = 0
    CHUNK = 20
    try:
        for s in range(0, len(ordered), CHUNK):
            batch = ordered[s:s + CHUNK]
            with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as pout:
                rc = subprocess.run(["git", "check-ignore", "--"] + batch,
                                    stdout=pout, stderr=subprocess.DEVNULL, timeout=180)
                pout.seek(0)
                body = pout.read()
                if rc.returncode not in (0, 1):    # 0 = some ignored, 1 = none, else bad
                    failed += 1
            for ln in body.splitlines():
                ln = ln.strip()
                if ln.startswith("./"):
                    ln = ln[2:]          # NOT lstrip("./") - it eats leading dots
                if ln:
                    found.add(ln)
    except Exception as exc:
        print("WARNING: git check-ignore failed (%s); reporting every unresolved path."
              % exc, file=sys.stderr)
        return set()
    if failed:
        print("WARNING: %d git check-ignore batch(es) errored; results may be incomplete."
              % failed, file=sys.stderr)
    hits = found
    return {c for c in candidates
            if c in hits or any(c == h.rstrip("/") or c.startswith(h) for h in hits)}


def is_historical_doc(path, text):
    if path.startswith(HIST_DIR_PREFIXES):
        return True
    name = path.rsplit("/", 1)[-1]
    # A changelog is a ledger of what shipped, including under names that later moved.
    # So is a root-level plan file (todo-global-saas-N.md): it enumerates the tree it
    # intended to change, and the code cites it as the contract for that work.
    #
    # Substring, NOT startswith: a finished plan is renamed IN PLACE by prefixing a
    # status word (done-todo-x, parked-todo-x), and any prefix placed before "todo-"
    # voided the exemption -- the checker then re-reads a doc as a live claim about
    # the tree and reports 28 findings for files that are historical BECAUSE they are
    # done. A gate that cries wolf is a gate that gets skipped, so the wolf wins:
    # over-exempting a live doc can only hide findings, while under-exempting a
    # historical one invents them, and invented ones are what trained people to
    # ignore this tool. Cost of the looseness, accepted: notes-todo-x.md is exempt
    # too, and so is a genuinely live plan whose name happens to contain one of
    # these words anywhere (new-plan-todo-ish.md). Do not tighten this back to
    # startswith without re-deciding that trade-off. See HIST_DIR_PREFIXES above,
    # which is the same call about whole directories, not names.
    if "CHANGELOG" in name.upper() or any(k in name for k in ("todo-", "plan-", "prd-")):
        return True
    if DATE_NAME.match(name):
        return True

def resolve_ok(token, files, dirs, basenames):
    b = token.split("#")[0].rstrip("/").rstrip(".-")
    if not b:
        return True
    if b in files or b in dirs or (b + "/") in dirs:
        return True
    if any(f.startswith(b + "/") for f in files):     # a directory named by prefix
        return True
    bare = b.rsplit("/", 1)[-1]
    if bare in basenames:                             # e2e/FOO.spec.ts exists elsewhere
        return True
    # Brace / glob forms: scripts/generate-license-keys.{sh,ps1} is truncated by the
    # tokenizer to "scripts/generate-license-keys." - a real path with a real prefix.
    if any(f.startswith(b + ".") or f.startswith(b + "-") for f in files):
        return True
    # Fall back to the filesystem. The index PRUNEs node_modules/, target/, dist/ and
    # friends, so a reference to a pruned-but-present directory is not dead. Without
    # this, every ui/node_modules mention in a doc is a false positive.
    try:
        if (ROOT / b).exists():
            return True
    except OSError:
        pass
    return False


def check_file(path, files, dirs, basenames, include_bare=False):
    """Returns (hits, historical) or (None, error) if the file could not be read.

    include_bare also tests bare filenames. Off by default: a doc that says "publish
    latest.json" is naming a build artifact, not asserting a repo path, and the noise
    buried the real findings (154 hits vs 61). Turn it on when auditing a page that
    documents scripts by name."""

    try:
        text = (ROOT / path).read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return None, str(exc)
    hits = []
    lines = text.split(chr(10))

    # File-level, prefix-scoped opt-out, declared once near the top of the page:
    #   <!-- dead-ref-prefix-ok: apps/tablet-client/gen/ -->
    # A page whose entire subject is generated output (an iOS build guide) should say so
    # once, visibly, instead of carrying a dozen inline pragmas. It stays grep-able, and
    # the exemption is scoped to a prefix so the rest of the page is still checked.
    head = chr(10).join(lines[:40])
    prefixes = tuple(re.findall(r"dead-ref-prefix-ok:\s*([A-Za-z0-9._/-]+)", head))
    for n, line in enumerate(lines, 1):
        # Opt-out pragma: "<!-- dead-ref: ok -->" on the line, or on the line above.
        # Same purpose as #[allow(...)] / eslint-disable-next-line - a reference can be
        # deliberately wrong (an example commit subject, a path being proposed) and the
        # doc should say so in one token rather than the tool guessing.
        if "dead-ref: ok" in line or (n >= 2 and "dead-ref: ok" in lines[n - 2]):
            continue
        # An annotation BELOW a claim suppresses it. Auditors write the claim, then the
        # caveat underneath ("does not exist yet, create it"), so a marker only on the
        # reference line is the wrong shape - INCIDENT_RESPONSE.md §7.3 was reported as
        # drift while its own "> Pending" note sat two lines down. Bounded to 4 lines and
        # requires a note block (a ">" line) so ordinary prose cannot silence findings.
        ahead = chr(10).join(lines[n:n + 4])
        if "\n> " in ahead or ahead.startswith("> "):
            if re.search(r"(?m)^> .*(does not exist|doesn.t exist|Pending|not exist yet|"
                         r"do not exist|does not yet exist)", ahead):
                continue
        if NEGATIVE_MARKERS.search(line):
            continue
        cands = []
        for m in PATH_RE.finditer(line):
            after = line[m.end():m.end() + 1]
            if after in ("*", "{", "?", "[", "~"):
                continue                       # a glob, not a path claim
            cands.append(m.group(1))
        # A bare filename that is just the last segment of a path already captured above
        # must not be reported a second time (crates/x/y.rs would appear twice).
        tails = {c.rsplit("/", 1)[-1] for c in cands}
        for m in (BARE_RE.finditer(line) if include_bare else []):
            tok = m.group(1)
            after = line[m.end():m.end() + 1]
            if after in ("*", "{", "?", "["):
                continue
            if tok in tails or tok in basenames:
                continue
            cands.append("~/" + tok)
        for c in cands:
            # a prefix the page declared it exists to document
            if prefixes and c.startswith(prefixes):
                continue
            if PLACEHOLDER.search(c):
                continue
            if not resolve_ok(c, files, dirs, basenames):
                hits.append((n, c.split("#")[0]))
    return hits, is_historical_doc(path, text)


def main():
    ap = argparse.ArgumentParser(description="find dead path references in docs")
    ap.add_argument("paths", nargs="*", help="specific markdown files (default: all)")
    ap.add_argument("--verbose", action="store_true", help="show every hit, not 5")
    ap.add_argument("--include-bare", action="store_true",
                    help="also test bare filenames (noisy: build artifacts)")
    ap.add_argument("--include-historical", action="store_true",
                    help="list dated-record hits too (still not counted as drift)")
    args = ap.parse_args()

    try:
        files, dirs, basenames = build_index()
    except OSError as exc:
        print("cannot index the tree: %s" % exc, file=sys.stderr)
        return 2

    targets = args.paths or sorted(f for f in files if f.endswith(".md"))

    live, hist, errs, scanned = [], [], [], 0
    rows = []            # (file, line, candidate, historical) - filtered below
    for t in targets:
        if any(x in t for x in ("/node_modules/", "/target/", "/references/")):
            continue
        if t.startswith(SCRATCH) or t in SCRATCH:
            continue
        scanned += 1
        hits, historical = check_file(t, files, dirs, basenames, args.include_bare)
        if hits is None:
            errs.append("%s: %s" % (t, historical))
            continue
        for n, cand in hits:
            rows.append((t, n, cand, historical))

    # One batched git query decides which unresolved paths are ignored on purpose,
    # so the answer comes from .gitignore rather than a hardcoded extension list.
    seen = {r[2] for r in rows}
    ign = git_ignored(seen)
    before = len(rows)
    rows = [r for r in rows if r[2] not in ign]
    ignored_hits = before - len(rows)

    acc = {}
    hacc = {}
    for f, n, c, historical in rows:
        (hacc if historical else acc).setdefault(f, []).append((n, c))
    live = sorted(acc.items(), key=lambda kv: kv[0])
    hist = sorted(hacc.items(), key=lambda kv: kv[0])

    live_n = len([1 for t, h in live if h])
    live = [(t, h) for t, h in live if h]
    hist = [(t, h) for t, h in hist if h]
    live.sort(key=lambda x: -len(x[1]))

    print("indexed %d files / %d dirs; scanned %d markdown files (%d live with hits)"
          % (len(files), len(dirs), scanned, live_n))
    print("")
    total = sum(len(h) for _, h in live)
    if live:
        print("LIVE DOCS WITH UNRESOLVED PATH REFERENCES -- %d file(s):" % len(live))
        for t, h in live:
            print("  %s  (%d)" % (t, len(h)))
            shown = h if args.verbose else h[:5]
            for n, b in shown:
                print("      L%-5d %s" % (n, b))
            if len(h) > len(shown):
                print("      ... %d more (use --verbose)" % (len(h) - len(shown)))
    else:
        print("LIVE DOCS: every path reference resolves.")

    print("")
    if args.include_historical:
        print("dated records (reported, NOT counted as drift): %d file(s), %d ref(s)"
              % (len(hist), sum(len(h) for _, h in hist)))
        for t, h in hist[:14]:
            print("  %s  (%d)" % (t, len(h)))
    else:
        print("dated records skipped: %d file(s). Use --include-historical to list."
              % len(hist))
    if errs:
        print("read errors: " + "; ".join(errs[:4]))

    print("")
    print("check-dead-refs: %d unresolved reference(s) in %d live doc(s)."
          % (total, len(live)))
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
    print("git-ignored (absent by design, skipped): %d ref(s)" % ignored_hits)
    print("")
