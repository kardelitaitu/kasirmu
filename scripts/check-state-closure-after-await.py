#!/usr/bin/env python3
"""check-state-closure-after-await.py -- flag a setter that replaces state from a stale closure.

WHY THIS EXISTS
Round 201 of the restaurant-POS work found `handleSendToKitchen` in PosScreen.tsx sending a
delta of undispatched lines and then recording what was sent with:

    const updatedLines = lines.map((l) => ({ ...l, dispatchedQty: l.qty }));
    setLines(updatedLines);

`lines` is the render closure, captured BEFORE the await. The cart stays interactive while
the send is in flight, so a line added during it was absent from the replacement array and
`setLines` DROPPED it. Measured live: two lines, Send, add a third -- the cart came back with
two. The operator's item vanished with no message.

Round 202 hunted the same shape across all 741 production files and found no second
instance -- but the hunt also established WHY a grep cannot be the guard:

    const rows = await getLocalPaymentMethodsScoped(...);   // fresh value
    setDrafts(rows.map((r) => ({ ...r })));                 // CORRECT

    const updatedLines = lines.map((l) => ({ ...l }));      // `lines` is useState
    setLines(updatedLines);                                 // DEFECT

Identical syntax. The difference is WHERE THE VARIABLE CAME FROM -- an await in this handler,
or a useState binding read at render. That is not visible in the line, which is why the
defect survived review: it reads as the correct pattern.

WHAT IT DOES
Single-file analysis, no parsing library. For each source file it finds every `setX(v.map(`,
`setX(v.filter(` or `setX(v.concat(` where `v` is a lowercase identifier BOUND BY useState in
the same file, and where an `await` appears earlier in the enclosing function. Those are
reported with file:line.

It is deliberately narrow. A candidate is not a defect -- `setX(prev => ...)` and a value
reassigned from the await are both correct -- so the default run REPORTS and exits 0. The
point is a short list a human reads, not a gate that blocks a lane on a heuristic.

USAGE
  python3 scripts/check-state-closure-after-await.py             # report, exit 0
  python3 scripts/check-state-closure-after-await.py --strict    # exit 1 on any candidate
  python3 scripts/check-state-closure-after-await.py --json      # machine-readable
  python3 scripts/check-state-closure-after-await.py --self-test # assert the matcher

Exit codes: 0 report/clean, 1 --strict and candidates found, 2 self-test failure.
"""

import argparse
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SCAN_ROOT = os.path.join(ROOT, 'ui', 'src')
SKIP_DIRS = {'node_modules', 'dist', '__tests__', '__mocks__'}

# `setFoo(bar.map(` / `.filter(` / `.concat(` -- the array-shaped replacement.
# `setFoo(prev => ...)` deliberately does NOT match: the updater form is the fix.
# `setFoo(bar.map(` / `.filter(` / `.concat(` -- the array-shaped replacement.
# Also matches the SPLIT form, which is how the real defect reads:
#
#     const updatedLines = lines.map((l) => ({ ...l }));
#     setLines(updatedLines);
#
# The setter and the `.map(` are on different lines there, so a single-line regex
# missed the very case this file exists for -- and a self-test fixture written on
# one line passed. Both forms are matched: `setFoo(bar` captures the identifier,
# and the caller checks this line and the next for the array method.
SETTER_ARRAY_RE = re.compile(r'\bset([A-Z]\w*)\(\s*([a-z]\w*)\.(map|filter|concat)\(')
SETTER_ANY_RE = re.compile(r'\bset([A-Z]\w*)\(\s*([a-z]\w*)\s*\)')
ARRAY_METHOD_RE = re.compile(r'\b([a-z]\w*)\.(map|filter|concat)\(')
# `const [foo, bar] = useState(` / `const foo = useState(`
USE_STATE_RE = re.compile(r'\bconst\s+(?:\[\s*)?(\w+)|\bconst\s+(\w+)\s*=\s*useState')


def _state_bound_names(text):
    """Names that are state: a `useState` binding, or a value from a custom hook."""
    names = set()
    lines = text.splitlines()
    # 1. `const [a, setA] = useState(` / `const a = useState(`
    for line in lines:
        if 'useState' not in line:
            continue
        m = re.search(r'\bconst\s*\[\s*([\w, ]+)\]\s*=\s*useState', line)
        if m:
            for part in m.group(1).split(','):
                part = part.strip()
                if part:
                    names.add(part)
            continue
        m = re.search(r'\bconst\s+(\w+)\s*=\s*useState', line)
        if m:
            names.add(m.group(1))
    # 2. Destructured values from a CUSTOM HOOK. This is the case the first version
    #    missed and it is the one that mattered: PosScreen's `lines` comes from
    #    `usePosHeldCarts(...)`, not from `useState`, so a useState-only collector
    #    found ZERO candidates on a tree that contained the round-201 defect. The
    #    matcher passed its self-test on a `useState` fixture and was blind to the
    #    real shape -- a reminder that the self-test's fixture choice is itself a
    #    claim about where defects live.
    for i, line in enumerate(lines):
        if not re.search(r'=\s*use[A-Z]\w*\(', line):
            continue
        # The destructure may open on this line or the lines above it.
        head = line
        for n in range(i - 1, max(-1, i - 30), -1):
            if lines[n].strip().startswith('//'):
                continue
            head = lines[n] + '\n' + head
            if re.search(r'(const|let)\s*\{', lines[n]):
                break
        m = re.search(r'(?:const|let)\s*\{([^}]*)\}\s*=\s*use[A-Z]', head)
        if not m:
            m2 = re.search(r'(?:const|let)\s*\[([^\]]*)\]\s*=\s*use[A-Z]', head)
            if not m2:
                continue
            for part in m2.group(1).split(','):
                part = part.strip()
                if part and not part.startswith('set'):
                    names.add(part)
            continue
        for part in m.group(1).split(','):
            part = part.split(':')[0].strip()
            if part and not part.startswith('set'):
                names.add(part)
    return names


def _enclosing_start(lines, index):
    """The first line of the function or arrow body enclosing `index`, best effort."""
    # Walk BACKWARD for the nearest line that dedents past this one AND opens a body.
    # The window form of this (look back N lines for an `await`) was tried first and
    # produced a FALSE POSITIVE on StockTransfersScreen.tsx:250 -- `removeLineEntry`
    # has no await of its own, but the handler 20 lines above it does, and the window
    # reached it. Scoping to the enclosing body is what makes the report trustworthy.
    indent = len(lines[index]) - len(lines[index].lstrip())
    for n in range(index - 1, -1, -1):
        stripped = lines[n].strip()
        if not stripped or stripped.startswith('//') or stripped.startswith('*'):
            continue
        this_indent = len(lines[n]) - len(lines[n].lstrip())
        if this_indent >= indent:
            continue
        is_arrow_body = re.search(
            r'(=\s*(async\s*)?\(|=\s*async\s|\buseCallback\(|\buseMemo\()', lines[n]
        )
        is_named_fn = re.search(r'^\s*(export\s+)?(async\s+)?function\b', lines[n])
        if is_arrow_body or is_named_fn:
            return n
    return 0


def _enclosing_has_await(lines, index):
    """Whether an await appears between the enclosing body head and this line."""
    start = _enclosing_start(lines, index)
    for n in range(start, index):
        stripped = lines[n].strip()
        if stripped.startswith('//') or stripped.startswith('*'):
            continue
        if re.search(r'\bawait\b', lines[n]):
            return True
    return False


def scan_file(path):
    with open(path, encoding='utf-8', errors='replace') as handle:
        text = handle.read()
    lines = text.splitlines()
    state_names = _state_bound_names(text)
    if not state_names:
        return []
    found = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('//') or stripped.startswith('*'):
            continue
        # Two forms, and BOTH are needed.
        #
        #  a. single line:  setLines(lines.map((l) => ...))
        #  b. split:        const updatedLines = lines.map((l) => ...);
        #                   setLines(updatedLines);
        #
        # The real defect reads as (b), where the STATE-BOUND name appears on the
        # `.map(` line and the setter names a LOCAL. A matcher that only handles (a)
        # found nothing on a tree containing the bug -- and its self-test fixture,
        # written on one line, agreed with it.
        candidates = []
        # (a) single line: setter and .map( together.
        for m in SETTER_ARRAY_RE.finditer(line):
            candidates.append((m.group(1), m.group(2)))
        # (b) split, setter ABOVE the .map:  setLines(
        #                                    lines.map(
        # The identifier the setter names must be the one mapped on the next line.
        for m in SETTER_ANY_RE.finditer(line):
            if i + 1 < len(lines):
                nxt = ARRAY_METHOD_RE.search(lines[i + 1])
                if nxt and nxt.group(1) == m.group(2):
                    candidates.append((m.group(1), nxt.group(1)))
        # (c) split, .map ABOVE the setter -- THE FORM THE REAL DEFECT USES:
        #       const x = lines.map((l) => ...);
        #       setLines(x);
        # The setter's ARGUMENT must be the bound local the .map assigned, which is
        # what separates this from a JSX prop that happens to precede an unrelated
        # `.map(` -- measured 2026-10-14 on TopologyScreen:1000, where
        # `onChange={(id) => setCompareOtherBranchId(id)}` sits one line above an
        # `options={stores.filter(...).map(...)}` and matched without this check.
        here_map = re.search(
            r'\bconst\s+([a-z]\w*)\s*(?::[^=]+)?=\s*([a-z]\w*)\.(?:map|filter|concat)\(',
            line,
        )
        if here_map and i + 1 < len(lines):
            local, mapped = here_map.group(1), here_map.group(2)
            for m in SETTER_ANY_RE.finditer(lines[i + 1]):
                if m.group(2) == local and mapped in state_names:
                    candidates.append((m.group(1), mapped))
        for setter, var in candidates:
            if var not in state_names:
                continue
            if not _enclosing_has_await(lines, i):
                continue
            found.append({
                'file': os.path.relpath(path, ROOT).replace(os.sep, '/'),
                'line': i + 1,
                'setter': 'set' + setter,
                'variable': var,
                'text': stripped[:110],
            })
    return found


def iter_sources(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if not name.endswith(('.ts', '.tsx')):
                continue
            if '.test.' in name or '.spec.' in name:
                continue
            yield os.path.join(dirpath, name)


def run_scan():
    findings = []
    for path in iter_sources(SCAN_ROOT):
        findings.extend(scan_file(path))
    return findings


def self_test():
    """Assert the matcher on the shapes that must and must not fire."""
    cases = [
        # (label, source, expected_count)
        ('stale closure after await', '''
const [lines, setLines] = useState([]);
async function go() {
  await send();
  setLines(lines.map((l) => ({ ...l })));
}
''', 1),
        ('fresh awaited value', '''
const [drafts, setDrafts] = useState([]);
async function load() {
  const rows = await get();
  setDrafts(rows.map((r) => ({ ...r })));
}
''', 0),
        ('updater form is the fix', '''
const [lines, setLines] = useState([]);
async function go() {
  await send();
  setLines((prev) => prev.map((l) => l));
}
''', 0),
        ('no await at all', '''
const [lines, setLines] = useState([]);
function go() {
  setLines(lines.map((l) => l));
}
''', 0),
        ('variable is not state', '''
const [x, setX] = useState([]);
async function go() {
  const other = await get();
  setX(other.filter((y) => y));
}
''', 0),
    ]
    failures = 0
    for label, source, expected in cases:
        names = _state_bound_names(source)
        lines = source.splitlines()
        got = 0
        for i, line in enumerate(lines):
            for m in SETTER_ARRAY_RE.finditer(line):
                if m.group(2) in names and _enclosing_has_await(lines, i):
                    got += 1
        if got != expected:
            failures += 1
            print('  FAIL %-28s expected %d, got %d' % (label, expected, got))
        else:
            print('  ok   %-28s (%d)' % (label, got))
    if failures:
        print('self-test: %d failure(s)' % failures)
        return 2
    print('self-test: all %d cases pass' % len(cases))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--strict', action='store_true', help='exit 1 on any candidate')
    parser.add_argument('--json', action='store_true', help='machine-readable output')
    parser.add_argument('--self-test', action='store_true', help="assert the matcher's shapes")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    findings = run_scan()
    if args.json:
        print(json.dumps(findings, indent=2))
    else:
        if not findings:
            print('state-closure-after-await: 0 candidates in ui/src')
        else:
            print('state-closure-after-await: %d candidate(s) -- a setter replacing state'
                  ' from a variable bound by useState, after an await.' % len(findings))
            print('Each is a CANDIDATE, not a defect: confirm the variable is the stale'
                  ' closure and not the awaited value.')
            print()
            for f in findings:
                print('  %s:%d  %s(%s.%s(' % (f['file'], f['line'], f['setter'],
                                              f['variable'],'map'))
                print('      %s' % f['text'])
    return 1 if (args.strict and findings) else 0


if __name__ == '__main__':
    sys.exit(main())