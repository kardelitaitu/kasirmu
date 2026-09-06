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


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


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


def staged_diff() -> str:
    return subprocess.run(
        ["git", "diff", "--cached", "-U0", "--", "ui/src/locales", "ui/src"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=ROOT).stdout


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
    if not ALLOWLIST_PATH.exists():
        return {}
    return json.loads(ALLOWLIST_PATH.read_text(encoding="utf-8"))


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


def census() -> int:
    """Report whole-tree orphan candidates without blocking."""
    names = set(declared_keys())
    owner = declared_keys()
    live = referenced(names)
    dead = names - live
    allow = set(load_allowlist().get("census", []))
    unaccounted = sorted(dead - allow)
    id_only = id_only_keys()
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
    """The blocking check: what this commit adds and what it stops referencing."""
    diff = staged_diff()
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
    """
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged-only", action="store_true",
                        help="check only what the staged commit adds and stops referencing")
    parser.add_argument("--census", action="store_true",
                        help="report whole-tree orphan candidates informationally")
    parser.add_argument("--self-test", action="store_true",
                        help="exercise the diff parsers and prove the checks can fail")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if args.census:
        return census()
    return check_staged()


if __name__ == "__main__":
    sys.exit(main())
