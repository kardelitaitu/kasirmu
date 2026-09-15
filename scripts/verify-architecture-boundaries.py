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

Exit codes:
  0  no new/stale/expired findings (or report-only mode)
  1  new findings, stale baseline entries, or expired baseline entries
  2  malformed metadata, baseline, or unreadable required input
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
    "core-upward-dependency": {"category": "cargo", "severity": "P1", "hint": "Keep oz-core below business modules; move shared contracts/models to a lower layer."},
    "platform-to-business": {"category": "cargo", "severity": "P1", "hint": "Use platform-startup or an application composition root for business-module wiring."},
    "ui-direct-invoke": {"category": "ui", "severity": "P2", "hint": "Route Tauri IPC through ui/src/api or a documented infrastructure adapter."},
    "bridge-toolkit-purity": {"category": "renderer", "severity": "P1", "hint": "Keep crates/oz-bridge toolkit-free (ADR #49): a tauri/gtk/webkit dependency or reference removes the headless seam a second renderer binds to."},
}
BUSINESS_PREFIX = "modules-"
BRIDGE_TOOLKIT_SECTIONS = ("[dependencies]", "[dev-dependencies]", "[build-dependencies]")
BRIDGE_TOOLKIT_PATTERN = re.compile(r"tauri|webkit|gtk", re.IGNORECASE)
ALLOWED_PLATFORM_COMPOSER = "platform-startup"
UI_API_PREFIX = "ui/src/api/"
UI_INFRASTRUCTURE_ADAPTERS = {"ui/src/utils/logged-invoke.ts"}


def configure_streams() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def normalize_path(value: str | Path) -> str:
    return str(value).replace("\\", "/").lstrip("./")


def relative_path(path: Path, root: Path) -> str:
    try:
        return normalize_path(path.resolve().relative_to(root.resolve()))
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
        cache_file = root / "scripts" / "architecture-cargo-metadata.json"
        if cache_file.is_file():
            try:
                return json.loads(cache_file.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                pass
        if result is not None and result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()
            raise ValueError(f"cargo metadata failed ({result.returncode}): {detail}")
        raise ValueError("could not execute cargo metadata and no fallback metadata cache available")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ValueError(f"cargo metadata returned malformed JSON: {exc}") from exc


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


def cargo_findings(metadata: dict[str, Any], root: Path) -> list[dict[str, Any]]:
    packages = metadata.get("packages")
    if not isinstance(packages, list):
        raise ValueError("Cargo metadata has no valid 'packages' list")
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
            dep_path = dependency.get("path")
            if not isinstance(dep_path, str):
                continue
            target = next((package_by_path[key] for key in package_path_keys(dep_path, root) if key in package_by_path), None)
            if target is None or dependency.get("kind") not in (None, "normal"):
                continue
            target_is_business = target.startswith(BUSINESS_PREFIX)
            owner_is_business = owner.startswith(BUSINESS_PREFIX)
            rule = None
            if owner == "oz-core" and target_is_business:
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


def ui_findings(root: Path) -> list[dict[str, Any]]:
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


def bridge_toolkit_findings(root: Path) -> list[dict[str, Any]]:
    """Report UI-toolkit coupling inside `crates/oz-bridge` (ADR #49).

    ADR #49 makes the bridge headless *by dependency*: it carries no `tauri`,
    `gtk`, `webkit2gtk` or `tauri-plugin-*`, so command bodies can be driven
    without a shell and a second renderer can call them directly. That claim is
    currently asserted only in prose and by a comment in the crate itself.

    Comments and string contents are masked before scanning, so the crate's own
    "depends on no tauri, gtk or webkit type" assertions do not self-report.
    A fixture repository without `crates/oz-bridge` yields no findings.
    """
    crate = root / "crates" / "oz-bridge"
    if not crate.is_dir():
        return []
    findings: list[dict[str, Any]] = []
    manifest = crate / "Cargo.toml"
    if manifest.is_file():
        try:
            raw_manifest = manifest.read_text(encoding="utf-8")
        except OSError as exc:
            raise ValueError(f"cannot read bridge manifest: {manifest}: {exc}") from exc
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
        key = normalize_path(entry["rule"]), normalize_path(entry["path"]), entry["target"]
        if key in seen:
            raise ValueError(f"duplicate baseline entry: {key}")
        seen.add(key)
        entry["path"] = normalize_path(entry["path"])
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


def report_human(tracked: list[dict[str, Any]], blocking: list[dict[str, Any]], stale: list[dict[str, Any]], expired: list[dict[str, Any]]) -> None:
    print(f"verify-architecture-boundaries: {len(tracked)} tracked transitional finding(s), {len(blocking)} new/expired blocking finding(s), {len(stale)} stale baseline entry(ies).")
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
    parser.add_argument("--report-only", action="store_true", help="Report findings but do not fail for policy violations.")
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
        baseline = load_baseline(baseline_path, root)
        findings = dedupe_findings(cargo_findings(metadata, root) + ui_findings(root) + bridge_toolkit_findings(root))
        tracked, blocking, stale, expired = apply_baseline(findings, baseline)
    except (ValueError, OSError) as exc:
        return fail(str(exc))
    if args.json:
        print(json.dumps({"tracked_transitional": sort_output(tracked), "new_blocking": sort_output(blocking), "stale_baseline": sort_output(stale), "expired_baseline": sort_output(expired), "summary": {"tracked": len(tracked), "blocking": len(blocking), "stale": len(stale), "expired": len(expired)}}, indent=2, sort_keys=True))
    else:
        report_human(tracked, blocking, stale, expired)
    if args.report_only:
        return 0
    return 1 if blocking or stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
