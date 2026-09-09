# ui-coder-16 journal — role floor + settings screen scaffolds (UNTRACKED, never staged)

Repo: C:/dev/ozpos/0.0.35/oz-pos · branch 0.0.37 (no branching/switching/stashing/pushing).
Skill loaded: ui-components.

## File fence (only these touched)
- ui/src/utils/role.ts (additive: ROLE_HIERARCHY, RoleFloor, roleAtLeast)
- ui/src/__tests__/role.test.ts (existed → extended with describe('roleAtLeast'))
- ui/src/features/settings/screens/*.tsx (13 new scaffolds)
- ui/src/features/settings/screens/screens-placeholder.css (new, shared by all 13)
- ui/src/locales/settings.ftl / settings.id.ftl (nav + placeholder + lock-copy keys)
- ui/src/__tests__/screenExtraction.test.ts (SCREENS array APPEND only)

Never touched: SettingsNavTree.tsx/.css, SettingsPage.tsx/.css, WorkspaceHome.tsx,
features/tax|currency|offline, shared.ftl.

## Task status
- T1 role floor helper — DONE (mirrors WorkspaceHome ROLE_HIERARCHY :96, dedupe noted as
  follow-up; WorkspaceHome untouched). 11 new cases, all spec'd pairs covered.
- T2 13 screens — DONE (named function export only; Localized string children supported by
  @fluent/react 0.15.2 — index.js:327 falls back to getString(id, vars, string)).
- T3 screens-placeholder.css — DONE. Tokens verified in ui/src/frontend/themes/tokens.css:
  --space-5 :188, --space-3 :185, --text-lg :157, --text-sm :154, --color-fg :68,
  --color-fg-muted :72. No hex, no px font size. max-width: 68ch (design-language 65-75ch
  line length; themeTokenCompliance baseline is 0 violations and does not scan max-width).
- T4 FTL — DONE (settings-nav-general reused, not duplicated; 12 new nav keys + 2 placeholder
  notes + 2 lock keys + 1 badge aria key, in both locales, real Indonesian).
- T5 screenExtraction SCREENS — DONE (13 entries appended after AppearanceSettings, no
  reordering; duplicate-class check is per-entry so sharing one CSS across 13 entries is clean).

## Verification (from ui/)
- npx vitest run screenExtraction + i18nBundle + role + SettingsNavTree → 4 files / 273 tests PASS
  (role 27, screenExtraction 181, SettingsNavTree 45 green with the file untouched, i18nBundle 20).
  Re-run after the FTL edits: still 273/273.
- npm run typecheck → clean (also re-run inside both pre-commit hooks).
- npx eslint src/utils/role.ts src/__tests__/role.test.ts src/__tests__/screenExtraction.test.ts
  src/features/settings/screens → 0 errors / 0 warnings (exit 0).

## Commits (both verified with git merge-base --is-ancestor <sha> HEAD)
- bcede2e30cd911c85ad3af6053b9be73c1ee93c5  feat(ui): add role floor helper to utils/role
  2 files: ui/src/utils/role.ts (+50), ui/src/__tests__/role.test.ts (+61/-1). All 10 gates ran.
- 8aba90717c767b119269a64f69f7196c17bae58b  feat(ui): scaffold blank settings screens with localized placeholders
  17 files (+569): 13 scaffolds + screens-placeholder.css + settings.ftl (+26) +
  settings.id.ftl + screenExtraction.test.ts (13 appended entries). All 10 gates ran, incl.
  step 9 typecheck and step 10 "ftl orphans: OK".
- Pre-commit probes recorded before committing: verify-bundle-parity.py --staged-only over the
  13 staged screens → "39 key site(s) across 8 surface(s), 15 unique key(s), 0 missing key(s)";
  lint-i18n.sh → "no issues detected".
- git status on all six fenced paths after the commits → clean.

## DEVIATION (one, deliberate and reported to the orchestrator)
settings-nav-plus-badge-aria ("Requires Plus plan" / "Memerlukan paket Plus") was NOT committed.
Pre-commit step 10 hard-blocks a key whose own commit adds no reference to it, and nothing in the
working tree reads it — the sidebar Plus badge lives in SettingsNavTree.tsx, which is on my
DO-NOT-TOUCH list. Both bundles now carry a comment naming the key and the reason, so the next
agent finds the decision instead of rediscovering it. It must land in the same commit as the badge
that consumes it (or be added to scripts/ftl-orphan-allowlist.json, also outside my fence).
Note: settings-locked-title / settings-locked-desc passed step 10 only because role.ts's doc
comment names them — a real reference once the settings floor gate lands, but a weak one today.

## Follow-ups recorded elsewhere
- Fold features/workspaces/WorkspaceHome.tsx:96 ROLE_HIERARCHY onto utils/role ROLE_HIERARCHY
  (dedupe; WorkspaceHome untouched by design).
- Each scaffold's screenExtraction entry repoints at the migrated screen's own stylesheet.
