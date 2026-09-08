#!/usr/bin/env bash
# Prove the post-commit graph indexer resolves the right binary and survives the
# two failures that made it silently useless for 535 commits.
#
#   1. Resolution order. The hook resolved the indexer off PATH, which points at
#      %LOCALAPPDATA%\\Programs\\codebase-memory-mcp.exe. That build refuses to act
#      as a client while a NEWER daemon is running: it hangs 30s, prints "CBM
#      daemon is active or starting but could not accept this client", and the
#      hook threw the message into /dev/null. The MCP launcher at
#      ~/.agents/bin/codebase-memory-mcp-launcher.py already documents the trap
#      ("a stale copy under %LOCALAPPDATA%\\Programs... is deliberately ignored");
#      the hook is only now following it.
#
#   2. A 'nul' ghost in the repo root. '2> nul' under Git bash creates a REAL
#      file (cmd.exe would write to the NUL device), and the indexer's discovery
#      pass dies on it in ~2s with a generic "Pipeline failed" -- before
#      .cbmignore is consulted, so listing nul in .cbmignore buys nothing.
#
# Both blocks are EXTRACTED from the hook, not copied, so this test cannot drift
# from the thing it polices. A missing marker is FATAL, not a silent pass: a
# guard nobody runs and a guard that checks nothing look identical from outside,
# and that is exactly how bug 1 survived 535 commits.
#
# Run with Git bash by full path -- 'bash scripts/test-cbm-hook.sh' resolves to
# WSL and hangs (see AGENTS.md):
#   & 'C:\\Program Files\\Git\\bin\\bash.exe' scripts/test-cbm-hook.sh

set -uo pipefail

HOOK=".githooks/post-commit"
[ -f "$HOOK" ] || { echo "FATAL: $HOOK not found (run from repo root)"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()    { echo "  ok    $1"; PASS=$((PASS+1)); }
bad()   { echo "  FAIL  $1"; if [ $# -gt 1 ]; then echo "        $2"; fi; FAIL=$((FAIL+1)); }
same()  { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$2] got [$3]"; fi; }
has()   { case "$3" in *"$2"*) ok "$1" ;; *) bad "$1" "no [$2] in [$3]" ;; esac; }
hasnt() { case "$3" in *"$2"*) bad "$1" "[$3] contains [$2]" ;; *) ok "$1" ;; esac; }
gone()  { if [ -e "$2" ]; then bad "$1" "$2 still present"; else ok "$1"; fi; }
kept()  { if [ -e "$2" ]; then ok "$1"; else bad "$1" "$2 vanished"; fi; }

extract() { # $1 start marker, $2 end marker
  awk -v s="$1" -v e="$2" '
    index($0, s) { f = 1; next }
    index($0, e) { f = 0 }
    f { print }
  ' "$HOOK"
}

RESOLVE="$(extract 'cbm-resolve-start' 'cbm-resolve-end')"
GHOSTS="$(extract 'cbm-ghosts-start' 'cbm-ghosts-end')"
RESOLVE_LINES="$(printf '%s\n' "$RESOLVE" | wc -l | tr -d ' ')"
GHOSTS_LINES="$(printf '%s\n' "$GHOSTS" | wc -l | tr -d ' ')"
if [ "$RESOLVE_LINES" -lt 10 ]; then
  echo "FATAL: extracted only $RESOLVE_LINES resolve lines -- the cbm-resolve-*"
  echo "       markers are gone, so nothing is policing the hook any more."
  exit 1
fi
if [ "$GHOSTS_LINES" -lt 5 ]; then
  echo "FATAL: extracted only $GHOSTS_LINES ghost lines -- cbm-ghosts-* markers gone"
  exit 1
fi
echo "extracted from $HOOK: resolve=$RESOLVE_LINES lines, ghosts=$GHOSTS_LINES lines"

# ── 1. resolution order ─────────────────────────────────────────────────────
{ printf '%s\n' "$RESOLVE"; echo 'printf "%s\n" "$_CBM_EXE"'; } > "$TMP/resolve.sh"

resolve() { # $1 fake HOME, $2 fake PATH, $3 CBM_EXE, $4 CODEBASE_MEMORY_MCP_BIN
  HOME="$1" PATH="$2" CBM_EXE="$3" CODEBASE_MEMORY_MCP_BIN="$4" bash "$TMP/resolve.sh"
}

mkfake() { # $1 dir acting as a HOME that holds every candidate at once
  H="$1"
  mkdir -p "$H/AppData/Local/codebase-memory-mcp/0.9.0" \
           "$H/AppData/Local/codebase-memory-mcp/0.10.2" \
           "$H/AppData/Local/Programs/codebase-memory-mcp" "$H/bin"
  for f in "$H/AppData/Local/codebase-memory-mcp/0.9.0/codebase-memory-mcp.exe" \
           "$H/AppData/Local/codebase-memory-mcp/0.10.2/codebase-memory-mcp.exe" \
           "$H/AppData/Local/Programs/codebase-memory-mcp/codebase-memory-mcp.exe"; do
    printf '#!/bin/sh\n' > "$f"; chmod +x "$f"
  done
  # The trap that broke the hook: PATH points at the stale Programs build.
  printf '#!/bin/sh\n' > "$H/bin/codebase-memory-mcp"
  chmod +x "$H/bin/codebase-memory-mcp"
}

echo "-- resolution order"
H1="$TMP/home1"
mkfake "$H1"
VROOT="$H1/AppData/Local/codebase-memory-mcp"
same "newest versioned install wins over PATH" \
  "$VROOT/0.10.2/codebase-memory-mcp.exe" "$(resolve "$H1" "$H1/bin:/usr/bin:/bin" "" "")"

mkdir -p "$VROOT/0.10.10"
printf '#!/bin/sh\n' > "$VROOT/0.10.10/codebase-memory-mcp.exe"
chmod +x "$VROOT/0.10.10/codebase-memory-mcp.exe"
same "versions sort numerically, not lexically (0.10.10 beats 0.9.0)" \
  "$VROOT/0.10.10/codebase-memory-mcp.exe" "$(resolve "$H1" "$H1/bin:/usr/bin:/bin" "" "")"

same "CBM_EXE pin overrides everything" \
  "$H1/pinned.exe" "$(resolve "$H1" "$H1/bin:/usr/bin:/bin" "$H1/pinned.exe" "")"
same "CODEBASE_MEMORY_MCP_BIN honoured (launcher parity)" \
  "$H1/launcher-pinned.exe" "$(resolve "$H1" "$H1/bin:/usr/bin:/bin" "" "$H1/launcher-pinned.exe")"

H2="$TMP/home2"
mkdir -p "$H2/bin"
printf '#!/bin/sh\n' > "$H2/bin/codebase-memory-mcp"
chmod +x "$H2/bin/codebase-memory-mcp"
same "PATH still used when no versioned install exists" \
  "$H2/bin/codebase-memory-mcp" "$(resolve "$H2" "$H2/bin:/usr/bin:/bin" "" "")"

H3="$TMP/home3"
mkdir -p "$H3/AppData/Local/Programs/codebase-memory-mcp"
P3="$H3/AppData/Local/Programs/codebase-memory-mcp/codebase-memory-mcp.exe"
printf '#!/bin/sh\n' > "$P3"
chmod +x "$P3"
same "legacy Programs install reachable as a last resort" \
  "$P3" "$(resolve "$H3" "/usr/bin:/bin" "" "")"

H4="$TMP/home4"
mkdir -p "$H4"
same "nothing installed anywhere resolves to empty" \
  "" "$(resolve "$H4" "/usr/bin:/bin" "" "")"

# ── 2. reserved-name ghosts ─────────────────────────────────────────────────
{ printf '%s\n' "$GHOSTS"; echo '_cbm_quarantine_ghosts "$1"'; } > "$TMP/ghosts.sh"

echo "-- reserved-name ghosts"
R1="$TMP/repo1"
mkdir -p "$R1"
git -C "$R1" init -q .
printf 'bash: cd: nope: No such file or directory\n' > "$R1/nul"
printf 'junk\n' > "$R1/con"
printf 'real work\n' > "$R1/keep.txt"
bash "$TMP/ghosts.sh" "$R1"
gone "untracked nul is relocated out of the root" "$R1/nul"
gone "untracked con is relocated out of the root" "$R1/con"
kept "ordinary files are untouched" "$R1/keep.txt"
NQ="$(ls -1 "$R1/.git/cbm-ghosts" 2>/dev/null | wc -l | tr -d ' ')"
same "relocated ghosts stay recoverable under .git/cbm-ghosts" "2" "$NQ"

# A tracked path must never be moved, even if it is named like a ghost. git
# cannot track 'nul' on Windows, so stub ls-files to answer "tracked".
REAL_GIT="$(command -v git)"
mkdir -p "$TMP/stub"
printf '#!/bin/sh\nif [ "$1" = "-C" ]; then sub="$3"; else sub="$1"; fi\nif [ "$sub" = "ls-files" ]; then exit 0; fi\nexec %s "$@"\n' "$REAL_GIT" > "$TMP/stub/git"
chmod +x "$TMP/stub/git"
R2="$TMP/repo2"
mkdir -p "$R2"
git -C "$R2" init -q .
printf 'another agents in-flight file\n' > "$R2/nul"
PATH="$TMP/stub:$PATH" bash "$TMP/ghosts.sh" "$R2"
kept "a tracked path is never relocated (stubbed ls-files)" "$R2/nul"

# ── 3. failure visibility ───────────────────────────────────────────────────
echo "-- failure visibility"
IDX="$(grep -A4 'cli index_repository' "$HOOK")"
hasnt "the index invocation does not write to /dev/null" "/dev/null" "$IDX"
has   "the index invocation appends to the run log" "_CBM_LOG_FILE" "$IDX"
has   "the exit status is recorded in the log" "index exit=" "$(cat "$HOOK")"
[ -x "$HOOK" ] && ok "hook is executable on disk" || bad "hook is executable on disk"
same "hook is mode 100755 in the git index" "100755" "$(git ls-files -s "$HOOK" | awk '{print $1}' | head -1)"

# ── 4. end to end ───────────────────────────────────────────────────────────
echo "-- integration"
R3="$TMP/repo3"
mkdir -p "$R3/.githooks"
git -C "$R3" init -q .
git -C "$R3" config core.hooksPath .githooks
cp "$HOOK" "$R3/.githooks/post-commit"
chmod +x "$R3/.githooks/post-commit"
printf '#!/bin/sh\necho "tripwire saw: $*"\nexit 0\n' > "$TMP/trip.sh"
chmod +x "$TMP/trip.sh"
printf 'ghost\n' > "$R3/nul"
LOG="$R3/run.log"
CBM_EXE="$TMP/trip.sh" CBM_POST_COMMIT_LOG="$LOG" git -C "$R3" hook run post-commit
I=0
while ! grep -q 'index exit=' "$LOG" 2>/dev/null; do
  I=$((I+1))
  if [ "$I" -gt 60 ]; then break; fi
  sleep 0.25
done
if [ -f "$LOG" ]; then
  L="$(cat "$LOG")"
  has "run log records the start line" "index start exe=" "$L"
  has "run log captures the indexer stdout" "tripwire saw: cli index_repository" "$L"
  has "run log records a zero exit status" "index exit=0" "$L"
  gone "the hook cleared the ghost before indexing" "$R3/nul"
else
  bad "hook wrote a run log" "no log after 15s -- the silent-failure bug is back"
fi

rm -f "$LOG"
CBM_SKIP_POST_COMMIT=1 CBM_EXE="$TMP/trip.sh" CBM_POST_COMMIT_LOG="$LOG" git -C "$R3" hook run post-commit
sleep 0.5
if [ -f "$LOG" ]; then
  bad "CBM_SKIP_POST_COMMIT=1 disables the hook" "it still wrote $LOG"
else
  ok "CBM_SKIP_POST_COMMIT=1 disables the hook"
fi

echo
echo "post-commit hook guard: $PASS passed, $FAIL failed"
if [ "$FAIL" -ne 0 ]; then exit 1; fi
exit 0
