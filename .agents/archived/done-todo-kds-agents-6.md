# Orchestrator Agent 6: Retire the Unreachable KdsSettingsPanel, Keep Its Model

**Document:** `todo-kds-agents-6.md`
**Origin:** agent-M's mount decision (`9f6fcd828`) proved the panel renders nowhere — evidence re-verified by the orchestrator with the full three-grep dead-code protocol (register.tsx registers ONLY KdsScreen + ExpoScreen; zero `kds-settings` route strings tree-wide; the two production importers take `type KdsSettings`, `type DisplayDensity`, `DEFAULT_SETTINGS` — nothing else).

## Decision
The live KDS settings surface is the hamburger panel (Display/Colours/Behaviour + the new Routing Rules section). Re-mounting the orphan is duplication, so: **retire the component, extract the shared model, settle every pin the deletion disturbs.**

## Tasks
1. [x] New `ui/src/features/kds/kdsSettingsModel.ts` (35 ln) — `KdsSettings`, `DisplayDensity`, `DEFAULT_SETTINGS` moved VERBATIM (name matches the `kdsRoutingRulesModel.ts` idiom; doc header per file law). The panel carried no parse/validate helpers to move — its non-UI content was exactly those three symbols; `KdsScreen`'s settings state is a plain `useState(DEFAULT_SETTINGS)`. Commit `cb3254878`.
2. [x] Repointed: `KdsHamburgerPanel.tsx:7`, `KdsScreen.tsx:22`, and grep-found test-file importer `__tests__/KdsHamburgerPanel.test.tsx:15-16` — one import line each, no behavior edits. Commit `cb3254878`.
3. [x] Deleted `KdsSettingsPanel.tsx` (192 ln — NOT 516 as briefed; the 516 figure matched nothing on disk), its companion `KdsSettingsPanel.css` (217 ln, defined classes used ONLY by the deleted TSX — verified no live consumer), and `__tests__/KdsSettingsPanel.test.tsx` (291 ln, 23 tests — ALL 23 were render/interaction tests and died with the component; the 5 model facts they pinned by proxy were distilled fresh into `__tests__/kdsSettingsModel.test.ts` — see Close). Commit `32d9f68b8`.
4. [x] Ratchets settled — each checked with evidence, none widened:
   - `popoverSurfaceCompliance.test.ts` (**.ts, not .tsx as briefed**): panel CSS entry `{ '.kds-settings-popover', 'features/kds/KdsSettingsPanel.css' }` REMOVED with a comment citing the in-file `.kds-layout-popover`/fece7524 precedent (same situation: surface + stylesheet retired together). In commit `32d9f68b8`.
   - `screenExtraction.test.ts`: **no panel entry existed** (grep of the 849-ln SCREENS array: zero hits) — nothing to remove; 187 tests still green. No action.
   - `storageKeyPins.test.ts`: **does not name the deleted module** (its kds entries pin `useKdsOffline`/`KdsCardColorsContext`/`kdsStationPrefs`/`useKdsPreferences`) — no action; 5 tests green.
   - FTL: **zero keys orphaned, zero removed, both bundles untouched.** The panel referenced exactly 9 keys: `kds-settings-aria`, `kds-settings-sound`, `kds-settings-yellow`, `kds-settings-yellow-aria`, `kds-settings-red`, `kds-settings-red-aria`, `kds-settings-auto-ack`, `kds-settings-density`, `kds-slider-value-min`. Post-deletion `git grep -l <key> -- ui/src` per key: every one still has a live reference in `KdsHamburgerPanel.tsx` (non-bundle list = exactly that file; density also in its test). Nothing was "only in the panel", so the orphan gate and bundle-parity had nothing to strand.
   - `noiseDitherCompliance.test.ts` (not in fence, not disturbed): its `.kds-settings-popover` entry asserts presence in `frontend/themes/components.css`, which was NOT touched — direction is list→components.css, so deleting the feature CSS cannot break it; 8 tests green in the final full run. Same list still carries `.kds-layout-popover` after fece7524 — established precedent.
5. [x] No behavior changes anywhere else. KdsScreen (56), KdsHamburgerPanel (54), KdsRoutingRulesEditor (17), ExpoScreen (18), StationSelectorModal (17) test counts identical baseline→final.

## Verification
- Baseline (recorded BEFORE any edit): scoped gate `KdsHamburgerPanel KdsRoutingRulesEditor ExpoScreen StationSelector screenExtraction popoverSurfaceCompliance storageKeyPins` → **8 files, 321 passed, 0 failed**. Typecheck → 9 errors, all foreign (8 `dev-mock/tauri-api.ts` TS6133 + 1 `AnalyticsScreen.tsx` TS6133).
- Final scoped gate (same filters + `kdsSettingsModel`): **9 files, 326 passed** — 321 baseline + 5 salvaged model tests; the 23 dead component tests never matched the scoped filters, they died in the full suite.
- Final FULL `npm run test`: **561 files — 2 failed | 559 passed; 3 tests failed | 9,577 passed | 24 skipped.** The only red files are two members of the foreign trio at their known counts: `SessionLockScreen.test.tsx` (1 — dev-mock version pin) and `nativeTooltipCompliance.test.ts` (2 — foreign sites). The third member, `AnalyticsScreen` (~80 reds at dispatch), turned **green mid-session via foreign commits** (`86e4dc567`/`d5e3aba33`/`411e6dccf` + the `createPortal` typecheck error disappearing between my baseline and final runs) — a shrinking of the trio, which the law permits ("must not grow"). **Zero new reds, zero count growth.**
- Final `npm run typecheck`: 8 errors, all the pre-existing dev-mock foreign TS6133s; **zero in features/kds, kdsSettingsModel.ts, or any touched file.**
- eslint on every touched/new file (`kdsSettingsModel.ts`, `kdsSettingsModel.test.ts`, `KdsHamburgerPanel.tsx`, `KdsScreen.tsx`, `KdsHamburgerPanel.test.tsx`, `popoverSurfaceCompliance.test.ts`): **0 errors.** One warning (`react-refresh/only-export-components` on `KdsScreen.tsx:42` `sameOrders`) predates this work — the same export exists at the same line in the pre-extraction blob; my only KdsScreen edit is the line-22 import.
- Unfiltered-importer sanity check (the AGENTS.md trap) run before deletion: `git grep -n "KdsSettingsPanel"` tree-wide showed ONLY the two type/default-only production imports + their test, the panel itself, and the popover ratchet entry — plus prose in historical docs. Post-deletion the only mentions left are three comment lines recording the retirement.

## Fence
Held. Only `features/kds/**` (model, hamburger, screen, panel+css deleted), `__tests__/` (panel test deleted, model test created, hamburger test import-repointed, popover ratchet entry removed), and NOTHING else. Foreign ` M` at start was on dev-mock/crates/apps/analytics only — no foreign dirt on any fence path, no stop condition. Both commits passed the pre-commit hook (bundle-parity printed 0 missing keys). kds.ftl/kds.id.ftl untouched — staged never, orphan lint vacuous.

## Law & close
- Conventional types: `refactor(kds-ui)` ×2 (extract; retire+settle), `docs(kds-ui)` ×1 (this stamp, renamed into place via the add-chain). No push/branch/stash/amend; no cargo of any kind.
- Commits (pathspec form, one line each):
  1. `cb3254878` `refactor(kds-ui): extract KdsSettings model into kdsSettingsModel.ts` — 4 files, +39/−4. `create mode` on the model only.
  2. `32d9f68b8` `refactor(kds-ui): retire unreachable KdsSettingsPanel, keep model contract` — 5 files, +79/−701. `delete mode` ×3 (tsx, css, panel test), `create mode` kdsSettingsModel.test.ts, popoverSurfaceCompliance entry removed.
- Net: component 192 ln + css 217 ln + its test 291 ln = 701 ln retired; model 35 ln + model test 75 ln = 110 ln kept.
- Deferred (named, outside fence): (1) dead `.kds-settings-popover::after` selector trio in `frontend/themes/components.css` (385/537/666) + the `noiseDitherCompliance.test.ts:120` baseline entry now cover a selector no element carries — harmless (gates green), cleanup belongs to the theme lane, same state as the `.kds-layout-popover` remnants from fece7524; (2) historical prose in CHANGELOG.md and docs/specs/* still names KdsSettingsPanel — audit-stamped history, not to be rewritten by this fence.

## Salvage ledger (23 read → 5 distilled + 18 dead)
None of the 23 was a literal model test — every one drove a render and most opened the popover first — so nothing moved verbatim; the MODEL CONTRACTS they pinned by proxy were distilled into `kdsSettingsModel.test.ts`, and the component behavior died with the component:
1. "carries exactly the five documented fields" — the shape contract the whole suite pinned through props.
2. "defaults to sound on, yellow 5, red 10, auto-accept off, 3 columns" — from the 'Default settings' test plus the checked/slider-value render assertions.
3. "red threshold above yellow" — the invariant the red slider's `min={max(yellow+1,6)}` enforced; stored as a defaults contract, not a DOM attribute check.
4. "density integer within 1–5" — the range the five density buttons represented.
5. "accepts a defaults spread with single-field overrides" — both live consumers' exact usage pattern (`{ ...DEFAULT_SETTINGS, x }`).
Killed outright (18): gear-button render + aria-expanded, popover hidden/open/close/toggle/escape/click-outside, the onChange* prop-plumbing assertions (a component that no longer exists has no props to plumb), label-text renders, aria-pressed density styling. Behavior of an unreachable component died; the model contract did not.
