#!/usr/bin/env bash
# scripts/reset-dev-pg.sh — Reset the development PostgreSQL database
#                          to match the committed PG_INIT schema.
#
# The shared dev PG container (oz-pg-test-15432, port 15432) can drift from
# 20260813_init.pg.sql when concurrent agents merge schema changes without
# re-migrating their live database. When this happens, every PG integration
# test silently skips with "Migration error" — the schema no longer applies
# idempotently because the live objects differ from what PG_INIT expects.
#
# This script drops and recreates the public schema, then applies the full
# PG_INIT, so the dev DB always matches the committed schema.
#
# Usage:
#   bash scripts/reset-dev-pg.sh                    # default: postgres@localhost:15432/postgres
#   OZ_TEST_PG_URL="postgresql://u:p@host:5432/db" bash scripts/reset-dev-pg.sh   # custom URL
#
# The container can be started with:
#   docker run -d --name oz-pg-test-15432 \
#     -e POSTGRES_PASSWORD=postgres \
#     -p 127.0.0.1:15432:5432 \
#     postgres:17-alpine

set -euo pipefail

# ── Resolve the target URL ──────────────────────────────────────────
URL="${OZ_TEST_PG_URL:-postgres://postgres:postgres@localhost:15432/postgres}"

# Extract host/port for the connectivity check.
HOST_PORT="${URL#*://}"
HOST_PORT="${HOST_PORT#*@}"
HOST_PORT="${HOST_PORT%%/*}"
HOST="${HOST_PORT%:*}"
PORT="${HOST_PORT#*:}"

echo "🔍 Checking connectivity to PG at ${HOST}:${PORT}..."
if ! docker exec oz-pg-test-15432 psql -U postgres -d postgres -c "SELECT 1" &>/dev/null 2>&1; then
    echo "❌ oz-pg-test-15432 container is not reachable."
    echo "   Start it with:"
    echo "     docker run -d --name oz-pg-test-15432 \\"
    echo "       -e POSTGRES_PASSWORD=postgres \\"
    echo "       -p 127.0.0.1:15432:5432 \\"
    echo "       postgres:17-alpine"
    exit 1
fi

# ── Drop and recreate the public schema ─────────────────────────────
echo "🧹 Dropping and recreating public schema..."
docker exec oz-pg-test-15432 psql -U postgres -d postgres -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" 2>&1

# ── Apply the committed PG_INIT ─────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PG_INIT_PATH="${SCRIPT_DIR}/../crates/kasirmu-core/migrations/20260813_init.pg.sql"

if [ ! -f "$PG_INIT_PATH" ]; then
    echo "❌ PG_INIT file not found at $PG_INIT_PATH"
    exit 1
fi

echo "📄 Applying PG_INIT (${PG_INIT_PATH})..."
# Pipe the schema through stdin instead of `docker cp` + `psql -f /tmp/...`:
# Git Bash (MSYS) rewrites POSIX-looking paths in arguments of native
# Windows executables, so `/tmp/pg_init.sql` silently became
# `C:/Users/.../Temp/pg_init.sql` inside the container and the apply
# failed after the schema had already been dropped. stdin has no path
# to convert and works under Git Bash, WSL, and Linux alike.
docker exec -i oz-pg-test-15432 psql -U postgres -d postgres \
    -v ON_ERROR_STOP=1 < "$PG_INIT_PATH" 2>&1

echo "✅ Dev PG reset complete — schema matches the committed PG_INIT."
TABLE_COUNT=$(docker exec oz-pg-test-15432 psql -U postgres -d postgres -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
echo "   ${TABLE_COUNT} tables in public schema"