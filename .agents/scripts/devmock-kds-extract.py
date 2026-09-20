#!/usr/bin/env python3
from pathlib import Path
import re

REPO = Path(__file__).resolve().parents[1]
SRC = REPO / "ui" / "src" / "dev-mock" / "tauri-api.ts"
HDIR = REPO / "ui" / "src" / "dev-mock" / "handlers"
CLASS = REPO / ".agents" / "devmock-phase40-classify.txt"

# Symbols that stay in the router
ROUTER_RESERVED = {"kdsDisplayCounter", "maxDisplay", "pushKdsOrderFromCart"}

DEF_RE = re.compile(r"^(const|let|var|function|interface|type|class|enum)\s+")

def read_spans(class_file):
    spans = {}
    current = None
    for ln in class_file.read_text().splitlines():
        if ln.startswith("## a4_kds"):
            current = "kds"
        elif ln.startswith("## "):
            current = None
        elif current and not ln.startswith("#") and ln.strip():
            parts = ln.strip().split()
            if len(parts) >= 3 and "-" in parts[0]:
                s = int(parts[0].rstrip("-"))
                e = int(parts[1])
                spans.setdefault(current, []).append((s, e))
    return spans

def find_kds_defs(lines):
    """Find module-level definitions whose line contains a KDS keyword."""
    defs = []
    for i, ln in enumerate(lines):
        if not (ln.startswith("const") or ln.startswith("let") or ln.startswith("var") or ln.startswith("function") or ln.startswith("interface") or ln.startswith("type")):
            continue
        if not re.search(r'kds|kitchen', ln, re.I):
            continue
        # Extract identifier
        m = re.search(r'(?:const|let|var|function|interface|type|class|enum)\s+([A-Za-z_][A-Za-z0-9_]*)', ln)
        if not m:
            continue
        ident = m.group(1)
        if ident in ROUTER_RESERVED:
            continue
        defs.append((i, ident))
    return defs

def block_end(lines, start_idx):
    """Find the line before the next module-level definition."""
    for j in range(start_idx + 1, len(lines)):
        ln = lines[j]
        if ln.startswith("const") or ln.startswith("let") or ln.startswith("var") or ln.startswith("function") or ln.startswith("interface") or ln.startswith("type") or ln.startswith("class") or ln.startswith("enum"):
            return j - 1
    return len(lines) - 1

def merge_blocks(blocks):
    """Merge overlapping or adjacent blocks (gap <= 2 lines)."""
    if not blocks:
        return []
    sorted_blocks = sorted(blocks, key=lambda x: x[0])
    merged = [list(sorted_blocks[0])]
    for s, e in sorted_blocks[1:]:
        if s <= merged[-1][1] + 3:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    return [(m[0], m[1]) for m in merged]

lines = SRC.read_text(encoding="utf-8").split("\n")
spans = read_spans(CLASS)

# Find KDS state blocks
kds_defs = find_kds_defs(lines)
blocks = []
for idx, ident in kds_defs:
    end = block_end(lines, idx)
    blocks.append((idx, end))

state_blocks = merge_blocks(blocks)
print(f"KDS state blocks: {len(state_blocks)}")
for s, e in state_blocks:
    print(f"  {s+1}-{e+1}  {lines[s][:60]}")

# Build kds.ts
state_texts = []
for s, e in state_blocks:
    state_texts.append("\n".join(lines[s:e+1]))

entry_lines = []
for s, e in spans.get("kds", []):
    for ln in lines[s-1:e]:
        entry_lines.append(ln)

# Determine exports: everything defined in state_blocks
exports = []
for idx, ident in kds_defs:
    exports.append(ident)
# Deduplicate and sort
exports = sorted(set(exports))

kds_ts = f"""/**
 * Dev-mock handlers — KDS domain.
 *
 * Kitchen display system: orders, line items, statuses, auto-generation
 * and auto-progress. Extracted from `tauri-api.ts` by the agent-4 work order
 * (`todo-refactor-devmock-agents-4.md`, phase 4.1); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * This module is self-contained: it needs no injected dependencies and
 * exports a plain map rather than a factory. `kdsDisplayCounter` and
 * `pushKdsOrderFromCart` stay in the router (they are shared with sales).
 */

import type {{ MockHandler }} from '../core/mockDispatcher';

"""
for st in state_texts:
    kds_ts += st + "\n\n"

kds_ts += "export const kdsHandlers: Record<string, MockHandler> = {{\n"
kds_ts += "\n".join(entry_lines)
kds_ts += "\n}};\n"
if exports:
    kds_ts += f"export {{ {', '.join(exports)} }};\n"

(HDIR / "kds.ts").write_text(kds_ts, encoding="utf-8")
print("wrote kds.ts")

# Remove from router
remove = set()
for s, e in spans.get("kds", []):
    remove.update(range(s-1, e))
for s, e in state_blocks:
    remove.update(range(s, e+1))

new_lines = [ln for i, ln in enumerate(lines) if i not in remove]

# Insert import after loyaltyHandlers import
for idx, ln in enumerate(new_lines):
    if "import { loyaltyHandlers } from './handlers/loyalty';" in ln:
        new_lines.insert(idx + 1, "import { kdsHandlers } from './handlers/kds';")
        break

# Insert registration after loyaltyHandlers registration
for idx, ln in enumerate(new_lines):
    if "registerHandlers(loyaltyHandlers);" in ln:
        new_lines.insert(idx + 1, "registerHandlers(kdsHandlers);")
        break

SRC.write_text("\n".join(new_lines), encoding="utf-8")
print("rewrote tauri-api.ts")
