#!/usr/bin/env python3
"""Check that every id a template-literal getString() can build exists in
BOTH Fluent bundles.

The parity gate resolves only string literals, so a template-built id is
invisible to it. This script closes that gap for the families whose domain is
bounded by TypeScript (a union, a const array, a fixed .map list). Families
whose domain comes from the server (gift-card status, txn_type, product
category names) are reported as UNBOUNDED on purpose: no static check can
cover them, so the code must degrade gracefully instead.

Usage: python verify-fluent-dynamic-families.py <repo_root>
       python verify-fluent-dynamic-families.py --self-test

WHAT IT ACTUALLY REPORTS, stated carefully because the obvious reading is wrong. The
"setup feature label" family was a HAND-MAINTAINED slug list, not something derived
from the source, and none of the 27 ids it named (setup-feature-analytics-label,
setup-feature-audit-log-label, ...) appeared anywhere under ui/src -- zero references.
So the GAP it reported was a true statement about the BUNDLE ("these 27 keys are
absent") and an unproven claim about the CODE ("the UI needs these 27 keys"). An
earlier note in this file called it a live product defect. That was overstated: the
defect demonstrably present there was THIS CHECKER'S STALE LIST.

RESOLVED 2026-09-29, repo-wide, because it decides the wiring question:
  grep 'setup-feature-'          -> 12 hits, NONE of them a key or a source reference
  grep 'setup-feature-analytics-label' in shared-ui/locales -> 0
  the only two hits under shared-ui/locales are COMMENTS, and they point at
    "setup-feature-cloud-sync" -- a key that does not exist either.
The family was DELETED rather than satisfied (see the note in FAMILIES), because adding
27 keys would have put translation strings in the .ftl that nothing reads.

WHY --self-test EXISTS (added 2026-10-23)
=========================================
This checker's whole verdict is a comparison: family ids against the two bundles. If the
bundle reader stops seeing keys, or a family list empties, the comparison still runs and
still prints a verdict -- it just prints OK over nothing. That is the repo's named
failure class (docs/operations/agent-gates.md: a gate whose answer is a comparison cannot
tell "the sets agree" from "there were no sets"). Two such defects were found while
writing the cases and are now fixed:

  1. found NOTHING -> exit 0. An empty shared-ui/locales (renamed directory, wrong
     root, a glob that stopped matching) produced "0 bounded family/families with gaps"
     and exit 0 -- a vacuous clean pass. Now rc 2 with a refusal message.
  2. The key regex accepted a LEADING "-", so it matched "-term =" (a MULTILINE
     attribute) and registered a phantom id named "-term". The replacement, spelled at
     KEY_RE, still matches every real key (all 4596 of them start with a letter) and
     no attribute. Pinned by the "-term =" case below.

Exit 0 clean, 1 bounded family/families with gaps, 2 usage, self-test failure, or a
report that could not have examined anything (no .ftl, or no bounded family).
"""
# Promoted from the 2026-09-03 Fluent page audit; see
# docs/records/audits/frontend/fluent-page-audit.md for why this check exists.

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Repo root, script-relative: scripts/ sits one level below it. An explicit
# path argument still wins, so the tool works from anywhere. Resolved inside
# main() and NOT at import time, so --self-test touches no file.
DEFAULT_ROOT = Path(__file__).resolve().parents[1]

# A Fluent key definition: the id starts a line and is followed by "=".
# Deliberately NOT [A-Za-z0-9_-]+: that also matched "-term =", a MULTILINE
# attribute, and filed a phantom key named "-term" in the bundle. A Fluent id may not
# start with "-", so requiring a leading letter is exact, and an attribute is excluded
# by construction. Whitespace before "=" is kept because a padded key is still a key.
KEY_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*)\s*=")

# (family label, prefix, [suffixes]) -- suffixes enumerated from the RUNTIME
# domain, not the TypeScript type. Getting this wrong produces false
# positives: the Granularity union admits 'daily', but the GRANULARITIES
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


def bundle_files(locales: Path) -> list[Path]:
    """Every bundle, English and Indonesian, in a stable order."""
    return sorted(locales.glob("*.ftl"))


def read_keys(text: str) -> set[str]:
    """Top-level message ids defined in one bundle's text.

    Attributes are NOT keys and must not be counted: "-term" inside a message is a
    term reference or a multiline attribute, never something getString() can build.
    """
    out: set[str] = set()
    for line in text.splitlines():
        m = KEY_RE.match(line.strip())
        if m:
            out.add(m.group(1))
    return out


def load_bundles(locales: Path) -> tuple[set[str], set[str], int]:
    """(EN ids, ID ids, bundle file count) from every *.ftl under locales.

    *.id.ftl is the Indonesian bundle; every other *.ftl is English and they are
    UNIONED. That union is what makes a new second English file count rather than
    silently disappear.
    """
    en: set[str] = set()
    id_: set[str] = set()
    files = bundle_files(locales)
    for f in files:
        keys = read_keys(f.read_text(encoding="utf-8"))
        if f.name.endswith(".id.ftl"):
            id_ |= keys
        else:
            en |= keys
    return en, id_, len(files)


def family_findings(families, en: set[str], id_: set[str]) -> list[dict]:
    """One record per bounded family: what is missing from EN and from ID.

    Both directions, and they are separate lists on purpose -- a key present in
    English and absent in Indonesian is the likeliest real regression, and reporting
    only the union would name the family without saying which bundle lost it.
    """
    out: list[dict] = []
    for label, prefix, values in families:
        ids = [prefix + v for v in values]
        out.append({
            "label": label,
            "count": len(values),
            "missing_en": [i for i in ids if i not in en],
            "missing_id": [i for i in ids if i not in id_],
        })
    return out


def is_gap(record: dict) -> bool:
    """True when a family is missing at least one id from AT LEAST ONE bundle."""
    return bool(record["missing_en"] or record["missing_id"])


def gap_count(records) -> int:
    """How many bounded families have a gap. The number the exit code reports."""
    return sum(1 for r in records if is_gap(r))


def unbounded_report(unbounded, en: set[str]) -> list[tuple[str, str, str, int]]:
    """(label, prefix, why, declared count) for each exempt family.

    UNBOUNDED families are an EXEMPTION, not a check: they are reported with how many
    ids exist today and can never contribute a gap, however many are absent. Pinned in
    the self-test, because folding them into the bounded loop would turn every
    server-driven status into a build failure.
    """
    return [(label, prefix, why, len([k for k in en if k.startswith(prefix)]))
            for label, prefix, why in unbounded]


def vacuous_reason(n_files: int, families) -> str | None:
    """Why this run could not have examined anything, or None when it could.

    A comparison over an empty set agrees with itself. n_files == 0 means the locales
    directory was missed or renamed; an empty family list means the bounded list was
    emptied. Either way "0 families with gaps" is not evidence of a clean tree, and the
    repo's rule is that such a run must be loud rather than clean.
    """
    if n_files == 0:
        return ("no *.ftl bundle was found under shared-ui/locales -- the directory, the "
                "root or the glob is wrong. Refusing to report clean over zero bundles.")
    if not families:
        return ("no bounded family is declared, so nothing was compared. Refusing to "
                "report clean over an empty family list.")
    return None


def obeys_exemption(unbounded, bounded) -> bool:
    """True when no family exempt as UNBOUNDED is also graded as bounded.

    UNBOUNDED means "their domain comes from the server, so their absence from the
    bundle can never be a gap". Copying one into FAMILIES (the obvious way to "also
    check" a server-driven family) would grade it, and every install whose server
    returns a status nobody translated would fail the build. The rule lives HERE so the
    self-test can grade the live table against it -- an earlier version of this case
    only asserted that grading NO families yields no gaps, which no real edit can break.
    """
    exempt_labels = {label for label, _, _ in unbounded}
    exempt_prefixes = {prefix for _, prefix, _ in unbounded}
    return not any(label in exempt_labels or prefix in exempt_prefixes
                   for label, prefix, _ in bounded)


def exemption_report(bounded, unbounded, en: set[str]) -> list[tuple[str, str, str, int]]:
    """The UNBOUNDED rows main() prints: every exempt family NOT also graded as bounded.

    The intersection is dropped rather than silently exempted, because grading a family
    and exempting it at the same time is the contradiction this rule exists to surface.
    main() prints from HERE and the self-test grades HERE: one function, so the cases
    cannot describe a rule the live run does not apply. (Measured: a case that called
    obeys_exemption() directly stayed green under "return True", and so did a mutation
    that copied an exempt family into FAMILIES, because this filter is the only thing
    that catches the copy.)
    """
    return [row for row in unbounded_report(unbounded, en)
            if obeys_exemption([(row[0], row[1], ())], bounded)]


def well_formed(families) -> bool:
    """True when every family can actually be compared.

    A family with no suffixes compares nothing and reports OK forever; a prefix that
    does not end in "-" builds ids the source never builds. Both are silent in the live
    run, so both are graded here over a fixture AND over the live table.
    """
    return (bool(families)
            and all(values and prefix.endswith("-") for _, prefix, values in families))


def self_test() -> int:
    """Cases for the four rules this checker applies. No file is read or written.

    Each case drives the REAL function main() calls (read_keys, family_findings,
    gap_count, unbounded_report, vacuous_reason) -- never a reimplementation, which is
    the trap that makes a self-test green while the live path is dead.
    """
    bad: list[str] = []
    n = 0

    def case(name: str, got, want) -> None:
        nonlocal n
        n += 1
        if got != want:
            bad.append(name + ": expected " + repr(want) + ", got " + repr(got))

    def ok(name: str, cond: bool) -> None:
        case(name, bool(cond), True)

    # The family used by the bounded cases. The prefix ends in "-" like every live one.
    fam = [("demo status", "demo-status-", ["open", "closed", "void"])]
    all_ids = {"demo-status-open", "demo-status-closed", "demo-status-void"}

    # R1 -- a bounded family whose ids all exist is NOT reported.
    clean = family_findings(fam, all_ids, all_ids)
    case("R1 bounded family complete in both bundles -> 0 gaps", gap_count(clean), 0)
    case("R1 ...and it is still counted as examined", len(clean), 1)

    # R2 -- one id missing from EN is a gap, and the report NAMES it.
    en_miss = family_findings(fam, all_ids - {"demo-status-void"}, all_ids)
    case("R2 one id missing from EN -> 1 gap", gap_count(en_miss), 1)
    case("R2 the missing EN id is named", en_miss[0]["missing_en"], ["demo-status-void"])
    case("R2 ...and ID is reported clean", en_miss[0]["missing_id"], [])

    # R3 -- one id missing from ID is a gap. SEPARATE from the EN direction: a detector
    # that only checked EN would pass every Indonesian lock as clean.
    id_miss = family_findings(fam, all_ids, all_ids - {"demo-status-open"})
    case("R3 one id missing from ID -> 1 gap", gap_count(id_miss), 1)
    case("R3 the missing ID id is named", id_miss[0]["missing_id"], ["demo-status-open"])
    case("R3 ...and EN is reported clean", id_miss[0]["missing_en"], [])

    # R4 -- BOTH bundles empty (nothing loaded). Every family is a gap, loudly. This is
    # the direction a "return 0 when a set is empty" convenience guard would hide.
    none = family_findings(fam, set(), set())
    case("R4 both bundles empty -> every id missing in both",
         (len(none[0]["missing_en"]), len(none[0]["missing_id"])), (3, 3))

    # R5 -- UNBOUNDED is an exemption. Its ids are absent from EN entirely and it still
    # contributes no gap, by design.
    unb = [("demo server status", "demo-status-", "server string")]
    rows = unbounded_report(unb, {"demo-status-open", "demo-status-closed"})
    case("R5 unbounded family still gets a report row", len(rows), 1)
    case("R5 ...carrying only the ids that exist today", rows[0][3], 2)
    case("R5 ...and an unbounded-only report has 0 gaps",
         gap_count(family_findings([], set(), set())), 0)
    # And on the LIVE tables: the four exempt families are still reported as exempt, and
    # none of them is ALSO graded as a bounded family. Both cases go through
    # exemption_report(), the function main() prints from -- NOT through a direct call to
    # obeys_exemption(): a case asserting obeys_exemption() == True stayed green under
    # "return True", because a check that already passes cannot notice it was disabled.
    # Driving the reporting path means a broken rule shows up as a dropped row.
    live_rows = exemption_report(FAMILIES, UNBOUNDED, {"gift-cards-status-open"})
    case("R5 every live UNBOUNDED family is reported as exempt, once",
         [r[0] for r in live_rows], [label for label, _, _ in UNBOUNDED])
    # WITH A WITNESS that both tables are non-empty: a case that passed by iterating
    # nothing would be the vacuous-pass defect reproduced inside the self-test.
    ok("R5 the live UNBOUNDED table is non-empty", bool(UNBOUNDED))
    ok("R5 the live bounded table is non-empty", bool(FAMILIES))
    # A family that is BOTH exempt and graded loses its exemption, because it is now
    # compared -- that is what makes "copy an UNBOUNDED row into FAMILIES" visible.
    doubled = exemption_report(
        [("gift-cards status", "gift-cards-status-", ["open"])], UNBOUNDED, set())
    case("R5 an exempt family that is ALSO graded is dropped from the exemption report",
         [r[0] for r in doubled], ["gift-cards txn type", "sales report category",
                                   "topology purpose"])

    # R6 -- a REAL Fluent message definition is a key...
    case("R6 'x-key = Halo' is a key", sorted(read_keys("x-key = Halo")), ["x-key"])
    # ...and an ATTRIBUTE is not. "-term =" is a MULTILINE attribute; it matched the old
    # regex and filed a phantom key named "-term" in the bundle.
    case("R6 a '-term =' attribute is NOT a key",
         sorted(read_keys("x-key =\n    -term = value\n    .label = Lain")), ["x-key"])
    # A padded "=" is still a definition.
    case("R6 a padded '=' is still a key",
         sorted(read_keys("  spaced-key   = value")), ["spaced-key"])
    # A comment mentioning '=' is not a key.
    case("R6 a '#' comment is not a key", sorted(read_keys("# hello = world")), [])
    # A key with a "=" inside its VALUE is one key, not two.
    case("R6 '=' inside a value is not a second key",
         sorted(read_keys("math = 2 + 2 = 4")), ["math"])

    # R7 -- found NOTHING must be loud, not a silent clean pass.
    ok("R7 zero bundles is a refusal", vacuous_reason(0, fam) is not None)
    ok("R7 zero families is a refusal", vacuous_reason(12, []) is not None)
    case("R7 a real run is not a refusal", vacuous_reason(12, fam), None)
    ok("R7 the zero-bundle refusal names its cause",
       "no *.ftl bundle" in (vacuous_reason(0, fam) or ""))

    # R8 -- the family list must be well formed: a family with no suffixes compares
    # nothing and would report OK forever, and a prefix that does not end in "-" builds
    # ids the source never builds. This takes the list as an ARGUMENT and is then run
    # against the live table below, because a case that closed over the module global
    # stayed green when an unfilled family was inserted into FAMILIES.
    ok("R8 no family has an empty suffix list",
       well_formed([("a", "a-", ["x"]), ("b", "b-", ["y"])]))
    ok("R8 an empty suffix list is rejected",
       not well_formed([("a", "a-", [])]))
    ok("R8 a prefix not ending in '-' is rejected",
       not well_formed([("a", "a", ["x"])]))
    ok("R8 the LIVE bounded table is well formed", well_formed(FAMILIES))
    ok("R8 the live bounded list is not empty", bool(FAMILIES))

    if bad:
        for line in bad:
            print("  MISSED " + line)
        print("SELF-TEST WRONG (" + str(len(bad)) + "/" + str(n) + " cases)")
        return 2
    print("SELF-TEST OK (" + str(n) + " cases, no files touched)")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("root", nargs="?", help="repo root (default: the tree this file lives in)")
    ap.add_argument("--self-test", action="store_true",
                    help="run the classifier cases and exit; reads no file")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()

    root = Path(args.root).resolve() if args.root else DEFAULT_ROOT
    locales = root / "shared-ui" / "locales"
    en, id_, n_files = load_bundles(locales)

    reason = vacuous_reason(n_files, FAMILIES)
    if reason:
        print("verify-fluent-dynamic-families: " + reason, file=sys.stderr)
        return 2
    if not en or not id_:
        which = "English" if not en else "Indonesian"
        print("verify-fluent-dynamic-families: " + str(n_files) + " bundle file(s) were "
              "read but " + which + " yielded ZERO ids. Refusing to report clean: a "
              "comparison against an empty set agrees with itself.", file=sys.stderr)
        return 2

    records = family_findings(FAMILIES, en, id_)
    for r in records:
        status = "GAP" if is_gap(r) else "OK "
        print(status + " " + r["label"].ljust(32) + " " + str(r["count"]).rjust(3) + " ids"
              + (("  missing en: " + ", ".join(r["missing_en"])) if r["missing_en"] else "")
              + (("  missing id: " + ", ".join(r["missing_id"])) if r["missing_id"] else ""))

    print()
    for label, prefix, why, declared in exemption_report(FAMILIES, UNBOUNDED, en):
        print("~~ " + label.ljust(32) + " prefix " + repr(prefix) + " - UNBOUNDED (" + why
              + "); " + str(declared) + " id(s) declared today")

    bad = gap_count(records)
    print()
    print(str(bad) + " bounded family/families with gaps.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
