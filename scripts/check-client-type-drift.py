#!/usr/bin/env python3
"""check-client-type-drift.py -- grade ui/src/api/client/types.ts against the
published OpenAPI document it claims to be derived from.

WHY THIS EXISTS
    types.ts opens with a header saying every type in it is derived from the
    OpenAPI 3.1 specification. Nothing derived them and nothing graded them, so
    they drifted: five of the fifteen interfaces that exist on both sides had
    members the server has never sent, members it always has sent, or both. The
    worst was not a stale field but a wrong SHAPE -- the token endpoint answers a
    { token: {...} } envelope and the client typed the envelope as the details,
    which is the kind of defect no compiler and no prose audit sees. A published
    SDK type file is read by people who are not in this repository, so our own
    tests do not catch it either.

    check-api-surface.py already exists and is already wired, but it reconciles a
    DOCUMENT against the IPC registries. This reconciles a TYPE FILE against the
    schema document. Different inputs, different failure mode, so it is a
    separate checker rather than another mode of that one.

HOW IT GRADES
    Only names present on BOTH sides are compared. A name on one side alone is
    reported as context, never as a finding: the OpenAPI document describes two
    servers (kasirmu-api and the cloud server) while types.ts describes the one
    the browser talks to, so the populations are deliberately different and a
    two-way set comparison would be a permanent red page.

    Two graded classes:
      missing_member  -- the server sends it, the type does not declare it
      invented_member -- the type declares it, the server has no such member

    Exit 0 clean, 1 findings, 2 an input could not be parsed.

SCOPE: wired as a BLOCKING gate, with a green baseline from day one because the
five drifts were repaired in the commit before this one. A gate introduced
against a red page gets muted; that is how check-api-surface.py sat unwired from
08-09-26 to 09-29.

USAGE
    python check-client-type-drift.py [--root REPO] [--json] [--full]
    python check-client-type-drift.py --self-test
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

TYPES_REL = "ui/src/api/client/types.ts"
# name -> file, for each builder that emits components.schemas. Keyed by function
# name rather than by "the first json! block" because these files carry a second
# block each: build_base_parameters and build_cloud_paths, which hold Parameter
# and Path Objects, not Schema Objects. Reading those as schemas invents members
# -- a Parameter has a "name", a Path has a "get" -- and every one of them would
# be reported as drift against a real type.
SCHEMA_BUILDERS = (
    ("crates/kasirmu-api/src/spec/schemas.rs", "build_base_schemas"),
    ("apps/cloud-server/src/openapi/cloud.rs", "build_cloud_schemas"),
)

FUNC_RE = re.compile(r"fn\s+(\w+)\s*\(")
TS_TYPE_RE = re.compile(r"^export\s+(interface|type)\s+(\w+)", re.M)
TS_MEMBER_RE = re.compile(r"^\s{2}(\w+)\??\s*:", re.M)


def _skip_string(text, i):
    """Advance past the JSON string whose opening quote is at index i."""
    i += 1
    n = len(text)
    while i < n:
        if text[i] == "\\":
            i += 2
            continue
        if text[i] == '"':
            return i + 1
        i += 1
    raise ValueError("unterminated string")


def _strip_rust_comments(text):
    """Blank out // and /* */ comments, preserving every offset and newline.

    A json! literal is Rust, so it carries comments, and a comment inside one is
    invisible to the compiler but fully visible to a text scanner. These files use
    that: apps/cloud-server/src/openapi/cloud.rs documents SyncPushItem and
    PushOutcome in prose that sits between the schema entries, and one of those
    comments contains a JSON example with braces and quotes in it. Scanning the
    raw text therefore counted braces from inside a comment as real structure,
    which is how PushOutcome lost its name and its members were reported as
    schemas of their own.

    Blanking rather than deleting keeps every index valid, so this can run once
    over the file and leave the rest of the extractors working on offsets that
    still mean what they meant. Newlines are preserved for the same reason: line
    numbers in a diagnostic have to survive.

    String literals are skipped, so a // inside a JSON string is not a comment
    and a brace inside one is still structure.
    """
    out = list(text)
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c == '"':
            i = _skip_string(text, i)
            continue
        if _is_macro_start(text, i):
            i = _skip_macro(text, i)
            continue
        if c == "/" and i + 1 < n:
            if text[i + 1] == "/":
                j = text.find("\n", i)
                j = n if j < 0 else j
                for k in range(i, j):
                    out[k] = " "
                i = j
                continue
            if text[i + 1] == "*":
                j = text.find("*/", i + 2)
                j = n if j < 0 else j + 2
                for k in range(i, j):
                    if out[k] != "\n":
                        out[k] = " "
                i = j
                continue
        i += 1
    return "".join(out)


def _is_macro_start(text, i):
    """True when a Rust macro invocation -- ident! -- starts at index i."""
    if i + 1 >= len(text) or text[i + 1] != "!":
        return False
    if i + 2 < len(text) and (text[i + 2].isalnum() or text[i + 2] == "_"):
        return False
    return i == 0 or not (text[i - 1].isalnum() or text[i - 1] == "_")


def _skip_macro(text, i):
    """Advance past a macro invocation whose name starts at index i.

    A json! literal may embed a Rust expression wherever a value goes, and this
    document does exactly that once: apps/cloud-server/src/openapi/cloud.rs has
    an example field set to env!("CARGO_PKG_VERSION"). That argument is a string
    to Rust but is invisible to a JSON reader, so a scanner that only
    understands quotes reads the macro argument as the next KEY and reports the
    members of the following schema as members of the previous one. That is not
    hypothetical: it is how HealthResponse acquired three phantom members and how
    PushOutcome lost its own name entirely. The invocation is delimited by its
    parentheses, with strings inside it skipped so a bracket in a string argument
    cannot close it early.
    """
    n = len(text)
    j = i + 1
    while j < n and text[j] != "(":
        j += 1
    if j >= n:
        return i + 1
    depth = 0
    while j < n:
        c = text[j]
        if c == '"':
            j = _skip_string(text, j)
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    raise ValueError("unbalanced macro invocation at %d" % i)


def _balanced(text, start):
    """Return the index one past the brace closing the object opened at start."""
    depth = 0
    i = start
    n = len(text)
    while i < n:
        c = text[i]
        if c == '"':
            i = _skip_string(text, i)
            continue
        if _is_macro_start(text, i):
            i = _skip_macro(text, i)
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError("unbalanced object at %d" % start)


def _object_body(text, start):
    """Return the inside of the object whose opening brace is at start."""
    end = _balanced(text, start)
    return text[start + 1 : end - 1]


def _skip_value(body, i):
    """Advance past one JSON value starting at i; return the index after it.

    One uniform depth tracker rather than a case per JSON kind. The case-per-kind
    version had three separate reasons to be wrong, and each one shipped a real
    misparse: an array branch that counted only [ and ] let an object nested
    inside an array desynchronise the scan, so PushOutcome's members were
    reported as schemas of their own; a scalar branch that stopped without
    consuming its terminator returned the caller's own index, which livelocked
    the loop; and a scalar branch that did not know ] at all walked past the end
    of the enclosing array. Tracking both delimiters together cannot go wrong in
    that way, and a string can hide neither.
    """
    n = len(body)
    if i >= n:
        return n
    c = body[i]
    if c == '"':
        return _skip_string(body, i)
    if _is_macro_start(body, i):
        return _skip_macro(body, i)
    if c not in "{[":
        # scalar: number, true, false, null. Consume the terminator too --
        # returning the index OF a separator without eating it hands the caller
        # back where it started, and the loop above never advances.
        while i < n and body[i] not in ",}]":
            i += 1
        return i + 1 if i < n else n
    depth = 0
    while i < n:
        d = body[i]
        if d == '"':
            i = _skip_string(body, i)
            continue
        if _is_macro_start(body, i):
            i = _skip_macro(body, i)
            continue
        if d in "{[":
            depth += 1
        elif d in "}]":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError("unbalanced value at %d" % i)


def _top_level_members(body):
    """(name, value_text) for every member of a JSON object, nested ones skipped.

    A regex over the body returns nested keys too -- the properties of a nested
    schema, the entries of an enum -- and they then look like members of the
    object that owns them. Depth tracking is what separates the two, and it is
    why this cannot be a findall.
    """
    out = []
    i = 0
    n = len(body)
    while i < n:
        c = body[i]
        # Consume whitespace and structural punctuation BEFORE deciding what the
        # next member is. Doing it afterwards means the space after a comma falls
        # through to _skip_value, whose scalar branch scans blindly to the next
        # comma -- swallowing the following key as part of a value. Every member
        # after the first would then be lost, and the scanner would report one
        # key where the object has three.
        if c.isspace() or c in ",}]":
            i += 1
            continue
        if _is_macro_start(body, i):
            i = _skip_macro(body, i)
            continue
        if c == '"':
            j = _skip_string(body, i)
            name = body[i + 1 : j - 1]
            k = j
            while k < n and body[k].isspace():
                k += 1
            if k < n and body[k] == ":":
                k += 1
                while k < n and body[k].isspace():
                    k += 1
                e = _skip_value(body, k)
                out.append((name, body[k:e]))
                i = e
                continue
            # A string that is not a key is a value in its own right.
            out.append((None, body[i:j]))
            i = j
            continue
        i = _skip_value(body, i)
    return out


def function_json_block(text, fn):
    """The inside of the json!({...}) literal that belongs to `fn`.

    Scoped by the enclosing function rather than by position, because these files
    hold more than one json! block and only one of them is the schema set.
    """
    starts = {m.group(1): m.end() for m in FUNC_RE.finditer(text)}
    if fn not in starts:
        return None
    tail = text[starts[fn]:]
    jm = re.search(r"json!\s*\(\s*\{", tail)
    if not jm:
        return None
    return _object_body(tail, tail.index("{", jm.start()))


def spec_schemas(root):
    """name -> set(member) over every schema builder in the published document."""
    out = {}
    for rel, fn in SCHEMA_BUILDERS:
        path = root / rel
        if not path.is_file():
            raise FileNotFoundError(str(path))
        text = path.read_text(encoding="utf-8", errors="replace")
        # Comments go before any scanning, not inside the schema loop: the
        # desync they cause is positional, so a block that starts clean and
        # drifts halfway through is unrecoverable by the time it is noticed.
        text = _strip_rust_comments(text)
        block = function_json_block(text, fn)
        if block is None:
            raise ValueError("no json! block in %s for %s" % (rel, fn))
        for name, schema_text in _top_level_members(block):
            if not schema_text.lstrip().startswith("{"):
                continue
            schema_body = schema_text.lstrip()[1:-1]
            props = None
            for mname, mtext in _top_level_members(schema_body):
                if mname == "properties":
                    props = mtext.lstrip()[1:-1]
                    break
            members = set()
            if props is not None:
                members = {n for n, _ in _top_level_members(props)}
            out.setdefault(name, set()).update(members)
    return out


def ts_types(root):
    """name -> set(member) for every exported interface in types.ts."""
    path = root / TYPES_REL
    if not path.is_file():
        raise FileNotFoundError(str(path))
    text = path.read_text(encoding="utf-8", errors="replace")
    hits = list(TS_TYPE_RE.finditer(text))
    out = {}
    for idx, m in enumerate(hits):
        kind, name = m.group(1), m.group(2)
        end = hits[idx + 1].start() if idx + 1 < len(hits) else len(text)
        # A type alias is a union or a Record alias; there is no member list to
        # grade, so it joins the comparison as a name with no members. Grading it
        # would report every property of an aliased object as invented.
        out[name] = set(TS_MEMBER_RE.findall(text[m.start():end])) if kind == "interface" else set()
    return out


def classify(spec, ts):
    """Compare the names present on both sides and bucket the differences."""
    shared = sorted(set(spec) & set(ts))
    missing, invented = {}, {}
    for name in shared:
        gap = sorted(spec[name] - ts[name])
        extra = sorted(ts[name] - spec[name])
        if gap:
            missing[name] = gap
        if extra:
            invented[name] = extra
    return {
        "shared": shared,
        "missing_member": missing,
        "invented_member": invented,
        "spec_only": sorted(set(spec) - set(ts)),
        "ts_only": sorted(set(ts) - set(spec)),
    }


def self_test():
    """Pure-function cases: no filesystem, so they cannot rot when the tree moves."""
    cases = []

    def keys(src):
        # _top_level_members takes the body INSIDE the braces, which is what
        # _object_body hands back. Given a whole object instead, the scanner
        # consumes the outer pair as one nested value and finds nothing -- which
        # is exactly what the first draft of these cases did, and why a
        # self-test has to prove the contract of its own fixtures.
        return [n for n, _ in _top_level_members(src.strip()[1:-1])]

    cases.append(("top-level keys skip nested ones", keys,
                  '{"a": {"b": {"c": 1}}, "d": [1, 2], "e": "f"}', ["a", "d", "e"]))
    cases.append(("a colon inside a string is not a key", keys,
                  '{"a": "x:y", "b": 1}', ["a", "b"]))
    cases.append(("a comma inside a string does not split", keys,
                  '{"a": "p,q", "b": 2}', ["a", "b"]))
    cases.append(("nested arrays of objects stay nested", keys,
                  '{"a": [{"z": 1}], "b": 2}', ["a", "b"]))
    cases.append(("an escaped quote does not end the string", keys,
                  '{"a": "he said \\\"ok\\\"", "b": 1}', ["a", "b"]))
    cases.append(("function_json_block picks the named function, not the first",
                  lambda src: function_json_block(src, "build_cloud_paths"),
                  'fn build_cloud_schemas() -> Value { json!({ "A": {} }) }\n'
                  'fn build_cloud_paths() -> Value { json!({ "/x": {} }) }',
                  ' "/x": {} '))
    cases.append(("a missing function yields None, not the wrong block",
                  lambda src: function_json_block(src, "build_nope"),
                  'fn build_base_schemas() -> Value { json!({ "A": {} }) }', None))

    bad = 0
    for name, fn, src, want in cases:
        try:
            got = fn(src)
        except ValueError as exc:
            bad += 1
            print("  FAIL " + name + ": raised " + str(exc))
            continue
        if got != want:
            bad += 1
            print("  FAIL " + name + ": expected " + repr(want) + ", got " + repr(got))
        else:
            print("  ok   " + name)

    # classify is a pure function of two dicts, so it needs no fixture files.
    spec = {"Shared": {"a", "b"}, "SpecOnly": {"z"}}
    ts = {"Shared": {"a", "c"}, "TsOnly": {"y"}}
    c = classify(spec, ts)
    want_missing = {"Shared": ["b"]}
    want_invented = {"Shared": ["c"]}
    checks = [
        ("classify finds a member the type dropped", c["missing_member"], want_missing),
        ("classify finds a member the type invented", c["invented_member"], want_invented),
        ("classify reports one-sided names as context", c["spec_only"], ["SpecOnly"]),
        ("classify keeps the shared name list", c["shared"], ["Shared"]),
    ]
    for name, got, want in checks:
        if got != want:
            bad += 1
            print("  FAIL " + name + ": expected " + repr(want) + ", got " + repr(got))
        else:
            print("  ok   " + name)

    total = len(cases) + len(checks)
    if bad:
        print("SELF-TEST FAILED (" + str(bad) + " of " + str(total) + ")")
        return 1
    print("SELF-TEST OK (" + str(total) + " cases, no files touched)")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    root = Path(args.root).resolve()
    try:
        spec = spec_schemas(root)
        ts = ts_types(root)
    except (FileNotFoundError, OSError, ValueError, KeyError) as exc:
        print("error: cannot parse inputs: %s" % exc, file=sys.stderr)
        return 2
    if not spec or not ts:
        print("error: parsed zero schemas or zero types -- an extractor is stale",
              file=sys.stderr)
        return 2
    c = classify(spec, ts)
    missing, invented = c["missing_member"], c["invented_member"]
    total = sum(len(v) for v in missing.values()) + sum(len(v) for v in invented.values())
    if args.json:
        print(json.dumps({
            "spec_schemas": len(spec),
            "ts_types": len(ts),
            "shared": len(c["shared"]),
            "missing_member": missing,
            "invented_member": invented,
            "spec_only": c["spec_only"],
            "ts_only": c["ts_only"],
            "clean": total == 0,
        }, indent=2))
        return 0 if total == 0 else 1
    print("spec schemas  %d, from %s" % (len(spec), ", ".join(r for r, _ in SCHEMA_BUILDERS)))
    print("ts types      %d, from %s" % (len(ts), TYPES_REL))
    print("compared      %d name(s) present on both sides" % len(c["shared"]))
    print("")
    print("  declared on the wire, missing from the type : %d"
          % sum(len(v) for v in missing.values()))
    for name, mem in sorted(missing.items()):
        for m in mem:
            print("    %-24s %s" % (name, m))
    print("  declared in the type, absent from the wire  : %d"
          % sum(len(v) for v in invented.values()))
    for name, mem in sorted(invented.items()):
        for m in mem:
            print("    %-24s %s" % (name, m))
    if args.full:
        print("")
        print("  spec-only names (context, never findings): %s" % ", ".join(c["spec_only"]))
        print("  ts-only names   (context, never findings): %s" % ", ".join(c["ts_only"]))
    print("")
    print("CLEAN: every shared type matches the published schema" if total == 0
          else "DRIFT: %d discrepanc%s" % (total, "y" if total == 1 else "ies"))
    return 0 if total == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
