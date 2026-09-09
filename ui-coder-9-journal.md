# ui-coder-9 — SettingsNavTree UI Missions A1, A2+A3, B

Branch: 0.0.37 (worked in place; never created/switched branches, never stashed/pushed)

## Commits (in order, self-contained, fenced to fence files only)

### 1. A1 — per-key debounce + flush-on-unmount
SHA: 7b16baeec
Subject: fix(ui): flush per-key sidebar preference writes (A1)
Files: ui/src/features/settings/SettingsNavTree.tsx, ui/src/__tests__/SettingsNavTree.test.tsx
(2 files, +61/-8)
- Replaced shared single debounce timer with per-key Map<string,{timer,run}> so simultaneous
  toggles on different preference keys no longer clobber each other.
- Unmount cleanup now FLUSHES all pending writes (clearTimeout + run) instead of dropping them.
- Added 2 tests: persistence within debounce window; flush-on-unmount.
- Pre-commit gates: i18n lint OK, bundle-parity 0 missing, ui typecheck OK.

### 2. A2+A3 — backdrop semantics + scoped keyboard nav
SHA: ddfef205a
Subject: fix(ui): scope settings sidebar keyboard nav and backdrop semantics (A2+A3)
Files: ui/src/features/settings/SettingsNavTree.tsx, ui/src/__tests__/SettingsNavTree.test.tsx
(2 files, +63/-21)
- A2: mobile backdrop div gained role="presentation" tabIndex={-1} (mirrors FastPINOverlay).
- A3: split the document-level keyboard handler into a SEPARATE Escape listener and a guarded
  navigation handler. Guard: skip INPUT/SELECT/TEXTAREA/contentEditable; treat target===sidebar
  or sidebar.contains(target) as inSidebar; treat null/document/body/documentElement as noFocus;
  handler returns early unless inSidebar || noFocus. This preserves the fix's intent while NOT
  breaking the (uneditable, outside-fence) SettingsPage.test.tsx which fires arrows on document.
- A3 tests fire arrows on the sidebar element (fireKey('ArrowDown', sidebar)).
- Pre-commit gates: i18n lint OK, bundle-parity 0 missing, ui typecheck OK.

### 3. B — localize sidebar announcements + search-result behavior
SHA: da1b04dee
Subject: fix(ui): localize settings sidebar announcements (B)
Files: ui/src/features/settings/SettingsNavTree.tsx, ui/src/__tests__/SettingsNavTree.test.tsx,
       ui/src/locales/settings.ftl, ui/src/locales/settings.id.ftl
(4 files, +82/-18)
- Replaced hardcoded English announcements with l10n.getString(...) + Fluent vars
  (section-opened, search-none, search-count, category-expanded, category-collapsed).
- Localized KEYBOARD_SHORTCUTS descriptions via new settings-shortcuts-desc-* keys.
- Added FTL keys to settings.ftl AND settings.id.ftl (real Indonesian).
- DEVIATION/FIX: settings-announce-search-cleared was initially defined in FTL but only referenced
  by the test mock (production line still hardcoded 'Search cleared'). The FTL orphan gate (step 10)
  rejected the first attempt. Remediation: localized line 511 to
  l10n.getString('settings-announce-search-cleared'), consuming the key. Re-committed; orphan gate OK.

## Verification (final B state, from ui/)
- 5-test suite: npx vitest run SettingsNavTree/SettingsPage/modalGuard/keyboardNavigationCompliance/
  loadingStateCompliance → 5 files, 110 passed, 0 failed (EXIT=0).
- typecheck: npm run typecheck → TC_EXIT=0.
- eslint: npx eslint src/features/settings/SettingsNavTree.tsx → ES_EXIT=0 (0 errors, 0 warnings).
- i18n lint: 'C:/Program Files/Git/bin/bash.exe' -c 'bash scripts/lint-i18n.sh' → EXIT=0, "no issues detected".
- Merge-base checks: git merge-base --is-ancestor <sha> HEAD → OK for all three (7b16baeec, ddfef205a, da1b04dee).

## Deviations
- A3 implemented as a guarded document-level listener (not strictly <aside>-bound) because
  SettingsPage.test.tsx (outside fence, must pass, uneditable) fires arrow keys on document;
  the guard scopes behavior to sidebar context / no-focus, preserving the fix's intent.
- B: localized 'Search cleared' announcement to consume the pre-existing settings-announce-search-cleared
  key (orphan-gate remediation).

## Cleanup
Removed all untracked helper/backup files (_bak_*, _orig_*, _bak_ftl_*, _*.log, _testdiff.txt).
Left other agents' in-flight untracked files (ui-coder-12/13-journal.md, StatusBarDegraded.test.tsx,
connectionHealth.*) untouched.
