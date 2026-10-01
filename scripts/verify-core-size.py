#!/usr/bin/env python3
"""Verify the kasirmu-core production line count stays at or below its baseline.

Phase 3 P3.4 (docs/architecture/phase3-implementation-tickets.md section 5).
The plan Core Size Ratchet (section 11.1) needs a measured ceiling: extraction
can otherwise be undone by new logic landing back in core with nothing to notice.

The measure is deliberately narrow and mechanical: the number of NON-BLANK lines
in production Rust source under crates/kasirmu-core/src, excluding
  - whole test files (a *_tests.rs basename, tests.rs, or anything under a tests/
    directory), and
  - inline #[cfg(test)] mod <name> { ... } blocks inside an otherwise production
    file.

Comments and string bodies are masked before anything is counted, so a comment
line is not a line of code and a brace inside a log message does not close a block.
Blank lines are not counted; a line that is only whitespace after masking is blank.

The baseline (scripts/core-size-baseline.json) records the ceiling. The checker
FAILS when the measured count RISES above it and prints the delta; it does not
fail when the count falls, but it does REPORT the headroom so lowering the ceiling
stays a deliberate, visible edit -- exactly how a retired namespace edge leaves
scripts/namespace-governance-baseline.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BASELINE_NAME = "core-size-baseline.json"
SOURCE_DIR = Path("crates/kasirmu-core/src")


def configure_streams() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass


def fail(message: str) -> int:
    print(f"verify-core-size: FAIL: {message}", file=sys.stderr)
    return 1


def load_json(path: Path, label: str):
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as exc:
        raise SystemExit(f"verify-core-size: {label} is not valid JSON: {exc}") from exc


def mask_comments_and_strings(text: str) -> str:
    """Blank comment and string contents, preserving offsets and newlines.

    The same helper scripts/verify-namespace-governance.py carries, and for the
    same reason: a brace inside a doc comment or a log message must not be read
    as the brace that closes a #[cfg(test)] module.
    """
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
                out.append("\n" if text[i + 1] == "\n" else " ")
                out.append(" ")
                i += 2
                continue
            if char == in_string:
                in_string = None
            out.append("\n" if char == "\n" else " ")
            i += 1
            continue
        if char == "'":
            if i + 1 < len(text) and text[i + 1] == "\\" and i + 2 < len(text):
                out.append(" ")
                i += 1
                out.extend(" " * 2)
                i += 2
                if i < len(text) and text[i] == "'":
                    out.append(" ")
                    i += 1
                continue
            if i + 2 < len(text) and text[i + 2] == "'":
                out.extend("   ")
                i += 3
                continue
            out.append(" ")
            i += 1
        elif char == "r" and nxt in ('"', "#"):
            hashes = 0
            j = i + 1
            while j < len(text) and text[j] == "#":
                hashes += 1
                j += 1
            if j < len(text) and text[j] == '"':
                terminator = '"' + "#" * hashes
                out.append(" ")
                k = j + 1
                while k < len(text) and not text.startswith(terminator, k):
                    out.append("\n" if text[k] == "\n" else " ")
                    k += 1
                if k < len(text):
                    out.extend(" " * len(terminator))
                    k += len(terminator)
                i = k
                continue
            out.append(char)
            i += 1
        elif char in ('"', "`"):
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


def is_test_file(path: Path, source_dir: Path) -> bool:
    """A whole file that is test scaffolding rather than production source."""
    name = path.name
    if name.endswith("_tests.rs") or name == "tests.rs":
        return True
    rel = path.relative_to(source_dir)
    return any(part == "tests" for part in rel.parts[:-1])


def strip_test_modules(masked: str) -> str:
    """Remove #[cfg(test)] test scaffolding from masked source.

    Two shapes are removed:

      * an inline module -- ``#[cfg(test)] mod tests { ... }`` -- where the
        whole brace-balanced block goes;
      * an external declaration -- ``#[cfg(test)] #[path = "..."] mod tests;``
        -- where the attribute line(s) and the ``mod`` declaration are not
        production code either, because the tests live in another file.

    The masker has already blanked comments and strings, so the braces that
    matter are real code. Depth is counted so a nested item does not close the
    block early. A ``#[cfg(test)]`` attribute that is not followed by a ``mod``
    item within a few lines is left alone: it may mark a unit-test-only helper
    function, which is still production source.
    """
    lines = masked.split("\n")
    out: list[str] = []
    i = 0
    n = len(lines)
    while i < n:
        if lines[i].strip().startswith("#[cfg(test)]"):
            j = i
            mod_line = None
            mod_col = None
            while j < n and j - i <= 5:
                if "mod " in lines[j]:
                    col = lines[j].find("{")
                    if col != -1:
                        mod_line = j
                        mod_col = col
                    break
                j += 1
            if mod_line is not None:
                depth = 1
                k = mod_line
                col = mod_col + 1
                while k < n and depth > 0:
                    row = lines[k]
                    start = col if k == mod_line else 0
                    for idx in range(start, len(row)):
                        if row[idx] == "{":
                            depth += 1
                        elif row[idx] == "}":
                            depth -= 1
                            if depth == 0:
                                break
                    if depth == 0:
                        break
                    k += 1
                out.append("")
                i = k + 1
                continue
            if j < n and j - i <= 5 and lines[j].strip().startswith("mod ") and lines[j].strip().endswith(";"):
                out.append("")
                i = j + 1
                continue
        out.append(lines[i])
        i += 1
    return "\n".join(out)

def count_lines(path: Path, source_dir: Path) -> int:
    raw = path.read_text(encoding="utf-8", errors="replace")
    masked = mask_comments_and_strings(raw)
    stripped = strip_test_modules(masked)
    return sum(1 for line in stripped.split("\n") if line.strip())


def production_sources(root: Path) -> list[Path]:
    source_dir = root / SOURCE_DIR
    if not source_dir.is_dir():
        return []
    return sorted(path for path in source_dir.rglob("*.rs") if not is_test_file(path, source_dir))


def measure(root: Path):
    source_dir = root / SOURCE_DIR
    per_file: list[tuple[str, int]] = []
    total = 0
    for path in production_sources(root):
        count = count_lines(path, source_dir)
        per_file.append((str(path.relative_to(root)).replace("\\", "/"), count))
        total += count
    return total, len(per_file), per_file


def main() -> int:
    configure_streams()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, help="Repository root (defaults to the script parent).")
    parser.add_argument("--baseline-file", type=Path, help="Baseline JSON path.")
    parser.add_argument("--json", action="store_true", help="Emit stable JSON.")
    parser.add_argument("--emit-baseline", action="store_true", help="Rewrite the baseline from the current count.")
    parser.add_argument("--self-test", action="store_true", help="Run the built-in classifier tests and exit.")
    parser.add_argument("--files", action="store_true", help="List per-file counts (report-only).")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    root = args.root or Path(__file__).resolve().parent.parent
    baseline_path = args.baseline_file or (root / "scripts" / BASELINE_NAME)
    total, file_count, per_file = measure(root)

    if args.emit_baseline:
        document = {
            "schema_version": 1,
            "description": (
                "Ceiling for the kasirmu-core production line count (Phase 3 P3.4, plan section 11.1). "
                "scripts/verify-core-size.py fails when the measured count rises above ceiling. "
                "Lowering it is a deliberate edit, exactly as a retired namespace edge leaves "
                "scripts/namespace-governance-baseline.json."
            ),
            "measure": "non-blank lines in crates/kasirmu-core/src production .rs files, minus inline #[cfg(test)] mod blocks",
            "ceiling": total,
            "measured_files": file_count,
        }
        baseline_path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
        print(f"verify-core-size: wrote baseline (ceiling {total}, {file_count} files)")
        return 0

    if args.files:
        for name, count in per_file:
            print(f"{count:6d}  {name}")
        print(f"{total:6d}  TOTAL ({file_count} files)")
        return 0

    baseline = load_json(baseline_path, "baseline")
    if baseline is None:
        return fail(f"baseline missing at {baseline_path}; run --emit-baseline")

    ceiling = int(baseline.get("ceiling", 0))
    delta = total - ceiling

    if args.json:
        print(json.dumps({
            "measured": total,
            "ceiling": ceiling,
            "delta": delta,
            "measured_files": file_count,
            "baseline_files": baseline.get("measured_files"),
            "ok": delta <= 0,
        }, indent=2))
    elif delta > 0:
        print(f"verify-core-size: measured {total} vs ceiling {ceiling} (+{delta} lines)", file=sys.stderr)
    else:
        print(f"verify-core-size: measured {total} vs ceiling {ceiling} ({delta} lines, headroom {-delta})")

    if delta > 0:
        return fail(
            f"kasirmu-core grew by {delta} production line(s) above the {ceiling}-line ceiling. "
            "Extract the new logic into its module, or lower the ceiling deliberately by editing "
            f"{baseline_path.relative_to(root)} in a commit that says why."
        )
    return 0


def self_test() -> int:
    import tempfile

    cases = 0
    failures = 0

    def check(name: str, got, want) -> None:
        nonlocal cases, failures
        cases += 1
        if got != want:
            failures += 1
            print(f"  x {name}: got {got!r}, want {want!r}", file=sys.stderr)

    # The masker blanks a string body, so a brace inside a string vanishes.
    check("comment is not code", mask_comments_and_strings("// }").strip(), "")
    check("block comment is not code", mask_comments_and_strings("/* } */").strip(), "")
    check("string brace is not code", mask_comments_and_strings('let s = "}";').count("}"), 0)
    check("raw string brace is not code", mask_comments_and_strings('let s = r#"}"#;').count("}"), 0)
    check("lifetime is not a char literal", mask_comments_and_strings("fn f<'a>(x: &'a str) -> &'a str { x }").count("{"), 1)

    sample = (
        "pub fn prod() -> u8 {\n"
        "    1\n"
        "}\n\n"
        "#[cfg(test)]\n"
        "mod tests {\n"
        "    #[test]\n"
        "    fn t() {\n"
        "        assert_eq!(prod(), 1);\n"
        "    }\n"
        "}\n"
    )
    masked = mask_comments_and_strings(sample)
    stripped = strip_test_modules(masked)
    check("inline test module is stripped", sum(1 for l in stripped.split("\n") if l.strip()), 3)
    check("production lines survive", "pub fn prod" in stripped, True)

    tricky = '#[cfg(test)]\nmod tests {\n    fn t() {\n        let s = "}";\n    }\n}\n'
    tricky_masked = strip_test_modules(mask_comments_and_strings(tricky))
    check("string brace does not close a test module early", sum(1 for l in tricky_masked.split("\n") if l.strip()), 0)

    ext = "\n".join(["pub fn a() {}", "#[cfg(test)]", '#[path = "x_tests.rs"]', "mod tests;", ""])
    ext_stripped = strip_test_modules(mask_comments_and_strings(ext))
    check("external test declaration is not production", sum(1 for l in ext_stripped.split("\n") if l.strip()), 1)
    ext_plus = ext + "pub fn b() {}\n"
    ext_plus_stripped = strip_test_modules(mask_comments_and_strings(ext_plus))
    check("code after an external declaration still counts", sum(1 for l in ext_plus_stripped.split("\n") if l.strip()), 2)
    src = Path("/repo/crates/kasirmu-core/src")
    check("test file by basename", is_test_file(src / "foo_tests.rs", src), True)
    check("tests.rs is a test file", is_test_file(src / "tests.rs", src), True)
    check("file under tests/ is a test file", is_test_file(src / "sync" / "tests" / "case.rs", src), True)
    check("ordinary source file", is_test_file(src / "sale.rs", src), False)

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        base = root / SOURCE_DIR
        base.mkdir(parents=True)
        (base / "prod.rs").write_text("pub fn a() {}\npub fn b() {}\n", encoding="utf-8")
        (base / "prod_tests.rs").write_text("fn t() {\n    panic!();\n}\n", encoding="utf-8")
        total, files, _ = measure(root)
        check("temp tree counts only production", total, 2)
        check("temp tree file count", files, 1)

    if failures:
        print(f"verify-core-size --self-test: {failures}/{cases} FAILED", file=sys.stderr)
        return 1
    print(f"verify-core-size --self-test: {cases}/{cases} passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
