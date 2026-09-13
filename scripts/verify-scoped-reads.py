#!/usr/bin/env python3
"""Fail when production code calls an ambient IPC command that the desktop shell does not register.

WHY THIS EXISTS

`scripts/ipc-parity-allowlist.json` records, per shell, "UI command strings not yet registered in
that shell". The file cannot distinguish two very different situations that look identical in a
list:

  * a wrapper called only from the `else` branch of an ADR #7 conditional, which is dead surface on
    that shell and harmless, and
  * a wrapper called unconditionally, which throws `command not found` at runtime on that shell.

Round 66 found the second case filed as accepted debt: `get_cart_deduction_location` was allowlisted
for desktop while `PosScreen` called it unconditionally, so every desktop sale started with a
stock-target item threw and then reported the already-created cart as a failure. Round 67 found a
second one -- `getSale(result.saleId)` in PaymentModal's shortfall-retry callback -- which had been
missed days earlier by a fix that searched for the literal text `getSale(saleResult.saleId)` and so
never matched the site whose parameter was named `result` instead of `saleResult`. **Two sites, one
bug class, and a literal-string search that looked complete.** That is the gap this gate closes.

HOW IT DECIDES

For each command the allowlist says a shell does not register, find the TS wrapper that invokes it,
find every production call site, and ask whether that call sits in an ADR #7 conditional -- the
established `sessionToken ? xScoped(token, ...) : x(...)` shape (see useProducts.ts). Guarded is
accepted; unguarded is a violation, because the call will run on that shell with no token check.

WHICH ENTRY SHAPES IT READS

An allowlist member is normally a bare command name. scripts/verify-ipc-parity.py -- the gate
that validates and writes that file -- also accepts the object form {"name": ..., "reason": ...}
in the two sections nothing outside it reads, "dev_mock" and "scoped_orphans". This reader takes
both shapes there and the bare shape only in "desktop" and "tablet", because that validator
refuses an object in a shell section and names this script as its reason; the two gates have to
agree about what the file may contain. A member that cannot become a command name fails this
gate with a sentence naming the section, the entry's position and the value found -- never a
traceback, and never a quiet skip.
Comments are stripped before matching. Without that, prose mentioning `getSale()` reads as a call
site -- which is exactly the false positive this script's own first draft produced against a
comment written by the fix that missed the real site.

usage:
    python scripts/verify-scoped-reads.py                # check the tree
    python scripts/verify-scoped-reads.py --self-test    # classifier + entry-shape reader
"""
import argparse
import io
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWLIST = os.path.join(REPO, "scripts", "ipc-parity-allowlist.json")

# WHO DECIDES AN ENTRY SHAPE, written where the rule is read rather than in a commit
# message from whichever lane noticed the drift last.
#
# scripts/ipc-parity-allowlist.json is validated and written by scripts/verify-ipc-parity.py,
# and that file -- not this one -- owns the answer to "may an entry be an object
# {"name": ..., "reason": ...} instead of a bare command name?". Its answer is two tuples:
# OBJECT_ALLOWED_SECTIONS ("dev_mock", "scoped_orphans" -- read by nobody outside that
# script) and EXTERNALLY_READ_SECTIONS ("desktop", "tablet" -- read by this one), and its
# refusal for an object in a shell section names THIS script as the reason. So the policy
# is mirrored below, not reinvented: a member this reader refuses has to be a member that
# validator refuses too, or the two gates disagree about what the file may contain and
# neither says which of them is wrong. If that file ever moves desktop or tablet into the
# allowed tuple, move the tuple below in the same change.
OBJECT_ALLOWED_SECTIONS = ("dev_mock", "scoped_orphans")

# What is NOT delegated to the other gate is the crash. Reading a section used to hand
# every member straight to a dict lookup, so one object member came out as
# "TypeError: cannot use 'dict' as a dict key" after the whole UI tree had been walked --
# no section, no index, no file name, and nothing to tell the operator that a second gate
# had just blessed that exact entry. Both halves live here now: read the shapes a section
# is allowed to hold, and refuse the rest in a sentence. A member is never quietly dropped
# either -- an allowlist entry that stops matching anything turns "clean" into a lie.

# Wrappers are `export const name = (args): Ret => loggedInvoke<T>('cmd', {...});`. The body is an
# arrow, so the pattern must cross `=>`; a character class that excludes `=` cannot, and matching
# nothing would report every entry as clean.
WRAPPER_RE = re.compile(
    r"export const (\w+)[^;]*?loggedInvoke(?:<[^>]*>)?\(\s*'(\w+)'", re.S)

# An ADR #7 conditional: the scoped twin appears before this call, within a few lines.
GUARD_RE = re.compile(
    r"(?:sessionToken|token)\s*\?|\?\s*(?:await\s+)?\w+Scoped\s*\(", re.S)

# The guard is not always a ternary. useTerminalHardware.ts writes it as a statement:
#     if (sessionToken) { await setHardwareSettingsScoped(...) } else { await setHardwareSettings(...) }
# Recognising only `?` flagged that already-correct code as a violation, and a gate whose first
# output includes a false positive gets ignored, which is worse than no gate. A window counts as
# guarded when it both tests a token and reaches a Scoped call -- requiring both keeps the
# catalog-cache shape (a Scoped call beside an untested `token` parameter) flagged, which is
# correct: there the ambient call had no guard at all.
# A token TEST, not merely a token appearing somewhere. The first version allowed a bare `token)`
# which made `listProductsScoped(token)` read as a guard -- the self-test fixture caught it. Each
# alternative here is a real branch condition: an if-test, a ternary, or an explicit comparison.
TOKEN_TEST_RE = re.compile(
    r"\bif\s*\(\s*(?:sessionToken|token)\s*\)"
    r"|\b(?:sessionToken|token)\s*\?"
    r"|\b(?:sessionToken|token)\s*(?:!==|!=|&&|\|\|)")
SCOPED_CALL_RE = re.compile(r"\b\w+Scoped\s*\(")


def _window_is_guarded(window):
    return bool(GUARD_RE.search(window)) or bool(
        TOKEN_TEST_RE.search(window) and SCOPED_CALL_RE.search(window))


def strip_comments(text):
    """Remove // line and /* */ block comments, preserving line numbers with blank fills."""
    out = []
    in_block = False
    for line in text.split("\n"):
        if in_block:
            end = line.find("*/")
            if end == -1:
                out.append("")
                continue
            in_block = False
            line = line[end + 2:]
        # A `//` inside a string literal would be a false strip; the call-site patterns below are
        # code-shaped enough that this simplification costs nothing in practice, and over-stripping
        # is the safe direction (it hides call sites rather than inventing them).
        cut = line.find("//")
        if cut != -1:
            line = line[:cut]
        start = line.find("/*")
        if start != -1:
            end = line.find("*/", start + 2)
            if end == -1:
                in_block = True
                line = line[:start]
            else:
                line = line[:start] + line[end + 2:]
        out.append(line)
    return "\n".join(out)


def find_wrappers(api_dir):
    """command string -> set of wrapper names, from the TS api layer."""
    cmd_to_wrapper = {}
    for root, _dirs, files in os.walk(api_dir):
        for fn in sorted(files):
            if not fn.endswith(".ts"):
                continue
            path = os.path.join(root, fn)
            with io.open(path, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
            for m in WRAPPER_RE.finditer(text):
                cmd_to_wrapper.setdefault(m.group(2), set()).add(m.group(1))
    return cmd_to_wrapper


def production_files(ui_dir):
    files = []
    for root, _dirs, fnames in os.walk(ui_dir):
        if "__tests__" in root or os.path.join("ui", "api") in root.replace("\\", "/"):
            continue
        for fn in fnames:
            if fn.endswith(".ts") or fn.endswith(".tsx"):
                files.append(os.path.join(root, fn))
    return files


# A match is a CALL only if the preceding token is not a declaration keyword. Without this, the
# method definition `async adjustStock(...)` reads as a call to `adjustStock` and the gate reports
# the api layer defining its own wrapper -- a false positive that would train people to distrust a
# gate whose first output is nonsense.
DECL_BEFORE_RE = re.compile(r"(?:\basync|\bfunction|\bpublic\b|\bprivate\b|\bdeclare\b)\s+$")


def _is_call_site(text, start):
    return not DECL_BEFORE_RE.search(text[max(0, start - 24):start])


def allowlist_names(payload, section, problems):
    """The command names in one allowlist section, plus a sentence per member not read.

    Two shapes are in circulation in the file: a bare command name -- the shape every
    section has always used, and still the shape every entry on disk is written in today --
    and the object form {"name": ..., "reason": ...}, accepted by the validator in the two
    sections named in OBJECT_ALLOWED_SECTIONS above. `reason` exists to be read by a human
    and says nothing to this gate, so only `name` is taken out of an object.

    Anything that cannot become a command name is appended to `problems` and skipped in the
    local sense of "not added to the returned list" -- which is why the caller has to fail on
    a non-empty `problems`, and why a refusal here is not the silent drop the docstring warns
    about. Never raises: an unreadable member is a sentence naming the section, the 1-based
    index the file holds it at, and the value that was found.
    """
    filename = os.path.basename(ALLOWLIST)
    members = payload.get(section)
    if members is None:
        return []
    if not isinstance(members, list):
        problems.append(
            f'the "{section}" section of {filename} is a {type(members).__name__}, not a '
            'list of command names, so nothing could be read from it.')
        return []

    names = []
    for index, raw in enumerate(members, 1):
        # 1-based, like the validator's message, so both gates point at the same line of
        # the same file with the same number.
        where = f'entry #{index} of the "{section}" section of {filename}'
        keys = sorted(str(k) for k in raw) if isinstance(raw, dict) else None
        if isinstance(raw, str):
            # Stripped, not verbatim: a name padded with whitespace can never match a
            # wrapper, so reading it as written would keep the entry on the page while it
            # enforced nothing. A blank is still refused, never stripped away.
            if raw.strip():
                names.append(raw.strip())
            else:
                problems.append(
                    f'{where} is blank. An empty command name matches no wrapper, so the '
                    'entry enforces nothing while the gate still prints clean.')
            continue
        if isinstance(raw, dict):
            if section not in OBJECT_ALLOWED_SECTIONS:
                problems.append(
                    f'{where} is an object with keys {keys}, and the "{section}" section '
                    'names one shell whose gaps are audited here. It takes one bare command '
                    'name per entry; "dev_mock" and "scoped_orphans" are the only sections '
                    'scripts/verify-ipc-parity.py lets carry a reason. That validator refuses '
                    'this shape in a shell section too and names this script as its reason, so '
                    'run it to see which of the two gates is wrong.')
                continue
            if "name" not in raw:
                problems.append(
                    f'{where} is an object with no "name" -- found keys {keys}. With no '
                    'command name there is nothing to match against a wrapper, so this entry '
                    'is not enforcing anything.')
                continue
            name = raw["name"]
            if not isinstance(name, str):
                problems.append(
                    f'{where} has a "name" of type {type(name).__name__} ({name!r}) -- not a '
                    'command name, so it cannot match a wrapper.')
                continue
            if not name.strip():
                problems.append(
                    f'{where} has a blank "name" ({name!r}), which matches no wrapper.')
                continue
            names.append(name.strip())
            continue
        # Anything else: a number, a nested list, None. Including 0 and False, which are
        # falsy and would vanish from an `if not raw: continue` guard -- dropped in
        # silence, which is precisely how a policy entry stops enforcing.
        problems.append(
            f'{where} is of type {type(raw).__name__} ({raw!r}) -- not a command name and '
            'not an object carrying one, so it cannot match a wrapper.')
    return names


def audit(shells, repo=REPO):
    """Return (violations, shape_problems).

    violations is [(shell, command, file, line, snippet), ...]; shape_problems is one
    sentence per allowlist member this gate could not turn into a command name. Both have to
    be empty for the gate to pass: an entry that was neither read nor refused is how a
    policy line stops enforcing while the output still says clean.
    """
    with io.open(ALLOWLIST, encoding="utf-8") as fh:
        allow = json.load(fh)
    ui_dir = os.path.join(repo, "ui", "src")
    cmd_to_wrapper = find_wrappers(os.path.join(ui_dir, "api"))
    files = production_files(ui_dir)

    texts = {}
    for p in files:
        with io.open(p, encoding="utf-8", errors="replace") as fh:
            texts[p] = strip_comments(fh.read())

    violations = []
    shape_problems = []
    for shell in shells:
        # Read through allowlist_names so an entry in the object form contributes its
        # command name here instead of reaching the lookup below as a dict.
        for cmd in allowlist_names(allow, shell, shape_problems):
            for wrapper in cmd_to_wrapper.get(cmd, ()):
                pat = re.compile(r"\b" + re.escape(wrapper) + r"\s*\(")
                for path, text in texts.items():
                    for m in pat.finditer(text):
                        if not _is_call_site(text, m.start()):
                            continue
                        upto = text[:m.start()].count("\n")
                        window = "\n".join(text.split("\n")[max(0, upto - 8):upto + 1])
                        if _window_is_guarded(window):
                            continue
                        line = text.split("\n")[upto].strip()
                        rel = os.path.relpath(path, repo).replace("\\", "/")
                        violations.append((shell, cmd, rel, upto + 1, line[:88]))
    return violations, shape_problems


# ── self-test ────────────────────────────────────────────────────────

FIXTURES = [
    # (name, file body, expect_violation)
    ("unguarded ambient call is a violation",
     "const x = async () => {\n  const s = await getSale(id);\n};\n", True),
    ("ADR #7 conditional is accepted",
     "const x = async () => {\n  const s = sessionToken\n    ? await getSaleScoped(sessionToken, id)\n    : await getSale(id);\n};\n",
     False),
    # Proximity to a scoped call does NOT guard anything: these are two independent statements, so
    # the second runs ambient regardless of the first. The first draft of this case expected
    # "accepted" and the classifier correctly disagreed -- a screen that calls the scoped twin for
    # one thing and the ambient one for another is exactly the SalesHistoryScreen shape from item
    # 65, which was a bug, not a pass.
    ("a separate scoped call does not guard this one",
     "const x = async () => {\n  const a = await getSaleScoped(t, id);\n  const b = await getSale(id);\n};\n",
     True),
    ("a comment mentioning the call is not a call site",
     "// getSale() used to be called here\nconst x = async () => {\n  return 1;\n};\n", False),
    ("a comment is stripped even mid-expression",
     "const x = async () => {\n  // await getSale(id);\n  return 1;\n};\n", False),
    ("block comment is stripped",
     "const x = async () => {\n  /* getSale(id) */\n  return 1;\n};\n", False),
    # The if/else statement form of the guard. Missing this made the gate flag
    # useTerminalHardware.ts, which was already correct -- a false positive on a brand-new gate.
    ("if/else token test with a scoped twin is accepted",
     "const x = async () => {\n  if (sessionToken) {\n    await setHardwareSettingsScoped(sessionToken, d);\n  } else {\n    await getSale(id);\n  }\n};\n",
     False),
    # A Scoped call nearby is NOT a guard if nothing tests the token: this is the catalog-cache
    # shape, where `token` is a required parameter and the ambient call simply had no branch.
    ("a scoped call beside an untested token parameter is still a violation",
     "const x = async (token) => {\n  return Promise.all([listProductsScoped(token), getSale(id)]);\n};\n",
     True),
    # A method DEFINITION is not a call. The first version of this gate reported the api layer as
    # violating itself because `async adjustStock(...)` matched the call pattern for `adjustStock`.
    ("a declaration is not a call site",
     "class C {\n  async getSale(id: string) {\n    return 1;\n  }\n}\n", False),
]


# ── allowlist entry-shape cases ──────────────────────────────────────
#
# The happy path is the first two cases: a bare name reads as itself, and an object in a
# section that is allowed to hold one contributes its "name". Case two is the reason this
# block exists -- that member used to reach a dict lookup and abort the gate with
# "TypeError: cannot use 'dict' as a dict key" after the whole UI tree had been parsed,
# with no section, index or file name anywhere in the output.
#
# Everything after them is the inverse case, and it matters more: each must produce ONE
# SENTENCE naming the section, the 1-based position of the member and the value that was
# found. Not a traceback, and not a skip -- an entry dropped quietly reads on screen
# exactly like an entry that was never needed, which is how a policy line stops
# enforcing while the gate still prints clean. `expect` lists substrings that must all
# appear in one problem sentence; None means the case must produce no problem at all.
SHAPE_CASES = [
    # (name, section, members, expect_names, expect)
    ("a bare name is read as itself",
     "desktop", ["get_active_cart_scoped"], ["get_active_cart_scoped"], None),
    ("an object in scoped_orphans yields its name; its reason is ignored",
     "scoped_orphans",
     [{"name": "get_active_cart_scoped", "reason": "host-only, recorded debt"}],
     ["get_active_cart_scoped"], None),
    ("both shapes in one section read through the same path",
     "dev_mock", ["a_scoped", {"name": "b_scoped", "reason": "x"}],
     ["a_scoped", "b_scoped"], None),
    ("an object that grew an extra key still yields its name",
     "scoped_orphans", [{"name": "c_scoped", "reason": "r", "owner": "licensing"}],
     ["c_scoped"], None),
    ("an object in desktop is refused, not read, and the sentence names desktop",
     "desktop", [{"name": "get_active_cart_scoped",
                  "reason": "copied the dev_mock shape"}], [],
     ['"desktop"', "entry #1", "verify-ipc-parity"]),
    ("an object in tablet is refused too -- the two shell sections stay strict",
     "tablet", [{"name": "x_scoped", "reason": "r"}], [], ['"tablet"', "entry #1"]),
    ("an object with no name is a sentence, not a crash and not a skip",
     "scoped_orphans", [{"reason": "orphan"}], [],
     ["entry #1", 'no "name"', "found keys"]),
    ("a name that is not a string is refused with the type and value found",
     "dev_mock", [{"name": 7, "reason": "r"}], [], ['"name"', "int", "7"]),
    ("a blank name is refused rather than stripped into nothing",
     "scoped_orphans", ["   "], [], ["entry #1", "blank"]),
    ("the number zero is refused, not treated as an absent entry",
     "dev_mock", [0], [], ["entry #1", "int", "0"]),
    ("a nested list is refused with the value it found",
     "scoped_orphans", [["a_scoped", "b_scoped"]], [], ["entry #1", "list"]),
    ("a section that is not a list is refused",
     "desktop", {"get_active_cart_scoped": True}, [], ['"desktop"', "dict"]),
    ("the position counts the members that read fine, not only the bad one",
     "dev_mock", ["ok_scoped", {"name": "also_ok_scoped"}, 0],
     ["ok_scoped", "also_ok_scoped"], ["entry #3"]),
]


def _shape_self_test():
    """Run allowlist_names over both shapes and over every way a member can go wrong.

    Kept a separate function but called from self_test(), so CI's blocking
    `--self-test` step cannot pass while the shape reader is broken. It calls the real
    reader, not a copy of it.
    """
    print("  verify-scoped-reads self-test / allowlist entry shapes")
    failures = 0
    for name, section, members, expect_names, expect in SHAPE_CASES:
        problems = []
        names = allowlist_names({section: members}, section, problems)
        ok = names == list(expect_names)
        if ok:
            if expect is None:
                ok = not problems
            else:
                ok = any(all(s in p for s in expect) for p in problems)
        if ok:
            tag = "" if expect is None else "  [refused in a sentence]"
            print(f"    ok   {name}{tag}")
        else:
            print(f"    FAIL {name}")
            print(f"           names read: {names}  expected: {list(expect_names)}")
            for p in problems:
                print(f"           problem: {p}")
            failures += 1
    # Both directions have to have actually happened: a reader that refused every member
    # would pass the refusal cases, and so would one that silently skipped them.
    refused = sum(1 for c in SHAPE_CASES if c[4])
    read = sum(1 for c in SHAPE_CASES if c[3])
    if refused and read:
        print(f"    ok   shape cases read names in {read} and refused in {refused}")
    else:
        print("    FAIL shape cases cover only one direction -- the checks are vacuous")
        failures += 1
    # The file on disk, read for real. Every entry there today is a bare name, so this is
    # the case that fails if a tolerant reader starts inventing a name or losing one.
    with io.open(ALLOWLIST, encoding="utf-8") as fh:
        real = json.load(fh)
    disk_problems = []
    disk_names = disk_members = 0
    for section in ("desktop", "tablet", "dev_mock", "scoped_orphans"):
        members = real.get(section, [])
        disk_names += len(allowlist_names(real, section, disk_problems))
        disk_members += len(members)
    if not disk_problems and disk_names == disk_members and disk_names:
        print(f"    ok   on-disk allowlist: all {disk_names} entries read, no problem")
    else:
        print(f"    FAIL on-disk allowlist: {disk_names}/{disk_members} names read, "
              f"{len(disk_problems)} problem(s)")
        for p in disk_problems:
            print(f"           problem: {p}")
        failures += 1
    # The defended-against crash stays reproducible, so a regression to the raw loop shows
    # up as a live hazard rather than as a fixture that quietly stopped meaning anything.
    crashed = False
    try:
        {}.get({"name": "get_active_cart_scoped", "reason": "r"})
    except TypeError:
        crashed = True
    if crashed:
        print("    ok   an object member still crashes a raw dict lookup")
    else:
        print("    FAIL the lookup this reader defends is no longer a hazard -- suspect")
        print("           the object-form cases before believing the green")
        failures += 1
    return failures


def self_test():
    print("  verify-scoped-reads self-test")
    failures = 0
    for name, body, expect in FIXTURES:
        # Exercise the same predicates audit() uses, so a fix to one cannot silently diverge from
        # the other -- a self-test that reimplements the logic tests its own copy, not the gate.
        stripped = strip_comments(body)
        m = re.search(r"\bgetSale\s*\(", stripped)
        has_call = bool(m) and _is_call_site(stripped, m.start())
        guarded = _window_is_guarded(stripped)
        violation = has_call and not guarded
        ok = (violation == expect)
        # The two "should be accepted" code cases must also prove the guard is what saves them.
        if ok and has_call:
            print(f"    ok   {name}  [call found, guarded={guarded}]")
        else:
            print(f"    {'ok  ' if ok else 'FAIL'} {name}")
        if not ok:
            failures += 1
    # Guard against a vacuous classifier: if nothing ever registers a violation, every check above
    # passes for the wrong reason.
    any_violation = any(
        (lambda s: (lambda m: bool(m) and _is_call_site(s, m.start())
                    and not _window_is_guarded(s))(re.search(r"\bgetSale\s*\(", s)))(strip_comments(b))
        for _n, b, e in FIXTURES if e)
    if not any_violation:
        print("    FAIL classifier can never report a violation -- checks are vacuous")
        failures += 1
    else:
        print("    ok   classifier can report a violation (not vacuous)")
    failures += _shape_self_test()
    print(f"  self-test: {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--shell", default="desktop",
                    help="comma-separated shells to audit (default: desktop)")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    shells = [s.strip() for s in args.shell.split(",") if s.strip()]
    violations, shape_problems = audit(shells)
    if shape_problems:
        # Ahead of the violations, because a member this gate could not read makes every
        # number it then prints -- including a reassuring zero -- a guess about a file it
        # has not actually parsed.
        print(f"FAIL: {len(shape_problems)} member(s) of {os.path.basename(ALLOWLIST)} "
              "this gate could not read:")
        for problem in shape_problems:
            print(f"  {problem}")
        print("\nThis script does not decide which sections may hold an object entry; it",
              "mirrors")
        print("scripts/verify-ipc-parity.py, the gate that validates and writes that file. "
              "Run it:")
        print("  python3 scripts/verify-ipc-parity.py")
        print("If that gate is clean, the entry sits in a section this reader rejects on "
              "purpose:")
        print("\"desktop\" and \"tablet\" stay lists of bare command names, one per gap in "
              "that shell.")
        return 1
    if violations:
        print(f"FAIL: {len(violations)} unguarded ambient IPC call(s):")
        for shell, cmd, path, line, snippet in violations:
            print(f"  [{shell}] {cmd} is not registered in that shell")
            print(f"    {path}:{line}: {snippet}")
        print("\nFix by routing through the scoped twin under the ADR #7 conditional:")
        print("  sessionToken ? await xScoped(sessionToken, ...) : await x(...)")
        print("If the ambient call is genuinely unreachable, remove the allowlist entry instead.")
        return 1
    print(f"verify-scoped-reads: clean for {', '.join(shells)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
