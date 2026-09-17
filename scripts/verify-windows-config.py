#!/usr/bin/env python3
r"""
scripts/verify-windows-config.py — Gate Windows release config drift.

WHY
====

The zero-popup Windows install goal (audit/28, RELEASE-06 follow-up)
rests on two properties that can silently regress:

  1. **NSIS installMode** — a `perMachine` installer requires elevation
     and reintroduces a UAC prompt at install time. The Tauri config
     must keep `bundle.windows.nsis.installMode` at `currentUser`.
  2. **asInvoker application manifest** — every shipped Windows exe must
     embed a loadable manifest (`<requestedExecutionLevel
     level="asInvoker"/>`) as the NUMERIC resource type 24
     (RT_MANIFEST). A manifest embedded as a *named* type (the string
     "RT_MANIFEST") is ignored by the Windows loader (mt.exe cannot find
     it), which previously triggered UAC installer-detection heuristics
     on every run (the updater-compat harness bug).

This script enforces both, statically (tauri.conf.json + source
app.manifest files) and — with `--exe` — against actually-built
binaries (PE resource walk). The `--exe` mode is wired into the release
workflow's Windows job so a future build-system or config change that
drops the manifest fails the release before upload.

USAGE
=====

    python3 scripts/verify-windows-config.py                      # static config + source manifests
    python3 scripts/verify-windows-config.py --exe a.exe b.exe    # PE-scan built binaries
    python3 scripts/verify-windows-config.py --verbose            # list every checked file
    python3 scripts/verify-windows-config.py --report-only        # exit 0 on violations
    python3 scripts/verify-windows-config.py --self-test          # prove the floor can fire

WHAT A GREEN LINE PROMISES
==========================

The final line names the population it examined: "N violation(s) (population
examined: X tauri.conf.json walked, Y source app.manifest checked, Z built exe
scanned)". It used to read only "N violation(s)". That count is an ERROR count,
not a population, so the sentence was true and useful even when the walk had
found no files at all: the `apps/*/tauri.conf.json` glob could come back empty
(a renamed apps/ dir, a partial checkout, a shallow CI clone), the loop body
never ran, `errors` stayed empty, and the gate printed "0 violation(s)" and
exited 0 having examined zero configs. Per-file detail sat behind --verbose, so
even a real run hid what it had looked at.

So the gate now also refuses to certify an empty config walk: the "EMPTY
POPULATION" sentence goes to stderr as the LAST line a caller reads, after the
count line (the reason verify-topology-parity.py puts its "NOT FULLY VERIFIED"
last — two lines above an OK is where a skip goes unnoticed), and the exit code
is 2. `--report-only` suppresses violation exits; it does not buy a certificate
the gate never issued. Shape borrowed from verify-test-shadow-copies.py, which
hit the same class.

KNOWN LIMIT — SOURCE_MANIFESTS IS A HAND-MAINTAINED LITERAL
===========================================================

`SOURCE_MANIFESTS` is a 4-entry literal, not a glob, so THIS GATE CANNOT NOTICE
A NEW WINDOWS BINARY: a fifth shipped exe whose manifest asks for
`requireAdministrator` passes here, because nothing ever asked about it. Do not
read a green run as "every Windows exe in this repo embeds asInvoker". When you
add a shipped Windows exe you MUST add its `app.manifest` path to
`SOURCE_MANIFESTS` in the same commit, and say in the commit message how the
manifest gets embedded (build.rs `embed-resource`, or a committed Go `.syso`) —
a manifest that exists in the source tree but is never embedded is precisely the
bug this list was written to catch. The literal was left a literal on purpose:
which binaries ship is a product decision, and a glob would silently widen or
narrow coverage to include manifests that ship nothing. The vacuity fixed above
is one-directional, and stays so: a LISTED file that goes missing does fail
(`check_source_manifests` reports "missing app.manifest"), so this gate is loud
about files it was told about and structurally blind to files it was not.

EXIT CODES
==========

  * 0  all assertions hold AND the walk examined a non-empty config population.
  * 1  at least one violation (unless --report-only).
  * 2  a runtime error occurred (missing config/manifest/exe file), or the gate
       refused to certify an empty population. `--self-test` also exits 2 when a
       case fails: a broken proof is this tool's own runtime error, never a
       verdict about anyone's Windows config (so it must not exit 1).
"""

import argparse
import contextlib
import io
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Every Tauri app config under apps/ — a future app that adds a Windows
# NSIS target is picked up automatically. Apps with no `bundle.windows.nsis`
# block (e.g. the tablet, Android/iOS-only) are skipped, not failed.
# The flip side: this glob is the gate's whole population. Empty glob = the
# loop below never runs = zero assertions made, which is why `main()`
# refuses to certify an empty walk instead of reporting "0 violation(s)".
TAURI_CONFIGS = sorted((ROOT / "apps").glob("*/tauri.conf.json"))

# Source-level app.manifest files that must carry asInvoker. Each one is
# embedded into a shipped Windows exe (cloud-server + oz CLI via
# embed-resource build.rs, license-server via the committed Go .syso, and
# the updater-compat harness used by the release validation).
#
# A LITERAL ON PURPOSE, AND THEREFORE A CEILING: a fifth shipped Windows exe
# is invisible to this gate until a human adds its path here — see
# "KNOWN LIMIT" in the module docstring for what to do when you ship one.
SOURCE_MANIFESTS = [
    ROOT / "apps" / "cloud-server" / "app.manifest",
    ROOT / "crates" / "kasirmu-cli" / "app.manifest",
    ROOT / "apps" / "license-server" / "app.manifest",
    ROOT / "scripts" / "updater-compat-check" / "app.manifest",
]

REQUIRED_NSIS_INSTALL_MODE = "currentUser"
RT_MANIFEST = 24  # numeric resource type for the application manifest

DESCRIPTION = (
    "Verify Tauri NSIS installMode stays currentUser and every shipped "
    "Windows exe embeds a loadable asInvoker manifest (numeric RT_MANIFEST "
    "type 24). Prevents silent UAC-prompt regressions."
)


# ── Static config + source manifest checks ─────────────────────────────

def check_tauri_configs(verbose: bool, configs: list[Path] | None = None) -> list[str]:
    """Fail if any tauri.conf.json sets NSIS installMode to perMachine.

    `configs` is a parameter (defaulting to the module-level walk) so the
    population is a pure function of inputs: a test can hand this walker an
    empty list without deleting anything under apps/.
    """
    errors: list[str] = []
    for path in TAURI_CONFIGS if configs is None else configs:
        if not path.is_file():
            errors.append(f"{rel(path)}: missing tauri.conf.json")
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        label = rel(path)
        nsis = (data.get("bundle") or {}).get("windows", {}).get("nsis")
        if not nsis:
            # No NSIS target configured (e.g. the tablet app is Android/iOS
            # only) — nothing to enforce. Also: if a future config deletes
            # the nsis block entirely, Tauri's NSIS default installMode is
            # already `currentUser`, so skipping is safe (perMachine can
            # only be set explicitly).
            if verbose:
                print(f"  {label}: no bundle.windows.nsis block — skipped")
            continue
        mode = nsis.get("installMode")
        if verbose:
            print(f"  {label}: bundle.windows.nsis.installMode = {mode!r}")
        if mode != REQUIRED_NSIS_INSTALL_MODE:
            errors.append(
                f"{label}: NSIS installMode is {mode!r} — must be "
                f"'{REQUIRED_NSIS_INSTALL_MODE}'. An explicit `currentUser` "
                "is required even though Tauri defaults to it; a perMachine "
                "installer requires elevation and reintroduces the UAC prompt "
                "at install time."
            )
    return errors


def check_source_manifests(verbose: bool, manifests: list[Path] | None = None) -> list[str]:
    """Fail if any source app.manifest lacks an asInvoker execution level."""
    errors: list[str] = []
    for path in SOURCE_MANIFESTS if manifests is None else manifests:
        label = rel(path)
        if not path.is_file():
            errors.append(f"{label}: missing app.manifest")
            continue
        text = path.read_text(encoding="utf-8")
        if verbose:
            print(f"  {label}: {'asInvoker' if 'asInvoker' in text else 'NO asInvoker'}")
        if "asInvoker" not in text:
            errors.append(
                f"{label}: manifest lacks <requestedExecutionLevel level=\"asInvoker\"/>"
            )
        if "requireAdministrator" in text or "highestAvailable" in text:
            errors.append(
                f"{label}: manifest requests elevation "
                "(requireAdministrator/highestAvailable) — breaks the zero-popup goal"
            )
    return errors


# ── What a green line is allowed to claim ──────────────────────────────

def verdict_line(errors: list[str], configs: list[Path], manifests: list[Path],
                 exes: list[Path] | None = None) -> str:
    """The final line, and the only unconditional one.

    The violation count alone was the vacuous-green bug: "0 violation(s)" is
    equally true of a run that checked two configs and a run that found no
    configs at all. So the counts of what was examined ride on the same line,
    in the same sentence — a reader cannot grep the green without reading the
    denominator. The leading phrase is kept byte-stable ("verify-windows-config:
    N violation(s)") because lanes and docs quote it.
    """
    exes = [] if exes is None else exes
    return (
        f"verify-windows-config: {len(errors)} violation(s) "
        f"(population examined: {len(configs)} tauri.conf.json walked, "
        f"{len(manifests)} source app.manifest checked, "
        f"{len(exes)} built exe scanned)."
    )


def empty_population_exit(configs: list[Path], manifests: list[Path],
                          exes: list[Path] | None = None) -> int | None:
    """Refuse to certify a config walk that examined nothing. Returns the exit
    code to use, or None when there was a population to check.

    The NSIS half of this gate lives entirely inside
    `for path in TAURI_CONFIGS`; an empty walk makes zero assertions, and zero
    assertions printed as a pass. Shape and voice copied from
    verify-test-shadow-copies.py's EMPTY POPULATION refusal; placed last, after
    the count line, for the reason verify-topology-parity.py gives — two lines
    above an OK is where a skip goes unnoticed.
    """
    if configs:
        return None
    exes = [] if exes is None else exes
    print(
        f"verify-windows-config: EMPTY POPULATION (tauri.conf.json walked={len(configs)}, "
        f"source manifests={len(manifests)}, built exe scanned={len(exes)}); a clean result "
        f"here means the check looked at nothing, not that it passed — the installMode "
        f"assertion never ran, so nothing here rules out a perMachine installer. Check that "
        f"apps/*/tauri.conf.json still exists in this checkout.",
        file=sys.stderr,
    )
    return 2


# ── PE resource walk (built binaries) ─────────────────────────────────

def pe_sections(data: bytes) -> dict[str, tuple[int, int, int, int]]:
    """Map section name -> (vaddr, vsize, file_offset, raw_size)."""
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe : pe + 4] != b"PE\0\0":
        raise ValueError("not a PE file")
    nsec = struct.unpack_from("<H", data, pe + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe + 20)[0]
    sect_off = pe + 24 + opt_size
    sections: dict[str, tuple[int, int, int, int]] = {}
    for i in range(nsec):
        off = sect_off + i * 40
        name = data[off : off + 8].rstrip(b"\0").decode()
        vsize, vaddr, rsize, roff = struct.unpack_from("<IIII", data, off + 8)
        sections[name] = (vaddr, vsize, roff, rsize)
    return sections


def _dir_entries(data: bytes, off: int) -> list[tuple[int, int]]:
    """Read IMAGE_RESOURCE_DIRECTORY entries at file offset `off`."""
    n_named, n_id = struct.unpack_from("<HH", data, off + 12)
    entries = []
    for i in range(n_named + n_id):
        name_off, data_off = struct.unpack_from("<II", data, off + 16 + i * 8)
        entries.append((name_off, data_off))
    return entries


def find_manifest_xml(data: bytes) -> tuple[bytes | None, list[str]]:
    """Extract the embedded application manifest XML from a PE binary.

    Returns (manifest_xml_or_None, diagnostics). Only a NUMERIC type-24
    resource counts — a named-type "RT_MANIFEST" resource is ignored by
    the Windows loader and is reported as a diagnostic.

    Resource-tree addressing follows the PE spec: IMAGE_RESOURCE_DIRECTORY
    child offsets ("OffsetToData") are relative to the START of the .rsrc
    section, while the leaf IMAGE_RESOURCE_DATA_ENTRY.OffsetToData is a
    full image-base RVA (so it maps through the section table).
    """
    diag: list[str] = []
    try:
        sections = pe_sections(data)
    except ValueError as e:
        return None, [str(e)]
    if ".rsrc" not in sections:
        return None, ["no .rsrc section — manifest NOT embedded"]
    vaddr, _vsize, roff, _rsize = sections[".rsrc"]

    def rva_to_off(rva: int) -> int:
        return roff + (rva - vaddr)

    numeric_manifest: bytes | None = None
    try:
        # Level 1: resource types. The root directory sits at .rsrc start.
        for name_off, data_off in _dir_entries(data, roff):
            if name_off & 0x80000000:
                # Named type — e.g. the string "RT_MANIFEST". The Windows
                # loader never reads this for the app manifest. The name
                # string offset is also .rsrc-relative.
                soff = roff + (name_off & 0x7FFFFFFF)
                ln = struct.unpack_from("<H", data, soff)[0]
                nm = data[soff + 2 : soff + 2 + ln * 2].decode("utf-16-le", "replace")
                diag.append(f"named resource type present: {nm!r} (ignored by loader)")
                continue
            if name_off != RT_MANIFEST:
                continue
            # Level 2: name ids under type 24 (e.g. #1). Child offset is
            # relative to .rsrc start.
            lvl2 = _dir_entries(data, roff + (data_off & 0x7FFFFFFF))
            for _l2_name, l2_data in lvl2:
                # Level 3: language ids. Same .rsrc-relative addressing.
                lvl3 = _dir_entries(data, roff + (l2_data & 0x7FFFFFFF))
                for _l3_name, l3_data in lvl3:
                    # Leaf: points to IMAGE_RESOURCE_DATA_ENTRY (rsrc-rel).
                    leaf = roff + (l3_data & 0x7FFFFFFF)
                    data_rva, size = struct.unpack_from("<II", data, leaf)
                    if size and data_rva:
                        start = rva_to_off(data_rva)
                        numeric_manifest = data[start : start + size]
                        break
                if numeric_manifest:
                    break
            if not numeric_manifest:
                diag.append("numeric type-24 resource present but unreadable")
    except (struct.error, ValueError) as e:
        return None, [f"resource tree parse error: {e}"]
    return numeric_manifest, diag


def rel(path: Path) -> str:
    """Best-effort repo-relative label; falls back to the raw path."""
    try:
        return str(path.resolve().relative_to(ROOT.resolve()))
    except ValueError:
        return str(path)


def check_exe(path: Path, verbose: bool) -> list[str]:
    """Assert a built exe embeds a loadable asInvoker manifest."""
    label = rel(path)
    data = path.read_bytes()
    xml, diag = find_manifest_xml(data)
    if verbose:
        for d in diag:
            print(f"  {label}: {d}")
    errors: list[str] = []
    if xml is None:
        errors.append(f"{label}: no loadable application manifest — {diag[0] if diag else 'missing'}")
        return errors
    text = xml.decode("utf-8", "replace")
    if "asInvoker" not in text:
        errors.append(f"{label}: manifest embedded but does not request asInvoker")
    if "requireAdministrator" in text or "highestAvailable" in text:
        errors.append(f"{label}: manifest requests elevation (requireAdministrator/highestAvailable)")
    if verbose:
        print(f"  {label}: asInvoker manifest present (numeric RT_MANIFEST type 24)")
    return errors


# ── self-test ──────────────────────────────────────────────────────────

def self_test() -> int:
    """Prove the floor can fire, without deleting anything.

    The plant is an empty list handed to the same function `main()` calls; the
    restore is the control case two below it, a non-empty population that must
    NOT refuse. Nothing here mutates the tree or the module globals — the
    walkers and the floor take their populations as arguments, which is the only
    reason an empty walk is testable at all (apps/*/tauri.conf.json cannot be
    deleted to demonstrate a bug that must never fire on a real checkout).

    A failed case exits 2, never 1: this tool's 1 means "someone's Windows
    config is wrong", and a broken proof of ours is not that verdict.
    """
    failures = 0

    def check(label: str, cond: bool, detail: str = "") -> None:
        nonlocal failures
        print(f"  {'ok  ' if cond else 'FAIL'}  {label}")
        if not cond:
            failures += 1
            for ln in str(detail).splitlines()[:4]:
                if ln.strip():
                    print(f"        {ln.strip()[:108]}")

    # 1. THE PLANT: an empty config walk must be refused, not certified. The
    #    refusal is captured, not streamed: this file's "EMPTY POPULATION" line
    #    is a live red signal when a lane prints it, and a self-test that
    #    echoes one unlabelled is how a passing run gets read as a failing one.
    buf = io.StringIO()
    with contextlib.redirect_stderr(buf):
        rc = empty_population_exit([], list(SOURCE_MANIFESTS))
    said = buf.getvalue()
    check("plant: an empty tauri.conf.json walk exits non-zero", rc is not None and rc != 0,
          f"empty_population_exit([], {len(SOURCE_MANIFESTS)} manifests) -> {rc!r}")
    check("plant: the refusal is the runtime-error code, not a violation", rc == 2,
          f"got {rc!r}; 1 would impersonate a config finding")
    check("plant: the refusal names the zero it refused on",
          "EMPTY POPULATION" in said and "tauri.conf.json walked=0" in said, said)
    for ln in said.splitlines():
        print(f"        | {ln.strip()[:100]}")

    # 1b. The refusal must be the LAST line main() prints, or it lands two
    #     lines above an OK — verify-topology-parity.py's lesson.
    src = Path(__file__).resolve().read_text(encoding="utf-8")
    printed = src.index("print(verdict_line(errors,")
    refused = src.index("empty_population_exit(configs,")
    check("order: the floor is consulted after the count line", printed < refused,
          f"count line at offset {printed}, floor at {refused}: the refusal must print"
          " after the count, or it lands two lines above an OK")

    # 2. CONTROL: a populated walk must NOT refuse, or case 1 is an always-red
    #    print that guards nothing.
    one = [ROOT / "apps" / "desktop-client" / "tauri.conf.json"]
    check("control: one config in the population certifies normally",
          empty_population_exit(one, list(SOURCE_MANIFESTS)) is None)

    # 3. THE CLAIM THE FLOOR RELIES ON, measured here rather than asserted in
    #    prose: this checkout's population is non-empty, so a real run cannot
    #    hit the refusal.
    walked = sorted((ROOT / "apps").glob("*/tauri.conf.json"))
    check(f"live: the real walk is non-empty ({len(walked)} tauri.conf.json)", len(walked) > 0,
          "the floor would fire on every lane, which is a different bug")

    # 4. The green line names its denominator even at zero violations.
    line = verdict_line([], [], [])
    check("line: '0 violation(s)' cannot be printed without the population",
          "0 violation(s)" in line and "0 tauri.conf.json walked" in line
          and "0 source app.manifest checked" in line, line)
    line2 = verdict_line([], walked, list(SOURCE_MANIFESTS))
    check(f"line: a real run prints its counts ({len(walked)}, {len(SOURCE_MANIFESTS)})",
          f"{len(walked)} tauri.conf.json walked" in line2
          and f"{len(SOURCE_MANIFESTS)} source app.manifest checked" in line2, line2)

    print()
    if failures:
        print(f"self-test: {failures} FAILURE(S) — the floor is weaker than claimed",
              file=sys.stderr)
        return 2
    print("self-test: OK — the empty walk refuses to certify and the populated one does not")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="List every checked file and its status.",
    )
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="Exit 0 on violations; print report and return. Does NOT buy a pass "
             "on an empty population — that refusal still exits 2.",
    )
    parser.add_argument(
        "--exe",
        nargs="+",
        metavar="PATH",
        help="PE-scan the given built Windows executables instead of (in addition to) static checks.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Plant an empty config walk and prove the refusal fires. Exits 2 on a failed case.",
    )
    args = parser.parse_args(argv)

    # A cp1252 Windows console must never crash instead of failing the gate.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    if args.self_test:
        return self_test()

    # Bound up front: the lists below ARE the population, and the population is
    # what the final line reports and the floor refuses on.
    configs = list(TAURI_CONFIGS)
    manifests = list(SOURCE_MANIFESTS)
    exe_paths: list[Path] = []
    errors: list[str] = []

    print("verify-windows-config: NSIS installMode + asInvoker manifest gate")
    if args.verbose:
        print("  tauri.conf.json checks:")
    errors += check_tauri_configs(args.verbose, configs)
    if args.verbose:
        print("  source app.manifest checks:")
    errors += check_source_manifests(args.verbose, manifests)

    if args.exe:
        print("  --exe PE resource checks:")
        exe_paths = [Path(p) for p in args.exe]
        missing = [p for p in exe_paths if not p.is_file()]
        for p in missing:
            errors.append(f"{p}: exe file not found")
        for p in (p for p in exe_paths if p.is_file()):
            try:
                errors += check_exe(p, args.verbose)
            except (OSError, struct.error, ValueError) as e:
                errors.append(f"{p}: could not parse exe — {e}")

    print(verdict_line(errors, configs, manifests, exe_paths))
    for e in errors:
        print(f"  ✗ {e}")

    # Last, so it is the final thing a caller reads; it is not suppressible by
    # --report-only, which buys silence about violations, not a certificate.
    refusal = empty_population_exit(configs, manifests, exe_paths)
    if refusal is not None:
        return refusal

    return 0 if (args.report_only or not errors) else 1


if __name__ == "__main__":
    sys.exit(main())
