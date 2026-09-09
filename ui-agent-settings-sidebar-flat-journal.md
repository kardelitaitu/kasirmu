# sidebar-flat journal — remove category accordion from the Tauri settings sidebar

Branch 0.0.37, worked in place. Mission (direct user order): "remove the collapse
category, we don't need category on sidebar" — flatten SettingsNavTree.

## Collision timeline (read this before touching the same files)

1. I rewrote SettingsNavTree.tsx to a flat list (old 13 sections, order preserved),
   stripped category CSS/FTL, rewrote SettingsNavTree.test.tsx, updated 3 e2e specs.
2. A concurrent agent (no journal yet — check ui-coder-16-journal.md's 13-scaffold
   follow-up) overwrote the component mid-flight with the SAME flat structure but the
   NEW 13-page IA (general, license-subscription, devices-connectivity, business-defaults,
   features-modules, security-account, data-sync, data-management, sync-status [subpage],
   offline-queue [subpage], tax-configuration, exchange-rates, system-diagnostics; plus
   badge). Their version KEEPS my foundation: per-key debounced persist + flush-on-unmount,
   the settings-sidebar-expanded sweep, pinned group, resize splitter, scoped keyboard nav,
   focus trap, trimmed shortcut popover, flat role="list" render.
3. SettingsPage.tsx is being rewritten by that same agent right now and does not
   typecheck (markDirty unused at :265, cmInput unresolved at :714). NOT my breakage;
   do not "fix" — their edit is in motion.

## What landed (working tree, UNCOMMITTED — do not pathspec-commit the component,
## it now contains the other agent's work)

- ui/src/locales/settings.ftl + settings.id.ftl: removed 14 dead category keys
  (settings-category-business/operations/system, settings-sidebar-collapse-all-aria,
  settings-sidebar-count-aria/-title, settings-announce-category-expanded/-collapsed,
  settings-shortcuts-desc-expand/-collapse). RESTORED settings-sidebar-collapse-all-aria
  with flat-IA wording ("Collapse all pages" / "Tutup semua halaman") — the other agent's
  component repurposes the collapse-all button as collapse-into-icon-rail and still
  references the key. lint-i18n.sh: exit 0, "no issues detected".
- ui/e2e/admin-workflows.spec.ts, e2e-settings-persist.spec.ts,
  adr22-workspace-settings.spec.ts: all .settings-sidebar-section-header expansion
  blocks removed (7 in adr22, 2 in persist, helper + test in admin-workflows). No
  category selectors remain anywhere under ui/.
- ui/src/features/settings/SettingsPage.tsx: one stale comment fixed
  ("Accordion state moved" → "Sidebar nav tree lives in SettingsNavTree.tsx (flat list)").
- ui/src/__tests__/SettingsNavTree.test.tsx: rewritten for a flat list (38 tests,
  25 pass). The 13 failures assert the OLD section names (Receipt, Appearance, About,
  'Inventaris', keys 'appearance'/'receipt'/'local-api' order) against the NEW IA —
  they need one alignment pass (labels/keys/pinned fixtures) once the IA migration
  settles. Bundle note for that pass: bundle says settings-nav-data-sync = "Data & Sync"
  while the component label constant is "Data Sync"; prefer asserting against
  NAV_L10N_KEYS + bundle resolution, not label constants.

## Known orphans for the next commit's orphan gate

settings-nav-sync, settings-nav-license, settings-nav-topology remain in both bundles
but the new NAV_L10N_KEYS does not reference them (may be referenced elsewhere — grep
before deleting). settings-nav-plus-badge-aria is now referenced by the component and
present in both bundles, closing coder-16's recorded deviation.

## Verification

- bash scripts/lint-i18n.sh → exit 0 (Git bash, full path).
- npx vitest run src/__tests__/SettingsNavTree.test.tsx → 25/38 pass; 13 failures are
  the stale-IA assertions above.
- npm run typecheck → 2 errors, both in SettingsPage.tsx (other agent, in flight).
- NOT committed: the working tree mixes two agents' uncommitted work; committing the
  shared files now would sweep the other agent's half-done SettingsPage under a wrong
  message (see AGENTS.md 3b10ea3a warning). Wait for the IA migration to settle or for
  an explicit user instruction, then commit with an explicit pathspec.
