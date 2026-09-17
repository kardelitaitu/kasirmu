#!/usr/bin/env python3
"""Verify documented Cargo and frontend architecture boundaries.

The checker is intentionally static and report-oriented. Existing transitional
architecture debt is listed in ``scripts/architecture-boundaries-baseline.json``
and remains visible, while new findings, expired entries, and stale baseline
entries fail the normal gate.

Usage::

    python3 scripts/verify-architecture-boundaries.py
    python3 scripts/verify-architecture-boundaries.py --report-only
    python3 scripts/verify-architecture-boundaries.py --strict
    python3 scripts/verify-architecture-boundaries.py --json
    python3 scripts/verify-architecture-boundaries.py --root <path>
    python3 scripts/verify-architecture-boundaries.py --metadata-file <path>

Exit codes -- and why 0 alone is not a verdict:
  0  three different facts produce this code: the checker DID NOT RUN against
     the tree you meant (a --root pointing somewhere with nothing in it), it
     RAN AND FOUND NOTHING TO REPORT, or it RAN AND WAS TOLD NOT TO JUDGE
     (--report-only). No exit code distinguishes those three, and by design
     this one does not try to; the printed line does, because it now carries
     the population it examined and, under --report-only, the words NOT
     JUDGING.
  1  new findings, stale baseline entries, or expired baseline entries
  2  malformed metadata, baseline, or unreadable required input

WHAT THE GREEN LINE NAMES
=========================

The line used to print three counts and nothing else, and every one of them was
a FINDING count -- tracked, blocking, stale. Those measure debt, not scope. So
"0 new/expired blocking finding(s)" was equally true of a run that graded this
workspace and of a run whose --root pointed at a directory holding no crates, no
ui/src and no crates/kasirmu-bridge. That second run is a supported mode, not a
corruption: --root is a documented flag above, and the node suite in
scripts/__tests__/verify-architecture-boundaries.test.mjs already reaches fixture
scope another way -- it copies this script into the fixture directory and passes
--metadata-file, so the empty population is the intended shape of every test in
that file. --strict is not a scope control either (it is parsed and never read).
The lanes that run this gate are whatever
`grep -ln verify-architecture-boundaries.py scripts/run-pre-push.py
scripts/check.sh scripts/check.ps1 .github/workflows/*.yml` names, and none of
them passes --root, so all of them print a real denominator. The line therefore
now
ends in a denominator built by the same walks that produced the findings -- see
new_scope() and the "scope" argument every walker takes -- not by a second glob
beside them, because a denominator computed on a separate path is a denominator
that can drift from the scan it claims to describe. "2 crates / 0 blockers" and
"0 crates / 0 blockers" now read differently, and --json carries the same
numbers under the "population" and "judging" keys.

KNOWN LIMIT -- A REAL REPO CAN PRESENT AS A FIXTURE
===================================================

An empty population is INTENDED here and stays intended: the walker docstrings
say a fixture repository without crates/kasirmu-bridge yields no findings, and
--root / --metadata-file exist precisely so synthetic trees can be graded -- and
the node suite named above is made of nothing else. So this file deliberately has
NO empty-population floor: adding one would fail the fixture runs that are this
checker's own tests, which is a different tool's fix and not this one's. What remains, and what
no exit code can close, is narrower: a run that means to grade this repository
and instead lands on a directory that presents as a fixture is indistinguishable
from a real fixture run by exit code alone. The caller's check is the printed
denominator, stated as an action: run the command, read the
"[population examined: ...]" clause, and confirm it names the tree you meant.
Re-derive the expected numbers
rather than trusting anything written here. The crate count is the number of
PACKAGES the graph names, not the number of directories under `crates/` (this
workspace also carries `modules/`, `platform/`, `foundation/` and app crates),
so re-derive it with the same request the checker makes: `cargo metadata --no-deps
--format-version 1 | python -c "import json,sys; print(len(json.load(sys.stdin)
['packages']))"`. For the UI half use `find ui/src -name '*.ts' -o -name '*.tsx'
| wc -l` and remember the printed number is lower, because the rule skips
`ui/src/api/` and the test/mock trees. Zero crates examined with exit 0 means the
scope was empty; it does not mean the boundaries held.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any

RULES = {
    "module-to-module": {"category": "cargo", "severity": "P1", "hint": "Move composition to an application/platform boundary or depend on a shared contract."},
    "core-upward-dependency": {"category": "cargo", "severity": "P1", "hint": "Keep kasirmu-core below business modules; move shared contracts/models to a lower layer."},
    "platform-to-business": {"category": "cargo", "severity": "P1", "hint": "Use platform-startup or an application composition root for business-module wiring."},
    "ui-direct-invoke": {"category": "ui", "severity": "P2", "hint": "Route Tauri IPC through ui/src/api or a documented infrastructure adapter."},
    "bridge-toolkit-purity": {"category": "renderer", "severity": "P1", "hint": "Keep crates/kasirmu-bridge toolkit-free (ADR #49): a tauri/gtk/webkit dependency or reference removes the headless seam a second renderer binds to."},
    "ui-framework-vocabulary": {"category": "renderer", "severity": "P2", "hint": "Keep renderer vocabulary out of app-layer prose (ADR #53): cite the caller by its role, not by its .tsx/.css filename."},
}
BUSINESS_PREFIX = "modules-"
BRIDGE_TOOLKIT_SECTIONS = ("[dependencies]", "[dev-dependencies]", "[build-dependencies]")
BRIDGE_TOOLKIT_PATTERN = re.compile(r"tauri|webkit|gtk", re.IGNORECASE)
ALLOWED_PLATFORM_COMPOSER = "platform-startup"
UI_API_PREFIX = "ui/src/api/"
UI_INFRASTRUCTURE_ADAPTERS = {"ui/src/utils/logged-invoke.ts"}
# ADR #53: a Rust char literal, as opposed to a lifetime (`&'a str`). Needed so the
# comment-preserving mask does not open a fake string at a lifetime's apostrophe.
CHAR_LITERAL_PATTERN = re.compile(r"'(?:\\.|[^\\'])'")
# ADR #53: the application layer may not name a renderer or its file formats in
# prose. Case-sensitive on purpose -- `\bReact\b` must not fire on the domain verb
# `reactivate`, and `.tsx`/`.css` are lowercase in every citation this tree holds.
UI_VOCABULARY_ROOTS = ("crates", "modules", "platform", "foundation")
UI_VOCABULARY_PATTERN = re.compile(r"\bReact\b|\.tsx|\.css|component to render")


def configure_streams() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def normalize_path(value: str | Path) -> str:
    """Portably slash a path WITHOUT destroying the marker that says where it lives.

    The previous body ended in .lstrip("./"), which removes a leading RUN of any
    of the "." and "/" characters. That is right for "./x" and wrong for
    everything else: "../x" became "x", and "/abs/x" became "abs/x". Eating the
    "../" is how a manifest living in a sibling checkout (the multi-root layout,
    <base>/0.0.35/oz-pos/...) printed AS IF it were a repo-relative path, so a
    foreign-worktree finding was rendered indistinguishable from a local one and
    an absolute path arriving from cached cargo metadata lost its leading slash
    too. Only an explicit "./" prefix is trimmed now.
    """
    text = str(value).replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    return text


def relative_path(path: Path, root: Path) -> str:
    """THE canonical form for a path, used on BOTH sides of the baseline key.

    Under the root: repo-relative posix. Not under it (another checkout, a bare
    absolute path, an entry recorded with a prefix): the honest "../"-relative
    form, so out-of-tree debt stays addressable instead of silently acquiring a
    fake repo-relative spelling. This is equality on a normalized path and never
    a substring or suffix test: two paths match only when they name the same file
    from the same root, so a suppression recorded in one checkout cannot silence
    a finding computed in another, and an escaped "../" path cannot collide with
    a repo-relative entry in either direction.
    """
    try:
        resolved_root = root.resolve()
    except OSError:
        resolved_root = root
    try:
        resolved = path.resolve()
    except OSError:
        resolved = path
    try:
        return normalize_path(resolved.relative_to(resolved_root))
    except ValueError:
        pass
    try:
        return normalize_path(Path(os.path.relpath(resolved, resolved_root)))
    except ValueError:
        return normalize_path(path)


def fail(message: str) -> int:
    print(f"verify-architecture-boundaries: error: {message}", file=sys.stderr)
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


def resolve_cargo() -> str:
    found = shutil.which("cargo")
    if found:
        return found
    cargo_home = Path(os.environ.get("USERPROFILE", "")) / ".cargo" / "bin" / "cargo.exe"
    if cargo_home.exists():
        return str(cargo_home)
    return "cargo"


def metadata_from_cargo(root: Path) -> dict[str, Any]:
    cargo_cmd = resolve_cargo()
    manifest_path = (root / "Cargo.toml").resolve()
    cmd = [cargo_cmd, "metadata", "--manifest-path", str(manifest_path), "--no-deps", "--format-version", "1"]
    result = None
    try:
        result = subprocess.run(cmd, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
    except OSError:
        pass
    if result is None or result.returncode != 0:
        # No implicit fallback, deliberately. scripts/architecture-cargo-metadata.json
        # is one machine's COMMITTED build graph - it records workspace_root
        # C:/dev/ozpos/0.0.35/oz-pos, a different checkout - so reading it after a
        # transient cargo failure scored this tree against that repository, which is
        # how eight live baseline entries once printed as stale with nothing in the
        # repo changed. A graph is a request, not a substitution: --metadata-file is
        # unchanged and remains the supported way to supply one (the harness uses it).
        # The root comparison shipped at 55ff480d5 was deleted WITH this route, which is
        # the only reason that deletion was safe: a check on a path nobody can walk
        # advertises protection that cannot fire. It is now restored, on every route in
        # -- see check_graph_root() -- because the explicit --metadata-file route stayed
        # reachable and unchecked, and an unchanged tree then scored 8 new blocking plus
        # 8 stale off a committed graph whose workspace_root names a nested sibling.
        if result is None:
            raise ValueError(
                "could not execute cargo metadata: no Cargo graph is available and this"
                " checker does not substitute a cached one. Install cargo or pass"
                " --metadata-file <path> explicitly."
            )
        detail = (result.stderr or result.stdout).strip().splitlines()
        reason = detail[0] if detail else "no diagnostics from cargo"
        raise ValueError(
            f"cargo metadata failed ({result.returncode}): {reason}; no Cargo graph is"
            " available and this checker does not substitute a cached one. Repair cargo"
            " or pass --metadata-file <path> explicitly (the test harness supplies"
            " fixture graphs that way)."
        )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ValueError(f"cargo metadata returned malformed JSON: {exc}") from exc


def check_graph_root(metadata: dict[str, Any], root: Path) -> None:
    """Refuse a graph that declares a workspace_root other than the tree being scored.

    The same act as the implicit cached-graph fallback that 95ad42ea2 removed: a
    request to score a tree is not a licence to score another one. Compared on
    EQUALITY of resolved roots, never containment, because this repo documents a
    multi-root layout whose release checkouts sit INSIDE the workspace root
    (<base>/0.0.35/oz-pos), so a sibling checkout's manifests render as plausible
    repo-relative findings with no "../" in them and relative_path() never sees an
    escape. A graph that declares no workspace_root is accepted: nothing was
    declared to disagree with. --metadata-file stays the supported route for
    synthetic trees built under a fixture directory, whose declared root is that
    directory.
    """
    declared = metadata.get("workspace_root")
    if not isinstance(declared, str) or not declared.strip():
        return
    want = str(Path(declared).resolve())
    have = str(root.resolve())
    if os.path.normcase(want) != os.path.normcase(have):
        raise ValueError(
            f"refusing to score {have} with a graph that declares workspace_root {want}: a"
            " graph describing another checkout cannot score this one. This is the same act as"
            " the implicit fallback that was removed -- a request is not a licence to score the"
            " wrong tree -- so it is checked on every route in, including this one."
            " Containment is not agreement: release checkouts are nested inside this root,"
            " which is how a sibling's paths read as repo-relative with no \"..\" marker in"
            " them. Regenerate the graph for the tree you mean (cargo metadata --no-deps"
            " --format-version 1) or pass --root at the checkout the graph describes; the"
            " fixture route is for synthetic trees built under a fixture directory."
        )


def package_path_keys(path: str, root: Path) -> set[str]:
    raw = Path(path)
    candidates = {normalize_path(path), normalize_path(raw)}
    try:
        resolved = (raw if raw.is_absolute() else root / raw).resolve()
        candidates.update({
            normalize_path(resolved),
            normalize_path(resolved / "Cargo.toml"),
            normalize_path(resolved.parent),
            normalize_path(resolved.parent / "Cargo.toml"),
        })
    except OSError:
        pass
    return candidates


def cargo_findings(metadata: dict[str, Any], root: Path, scope: dict[str, int]) -> list[dict[str, Any]]:
    packages = metadata.get("packages")
    if not isinstance(packages, list):
        raise ValueError("Cargo metadata has no valid 'packages' list")
    # The Cargo half of the population: crates the graph names, and the
    # dependency edges actually followed between them. An empty graph and a graph
    # with no violation produce the same "0 blocking" without this.
    scope["crates"] += len(packages)
    package_by_path: dict[str, str] = {}
    package_manifest: dict[str, str] = {}
    for package in packages:
        if not isinstance(package, dict) or not isinstance(package.get("name"), str):
            raise ValueError("Cargo metadata contains an invalid package entry")
        manifest = package.get("manifest_path")
        if not isinstance(manifest, str):
            raise ValueError(f"Cargo metadata package {package['name']} has no manifest_path")
        package_by_path.update({key: package["name"] for key in package_path_keys(manifest, root)})
        package_manifest[package["name"]] = relative_path(Path(manifest), root)
    findings: list[dict[str, Any]] = []
    for package in packages:
        owner = package["name"]
        dependencies = package.get("dependencies", [])
        if not isinstance(dependencies, list):
            raise ValueError(f"Cargo metadata package {owner} has invalid dependencies")
        for dependency in dependencies:
            if not isinstance(dependency, dict):
                raise ValueError(f"Cargo metadata package {owner} has invalid dependency")
            scope["dep_edges"] += 1
            dep_path = dependency.get("path")
            if not isinstance(dep_path, str):
                continue
            target = next((package_by_path[key] for key in package_path_keys(dep_path, root) if key in package_by_path), None)
            if target is None or dependency.get("kind") not in (None, "normal"):
                continue
            target_is_business = target.startswith(BUSINESS_PREFIX)
            owner_is_business = owner.startswith(BUSINESS_PREFIX)
            rule = None
            # Spelled once, not as an `oz-core`/`kasirmu-core` pair: the package has
            # been named `kasirmu-core` since the Tier-3 rename and every graph this
            # gate accepts now comes from `cargo metadata` on this tree (the tracked
            # `scripts/architecture-cargo-metadata.json` snapshot is no longer a
            # fallback -- see `metadata_from_cargo`). A second spelling that no input
            # can produce is a branch nothing exercises, i.e. a rule that would go
            # unfelt the day it silently stopped matching.
            if owner == "kasirmu-core" and target_is_business:
                rule = "core-upward-dependency"
            elif owner_is_business and target_is_business:
                rule = "module-to-module"
            elif owner.startswith("platform-") and target_is_business and owner != ALLOWED_PLATFORM_COMPOSER:
                rule = "platform-to-business"
            if rule:
                findings.append(make_finding(rule, package_manifest[owner], target, None))
    return dedupe_findings(findings)


def mask_comments_and_strings(text: str) -> str:
    """Mask comments and string contents while preserving offsets and lines."""
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
        if char in ("'", '"', "`"):
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


def strip_comments_preserving_strings(text: str) -> str:
    """Remove comments while retaining string contents and line offsets."""
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
            out.append(char)
            if char == "\\" and i + 1 < len(text):
                out.append(text[i + 1])
                i += 2
                continue
            if char == in_string:
                in_string = None
            i += 1
            continue
        if char in ("'", '"', "`"):
            in_string = char
            out.append(char)
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


def mask_code_preserving_comments(text: str) -> str:
    """Mask code and string contents while preserving comments and lines.

    The inverse of `mask_comments_and_strings`, which blanks comments so a
    code-scanning rule cannot see prose. This one blanks everything *except* the
    prose, because `ui-framework-vocabulary`'s subject is the comment layer — a
    rule graded through the masking helper would be measuring the layer the mask
    keeps, which is how ADR #53's Option A first arrived with a zero that meant
    nothing (see that record's Correction section).

    Two differences from the masking helper, both load-bearing. Block comments
    nest in Rust, so depth is counted rather than a boolean toggled. And a `'`
    is treated as a char literal only when it closes within one character, so a
    lifetime (`&'static str`) does not open a string that swallows the rest of
    the file and hides every comment after it.
    """
    out: list[str] = []
    i = 0
    in_string: str | None = None
    in_block = 0
    while i < len(text):
        char = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if in_block:
            if char == "/" and nxt == "*":
                in_block += 1
                out.extend("  ")
                i += 2
            elif char == "*" and nxt == "/":
                in_block -= 1
                out.extend("  ")
                i += 2
            else:
                out.append(char)
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
        if char == "/" and nxt == "/":
            while i < len(text) and text[i] != "\n":
                out.append(text[i])
                i += 1
            continue
        if char == "/" and nxt == "*":
            in_block = 1
            out.extend("  ")
            i += 2
            continue
        if char in ('"', "`"):
            in_string = char
            out.append(" ")
            i += 1
            continue
        if char == "'":
            literal = CHAR_LITERAL_PATTERN.match(text, i)
            if literal:
                out.extend(" " * (literal.end() - i))
                i = literal.end()
            else:
                out.append(" ")
                i += 1
            continue
        out.append("\n" if char == "\n" else " ")
        i += 1
    return "".join(out)


def invoke_callable_names(raw: str) -> set[str]:
    """Return direct, aliased, and namespace-qualified invoke call names."""
    import_code = strip_comments_preserving_strings(raw)
    names: set[str] = set()
    direct_import = re.search(
        r"import\s*\{([^}]*)\}\s*from\s*['\"]@tauri-apps/api/core['\"]",
        import_code,
        re.DOTALL,
    )
    if direct_import:
        for item in direct_import.group(1).split(","):
            match = re.search(r"\binvoke\b(?:\s+as\s+([A-Za-z_$][\w$]*))?", item)
            if match:
                names.add(match.group(1) or "invoke")
    for namespace in re.finditer(
        r"import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*['\"]@tauri-apps/api/core['\"]",
        import_code,
    ):
        names.add(f"{namespace.group(1)}.invoke")
    # UpdateBanner dynamically imports the Tauri core API before login. Treat
    # only a destructured `invoke` from that module as an approved direct call.
    if re.search(
        r"\{[^}]*\binvoke\b[^}]*\}\s*=\s*await\s+import\s*\(\s*['\"]@tauri-apps/api/core['\"]\s*\)",
        import_code,
        re.DOTALL,
    ):
        names.add("invoke")
    return names


def find_invoke_calls(raw: str) -> list[tuple[int, str]]:
    """Return (line, target) for executable direct invoke calls."""
    code = mask_comments_and_strings(raw)
    names = sorted(invoke_callable_names(raw), key=len, reverse=True)
    calls: list[tuple[int, str]] = []
    if not names:
        return calls
    callable_pattern = "|".join(re.escape(name) for name in names)
    call_re = re.compile(
        rf"(?<![\w$])(?:{callable_pattern})(?:\s*<[^;()\n]*>)?\s*\("
    )
    for match in call_re.finditer(code):
        open_paren = code.find("(", match.start(), match.end())
        raw_pos = open_paren + 1
        while raw_pos < len(raw) and raw[raw_pos].isspace():
            raw_pos += 1
        target = "<dynamic>"
        if raw_pos < len(raw) and raw[raw_pos] in ("'", '"'):
            quote = raw[raw_pos]
            end = raw_pos + 1
            while end < len(raw) and raw[end] != quote:
                if raw[end] == "\\":
                    end += 1
                end += 1
            if end < len(raw):
                target = raw[raw_pos + 1 : end]
        calls.append((raw.count("\n", 0, match.start()) + 1, target))
    return calls


def ui_findings(root: Path, scope: dict[str, int]) -> list[dict[str, Any]]:
    ui_root = root / "ui" / "src"
    if not ui_root.is_dir():
        raise ValueError(f"UI source directory not found: {ui_root}")
    findings: list[dict[str, Any]] = []
    for path in sorted(ui_root.rglob("*.ts")) + sorted(ui_root.rglob("*.tsx")):
        rel = relative_path(path, root)
        if rel.startswith(UI_API_PREFIX) or rel in UI_INFRASTRUCTURE_ADAPTERS:
            continue
        if {"__tests__", "__mocks__", "dev-mock"} & set(path.parts) or ".test." in path.name or ".spec." in path.name:
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise ValueError(f"cannot read UI source: {path}: {exc}") from exc
        # Counted after the skip filters on purpose: this is how many files the
        # rule actually opened, not how many the glob could see.
        scope["ui_files"] += 1
        calls = find_invoke_calls(raw)
        for line, target in calls:
            findings.append(make_finding("ui-direct-invoke", rel, target, line))
        if not calls and invoke_callable_names(raw):
            import_code = strip_comments_preserving_strings(raw)
            import_match = re.search(
                r"(?:import\s*\{[^}]*\binvoke\b[^}]*\}\s*from\s*['\"]@tauri-apps/api/core['\"]|"
                r"import\s*\*\s*as\s+\w+\s*from\s*['\"]@tauri-apps/api/core['\"]|"
                r"\{[^}]*\binvoke\b[^}]*\}\s*=\s*await\s+import\s*\(\s*['\"]@tauri-apps/api/core['\"]\s*\))",
                import_code,
                re.DOTALL,
            )
            if import_match:
                findings.append(
                    make_finding(
                        "ui-direct-invoke",
                        rel,
                        "<import>",
                        import_code.count("\n", 0, import_match.start()) + 1,
                    )
                )
    return dedupe_findings(findings)


def bridge_toolkit_findings(root: Path, scope: dict[str, int]) -> list[dict[str, Any]]:
    """Report UI-toolkit coupling inside `crates/kasirmu-bridge` (ADR #49).

    ADR #49 makes the bridge headless *by dependency*: it carries no `tauri`,
    `gtk`, `webkit2gtk` or `tauri-plugin-*`, so command bodies can be driven
    without a shell and a second renderer can call them directly. That claim is
    currently asserted only in prose and by a comment in the crate itself.

    Comments and string contents are masked before scanning, so the crate's own
    "depends on no tauri, gtk or webkit type" assertions do not self-report.
    A fixture repository without `crates/kasirmu-bridge` yields no findings, and says so:
    the run's "[population examined: ...]" clause reports 0 bridge files scanned
    rather than staying silent about the absence.
    """
    crate = root / "crates" / "kasirmu-bridge"
    if not crate.is_dir():
        # Intended fixture behaviour, and now visible rather than implied: this
        # walk examined no file, which the green line prints as zero.
        return []
    findings: list[dict[str, Any]] = []
    manifest = crate / "Cargo.toml"
    if manifest.is_file():
        try:
            raw_manifest = manifest.read_text(encoding="utf-8")
        except OSError as exc:
            raise ValueError(f"cannot read bridge manifest: {manifest}: {exc}") from exc
        scope["bridge_files"] += 1
        section = ""
        for number, line in enumerate(raw_manifest.splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("["):
                section = stripped
                continue
            if section not in BRIDGE_TOOLKIT_SECTIONS:
                continue
            key = re.match(r"[\"']?([A-Za-z0-9_.\-]+)[\"']?\s*=", stripped)
            if not key:
                continue
            match = BRIDGE_TOOLKIT_PATTERN.search(key.group(1))
            if match:
                findings.append(make_finding("bridge-toolkit-purity", relative_path(manifest, root), f"{key.group(1)} ({section})", number))
    for path in sorted((crate / "src").rglob("*.rs")):
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise ValueError(f"cannot read bridge source: {path}: {exc}") from exc
        scope["bridge_files"] += 1
        code = mask_comments_and_strings(raw)
        for match in BRIDGE_TOOLKIT_PATTERN.finditer(code):
            findings.append(
                make_finding(
                    "bridge-toolkit-purity",
                    relative_path(path, root),
                    match.group(0).lower(),
                    code.count("\n", 0, match.start()) + 1,
                )
            )
    return dedupe_findings(findings)


def ui_vocabulary_findings(root: Path, scope: dict[str, int]) -> list[dict[str, Any]]:
    """Report UI-framework vocabulary in the application layer's comments (ADR #53).

    The application layer may not name a renderer or its file formats in prose.
    `crates/`, `modules/`, `platform/` and `foundation/` are renderer-agnostic by
    design: the stated goal is that the UI is replaceable, and a doc comment that
    says "the React component renders this" or cites `Foo.tsx:120` binds the
    layer's reasoning to one renderer and rots the moment that file moves.

    Scanned through `mask_code_preserving_comments`, so string literals are
    invisible. That is deliberate and is the rule's one known gap: a test-side
    extension array (`.css`, `.tsx`) and the twelve `.tsx` evidence citations in
    `platform/sync/src/queue_tests.rs` are string literals, and flagging an
    extension list would be a false positive.

    A fixture repository without any of the four roots yields no findings, which
    the green line prints as "0 app-layer .rs file(s) scanned across 0/4 root(s)"
    instead of hiding behind a zero blocking count.
    """
    findings: list[dict[str, Any]] = []
    for top in UI_VOCABULARY_ROOTS:
        base = root / top
        if not base.is_dir():
            continue
        scope["app_layer_roots"] += 1
        for path in sorted(base.rglob("*.rs")):
            try:
                raw = path.read_text(encoding="utf-8")
            except OSError as exc:
                raise ValueError(f"cannot read application-layer source: {path}: {exc}") from exc
            scope["app_layer_files"] += 1
            comments = mask_code_preserving_comments(raw)
            for match in UI_VOCABULARY_PATTERN.finditer(comments):
                findings.append(
                    make_finding(
                        "ui-framework-vocabulary",
                        relative_path(path, root),
                        match.group(0),
                        comments.count("\n", 0, match.start()) + 1,
                    )
                )
    return dedupe_findings(findings)


def make_finding(rule: str, path: str, target: str, line: int | None) -> dict[str, Any]:
    policy = RULES[rule]
    return {"rule": rule, "category": policy["category"], "severity": policy["severity"], "path": normalize_path(path), "line": line, "target": target, "baseline_status": "new", "remediation": policy["hint"]}


def finding_key(finding: dict[str, Any]) -> tuple[str, str, str]:
    return finding["rule"], finding["path"], finding["target"]


def dedupe_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[tuple[str, str, str], dict[str, Any]] = {}
    for finding in findings:
        key = finding_key(finding)
        if key not in unique or (unique[key]["line"] is None and finding["line"] is not None):
            unique[key] = finding
    return sorted(unique.values(), key=lambda f: (f["rule"], f["path"], f["target"], f["line"] or 0))


def load_baseline(path: Path, root: Path) -> list[dict[str, Any]]:
    data = load_json(path, "architecture boundary baseline")
    entries = data.get("entries") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        raise ValueError("architecture boundary baseline must contain an 'entries' list")
    seen: set[tuple[str, str, str]] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("baseline entries must be objects")
        for field in ("rule", "path", "target", "reason", "owner", "introduced", "expires"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise ValueError(f"baseline entry missing non-empty '{field}'")
        if entry["rule"] not in RULES:
            raise ValueError(f"baseline entry has unknown rule '{entry['rule']}'")
        try:
            introduced = date.fromisoformat(entry["introduced"])
            expires = date.fromisoformat(entry["expires"])
        except ValueError as exc:
            raise ValueError(f"baseline entry has invalid date: {entry}") from exc
        if introduced > expires:
            raise ValueError(f"baseline entry introduced date is after expiry: {entry}")
        if introduced > date.today():
            raise ValueError(f"baseline entry introduced date is in the future: {entry}")
        # Canonicalize FIRST, then key. The recorded entry and the freshly
        # computed finding must pass through the same function, or a suppression
        # spelled against one checkout stops matching a finding computed from
        # another and every live entry reads stale at once.
        entry["path"] = relative_path(root / normalize_path(entry["path"]), root)
        key = entry["rule"], entry["path"], entry["target"]
        if key in seen:
            raise ValueError(f"duplicate baseline entry: {key}")
        seen.add(key)
        # A missing source is handled as a stale baseline entry (exit 1), not
        # as malformed checker input (exit 2), so debt removal is visible and
        # actionable rather than reported as an infrastructure failure.
    return entries


def apply_baseline(findings: list[dict[str, Any]], baseline: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    today = date.today()
    baseline_by_key = {(e["rule"], e["path"], e["target"]): e for e in baseline}
    matched: set[tuple[str, str, str]] = set()
    tracked: list[dict[str, Any]] = []
    blocking: list[dict[str, Any]] = []
    expired: list[dict[str, Any]] = []
    for finding in findings:
        key = finding_key(finding)
        entry = baseline_by_key.get(key)
        if entry is None:
            blocking.append(finding)
        else:
            matched.add(key)
            if today > date.fromisoformat(entry["expires"]):
                finding["baseline_status"] = "expired"
                expired.append(finding)
                blocking.append(finding)
            else:
                finding["baseline_status"] = "tracked"
                finding["baseline_entry"] = entry
                tracked.append(finding)
    stale: list[dict[str, Any]] = []
    for entry in baseline:
        key = entry["rule"], entry["path"], entry["target"]
        if key not in matched:
            stale.append({"rule": entry["rule"], "category": RULES[entry["rule"]]["category"], "severity": RULES[entry["rule"]]["severity"], "path": entry["path"], "line": None, "target": entry["target"], "baseline_status": "stale", "remediation": "Remove or update the baseline entry after confirming the debt is gone.", "baseline_entry": entry})
    return tracked, blocking, stale, expired


def sort_output(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(items, key=lambda item: (item.get("rule", ""), item.get("path", ""), item.get("target", "")))


def new_scope() -> dict[str, int]:
    """An empty census, filled IN by the walkers as they walk.

    It is threaded through the existing walks instead of computed by a second
    glob beside them: a denominator that re-derives the scope on its own is a
    denominator that can disagree with the scan it is meant to describe.
    """
    return {
        "crates": 0,
        "dep_edges": 0,
        "ui_files": 0,
        "bridge_files": 0,
        "app_layer_roots": 0,
        "app_layer_files": 0,
        "baseline_entries": 0,
    }


def population_clause(scope: dict[str, int]) -> str:
    """The denominator half of the green line.

    All three finding counts can be zero while the scope is zero too, which is
    what --root on an empty directory produces. Printing the population is what
    makes that visible without this tool taking an exit code away from a mode
    (fixtures) that legitimately has nothing to find.
    """
    return (
        f" [population examined: {scope['crates']} crate(s) in the Cargo graph, "
        f"{scope['dep_edges']} dependency edge(s) followed, "
        f"{scope['ui_files']} UI file(s) scanned, "
        f"{scope['bridge_files']} crates/kasirmu-bridge file(s) scanned, "
        f"{scope['app_layer_files']} app-layer .rs file(s) scanned across "
        f"{scope['app_layer_roots']}/{len(UI_VOCABULARY_ROOTS)} root(s), "
        f"{scope['baseline_entries']} baseline entry(ies)]"
    )


def report_human(
    tracked: list[dict[str, Any]],
    blocking: list[dict[str, Any]],
    stale: list[dict[str, Any]],
    expired: list[dict[str, Any]],
    scope: dict[str, int],
    report_only: bool = False,
) -> None:
    # Byte-stable head: lanes and the node suite grep
    # "... N tracked transitional finding(s), M new/expired blocking finding(s)"
    # out of this line. Everything appended after it is scope, not verdict.
    line = (
        f"verify-architecture-boundaries: {len(tracked)} tracked transitional finding(s), "
        f"{len(blocking)} new/expired blocking finding(s), "
        f"{len(stale)} stale baseline entry(ies)"
        + population_clause(scope)
        + "."
    )
    if report_only:
        # The third green: 0 here means "told not to judge", not "clean". Say so
        # in the same line, because the exit code is not going to say it.
        line += " NOT JUDGING: --report-only suppresses the verdict; this run's exit 0 is not a pass."
    print(line)
    if tracked:
        print("\nTracked transitional findings:")
        for finding in sort_output(tracked):
            location = f":{finding['line']}" if finding["line"] else ""
            print(f"  [tracked] {finding['rule']} {finding['path']}{location} -> {finding['target']}")
    if blocking:
        print("\nNew blocking findings:")
        for finding in sort_output(blocking):
            location = f":{finding['line']}" if finding["line"] else ""
            print(f"  [{finding['baseline_status']}] {finding['rule']} {finding['path']}{location} -> {finding['target']}")
            print(f"           {finding['remediation']}")
    if stale:
        print("\nStale baseline entries:")
        for finding in sort_output(stale):
            print(f"  [stale] {finding['rule']} {finding['path']} -> {finding['target']}")
    if expired:
        print(f"\nExpired baseline findings: {len(expired)}")


def main() -> int:
    configure_streams()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-only", action="store_true", help="Report findings but do not fail for policy violations. The printed line then says NOT JUDGING, because its exit 0 is not a pass.")
    parser.add_argument("--strict", action="store_true", help="Explicitly enforce the default blocking policy.")
    parser.add_argument("--json", action="store_true", help="Emit stable JSON instead of human-readable output.")
    parser.add_argument("--root", type=Path, help="Repository root (defaults to the script's repository root).")
    parser.add_argument("--metadata-file", type=Path, help="Cargo metadata JSON fixture instead of running cargo metadata.")
    parser.add_argument("--baseline-file", type=Path, help="Baseline JSON path (defaults to <root>/scripts/architecture-boundaries-baseline.json).")
    args = parser.parse_args()
    root = (args.root or Path(__file__).resolve().parent.parent).resolve()
    baseline_path = (args.baseline_file or root / "scripts" / "architecture-boundaries-baseline.json").resolve()
    metadata_path = args.metadata_file.resolve() if args.metadata_file else None
    try:
        metadata = load_json(metadata_path, "Cargo metadata fixture") if metadata_path else metadata_from_cargo(root)
        check_graph_root(metadata, root)  # every route in, not only the deleted implicit one
        baseline = load_baseline(baseline_path, root)
        scope = new_scope()
        findings = dedupe_findings(
            cargo_findings(metadata, root, scope)
            + ui_findings(root, scope)
            + bridge_toolkit_findings(root, scope)
            + ui_vocabulary_findings(root, scope)
        )
        scope["baseline_entries"] = len(baseline)
        tracked, blocking, stale, expired = apply_baseline(findings, baseline)
    except (ValueError, OSError) as exc:
        return fail(str(exc))
    if args.json:
        # Same two facts the human line now carries, in machine form: the
        # findings, and what was examined to produce them. "judging": false is
        # the report-only case a log parser can no longer read off the exit code.
        print(json.dumps({"tracked_transitional": sort_output(tracked), "new_blocking": sort_output(blocking), "stale_baseline": sort_output(stale), "expired_baseline": sort_output(expired), "summary": {"tracked": len(tracked), "blocking": len(blocking), "stale": len(stale), "expired": len(expired)}, "population": scope, "judging": not args.report_only}, indent=2, sort_keys=True))
    else:
        report_human(tracked, blocking, stale, expired, scope, args.report_only)
    if args.report_only:
        return 0
    return 1 if blocking or stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
