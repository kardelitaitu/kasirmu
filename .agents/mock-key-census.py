#!/usr/bin/env python3
"""Which dev-mock keys are load-bearing, and which are inert -- counted, not remembered.

WHY. A rule about the dev-mock alias pass went through one human paraphrase in this repo and came
out inverted, and the inverted version then blocked an owner decision. The rule as the ledger states
it (`answerable_sets`, scripts/verify-ipc-parity.py:817-821, and row T16): an unscoped mock key is an
**alias seed** when its `_scoped` twin is **NOT** explicitly registered -- only then does
`applyScopedAliases` copy it (ui/src/dev-mock/core/mockDispatcher.ts:91 guards on
`handlers[scoped] === undefined`). The paraphrase that got around said "never delete an unscoped key
whose `_scoped` twin IS registered", which protects exactly the 130 keys whose alias role can never
fire and endangers the 144 whose copy is the only thing answering their scoped name. T20 recorded an
open uncertainty in that inverted shape ("load-bearing as an alias seed until someone proves
otherwise") and it was never true of the name in question.

So: do not restate this rule in prose. Run this.

Usage:
    python .agents/mock-key-census.py            # populations + the two partitions' closures
    python .agents/mock-key-census.py --inert    # name the keys with no alias role and no caller
    python .agents/mock-key-census.py --seeds    # name the keys a deletion would orphan
"""
from __future__ import annotations

import argparse
import importlib.util
import pathlib
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load_gate():
    """Import the parity gate as a module so its extractors are the single source of truth.

    Deliberately not a re-implementation: the lesson of T32 is that a hand-written mirror of a
    gate's logic arrives carrying two bugs of its own, and the numbers here have to agree with the
    gate's own printed `aliasable` count or the whole census is decoration.
    """
    spec = importlib.util.spec_from_file_location(
        "pip", str(ROOT / "scripts" / "verify-ipc-parity.py"))
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--inert", action="store_true")
    ap.add_argument("--seeds", action="store_true")
    a = ap.parse_args()

    m = load_gate()
    per_file, alias_file = m.parse_dev_mock(m.read_dev_mock_sources())
    mock_keys, aliasable = m.answerable_sets(per_file, alias_file)
    ui = set(m.extract_ui_commands())

    unscoped = {k for k in mock_keys if not k.endswith("_scoped")}
    scoped_explicit = mock_keys - unscoped
    # The definition, spelled the way the CODE spells it: no explicit twin => the alias is the only
    # thing that can answer <name>_scoped.
    seeds = {k for k in unscoped if f"{k}_scoped" not in mock_keys}
    redundant = unscoped - seeds
    s_needed = {k for k in seeds if f"{k}_scoped" in ui}
    r_inert = {k for k in redundant if k not in ui}

    # Two closures asserted, not observed: the partitions must account for every key, and the seed
    # set must map onto exactly what the gate reports as aliasable. The SECOND one was wrong in the
    # first version of this file, where it compared `seeds` (unscoped base names) to `aliasable`
    # (the derived `_scoped` names) -- equal in count at 144 each, unequal as sets, because they are
    # two UNITS of the same 144 pairs rather than two populations. The guard fired on that in its
    # own print, "MISMATCH (144 vs 144)", which is the most useful shape a check can take: it does
    # not hide behind a matching number. Map through the same rule the gate uses before comparing.
    assert len(seeds) + len(redundant) == len(unscoped)
    assert len(unscoped) + len(scoped_explicit) == len(mock_keys)
    derived = {f"{k}_scoped" for k in seeds}
    agree = derived == aliasable

    print(f"dev-mock: {len(per_file)} files walked, alias pass at {alias_file}")
    print(f"  explicit mock keys: {len(mock_keys)}   = {len(unscoped)} unscoped + "
          f"{len(scoped_explicit)} explicitly _scoped")
    print(f"  ALIAS SEEDS (no explicit twin -> the copy is the only answer): {len(seeds)}")
    print(f"    of those, UI invokes the scoped name: {len(s_needed)}   nobody asks: "
          f"{len(seeds) - len(s_needed)}")
    print(f"  REDUNDANT (explicit twin exists -> the alias can never fire): {len(redundant)}")
    print(f"    of those, UI still names the unscoped call: {len(redundant) - len(r_inert)}   "
          f"fully inert: {len(r_inert)}")
    print(f"  agreement with the gate's own aliasable count: "
          f"{'EXACT' if agree else f'MISMATCH ({len(aliasable)} vs {len(seeds)})'}")
    if not agree:
        print("  --> the census and the gate disagree; do not act on either until that is fixed.")
        return 1

    if a.inert:
        print(f"\n  {len(r_inert)} keys with no alias role and no UI caller:")
        for k in sorted(r_inert):
            print(f"    {k}")
    if a.seeds:
        print(f"\n  {len(s_needed)} keys whose deletion would orphan a live scoped call:")
        for k in sorted(s_needed):
            print(f"    {k} -> {k}_scoped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
