#!/usr/bin/env python3
r"""
scripts/verify-release-workflow.py — Statically validate .github/workflows/release.yml.

WHY
===

`release.yml` was renamed to `release.yml.bak` by 23c96330 with an empty commit
message, and nothing noticed that pushing a `v*` tag had stopped producing
installers (R36-11). A workflow that never runs cannot report its own breakage,
so it accumulates errors that only surface at the moment of a real release --
which is the worst possible time to discover them.

This script closes that gap for the parts that are checkable WITHOUT a tag, a
signing key, or a macOS/Windows runner:

  1. the file parses, and parses as a GitHub workflow with a `v*` tag trigger
  2. every `uses:` action is pinned to a full 40-hex commit SHA (CICD-05), and
     that name@sha pair appears in another workflow in this repo -- so a typo'd
     or fabricated commit is a finding rather than a tag-time failure
  3. every `scripts/...` and `ops/install/...` path it invokes exists
  4. no residue from the docker matrix targets that were cut when this was
     restored desktop-only: a leftover `if: matrix.target == 'docker-cloud'`
     guard is dead weight, and an inventory gate demanding a `.tar` no job
     builds would fail every release
  5. the release asset inventory only demands extensions some matrix entry can
     actually produce
  6. a missing UPDATER_PRIVATE_KEY still hard-fails. This is the one that
     matters most: an UNSIGNED updater manifest is worse than no release at all,
     because every client rejects it and the failure appears on a customer's
     machine rather than in CI. Checking that the secret is merely *mentioned*
     passed a mutation that turned the guard into `exit 0`, so the guard's
     branch is required to contain `exit 1`.
  7. job ordering (publish needs build needs validate) and least privilege
     (repo-wide `contents: read`; writes confined to release-publish)

WHAT THIS DOES NOT PROVE
========================

That a real tagged build produces working installers. That needs the actual
runners and key material. The complementary automated proof is
`dev-ci.yml#release-readiness`, which runs `scripts/check-updater-compat.mjs` --
that builds a Rust harness pinned to the minisign-verify version the real Tauri
updater client uses and proves signatures from `generate-latest-json.mjs`
verify, and that a tampered installer is rejected.

Usage:
    python3 scripts/verify-release-workflow.py            # validate
    python3 scripts/verify-release-workflow.py --self-test # prove the checks bite
"""

from __future__ import annotations

import io
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    print("FAIL: PyYAML is required (pip install pyyaml)")
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows" / "release.yml"


def validate(text: str) -> list[str]:
    """Return a list of human-readable problems. Empty means the workflow is sound."""
    problems: list[str] = []

    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError as e:
        return [f"release.yml does not parse as YAML: {e}"]

    if not isinstance(doc, dict):
        return ["release.yml does not parse to a mapping"]

    jobs = doc.get("jobs") or {}
    if not jobs:
        problems.append("no jobs defined")

    # `on:` parses as Python True because YAML 1.1 treats bare `on` as a boolean.
    trig = doc.get("on", doc.get(True))
    if not trig:
        problems.append("no trigger defined")
    else:
        tags = (trig.get("push") or {}).get("tags") or []
        if not any("v*" in str(t) for t in tags):
            problems.append(f"push.tags does not include a v* pattern: {tags}")

    # ── Action pins ───────────────────────────────────────────────────
    known: set[tuple[str, str]] = set()
    for p in sorted((ROOT / ".github" / "workflows").glob("*")):
        if p == WF or not p.is_file():
            continue
        other = io.open(p, encoding="utf-8", errors="replace").read()
        known.update(re.findall(r"([A-Za-z0-9_.\-/]+)@([0-9a-f]{40})", other))

    # Actions bumped by Dependabot PRs (e.g. chore(deps) group updates) may
    # introduce new version SHAs for actions unique to release.yml (such as
    # signpath, upload/download-artifact, attest-build-provenance).
    try:
        import subprocess
        log_out = subprocess.run(
            ["git", "log", "--grep=dependabot", "--grep=chore(deps)", "-n", "5", "-p", "--", ".github/workflows"],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        ).stdout
        known.update(re.findall(r"([A-Za-z0-9_.\-/]+)@([0-9a-f]{40})", log_out))
    except Exception:
        pass

    for owner, sha in re.findall(r"uses:\s*([^\s#]+?)@([^\s#]+)", text):
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            problems.append(
                f"action {owner} is pinned to '{sha}', not a full commit SHA")
        elif (owner, sha) not in known:
            problems.append(
                f"action {owner}@{sha[:12]} appears in no other workflow -- "
                f"unverifiable pin (typo or fabricated SHA?)")

    # ── Referenced paths ──────────────────────────────────────────────
    # Each pattern is root-anchored with a lookbehind: without it, the unanchored
    # `install/...` pattern matched the TAIL of `ops/install/...` (P3 moved
    # install/ → ops/install/) and reported the workflow's real installer copies
    # as missing root paths. `(?:ops/)?` keeps both spellings checkable, and the
    # lookbehind stops a path component from claiming a shorter match mid-path.
    for pat in (r"(?<![\w./-])scripts/[A-Za-z0-9_.\-]+",
                r"(?<![\w./-])(?:ops/)?install/[A-Za-z0-9_./\-]+",
                r"(?<![\w./-])apps/[A-Za-z0-9_.\-/]+\.json"):
        for ref in sorted(set(re.findall(pat, text))):
            if not (ROOT / ref).exists():
                problems.append(f"referenced path missing: {ref}")

    # ── Docker residue ────────────────────────────────────────────────
    # `\.tar\b` rather than `.tar`: the bare substring also matches
    # `matrix.target`, which produced five false positives on the first run.
    for tok in ("docker", "trivy", "oz-pos-cloud", "oz-pos-license"):
        hits = [i + 1 for i, l in enumerate(text.splitlines())
                if tok in l.lower() and not l.lstrip().startswith("#")]
        if hits:
            problems.append(
                f"stale docker-era reference '{tok}' on live line(s) {hits[:5]}")
    tar_hits = [i + 1 for i, l in enumerate(text.splitlines())
                if re.search(r"\.tar\b", l) and not l.lstrip().startswith("#")]
    if tar_hits:
        problems.append(
            f"stale docker-era reference '.tar' on live line(s) {tar_hits[:5]}")

    # ── Inventory vs matrix ───────────────────────────────────────────
    matrix_ext: set[str] = set()
    for entry in (jobs.get("release-build", {})
                  .get("strategy", {}).get("matrix", {}).get("include", []) or []):
        for e in str(entry.get("bundle_ext", "")).split():
            matrix_ext.add(e)
    # Two `for ext in` loops exist: the per-target bundle check (whose list is a
    # `${{ matrix.bundle_ext }}` expression) and the final release inventory
    # (literal). Only the literal one can demand an artifact nothing builds.
    loops = re.findall(r"for ext in ([^;]+); do", text)
    literal = [l for l in loops if "${{" not in l]
    if not literal:
        problems.append("could not locate the literal release asset inventory loop")
    elif matrix_ext:
        unmakable = sorted(set(literal[0].split()) - matrix_ext)
        if unmakable:
            problems.append(
                f"inventory gate requires {unmakable} but no matrix target builds "
                f"them (matrix produces {sorted(matrix_ext)}) -- every release "
                f"would fail")

    # ── Signing must stay fatal ───────────────────────────────────────
    if "UPDATER_PRIVATE_KEY" not in text:
        problems.append(
            "UPDATER_PRIVATE_KEY no longer referenced -- manifest is unsigned")
    else:
        guard = re.search(
            r'if \[ -z "\$UPDATER_PRIVATE_KEY" \]; then(.*?)fi', text, re.S)
        if not guard:
            problems.append(
                "the UPDATER_PRIVATE_KEY absence guard was restructured or "
                "removed, so nothing proves a missing key still fails the release")
        elif "exit 1" not in guard.group(1):
            problems.append(
                "the missing-UPDATER_PRIVATE_KEY branch does not `exit 1` -- an "
                "UNSIGNED updater manifest would be published silently")

    # ── Ordering and privilege ────────────────────────────────────────
    if jobs.get("release-publish", {}).get("needs") != "release-build":
        problems.append("release-publish does not need release-build")
    if jobs.get("release-build", {}).get("needs") != "release-validate":
        problems.append("release-build does not need release-validate")

    top_perms = doc.get("permissions") or {}
    if top_perms.get("contents") != "read":
        problems.append(
            f"top-level permissions.contents is {top_perms.get('contents')!r}, "
            f"want read (CICD-01 least privilege)")
    pub_perms = jobs.get("release-publish", {}).get("permissions") or {}
    for need in ("contents", "id-token", "attestations"):
        if need not in pub_perms:
            problems.append(f"release-publish lacks permission {need}")

    return problems


# ── Self-test: does this script actually catch what it claims? ───────
# Without this, a regression in `validate` would silently turn the gate into a
# no-op -- the exact failure mode that let 16 fictional gates sit marked
# `required` in gates.json for a release cycle.
MUTATIONS: list[tuple[str, str, str]] = [
    ("demand an artifact nothing builds",
     "          for ext in AppImage exe dmg; do",
     "          for ext in AppImage exe dmg apk; do"),
    ("unpinned action",
     "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n      - uses: dtolnay/rust-toolchain@4360b52568e2003a75bf9bc1d59f33a8e3fc893c # stable",
     "      - uses: actions/checkout@v7\n      - uses: dtolnay/rust-toolchain@4360b52568e2003a75bf9bc1d59f33a8e3fc893c # stable"),
    ("fabricated action SHA",
     "      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
     "      - uses: actions/setup-node@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7.0.0"),
    ("reference a script that does not exist",
     "          node scripts/generate-latest-json.mjs --self-test",
     "          node scripts/generate-latest-manifest.mjs --self-test"),
    ("make unsigned manifests survivable",
     '            echo "::error::UPDATER_PRIVATE_KEY secret is not set \u2014 cannot sign updater manifest"\n            exit 1',
     '            echo "UPDATER_PRIVATE_KEY secret is not set -- skipping signing"\n            exit 0'),
    ("leave a docker guard behind",
     "      - name: Install cargo-nextest",
     "      - name: Scan docker image\n        if: matrix.target == 'docker-cloud'\n        run: echo trivy\n      - name: Install cargo-nextest"),
    ("publish stops waiting for build",
     "    needs: release-build\n    runs-on: ubuntu-latest\n    timeout-minutes: 30",
     "    runs-on: ubuntu-latest\n    timeout-minutes: 30"),
    ("grant write token repo-wide",
     "permissions:\n  contents: read\n\ndefaults:",
     "permissions:\n  contents: write\n  id-token: write\n\ndefaults:"),
]


def self_test() -> int:
    if not WF.is_file():
        print(f"FAIL: {WF} not found")
        return 1
    original = io.open(WF, encoding="utf-8").read()

    base = validate(original)
    if base:
        print(f"FAIL: baseline release.yml is not clean ({len(base)} problem(s)):")
        for p in base:
            print(f"    - {p}")
        return 1
    print("  baseline: release.yml clean")

    rc = 0
    for name, old, new in MUTATIONS:
        if old not in original:
            print(f"  SKIP    {name:40s} anchor missing -- test needs updating")
            rc = 1
            continue
        found = validate(original.replace(old, new, 1))
        ok = bool(found)
        print(f"  {'CAUGHT ' if ok else 'MISSED!'} {name:40s} "
              f"{(found[0][:60] if found else '')}")
        if not ok:
            rc = 1
    if rc == 0:
        print(f"\n  self-test: all {len(MUTATIONS)} mutations caught")
    else:
        print("\n  self-test: a mutation slipped through -- the gate is weaker than claimed")
    return rc


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()
    if not WF.is_file():
        print(f"FAIL: {WF} not found")
        return 1
    problems = validate(io.open(WF, encoding="utf-8").read())
    if problems:
        print(f"verify-release-workflow: {len(problems)} problem(s) in release.yml:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("verify-release-workflow: release.yml validates "
          "(pins, paths, inventory, signing guard, ordering, privileges)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
