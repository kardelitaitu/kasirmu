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
          (``docs/records/superseded/handler-census-phase0.md``) classified them, and
          re-grading them here would duplicate that work.

  Rule 3  Reported, never failed. For every cross-vertical table a module names,
          the module's ``modules/<id>/manifest.json`` must declare the owning
          module in its ``dependencies`` array. Edges that lack the declaration
          are printed as informational findings. This is a review rule today by
          design (governance doc §2, Rule 3): two such edges exist, and making
          this a hard failure is a Phase 4 change gated on closing them.

  --census / --emit-census
          Re-derive the Phase 0 handler census from the repository instead of
          trusting the registry's ``site`` pointers. Rule 2 checks the OTHER
          direction only: it finds a new impl and asks the registry to name it.
          Nothing checks that a registry row still points at a real impl, so a
          handler renamed, moved, or deleted leaves a stale ``site`` with no
          signal. ``--census`` joins the two sets and reports:
            * ``stale-handler-row`` -- the row's ``site`` file is missing, its
              line is past end-of-file, or that line is not
              ``impl EventHandler<...> for <the row's type>`` (renamed/moved);
            * ``retired-handler-row`` -- the row's type is found in NO
              production file at all (deleted, or the pointer is the only trace);
            * ``unclassified-handler`` -- Rule 2's finding, folded into the same
              report so the census is one view of the handler population.
          ``--emit-census`` prints the population as a Markdown table (Handler,
          Category, Subscribed topic(s), Site, Note, Status) so the census doc's
          table can be regenerated rather than hand-edited; its Site/Status
          columns are the tree-resolution verdict the hand table lacked, which
          replaces that table's Registrant/Class/Live columns. Neither mode
          changes the verdict: they are report-only, always exit 0, and the
          default run is unchanged.

  --emit-registry / --check
          The classification REGISTRY is generated from the Rust. Each handler
          type declares its category with an overridden
          `fn handler_type(&self) -> HandlerType` (the EventHandler trait provides a
          default of `InternalHelper`); `--emit-registry` rewrites
          `scripts/handler-classification.json` with a `category` taken from the Rust
          while keeping each row's census narrative (topic/site/note) and order,
          and `--check` fails, naming the type and both categories, when the
          committed file has drifted. The registry stops being hand-maintained;
          the JSON stays a reviewable artifact.

USAGE
=====

    python3 scripts/verify-namespace-governance.py
    python3 scripts/verify-namespace-governance.py --report-only
    python3 scripts/verify-namespace-governance.py --json
    python3 scripts/verify-namespace-governance.py --root <path>
    python3 scripts/verify-namespace-governance.py --baseline-file <path>
    python3 scripts/verify-namespace-governance.py --classification-file <path>
    python3 scripts/verify-namespace-governance.py --self-test
    python3 scripts/verify-namespace-governance.py --census
    python3 scripts/verify-namespace-governance.py --emit-census
    python3 scripts/verify-namespace-governance.py --emit-registry
    python3 scripts/verify-namespace-governance.py --check

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
    "sales": ("sales", "sale_lines", "payments"),
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

# -- Single source of truth (plan §7) --------------------------------------
# The ownership map lives in modules/ownership.json and is generated into the
# Rust const (crates/kasirmu-core/src/db/ownership.rs) by
# scripts/generate-ownership-map.mjs. TABLE_OWNERS above must equal it: run
# --check-ownership to fail on drift, or --emit-ownership to rewrite this file.
OWNERSHIP_JSON = "modules/ownership.json"


def load_ownership(root: Path) -> dict[str, tuple[str, ...]]:
    """Read modules/ownership.json into the TABLE_OWNERS shape."""
    path = root / OWNERSHIP_JSON
    data = json.loads(path.read_text(encoding="utf-8"))
    owners = data.get("owners")
    if not isinstance(owners, dict) or not owners:
        raise ValueError(f"{OWNERSHIP_JSON}: 'owners' must be a non-empty object")
    out: dict[str, tuple[str, ...]] = {}
    seen: dict[str, str] = {}
    for module, tables in owners.items():
        if not isinstance(tables, list):
            raise ValueError(f"{OWNERSHIP_JSON}: '{module}' must map to an array")
        for table in tables:
            if table in seen:
                raise ValueError(
                    f"{OWNERSHIP_JSON}: table '{table}' claimed by both "
                    f"'{seen[table]}' and '{module}'"
                )
            seen[table] = module
        out[module] = tuple(tables)
    return out


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


# A registry ``site`` is "<repo-relative path>:<line>". The line is allowed to
# drift by a few lines in a renamed/moved file without being called stale, but
# the CENSUS is about whether the pointer resolves at all, so the comparison is
# exact: a row is stale when its named line is not the impl it claims.
SITE_RE = re.compile(r"^(?P<path>[^:]+):(?P<line>\d+)$")

# The in-code grant marker (T3): a comment naming the table a cross-vertical
# read is allowed to touch and the reason it exists.
#   // namespace: cross-vertical read gift_cards granted (T3: loyalty C9 lookup)
GRANT_MARKER_RE = re.compile(
    r"//\s*namespace:\s*cross-vertical\s+read\s+(?P<table>[A-Za-z_][A-Za-z0-9_]*)\s+"
    r"granted\s*\(\s*(?P<reason>[^)]*?)\s*\)"
)

# How far above a SQL literal to look for its grant marker. The marker sits on
# or immediately above the statement, so a few lines suffice; a wider window
# would let a marker for one query silently excuse its neighbour.
GRANT_MARKER_WINDOW = 4

# The Rust spelling of a handler's declared seam type, inside the handler_type
# method the EventHandler trait provides (T2). Captures the variant name; the
# snake_case registry category is looked up in RUST_HANDLER_TYPE_TO_CATEGORY.
HANDLER_TYPE_RE = re.compile(
    r"fn\s+handler_type\s*\(\s*&self\s*\)\s*->\s*HandlerType\s*\{\s*"
    r"HandlerType::([A-Za-z_][A-Za-z0-9_]*)\s*\}"
)

# Rust variant -> registry category string. This mirrors foundation::HandlerType
# and the ADR-62 D4 vocabulary the JSON registry already uses; a mismatch is a
# generator failure, not a silent rename.
RUST_HANDLER_TYPE_TO_CATEGORY = {
    "CommandContributor": "command_contributor",
    "ProjectionSubscriber": "projection_subscriber",
    "QueryFacade": "query_facade",
    "Lifecycle": "lifecycle",
    "PluginBridge": "plugin_bridge",
    "InternalHelper": "internal_helper",
}

# The registry's stable prose. The handlers array is generated from the Rust
# handler_type methods; these two fields are the file's contract and are kept
# here so the emitted JSON is byte-stable.
REGISTRY_SCHEMA_VERSION = 1
REGISTRY_DESCRIPTION = (
    "Handler classification registry for the soft namespace-governance rule "
    "(docs/architecture/module-namespace-governance.md, Rule 2). Every EventHandler "
    "impl a production file declares must appear here with one of the ADR-62 D4 "
    "categories. The populating classification is the Phase 0 census "
    "(docs/records/superseded/handler-census-phase0.md §3); scripts/verify-namespace-governance.py "
    "fails when a NEW impl type is absent, and deliberately does not re-grade existing rows. "
    "The handlers array is GENERATED from each type's EventHandler::handler_type method "
    "(Phase 1 ticket T2): regenerate with --emit-registry, verify with --check."
)
REGISTRY_CATEGORIES = {
    "command_contributor": "Runs synchronously in the sale transaction and may reject it (ADR-62 D1/D2).",
    "projection_subscriber": "Runs after commit, derives a projection, may not reject the sale (ADR-62 D1/D3).",
    "query_facade": "Serves reads through a sanctioned facade (ADR-62 D4/D5).",
    "lifecycle": "Module load/start/stop hook; not a seam (ADR-62 D6).",
    "plugin_bridge": "Bridges an event to an external surface, e.g. the LAN fan-out (ADR-62 D6).",
    "internal_helper": "Support code with no seam contract (ADR-62 D6).",
}


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
                # An escape pair. If the escaped character is a newline (a Rust
                # string line-continuation, "abc\<newline>def"), emit a real
                # newline for it: dropping it would shift every later line number
                # by one, and the Rule 1 scanner reports line numbers. Two spaces
                # elsewhere keeps offsets intact.
                out.append("\n" if text[i + 1] == "\n" else " ")
                out.append(" ")
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
        elif char == "r" and nxt in ('"', "#"):
            # A raw string: r"..." or r#"..."# (or r##"..."##). The masker
            # must consume it whole: without this branch the quotes INSIDE a
            # raw literal (r#"{"type":"kds."#) are read as ordinary string
            # delimiters, which closes and reopens the string an even or odd
            # number of times and can leave a later real impl blanked -- the
            # kds_sync.rs false-stale that motivated this branch.
            hashes = 0
            j = i + 1
            while j < len(text) and text[j] == "#":
                hashes += 1
                j += 1
            if j < len(text) and text[j] == '"':
                terminator = '"' + "#" * hashes
                out.append(" ")
                k = j + 1
                while k < len(text) and not text.startswith(terminator, k):
                    out.append("\n" if text[k] == "\n" else " ")
                    k += 1
                if k < len(text):
                    out.extend(" " * len(terminator))
                    k += len(terminator)
                i = k
                continue
            out.append(char)
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

# A literal that is a single clause of a larger statement: the repo splits long
# queries across string continuations, so the tail ('FROM sales WHERE ...') is
# still query text. Anchored at the start and requiring a table-like token, so
# prose ('from the cart') cannot match.
SQL_FRAGMENT_RE = re.compile(
    r"^\s*(?:FROM|JOIN|UPDATE|DELETE\s+FROM)\s+[A-Za-z_][A-Za-z0-9_]*", re.IGNORECASE
)


def is_sql_literal(body: str) -> bool:
    """True when a literal body is SQL text rather than prose.

    A table-like token can sit inside a HUMAN string ('failed to construct
    sale from cart') and a keyword-anchored regex cannot tell the two apart.
    SQL statements in this repo always open with a verb. A FRAGMENT (the
    multi-line continuations this repo builds in place, e.g. 'FROM sales
    WHERE status = ?1') opens with a clause keyword instead, which is no
    longer prose: a log or error line does not start with FROM/JOIN/WHERE.
    Both spellings are query text; everything else is prose.
    """
    return bool(SQL_VERB_RE.match(body)) or bool(SQL_FRAGMENT_RE.match(body))


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


def grant_markers(raw: str) -> list[tuple[str, int, str]]:
    """Every grant marker in a source file: (table, 1-based line, reason)."""
    markers: list[tuple[str, int, str]] = []
    for line_number, text in enumerate(raw.split("\n"), start=1):
        for match in GRANT_MARKER_RE.finditer(text):
            markers.append((match.group("table").lower(), line_number, match.group("reason")))
    return markers


def grant_for(table: str, literal_start: int, markers: list[tuple[str, int, str]]) -> tuple[str, int] | None:
    """The marker granting a table on or shortly above its statement, if any.

    Returns (reason, marker_line). The window is deliberately small and anchored
    above the statement: a marker further away, or one naming a different table,
    does not excuse this reference.
    """
    for marker_table, marker_line, reason in markers:
        if marker_table != table:
            continue
        if 0 <= literal_start - marker_line <= GRANT_MARKER_WINDOW or marker_line == literal_start:
            return reason, marker_line
    return None


def module_sql_findings(root: Path, scope: dict[str, int]) -> list[dict[str, Any]]:
    """Every cross-vertical table a module names in raw SQL (Rule 1 subject).

    A cross-vertical reference is PERMITTED when it carries a grant marker for
    exactly its target table (T3): the finding is still emitted, but flagged
    granted so the baseline layer lets it through and the report shows the
    reason. A marker on a reference to the module own table is a stale grant
    (stale-grant) -- the exception outlived the coupling, and leaving it
    would let a future unrelated read hide behind it.
    """
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
            raise ValueError("cannot read module source: " + str(path) + ": " + str(exc)) from exc
        markers = grant_markers(raw)
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
                grant = grant_for(table, start_line, markers)
                if owner is None:
                    scope["unowned_tables"] += 1
                    findings.append(make_finding("unowned-table", rel, table, line, "note"))
                    continue
                if owner == owner_module:
                    if grant is not None:
                        # A marker that outlived the coupling it excused.
                        scope["stale_grants"] += 1
                        finding = make_finding(
                            "stale-grant", rel, table + " (owned by this module)",
                            grant[1], "verdict",
                        )
                        finding["grant_reason"] = grant[0]
                        findings.append(finding)
                    continue
                scope["cross_vertical_refs"] += 1
                finding = make_finding(
                    "cross-vertical-sql", rel, table + " (owned by " + owner + ")", line, "verdict"
                )
                if grant is not None:
                    finding["granted"] = True
                    finding["grant_reason"] = grant[0]
                findings.append(finding)
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


def declared_handler_types(root: Path) -> dict[str, tuple[str, str, int, str]]:
    """type name -> (category, repo-relative path, line, raw variant) from the Rust.

    Walks the SAME production population as the census, and for each
    `impl EventHandler<...> for T` looks inside the block for the overridden
    `handler_type` method (T2). A type that declares no override is reported as
    the trait default, `internal_helper` -- but a *registered* type is expected
    to override, and the registry check turns a missing override into drift.

    The first impl block that carries the override wins; a later impl of the
    same type with a DIFFERENT category is a contradiction and raises.
    """
    declared: dict[str, tuple[str, str, int, str]] = {}
    for top in HANDLER_ROOTS:
        base = root / top
        if not base.is_dir():
            continue
        for path in production_sources(base):
            try:
                raw = path.read_text(encoding="utf-8")
            except OSError as exc:
                raise ValueError(f"cannot read handler source: {path}: {exc}") from exc
            code = mask_comments_and_strings(raw)
            rel = relative_path(path, root)
            for match in EVENT_HANDLER_RE.finditer(code):
                type_name = match.group(1)
                # The impl block runs from the match to the matching close brace;
                # scan that slice for the handler_type override.
                depth = 0
                i = match.end()
                started = False
                while i < len(code):
                    ch = code[i]
                    if ch == "{":
                        depth += 1
                        started = True
                    elif ch == "}":
                        depth -= 1
                        if started and depth == 0:
                            break
                    i += 1
                block = code[match.start():i + 1]
                override = HANDLER_TYPE_RE.search(block)
                if override is None:
                    continue
                variant = override.group(1)
                category = RUST_HANDLER_TYPE_TO_CATEGORY.get(variant)
                if category is None:
                    raise ValueError(
                        f"handler {type_name} declares unknown HandlerType::{variant}"
                    )
                line = code.count("\n", 0, match.start()) + 1
                prior = declared.get(type_name)
                if prior is not None and prior[0] != category:
                    raise ValueError(
                        f"handler {type_name} declares conflicting categories "
                        f"{prior[0]} ({prior[1]}:{prior[2]}) and {category} ({rel}:{line})"
                    )
                declared.setdefault(type_name, (category, rel, line, variant))
    return declared


def build_registry(root: Path, committed: list[dict[str, Any]], committed_meta: dict[str, Any] | None = None) -> dict[str, Any]:
    """Assemble the full registry dict: Rust categories, committed metadata.

    `category` comes from the Rust `handler_type` method; `topic`, `site`,
    `note` and the row ORDER are census narrative the Rust does not carry, so
    they are kept from the committed registry, matched by name. A registered type
    the Rust no longer declares is a failure (the registry must shrink with the
    code); a declared type with no committed row cannot be generated (run the
    census to classify a new handler first).

    `schema_version`, `description` and `categories` are also taken from the
    committed file when present, so a category flip regenerates EXACTLY the one
    field that changed -- the `--check` byte comparison stays honest about what
    is generated and what is prose.
    """
    declared = declared_handler_types(root)
    by_name = {str(e["name"]): e for e in committed}
    missing_in_rust = [name for name in by_name if name not in declared]
    if missing_in_rust:
        raise ValueError(
            "registry rows with no Rust handler_type: " + ", ".join(sorted(missing_in_rust))
        )
    handlers: list[dict[str, Any]] = []
    for entry in committed:
        name = str(entry["name"])
        if name not in declared:
            continue
        category, _rel, _line, _variant = declared[name]
        handlers.append({
            "name": name,
            "category": category,
            "topic": str(entry.get("topic", "")),
            "site": str(entry.get("site", "")),
            "note": str(entry.get("note", "")),
        })
    meta = committed_meta or {}
    return {
        "schema_version": meta.get("schema_version", REGISTRY_SCHEMA_VERSION),
        "description": meta.get("description", REGISTRY_DESCRIPTION),
        "categories": meta.get("categories", REGISTRY_CATEGORIES),
        "handlers": handlers,
    }


def render_registry(registry: dict[str, Any]) -> str:
    """The exact on-disk JSON text, so `--check` can compare bytes."""
    return json.dumps(registry, indent=2, ensure_ascii=False) + "\n"


def emit_registry(root: Path, registry_path: Path) -> int:
    """Write the generated registry to disk (`--emit-registry`)."""
    try:
        committed = load_classification_entries(registry_path)
        meta = load_json(registry_path, "handler classification registry")
    except (ValueError, OSError) as exc:
        return fail(str(exc))
    try:
        registry = build_registry(root, committed, meta if isinstance(meta, dict) else None)
    except ValueError as exc:
        return fail(str(exc))
    registry_path.write_text(render_registry(registry), encoding="utf-8", newline="\n")
    print(f"verify-namespace-governance --emit-registry: wrote {len(registry['handlers'])} row(s) to {relative_path(registry_path, root)}")
    return 0


def check_registry(root: Path, registry_path: Path) -> int:
    """Fail when the committed registry drifts from the Rust (`--check`).

    Names the drifted type and the two categories so the fix is a one-line edit
    (regenerate) -- a gate that says only "differs" sends the reader hunting.
    """
    try:
        committed = load_classification_entries(registry_path)
        meta = load_json(registry_path, "handler classification registry")
    except (ValueError, OSError) as exc:
        return fail(str(exc))
    try:
        registry = build_registry(root, committed, meta if isinstance(meta, dict) else None)
    except ValueError as exc:
        return fail(str(exc))
    want = render_registry(registry)
    try:
        got = registry_path.read_text(encoding="utf-8")
    except OSError as exc:
        return fail(f"cannot read registry: {exc}")
    if got == want:
        print(f"verify-namespace-governance --check: registry matches the Rust handler_type declarations ({len(registry['handlers'])} row(s)).")
        return 0
    committed_by_name = {str(e["name"]): str(e.get("category", "")) for e in committed}
    want_by_name = {str(e["name"]): str(e["category"]) for e in registry["handlers"]}
    printed = 0
    for name in sorted(set(committed_by_name) | set(want_by_name)):
        old = committed_by_name.get(name, "<absent>")
        new = want_by_name.get(name, "<absent>")
        if old != new:
            print(f"  [drift] {name}: registry says '{old}', Rust handler_type says '{new}'", file=sys.stderr)
            printed += 1
    if printed == 0:
        print("  (every category matches; the file differs only in whitespace, prose or row order)", file=sys.stderr)
    print("verify-namespace-governance --check: registry DRIFTED from the Rust handler_type declarations.", file=sys.stderr)
    return 1


def load_classification_entries(path: Path) -> list[dict[str, Any]]:
    """The registry rows, validated: name, site, category, topic, note.

    ``load_classifications`` keeps only the names Rule 2 needs. The census needs
    the whole row -- above all ``site`` -- so this validates and returns the
    entries themselves. A row missing a non-empty ``site`` is malformed input:
    without it the census cannot tell a live pointer from a dead one.
    """
    data = load_json(path, "handler classification registry")
    handlers = data.get("handlers") if isinstance(data, dict) else None
    if not isinstance(handlers, list):
        raise ValueError("handler classification registry must contain a 'handlers' list")
    entries: list[dict[str, Any]] = []
    for entry in handlers:
        if not isinstance(entry, dict):
            raise ValueError("handler classification entries must be objects")
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("handler classification entry missing non-empty 'name'")
        site = entry.get("site")
        if not isinstance(site, str) or not site.strip():
            raise ValueError(f"handler classification entry '{name}' missing non-empty 'site'")
        entries.append(entry)
    return entries


def production_handler_impls(root: Path) -> dict[str, list[tuple[str, int]]]:
    """type name -> [(repo-relative path, 1-based line)] for every production impl.

    The same population and the same scanner as ``handler_findings``, but keyed
    by type so the census can ask "does this registry row still resolve?" in the
    other direction. Uses the SAME ``mask_comments_and_strings`` +
    ``EVENT_HANDLER_RE`` pair Rule 2 uses, so the two directions can never
    disagree about what an impl is.
    """
    found: dict[str, list[tuple[str, int]]] = {}
    for top in HANDLER_ROOTS:
        base = root / top
        if not base.is_dir():
            continue
        for path in production_sources(base):
            try:
                raw = path.read_text(encoding="utf-8")
            except OSError as exc:
                raise ValueError(f"cannot read handler source: {path}: {exc}") from exc
            code = mask_comments_and_strings(raw)
            rel = relative_path(path, root)
            for match in EVENT_HANDLER_RE.finditer(code):
                line = code.count("\n", 0, match.start()) + 1
                found.setdefault(match.group(1), []).append((rel, line))
    return found


def census_rows(root: Path, entries: list[dict[str, Any]], scope: dict[str, int]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Join the registry rows against the impls actually present.

    Returns (stale, retired, unclassified):
      stale        -- a row whose ``site`` no longer names its own impl;
      retired      -- a row whose type is found in no production file;
      unclassified -- an impl with no registry row (Rule 2, same shape).
    """
    stale: list[dict[str, Any]] = []
    retired: list[dict[str, Any]] = []
    impls = production_handler_impls(root)
    registered_names = {str(e["name"]) for e in entries}
    for entry in entries:
        name = str(entry["name"])
        site = str(entry["site"])
        match = SITE_RE.match(site)
        if match is None:
            scope["stale_handler_rows"] += 1
            stale.append(make_finding(
                "stale-handler-row", site, f"{name} (site is not <path>:<line>)", None, "note"
            ))
            continue
        rel = match.group("path")
        want_line = int(match.group("line"))
        # A type found in no production file is retired regardless of the site:
        # the site cannot name an impl that does not exist anywhere.
        if not impls.get(name):
            scope["retired_handler_rows"] += 1
            retired.append(make_finding(
                "retired-handler-row", rel, f"{name} (type found in no production file)", want_line, "note"
            ))
            continue
        target_path = root / rel
        if not target_path.is_file():
            scope["stale_handler_rows"] += 1
            stale.append(make_finding(
                "stale-handler-row", rel, f"{name} (file not found)", want_line, "note"
            ))
            continue
        try:
            code = mask_comments_and_strings(target_path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise ValueError(f"cannot read handler source: {target_path}: {exc}") from exc
        if want_line < 1 or want_line > code.count("\n") + 1:
            scope["stale_handler_rows"] += 1
            stale.append(make_finding(
                "stale-handler-row", rel, f"{name} (line {want_line} past end of file)", want_line, "note"
            ))
            continue
        line_text = code.split("\n")[want_line - 1]
        on_site = [m.group(1) for m in EVENT_HANDLER_RE.finditer(line_text)]
        if name not in on_site:
            moved = impls[name][0]
            scope["stale_handler_rows"] += 1
            stale.append(make_finding(
                "stale-handler-row", rel,
                f"{name} (line {want_line} is not its impl) (now at {moved[0]}:{moved[1]})",
                want_line, "note"
            ))
    unclassified = [
        make_finding("unclassified-handler", rel, name, line, "note")
        for name, sites in sorted(impls.items())
        if name not in registered_names
        for rel, line in sites[:1]
    ]
    return stale, retired, unclassified

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
    "stale-grant": "Delete the grant marker: the reference now names a table this module owns, so the exception is no longer needed.",
    "stale-handler-row": "Update the registry row's 'site' to where the impl now lives, or remove the row if the handler was deleted.",
    "retired-handler-row": "Confirm the handler was deleted, then remove its registry row (or re-point it if it was renamed).",
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
            # Only Rule 1 findings are baselined. A new unclassified handler, a
            # stale grant or a stale registry row is not forgiven by a baseline
            # entry -- those fail directly, so an entry claiming otherwise is
            # malformed input.
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
    """Split findings into (tracked, blocking, stale) under the grant rule (T3).

    A cross-vertical reference is permitted when it carries a valid grant marker
    (T3): it is reported as tracked/granted whether or not a baseline entry
    exists. A baseline entry whose finding has NO grant marker no longer excuses
    it -- the whole point of T3 is that the exception must be visible at the call
    site, so the finding becomes blocking and says why.
    """
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
        granted = bool(finding.get("granted"))
        if finding["rule"] == "cross-vertical-sql" and granted:
            # Permitted by an in-code grant. A baseline entry, if present, is
            # marked matched so it is not reported stale -- the edge is still
            # frozen AND now carries its marker, which is what T3 requires.
            if entry is not None:
                matched.add(key)
                finding["baseline_entry"] = entry
            finding["baseline_status"] = "granted"
            tracked.append(finding)
            continue
        if entry is not None and finding["rule"] == "cross-vertical-sql" and not granted:
            # A frozen edge that still has no marker: fail, and say the marker is
            # what is missing rather than the access itself.
            matched.add(key)
            finding["baseline_status"] = "unmarked"
            finding["baseline_entry"] = entry
            finding["remediation"] = (
                "Add an in-code grant marker above the statement: "
                "// namespace: cross-vertical read <table> granted (<reason>). "
                "A baseline entry no longer excuses an unmarked cross-vertical read."
            )
            blocking.append(finding)
            continue
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
        "stale_handler_rows": 0,
        "retired_handler_rows": 0,
        "stale_grants": 0,
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


def promote_strict(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Phase 4 P4.5: strict makes an undeclared dependency a verdict, not a note.

    By default an undeclared cross-vertical dependency (Rule 3) is informational
    (Phase 1 softness). Strict promotes each such note to a `verdict` so it flows
    through apply_baseline and blocks unless it carries a reasoned baseline entry.
    """
    for finding in findings:
        if finding["rule"] == "undeclared-dependency" and finding["severity"] == "note":
            finding["severity"] = "verdict"
    return findings

def scan(root: Path, baseline_path: Path, classification_path: Path, strict: bool = False):
    baseline = load_baseline(baseline_path, root)
    classifications = load_classifications(classification_path)
    scope = new_scope()
    scope["_baseline"] = baseline
    findings = dedupe_findings(
        module_sql_findings(root, scope)
        + handler_findings(root, classifications, scope)
        + dependency_findings(root, scope)
    )
    if strict:
        findings = promote_strict(findings)
    if scope["module_files"] == 0:
        raise ValueError(
            f"no production module source found under {root / MODULE_SOURCE_ROOT}: "
            "nothing was graded. Run against the repository root."
        )
    tracked, blocking, stale = apply_baseline(findings, baseline)
    notes = [f for f in findings if f["severity"] == "note"]
    return tracked, blocking, stale, notes, scope, len(classifications)


def emit_census(root: Path, entries: list[dict[str, Any]]) -> int:
    """Print the handler census as a Markdown table.

    Columns follow the Phase 1 ticket shape (Handler, Category, Subscribed
    topic(s), Site, Note, Status). That is a superset of the hand-written
    ``docs/records/superseded/handler-census-phase0.md`` §3 columns: the registry Site
    is the impl pointer and Status adds the tree-resolution verdict the hand
    census could not compute. A difference in the Registrant/Live columns is
    therefore expected, since this mode does not carry them.
    """
    impls = production_handler_impls(root)
    print("| Handler (source) | Category | Subscribed topic(s) | Site | Note | Status |")
    print("|---|---|---|---|---|---|")
    for entry in entries:
        name = str(entry["name"])
        site = str(entry["site"])
        live = impls.get(name, [])
        match = SITE_RE.match(site)
        resolves = False
        if match is not None:
            target = root / match.group("path")
            want = int(match.group("line"))
            if target.is_file():
                code = mask_comments_and_strings(target.read_text(encoding="utf-8"))
                lines = code.split("\n")
                if 1 <= want <= len(lines):
                    resolves = name in [m.group(1) for m in EVENT_HANDLER_RE.finditer(lines[want - 1])]
        if not live:
            status = "RETIRED (type in no production file)"
        elif resolves:
            status = "resolves"
        else:
            status = f"STALE (now {live[0][0]}:{live[0][1]})"
        topic = str(entry.get("topic", "")) or "--"
        note = str(entry.get("note", ""))
        print(f"| `{name}` (`{site}`) | {entry.get('category', '')} | {topic} | `{site}` | {note} | {status} |")
    return 0

def main() -> int:
    configure_streams()
    parser = argparse.ArgumentParser(description="Verify soft namespace-governance rules.")
    parser.add_argument("--report-only", action="store_true", help="Report findings but never fail. The printed line says NOT JUDGING.")
    parser.add_argument("--strict", action="store_true", help="Phase 4 P4.5: an undeclared dependency blocks instead of being informational.")
    parser.add_argument("--json", action="store_true", help="Emit stable JSON instead of human-readable output.")
    parser.add_argument("--root", type=Path, help="Repository root (defaults to the script's repository root).")
    parser.add_argument("--baseline-file", type=Path, help="Baseline JSON path (defaults to <root>/scripts/namespace-governance-baseline.json).")
    parser.add_argument("--classification-file", type=Path, help="Classification registry path (defaults to <root>/scripts/handler-classification.json).")
    parser.add_argument("--self-test", action="store_true", help="Run the built-in classifier tests and exit.")
    parser.add_argument("--census", action="store_true", help="Report stale/retired registry rows and unclassified impls (report-only; never fails).")
    parser.add_argument("--emit-census", action="store_true", help="Print the handler census as a Markdown table (report-only; never fails).")
    parser.add_argument("--check-ownership", action="store_true", help="Fail when TABLE_OWNERS drifts from modules/ownership.json (the plan 7 single source).")
    parser.add_argument("--emit-ownership", action="store_true", help="Rewrite TABLE_OWNERS in this file from modules/ownership.json.")
    parser.add_argument("--check-capabilities", action="store_true", help="Fail when a module manifest capabilities set drifts from the ownership map + dependencies (Phase 4 P4.1).")
    parser.add_argument("--emit-capabilities", action="store_true", help="Rewrite every module manifest capabilities set from the ownership map + dependencies.")
    parser.add_argument("--emit-registry", action="store_true", help="Regenerate scripts/handler-classification.json from the Rust handler_type declarations.")
    parser.add_argument("--check", action="store_true", help="Fail when the committed registry drifts from the Rust handler_type declarations.")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    root = (args.root or Path(__file__).resolve().parent.parent).resolve()
    baseline_path = (args.baseline_file or root / "scripts" / "namespace-governance-baseline.json").resolve()
    classification_path = (args.classification_file or root / "scripts" / "handler-classification.json").resolve()
    if args.check_ownership:
        return check_ownership(root)
    if args.check_capabilities:
        return check_capabilities(root)
    if args.emit_capabilities:
        return emit_capabilities(root)
    if args.emit_ownership:
        return emit_ownership(root, Path(__file__).resolve())
    if args.emit_registry:
        return emit_registry(root, classification_path)
    if args.check:
        return check_registry(root, classification_path)
    if args.emit_census:
        try:
            entries = load_classification_entries(classification_path)
        except (ValueError, OSError) as exc:
            return fail(str(exc))
        return emit_census(root, entries)
    if args.census:
        try:
            entries = load_classification_entries(classification_path)
        except (ValueError, OSError) as exc:
            return fail(str(exc))
        scope = new_scope()
        if not (root / MODULE_SOURCE_ROOT).is_dir():
            return fail(f"no production module source found under {root / MODULE_SOURCE_ROOT}: nothing was graded.")
        stale, retired, unclassified = census_rows(root, entries, scope)
        print(
            f"verify-namespace-governance --census: {len(entries)} registry row(s), "
            f"{len(stale)} stale, {len(retired)} retired, {len(unclassified)} unclassified "
            f"[population: {len(production_handler_impls(root))} impl type(s) found; REPORT-ONLY, never fails]."
        )
        if stale:
            print("\nStale registry rows (site no longer names the impl):")
            for f in stale:
                print(f"  [stale] {f['path']}:{f['line']} -> {f['target']}")
        if retired:
            print("\nRetired registry rows (type in no production file):")
            for f in retired:
                print(f"  [retired] {f['path']}:{f['line']} -> {f['target']}")
        if unclassified:
            print("\nUnclassified impls (no registry row):")
            for f in unclassified:
                print(f"  [unclassified] {f['path']}:{f['line']} -> {f['target']}")
        return 0
    try:
        tracked, blocking, stale, notes, scope, classification_count = scan(root, baseline_path, classification_path, strict=args.strict)
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


def render_table_owners(owners: dict[str, tuple[str, ...]]) -> str:
    """Render the TABLE_OWNERS literal exactly as this file spells it."""
    lines = ["TABLE_OWNERS: dict[str, tuple[str, ...]] = {"]
    for module, tables in owners.items():
        inner = ", ".join(f'"{table}"' for table in tables)
        # Two commas matter here, and this function used to get both wrong.
        # (1) The comma that ENDS each dict entry: putting it inside the
        #     parens instead leaves consecutive entries with no separator, so
        #     --emit-ownership writes Python that no longer imports and takes
        #     every other gate in check.sh down with it.
        # (2) A ONE-element tuple needs its own trailing comma -- ("customers")
        #     is just a str, so dropping it turns TABLE_OWNERS["crm"] into the
        #     characters 'c','u','s',... and the drift report degenerates into
        #     one line per letter. Pinned by the self_test cases below.
        if len(tables) == 1:
            inner += ","
        lines.append(f'    "{module}": ({inner}),')
    lines.append("}")
    return "\n".join(lines)


def check_ownership(root: Path) -> int:
    """Fail when TABLE_OWNERS (this file) and modules/ownership.json disagree."""
    source = load_ownership(root)
    if source != TABLE_OWNERS:
        source_tables = {t for tables in source.values() for t in tables}
        local_tables = {t for tables in TABLE_OWNERS.values() for t in tables}
        for module in sorted(set(source) | set(TABLE_OWNERS)):
            a = source.get(module)
            b = TABLE_OWNERS.get(module)
            if a != b:
                print(
                    f"[drift] {module}: ownership.json says {a}, "
                    f"verify-namespace-governance.py TABLE_OWNERS says {b}"
                )
        for table in sorted(source_tables - local_tables):
            print(f"[drift] {OWNERSHIP_JSON} owns '{table}' but the checker does not")
        for table in sorted(local_tables - source_tables):
            print(f"[drift] the checker owns '{table}' but {OWNERSHIP_JSON} does not")
        print("ownership map drift: TABLE_OWNERS must match modules/ownership.json")
        return 1
    print(
        f"ok: TABLE_OWNERS matches {OWNERSHIP_JSON} "
        f"({len(source)} module(s), {sum(len(v) for v in source.values())} table(s))"
    )
    return 0


MODULES_DIR = "modules"


def derive_capabilities(root: Path) -> dict[str, list[str]]:
    """Derive each module's expected `capabilities` set from ownership + deps.

    The contract (Phase 4 P4.1) is deliberately mechanical so it can be a gate:

      * a module that owns tables declares `read:<id>` and `write:<id>` for its
        own namespace;
      * each declared dependency contributes `read:<dep>`.

    The manifest `capabilities` field must equal this set exactly, so an
    undeclared grant (a read of a module not in `dependencies`) is a drift
    finding rather than a silent convention.
    """
    owners = load_ownership(root)
    expected: dict[str, list[str]] = {}
    for module in sorted(owners):
        manifest_path = root / MODULES_DIR / module / "manifest.json"
        if not manifest_path.is_file():
            raise ValueError(f"{module}: owns tables but has no manifest.json")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        caps: set[str] = set()
        if owners[module]:
            caps.add(f"read:{module}")
            caps.add(f"write:{module}")
        for dep in manifest.get("dependencies", []) or []:
            caps.add(f"read:{dep}")
        expected[module] = sorted(caps)
    return expected


def check_capabilities(root: Path) -> int:
    """Fail when a module's manifest `capabilities` disagree with the derivation."""
    expected = derive_capabilities(root)
    drift = 0
    for module in sorted(expected):
        manifest_path = root / MODULES_DIR / module / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        actual = sorted(manifest.get("capabilities", []) or [])
        if actual != expected[module]:
            drift += 1
            missing = sorted(set(expected[module]) - set(actual))
            extra = sorted(set(actual) - set(expected[module]))
            print(
                f"[drift] {module}: capabilities {actual} != expected {expected[module]} "
                f"(missing {missing}, extra {extra})"
            )
    if drift:
        print("capability drift: run --emit-capabilities to rewrite the manifests")
        return 1
    total = sum(len(v) for v in expected.values())
    print(f"ok: {len(expected)} module manifest(s) declare exactly {total} derived capability(ies)")
    return 0


def emit_capabilities(root: Path) -> int:
    """Rewrite each module manifest's `capabilities` from the derivation."""
    expected = derive_capabilities(root)
    for module in sorted(expected):
        manifest_path = root / MODULES_DIR / module / "manifest.json"
        text = manifest_path.read_text(encoding="utf-8")
        manifest = json.loads(text)
        manifest["capabilities"] = expected[module]
        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    total = sum(len(v) for v in expected.values())
    print(f"wrote capabilities for {len(expected)} module manifest(s) ({total} capability(ies))")
    return 0

def emit_ownership(root: Path, script_path: Path) -> int:
    """Rewrite the TABLE_OWNERS literal in this file from the JSON source."""
    source = load_ownership(root)
    text = script_path.read_text(encoding="utf-8")
    rendered = render_table_owners(source)
    match = re.search(
        r"TABLE_OWNERS: dict\[str, tuple\[str, \.\.\.\]\] = \{.*?\n\}",
        text,
        re.DOTALL,
    )
    if not match:
        print("could not locate the TABLE_OWNERS literal to rewrite", file=sys.stderr)
        return 1
    script_path.write_text(text[: match.start()] + rendered + text[match.end() :], encoding="utf-8")
    print(f"rewrote TABLE_OWNERS in {script_path} from {OWNERSHIP_JSON}")
    return 0


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
    check("mask preserves a newline in a backslash-newline continuation",
          len(mask_comments_and_strings('let s = "a\\\nb";').split("\n")), 2)
    check("mask keeps a raw string's impl line honest",
          EVENT_HANDLER_RE.findall(
              mask_comments_and_strings('let j = r#"{"k":"v"}"#;\nimpl EventHandler<X> for Y {}')),
          ["Y"])
    check("census site parses <path>:<line>",
          SITE_RE.match("modules/x/src/handlers.rs:220").group("line"), "220")

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

    with tempfile.TemporaryDirectory() as tmp:
        tree = Path(tmp)
        src = tree / "modules" / "inventory" / "src"
        src.mkdir(parents=True)
        handler = src / "handlers.rs"
        handler.write_text(
            "impl EventHandler<SaleCompleted> for InventoryStockHandler {}\n",
            encoding="utf-8",
        )
        scope = new_scope()

        def row(name: str, site: str) -> dict:
            return {"name": name, "site": site, "category": "internal_helper", "topic": ""}

        exact = [row("InventoryStockHandler", "modules/inventory/src/handlers.rs:1")]
        stale, retired, unclassified = census_rows(tree, exact, scope)
        check("census: an exact site resolves on all three axes",
              [len(stale), len(retired), len(unclassified)], [0, 0, 0])

        # A registered type whose impl is nowhere in the tree is retired, not stale.
        gone_type = [row("SaleCompletedReporter", "modules/inventory/src/handlers.rs:1")]
        stale, retired, unclassified = census_rows(tree, gone_type, scope)
        check("census: a type in no production file is retired, not stale",
              [len(stale), [f["rule"] for f in retired]], [0, ["retired-handler-row"]])

        # Exactly one doctored site (right file, wrong line) -> exactly one stale row.
        doctored = [
            row("InventoryStockHandler", "modules/inventory/src/handlers.rs:1"),
            row("InventoryStockHandler", "modules/inventory/src/handlers.rs:9"),
        ]
        stale, retired, unclassified = census_rows(tree, doctored, scope)
        check("census: one doctored site yields exactly one stale row", len(stale), 1)
        check("census: the stale row names the drifted type",
              stale[0]["target"].split(" ")[0], "InventoryStockHandler")

        # An impl with no registry row at all is unclassified.
        handler.write_text(
            "impl EventHandler<SaleCompleted> for InventoryStockHandler {}\n"
            "impl EventHandler<StockAdjusted> for OrphanHandler {}\n",
            encoding="utf-8",
        )
        orphan = [row("InventoryStockHandler", "modules/inventory/src/handlers.rs:1")]
        stale, retired, unclassified = census_rows(tree, orphan, scope)
        check("census: an impl with no registry row is unclassified",
              [f["target"] for f in unclassified], ["OrphanHandler"])

        missing = [row("InventoryStockHandler", "modules/inventory/src/gone.rs:1")]
        stale, retired, unclassified = census_rows(tree, missing, scope)
        check("census: a missing site file is stale", len(stale), 1)

    # T2: the registry generator reads the Rust handler_type method.
    check("HANDLER_TYPE_RE reads the declared variant",
          HANDLER_TYPE_RE.search(
              "fn handler_type(&self) -> HandlerType { HandlerType::PluginBridge }").group(1),
          "PluginBridge")
    check("every Rust variant maps to a registry category",
          sorted(RUST_HANDLER_TYPE_TO_CATEGORY), sorted({
              "CommandContributor", "ProjectionSubscriber", "QueryFacade",
              "Lifecycle", "PluginBridge", "InternalHelper"}))
    check("the default trait method is internal_helper",
          RUST_HANDLER_TYPE_TO_CATEGORY["InternalHelper"], "internal_helper")

    with tempfile.TemporaryDirectory() as tmp:
        tree = Path(tmp)
        src = tree / "modules" / "inventory" / "src"
        src.mkdir(parents=True)
        (src / "handlers.rs").write_text(
            "impl EventHandler<SaleCompleted> for Foo {\n"
            "    fn handler_type(&self) -> HandlerType { HandlerType::PluginBridge }\n"
            "\n"
            "    fn handle(&self, _: &SaleCompleted) -> ModuleResult { Ok(()) }\n"
            "}\n",
            encoding="utf-8",
        )
        declared = declared_handler_types(tree)
        check("declared_handler_types reads the override",
              declared.get("Foo", ())[0], "plugin_bridge")
        # A type with no override is absent from the declaration map -- the
        # generator must not invent a category for it.
        (src / "other.rs").write_text(
            "impl EventHandler<StockAdjusted> for Bar {\n"
            "    fn handle(&self, _: &StockAdjusted) -> ModuleResult { Ok(()) }\n"
            "}\n",
            encoding="utf-8",
        )
        declared = declared_handler_types(tree)
        check("a type without an override is not declared",
              "Bar" in declared, False)
        # Conflicting categories across two impls of the same type is an error.
        (src / "conflict.rs").write_text(
            "impl EventHandler<ProductCreated> for Foo {\n"
            "    fn handler_type(&self) -> HandlerType { HandlerType::Lifecycle }\n"
            "\n"
            "    fn handle(&self, _: &ProductCreated) -> ModuleResult { Ok(()) }\n"
            "}\n",
            encoding="utf-8",
        )
        try:
            declared_handler_types(tree)
            failures.append("declared_handler_types accepted conflicting categories")
        except ValueError:
            pass

    with tempfile.TemporaryDirectory() as tmp:
        tree = Path(tmp)
        src = tree / "modules" / "inventory" / "src"
        src.mkdir(parents=True)
        (src / "handlers.rs").write_text(
            "impl EventHandler<SaleCompleted> for Foo {\n"
            "    fn handler_type(&self) -> HandlerType { HandlerType::PluginBridge }\n"
            "\n"
            "    fn handle(&self, _: &SaleCompleted) -> ModuleResult { Ok(()) }\n"
            "}\n",
            encoding="utf-8",
        )
        committed = [{
            "name": "Foo", "category": "internal_helper", "topic": "sale.completed",
            "site": "modules/inventory/src/handlers.rs:1", "note": "fixture",
        }]
        registry = build_registry(tree, committed)
        check("build_registry takes the category from the Rust",
              registry["handlers"][0]["category"], "plugin_bridge")
        check("build_registry keeps the committed site and note",
              [registry["handlers"][0]["site"], registry["handlers"][0]["note"]],
              ["modules/inventory/src/handlers.rs:1", "fixture"])
        # A registry row whose type the Rust no longer declares is an error.
        try:
            build_registry(tree, committed + [{
                "name": "Gone", "category": "lifecycle", "topic": "",
                "site": "modules/inventory/src/handlers.rs:1", "note": "",
            }])
            failures.append("build_registry accepted a row with no Rust declaration")
        except ValueError:
            pass

    # T3: grant markers -- no marker fails, matching marker passes, wrong
    # table (and own-table) marker fails or is stale.
    check("GRANT_MARKER_RE reads table and reason",
          GRANT_MARKER_RE.search(
              "// namespace: cross-vertical read sales granted (daily report)").groups(),
          ("sales", "daily report"))
    check("GRANT_MARKER_RE tolerates extra spacing",
          GRANT_MARKER_RE.search(
              "//  namespace:  cross-vertical  read  gift_cards  granted ( x )").group("table"),
          "gift_cards")
    check("grant_markers reports 1-based line numbers",
          [(t, ln) for t, ln, _ in grant_markers("let a = 1;\n// namespace: cross-vertical read sales granted (r)\n")],
          [("sales", 2)])
    check("grant_for finds a marker within the window above the statement",
          grant_for("sales", 5, grant_markers(
              "l1\nl2\n// namespace: cross-vertical read sales granted (r)\nl4\nl5")),
          ("r", 3))
    check("grant_for is one-way: a marker BELOW the statement does not grant",
          grant_for("sales", 1, grant_markers(
              "l1\nl2\n// namespace: cross-vertical read sales granted (r)")),
          None)
    check("grant_for ignores a marker further than the window",
          grant_for("sales", 10, grant_markers(
              "// namespace: cross-vertical read sales granted (r)")),
          None)
    check("grant_for ignores a marker naming another table",
          grant_for("gift_cards", 1, grant_markers(
              "// namespace: cross-vertical read sales granted (r)")),
          None)

    with tempfile.TemporaryDirectory() as tmp:
        tree = Path(tmp)
        src = tree / "modules" / "loyalty" / "src"
        src.mkdir(parents=True)
        scope = new_scope()
        baseline = [{"rule": "cross-vertical-sql",
                     "path": "modules/loyalty/src/repository.rs",
                     "target": "gift_cards (owned by giftcards)",
                     "reason": "frozen edge"}]

        def sql_file(body: str) -> None:
            (src / "repository.rs").write_text(body, encoding="utf-8")

        # An unmarked frozen edge is blocking: the baseline is not enough.
        sql_file('let q = "FROM gift_cards WHERE card_number = ?1";\n')
        findings = module_sql_findings(tree, scope)
        tracked, blocking, stale = apply_baseline(findings, baseline)
        check("T3: an unmarked frozen edge blocks",
              [len(tracked), [f["baseline_status"] for f in blocking]], [0, ["unmarked"]])

        # The same edge WITH a matching marker is permitted (tracked/granted).
        sql_file("// namespace: cross-vertical read gift_cards granted (gift card redemption)\n"
                 'let q = "FROM gift_cards WHERE card_number = ?1";\n')
        findings = module_sql_findings(tree, scope)
        tracked, blocking, stale = apply_baseline(findings, baseline)
        check("T3: a matching grant marker permits the frozen edge",
              [len(blocking), [f["baseline_status"] for f in tracked]], [0, ["granted"]])
        check("T3: the granted finding carries the marker's reason",
              tracked[0]["grant_reason"], "gift card redemption")

        # A marker naming the wrong table does not grant.
        sql_file("// namespace: cross-vertical read sales granted (wrong)\n"
                 'let q = "FROM gift_cards WHERE card_number = ?1";\n')
        findings = module_sql_findings(tree, scope)
        tracked, blocking, stale = apply_baseline(findings, baseline)
        check("T3: a wrong-table marker does not grant",
              [len(tracked), [f["baseline_status"] for f in blocking]], [0, ["unmarked"]])

        # A marker on a reference to the module's own table is a stale grant.
        sql_file("// namespace: cross-vertical read loyalty_accounts granted (outlived)\n"
                 'let q = "FROM loyalty_accounts WHERE id = ?1";\n')
        findings = module_sql_findings(tree, scope)
        check("T3: a marker on the module's own table is a stale grant",
              [f["rule"] for f in findings], ["stale-grant"])
        tracked, blocking, stale = apply_baseline(findings, baseline)
        check("T3: a stale grant always blocks",
              [len(tracked), [f["rule"] for f in blocking]], [0, ["stale-grant"]])

        # An unowned table with a marker is still just informational.
        sql_file("// namespace: cross-vertical read sqlite_master granted (introspection)\n"
                 'let q = "FROM sqlite_master";\n')
        findings = module_sql_findings(tree, scope)
        check("T3: an unowned table stays a note even with a marker",
              [f["rule"] for f in findings], ["unowned-table"])

    # Phase 4 P4.5: strict promotes an undeclared dependency from note to verdict.
    soft = [make_finding("undeclared-dependency", "modules/x/src/repository.rs",
                         "sales (owned by sales, not in dependencies)", 7, "note")]
    promoted = promote_strict([dict(f) for f in soft])
    check("strict: an undeclared dependency becomes a verdict",
          [f["severity"] for f in promoted], ["verdict"])
    check("strict: promotion does not touch a cross-vertical note",
          [f["severity"] for f in promote_strict(
              [make_finding("cross-vertical-sql", "p", "t", 1, "note")])],
          ["note"])
    check("soft: an undeclared dependency stays a note without strict",
          [f["severity"] for f in soft], ["note"])
    # Ownership-map single-source parity (plan \u00a77).
    with tempfile.TemporaryDirectory() as tmp:
        tr = Path(tmp)
        (tr / "modules").mkdir()
        (tr / "modules" / "ownership.json").write_text(
            json.dumps({"owners": {"sales": ["sales", "sale_lines"]}}), encoding="utf-8"
        )
        check("load_ownership reads the source", load_ownership(tr),
              {"sales": ("sales", "sale_lines")})
        (tr / "modules" / "ownership.json").write_text(
            json.dumps({"owners": {"sales": ["sales"], "b": ["sales"]}}), encoding="utf-8"
        )
        try:
            load_ownership(tr)
            failures.append("load_ownership should reject a table claimed twice")
        except ValueError:
            pass
        (tr / "modules" / "ownership.json").write_text(
            json.dumps({"owners": {}}), encoding="utf-8"
        )
        try:
            load_ownership(tr)
            failures.append("load_ownership should reject an empty owners map")
        except ValueError:
            pass
    check("render_table_owners round-trips an empty module",
          render_table_owners({"reporting": ()}).splitlines()[-2].strip(),
          '"reporting": (),')
    # The empty-module case above is the ONE branch that was already correct,
    # which is why both bugs survived: nothing exercised a populated entry.
    check("render_table_owners terminates a populated entry",
          render_table_owners({"sales": ("sales", "payments")}).splitlines()[-2].strip(),
          '"sales": ("sales", "payments"),')
    check("render_table_owners keeps a one-element entry a tuple",
          render_table_owners({"crm": ("customers",)}).splitlines()[-2].strip(),
          '"crm": ("customers",),')
    try:
        compile(render_table_owners({"sales": ("sales", "payments"),
                                     "crm": ("customers",),
                                     "reporting": ()}),
                "<rendered TABLE_OWNERS>", "exec")
        rendered_compiles = True
    except SyntaxError:
        rendered_compiles = False
    check("render_table_owners emits a literal Python can parse", rendered_compiles, True)

    if failures:
        print("verify-namespace-governance: self-test FAILED", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
        return 1
    print("verify-namespace-governance: self-test ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
