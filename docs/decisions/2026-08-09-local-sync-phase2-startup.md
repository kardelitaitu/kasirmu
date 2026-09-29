<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 minor, 0 major) · Audited on branch 0.0.40. Every change this record claims is still in the launcher, checked at the line rather than taken from the prose. `scripts/start-local-sync.bat` exists and is tracked. The merged-config validation it describes is real: line 78 runs `docker compose --project-directory . -f ops/docker/docker-compose.yml -f ops/docker/docker-compose.override.yml config --quiet` for the default path and line 83 adds `-f ops/docker/docker-compose.pg.yml` for the PostgreSQL path, with `goto compose_config_failed` on `errorlevel 1` — so the "validate before starting" and "merge the PG override explicitly" bullets both hold, and the bug this record set out to fix (a `--profile pg` that never merged the override) cannot recur in this form. The up commands mirror the same two file sets at lines 91 and 98. All four named environment variables are still read: `OZ_API_SECRET` and `OZ_LICENSE_PRIVATE_KEY` at line 105, `PG_PASSWORD` at line 106, `OZ_API_PORT` at line 23. MINOR repaired: the three compose filenames are cited as bare `docker-compose.yml` / `.override.yml` / `.pg.yml`, which reads as repo-root paths where no such file exists — they live under `ops/docker/`, and the launcher is explicit about that with `--project-directory .` plus three `-f ops/docker/...` flags. Repaired to the paths the launcher actually passes, since a reader who took the bare names would run the command in the wrong directory. · The "Windows-only, verified by static inspection" caveat and the "not executed" note are left as written: that is a disclosure about how the record was produced and is still true of it. · No stamp or footer existed on this file before this pass. -->

# Phase 2 — Deterministic Local Sync Startup

**Date:** 2026-08-09
**Scope:** `scripts/start-local-sync.bat` and local Docker Compose startup
**Status:** Implemented

## Problem

The local launcher reported success immediately after `docker compose up -d --build`. That only proved Compose accepted the request; it did not prove that the cloud server had passed its healthcheck or that the token endpoint required by the debug Tauri bootstrap was usable. PostgreSQL mode also passed `--profile pg` without merging `docker-compose.pg.yml`, so it did not select the PostgreSQL override.

## Changes

- Validate the merged Compose configuration before starting containers. Missing `OZ_API_SECRET` or `OZ_LICENSE_PRIVATE_KEY` now fails before a misleading startup-success message; PostgreSQL mode also validates `PG_PASSWORD` through the explicit override.
- Keep the default path on SQLite with the existing `docker compose up` command.
- Merge `ops/docker/docker-compose.yml`, `ops/docker/docker-compose.override.yml`, and
  `ops/docker/docker-compose.pg.yml` explicitly for `--pg`, under `--project-directory .`.
- Wait for both `/api/v1/health` and `POST /api/v1/tokens` to succeed before reporting readiness. The readiness token response is discarded and no credential is printed.
- Include the selected API port in readiness and success messages when `OZ_API_PORT` is supplied in the process environment.

## Verification

- Existing local Compose configuration passes `docker compose config --quiet`.
- The running stack passed health, token issuance, authenticated sync status, push, and pull probes during Phase 1.
- The launcher remains Windows-only and was verified by static inspection; it was not executed because execution would rebuild or restart the shared Docker stack.

## Follow-up

Phase 3 should expose the Tauri-side persisted sync settings and explicit `sync_run` result so a healthy server cannot appear idle when client bootstrap or daemon scheduling is the actual failure.

> last audited 29-09-26 by docs-auditor
