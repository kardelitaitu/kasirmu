#!/usr/bin/env python3
r"""
scripts/verify-topology-parity.py — Keep the topology semantic contract and
its verdict corpus consistent across the Rust/TypeScript boundary.

WHY
===

The topology semantic contract (`topologySemantics.json`) is consumed by
BOTH sides of the IPC boundary:

  1. Rust — `crates/oz-core/src/topology.rs` embeds a VENDORED copy
     (`crates/oz-core/src/topologySemantics.json`) via `include_str!` so
     compiling the cloud/desktop server never touches the UI tree
     (`.dockerignore` excludes `ui` entirely).
  2. TypeScript — `ui/src/features/locations/topologyContract.ts` and
     `topologyCard.ts` import the ORIGINAL `ui/src/features/locations/
     topologySemantics.json`.

If a developer edits the contract on one side and forgets the other, the
Rust and TS validation engines silently disagree about the same topology
graph — exactly the class of drift this script exists to catch before it
reaches production. The `oz-core` unit test
(`vendored_contract_matches_ui_canonical`) enforces the same invariant at
test time; this script makes it enforceable from CI and `scripts/check.sh`
without compiling anything.

PHASE 2 — THE CORPUS (ADR #45 §2)
=================================

Byte parity proves the two sides read the same file. It does NOT prove they
compute the same answer from it, and that second gap is the one that actually
shipped a bug once (CHANGELOG.md:144 / JOURNAL.md:3953: same JSON, two
hand-written rule sets, different error contract).

So the contract also carries a generated verdict corpus,
`crates/oz-core/src/topologySemantics.matrix.json` — every (pairing row ×
source kind × target kind) combination, produced by the Rust evaluator. Both
evaluators assert against it: `topology_matrix_golden_matches_the_rust_evaluator`
in Rust, and `ui/src/__tests__/topologyMatrix.test.ts` in TypeScript.

This script cannot run either evaluator, so it enforces the corpus's SHAPE:
that it exists, tracks the contract's schema version, holds exactly one row
per pairing in contract order, probes every declared kind, and covers each row
with the full kind cross-product. A stale or truncated golden fails here even
in a context where neither test binary is available.

Regenerate the corpus deliberately:

    TOPOLOGY_MATRIX_UPDATE=1 cargo test -p oz-core --lib topology_matrix

USAGE
=====

    python3 scripts/verify-topology-parity.py     # exit 1 on any drift

EXIT CODES
==========

  0  — contract copies are byte-identical (or the UI copy is absent, which
       is legal in a server-only build context — oz-core vendors its own)
       AND the corpus is consistent with the contract.
  1  — drift detected; the output names the files to reconcile.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Drift reports carry row labels, kind tokens and regeneration commands. On a
# Windows console defaulting to cp1252, a single non-encodable character in
# those strings raises UnicodeEncodeError and the script dies WITHOUT reporting
# the drift it found — a guard that fails closed by failing silently is worse
# than no guard. Force UTF-8 output, and never let an unencodable byte swallow
# a failure message.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

VENDORED = Path("crates/oz-core/src/topologySemantics.json")
UI = Path("ui/src/features/locations/topologySemantics.json")
MATRIX = Path("crates/oz-core/src/topologySemantics.matrix.json")


def check_contract_copies() -> int:
    """Phase 1: the two contract copies must be byte-identical."""
    if not VENDORED.exists():
        print(f"verify-topology-parity: missing vendored contract {VENDORED}")
        return 1
    if not UI.exists():
        print(
            "verify-topology-parity: ui/ absent (server-only build context) — "
            "vendored copy is authoritative here; nothing to compare."
        )
        return 0

    vendored = VENDORED.read_bytes()
    ui = UI.read_bytes()
    if vendored == ui:
        print(
            f"verify-topology-parity: OK — {VENDORED} and {UI} are "
            f"byte-identical ({len(vendored)} bytes)."
        )
        return 0

    # Locate the first differing line for an actionable message.
    vendored_lines = vendored.splitlines()
    ui_lines = ui.splitlines()
    first_diff = next(
        (
            i + 1
            for i, (a, b) in enumerate(zip(vendored_lines, ui_lines))
            if a != b
        ),
        min(len(vendored_lines), len(ui_lines)) + 1,
    )
    print(
        f"verify-topology-parity: DRIFT — {VENDORED} and {UI} differ "
        f"(first divergence around line {first_diff}).\n"
        "  Copy the edited copy across so the Rust include_str! and the TS "
        "import describe the same contract:\n"
        "    cp ui/src/features/locations/topologySemantics.json "
        "crates/oz-core/src/topologySemantics.json\n"
        "  (or the reverse, depending on which side owns the change)."
    )
    return 1


def check_corpus(contract: dict) -> int:
    """Phase 2: the generated verdict corpus must match the contract's shape."""
    if not MATRIX.exists():
        print(
            f"verify-topology-parity: missing corpus {MATRIX}\n"
            "  Regenerate it:\n"
            "    TOPOLOGY_MATRIX_UPDATE=1 cargo test -p oz-core --lib topology_matrix"
        )
        return 1

    try:
        matrix = json.loads(MATRIX.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"verify-topology-parity: {MATRIX} is not valid JSON — {exc}")
        return 1

    problems: list[str] = []

    if matrix.get("contractSchemaVersion") != contract.get("schemaVersion"):
        problems.append(
            f"corpus records schemaVersion "
            f"{matrix.get('contractSchemaVersion')!r} but the contract declares "
            f"{contract.get('schemaVersion')!r} — the corpus is stale"
        )

    pairings = contract.get("semanticPairings") or []
    want = [
        f"{r.get('source')}|{r.get('target')}|{r.get('relationshipType')}"
        for r in pairings
    ]
    got = [
        f"{r.get('source')}|{r.get('target')}|{r.get('relationshipType')}"
        for r in matrix.get("rows") or []
    ]
    if want != got:
        missing = [row for row in want if row not in got]
        extra = [row for row in got if row not in want]
        problems.append(
            "corpus rows do not mirror the contract pairings in order\n"
            f"    missing: {missing or '—'}\n"
            f"    unexpected: {extra or '—'}"
        )

    kinds = matrix.get("kinds") or []
    expected_kinds = [k for k in contract.get("nodeKinds") or [] if k != "workspace"]
    expected_kinds += [f"workspace:{key}" for key in contract.get("endpointWorkspaceTypeKeys") or []]
    unprobed = [kind for kind in expected_kinds if kind not in kinds]
    if unprobed:
        problems.append(f"corpus does not probe declared kinds: {unprobed}")

    size = len(kinds) ** 2
    for row in matrix.get("rows") or []:
        verdicts = row.get("verdicts") or {}
        label = f"{row.get('source')}->{row.get('target')}"
        if len(verdicts) != size:
            problems.append(
                f"corpus row {label} holds {len(verdicts)} verdicts, expected "
                f"{size} (every {kinds.__len__()}×{kinds.__len__()} kind pair)"
            )
            continue
        non_bool = [key for key, value in verdicts.items() if not isinstance(value, bool)]
        if non_bool:
            problems.append(f"corpus row {label} has non-boolean verdicts: {non_bool[:4]}")
        # A row with no admitted pair anywhere in the corpus is either an
        # unauthorable contract member or a broken evaluator — historically the
        # family-match rule failing made the Location row go all-false while
        # every test still passed. Force the question instead of shrugging.
        if not any(verdicts.values()):
            problems.append(
                f"corpus row {label} admits NO kind pair in the corpus. If the "
                "row is genuinely unauthorable today, add its kinds to "
                "corpus_kinds() in crates/oz-core/src/topology_tests.rs and "
                "regenerate; otherwise the endpoint evaluator is broken."
            )

    if problems:
        print(f"verify-topology-parity: CORPUS DRIFT — {MATRIX}")
        for problem in problems:
            print(f"  - {problem}")
        print(
            "  Regenerate deliberately and review the matrix diff:\n"
            "    TOPOLOGY_MATRIX_UPDATE=1 cargo test -p oz-core --lib topology_matrix"
        )
        return 1

    print(
        f"verify-topology-parity: OK — corpus covers {len(got)} pairings × "
        f"{len(kinds)} kinds ({len(got) * size} verdicts) at schemaVersion "
        f"{contract.get('schemaVersion')}."
    )
    return 0


def main() -> int:
    copies = check_contract_copies()
    source = UI if UI.exists() else VENDORED
    try:
        contract = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"verify-topology-parity: cannot read contract {source} — {exc}")
        return 1
    corpus = check_corpus(contract)
    return copies or corpus


if __name__ == "__main__":
    sys.exit(main())
