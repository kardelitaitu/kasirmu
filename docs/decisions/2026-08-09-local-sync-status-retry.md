<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. A clean pass, and unusually a complete one: every claim in this record is still literally true, and the numbers were read out of the source rather than assumed. The two intervals are exact — `const POLL_INTERVAL_MS = 60_000;` at `ui/src/hooks/useSyncConnection.ts:58` and `const RETRY_INTERVAL_MS = 5_000;` at `:59`, with the module doc at `:3` and `:62-63` describing the same 60 s poll and 5 s retry-while-disconnected split this Decision section prescribes. The command is real and unscoped as written: `test_sync_connection` at `apps/desktop-tauri/src/commands/sync.rs:276` and `apps/mobile-tauri/src/commands/sync.rs:108` (an additional `test_sync_connection_scoped` sits at `apps/desktop-tauri/src/commands/sync.rs:287`, which this record neither claims nor contradicts). The "presentation-only, never handles credentials, stops cleanly on unmount" claim matches the hook's shape — it imports only `testSyncConnection` from `@/api/offline` and the shared `isSyncUnconfigured` / `isSyncUnauthorized` vocabulary, and exposes a `retryNow` re-probe. The Regression coverage paragraph is confirmed by reading the test rather than trusting the summary: `ui/src/__tests__/useSyncConnection.test.ts` mocks a first probe of `{ ok: false, status: 'No server URL configured', latencyMs: null }` at line 81, asserts the `unconfigured` state at line 93, and advances the fake timers by `5_000` at line 96 to prove the second check fires on the retry interval rather than the poll interval. That is precisely the sequence the record describes. Nothing in this file required an edit beyond the stamp. · No stamp or footer existed on this file before this pass. -->

# Local Sync Status Retry

**Date:** 2026-08-09
**Scope:** Status-bar sync connectivity indicator
**Status:** Implemented

## Problem

The Docker sync server can become healthy after the debug Tauri window and status-bar hook start. The hook performed one immediate health check and then waited 60 seconds for the next poll, leaving the indicator red even after the server and auto-provisioning became ready.

## Decision

Keep the 60-second poll interval while connected, but retry every 5 seconds after a failed or disconnected check. This lets a startup race recover without restarting the app or Docker and does not change the backend sync contract.

The retry remains presentation-only: it calls the existing `test_sync_connection` command, never handles credentials, and stops cleanly on unmount.

## Regression coverage

The hook test simulates an initial `No server URL configured` result followed by a successful health check. It verifies the second check occurs after 5 seconds and the indicator transitions to connected with the reported latency.

> last audited 29-09-26 by docs-auditor
