#!/usr/bin/env bash
# scripts/verify-quota-coverage.sh - S6 regression guard.
#
# Every INSERT into a QUOTA-GATED table, from code that can create a row, must
# have a quota gate upstream of it. Gated dimensions: Locations, Terminals,
# Staff, Products, Warehouses (QuotaDimension / DIMENSION_ORDER) plus
# workspace_instances, whose door goes through enforce_instance_quota.
#
# WHY: waves S1-S4 each closed one forgotten create site - five gates
# converted (b11f7b4ed), then the import batch door (b5758c571), then the
# TOCTOU race (9264b8f67). Each time, "which site did we miss?" was answered
# by hand. This answers it permanently: a new INSERT INTO products that
# nobody thought about fails a check instead of shipping.
#
# Usage:  bash scripts/verify-quota-coverage.sh
#         bash scripts/verify-quota-coverage.sh --self-test
#         (run from the workspace root)
#
# Exit: 0 when every site is gated, gate-reachable, or exempted below WITH A
# REASON; 1 otherwise. A KNOWN-GAP exemption still exits 0 but prints in
# yellow on every run - visible debt, not a silent pass.
#
# Verdicts, in the order tried:
#   GATED-IN-FN      the INSERT own function calls a gate.
#   GATES-A-CALLEE   the function calls a function that gates (import_data
#                    calls gate_import_product_batch, which gates).
#   GATED-IN-CALLER  a caller gates. Core create fns are deliberately dumb
#                    and the command layer gates, so the rule follows the
#                    house pattern instead of flagging correct call sites.
#   WHITELISTED      exempted below with a reason. An entry WITHOUT a reason
#                    is itself a violation: an unexplained exemption is how
#                    an allowlist turns into a lie.
#   UNCOVERED        violation.
#
# Honest limits: a text walk, not a call graph. Names match by name; a trait
# method or function-pointer hop is not followed, so a gate reachable only
# through indirection reads UNCOVERED and must be whitelisted with a reason.
# One hop each way covers every shape in the tree today. fn bodies end at
# the next fn signature, so a body can include a following sibling - that
# errs toward PASSING a site, which is why exemptions must be reasoned. Test
# files (*_tests.rs) are excluded: seeding rows is what tests do.

set -uo pipefail
cd "$(dirname "$0")/.."

RED=$(printf "\033[0;31m")
YEL=$(printf "\033[0;33m")
GRN=$(printf "\033[0;32m")
NC=$(printf "\033[0m")

TABLES="products|users|terminals|locations|workspace_instances"
INSERT_RE="INSERT( OR (IGNORE|REPLACE))? INTO (${TABLES})[ (]"
GATE_RE="enforce_[a-z_]*quota|ensure_quota_allows|enforce_creation_quota|quota_gate::"
FN_RE="^[[:space:]]*(pub([[:space:]]+(crate|in|super))?[[:space:]]+)?(async[[:space:]]+)?(unsafe[[:space:]]+)?fn[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*"
SCAN=(apps/desktop-client/src apps/tablet-client/src crates/kasirmu-core/src)

# Whitelist: "file::fn | reason". A KNOWN-GAP reason stays visible.
WHITELIST=(
"crates/kasirmu-core/src/sync_pull.rs::upsert_products | Cloud PULL mirror of hub-authored rows: the hub enforced the quota when the row was created, and re-gating a pull would make a tenant that legitimately grew past its limit fail to SYNC rather than fail to CREATE - that loses data instead of protecting it."
"crates/kasirmu-core/src/sync_pull.rs::upsert_users | Same pull-mirror class as upsert_products: the rows arrive from the hub, where the gated authoring door already ran."
"apps/desktop-client/src/state.rs::seed_primary_store | First-run bootstrap of the ONE primary location an empty install needs, before any subscription row exists, so there is no tier to ask. Gating it makes a fresh install unbootable."
"apps/desktop-client/src/commands/topology/commands.rs::apply_topology_diff | KNOWN-GAP (journal D54, RESOLVED by adoption - journal D65): topology nodes ARE constrained here - type allowlist, per-location caps, suspend_surplus - and the TopologyNodes marker dimension is now LANDED read-computed (8bae644e0: severity over iff quota_suspended or over limit, limit = sum of finite per-location caps, quota_count refuses TopologyNodes loudly). This entry stays as the record of the one create door that REJECTS rather than over-creates, so no marker overflow hook exists for a gate to check; it turns STALE the day apply_topology_diff grows an INSERT instead of being satisfied."
"crates/kasirmu-core/src/db/products_stock_query.rs::create_product_if_absent_in_tx | KNOWN-GAP: a PUBLIC Store create door with ZERO in-tree callers (git grep on the name matches only its own definition). Nothing ungated runs today, so this is not a live hole - but whoever wires it up must gate first, and this line is the tripwire that makes that visible the day it gains a caller."
)

fn_name_at() { # FILE LINE -> name of the closest fn signature at or above LINE
  local file="$1" want="$2" hit nm
  hit=$(head -n "$want" "$file" | grep -nE "$FN_RE" | tail -1 | cut -d: -f2-)
  [ -n "$hit" ] || return 1
  nm="${hit##*fn }"
  printf "%s" "${nm%%[(< ]*}"
}

fn_body() { # FILE FN -> signature line through the next fn signature
  local file="$1" name="$2" start end
  start=$(grep -nE "(^|[^a-zA-Z0-9_])fn[[:space:]]+${name}([[:space:]]*[(<]|$)" "$file" | head -1 | cut -d: -f1)
  [ -n "$start" ] || return 1
  end=$(tail -n +"$((start + 1))" "$file" | grep -nE "$FN_RE" | head -1 | cut -d: -f1)
  if [ -z "$end" ]; then end=$(wc -l <"$file"); else end=$((start + end)); fi
  sed -n "${start},${end}p" "$file"
}

gated_names_in() { # files... -> names of functions that gate
  local file name body; shift 0
  for file in "$@"; do
    grep -qE "$GATE_RE" "$file" || continue
    while read -r name; do
      [ -n "$name" ] || continue
      body=$(fn_body "$file" "$name") || continue
      printf "%s" "$body" | grep -qE "$GATE_RE" && printf "%s\n" "$name"
    done < <(grep -oE "fn[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*" "$file" | sed "s/^fn[[:space:]]*//" | sort -u)
  done | sort -u
}

body_gates_indirectly() { # body -> 0 when it calls a function that gates
  local body="$1" gated
  for gated in $GATE_NAMES; do
    printf "%s" "$body" | grep -qE "[^.a-zA-Z0-9_]${gated}([[:space:]]*\(|::)" && return 0
  done
  return 1
}

callers_of_fn() { # FN -> "file:line" hits, minus tests and the definition itself
  grep -rnE "[^a-zA-Z0-9_]$1([[:space:]]*\(|::)" "${SCAN[@]}" --include="*.rs" 2>/dev/null \
    | grep -v "_tests\.rs:" \
    | grep -vE "(async )?fn[[:space:]]+$1([[:space:]]*[(<])" \
    | cut -d: -f1,2 | head -8
}

caller_gates_at() { # hits -> 0 when the fn holding one of them gates; echoes
                    # the holder names so the next hop can walk from them
  local hit file line cfn body out=""
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    file="${hit%%:*}"; line="${hit#*:}"; line="${line%%:*}"
    cfn=$(fn_name_at "$file" "$line") || continue
    [ -n "$cfn" ] || continue
    body=$(fn_body "$file" "$cfn") || continue
    printf "%s" "$body" | grep -qE "$GATE_RE" && { echo "$out"; return 0; }
    body_gates_indirectly "$body" && { echo "$out"; return 0; }
    out="$out${out:+ }$cfn"
  done
  echo "$out"
  return 1
}

any_caller_gates() { # FN -> 0 when a caller gates, within two hops upward
  local name="$1" frontier
  frontier=$(callers_of_fn "$name" | caller_gates_at) && return 0
  # hop 2: a create fn reached through one dumb wrapper - Store::create_user
  # is called by create_user_with_profile, which the gated command calls.
  # Without this second hop the house pattern of delegating inside core reads
  # as a hole, and the honest answer is to walk further, not to whitelist.
  local mid
  for mid in $frontier; do
    callers_of_fn "$mid" | caller_gates_at >/dev/null && return 0
  done
  return 1
}

whitelist_reason() { # KEY -> reason
  local entry
  for entry in "${WHITELIST[@]}"; do
    if [ "${entry%% | *}" = "$1" ]; then printf "%s" "${entry#* | }"; return 0; fi
  done
  return 1
}

SITE_BAD=0
check_sites() { # files...
  local sites file line rest lineno fn key body reason covered=0 gaps=0 bad=0 n=0 stale=0 entry wkey
  SEEN_KEYS=""
  sites=$(grep -HnE "$INSERT_RE" "$@" 2>/dev/null | grep -v "_tests\.rs:")
  [ -n "$sites" ] || { printf "no INSERT sites found - the checker is looking at nothing\n"; SITE_BAD=1; return; }
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    n=$((n + 1))
    file="${line%%:*}"; rest="${line#*:}"; lineno="${rest%%:*}"
    fn=$(fn_name_at "$file" "$lineno") || fn="(top-level)"
    key="${file}::${fn}"
    body=$(fn_body "$file" "$fn" 2>/dev/null || true)
    # A stated KNOWN-GAP is printed even when a nearby gate would have passed it:
    # debt must not be silenced by a neighbouring call. Two INSERT sites in one
    # function share a body here (import_data gates products, not users), so the
    # order of these checks is what keeps that visible rather than absorbed.
    if reason=$(whitelist_reason "$key") && printf "%s" "$reason" | grep -q "KNOWN-GAP"; then
      gaps=$((gaps + 1)); SEEN_KEYS="$SEEN_KEYS $key"; printf "  %-58s %s %s\n" "$key" "${YEL}KNOWN-GAP${NC}" "$reason"; continue
    fi
    if printf "%s" "$body" | grep -qE "$GATE_RE"; then
      covered=$((covered + 1)); printf "  %-58s GATED-IN-FN\n" "$key"; continue
    fi
    if body_gates_indirectly "$body"; then
      covered=$((covered + 1)); printf "  %-58s GATES-A-CALLEE\n" "$key"; continue
    fi
    if any_caller_gates "$fn"; then
      covered=$((covered + 1)); printf "  %-58s GATED-IN-CALLER\n" "$key"; continue
    fi
    if reason=$(whitelist_reason "$key"); then
      case "$reason" in
        *KNOWN-GAP*) gaps=$((gaps + 1)); printf "  %-58s %s %s\n" "$key" "${YEL}KNOWN-GAP${NC}" "$reason" ;;
        *) covered=$((covered + 1)); SEEN_KEYS="$SEEN_KEYS $key"; printf "  %-58s WHITELISTED: %s\n" "$key" "$reason" ;;
      esac
      continue
    fi
    bad=$((bad + 1)); printf "  %-58s %sUNCOVERED%s\n" "$key" "$RED" "$NC"
  done <<<"$sites"
  # A stale exemption is a lie kept on the books: when no site matches a
  # whitelist key any more, either the missing gate arrived or the create site
  # went away, and the entry must be deleted rather than inherited. This is
  # what caught the import_data entry the moment W6-A gated the users arm.
  # Counted BEFORE the summary prints: a "violations: 0" line followed by a
  # red STALE line below it reads as a pass, and the FAIL summary must reflect
  # every reason it failed.
  for entry in "${WHITELIST[@]}"; do
    wkey="${entry%% | *}"
    case " $SEEN_KEYS " in
      *" $wkey "*) ;;
      *) bad=$((bad + 1)); stale=$((stale + 1)); printf "  %-58s %sSTALE EXEMPTION%s\n" "$wkey" "$RED" "$NC" ;;
    esac
  done
  [ "$stale" -gt 0 ] && printf "note: %d whitelist entry(ies) match no site - delete them\n" "$stale"
  printf "\nsites: %d  covered: %d  known gaps: %d  violations: %d\n" "$n" "$covered" "$gaps" "$bad"
  SITE_BAD=$bad
}

if [ "${1:-}" = "--self-test" ]; then
  FIX=$(mktemp -d)
  mkdir -p "$FIX/src"
  printf "pub fn create_gated() {\n    enforce_product_quota();\n    INSERT INTO products (id) VALUES (1);\n}\n\npub fn gate_the_dumb_one() {\n    ensure_quota_allows();\n}\n\npub fn dumb_create() {\n    gate_the_dumb_one();\n    INSERT INTO users (id) VALUES (2);\n}\n" >"$FIX/src/covered.rs"
  printf "pub fn create_ungated() {\n    INSERT INTO terminals (id) VALUES (3);\n}\n" >"$FIX/src/hole.rs"
  WHITELIST=()
  GATE_NAMES="$(gated_names_in "$FIX/src/covered.rs" "$FIX/src/hole.rs")"
  printf "self-test: gated helper names seen: %s\n" "$(printf "%s" "$GATE_NAMES" | tr "\n" " ")"
  check_sites "$FIX/src/covered.rs" "$FIX/src/hole.rs"
  rm -rf "$FIX"
  if [ "${SITE_BAD:-0}" = "1" ]; then
    printf "%sself-test ok%s - the checker marked the two covered sites and reported exactly one hole\n" "$GRN" "$NC"
    exit 0
  fi
  printf "%sself-test FAILED%s - expected exactly 1 violation from the fixture, got %s\n" "$RED" "$NC" "${SITE_BAD:-?}"
  exit 1
fi

FILES=$(grep -rlE "$INSERT_RE" "${SCAN[@]}" --include="*.rs" 2>/dev/null | grep -v "_tests\.rs$" | sort -u)
[ -n "$FILES" ] || { printf "no candidate files\n"; exit 1; }
GATE_NAMES="$(gated_names_in $FILES $(grep -rlE "$GATE_RE" "${SCAN[@]}" --include="*.rs" 2>/dev/null | grep -v "_tests\.rs$" | sort -u))"
printf "quota coverage: INSERT sites for (%s)\n" "$TABLES"
check_sites $FILES
if [ "${SITE_BAD:-0}" -gt 0 ]; then
  printf "%sFAIL%s - create site(s) reach a quota-gated table with no gate and no stated exemption\n" "$RED" "$NC"
  exit 1
fi
printf "%sPASS%s - every create site routes through a quota gate or a reasoned exemption\n" "$GRN" "$NC"
exit 0
