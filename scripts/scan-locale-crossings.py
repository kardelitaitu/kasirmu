#!/usr/bin/env python3
"""Locate where each en-only key's Indonesian twin actually lives.

A key declared in <domain>.ftl but translated in <other>.id.ftl resolves at
runtime because all 25 files are concatenated per locale — so the parity gate
is green while the file layout lies. This finds those crossings.
"""
# Promoted from the 2026-09-03 Fluent page audit; see
# docs/records/fluent-page-audit.md for why this check exists.

from __future__ import annotations

import re
import sys
from pathlib import Path

# Repo root, script-relative: scripts/ sits one level below it. An
# explicit path argument still wins, so the tool works from anywhere.
ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
LOCALES = ROOT / "shared-ui" / "locales"
KEY_VAL = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(.*)$")


def parse(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s and not s.startswith("#"):
            m = KEY_VAL.match(s)
            if m and m.group(1) not in out:
                out[m.group(1)] = m.group(2).strip()
    return out


en_files = {f.name[: -len(".ftl")]: parse(f)
            for f in sorted(LOCALES.glob("*.ftl")) if not f.name.endswith(".id.ftl")}
id_files = {f.name[: -len(".id.ftl")]: parse(f)
            for f in sorted(LOCALES.glob("*.id.ftl"))}

print("=== en keys whose id twin is NOT in the same domain ===")
crossings: list[tuple[str, str, str]] = []
for dom, kv in en_files.items():
    same = id_files.get(dom, {})
    for k in kv:
        if k in same:
            continue
        holders = [d for d, v in id_files.items() if k in v]
        if holders:
            crossings.append((dom, k, holders[0]))

by_pair: dict[tuple[str, str], list[str]] = {}
for dom, k, holder in crossings:
    by_pair.setdefault((dom, holder), []).append(k)

if not by_pair:
    print("  (none)")
for (dom, holder), keys in sorted(by_pair.items(), key=lambda x: -len(x[1])):
    print(f"  {dom}.ftl  ->  {holder}.id.ftl   ({len(keys)} keys)")
    for k in sorted(keys)[:12]:
        print(f"      {k}")
    if len(keys) > 12:
        print(f"      … +{len(keys) - 12} more")

print("\n=== id keys with NO en twin anywhere (id-only, unreachable in English) ===")
all_en = set().union(*(set(v) for v in en_files.values()))
for dom, kv in sorted(id_files.items()):
    orphan = [k for k in kv if k not in all_en]
    if orphan:
        print(f"  {dom}.id.ftl: {len(orphan)} id-only")
print(f"\ntotal cross-file en/id pairs: {sum(len(v) for v in by_pair.values())}")
