#!/usr/bin/env bash
# scripts/lint-i18n.sh — local i18n quality gate.
#
# Runs as the `i18n Quality Gate` job in `.github/workflows/dev-ci.yml` — the
# only live workflow that runs THIS gate, not the only live workflow: android.yml
# and website.yml are live too (ls .github/workflows/*.yml). It previously ran inside
# `ci.yml`, which 23c96330 retired
# to `ci.yml.bak` without a replacement; the step was restored after the Fluent
# page audit, because in between the only enforcement was the opt-in local
# pre-commit hook (core.hooksPath is set by scripts/setup-dev.ps1 and is not
# versioned, so a fresh clone gets no gate at all).
#
# Reports three categories of regressions. ALL THREE fail-closed
# (each drives the script's exit code):
#   1. `[i18n]` — translation completeness tests in
#      `ui/src/__tests__/i18nBundle.test.tsx` flag any .id.ftl file
#      that is byte-identical to its .ftl sibling (Indonesian users
#      see English text on those screens).
#   2. `Attempt to override an existing message` — FluentBundle
#      warns when two .ftl files in the same joined bundle define
#      the same key; the first loaded file wins silently, the
#      duplicate is dropped.
#   3. Parity: every literal Fluent key reference must have a
#      matching key in BOTH the en .ftl AND the id .id.ftl. Since the
#      Fluent page audit this covers `getString()`,
#      `requiredLocalized()`, `registerNavItem` i18nKey and
#      `SECTION_LABELS`, across features + components + frontend +
#      contexts + hooks + platform (see `--full-census` in
#      `scripts/verify-bundle-parity.py`). The rev-1 features-only
#      `<Localized id>` walk reported clean while 14 keys shipped
#      broken.
#
# Usage:  bash scripts/lint-i18n.sh
#         (run from any directory)
#
# Exits 0 only when all three categories are clean; 1 otherwise, with a
# categorized error report on stderr.

set -uo pipefail

cd "$(dirname "$0")/.."

# ── Pre-flight: bundle parity (FAIL-CLOSED since the Fluent audit) ───
#
# Sentinel-grep on the parity script's always-last stdout line
# `verify-bundle-parity: <N> missing key(s).` — robust to bucket
# renames / additions.
#
# Promoted from informational to a gate, exactly as the rev-1 comment
# prescribed ("Promote — once --report-only reports 0 missing — by
# dropping --report-only AND adding `exit 1` inside the `if grep -q`
# block"). The promotion is safe because the census reached 0 missing
# once the 14 phantom keys found by the page audit landed.
#
# Scope is now `--full-census`, not the rev-1 features-only
# <Localized> walk. The narrower scan reported "0 missing key(s)" while
# 14 keys shipped broken, because it could not see getString(),
# requiredLocalized(), registerNavItem i18nKey, or anything outside
# ui/src/features/** — including the shared chrome every page renders.
OUT=$(mktemp)
PARITY_OUT=$(mktemp)
trap 'rm -f "$OUT" "$PARITY_OUT"' EXIT
python3 scripts/verify-bundle-parity.py --full-census > "$PARITY_OUT" 2>&1
if grep -qE '^verify-bundle-parity: [1-9][0-9]* missing' "$PARITY_OUT"; then
    cat "$PARITY_OUT" >&2
    echo "" >&2
    echo "error: bundle parity — a literal Fluent key resolves in neither .ftl bundle (or only one). See verify-bundle-parity.py output above." >&2
    exit 1
fi

# Targeted: i18nBundle.test.tsx is the sole source of `[i18n]`
# warnings and triggers `getBundle('en')` + `getBundle('id')` which
# emit Fluent `Attempt to override` warnings once per duplicate key
# per locale. Running targeted keeps the lint under 2 seconds —
# important for pre-commit ergonomics.
VITEST_EXIT=0
(cd ui && npx vitest run src/__tests__/i18nBundle.test.tsx 2>&1) > "$OUT" || VITEST_EXIT=$?

untranslated=$(grep -E '\[i18n\]' "$OUT" || true)
duplicates=$(grep -E 'Attempt to override an existing message' "$OUT" || true)

if [ -z "$untranslated$duplicates" ]; then
    # If vitest itself failed (OOM, config error, etc.) but produced no
    # i18n warnings, still fail — the test infrastructure is broken.
    if [ "$VITEST_EXIT" -ne 0 ]; then
        echo "i18n lint: vitest infrastructure failure (exit $VITEST_EXIT) — no i18n issues detected but the test runner crashed." >&2
        cat "$OUT" >&2
        exit 1
    fi
    echo "i18n lint: no issues detected."
    exit 0
fi

echo "i18n lint: issues detected" >&2
if [ -n "$untranslated" ]; then
    echo "" >&2
    echo "  Untranslated .id.ftl files (Indonesian users see English text):" >&2
    echo "$untranslated" | sed -E 's/^\[i18n\] */    - /' >&2
fi
if [ -n "$duplicates" ]; then
    echo "" >&2
    echo "  Fluent key duplicates (consolidate into a single home .ftl file):" >&2
    echo "$duplicates" | sed -E 's/.*"([^"]+)".*/    - \1/' | sort -u >&2
fi
exit 1
