#!/usr/bin/env python3
"""Check that every id a template-literal getString() can build exists in
BOTH Fluent bundles.

The parity gate resolves only string literals, so a template-built id is
invisible to it. This script closes that gap for the families whose domain is
bounded by TypeScript (a union, a const array, a fixed .map list). Families
whose domain comes from the server (gift-card status, txn_type, product
category names) are reported as UNBOUNDED on purpose: no static check can
cover them, so the code must degrade gracefully instead.

Usage: python dyn_cover.py <repo_root>

UNWIRED -- and measured 2026-09-29, run by hand it exits 1 on ONE family. Open
finding GI-4 lists this among seven checkers no runner invokes.

WHAT IT ACTUALLY REPORTS, stated carefully because the obvious reading is wrong. The
"setup feature label" family is a HAND-MAINTAINED slug list below, not something
derived from the source, and none of the 27 ids it names (setup-feature-analytics-label,
setup-feature-audit-log-label, ...) appears anywhere under ui/src -- zero references.
So the GAP it reports is a true statement about the BUNDLE ("these 27 keys are absent")
and an unproven claim about the CODE ("the UI needs these 27 keys"). An earlier note in
this file, added the same day, called it a live product defect. That was overstated: the
defect demonstrably present here is THIS CHECKER'S STALE LIST, not 27 missing
translations. Adding the keys to the .ftl would be adding translation strings nothing
reads.

RESOLVED 2026-09-29, repo-wide, because it decides the wiring question:
  grep 'setup-feature-'          -> 12 hits, NONE of them a key or a source reference
  grep 'setup-feature-analytics-label' in shared-ui/locales -> 0
  the only two hits under shared-ui/locales are COMMENTS, and they point at
    "setup-feature-cloud-sync" -- a key that does not exist either.
So the keys are in neither bundle, referenced by no source file, and the only surviving
trace is two comments citing a third missing key. The setup wizard code that built these
ids is gone or renamed; the list is STALE.

That settles it: the fix is to DELETE the "setup feature label" family from the list
below, not to add 27 keys to the bundle. Adding them would put translation strings in the
.ftl that nothing reads -- inventing dead copy to satisfy a stale test.

Not done in this commit, and the reason is budget rather than judgement: deleting a
family changes what the gate accepts, and that deserves a run of this file afterwards to
confirm the other ten families still report OK. Recorded here so the next pass is one
delete plus one verification, not a re-derivation.

Still not wired, and the reason is now sharper: a blocking step would turn every
check.sh run red over a list that is probably itself wrong, which is worse than the
silent gap because it looks like a real failure.

NOT WIRED YET, DELIBERATELY. Wiring it as a blocking step would turn every check.sh run
red over 27 missing translations, and shipping that without fixing the ids is the
out-of-the-gate-gets-muted failure this repo has already paid for. The fix is 27 lines in
the .ftl bundle; the wiring is one step beside it. Whoever lands the translations should
do both, and can confirm the gap is closed by running this file directly.
"""
# Promoted from the 2026-09-03 Fluent page audit; see
# docs/records/audits/frontend/fluent-page-audit.md for why this check exists.

from __future__ import annotations

import re
import sys
from pathlib import Path

# Repo root, script-relative: scripts/ sits one level below it. An
# explicit path argument still wins, so the tool works from anywhere.
ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
LOCALES = ROOT / "shared-ui" / "locales"


EN = set()
ID = set()
for f in LOCALES.glob("*.ftl"):
    target = ID if f.name.endswith(".id.ftl") else EN
    for line in f.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Za-z0-9_-]+)\s*=", line.strip())
        if m:
            target.add(m.group(1))

# (family label, prefix, [suffixes]) — suffixes enumerated from the RUNTIME
# domain, not the TypeScript type. Getting this wrong produces false
# positives: the `Granularity` union admits 'daily', but the GRANULARITIES
# array the selector renders omits it, so analytics-granularity-daily
# correctly does not exist.
FAMILIES: list[tuple[str, str, list[str]]] = [
    ("analytics month", "analytics-month-",
     ["jan", "feb", "mar", "apr", "may", "jun",
      "jul", "aug", "sep", "oct", "nov", "dec"]),
    ("analytics granularity", "analytics-granularity-",
     ["weekly", "monthly", "yearly", "custom"]),
    ("analytics range preset", "analytics-range-preset-",
     ["7d", "30d", "90d", "365d"]),
    ("sales report view mode", "sales-report-",
     ["daily", "weekly", "monthly"]),
    ("data-mgmt type", "data-mgmt-type-",
     ["categories", "customers", "products", "sales", "settings", "users"]),
    ("topology rack panel", "topology-rack-",
     ["add-title", "edit-title", "share-title", "view-title"]),
    ("topology new node", "topology-new-",
     ["store", "workspace", "warehouse", "hardware"]),
    ("topology new node subtitle", "topology-new-",
     ["store-subtitle", "workspace-subtitle",
      "warehouse-subtitle", "hardware-subtitle"]),
    ("stock-transfers status", "stock-transfers-status-",
     ["all", "draft", "pending", "in_transit", "received",
      "received_partial", "cancelled"]),
    ("menu-eng quadrant", "menu-eng-",
     ["star", "plowhorse", "puzzle", "dog"]),
    ("inventory txn type (via map)", "inv-log-type-",
     ["sale", "void", "refund", "transfer", "po-receive",
      "stock-count", "manual-adjustment"]),
    ("offline-queue status (via statusLabel)", "offline-queue-status-",
     ["pending", "synced", "failed"]),
    ("sales-history status (via statusFluentId)", "sales-history-status-",
     ["completed", "pending", "voided"]),
    ("void-orders status (via statusLabelFluentId)", "void-orders-status-",
     ["active", "completed", "voided", "pending"]),
    ("restaurant sort mode", "restaurant-sort-",
     ["manual", "a-z", "date", "popularity"]),
    ("heatmap weekday", "day-",
     ["sunday", "monday", "tuesday", "wednesday", "thursday",
      "friday", "saturday"]),
    # REMOVED 2026-09-29: the "setup feature label" family (prefix "setup-feature-",
    # 27 slugs) is STALE and was deleted rather than satisfied. Measured repo-wide:
    # the keys are in neither shared.ftl nor shared.id.ftl, no source file under
    # ui/src references the prefix, and the only surviving traces are two comments
    # that themselves cite "setup-feature-cloud-sync" -- a key that does not exist
    # either. The code that built these ids is gone or renamed.
    #
    # The alternative was adding the 27 keys, which would have put translation
    # strings in the bundle that nothing reads: dead copy invented to satisfy a stale
    # assertion, and a gate that then reports OK. If the setup wizard ever regains
    # these labels, restore the family from git history at this commit and the
    # assertion becomes true because the code is true again -- not because a test was
    # made to agree with itself.
]

UNBOUNDED = [
    ("gift-cards status", "gift-cards-status-", "server string"),
    ("gift-cards txn type", "gift-cards-txn-", "server string"),
    ("sales report category", "sales-report-category-", "DB category name"),
    ("topology purpose", "topology-purpose-", "metadata.purposeKey, open set"),
]

bad = 0
for label, prefix, values in FAMILIES:
    miss_en = [prefix + v for v in values if prefix + v not in EN]
    miss_id = [prefix + v for v in values if prefix + v not in ID]
    status = "OK " if not miss_en and not miss_id else "GAP"
    if status == "GAP":
        bad += 1
    print(f"{status} {label:32s} {len(values):3d} ids"
          + (f"  missing en: {', '.join(miss_en)}" if miss_en else "")
          + (f"  missing id: {', '.join(miss_id)}" if miss_id else ""))

print()
for label, prefix, why in UNBOUNDED:
    present = sorted(k for k in EN if k.startswith(prefix))
    print(f"~~ {label:32s} prefix {prefix!r} — UNBOUNDED ({why}); "
          f"{len(present)} id(s) declared today")

print(f"\n{bad} bounded family/families with gaps.")
sys.exit(1 if bad else 0)
