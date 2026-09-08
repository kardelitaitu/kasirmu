# ui-coder-8 journal — tauri api-layer routing (SettingsContext + ProductThumb)

## Mission
Eliminate the last 2 direct `@tauri-apps/api` violations in ui/src outside ui/src/api/:
1. SettingsContext.tsx:483 — dynamic import('@tauri-apps/api/event') listen('settings_updated')
2. ProductThumb.tsx:28 — dynamic import('@tauri-apps/api/path') appCacheDir()

## Result — COMMITTED
- SHA: `2a9c733ab20196e8b8cce7c39552ac6a5d1a6feb` on branch 0.0.37
- `git merge-base --is-ancestor <sha> HEAD` → ANCESTOR_OK (verified post-commit)
- Message: `refactor(ui): route tauri event and path calls through the api layer`
- 8 files, +109/-53; pre-commit ran all 10 gates (i18n lint clean, bundle-parity 0 missing, ui typecheck passed). Commit attempts 1–2 hit index.lock from concurrent agents; succeeded on attempt 3 after 15s backoff (no --no-verify, no stash, no amend).

## Changes
- **ui/src/api/settings.ts**: new `SettingsUpdatedPayload` interface + `onSettingsUpdated(handler): Promise<UnlistenFn>`. Keeps the dynamic import INTERNALLY: import failure (browser dev) → resolves to a no-op unlisten silently (same as old outer catch); listen() rejection is returned unawaited so the caller's `.catch(console.warn)` still fires — exact old two-tier behavior. Type-only `import type { UnlistenFn }` (erased, no runtime import).
- **ui/src/contexts/SettingsContext.tsx**: imports onSettingsUpdated from '@/api/settings'; effect rewritten to call it; same event name, same own-terminal suppression logic, same unlisten-on-cleanup, same deps.
- **ui/src/api/cache.ts** (NEW): `getAppCacheDir(): Promise<string | null>` — dynamic import of @tauri-apps/api/path + try/catch → null fallback, mirroring the old in-component guard.
- **ui/src/components/ProductThumb.tsx**: resolveCacheDir now calls getAppCacheDir(); module-level memoization unchanged.
- **Test mock updates** (factory mocks of '@/api/settings' that mount SettingsProvider would crash without the new export):
  - SettingsContext.test.tsx: factory made async; onSettingsUpdated delegates to the per-file mocked listen('settings_updated', ...) so all 6 event-bus integration tests keep asserting through tauriListenHandler.
  - WorkspaceSettingsModal.test.tsx / .role-swap.test.tsx: no-op onSettingsUpdated added.
  - a11y/SettingsPage.a11y.test.tsx: no-op onSettingsUpdated added (DEVIATION: file does not literally import SettingsContext — it renders SettingsPage which mounts SettingsProvider — so it was outside the letter of the fence but breaks without it; not on any DO-NOT-TOUCH list; 3-line mock addition).

## Verification evidence
- `npm run typecheck` (ui/): PASS (also re-run by pre-commit gate 9: PASS)
- `npx vitest run` 5 files: api-settings-contract (7), SettingsContext (31), WorkspaceSettingsModal (21), role-swap (3), a11y/SettingsPage (1) → **63/63 passed**, 0 failed
- `npx eslint` on all 8 touched files → 0 errors, 0 warnings
- Final grep `@tauri-apps/api` outside api/dev-mock/tests: ZERO hits in components/contexts/hooks/features. Remaining hits are sanctioned infrastructure only: ui/src/test-setup.ts (global vi.mock of the event module — still required, it intercepts the dynamic import inside api/settings.ts during tests; its line-63 comment is now slightly stale) and ui/src/utils/logged-invoke.ts (the documented invoke wrapper). Broad `@tauri-apps` grep additionally shows only `plugin-updater`/`plugin-dialog` imports in UpdateBanner/SettingsPage/EditProductModal/useVersionStatus — different packages, other agents' files, out of fence.

## Deviations
1. a11y/SettingsPage.a11y.test.tsx touched (justified above).
2. getAppCacheDir returns `Promise<string | null>` not `Promise<string>` — the existing guard returns null in dev-mock/tests and ProductThumb branches on null; mission said "mirror the current guard", so null is preserved.
3. ui/src/api/index.ts does not exist → not touched (fence item moot).
4. No ProductThumb test files exist (git grep confirmed) → none updated.
