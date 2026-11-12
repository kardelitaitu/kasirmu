#!/usr/bin/env python3
"""Verify the kasirmu-core production line count stays at or below its baseline.

Phase 3 P3.4 (docs/records/superseded/phase3-implementation-tickets.md section 5).
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


#: The crate's database layer, measured separately from everything else.
#:
#: WHY TWO BUDGETS (ADR-67). `db/` is one `impl Store<'_>` surface -- inherent methods on
#: the crate's own database handle. It cannot move out of the crate without moving the
#: crate, so it can never be an extraction target. Measured 2026-10-24: 27,481 of the
#: crate's 40,616 production lines (67.7%) live here.
#:
#: Phase 3 P3.4 introduced this ratchet to stop "new logic landing back in core" after the
#: feature modules moved out to `modules/`. That rule is about the OTHER 32.3% -- logic
#: that could live in a module. Grading one combined number conflates "the product has a
#: lot of SQL" with "modularity regressed", and the combined number was raised four times
#: in five days (+1,548 lines) because every raise was individually correct.
DB_PREFIX = "crates/kasirmu-core/src/db/"


def measure(root: Path):
    """(total, file_count, per_file, db_total, non_db_total).

    `total` is what the original single-budget gate graded and is still reported, so the
    transition changes nothing a reader already relies on. `db_total` and `non_db_total`
    partition it exactly: they always sum to `total`.
    """
    source_dir = root / SOURCE_DIR
    per_file: list[tuple[str, int]] = []
    total = 0
    db_total = 0
    for path in production_sources(root):
        count = count_lines(path, source_dir)
        rel = str(path.relative_to(root)).replace("\\", "/")
        per_file.append((rel, count))
        total += count
        if rel.startswith(DB_PREFIX):
            db_total += count
    return total, len(per_file), per_file, db_total, total - db_total


def _rel(path: Path, root: Path) -> str:
    """Path relative to the repo when possible, else the absolute path.

    A baseline passed with `--baseline-file` may live outside the checkout (a scratch
    file, a worktree copy). `Path.relative_to` RAISES in that case, and it raises INSIDE
    the failure message -- so the gate crashed with a ValueError instead of reporting the
    violation it had just detected. Measured 2026-10-24 by pointing --baseline-file at a
    temp file: the db-budget finding was computed, then lost to this.
    """
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def main(argv=None, root=None) -> int:
    """r181: argv and root parameterized, the r166..r180 contract. root
    redirects the measured tree AND the baseline (both read and written),
    so --emit-baseline under a fixture writes the fixture's baseline."""
    configure_streams()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, help="Repository root (defaults to the script parent).")
    parser.add_argument("--baseline-file", type=Path, help="Baseline JSON path.")
    parser.add_argument("--json", action="store_true", help="Emit stable JSON.")
    parser.add_argument("--emit-baseline", action="store_true", help="Rewrite the baseline from the current count.")
    parser.add_argument("--self-test", action="store_true", help="Run the built-in classifier tests and exit.")
    parser.add_argument("--files", action="store_true", help="List per-file counts (report-only).")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    root = Path(root).resolve() if root is not None else (
        args.root or Path(__file__).resolve().parent.parent)
    baseline_path = args.baseline_file or (root / "scripts" / BASELINE_NAME)
    total, file_count, per_file, db_total, non_db_total = measure(root)

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
            # ADR-67: `db/` is the crate's own Store layer and can never be extracted, so it
            # gets its own budget. The two ceilings are INDEPENDENT and their sum is NOT
            # `ceiling`: `ceiling` stays the whole-crate ratchet (so every historical raise
            # keeps its meaning), while `db_ceiling` + `non_db_ceiling` partition TODAY's tree.
            "db_ceiling": db_total,
            "non_db_ceiling": non_db_total,
            "measured_files": file_count,
        }
        baseline_path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
        print(f"verify-core-size: wrote baseline (ceiling {total} = db {db_total} + non-db {non_db_total}, {file_count} files)")
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

    # ADR-67 second budget. `db_ceiling` is OPTIONAL on purpose: a baseline written before
    # the split has no such key, and the gate must keep grading such a tree exactly as it
    # did yesterday rather than refusing it. Absent means "not yet split".
    db_ceiling = baseline.get("db_ceiling")
    split = isinstance(db_ceiling, int)
    db_delta = db_total - db_ceiling if split else None
    non_db_ceiling = int(baseline.get("non_db_ceiling", 0)) if split else None
    non_db_delta = non_db_total - non_db_ceiling if split else None

    if args.json:
        payload = {
            "measured": total,
            "ceiling": ceiling,
            "delta": delta,
            "measured_files": file_count,
            "baseline_files": baseline.get("measured_files"),
            # The SPLIT is reported even when no db ceiling is recorded, so a reader
            # can always see how much of the number is immovable.
            "db": db_total,
            "non_db": non_db_total,
            "db_ceiling": db_ceiling,
            "db_delta": db_delta,
            "non_db_delta": non_db_delta,
            "ok": delta <= 0 and (db_delta is None or db_delta <= 0)
                  and (non_db_delta is None or non_db_delta <= 0),
        }
        print(json.dumps(payload, indent=2))
    else:
        if delta > 0:
            print(f"verify-core-size: measured {total} vs ceiling {ceiling} (+{delta} lines)", file=sys.stderr)
        else:
            print(f"verify-core-size: measured {total} vs ceiling {ceiling} ({delta} lines, headroom {-delta})")
        # Always print the split: 67.7% of this number cannot ever move, and a reader
        # who does not know that will read every raise as drift.
        line = f"  split: db {db_total}"
        if split:
            line += f" (ceiling {db_ceiling}, {db_delta:+d})"
        line += f" + non-db {non_db_total}"
        if split:
            line += f" (ceiling {non_db_ceiling}, {non_db_delta:+d})"
        print(line)

    if delta > 0:
        return fail(
            f"kasirmu-core grew by {delta} production line(s) above the {ceiling}-line ceiling. "
            "Extract the new logic into its module, or lower the ceiling deliberately by editing "
            f"{_rel(baseline_path, root)} in a commit that says why."
        )
    # ADR-67: the db budget is graded separately, with its own message. "Extract it into
    # its module" is advice that cannot apply to one `impl Store` surface, so a rise here
    # is SQL debt rather than a modularity regression and the gate should say so.
    if db_delta is not None and db_delta > 0:
        return fail(
            f"kasirmu-core db/ grew by {db_delta} production line(s) above its {db_ceiling}-line "
            "budget. That layer is one `impl Store` surface and cannot be extracted into a "
            "module (ADR-67), so a rise here is SQL debt: raise db_ceiling in "
            f"{_rel(baseline_path, root)} in a commit that says why."
        )
    # The MODULARITY budget, and this is the one Phase 3 P3.4 actually describes: everything
    # outside db/ is logic that COULD live in a module, so a rise here is the failure the
    # ratchet was built to catch. Perturbing non_db_ceiling by 1 was measured to pass this
    # gate before this branch existed -- the split reported the breach and then graded only
    # the db half, which would have made the whole split decorative.
    if non_db_delta is not None and non_db_delta > 0:
        return fail(
            f"kasirmu-core (outside db/) grew by {non_db_delta} production line(s) above its "
            f"{non_db_ceiling}-line budget. This is the population Phase 3 P3.4 polices: logic "
            "that could live in a module landing back in core. Extract it into its module, or "
            f"raise non_db_ceiling in {_rel(baseline_path, root)} in a commit that says why."
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
        total, files, _, db_total, non_db = measure(root)
        check("temp tree counts only production", total, 2)
        check("temp tree file count", files, 1)
        # ADR-67 SPLIT: a file under db/ lands in the db bucket, everything else does not,
        # and the two always partition the total. The partition is the property that keeps
        # the split honest -- if the buckets ever failed to sum to `total`, one of them
        # would be graded against a number it does not describe.
        dbdir = base / "db"
        dbdir.mkdir()
        (dbdir / "thing.rs").write_text(
            "pub fn c() {}\npub fn d() {}\npub fn e() {}\n", encoding="utf-8"
        )
        total2, _, _, db2, non2 = measure(root)
        check("a db/ file counts in the db bucket", db2, 3)
        check("and not in the non-db bucket", non2, 2)
        check("the two buckets partition the total", db2 + non2, total2)

    # THE EXIT CODE ITSELF, and the reporter behind it. Every case above grades a RULE;
    # none of them ran fail(), so blanking fail() to "return None" left this self-test
    # green (found by scripts/sabotage-selftests.py, 2026-10-23). It is not cosmetic:
    # main() ends "return fail(...)" for a violation and an uncaught "raise SystemExit(None)"
    # exits 0, so a finding would have printed FAIL and exited success. Capture the
    # function's answer and its stream.
    import io
    from contextlib import redirect_stderr

    sink = io.StringIO()
    with redirect_stderr(sink):
        answer = fail("planted violation")
    check("fail() reports to stderr", "planted violation" in sink.getvalue(), True)
    check("fail() answers exit 1", answer, 1)

    # r181: main()'s shell -- argv and root graded against a tempdir fixture
    # carrying the measured tree AND the baseline, the r166..r180 pattern.
    # --emit-baseline must write the FIXTURE's baseline; --root is left None
    # in every case on purpose (the explicit argv rule), so the root
    # PARAMETER is the redirect under test.
    def _shell(files, argv=None, check=None):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            for rel, content in files.items():
                dst = base / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding="utf-8")
            out, err = io.StringIO(), io.StringIO()
            with redirect_stderr(err), redirect_stdout(out):
                rc = main(argv=[] if argv is None else argv, root=base)
            # the caller's post-condition checks must run INSIDE this context:
            # after the with-block the tempdir is already deleted (the r180
            # lesson, learned twice now).
            extra = check(base) if check is not None else None
            return rc, out.getvalue() + err.getvalue(), extra
    from contextlib import redirect_stdout
    PROD = "crates/kasirmu-core/src/prod.rs"
    BUD = {"schema_version": 1, "ceiling": 3, "db_ceiling": 0,
           "non_db_ceiling": 3, "measured_files": 1}
    rc, text, _b = _shell({PROD: "pub fn a() {}\npub fn b() {}\npub fn c() {}\n",
                           "scripts/core-size-baseline.json": json.dumps(BUD)})
    check("a tree at its ceiling exits 0", rc, 0)
    check("the ceiling report mentions headroom", "headroom 0" in text, True)
    rc, text, _b = _shell({PROD: "pub fn a() {}\npub fn b() {}\npub fn c() {}\npub fn d() {}\n",
                           "scripts/core-size-baseline.json": json.dumps(BUD)})
    check("one line over the ceiling exits 1", rc, 1)
    check("the over-ceiling report names the delta", "+1 lines" in text, True)
    # whole-crate ceiling raised to 4 so ONLY the db arm can fire -- with
    # BUD (ceiling 3) the generic over-ceiling branch returns first.
    BUD_DB = {**BUD, "ceiling": 4}
    rc, text, _b = _shell({"crates/kasirmu-core/src/db/store.rs": "pub fn a() {}\npub fn b() {}\npub fn c() {}\npub fn d() {}\n",
                           "scripts/core-size-baseline.json": json.dumps(BUD_DB)})
    check("a db/ rise is SQL debt, exit 1", rc, 1)
    check("the db report says it cannot be extracted", "cannot be extracted" in text, True)
    rc, text, _b = _shell({PROD: "pub fn a() {}\n"})
    check("a missing baseline fails with advice", rc, 1)
    check("the missing-baseline report names the fix", "run --emit-baseline" in text, True)
    def _emit_wrote_fixture(base):
        dst = base / "scripts" / "core-size-baseline.json"
        if not dst.is_file():
            return None
        return json.loads(dst.read_text(encoding="utf-8"))["ceiling"]
    rc, text, ceiling = _shell({PROD: "pub fn a() {}\npub fn b() {}\n",
                                "scripts/core-size-baseline.json": "{}"},
                               argv=["--emit-baseline"],
                               check=_emit_wrote_fixture)
    check("--emit-baseline exits 0", rc, 0)
    check("--emit-baseline writes the FIXTURE's baseline", ceiling, 2)

    if failures:
        print(f"verify-core-size --self-test: {failures}/{cases} FAILED", file=sys.stderr)
        return 1
    print(f"verify-core-size --self-test: {cases}/{cases} passed")
    # r276: the ladder must be CALLED, not merely defined. r263 measured the
    # failure this guards against -- a ladder that existed, satisfied a reader
    # grepping for it, and never ran. The rule cases above are unchanged; this
    # line is where they become rungs.
    return shell_ladder()


#: Re-entry guard: a rung that drives a nested --self-test must not start a
#: second ladder recursively.
_LADDER_RUNNING = False


def shell_ladder() -> int:
    """The rung ladder: every rung drives main() over a synthetic root.

    WHY A LADDER AND NOT MORE RULE CASES. The cases in self_test() grade
    helpers -- mask_comments_and_strings, strip_test_modules, is_test_file,
    measure, fail. Not one of them grades the thing this gate is FOR: that
    main(), handed a root, grades THAT root and answers with a verdict about
    it. A checker whose main() ignores its root passes every rule case above
    and then grades the developer's own checkout in production -- the exact
    defect rounds r265..r275 found in five sibling checkers.

    RUNG 1 IS THE KILLING RUNG, and it must kill on a VERDICT rather than on a
    refusal (the r274 lesson). The fixture sits one line OVER its ceiling, so a
    correct main() exits 1 naming the fixture's own delta. A root-blind main()
    reads this checkout instead, which sits exactly at its own ceiling, and
    exits 0 -- so the rung fails because the ANSWER is wrong, not because the
    mutant could not start. Rung 1 asserts the absence of refusal text as well
    as the presence of the verdict, so a future edit cannot quietly convert the
    kill back into a scope refusal.

    Rung 2 is the positive floor: a fixture AT its ceiling must exit 0, so an
    arm that always answers 1 dies here instead of passing rung 1 by accident.
    """
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        return 0
    _LADDER_RUNNING = True
    try:
        return _ladder_body()
    finally:
        _LADDER_RUNNING = False


def _ladder_body() -> int:
    import io
    import tempfile
    from contextlib import redirect_stderr, redirect_stdout

    cases = 0
    failures = 0

    def rung(name: str, got, want) -> None:
        nonlocal cases, failures
        cases += 1
        if got != want:
            failures += 1
            print(f"  x {name}: got {got!r}, want {want!r}", file=sys.stderr)

    PROD = "crates/kasirmu-core/src/prod.rs"
    DBF = "crates/kasirmu-core/src/db/store.rs"

    def budget(ceiling, db_ceiling=0, non_db_ceiling=None):
        return json.dumps({
            "schema_version": 1,
            "ceiling": ceiling,
            "db_ceiling": db_ceiling,
            "non_db_ceiling": ceiling if non_db_ceiling is None else non_db_ceiling,
            "measured_files": 1,
        })

    def run(files, argv=None):
        """Drive main() over a tempdir fixture; return (rc, combined output).

        THE BASELINE IS PASSED AS AN ABSOLUTE --baseline-file, and that is the
        whole mechanism of rung 1. Measured 2026-11-11: with the baseline left
        at its default (root / scripts / BASELINE_NAME), a root-blind main()
        resolves root to the MUTANT's own parent directory -- a temp dir with no
        scripts/ in it -- and main() then CRASHES on write_text instead of
        returning a verdict. A rung that kills on a crash has not shown that it
        detects the defect (the r274 rule). An absolute baseline path is read
        the same way by a correct main and by a root-blind one, so the mutant
        still reaches the grading code and answers about the WRONG TREE.

        The root PARAMETER is the redirect under test, so --root is never passed
        in argv. Everything the caller asserts on is returned as text, because
        the tempdir is gone once this returns (the r180 lesson).
        """
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            for rel, content in files.items():
                dst = base / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding="utf-8")
            baseline = base / "scripts" / BASELINE_NAME
            if not baseline.is_file():
                baseline.parent.mkdir(parents=True, exist_ok=True)
                baseline.write_text(budget(0), encoding="utf-8")
            call = ["--baseline-file", str(baseline)] + ([] if argv is None else argv)
            out, err = io.StringIO(), io.StringIO()
            with redirect_stderr(err), redirect_stdout(out):
                rc = main(argv=call, root=base)
            return rc, out.getvalue() + err.getvalue()

    # RUNG 1 -- the KILLING rung, and it must kill on a VERDICT (the r274 rule).
    # The fixture sits one line OVER its ceiling, so a correct main() exits 1
    # naming the fixture's own delta. A root-blind main() grades THIS checkout
    # instead, which sits exactly at its own ceiling, and exits 0 -- so the rung
    # fails because the ANSWER is wrong, not because the mutant could not start.
    # The refusal assertions below keep a future edit from quietly converting
    # the kill back into a crash or a scope refusal.
    rc, text = run({PROD: "pub fn a() {}\npub fn b() {}\npub fn c() {}\npub fn d() {}\n",
                    "scripts/core-size-baseline.json": budget(3)})
    rung("rung 1: an over-ceiling fixture exits 1", rc, 1)
    rung("rung 1: the verdict names the fixture's delta", "+1 lines" in text, True)
    rung("rung 1: the kill is a verdict, not a refusal",
         any(m in text for m in ("baseline missing", "cannot read", "No such file",
                                 "Traceback")), False)

    # RUNG 2 -- the positive floor. At the ceiling, exit 0. An arm that always
    # answers 1 dies here instead of passing rung 1 by accident.
    rc, text = run({PROD: "pub fn a() {}\npub fn b() {}\npub fn c() {}\n",
                    "scripts/core-size-baseline.json": budget(3)})
    rung("rung 2: a fixture at its ceiling exits 0", rc, 0)
    rung("rung 2: the report says headroom 0", "headroom 0" in text, True)

    # RUNG 3 -- the fixture's own ceiling is honoured. Same tree, two different
    # ceilings: 2 passes, 1 fails. A main() reading a constant baseline would
    # answer the same way both times.
    tree = {PROD: "pub fn a() {}\npub fn b() {}\n"}
    rc_pass, _ = run({**tree, "scripts/core-size-baseline.json": budget(2)})
    rc_fail, _ = run({**tree, "scripts/core-size-baseline.json": budget(1)})
    rung("rung 3: the fixture's own ceiling is honoured (at)", rc_pass, 0)
    rung("rung 3: the fixture's own ceiling is honoured (over)", rc_fail, 1)

    # RUNG 4 -- the db/ budget fires its OWN message. The whole-crate ceiling is
    # raised so only the db arm can fire; ADR-67 says a db rise is SQL debt and
    # must not be reported as a modularity regression.
    rc, text = run({DBF: "pub fn a() {}\npub fn b() {}\npub fn c() {}\npub fn d() {}\n",
                    "scripts/core-size-baseline.json": budget(4, db_ceiling=3, non_db_ceiling=0)})
    rung("rung 4: a db/ rise exits 1", rc, 1)
    rung("rung 4: the db report says it cannot be extracted",
         "cannot be extracted" in text, True)

    # RUNG 5 -- the MODULARITY budget, the population Phase 3 P3.4 polices.
    # Perturbing non_db_ceiling by 1 was measured to pass this gate before the
    # branch existed, which would have made the whole split decorative.
    rc, text = run({PROD: "pub fn a() {}\npub fn b() {}\npub fn c() {}\n",
                    "scripts/core-size-baseline.json": budget(3, db_ceiling=0, non_db_ceiling=2)})
    rung("rung 5: a non-db rise exits 1", rc, 1)
    rung("rung 5: the report names the modularity population",
         "could live in a module" in text, True)

    # RUNG 6 -- a missing baseline fails with the fix, not a traceback.
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        dst = base / PROD
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text("pub fn a() {}\n", encoding="utf-8")
        missing = base / "scripts" / BASELINE_NAME
        out, err = io.StringIO(), io.StringIO()
        with redirect_stderr(err), redirect_stdout(out):
            rc = main(argv=["--baseline-file", str(missing)], root=base)
        text = out.getvalue() + err.getvalue()
    rung("rung 6: a missing baseline exits 1", rc, 1)
    rung("rung 6: the report names the fix", "run --emit-baseline" in text, True)

    # RUNG 7 -- --emit-baseline writes the FIXTURE's baseline, not this
    # checkout's. The post-condition runs inside the fixture's lifetime.
    with tempfile.TemporaryDirectory() as td:
        base = Path(td)
        dst = base / PROD
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text("pub fn a() {}\npub fn b() {}\n", encoding="utf-8")
        scripts = base / "scripts"
        scripts.mkdir(parents=True, exist_ok=True)
        written_path = scripts / BASELINE_NAME
        written_path.write_text("{}", encoding="utf-8")
        out, err = io.StringIO(), io.StringIO()
        with redirect_stderr(err), redirect_stdout(out):
            rc = main(argv=["--emit-baseline", "--baseline-file", str(written_path)], root=base)
        written = json.loads(written_path.read_text(encoding="utf-8"))
    rung("rung 7: --emit-baseline exits 0", rc, 0)
    rung("rung 7: --emit-baseline writes the FIXTURE's ceiling", written.get("ceiling"), 2)

    if failures:
        print(f"verify-core-size ladder: {failures}/{cases} rung(s) FAILED", file=sys.stderr)
        return 1
    print(f"verify-core-size ladder: {cases}/{cases} rungs passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
