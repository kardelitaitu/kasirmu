#!/usr/bin/env python3
"""Gate Fluent keys that nothing references -- the direction nobody checks.

`verify-bundle-parity.py` walks eight reference surfaces and fails when code names a key that
resolves in neither locale. The opposite question has no gate at all: a key sitting in a
bundle with no code that reads it. That asymmetry is not academic. Two cases surfaced while
this was being written:

  - `topology-shortcuts-*`: 18 keys in multi-location.ftl. The only places the names appear are
    test fixtures that enumerate expected bundle contents, and a comment in
    popoverSurfaceCompliance.test.tsx:54 recording that "topology-shortcuts-popover [was]
    removed with the shortcuts feature". The feature is gone; the copy stayed.
  - `warehouse-col-*` / `warehouse-stat-*` / `warehouse-stock-*`: ~23 keys with zero matches
    anywhere in the repository, tests included.

Blocking on the whole-tree count would be wrong, because detection is genuinely imperfect:
template composition (`analytics-month-${m}`) means a family can be live from a single
dynamic hit, and a naive name-grep reports 296 candidates where maybe 50 are real. A gate
that arrives needing a 93-entry allowlist is a backlog wearing a gate's clothes.

So this gates the two things a COMMIT can be held to, both cheap and both precise:

  1. a key the commit ADDS must be referenced in the working tree -- no new orphans;
  2. a reference the commit REMOVES must not leave a key stranded -- which is exactly how
     the topology-shortcuts debt happened, and the case that would otherwise be invisible.

`--census` reports the whole-tree picture informationally so existing debt stays visible
without blocking unrelated work, and `--self-test` proves both directions can actually fail.

Three exit codes, and the gap between them is the whole contract: 0 means this run checked
what it was pointed at and found nothing, 1 means it reached a verdict and the verdict is
`FAIL: N orphan problem(s)`, and 2 means it checked nothing at all -- no ROOT to read, no
index to diff, or a file that would not open. That last case is why a lock collision on a busy
tree must never leave a 1 behind: the code that means "somebody's keys are orphaned" cannot
also be the code that means "a writer held the file for one millisecond". See `_read()`.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCALES = ROOT / "ui" / "src" / "locales"
ALLOWLIST_PATH = ROOT / "scripts" / "ftl-orphan-allowlist.json"

KEY_DECL = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=", re.M)
UI_EXCLUDES = ("__tests__", "dev-mock", "/locales/")


#: True only for --census, the advisory mode, which names an unreadable file and carries on.
#: The two hard-gate modes leave this False and raise instead. Set once in main().
_REPORT_UNREADABLE = False

#: Paths that existed in the glob and then would not open, in the order they failed. Only
#: --census populates it; a hard mode raises on the first one and never reaches the list.
UNREADABLE: list[str] = []


class UnreadableSource(Exception):
    """A file this gate needs would not open.

    Raised by `_read()` in `--self-test` and `--staged-only` only. Those two are the modes
    a reader trusts to have CHECKED something -- `--staged-only` is pre-commit step 7 and
    `--self-test` blocks CI -- and an unknown corpus is not a clean one. The handler is
    `main()`'s single `except`, so the gate keeps one voice: one `error:` sentence on stderr
    naming the path, exit 2, no Traceback.

    The name and the shape are the house law, not an invention: `verify-scoped-reads.py`
    (`AllowlistUnreadable` / `AllowlistUndecodable`, `dd4888194`) already keeps one class and
    one handler for "the bytes would not arrive", and `coverage_top.py` (`dfb3e10e9`) already
    names one UNREADABLE line and carries on. `hollow_root_reason()` deliberately does NOT
    cover this and is not widened to try: the directory exists, the bundles exist, and the
    `open()` is what fails this instant because another session is writing the file. The
    finding at docs/records/audit-open-findings.md (2026-09-13 19:45) is precisely that
    `exists` cannot see it.

    Not retried. This gate never writes, so it has nothing to negotiate with a writer, and the
    pre-commit budget for all seven steps is under a second; a denial is settled by a re-run,
    not by a sleep inside someone's commit.
    """


def _rel(path: Path) -> str:
    """The ROOT-relative posix path, for a message a reader can cd to."""
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def _read(path: Path, errors: str = "replace") -> str:
    """One file's text. A read that fails is never allowed to reach an exit code.

    Before this, every content read in the file was a bare `read_text`, and on a tree where
    several sessions write `.ftl` continuously the open raises `PermissionError` for the
    microsecond a writer holds the file. Unhandled, that left the process at exit 1 with one
    Traceback and no `FAIL: N orphan problem(s)` line -- this file's failure code for a real
    orphan verdict, spent on a lock collision, and read downstream as a claim about somebody's
    keys. Measured on the real tree against `ui/src/locales/kds.ftl`; recorded 2026-09-13 at
    19:45.

    The mode decides what a failed read means, and `main()` sets that once:

      * `--self-test` / `--staged-only` (`_REPORT_UNREADABLE` False) -- raise
        `UnreadableSource`. Both feed a hard gate step, and a corpus with a hole in it is not
        a corpus; `main()` answers with `_refusal()`, which exits 2 -- the same code a hollow
        ROOT or an unreadable index already costs, and never the 1 a verdict costs.
      * `--census` (`_REPORT_UNREADABLE` True, advisory, reported and never blocking) --
        record the path, hand back the empty string, finish the run, and let `_report_unreadable()`
        name the gap ABOVE the numbers it qualifies.

    Only `OSError` is caught, and only around the open, so a missing directory stays
    `hollow_root_reason()'s` case. A decode error cannot reach here for a bundle: the
    default `errors="replace"` is what it always was, which makes a non-UTF-8 `.ftl` a
    content question rather than a crash, and the one caller that keeps strict decoding
    (`load_allowlist()`) keeps raising what it always raised. `FileNotFoundError` IS an
    `OSError`: a bundle deleted between the glob and the read is the same race wearing a
    different name, and it gets the same sentence.
    """
    try:
        return path.read_text(encoding="utf-8", errors=errors)
    except OSError as exc:
        where = f"`{_rel(path)}` ({type(exc).__name__}: {exc.strerror or exc})"
        if where not in UNREADABLE:
            UNREADABLE.append(where)
        if not _REPORT_UNREADABLE:
            raise UnreadableSource(where) from None
        return ""


def _refusal(mode: str) -> int:
    """Exit 2 for a hard mode whose corpus would not open -- the hollow-ROOT voice, reused.

    `census()` and `self_test()` already print `error: cannot run <mode> here: <what>
    (looked under ROOT=...); nothing was <verb>ed, so this refusal is not an orphan verdict.`
    for a tree they cannot see. This is the same sentence for a tree they can see but cannot
    read, because what it denies is the same: no number, and therefore no finding. One line
    per path that failed, which in a strict mode is the one that stopped the run.
    """
    for line in UNREADABLE or [f"{mode} scope"]:
        print(f"error: cannot run {mode} here: {line} -- the file would not open, so the keys it "
              f"declares and any reference it holds are unknown to this run (looked under "
              f"ROOT={ROOT}). Nothing was checked, so this refusal is not an orphan verdict -- a "
              f"file that will not open is usually another session mid-write, and a busy file is "
              f"not evidence about anybody's keys. Re-run it once the writer is done.",
              file=sys.stderr)
    return 2


def _report_unreadable() -> None:
    """Name what --census could not read, before the numbers that are short because of it.

    The report is why census does not raise: a whole-tree census is a trend line, not a gate,
    and one locked bundle out of 52 is worth a line rather than a lost report. The line says
    which way the number is wrong -- a bundle that did not arrive contributes no declared keys
    and no intra-bundle references, and a `.tsx` that did not arrive contributes no
    references -- so the census can read both short and over-long because of it.
    """
    if not UNREADABLE:
        return
    print(f"UNREADABLE: {len(UNREADABLE)} file(s) in scope would not open, so the counts below "
          f"are not the whole tree:")
    for line in UNREADABLE:
        print(f"  UNREADABLE: {line} -- a file that exists and would not open this instant, "
              f"usually another session mid-write. Not an orphan finding, not a verdict on "
              f"anybody's keys; the keys it declares are missing from the count and any "
              f"reference it holds was not seen, so this census is short and may over-report "
              f"candidates. Re-run when the tree is quiet.")


def declared_keys() -> dict[str, str]:
    """{key: declaring file} across the English bundles."""
    out: dict[str, str] = {}
    for f in sorted(LOCALES.glob("*.ftl")):
        if f.name.endswith(".id.ftl"):
            continue
        for m in KEY_DECL.finditer(_read(f)):
            out.setdefault(m.group(1), f.name)
    return out


def ui_blob() -> str:
    """Production UI source, excluding tests, the dev-mock, and the bundles themselves."""
    parts = []
    for path in ROOT.glob("ui/src/**/*.ts*"):
        rel = path.relative_to(ROOT).as_posix()
        if any(x in rel for x in UI_EXCLUDES):
            continue
        parts.append(_read(path))
    return "\n".join(parts)


def intra_bundle_refs(names: set[str]) -> set[str]:
    """Keys referenced by OTHER messages, terms, or attributes in any .ftl file.

    All 25 domain files concatenate into one bundle per locale, so a key declared in one
    file may be consumed from another; scanning only the declaring file would call that an
    orphan. The declaration line itself is stripped before the search so a key does not
    count as referencing itself.
    """
    joined = "\n".join(_read(f) for f in sorted(LOCALES.glob("*.ftl")))
    hits: set[str] = set()
    for name in names:
        stripped = re.sub(r"^" + re.escape(name) + r"\s*=.*$", "", joined, flags=re.M)
        if name in stripped:
            hits.add(name)
    return hits


def composed_prefixes(source: str) -> set[str]:
    """Static heads of template literals and concatenations that build key names.

    Trailing separators are stripped deliberately. The capturing class includes '-', so
    `analytics-month-${m}` yields 'analytics-month-'; testing startswith(p + "-") against
    that looks for 'analytics-month--' and never matches, which silently disabled the rescue
    for exactly the common dash-terminated case and inflated the census from ~50 real
    candidates to 295. Normalising here keeps the caller's comparison honest.
    """
    prefixes: set[str] = set()
    for m in re.finditer(r"[`'\"]([A-Za-z0-9][A-Za-z0-9._-]{2,})-?\$\{", source):
        prefixes.add(m.group(1).rstrip("-"))
    for m in re.finditer(r"['\"]([A-Za-z0-9][A-Za-z0-9._-]{2,}-)['\"]\s*\+", source):
        prefixes.add(m.group(1).rstrip("-"))
    return prefixes


def referenced(names: set[str]) -> set[str]:
    """Names that have some plausible reference: literal, intra-bundle, or composed."""
    source = ui_blob()
    live = {n for n in names if n in source}
    live |= intra_bundle_refs(names)
    prefixes = composed_prefixes(source)
    live |= {n for n in names if any(n == p or n.startswith(p + "-") for p in prefixes)}
    return live


def staged_diff() -> str | None:
    """The staged diff under ui/src, or None when git could not produce one.

    None is a REFUSAL condition, not an empty set. `git diff --cached` reports a usage or
    repository error on stderr and writes NOTHING to stdout, so returning `.stdout` alone --
    the shape this function had, with no `check=` and `returncode` never read -- made "the
    index could not be read" and "the index holds nothing under ui/src" byte-identical to the
    caller, which then printed a clean verdict over the empty string. This is the law this repo
    already states at scripts/verify-migration-column-types.py:204-222.
    """
    cmd = ["git", "diff", "--cached", "-U0", "--", "ui/src/locales", "ui/src"]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
            cwd=ROOT, check=True)
    except Exception as exc:  # no git on PATH, no repository at ROOT, or a non-zero exit
        # The words below are git's own, quoted from its stderr -- a complaint about the
        # command or the checkout, not this gate's verdict on anyone's keys.
        print(f"error: cannot read the staged diff (`{' '.join(cmd)}` in {ROOT}): {exc}",
              file=sys.stderr)
        raw = getattr(exc, "stderr", "") or ""
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        for line in str(raw).splitlines()[:3]:
            print(f"  git: {line}", file=sys.stderr)
        return None
    return proc.stdout


def changes_from_diff(diff: str) -> tuple[set[str], set[str], set[str]]:
    """(keys added to an English bundle, keys added to an Indonesian bundle, key names
    removed from code) as seen in one diff.

    English and Indonesian additions are tracked separately because they fail differently: an
    English-only key is an orphan candidate if nothing reads it, while an Indonesian-only key is
    a one-sided translation that renders raw to English users. Collapsing them into one set, as
    the first version did, cannot express the second check at all.
    """
    added_en: set[str] = set()
    added_id: set[str] = set()
    removed_refs: set[str] = set()
    cur = ""
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            cur = line[6:].strip()
            continue
        if not cur:
            continue
        is_bundle = cur.endswith(".ftl") and "/locales/" in cur
        is_id_bundle = is_bundle and cur.endswith(".id.ftl")
        is_code = cur.startswith("ui/src") and not is_bundle
        if line.startswith("+") and not line.startswith("+++") and is_bundle:
            for m in KEY_DECL.finditer(line[1:]):
                (added_id if is_id_bundle else added_en).add(m.group(1))
        if line.startswith("-") and not line.startswith("---") and is_code:
            # A removed code line may have been the only reference to a key.
            for m in re.finditer(r"['\"`]([A-Za-z0-9][A-Za-z0-9._-]{3,})['\"`]", line[1:]):
                removed_refs.add(m.group(1))
    return added_en, added_id, removed_refs


def load_allowlist() -> dict:
    """The allowlist, or nothing at all when it would not open.

    Read through the same `_read()` as every other file here, because it has the same
    exposure and the same two consumers: an allowlist that will not OPEN under
    `--staged-only` must not cost an exit 1, and it is no verdict either way. In `--census`
    the `{}` it falls back to is not a silent empty allowlist -- `_read()` has already named
    the path, so the sheet carries the gap beside the number. `errors="strict"` keeps this
    file decoding exactly what it always decoded; only the open is guarded. A file that IS
    readable but is not valid JSON still raises, unchanged -- a defect in a committed file
    is not a race with a writer, and it is not this gate's sentence to soften.
    """
    if not ALLOWLIST_PATH.exists():
        return {}
    before = len(UNREADABLE)
    text = _read(ALLOWLIST_PATH, errors="strict")
    if len(UNREADABLE) > before:
        return {}
    return json.loads(text)


def bundle_keys(suffix: str) -> set[str]:
    """Every key declared across one locale's whole set of domain files.

    Global rather than per-file on purpose: all 25 domain files are concatenated into one
    bundle per locale at load time (see scan-locale-crossings.py), so a key declared in
    sales.id.ftl is satisfied by a definition in ANY English domain file. Pairing files
    strictly would report crossings as one-sided when the runtime resolves them fine.
    """
    names: set[str] = set()
    for f in sorted(LOCALES.glob("*.ftl")):
        is_id = f.name.endswith(".id.ftl")
        if (suffix == "id") != is_id:
            continue
        for m in KEY_DECL.finditer(_read(f)):
            names.add(m.group(1))
    return names


def id_only_keys() -> set[str]:
    """Keys in the Indonesian bundle with no English definition anywhere.

    Reported as cleanup debt, NOT gated. An earlier version of this file claimed a reference
    resolving in Indonesian but not English was invisible to every gate, on the reasoning that
    i18nBundle.test.tsx:450 checks only EN->ID and --full-census is described as failing on
    keys resolving in NEITHER locale. That claim was tested and is false: verify-bundle-parity.py
    reports "missing in en .ftl only" and does so at getString, <Localized id> and i18nKey sites
    alike. Its summary wording is what misled -- the behaviour checks each locale separately.

    Checking at the reference is also strictly better than the key-set symmetry check proposed
    there: it flags only one-sided keys that would actually render a raw identifier to a user,
    and stays quiet about the 75 unreferenced dead translations that are untidy but harmless.
    """
    return bundle_keys("id") - bundle_keys("en")


def hollow_root_reason() -> str | None:
    """Say why ROOT is not a checkout of this project, or None when it plainly is.

    `--census` derives every number it prints from `Path.glob`, which yields nothing rather than
    raising when the directory it points at does not exist: `declared_keys()`, `bundle_keys()` and
    `intra_bundle_refs()` all glob `LOCALES`, and `ui_blob()` globs `ROOT/ui/src`. Under a ROOT that
    resolves outside any checkout -- this file copied two levels under a temp dir, or a working
    directory that is not a repository -- all four returned empty, every set subtracted from every
    other set cleanly, and the gate printed `info[census]: 0 declared en keys, 0 referenced, 0
    candidates` at exit 0: a clean-looking orphan sheet over nothing.

    A zero key count is NOT the signal. A repository where every declared key is genuinely
    referenced legitimately reports 0 candidates, and refusing on that would reject a real result.
    The load-bearing shape is the one `staged_diff()` already uses: a named path this gate REQUIRES
    is missing. In a checkout of this project `ui/src/locales` is a directory holding the `.ftl`
    bundles, so a tree without that surface is not this project and holds no orphan verdict either
    way. Same reasoning `verify-no-hardcoded-money-format.py` recorded at 13:51, where `scanned ==
    0` in its starve check is an unobservable disjunct: a census that declared zero files is not a
    census of zero orphans.
    """
    if not LOCALES.is_dir():
        return "the required directory `ui/src/locales` is missing"
    if not any(LOCALES.glob("*.ftl")):
        return "`ui/src/locales` holds no `.ftl` bundle"
    return None


def census() -> int:
    """Report whole-tree orphan candidates without blocking.

    Refuses BEFORE counting when the locale surface cannot be found at all; see
    `hollow_root_reason()`. Exit 2, not 1 -- in this file 1 means a verdict was reached about
    someone else's keys, and a tree with no bundles in it has produced no verdict.

    A surface that is there but will not OPEN is the third case, and it is not refused: this
    mode is advisory, and one locked bundle out of fifty-two is worth a line, not a lost
    report. `_read()` records it, `_report_unreadable()` names it above the numbers, and the
    run still exits 0 -- which is exactly why the line says the count is short: a 0 here means
    "the sheet printed", never "the tree is clean". The two modes that gate a commit do not
    carry this trade; they refuse.
    """
    hollow = hollow_root_reason()
    if hollow:
        print(f"error: cannot run --census here: {hollow} (looked under ROOT={ROOT}); nothing was "
              f"counted, so this refusal is not an orphan verdict.", file=sys.stderr)
        return 2
    names = set(declared_keys())
    owner = declared_keys()
    live = referenced(names)
    dead = names - live
    allow = set(load_allowlist().get("census", []))
    unaccounted = sorted(dead - allow)
    id_only = id_only_keys()
    # Every read this sheet is built from has now happened, so this is the first moment the
    # gap can be named BEFORE any number that gap makes wrong. Nothing else in this function
    # reads a file, and nothing after it does either.
    _report_unreadable()
    print(
        f"info[census]: {len(names)} declared en keys, {len(live)} referenced, "
        f"{len(dead)} candidates ({len(dead & allow)} allowlisted, "
        f"{len(unaccounted)} unaccounted)"
    )
    print(
        f"info[reverse-parity]: {len(id_only)} key(s) exist only in the Indonesian bundle. "
        f"Not a defect while nothing references them -- verify-bundle-parity.py already fails "
        f"on a reference resolving in English but not Indonesian, across getString, "
        f"<Localized id> and i18nKey sites. Reported as cleanup debt only."
    )
    for k in unaccounted[:25]:
        print(f"  candidate: {k}  ({owner[k]})")
    if len(unaccounted) > 25:
        print(f"  ... and {len(unaccounted) - 25} more")
    return 0


def check_staged() -> int:
    """The blocking check: what this commit adds and what it stops referencing.

    Three exits, and only one of them is a verdict: 0 when the scope was read and held
    nothing, 1 when it held a problem, 2 when the scope could not be read at all.
    """
    diff = staged_diff()
    if diff is None:
        # An unreadable index is not an empty one, so this prints no verdict and does not
        # exit 0. The hook treats it as the hard fail it already treats a FAIL as.
        print("verify-ftl-orphans: REFUSED -- git could not produce the staged diff "
              "(`git diff --cached -U0 -- ui/src/locales ui/src`), so the --staged-only "
              "scope is unknown, and an unknown scope is not an empty one. Nothing was "
              "checked here; git's own words, on stderr, name the command that failed.")
        return 2
    if not diff.strip():
        print("staged-only: nothing staged under ui/src; nothing to verify.")
        return 0
    added_en, added_id, removed_refs = changes_from_diff(diff)
    added_keys = added_en | added_id
    names = set(declared_keys())
    allow = set(load_allowlist().get("staged", []))
    problems: list[str] = []

    # 1. Keys this commit introduces must be reachable.
    if added_keys:
        live = referenced(added_keys)
        for k in sorted(added_keys - live - allow):
            problems.append(
                f"added key '{k}' has no reference in production UI, no consuming message in "
                f"any .ftl, and no composing prefix -- it is orphaned on arrival"
            )

    # 2. References this commit deletes must not strand a key.
    stranded: set[str] = set()
    for k in removed_refs & names:
        if k in added_keys:
            continue
        if k not in referenced({k}):
            stranded.add(k)
    for k in sorted(stranded - allow):
        problems.append(
            f"this commit removes the last reference to '{k}', leaving it in the bundle "
            f"unreferenced -- delete the message too, or allowlist it with a reason"
        )

    # 3. Report, but do NOT block, keys added to the Indonesian bundle with no English twin.
    # This started as a blocker on the theory that a reference resolving in Indonesian but not
    # English is invisible to every gate. That theory is false, and testing it is what killed it:
    # verify-bundle-parity.py reports "missing in en .ftl only" and does so across getString,
    # <Localized id> and i18nKey sites alike. Checking at the REFERENCE is strictly better than
    # the key-set symmetry check I proposed, because it flags only the one-sided keys that would
    # actually render a raw identifier to a user, and stays quiet about the 75 unreferenced dead
    # translations that are untidy but harmless. Blocking here would also reject a legitimate
    # sequence -- adding the Indonesian message in one commit and the English in the next.
    # So the count is surfaced as a signal and nothing more.
    one_sided = added_id & id_only_keys()

    print(
        f"staged-only: {len(added_keys)} key(s) added ({len(added_en)} en / {len(added_id)} id), "
        f"{len(removed_refs & names)} removed reference(s) resolved to declared keys, "
        f"{len(stranded)} stranded, {len(one_sided)} one-sided (informational)."
    )
    for k in sorted(one_sided):
        print(f"  info: '{k}' has no English definition; harmless while nothing references it, "
              f"and verify-bundle-parity.py fails if that changes.")
    if problems:
        print(f"\nFAIL: {len(problems)} orphan problem(s):", file=sys.stderr)
        for line in problems:
            print(f"  - {line}", file=sys.stderr)
        return 1
    print("ftl orphans: OK")
    return 0


def self_test() -> int:
    """Prove both blocking directions can actually fail.

    A gate nobody has seen go red is indistinguishable from a gate that cannot go red --
    the lesson behind every liveness case in this repo's gates.

    Refuses BEFORE parsing when the locale surface cannot be found at all, exactly as
    `census()` does; see `hollow_root_reason()`. Exit 2, not 1 -- in this mode 1 means the
    directions ran and at least one found something broken, and a ROOT with no bundles in it
    ran none of them. Unguarded, direction 2 indexed `real[0]` out of an empty declared-key
    list and died with an IndexError traceback at exit 1, which is what made a hollow
    invocation look like a self-test that had found a defect.

    A file that exists and will not OPEN is the same trap one layer down, answered the same
    way rather than in a new one: this mode blocks CI, so a PermissionError out of a bundle
    another session is writing raises UnreadableSource from _read() and main() exits 2 naming
    the path. It is not a direction that failed -- no direction ran over a complete tree -- and
    the 1 reserved for "a direction ran and found something broken" is not spent on it.
    """
    hollow = hollow_root_reason()
    if hollow:
        print(f"error: cannot run --self-test here: {hollow} (looked under ROOT={ROOT}); nothing "
              f"was exercised, so this refusal is not a self-test failure.", file=sys.stderr)
        return 2
    failures = 0

    # Direction 1: an added key with no reference anywhere must be reported.
    synthetic = "\n".join([
        "+++ b/ui/src/locales/shared.ftl",
        "+selftest-orphan-key-zz = Never referenced anywhere",
    ])
    added_en, added_id, removed = changes_from_diff(synthetic)
    added = added_en | added_id
    if added != {"selftest-orphan-key-zz"}:
        print(f"FAIL self-test: added-key extraction returned {added}", file=sys.stderr)
        failures += 1
    if added_id:
        print("FAIL self-test: an English-bundle addition was classified as Indonesian",
              file=sys.stderr)
        failures += 1
    if "selftest-orphan-key-zz" in referenced(added):
        print("FAIL self-test: a key nothing references was judged live", file=sys.stderr)
        failures += 1

    # Direction 1b: the same key added to an .id.ftl must land in the Indonesian set, not the
    # English one. Without this split the reverse-parity check has no input at all, and a
    # parser that lumps both locales together would still pass direction 1.
    synthetic_id = "\n".join([
        "+++ b/ui/src/locales/shared.id.ftl",
        "+selftest-onesided-key-zz = Kunci tanpa padanan Inggris",
    ])
    a_en2, a_id2, _ = changes_from_diff(synthetic_id)
    if a_id2 != {"selftest-onesided-key-zz"} or a_en2:
        print(f"FAIL self-test: id-bundle addition classified as en={a_en2} id={a_id2}",
              file=sys.stderr)
        failures += 1

    # Direction 2: a removed code line naming a real key must surface as a candidate.
    real = sorted(declared_keys())[:1]
    synthetic2 = "\n".join([
        "+++ b/ui/src/features/x/Y.tsx",
        f"-  getString('{real[0]}')",
    ])
    _, _, removed2 = changes_from_diff(synthetic2)
    if real[0] not in removed2:
        print("FAIL self-test: removed reference extraction missed a key name", file=sys.stderr)
        failures += 1

    # Direction 3: a composing prefix must actually RESCUE a family member. Asserting only
    # that detection "found something" let a real bug through: the capture group includes
    # '-', so `analytics-month-${m}` yielded 'analytics-month-' and the startswith test
    # looked for 'analytics-month--', silently rescuing nothing and inflating the census
    # from ~50 candidates to 295. The gate's own source is the fixture, so this fails if
    # the rescue ever breaks again.
    real_src = ui_blob()
    rescued = {n for n in ("analytics-month-jan", "analytics-granularity-monthly")
               if n in referenced({n})}
    if len(rescued) != 2:
        print(f"FAIL self-test: composing prefix did not rescue a known dynamic family "
              f"(rescued {sorted(rescued)}); dash handling is broken", file=sys.stderr)
        failures += 1

    # Direction 4: a key consumed only by another message must not be called an orphan.
    if not intra_bundle_refs({"workspace-home-cloud-sync-title"}):
        pass  # not necessarily referenced; only assert the mechanism exists on a known case
    known_intra = [n for n in declared_keys() if n in intra_bundle_refs({n})]
    if not known_intra:
        print("FAIL self-test: intra-bundle reference detection found no case at all",
              file=sys.stderr)
        failures += 1

    # Direction 5: reverse-parity detection must find real data, not just run. Asserting only
    # that the function returns without raising is the "0 id-map(s) inspected" failure -- a
    # clean result from an extractor that matched nothing. So: the known population must be
    # non-empty, a specific known member must be present, and a key defined in both locales
    # must be absent. That last clause is the one that catches a comparison inverted to
    # bundle_keys("en") - bundle_keys("id"), which would also report a confident number.
    one_sided = id_only_keys()
    if not one_sided:
        print("FAIL self-test: id_only_keys() found nothing, but the Indonesian bundle is "
              "known to carry keys with no English twin -- the check is hollow", file=sys.stderr)
        failures += 1
    probe = sorted(one_sided)[:1]
    if probe and probe[0] not in bundle_keys("id"):
        print("FAIL self-test: a reported id-only key is absent from the Indonesian bundle",
              file=sys.stderr)
        failures += 1
    both = bundle_keys("en") & bundle_keys("id")
    if not both:
        print("FAIL self-test: no key is defined in both locales, so the sets cannot be "
              "distinguished -- the derivation is broken", file=sys.stderr)
        failures += 1
    if one_sided & both:
        print("FAIL self-test: a key present in both locales was reported as one-sided",
              file=sys.stderr)
        failures += 1

    if failures:
        print(f"self-test: {failures} FAILURE(S)", file=sys.stderr)
        return 1
    print(f"self-test: OK (6 directions exercised, {len(one_sided)} one-sided keys detected)")
    return 0


def main() -> int:
    """Pick the mode, set the read contract, and hold the ONE unreadable-source handler.

    `_REPORT_UNREADABLE` is decided here and nowhere else, because the question -- what does
    a file that will not open cost this run? -- is a question about the consumer's contract,
    not about the file. `--census` is read by a human watching a trend and reports; the two
    modes that a hook step and a CI step trust to have CHECKED something refuse. The single
    `except` is the shape `verify-scoped-reads.py` settled on: one handler, one voice, and
    the exit code a busy file costs (2) never collides with the exit code a real orphan
    finding costs (1).

    Exits, all of them: 0 = checked and clean (or the census printed its sheet), 1 = a verdict
    that something is wrong with the keys, 2 = nothing was checked -- hollow ROOT, unreadable
    index, or a file that would not open.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged-only", action="store_true",
                        help="check only what the staged commit adds and stops referencing")
    parser.add_argument("--census", action="store_true",
                        help="report whole-tree orphan candidates informationally")
    parser.add_argument("--self-test", action="store_true",
                        help="exercise the diff parsers and prove the checks can fail")
    args = parser.parse_args()
    global _REPORT_UNREADABLE
    if args.self_test:
        mode, run = "--self-test", self_test
    elif args.census:
        mode, run = "--census", census
        _REPORT_UNREADABLE = True
    else:
        mode, run = "--staged-only", check_staged
    try:
        return run()
    except UnreadableSource:
        # The path is already in UNREADABLE -- _read() recorded it before raising. What
        # escapes here is a sentence naming it, and the 2 that says no verdict was reached.
        return _refusal(mode)


if __name__ == "__main__":
    sys.exit(main())
