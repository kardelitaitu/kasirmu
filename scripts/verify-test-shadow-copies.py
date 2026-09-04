#!/usr/bin/env python3
"""Detect test files that shadow production code with a private copy.

WHY THIS EXISTS
---------------
Five suites were found in one sweep asserting against a reimplementation of the thing they
claimed to test. The worst (KdsAutoAcceptLogic, fixed in 314b7783) guarded double-fire with

    if (inFlight.has(order.status)) return false; // simplified -- real impl checks order.id

where production keys on order id. The author annotated the wrongness in the copy, and the
suite stayed green -- including a test named "rejects when order is in-flight" that fed the
copy a status, so it validated a rule the application does not implement.

HOW IT DECIDES
--------------
A candidate is a top-level function declared in a test file whose NAME also exists as a
top-level function in production, and which the test file does not import. That alone is
only ~50% precise: SettingsNavTree's getNavItems() is a DOM query helper while the
production getNavItems() filters a registry, and colorContrastCompliance's hexToRgb()
returns a tuple where production returns an object. Name collisions are normal.

So the candidate must also be SIMILAR in body. Tokens are compared after stripping
keywords, type annotations and identifiers shorter than two characters, as a Jaccard index.
Measured on labelled cases with the current extractor: real shadows score 1.000
(KdsContrastTextBoundary's contrastText, a byte-for-byte copy) and 0.750
(KdsCourseDoneLogic's itemDone, same rule, different parameter shape); name collisions score
0.333 (colorContrastCompliance's hexToRgb -- returns a tuple where production returns an
object, slices where production bit-shifts) and 0.091 (SettingsNavTree's getNavItems -- a
DOM query helper against a registry filter). The gap runs 0.333 -> 0.750, so THRESHOLD is
0.50.

That number was 0.25 when this file was first written, derived from a broken find_body()
that read hexToRgb's RETURN TYPE brace as its function body and therefore scored it 0.000.
The weak datapoint was flagged in the commit that shipped the sweep; fixing the extractor
moved it to 0.333 and invalidated the threshold. Re-derive after any change to find_body.

WHAT IT DELIBERATELY DOES NOT DO
--------------------------------
It does not grep for confession comments ("same logic as", "reimplement"). That was the
first idea and it is unusable: 7 hits, 5 false positives, because the phrase also appears
in comments explaining that a shadow copy was REMOVED. A gate that fires on its own fix
teaches people to ignore it.

Exit 0 = clean, 1 = findings, 2 = usage or internal error.
"""

import argparse
import io
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_DIR = os.path.join(REPO, "ui", "src", "__tests__")
PROD_DIRS = [
    os.path.join(REPO, "ui", "src", d)
    for d in ("features", "hooks", "utils", "api", "contexts", "platform", "components")
]

THRESHOLD = 0.50

FN_DEF = re.compile(r"^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(", re.M)
IMPORT_BRACES = re.compile(r"^import\s+(?:type\s+)?\{([^}]*)\}", re.M)

STOP = {
    "const", "let", "var", "return", "function", "if", "else", "try", "catch", "throw",
    "new", "typeof", "instanceof", "as", "number", "string", "boolean", "true", "false",
    "null", "undefined", "void", "export", "async", "interface", "type", "for", "of",
    "in", "while", "switch", "case", "break", "continue", "default", "extends", "implements",
    "public", "private", "readonly", "await", "yield", "this",
}


def read(path):
    try:
        return io.open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return ""


def find_body(text, start):
    """Return (body_text, ok) for the function body whose search began at `start`.

    `start` points at the '(' of the parameter list. Skips the balanced parameter list,
    then locates the body brace. A TypeScript return type can itself be an object literal
    -- `function hexToRgb(h: string): { r: number; g: number } {` -- and treating that
    first brace as the body yields an empty token set, which silently scores a real shadow
    as a collision. So after taking a candidate brace block, if the next non-space
    character is another '{', the block was a return type and we keep looking.
    """
    def match_delim(i, opener, closer):
        depth, j = 0, i
        while j < len(text):
            c = text[j]
            if c == opener:
                depth += 1
            elif c == closer:
                depth -= 1
                if depth == 0:
                    return j
            j += 1
        return -1

    close = match_delim(start, "(", ")")
    if close < 0:
        return "", False
    i = close + 1
    # Skip a generic return-type annotation like `: Array<{ a: number }>`
    while i < len(text) and text[i] in " \t\n\r":
        i += 1
    if i < len(text) and text[i] == ":":
        j = i + 1
        angle = 0
        while j < len(text):
            c = text[j]
            if c == "<":
                angle += 1
            elif c == ">":
                angle -= 1
            elif c == "{" and angle == 0:
                break
            elif c == ";" and angle == 0:
                return "", False
            j += 1
        i = j
    while i < len(text):
        if text[i] == "{":
            end = match_delim(i, "{", "}")
            if end < 0:
                return "", False
            k = end + 1
            while k < len(text) and text[k] in " \t\n\r":
                k += 1
            if k < len(text) and text[k] == "{":
                # This block was a return type; the body follows.
                i = k
                continue
            return text[i:end + 1], True
        elif text[i] in ";=" or i >= len(text):
            return "", False
        i += 1
    return "", False


def tokens(body):
    return {t for t in re.findall(r"[A-Za-z_$][\w$]*", body)
            if t not in STOP and len(t) > 1}


def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def imported_names(text):
    names = set()
    for m in IMPORT_BRACES.finditer(text):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            part = re.sub(r"^type\s+", "", part)
            names.add(part.split(" as ")[-1].strip())
    return names


def collect_prod():
    """name -> list of (path, body_tokens)."""
    prod = {}
    for d in PROD_DIRS:
        if not os.path.isdir(d):
            continue
        for root, _dirs, files in os.walk(d):
            if "__tests__" in root:
                continue
            for fn in files:
                if not fn.endswith((".ts", ".tsx")):
                    continue
                path = os.path.join(root, fn)
                text = read(path)
                for m in FN_DEF.finditer(text):
                    body, ok = find_body(text, m.end() - 1)
                    if not ok:
                        continue
                    prod.setdefault(m.group(1), []).append((path, tokens(body)))
    return prod


def scan(threshold=THRESHOLD):
    prod = collect_prod()
    findings = []
    all_candidates = []
    examined = 0
    candidates = 0
    if not os.path.isdir(TEST_DIR):
        return None
    for fn in sorted(os.listdir(TEST_DIR)):
        if not fn.endswith((".ts", ".tsx")):
            continue
        path = os.path.join(TEST_DIR, fn)
        text = read(path)
        imported = imported_names(text)
        for m in FN_DEF.finditer(text):
            name = m.group(1)
            examined += 1
            if name not in prod or name in imported:
                continue
            candidates += 1
            body, ok = find_body(text, m.end() - 1)
            if not ok:
                continue
            mine = tokens(body)
            # Seed from the first production match rather than from 0.0: a genuine
            # zero-similarity collision left best_path as "" and crashed the relpath
            # below. The self-test's collision case is what surfaced it.
            best = -1.0
            best_path = prod[name][0][0]
            for ppath, ptoks in prod[name]:
                s = jaccard(mine, ptoks)
                if s > best:
                    best, best_path = s, ppath
            row = {
                "test": os.path.relpath(path, REPO).replace("\\", "/"),
                "line": text[:m.start()].count("\n") + 1,
                "function": name,
                "similarity": round(best, 3),
                "production": os.path.relpath(best_path, REPO).replace("\\", "/"),
            }
            all_candidates.append(row)
            if best >= threshold:
                findings.append(row)
    return findings, examined, candidates, len(prod), all_candidates


def self_test():
    """Prove the detector can fail. A static gate with no liveness case is indistinguishable
    from a gate that passes, and this session has been bitten by that often enough that the
    check ships with its own proof."""
    import tempfile
    ok = True

    def run(tmp):
        global TEST_DIR, PROD_DIRS
        old_t, old_p = TEST_DIR, PROD_DIRS
        TEST_DIR = os.path.join(tmp, "__tests__")
        PROD_DIRS = [os.path.join(tmp, "prod")]
        try:
            return scan()
        finally:
            TEST_DIR, PROD_DIRS = old_t, old_p

    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "__tests__"))
        os.makedirs(os.path.join(tmp, "prod"))
        prod_src = (
            "export function computeTax(amount: number, rate: number): number {\n"
            "  const net = amount / (1 + rate);\n"
            "  return Math.round((amount - net) * 100) / 100;\n}\n"
        )
        with open(os.path.join(tmp, "prod", "tax.ts"), "w", encoding="utf-8") as f:
            f.write(prod_src)

        # 1. A faithful shadow must be reported.
        with open(os.path.join(tmp, "__tests__", "Shadow.test.ts"), "w", encoding="utf-8") as f:
            f.write(
                "import { describe, it, expect } from 'vitest';\n"
                "function computeTax(amount: number, rate: number): number {\n"
                "  const net = amount / (1 + rate);\n"
                "  return Math.round((amount - net) * 100) / 100;\n}\n"
                "describe('x', () => { it('y', () => { expect(computeTax(1, 2)).toBe(3); }); });\n"
            )
        res = run(tmp)
        found = res[0]
        if len(found) == 1 and found[0]["function"] == "computeTax":
            print("  ok    faithful shadow is reported")
        else:
            print(f"  FAIL  faithful shadow not reported: {found}")
            ok = False

        # 2. Importing the real function must clear it.
        with open(os.path.join(tmp, "__tests__", "Shadow.test.ts"), "w", encoding="utf-8") as f:
            f.write(
                "import { describe, it, expect } from 'vitest';\n"
                "import { computeTax } from '../prod/tax';\n"
                "describe('x', () => { it('y', () => { expect(computeTax(1, 2)).toBe(3); }); });\n"
            )
        res = run(tmp)
        if res[0] == []:
            print("  ok    importing the real function clears the finding")
        else:
            print(f"  FAIL  still reported after import: {res[0]}")
            ok = False

        # 3. A same-named function with a different body must NOT be reported.
        with open(os.path.join(tmp, "__tests__", "Shadow.test.ts"), "w", encoding="utf-8") as f:
            f.write(
                "import { describe, it, expect } from 'vitest';\n"
                "function computeTax(input: string): string {\n"
                "  return input.trim().toLowerCase().replace(/\\s+/g, '-');\n}\n"
                "describe('x', () => { it('y', () => { expect(computeTax('A')).toBe('a'); }); });\n"
            )
        res = run(tmp)
        if res[0] == []:
            print("  ok    name collision with a different body is not reported")
        else:
            print(f"  FAIL  collision reported: {res[0]}")
            ok = False

        # 4. Liveness of the population itself: an empty production tree must be loud.
        empty = os.path.join(tmp, "empty")
        os.makedirs(os.path.join(empty, "__tests__"), exist_ok=True)
        os.makedirs(os.path.join(empty, "prod"), exist_ok=True)
        res = run(empty)
        if res[1] == 0:
            print("  ok    empty corpus reports examined=0 (visible, not silently clean)")
        else:
            print(f"  FAIL  empty corpus reported examined={res[1]}")
            ok = False

    print("  SELF-TEST:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true", help="prove the detector can fail")
    ap.add_argument("--json", action="store_true", help="machine-readable findings")
    ap.add_argument("--calibrate", action="store_true",
                    help="print every candidate's similarity, not just those over threshold")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    res = scan(0.0) if args.calibrate else scan()
    if res is None:
        print("verify-test-shadow-copies: no test directory found -- nothing examined",
              file=sys.stderr)
        return 2
    findings, examined, candidates, prod_names, all_candidates = res

    if examined == 0 or prod_names == 0:
        print(f"verify-test-shadow-copies: EMPTY POPULATION (functions examined={examined}, "
              f"production names={prod_names}); a clean result here means the check looked "
              f"at nothing, not that it passed.", file=sys.stderr)
        return 2

    if args.calibrate:
        print(f"every name collision ranked by body similarity "
              f"({len(all_candidates)} candidates, threshold {THRESHOLD}):")
        for row in sorted(all_candidates, key=lambda r: -r["similarity"]):
            mark = "SHADOW " if row["similarity"] >= THRESHOLD else "collision"
            print(f"  {row['similarity']:6.3f}  {mark}  {row['test'].split('/')[-1]}"
                  f":{row['line']}  {row['function']}()  vs "
                  f"{row['production'].split('/')[-1]}")
        print("\nLabel these by reading both bodies, then set THRESHOLD inside the gap.")
        print("A threshold derived from an unlabelled or mis-extracted score is how this")
        print("file shipped with 0.25 for a while -- see the module docstring.")
        return 0

    if args.json:
        print(json.dumps({"findings": findings, "examined": examined,
                          "candidates": candidates, "threshold": THRESHOLD}, indent=2))
        return 1 if findings else 0

    print(f"verify-test-shadow-copies: threshold={THRESHOLD}  "
          f"production function names={prod_names}  "
          f"test-level functions examined={examined}  "
          f"name collisions={candidates}  shadows={len(findings)}")
    for f in findings:
        print(f"  {f['test']}:{f['line']}  {f['function']}()  similarity={f['similarity']}"
              f"  shadows {f['production']}")
        print(f"      -> import the real function instead of redeclaring it; if the name "
              f"collides by accident, rename the test helper.")
    if findings:
        plural = "y" if len(findings) == 1 else "ies"
        print(f"\nverify-test-shadow-copies: {len(findings)} shadow copy{plural} "
              f"-> tests may be validating code that never runs")
        return 1
    print("verify-test-shadow-copies: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
