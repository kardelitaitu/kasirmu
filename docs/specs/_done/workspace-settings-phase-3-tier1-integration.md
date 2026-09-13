# Phase 3 — Tier 1 Integration (Central Hub)

- **Status:** IMPLEMENTED (ADR #22 unified workspace settings shipped in 0.0.19; re-audited 2026-08-08 by docs-auditor)
- **Phase:** 3 of 11 (Workspace Settings Architecture — ADR #22)
- **Parent:** `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md`
- **Severity:** CORE
- **Dependencies:** Phase 0a (SettingsPage extraction), Phase 0b (SettingsContext), Phase 0e (async event bus), Phase 1 (shared cards)
- **Owner:** TBD
- **Est. effort:** 2-3 days

## Summary

Add new nav items for workspace config cards to `SettingsNavTree.tsx` and update `SettingsPage.tsx` to render shared cards in the main content area. Wire `SettingsContext` reactivity so the sidebar and workspace cards update in real time when settings change on another terminal or screen.

## Baseline (pre-fix)

- `SettingsNavTree.tsx`: 18 nav items across 4 categories (Business, Operations, System, Management). No workspace config items.
- `SettingsPage.tsx` (post-Phase 0a): Delegates to section components. No workspace card sections rendered.
- `SettingsContext` (post-Phase 0b): Provider wraps the app. `useSettings()` hook available.
- Shared cards (post-Phase 1): Created but not wired into SettingsPage.

## Acceptance criteria

### Nav items
- [ ] 4 new nav items added to `NAV_ITEMS` in `SettingsNavTree.tsx`:
  - `store-pos` → icon: shopping cart / POS register
  - `restaurant-pos` → icon: utensils / table
  - `kds` → icon: ticket / display panel
  - `inventory` → icon: box / warehouse
- [ ] Nav items placed in the **"Operations"** category (alongside `receipt`, `sync`, `email`)
- [ ] Fluent keys added symmetrically to `settings.ftl` and `settings.id.ftl`:
  - `settings-nav-store-pos`, `settings-nav-restaurant-pos`, `settings-nav-kds`, `settings-nav-inventory`
- [ ] Fuse.js fuzzy search automatically includes new items (no code change needed — index built from `NAV_ITEMS`)
- [ ] Pin-to-top works for new items (no code change needed)
- [ ] "Operations" category auto-expands when navigating to a workspace config section

### SettingsPage rendering
- [ ] `SettingsPage.tsx` `renderSection()` delegates workspace card sections to imported components
- [ ] `store-pos` → `<WorkspaceStorePosSettings variant="full-page" />`
- [ ] `restaurant-pos` → `<WorkspaceRestaurantPosSettings variant="full-page" />`
- [ ] `kds` → `<WorkspaceKdsSettings variant="full-page" />`
- [ ] `inventory` → `<WorkspaceInventorySettings variant="full-page" />`
- [ ] Workspace card components imported via `React.lazy()` with `<Suspense fallback={<Skeleton />}>`
- [ ] Workspace cards receive `terminalId` from active terminal context

### SettingsContext reactivity
- [ ] When a setting changes via `SettingsContext` (from another terminal or screen), the active workspace card re-renders with updated values
- [ ] Integration test: change receipt footer in Tier 1 → verify Tier 2 modal (Phase 4) card shows updated footer within debounce window
- [ ] The `settings_updated` event triggers exactly one refetch (deduplication verified)

## Plan

1. Add 4 new `SettingsNavItem` entries to `NAV_ITEMS` array in `SettingsNavTree.tsx`
2. Add `CATEGORIES` entry: add `store-pos`, `restaurant-pos`, `kds`, `inventory` to the `Operations` category keys array
3. Add `NAV_L10N_KEYS` entries mapping `store-pos` → `settings-nav-store-pos`, etc.
4. Add Fluent keys to `ui/src/locales/settings.ftl` and `settings.id.ftl`
5. Add `case` entries in `SettingsPage.tsx` `renderSection()` for the 4 new keys
6. Wire `React.lazy()` imports with `<Suspense>` wrappers
7. Pass `terminalId` from active terminal context to workspace cards
8. Write integration test: event bus → SettingsContext → UI update
9. Run `scripts/verify-bundle-parity.py` to confirm Fluent keys in both bundles

## Verification

| Check | Expected |
|-------|----------|
| `cd ui && npm run typecheck` | exit 0 |
| `cd ui && npm run lint` | exit 0 |
| `scripts/verify-bundle-parity.py` | all Fluent keys exist in both `.ftl` and `.id.ftl` |
| `cd ui && npx vitest run src/__tests__/SettingsPage.test.tsx` | all passing |
| Integration test: change setting → verify UI updates within debounce window | Pass |
| Manual: navigate to each new nav section → card renders with correct content | Pass |
| Manual: search "Store POS" in sidebar → fuzzy search finds it | Pass |
| Manual: pin "Store POS" to top of sidebar → persists across page reloads | Pass |

## Residual / follow-ups

- "Operations" category may be split into a dedicated "Workspace Config" category if sidebar balance becomes an issue in user testing (documented in ADR §SettingsNavTree Integration)
- Workspace card nav items share the same icons as the topology canvas node type icons — icon component reuse is a future refinement

## References

- `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md` §Pillar A, §SettingsNavTree Integration, §Phase 3
- `ui/src/features/settings/SettingsNavTree.tsx`
- `ui/src/features/settings/SettingsPage.tsx`

> (status corrected to IMPLEMENTED).
>
> last audited 08-08-26 by docs-auditor
