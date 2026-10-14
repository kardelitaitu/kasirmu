#!/usr/bin/env python3
"""restaurant-coverage.py -- how much of the restaurant surface e2e actually addresses.

WHY THIS EXISTS
Three rounds this session produced a WRONG coverage number, each the same way: the scan
searched source text and the source did not spell the id as the scan expected.

  round 180  role=tab matched inside a querySelector STRING and inside a COMMENT
  round 224  data-testid=qris-mode-static missed, because the spec writes it as a
             TEMPLATE LITERAL: data-testid=`qris-mode-${mode}`
  round 225  sel.locator('option') returned [] for a CUSTOM dropdown rendered in a portal

The shared lesson is not about regexes. It is that an empty reading is evidence about the
INSTRUMENT until the instrument is shown able to find a positive. This script therefore
carries a SELF-CHECK: it proves it can see an id the specs are known to reference before it
reports anything. A run that cannot pass the self-check exits non-zero and prints NO numbers.

WHAT IT COUNTS
For each screen file: every data-testid it declares, and whether any spec under ui/e2e
references it -- literally, or through a templated prefix that the id starts with.

USAGE
  python3 scripts/restaurant-coverage.py            # the table
  python3 scripts/restaurant-coverage.py --json     # machine-readable
  python3 scripts/restaurant-coverage.py --self-test

Exit codes: 0 reported, 1 self-check failed (numbers withheld), 2 usage error.
"""

import argparse
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
E2E = os.path.join(ROOT, 'ui', 'e2e')

SCREENS = [
    ('payments', 'ui/src/features/restaurant/screens/RestaurantPaymentsScreen.tsx'),
    ('receipts', 'ui/src/features/restaurant/screens/RestaurantReceiptsScreen.tsx'),
    ('settings', 'ui/src/features/restaurant/screens/RestaurantSettingsScreen.tsx'),
    ('editor', 'ui/src/features/restaurant/screens/RestaurantMenuEditorScreen.tsx'),
    ('tables', 'ui/src/features/tables/TableManagementScreen.tsx'),
    ('CartPanel', 'ui/src/features/sales/components/CartPanel.tsx'),
    ('CartLineItem', 'ui/src/features/sales/components/CartLineItem.tsx'),
]

DECL = re.compile(r'data-testid="([a-zA-Z][a-zA-Z0-9-]+)"')
# An id may be addressed through a template or a prefix selector rather than literally.
TEMPLATE = re.compile(r'data-testid="([a-zA-Z][a-zA-Z0-9-]*)\$\{')
PREFIX = re.compile(r'\[data-testid\^="([a-zA-Z][a-zA-Z0-9-]+)"')

# An id the specs are KNOWN to address literally. If the scan cannot see this one it is
# broken, and its numbers would be noise -- so they are withheld.
SELF_CHECK_ID = 'restaurant-menu-editor-bulk-avail'


def spec_corpus():
    parts = []
    for name in sorted(os.listdir(E2E)):
        if name.endswith('.spec.ts'):
            with open(os.path.join(E2E, name), encoding='utf-8', errors='replace') as fh:
                parts.append(fh.read())
    return '\n'.join(parts)


def instruments(corpus):
    return set(DECL.findall(corpus)), set(TEMPLATE.findall(corpus)) | set(PREFIX.findall(corpus))


def seen(tid, literals, prefixes):
    return tid in literals or any(tid.startswith(pre) for pre in prefixes)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args()

    if not os.path.isdir(E2E):
        print('no ui/e2e directory -- wrong root?', file=sys.stderr)
        return 2

    corpus = spec_corpus()
    literals, prefixes = instruments(corpus)

    if not seen(SELF_CHECK_ID, literals, prefixes):
        print('SELF-CHECK FAILED: cannot see %r, which specs DO reference.' % SELF_CHECK_ID)
        print('The scan is broken, so its numbers would be noise. Fix the scan, not this file.')
        return 1

    if args.self_test:
        print('self-test ok: sees %r across %d spec bytes' % (SELF_CHECK_ID, len(corpus)))
        return 0

    rows = []
    for label, rel in SCREENS:
        with open(os.path.join(ROOT, rel), encoding='utf-8', errors='replace') as fh:
            ids = sorted(set(DECL.findall(fh.read())))
        hit = [i for i in ids if seen(i, literals, prefixes)]
        rows.append({'screen': label, 'file': rel, 'total': len(ids),
                     'covered': len(hit), 'missing': [i for i in ids if i not in hit]})

    if args.json:
        print(json.dumps(rows, indent=2))
        return 0

    width = max(len(r['screen']) for r in rows)
    print('screen'.ljust(width) + '  covered   pct')
    for r in rows:
        pct = round(100 * r['covered'] / r['total']) if r['total'] else 0
        print(r['screen'].ljust(width) + '  %2d/%-3d  %4d%%' % (r['covered'], r['total'], pct))
    return 0


if __name__ == '__main__':
    sys.exit(main())