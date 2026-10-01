<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 major, 0 minor) · Audited on branch 0.0.40. This is a dated observation record (2026-08-09), so its HTTP results are evidence of that session, not claims about current behaviour, and they are left exactly as recorded. What an audit can still falsify is whether the artifacts it names still exist. MAJOR — the closing "Next phase" names three Tauri commands as `get_sync_settings`, `pending_sync_count` and `sync_run`; no command carries any of those three names. The real ones are suffixed: `get_sync_settings_scoped` (`apps/desktop-tauri/src/commands/sync.rs:46`), `pending_sync_count_scoped` (`:237`) and `sync_run_scoped` (`:299`). Repaired, because an instruction that names a command which does not resolve is the failure mode this skill exists to catch. · MATCH, re-measured: every service and port the Evidence section lists is still defined in `ops/docker/docker-compose.yml` — `pos-cloud-server` at line 41 published as `"${OZ_API_PORT:-3099}:${OZ_API_PORT:-3099}"` (line 48, so 3099 is the default rather than a hard-coded port), `license-server` at line 108 on `8080:8080` (line 113), and `redis` at line 139 on `6379:6379` (line 142); the `/api/v1/health` probe is the same endpoint the compose healthcheck itself uses (lines 15 and 81). · NOT re-measured, deliberately: the 200/401/422 status codes, the `"version":"0.0.25"` body, the running `oz-pos-app.exe` process and the Vite dev server on port 1420. Those are observations of one machine on one day; re-asserting them as current state is the drift this pass is removing, and the executable name in particular predates the `desktop-tauri` / `mobile-tauri` split. · No stamp or footer existed on this file before this pass. -->

# Phase 1 — Local Docker and Dev Tauri Sync Diagnostics

**Date:** 2026-08-09
**Scope:** Local Docker sync server and debug Tauri bootstrap
**Status:** Diagnostic complete; no server-side failure reproduced

## Evidence

- Docker Compose services are running and healthy:
  - `pos-cloud-server` on port `3099`
  - `license-server` on port `8080`
  - `redis` on port `6379`
- `GET http://localhost:3099/api/v1/health` returned HTTP `200` with `{"status":"ok","version":"0.0.25"}`.
- `GET http://localhost:3099/health` returned HTTP `200`, with SQLite connected and zero pending sync items.
- `POST http://localhost:3099/api/v1/tokens` succeeds when the required `label` field is supplied. An empty JSON object correctly returns `422`; this is request validation, not a Docker failure.
- An issued token successfully authenticated:
  - `GET /api/sync/status` returned HTTP `200`.
  - `POST /api/sync/push` with an empty batch returned HTTP `200` and `results: []`.
  - `POST /api/sync/pull` with no cursor returned HTTP `200` and an empty page.
  - The unauthenticated status control returned HTTP `401` as expected.
- A debug `oz-pos-app.exe` process and the Vite dev server are running locally; port `1420` is listening for the dev frontend.
- Recent `pos-cloud-server` logs contain no startup, migration, database, or request errors. The containers have been running since their last healthy startup.

## Conclusion

The first failing seam is **not** Docker health, token issuance, authentication, or the sync HTTP API. The remaining unverified seam is inside the running Tauri client: whether debug auto-provisioning persisted `http://localhost:3099`, the issued API key, and `enabled = true`, and whether `sync_run_scoped` is being triggered and reporting its result.

The token value was not recorded. No credentials or secrets are included in this diagnostic.

## Next phase

Inspect the Tauri-side settings and daemon lifecycle without restarting the existing process. Capture the result of `get_sync_settings_scoped`, `pending_sync_count_scoped`, and one explicit `sync_run_scoped`; then repair only the first failing client-side seam.

> last audited 29-09-26 by docs-auditor
