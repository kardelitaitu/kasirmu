#!/usr/bin/env python3
"""
Verify IPC session-token payload parity: whenever the UI invokes a Tauri
command whose Rust signature requires `session_token`, the invoke payload
must carry a `sessionToken` — otherwise the call dies at Tauri arg
deserialization (or, worse, reaches a command layer with no session).

Why this gate exists (0.0.37, round AC): `ui/src/api/edc.ts` shipped
wrappers that never sent the `session_token` its card-present payment
commands REQUIRE. Latent only because nothing imported them yet — and
invisible to tsc (the wrapper-to-Rust boundary is untyped) and to vitest
(mocked invoke accepts anything). The unregistered-command class is owned
by scripts/verify-ipc-parity.py (F-008/F-050); THIS gate owns the token
class, across BOTH Tauri shells (desktop + tablet share the ui/ front-end,
so a command requiring a token in either shell must receive one from
every caller — union semantics).

Supports --self-test (drives the classifier against a synthetic fixture
tree covering both shells and both failure directions).
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SHELLS = {
    "desktop": (
        REPO_ROOT / "apps" / "desktop-tauri" / "src" / "lib.rs",
        REPO_ROOT / "apps" / "desktop-tauri" / "src" / "commands",
    ),
    "tablet": (
        REPO_ROOT / "apps" / "mobile-tauri" / "src" / "lib.rs",
        REPO_ROOT / "apps" / "mobile-tauri" / "src" / "commands",
    ),
}
API_DIR = REPO_ROOT / "ui" / "src" / "api"

# `commands::audit::list_audit_log_scoped` → "list_audit_log_scoped"
HANDLER_RE = re.compile(r"commands::(?:\w+::)*(\w+)")
# loggedInvoke<T>('cmd', {...}) / loggedInvoke('cmd') — single or double quotes
INVOKE_RE = re.compile(r"loggedInvoke(?:<[^>(]*>)?\(\s*['\"](\w+)['\"]")
# Rust command signature: fn NAME( ... ) -> — capture the parameter region.
# Parameter ORDER varies (some commands take session_token first, some
# last), so the token check reads the whole signature, not the first param.
FN_RE = re.compile(r"pub (?:async )?fn (\w+)\s*\(")


def registered_commands(lib_text: str) -> set[str]:
    """Command fn names listed in a shell's generate_handler![...] block."""
    start = lib_text.find("generate_handler![")
    if start < 0:
        return set()
    end = lib_text.find("]", start)
    if end < 0:
        return set()
    return set(HANDLER_RE.findall(lib_text[start:end]))


def param_requiring_commands(commands_text: str, param: str) -> set[str]:
    """Names of commands whose signature declares the named parameter."""
    names: set[str] = set()
    # The parameter must appear as `name:` at a WORD BOUNDARY, not as a substring.
    # A plain `in` test reads `from_currency: String` as a `currency` parameter --
    # measured 2026-10-26 (round 249): the first draft of the currency class
    # flagged get_latest_exchange_rate_scoped, whose signature takes
    # `from_currency`/`to_currency` and no bare `currency` at all. A gate that
    # invents findings is worse than none, so the name is matched exactly.
    param_re = re.compile(r"(?:^|\n)\s*" + re.escape(param) + r"\s*:")
    for m in FN_RE.finditer(commands_text):
        # Signature = everything from '(' to the first `) ->` (commands all
        # return Result<...>; no nested `) ->` inside a signature).
        close = commands_text.find(") ->", m.end())
        if close < 0:
            continue
        if param_re.search(commands_text[m.end():close]):
            names.add(m.group(1))
    return names


def token_requiring_commands(commands_text: str) -> set[str]:
    """Names of commands whose signature declares `session_token`."""
    return param_requiring_commands(commands_text, "session_token")


def currency_requiring_commands(commands_text: str) -> set[str]:
    """Names of commands whose signature declares `currency`.

    THE SECOND GRADED CLASS, added 2026-10-26 (round 249). The token class exists
    because a payload that omits it dies at Tauri arg deserialization. A currency
    argument fails the opposite way: it deserializes fine, and the command then
    credits or debits a balance denominated in a DIFFERENT currency than the number
    the caller sent. Measured this round: replacing the shell's `&currency` forward
    with an empty string compiled clean and passed every gate, because nothing
    compared the Rust signature to the TypeScript payload.

    Only commands whose signature names `currency` are graded, and only the
    presence of a `currency` key is required -- the VALUE cannot be checked
    statically (it is a runtime variable in almost every caller).
    """
    return param_requiring_commands(commands_text, "currency")


def _payload_text(call_text: str, open_brace: int) -> str:
    """Substring of the balanced { ... } payload starting at open_brace."""
    depth = 0
    in_str = False
    quote = ""
    for i in range(open_brace, len(call_text)):
        ch = call_text[i]
        if in_str:
            if ch == "\\":
                continue  # skip the escape; the next loop pass eats the pair
            if ch == quote:
                in_str = False
            continue
        if ch in ("'", '"', "`"):
            in_str = True
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return call_text[open_brace:i + 1]
    return call_text[open_brace:]  # unbalanced (truncated file) — take the rest


def ui_invokes(api_text: str) -> list[tuple[str, str | None]]:
    """(command, payload-or-None) pairs for every loggedInvoke in the text.

    The payload is the balanced-brace object literal when present; None for
    argless calls. Command names inside template literals are not literals
    we can pin and are skipped by design (INVOKE_RE matches literals only)."""
    out: list[tuple[str, str | None]] = []
    for m in INVOKE_RE.finditer(api_text):
        rest = api_text[m.end():]
        brace = re.search(r"\{", rest)
        paren = rest.find(")")
        if brace is not None and (paren < 0 or brace.start() < paren):
            out.append((m.group(1), _payload_text(rest, brace.start())))
        else:
            out.append((m.group(1), None))
    return out


def run_check(
    shells: dict[str, tuple[Path, Path]],
    api_dir: Path,
    root: Path = REPO_ROOT,
) -> tuple[list[str], int]:
    """Token sweep. Returns (violation lines, checked-invoke count).

    Union semantics: a command requiring `session_token` in ANY shell must
    receive a `sessionToken` payload from every caller."""
    violations: list[str] = []
    token_cmds: set[str] = set()
    currency_cmds: set[str] = set()
    for shell, (lib_path, commands_dir) in shells.items():
        if not lib_path.is_file():
            violations.append(f"lib.rs not found for shell '{shell}': {lib_path}")
            continue
        registered = registered_commands(lib_path.read_text(encoding="utf-8"))
        if not registered:
            violations.append(
                f"generate_handler![...] parsed as empty for shell '{shell}' "
                f"— lib.rs layout changed?"
            )
            continue
        if commands_dir.is_dir():
            # SKIP *_tests.rs: those files embed FAKE command signatures inside
            # string literals (settings_tests.rs asserts on doors by reading their
            # source text), and the signature scanner reads them as real declarations.
            # Measured 2026-10-26 (round 249): without this filter the currency class
            # flagged get_setting/get_setting_scoped from the tablet test file alone.
            #
            # RECURSIVE since 2026-11-06. This was .glob("*.rs"), so a command declared in
            # a SUBDIRECTORY of commands/ was never read and never entered token_cmds or
            # currency_cmds -- 13 of them: the 10 topology commands under
            # apps/desktop-tauri/src/commands/topology/ plus complete_sale_scoped,
            # preview_promoted_total_scoped and preview_promoted_total_from_lines_scoped
            # under the tablet's subdirectories. A caller that dropped sessionToken for
            # load_topology could not be flagged, because the scanner did not know the
            # command takes one. Both classes carry the same union semantics below, so
            # the fix is the glob, not the classifier.
            for rs in sorted(p for p in commands_dir.rglob("*.rs")
                             if not p.name.endswith("_tests.rs")):
                _src = rs.read_text(encoding="utf-8")
                token_cmds |= token_requiring_commands(_src)
                currency_cmds |= currency_requiring_commands(_src)
    if not api_dir.is_dir():
        violations.append(f"api dir not found: {api_dir}")
        return sorted(violations), 0

    checked = 0
    for api_file in sorted(api_dir.glob("*.ts")):
        rel = api_file.relative_to(root).as_posix()
        for cmd, payload in ui_invokes(api_file.read_text(encoding="utf-8")):
            checked += 1
            if cmd in token_cmds and (payload is None or "sessionToken" not in payload):
                violations.append(
                    f"{rel}: loggedInvoke('{cmd}') — the Rust command requires a "
                    f"session_token, but the payload carries no sessionToken; "
                    f"the call fails at Tauri arg deserialization"
                )
            if cmd in currency_cmds and (payload is None or "currency" not in payload):
                violations.append(
                    f"{rel}: loggedInvoke('{cmd}') — the Rust command declares a "
                    f"currency argument, but the payload carries no currency; "
                    f"the command then applies a number quoted in the caller's "
                    f"denomination to a balance stored in another one"
                )

    return sorted(violations), checked


def self_test() -> int:
    """Drive run_check against a synthetic two-shell fixture: the token class
    must be caught in both param orders, satisfied by a nested payload, and
    never fired for a command that does not require a token."""
    failed: list[str] = []

    def check(label: str, got, want) -> bool:
        ok = got == want
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}")
        if not ok:
            print(f"        want {want!r}\n        got  {got!r}")
            failed.append(label)
        return ok

    lib = (
        "tauri::generate_handler![\n"
        "  commands::alpha::alpha_scoped,\n"
        "  commands::beta::beta_plain,\n"
        "  commands::delta::delta_cmd,\n"
        "]"
    )
    # alpha: session_token FIRST; delta: session_token LAST — the signature
    # scan must be param-order independent.
    alpha_rs = "pub async fn alpha_scoped(\n    session_token: String,\n) -> Result<(), AppError> { Ok(()) }"
    delta_rs = "pub async fn delta_cmd(\n    amount: i64,\n    session_token: String,\n) -> Result<(), AppError> { Ok(()) }"
    beta_rs = "pub async fn beta_plain() -> Result<(), AppError> { Ok(()) }"
    good_ts = (
        "const a = loggedInvoke<X>('alpha_scoped', { sessionToken, args: { nested: 1 } });\n"
        "const b = loggedInvoke('beta_plain');\n"
    )
    no_token_ts = "const a = loggedInvoke('alpha_scoped', { amount: 1 });\n"
    late_token_ts = (
        "const d = loggedInvoke('delta_cmd', { nested: { deep: 1 }, sessionToken: 't' });\n"
    )

    def build(api_ts: str):
        td = Path(tempfile.mkdtemp())
        (td / "apps" / "desktop-tauri" / "src" / "commands").mkdir(parents=True)
        (td / "apps" / "mobile-tauri" / "src" / "commands").mkdir(parents=True)
        (td / "apps" / "desktop-tauri" / "src" / "lib.rs").write_text(lib, encoding="utf-8")
        (td / "apps" / "mobile-tauri" / "src" / "lib.rs").write_text(lib, encoding="utf-8")
        dc = td / "apps" / "desktop-tauri" / "src" / "commands"
        tc = td / "apps" / "mobile-tauri" / "src" / "commands"
        for d in (dc, tc):
            (d / "alpha.rs").write_text(alpha_rs, encoding="utf-8")
            (d / "delta.rs").write_text(delta_rs, encoding="utf-8")
            (d / "beta.rs").write_text(beta_rs, encoding="utf-8")
        api = td / "ui" / "api"
        api.mkdir(parents=True)
        (api / "f.ts").write_text(api_ts, encoding="utf-8")
        shells = {
            "desktop": (td / "apps" / "desktop-tauri" / "src" / "lib.rs", dc),
            "tablet": (td / "apps" / "mobile-tauri" / "src" / "lib.rs", tc),
        }
        return shells, api, td

    # ── 1. Clean tree passes ─────────────────────────────────────────
    shells, api, root = build(good_ts)
    v, n = run_check(shells, api, root)
    check("clean tree: zero violations", v, [])
    check("clean tree: 2 invokes checked", n, 2)

    # ── 2. Missing sessionToken is caught ────────────────────────────
    shells, api, root = build(good_ts + no_token_ts)
    v, _ = run_check(shells, api, root)
    check("missing sessionToken detected",
          any("alpha_scoped" in x and "session_token" in x for x in v), True)

    # ── 3. Param-order independence ──────────────────────────────────
    # delta_cmd declares session_token LAST and still requires one.
    shells, api, root = build(late_token_ts.replace("sessionToken: 't'", ""))
    v, _ = run_check(shells, api, root)
    check("token required when session_token is the last param",
          any("delta_cmd" in x and "session_token" in x for x in v), True)

    # ── 4. sessionToken satisfied anywhere in the payload ────────────
    shells, api, root = build(late_token_ts)
    v, _ = run_check(shells, api, root)
    check("sessionToken found inside a nested payload", v, [])

    # ── 5. Argless invoke of a token command is caught ───────────────
    shells, api, root = build("const a = loggedInvoke('alpha_scoped');\n")
    v, _ = run_check(shells, api, root)
    check("argless invoke of token command detected",
          any("alpha_scoped" in x and "session_token" in x for x in v), True)

    # ── 6. Token-free commands are never flagged ─────────────────────
    shells, api, root = build(
        "const b = loggedInvoke('beta_plain', { whatever: 1 });\n")
    v, _ = run_check(shells, api, root)
    check("token-free command with no sessionToken passes", v, [])

    # ── 7. Tablet-only token requirement is caught (union semantics) ─
    td = Path(tempfile.mkdtemp())
    (td / "apps" / "desktop-tauri" / "src" / "commands").mkdir(parents=True)
    (td / "apps" / "mobile-tauri" / "src" / "commands").mkdir(parents=True)
    d_lib = "tauri::generate_handler![\n  commands::beta::beta_plain,\n]"
    t_lib = "tauri::generate_handler![\n  commands::alpha::alpha_scoped,\n]"
    (td / "apps" / "desktop-tauri" / "src" / "lib.rs").write_text(d_lib, encoding="utf-8")
    (td / "apps" / "mobile-tauri" / "src" / "lib.rs").write_text(t_lib, encoding="utf-8")
    (td / "apps" / "desktop-tauri" / "src" / "commands" / "beta.rs").write_text(
        beta_rs, encoding="utf-8")
    (td / "apps" / "mobile-tauri" / "src" / "commands" / "alpha.rs").write_text(
        alpha_rs, encoding="utf-8")
    api = td / "ui" / "api"
    api.mkdir(parents=True)
    (api / "f.ts").write_text(no_token_ts, encoding="utf-8")
    shells = {
        "desktop": (td / "apps" / "desktop-tauri" / "src" / "lib.rs",
                    td / "apps" / "desktop-tauri" / "src" / "commands"),
        "tablet": (td / "apps" / "mobile-tauri" / "src" / "lib.rs",
                   td / "apps" / "mobile-tauri" / "src" / "commands"),
    }
    v, _ = run_check(shells, api, td)
    check("tablet-only token requirement is caught (union)",
          any("alpha_scoped" in x and "session_token" in x for x in v), True)

    # ── 8. The currency class, both directions (round 249) ───────────
    # A command whose signature names `currency` must receive one. This is the
    # class that let a shell drop `&currency` and still compile and pass every
    # gate: the number survives, the denomination does not, and the command
    # credits a balance stored in a different currency.
    td = Path(tempfile.mkdtemp())
    (td / "apps" / "desktop-tauri" / "src" / "commands").mkdir(parents=True)
    (td / "apps" / "mobile-tauri" / "src" / "commands").mkdir(parents=True)
    cur_lib = "tauri::generate_handler![\n  commands::gamma::gamma_topup,\n]"
    gamma_rs = (
        "pub async fn gamma_topup(\n    card: String,\n    amount_minor: i64,\n"
        "    currency: String,\n    session_token: String,\n) -> Result<(), AppError> { Ok(()) }"
    )
    for side in ("desktop-tauri", "mobile-tauri"):
        (td / "apps" / side / "src" / "lib.rs").write_text(cur_lib, encoding="utf-8")
        (td / "apps" / side / "src" / "commands" / "gamma.rs").write_text(
            gamma_rs, encoding="utf-8")
    cur_shells = {
        "desktop": (td / "apps" / "desktop-tauri" / "src" / "lib.rs",
                    td / "apps" / "desktop-tauri" / "src" / "commands"),
        "tablet": (td / "apps" / "mobile-tauri" / "src" / "lib.rs",
                   td / "apps" / "mobile-tauri" / "src" / "commands"),
    }

    def cur_build(api_ts: str):
        # The api dir must live INSIDE the fixture root: run_check reports
        # paths with relative_to(root), so a second mkdtemp() raises ValueError
        # instead of grading anything.
        api = td / "ui" / "api"
        api.mkdir(parents=True, exist_ok=True)
        (api / "g.ts").write_text(api_ts, encoding="utf-8")
        return api

    api = cur_build(
        "const g = loggedInvoke('gamma_topup', { card: 'C1', amountMinor: 1, "
        "currency: 'IDR', sessionToken: 't' });\n")
    v, _ = run_check(cur_shells, api, td)
    check("currency command with a currency payload passes", v, [])

    api = cur_build(
        "const g = loggedInvoke('gamma_topup', { card: 'C1', amountMinor: 1, "
        "sessionToken: 't' });\n")
    v, _ = run_check(cur_shells, api, td)
    check("missing currency detected",
          any("gamma_topup" in x and "currency" in x for x in v), True)
    # ── 9. A command declared in a SUBDIRECTORY is scanned ───────────
    # Measured 2026-11-06: the sweep read commands_dir.glob("*.rs"), so 13 real
    # commands (10 desktop topology + 3 tablet subdirectory) were invisible to both
    # classes. Without the rglob this case passes silently, which is exactly the
    # failure mode: a caller may drop sessionToken for a command the scanner never saw.
    td = Path(tempfile.mkdtemp())
    for side in ("desktop-tauri", "mobile-tauri"):
        nested = td / "apps" / side / "src" / "commands" / "topology"
        nested.mkdir(parents=True)
        (td / "apps" / side / "src" / "lib.rs").write_text(
            "tauri::generate_handler![\n  commands::topology::nested_cmd,\n]",
            encoding="utf-8")
        (nested / "deep.rs").write_text(alpha_rs, encoding="utf-8")
    api = td / "ui" / "api"
    api.mkdir(parents=True)
    (api / "n.ts").write_text(
        "const a = loggedInvoke('alpha_scoped', { amount: 1 });\n", encoding="utf-8")
    nested_shells = {
        "desktop": (td / "apps" / "desktop-tauri" / "src" / "lib.rs",
                    td / "apps" / "desktop-tauri" / "src" / "commands"),
        "tablet": (td / "apps" / "mobile-tauri" / "src" / "lib.rs",
                   td / "apps" / "mobile-tauri" / "src" / "commands"),
    }
    v, _ = run_check(nested_shells, api, td)
    check("a command under commands/<subdir>/ is scanned",
          any("alpha_scoped" in x and "session_token" in x for x in v), True)

    print()
    if failed:
        print(f"  {len(failed)} self-test case(s) FAILED:")
        for f in failed:
            print(f"    {f}")
        return 1
    print("  all self-test cases passed")
    return 0


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    parser = argparse.ArgumentParser(
        description=(
            "Verify IPC session-token payload parity: every loggedInvoke of a "
            "session_token-requiring command must carry a sessionToken payload."
        )
    )
    parser.add_argument(
        "--self-test", action="store_true",
        help="Run the synthetic-fixture self-test and exit.")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    violations, checked = run_check(SHELLS, API_DIR)
    print(
        f"verify-invoke-parity: {checked} invoke(s) across "
        f"{len(list(API_DIR.glob('*.ts')))} api file(s), "
        f"{len(SHELLS)} shell(s)."
    )
    if violations:
        print(f"verify-invoke-parity: {len(violations)} violation(s):")
        for v in violations:
            print(f"  {v}")
        return 1
    print("verify-invoke-parity: 0 violation(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
