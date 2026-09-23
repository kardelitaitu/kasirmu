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
# A SECOND, NARROW rule covers the other door into a counted set: an UPDATE
# that can move a row INTO it. For `users` the counted set is `is_active = 1`,
# so `UPDATE users SET ... is_active = <truthy> ...` (a literal 1/true or a
# bound `?n`, the only shape the tree writes) is graded on the SAME ladder
# above. A DEACTIVATION (`is_active = 0`/false) leaves the counted set and is
# never a site, let alone a violation - only the transition INTO the count can
# push it past a cap.
#
# What the new rule sees on the real tree: exactly two activation sites. The
# one `UPDATE users SET ... is_active = ?n` is
# crates/kasirmu-core/src/db/staff.rs::update_user_in_tx, which reads
# GATED-IN-CALLER - the bridge's update_staff_scoped and its mobile-tauri twin
# hold the `enforce_staff_quota` gate and then CALL this writer, so the gate is
# upstream in the caller, not in the statement's own function. The other is the
# import upsert crates/kasirmu-bridge/src/data.rs::import_data, GATES-A-CALLEE
# through `gate_import_user_batch`. It does NOT see a reactivation expressed as
# a two-step read-then-write (`SELECT is_active` then a bare assignment), and it
# cannot tell a value bound from a caller-supplied true from one bound from a
# constant false; it keys on the literal shape only.
#
# Honest limits: a text walk, not a call graph. Names match by name; a trait
# method or function-pointer hop is not followed, so a gate reachable only
# through indirection reads UNCOVERED and must be whitelisted with a reason.
# One hop each way covers every shape in the tree today. Hop 2 is the weaker
# half: it keys on the holder's bare NAME, so a holder called `new`, `default`
# or `from` sends it through every `.new(` / `::default(` in the scan roots and
# it will find SOME gating function, which reads as GATED-IN-CALLER and is a
# false pass. `seed_primary_store` is the live instance (its holder is
# `AppState::new`) and is why that entry is labelled KNOWN-GAP instead of being
# left to the verdict. fn bodies end at
# the next fn signature, so a body can include a following sibling - that
# errs toward PASSING a site, which is why exemptions must be reasoned. Test
# files (*_tests.rs) and the cfg(test)-only harness `src/testing.rs` are
# excluded: seeding rows is what tests do.
#
# Scan roots are the three layers a create can be reached through: both Tauri
# shells, `kasirmu-core` (the create fns) and `kasirmu-bridge` (the command
# layer that gates them). Leaving the bridge out is not a smaller scan but a
# blind one -- the gates live there, so every core create fn whose only gate is
# its caller read UNCOVERED.

set -uo pipefail
cd "$(dirname "$0")/.."

RED=$(printf "\033[0;31m")
YEL=$(printf "\033[0;33m")
GRN=$(printf "\033[0;32m")
NC=$(printf "\033[0m")

TABLES="products|users|terminals|locations|workspace_instances"
INSERT_RE="INSERT( OR (IGNORE|REPLACE))? INTO (${TABLES})[ (]"
GATE_RE="enforce_[a-z_]*quota|ensure_quota_allows|enforce_creation_quota|quota_gate::"
# The SECOND rule: an UPDATE that moves a `users` row INTO the counted set
# (`is_active = 1`). Only the truthy assignment is a site; `is_active = 0` (a
# deactivation) and `... = false` are not matched, so the legitimate half is
# never flagged. The assigned value is a literal 1/true or a bound `?n` -- the
# only shapes this tree writes -- and `[^;]*` keeps the match inside one
# statement so a later `is_active = 1` in another query cannot reach back.
ACTIVATION_RE="UPDATE[[:space:]]+(users)[[:space:]]+SET[^;]*is_active[[:space:]]*=[[:space:]]*(1|true|TRUE|\?[0-9]+)([^a-zA-Z0-9_]|$)"
FN_RE="^[[:space:]]*(pub([[:space:]]+(crate|in|super))?[[:space:]]+)?(async[[:space:]]+)?(unsafe[[:space:]]+)?fn[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*"
# The command layer lives in `crates/kasirmu-bridge` since the extraction and
# the two Tauri apps are thin shims, so a scan that stops at them cannot see
# the gate a core create fn's CALLER runs. Omitting the bridge made
# `create_location_profile` and `create_workspace_instance_with_purpose` read
# UNCOVERED while both of their real callers gate -- `kasirmu-bridge/src/
# locations.rs` calls `enforce_location_quota`, `workspaces.rs` calls
# `enforce_instance_quota` -- and made the `apply_topology_diff` exemption read
# STALE because the INSERT it names had moved into this crate.
SCAN=(apps/desktop-tauri/src apps/mobile-tauri/src crates/kasirmu-core/src crates/kasirmu-bridge/src)
# Files that hold no shipped INSERT, alongside the `_tests.rs` exclusion: the
# bridge's `src/testing.rs` is `#[cfg(test)] mod testing;` (declared under
# `#[cfg(test)]` at `lib.rs:159-160`), so seeding rows there is what tests do.
# Excluding it is not cosmetic. It defines a `fn new` and a `fn default` whose
# `fn_body` (signature through the NEXT fn signature) swallows a neighbouring
# gating body, and a gated name as generic as `new` makes
# `body_gates_indirectly` match nearly every function in the tree -- which
# turned `seed_primary_store` into a false GATED-IN-CALLER and then reported
# its load-bearing bootstrap exemption as STALE.
NOT_PROD='(_tests\.rs|/testing\.rs)'

# Whitelist: "file::fn | reason". A KNOWN-GAP reason stays visible.
WHITELIST=(
"crates/kasirmu-core/src/sync_pull.rs::upsert_products | Cloud PULL mirror of hub-authored rows: the hub enforced the quota when the row was created, and re-gating a pull would make a tenant that legitimately grew past its limit fail to SYNC rather than fail to CREATE - that loses data instead of protecting it."
"crates/kasirmu-core/src/sync_pull.rs::upsert_users | Same pull-mirror class as upsert_products: the rows arrive from the hub, where the gated authoring door already ran."
"apps/desktop-tauri/src/state.rs::seed_primary_store | KNOWN-GAP: first-run bootstrap of the ONE primary location an empty install needs, before any subscription row exists, so there is no tier to ask. Gating it makes a fresh install unbootable, so this door is deliberately ungated for good rather than pending a gate. Relabelled KNOWN-GAP on 2026-09-20 rather than WHITELISTED because the GATED-IN-CALLER verdict the checker reaches for it is an artefact of name matching, not a gate: the site's only caller is AppState::new, so hop 1 hands hop 2 the holder's bare NAME 'new', and callers_of_fn('new') then matches all 1164 .new( sites in the scan roots -- one of which sits inside a gating fn, which is all hop 2 needs to return 0. Measured, not inferred: fn_body(state.rs, new) spans :216-399 and matches neither GATE_RE nor any of the 33 names in GATE_NAMES. The KNOWN-GAP branch is tested before the gate verdicts, so this entry prints the true sentence (ungated debt) instead of the false one, in yellow, on every run."
"crates/kasirmu-bridge/src/topology/commands.rs::apply_topology_diff | KNOWN-GAP (journal D54, RESOLVED by adoption - journal D65): topology nodes ARE constrained here - type allowlist, per-location caps, suspend_surplus - and the TopologyNodes marker dimension is now LANDED read-computed (8bae644e0: severity over iff quota_suspended or over limit, limit = sum of finite per-location caps, quota_count refuses TopologyNodes loudly). This entry stays as the record of the one create door that REJECTS rather than over-creates, so no marker overflow hook exists for a gate to check; it turns STALE the day apply_topology_diff grows an INSERT instead of being satisfied. KEY REPOINTED (2026-09-20) from the desktop shim key 'apps/desktop-tauri/src/commands/topology/commands.rs::apply_topology_diff' to this bridge path: the extraction moved the INSERT INTO workspace_instances (now :930-945) into the bridge and left the app file a shim with no INSERT, so the old key matched no site. The rejection this entry describes is at :889-897 in the same file - it projects (current - archived_active + workspace_creations.len()) against the tier limit and returns PermissionDenied before the loop that inserts, which is why the door cannot over-create. (Quoted with ' not backticks on purpose: this string is double-quoted bash, so a backtick would be a command substitution.)"
"crates/kasirmu-core/src/db/products_stock_query.rs::create_product_if_absent_in_tx | KNOWN-GAP: a PUBLIC Store create door with ZERO in-tree callers (git grep on the name matches only its own definition). Nothing ungated runs today, so this is not a live hole - but whoever wires it up must gate first, and this line is the tripwire that makes that visible the day it gains a caller."
  # NOT a production door: a test-fixture helper that happens to live in a
  # production file. Zero production callers (measured, 2026-09-20).
"crates/kasirmu-core/src/migrations.rs::seed_provisioned_baseline | TEST-FIXTURE HELPER, not a door: #[doc(hidden)], and its own doc says tests that exercise layers BELOW provisioning still need a provisioned store, so it reproduces exactly what provisioning produces to keep the five workspace ids identical wherever a test asserts on them by name. MEASURED: grep over the whole repo finds 21 call sites and every one is a test target -- kasirmu-core *_tests.rs files, kasirmu-api/src/routes/tax_rates_tests.rs, kasirmu-bridge/src/regional_tests.rs and kasirmu-bridge/src/testing.rs. That last file is a shared test-support module that is NOT named _tests.rs, which is exactly why the NOT_PROD filter cannot reach this site; the file also documents itself as the single source for what provisioning writes. ZERO production callers. It cannot be #[cfg(test)] because test targets in OTHER crates link it, so it has to stay a pub fn in a production file and needs this line to say so. It also writes tenant_subscription with tier_key free, which the guard does not scan. This entry turns STALE if a production path ever calls it; the day one does, that caller needs a gate."
"crates/kasirmu-core/src/db/provisioning.rs::provision_device_inner | KNOWN-GAP: ADR #56 first-run provisioning, pre-session by construction -- there is no session yet, so no permission key can gate the door, and a fresh install has no subscription row, hence no tier to ask. That is the same reason seed_primary_store is ungated for good. What makes this DEBT rather than settled is RE-ENTRY: the public provision_device wrapper checks only per-terminal_id idempotency (store.get_provisioning of args.terminal_id), so a caller passing a DIFFERENT terminal_id provisions all over again -- a new locations row, its five workspace_instances, and (with a distinct owner username) another OWNER user, with no tier or quota check anywhere in the chain. Not changed here on purpose: refusing would strand a re-installed or second terminal at the setup screen, and the guard belongs at the install level, which is an ADR-56 decision rather than a unilateral one. Reported to the user as a real hole on 2026-09-20."
"crates/kasirmu-core/src/db/provisioning.rs::create_workspaces_in_tx | KNOWN-GAP: callee of provision_device_inner in the same pre-session first-run chain, so it inherits that entry -- five workspace_instances rows per provisioning run with no quota check, hanging off whichever location the caller just made. Graded UNCOVERED rather than GATES-A-CALLEE because nothing in this chain gates: the wrapper checks terminal_id idempotency only. Gating the insert itself would leave a first run HALF-provisioned (location committed, workspaces refused), so the fix belongs where the whole provisioning run is decided, not here."
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
    | grep -vE "$NOT_PROD" \
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

# The ONE verdict ladder. Both rules feed it -- the INSERT pass and the
# activation pass below -- so the new rule reuses the same verdicts instead of
# growing a second framework. Returns 0 when covered, 2 for a stated
# KNOWN-GAP, 1 when UNCOVERED, and prints the line it decided.
grade_site() { # FILE FN -> verdict for the function holding the site
  local file="$1" fn="$2" key body reason
  key="${file}::${fn}"
  body=$(fn_body "$file" "$fn" 2>/dev/null || true)
  # A stated KNOWN-GAP is printed even when a nearby gate would have passed it:
  # debt must not be silenced by a neighbouring call. Two sites in one function
  # share a body here (import_data gates products, not users), so the order of
  # these checks is what keeps that visible rather than absorbed.
  if reason=$(whitelist_reason "$key") && printf "%s" "$reason" | grep -q "KNOWN-GAP"; then
    printf "  %-58s %s %s\n" "$key" "${YEL}KNOWN-GAP${NC}" "$reason"
    SEEN_KEYS="$SEEN_KEYS $key"; return 2
  fi
  if printf "%s" "$body" | grep -qE "$GATE_RE"; then
    printf "  %-58s GATED-IN-FN\n" "$key"; return 0
  fi
  if body_gates_indirectly "$body"; then
    printf "  %-58s GATES-A-CALLEE\n" "$key"; return 0
  fi
  if any_caller_gates "$fn"; then
    printf "  %-58s GATED-IN-CALLER\n" "$key"; return 0
  fi
  if reason=$(whitelist_reason "$key"); then
    case "$reason" in
      *KNOWN-GAP*) printf "  %-58s %s %s\n" "$key" "${YEL}KNOWN-GAP${NC}" "$reason"; SEEN_KEYS="$SEEN_KEYS $key"; return 2 ;;
      *) printf "  %-58s WHITELISTED: %s\n" "$key" "$reason"; SEEN_KEYS="$SEEN_KEYS $key"; return 0 ;;
    esac
  fi
  printf "  %-58s %sUNCOVERED%s\n" "$key" "$RED" "$NC"
  return 1
}

tally_site() { # RC -> fold one graded site into the run counters
  case "$1" in
    0) SITE_COVERED=$((SITE_COVERED + 1)) ;;
    2) SITE_GAPS=$((SITE_GAPS + 1)) ;;
    *) SITE_BAD=$((SITE_BAD + 1)) ;;
  esac
}

SITE_BAD=0
check_sites() { # files...
  local sites line rest lineno fn file asites afile arest alineno afn stale=0 entry wkey
  SITE_N=0; SITE_COVERED=0; SITE_GAPS=0; SITE_BAD=0
  SEEN_KEYS=""
  sites=$(grep -HnE "$INSERT_RE" "$@" 2>/dev/null | grep -v "_tests\.rs:")
  [ -n "$sites" ] || { printf "no INSERT sites found - the checker is looking at nothing\n"; SITE_BAD=1; return; }
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    SITE_N=$((SITE_N + 1))
    file="${line%%:*}"; rest="${line#*:}"; lineno="${rest%%:*}"
    fn=$(fn_name_at "$file" "$lineno") || fn="(top-level)"
    grade_site "$file" "$fn"; tally_site $?
  done <<<"$sites"
  # The SECOND rule, graded on the SAME ladder: an UPDATE that can move a
  # `users` row INTO the counted set. A deactivation is not a site at all, so
  # the legitimate half is never flagged.
  asites=$(grep -HnE "$ACTIVATION_RE" "$@" 2>/dev/null | grep -v "_tests\.rs:")
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    SITE_N=$((SITE_N + 1))
    afile="${line%%:*}"; arest="${line#*:}"; alineno="${arest%%:*}"
    afn=$(fn_name_at "$afile" "$alineno") || afn="(top-level)"
    grade_site "$afile" "$afn"; tally_site $?
  done <<<"$asites"
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
      *) SITE_BAD=$((SITE_BAD + 1)); stale=$((stale + 1)); printf "  %-58s %sSTALE EXEMPTION%s\n" "$wkey" "$RED" "$NC" ;;
    esac
  done
  [ "$stale" -gt 0 ] && printf "note: %d whitelist entry(ies) match no site - delete them\n" "$stale"
  printf "\nsites: %d  covered: %d  known gaps: %d  violations: %d\n" "$SITE_N" "$SITE_COVERED" "$SITE_GAPS" "$SITE_BAD"
}

if [ "${1:-}" = "--self-test" ]; then
  FIX=$(mktemp -d)
  mkdir -p "$FIX/src"
  # The two INSERT sites plus one GATED activation, all in covered.rs.
  printf "pub fn create_gated() {\n    enforce_product_quota();\n    INSERT INTO products (id) VALUES (1);\n}\n\npub fn gate_the_dumb_one() {\n    ensure_quota_allows();\n}\n\npub fn dumb_create() {\n    gate_the_dumb_one();\n    INSERT INTO users (id) VALUES (2);\n}\n\npub fn activate_gated() {\n    enforce_staff_quota();\n    UPDATE users SET is_active = 1 WHERE id = 'u';\n}\n" >"$FIX/src/covered.rs"
  # hole.rs: the ungated INSERT, an UNGATED activation (the new rule's red
  # case), and a DEACTIVATION. The last must never be a site -- if the truthy
  # guard ever matched `is_active = 0` the site count would rise by one and
  # this leg would fail, which is how the "no crying wolf" half is proven.
  printf "pub fn create_ungated() {\n    INSERT INTO terminals (id) VALUES (3);\n}\n\npub fn activate_ungated() {\n    UPDATE users SET is_active = 1 WHERE id = 'u';\n}\n\npub fn deactivate_row() {\n    UPDATE users SET is_active = 0 WHERE id = 'u';\n}\n" >"$FIX/src/hole.rs"
  # Positive control for NOT_PROD. `testing.rs` and `*_tests.rs` must be
  # dropped, `prod.rs` must survive -- and the surviving file must be the only
  # reason this leg can fail, so a filter that silently dropped EVERYTHING
  # would be caught rather than read as a clean sweep.
  printf "pub fn harness_seed() {\n    INSERT INTO users (id) VALUES (9);\n}\n" >"$FIX/src/testing.rs"
  printf "pub fn test_seed() {\n    INSERT INTO users (id) VALUES (10);\n}\n" >"$FIX/src/hole_tests.rs"
  printf "pub fn prod_ungated() {\n    INSERT INTO terminals (id) VALUES (11);\n}\n" >"$FIX/src/prod.rs"
  FIX_FILES=$(grep -rlE "$INSERT_RE" "$FIX/src" --include="*.rs" 2>/dev/null | grep -vE "$NOT_PROD" | sort -u)
  printf "self-test: production files after NOT_PROD: %s\n" "$(printf "%s" "$FIX_FILES" | tr "\n" " ")"
  FIX_BAD=0
  case "$FIX_FILES" in *"/testing.rs"*) FIX_BAD=1; printf "%sself-test: NOT_PROD kept testing.rs%s\n" "$RED" "$NC" ;; esac
  case "$FIX_FILES" in *"_tests.rs"*) FIX_BAD=1; printf "%sself-test: NOT_PROD kept a *_tests.rs%s\n" "$RED" "$NC" ;; esac
  case "$FIX_FILES" in *"/prod.rs"*) ;; *) FIX_BAD=1; printf "%sself-test: NOT_PROD dropped prod.rs%s\n" "$RED" "$NC" ;; esac
  WHITELIST=()
  GATE_NAMES="$(gated_names_in "$FIX/src/covered.rs" "$FIX/src/hole.rs")"
  printf "self-test: gated helper names seen: %s\n" "$(printf "%s" "$GATE_NAMES" | tr "\n" " ")"
  check_sites "$FIX/src/covered.rs" "$FIX/src/hole.rs"
  rm -rf "$FIX"
  # Both directions of the new rule are asserted here. 5 sites = 3 INSERTs
  # (create_gated, dumb_create, create_ungated) + 2 activations (activate_gated,
  # activate_ungated); deactivate_row is absent because `is_active = 0` is not a
  # site. 2 violations = the ungated INSERT and the ungated activation, so a
  # regression that stopped grading activations, or one that started flagging
  # deactivations, both move a count and fail this leg.
  printf "self-test: sites=%s covered=%s violations=%s\n" "${SITE_N:-?}" "${SITE_COVERED:-?}" "${SITE_BAD:-?}"
  if [ "${SITE_N:-0}" = "5" ] && [ "${SITE_COVERED:-0}" = "3" ] \
     && [ "${SITE_BAD:-0}" = "2" ] && [ "$FIX_BAD" = "0" ]; then
    printf "%sself-test ok%s - 5 sites (3 INSERT + 2 activations, deactivation not a site), 3 covered, 2 violations (ungated INSERT + ungated activation); production filter kept prod.rs and dropped testing.rs and *_tests.rs\n" "$GRN" "$NC"
    exit 0
  fi
  printf "%sself-test FAILED%s - expected sites=5 covered=3 violations=2 filter_bad=0, got sites=%s covered=%s violations=%s filter_bad=%s\n" "$RED" "$NC" "${SITE_N:-?}" "${SITE_COVERED:-?}" "${SITE_BAD:-?}" "$FIX_BAD"
  exit 1
fi

# Either rule can own a file: the bridge's staff.rs gates an activation but holds
# no gated INSERT, so keying FILES on INSERT_RE alone would leave the new rule
# blind to exactly the file that carries the real gate.
FILES=$(grep -rlE "($INSERT_RE|$ACTIVATION_RE)" "${SCAN[@]}" --include="*.rs" 2>/dev/null | grep -vE "$NOT_PROD" | sort -u)
[ -n "$FILES" ] || { printf "no candidate files\n"; exit 1; }
GATE_NAMES="$(gated_names_in $FILES $(grep -rlE "$GATE_RE" "${SCAN[@]}" --include="*.rs" 2>/dev/null | grep -vE "$NOT_PROD" | sort -u))"
printf "quota coverage: INSERT sites for (%s)\n" "$TABLES"
check_sites $FILES
if [ "${SITE_BAD:-0}" -gt 0 ]; then
  printf "%sFAIL%s - create site(s) reach a quota-gated table with no gate and no stated exemption\n" "$RED" "$NC"
  exit 1
fi
printf "%sPASS%s - every create site routes through a quota gate or a reasoned exemption\n" "$GRN" "$NC"
exit 0
