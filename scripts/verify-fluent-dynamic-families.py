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
"""
# Promoted from the 2026-09-03 Fluent page audit; see
# docs/records/fluent-page-audit.md for why this check exists.

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
    ("setup feature label", "setup-feature-",
     ["analytics-label", "audit-log-label", "barcode-scanning-label",
      "card-payment-label", "cash-drawer-label", "cash-payment-label",
      "categories-enabled-label", "cloud-sync-label",
      "customer-display-label", "discount-engine-label",
      "export-import-label", "inventory-tracking-label",
      "loyalty-program-label", "multi-currency-label", "multi-store-label",
      "multi-terminal-label", "nfc-reader-label", "plugin-system-label",
      "product-bundles-label", "product-variants-label",
      "promotions-engine-label", "receipt-printing-label",
      "reporting-label", "shift-management-label", "staff-login-label",
      "staff-roles-label", "tax-engine-label"]),
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
