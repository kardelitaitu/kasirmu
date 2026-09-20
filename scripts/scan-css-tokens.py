#!/usr/bin/env python3
"""
CSS Token Compliance Scanner
============================
Extracts all CSS custom properties (--*) defined in tokens.css,
then scans every .css file in ui/src/ for var(--...) references,
reporting:
  1. Non-existent tokens (used but not defined)
  2. Mismatched fallback hexes (fallback doesn't match actual token value)
  3. Orphaned tokens (defined but never used outside tokens.css)
"""

import os
import re
import sys
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
# THM-01: the design tokens live in ui/src/theme/tokens.css.
# (The old ui/src/styles/tokens.css path never existed — the scanner
# errored out immediately and could never run. A SECOND move did the same
# thing again: 7866197c7 "refactor(ui): move frontend/themes to theme/ and
# fix filesystem references" renamed the directory and fixed every reference
# EXCEPT the ones under scripts/, so this constant kept pointing at a path
# that no longer existed and the scanner went back to erroring out on line 1.
# Both stale names are kept in this comment on purpose: the next rename should
# grep for them.)
TOKENS_FILE = PROJECT_ROOT / "ui" / "src" / "theme" / "tokens.css"
UI_SRC_DIR = PROJECT_ROOT / "ui" / "src"
EXCLUDE_DIRS = {"node_modules"}

# ── 1. Parse tokens.css: extract token name -> value mappings ─────────────

# Matches token definitions that may span multiple lines.
# First line: "  --token-name: value_start"
# Subsequent lines: "    value_continuation"
# Terminated by a semicolon at end of a line.
SINGLE_LINE_TOKEN_RE = re.compile(r"^\s{2}--([a-zA-Z0-9_/-]+):\s*(.+?);\s*$")
MULTI_LINE_TOKEN_START_RE = re.compile(r"^\s{2}--([a-zA-Z0-9_/-]+):\s*(.+?)$")
CONTINUATION_LINE_RE = re.compile(r"^\s+(.+?)$")
VAR_REF_RE = re.compile(r"var\(--([a-zA-Z0-9_/-]+)\s*(?:,\s*(.*?))?\)")
COMMENT_BLOCK_RE = re.compile(r"/\*.*?\*/", re.DOTALL)

def parse_tokens(filepath: Path) -> dict[str, str]:
    """Return dict of token_name -> raw_value from :root block."""
    text = filepath.read_text(encoding="utf-8")
    text = COMMENT_BLOCK_RE.sub("", text)

    tokens: dict[str, str] = {}
    in_root = False
    brace_depth = 0
    current_token_name: str | None = None
    current_token_value: list[str] = []

    def flush_token() -> None:
        """If a multi-line token is being accumulated, save it."""
        nonlocal current_token_name, current_token_value
        if current_token_name is not None:
            value = " ".join(current_token_value).strip()
            tokens[current_token_name] = value
            current_token_name = None
            current_token_value = []

    for line in text.splitlines():
        stripped = line.strip()

        if stripped == ":root {":
            in_root = True
            brace_depth = 1
            continue

        if not in_root:
            continue

        brace_depth += stripped.count("{")
        brace_depth -= stripped.count("}")
        if brace_depth <= 0:
            flush_token()
            break

        # Check if this is a single-line token definition
        m = SINGLE_LINE_TOKEN_RE.match(line)
        if m:
            flush_token()  # flush any pending multi-line token
            name, value = m.group(1), m.group(2).strip()
            tokens[name] = value
            continue

        # Check if this is the start of a multi-line token definition
        m = MULTI_LINE_TOKEN_START_RE.match(line)
        if m:
            flush_token()
            current_token_name = m.group(1)
            current_token_value = [m.group(2).strip()]
            # Check if the value ends with ';' on this line (unusual but possible)
            if current_token_value[-1].endswith(";"):
                current_token_value[-1] = current_token_value[-1][:-1].strip()
                flush_token()
            continue

        # Check if this is a continuation of a multi-line token
        if current_token_name is not None:
            cm = CONTINUATION_LINE_RE.match(line)
            if cm:
                val = cm.group(1).strip()
                if val.endswith(";"):
                    val = val[:-1].strip()
                    current_token_value.append(val)
                    flush_token()
                else:
                    current_token_value.append(val)
            else:
                # Not a continuation — flush with what we have
                flush_token()

    flush_token()
    return tokens


# ── 2. Scan all CSS files for var() references ────────────────────────────

def find_all_css_files(directory: Path) -> list[Path]:
    """Recursively find all .css files, skipping EXCLUDE_DIRS."""
    files = []
    for root, dirs, filenames in os.walk(directory):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in filenames:
            if f.endswith(".css"):
                files.append(Path(root) / f)
    return sorted(files)


def find_var_references(filepath: Path) -> list[tuple[int, str, str | None]]:
    """
    Return list of (line_number, token_name, fallback_value_or_None)
    for every var(--...) in the file.
    """
    text = filepath.read_text(encoding="utf-8")
    refs = []
    for i, line in enumerate(text.splitlines(), start=1):
        for m in VAR_REF_RE.finditer(line):
            token = m.group(1)
            fallback = m.group(2)
            refs.append((i, token, fallback))
    return refs


# ── 3. Main scan logic ────────────────────────────────────────────────────

def main():
    print("=" * 72)
    print("  OZ-POS CSS Token Compliance Scanner")
    print("=" * 72)
    print()

    # Parse tokens from the single source of truth (THM-01 path fix)
    if not TOKENS_FILE.exists():
        print(f"ERROR: tokens.css not found at {TOKENS_FILE}")
        sys.exit(1)

    tokens = parse_tokens(TOKENS_FILE)
    print(f"[TOKENS] Tokens from theme/tokens.css: {len(tokens)}")
    print()

    known_tokens = set(tokens.keys())

    # Find all CSS files
    css_files = find_all_css_files(UI_SRC_DIR)
    css_files = [f for f in css_files if f.resolve() != TOKENS_FILE.resolve()]
    print(f"[FILES] CSS files scanned (excluding tokens.css): {len(css_files)}")
    print()

    # Scan for var() references
    all_refs: list[tuple[Path, int, str, str | None]] = []
    token_usage_count: dict[str, int] = defaultdict(int)

    for css_file in css_files:
        rel_path = css_file.relative_to(PROJECT_ROOT)
        refs = find_var_references(css_file)
        for line_no, token, fallback in refs:
            all_refs.append((rel_path, line_no, token, fallback))
            token_usage_count[token] += 1

    print(f"[REFS] Total var() references found: {len(all_refs)}")
    print()

    # ── Report 1: Non-existent tokens ───────────────────────────────
    non_existent = sorted([
        (token, count) for token, count in token_usage_count.items()
        if token not in known_tokens
    ], key=lambda x: -x[1])

    print("=" * 72)
    print("  SECTION 1: NON-EXISTENT TOKENS (used but not defined)")
    print("=" * 72)
    if non_existent:
        print(f"  FAIL: {len(non_existent)} non-existent tokens found ({sum(c for _, c in non_existent)} references)")
        print()
        for token, count in non_existent:
            print(f"    --{token}  ({count} reference{'s' if count > 1 else ''})")
            for fpath, lno, tok, fb in all_refs:
                if tok == token:
                    fb_str = f"  fallback: [{fb}]" if fb else ""
                    print(f"        {fpath}:{lno}{fb_str}")
            print()
    else:
        print("  PASS: All var() references use known tokens!")
        print()

    # ── Report 2: Mismatched fallback hexes ─────────────────────────
    print("=" * 72)
    print("  SECTION 2: MISMATCHED FALLBACK HEXES")
    print("=" * 72)
    print()

    mismatches = []
    for fpath, lno, token, fallback in all_refs:
        if not fallback or token not in known_tokens:
            continue
        actual_raw = tokens[token]
        if VAR_REF_RE.match(actual_raw):
            continue
        actual = actual_raw.strip().lower()
        fb_clean = fallback.strip().lower()
        if actual != fb_clean:
            mismatches.append((fpath, lno, token, fallback.strip(), actual_raw.strip()))

    if mismatches:
        by_token: dict[str, list] = defaultdict(list)
        for fpath, lno, token, fb, actual in mismatches:
            by_token[token].append((fpath, lno, fb, actual))

        print(f"  WARN: {len(mismatches)} mismatched fallback{'s' if len(mismatches) > 1 else ''} found:")
        print()
        for token, entries in sorted(by_token.items()):
            print(f"    --{token}")
            print(f"        Actual token value:  {tokens[token]}")
            for fpath, lno, fb, actual in entries:
                print(f"        {fpath}:{lno}  fallback: [{fb}]  (should be: [{actual}])")
            print()
    else:
        print("  PASS: All fallbacks match their token's actual value!")
        print()

    # ── Report 3: Orphaned tokens ───────────────────────────────────
    print("=" * 72)
    print("  SECTION 3: ORPHANED TOKENS (defined but never used)")
    print("=" * 72)
    print()

    tokens_css_refs: dict[str, int] = defaultdict(int)
    # Count self-references in the token definition file
    token_texts = [TOKENS_FILE.read_text(encoding="utf-8")]
    for text in token_texts:
        for m in VAR_REF_RE.finditer(text):
            token_name = m.group(1)
            if token_name in known_tokens:
                tokens_css_refs[token_name] += 1

    orphaned = []
    for token in sorted(known_tokens):
        used_externally = token_usage_count.get(token, 0)
        used_in_tokens_css = tokens_css_refs.get(token, 0)
        total_usage = used_externally + used_in_tokens_css
        if total_usage == 0:
            orphaned.append(token)

    if orphaned:
        print(f"  INFO: {len(orphaned)} orphaned tokens (defined but never referenced anywhere):")
        print()
        for token in orphaned:
            print(f"    --{token}  =  {tokens[token]}")
        print()
        print("  Note: some may be intentionally reserved for future use")
        print("  or referenced only in JS/TS (not CSS).")
        print()
    else:
        print("  PASS: All defined tokens are referenced somewhere!")
        print()

    # ── Section 4: Summary stats ────────────────────────────────────
    print("=" * 72)
    print("  SUMMARY")
    print("=" * 72)
    print(f"  Total tokens defined:      {len(tokens)}")
    print(f"  Total CSS files scanned:   {len(css_files)}")
    print(f"  Total var() references:    {len(all_refs)}")
    print(f"  Non-existent tokens:       {len(non_existent)}")
    print(f"  Mismatched fallbacks:      {len(mismatches)}")
    print(f"  Orphaned tokens:           {len(orphaned)}")
    print()

    if non_existent or mismatches:
        print("  RESULT: ISSUES FOUND -- see above for details.")
        sys.exit(1)
    else:
        print("  RESULT: ALL CLEAN -- every token reference is valid.")
        sys.exit(0)


if __name__ == "__main__":
    main()
