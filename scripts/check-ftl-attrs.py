#!/usr/bin/env python3
r"""
scripts/check-ftl-attrs.py — catch a message that is asked for an attribute it does not define.

WHY
===

A React call site can ask Fluent for a message ATTRIBUTE:

    <Localized id="k" attrs={{ placeholder: true }}>
      <input placeholder="Enter API key" />
    </Localized>

When message `k` defines `.placeholder = ...`, the attribute value is used, so the
placeholder is translated. When it does NOT, @fluent/react falls back to the
between-tag children — a HARDCODED ENGLISH LITERAL. The component still renders,
the test suite still passes, and the translation that exists in `*.id.ftl` is never
reached. Three messages shipped that way (settings-api-key-placeholder,
settings-api-key-masked, settings-email-password-placeholder; fixed in d9cc0098f),
and `verify-bundle-parity.py` reports this class as OUT OF SCOPE at its docstring:
it validates ids, not attributes.

WHAT IT CHECKS
==============

For every `attrs={{ ... }}` in `ui/src/**/*.tsx`, resolve the `id` of the enclosing
`<Localized>` — a string literal, or a conditional/`||` expression whose branches are
string literals — and assert each requested attribute is defined on that message in
the EN bundle (`shared-ui/locales/*.ftl`, excluding `.id.ftl`).

The dynamic form matters: the three real defects were all behind
`id={flag ? 'a' : 'b'}`, which is why a resolver that walks back to the nearest
LITERAL id found the wrong message and produced three false positives before the
real three. Both branches are checked, so either selection is safe.

Comments are blanked before scanning, so prose that quotes `<Localized attrs=...>`
(RefundModal explains that it avoided the pattern) is not a site.

UNRESOLVABLE SITES are counted and reported rather than silently skipped: an id built
from a JS variable (`id={SOME_KEY}`) cannot be checked statically, and a silent skip
would make the gate's coverage look wider than it is.

Exit 0 clean, 1 finding(s), 2 refused/self-test failure.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LOCALES = REPO / 'shared-ui' / 'locales'
SCAN_ROOT = REPO / 'ui' / 'src'

LOCALIZED = re.compile(r"<Localized\b")
ATTRS = re.compile(r"attrs=\{\{([^}]*)\}\}")
ID_EXPR = re.compile(r"id=(\{[^}]*\}|\"[^\"]*\")", re.S)
STRING_LIT = re.compile(r"'([a-z0-9][a-z0-9-]*)'")
ATTR_NAME = re.compile(r"\"?([a-zA-Z-]+)\"?\s*:")
FTL_KEY = re.compile(r"(?m)^([a-z0-9][a-z0-9-]*)\s*=")
FTL_ATTR = re.compile(r"(?m)^\s*\.([a-zA-Z-]+)\s*=")


def blank_comments(text: str) -> str:
    """Replace comment bodies with spaces, preserving offsets and line numbering."""
    out = list(text)
    i = 0
    n = len(text)
    while i < n:
        if text.startswith('//', i):
            j = text.find('\n', i)
            j = n if j == -1 else j
            for k in range(i, j):
                out[k] = ' '
            i = j
            continue
        if text.startswith('/*', i):
            j = text.find('*/', i + 2)
            j = n if j == -1 else j + 2
            for k in range(i, j):
                if text[k] != '\n':
                    out[k] = ' '
            i = j
            continue
        i += 1
    return ''.join(out)


def parse_bundle(path: Path) -> dict[str, set[str]]:
    """Message id -> the set of attribute names it defines."""
    text = path.read_text(encoding='utf-8', errors='replace')
    messages: dict[str, set[str]] = {}
    # Split on a column-0 `key =` line; that is the Fluent message boundary.
    for chunk in re.split(r'(?m)^(?=[a-z0-9][a-z0-9-]*\s*=)', text):
        m = FTL_KEY.match(chunk)
        if not m:
            continue
        messages.setdefault(m.group(1), set()).update(FTL_ATTR.findall(chunk))
    return messages


def load_en(locales=None) -> dict[str, set[str]]:
    """r187: the bundle directory follows root (the r166..r186 contract)."""
    locale_dir = LOCALES if locales is None else Path(locales)
    merged: dict[str, set[str]] = {}
    for path in sorted(locale_dir.glob('*.ftl')):
        if path.name.endswith('.id.ftl'):
            continue
        for key, attrs in parse_bundle(path).items():
            merged.setdefault(key, set()).update(attrs)
    return merged


def ids_in(raw: str) -> list[str] | None:
    """The literal ids an `id=` value can select, or None when unresolvable."""
    if not raw.startswith('{'):
        return [raw.strip('"')]
    found = STRING_LIT.findall(raw)
    return found or None


def scan_file(path: Path, en: dict[str, set[str]]) -> tuple[list[tuple[int, str, str]], int]:
    """(line, message id, missing attribute) findings, plus the unresolvable-site count."""
    text = blank_comments(path.read_text(encoding='utf-8', errors='replace'))
    findings: list[tuple[int, str, str]] = []
    unresolved = 0
    for opener in LOCALIZED.finditer(text):
        close = text.find('>', opener.end())
        if close == -1:
            continue
        tag = text[opener.start():close + 1]
        attr_match = ATTRS.search(tag)
        if not attr_match:
            continue
        names = ATTR_NAME.findall(attr_match.group(1))
        if not names:
            continue
        id_match = ID_EXPR.search(tag)
        if not id_match:
            unresolved += 1
            continue
        keys = ids_in(id_match.group(1))
        if keys is None:
            unresolved += 1
            continue
        line = text[:attr_match.start()].count('\n') + 1
        for key in keys:
            defined = en.get(key)
            if defined is None:
                continue  # a missing key is verify-bundle-parity.py's class, not this one
            for name in names:
                if name not in defined:
                    findings.append((line, key, name))
    return findings, unresolved


def scan_tree(root: Path, en: dict[str, set[str]], base=None) -> tuple[list[str], int, int]:
    findings: list[str] = []
    unresolved = 0
    scanned = 0
    # r187: base is where the reported relative paths anchor -- it follows the
    # same root as the scan, so a redirected run reports fixture-relative paths.
    base = REPO if base is None else Path(base)
    for path in sorted(root.rglob('*')):
        if path.suffix not in ('.tsx', '.ts') or not path.is_file():
            continue
        if 'node_modules' in path.parts:
            continue
        scanned += 1
        hits, unres = scan_file(path, en)
        unresolved += unres
        rel = path.relative_to(base).as_posix()
        for line, key, name in hits:
            findings.append(
                "%s:%d  message '%s' defines no attribute '%s' -- the call site will"
                " fall back to its children" % (rel, line, key, name)
            )
    return findings, unresolved, scanned


def _self_test() -> int:
    """Both directions on the shapes that produced a false positive and a real defect.

    Case 1 must FIRE (the shipped defect), case 2 must stay silent on the SAME message
    once the attribute exists, and cases 3-4 pin the dynamic-id resolver: a conditional
    id must check BOTH branches, and a JS-variable id must be counted as unresolved
    rather than skipped silently.
    """
    en = {'k-attr': {'placeholder'}, 'k-bare': set(), 'k-other': {'placeholder'}}
    cases: list[tuple[str, str, int, int]] = [
        ('a bare message is a finding',
         '<Localized id="k-bare" attrs={{ placeholder: true }}><input /></Localized>', 1, 0),
        ('a message defining the attribute is clean',
         '<Localized id="k-attr" attrs={{ placeholder: true }}><input /></Localized>', 0, 0),
        # 'k-other' defines the attribute and 'k-bare' does not, so a resolver that
        # checked only the FIRST branch reports 0 and misses the defect -- which is the
        # shape all three real findings actually had.
        ('a conditional id checks BOTH branches',
         "<Localized id={f ? 'k-other' : 'k-bare'} attrs={{ placeholder: true }}><input /></Localized>", 1, 0),
        ('a JS-variable id is counted, not skipped',
         '<Localized id={SOME_KEY} attrs={{ placeholder: true }}><input /></Localized>', 0, 1),
        ('a comment quoting the pattern is not a site',
         '// <Localized id="k-bare" attrs={{ placeholder: true }}>\n<p>ok</p>', 0, 0),
    ]
    import tempfile
    bad = 0
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for name, body, want_hits, want_unres in cases:
            f = root / 'case.tsx'
            f.write_text(body, encoding='utf-8')
            hits, unres = scan_file(f, en)
            ok = len(hits) == want_hits and unres == want_unres
            if not ok:
                bad += 1
                print('  %-46s FAIL want=%d/%d got=%d/%d'
                      % (name, want_hits, want_unres, len(hits), unres))
            else:
                print('  %-46s ok' % name)
    # r187: main()'s shell -- argv and root graded against a tempdir fixture
    # carrying BOTH inputs, the r166..r186 pattern. This gate needs no git
    # repository (it rglobs, it does not ls-files), so a plain directory is
    # the whole fixture. The refusal case is the redirect kill: a main that
    # ignored root would scan the REAL tree (which exists) and return 0
    # where the fixture demands 2.
    import contextlib as _ctx
    import io as _io
    import tempfile as _tempfile
    shell = 0
    def _shell(files):
        with _tempfile.TemporaryDirectory() as td:
            base = Path(td)
            for rel, content in files.items():
                dst = base / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding='utf-8')
            out, err = _io.StringIO(), _io.StringIO()
            with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                rc = main(argv=[], root=base)
            return rc, out.getvalue() + err.getvalue()
    BARE_FTL = 'k-bare = Enter a key\n'
    ATTR_FTL = 'k-attr = Enter a key\n    .placeholder = API key\n'
    SITE = '<Localized id="k-bare" attrs={{ placeholder: true }}><input /></Localized>\n'
    shell += 1
    rc, text = _shell({'shared-ui/locales/en.ftl': BARE_FTL, 'ui/src/App.tsx': SITE})
    if rc != 1 or "ui/src/App.tsx:1" not in text or "k-bare" not in text:
        print(f'  x an undefined attribute must be a finding naming file:line (rc={rc} text={text[-90:]!r})',
              file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({'shared-ui/locales/en.ftl': ATTR_FTL,
                       'ui/src/App.tsx': SITE.replace('k-bare', 'k-attr')})
    if rc != 0 or 'OK: every resolvable' not in text:
        print(f'  x a defined attribute must be clean (rc={rc} text={text[-90:]!r})', file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({'ui/src/App.tsx': SITE})
    if rc != 2 or 'refused: expected' not in text:
        print(f'  x a missing bundle directory must refuse rc 2 (rc={rc} text={text[-90:]!r})', file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({'shared-ui/locales/en.ftl': ATTR_FTL,
                       'ui/src/App.tsx': SITE.replace('id="k-bare"', 'id={SOME_KEY}')})
    if rc != 0 or '1 attr site(s) unresolvable' not in text:
        print(f'  x an unresolvable id must be counted, not skipped (rc={rc} text={text[-90:]!r})',
              file=sys.stderr)
        return 1
    print('SELF-TEST %s (%d cases + %d shell cases)'
          % ('FAILED' if bad else 'OK', len(cases), shell))
    return 1 if bad else 0


def main(argv=None, root=None) -> int:
    """r187: argv and root parameterized, the r166..r186 contract -- root
    redirects the bundle directory AND the scan tree together."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--self-test', action='store_true',
                    help='run the extractor cases and exit; touches no files')
    args = ap.parse_args(argv)
    if args.self_test:
        return _self_test()

    base = REPO if root is None else Path(root).resolve()
    locales = base / 'shared-ui' / 'locales'
    scan_root = base / 'ui' / 'src'
    if not locales.is_dir() or not scan_root.is_dir():
        print('refused: expected %s and %s to exist' % (locales, scan_root))
        return 2

    en = load_en(locales)
    findings, unresolved, scanned = scan_tree(scan_root, en, base)
    for line in findings:
        print(line)
    print('scanned %d file(s) against %d EN message(s); %d attr site(s) unresolvable'
          % (scanned, len(en), unresolved))
    if findings:
        print('FAIL: %d attrs site(s) ask for an attribute the message does not define'
              % len(findings))
        return 1
    print('OK: every resolvable attrs request is defined on its message')
    return 0


if __name__ == '__main__':
    sys.exit(main())
