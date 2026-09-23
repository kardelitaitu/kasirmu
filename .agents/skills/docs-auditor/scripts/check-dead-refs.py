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
    file whose name starts with a date, and any doc that declares itself one in its
    header via `status: HISTORICAL-RECORD` / `STALE` / `REVIEW` or an `Anchor: HEAD`
    line) as HISTORICAL: they describe the world at the time of writing, are reported
    separately, and are never counted as drift. The audit convention in this repo is
    to annotate such files, not rewrite them. The header rule exists because four
    audit records live in `docs/security/` and no directory or name rule catches them.

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
    whose name did not change. SINCE 2026-09-24 this rescue never applies to markdown
    link targets written ./x or ../x: those resolve against the source file alone, so a
    stale reorg link can no longer pass on the strength of a same-named survivor in
    another directory (~25 such breaks were measured and repaired by hand in the
    2026-09-23 documentation audit; see its open item 3).
  * Prose containing slashes off a known top-level dir can look like a path
    ("install/uninstall/shortcut/update wiring"). These are rare and are handled with the
    pragma rather than a heuristic that would start eating real findings.

  * Symbol references are NOT checked, only paths. Measured 2026-09-19: the docs name 18 Go
    test functions (`TestXxx`) and 38 Rust `*_tests.rs` files. All 18 resolved, so this is a
    prophylactic gap rather than a live defect — but a doc promising a test that was renamed or
    never written reads exactly like this tool's other findings, and one did slip through a
    hand-audit of an ADR's verification section (ADR #54 §8, equivalence of the two signup
    doors). A future symbol rule must accept a PREFIX match: `TestMidtransWebhook` is used as a
    `go test -run` regex and matches twelve tests, so an exact-existence rule would report the
    one reference that is most deliberately correct as dead.

  * Section anchors are not checked either, and measurement says they cannot be cheaply. Counted
    2026-09-20: 1,915 `§` references across 489 files, 174 distinct tokens. Most infer their
    target from the surrounding prose ("spec 0046b §3.4" vs "ADR #54 §2.3" vs "runbook §8"),
    so a checker would first have to guess WHICH document is meant. The one unambiguous form —
    an explicit `ADR #N §X.Y`, resolvable through each ADR's `num:` frontmatter — occurs 15
    times, 9 distinct pairs: too few to justify a gate. A sample resolution of those 9 produced
    two apparent misses, and both were the checker's fault, not the docs': ADR #45 numbers its
    headings `## §4.2 …` (the `§` is in the heading), and ADR #49's `§4` is an item INSIDE a
    named section (`## Decision`), not a heading at all. A rule wrong on a nine-item sample
    teaches people to ignore the tool, which is the failure this list exists to prevent.

  * Prose splits are NOT checked, and an attempt was withdrawn rather than shipped noisy. Three
    sections of ADR #54 and one runbook paragraph had a note inserted into the middle of a
    sentence (a numbered rule read "...the admin row already exists with", then ten lines of
    history, then "email_verified = false"). A checker was written for it on 2026-09-20: it found
    those three, plus 60+ false positives, because the hard part is not the punctuation test but
    SEGMENTING markdown prose into paragraphs -- a continuation line starting with `**bold**` or
    `1.4` looks like a list item, and every rule added to compensate cost another real case. It
    was deleted after three rounds. The four repairs it motivated are in the tree; the general
    case stays a hand audit.

  * Paths inside FENCED CODE BLOCKS are not checked, which is the one place a command is most
    likely to rot. Measured 2026-09-20: a `node scripts/check-env-docs.mjs` line sat in ADR #54's
    verification block for eight rounds after that script was deleted, and every checker here was
    green -- ADRs are historical, and a fenced line is not a prose reference. Scanning fences was
    tried: the five docs that matter (ADR #54, the runbook, agent-gates, DEPLOY, the dev compose)
    yielded four hits and all four were HOST paths in operational commands (`/opt/oz/backup-pb.sh`,
    `/tmp/attest.json`), so a fence scanner cannot tell a repo path from a server path without
    knowing which commands run where. Until it can, a command block is a hand check.

  * Markdown link and image targets ([text](target)) are extracted and resolved against
    the SOURCE FILE's directory first (since 2026-09-24). A ./ or ../ target is anchored:
    it passes only if the path exists relative to the file that links it -- never from the
    repo root, never through the basename fallback -- because that fallback is what hid
    the stale ../operations/... links the 2026-09-23 audit repointed by hand. A plain
    target (docs/foo.md written inside a nested page) tries the source directory first,
    then the path-literal rules below unchanged. Targets that are not filesystem paths
    are skipped: URLs, mailto:/tel:, anchors (#...), site-absolute routes (/...), and
    everything under website/, whose ../../login/ forms are Astro routes rather than
    paths (check-site-links.py resolves those site-aware -- audit open item 4,
    resolved 2026-09-24; extracting them here produced ~90 false findings).

  Opt-out pragma: put "dead-ref: ok" in an HTML comment on the line, or on the line
  above it. Same contract as eslint-disable-next-line or #[allow(...)]: the doc states
  the reference is intentional, in one token, where a reader can see it.

Exit: 0 clean, 1 unresolved references in live docs, 2 self-failure.

Usage:
  python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py
  python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py --verbose
  python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py docs/guides/FOO.md
  python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py --self-test
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
           "pr_body.md", "-journal",
           # Agent work products, not documentation of the product. The .agents/ sandbox
           # was reorganized into record subdirectories by edd97e5c0, and these two hold
           # reviews, audits, inventories and plans. Deliberately NOT all of .agents/:
           # skills/ holds live SKILL.md contracts and management/ holds the live AGENTS
           # mirror, and exempting those would hide real drift in a policed contract.
           ".agents/planning/", ".agents/reviews/")

# Words meaning "this reference is deliberately about something that is absent".
NEGATIVE_MARKERS = re.compile(
    r"retired|does not exist|doesn.t exist|no longer|was renamed|renamed to|"
    r"moved to|superseded|pending|removed|deleted|gone|\.bak\b|obsolete|historic|"
    r"squashed|used to|until 0|absent|missing|stale|no such|not present|has never|"
    r"never existed|nowhere|deliberately not|false positive|there (is|are) no|"
    r"proposed|planned|to be created|would (create|live)|not yet|would be|"
    r"2>/dev/null|copy .* to |or .*bucket|\badd(?:ing)? .* to\b|"
    # Rename provenance in a structure diagram: README's restructure tree annotates each
    # new path with "-> <old path>" (U+2190), which is the same claim as "moved to" above.
    # And "became a ghost" is README's own wording for a directory that was removed -- the
    # one place the repo names a dead path without using any word above.
    "\u2190\\s*(?:crates|apps|ui|platform|shared-ui|modules|foundation|scripts|docs|website)/|"
    r"became a ghost",
    re.I,
)

TOP = (r"crates|apps|ui|modules|platform|foundation|scripts|docs|website|gateway|"
       r"install|packaging|assets|e2e|fuzz|\.github|\.agents|\.githooks")

PATH_RE = re.compile(r"(?<![\w/.~-])((?:" + TOP + r")/[\w./+~@-]*[\w])")

BARE_RE = re.compile(
    r"\b([\w.+-]+\.(?:sh|ps1|py|mjs|cjs|sql|toml|ya?ml|tsx|ts|rs|ftl|go|css|json))\b")

# A markdown link or image target: [text](target). Captures the target only; the
# resolution RULES (source-relative first, anchored ./ ../, skipped domains) live in
# resolve_ok and in scan_text's extraction skips. PATH_RE cannot see ./x or ../x -- its
# lookbehind rejects a preceding "/" or "." -- which is why this extractor exists.
LINK_RE = re.compile(r"\]\(\s*<?([^)\s>]+)>?\)")

# Link targets that name a route or an endpoint, not a repository path. "/..." is a
# site-absolute route; the scheme prefixes are URLs. Compared with str.startswith.
LINK_SKIP = ("http://", "https://", "mailto:", "tel:", "ftp://", "/", "#", "{{")

# NOTE: the character class must NOT contain a bare "." - a class like [....] keeps
# literal dots, which makes every path with an extension look like a placeholder and
# silently disables the whole tool. Found by the self-test, not by inspection.
PLACEHOLDER = re.compile(r"[{}<>*?\[\]\u2026]|\.{3}|X{2,}|Y{2,}|\bTODO\b|\bFIXME\b")

# A date ANYWHERE in the filename makes it a dated record: baseline-2026-07-20.md is
# as much a snapshot as 2026-07-20-baseline.md.
DATE_NAME = re.compile(r"(?:\d{4}-\d{2}-\d{2}|^audit-|^hardening-|^sast-|^license-audit-|^baseline-)")

# A doc that declares itself a record in its own header IS one, whatever its directory or
# name -- the repo convention is to annotate such a file, not rewrite it (module docstring
# above), and docs/security/ holds four audit records that no directory or name rule
# catches. Read the HEADER only: these are stamps that sit at the top, and scanning the
# whole body would exempt any live doc that merely mentions another file's status.
#
# "status: VERIFIED-TRUE" is deliberately NOT a marker. A page whose stamp says its claims
# were verified against code is a maintained policy page (data-residency-and-retention.md),
# not a frozen snapshot, so its body citations must stay live and be corrected forward.
RECORD_HEADER_LINES = 15
RECORD_MARKER = re.compile(
    r"status:\s*(?:HISTORICAL-RECORD|STALE|REVIEW|SUPERSEDED)\b|"
    r"treat as a historical|"
    r"(?:anchor|reviewed)\s*:?\s*HEAD\b",
    re.I,
)


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
# (That second case is a live finding: apps/mobile-tauri/gen/apple/ is not ignored,
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
    # A self-declared record (see RECORD_MARKER). Checked last, so the cheap directory and
    # name rules still win, and read from the header only.
    if RECORD_MARKER.search("\n".join(text.splitlines()[:RECORD_HEADER_LINES])):
        return True
    return False

def resolve_ok(token, files, dirs, basenames, src_dir=""):
    b = token.split("#")[0].rstrip("/").rstrip(".-")
    if not b:
        return True

    def on_disk(p):
        # The index PRUNEs node_modules/, target/, dist/ and friends, so a reference to
        # a pruned-but-present path is not dead. Without this, every ui/node_modules
        # mention in a doc is a false positive.
        try:
            return (ROOT / p).exists()
        except OSError:
            return False

    # SOURCE-RELATIVE FIRST (2026-09-24): every candidate is first tried against the
    # directory of the file that names it, which is what a markdown reader does. For a
    # root-level file src_dir is "": the repo root IS the source directory, so "./x"
    # normalizes to "x" there instead of failing the anchored branch below.
    rel = os.path.normpath(os.path.join(src_dir, b)).replace(os.sep, "/")

    # ANCHORED targets ("./x", "../x"): markdown's own relative form, extracted from
    # [text](...) links only. These resolve against the source file ALONE -- no repo-root
    # retry, no basename fallback -- so a stale reorg link cannot pass on the strength of
    # a same-named survivor in another directory (the ~25 hidden breaks the 2026-09-23
    # audit found by hand; its open item 3).
    if b.startswith("./") or b.startswith("../"):
        if not rel or rel.startswith("../"):
            return False            # the link escapes the repo root (or resolved to nothing)
        return (rel in files or (rel + "/") in dirs
                or any(f.startswith(rel + "/") for f in files) or on_disk(rel))

    if rel and rel != b and (rel in files or (rel + "/") in dirs or on_disk(rel)):
        return True                 # source-relative resolution wins before any fallback

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
    return on_disk(b)


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
    return scan_text(path, text, files, dirs, basenames, include_bare)


def scan_text(path, text, files, dirs, basenames, include_bare=False):
    """Pure core of check_file: (path, text) plus an index -> (hits, historical).

    Split out for --self-test, which feeds synthetic fixtures here and touches no file
    on disk -- check-nav-paths.py's rule: a self-test that mutates the tree can damage
    the thing it is policing."""

    # Relative resolution is anchored to the directory of the file being scanned.
    src_dir = path.rsplit("/", 1)[0] if "/" in path else ""
    # website/ keeps path-literal scanning only: its ../../login/ and /en/docs/ link
    # targets are Astro routes, not filesystem paths, and extracting them produced ~90
    # false findings in the 2026-09-23 audit; check-site-links.py owns them since 2026-09-24.
    links = not path.startswith("website/")
    hits = []
    lines = text.split(chr(10))

    # File-level, prefix-scoped opt-out, declared once near the top of the page:
    #   <!-- dead-ref-prefix-ok: apps/mobile-tauri/gen/ -->
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
        # Markdown link/image targets, so ./ and ../ targets and non-TOP plain targets
        # are graded at all -- all three were invisible to this checker before
        # 2026-09-24 (measured in the 2026-09-23 audit). Deduped against PATH_RE's
        # captures: double-reporting from two regexes was one of the five silent bugs
        # the self-test caught on day one.
        if links:
            for m in LINK_RE.finditer(line):
                tgt = m.group(1)
                if tgt.startswith(LINK_SKIP) or "://" in tgt:
                    continue
                if PLACEHOLDER.search(tgt) or tgt in cands:
                    continue
                cands.append(tgt)
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
            if not resolve_ok(c, files, dirs, basenames, src_dir):
                hits.append((n, c.split("#")[0]))
    return hits, is_historical_doc(path, text)


def self_test():
    # Synthetic fixtures, deliberately (check-nav-paths.py's rule): a self-test that
    # reads the live tree fails whenever the tree is refactored, which says nothing about
    # the resolution logic it exists to pin. Every case pins one claim from the
    # 2026-09-23 audit's open item 3 or one of the bug classes this checker shipped with.
    files = {"docs/sub/page.md", "docs/sub/brother.md", "docs/other/ghost.md",
             "docs/guide.md", "website/src/content/docs/en/index.md"}
    dirs = {"docs/", "docs/sub/", "docs/other/", "website/", "website/src/",
            "website/src/content/", "website/src/content/docs/",
            "website/src/content/docs/en/"}
    basenames = {f.rsplit("/", 1)[-1] for f in files}
    idx = (files, dirs, basenames)

    def hits(path, text):
        h, _ = scan_text(path, text, *idx)
        return h

    cases = []
    # The regression the whole change exists for: ghost.md survives in docs/other/, so a
    # basename fallback would resolve this stale link and the finding would vanish.
    cases.append(("stale ../ link reported despite same-named file elsewhere",
                  len(hits("docs/sub/page.md", "[g](../late/ghost.md)")) == 1))
    cases.append(("existing ../ link clean",
                  len(hits("docs/sub/page.md", "[g](../other/ghost.md)")) == 0))
    cases.append(("./ sibling extracted (the previously invisible form)",
                  len(hits("docs/sub/page.md", "[n](./nope.md)")) == 1))
    cases.append(("existing ./ sibling clean",
                  len(hits("docs/sub/page.md", "[b](./brother.md)")) == 0))
    cases.append(("anchored target resolves against the source directory",
                  len(hits("docs/guide.md", "[p](./sub/page.md)")) == 0))
    cases.append(("plain link target through the source directory, clean",
                  len(hits("docs/guide.md", "[p](sub/page.md)")) == 0))
    cases.append(("missing path reported exactly once (no double count)",
                  len(hits("docs/sub/page.md", "[x](docs/nope.md)")) == 1))
    cases.append(("website site-route targets skipped",
                  len(hits("website/src/content/docs/en/index.md",
                           "[l](../../login/) [m](../account.md)")) == 0))
    cases.append(("pragma still suppresses an anchored stale link",
                  len(hits("docs/sub/page.md",
                           "<!-- dead-ref: ok -->" + chr(10) +
                           "[g](../late/ghost.md)")) == 0))
    cases.append(("dated record stays historical",
                  is_historical_doc("docs/records/2026-01-01-x.md", "t") is True))
    bad = [n for n, ok in cases if not ok]
    if bad:
        print("SELF-TEST WRONG: " + ", ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (%d cases, no files touched)" % len(cases))
    return 0


def main():
    ap = argparse.ArgumentParser(description="find dead path references in docs")
    ap.add_argument("paths", nargs="*", help="specific markdown files (default: all)")
    ap.add_argument("--verbose", action="store_true", help="show every hit, not 5")
    ap.add_argument("--include-bare", action="store_true",
                    help="also test bare filenames (noisy: build artifacts)")
    ap.add_argument("--include-historical", action="store_true",
                    help="list dated-record hits too (still not counted as drift)")
    ap.add_argument("--self-test", action="store_true",
                    help="run synthetic resolution cases; touches no files")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    try:
        files, dirs, basenames = build_index()
    except OSError as exc:
        print("cannot index the tree: %s" % exc, file=sys.stderr)
        return 2

    targets = args.paths or sorted(f for f in files if f.endswith(".md"))

    # A gitignored file is not part of the repository, so it cannot be a live document OF
    # the repository. Grading one invents findings about a scratch artifact -- which is
    # the class the SCRATCH list below means to skip but cannot express: SCRATCH is tested
    # with str.startswith on the whole relative path, so "-journal.md" can never match
    # ".agents/manager-journal-<topic>.md", the repo's actual naming. Measured 2026-09-18:
    # five such journals held 73 of this gate's 148 findings and .workbuddy-ai/memory held
    # another. Uses the same batched query as the unresolved-path filter, so the answer
    # comes from .gitignore rather than a second hardcoded list.
    ignored_docs = git_ignored(set(targets))
    if ignored_docs:
        targets = [t for t in targets if t not in ignored_docs]

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
    # Anchored link targets (./x, ../x) are excluded: they are never gitignore forms,
    # and a ../ argument makes git check-ignore fail its WHOLE batch of twenty, which
    # would silently drop the ignore-filtering for the other nineteen (seen as "2 git
    # check-ignore batch(es) errored" on the first run of the link rules).
    seen = {r[2] for r in rows if not r[2].startswith(("./", "../"))}
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
