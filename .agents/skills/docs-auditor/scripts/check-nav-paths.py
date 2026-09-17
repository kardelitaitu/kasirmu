#!/usr/bin/env python3
"""Check nav paths claimed in the customer docs against the nav registry.

Why: website/src/content/docs/en/user-roles.md told customers to open **Settings -> Staff**.
ui/src/features/settings/ never references the staff route; ui/src/features/staff/register.tsx
registers it with section: 'tools' (label key nav-section-tools). A wrong pointer is not a
style nit - a customer follows it and does not arrive. Sweeping mechanically found the same
defect in a second page (workspaces.md) and is the only way it would ever be found again.

Model, built from code and never asserted:
  1. every registerNavItem({...}) in ui/src/features/*/register.tsx -> route, label, section,
     i18nKey
  2. every label/key in ui/src/features/settings/SettingsNavTree.tsx -> names legitimately
     reachable as Settings -> <label>. Skipping this flags **Settings -> License**, which is
     CORRECT (real node, SettingsNavTree.tsx:92). v1 had that false positive; the model was
     widened, the docs were not touched. A checker that misfires on every Settings child path
     teaches the reader to ignore it.
  3. locale labels: nav-section-* and settings-nav-* values from every .ftl of that locale,
     so id pages are checked against Indonesian labels (Alat, Peran, Lisensi) instead of
     being read as drift. Resolving only shared.ftl made v1 flag all four id paths.

check_docs() is a pure function over (name, text) pairs. --self-test therefore feeds
synthetic pages rather than editing a tracked file: the first version wrote mutations into
website/... and crashed before restoring them, leaving a corrected doc re-broken on disk.
A self-test that mutates the tree can damage the thing it is policing.

Exit 0 clean, 1 findings, 2 self-test failure.
"""
from __future__ import annotations
import argparse, json, re, subprocess, sys
from pathlib import Path

ARROW = re.compile(r'\*\*\s*([^*\u2192\n]+?)\s*(?:\u2192|->)\s*([^*\u2192\n]+?)\s*\*\*')
ITEM = re.compile(r'registerNavItem\(\{(.*?)\n\s*\}\);', re.S)
STR = re.compile(r"(label|route|section|i18nKey|key):\s*'([^']+)'")
SETTINGS_PARENTS = {'settings', 'pengaturan'}

def repo_root():
    o = subprocess.run(['git', 'rev-parse', '--show-toplevel'], stdout=subprocess.PIPE, text=True, errors='replace')
    if o.returncode != 0:
        raise SystemExit(2)
    return Path(o.stdout.strip())

def fold(p: Path) -> dict:
    out: dict[str, str] = {}
    if not p.is_file():
        return out
    key, buf = None, []
    for line in p.read_text(encoding='utf-8', errors='replace').splitlines():
        m = re.match(r'^([a-zA-Z][\w-]*)\s*=\s*(.*)$', line)
        if m:
            if key:
                out[key] = ' '.join(buf).strip()
            key, buf = m.group(1), [m.group(2)]
        elif key is not None and (line.startswith('  ') or line.startswith(chr(9))):
            buf.append(line.strip())
    if key:
        out[key] = ' '.join(buf).strip()
    return out

def build(r: Path, locale: str):
    vals: dict[str, str] = {}
    pat = 'shared' + ('.id' if locale == 'id' else '')
    for f in sorted((r / 'shared-ui' / 'locales').glob('*.ftl')):
        want = f.name.endswith('.id.ftl') if locale == 'id' else not f.name.endswith('.id.ftl')
        if not want:
            continue
        for k, v in fold(f).items():
            vals[k] = v
    nav = {}
    for reg in sorted((r / 'ui' / 'src' / 'features').glob('*/register.tsx')):
        for blk in ITEM.findall(reg.read_text(encoding='utf-8', errors='replace')):
            d = dict(STR.findall(blk))
            if 'route' not in d or 'label' not in d:
                continue
            sec = d.get('section', '')
            names = {d['label'].lower(), d['route'].lower()}
            if d.get('i18nKey') and d['i18nKey'] in vals:
                names.add(vals[d['i18nKey']].lower())
            nav[d['label'].lower()] = {
                'route': d['route'], 'label': d['label'],
                'section_label': vals.get('nav-section-' + sec, sec or '(none)'),
                'names': names,
            }
    tree = set()
    st = r / 'ui' / 'src' / 'features' / 'settings' / 'SettingsNavTree.tsx'
    if st.is_file():
        for d in re.findall(r"label:\s*'([^']+)'", st.read_text(encoding='utf-8', errors='replace')):
            tree.add(d.lower())
    for k, v in vals.items():
        if k.startswith('settings-nav-'):
            tree.add(v.lower())
    return nav, tree

def check_docs(pages, nav, tree, label):
    out = []
    for name, text in pages:
        for i, line in enumerate(text.splitlines(), 1):
            for m in ARROW.finditer(line):
                par, child = m.group(1).strip(), m.group(2).strip()
                if len(child) > 40 or len(par) > 40:
                    continue
                k = child.lower()
                entry = next((e for e in nav.values() if k in e['names']), None)
                if entry is None and k not in tree:
                    out.append('%s:%s:%d: **%s \u2192 %s** \u2014 nothing in the nav model is labelled that' %
                               (label, name, i, par, child))
                    continue
                if entry is None or (k in tree and par.lower() in SETTINGS_PARENTS):
                    continue
                ok = {entry['section_label'].lower(), entry['route'].lower(), entry['label'].lower()}
                if par.lower() not in ok:
                    out.append('%s:%s:%d: **%s \u2192 %s** \u2014 lives under \u201c%s\u201d (route `%s`), not \u201c%s\u201d' %
                               (label, name, i, par, child, entry['section_label'], entry['route'], par))
    return out

def check():
    r = repo_root()
    out = []
    for loc in ('en', 'id'):
        nav, tree = build(r, loc)
        base = r / 'website' / 'src' / 'content' / 'docs' / loc
        if not base.is_dir():
            continue
        pages = [(p.name, p.read_text(encoding='utf-8', errors='replace')) for p in sorted(base.glob('*.md'))]
        out += check_docs(pages, nav, tree, loc)
    return out

def self_test():
    r = repo_root()
    nav, tree = build(r, 'en')
    good = [('x.md', 'open **Tools \u2192 Staff** here')]
    base = len(check_docs(good, nav, tree, 'en'))
    cases = []
    cases.append(('wrong parent detected', len(check_docs([('x.md', 'open **Settings \u2192 Staff**')], nav, tree, 'en')) > 0))
    cases.append(('unknown child detected', len(check_docs([('x.md', 'open **Tools \u2192 Nonexistentz**')], nav, tree, 'en')) > 0))
    cases.append(('correct path clean', base == 0))
    cases.append(('Settings child accepted', len(check_docs([('x.md', 'open **Settings \u2192 License**')], nav, tree, 'en')) == 0))
    cases.append(('route as parent accepted', len(check_docs([('x.md', 'open **staff \u2192 Staff**')], nav, tree, 'en')) == 0))
    bad = [n for n, ok in cases if not ok]
    if bad:
        print('SELF-TEST WRONG: ' + ', '.join(bad), file=sys.stderr)
        return 2
    print('SELF-TEST OK (%d cases, no files touched)' % len(cases))
    return 0

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args()
    if a.self_test:
        return self_test()
    f = check()
    if a.json:
        print(json.dumps({'count': len(f), 'findings': f}, indent=1))
    elif f:
        print(chr(10).join(f))
        print(chr(10) + 'check-nav-paths: %d bad navigation path(s)' % len(f))
    else:
        print('check-nav-paths: every bolded nav path in the customer docs resolves.')
    return 1 if f else 0

if __name__ == '__main__':
    raise SystemExit(main())
