#!/usr/bin/env python3
"""Classify each `verify-scoped-reads` finding by whether the code can run at all.

WHY THIS EXISTS

`verify-scoped-reads.py` answers one question exactly: does this call site sit inside a
guard the walk can see? It cannot answer the question an operator actually has, which is
whether the code runs. Three of its tablet findings in round 151 were unreachable on BOTH
shells because nothing renders the component; six more were behind a conditional render one
component up, which no per-call-site walk can express. A finding list that mixes 'this is
broken' with 'this cannot execute' is a list nobody reads.

So this script does NOT re-grade the guards. It takes the finding list as given and asks a
different, mechanical question per finding: is the module that contains this call reachable
in a production bundle?

HOW REACHABILITY IS DECIDED, and why it needs three rules

A single 'is it rendered?' check would be wrong for most of the tree. The module holding a
finding is one of three kinds, and each is reached differently:

  component  rendered as JSX:        <Name ... />
  hook       CALLED:                useName(...)
  screen     REGISTERED, not rendered by a parent: component: Name in a register call

Measured 2026-10-25: a JSX-only rule reported TopologyScreen, WarehouseConsole, useKeyAge,
useRestore and useTerminalProfile as unreachable. Every one of those is live -- the screens
are registered, the hooks are called. Five false 'dead' verdicts from one wrong predicate,
which is the direction that gets a real defect deleted.

THE TRAP THIS FILE EXISTS TO AVOID

The FIRST version of this check searched for the FILE name (`useKeyAge`) and reported zero
consumers. The consumer imports `useKeyRotationReminder` -- a different symbol in the same
file -- so the search was for the wrong string and the verdict was wrong in the alarming
direction. This script resolves the file's EXPORTED SYMBOLS and searches for each of them,
because the symbol that consumes a module is not named after the module.

WHAT IT REPORTS

  REACHABLE     at least one production reference outside the defining file
  DEAD          no production reference: nothing in the shipped bundle can reach it
  UNRESOLVED    the module could not be matched to a file; never silently dead

USAGE

    python scripts/classify-finding-reachability.py            # grade the tree
    python scripts/classify-finding-reachability.py --self-test

Exit 0 always for the report (it is informational), 2 on a malformed input, and with
--strict, 1 when any finding is DEAD -- so CI can fail on the next dead surface rather than
discovering it three findings later.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The two shells and the file whose generate_handler![...] list is their registration.
SHELL_HANDLERS = {
    'desktop': os.path.join('apps', 'desktop-tauri', 'src', 'lib.rs'),
    'tablet': os.path.join('apps', 'mobile-tauri', 'src', 'lib.rs'),
}
UI_SRC = os.path.join(REPO, 'ui', 'src')

# Directories whose contents never ship.
SKIP_DIRS = {'__tests__', 'dev-mock', 'node_modules', 'dist', 'dist-mobile'}


def strip_comments(text):
    """Blank // and /* */ comments, preserving nothing but the code.

    Comments are blanked rather than deleted because every one of the false references in
    round 151 was a COMMENT -- SecurityAccountScreen.tsx:33 names EmailReportSettings in
    prose, and a naive grep reads that as a consumer.
    """
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
    return re.sub(r'//[^\n]*', ' ', text)


def production_files():
    """Every .ts/.tsx under ui/src that ships, as (path, stripped text)."""
    out = []
    for dirpath, dirnames, filenames in os.walk(UI_SRC):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if not name.endswith(('.ts', '.tsx')):
                continue
            if '.test.' in name:
                continue
            full = os.path.join(dirpath, name)
            with open(full, encoding='utf-8', errors='replace') as handle:
                out.append((full, strip_comments(handle.read())))
    return out


EXPORT_DECL_RE = re.compile(
    r'export\s+(?:default\s+)?(?:async\s+)?'
    r'(?:function\s+([A-Za-z_]\w*)|(?:const|let|class)\s+([A-Za-z_]\w*))'
)


def exported_symbols(text, path):
    """The names another module can import from this one.

    A default export with no name contributes the FILE stem, because that is how
    `import Name from './Name'` reaches it.
    """
    names = set()
    for match in EXPORT_DECL_RE.finditer(text):
        symbol = match.group(1) or match.group(2)
        if symbol:
            names.add(symbol)
    stem = os.path.splitext(os.path.basename(path))[0]
    if re.search(r'export\s+default\b', text):
        names.add(stem)
    return names


def references(symbol, files, defining_path):
    """Files (other than the definer) that NAME this symbol as code."""
    pattern = re.compile(r'\b' + re.escape(symbol) + r'\b')
    hits = []
    for path, text in files:
        if os.path.abspath(path) == os.path.abspath(defining_path):
            continue
        if pattern.search(text):
            hits.append(path)
    return hits


def shell_registrations():
    """{shell: set of command fn names} from each shell's generate_handler! list.

    Read so a DEAD verdict can say the thing that decides the next action: a component
    nothing renders whose commands the desktop DOES register is a missing MOUNT; one whose
    commands no shell registers is a missing BACKEND. Those need opposite fixes, and the
    reachability verdict alone cannot tell them apart.
    """
    out = {}
    for shell, rel in SHELL_HANDLERS.items():
        path = os.path.join(REPO, rel)
        names = set()
        if os.path.exists(path):
            with open(path, encoding='utf-8', errors='replace') as handle:
                text = handle.read()
            match = re.search(r'generate_handler!\s*\[', text)
            if match:
                start = match.end() - 1
                depth = 0
                for index in range(start, len(text)):
                    if text[index] == '[':
                        depth += 1
                    elif text[index] == ']':
                        depth -= 1
                        if depth == 0:
                            body = text[start:index]
                            for entry in re.finditer(r'commands::\w+::([A-Za-z_]\w*)', body):
                                names.add(entry.group(1))
                            break
        out[shell] = names
    return out

def enclosing_export(module_path, line_no):
    """The exported symbol whose body contains `line_no`, or None.

    This is what makes the verdict ABOUT the flagged line rather than about the file. A
    module can be reachable through an export that has nothing to do with the finding, and
    a report that cites the wrong export teaches the reader to distrust the tool.
    """
    if not os.path.exists(module_path):
        return None
    with open(module_path, encoding='utf-8', errors='replace') as handle:
        lines = strip_comments(handle.read()).split(chr(10))
    best = None
    for index, text in enumerate(lines[:max(0, line_no - 1)]):
        match = EXPORT_DECL_RE.search(text)
        if match:
            best = match.group(1) or match.group(2)
    return best


def classify(module_path, files, symbol_hint=None):
    """(verdict, evidence) for the module at module_path."""
    if not os.path.exists(module_path):
        return 'UNRESOLVED', 'file not found'
    with open(module_path, encoding='utf-8', errors='replace') as handle:
        text = strip_comments(handle.read())
    symbols = exported_symbols(text, module_path)
    if not symbols:
        return 'UNRESOLVED', 'no exported symbol'
    evidence = {}
    for symbol in sorted(symbols):
        hits = references(symbol, files, module_path)
        if hits:
            evidence[symbol] = hits
    if evidence:
        # PREFER the symbol the call site itself names. A module exports several things,
        # and the strongest evidence that THIS line of it runs is that the consumer
        # imported the thing the line sits in -- not that the module has some other
        # export somebody uses. Measured 2026-10-25: useRestore reported
        # 'formatBytes <- RestoreSection.tsx', true but beside the point, because
        # formatBytes is a formatter the section imports while the restore calls live
        # in the useRestore hook. Same module, different reason.
        symbol = symbol_hint if symbol_hint in evidence else sorted(evidence)[0]
        first = os.path.relpath(evidence[symbol][0], UI_SRC).replace(os.sep, '/')
        return 'REACHABLE', f'{symbol} <- {first}'
    return 'DEAD', f'none of {sorted(symbols)} referenced outside the file'
FINDING_RE = re.compile(r'^\s+\[\w+\] (\S+) is not registered in that shell')
SITE_RE = re.compile(r'^\s+(ui/src/\S+?):(\d+):')


def read_findings(shells):
    """[(command, relpath, line)] from verify-scoped-reads, or raise on a bad run."""
    cmd = [sys.executable, os.path.join(REPO, 'scripts', 'verify-scoped-reads.py'),
           '--shell', shells]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO)
    # 0 clean, 1 verdict-with-findings; anything else is a refusal and must not read as
    # 'no findings', which is why the exit code is graded rather than the text.
    if proc.returncode not in (0, 1):
        raise SystemExit(f'error: verify-scoped-reads exited {proc.returncode}; '
                         f'{proc.stderr.strip()[:300]}')
    findings = []
    pending = None
    for line in proc.stdout.splitlines():
        match = FINDING_RE.match(line)
        if match:
            pending = match.group(1)
            continue
        match = SITE_RE.match(line)
        if match and pending:
            findings.append((pending, match.group(1), int(match.group(2))))
            pending = None
    return findings


def report(findings, files, strict):
    """Print the classification; return the number of DEAD findings."""
    dead = 0
    rows = []
    shells = shell_registrations()
    for command, rel, line in findings:
        module_path = os.path.join(REPO, rel.replace('/', os.sep))
        hint = enclosing_export(module_path, line)
        verdict, evidence = classify(module_path, files, hint)
        # Which shells register the COMMAND (not the module). Carried into the report
        # because it decides the fix: DEAD + registered-nowhere is a missing backend,
        # DEAD + registered-somewhere is a missing mount.
        where = [shell for shell, names in shells.items() if command in names]
        registered = ','.join(where) if where else 'none'
        if verdict == 'DEAD':
            dead += 1
        rows.append((verdict, command, rel, line, evidence, registered))
    order = {'DEAD': 0, 'UNRESOLVED': 1, 'REACHABLE': 2}
    rows.sort(key=lambda r: (order[r[0]], r[2], r[3]))
    print(f'classify-finding-reachability: {len(rows)} finding(s) from verify-scoped-reads')
    counts = {}
    for verdict, command, rel, line, evidence, registered in rows:
        counts[verdict] = counts.get(verdict, 0) + 1
        print(f'  {verdict:10s} {command:38s} {registered:16s} {rel}:{line}')
        print(f'             {evidence}')
    print()
    print('  ' + ', '.join(f'{k}={v}' for k, v in sorted(counts.items())))
    return dead


def _self_test():
    """The classifier on fabricated modules, including the trap that broke the first try."""
    failures = 0
    tmp = os.path.join(REPO, 'target', 'classify-selftest')
    os.makedirs(tmp, exist_ok=True)

    def write(name, body):
        path = os.path.join(tmp, name)
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write(body)
        return path

    def case(label, got, expected):
        nonlocal failures
        ok = got == expected
        print(f"    {'ok  ' if ok else 'FAIL'} {label}")
        if not ok:
            print(f'           expected {expected!r}, got {got!r}')
            failures += 1

    # A component rendered by a parent is REACHABLE.
    comp = write('Widget.tsx', 'export default function Widget() { return null; }')
    parent = write('Parent.tsx', "import Widget from './Widget';\nexport const P = () => <Widget />;")
    files = [(parent, strip_comments(open(parent, encoding='utf-8').read()))]
    case('a rendered component is REACHABLE', classify(comp, files)[0], 'REACHABLE')

    # The trap: the consumer imports a DIFFERENT symbol than the filename.
    hook_file = write('useThing.ts', 'export function useSomethingElse() { return 1; }')
    consumer = write('Consumer.tsx', "import { useSomethingElse } from './useThing';\nexport const C = () => useSomethingElse();")
    files = [(consumer, strip_comments(open(consumer, encoding='utf-8').read()))]
    case('the exported symbol decides, not the filename', classify(hook_file, files)[0], 'REACHABLE')

    # Only a COMMENT names it: that is not a consumer.
    orphan = write('Orphan.tsx', 'export default function Orphan() { return null; }')
    commenter = write('Notes.tsx', '// Orphan is mentioned here in prose\nexport const N = () => null;')
    files = [(commenter, strip_comments(open(commenter, encoding='utf-8').read()))]
    case('a comment is not a consumer', classify(orphan, files)[0], 'DEAD')

    # No exemplar at all is DEAD, and must say so rather than raise.
    alone = write('Alone.tsx', 'export default function Alone() { return null; }')
    case('no reference at all is DEAD', classify(alone, [])[0], 'DEAD')

    # A missing file is UNRESOLVED, never DEAD -- deleting on a path typo would be fatal.
    case('a missing file is UNRESOLVED', classify(os.path.join(tmp, 'nope.tsx'), [])[0], 'UNRESOLVED')

    # A file with no exports cannot be reached by name; say UNRESOLVED, not DEAD.
    noexport = write('NoExport.tsx', 'const internal = 1;')
    case('no exported symbol is UNRESOLVED', classify(noexport, [])[0], 'UNRESOLVED')

    # The shell-registration read must find both lib.rs files and read only the
    # generate_handler! list -- a whole-file grep would also match a bare re-export.
    shells = shell_registrations()
    case('both handler lists are read', sorted(shells), ['desktop', 'tablet'])
    case('the desktop list is non-empty', bool(shells.get('desktop')), True)
    case('the desktop registers the email commands',
         'save_report_schedule' in shells.get('desktop', set()), True)
    case('the tablet does NOT register them',
         'save_report_schedule' in shells.get('tablet', set()), False)
    # THE DISCRIMINATOR for 'only the list is read'. `start_and_store` is called directly in
    # apps/desktop-tauri/src/lib.rs but is NOT in its generate_handler! list, so a parser
    # that scans the whole file reports it registered -- a false 'the desktop answers this'
    # that would hide a real missing registration. Measured 2026-10-25: the four cases above
    # all passed under exactly that mutation, which is why this one exists.
    case('a fn called outside the handler list is NOT counted',
         'start_and_store' in shells.get('desktop', set()), False)
    print(f'  self-test: {"PASS" if failures == 0 else f"FAIL ({failures})"}')
    return failures


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument('--shell', default='tablet', help='shell to read findings for')
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--strict', action='store_true',
                        help='exit 1 when any finding is DEAD')
    args = parser.parse_args(argv)
    if args.self_test:
        return 1 if _self_test() else 0
    findings = read_findings(args.shell)
    dead = report(findings, production_files(), args.strict)
    if args.strict and dead:
        print(f'FAIL: {dead} finding(s) sit in modules no production code reaches.')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
