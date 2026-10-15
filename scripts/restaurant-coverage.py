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

# A spec USES an id when the string appears inside a selector, not merely anywhere in the file.
#
# Round 269 found the reason this matters: a spec named `restaurant-menu-editor-manage-recipe-btn`
# three times in COMMENTS while driving a different route, so the old count called it covered and
# the gap survived a round. A mention is not a use, and a coverage number that counts mentions is a
# coverage number that cannot be trusted.
#
# Matched by the surrounding call, not by stripping comments: stripping them is a parser, and this
# is a heuristic that errs toward calling something a use. The three shapes used across the specs
# are `locator(...)`, `getByTestId(...)` and `querySelector(...)`.
# NOTE ON THE TWO MEASURES. `covered` answers "is this id mentioned anywhere in a spec?" and
# `used` answers "is it mentioned on a line that also makes a selector call?". Round 269 found why
# both are needed: a spec named `restaurant-menu-editor-manage-recipe-btn` in THREE COMMENTS while
# driving a different route, so `covered` called it done and the gap survived a round.
#
# The `used` measure is deliberately loose — it errs toward counting something as a use, because
# the reverse error (calling a used id unused) would read as a gap where there is none. It is a
# second reading, not a stricter gate, which is why the table prints both.
SELECTOR_CALL = re.compile(r'\.locator\(|getByTestId\(|querySelector(?:All)?\(')


def used_ids(corpus: str) -> set:
    """Ids that appear on a line that also makes a selector call."""
    out = set()
    for line in corpus.split('\n'):
        if not SELECTOR_CALL.search(line):
            continue
        for m in DECL.finditer(line):
            out.add(m.group(1))
    return out
    """Ids the specs actually reference inside a selector."""
    return set(USE.findall(corpus))
# An id may be addressed through a template or a prefix selector rather than literally.
TEMPLATE = re.compile(r'data-testid="([a-zA-Z][a-zA-Z0-9-]*)\$\{')
PREFIX = re.compile(r'\[data-testid\^="([a-zA-Z][a-zA-Z0-9-]+)"')

# An id the specs are KNOWN to address literally. If the scan cannot see this one it is
# broken, and its numbers would be noise -- so they are withheld.

# IDs that CANNOT render in the scanned workspace because a branch relocates them.
#
# Both of these are rendered by `CartPanel.tsx:573` under `!sidebarOwnsTerminalActions`, which is
# FALSE on the restaurant till: the restaurant tier moves them into the sidebar popover
# (`RestaurantSidebar.tsx:441-461`). Counting them as uncovered reports a DESIGNED absence as a gap,
# which is the round-224 class of error one layer over.
#
# The relocated control IS covered behaviourally -- `ui/e2e/restaurant-cart-deduction-badge.spec.ts`
# (round 243) drives the override that reveals it and asserts the `Deducting:` row on both profiles.
# It does not spell the cart-panel testid, because that element never exists there.
VIEW_GATED = {
    'deduction-location-badge',
    'deduction-override-indicator',
}

# The `used` measure needs its own floor, for the same reason `SELF_CHECK_ID` exists above.
#
# Kill-tested 2026-10-15 (round 272): replacing `SELECTOR_CALL` with a pattern that matches nothing
# collapsed every `used` count to 0-2 and the script still exited 0. A broken measure that reports
# silently is worse than no measure, because the number is read as a finding.
#
# The floor is a FLOOR, not a target: it only has to be high enough that a collapsed measure cannot
# clear it. Measured at 200+ when healthy, so 50 is far below any real value and far above zero.
USED_FLOOR = 50
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
    used = used_ids(corpus)

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
        # A use, not a mention. Round 269's spec named an id in three COMMENTS while driving a
        # different route, so the old rule counted it and the gap survived a round. Reported
        # separately rather than replacing the loose count, which still carries the templated
        # and prefix forms the regex cannot see.
        used_ids_here = [i for i in hit if i in used or any(i.startswith(p) for p in prefixes)]
        rows.append({'screen': label, 'file': rel, 'total': len(ids),
                     'covered': len(hit), 'used': len(used_ids_here),
                     'missing': [i for i in ids if i not in hit and i not in VIEW_GATED],
                     'view_gated': [i for i in ids if i in VIEW_GATED]});

    total_used = sum(r['used'] for r in rows)
    if total_used < USED_FLOOR:
        print('REFUSING TO REPORT: the used measure found only %d selector uses.' % total_used)
        print('That is far below any healthy value, so the measure is broken and the column')
        print('would be read as a finding. Check SELECTOR_CALL and the spec corpus.')
        return 1

    if args.json:
        print(json.dumps(rows, indent=2))
        return 0

    width = max(len(r['screen']) for r in rows)
    print('screen'.ljust(width) + '  covered   used   pct')
    for r in rows:
        pct = round(100 * r['covered'] / r['total']) if r['total'] else 0
        pct = round(100 * r['used'] / r['total']) if r['total'] else 0
        print(r['screen'].ljust(width) + '  %2d/%-3d %3d/%-3d %4d%%' % (r['covered'], r['total'], r['used'], r['total'], pct))
    return 0


if __name__ == '__main__':
    sys.exit(main())