#!/usr/bin/env python3
"""Census: which declared settings keys the RemoteSync ingest lane ADMITS.

Read-only over the sources named in QUERIES below; writes nothing and changes
no behaviour. The policy is reproduced in Python because this is a CENSUS, not a
gate: no runner consumes it (deliberately - a census with no runner is a fake
control, so it claims none of that authority), and nothing here can refuse a
key at runtime.

The contract it mirrors is the identity shape landed in edaaf7f9c:
platform/core/src/settings/keys.rs computes membership in exactly two functions
(credential_base against SECRET_KEY_DENY_LIST, device_base against
NON_EXPORTABLE_DEVICE_KEYS), both suffix-blind whole-key equality, and
raw.rs:660-670 makes the untrusted-lane rule

    !(is_non_exportable_setting_key(key) || is_manager_owned_key(key))

so a name is refused for one of exactly three reasons: credential list, device
list, manager-owned prefix. If this census ever needs a FOURTH reason it has
found something and must report it, not encode it quietly.
"""

import os
import re
import sys

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))
KEYS_RS = os.path.join(REPO, "platform", "core", "src", "settings", "keys.rs")
RAW_RS = os.path.join(REPO, "platform", "core", "src", "settings", "raw.rs")

QUERIES = [
    ("declared constants", "grep -cE '^[[:space:]]*(pub |pub\\(crate\\) )?const [A-Z][A-Z0-9_]*: &str = ' platform/core/src/settings/keys.rs"),
    ("deny-list size", 'sed -n "266,282p" platform/core/src/settings/keys.rs | grep -cE "^[[:space:]]+[A-Z][A-Z0-9_]*,$"'),
    ("admission rule", 'sed -n "660,670p" platform/core/src/settings/raw.rs'),
    ("prefix rule", 'sed -n "754,757p" platform/core/src/settings/raw.rs'),
]

CONST_RE = re.compile(r'^\s*(?:pub |pub\(crate\) )?const ([A-Z][A-Z0-9_]*): &str = "([^"]*)";\s*$')
LIST_START_RE = re.compile(r"^pub const (\w+): &\[&str\] =")
IDENT_RE = re.compile(r"\b([A-Z][A-Z0-9_]{2,})\b")
PREFIX_RE = re.compile(r'starts_with\("([^"]+)"\)')


def lines(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read().splitlines()


def normalised_candidate(key):
    """Mirror of keys.rs normalised_candidate: trim, then ASCII-case-fold."""
    return key.strip().lower()


def read_constants():
    """name -> value for every declared &str key constant, doc lines skipped."""
    out = []
    for line in lines(KEYS_RS):
        if line.lstrip().startswith("///"):
            continue
        m = CONST_RE.match(line)
        if m:
            out.append((m.group(1), m.group(2)))
    return out


def read_list_body(list_name):
    src = lines(KEYS_RS)
    start = None
    for i, line in enumerate(src):
        if LIST_START_RE.match(line) and list_name in line:
            start = i
            break
    if start is None:
        raise SystemExit("census cannot find %s; the file shape moved" % list_name)
    body = ""
    for i in range(start, min(start + 40, len(src))):
        body += src[i] + "\n"
        if body.rstrip().endswith("];"):
            return body
    raise SystemExit("%s block did not terminate within 40 lines" % list_name)


LIST_BODY_RE = re.compile(r"=\s*&\[(.*?)\];", re.S)


def resolve_members(body, consts):
    """Resolve a list block to key strings.

    DOTALL because the two blocks are laid out differently: SECRET_KEY_DENY_LIST
    keeps its elements one per line under "= &[" while NON_EXPORTABLE_DEVICE_KEYS
    breaks the literal itself across lines ("= ... \n &[A, B, C];"), which a
    single-line scan silently misses.
    """
    by_name = dict(consts)
    m = LIST_BODY_RE.search(body)
    if not m:
        raise SystemExit("census cannot read a list block; its layout moved")
    names = [i for i in IDENT_RE.findall(m.group(1)) if i in by_name]
    unresolved = [i for i in IDENT_RE.findall(m.group(1)) if i not in by_name]
    if unresolved:
        raise SystemExit("list members not declared as key constants: %r" % (unresolved,))
    return [by_name[i] for i in names]


def manager_prefixes():
    """The literals is_manager_owned_key compares against, read from raw.rs."""
    src = lines(RAW_RS)
    out = []
    for i, line in enumerate(src):
        if "fn is_manager_owned_key" in line:
            for sub in src[i:i + 8]:
                out.extend(PREFIX_RE.findall(sub))
            break
    if len(out) != 2:
        raise SystemExit("expected 2 manager prefixes, read %r" % (out,))
    return tuple(out)


def main():
    consts = read_constants()
    total = len(consts)
    deny = resolve_members(read_list_body("SECRET_KEY_DENY_LIST"), consts)
    device = resolve_members(read_list_body("NON_EXPORTABLE_DEVICE_KEYS"), consts)
    prefixes = manager_prefixes()
    deny_n = {normalised_candidate(k) for k in deny}
    device_n = {normalised_candidate(k) for k in device}

    def verdict(key):
        c = normalised_candidate(key)
        if c in deny_n:
            return "refused: credential list"
        if c in device_n:
            return "refused: device list"
        if c.startswith(prefixes):
            return "refused: manager prefix"
        return "admitted"

    rows = [(n, v, verdict(v)) for n, v in consts]
    admitted = [r for r in rows if r[2] == "admitted"]
    refused = [r for r in rows if r[2] != "admitted"]

    failures = []
    if total < 70:
        failures.append("FLOOR: parsed only %d declared constants (floor 70): the "
                        "parser is reading part of the file, so no verdict below "
                        "is trustworthy" % total)
    if len(deny) < 10:
        failures.append("VACUITY: deny list resolved to %d members (floor 10)" % len(deny))
    if len(device) < 1:
        failures.append("VACUITY: device list resolved to %d members" % len(device))
    # Declared spellings only: sync_server_url / sync_enabled / sync_api_key are
    # FLAT names, not sync.server_url, and local_api.secret is refused by the
    # CREDENTIAL list (LOCAL_API_SECRET is on it), with the prefix rule catching
    # lan_server.bind. Both were guessed wrong in the briefing, so the probes
    # name what the file actually declares.
    known = [
        ("sync_server_url admitted", "sync_server_url", "admitted"),
        ("sync_enabled admitted", "sync_enabled", "admitted"),
        ("sync_api_key refused", "sync_api_key", "refused: credential list"),
        ("local_api.secret refused", "local_api.secret", "refused: credential list"),
        ("lan_server.bind refused by prefix", "lan_server.bind", "refused: manager prefix"),
        ("smtp_config:tenant-a admitted (the finding)", "smtp_config:tenant-a", "admitted"),
    ]
    for label, key, want in known:
        got = verdict(key)
        if got != want:
            failures.append("VERDICT: %s -> %s, expected %s" % (label, got, want))

    print("CENSUS  settings keys admitted by the untrusted ingest lanes")
    print("        PortablePackage and RemoteSync share ONE rule; TrustedLocal admits all")
    print("")
    print("SOURCES keys.rs, raw.rs  (read-only; this script writes nothing)")
    print("QUERIES the measurement named for each bucket, so a zero can be checked:")
    for what, q in QUERIES:
        print("  %-18s %s" % (what + ":", q))
    print("PARSER  line-based regex on a one-line 'const NAME: &str = \"value\";' form;")
    print("        doc-comment lines skipped so prose never counts as a declaration.")
    print("        LIMITATION, stated not hidden: a declaration that WRAPS across")
    print("        lines, or a raw/concatenated literal, would be MISSED. The 70-floor")
    print("        is the guard against that, not a proof of completeness.")
    print("")
    print("TOTALS  declared=%d  admitted=%d  refused=%d" % (total, len(admitted), len(refused)))
    for reason in ("refused: credential list", "refused: device list", "refused: manager prefix"):
        print("        %-26s %d" % (reason, sum(1 for r in refused if r[2] == reason)))
    print("        SECRET_KEY_DENY_LIST=%d resolved  NON_EXPORTABLE_DEVICE_KEYS=%d resolved"
          % (len(deny), len(device)))
    print("        (the deny list is 17 entries, not the 18 quoted in dispatches)")
    print("")
    print("ADMITTED BY FAMILY")
    fams = {}
    for _n, v, _w in admitted:
        fams.setdefault(v.split(".", 1)[0], []).append(v)
    for fam in sorted(fams, key=lambda f: (-len(fams[f]), f)):
        print("  %-13s %2d  %s" % (fam, len(fams[fam]), ", ".join(sorted(fams[fam]))))
    print("")
    print("REFUSED, every one, with its reason")
    for _n, v, why in sorted(refused, key=lambda r: r[1]):
        print("  %-32s %s" % (v, why.replace("refused: ", "")))
    print("")
    print("THE FOUR THAT MAKE THIS URGENT")
    for key in ("sync_server_url", "sync_enabled", "pg_sync.host", "redis.cache_ttl"):
        print("  %-16s %s" % (key, verdict(key)))
    for fam in ("pg_sync", "redis"):
        members = sorted({v for _n, v, _w in rows if v.split(".", 1)[0] == fam})
        ref = [m for m in members if verdict(m) != "admitted"]
        adm = [m for m in members if verdict(m) == "admitted"]
        print("  family %-8s declared: %s" % (fam, ", ".join(members)))
        print("           refused: %-16s admitted: %s" % (", ".join(ref) or "none", ", ".join(adm) or "none"))
    print("")
    print("SUFFIX BLIND SPOT, by decision in edaaf7f9c (identity returns the BASE alone)")
    for probe in ("smtp_config:tenant-a", "sync_api_key:tenant-a", "stripe.api_key:0"):
        print("  %-26s %-10s  is_secret_setting_key=%s" % (probe, verdict(probe), verdict(probe) != "admitted"))
    print("")
    if failures:
        print("SELF-TEST FAILED")
        for f in failures:
            print("  ! " + f)
        return 1
    print("SELF-TEST ok  floor(70)=%d  deny-list(10)=%d  device-list=%d  known-verdicts=%d/%d"
          % (total, len(deny), len(device), len(known), len(known)))
    for label, key, want in known:
        print("  ok  %-44s %s -> %s" % (label, key, want))
    return 0


if __name__ == "__main__":
    sys.exit(main())
