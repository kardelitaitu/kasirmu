#!/usr/bin/env bash
# Skill drift detection — runs the 7 mechanical checks described in
# .agents/skills/skill-drift-guard/SKILL.md and emits a markdown report.
#
# Usage:
#   ./detect.sh                          # all checks, no patches
#   ./detect.sh --check=paths            # one check only
#   ./detect.sh --auto-patch             # auto-patch safe categories
#   ./detect.sh --report                 # write skill-drift-report.md
#   SKIP=api,golden ./detect.sh          # skip the named checks
#
# Exit code is the number of manual-review findings (0 = clean).

set -u

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Tracks every pairs_file created via mktemp so an EXIT trap cleans
# them up on Ctrl-C / SIGTERM (otherwise the killed run leaks /tmp/tmp.*
# pairs files until the OS purges). Fires on EVERY exit (clean included);
# idempotent because each check already does `rm -f "$pairs_file"` at the
# end, so the array is empty by the time a clean-exit trap fires. The array
# length is well-defined under `set -u` thanks to the `declare -a` above,
# so no `:-0` default is needed.
declare -a PAIRS_FILES=()
trap '[ "${#PAIRS_FILES[@]}" -gt 0 ] && rm -f "${PAIRS_FILES[@]}" 2>/dev/null; true' EXIT

REPORT="skill-drift-report.md"
ONLY_CHECK=""
AUTO_PATCH=false
WRITE_REPORT=false
today="$(date +%d-%m-%y)"

for arg in "$@"; do
  case "$arg" in
    --check=*) ONLY_CHECK="${arg#--check=}" ;;
    --auto-patch) AUTO_PATCH=true ;;
    --report) WRITE_REPORT=true ;;
    --help|-h)
      sed -n '2,12p' "$0"
      exit 0
      ;;
  esac
done

should_run() {
  local name="$1"
  [ -z "$ONLY_CHECK" ] && return 0
  [ "$ONLY_CHECK" = "$name" ] && return 0
  return 1
}

# Categories that can be auto-patched safely
AUTO_PATCH_CATS=("versions" "audit-date" "cross-refs" "missing-crates")

# Audit-footer regex shared by Check 9 (skills) and Check 10 (project docs).
# If you change this line, both call sites stay in sync because they
# reference $AUDIT_RE. This is the SHAPE check only — date VALUE
# (DD 01-31, MM 01-12) is enforced by batch_validate_audit_dates below,
# called by both Check 9 and Check 10. (An earlier revision of this comment
# named two helpers, `audit_date_of` and `is_real_audit_date`, that the
# script never defined; the value check has always been the batched one.)
AUDIT_RE='^> last audited [0-9]{2}-[0-9]{2}-[0-9]{2} by [^[:space:]]+$'

# Shared Python interpreter for date-validity checks (Check 8,
# batch_validate_audit_dates). Resolved once at script start so the
# value-check helper doesn't pay the `command -v` cost per call. Empty
# if neither python3 nor python is on the host — both Check 8 and
# batch_validate_audit_dates fail-closed in that case (Check 8 reports
# the date as stale under `audit-date`; batch_validate_audit_dates
# surfaces every shape-pass date as invalid under `audit-format` /
# `doc-audit` via its internal `awk -F'\t' '{print "INVALID\t" $0}'`
# fallback when PYTHON_BIN is empty), so a missing Python is loudly
# surfaced, never silently passed through.
PYTHON_BIN="$(command -v python3 2>/dev/null || command -v python 2>/dev/null)"
# Smoke-test: some hosts (notably Windows 10/11 with the Microsoft Store
# stub `python3`) expose a path that returns exit 0 but executes nothing.
# That hidden state silently swallows the value check because
# `cut | "$PYTHON_BIN" -c '...'` produces empty output → $res_file empty
# → no FINDINGS written. Demote such stubs to empty so the awk fail-closed
# path correctly surfaces every shape-pass date as INVALID instead of
# silently passing through.

# Amortize the ~100-500ms `python3 -c 'pass'` cold-start on canonical
# real-Python install paths (Linux distro defaults, Homebrew, pyenv,
# python.org macOS framework). The `[ -x ]` pre-flight still cheap-skips
# non-executable stubs (e.g. Windows Store launchers); this positive-list
# extends that to executable-but-known-real installs. Paths not in the
# list fall through to the smoke-test, which catches unknown / venv /
# programmatic installs at the cost of one cold-start per run.
#
# Each pattern is split into `python3` AND `python3.[0-9]*` (NOT a
# single `python3*` glob) so unrelated helpers — `python3m`,
# `python3-config`, `python3-something` — are NOT trusted. Add patterns
# to the case below as new canonical paths surface; keep the list
# short and conservative.
case "$PYTHON_BIN" in
  /usr/bin/python3|/usr/bin/python3.[0-9]*|\
  /usr/local/bin/python3|/usr/local/bin/python3.[0-9]*|\
  /opt/homebrew/bin/python3|/opt/homebrew/bin/python3.[0-9]*|\
  /opt/python*/bin/python3|/opt/python*/bin/python3.[0-9]*|\
  /usr/local/opt/python*/bin/python3|/usr/local/opt/python*/bin/python3.[0-9]*|\
  /home/*/.pyenv/shims/python3|/home/*/.pyenv/shims/python3.[0-9]*|\
  /Users/*/.pyenv/shims/python3|/Users/*/.pyenv/shims/python3.[0-9]*|\
  /Library/Frameworks/Python.framework/Versions/*/bin/python3|\
  /Library/Frameworks/Python.framework/Versions/*/bin/python3.[0-9]*)
    # Canonical real-Python path; trust without smoke-test. The pyenv
    # entries enumerate /home/* and /Users/* explicitly because bash
    # case-patterns do not tilde-expand (literal `~/` would never match
    # real `command -v python3` resolutions on pyenv hosts).
    ;;
  *)
    [ -n "$PYTHON_BIN" ] && [ -x "$PYTHON_BIN" ] \
      && ! "$PYTHON_BIN" -c 'pass' 2>/dev/null \
      && PYTHON_BIN=""
    ;;
esac

# Audit-footer validation helpers (used by Check 9 and Check 10).
# Two-pass validation: $AUDIT_RE catches SHAPE failures (missing fields,
# wrong separators, year prefix), then `batch_validate_audit_dates` catches
# VALUE failures (day/month out of range, invented dates like 00-00-00 /
# 99-99-99) in a single Python call. Both passes fail-closed when Python is
# missing (see $PYTHON_BIN above).

# The line that marks an audit footer. ONE definition, used by both the
# Check 10 prefilter and the per-file scan below: if the prefilter pattern
# ever drifted narrower than the scan's, files would be skipped and findings
# lost silently — the exact failure mode this whole exercise is about.
FOOTER_RE='^> last audited '

# Project-doc *.md files that actually carry an audit footer, newline-separated.
#
# The grep is folded into `find -exec … +` rather than looping per file: only
# ~104 of ~2000 project markdown files have a footer at all, so the old
# one-grep-per-file loop spawned ~1900 empty greps and, on Windows, that
# process-creation cost dominated the whole script (90s for Check 10 alone,
# ~5min for the bats suite — which is why runs kept getting killed).
#
# `-exec … +` is deliberately used instead of `xargs`: it is POSIX, batches
# the same way, and — unlike xargs — never invokes the command when the set is
# empty. BSD/macOS xargs has no `-r`, so there an empty corpus would hand grep
# no file arguments and it would block forever reading stdin.
#
# $FOOTER_RE is shared with the per-file scan below, so the prefilter can
# never drift narrower than the check and silently drop findings.
md_footer_files() {
  find . -name '*.md' \
    -not -path './.git/*' \
    -not -path './.agents/skills/*' \
    -not -path './node_modules/*' \
    -not -path './target/*' \
    -not -path './dist/*' \
    -exec grep -lE "$FOOTER_RE" {} + 2>/dev/null
}

# Batched Python validation for shape-pass audit-footer dates.
# Reads tab-separated pairs from $2 (each line: "<DD-MM-YY>\t<context>"),
# invokes $PYTHON_BIN ONCE on the date column, then appends a FINDINGS[$1]
# entry for every INVALID date using the context as the formatted message.
#
# Fail-closed: PYTHON_BIN empty → every pair is treated as INVALID.
# Empty pairs_file is a no-op (no Python call, no FINDINGS writes).
# The inner while-read uses < <(paste …) so the FINDINGS write happens in
# the parent shell (subshell from `paste | while` would discard the write).
batch_validate_audit_dates() {
  local cat="$1"
  local pairs_file="$2"
  [ ! -s "$pairs_file" ] && return 0
  local res_file
  res_file="$(mktemp)" || return 1
  if [ -z "$PYTHON_BIN" ]; then
    # PYTHON_BIN empty → every date is INVALID (fail-closed).
    awk -F'\t' '{print "INVALID\t" $0}' "$pairs_file" > "$res_file"
  else
    # `| tr -d '\r'` is load-bearing, not cosmetic: a native Windows Python
    # writes CRLF through a pipe, so `read -r res` below yields $'INVALID\r'
    # and the string comparison never matches. Every invented-date footer then
    # validated as CLEAN on Windows — Checks 9/10's VALUE pass was silently
    # dead on that host while the SHAPE pass (pure grep) kept working, which
    # is exactly why only the value-check test caught it.
    cut -f1 "$pairs_file" | "$PYTHON_BIN" -c '
import sys
from datetime import datetime
for line in sys.stdin:
    d = line.strip()
    if not d:
        print("OK")  # empty line — skip without crashing
        continue
    try:
        datetime.strptime(d, "%d-%m-%y")
        print("OK")
    except Exception:
        print("INVALID")
' | tr -d '\r' > "$res_file"
  fi
  # Defensive: normalise CR on the result column too, so a future writer of
  # res_file cannot re-introduce the same silent pass-through.
  while IFS=$'\t' read -r res date context; do
    res="${res%$'\r'}"
    [ "$res" = "INVALID" ] && FINDINGS[$cat]+="${context}"$'\n'
  done < <(paste "$res_file" "$pairs_file" 2>/dev/null)
  rm -f "$res_file"
}

# Validate audit-footer(s) in a single file. Shape violations are appended
# to FINDINGS[$1] inline; shape-pass dates are appended as "<date>\t<context>"
# pairs to $3 so the caller can batch-validate via `batch_validate_audit_dates`.
# Shared by Check 9 (skills) and Check 10 (project docs) so the inner-loop
# logic is defined exactly once — any future tightening to the shape check,
# value check, or FINDINGS message format lands in both call sites for free.
#
# Caller responsibilities: $pairs_file must already be a writable temp file
# (the mktemp + stderr-capture ceremony is inlined per check since each check
# owns its own pairs_file lifecycle); the file must exist on disk ([ -f ] guard
# makes a missing file a no-op rather than a crash).
audit_footer_check_in_file() {
  local cat="$1"
  local file="$2"
  local pairs_file="$3"
  [ -f "$file" ] || return 0
  local line footer date_part
  # IFS= keeps leading whitespace, -r keeps backslashes.
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    # Trailing-whitespace strip as a pure builtin (was `echo | sed`).
    footer="${line%"${line##*[![:space:]]}"}"
    # `[[ =~ ]]` instead of `echo | grep -qE` — same ERE, no subprocess.
    # $AUDIT_RE MUST stay unquoted: quoting it makes bash match it as a
    # literal string, so every footer would "fail" the shape check.
    if [[ ! $footer =~ $AUDIT_RE ]]; then
      FINDINGS[$cat]+="${file}: footer violates DD-MM-YY + by-clause convention: \`${footer}\`"$'\n'
    else
      # A shape-passing footer is exactly `> last audited DD-MM-YY by <who>`,
      # so the date is the one token after the prefix — no grep needed
      # (was: `audit_date_of` → echo | grep -oE | head -1).
      date_part="${footer#> last audited }"
      date_part="${date_part%% *}"
      if [ -n "$date_part" ]; then
        printf '%s\t%s: shape OK but date [%s] is not a real calendar DD-MM-YY: [%s]\n' \
          "$date_part" "$file" "$date_part" "$footer" >> "$pairs_file"
      fi
    fi
  done < <(grep -E "$FOOTER_RE" "$file" 2>/dev/null)
}

# Findings: associative array of category -> lines
declare -A FINDINGS
for cat in paths crates api versions golden refs fluent audit-date audit-format doc-audit; do
  FINDINGS[$cat]=""
done

# ---------------------------------------------------------------------------
# Check 1 — File path inventory
# ---------------------------------------------------------------------------
if should_run paths; then
  while read -r skill; do
    [ -z "$skill" ] && continue
    # Process substitution, NOT `grep | while`: the FINDINGS write must land
    # in the parent shell. A pipeline runs the loop body in a subshell, so
    # `FINDINGS[paths]+=…` there is discarded when the loop exits and the
    # check silently reports clean. Same invariant as
    # batch_validate_audit_dates above.
    while read -r path; do
      case "$path" in
        http*|https*|file://*|node_modules*|target/*|dist/*) continue ;;
      esac
      # Skip regex-truncation artifacts. The extractor has no notion of a
      # glob or an ellipsis, so `crates/oz-*` yields `crates/oz-` and prose
      # like `bash scripts/...` yields `scripts/...`. A real path never ends
      # in `-`, `.` or an ellipsis, so dropping these cannot mask genuine
      # drift — it only stops the check crying wolf on every run.
      case "$path" in
        *[-.]|*...|*..) continue ;;
      esac
      if [ ! -e "$path" ]; then
        # only flag if the path looks like a project path
        case "$path" in
          src*|ui/*|crates/*|migrations/*|hal/*|docs/*|src-tauri/*|.github/*|scripts/*)
            FINDINGS[paths]+="${skill}: ${path}"$'\n'
            ;;
        esac
      fi
    done < <(grep -oE '[a-zA-Z_.-]+(/[a-zA-Z0-9_.-]+){1,}' "$skill" 2>/dev/null | sort -u)
  done < <(find .agents/skills -name SKILL.md 2>/dev/null)
fi

# ---------------------------------------------------------------------------
# Check 2 — Crate inventory
# ---------------------------------------------------------------------------
if should_run crates; then
  : "${Cargo_FILE:=Cargo.toml}"
  if [ -f "$Cargo_FILE" ]; then
    : "$(grep -oE '"crates/oz-[a-z-]+"' "$Cargo_FILE" 2>/dev/null | sort -u | sed 's|"crates/||;s|"||')"
    workspace_crates="$(grep -oE '"crates/oz-[a-z-]+"' "$Cargo_FILE" 2>/dev/null | sort -u | sed 's|"crates/||;s|"||')"
    skill_crates="$(cat .agents/skills/*/SKILL.md | grep -oE 'oz-[a-z-]+' | sort -u)"

    while read -r c; do
      [ -z "$c" ] || [ "$c" = "oz-pos" ] || [[ "$c" = oz-pos-* ]] && continue
      if ! echo "$workspace_crates" | grep -qx "$c"; then
        FINDINGS[crates]+="missing in workspace: ${c}"$'\n'
      fi
    done <<< "$skill_crates"
  fi
fi

# ---------------------------------------------------------------------------
# Check 3 — API signature (lightweight; deep check needs cargo doc)
# ---------------------------------------------------------------------------
if should_run api; then
  # Look for code blocks that call known public functions
  while read -r skill; do
    [ -z "$skill" ] && continue
    # Catch calls to Money::from_major / checked_add / zero so we can flag if any change.
    # Taxonomy #4 is about a skill's CODE EXAMPLE going stale, so scan only inside
    # ``` fences — a bare grep also matched prose that merely names a constructor
    # (e.g. "`#[must_use]` on every Money constructor"), which is not a signature
    # claim and produced a permanent stream of un-actionable findings.
    # `< <(…)` not `grep | while`: see the subshell note in Check 1.
    while read -r line; do
      FINDINGS[api]+="${skill}: ${line} (verify signature in foundation/src/money.rs, re-exported by kasirmu-core/src/money.rs)"$'\n'
    done < <(awk '/^```/{f=!f; next} f && /Money::(from_major|checked_add|zero|new)/{print NR": "$0}' "$skill" 2>/dev/null)
  done < <(find .agents/skills -name SKILL.md 2>/dev/null)
fi

# ---------------------------------------------------------------------------
# Check 4 — Dependency version drift
# ---------------------------------------------------------------------------
if should_run versions; then
  if [ -f "Cargo.toml" ]; then
    while read -r skill; do
      [ -z "$skill" ] && continue
      # `< <(…)` not `grep | while`: see the subshell note in Check 1.
      # This category is also in AUTO_PATCH_CATS, so a swallowed write
      # silently disables that auto-patch path too.
      while read -r ver; do
        # strip quotes
        v="${ver//\"/}"
        # crude: see if this exact version is still in Cargo.toml
        if ! grep -q "$v" Cargo.toml; then
          FINDINGS[versions]+="${skill}: quoted version ${ver} not in Cargo.toml"$'\n'
        fi
      done < <(grep -hoE '"[0-9]+\.[0-9]+(\.[0-9]+)?"' "$skill" 2>/dev/null | sort -u)
    done < <(find .agents/skills -name SKILL.md 2>/dev/null)
  fi
fi

# ---------------------------------------------------------------------------
# Check 5 — Golden rule alignment (mechanical: look for the major ones)
# ---------------------------------------------------------------------------
if should_run golden; then
  for phrase in "i64 minor units" "thiserror" "anyhow" "rusqlite" "Tauri v2"; do
    in_agents="$(grep -c "$phrase" AGENTS.md 2>/dev/null || echo 0)"
    in_skills="$(cat .agents/skills/*/SKILL.md | grep -c "$phrase" 2>/dev/null || echo 0)"
    in_agents="$(echo "$in_agents" | tr -d '\r' | tr -cd '0-9')"
    in_skills="$(echo "$in_skills" | tr -d '\r' | tr -cd '0-9')"
    if [ -z "$in_agents" ]; then in_agents=0; fi
    if [ -z "$in_skills" ]; then in_skills=0; fi

    # heuristic: if AGENTS.md says it but no skill mentions it, flag
    if [ "$in_agents" -gt 0 ] && [ "$in_skills" -eq 0 ]; then
      FINDINGS[golden]+="phrase '${phrase}' in AGENTS.md but not in any skill"$'\n'
    fi
  done
fi

# ---------------------------------------------------------------------------
# Check 6 — Cross-reference integrity
# ---------------------------------------------------------------------------
if should_run refs; then
  # onboarding-guide should reference only existing skills.
  # Overridable for the same reason as Cargo_FILE in Check 2: it lets the
  # test suite point the check at a throwaway fixture instead of mutating
  # the real onboarding-guide (a backup/restore there can leak a probe line
  # into a tracked file if the run is killed mid-test).
  og="${OG_FILE:-.agents/skills/onboarding-guide/SKILL.md}"
  if [ -f "$og" ]; then
    # `< <(…)` not `grep | while`: see the subshell note in Check 1.
    # Also in AUTO_PATCH_CATS — a swallowed write disables that path too.
    while read -r ref; do
      case "$ref" in
        rust-backend|tauri-ipc|ui-components|hal-drivers|project-scaffold|onboarding-guide|skill-drift-guard) continue ;;
      esac
      # Heuristic: anything else in backticks inside the router table is a skill reference
      if [ -d ".agents/skills/$ref" ]; then continue; fi
      # …but only if it resolves to NOTHING else real. The guide backtick-names
      # workspace members (`kasirmu-core`), dependencies (`mlua`, `rusqlite`,
      # `async-trait`) and CI keys (`static-gates`, `continue-on-error`) in the
      # same voice it uses for skills, and token shape cannot tell them apart.
      # Without this, every one of those is a permanent false positive and the
      # check's exit code stops meaning anything. Taxonomy #8 is about a
      # reference to a SKILL that does not exist — not about every kebab token.
      if [ -d "crates/$ref" ] || [ -d "modules/$ref" ] || [ -d "platform/$ref" ] \
         || [ -d "apps/$ref" ] || [ "$ref" = "foundation" ]; then continue; fi
      if grep -qE "^[[:space:]]*\"?${ref}\"?[[:space:]]*=" Cargo.toml 2>/dev/null; then continue; fi
      if grep -rqE "^[[:space:]]+${ref}:" .github/workflows/ 2>/dev/null; then continue; fi
      # skip common non-skill backticks
      case "$ref" in
        src|ui|crates|hal|src-tauri|AGENTS.md|README.md|WHITEPAPER.md|ARCHITECTURE.md|ROADMAP.md) continue ;;
        async|await|pub|fn|let|mut|use|match|impl|trait) continue ;;   # Rust keywords
      esac
      FINDINGS[refs]+="onboarding-guide: possible missing skill ref \`${ref}\`"$'\n'
    done < <(grep -oE '`[a-z][a-z-]+`' "$og" 2>/dev/null | sort -u | \
      grep -vE '^\`(feat|fix|docs|chore|test|refactor|perf|style|ci|revert|build)\`$' | \
      tr -d '`')
  fi
fi

# ---------------------------------------------------------------------------
# Check 7 — Front-end Fluent ID alignment (no-op if no FTL files exist)
#
# Direction is intentionally one-way: every Fluent id referenced from a skill
# must exist in the active FTL files. The reverse (every FTL id is mentioned
# in a skill) is NOT checked, because FTL files legitimately contain ids that
# no skill has documented yet.
# ---------------------------------------------------------------------------
if should_run fluent; then
  if [ -d "ui/src/locales" ]; then
    while read -r skill; do
      [ -z "$skill" ] && continue
      # Permissive pattern: any non-empty id. Trust the FTL to define the format.
      # `< <(…)` not `grep | while`: see the subshell note in Check 1.
      while read -r ftl_id; do
        if ! grep -rqE "^${ftl_id}\s*=" ui/src/locales/ 2>/dev/null; then
          FINDINGS[fluent]+="${skill}: Fluent id '${ftl_id}' not found in ui/src/locales/"$'\n'
        fi
      done < <(grep -hoE 'id="[^"]+"' "$skill" 2>/dev/null | sort -u | \
        sed 's/id="//;s/"$//')
    done < <(find .agents/skills -name SKILL.md 2>/dev/null)
  fi
  # else: no front-end yet, silently skip
fi

# ---------------------------------------------------------------------------
# Check 8 — Audit-date freshness
# ---------------------------------------------------------------------------
if should_run audit-date; then
  today="$(date +%d-%m-%y)"
  while read -r skill; do
    [ -z "$skill" ] && continue
    last="$(grep -oE 'last audited [0-9]{2}-[0-9]{2}-[0-9]{2}' "$skill" 2>/dev/null | tail -1 | awk '{print $3}')"
    if [ -z "$last" ]; then
      FINDINGS[audit-date]+="${skill}: missing audit date"$'\n'
      continue
    fi
    py_cmd="$PYTHON_BIN"
    if [ -z "$py_cmd" ]; then
      # No python on host — fail-closed: report as stale (age=9999).
      age=9999
    else
      age="$($py_cmd -c "
from datetime import datetime
try:
    d = datetime.strptime('$last', '%d-%m-%y')
    print((datetime.now() - d).days)
except Exception:
    print(9999)
" 2>/dev/null || echo 9999)"
    fi
    if [ "${age:-9999}" -gt 30 ]; then
      FINDINGS[audit-date]+="${skill}: last audited ${last} (${age} days ago)"$'\n'
    fi
  done < <(find .agents/skills -name SKILL.md 2>/dev/null)
fi

# ---------------------------------------------------------------------------
# Check 9 — Audit-date format enforcement
#
# Asserts every `> last audited ...` footer in a skill file matches the
# project convention exactly: `^> last audited [0-9]{2}-[0-9]{2}-[0-9]{2}
# by [^[:space:]]+$`. Wrong-format footers (e.g. YYYY-MM-DD, missing
# by-clause) are reported separately from Check 8's "stale" category so
# triage is unambiguous. Format fixes are ALWAYS manual — Check 8's parser
# can silently mis-accept a 4-digit year as a coincidentally-valid 2-digit
# date (see Pitfall #8 in SKILL.md for the worked example).
# ---------------------------------------------------------------------------
if should_run audit-format; then
  pairs_file="$(mktemp 2>/tmp/mktemp.err)" || { echo "detect.sh: mktemp failed for audit-format: $(cat /tmp/mktemp.err)" >&2; rm -f /tmp/mktemp.err; exit 1; }
  rm -f /tmp/mktemp.err
  PAIRS_FILES+=("$pairs_file")  # tracked for EXIT-trap cleanup if killed mid-run
  while read -r skill; do
    [ -z "$skill" ] && continue
    audit_footer_check_in_file audit-format "$skill" "$pairs_file"
  done < <(find .agents/skills -name SKILL.md 2>/dev/null)
  batch_validate_audit_dates audit-format "$pairs_file"
  rm -f "$pairs_file"
fi

# ---------------------------------------------------------------------------
# Check 10 — Audit-date format enforcement (project docs, non-skill)
#
# Mirrors Check 9 against every `*.md` file outside `.agents/skills/` so
# the audit-footer convention enforced for skills also fires for human-
# maintained docs (CONTRIBUTING.md, AGENTS.md, docs/QUICKSTART.md, crate/app/
# module README.md files, etc.). The audit-date format is a project-wide
# convention — its drift would re-accumulate silently without this check.
# Format fixes are ALWAYS manual — same reasoning as Check 9.
# ---------------------------------------------------------------------------
if should_run doc-audit; then
  pairs_file="$(mktemp 2>/tmp/mktemp.err)" || { echo "detect.sh: mktemp failed for doc-audit: $(cat /tmp/mktemp.err)" >&2; rm -f /tmp/mktemp.err; exit 1; }
  rm -f /tmp/mktemp.err
  PAIRS_FILES+=("$pairs_file")  # tracked for EXIT-trap cleanup if killed mid-run
  # Corpus is prefiltered to footer-bearing files — see md_footer_files above.
  # Accepted limitation: `grep -l` delimits its output with newlines, so a
  # filename containing a literal newline would be mis-parsed here. The
  # prefilter is a set-membership test only; every file it does hand to the
  # helper is still read and scanned in full below.
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    audit_footer_check_in_file doc-audit "$file" "$pairs_file"
  done < <(md_footer_files)
  batch_validate_audit_dates doc-audit "$pairs_file"
  rm -f "$pairs_file"
fi

# ---------------------------------------------------------------------------
# Auto-patch (safe categories only)
# ---------------------------------------------------------------------------
if $AUTO_PATCH; then
  if [ -n "${FINDINGS[audit-date]}" ]; then
    for skill in .agents/skills/*/SKILL.md; do
      sed -i "s/^> last audited .* by .*/> last audited $today by skill-drift-guard/" "$skill"
    done
    echo "auto-patched: audit dates bumped to $today"
  fi
  if [ -n "${FINDINGS[versions]}" ]; then
    echo "auto-patch: versions — manual review needed, listing:"
    echo "${FINDINGS[versions]}"
  fi
  if [ -n "${FINDINGS[refs]}" ]; then
    echo "auto-patch: refs — manual review needed, listing:"
    echo "${FINDINGS[refs]}"
  fi
fi

# ---------------------------------------------------------------------------
# Emit report
# ---------------------------------------------------------------------------
manual_count=0
report=""
report+="# Skill drift report — $today"$'\n\n'

for cat in paths crates api versions golden refs fluent audit-date audit-format doc-audit; do
  body="${FINDINGS[$cat]}"
  if [ -z "$body" ]; then continue; fi
  manual_count=$((manual_count + $(echo "$body" | grep -c . || true)))
  report+="## $cat"$'\n\n'
  report+="\`\`\`"$'\n'
  report+="$body"
  report+="\`\`\`"$'\n\n'
done

if [ "$manual_count" -eq 0 ]; then
  report+="No drift detected. All skills are in sync with the code."$'\n'
fi

if $WRITE_REPORT || [ "$manual_count" -gt 0 ]; then
  echo "$report" > "$REPORT"
  echo "wrote $REPORT ($manual_count findings)"
fi

echo "$report"
exit "$manual_count"
