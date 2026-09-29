<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 major, 1 minor) · Audited on branch 0.0.40. This record describes a decision taken inside a hook that no longer exists, so the first job was finding where the behaviour went. MAJOR — the subject of the record, "the shared `useCloudSync` hook", is not in the tree. `ui/src/hooks/` holds 37 hooks and none is `useCloudSync`; a repo-wide `git grep` for the name returns exactly two hits, and BOTH are prose, not code: this file and a module comment at `ui/src/hooks/useSyncConnection.ts:6` that describes "the full `useCloudSync` hook" as something it deliberately does not pull in. That second one is a dangling reference left in a source file — a CODE finding, reported rather than patched, because the default repair direction for this skill is doc to code and editing a `.ts` file is outside a doc audit. What replaced it: the decision survives in `ui/src/features/settings/sections/SyncSection.tsx`, which takes `syncRun` as an injected prop (declared `:109`, destructured `:147`, awaited `:468`) and calls it unconditionally — which is precisely the "always delegate to the sync command" behaviour this record claims to have introduced. Repaired to name that. MINOR — the command is `sync_run_scoped`, not `sync_run` (`apps/desktop-tauri/src/commands/sync.rs:299`); the TypeScript wrapper is `syncRunScoped` (`ui/src/api/offline.ts:177`). Repaired. · NOT re-verified, and flagged rather than asserted: the "Regression coverage" paragraph claims a hook test proving that an empty localStorage URL still invokes the sync command. Neither `ui/src/__tests__/SyncSection.test.tsx` nor `ui/src/__tests__/CloudSyncSettings.test.tsx` contains a `localStorage` reference, and `syncRun` is supplied as a prop only from those two test files (`CloudSyncSettings.test.tsx:586` wires it to `syncRunScoped(sessionToken ?? '')`, `SettingsToggleButtons.test.tsx:314` to a `vi.fn()`), so no production component injects it by that JSX prop. The specific test this record points at could not be located and may have been renamed or removed when the hook was split; that is a question for whoever owns the sync UI, not something this audit should guess at. · No stamp or footer existed on this file before this pass. -->

# Phase 3 — Tauri Sync Diagnostics

**Date:** 2026-08-09
**Scope:** Debug Tauri sync invocation and UI hydration
**Status:** Implemented

## Problem

The shared `useCloudSync` hook — since split up, see the audit stamp above — refused to call the real `sync_run_scoped` command when its localStorage copy of the server URL was empty. Debug auto-provisioning writes the URL and API key to the Tauri settings database, so this stale UI guard could make a working persisted configuration appear idle and hide the backend's explicit diagnostic result.

## Decision

`sync_run_scoped` is the authority for whether sync is configured, enabled, authenticated, and reachable. The hook now always delegates to it when a run is requested; the unconditional call lives on in `SyncSection.tsx:468`. It continues to display the returned `synced`, `failed`, and `error` fields and refreshes the authoritative pending count. The localStorage URL remains UI hydration state and is still used for connection probes and destructive pulls, which require a user-supplied candidate URL.

## Regression coverage

The hook test now proves that an empty localStorage URL still invokes `sync_run`, accepts a successful persisted-backend result, updates the status to online, and emits the success toast.

This keeps the repair scoped: no credentials are exposed, no database schema changes are required, and the existing Tauri command contract remains unchanged.

> last audited 29-09-26 by docs-auditor
