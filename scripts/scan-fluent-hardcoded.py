#!/usr/bin/env python3
"""Per-page Fluent health scanner for OZ-POS ui/ (rev 2).

rev 1 counted every English JSX text node as a violation, which is wrong:
`<Localized id="k"><th>Assigned Tax Rates</th></Localized>` is the project's
correct fallback pattern. rev 2 removes every <Localized>...</Localized>
subtree before scanning, so what remains is genuinely un-localized copy.

Read-only. Emits JSON + a TSV worksheet to --out.
"""
# Promoted from the 2026-09-03 Fluent page audit; see
# docs/records/fluent-page-audit.md for why this check exists.

from __future__ import annotations

import json
import re
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

# Repo root, script-relative: scripts/ sits one level below it, so the tool
# works from any directory and never anchors to one checkout (AGENTS.md).
ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "ui" / "src"
# Output defaults to the OS temp dir, NOT the working tree: an earlier
# version defaulted to cwd and silently dropped fluent_scan.json and
# hardcoded_hits.tsv into the repo root. Pass a directory to override.
#
# "Pass a directory" was itself a trap, though: sys.argv[1] became the output
# path with no validation, and OUT.mkdir(parents=True) never objects to a name
# that starts with a dash. So any unknown flag silently became a directory in
# the working tree. `scan-fluent-hardcoded.py --help` -- which this script does
# not implement -- created ./--help/ and wrote both outputs into it, and so did
# `--json`. Both landed as untracked entries in a repo where several agents
# commit concurrently, which is exactly how the cwd default got committed once
# already. Reject flag-shaped arguments rather than honouring them.
_args = sys.argv[1:]
_flags = [a for a in _args if a.startswith("-")]
if _flags:
    print(
        f"scan-fluent-hardcoded: unknown argument(s): {', '.join(_flags)}\n"
        "  this script takes at most one argument: an output DIRECTORY.\n"
        "  there is no --help and no --json. It always writes fluent_scan.json and\n"
        "  hardcoded_hits.tsv into the output dir and prints a summary to stdout.",
        file=sys.stderr,
    )
    raise SystemExit(2)
if len(_args) > 1:
    print(
        f"scan-fluent-hardcoded: expected at most one output directory, got: {_args}",
        file=sys.stderr,
    )
    raise SystemExit(2)
OUT = Path(_args[0]).resolve() if _args else Path(tempfile.gettempdir()) / "fluent-scan"
OUT.mkdir(parents=True, exist_ok=True)

KEY_LINE = re.compile(r"^([-a-zA-Z][a-zA-Z0-9_-]*)\s*=")


def ftl_keys(pattern: str) -> set[str]:
    keys: set[str] = set()
    for f in sorted((UI / "locales").glob(pattern)):
        if pattern == "*.ftl" and f.name.endswith(".id.ftl"):
            continue
        for line in f.read_text(encoding="utf-8").splitlines():
            m = KEY_LINE.match(line)
            if m:
                keys.add(m.group(1))
    return keys


EN_KEYS = ftl_keys("*.ftl")
ID_KEYS = ftl_keys("*.id.ftl")

RE_LOCALIZED_LITERAL = re.compile(
    r"<Localized\b[^>]*?\bid\s*=\s*(['\"])(?P<id>[^'\"]+)\1", re.DOTALL
)
RE_LOCALIZED_PROGRAMMATIC = re.compile(r"<Localized\b[^>]*?\bid\s*=\s*\{", re.DOTALL)
RE_GETSTRING = re.compile(r"\.getString\(\s*(['\"])(?P<id>[^'\"]+)\1")
RE_GETSTRING_TEMPLATE = re.compile(r"\.getString\(\s*`")
RE_REQUIRED_LOCALIZED = re.compile(r"\brequiredLocalized\(")
RE_USEL10N = re.compile(r"\buseLocalization\(")

RE_JSX_TEXT = re.compile(r">\s*([A-Za-z][^<>{}\n]{0,90}?)\s*<")
USER_ATTRS = "aria-label|aria-labelledby|aria-description|placeholder|title|alt|label|tooltip|summary|caption"
RE_ATTR_LITERAL = re.compile(rf"\b({USER_ATTRS})\s*=\s*\"([^\"]+)\"")
RE_ATTR_EXPR_STR = re.compile(rf"\b({USER_ATTRS})\s*=\s*\{{\s*\"([^\"]+)\"\s*\}}")
def find_getstring_fallbacks(src):
    """Yield (start, snippet) for each `.getString(...)` followed by a `||` / `??` fallback.

    Replaces RE_OR_FALLBACK's `\\.getString\\([^)]*\\)`, whose `[^)]*` stops at the FIRST
    ')' even when that paren belongs to a nested call. The capture then ends early, `\\)`
    matches an inner paren, and the text after it is not `||` -- so the site is invisible.
    That was not hypothetical: MenuEngineeringScreen.tsx:298,

        return l10n.getString(recKey(q)) || QUADRANT_META[q].label;

    is a real hardcoded-fallback violation the gate never reported, and 74 of the 1549
    `.getString(` calls in this repo contain a nested paren, so the blind spot was wide.
    Counting parens fixes it at any depth.
    """
    for m in re.finditer(r"\.getString\s*\(", src):
        depth, j = 1, m.end()
        while j < len(src) and depth:
            c = src[j]
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
            j += 1
        if depth:  # unbalanced; not our problem
            continue
        tail = re.match(r"\s*(?:\|\||\?\?)", src[j:])
        if tail:
            yield m.start(), src[m.start():j + tail.end()].strip()
RE_INVOKE = re.compile(r"(?<![\w.])invoke\s*(?:<[^<>]*>)?\s*\(")
# Imperative user-facing surfaces: toasts / alerts / direct error state.
RE_TOAST = re.compile(
    r"\b(?:toast(?:\.\w+)?|alert|confirm|notification(?:\.\w+)?)\(\s*(['\"])(?P<v>[^'\"]{2,})\1"
)
RE_SET_ERROR_LITERAL = re.compile(
    r"\bset[A-Za-z0-9_]*(?:Error|Message|Notice|Warning|Toast)\(\s*(['\"])(?P<v>[^'\"]{2,})\1"
)

RE_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
RE_LINE_COMMENT = re.compile(r"//[^\n]*")

# Acronyms, units, numbers and code fragments are not translatable copy.
TECH_OK = re.compile(
    r"^(?:[\d\s.,:%/\-–—+*#&()]+$|[\d.,]+\d|"
    r"[A-Z]{2,6}s?|\d+(?:st|nd|rd|th)|v\d[\w.]*|0x[0-9a-fA-F]+)$"
)
# Code-ish fragments that leak through the JSX-text regex (ternaries, generics).
CODEISH = re.compile(r"(?:&&|\|\||===|!==|=>|\?\?|\?\.$|[(){};]|^\s*[TUKV]\b|^void\b|^Promise\b|^Math\.)")
CODE_WORDS = {"void", "null", "undefined", "true", "false", "T", "R", "K", "V", "U", "Promise", "Math"}
KEYISH = re.compile(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$")


def strip_comments(src: str) -> str:
    src = RE_BLOCK_COMMENT.sub(lambda m: "\n" * m.group(0).count("\n"), src)
    return RE_LINE_COMMENT.sub("", src)


def blank_localized_subtrees(src: str) -> str:
    """Replace <Localized ...>...</Localized> spans with newlines.

    The children of a <Localized> element are intentional English fallback
    content, not violations. Nested Localized elements are handled by depth
    counting. Self-closing <Localized id=... /> spans are blanked too.
    """
    out = list(src)
    i = 0
    n = len(src)
    while True:
        start = src.find("<Localized", i)
        if start == -1:
            break
        # Find the end of the opening tag.
        j = start + len("<Localized")
        depth_quote = None
        while j < n:
            c = src[j]
            if depth_quote:
                if c == depth_quote:
                    depth_quote = None
            elif c in "\"'":
                depth_quote = c
            elif c == ">":
                break
            j += 1
        if j >= n:
            i = start + 1
            continue
        if src[j - 1] == "/":  # self-closing
            end = j + 1
        else:
            depth = 1
            k = j + 1
            while k < n and depth:
                if src.startswith("</Localized>", k):
                    depth -= 1
                    k += len("</Localized>")
                    if depth == 0:
                        break
                    continue
                if src.startswith("<Localized", k):
                    # skip a nested opening tag, honouring self-close
                    m2 = k + len("<Localized")
                    q = None
                    while m2 < n:
                        c2 = src[m2]
                        if q:
                            if c2 == q:
                                q = None
                        elif c2 in "\"'":
                            q = c2
                        elif c2 == ">":
                            break
                        m2 += 1
                    if m2 < n and src[m2 - 1] != "/":
                        depth += 1
                    k = m2 + 1
                    continue
                k += 1
            end = k
        for x in range(start, min(end, n)):
            if out[x] != "\n":
                out[x] = " "
        i = end
    return "".join(out)


def looks_like_copy(value: str) -> bool:
    v = " ".join(value.split())
    if not v or TECH_OK.match(v) or CODEISH.search(v):
        return False
    if KEYISH.match(v):
        return False
    if not re.search(r"[A-Za-z]", v):
        return False
    if v in CODE_WORDS:
        return False
    # Single lowercase word with no spaces is almost always an enum/class value.
    if " " not in v and v == v.lower():
        return False
    return True


def line_of(src: str, idx: int) -> int:
    return src.count("\n", 0, idx) + 1


SKIP_DIRNAME = {"__tests__", "node_modules", "dist"}


def iter_source_files():
    for p in sorted(UI.rglob("*.tsx")) + sorted(UI.rglob("*.ts")):
        rel = p.relative_to(UI).as_posix()
        if any(part in SKIP_DIRNAME for part in p.parts):
            continue
        if p.name.endswith((".test.tsx", ".test.ts", ".d.ts", ".stories.tsx")):
            continue
        yield p, rel


def scope_of(rel: str) -> str:
    top = rel.split("/", 1)[0]
    return top if top in ("features", "components", "frontend", "platform", "hooks", "contexts", "api") else "other"


METRICS: dict[str, dict] = {}
HITS: dict[str, list[dict]] = {}

for path, rel in iter_source_files():
    raw = path.read_text(encoding="utf-8")
    src = strip_comments(raw)
    scan_src = blank_localized_subtrees(src)

    lit_ids = [m.group("id") for m in RE_LOCALIZED_LITERAL.finditer(src)]
    prog = len(RE_LOCALIZED_PROGRAMMATIC.findall(src))
    gs_ids = [m.group("id") for m in RE_GETSTRING.finditer(src)]
    gs_tmpl = len(RE_GETSTRING_TEMPLATE.findall(src))
    req_loc = len(RE_REQUIRED_LOCALIZED.findall(src))

    hits: list[dict] = []
    # JSX text nodes only exist in .tsx; in .ts the `>...<` regex collides with
    # generic type arguments (loggedInvoke<T>(...) → false "copy").
    if path.suffix == ".tsx":
        for m in RE_JSX_TEXT.finditer(scan_src):
            txt = " ".join(m.group(1).split())
            if looks_like_copy(txt):
                hits.append({"kind": "jsx-text", "line": line_of(scan_src, m.start()), "value": txt})
    for rx in (RE_ATTR_LITERAL, RE_ATTR_EXPR_STR):
        for m in rx.finditer(scan_src):
            val = " ".join(m.group(2).split())
            if looks_like_copy(val):
                hits.append({"kind": f"attr:{m.group(1)}", "line": line_of(scan_src, m.start()), "value": val})
    for rx, kind in ((RE_TOAST, "toast-literal"), (RE_SET_ERROR_LITERAL, "error-state-literal")):
        for m in rx.finditer(scan_src):
            val = " ".join(m.group("v").split())
            if looks_like_copy(val):
                hits.append({"kind": kind, "line": line_of(scan_src, m.start()), "value": val})
    for start, snippet in find_getstring_fallbacks(src):
        hits.append({"kind": "english-fallback", "line": line_of(src, start), "value": snippet[:60]})
    if not rel.startswith(("api/", "utils/")):
        for m in RE_INVOKE.finditer(src):
            hits.append({"kind": "bare-invoke", "line": line_of(src, m.start()), "value": "invoke()"})

    all_ids = lit_ids + gs_ids
    METRICS[rel] = {
        "scope": scope_of(rel),
        "lines": raw.count("\n") + 1,
        "localized": len(lit_ids),
        "localized_programmatic": prog,
        "localized_template_getstring": gs_tmpl,
        "getstring": len(gs_ids),
        "requiredLocalized": req_loc,
        "hardcoded": len(hits),
        "missing_en": sorted({i for i in all_ids if i not in EN_KEYS}),
        "missing_id": sorted({i for i in all_ids if i not in ID_KEYS}),
    }
    if hits:
        HITS[rel] = hits

# ── page inventory ──────────────────────────────────────────────────
RE_REGISTER_BLOCK = re.compile(r"registerPage\s*\(\s*\{", re.DOTALL)


def brace_block(text: str, start: int) -> str:
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return text[start:]


def field(block: str, name: str) -> str | None:
    m = re.search(rf"\b{name}\s*:\s*(?:(['\"])([^'\"]*)\1|([A-Za-z_$][\w.$]*))", block)
    if not m:
        return None
    return m.group(2) if m.group(2) is not None else m.group(3)


def resolve_import(register_rel: str, ident: str, src: str) -> str | None:
    base = (UI / register_rel).parent
    m = re.search(rf"import\s+(?:\w+\s*,\s*)?{re.escape(ident)}\s+from\s+['\"]([^'\"]+)['\"]", src)
    if not m:
        m = re.search(rf"const\s+{re.escape(ident)}\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(['\"]([^'\"]+)['\"]", src)
    if not m:
        return None
    spec = m.group(1)
    cand = UI / spec[2:] if spec.startswith("@/") else (base / spec).resolve()
    for suffix in (".tsx", ".ts", "/index.tsx", "/index.ts"):
        p = Path(str(cand) + suffix)
        if p.exists():
            return p.relative_to(UI).as_posix()
    return cand.relative_to(UI).as_posix() if cand.exists() else None


PAGES: list[dict] = []
for reg in sorted((UI / "features").glob("*/register.tsx")):
    rel_reg = reg.relative_to(UI).as_posix()
    src = strip_comments(reg.read_text(encoding="utf-8"))
    for m in RE_REGISTER_BLOCK.finditer(src):
        block = brace_block(src, m.end() - 1)
        comp_ident = field(block, "component")
        label = field(block, "label")
        PAGES.append({
            "route": field(block, "route"),
            "feature": rel_reg.split("/")[1],
            "component_file": resolve_import(rel_reg, comp_ident, src) if comp_ident else None,
            "label": label,
            "label_is_real_ftl_key": bool(label and label in EN_KEYS),
            "fullscreen": bool(re.search(r"\bfullscreen\s*:\s*true", block)),
        })

by_feature: dict[str, dict] = defaultdict(lambda: defaultdict(int))
for rel, mm in METRICS.items():
    if mm["scope"] != "features":
        continue
    a = by_feature[rel.split("/")[1]]
    a["files"] += 1
    for k in ("lines", "localized", "localized_programmatic", "getstring",
              "requiredLocalized", "hardcoded", "localized_template_getstring"):
        a[k] += mm[k]

chrome: dict[str, dict] = defaultdict(lambda: defaultdict(int))
for rel, mm in METRICS.items():
    if mm["scope"] == "features":
        continue
    c = chrome[mm["scope"]]
    c["files"] += 1
    for k in ("lines", "localized", "getstring", "requiredLocalized", "hardcoded"):
        c[k] += mm[k]

payload = {
    "metrics": METRICS,
    "totals": {
        "source_files": len(METRICS),
        "en_keys": len(EN_KEYS),
        "id_keys": len(ID_KEYS),
        "localized_sites": sum(m["localized"] for m in METRICS.values()),
        "programmatic_sites": sum(m["localized_programmatic"] for m in METRICS.values()),
        "getstring_sites": sum(m["getstring"] for m in METRICS.values()),
        "requiredLocalized_sites": sum(m["requiredLocalized"] for m in METRICS.values()),
        "hardcoded_hits": sum(m["hardcoded"] for m in METRICS.values()),
        "registered_pages": len(PAGES),
    },
    "pages": PAGES,
    "by_feature": {k: dict(v) for k, v in sorted(by_feature.items())},
    "chrome": {k: dict(v) for k, v in sorted(chrome.items())},
    "files_missing_keys": {
        rel: {"missing_en": mm["missing_en"], "missing_id": mm["missing_id"]}
        for rel, mm in METRICS.items()
        if mm["missing_en"] or mm["missing_id"]
    },
    "zero_fluent_feature_files": sorted(
        rel for rel, mm in METRICS.items()
        if mm["scope"] == "features" and mm["lines"] > 120
        and mm["localized"] + mm["getstring"] + mm["requiredLocalized"] == 0
    ),
    "worst_files": sorted(
        ((rel, mm["hardcoded"], mm["localized"] + mm["getstring"] + mm["requiredLocalized"])
         for rel, mm in METRICS.items()),
        key=lambda t: (-t[1], t[2]),
    )[:70],
}
(OUT / "fluent_scan.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")

with (OUT / "hardcoded_hits.tsv").open("w", encoding="utf-8") as fh:
    fh.write("file\tline\tkind\tvalue\n")
    for rel in sorted(HITS):
        for h in sorted(HITS[rel], key=lambda x: x["line"]):
            fh.write(f"{rel}\t{h['line']}\t{h['kind']}\t{h['value'][:90]}\n")

print(json.dumps(payload["totals"], indent=2))
kinds: dict[str, int] = defaultdict(int)
for hs in HITS.values():
    for h in hs:
        kinds[h["kind"]] += 1
print("\nhardcoded hits by kind:")
for k, v in sorted(kinds.items(), key=lambda t: -t[1]):
    print(f"  {k:<24} {v}")
print("\nper-feature rollup (files / Localized / getString / requiredLocalized / hardcoded):")
for f, a in sorted(by_feature.items(), key=lambda t: -t[1]["hardcoded"]):
    print(f"  {f:<18} {a['files']:>3}  {a['localized']:>4}  {a['getstring']:>4}  {a['requiredLocalized']:>4}  {a['hardcoded']:>4}")
print("\nchrome rollup:")
for s, c in sorted(chrome.items()):
    print(f"  {s:<12} files={c['files']:>3} loc={c['localized']:>4} gs={c['getstring']:>4} req={c['requiredLocalized']:>4} hard={c['hardcoded']:>4}")
print(f"\nzero-fluent feature files >120 lines: {len(payload['zero_fluent_feature_files'])}")
for r in payload["zero_fluent_feature_files"]:
    print("  " + r)
