#!/usr/bin/env python3
r"""Generate translator scaffolds for byte-identical .id.ftl bundles.

Why this script exists
----------------------

Per the "no byte-identical" principle documented in ``docs/archived/i18n-todo.md``,
we cannot ship a ``.id.ftl`` that matches its ``.ftl`` sibling verbatim:
that would render English content under the Indonesian locale tag, which
is *worse* than letting Fluent's runtime fallback chain show a yellow
``[i18n]`` warning at the page boundary.

Until translators land actual translations, this script generates a
**scaffold** file that:

1. Injects a per-domain ``# HINT:`` comment at the top of the bundle,
   captured from the ``DOMAIN_HINTS`` table below. The hint is the
   primary translator hand-off signal (covers brand-tone sensitivity,
   placeholder preservation rules, and domain vocabulary).
2. Prepends a configurable sentinel (default ``[TODO] ``) AFTER the
   ``=`` of every FTL key and attribute. Placeholders, select expressions,
   and multiline block strings stay syntactically intact and the structural
   ``.attribute =`` regex remains detectable so downstream parity / lint
   gates still parse the scaffold. The ``# HINT:`` block + sentinel
   prefix guarantee the scaffold is NOT byte-identical to the source.
3. Retains the English source value inline after the sentinel, so the
   translator sees exactly what to overwrite and need not consult the
   ``.ftl`` sibling.

What the script validates before exit
-------------------------------------

The ``validate_scaffold()`` helper enforces five pre-write invariants.
Run with ``--write`` and any failure aborts with a non-zero exit code
*before* touching disk. Without ``--write``, the same checks run as a
dry-run and the script prints a preview, never writes.

Invariants:

1. **Key count match** between source ``.ftl`` and scaffold ``.id.ftl``.
2. **Byte-identical guard**: scaffold text is strictly different from
   source text (asserted via full string compare).
3. **Placeholder parity** per key: count of ``{ $var }`` tokens matches.
4. **Select parity** per key: count of ``{ $var ->`` tokens matches.
5. **Attribute parity** per key: count of ``.attr =`` lines matches.

CLI surface
-----------

::

    python3 scripts/translate-stub.py [options]

Options
~~~~~~~

* ``--bundle=<name>``  Target one bundle (e.g. ``gift-cards``). Omit
  with ``--all`` to process every byte-identical ``.id.ftl``.
* ``--all``            Scaffold every currently-byte-identical bundle.
* ``--write``          Commit the scaffold to ``<bundle>.id.ftl`` on
  disk. Without this flag, the script runs in dry-run mode (default)
  and prints a preview only. Pre-write invariants are enforced either
  way.
* ``--sentinel=<text>`` Override the default ``"[TODO] "`` sentinel.
  Useful for re-running after a translator partial pass.

Exit codes
~~~~~~~~~~

* ``0``  All invariants pass (and, with ``--write``, files written).
* ``1``  Validation failed (any of the five invariants). No files
  modified.
* ``2``  I/O error (file not found, write permission, etc.). No files
  modified.

Stdlib-only. PEP 8. Targets Python 3.10+ (uses PEP 604 union syntax
in type hints; matches the project's pre-existing script baseline)."""

import argparse
import re
import sys
from pathlib import Path

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------

LOCALE_DIR = Path("shared-ui/locales")

# Per-domain translator hand-off guidance. Keys are bundle base names
# (no extension). Values are concrete, actionable hints for the
# translator landing the bundle — not generic good-practice prose.
DOMAIN_HINTS = {
    "gift-cards": (
        "brand-tone sensitive. Avoid literal translations of marketing "
        "copy; consult the brand review team before merging copy that "
        "touches the gift card title or call-to-action labels."
    ),
    "purchasing": (
        "preserve { $id } placeholders verbatim; preserve { $currency } "
        "and { $amount } formatting. Order-line and supplier labels are "
        "operational — direct translation is fine."
    ),
    "stock-counting": (
        "inventory nomenclature. Use standard regional POS terms for "
        "'SKU', 'Diff', and 'Variance'; preserve { $count } and "
        "{ $unit } placeholders."
    ),
    "stock-transfers": (
        "warehouse terminology. Ensure clear distinction between Source "
        "and Destination columns; preserve { $transferId } and "
        "{ $sku } placeholders."
    ),
}

PLACEHOLDER_RE = re.compile(r"\{\s*\$[A-Za-z_][A-Za-z0-9_-]*\s*\}")
SELECT_RE = re.compile(r"\{\s*\$[A-Za-z_][A-Za-z0-9_-]*\s*->")
ATTR_RE = re.compile(r"^\s*\.([A-Za-z_][A-Za-z0-9_-]*)\s*=")
KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*)\s*=")

SENTINEL_DEFAULT = "[TODO] "


# ----------------------------------------------------------------------------
# I/O helpers
# ----------------------------------------------------------------------------


def read_locale(path: Path) -> str:
    """Read a .ftl file, returning its full text. On FileNotFoundError,
    exits with code 2 (I/O error) per the docstring contract."""
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise SystemExit(f"[i18n] missing locale file: {path} ({exc})") from exc
    except OSError as exc:
        raise SystemExit(f"[i18n] I/O error reading {path}: ({exc})") from exc


def is_byte_identical(en_path: Path, id_path: Path) -> bool:
    """True if the .id.ftl sibling matches the .ftl source verbatim."""
    if not id_path.exists():
        return False
    return read_locale(en_path) == read_locale(id_path)


# ----------------------------------------------------------------------------
# Block parser
# ----------------------------------------------------------------------------


def collect_blocks(text: str) -> tuple[list[str], list[tuple[str, list[str]]]]:
    r"""Group FTL text into ``(header_comments, [(key, lines), ...])``.

    ``lines`` per block is the concatenation of the key's own line(s)
    plus any attached attribute lines. Header comments (lines starting
    with ``#`` BEFORE the first key) are returned separately so the
    scaffold prepends its own ``# HINT:`` block without disturbing
    inline translator annotations later in the file.

    Parser-tolerance: a blank line that appears INSIDE a message block
    (e.g. ``shared-ui/locales/purchasing.ftl`` separates ``.placeholder``
    and ``.aria-label`` with a blank line) does NOT end the block. The
    flush helper merges the buffered key + attrs into the previous block
    for the same key on a downstream flush, so orphan attribute lines
    that follow a blank still land under their parent key.
    """
    header_comments: list[str] = []
    blocks: list[tuple[str, list[str]]] = []
    pending_key: str | None = None
    pending_lines: list[str] = []
    pending_attrs: list[str] = []

    def flush_pending() -> None:
        """Emit pending block, merging into the previous block for the
        same key (skipping ``__blank__`` separators) so blank-line-
        separated attribute groups collapse into a single block."""
        if pending_key is None or (not pending_lines and not pending_attrs):
            return
        new_lines = pending_lines + pending_attrs
        last_real_idx = next(
            (
                i
                for i in range(len(blocks) - 1, -1, -1)
                if blocks[i][0] != "__blank__"
            ),
            -1,
        )
        if last_real_idx != -1 and blocks[last_real_idx][0] == pending_key:
            blocks[last_real_idx][1].extend(new_lines)
        else:
            blocks.append((pending_key, new_lines))
        pending_lines.clear()
        pending_attrs.clear()

    for raw in text.splitlines(keepends=True):
        line = raw.rstrip("\n")
        if not line.strip():
            flush_pending()
            blocks.append(("__blank__", []))
            continue
        if line.lstrip().startswith("#"):
            if pending_key is None:
                header_comments.append(raw)
            else:
                pending_lines.append(raw)
            continue
        if ATTR_RE.match(line) and pending_key is not None:
            pending_attrs.append(raw)
            continue
        key_match = KEY_RE.match(line)
        if key_match:
            flush_pending()
            pending_key = key_match.group(1)
            pending_lines = [raw]
            pending_attrs = []
            continue
        if pending_key is not None:
            pending_lines.append(raw)

    flush_pending()
    return header_comments, blocks


# ----------------------------------------------------------------------------
# Scaffolding transformation
# ----------------------------------------------------------------------------


def scaffold_value_line(line: str, sentinel: str) -> str:
    """Insert the sentinel AFTER the first ``=`` of the line, preserving

    - The ``=`` between key (or attribute) name and value, which keeps
      ``KEY_RE`` and ``ATTR_RE`` matches stable for downstream validators.
    - A single space between ``=`` and the sentinel, so the source's
      ``\\s*=`` regex tail is satisfied even when the source had no
      space after ``=``.
    - The English source value inline as a translator cue, after the
      sentinel.
    - Idempotency on re-runs via a sentinel-rstrip presence check.
    """
    eq_index = line.find("=")
    if eq_index == -1:
        # No ``=``; treat the whole line as a free-form value.
        return f"{line.rstrip()} {sentinel}"
    prefix = line[: eq_index + 1].rstrip()  # "..." up to and including "="
    rest = line[eq_index + 1 :].lstrip()
    sentinel_stripped = sentinel.rstrip()
    if rest.startswith(sentinel_stripped):
        return line
    return f"{prefix} {sentinel}{rest}"


def scaffold_bundle(text: str, sentinel: str, hint: str) -> str:
    """Apply the scaffold transformation to a full .ftl text body.

    Header comments are preserved verbatim. A ``# HINT:`` block is
    inserted as the very first content so the translator sees it as
    soon as they open the file.
    """
    header_comments, blocks = collect_blocks(text)
    out_segments: list[str] = []
    out_segments.append("# HINT (auto-generated by translate-stub.py):\n")
    out_segments.append(f"#   {hint}\n")
    out_segments.append(
        f"# Replace each `[TODO]` sentinel below with the actual Indonesian\n"
    )
    out_segments.append(
        f"# translation. Placeholders (e.g. {{ $count }}) and select\n"
    )
    out_segments.append(
        f"# expressions must be preserved verbatim.\n"
    )
    for raw in header_comments:
        out_segments.append(raw)
    for key, lines in blocks:
        if key == "__blank__":
            out_segments.append("\n")
            continue
        for line in lines:
            if not line.strip():
                continue
            if line.lstrip().startswith("#"):
                out_segments.append(line + "\n")
                continue
            out_segments.append(scaffold_value_line(line, sentinel) + "\n")
    return "".join(out_segments)


# ----------------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------------


def validate_scaffold(source_text: str, scaffold_text: str) -> list[str]:
    """Return a list of validation failure messages (empty on success)."""
    failures: list[str] = []

    if scaffold_text == source_text:
        failures.append(
            "byte-identical guard: scaffold matches source verbatim "
            "(would still render English under the id locale)."
        )

    _, src_blocks = collect_blocks(source_text)
    _, tgt_blocks = collect_blocks(scaffold_text)
    src_keys = {k for k, _ in src_blocks if k != "__blank__"}
    tgt_keys = {k for k, _ in tgt_blocks if k != "__blank__"}

    if src_keys != tgt_keys:
        missing = sorted(src_keys - tgt_keys)
        extra = sorted(tgt_keys - src_keys)
        if missing:
            failures.append(f"keys missing in scaffold: {', '.join(missing)}")
        if extra:
            failures.append(f"keys added in scaffold: {', '.join(extra)}")

    for key, lines in src_blocks:
        if key == "__blank__":
            continue
        src_ph = sum(len(PLACEHOLDER_RE.findall(l)) for l in lines)
        src_sel = sum(len(SELECT_RE.findall(l)) for l in lines)
        src_attr = sum(1 for l in lines if ATTR_RE.match(l.lstrip()))
        tgt_lines = next((lns for k, lns in tgt_blocks if k == key), [])
        tgt_ph = sum(len(PLACEHOLDER_RE.findall(l)) for l in tgt_lines)
        tgt_sel = sum(len(SELECT_RE.findall(l)) for l in tgt_lines)
        tgt_attr = sum(1 for l in tgt_lines if ATTR_RE.match(l.lstrip()))
        if src_ph != tgt_ph:
            failures.append(
                f"placeholder drift on `{key}`: src={src_ph} scaffold={tgt_ph}"
            )
        if src_sel != tgt_sel:
            failures.append(
                f"select drift on `{key}`: src={src_sel} scaffold={tgt_sel}"
            )
        if src_attr != tgt_attr:
            failures.append(
                f"attribute drift on `{key}`: src={src_attr} scaffold={tgt_attr}"
            )

    return failures


# ----------------------------------------------------------------------------
# Per-bundle driver
# ----------------------------------------------------------------------------


def process_bundle(
    bundle_name: str,
    write: bool,
    sentinel: str,
    *,
    force_write: bool = False,
) -> tuple[str, int]:
    """Process one bundle; return ``(status, exit_code)``.

    ``status`` is one of: ``"scaffolded"``, ``"scaffolded-force"``,
    ``"skipped-missing-source"``, ``"skipped-non-identical"``,
    ``"skipped-no-hint"``, ``"failed-validation"``,
    ``"refused-write"``, ``"failed-io"``.

    ``exit_code`` is ``1`` for validation failures and ``2`` for both
    I/O failures and the translator-protection refusal (translators can
    match exit ``2`` in CI to detect hand-edit-preserving refusals).
    """
    en_path = LOCALE_DIR / f"{bundle_name}.ftl"
    id_path = LOCALE_DIR / f"{bundle_name}.id.ftl"

    if not en_path.exists():
        print(f"[i18n] {bundle_name}: source missing; skipping.")
        return ("skipped-missing-source", 0)

    if not is_byte_identical(en_path, id_path):
        print(f"[i18n] {bundle_name}: not byte-identical; skipping.")
        return ("skipped-non-identical", 0)

    if bundle_name not in DOMAIN_HINTS:
        print(
            f"[i18n] {bundle_name}: no DOMAIN_HINTS entry; skipping. "
            f"Add a hint to scripts/translate-stub.py before retrying."
        )
        return ("skipped-no-hint", 0)

    source_text = read_locale(en_path)
    scaffold_text = scaffold_bundle(
        source_text, sentinel=sentinel, hint=DOMAIN_HINTS[bundle_name]
    )
    failures = validate_scaffold(source_text, scaffold_text)

    if failures:
        print(
            f"[i18n] validation failed for {bundle_name}:", file=sys.stderr,
        )
        for msg in failures:
            print(f"  - {msg}", file=sys.stderr)
        return ("failed-validation", 1)

    if write:
        # Refuse --write when the target .id.ftl already lacks any
        # TODO sentinel AND is not byte-identical to the source bundle.
        # That combination means a translator has presumably done
        # hand-edits; re-running --write would destroy that work.
        # Translators who want to re-scaffold from scratch should
        # `git checkout` the .id.ftl first OR pass --force-write.
        if id_path.exists() and not force_write:
            existing_text = read_locale(id_path)
            sentinel_stripped = sentinel.rstrip()
            existing_has_todo = sentinel_stripped in existing_text
            existing_is_byte_identical_source = existing_text == source_text
            if (
                not existing_has_todo
                and not existing_is_byte_identical_source
                and existing_text != scaffold_text
            ):
                print(
                    f"[i18n] {bundle_name}: --write refused: existing "
                    f"{id_path} appears translated (no sentinel); "
                    f"`git checkout` {id_path} to reset, or pass "
                    f"--force-write to clobber hand-edits.",
                    file=sys.stderr,
                )
                return ("refused-write", 2)
        try:
            id_path.write_text(scaffold_text, encoding="utf-8")
        except OSError as exc:
            print(
                f"[i18n] I/O error writing {id_path}: ({exc})",
                file=sys.stderr,
            )
            return ("failed-io", 2)
        if force_write and id_path.exists():
            # Manifest audit signal: did this --write clobber an existing
            # translated file (vs. just generating a fresh scaffold over
            # a byte-identical-to-English target)?
            return ("scaffolded-force", 0)
        print(f"[i18n] wrote scaffold: {id_path}")
    else:
        head_lines = scaffold_text.splitlines()[:8]
        print(f"[i18n] {bundle_name}: scaffold preview (first 8 lines)")
        print("\n".join(head_lines))
        print(
            f"[i18n] {bundle_name}: pass --write to commit "
            f"(or --force-write to override translator-protection refusal)."
        )

    return ("scaffolded", 0)


# ----------------------------------------------------------------------------
# Entry point
# ----------------------------------------------------------------------------


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="translate-stub.py",
        description=(
            "Generate translator scaffolds for byte-identical .id.ftl "
            "bundles. Default mode is dry-run (read-only). Pass --write "
            "to commit the scaffold to disk. See scripts/translate-stub.py "
            "docstring for the design rationale."
        ),
    )
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument(
        "--bundle",
        metavar="<name>",
        help="Target one bundle (e.g. gift-cards).",
    )
    target.add_argument(
        "--all",
        action="store_true",
        help="Process every currently-byte-identical bundle.",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help=(
            "Write scaffolds to <bundle>.id.ftl on disk (default: dry-run, "
            "print preview only)."
        ),
    )
    parser.add_argument(
        "--sentinel",
        metavar="<text>",
        default=SENTINEL_DEFAULT,
        help=(
            'Sentinel prefix for untranslated values '
            '(default: "[TODO] ").'
        ),
    )
    parser.add_argument(
        "--force-write",
        action="store_true",
        help=(
            "Override the --write translator-protection guard. By "
            "default `--write` refuses to overwrite an .id.ftl that "
            "appears to have hand-edits (no TODO sentinel + not "
            "byte-identical to source). Pass --force-write to clobber "
            "those edits."
        ),
    )
    return parser.parse_args(argv)


def discover_byte_identical_bundles() -> list[str]:
    candidates: list[str] = []
    for ftl in sorted(LOCALE_DIR.glob("*.ftl")):
        bundle = ftl.stem
        if bundle == "en":
            continue
        id_path = ftl.with_suffix(".id.ftl")
        if is_byte_identical(ftl, id_path):
            candidates.append(bundle)
    return candidates


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    if args.all:
        bundles = discover_byte_identical_bundles()
    else:
        bundles = [args.bundle]

    if not bundles:
        print("[i18n] no byte-identical bundles found.")
        return 0

    worst_exit = 0
    for bundle in bundles:
        _status, exit_code = process_bundle(
            bundle,
            write=args.write,
            sentinel=args.sentinel,
            force_write=args.force_write,
        )
        if exit_code != 0:
            worst_exit = exit_code

    write_mode = "WRITE" if args.write else "DRY-RUN"
    print(
        f"[i18n] {write_mode} processed {len(bundles)} bundle(s); "
        f"worst exit={worst_exit}."
    )
    return worst_exit


if __name__ == "__main__":
    sys.exit(main())
