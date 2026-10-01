#!/usr/bin/env python3
"""check-api-surface.py -- reconcile docs/guides/developer/api-reference.md against the real IPC surface.

WHY THIS EXISTS
  The reference page claimed to be auto-derived from generate_handler! while listing
  505 commands. The registries hold 450. The gap was not one number: 85 entries are
  command fns no generate_handler! includes, 14 are names that exist nowhere in the
  repo, 44 registered commands are missing from the page, and 11 availability markers
  name the wrong shell. A reader cannot tell those apart, and a prose audit finds them
  only by accident. This turns a one-off measurement into a re-runnable check.

SCOPE: a BLOCKING gate since 2026-09-29 -- wired into check.sh (step 'api surface'),
  gates.json ('api-surface') and dev-ci.yml#ci-docs-drift (step 'API reference surface'),
  with a green baseline from day one because the page was repaired in the same change
  that added the step. It ran reporting-only and unwired from 08-09-26 to 09-29: the page
  was red against it by design, and the recorded reason for not wiring it was that a gate
  introduced against a red page gets muted rather than fixed. Exit 2 on an unparseable
  input is what keeps that from cutting the other way -- a checker that cannot run must
  never read as a checker that found nothing.

USAGE
  python check-api-surface.py [--root REPO] [--json] [--full]
  python check-api-surface.py --self-test
  exit 0  doc and registries agree exactly
  exit 1  at least one of the four drift classes is non-empty
  exit 2  could not parse an input (never report drift on a parse failure)

SELF-TEST
  The classification is a pure function of three parsed inputs, so its cases need no
  filesystem and cannot rot when a crate is renamed - which is what took this checker out
  of scripts/check-auditor-selftests.sh before: it read live paths, and reading live
  paths is exactly what breaks when the tree moves.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

DOC_REL = "docs/guides/developer/api-reference.md"
CLIENTS = {"desktop": "apps/desktop-tauri", "tablet": "apps/mobile-tauri"}
BT = chr(96)  # a backtick, without embedding one in this file

HANDLER_RE = re.compile(r'generate_handler!\s*\[(.*?)\n\s*\]', re.S)
IDENT_IN_BLOCK_RE = re.compile(r'([A-Za-z_][\w:]*\w)\s*,')
COMMENT_RE = re.compile(r'//[^\n]*')
CMD_ATTR_RE = re.compile(r'^\s*#\[(?:tauri::)?command\]')
FN_RE = re.compile(r'^\s*pub\s+(?:async\s+)?fn\s+(\w+)')
SKIP_RE = re.compile(r'^\s*(?:#!?\[|///|//!|//|$)')
# a documented entry line looks like: - **<bt>name<bt>** [marker] -- summary
ENTRY_RE = re.compile(r'^- \*\*' + BT + r'([a-z0-9_]+)' + BT + r'\*\*\s*\[([^\]]*)\]')


def registered(root, app_dir):
    lib = root / app_dir / "src" / "lib.rs"
    if not lib.is_file():
        raise FileNotFoundError(str(lib))
    text = lib.read_text(encoding="utf-8", errors="replace")
    out = set()
    for block in HANDLER_RE.findall(text):
        block = COMMENT_RE.sub("", block)
        for ident in IDENT_IN_BLOCK_RE.findall(block):
            out.add(ident.split('::')[-1])
    return out


def defined(root, app_dir):
    """Every #[command] fn under src/, mapped to the file declaring it."""
    src = root / app_dir / 'src'
    if not src.is_dir():
        raise FileNotFoundError(str(src))
    found = {}
    for path in sorted(src.rglob('*.rs')):
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        for i, line in enumerate(lines):
            if not CMD_ATTR_RE.match(line):
                continue
            for j in range(i + 1, min(i + 12, len(lines))):
                nxt = lines[j]
                if SKIP_RE.match(nxt):
                    continue
                m = FN_RE.match(nxt)
                if m:
                    found.setdefault(m.group(1), path.name)
                break
    return found


def documented(root):
    doc = root / DOC_REL
    if not doc.is_file():
        raise FileNotFoundError(str(doc))
    rows = []
    for line in doc.read_text(encoding="utf-8", errors="replace").splitlines():
        m = ENTRY_RE.match(line)
        if m:
            rows.append((m.group(1), m.group(2).strip()))
    return rows


def norm(marker):
    return marker.replace('only', '').strip()


def classify(reg, dfn, doc):
    """Pure: the four drift buckets, from three already-parsed inputs. No filesystem.

    Split out of main() so --self-test can drive it with fixtures. The weakness this
    shape exists to remove is the one scripts/check-auditor-selftests.sh records for this
    file: it read live paths, so it could not run at all once apps/desktop-client became
    apps/desktop-tauri, and a checker that cannot run is indistinguishable from one that
    found nothing. Classification touches no path, so it can be tested anywhere.

    Returns a dict; the caller formats it. Every bucket is kept, not just counts, so the
    reporter and the test read the same objects.
    """
    all_reg = reg["desktop"] | reg["tablet"]
    truth = {}
    for n in all_reg:
        in_d, in_t = n in reg["desktop"], n in reg["tablet"]
        truth[n] = "D+T" if in_d and in_t else ("D" if in_d else "T")
    all_def = set(dfn["desktop"]) | set(dfn["tablet"])
    doc_names = [n for n, _ in doc]
    doc_set = set(doc_names)
    wrong = [(n, m, truth[n]) for n, m in doc if n in truth and norm(m) != truth[n]]
    unwired = [n for n in doc_names if n not in all_reg and n in all_def]
    absent = [n for n in doc_names if n not in all_reg and n not in all_def]
    missing = sorted(all_reg - doc_set)
    return {"truth": truth, "wrong": wrong, "unwired": unwired, "absent": absent,
            "missing": missing}


def _reg(d, t):
    return {"desktop": set(d), "tablet": set(t)}


def _dfn(d, t):
    return {"desktop": set(d), "tablet": set(t)}


# (name, reg, dfn, doc, expected {bucket: count}). Each row must put every command in
# exactly one bucket, so a row with a non-zero count in one bucket has zeros in the rest.
SELF = [
    ("clean page, all three marker shapes", _reg(["a", "b"], ["b", "c"]),
     _dfn(["a", "b"], ["b", "c"]), [("a", "D"), ("b", "D+T"), ("c", "T")], {}),
    # A doc may write [D only]; norm() strips the word, so this is NOT a marker error.
    ("'only' in a marker normalises away", _reg(["a"], ["b"]),
     _dfn(["a"], ["b"]), [("a", "D only"), ("b", "T only")], {}),
    ("marker names the wrong shell", _reg(["a", "b"], ["b"]),
     _dfn(["a", "b"], ["b"]), [("a", "T"), ("b", "D+T")], {"wrong": 1}),
    ("listed, not registered, but defined", _reg(["a"], []),
     _dfn(["a", "ghost"], []), [("a", "D"), ("ghost", "D")], {"unwired": 1}),
    ("listed, exists nowhere at all", _reg(["a"], []),
     _dfn(["a"], []), [("a", "D"), ("nowhere", "D")], {"absent": 1}),
    ("registered, not listed", _reg(["a", "b"], []),
     _dfn(["a", "b"], []), [("a", "D")], {"missing": 1}),
    # The four classes are independent: one row that trips three of them at once.
    ("three classes at once", _reg(["a", "unlisted"], []),
     _dfn(["a", "unlisted", "wired"], []),
     [("a", "T"), ("wired", "D"), ("ghost", "D")],
     {"wrong": 1, "unwired": 1, "absent": 1, "missing": 1}),
]


def self_test():
    bad = 0
    for name, reg, dfn, doc, want in SELF:
        c = classify(reg, dfn, doc)
        got = {"wrong": len(c["wrong"]), "unwired": len(c["unwired"]),
               "absent": len(c["absent"]), "missing": len(c["missing"])}
        got = {k: v for k, v in got.items() if v}
        if got != want:
            bad += 1
            print("  FAIL " + name + ": expected " + str(want) + ", got " + str(got))
        else:
            print("  ok   " + name)
    if bad:
        print("SELF-TEST FAILED (" + str(bad) + " of " + str(len(SELF)) + ")")
        return 1
    print("SELF-TEST OK (" + str(len(SELF)) + " cases, no files touched)")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--full", action="store_true",
                    help="list EVERY name per bucket, not just examples")
    ap.add_argument("--self-test", action="store_true",
                    help="run this checker's own cases and exit")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    root = Path(args.root).resolve()
    try:
        reg = {k: registered(root, v) for k, v in CLIENTS.items()}
        dfn = {k: defined(root, v) for k, v in CLIENTS.items()}
        doc = documented(root)
    except (FileNotFoundError, OSError) as exc:
        print("error: cannot parse inputs: %s" % exc, file=sys.stderr)
        return 2
    if not doc:
        print("error: parsed zero documented entries -- check ENTRY_RE", file=sys.stderr)
        return 2
    c = classify(reg, dfn, doc)
    all_reg = reg['desktop'] | reg['tablet']
    wrong, unwired = c['wrong'], c['unwired']
    absent, missing = c['absent'], c['missing']
    total = len(wrong) + len(unwired) + len(absent) + len(missing)
    out = {
        'registered_desktop': len(reg['desktop']),
        'registered_tablet': len(reg['tablet']),
        'registered_distinct': len(all_reg),
        'defined_desktop': len(dfn['desktop']),
        'defined_tablet': len(dfn['tablet']),
        'documented_entries': len(doc),
        'marker_wrong': len(wrong),
        'listed_not_registered': len(unwired),
        'listed_not_defined': len(absent),
        'registered_not_listed': len(missing),
        'clean': total == 0,
    # --full removes the cap. The truncation keeps the default output readable, but it
    # also means 'five examples' is all anyone ever looks at - and a bucket of 85 is not
    # triageable without its actual contents.
        'examples': {
            'marker_wrong': ['%s: doc [%s] truth [%s]' % t
                             for t in (wrong if args.full else wrong[:5])],
            'listed_not_registered': list(unwired if args.full else unwired[:5]),
            'listed_not_defined': list(absent if args.full else absent[:10]),
            'registered_not_listed': list(missing if args.full else missing[:10]),
        },
    }
    if args.json:
        print(json.dumps(out, indent=2))
    else:
        print('registered   desktop=%d tablet=%d distinct=%d'
              % (out['registered_desktop'], out['registered_tablet'], out['registered_distinct']))
        print('defined      desktop=%d tablet=%d'
              % (out['defined_desktop'], out['defined_tablet']))
        print('documented   %d entries in %s' % (len(doc), DOC_REL))
        print('')
        print('  marker wrong                    : %d' % len(wrong))
        print('  listed, not registered anywhere : %d' % len(unwired))
        print('  listed, not defined anywhere    : %d' % len(absent))
        print('  registered, not listed          : %d' % len(missing))
        # 'listed_not_registered' used to be missing from this loop entirely: the largest
        # bucket in the report (85 names) was counted, capped to 5 inside the JSON, and
        # then never printed for humans at all. A number nobody can enumerate is not a
        # finding, it is an alarm.
        for key, label in (('marker_wrong', 'wrong marker'),
                           ('listed_not_registered', 'unregistered'),
                           ('listed_not_defined', 'does not exist'),
                           ('registered_not_listed', 'undocumented')):
            for ex in out['examples'][key]:
                print("    %-18s %s" % (label, ex))
            if args.full and len(out['examples'][key]) == 0:
                pass
        print('')
        print('CLEAN: doc and registries agree' if total == 0
              else 'DRIFT: %d discrepancies' % total)
    return 0 if total == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
