#!/usr/bin/env bash
# scripts/wtree-guard.sh — detect concurrent edits to files you are working on
#
# WHY THIS EXISTS
# This repo is edited by several agents in ONE shared worktree. Two failure
# modes have already cost real time here:
#
#   1. Silent revert — another agent's `git stash` / `git checkout --`
#      replaced an in-flight file with HEAD. Nothing failed loudly; the
#      symptom was tests behaving impossibly (a fix that "passed" because
#      cargo re-ran a stale binary, or half a change set present).
#   2. Foreign hunks — `git commit -- <path>` commits the WORKING TREE
#      version of that path, not "your hunks". Someone else's in-flight
#      edits to the same file land in your commit. This produced a red
#      HEAD once and put one agent's fix inside another's commit.
#
# Both are drift between "I verified this file" and "I committed this
# file". This tool makes that window observable.
#
# USAGE
#   bash scripts/wtree-guard.sh own   <file...>   # claim files, snapshot content
#   bash scripts/wtree-guard.sh verify            # stamp current content as tested-good
#   bash scripts/wtree-guard.sh check             # report drift since the stamp (exit 1 if any)
#   bash scripts/wtree-guard.sh status            # show what is claimed
#   bash scripts/wtree-guard.sh release           # drop the claim
#
# TYPICAL LOOP
#   wtree-guard own crates/kasirmu-core/src/cache.rs
#   ...edit... ; cargo test ... ; wtree-guard verify
#   ...later...  wtree-guard check   # <- run IMMEDIATELY before committing
#
# State lives in $(git rev-parse --git-dir)/oz-wtree-guard, so it never
# appears in git status and is never committed.
#
# WHY THIS IS NOT WIRED INTO .githooks/pre-commit
# It is tempting, but the claim file is per-REPOSITORY, not per-agent: if
# the hook enforced it, my claim could block another agent's commit for
# drift in a file they never touched. So it stays opt-in and the TDD
# skill tells you to run `check` immediately before you commit.
#
# It cannot prevent foreign hunks either — that is a property of
# `git commit -- <path>` committing the working-tree version of a path.
# What it does is shrink the window to a signal: if the file changed
# after your last verified run, you find out before the commit, not from
# a red HEAD afterwards.

set -euo pipefail

GUARD_FILE="$(git rev-parse --git-dir)/oz-wtree-guard"

usage() {
  sed -n '2,32p' "${BASH_SOURCE[0]}"
  exit "${1:-1}"
}

head_sha() { git rev-parse HEAD 2>/dev/null || echo "no-head"; }

# Blob hash of the working-tree copy, or "missing".
work_blob() {
  local f="$1"
  [ -f "$f" ] || { echo "missing"; return; }
  git hash-object -- "$f" 2>/dev/null || echo "unreadable"
}

# Blob hash recorded in HEAD for that path, or "absent".
head_blob() {
  local f="$1"
  git rev-parse --verify --quiet "HEAD:$f" 2>/dev/null || echo "absent"
}

cmd_own() {
  [ $# -gt 0 ] || { echo "own: no files given"; usage 1; }
  local tmp
  tmp="$(mktemp)"
  printf 'HEAD %s\n' "$(head_sha)" >"$tmp"
  local f
  for f in "$@"; do
    printf 'FILE %s %s\n' "$f" "$(work_blob "$f")" >>"$tmp"
  done
  # Merge with any existing claim so a second `own` does not erase the first.
  if [ -f "$GUARD_FILE" ]; then
    awk '
      /^FILE / { seen[$2] = 1; print }
      !/^FILE / { next }
    ' "$GUARD_FILE" >"$tmp.mine" || true
    # keep previously claimed files that were not re-supplied
    while read -r _ path _; do
      [ -n "${path:-}" ] || continue
      skip=0
      for f in "$@"; do [ "$f" = "$path" ] && skip=1; done
      [ "$skip" = "0" ] && printf 'FILE %s %s\n' "$path" "$(work_blob "$path")" >>"$tmp"
    done <"$tmp.mine"
    rm -f "$tmp.mine"
  fi
  mv "$tmp" "$GUARD_FILE"
  echo "wtree-guard: claimed $(printf '%s\n' "$@" | wc -l | tr -d ' ') file(s); HEAD=$(head_sha)"
}

cmd_verify() {
  [ -f "$GUARD_FILE" ] || { echo "wtree-guard: nothing claimed (run 'own <file...>' first)"; exit 1; }
  local tmp tag path blob
  tmp="$(mktemp)"
  printf 'HEAD %s\n' "$(head_sha)" >"$tmp"
  while read -r tag path blob; do
    [ "$tag" = "FILE" ] || continue
    printf 'FILE %s %s\n' "$path" "$(work_blob "$path")" >>"$tmp"
  done <"$GUARD_FILE"
  mv "$tmp" "$GUARD_FILE"
  echo "wtree-guard: stamped current content as verified (HEAD=$(head_sha))"
}

cmd_check() {
  [ -f "$GUARD_FILE" ] || { echo "wtree-guard: nothing claimed"; exit 0; }
  local stamped_head drift=0 tag path want have hblob now_head
  stamped_head="$(awk '$1=="HEAD"{print $2}' "$GUARD_FILE")"
  now_head="$(head_sha)"

  if [ "$stamped_head" != "$now_head" ]; then
    echo "wtree-guard: NOTE HEAD moved since the stamp ($stamped_head -> $now_head)"
    echo "             someone committed while you worked; re-read your files before trusting them."
  fi

  while read -r tag path want; do
    [ "$tag" = "FILE" ] || continue
    have="$(work_blob "$path")"
    hblob="$(head_blob "$path")"
    if [ "$have" = "$want" ]; then
      echo "wtree-guard: OK      $path"
    elif [ "$have" = "$hblob" ]; then
      echo "wtree-guard: REVERTED $path — content now equals HEAD; your edits are GONE."
      echo "             Check 'git stash list' (restore WITHOUT popping: git checkout 'stash@{N}' -- $path)"
      echo "             then touch the file: (Get-Item $path).LastWriteTime = Get-Date"
      drift=1
    elif [ "$have" = "missing" ]; then
      echo "wtree-guard: DELETED  $path — the file no longer exists."
      drift=1
    else
      echo "wtree-guard: DRIFT    $path — changed after your stamp (by you or by someone else)."
      echo "             Re-run the tests for this file before committing it."
      drift=1
    fi
  done <"$GUARD_FILE"

  if [ "$drift" = "1" ]; then
    echo "wtree-guard: drift detected — do NOT commit until re-verified."
    exit 1
  fi
  echo "wtree-guard: clean"
}

cmd_status() {
  if [ ! -f "$GUARD_FILE" ]; then
    echo "wtree-guard: no claim"
    exit 0
  fi
  echo "claimed files (stamped at HEAD $(awk '$1=="HEAD"{print $2}' "$GUARD_FILE")):"
  awk '$1=="FILE"{print "  " $2}' "$GUARD_FILE"
}

cmd_release() {
  rm -f "$GUARD_FILE"
  echo "wtree-guard: claim released"
}

case "${1:-}" in
  own) shift; cmd_own "$@" ;;
  verify) cmd_verify ;;
  check) cmd_check ;;
  status) cmd_status ;;
  release) cmd_release ;;
  *) usage 1 ;;
esac
