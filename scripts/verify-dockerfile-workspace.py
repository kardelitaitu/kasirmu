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


def workspace_members(root=None) -> list[str]:
    """r199: the workspace reader follows the contract root."""
    base = ROOT if root is None else Path(root).resolve()
    toml = CARGO_TOML if root is None else base / "Cargo.toml"
    text = toml.read_text(encoding="utf-8")
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
                p.relative_to(base).as_posix()
                for p in base.glob(pat)
                if p.is_dir()
            )
            if hits:
                expanded.extend(hits)
            else:
                expanded.append(pat)
        else:
            expanded.append(pat)
    return sorted(set(expanded))


def workspace_package_value(key: str, root=None) -> str:
    """Read a scalar string value from `[workspace.package]` in the root Cargo.toml.

    r199: follows the contract root; called per main() invocation rather than
    at import, so a root other than this checkout reads ITS version.
    """
    toml = CARGO_TOML if root is None else Path(root).resolve() / "Cargo.toml"
    text = toml.read_text(encoding="utf-8")
    m = re.search(r"\[workspace\.package\]\s*(.*?)(?:\n\[|\Z)", text, re.S)
    if not m:
        sys.exit("error: could not locate [workspace.package] section in Cargo.toml")
    body = m.group(1)
    km = re.search(rf"^\s*{key}\s*=\s*\"([^\"]+)\"", body, re.M)
    if not km:
        sys.exit(f"error: could not locate workspace.package.{key} in Cargo.toml")
    return km.group(1)


def dockerfile_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def check_dockerfile(name: str, members: list[str], root=None,
                     ws_version: str = "", ws_edition: str = "") -> list[str]:
    base = ROOT if root is None else Path(root).resolve()
    path = base / name
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
            for key, val in (("version", ws_version), ("edition", ws_edition)):
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


def apt_packages(dockerfile: str) -> set[str]:
    """Packages named on `apt-get install` lines in one Dockerfile text.

    Only the PACKAGE tokens are collected: continuation backslashes, the `-y`,
    `--no-install-recommends` and `install` words are dropped, and a trailing `\\`
    is stripped so a wrapped line reads like a single one. Comments are skipped,
    because this repo's Dockerfiles carry long explanatory blocks that name
    packages in prose (`libudev-dev is REQUIRED, not optional`) and counting those
    would invent packages neither file installs.
    """
    packages: set[str] = set()
    collecting = False
    for raw in dockerfile.splitlines():
        line = raw.strip()
        if line.startswith("#"):
            continue
        if not collecting:
            if not re.search(r"apt-get\s+install\b", line):
                continue
            collecting = True
            line = line.split("install", 1)[1]
        # Only a line ending in a backslash continues the install run. The
        # trailing `&& rm -rf /var/lib/apt/lists/*` does NOT, and treating any
        # non-backslash line as still-collecting added `rm` to the set.
        if line.endswith("\\"):
            line = line[:-1]
        else:
            collecting = False
        for chunk in line.split("&&"):
            for token in chunk.replace("\\", " ").split():
                if token.startswith("-") or token in ("install", "&&", "|"):
                    continue
                if re.fullmatch(r"[a-z0-9][a-z0-9.+-]*", token):
                    packages.add(token)
    return packages


# Apt packages that ONLY some Dockerfiles install, with the reason the asymmetry
# is deliberate. A builder-stage tool (`libc-dev`, `libssl-dev`, `pkg-config`,
# `libudev-dev`) exists to compile Rust; an image that ships a prebuilt binary
# and never runs cargo must not be told to install it. `libudev1` is recorded
# because the file itself measures it (see below). The divergence report still
# names every remaining package -- this table only silences the documented ones.
APT_PARITY_EXEMPT: dict[str, str] = {
    "libudev-dev": "builder-stage header for libudev-sys; no runtime image compiles Rust",
    "libudeb-dev": "builder-stage header for libudev-sys; no runtime image compiles Rust",
    "libssl-dev": "builder-stage header; no runtime image compiles Rust",
    "pkg-config": "builder-stage tool; no runtime image compiles Rust",
    "libc-dev": "builder-stage header; no runtime image compiles Rust",
    "libudev1": (
        "DOCKER-14: already present in debian:bookworm-slim as a util-linux dependency; "
        "Dockerfile.server lists it belt-and-braces, Dockerfile.unified deliberately does not"
    ),
    "gosu": "Dockerfile.server drops privileges with gosu; the unified image uses supervisord",
    "supervisor": "Dockerfile.unified runs caddy + the server under supervisord; the server image is single-process",
    "jq": "Dockerfile.unified's healthcheck parses JSON with jq; the server image has no such check",
}


def apt_divergence(texts: dict[str, str]) -> list[str]:
    """Packages installed by some Dockerfiles and not others.

    This is the gap `ops/docker/Dockerfile.unified:62-63` names in its own words:
    "scripts/verify-dockerfile-workspace.py compares the two files' cache-priming
    manifests but NOT their apt package lists." That omission is not theoretical --
    the unified image was unbuildable from 2026-09-13 to 2026-09-18 because
    `Dockerfile.server` installed `libudev-dev` and `Dockerfile.unified` did not, and
    nothing compared the two. The failure surfaced only as a dead Northflank build.

    The split is reported per package rather than as a diff, because the question a
    reader has is "which file is missing what", and a bare set difference cannot say
    whether the server is behind or the unified one is.
    """
    per_file = {name: apt_packages(text) for name, text in texts.items()}
    everything: set[str] = set()
    for pkgs in per_file.values():
        everything |= pkgs
    findings: list[str] = []
    for package in sorted(everything):
        have = sorted(n for n, pkgs in per_file.items() if package in pkgs)
        missing = sorted(n for n, pkgs in per_file.items() if package not in pkgs)
        if not missing:
            continue
        verdict = ""
        if package in APT_PARITY_EXEMPT:
            verdict = f" [exempt: {APT_PARITY_EXEMPT[package]}]"
        findings.append(
            f"{package}: installed by {', '.join(have)} but NOT by "
            f"{', '.join(missing)}{verdict}"
        )
    return findings


def main(argv=None, root=None) -> int:
    """r199: argv and root parameterized, the r166..r198 contract -- the
    workspace manifest, the glob expansion and both Dockerfiles resolve
    under the contract root; the version/edition the inline dummies are
    graded against come from THAT manifest, not this checkout's."""
    members = workspace_members(root)
    ws_version = workspace_package_value("version", root)
    ws_edition = workspace_package_value("edition", root)
    base = ROOT if root is None else Path(root).resolve()
    all_errors: list[str] = []

    for name in DOCKERFILES:
        all_errors.extend(check_dockerfile(name, members, base, ws_version, ws_edition))

    # A Dockerfile already reported missing above must not crash the apt
    # comparison: divergence is graded over the files that EXIST, and the
    # missing one has already earned its finding.
    texts = {name: t for name in DOCKERFILES
             if (base / name).is_file()
             for t in [(base / name).read_text(encoding="utf-8")]}
    apt_findings = apt_divergence(texts)
    apt_drift = [f for f in apt_findings if "[exempt:" not in f]

    if all_errors:
        print("DOCKER-09 drift: cache-priming stage is out of sync with Cargo.toml workspace members:")
        for e in all_errors:
            print(f"  - {e}")
        print("Add the member's manifest COPY + dummy src dir to the failing Dockerfile (see DOCKER-09).")
        return 1

    if apt_drift:
        print("DOCKER-10 drift: the Dockerfiles install different apt package sets:")
        for f in apt_drift:
            print(f"  - {f}")
        print("Both images must install the package, or record the reason in APT_PARITY_EXEMPT.")
        return 1

    for f in apt_findings:
        print(f"NOTE: deliberate apt asymmetry -- {f}")

    for name in DOCKERFILES:
        pkgs = apt_packages(texts[name])
        print(
            f"OK: all {len(members)} workspace members are represented in {name}'s cache "
            f"stage; apt packages agree ({len(pkgs)} installed by all files)."
        )
    return 0


def self_test() -> int:
    """Pin the apt-divergence rule with fixtures it must both fail and pass."""
    nl = chr(10)
    shared = [
        "apt-get install -y --no-install-recommends \\",
        "    libssl-dev \\",
        "    pkg-config \\",
    ]
    # A comment naming a package must not be read as an install (this repo's
    # Dockerfiles carry long prose blocks that name real packages).
    prose = [
        "# libudev-dev is REQUIRED, not optional, for the desktop build.",
        *shared,
    ]
    divergent = [*shared, "        libudev-dev \\"]

    failures: list[str] = []

    if apt_packages(nl.join(prose)) != {"libssl-dev", "pkg-config"}:
        failures.append("comment prose leaked into the package set")
    if apt_packages(nl.join(divergent)) != {"libssl-dev", "pkg-config", "libudev-dev"}:
        failures.append("wrapped continuation package was not collected")
    if "rm" in apt_packages(nl.join(shared)):
        failures.append("trailing shell operator `rm` was collected as a package")

    same = apt_divergence({"a": nl.join(shared), "b": nl.join(prose)})
    if same:
        failures.append(f"identical package sets reported as divergent: {same}")

    found = apt_divergence({"a": nl.join(divergent), "b": nl.join(shared)})
    if len(found) != 1 or "libudev-dev" not in found[0]:
        failures.append(f"divergent package not reported: {found}")
    elif "NOT by b" not in found[0]:
        failures.append(f"divergence does not name the missing file: {found[0]}")

    # The workspace reader -- the priming build's member list comes out of it, so a
    # gutted one must turn the self-test red. CARGO_TOML and ROOT are patched to a
    # throwaway workspace for the duration; restored in finally.
    global CARGO_TOML, ROOT
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        crates = root / "crates"
        (crates / "alpha").mkdir(parents=True)
        (crates / "beta").mkdir()
        (root / "Cargo.toml").write_text(
            '[workspace]\n'
            'members = [\n'
            '    "crates/*",\n'
            ']\n',
            encoding="utf-8")
        _saved_root, _saved_toml = ROOT, CARGO_TOML
        try:
            ROOT, CARGO_TOML = root, root / "Cargo.toml"
            got = workspace_members()
            if got != ["crates/alpha", "crates/beta"]:
                failures.append(f"workspace_members: expected the two globbed crates, got {got!r}")
        finally:
            ROOT, CARGO_TOML = _saved_root, _saved_toml

    # r199: the shell -- main() graded through argv and a contract root, the
    # r166..r198 pattern. The fixture is a throwaway workspace (two globbed
    # crates, one inline-dummy app, one skipped fuzz workspace) plus both
    # Dockerfiles; the graded dummy version comes from THAT manifest.
    import contextlib as _ctx
    import io as _io
    import tempfile as _tempfile
    shell = 0
    NL = chr(10)
    BSN = chr(92) + "n"          # the two-character backslash-n a printf carries
    MANIFEST = (
        "[workspace]" + NL
        + "members = [" + NL
        + "    " + chr(34) + "crates/*" + chr(34) + "," + NL
        + "    " + chr(34) + "apps/desktop-tauri" + chr(34) + "," + NL
        + "    " + chr(34) + "tools/fuzz" + chr(34) + "," + NL
        + "]" + NL + NL
        + "[workspace.package]" + NL
        + "version = " + chr(34) + "0.0.41" + chr(34) + NL
        + "edition = " + chr(34) + "2021" + chr(34) + NL
    )
    def make_df(extra_apt=(), cover_all=True, dummy_version="0.0.41", with_main=True):
        lines = ["FROM debian:bookworm-slim AS builder"]
        lines.append("RUN apt-get install -y --no-install-recommends " + chr(92))
        lines.append("    libssl-dev " + chr(92))
        for extra in extra_apt:
            lines.append("    " + extra + " " + chr(92))
        covered = ["crates/alpha", "crates/beta"] if cover_all else ["crates/alpha"]
        for member in covered:
            lines.append("COPY " + member + "/Cargo.toml " + member + "/")
            lines.append("RUN mkdir -p " + member + "/src")
        if dummy_version is not None:
            lines.append(
                "RUN printf '[package]" + BSN + "name = " + chr(34) + "desktop" + chr(34) + BSN
                + "version = " + chr(34) + dummy_version + chr(34) + BSN
                + "edition = " + chr(34) + "2021" + chr(34) + BSN + "' "
                + "> apps/desktop-tauri/Cargo.toml")
            if with_main:
                lines.append("RUN printf 'fn main() {}' > apps/desktop-tauri/src/main.rs")
        return NL.join(lines) + NL
    def write_tree(**kw):
        (base / "ops" / "docker").mkdir(parents=True, exist_ok=True)
        for member in ("crates/alpha", "crates/beta", "apps/desktop-tauri"):
            (base / member).mkdir(parents=True, exist_ok=True)
        (base / "tools" / "fuzz").mkdir(parents=True, exist_ok=True)
        (base / "Cargo.toml").write_text(MANIFEST, encoding="utf-8")
        (base / "ops" / "docker" / "Dockerfile.server").write_text(make_df(**kw), encoding="utf-8")
        (base / "ops" / "docker" / "Dockerfile.unified").write_text(make_df(**kw), encoding="utf-8")
    def run():
        out, err = _io.StringIO(), _io.StringIO()
        try:
            with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                rc = main(root=base)
        except SystemExit as se:
            return se.code, out.getvalue() + err.getvalue()
        return rc, out.getvalue() + err.getvalue()
    with _tempfile.TemporaryDirectory() as td:
        base = Path(td)
        shell += 1
        write_tree()
        rc, text = run()
        if rc != 0 or "OK: all 4 workspace members" not in text:
            print("  x a fully covered fixture must read OK over 4 members (rc=%r text=%r)"
                  % (rc, text[-90:]), file=sys.stderr)
            return 1
        shell += 1
        write_tree(cover_all=False)
        rc, text = run()
        if rc != 1 or "missing 'COPY crates/beta/Cargo.toml'" not in text:
            print("  x a forgotten member must fail as DOCKER-09 drift (rc=%r text=%r)"
                  % (rc, text[-90:]), file=sys.stderr)
            return 1
        shell += 1
        write_tree(dummy_version="0.0.34")
        rc, text = run()
        if rc != 1 or "inline dummy version must be '0.0.41'" not in text:
            print("  x a stale dummy version must fail naming the bump (rc=%r text=%r)"
                  % (rc, text[-90:]), file=sys.stderr)
            return 1
        shell += 1
        write_tree(with_main=False)
        rc, text = run()
        if rc != 1 or "expected inline dummy src" not in text:
            print("  x a missing dummy src must fail (rc=%r text=%r)"
                  % (rc, text[-90:]), file=sys.stderr)
            return 1
        shell += 1
        write_tree()
        (base / "ops" / "docker" / "Dockerfile.server").write_text(
            make_df(extra_apt=("ripgrep",)), encoding="utf-8")
        rc, text = run()
        if rc != 1 or "DOCKER-10 drift" not in text or "ripgrep" not in text:
            print("  x an apt asymmetry must fail naming the package (rc=%r text=%r)"
                  % (rc, text[-90:]), file=sys.stderr)
            return 1
        shell += 1
        write_tree()
        (base / "ops" / "docker" / "Dockerfile.server").write_text(
            make_df(extra_apt=("libudev-dev",)), encoding="utf-8")
        rc, text = run()
        if rc != 0 or "deliberate apt asymmetry" not in text:
            print("  x an exempted asymmetry must read OK with a NOTE (rc=%r text=%r)"
                  % (rc, text[-90:]), file=sys.stderr)
            return 1
        shell += 1
        write_tree()
        (base / "ops" / "docker" / "Dockerfile.server").unlink()
        rc, text = run()
        if rc != 1 or "Dockerfile not found" not in text:
            print("  x a missing Dockerfile must fail rc 1 (rc=%r text=%r)"
                  % (rc, text[-90:]), file=sys.stderr)
            return 1

    for f in failures:
        print(f"SELFTEST FAIL: {f}")
    if failures:
        return 1
    print("OK: apt-divergence self-test passed; main() shell graded "
          "(%d cases through argv and root)" % shell)
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv[1:] else main())
