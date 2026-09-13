# Orchestrator Agent 6: Retire the Unreachable KdsSettingsPanel, Keep Its Model

**Document:** `todo-kds-agents-6.md`
**Origin:** agent-M's mount decision (`9f6fcd828`) proved the panel renders nowhere — evidence re-verified by the orchestrator with the full three-grep dead-code protocol (register.tsx registers ONLY KdsScreen + ExpoScreen; zero `kds-settings` route strings tree-wide; the two production importers take `type KdsSettings`, `type DisplayDensity`, `DEFAULT_SETTINGS` — nothing else).

## Decision
The live KDS settings surface is the hamburger panel (Display/Colours/Behaviour + the new Routing Rules section). Re-mounting the orphan is duplication, so: **retire the component, extract the shared model, settle every pin the deletion disturbs.**

## Tasks
1. New `ui/src/features/kds/kdsSettingsModel.ts` (name may adapt to local idiom): move `KdsSettings`, `DisplayDensity`, `DEFAULT_SETTINGS` and any genuinely model-only helpers (settings parse/validate if present) out of `KdsSettingsPanel.tsx`. Doc-header per file law.
2. Repoint importers: `KdsHamburgerPanel.tsx:7`, `KdsScreen.tsx:22` (and any test-file importers found by grep).
3. Delete `KdsSettingsPanel.tsx` + `__tests__/KdsSettingsPanel.test.tsx`. Before deleting, read the 23 tests: any that assert MODEL behavior (defaults shape, parse/validation) move to a new `kdsSettingsModel.test.ts` — behavior of an unreachable component dies with it; model contracts do not.
4. Settle the ratchets the deletion disturbs — the test's own convention, never a widened baseline: `screenExtraction.test.ts` (drop the panel's entry), `popoverSurfaceCompliance.test.tsx` (it references the file), `storageKeyPins` if it names the module, and FTL: keys referenced ONLY by the deleted component become orphans — remove them from BOTH `kds.ftl` and `kds.id.ftl` (shared-with-hamburger keys must survive; the orphan gate + bundle-parity will catch a wrong cut).
5. No behavior changes anywhere else. The editor, Expo, hamburger sections must not notice this commit exists.

## Verification
- Baseline (record before ANY edit): `npm run test -- KdsHamburgerPanel KdsRoutingRulesEditor ExpoScreen StationSelector screenExtraction popoverSurfaceCompliance storageKeyPins` — plus `npm run typecheck` (dev-mock's foreign reds are expected; features/kds must be clean).
- Final: same filters all green, one FEWER test file in the count (the 23 die; moved model tests may add some back), `npm run test` whole-UI once: the foreign trio (SessionLock devmock-version, AnalyticsScreen in-flight, nativeTooltip) must be the ONLY red files and their counts must not grow.
- eslint on every new/touched tsx/ts; zero errors.

## Fence
`ui/src/features/kds/**`, the named test files, `ui/src/__tests__/KdsSettingsPanel.test.tsx`, both kds locale bundles, `screenExtraction.test.ts` (entry removal only). NEVER: dev-mock (dirty, live), crates/**, apps/**, other features. Foreign ` M` on a fence path → stop and report.

## Law & close
New files via the sanctioned one-line add-chain (listing new + touched paths in the commit pathspec); everything else one-line pathspec commits; rustfmt N/A; no cargo fmt (never ran any); no push/branch/stash/amend. Conventional types (`refactor(kds-ui)` for the move+delete, `chore`/`test` as fits per commit). Stamp each box with evidence, rename → `done-todo-kds-agents-6.md`.
