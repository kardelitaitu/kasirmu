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

SKIP_DIRS = {'__tests__', 'dev-mock', 'node_modules', 'dist', 'dist-mobile'}


def strip_comments(text):
    """Blank // and /* */ comments. Prose is not a reference -- see round 151."""
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
    return re.sub(r'//[^\n]*', ' ', text)


def production_files():
    """{path: stripped text} for every shipping .ts/.tsx under ui/src."""
    out = {}
    for dirpath, dirnames, filenames in os.walk(UI_SRC):
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


def census(texts):
    """[(verdict, relpath, evidence)] sorted ORPHAN-first."""
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
        rows.append((verdict, os.path.relpath(path, UI_SRC).replace(os.sep, '/'), evidence))
    rows.sort(key=lambda r: (0 if r[0] == 'ORPHAN' else 1, r[1]))
    return rows


def _self_test():
    """The predicate on fabricated trees, including every false positive the first run made."""
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

    print(f'  self-test: {"PASS" if failures == 0 else f"FAIL ({failures})"}')
    return failures


def main(argv=None):
    parser = argparse.ArgumentParser(description=(__doc__ or '').splitlines()[0])
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--strict', action='store_true', help='exit 1 when anything is orphaned')
    args = parser.parse_args(argv)
    if args.self_test:
        return 1 if _self_test() else 0
    rows = census(production_files())
    orphans = [r for r in rows if r[0] == 'ORPHAN']
    print(f'census-orphan-modules: {len(rows)} component module(s) under ui/src')
    for verdict, rel, evidence in orphans:
        print(f'  ORPHAN  {rel}')
        print(f'          {evidence}')
    print()
    print(f'  ORPHAN={len(orphans)}, LIVE={len(rows) - len(orphans)}')
    if args.strict and orphans:
        print(f'FAIL: {len(orphans)} component module(s) no production code reaches.')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
