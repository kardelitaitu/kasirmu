#!/usr/bin/env bash
# scripts/backup-db.sh — SQLite database backup with compression and retention
#
# Copies the active SQLite database using the .backup command (safe, consistent),
# timestamps the output, and compresses with gzip. Automatically prunes backups
# older than the retention period.
#
# Usage:
#   bash scripts/backup-db.sh                           # backup to default dir
#   bash scripts/backup-db.sh var/kasir.db             # specific DB file
#   BACKUP_DIR=var/backups bash scripts/backup-db.sh    # custom backup dir
#   RETENTION_DAYS=90 bash scripts/backup-db.sh         # keep 90 days
#
# Defaults:
#   DB file: ./var/kasir.db (or OZ_DB_PATH env var)
#   Backup dir: ./var/backups/
#   Retention: 30 days

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
# The first form is what made an ABSOLUTE $BACKUP_DIR unusable: the script
# exited 1 at the .backup step AFTER integrity-check passed, leaving an
# empty backup directory and NO backup. cygpath -m yields a Windows path with
# FORWARD slashes, which sqlite3 accepts and which needs no quoting escape,
# and it leaves a relative path alone (verified for all four shapes above,
# including paths containing spaces).
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
# Proves the dot-argument translation is what makes an ABSOLUTE path work, and
# that the relative form keeps working. A green run that cannot fail is not a
# test, so both legs are asserted by COUNT, not by a message match: without the
# translation the absolute leg leaves 0 backup files and the script exits 1.
if [ "${1:-}" = "--self-test" ]; then
  ST_DIR=$(mktemp -d)
  trap 'rm -rf "$ST_DIR"' EXIT
  ST_BAD=0

  # leg 1: RELATIVE paths, the documented form. Guard against a translator
  # that breaks the common case.
  mkdir -p "$ST_DIR/rel"
  sqlite3 "$ST_DIR/rel/live.db" "CREATE TABLE t(a); INSERT INTO t VALUES (1);"
  # `$0` is resolved to an absolute path FIRST: the relative leg `cd`s into a
  # scratch directory, and a relative "$0" would then name a file that is not
  # there -- which fails as "no such file", NOT as "the backup failed", so the
  # test would blame the wrong thing. `|| ST_BAD=1` is needed because a bare
  # failing command in a subshell trips `set -e` and aborts the whole self-test
  # with NO output, which reads as a pass to anyone scanning a CI log.
  ST_SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
  ( cd "$ST_DIR/rel" && BACKUP_DIR=backups bash "$ST_SELF" live.db >/dev/null 2>&1 ) || ST_BAD=1
  ST_REL=$(find "$ST_DIR/rel" -name '*.db.gz' | wc -l | tr -d ' ')
  printf "self-test: relative path -> %s backup file(s)\n" "$ST_REL"
  [ "$ST_REL" = "1" ] || ST_BAD=1

  # leg 2: ABSOLUTE paths, the form that used to abort. This is the leg the
  # translation earns: reverting it drops ST_ABS to 0.
  mkdir -p "$ST_DIR/abs/backups"
  sqlite3 "$ST_DIR/abs/live.db" "CREATE TABLE t(a); INSERT INTO t VALUES (1);"
  BACKUP_DIR="$ST_DIR/abs/backups" bash "$0" "$ST_DIR/abs/live.db" >/dev/null 2>&1 || ST_BAD=1
  ST_ABS=$(find "$ST_DIR/abs" -name '*.db.gz' | wc -l | tr -d ' ')
  printf "self-test: absolute path -> %s backup file(s)\n" "$ST_ABS"
  [ "$ST_ABS" = "1" ] || ST_BAD=1

  if [ "$ST_BAD" = "0" ]; then
    printf "self-test ok - relative and absolute destinations both produced a backup\n"
    exit 0
  fi
  printf "self-test FAILED - relative=%s absolute=%s (both must be 1)\n" "$ST_REL" "$ST_ABS"
  exit 1
fi

DB_FILE="${1:-${OZ_DB_PATH:-var/kasir.db}}"
BACKUP_DIR="${BACKUP_DIR:-var/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Ensure DB exists
if [ ! -f "$DB_FILE" ]; then
  echo "backup-db: ERROR — database not found: $DB_FILE"
  exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/kasir-${TIMESTAMP}.db.gz"

echo "backup-db: backing up $DB_FILE → $BACKUP_FILE"

# ── Integrity check (fail-fast on corruption) ────────────────────
echo "backup-db: running integrity check..."
INTEGRITY=$(sqlite3 "$DB_FILE" "PRAGMA integrity_check;" 2>&1)
if [ "$INTEGRITY" != "ok" ]; then
  echo "backup-db: ERROR — integrity check FAILED: $INTEGRITY"
  exit 1
fi
echo "backup-db: integrity check PASSED"

# Use sqlite3 .backup for a consistent snapshot. The DESTINATION goes through
# sqlite3_dot_arg: MSYS does not translate a path embedded in a dot-command, so
# an absolute $BACKUP_DIR failed here with "cannot open /c/..." AFTER the
# integrity check had already passed, and the script exited 1 with the backup
# directory created but empty.
sqlite3 "$DB_FILE" ".backup '$(sqlite3_dot_arg "${BACKUP_FILE%.gz}")'"

# Compress
gzip -f "${BACKUP_FILE%.gz}"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "backup-db: done — $BACKUP_FILE ($SIZE)"

# ── Vacuum source DB (reclaim space, rebuild indexes) ────────────
# Non-fatal: backup already succeeded. VACUUM can fail on disk-full
# or lock contention without risking data loss.
echo "backup-db: vacuuming source database..."
if sqlite3 "$DB_FILE" "VACUUM;" 2>&1; then
  echo "backup-db: vacuum complete"
  # Update query planner statistics for fresh index selectivity.
  sqlite3 "$DB_FILE" "PRAGMA optimize;" 2>/dev/null || true
else
  echo "backup-db: WARNING — vacuum failed (backup already saved)"
fi

# Prune old backups
echo "backup-db: pruning backups older than $RETENTION_DAYS days..."
DELETED=$(find "$BACKUP_DIR" \( -name "kasir-*.db.gz" -o -name "oz-pos-*.db.gz" \) -mtime +"$RETENTION_DAYS" -delete -print | wc -l)
echo "backup-db: removed $DELETED old backup(s)"

# List remaining backups
COUNT=$(find "$BACKUP_DIR" \( -name "kasir-*.db.gz" -o -name "oz-pos-*.db.gz" \) | wc -l)
echo "backup-db: $COUNT backup(s) retained"
