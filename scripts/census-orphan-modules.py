#!/usr/bin/env python3
"""Census UI modules that no production code imports, as a REPORT (and optionally a gate).

WHY THIS EXISTS

`classify-finding-reachability.py` answers "is the module behind this FINDING reachable". Its
input is the `verify-scoped-reads` list, which has two structural blind spots that round 156
measured rather than guessed:

  1. A component that calls no shell-specific IPC never appears in that list at all.
  2. Once a finding is GUARDED it leaves the list, so its module stops being classified.

Measured 2026-10-25 by removing a registry entry: `--strict` stayed green while the screen it
registered became unreachable. So that ratchet does not census dead code, and a green run from
it is not evidence that every component is mounted. This script is the missing census.

WHAT IT COUNTS, AND WHY THE PREDICATE IS CAREFUL

A first version of this census reported 47 orphan components. Five were false, and each one
names a rule the real predicate needs:

  * CONTEXTS are consumed through hooks, never rendered as JSX.
  * LAZY-REGISTERED screens appear in a registry as `lazy(() => import('./X'))`, not as a bare
    identifier, so `component: X` alone misses them.
  * BARREL re-exports (`export { X } from './X'`) name a component without consuming it --
    `StoreInfoCard` is exported from `workspace-cards/index.ts` and rendered by nobody.
  * A CSS class named after a component (`ConnectionStatus`) is not an import of it.

So the rules are: a module is LIVE if any production file imports it, renders it, registers it,
or exports it through a barrel that something else imports. Anything else is reported.

IT IS A REPORT, NOT A GATE. When the count reached zero it could be armed with --strict, the same
way its sibling was; until then it prints so the number has a baseline.

USAGE

    python scripts/census-orphan-modules.py
    python scripts/census-orphan-modules.py --self-test
    python scripts/census-orphan-modules.py --strict     # exit 1 when anything is orphaned
"""

from __future__ import annotations

import argparse
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI_SRC = os.path.join(REPO, 'ui', 'src')

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies files under its default temp can point this at a directory
#: it allows; unset leaves tempfile's own default in force (the r166 contract).
TMP_ENV = ('TMPDIR', 'TMP', 'TEMP')


def fixture_root():
    """The temp root this file's fixtures are written under (None = system default).

    The makedirs is the r250 lesson: a scratch dir that was removed between runs
    otherwise makes EVERY fixture die with FileNotFoundError before it grades
    anything. exist_ok keeps the common case a no-op.
    """
    root = next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)
    if root:
        os.makedirs(root, exist_ok=True)
    return root


SKIP_DIRS = {'__tests__', 'dev-mock', 'node_modules', 'dist', 'dist-mobile'}


def strip_comments(text):
    """Blank // and /* */ comments. Prose is not a reference -- see round 151."""
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
    return re.sub(r'//[^\n]*', ' ', text)


def production_files(ui_src=None):
    """{path: stripped text} for every shipping .ts/.tsx under ui/src.

    The r166 root seam lands here: production_files is called with the ROOT
    RESOLVED ui_src, so a fixture tree is scanned instead of this checkout's.
    """
    ui_src = UI_SRC if ui_src is None else ui_src
    out = {}
    for dirpath, dirnames, filenames in os.walk(ui_src):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if not name.endswith(('.ts', '.tsx')) or '.test.' in name:
                continue
            full = os.path.join(dirpath, name)
            with open(full, encoding='utf-8', errors='replace') as handle:
                out[full] = strip_comments(handle.read())
    return out


REEXPORT_RE = re.compile(r"export\s*\{[^}]*\}\s*from\s*'([^']+)'")


def barrel_targets(texts):
    """Every path a barrel re-exports from, so a barrel is transparent rather than a consumer.

    A barrel that nothing imports still transitively keeps nothing alive: the check below asks
    whether the barrel ITSELF is imported before crediting its targets.
    """
    out = {}
    for path, text in texts.items():
        body = [line for line in text.split(chr(10)) if line.strip()]
        if not body:
            continue
        reexports = [line for line in body if line.strip().startswith('export ') and ' from ' in line]
        if reexports and len(reexports) >= len(body) - 1:
            out[path] = [m.group(1) for m in REEXPORT_RE.finditer(text)]
    return out
def module_stem(path):
    """The identifier a module is known by, which is what its consumers name."""
    return os.path.splitext(os.path.basename(path))[0]


def classify_module(path, texts, barrels, imported_barrels):
    """(verdict, evidence) for one module."""
    stem = module_stem(path)
    # A context or hook is CONSUMED, not rendered; both are reached by an import.
    for other, text in texts.items():
        if other == path:
            continue
        # A BARREL that re-exports this module is not a consumer of it -- it is a
        # forwarding address. Counting it would make every barrelled module live
        # regardless of whether anything imports the barrel, which is the
        # StoreInfoCard case measured on 2026-10-25: exported from
        # workspace-cards/index.ts and rendered by nobody. The imported-barrel rule
        # below is what credits a module whose barrel IS reached.
        if other in barrels:
            continue
        if re.search(r"from\s+'[^']*\b" + re.escape(stem) + r"'", text):
            return 'LIVE', 'imported by ' + os.path.relpath(other, UI_SRC).replace(os.sep, '/')
    # Rendered as JSX somewhere other than its own file.
    for other, text in texts.items():
        if other == path:
            continue
        if re.search(r'<' + re.escape(stem) + r'[\s/>]', text):
            return 'LIVE', 'rendered by ' + os.path.relpath(other, UI_SRC).replace(os.sep, '/')
    # Registered lazily or by name.
    for other, text in texts.items():
        if other == path:
            continue
        if re.search(r'component:\s*' + re.escape(stem) + r'\b', text):
            return 'LIVE', 'registered by ' + os.path.relpath(other, UI_SRC).replace(os.sep, '/')
        # DYNAMIC import — the shape the settings registry actually writes:
        #   general: lazy(() => import('./GeneralScreen')).then(...)
        # The static-import rule above only matches `from './X'`, so every lazily
        # registered screen came back ORPHAN on the first real run (23 of them).
        # A dynamic import is a reference: nothing else names those modules.
        if re.search(r'import\s*\(\s*[\'"][^\'"]*\b' + re.escape(stem) + r'[\'"]\s*\)', text):
            return 'LIVE', 'dynamically imported by ' + os.path.relpath(other, UI_SRC).replace(os.sep, '/')
    # Re-exported by a barrel that is ITSELF imported: the barrel is the consumer.
    for barrel, targets in barrels.items():
        if barrel not in imported_barrels:
            continue
        if any(os.path.basename(t) == stem for t in targets):
            return 'LIVE', 're-exported by imported barrel ' + os.path.relpath(barrel, UI_SRC).replace(os.sep, '/')
    return 'ORPHAN', 'no import, render, registration or imported barrel names it'


def census(texts, ui_src=None):
    """[(verdict, relpath, evidence)] sorted ORPHAN-first.

    r166: the relative paths are reported against ui_src, so a fixture tree is
    named by its own layout rather than by this checkout's.
    """
    ui_src = UI_SRC if ui_src is None else ui_src
    barrels = barrel_targets(texts)
    imported_barrels = set()
    for path, text in texts.items():
        for other in barrels:
            if other == path:
                continue
            stem = os.path.splitext(os.path.basename(other))[0]
            if re.search(r"from\s+'[^']*\b" + re.escape(stem) + r"'", text):
                imported_barrels.add(other)
    rows = []
    for path in texts:
        stem = module_stem(path)
        if path.endswith('.tsx'):
            # A component: reached by JSX, by a lazy import or by a registry entry.
            if not stem[:1].isupper():
                continue  # a lower-case .tsx export is a helper, not a component
        elif stem[:1].isupper() or stem.startswith('use'):
            # HOOKS AND CAPITALISED .ts MODULES were outside this census until round 162,
            # which meant the printed ORPHAN count described components only. Measured
            # when the scope was widened: one such module existed (hooks/useMediaQuery.ts,
            # named by no other file). Reporting "N orphans" while silently excluding a
            # whole file class is the same narrow-search error this file exists to catch.
            pass
        else:
            continue  # an ordinary lower-case .ts helper is not addressable by name
        verdict, evidence = classify_module(path, texts, barrels, imported_barrels)
        rows.append((verdict, os.path.relpath(path, ui_src).replace(os.sep, '/'), evidence))
    rows.sort(key=lambda r: (0 if r[0] == 'ORPHAN' else 1, r[1]))
    return rows


def self_test(root=None):
    """The predicate on fabricated trees, including every false positive the first run made.

    r166: ends in shell_ladder(), the root contract graded through argv; root is
    the fixture root those rungs are written under.
    """
    failures = 0

    def case(label, got, expected):
        nonlocal failures
        ok = got == expected
        print(f"    {'ok  ' if ok else 'FAIL'} {label}")
        if not ok:
            print(f'           expected {expected!r}, got {got!r}')
            failures += 1

    def run(tree):
        # Keyed by BASENAME: the census reports paths relative to UI_SRC, and a fabricated
        # tree lives outside it. Keying by relpath made every case return None, which is
        # the vacuous-failure shape -- the test was measuring its own harness, not the
        # predicate.
        rows = census({f'/x/{name}': strip_comments(body) for name, body in tree.items()})
        return {rel.rsplit('/', 1)[-1]: verdict for verdict, rel, _ in rows}

    live = run({
        'Widget.tsx': 'export default function Widget() { return null; }',
        'Parent.tsx': "import Widget from './Widget';\nexport const P = () => <Widget />;",
    })
    case('a rendered component is LIVE', live.get('Widget.tsx'), 'LIVE')

    hookish = run({
        'ThingContext.tsx': 'export function ThingProvider() { return null; }',
        'Use.tsx': "import { ThingProvider } from './ThingContext';\nexport const U = () => null;",
    })
    case('an imported context is LIVE even though nothing renders its JSX', hookish.get('ThingContext.tsx'), 'LIVE')

    lazy = run({
        'Screen.tsx': 'export function Screen() { return null; }',
        'reg.ts': "const S = lazy(() => import('./Screen'));\nregisterPage({ component: Screen });",
    })
    case('a lazily registered screen is LIVE', lazy.get('Screen.tsx'), 'LIVE')

    orphan = run({'Orphan.tsx': 'export default function Orphan() { return null; }'})
    case('nothing naming it is ORPHAN', orphan.get('Orphan.tsx'), 'ORPHAN')

    barrel_unused = run({
        'Card.tsx': 'export function Card() { return null; }',
        'index.ts': "export { Card } from './Card';",
    })
    case('an UNIMPORTED barrel does not keep its target alive', barrel_unused.get('Card.tsx'), 'ORPHAN')

    barrel_used = run({
        'Card.tsx': 'export function Card() { return null; }',
        'index.ts': "export { Card } from './Card';",
        'Host.tsx': "import { Card } from './index';\nexport const H = () => <Card />;",
    })
    case('an IMPORTED barrel does keep its target alive', barrel_used.get('Card.tsx'), 'LIVE')

    comment_only = run({
        'Gone.tsx': 'export default function Gone() { return null; }',
        'Notes.tsx': '// Gone is mentioned in prose\nexport const N = () => null;',
    })
    case('a comment is not a reference', comment_only.get('Gone.tsx'), 'ORPHAN')

    # SCOPE: hooks and capitalised .ts modules. Until round 162 the census skipped every
    # non-.tsx file, so its ORPHAN count described components only -- which is how
    # hooks/useMediaQuery.ts sat unnamed for an unknown number of rounds.
    hook_orphan = run({'useThing.ts': 'export function useThing() { return 1; }'})
    case('an orphaned hook is ORPHAN', hook_orphan.get('useThing.ts'), 'ORPHAN')

    hook_used = run({
        'useThing.ts': 'export function useThing() { return 1; }',
        'Host.tsx': "import { useThing } from './useThing';\nexport const H = () => useThing();",
    })
    case('a consumed hook is LIVE', hook_used.get('useThing.ts'), 'LIVE')

    lower_ts = run({'helpers.ts': 'export const clamp = (n: number) => n;'})
    case('a lower-case .ts helper is out of scope', lower_ts.get('helpers.ts'), None)

    # THE DOUBLE-EXTENSION TRAP. `os.path.splitext('CartScreen.test.tsx')[0]` is
    # 'CartScreen.test', not 'CartScreen', so a dedicated-suite match that uses splitext
    # reports 0 for every orphan -- which is what happened on this helper's first run and
    # would have been read as "no tests are wasted on dead code".
    import tempfile
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as td:
        # A dedicated suite imports the module, so its body names it.
        with open(os.path.join(td, 'Widget.test.tsx'), 'w', encoding='utf-8') as fh:
            fh.write("import Widget from '../Widget';\n"
                     "it('a', () => { render(<Widget />); });\n"
                     "it('b', () => {});\n")
        # A COMMENT mention is not a naming file: strip_comments blanks it first. That is the
        # same rule the reachability predicate uses, and the first version of this fixture got
        # it backwards by putting the mention in prose.
        with open(os.path.join(td, 'Other.test.ts'), 'w', encoding='utf-8') as fh:
            fh.write('// Widget is mentioned in prose' + chr(10) + "it('c', () => {});" + chr(10))
        cost = test_cost([('ORPHAN', 'features/Widget.tsx', '')], td)
        case('a dedicated suite is counted by its two-extension name', cost['features/Widget.tsx'][0], 2)
        case('only the file whose CODE names it counts', cost['features/Widget.tsx'][1], 1)

    print(f'  self-test: {"SELF-TEST OK" if failures == 0 else f"FAIL ({failures})"}')
    if failures:
        return failures
    return shell_ladder(root)


def test_cost(orphans, tests_dir):
    """{module_relpath: (test_cases, test_files)} for each orphan, from the test corpus.

    Reported, never graded: the point is to make visible what a lane is maintaining when it
    keeps an unreachable module alive. Measured 2026-10-25 -- 7 orphan modules carried 68
    `it()` cases in dedicated suites, and appeared in 10 more files as CSS-inventory names.
    That cost is invisible from either side alone: the test suite is green, and the census
    does not look at tests.
    """
    if not os.path.isdir(tests_dir):
        return {}
    corpus = {}
    for name in sorted(os.listdir(tests_dir)):
        if not name.endswith(('.test.ts', '.test.tsx')):
            continue
        path = os.path.join(tests_dir, name)
        try:
            with open(path, encoding='utf-8', errors='replace') as handle:
                text = strip_comments(handle.read())
        except OSError:
            continue
        corpus[name] = (text, len(re.findall(r'^\s*it\(', text, re.M)))
    out = {}
    for verdict, rel, _evidence in orphans:
        stem = os.path.splitext(os.path.basename(rel))[0]
        dedicated = 0
        named_in = 0
        for name, (text, cases) in corpus.items():
            if not re.search(r'\b' + re.escape(stem) + r'\b', text):
                continue
            named_in += 1
            # `.test.tsx` has TWO extensions: splitext strips only the last, so
            # `os.path.splitext('CartScreen.test.tsx')[0]` is `'CartScreen.test'` and a
            # comparison against the module stem never matched -- every dedicated count
            # read 0 until this was measured against the 68 the tree actually has.
            if name.split('.test.')[0] == stem:
                dedicated = cases
        out[rel] = (dedicated, named_in)
    return out


def main(argv=None, root=None) -> int:
    """r166: argv and root parameterized -- root redirects BOTH the module walk and
    the test corpus, so a fixture tree is graded instead of this checkout."""
    parser = argparse.ArgumentParser(description=(__doc__ or '').splitlines()[0])
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--strict', action='store_true', help='exit 1 when anything is orphaned')
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    repo = REPO if root is None else os.path.abspath(root)
    ui_src = os.path.join(repo, 'ui', 'src')
    if not os.path.isdir(ui_src):
        # A census that found no modules must never read as a census that found
        # none -- the refusal floor every sibling gate in this arc follows.
        print(f'census-orphan-modules: {os.path.join("ui", "src")} not found under '
              f'{repo}; refusing to report a clean census of nothing.', file=sys.stderr)
        return 2
    rows = census(production_files(ui_src), ui_src)
    orphans = [r for r in rows if r[0] == 'ORPHAN']
    cost = test_cost(orphans, os.path.join(ui_src, '__tests__'))
    print(f'census-orphan-modules: {len(rows)} component module(s) under ui/src')
    total_cases = 0
    for verdict, rel, evidence in orphans:
        print(f'  ORPHAN  {rel}')
        print(f'          {evidence}')
        cases, named_in = cost.get(rel, (0, 0))
        total_cases += cases
        if cases or named_in:
            # The cost of keeping it: tests a lane maintains for a module no user reaches.
            print(f'          {cases} dedicated test case(s); named in {named_in} test file(s)')
    print()
    print(f'  ORPHAN={len(orphans)}, LIVE={len(rows) - len(orphans)}')
    if total_cases:
        print(f'  {total_cases} test case(s) exercise modules nothing in the app reaches.')
    if args.strict and orphans:
        print(f'FAIL: {len(orphans)} component module(s) no production code reaches.')
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
    """r166: the root contract, graded on fixture ui/src trees through main().

    Rung 1 IS the killing rung, and it asserts an EXACT verdict line plus a
    NEGATIVE finding. The positive half fixes both numbers the census prints to
    the fixture's: measured on this checkout, the live verdict is
    "census-orphan-modules: 419 component module(s) under ui/src" and
    "  ORPHAN=1, LIVE=418", so neither "6 component module(s)" nor
    "ORPHAN=1, LIVE=5" can be printed by a scan of the real tree. The negative
    half is the half a refusal floor cannot reach: the fixture's ORPHAN is
    Hookless.tsx, and the real AddonsMarketplace.tsx must NOT be reported. A
    ladder that stopped at "the broken scope is refused" would die at a floor
    that grades nothing; this rung fails a main() that honours root for the
    SCOPE while the CHECK's own analysis still reads this checkout.

    Rung 2 is the clean arm: every module reached by import/render/registration,
    exit 0, ORPHAN=0. Rung 3 is the refusal floor -- a root with no ui/src must
    refuse rc 2 and never print ORPHAN=; a root-blind main walks this checkout
    and prints its verdict instead. Rung 4 drives --self-test through argv;
    re-entry is guarded.
    """
    import contextlib
    import io
    import tempfile

    def build(tmp, files, label="fx"):
        """A fixture root holding the given {relative path: text} files."""
        base = os.path.join(tempfile.mkdtemp(dir=tmp, prefix=label + "_"))
        for rel, text in files.items():
            dst = os.path.join(base, *rel.split("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(text)
        return base

    def run(root_dir, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=str(root_dir))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    # SEVEN modules, ONE orphan. Three separate rules the predicate owns keep the
    # rest LIVE -- static import (Widget into Host, Host into App, useThing into
    # Host and Consumer), JSX render (Widget, Host, App), and a dynamic import
    # (Consumer). The census reports EVERY unnamed module, so the fixture's entry
    # points are named too: a .tsx carrying no JSX is exempt only by the
    # lower-case-helper rule main.tsx fails, so main.tsx renders <App /> through
    # createRoot rather than merely importing it. A fixture whose helpers were
    # unnamed would print orphans for reasons unrelated to the rule under test.
    # The one module nothing names is Hookless.tsx, and that name appears
    # nowhere in this checkout -- which is what makes it a finding only a
    # fixture scan can produce.
    MIXED = {
        "ui/src/main.tsx": ("import { App } from './App';" + chr(10)
                            + "createRoot(document.body).render(<App />);" + chr(10)
                            + "export const boot = App;" + chr(10)),
        "ui/src/Widget.tsx": "export default function Widget() { return null; }" + chr(10),
        "ui/src/Host.tsx": ("import Widget from './Widget';" + chr(10)
                            + "import { useThing } from './useThing';" + chr(10)
                            + "export const Host = () => { useThing(); return <Widget />; }" + chr(10)),
        "ui/src/useThing.ts": "export function useThing() { return 1; }" + chr(10),
        "ui/src/Consumer.tsx": ("import { useThing } from './useThing';" + chr(10)
                                + "export const Consumer = () => useThing();" + chr(10)),
        "ui/src/Hookless.tsx": "export default function Hookless() { return null; }" + chr(10),
        "ui/src/App.tsx": ("import { Host } from './Host';" + chr(10)
                           + "const C = lazy(() => import('./Consumer'));" + chr(10)
                           + "export const App = () => <Host />;" + chr(10)),
    }

    # Every module reachable: Widget by import and render, Screen dynamically,
    # and the host by the entry module -- same entry rule as MIXED.
    CLEAN = {
        "ui/src/Widget.tsx": "export default function Widget() { return null; }" + chr(10),
        "ui/src/Host.tsx": ("import Widget from './Widget';" + chr(10)
                            + "export const Host = () => <Widget />;" + chr(10)),
        "ui/src/Screen.tsx": "export function Screen() { return null; }" + chr(10),
        "ui/src/reg.ts": ("const S = lazy(() => import('./Screen'));" + chr(10)
                          + "registerPage({ component: Screen });" + chr(10)),
        "ui/src/main.tsx": ("import { Host } from './Host';" + chr(10)
                            + "createRoot(document.body).render(<Host />);" + chr(10)),
    }

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: the verdict is the FIXTURE's, exactly, and
        # the finding is the fixture's too.
        fx_root = build(tmp, MIXED)
        rc, said = run(fx_root)
        want_count = "census-orphan-modules: 6 component module(s) under ui/src"
        want_verdict = "ORPHAN=1, LIVE=5"
        if (rc != 0 or want_count not in said or want_verdict not in said
                or "ORPHAN  Hookless.tsx" not in said or "AddonsMarketplace" in said):
            print("  x rung 1: the verdict and the finding must both be the fixture's "
                  "(6 modules, Hookless.tsx orphaned, no AddonsMarketplace) "
                  "(rc=%r said=%r)" % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- the clean arm: every fixture module is reached, exit 0.
        fx_root = build(tmp, CLEAN)
        rc, said = run(fx_root)
        if (rc != 0 or "census-orphan-modules: 3 component module(s)" not in said
                or "ORPHAN=0, LIVE=3" not in said):
            print("  x rung 2: a clean fixture must exit 0 reporting ORPHAN=0, LIVE=3 "
                  "(rc=%r said=%r)" % (rc, said[-300:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- the refusal floor: no ui/src under this root.
        fx_root = build(tmp, {"README.md": "no ui here" + chr(10)}, label="bare")
        rc, said = run(fx_root)
        if rc != 2 or "not found" not in said or "ORPHAN=" in said:
            print("  x rung 3: a root without ui/src must refuse rc 2 and print no "
                  "verdict (rc=%r said=%r)" % (rc, said[-300:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- --self-test dispatch flows through argv; re-entry is guarded.
        fx_root = build(tmp, CLEAN)
        rc, said = run(fx_root, "--self-test")
        if rc != 0 or "SELF-TEST OK" not in said or "ladder re-entry" not in said:
            print("  x rung 4: --self-test through argv must pass rc 0 and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-300:]), file=sys.stderr)
            return 1
        shell += 1

    print("CENSUS-ORPHAN-MODULES SHELL LADDER OK (%d cases through argv and root, "
          "no repository file graded)" % shell)
    return 0


if __name__ == '__main__':
    sys.exit(main())
