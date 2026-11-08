#!/usr/bin/env python3
r"""
scripts/verify-plugin-guide-parity.py — Catch plugin-guide drift against
the implemented plugin API (PLG-10 recommendation).

WHY
===

`docs/plugin-guide.md` historically advertised APIs that were never
implemented: `oz.api_version`, `oz.get_setting`, `oz.get_product`,
`oz.get_cart`, `oz.calc_line_tax`, plus `cargo run -p kasirmu-cli --
run-script` / `validate-plugins`. Developers built against nonexistent
surfaces and received misleading instructions. PLG-10 recommended adding
"a documentation/API parity check that compares documented bindings and
CLI commands with source registration" — this script is that check.

It verifies, in both directions:

  1. **Documented → implemented:** every `oz.<name>` binding named in the
     guide's `oz` Global Table + Legacy Hooks sections must be registered
     in `crates/kasirmu-plugin/src/manager.rs` (`oz.set("...")`) or listed in
     `LuaRuntime::LEGACY_HOOK_NAMES` in `crates/kasirmu-lua/src/lib.rs`.
     A documented-but-missing binding fails the gate.

  2. **Implemented → documented:** every binding registered in
     `manager.rs` / `LEGACY_HOOK_NAMES` should appear in the guide
     (so a future binding ships with docs). Reported, but NOT a gate
     failure — the gate is fail-closed on *aspirational* docs, the
     expensive direction, while missing-doc is informational.

  3. **CLI commands:** any `cargo run -p kasirmu-cli -- <cmd>` line in the
     guide must reference a real subcommand in
     `crates/kasirmu-cli/src/cli.rs` (the `Command` enum). Also, the two
     historic phantom commands (`run-script`, `validate-plugins`) are
     explicitly forbidden.

USAGE
=====

    python3 scripts/verify-plugin-guide-parity.py          # strict: exit 1 on drift
    python3 scripts/verify-plugin-guide-parity.py --report-only   # always exit 0

EXIT CODES
==========

  * 0  no drift: every documented binding/CLI command is implemented.
  * 1  at least one documented binding or CLI command is not implemented
        (or a phantom command is documented).
  * 2  a runtime error occurred (expected source files missing).

LIMITATIONS
===========

  * Extracts `oz.<name>` tokens from the guide with a regex; a doc prose
    mention of a binding outside the API tables is still caught (good —
    over-detection is the safe direction), and it can only ever flag
    *missing implementations*, never a *wrongly documented* signature.
  * CLI subcommands are matched by their enum-variant name; kebab-case
    variants (e.g. `InitDb`) are compared case-insensitively.
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _paths(root=None) -> dict:
    """Every evidence source, all five derived from ONE base (r178).

    The five used to be module constants. That made a partial redirect easy
    in exactly the r172 way: a helper left on a constant grades the real
    tree while its siblings grade the fixture, and no single look catches
    it. One function returning all five means a new source joins the
    redirect by construction.
    """
    base = ROOT if root is None else Path(root).resolve()
    # CICD-04 lineage: the guide lives under docs/guides/ (mdBook layout) —
    # the historical docs/plugin-guide.md path made this gate fail-closed
    # with "guide not found" on every run after the doc tree was reorganized.
    return {
        "guide": base / "docs" / "guides" / "developer" / "plugin-guide.md",
        "manager": base / "crates" / "kasirmu-plugin" / "src" / "manager.rs",
        "lua": base / "crates" / "kasirmu-lua" / "src" / "lib.rs",
        "cli": base / "crates" / "kasirmu-cli" / "src" / "cli.rs",
        # The CLI's own README is the second place a subcommand name is written
        # down. It is the more load-bearing of the two: it carries a table of
        # every command and its arguments, so a row naming a command that does
        # not exist sends a reader straight to a clap error.
        "readme": base / "crates" / "kasirmu-cli" / "README.md",
    }

# `oz.<name>` tokens anywhere in the guide (over-detection is safe).
OZ_TOKEN = re.compile(r"\boz\.([a-z][a-z0-9_]*)\b")
# Registered bindings in the manager: oz.set("name", ...)
OZ_SET = re.compile(r'oz\.set\("([a-z][a-z0-9_]*)",')
# Legacy hook names: LEGACY_HOOK_NAMES: &[&str] = &["a", "b", ...];
# Extracted by finding the `LEGACY_HOOK_NAMES` declaration and pulling
# every quoted string on its line(s) up to the closing `]`. `[^\n]` (not
# `[^\]]`) is deliberate: the declaration itself contains `&[&str]`, so
# a negated-`]` class would stop at the wrong bracket.
LEGACY_HEAD = re.compile(r"LEGACY_HOOK_NAMES\b[^\n]*?=\s*&\s*\[")
# CLI subcommands documented in the guide: `cargo run -p kasirmu-cli -- name`
CLI_DOC = re.compile(r"cargo run -p kasirmu-cli --\s+([a-z][a-z0-9-]*)", re.I)
# …and in the crate README's command table, written as `kasir <name>`.
CLI_README_DOC = re.compile(r"\bkasir ([a-z][a-z0-9-]*)\b")
# Phantom commands that historically never existed and must not return.
PHANTOM_CLI = {"run-script", "validate-plugins"}

DESCRIPTION = (
    "Verify every oz.* binding and kasirmu-cli subcommand documented in "
    "docs/guides/developer/plugin-guide.md is actually implemented in the Rust source. "
    "See the module docstring for rationale."
)


def self_test() -> int:
    """Liveness for the four PARSERS, which is the leg nothing else here covers.

    This gate runs in dev-ci and check.sh and had no test of any kind. Every claim it
    makes is a REGEX match, and its failure direction is the quiet one: if OZ_SET stops
    matching, implemented_bindings() returns an empty oz set, and "implemented but not
    documented" then has nothing to complain about -- the gate reports parity on a
    plugin crate whose entire binding table it is no longer reading. The same holds
    for OZ_TOKEN on the guide side. Nothing else in the job would notice.

    The first four cases are PURE: a regex that cannot match its own planted text is
    not a regex that works. The last is a live floor, the same shape check-env-docs
    uses -- it is the only part that touches the tree, and it exists because a
    perfectly-matched regex against an empty file still measures nothing.

    Proven by mutation: pointing OZ_SET at a pattern that cannot match turns case 2
    red. The parser cases are pure; the r178 shell cases write only under a
    tempdir, never a repo file.
    """
    bad: list[str] = []

    def want(name: str, got, expect) -> None:
        if got != expect:
            bad.append(f"{name}: expected {expect!r}, got {got!r}")

    want("OZ_TOKEN finds a planted table token",
         [m.group(1) for m in OZ_TOKEN.finditer("| `oz.discount_apply` | yes |")],
         ["discount_apply"])
    want("OZ_SET finds a planted registration",
         [m.group(1) for m in OZ_SET.finditer('oz.set("promo_lookup", "k");')],
         ["promo_lookup"])
    want("LEGACY_HEAD finds a planted hook list",
         bool(LEGACY_HEAD.finditer("const LEGACY_HOOK_NAMES: &[&str] = &[\n")), True)
    want("CLI_DOC finds a planted subcommand",
         [m.group(1) for m in CLI_DOC.finditer("cargo run -p kasirmu-cli -- migrate")],
         ["migrate"])

    # Live floor: on THIS tree the parsers must find something. A regex can match a
    # planted string perfectly and still read an empty or renamed file as nothing.
    oz, legacy = implemented_bindings()
    if not (oz or legacy):
        bad.append("live floor: implemented_bindings() found no bindings at all")
    if not documented_bindings():
        bad.append("live floor: documented_bindings() found nothing in the guide")

    # r178: main()'s shell -- argv and root graded against a tempdir fixture
    # carrying all five evidence sources, the r166..r177 pattern. main's exit
    # mapping (0 / 1 / 2 and --report-only) is what the parser cases above
    # never reach.
    import contextlib as _ctxlib
    import io as _io
    import tempfile as _tempfile
    def _shell(files, argv=None):
        with _tempfile.TemporaryDirectory() as td:
            base = Path(td)
            for rel, content in files.items():
                dst = base / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding="utf-8")
            out, err = _io.StringIO(), _io.StringIO()
            with _ctxlib.redirect_stdout(out), _ctxlib.redirect_stderr(err):
                rc = main(argv=[] if argv is None else argv, root=base)
            return rc, out.getvalue() + err.getvalue()
    GUIDE_REL = str(Path("docs") / "guides" / "developer" / "plugin-guide.md")
    MANAGER_REL = str(Path("crates") / "kasirmu-plugin" / "src" / "manager.rs")
    LUA_REL = str(Path("crates") / "kasirmu-lua" / "src" / "lib.rs")
    CLI_REL = str(Path("crates") / "kasirmu-cli" / "src" / "cli.rs")
    README_REL = str(Path("crates") / "kasirmu-cli" / "README.md")
    # SYNTHETIC names throughout: a fixture that mirrors the real bindings
    # would survive a root-dropping mutant, which would find the same names
    # in the real tree. The corpus must contain nothing the real tree has.
    FULL = {
        GUIDE_REL: "oz.fixture_binding is documented.\n"
                   "fixture_legacy_hook runs on checkout.\n"
                   "cargo run -p kasirmu-cli -- fixture-cmd\n",
        MANAGER_REL: 'oz.set("fixture_binding", "k");\n',
        LUA_REL: 'const LEGACY_HOOK_NAMES: &[&str] = &["fixture_legacy_hook"];\n',
        CLI_REL: "enum Command {\n    FixtureCmd,\n}\n",
        README_REL: "| kasir fixture-cmd | run it |\n",
    }
    rc, text = _shell(FULL)
    if rc != 0 or "0 drift item(s)" not in text:
        bad.append(f"full parity must exit 0 (rc={rc} text={text[-120:]!r})")
    rc, text = _shell({**FULL, GUIDE_REL: FULL[GUIDE_REL] + "oz.never_impl\n"})
    if rc != 1 or "MISSING" not in text or "oz.never_impl" not in text:
        bad.append(f"a documented-but-missing binding must exit 1 naming it (rc={rc} text={text[-120:]!r})")
    rc, text = _shell({**FULL, GUIDE_REL: FULL[GUIDE_REL] + "cargo run -p kasirmu-cli -- run-script\n"})
    if rc != 1 or "PHANTOM" not in text:
        bad.append(f"a phantom command must exit 1 (rc={rc} text={text[-120:]!r})")
    with _tempfile.TemporaryDirectory() as td:
        out, err = _io.StringIO(), _io.StringIO()
        with _ctxlib.redirect_stdout(out), _ctxlib.redirect_stderr(err):
            rc = main(argv=[], root=td)
        if rc != 2 or "guide not found" not in (out.getvalue() + err.getvalue()):
            bad.append(f"a missing guide must refuse with exit 2 (rc={rc})")
    rc, text = _shell({**FULL, GUIDE_REL: FULL[GUIDE_REL] + "oz.never_impl\n"},
                      argv=["--report-only"])
    if rc != 0 or "1 drift item(s)" not in text:
        bad.append(f"--report-only must report drift yet exit 0 (rc={rc} text={text[-120:]!r})")

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (6 parser cases + 5 shell cases, no repo files touched)")
    return 0


def documented_bindings(root=None) -> set[str]:
    """Return every binding named in the guide.

    The `oz` Global Table rows are `oz.<name>` tokens; the legacy-hook
    table lists bare function names (`apply_discount`, ...). Both count as
    documented so the informational "implemented but not documented" leg
    does not false-positive on the legacy table.
    """
    text = _paths(root)["guide"].read_text(encoding="utf-8")
    oz_tokens = {m.group(1) for m in OZ_TOKEN.finditer(text)}
    # Legacy hooks are documented as bare names — accept them if they are
    # one of the names the source declares (they live under "Legacy
    # top-level hooks" in the guide).
    _, legacy = implemented_bindings(root)
    legacy_mentioned = {name for name in legacy if re.search(rf"\b{re.escape(name)}\b", text)}
    return oz_tokens | legacy_mentioned


def implemented_bindings(root=None) -> tuple[set[str], set[str]]:
    """Return (oz-table bindings, legacy hook names) actually registered."""
    paths = _paths(root)
    oz = set()
    if paths["manager"].exists():
        oz.update(m.group(1) for m in OZ_SET.finditer(paths["manager"].read_text(encoding="utf-8")))
    legacy: set[str] = set()
    if paths["lua"].exists():
        text = paths["lua"].read_text(encoding="utf-8")
        # Walk past `LEGACY_HOOK_NAMES ... &[` and collect strings until `]`.
        for head in LEGACY_HEAD.finditer(text):
            tail = text[head.end():]
            end = tail.find("]")
            if end == -1:
                continue
            legacy.update(
                part.strip().strip('"')
                for part in tail[:end].split(",")
                if part.strip()
            )
    return oz, legacy


def _kebab(name: str) -> str:
    """CamelCase enum variant -> the kebab-case name clap actually exposes.

    Comparing a lowercase-unkebabed `InitDb` against a documented `init-db`
    reports a phantom on every multi-word subcommand. That mismatch was latent
    while the plugin guide documented none of them; it becomes live the moment
    any doc names a multi-word command.
    """
    return re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()


def documented_cli(root=None) -> set[str]:
    paths = _paths(root)
    found = set()
    if paths["guide"].exists():
        text = paths["guide"].read_text(encoding="utf-8")
        found |= {m.group(1).lower() for m in CLI_DOC.finditer(text)}
    if paths["readme"].exists():
        text = paths["readme"].read_text(encoding="utf-8")
        found |= {m.group(1).lower() for m in CLI_README_DOC.finditer(text)}
    return found


def implemented_cli(root=None) -> set[str]:
    cli = _paths(root)["cli"]
    if not cli.exists():
        return set()
    text = cli.read_text(encoding="utf-8")
    return {_kebab(m.group(1)) for m in re.finditer(r"^\s{4}([A-Z][A-Za-z0-9]*)\s*,?", text, re.M)}


def main(argv=None, root=None) -> int:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="Always exit 0; print the report and return. Useful for "
             "human-readable summaries without failing CI.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run this checker's parser cases and exit.",
    )
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    paths = _paths(root)
    if not paths["guide"].exists():
        print(f"error: guide not found: {paths['guide']}", file=sys.stderr)
        return 2

    documented = documented_bindings(root)
    oz_impl, legacy_impl = implemented_bindings(root)
    implemented = oz_impl | legacy_impl
    cli_documented = documented_cli(root)
    cli_impl = implemented_cli(root)

    # 1. Documented → implemented (the gate direction).
    missing = sorted(documented - implemented)
    # 2. Implemented → documented (informational; NOT a gate failure).
    undocumented = sorted(implemented - documented)
    # 3. CLI commands.
    missing_cli = sorted(cli_documented - cli_impl - PHANTOM_CLI)
    phantom = sorted(cli_documented & PHANTOM_CLI)

    print(
        f"verify-plugin-guide-parity: guide documents {len(documented)} "
        f"oz.* binding(s); source registers {len(oz_impl)} table binding(s) "
        f"+ {len(legacy_impl)} legacy hook(s)."
    )
    print(f"  guide documents {len(cli_documented)} kasirmu-cli subcommand(s); "
          f"source defines {len(cli_impl)} subcommand(s).")
    print()

    if missing:
        print(f"  MISSING (documented but not implemented) — {len(missing)}:")
        for name in missing:
            print(f"    oz.{name}")
        print()
    if missing_cli:
        print(f"  MISSING CLI (documented but not implemented) — {len(missing_cli)}:")
        for name in missing_cli:
            print(f"    kasirmu-cli {name}")
        print()
    if phantom:
        print(f"  PHANTOM CLI (documented but must never exist) — {len(phantom)}:")
        for name in phantom:
            print(f"    kasirmu-cli {name}")
        print()
    if undocumented:
        print(
            f"  note: {len(undocumented)} binding(s) implemented but not "
            f"mentioned in the guide (informational):"
        )
        for name in sorted(undocumented):
            print(f"    oz.{name}")
        print()

    problems = len(missing) + len(missing_cli) + len(phantom)
    print(f"verify-plugin-guide-parity: {problems} drift item(s).")
    return 0 if (args.report_only or problems == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
