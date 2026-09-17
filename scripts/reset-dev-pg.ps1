# scripts/reset-dev-pg.ps1 — Reset the development PostgreSQL database
#                           to match the committed PG_INIT schema.
#
# Windows twin of scripts/reset-dev-pg.sh. The shared dev PG container
# (oz-pg-test-15432, port 15432) can drift from 20260813_init.pg.sql when
# concurrent agents merge schema changes without re-migrating their live
# database — every PG integration test then silently skips with
# "Migration error". This drops + recreates the public schema and applies
# PG_INIT so the dev DB always matches the committed schema.
#
# Usage:
#   pwsh scripts/reset-dev-pg.ps1
#   $env:OZ_TEST_PG_URL="postgresql://u:p@host:5432/db"; pwsh scripts/reset-dev-pg.ps1

$ErrorActionPreference = "Stop"

$url = if ($env:OZ_TEST_PG_URL) { $env:OZ_TEST_PG_URL } else { "postgres://postgres:postgres@localhost:15432/postgres" }
$container = "oz-pg-test-15432"

Write-Host "Checking connectivity to $container ..."
docker exec $container psql -U postgres -d postgres -c "SELECT 1" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ $container is not reachable. Start it with:"
    Write-Host "  docker run -d --name oz-pg-test-15432 -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:15432:5432 postgres:16-alpine"
    exit 1
}

Write-Host "Dropping and recreating public schema..."
docker exec $container psql -U postgres -d postgres -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
if ($LASTEXITCODE -ne 0) { exit 1 }

$pgInit = Join-Path $PSScriptRoot "..\crates\kasirmu-core\migrations\20260813_init.pg.sql"
if (-not (Test-Path $pgInit)) {
    Write-Host "❌ PG_INIT file not found at $pgInit"
    exit 1
}

Write-Host "Applying PG_INIT ($pgInit)..."
docker cp $pgInit "${container}:/tmp/pg_init.sql"
docker exec $container psql -U postgres -d postgres -f /tmp/pg_init.sql
if ($LASTEXITCODE -ne 0) { exit 1 }

$tableCount = docker exec $container psql -U postgres -d postgres -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
Write-Host "✅ Dev PG reset complete — $tableCount tables in public schema"
