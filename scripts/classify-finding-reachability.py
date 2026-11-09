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

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies files under its default temp can point this at a directory
#: it allows; unset leaves tempfile's own default in force (the r166 contract).
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root this file's ladder fixtures are written under (None = system default).

    The makedirs is the r250 lesson: a scratch dir that was removed between runs
    otherwise makes EVERY fixture die with FileNotFoundError before it grades
    anything. exist_ok keeps the common case a no-op.
    """
    root = next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)
    if root:
        os.makedirs(root, exist_ok=True)
    return root


# The two shells and the file whose generate_handler![...] list is their registration.
# Relative to the root being graded, which is why these stay relative.
SHELL_HANDLERS = {
    'desktop': os.path.join('apps', 'desktop-tauri', 'src', 'lib.rs'),
    'tablet': os.path.join('apps', 'mobile-tauri', 'src', 'lib.rs'),
}


def graded_ui_src(root):
    """The ui/src tree the analysis reads: this checkout's, or the fixture's.

    The r166 root seam lands here and nowhere else. Every rule below -- which files
    ship, which symbol each one exports, who references it -- reads its evidence
    through this single directory, so a root that resolves here redirects the
    analysis whole. Threading it as a PARAMETER rather than rebinding module state
    is deliberate: the ladder runs fixtures back to back in one process, and a
    rebinding that leaked would grade the second fixture with the first's tree.
    """
    return os.path.join(REPO, 'ui', 'src') if root is None else \
        os.path.join(os.path.abspath(root), 'ui', 'src')


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


def production_files(ui_src=None):
    """Every .ts/.tsx under ui/src that ships, as (path, stripped text)."""
    ui_src = graded_ui_src(None) if ui_src is None else ui_src
    out = []
    for dirpath, dirnames, filenames in os.walk(ui_src):
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


def shell_registrations(root=None):
    """{shell: set of command fn names} from each shell's generate_handler! list.

    Read so a DEAD verdict can say the thing that decides the next action: a component
    nothing renders whose commands the desktop DOES register is a missing MOUNT; one whose
    commands no shell registers is a missing BACKEND. Those need opposite fixes, and the
    reachability verdict alone cannot tell them apart.

    r166: the handler lists are read under the ROOT being graded, so a fixture's
    shells answer a fixture finding rather than lending it this checkout's.
    """
    base = REPO if root is None else os.path.abspath(root)
    out = {}
    for shell, rel in SHELL_HANDLERS.items():
        path = os.path.join(base, rel)
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


def classify(module_path, files, symbol_hint=None, ui_src=None):
    """(verdict, evidence) for the module at module_path.

    ui_src is only the tree the EVIDENCE path is made relative to, so a fixture's
    report names its own layout instead of this checkout's.
    """
    ui_src = graded_ui_src(None) if ui_src is None else ui_src
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
        first = os.path.relpath(evidence[symbol][0], ui_src).replace(os.sep, '/')
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


def report(findings, files, strict, root=None):
    """Print the classification; return the number of DEAD findings.

    r166: root redirects BOTH evidence sources that are not `files` -- the module
    a finding names and the shell handler lists -- so a fixture report answers
    entirely from the fixture.
    """
    dead = 0
    rows = []
    base = REPO if root is None else os.path.abspath(root)
    ui_src = graded_ui_src(root)
    shells = shell_registrations(root)
    for command, rel, line in findings:
        module_path = os.path.join(base, rel.replace('/', os.sep))
        hint = enclosing_export(module_path, line)
        verdict, evidence = classify(module_path, files, hint, ui_src)
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


def _self_test(root=None):
    """The classifier on fabricated modules, including the trap that broke the first try.

    r166: ends in shell_ladder(root), the root contract graded through argv;
    root is the fixture root those rungs are written under.
    """
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
    if failures:
        return failures
    return shell_ladder(root)


def main(argv=None, root=None):
    """r166: argv and root parameterized -- root redirects the ui/src walk, the
    module each finding names and the shell handler lists, so a fixture tree is
    graded whole rather than half-run against this checkout."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument('--shell', default='tablet', help='shell to read findings for')
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--strict', action='store_true',
                        help='exit 1 when any finding is DEAD')
    args = parser.parse_args(argv)
    if args.self_test:
        return 1 if _self_test(root) else 0
    # r166: a root that holds no ui/src is REFUSED, not reported as a tree whose every
    # finding is UNRESOLVED. Measured while writing the ladder: without this the empty
    # arm printed a verdict over zero evidence, and a walk that found nothing read as a
    # grading. `file not found` is what UNRESOLVED means per finding; this says it once.
    ui_src = graded_ui_src(root)
    if not os.path.isdir(ui_src):
        print(f'FAIL: ui/src not found under {root or REPO}; nothing to classify',
              file=sys.stderr)
        return 2
    findings = read_findings(args.shell)
    dead = report(findings, production_files(ui_src), args.strict, root)
    if args.strict and dead:
        print(f'FAIL: {dead} finding(s) sit in modules no production code reaches.')
        return 1
    return 0


_LADDER_RUNNING = False


def shell_ladder(root=None) -> int:
    """Re-entry guard (the r228 pattern): rung 4 drives --self-test through argv
    from inside the ladder, and the self-test ends in this call."""
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        print("  (ladder re-entry from a nested --self-test: skipped)")
        return 0
    _LADDER_RUNNING = True
    try:
        return _shell_ladder_body(root)
    finally:
        _LADDER_RUNNING = False


def _shell_ladder_body(root=None) -> int:
    """r166: the root contract, graded on fixture checkouts through main().

    Rung 1 IS the killing rung, and it grades a VERDICT, not a refusal. Its fixture
    holds one finding for ui/src/features/LedgerScreen.tsx and NO other file, so the
    line it asserts -- "DEAD       ledger_reconcile", then "DEAD=1" -- is a verdict
    this checkout cannot print: measured 2026-11-09 the live run reports
    "0 finding(s) from verify-scoped-reads" and an empty counts line. A main() whose
    finding list comes from the fixture while its ANALYSIS half reads this checkout
    prints "0 finding(s)" or "UNRESOLVED file not found" there, and this rung fails.
    A ladder that only asserted the rc-2 refusal of rung 3 would kill a root-blind
    main at a floor that grades nothing.

    Rung 2 pins the OTHER direction: the same module plus one consumer, so ignoring
    the fixture's files cannot pass as the fixture's own verdict -- measured, that
    mutant puts its wrong verdict on this rung, not on rung 1.

    Rung 2 is the clean arm: the same finding, preceded in its file by an exported
    helper its own shell registers, so ledger_reconcile is REACHABLE through the
    enclosing export -- exit 0, verdict REACHABLE, and no DEAD verdict. Rung 3 is
    the refusal floor -- a root with no ui/src refuses rc 2 and prints no OK -- and
    rung 4 drives --self-test through argv, where re-entry is guarded.

    The finding list is FABRICATED rather than shelled out: read_findings() runs
    verify-scoped-reads against this checkout, and a rung that ran it would grade
    this repository, not the fixture. The one input a fixture cannot own is
    replaced; everything main() does with it is graded.
    """
    import contextlib
    import io
    import tempfile

    def build(tmp, files, label="fx"):
        """A fixture repo root holding the given {relative path: text} files."""
        base = os.path.join(tempfile.mkdtemp(dir=tmp, prefix=label + "_"))
        for rel, text in files.items():
            dst = os.path.join(base, *rel.split("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(text)
        return base

    def run(findings, root_dir, *argv):
        """main() over one fixture, its finding list replaced, output captured.

        The replacement is read through globals() rather than the bare name: the
        ladder ASSIGNS that name in this frame, which makes it local to the whole
        ladder body, and a lambda closing over it would needlessly depend on that.

        argv is passed as an EXPLICIT LIST even when a rung has none, because an
        empty tuple would be discarded by the caller (`argv or sys.argv[1:]`), and
        the invocation that matters -- rung 4's --self-test -- is exactly the one
        whose inherited command line carries it.
        """
        real = globals()["read_findings"]
        globals()["read_findings"] = lambda shells, _f=list(findings): list(_f)
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=str(root_dir))
        except SystemExit as se:
            return se.code, buf.getvalue()
        finally:
            globals()["read_findings"] = real
        return rc, buf.getvalue()

    # ONE finding, ONE module nothing names. The fixture ships EXACTLY that module and
    # no other file, because a consumer in the same tree changes the answer: measured
    # while writing this ladder, a tree holding HomeScreen.tsx -- which imports the
    # export -- read REACHABLE, and the rung can only be a killing rung if the tree it
    # grades can produce DEAD at all. So the LedgerScreen module is the whole
    # population, and no file under any root holds a second one.
    MIXED = {
        # THREE lines, measured rather than guessed: enclosing_export() reads only the
        # lines STRICTLY ABOVE line_no, so an export declared ON line 1 is never seen
        # for a finding at line 1 (verified on this tree: it returns None). The export
        # therefore sits on line 2 and the finding points at line 3, inside it.
        "ui/src/features/LedgerScreen.tsx": (
            "const ledgerApiVersion = 1;" + chr(10)
            + "export function useLedgerReconcile() { return ledgerApiVersion; }" + chr(10)
            + "useLedgerReconcile();" + chr(10)),
    }
    FINDING = ("ledger_reconcile", "ui/src/features/LedgerScreen.tsx", 3)

    # The clean arm: the enclosing export of line 3 is `useLedgerReconcile`, and THIS
    # fixture's desktop shell registers ledger_reconcile -- so classify() finds the
    # export reached from HomeScreen.tsx and the report says REACHABLE, desktop.
    CLEAN = dict(MIXED)
    CLEAN["ui/src/features/HomeScreen.tsx"] = (
        "import { useLedgerReconcile } from './LedgerScreen';" + chr(10)
        + "export const Home = () => useLedgerReconcile();" + chr(10))
    CLEAN["apps/desktop-tauri/src/lib.rs"] = (
        "tauri::generate_handler![commands::ledger::ledger_reconcile]" + chr(10))

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: the verdict is the FIXTURE's, exactly.
        fx_root = build(tmp, MIXED)
        rc, said = run([FINDING], fx_root)
        if (rc != 0 or "classify-finding-reachability: 1 finding(s)" not in said
                or "DEAD       ledger_reconcile" not in said
                or "DEAD=1" not in said
                or "0 finding(s)" in said):
            print("  x rung 1: a fixture finding in a module nothing names must be the "
                  "FIXTURE's DEAD verdict (rc=%r said=%r)" % (rc, said[-400:]),
                  file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- the clean arm: the enclosing export is reached, exit 0.
        fx_root = build(tmp, CLEAN)
        rc, said = run([FINDING], fx_root)
        if (rc != 0 or "REACHABLE  ledger_reconcile" not in said
                or "desktop" not in said or "DEAD" in said
                or "REACHABLE=1" not in said):
            print("  x rung 2: a fixture whose export its own shell registers must read "
                  "REACHABLE, exit 0 (rc=%r said=%r)" % (rc, said[-300:]),
                  file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- the refusal floor: no ui/src under this root. A fixture tree is
        # also the only proof the walk is the root's: this checkout HAS a ui/src, so
        # a root-blind main prints its own (albeit empty) verdict here instead.
        fx_root = build(tmp, {"README.md": "no ui here" + chr(10)}, label="bare")
        rc, said = run([FINDING], fx_root)
        if (rc != 2 or "not found" not in said or "OK" in said
                or "finding(s) from verify-scoped-reads" in said):
            print("  x rung 3: a root without ui/src must refuse rc 2 and print no "
                  "verdict (rc=%r said=%r)" % (rc, said[-300:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- --self-test dispatch flows through argv; re-entry is guarded.
        fx_root = build(tmp, CLEAN)
        rc, said = run([FINDING], fx_root, "--self-test")
        if rc != 0 or "self-test: PASS" not in said or "ladder re-entry" not in said:
            print("  x rung 4: --self-test through argv must pass rc 0 and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-300:]),
                  file=sys.stderr)
            return 1
        shell += 1

    print("CLASSIFY-FINDING-REACHABILITY SHELL LADDER OK (%d cases through argv and "
          "root, no repository file graded)" % shell)
    return 0


if __name__ == '__main__':
    sys.exit(main())
