#!/usr/bin/env bash
# scripts/restore-db.sh — Restore a SQLite database from backup
#
# Takes a backup file path, verifies integrity with .integrity_check,
# replaces the active database, and validates with a smoke query.
#
# Usage:
#   bash scripts/restore-db.sh var/backups/kasir-20260720-120000.db.gz
#   bash scripts/restore-db.sh var/backups/kasir-20260720-120000.db.gz var/kasir.db
#   RESTORE_NO_CONFIRM=1 bash scripts/restore-db.sh ...   # skip prompt
#
# Safety: creates a pre-restore backup of the current DB before replacing it.

set -euo pipefail

# ── sqlite3 dot-argument path translation ────────────────────────
# Why this exists, measured on MINGW64_NT-10.0-26200 (Git Bash) with
# sqlite3 3.50.6: MSYS2 rewrites a POSIX path to a Windows path when it is a
# STANDALONE argv element, but NOT when the path is embedded in the string
# passed to a dot-command. So of the four forms below:
#
#   sqlite3 "$DB" ".backup '$ABS'"     -> Error: cannot open "/c/..."
#   sqlite3 "$ABS" "PRAGMA ..."        -> works (argv is translated)
#   sqlite3 "$DB" ".backup 'rel.db'"   -> works (relative, no translation needed)
#   sqlite3 "$DB" ".backup 'C:/...'"   -> works (already a Windows path)
#
# The first form is the pre-restore SAFETY backup below, so an absolute
# target-db made the restore ABORT at its own safety step: "failed to create
# pre-restore backup; aborting." The documented relative form never hit it,
# which is why this survived. cygpath -m yields a Windows path with FORWARD
# slashes, which sqlite3 accepts and which needs no quoting escape, and it
# leaves a relative path alone (verified for all four shapes above, including
# paths containing spaces).
#
# No-op off Windows: `cygpath` is absent, and every path there is already
# what sqlite3 wants.
sqlite3_dot_arg() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

# ── self-test ───────────────────────────────────────────────────
# Proves the dot-argument translation is what makes an ABSOLUTE target work,
# and that the relative form keeps working. Asserted by COUNT, not by matching a
# message: the pre-fix failure is a bare "cannot open /c/..." and the restore
# aborts, so the artifact (the row count the restore left behind) is the thing to
# check.
if [ "${1:-}" = "--self-test" ]; then
  ST_DIR=$(mktemp -d)
  trap 'rm -rf "$ST_DIR"' EXIT
  ST_BAD=0
  # $0 is resolved absolute FIRST because both legs cd into a scratch
  # directory, where a relative script path names a file that is not there --
  # which fails as "no such file", NOT as "the restore failed".
  ST_SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")

  # One leg helper: seed one row, snapshot it, add a row, then restore and report
  # the count the restore left behind. A restore that aborted still leaves the
  # EXTRA row, so the count is how the abort shows up.
  st_leg() {
    st_name="$1"; st_dir="$ST_DIR/$st_name"; st_rel="$2"
    mkdir -p "$st_dir"
    sqlite3 "$st_dir/live.db" "CREATE TABLE t(a); INSERT INTO t VALUES (1);"
    sqlite3 "$st_dir/live.db" ".backup '$(sqlite3_dot_arg "$st_dir/seed.db")'"
    sqlite3 "$st_dir/live.db" "INSERT INTO t VALUES (2);"
    # "|| ST_BAD=1" is needed because a bare failing command trips set -e and
    # aborts the self-test with no output, which reads as a pass in a CI log.
    if [ "$st_rel" = "rel" ]; then
      ( cd "$st_dir" && RESTORE_NO_CONFIRM=1 bash "$ST_SELF" seed.db live.db >/dev/null 2>&1 ) || ST_BAD=1
    else
      RESTORE_NO_CONFIRM=1 bash "$ST_SELF" "$st_dir/seed.db" "$st_dir/live.db" >/dev/null 2>&1 || ST_BAD=1
    fi
    st_n=$(sqlite3 "$st_dir/live.db" "SELECT COUNT(*) FROM t;" 2>/dev/null || printf '?')
    printf "self-test: %s path -> %s row(s) after restore (want 1)\n" "$st_name" "$st_n"
    [ "$st_n" = "1" ] || ST_BAD=1
  }

  st_leg relative rel
  st_leg absolute abs

  if [ "$ST_BAD" = "0" ]; then
    printf "self-test ok - relative and absolute targets both restored to the seeded state\n"
    exit 0
  fi
  printf "self-test FAILED - a leg did not restore the seeded row count\n"
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/restore-db.sh <backup-file> [target-db]"
  echo "  backup-file: path to .db or .db.gz backup"
  echo "  target-db:   path to replace (default: var/kasir.db)"
  exit 1
fi

BACKUP_FILE="$1"
TARGET_DB="${2:-${OZ_DB_PATH:-var/kasir.db}}"

# Verify backup exists
if [ ! -f "$BACKUP_FILE" ]; then
  echo "restore-db: ERROR — backup file not found: $BACKUP_FILE"
  exit 1
fi

# Decompress if needed
RESTORE_DB="$BACKUP_FILE"
CLEANUP_DB=""
if [[ "$BACKUP_FILE" == *.gz ]]; then
  echo "restore-db: decompressing $BACKUP_FILE..."
  RESTORE_DB="${BACKUP_FILE%.gz}"
  gunzip -c "$BACKUP_FILE" > "$RESTORE_DB"
  CLEANUP_DB="$RESTORE_DB"
else
  RESTORE_DB="$BACKUP_FILE"
fi

# Integrity check
cleanup_on_exit() {
  if [ -n "$CLEANUP_DB" ] && [ -f "$CLEANUP_DB" ] && [ "$CLEANUP_DB" != "$TARGET_DB" ]; then
    rm -f "$CLEANUP_DB"
  fi
}
trap cleanup_on_exit EXIT

echo "restore-db: verifying backup integrity..."
if ! sqlite3 "$RESTORE_DB" "PRAGMA integrity_check;" 2>&1 | grep -q "ok"; then
  echo "restore-db: ERROR — backup integrity check FAILED"
  exit 1
fi
echo "restore-db: integrity check PASSED"

# Smoke query — count key tables
TABLE_COUNT=$(sqlite3 "$RESTORE_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';")
echo "restore-db: backup contains $TABLE_COUNT tables"

# Confirm unless RESTORE_NO_CONFIRM is set
if [ "${RESTORE_NO_CONFIRM:-}" != "1" ]; then
  echo ""
  echo "WARNING: This will replace $TARGET_DB with $BACKUP_FILE"
  echo "  Current DB will be backed up to ${TARGET_DB}.pre-restore"
  read -r -p "Proceed? [y/N] " CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "restore-db: aborted"
    rm -f "${RESTORE_DB}" 2>/dev/null || true
    exit 0
  fi
fi

# Create pre-restore safety backup
# Uses .backup (NOT a raw cp): the app runs in WAL mode, so the live
# database's latest writes may live in $TARGET_DB-wal. A plain `cp` of
# the main file would silently drop those uncheckpointed frames, making
# the safety backup stale and useless for rollback. .backup produces a
# consistent snapshot that includes WAL content. The DESTINATION goes through
# sqlite3_dot_arg: MSYS does not translate a path embedded in a dot-command, so
# an absolute $TARGET_DB aborted the restore HERE — at the very step that exists
# to make the restore safe, which is the worst possible place for a path bug.
if [ -f "$TARGET_DB" ]; then
  if ! sqlite3 "$TARGET_DB" ".backup '$(sqlite3_dot_arg "${TARGET_DB}.pre-restore")'"; then
    echo "restore-db: ERROR — failed to create pre-restore backup; aborting." >&2
    exit 1
  fi
  echo "restore-db: pre-restore backup saved to ${TARGET_DB}.pre-restore"
fi

# Replace the active database. mkdir -p the parent first: the default target is
# var/kasir.db, and on a fresh clone nothing has created var/ yet, so `mv` would fail
# with a bare "No such file or directory" that names neither the directory it wanted
# nor the fact that creating it would have worked. Same reason apps/cloud-server/src/db.rs
# and crates/kasirmu-cli/src/commands/mod.rs create their parent before opening.
TARGET_PARENT=$(dirname "$TARGET_DB")
if [ -n "$TARGET_PARENT" ] && [ ! -d "$TARGET_PARENT" ]; then
  if ! mkdir -p "$TARGET_PARENT"; then
    echo "restore-db: ERROR — cannot create target directory: $TARGET_PARENT" >&2
    exit 1
  fi
  echo "restore-db: created target directory $TARGET_PARENT"
fi
mv "$RESTORE_DB" "$TARGET_DB"

# Drop the stale WAL/SHM sidecar files. They belong to the OLD database
# (the one we just replaced); SQLite would otherwise replay those frames
# against the freshly restored main file on next open and corrupt it.
# Safe to remove: their content was captured by the .backup above.
rm -f "$TARGET_DB-wal" "$TARGET_DB-shm"
echo "restore-db: restored $TARGET_DB from $BACKUP_FILE"

# Final validation
if sqlite3 "$TARGET_DB" "SELECT 1;" > /dev/null 2>&1; then
  echo "restore-db: final smoke query PASSED — restore complete"
else
  echo "restore-db: WARNING — final smoke query FAILED. Restore ${TARGET_DB}.pre-restore if needed."
fi
