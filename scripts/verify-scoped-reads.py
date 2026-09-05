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

Comments are stripped before matching. Without that, prose mentioning `getSale()` reads as a call
site -- which is exactly the false positive this script's own first draft produced against a
comment written by the fix that missed the real site.

usage:
    python scripts/verify-scoped-reads.py                # check the tree
    python scripts/verify-scoped-reads.py --self-test    # exercise the classifier
"""
import argparse
import io
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWLIST = os.path.join(REPO, "scripts", "ipc-parity-allowlist.json")

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


def audit(shells, repo=REPO):
    """Return violations: [(shell, command, file, line, snippet), ...]."""
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
    for shell in shells:
        for cmd in allow.get(shell, []):
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
    return violations


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
    violations = audit(shells)
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
