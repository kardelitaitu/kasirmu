#!/usr/bin/env python3
"""Verify the Dockerfile cache-priming stages cover every workspace member.

DOCKER-09: each Dockerfile (server and unified) manually copies every
workspace member's Cargo.toml into the builder stage to prime the
dependency cache, and creates dummy src dirs so `cargo build -p
kasirmu-cloud` can resolve the whole workspace. If a member is added to
the root Cargo.toml but forgotten in a Dockerfile, the priming build
silently fails (it is best-effort) and the cache layer is dead weight —
every image build then recompiles the full dependency tree.

P2: the unified image (ops/docker/Dockerfile.unified) had drifted from ops/docker/Dockerfile.server
— missing kasirmu-crypto / kasirmu-media (both in cloud-server's dependency graph),
scripts/updater-compat-check (a workspace member cargo must resolve), and
four modules (giftcards/kitchen/promotions/purchasing — not in the
cloud-server graph, but cargo still parses every member manifest). Its
prime stage always failed, so every unified build paid the full compile.

This script parses the workspace `members` list from the root Cargo.toml and
asserts each member's manifest (or the inline dummy fallback for
apps/desktop-tauri and apps/mobile-tauri) is present in EVERY Dockerfile's
cache stage. For the inline dummies it also checks the `printf`-generated
Cargo.toml carries the CURRENT `[workspace.package]` version and edition, so
a version bump cannot silently leave a stale `0.0.34`/`2021` in the cache
stage. A per-file exclusion set allows an image to intentionally omit
members it can still resolve — but the default requires the full list.
Exit code 0 = consistent, 1 = drift.

Usage:
    python scripts/verify-dockerfile-workspace.py
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARGO_TOML = ROOT / "Cargo.toml"

# Dockerfiles to validate, with members they are ALLOWED to omit. Both images
# build `kasirmu-cloud`; currently both carry the full member list so the
# exclusion sets are empty — kept so a future image can intentionally prune
# members without breaking the check.
DOCKERFILES: dict[str, set[str]] = {
    "ops/docker/Dockerfile.server": set(),
    "ops/docker/Dockerfile.unified": set(),
}

# These workspace members are NOT copied as manifests: the cache stage
# synthesizes inline dummy Cargo.tomls for them (they are excluded from the
# Docker build context by .dockerignore), so they are checked separately.
INLINE_DUMMY_MEMBERS = {"apps/desktop-tauri", "apps/mobile-tauri"}

# These workspace members are standalone fuzz workspaces under tools/fuzz/ that
# are NOT part of the cloud-server build and not included in the Docker context.
SKIP_MEMBERS = {"tools/fuzz", "tools/fuzz/hfuzz"}


def workspace_members() -> list[str]:
    text = CARGO_TOML.read_text(encoding="utf-8")
    m = re.search(r"\[workspace\]\s*(.*?)(?:\n\[|\Z)", text, re.S)
    if not m:
        sys.exit("error: could not locate [workspace] section in Cargo.toml")
    body = m.group(1)
    # Match `"crates/kasirmu-core",` lines (trailing comma, CRLF-safe). Only the
    # members list itself — workspace.dependencies entries contain '='.
    raw = [
        x for x in re.findall(r'^\s*"([^"]+)",?\s*$', body, re.M) if "=" not in x
    ]
    # Expand glob patterns (e.g. "crates/*") to actual directory members.
    expanded: list[str] = []
    for pat in raw:
        if '*' in pat or '?' in pat:
            # Use Path.glob on the workspace root to resolve the pattern.
            hits = sorted(
                p.relative_to(ROOT).as_posix()
                for p in ROOT.glob(pat)
                if p.is_dir()
            )
            if hits:
                expanded.extend(hits)
            else:
                expanded.append(pat)
        else:
            expanded.append(pat)
    return sorted(set(expanded))


def workspace_package_value(key: str) -> str:
    """Read a scalar string value from `[workspace.package]` in the root Cargo.toml."""
    text = CARGO_TOML.read_text(encoding="utf-8")
    m = re.search(r"\[workspace\.package\]\s*(.*?)(?:\n\[|\Z)", text, re.S)
    if not m:
        sys.exit("error: could not locate [workspace.package] section in Cargo.toml")
    body = m.group(1)
    km = re.search(rf"^\s*{key}\s*=\s*\"([^\"]+)\"", body, re.M)
    if not km:
        sys.exit(f"error: could not locate workspace.package.{key} in Cargo.toml")
    return km.group(1)


WS_VERSION = workspace_package_value("version")
WS_EDITION = workspace_package_value("edition")


def dockerfile_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def check_dockerfile(name: str, members: list[str]) -> list[str]:
    path = ROOT / name
    if not path.exists():
        return [f"{name}: Dockerfile not found"]
    dockerfile = dockerfile_text(path)
    exclusions = DOCKERFILES.get(name, set())
    errors: list[str] = []

    for member in members:
        if member in SKIP_MEMBERS:
            continue
        if member in exclusions:
            continue
        if member in INLINE_DUMMY_MEMBERS:
            # Inline dummy Cargo.toml is generated for these (printf ...)
            # because their real manifests are excluded from the build context.
            if f"> {member}/src/main.rs" not in dockerfile and f"> {member}/src/lib.rs" not in dockerfile:
                errors.append(
                    f"{name}: {member}: expected inline dummy src in cache stage"
                )
                continue
            # The dummy printf must carry the current workspace version and
            # edition so a bump cannot silently leave a stale cache stage.
            dummy_line = next(
                (l for l in dockerfile.splitlines() if f"> {member}/Cargo.toml" in l),
                None,
            )
            if dummy_line is None:
                errors.append(f"{name}: {member}: expected inline dummy Cargo.toml printf in cache stage")
                continue
            for key, val in (("version", WS_VERSION), ("edition", WS_EDITION)):
                if f"\\n{key} = \"{val}\"" not in dummy_line:
                    errors.append(
                        f"{name}: {member}: inline dummy {key} must be '{val}' "
                        f"(workspace.package) — update the printf line"
                    )
            continue
        if f"COPY {member}/Cargo.toml" not in dockerfile:
            errors.append(f"{name}: missing 'COPY {member}/Cargo.toml' in cache stage")
        if member.startswith("crates/") or member.startswith("modules/") or member.startswith("platform/"):
            src_dir = f"{member}/src"
            if src_dir not in dockerfile:
                errors.append(f"{name}: missing dummy src dir '{src_dir}' in cache stage")

    return errors


def main() -> int:
    members = workspace_members()
    all_errors: list[str] = []

    for name in DOCKERFILES:
        all_errors.extend(check_dockerfile(name, members))

    if all_errors:
        print("DOCKER-09 drift: cache-priming stage is out of sync with Cargo.toml workspace members:")
        for e in all_errors:
            print(f"  - {e}")
        print("Add the member's manifest COPY + dummy src dir to the failing Dockerfile (see DOCKER-09).")
        return 1

    for name in DOCKERFILES:
        print(f"OK: all {len(members)} workspace members are represented in {name}'s cache stage.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
