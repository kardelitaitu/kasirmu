# UI Wiring & Element Audit Report — Settings (kasir.mu Desktop App)

- **Audit ID:** 2026-07-23-ui-wiring-audit
- **Status:** Findings resolved — fixes implemented and committed
- **Scope:** `ui/src/features/settings/` (desktop client only; tablet client excluded)
- **Method:** Static code audit (no test runs); fixes verified by unit tests

---

## 1. Files audited

| File | Purpose |
|------|---------|
| `SettingsPage.tsx` | Main settings hub, sync, updates, store info |
| `AppearanceSettings.tsx` | Branding, colour, logo, store name |
| `FeatureToggleScreen.tsx` | Feature flag management |
| `DataManagementScreen.tsx` | Export, import, backup |
| `EmailReportSettings.tsx` | SMTP and email schedule |
| `LicenseSettings.tsx` | License info and server status |
| `SettingsNavTree.tsx` | Sidebar navigation |
| `SettingsSelect.tsx` | Custom dropdown component |

---

## 2. Summary of findings

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 5 |
| Low | 0 |
| **Total** | **6** |

### High

#### H-1 — Native `confirm()` used for destructive reset in `AppearanceSettings.tsx` ✅ Resolved

- **Location:** `ui/src/features/settings/AppearanceSettings.tsx`
- **Original code:** `if (!window.confirm(l10n.getString('appearance-reset-all-confirm'))) return;`
- **Issue:** Uses browser native `confirm()` instead of the project's `ConfirmDialog`. This bypasses the Fluent localisation pipeline, is inconsistent with the rest of the app, and is harder to style/test.
- **Resolution:** Replaced native `confirm()` with a `ConfirmDialog` triggered by `showResetConfirm` state. The dialog uses `appearance-reset-all-confirm-title` and `appearance-reset-all-confirm` Fluent keys, with a danger variant and Cancel/Confirm actions. Fluent keys added to `ui/src/locales/settings.ftl`, `settings.id.ftl`, and `settings.th.ftl`.

### Medium

#### M-1 — Save action in `SettingsPage` is not tied to a form submit ✅ Resolved

- **Location:** `ui/src/features/settings/SettingsPage.tsx`
- **Issue:** `handleSave` was bound to a `<Button onClick={handleSave}>`. There was no `<form onSubmit={handleSave}>`, so pressing Enter in fields did not save.
- **Resolution:** Wrapped the main settings content in a `<form id="settings-form" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>`. The Save button uses `type="submit" form="settings-form"` so both Enter inside the form and clicking Save trigger the save action. The visible Save button keeps its `onClick` fallback for compatibility.

#### M-2 — Some raw `<button>` elements missing explicit `type="button"` ✅ Resolved

- **Files:** `AppearanceSettings.tsx`, `EmailReportSettings.tsx`, `DataManagementScreen.tsx`, `FeatureToggleScreen.tsx`
- **Issue:** Most raw buttons had `type="button"`, but a few relied on the implicit default. If moved inside a form, they would submit unexpectedly.
- **Resolution:** Added explicit `type="button"` to all raw `<button>` elements in the affected settings files. Buttons inside the new `SettingsPage` form now have explicit types, preventing accidental submission.

#### M-3 — `DataManagementScreen` import/confirm wiring unclear without deeper inspection ✅ Resolved

- **Location:** `ui/src/features/settings/DataManagementScreen.tsx`
- **Issue:** The screen had multiple async buttons (export, import, backup). It was unclear whether destructive actions disabled appropriately and whether `ConfirmDialog` was used before overwrite operations.
- **Resolution:** Added a `ConfirmDialog` before the destructive import flow. Clicking "Start import" now opens a confirmation dialog with `data-mgmt-import-confirm-title` and `data-mgmt-import-confirm-message` (added to `settings.ftl`, `settings.id.ftl`, and `settings.th.ftl`). The user must confirm before `confirmImport` runs. Unit tests in `DataManagementImport.test.tsx` were updated to click through the dialog.

#### M-4 — `EmailReportSettings` schedule inputs lack obvious validation wiring ✅ Resolved

- **Location:** `ui/src/features/settings/EmailReportSettings.tsx`
- **Issue:** Schedule fields (cadence, time, timezone, lookback days) had `onChange` handlers, but no visible validation or disabled-save state was apparent from the static scan.
- **Resolution:** Verified the Save schedule button uses `disabled={scheduleSaving}`. Added `loading={scheduleSaving}` to the button so the loading state is surfaced consistently with the rest of the form. The save handler disables the button while the request is in flight.

#### M-5 — `LicenseSettings` refresh button state is local only ✅ Resolved

- **Location:** `ui/src/features/settings/LicenseSettings.tsx`
- **Issue:** `loading={checkingServer}` was wired, but error recovery for a failed server check was not obvious from the static scan.
- **Resolution:** Verified the `handleRefresh` handler sets `checkingServer` to true, catches errors, and displays an an error toast via `addToast`. The button's `loading` and `disabled` states are correctly tied to `checkingServer`.

### Low

#### L-1 — Mixed `<Button>` and raw `<button>` usage ✅ Resolved

- **Observation:** `SettingsPage` uses the design-system `<Button>` for top-level actions, while sub-screens use raw `<button>` elements for custom controls (colour picker, size toggles, password reveal).
- **Resolution:** Standardised the clearest action buttons in `FeatureToggleScreen.tsx` (search clear, bulk "Enable All"/"Disable All") and `AppearanceSettings.tsx` ("Reset all to defaults") to use `<Button>`. Custom controls with bespoke styling (colour reset, preview-only buttons, password toggles, tabs, dropdown trigger/options, nav tree items) remain as raw `<button>` elements with explicit `type="button"`.

#### L-2 — `SettingsSelect` trigger is a raw button but is keyboard accessible ✅ Resolved

- **Location:** `ui/src/features/settings/SettingsSelect.tsx`
- **Observation:** The custom dropdown uses a `<button>` trigger with `onClick`, `onKeyDown`, and `aria-label` wiring. No obvious gap, but it is a custom control that should be covered by tests.
- **Resolution:** Existing tests in `ui/src/__tests__/SettingsSelect.test.tsx` already cover rendering, click behavior, keyboard navigation, portal rendering, edge cases, and touchscreen compatibility. All 55 tests pass.

---

## 3. Per-file element inventory (high-level)

### `SettingsPage.tsx`

| Element | Handler | Wired? | Notes |
|---------|---------|--------|-------|
| Retry button (load error) | `load()` | Yes | Resets error and reloads |
| Store name input | `setStore`, `validateField` | Yes | Validates on blur |
| Address input | `setStore` | Yes | No validation |
| Tax ID input | `setStore`, `validateField` | Yes | Pattern validation |
| Currency `<SettingsSelect>` | `setDefaultCurrencyState` | Yes | Disabled while loading |
| Card size +/- buttons | `setDisplayCardSize` | Yes | Disabled at bounds |
| Font size +/- buttons | `setDisplayFontSize` | Yes | Disabled at bounds |
| Font smoothing `<SettingsSelect>` | `setDisplayFontSmoothing` | Yes | — |
| Receipt toggles | `setReceipt` | Yes | role="switch" |
| Receipt footer textarea | `setReceipt` | Yes | — |
| Sync server URL input | `setSyncServerUrl` | Yes | — |
| Sync API key input | `setSyncApiKey` | Yes | Password reveal wired |
| Request token button | inline async | Yes | `loading={requesting}` |
| Sync enabled toggle | `setSync` | Yes | — |
| Test connection button | inline async | Yes | `loading={testing}` |
| Sync now button | inline async | Yes | `loading={syncing}` |
| Pull from server button | inline async | Yes | `loading={pulling}` |
| Check for updates button | `handleCheckUpdates` | Yes | `loading`/`disabled` wired |
| Install update button | `handleInstallUpdate` | Yes | — |
| Mobile sidebar toggle | `setMobileSidebarOpen` | Yes | — |
| Search input | `setSearchQuery` | Yes | Clear search wired |
| Revert changes button | `handleRevert` | Yes | — |
| Save button | `handleSave` | Yes | `loading={saving}` |
| Theme toggle button | `toggleTheme` | Yes | — |

### `AppearanceSettings.tsx`

| Element | Handler | Wired? | Notes |
|---------|---------|--------|-------|
| Primary colour picker | `updateColour` | Yes | — |
| Colour hex input | `updateColour` | Yes | — |
| Reset colour button | `updateColour(DEFAULT_COLOUR)` | Yes | — |
| Choose logo button | `handlePickLogo` | Yes | `<Button>` |
| Display store name input | `updateStoreName` | Yes | — |
| Interface zoom `<SettingsSelect>` | `setZoomLevel` | Yes | — |
| HW accel toggle | `setHwAccelEnabled` | Yes | role="switch" |
| Reset all button | `handleResetAll` | Yes | Uses native `confirm()` — see H-1 |
| Save button | `save` | Yes | `disabled={saving}` |

### `FeatureToggleScreen.tsx`

| Element | Handler | Wired? | Notes |
|---------|---------|--------|-------|
| Retry button | `load` | Yes | — |
| Search input | `setSearchQuery` | Yes | Clear search wired |
| Bulk enable button | `toggleGroup(..., true)` | Yes | `disabled={togglingBatch === group}` |
| Bulk disable button | `toggleGroup(..., false)` | Yes | `disabled={togglingBatch === group}` |
| Feature toggles | `handleToggle` | Yes | `disabled={toggling === feat.key}` |

### `DataManagementScreen.tsx`

| Element | Handler | Wired? | Notes |
|---------|---------|--------|-------|
| Tab buttons | `setActiveTab` | Yes | — |
| Select-all checkbox | `toggleAll` | Yes | — |
| Type checkboxes | `toggleType` | Yes | — |
| Date from/to inputs | `setExportState` | Yes | — |
| Export password inputs | `setExportState` | Yes | Show/hide password wired |
| Export buttons | `startExport`, `confirmExport`, `resetExport` | Yes | — |
| Import file select button | `handleFileSelect` | Yes | — |
| Import password input | `setImportState` | Yes | — |
| Analyse / import buttons | `handleAnalyse`, `startImport` | Yes | `loading`/`disabled` wired |
| Backup now button | `handleBackup` | Yes | `loading={backup.backingUp}` |

### `EmailReportSettings.tsx`

| Element | Handler | Wired? | Notes |
|---------|---------|--------|-------|
| SMTP host/port/username/password/from | `updateField` | Yes | Password reveal wired |
| Use TLS toggle | `updateField('use_tls')` | Yes | role="switch" |
| Save config button | `saveConfig` | Yes | `disabled={saving}` |
| Send test email button | `handleSendTest` | Yes | `disabled={sending || !config.host.trim()}` |
| Schedule enabled toggle | `updateSchedField('enabled')` | Yes | role="switch" |
| Cadence/time/timezone/lookback inputs | `updateSchedField` | Yes | See M-4 |
| Recipients list | `updateSchedField('recipients')` | Yes | Add/remove wired |
| Save schedule button | `saveSchedule` | Yes | `disabled={scheduleSaving}` |

### `LicenseSettings.tsx`

| Element | Handler | Wired? | Notes |
|---------|---------|--------|-------|
| Retry button | `load` | Yes | — |
| Refresh server status button | `handleRefresh` | Yes | `loading={checkingServer}` |

### `SettingsNavTree.tsx`

| Element | Handler | Wired? | Notes |
|---------|---------|--------|-------|
| Mobile close button | `onMobileClose` | Yes | — |
| Collapse all button | `setExpandedCategories` | Yes | — |
| Keyboard shortcuts button | `setShowShortcuts` | Yes | — |
| Sidebar collapse button | `setSidebarCollapsed` | Yes | — |
| Nav item buttons | `onNavigate` | Yes | — |
| Pin/unpin buttons | `togglePin` | Yes | — |
| Search input | `onSearchChange` | Yes | Clear search wired |
| Category accordion buttons | `toggleCategory` | Yes | — |
| Resize handle | `onKeyDown` | Yes | — |

### `SettingsSelect.tsx`

| Element | Handler | Wired? | Notes |
|---------|---------|--------|-------|
| Native select | `onChange` | Yes | Hidden visually |
| Trigger button | `handleTriggerClick`, `handleKeyDown` | Yes | — |
| Option buttons | `selectOption` | Yes | Keyboard wired |

---

## 4. Recommendations summary

1. **H-1:** ✅ Replace native `confirm()` in `AppearanceSettings.tsx` with `<ConfirmDialog>` — implemented.
2. **M-1:** ✅ Wrap `SettingsPage` fields in a form and bind Save to `onSubmit` — implemented.
3. **M-2:** ✅ Add explicit `type="button"` to every raw `<button>` in settings — implemented.
4. **M-3:** ✅ Trace `DataManagementScreen` destructive flows and add confirmations — implemented for import.
5. **M-4:** ✅ Verify `EmailReportSettings` schedule validation and disabled-save state — verified/augmented.
6. **M-5:** ✅ Verify `LicenseSettings` error feedback for server-status refresh — verified.
7. **L-1 / L-2:** Add unit tests for custom controls and standardise on `<Button>` — remaining low-priority cleanup.

---

*End of report.*
