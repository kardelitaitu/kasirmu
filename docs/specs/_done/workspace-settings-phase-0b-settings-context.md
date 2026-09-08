# Phase 0b — SettingsContext (React Context Provider)

- **Status:** IMPLEMENTED (ADR #22 unified workspace settings shipped in 0.0.19; re-audited 2026-08-08 by docs-auditor)
- **Phase:** 0b of 11 (Workspace Settings Architecture — ADR #22)
- **Parent:** `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md`
- **Severity:** PREREQUISITE (blocks Phases 1–5)
- **Owner:** TBD
- **Est. effort:** 2-3 days

## Summary

Build a React context (`SettingsContext`) that acts as the single source of truth for all settings state. It subscribes to the `settings_updated` event from the Rust backend via `crates/oz-bus`, debounces refetches, supports scoped refetch by changed key, and exposes a `useSettings()` hook for consumer components. This replaces the current pattern where each settings screen independently fetches its own data via direct IPC calls.

## Baseline (pre-fix)

- `ui/src/contexts/SettingsContext.tsx` — **does not exist** (0 matches in codebase)
- `ui/src/hooks/useSettings.ts` — **does not exist**
- `SettingsPage.tsx` calls 7 parallel IPC APIs (`getReceiptSettings`, `getStoreSettings`, `listCurrencies`, `getSyncSettings`, `getUserPreferences`, `getBrandSettings`, `getVersion`) via `Promise.allSettled` on every load
- No shared settings state — each screen is a data silo
- No event bus subscription in the frontend

## Acceptance criteria

### Core context
- [ ] `SettingsContext.tsx` exports `SettingsProvider` and `useSettings()` hook
- [ ] Single `settings_updated` listener registered at mount time via Tauri IPC event listener or mocked `oz-bus` bridge
- [ ] Listener runs in a **non-blocking** task (see Phase 0e — without this, UI thread hangs)
- [ ] Debounce window: 300ms (configurable). Multiple rapid `settings_updated` events within the window trigger exactly one refetch at the end of the window
- [ ] Pending refetch is cancelled if unmount happens during debounce window

### Scoped refetch
- [ ] `settings_updated` event includes `changed_keys: string[]` and `terminal_id: string`
- [ ] Context inspects `changed_keys` and only refetches the affected setting scopes:
  - Keys starting with `receipt.*` → refetch receipt settings only
  - Keys starting with `store.*` or `currency.*` → refetch store settings + currencies
  - Keys starting with `sync.*` → refetch sync settings
  - Keys starting with `brand.*` → refetch brand settings
  - Keys starting with `prefs.*` or `user.*` → refetch user preferences
  - Unknown keys → full refetch (safety fallback)
- [ ] Context exposes `lastChangedKeys: string[]` for UI components that want to highlight recently changed values

### Consumer API
- [ ] `useSettings()` returns `{ settings, loading, error, refetch, lastChangedKeys }`
- [ ] `settings` object typed: `{ receipt, store, sync, brand, preferences, currencies, appVersion }`
- [ ] `loading` is `true` during initial fetch and during debounced refetch windows
- [ ] `refetch()` forces an immediate full reload (bypasses debounce)

### Integration
- [ ] `SettingsPage.tsx` replaces its `Promise.allSettled` load with `<SettingsProvider>` wrapper and `useSettings()`
- [ ] `handleSave()` in `SettingsPage.tsx` publishes `settings_updated` event after successful saves (so other terminals and components react)
- [ ] Unit test: deduplication — fire 5 `settings_updated` events within 100ms → exactly 1 refetch
- [ ] Unit test: scoped refetch — `changed_keys: ['receipt.footer']` → only `getReceiptSettings()` called
- [ ] Unit test: full refetch fallback — `changed_keys: ['unknown.key']` → all APIs called

## Plan

1. Create `ui/src/contexts/SettingsContext.tsx` with `SettingsProvider` component
2. Create `ui/src/hooks/useSettings.ts` with typed hook
3. Implement debounced `settings_updated` listener using `useRef` + `setTimeout`
4. Implement scoped refetch logic based on key prefix matching
5. Implement error boundary: if a scoped refetch fails, retry with full refetch once before surfacing error
6. Wrap the app root or settings route with `<SettingsProvider>`
7. Update `SettingsPage.tsx` to consume `useSettings()` instead of direct IPC calls

## Verification

| Check | Expected |
|-------|----------|
| `cd ui && npm run typecheck` | exit 0 |
| `cd ui && npx vitest run src/__tests__/SettingsContext.test.tsx` | all passing |
| `cd ui && npx vitest run src/__tests__/i18nBundle.test.tsx` | all passing (no regression) |
| `cd ui && npm run lint` | exit 0 |
| Manual: change receipt footer in Settings → verify KDS and POS reflect change without reload | Pass |

## Residual / follow-ups

- Phase 0e (async event bus handler) is a hard blocker — the listener must not block the UI thread
- WebSocket-based real-time sync for cloud-connected terminals is a future enhancement
- `useSettings()` may eventually replace `BrandContext`, `CurrencyContext`, and `AuthContext`-adjacent settings state in a future consolidation

## References

- `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md` §Pillar C, §Pillar D, §Phase 0b
- `ui/src/features/settings/SettingsPage.tsx`
- `platform/kernel/src/event_bus.rs`
- `ui/src/contexts/AuthContext.tsx` (existing context pattern to follow)

> (status corrected to IMPLEMENTED).
>
> last audited 08-08-26 by docs-auditor
