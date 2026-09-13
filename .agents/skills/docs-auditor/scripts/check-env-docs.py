#!/usr/bin/env python3
"""Fail when a variable the license server reads is documented nowhere.

Why: apps/license-server/DEPLOY.md section 7 opens with 'This section documents every
variable in full'. On 09-09-26 five names the binary reads appeared in no document at all -
three of them the login lockout (LOGIN_LOCKOUT_MIN_GAP, LOGIN_LOCKOUT_MAX_COOLDOWN,
LOGIN_LOCKOUT_DISABLED), so the one control that slows credential stuffing had no
operator-facing description, and a fourth (OZ_ADMIN_EMAIL) identifies a tenant the code
refuses to let change after boot. No existing gate could see any of it:
verify-ci-docs-drift.py compares docs against *gates*, not against configuration surface.
A variable that is read but never named fails closed in exactly one direction - unset means
the documented default - so nothing ever complains until someone sets it and it does not
behave as the person expected.

Scope is deliberately both apps, and that is the finding this script encodes:
  - apps/license-server/*.go  (os.Getenv / LookupEnv)
  - apps/unified/healthcheck.sh  (${VAR}) - the container healthcheck's own knobs live
    here, NOT in the service directory. Scanning only apps/license-server reported four
    'absent from code' names on the first run, all false: OZ_HEALTH_*_MAX_FAILS are real and
    read by apps/unified/healthcheck.sh. Test files (*_test.go) are excluded: a name read
    only by a test is not an operator surface.

Documented means named in at least one of: apps/license-server/DEPLOY.md,
docs/operations/go-live-checklist.md, .env.example, or any
apps/license-server/verification-*.md. A name may be exempted with an inline
`env-doc: ok: <reason>` comment on the Getenv line - same pragma spirit as the other
checkers here, decided by the repo rather than a hardcoded allowlist.

Exit 0 clean, 1 findings, 2 usage/self-test failure.
"""
from __future__ import annotations
import argparse, json, re, subprocess, sys
from pathlib import Path

GETENV = re.compile(r'(?:Getenv|LookupEnv)\(\s*"([A-Z][A-Z0-9_]{3,})"\)')
SHELLVAR = re.compile(r'\$\{?([A-Z][A-Z0-9_]{4,})')
PRAGMA = re.compile(r'env-doc:\s*ok\s*:', re.I)
PREFIX = ('OZ_', 'PADDLE_', 'MIDTRANS_', 'LOGIN_', 'LICENSE_', 'OZPA_')
DOC_GLOBS = ['apps/license-server/DEPLOY.md', 'docs/operations/go-live-checklist.md',
             '.env.example']

def repo_root():
    o = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                       stdout=subprocess.PIPE, text=True, errors='replace')
    if o.returncode != 0:
        raise SystemExit(2)
    return Path(o.stdout.strip())

def code_names(r: Path):
    out = {}
    for p in sorted((r / 'apps' / 'license-server').glob('*.go')):
        if p.name.endswith('_test.go'):
            continue
        for i, line in enumerate(p.read_text(encoding='utf-8', errors='replace').splitlines(), 1):
            if PRAGMA.search(line):
                continue
            for m in GETENV.finditer(line):
                if m.group(1).startswith(PREFIX):
                    out.setdefault(m.group(1), []).append('%s:%d' % (p.name, i))
    hc = r / 'apps' / 'unified' / 'healthcheck.sh'
    if hc.is_file():
        for i, line in enumerate(hc.read_text(encoding='utf-8', errors='replace').splitlines(), 1):
            if PRAGMA.search(line) or line.strip().startswith('#'):
                continue
            for m in SHELLVAR.finditer(line):
                if m.group(1).startswith(PREFIX):
                    out.setdefault(m.group(1), []).append('healthcheck.sh:%d' % i)
    return out

def docs_text(r: Path):
    t = ''
    for g in DOC_GLOBS:
        p = r / g
        if p.is_file():
            t += p.read_text(encoding='utf-8', errors='replace')
    for p in sorted((r / 'apps' / 'license-server').glob('verification-*.md')):
        t += p.read_text(encoding='utf-8', errors='replace')
    return t

def check(r: Path):
    names = code_names(r)
    text = docs_text(r)
    missing = sorted(n for n in names if n not in text)
    return [{'name': n, 'reads': names[n]} for n in missing], len(names)

def parse_go(text):
    out = []
    for line in text.splitlines():
        if PRAGMA.search(line):
            continue
        for m in GETENV.finditer(line):
            if m.group(1).startswith(PREFIX):
                out.append(m.group(1))
    return out

def parse_sh(text):
    out = []
    for line in text.splitlines():
        if PRAGMA.search(line) or line.strip().startswith('#'):
            continue
        for m in SHELLVAR.finditer(line):
            if m.group(1).startswith(PREFIX):
                out.append(m.group(1))
    return out

def self_test(r: Path) -> int:
    """Pure: synthetic strings only. No file on disk is created, read-only or otherwise,
    because a self-test that writes to the tree can damage what it polices.
    (see check-nav-paths.py for the incident that taught that.)"""
    names = code_names(r)
    cases = []
    cases.append(('live model is non-empty', len(names) > 10))
    go = parse_go('package main\nvar _ = os.Getenv("OZ_UNDOCUMENTED_TEST_NAME")\n' +
                  'var _ = os.Getenv("OZ_EXEMPT_BY_PRAGMA") // env-doc: ok: internal hook\n')
    cases.append(('go Getenv parsed', 'OZ_UNDOCUMENTED_TEST_NAME' in go))
    cases.append(('pragma exempts the line', 'OZ_EXEMPT_BY_PRAGMA' not in go))
    sh = parse_sh('#!/bin/sh\nx="${OZ_SHELL_ONLY_NAME} "\ny="${OZ_SHELL_DEFAULT_NAME:-3}"\n# ${OZ_IN_COMMENT}\n')
    cases.append(('shell var parsed', 'OZ_SHELL_ONLY_NAME' in sh and 'OZ_SHELL_DEFAULT_NAME' in sh))
    cases.append(('commented shell var ignored', 'OZ_IN_COMMENT' not in sh))
    dt = docs_text(r)
    cases.append(('a truly documented name parses and is not flagged',
                  'OZ_SMTP_HOST' in names and 'OZ_SMTP_HOST' in dt))
    cases.append(('an undocumented test name would be flagged',
                  'OZ_UNDOCUMENTED_TEST_NAME' not in dt))
    cases.append(('pragma-exempt name never enters the model',
                  'OZ_EXEMPT_BY_PRAGMA' not in names))
    real = [k for k in names if k not in docs_text(r)]
    cases.append(('live findings match check()', len(real) == len(check(r)[0])))
    bad = [n for n, ok in cases if not ok]
    if bad:
        print('SELF-TEST WRONG: ' + ', '.join(bad), file=sys.stderr)
        return 2
    print('SELF-TEST OK (%d cases; live model has %d names, %d documented)' % (
        len(cases), len(names), len(names) - len(real)))
    return 0

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args()
    r = repo_root()
    if a.self_test:
        return self_test(r)
    missing, total = check(r)
    if a.json:
        print(json.dumps({'scanned': total, 'count': len(missing), 'missing': missing}, indent=1))
    elif missing:
        for m in missing:
            print('%-32s read at %s' % (m['name'], ', '.join(m['reads'][:3])))
        print('')
        print('check-env-docs: %d of %d variables the code reads appear in no document'
              % (len(missing), total))
    else:
        print('check-env-docs: all %d code-read variables are named in a doc.' % total)
    return 1 if missing else 0

if __name__ == '__main__':
    raise SystemExit(main())
