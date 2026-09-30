#!/usr/bin/env python3
"""Verify the soft namespace-governance rules for the modular scaffolding effort.

The rules this gate exists to keep honest are recorded in
``docs/architecture/module-namespace-governance.md``. There are three:

  Rule 1  No new cross-vertical raw SQL outside the approved facades.
  Rule 2  No new unclassified event handlers.
  Rule 3  No new module dependencies without declared capabilities.

Why a gate at all
=================

A rule that lives only in a document is a rule nobody applies. The plan
(``todo-modular-scaffolding.md`` §9.2) is explicit that Phase 1 governance is
SOFT -- it must not fail a build on the cross-vertical access that exists today,
because every module shares one SQLite connection and strict rejection would
break working functionality. So this checker freezes the CURRENT set of
violations in a baseline and fails only when the set GROWS: a new cross-vertical
table reference, or a new EventHandler type with no classification. That is the
same posture ``verify-architecture-boundaries.py`` uses, and for the same reason.

HOW IT DECIDES
==============

  Rule 1  Scans production ``.rs`` files under ``modules/`` (a ``tests/``
          directory or a ``*_tests.rs`` sibling is skipped), masks comments and
          string contents, extracts the tables named after ``FROM`` / ``JOIN`` /
          ``INTO`` / ``UPDATE`` / ``DELETE FROM``, and compares each against the
          table -> module ownership map below. A table owned by another module,
          and not covered by the frozen baseline, is a blocking finding.

          The ownership map is deliberately small and is DATA, not a plan claim:
          it is the set of tables the owning module's repository creates. Tables
          no module claims are reported at most once as an informational note --
          governance should never turn an unmodelled table into a hard failure.

  Rule 2  Scans production ``.rs`` files under ``modules/``, ``platform/`` and
          ``crates/``, derives the type of every ``impl EventHandler<...> for``,
          and requires the type to appear in ``scripts/handler-classification.json``.
          A type that is absent is a NEW handler added without classification, and
          is blocking. Types that are present are NOT re-graded: the Phase 0 census
          (``docs/architecture/handler-census-phase0.md``) classified them, and
          re-grading them here would duplicate that work.

  Rule 3  Reported, never failed. For every cross-vertical table a module names,
          the module's ``modules/<id>/manifest.json`` must declare the owning
          module in its ``dependencies`` array. Edges that lack the declaration
          are printed as informational findings. This is a review rule today by
          design (governance doc §2, Rule 3): two such edges exist, and making
          this a hard failure is a Phase 4 change gated on closing them.

USAGE
=====

    python3 scripts/verify-namespace-governance.py
    python3 scripts/verify-namespace-governance.py --report-only
    python3 scripts/verify-namespace-governance.py --json
    python3 scripts/verify-namespace-governance.py --root <path>
    python3 scripts/verify-namespace-governance.py --baseline-file <path>
    python3 scripts/verify-namespace-governance.py --classification-file <path>
    python3 scripts/verify-namespace-governance.py --self-test

EXIT CODES -- and why 0 alone is not a verdict
=============================================

  0  the checker ran and found no NEW violation. It does not mean there is no
     cross-vertical access: the baseline holds the known edges, and the green
     line prints the population it examined (files scanned, baseline entries) so
     a run against an empty tree reads differently from a clean one. Three very
     different facts produce this code: nothing to report, a --report-only run
     told not to judge, and a scope that examined nothing. The printed
     population clause is what separates them.
  1  a new cross-vertical table reference, a new unclassified handler, or a
     baseline entry that no longer matches (stale) -- the debt is gone and the
     baseline must say so.
  2  malformed or missing input: the baseline, the classification registry, or
     a module manifest could not be read/parsed, or no production module source
     was found to scan at all.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# -- The table ownership map (governance doc §3) ----------------------------
# module id -> tables that module's repository owns. Kept as DATA so a reviewer
# sees the whole claim in one place, and so the checker does not import an
# ownership opinion from anywhere else. Reporting owns no tables: it reads
# through the sanctioned facade (ADR-62 D5).
TABLE_OWNERS: dict[str, tuple[str, ...]] = {
    "sales": ("sales", "sale_lines"),
    "inventory": ("products", "product_recipes", "inventory", "stock_summary"),
    "crm": ("customers",),
    "settings": ("settings",),
    "currency": ("currencies", "exchange_rates"),
    "loyalty": ("loyalty_accounts", "loyalty_tiers", "loyalty_transactions"),
    "staff": ("users", "roles"),
    "tax": ("tax_rates", "category_taxes", "product_taxes"),
    "terminal": ("terminals", "terminal_profiles", "terminal_feature_overrides"),
    "giftcards": ("gift_cards", "gift_card_transactions"),
    "kitchen": ("kds_daily_counters", "kds_line_items", "kds_order_targets"),
    "promotions": ("promotions", "promotion_applications"),
    "purchasing": ("purchase_orders", "purchase_order_lines"),
    "reporting": (),
}

# Inverted once at import: table -> owning module.
TABLE_TO_MODULE: dict[str, str] = {
    table: module for module, tables in TABLE_OWNERS.items() for table in tables
}

# module directory name -> module id. modules/sales holds the sales module.
MODULE_SOURCE_ROOT = "modules"
# Roots walked for impl EventHandler<...> (Rule 2): the module crates plus the
# crates/platform crates that carry production handlers.
HANDLER_ROOTS = ("modules", "platform", "crates")
TEST_DIR_PARTS = {"tests", "__tests__", "test"}
TEST_FILE_SUFFIX = "_tests.rs"

# Tables are named in SQL after one of these keywords. Anchored on the keyword,
# then a bare identifier, so CTEs, subqueries and aliases are not collected.
SQL_CLAUSE_KEYWORDS = frozenset({
    "set", "values", "select", "where", "on", "using", "and", "or",
    "order", "group", "limit", "returning", "with", "as",
})
SQL_TABLE_RE = re.compile(
    r"\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.IGNORECASE,
)
# impl EventHandler<SaleCompleted> for SaleSyncEnqueuer
# impl EventHandler<SaleCompleted> for SaleSyncEnqueuer
# The target must be a BARE type name: `for std::sync::Arc<BusHandler>` is a
# blanket-impl fixture, not a handler type, and matching just `std` there would
# invent a finding. A leading `::` or a following `::` is rejected.
EVENT_HANDLER_RE = re.compile(
    r"impl\s+EventHandler\s*<[^>]+>\s+for\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?=[\s{;])"
)


def configure_streams() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def fail(message: str) -> int:
    print(f"verify-namespace-governance: error: {message}", file=sys.stderr)
    return 2


def load_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"{label} not found: {path}") from exc
    except OSError as exc:
        raise ValueError(f"cannot read {label}: {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"malformed {label}: {path}: {exc}") from exc


def mask_comments_and_strings(text: str) -> str:
    """Blank comment and string contents while preserving offsets and newlines.

    The same helper the architecture-boundaries checker carries, and for the
    same reason: a table name mentioned in a doc comment or a log message is
    prose, not SQL. A literal ("select from customers") masks to spaces, so
    only real query text is scanned. Line numbers stay usable because every
    non-newline character in a masked region becomes a space.
    """
    out: list[str] = []
    i = 0
    in_string: str | None = None
    in_block = False
    while i < len(text):
        char = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if in_block:
            if char == "*" and nxt == "/":
                in_block = False
                out.extend("  ")
                i += 2
            else:
                out.append("\n" if char == "\n" else " ")
                i += 1
            continue
        if in_string:
            if char == "\\" and i + 1 < len(text):
                out.extend("  ")
                i += 2
                continue
            if char == in_string:
                in_string = None
            out.append("\n" if char == "\n" else " ")
            i += 1
            continue
        if char == "'":
            # A char literal ('a', '\\n', '"') or a lifetime ('a). Only a
            # CLOSED char literal is a string-like region; a lifetime has no
            # closing quote and must not open one, or <'a> blanks the rest of
            # the file and any impl/label after it is never seen.
            if i + 1 < len(text) and text[i + 1] == "\\" and i + 2 < len(text):
                out.append(" ")
                i += 1
                # consume the escape and its closing quote if present
                out.extend(" " * 2)
                i += 2
                if i < len(text) and text[i] == "'":
                    out.append(" ")
                    i += 1
                continue
            if i + 2 < len(text) and text[i + 2] == "'":
                out.extend("   ")
                i += 3
                continue
            out.append(" ")
            i += 1
        elif char in ('"', "`"):
            in_string = char
            out.append(" ")
            i += 1
        elif char == "/" and nxt == "/":
            out.extend("  ")
            i += 2
            while i < len(text) and text[i] != "\n":
                out.append(" ")
                i += 1
        elif char == "/" and nxt == "*":
            in_block = True
            out.extend("  ")
            i += 2
        else:
            out.append(char)
            i += 1
    return "".join(out)


def sql_literals(text: str) -> list[tuple[str, int]]:
    """The bodies of Rust string literals, with the line each starts on.

    Rule 1 has to read table names, and those live INSIDE string literals
    (self.conn.prepare("SELECT ... FROM sales ...")). mask_comments_and_strings
    blanks literal contents to hunt code identifiers, which is right for the
    handler pass and wrong here: applied to SQL it would erase the very text
    this rule grades. So comments are stripped, literals are KEPT, and each
    literal body is returned with the 1-based line of its opening quote.

    Three shapes are handled because all three occur (or may occur) here:
      * a normal double-quoted literal, with \\ escapes;
      * a raw literal r"...", r#"..."#, r##"..."## ...;
      * SQL that embeds single quotes (WHERE status = 'completed'), which is
        NOT a Rust string delimiter and must not start or end a literal.
    A char literal ('a') and a lifetime ('a) are left alone: only ", r" and
    r#*" open a string, so a leading single quote is never treated as one.
    """
    literals: list[tuple[str, int]] = []
    i = 0
    line = 1
    n = len(text)
    while i < n:
        char = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if char == "\n":
            line += 1
            i += 1
            continue
        if char == "/" and nxt == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if char == "/" and nxt == "*":
            i += 2
            while i < n and not (text[i] == "*" and i + 1 < n and text[i + 1] == "/"):
                if text[i] == "\n":
                    line += 1
                i += 1
            i += 2
            continue
        # Raw string: r", r#", r##" ...
        if char == "r" and (nxt == '"' or nxt == "#"):
            j = i + 1
            hashes = 0
            while j < n and text[j] == "#":
                hashes += 1
                j += 1
            if j < n and text[j] == '"':
                body_start = j + 1
                close = '"' + "#" * hashes
                end = text.find(close, body_start)
                if end == -1:
                    end = n
                body = text[body_start:end]
                literals.append((body, line))
                line += text[i:end].count("\n")
                i = end + len(close)
                continue
        # Char literal or lifetime: 'a', '\\n', '"'. A '"' must NOT open a
        # string, or trim_matches('"') merges the next real literal into this
        # one (the bug that made "sale" leak out of prose). Skip the enclosed
        # character and its closing quote when one is present.
        if char == "'":
            if i + 1 < n and text[i + 1] == "\\" and i + 2 < n:
                i += 3
                if i < n and text[i] == "'":
                    i += 1
                continue
            if i + 2 < n and text[i + 2] == "'":
                i += 3
                continue
            # A lifetime ('a) or a lone quote: consume just the apostrophe.
            i += 1
            continue
        if char == '"':
            body_start = i + 1
            j = body_start
            while j < n:
                if text[j] == "\\" and j + 1 < n:
                    j += 2
                    continue
                if text[j] == '"':
                    break
                j += 1
            body = text[body_start:j]
            literals.append((body, line))
            line += text[i:j].count("\n")
            i = j + 1
            continue
        i += 1
    return literals


SQL_VERB_RE = re.compile(
    r"^\s*(?:SELECT|INSERT|UPDATE|DELETE|REPLACE|WITH)\b", re.IGNORECASE
)


def is_sql_literal(body: str) -> bool:
    """True when a literal body is a SQL statement rather than prose.

    A table-like token can sit inside a HUMAN string ('failed to construct
    sale from cart') and a keyword-anchored regex cannot tell the two apart.
    SQL statements in this repo always open with a verb, so the literal must
    start with one; an error message or log line does not. This is the
    cheapest honest filter -- a literal that opens with SELECT/INSERT/UPDATE/
    DELETE/REPLACE/WITH is query text, everything else is prose.
    """
    return bool(SQL_VERB_RE.match(body))


def relative_path(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve())).replace("\\", "/")
    except (ValueError, OSError):
        return str(path).replace("\\", "/")


def is_production_source(path: Path) -> bool:
    """True for a .rs file that carries behaviour, false for test scaffolding.

    Both spellings this repo uses are excluded: a tests/ directory anywhere in
    the path, and the *_tests.rs sibling convention (e.g.
    modules/inventory/src/handlers_tests.rs). The inline #[cfg(test)] module
    inside a production file is NOT excluded -- it is still a real file a
    reviewer reads, and the checker's dedupe makes its extra references
    harmless.
    """
    if path.suffix != ".rs":
        return False
    if TEST_DIR_PARTS & set(path.parts):
        return False
    if path.name.endswith(TEST_FILE_SUFFIX):
        return False
    if path.name == "tests.rs":
        # platform/kernel/src/kernel/tests.rs and siblings: a whole file of
        # #[cfg(test)] cases. The census excluded its test-only EventHandler
        # impls (BusHandler, StopHandler), and this gate grades the same
        # population the census did.
        return False
    return True


def module_id_for(path: Path, root: Path) -> str | None:
    """The module id a source file belongs to, or None if not under modules/.

    Only the FIRST path component after modules/ is a module id, so
    modules/sales/src/repository.rs and modules/sales/tests/x.rs both map to
    sales. A file directly under modules/ maps to no module.
    """
    try:
        rel = path.resolve().relative_to((root / MODULE_SOURCE_ROOT).resolve())
    except (ValueError, OSError):
        return None
    parts = rel.parts
    if len(parts) < 2:
        return None
    return parts[0]


def production_sources(base: Path) -> list[Path]:
    if not base.is_dir():
        return []
    return [p for p in sorted(base.rglob("*.rs")) if is_production_source(p)]


def module_sql_findings(root: Path, scope: dict[str, int]) -> list[dict[str, Any]]:
    """Every cross-vertical table a module names in raw SQL (Rule 1's subject)."""
    findings: list[dict[str, Any]] = []
    modules_root = root / MODULE_SOURCE_ROOT
    if not modules_root.is_dir():
        return findings  # intended fixture behaviour; population stays 0
    for path in production_sources(modules_root):
        owner_module = module_id_for(path, root)
        if owner_module is None:
            continue
        scope["module_files"] += 1
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise ValueError(f"cannot read module source: {path}: {exc}") from exc
        seen_tables: set[str] = set()
        for body, start_line in sql_literals(raw):
            if not is_sql_literal(body):
                continue
            for match in SQL_TABLE_RE.finditer(body):
                table = match.group(1).lower()
                if table in SQL_CLAUSE_KEYWORDS:
                    continue
                if table in seen_tables:
                    continue
                seen_tables.add(table)
                owner = TABLE_TO_MODULE.get(table)
                rel = relative_path(path, root)
                line = start_line + body.count("\n", 0, match.start())
                if owner is None:
                    scope["unowned_tables"] += 1
                    findings.append(make_finding("unowned-table", rel, table, line, "note"))
                    continue
                if owner == owner_module:
                    continue
                scope["cross_vertical_refs"] += 1
                findings.append(make_finding("cross-vertical-sql", rel, f"{table} (owned by {owner})", line, "verdict"))
    return findings


def handler_findings(root: Path, classifications: set[str], scope: dict[str, int]) -> list[dict[str, Any]]:
    """New EventHandler implementations with no classification (Rule 2)."""
    findings: list[dict[str, Any]] = []
    for top in HANDLER_ROOTS:
        base = root / top
        if not base.is_dir():
            continue
        scope["handler_roots"] += 1
        for path in production_sources(base):
            try:
                raw = path.read_text(encoding="utf-8")
            except OSError as exc:
                raise ValueError(f"cannot read handler source: {path}: {exc}") from exc
            code = mask_comments_and_strings(raw)
            for match in EVENT_HANDLER_RE.finditer(code):
                type_name = match.group(1)
                scope["handler_impls"] += 1
                if type_name in classifications:
                    continue
                line = code.count("\n", 0, match.start()) + 1
                findings.append(make_finding("unclassified-handler", relative_path(path, root), type_name, line, "verdict"))
    return findings


def dependency_findings(root: Path, scope: dict[str, int]) -> list[dict[str, Any]]:
    """Cross-vertical edges whose owning module is not declared (Rule 3)."""
    findings: list[dict[str, Any]] = []
    modules_root = root / MODULE_SOURCE_ROOT
    if not modules_root.is_dir():
        return findings
    for manifest in sorted(modules_root.glob("*/manifest.json")):
        module = manifest.parent.name
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue  # manifest validity is another gate's subject
        dependencies = data.get("dependencies") if isinstance(data, dict) else None
        if not isinstance(dependencies, list):
            dependencies = []
        declared = {str(d) for d in dependencies}
        edges_module = 0
        for path in production_sources(manifest.parent):
            try:
                raw = path.read_text(encoding="utf-8")
            except OSError as exc:
                raise ValueError(f"cannot read module source: {path}: {exc}") from exc
            seen: set[tuple[str, str]] = set()
            for body, start_line in sql_literals(raw):
                if not is_sql_literal(body):
                    continue
                for match in SQL_TABLE_RE.finditer(body):
                    table = match.group(1).lower()
                    if table in SQL_CLAUSE_KEYWORDS:
                        continue
                    owner = TABLE_TO_MODULE.get(table)
                    if owner is None or owner == module:
                        continue
                    key = (relative_path(path, root), owner)
                    if key in seen or owner in declared:
                        continue
                    seen.add(key)
                    edges_module += 1
                    scope["undeclared_edges"] += 1
                    findings.append(make_finding("undeclared-dependency", key[0], f"{table} (owned by {owner}, not in dependencies)", start_line + body.count("\n", 0, match.start()), "note"))
        if edges_module:
            scope["modules_with_undeclared_edges"] += 1
    return findings


RULE_REMEDIATION = {
    "cross-vertical-sql": "Route the read through kasirmu_core::db::reports, declare the dependency, or add a reasoned baseline entry.",
    "unclassified-handler": "Add the handler type to scripts/handler-classification.json with one of the ADR-62 D4 categories.",
    "undeclared-dependency": "Declare the owning module in modules/<id>/manifest.json dependencies.",
    "unowned-table": "Add the table to TABLE_OWNERS in this checker if a module owns it.",
}


def make_finding(rule: str, path: str, target: str, line: int | None, severity: str) -> dict[str, Any]:
    return {
        "rule": rule,
        "severity": severity,
        "path": path,
        "line": line,
        "target": target,
        "remediation": RULE_REMEDIATION[rule],
        "baseline_status": "new",
    }


def finding_key(finding: dict[str, Any]) -> tuple[str, str, str]:
    return finding["rule"], finding["path"], finding["target"]


def dedupe_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[tuple[str, str, str], dict[str, Any]] = {}
    for finding in findings:
        key = finding_key(finding)
        if key not in unique:
            unique[key] = finding
    return sorted(unique.values(), key=lambda f: (f["rule"], f["path"], f["target"]))


def load_baseline(path: Path, root: Path) -> list[dict[str, Any]]:
    """Load and validate the frozen cross-vertical edges.

    Shape mirrors architecture-boundaries-baseline.json so the two gates are
    read and spelled the same way: an entries list, each entry keyed by
    (rule, path, target) and carrying its own reason. Unlike that baseline this
    one has NO expiry: the soft-governance posture is "frozen until Phase 4",
    and inventing a quarter-term deadline for debt that is explicitly tolerated
    would manufacture a renewal ceremony the plan does not ask for.
    """
    data = load_json(path, "namespace governance baseline")
    entries = data.get("entries") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        raise ValueError("namespace governance baseline must contain an 'entries' list")
    seen: set[tuple[str, str, str]] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("baseline entries must be objects")
        for field in ("rule", "path", "target", "reason"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise ValueError(f"baseline entry missing non-empty '{field}'")
        if entry["rule"] != "cross-vertical-sql":
            # Only Rule 1 findings are baselined. A new unclassified handler or a
            # stale entry is not forgiven by a baseline entry -- those fail
            # directly, so an entry claiming otherwise is malformed input.
            raise ValueError(
                f"baseline entry has non-baselineable rule '{entry['rule']}': "
                "only 'cross-vertical-sql' findings may be frozen"
            )
        key = (entry["rule"], entry["path"], entry["target"])
        if key in seen:
            raise ValueError(f"duplicate baseline entry: {key}")
        seen.add(key)
    return entries


def apply_baseline(findings: list[dict[str, Any]], baseline: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    baseline_by_key = {(e["rule"], e["path"], e["target"]): e for e in baseline}
    matched: set[tuple[str, str, str]] = set()
    tracked: list[dict[str, Any]] = []
    blocking: list[dict[str, Any]] = []
    for finding in findings:
        if finding["severity"] == "note":
            # Informational findings (Rule 3, unowned tables) are always shown
            # and never blocking; they are not baselineable either.
            continue
        key = finding_key(finding)
        entry = baseline_by_key.get(key)
        if entry is None:
            blocking.append(finding)
        else:
            matched.add(key)
            finding["baseline_status"] = "tracked"
            finding["baseline_entry"] = entry
            tracked.append(finding)
    stale: list[dict[str, Any]] = []
    for entry in baseline:
        key = (entry["rule"], entry["path"], entry["target"])
        if key not in matched:
            stale.append({
                "rule": entry["rule"],
                "severity": "note",
                "path": entry["path"],
                "line": None,
                "target": entry["target"],
                "baseline_status": "stale",
                "remediation": "Remove the baseline entry after confirming the access is gone.",
                "baseline_entry": entry,
            })
    return tracked, blocking, stale


def population_clause(scope: dict[str, int], classification_count: int) -> str:
    return (
        f" [population examined: {scope['module_files']} module source file(s) scanned, "
        f"{scope['cross_vertical_refs']} cross-vertical reference(s), "
        f"{scope['handler_impls']} EventHandler impl(s) across {scope['handler_roots']}/3 root(s), "
        f"{scope['undeclared_edges']} undeclared edge(s) in {scope['modules_with_undeclared_edges']} module(s), "
        f"{scope['unowned_tables']} unowned table reference(s), "
        f"{len(scope['_baseline'])} baseline entry(ies), "
        f"{classification_count} classified handler type(s)]"
    )


def report_human(tracked, blocking, stale, notes, scope, classification_count, report_only) -> None:
    line = (
        f"verify-namespace-governance: {len(tracked)} frozen cross-vertical edge(s), "
        f"{len(blocking)} new blocking finding(s), "
        f"{len(stale)} stale baseline entry(ies), "
        f"{len(notes)} informational finding(s)"
        + population_clause(scope, classification_count)
        + "."
    )
    if report_only:
        line += " NOT JUDGING: --report-only suppresses the verdict; this run's exit 0 is not a pass."
    print(line)
    if tracked:
        print("\nFrozen cross-vertical edges (Rule 1 baseline):")
        for finding in tracked:
            print(f"  [tracked] {finding['path']}:{finding['line']} -> {finding['target']}")
    if blocking:
        print("\nNew blocking findings:")
        for finding in blocking:
            print(f"  [new] {finding['rule']} {finding['path']}:{finding['line']} -> {finding['target']}")
            print(f"        {finding['remediation']}")
    if stale:
        print("\nStale baseline entries:")
        for finding in stale:
            print(f"  [stale] {finding['path']} -> {finding['target']}")
    if notes:
        print("\nInformational findings (Rule 3 / unmodelled tables; never blocking):")
        for finding in notes:
            print(f"  [note] {finding['rule']} {finding['path']}:{finding['line']} -> {finding['target']}")


def new_scope() -> dict[str, Any]:
    return {
        "module_files": 0,
        "cross_vertical_refs": 0,
        "handler_roots": 0,
        "handler_impls": 0,
        "undeclared_edges": 0,
        "modules_with_undeclared_edges": 0,
        "unowned_tables": 0,
        "_baseline": [],
    }


def load_classifications(path: Path) -> set[str]:
    data = load_json(path, "handler classification registry")
    handlers = data.get("handlers") if isinstance(data, dict) else None
    if not isinstance(handlers, list):
        raise ValueError("handler classification registry must contain a 'handlers' list")
    names: set[str] = set()
    for entry in handlers:
        if not isinstance(entry, dict):
            raise ValueError("handler classification entries must be objects")
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("handler classification entry missing non-empty 'name'")
        names.add(name)
    return names


def scan(root: Path, baseline_path: Path, classification_path: Path):
    baseline = load_baseline(baseline_path, root)
    classifications = load_classifications(classification_path)
    scope = new_scope()
    scope["_baseline"] = baseline
    findings = dedupe_findings(
        module_sql_findings(root, scope)
        + handler_findings(root, classifications, scope)
        + dependency_findings(root, scope)
    )
    if scope["module_files"] == 0:
        raise ValueError(
            f"no production module source found under {root / MODULE_SOURCE_ROOT}: "
            "nothing was graded. Run against the repository root."
        )
    tracked, blocking, stale = apply_baseline(findings, baseline)
    notes = [f for f in findings if f["severity"] == "note"]
    return tracked, blocking, stale, notes, scope, len(classifications)


def main() -> int:
    configure_streams()
    parser = argparse.ArgumentParser(description="Verify soft namespace-governance rules.")
    parser.add_argument("--report-only", action="store_true", help="Report findings but never fail. The printed line says NOT JUDGING.")
    parser.add_argument("--json", action="store_true", help="Emit stable JSON instead of human-readable output.")
    parser.add_argument("--root", type=Path, help="Repository root (defaults to the script's repository root).")
    parser.add_argument("--baseline-file", type=Path, help="Baseline JSON path (defaults to <root>/scripts/namespace-governance-baseline.json).")
    parser.add_argument("--classification-file", type=Path, help="Classification registry path (defaults to <root>/scripts/handler-classification.json).")
    parser.add_argument("--self-test", action="store_true", help="Run the built-in classifier tests and exit.")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    root = (args.root or Path(__file__).resolve().parent.parent).resolve()
    baseline_path = (args.baseline_file or root / "scripts" / "namespace-governance-baseline.json").resolve()
    classification_path = (args.classification_file or root / "scripts" / "handler-classification.json").resolve()
    try:
        tracked, blocking, stale, notes, scope, classification_count = scan(root, baseline_path, classification_path)
    except (ValueError, OSError) as exc:
        return fail(str(exc))
    if args.json:
        print(json.dumps({
            "frozen": tracked,
            "new_blocking": blocking,
            "stale_baseline": stale,
            "informational": notes,
            "summary": {"frozen": len(tracked), "blocking": len(blocking), "stale": len(stale), "informational": len(notes)},
            "population": {k: v for k, v in scope.items() if not k.startswith("_")},
            "judging": not args.report_only,
        }, indent=2, sort_keys=True))
    else:
        report_human(tracked, blocking, stale, notes, scope, classification_count, args.report_only)
    if args.report_only:
        return 0
    return 1 if blocking or stale else 0


def self_test() -> int:
    """Mutation-test the pure classifiers this gate depends on."""
    failures: list[str] = []

    def check(name: str, got: Any, want: Any) -> None:
        if got != want:
            failures.append(f"{name}: got {got!r}, want {want!r}")

    check("mask keeps code",
          mask_comments_and_strings("SELECT * FROM sales").strip(),
          "SELECT * FROM sales")
    check("mask blanks a line comment",
          mask_comments_and_strings("-- FROM customers\nX").splitlines()[1],
          "X")
    check("mask blanks a string literal",
          SQL_TABLE_RE.findall(mask_comments_and_strings('let q = "FROM customers";')),
          [])
    check("sql_literals reads a table out of a string literal",
          SQL_TABLE_RE.findall(" ".join(b for b, _ in sql_literals('let q = "SELECT 1 FROM sales";'))),
          ["sales"])
    check("sql_literals reports the literal's start line",
          sql_literals('let a = 1;\nlet q = "FROM sales";')[0][1], 2)
    check("sql_literals ignores a line comment naming a table",
          sql_literals("// FROM customers\nlet q = 1;"), [])
    check("sql_literals ignores a doc-comment block naming a table",
          sql_literals("/* FROM customers */ let q = 1;"), [])
    check("sql_literals keeps a single quote inside SQL as literal text",
          SQL_TABLE_RE.findall(sql_literals("prepare(\"FROM sales WHERE status = 'completed'\")")[0][0]),
          ["sales"])
    check("sql_literals reads a raw string",
          SQL_TABLE_RE.findall(sql_literals('let q = r#"FROM gift_cards"#;')[0][0]),
          ["gift_cards"])
    check("sql_literals reads a double-hash raw string",
          SQL_TABLE_RE.findall(sql_literals('let q = r##"FROM sales"##;')[0][0]),
          ["sales"])
    check("sql_literals does not open on a char literal",
          [b for b, _ in sql_literals("let c = 'x'; let s = \"ok\";")], ["ok"])
    check("sql_literals does not merge literals across a char quote",
          [b for b, _ in sql_literals("let a = s.trim_matches('\"'); let q = \"FROM sales\";")],
          ["FROM sales"])
    check("sql_literals skips a lifetime",
          [b for b, _ in sql_literals("fn f<'a>(x: &'a str) { let q = \"FROM sales\"; }")],
          ["FROM sales"])
    check("is_sql_literal accepts a SELECT",
          is_sql_literal("SELECT 1 FROM sales"), True)
    check("is_sql_literal accepts an UPDATE",
          is_sql_literal("UPDATE sales SET x = 1"), True)
    check("is_sql_literal rejects prose that mentions a table",
          is_sql_literal("failed to construct sale from cart"), False)
    check("SQL clause keywords stay capturable but are filtered by the readers",
          [t.lower() for t in SQL_TABLE_RE.findall("ON CONFLICT(key) DO UPDATE SET value = ?2")],
          ["set"])
    check("SQL_TABLE_RE names FROM/JOIN/UPDATE/DELETE targets",
          SQL_TABLE_RE.findall("SELECT a FROM sales JOIN customers ON 1 UPDATE products SET x DELETE FROM gift_cards"),
          ["sales", "customers", "products", "gift_cards"])
    check("EVENT_HANDLER_RE names the implementing type",
          EVENT_HANDLER_RE.findall("impl EventHandler<SaleCompleted> for SaleSyncEnqueuer {"),
          ["SaleSyncEnqueuer"])
    check("ownership lookup resolves an owned table",
          TABLE_TO_MODULE.get("gift_cards"), "giftcards")
    check("ownership lookup returns None for an unmodelled table",
          TABLE_TO_MODULE.get("migrations"), None)
    check("test file suffix is skipped",
          is_production_source(Path("modules/x/src/handlers_tests.rs")), False)
    check("a file named tests.rs is skipped",
          is_production_source(Path("platform/kernel/src/kernel/tests.rs")), False)
    check("mask does not let a lifetime swallow the file",
          "impl EventHandler<SaleCompleted> for X" in
          mask_comments_and_strings("fn f<'a>(x: &'a str) -> &'a str { x }\nimpl EventHandler<SaleCompleted> for X {}"),
          True)
    check("mask blanks a char literal",
          mask_comments_and_strings("let c = 'x'; OK").strip(), "let c =    ; OK")
    check("EVENT_HANDLER_RE rejects a qualified path target",
          EVENT_HANDLER_RE.findall("impl EventHandler<TestBusEvent> for std::sync::Arc<BusHandler> {"),
          [])
    check("EVENT_HANDLER_RE accepts a bare target",
          EVENT_HANDLER_RE.findall("impl EventHandler<SaleCompleted> for SaleSyncEnqueuer {"),
          ["SaleSyncEnqueuer"])
    check("tests directory is skipped",
          is_production_source(Path("modules/x/tests/boundary_contract.rs")), False)
    check("a repository source is production",
          is_production_source(Path("modules/x/src/repository.rs")), True)
    check("module_id_for reads the first component under modules/",
          module_id_for(Path("/r/modules/loyalty/src/repository.rs"), Path("/r")), "loyalty")

    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        bad = Path(tmp) / "bad.json"
        bad.write_text(json.dumps({"entries": [
            {"rule": "unclassified-handler", "path": "p", "target": "t", "reason": "r"}
        ]}), encoding="utf-8")
        try:
            load_baseline(bad, Path(tmp))
            failures.append("load_baseline accepted a non-baselineable rule")
        except ValueError:
            pass
        good = Path(tmp) / "good.json"
        good.write_text(json.dumps({"entries": [
            {"rule": "cross-vertical-sql", "path": "p", "target": "t", "reason": "r"}
        ]}), encoding="utf-8")
        check("load_baseline accepts a well-formed entry",
              len(load_baseline(good, Path(tmp))), 1)

    if failures:
        print("verify-namespace-governance: self-test FAILED", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
        return 1
    print("verify-namespace-governance: self-test ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
