# Unscoped class-A commands → ui/src/api caller map (the deregistration gate)

> **Citation rule (2026-09-14):** every `:NNN` into a file that is being actively refactored must carry a NAME anchor as well as the number (function name or exact call text), because this repo's extraction campaign moves code out of these files daily — a bare number then cites a brace.

> **CORRECTION 2026-09-13 ~05:30, anchor HEAD `e046e2f26` — the DESKTOP `gated` column here is
> not a permission-check claim.** These classifications came from the registration-gate predicate,
> whose marker vocabulary is four substrings (`require_permission`, `permissions::`,
> `has_permission`, `authorize_with`) and whose bridge clause is **file-level**:
> `text.contains("oz_bridge::") && stems.contains(&module)`, where a stem qualifies if a
> permission token appears ANYWHERE in that bridge file. Re-measured: **369 of 378 desktop gated
> names (97.6%) rest on that clause; only 9 carry a marker in the command body itself.** Of ten
> sampled from the 68 whose forwarded bridge function has no guard even under the widened
> 15-spelling census, **7 showed none on the first hop** — the `auth` stem qualifies on a single
> line, `crates/oz-bridge/src/auth.rs:1234` (`OPERATOR_IMPERSONATE`), inside one impersonation
> command. So **a desktop row marked gated here is a claim about a stem match, not a claim about
> a permission check**, and no deregistration should be briefed off that column without an
> owner-confirmed gate. Method and full counts: see
> `.agents/registration-gate-audit-findings.md`.
> **The TABLET numbers in these files stand.** Tablet was independently verified: 318 registered /
> 193 gated / 125 debt reproduce exactly; 190 of 193 gated rest on a hard in-module marker and the
> file-level clause decides ZERO; 7/7 ratchet tests pass inside a 640/640 unfiltered run; the
> ceiling sits at the measurement with zero slack. The tablet over-claim is three hardware names
> matched on event literals (`print_receipt_scoped`, `print_sales_receipt_scoped`,
> `start_scanner_scoped`) — 3 of 193, not a clause deciding 97.6%. One new tablet-side figure
> from the same census: 20 of the 125 debt rows call a bespoke guard the four tokens cannot see
> (`require_inventory_count_permission` and kin), so tablet debt is **overstated** — 105 on the
> widened vocabulary. Safe direction: a ceiling correction, not a hole.

Measured 2026-09-13 against HEAD `90b7132ca` (branch `0.0.37`) with `git show HEAD:<path>` / `git grep -n -E <re> HEAD -- <paths>` only. Read-only run: one file written (this one), no source edited, no commit, no cargo invocation. Source set = the 36 class-A rows (34 distinct names) in `.agents/unscoped-command-inventory.md`, whose ledgers reconcile (desktop 448/70, tablet 318/126→125).

## 0. Two corrections to the inventory before anything is dispatched on it

1. **`ui/src/api/sync.ts` does not exist.** The `test_sync_connection` wrapper lives in `ui/src/api/offline.ts:266` (twin `:270`). Query that found it: `git grep -n -E "['\"]test_sync_connection(_scoped)?['\"]" HEAD -- ui/src`. Had I assumed the domain file from the Rust module name, this row would have been reported as "no wrapper".
2. **Eight `license::*` rows, not nine.** `git grep -c` over the inventory table: rows matching `^| `license::` = 8 (get_machine_id, get_hardware_fingerprint, renew_license, pause_subscription, resume_subscription, get_license_status, check_license_status, test_auth_connection). Section 3's "nine" is off by one; the count of 22 desktop rows is unaffected.
3. The premise "each deregistration shows the wrapper already calls the scoped name" is **false for every one of the 34**: `ui/src` is one bundle shared by both shells, and 25 of 34 names still have a live front-end arm that invokes the unscoped command — most of them the `sessionToken ? XScoped(t) : X()` fallback, which is dead-looking and very much alive pre-login.

## 1. The table

Legend — **calls**: which name the wrapper/screen invokes · **screens**: number of distinct non-test, non-`ui/src/api`, non-`dev-mock` files that reach the wrapper · **V**: SAFE = every caller already on the twin · UNSC = CALLER-ON-UNSCOPED (fix the named call site first) · NOCALL = NO-UI-CALLER (delete the command outright).

| # | name (shell) | unscoped wrapper | twin wrapper in ui/src | caller(s) outside api/tests | calls | screens | V |
|---|---|---|---|---|---|---|---|
| 1 | get_brand_settings (D) | api/branding.ts:14 | :18 yes | contexts/BrandContext.tsx:54 · AppearanceSettings.tsx:86 | both | 3 | UNSC |
| 2 | pick_logo_file (D) | branding.ts:50 | :62 yes | AppearanceSettings.tsx:162 (fallback) | both | 1 | UNSC |
| 3 | get_backup_status (D) | api/data.ts:85 | :97 yes | DataManagementScreen.tsx:244 | both | 1 | UNSC |
| 4 | create_backup (D) | data.ts:101 | :110 yes | DataManagementScreen.tsx:276 **and** frontend/shell/UpdateBanner.tsx:184 (unconditional) | both | 2 | UNSC |
| 5 | get_report_schedule (D) | api/email.ts:25 | :39 yes | EmailReportSettings.tsx:120 | both | 1 | UNSC |
| 6 | edc_terminal_status (D) | api/edc.ts:34 | **none** | none (only __tests__/api-edc-contract.test.ts:23) | unscoped | 0 | **NOCALL** |
| 7 | list_all_features (D) | api/features.ts:27 | :38 yes | FeatureToggleScreen.tsx:172 | both | 1 | UNSC |
| 8 | set_setting (D+T) | api/settings.ts:230 | :247 yes | UpdateBanner.tsx:211 (unconditional, by design) · 4 scoped sites (all named in §2) | both | 5 files | UNSC |
| 9 | get_key_rotation_info (D) | api/security.ts:27 | **none** | hooks/useKeyAge.ts:24 | unscoped | 1 | UNSC |
| 10 | rotate_encryption_key (D) | security.ts:31 | **none** | none (only api-security-contract.test.ts:45,52,59) | unscoped | 0 | **NOCALL** |
| 11 | list_workspaces (D) | api/workspaces.ts:180 | :86 yes | contexts/WorkspaceContext.tsx:245 · AuthContext.tsx:25 (import) · scoped at TopologyScreen.tsx:291, topologyApply.ts:173 | both | 4 | UNSC |
| 12 | list_workspace_screens (D) | workspaces.ts:213 | :140 yes | WorkspaceContext.tsx:428 (twin has ZERO callers) | unscoped | 1 | UNSC |
| 13 | get_machine_id (D) | api/license.ts:45 | none | components/MachineIdStatus.tsx:15 · LicenseActivationScreen.tsx:96 | unscoped | 2 | UNSC |
| 14 | get_hardware_fingerprint (D) | license.ts:54 | none | LicenseActivationScreen.tsx:100 | unscoped | 1 | UNSC |
| 15 | renew_license (D) | license.ts:97 | none | none (only api-license-contract.test.ts:104) | unscoped | 0 | **NOCALL** |
| 16 | pause_subscription (D) | license.ts:110 | :124 yes | LicenseSettings.tsx:247-249 (ternary) | both | 1 | UNSC |
| 17 | resume_subscription (D) | license.ts:129 | :141 yes | LicenseSettings.tsx:272 | both | 1 | UNSC |
| 18 | get_license_status (D) | license.ts:35 | none | LicenseSettings.tsx:173 · **frontend/shell/AppShell.tsx:151** (app-wide, pre-login-capable) | unscoped | 2 | UNSC |
| 19 | check_license_status (D) | license.ts:40 | none | LicenseSettings.tsx:150,225 · TopologyScreen.tsx:481 | unscoped | 2 | UNSC |
| 20 | test_auth_connection (D) | license.ts:167 | none | hooks/useAuthConnection.ts:98 | unscoped | 1 | UNSC |
| 21 | get_setting (D) | api/settings.ts:213 | :263 yes | hooks/useGatewayStatus.ts:23 (`getSetting('stripe.api_key')`) · UpdateBanner.tsx:144 | both | 2 | UNSC |
| 22 | test_sync_connection (D+T) | api/offline.ts:266 | :270 yes | hooks/useSyncConnection.ts:105 · sections/SyncSection.tsx:146 (twin: ZERO callers) | unscoped | 2 | UNSC |
| 23 | list_sales (T) | api/sales.ts:496 | :500 yes | SalesHistoryScreen.tsx:234 · VoidOrdersScreen.tsx:112 | both | 2 | UNSC |
| 24 | get_sale (T) | sales.ts:504 | :508 yes | PaymentModal.tsx:748 · SalesHistoryScreen/VoidOrders (fallback arms) | both | 3 | UNSC |
| 25 | export_daily_summary (T) | sales.ts:704 | :708 yes | none — DailyTotalWidget.tsx:35 uses the **twin** (anchor `exportDailySummaryScoped(sessionToken)`; was cited :65, drift in the same file) | unscoped only in a test mock (mocks/api.ts:64) | 0 | **NOCALL** |
| 26 | export_sales_by_hour (T) | sales.ts:712 | :716 yes | none — SalesByHourWidget.tsx:31 uses the twin (anchor `exportSalesByHourScoped(sessionToken)`; was cited :60, drift) | unscoped only in mocks/api.ts:65 | 0 | **NOCALL** |
| 27 | export_eod_report (T) | sales.ts:720 | :724 yes | EodReportScreen.tsx:402 (ternary) | both | 1 | UNSC |
| 28 | set_receipt_settings (T) | **no unscoped wrapper exists** | settings.ts:29 yes | none | twin only | 0 | **NOCALL** |
| 29 | set_store_settings (T) | none | settings.ts:49 yes | none | twin only | 0 | **NOCALL** |
| 30 | set_credit_settings (T) | none | settings.ts:89 yes | none | twin only | 0 | **NOCALL** |
| 31 | settle_credit (T) | none | settings.ts:97 yes | none | twin only | 0 | **NOCALL** |
| 32 | set_hardware_settings (T) | settings.ts:139 | :143 yes | hooks/useTerminalHardware.ts:337 (else-arm) · workspace-cards/types.ts:8 | both | 2 | UNSC |
| 33 | get_default_currency (T) | api/currency.ts:34 | :42 yes | contexts/CurrencyContext.tsx:51 (unconditional) and :69-71 (ternary) · payment/useMultiCurrency.ts:41,96 use the twin — **relocation**: the loaders moved out of PaymentModal, whose `:278` is now an argument inside `useMultiCurrency({` at `:277`, not a call | both | 3 | UNSC |
| 34 | set_default_currency (T) | currency.ts:38 | :49 yes | features/setup/**SetupWizard.tsx:326,504** (twin has ZERO callers) | unscoped | 1 | UNSC |

## 2. The three the owner asked to see line by line

**`settings::set_setting` (registered desktop `lib.rs:1012` · tablet `lib.rs:590`) — UNSC in both shells.**
`ui/src/api/settings.ts:230` `loggedInvoke<void>('set_setting', { key, value, userId })` vs twin `:247` `'set_setting_scoped'`. Twin callers — these four are ALL of them: ExitSurveyModal.tsx:52, EmailReportSettings.tsx:163, hooks/useSettingsSave.ts:199-200 (name anchor `setSettingScoped(sessionToken, 'sync.auth_token'`; the call sits inside the `if (saveResult('sync'))` branch opened at `:195` of that 253-line hook), GeneralSection.tsx:50. **The useSettingsSave entry is a FILE RELOCATION, not line drift** — the save orchestration moved verbatim out of `SettingsPage.tsx` (its `:30` imports `./hooks/useSettingsSave`; comment at its `:399`), landing in commit `717017bb1` (`refactor(settings): move the save orchestration into useSettingsSave`) per the manager's git check, so on the 820-line page `:479` is a lone `}` and a reader searching for the old number alone finds nothing. **The "WorkspaceKds/Inventory/RestaurantPos batch saves" this line used to carry as twin callers call a DIFFERENT command:** `setSettingsScoped` → `'set_settings_scoped'` (wrapper `api/settings.ts:275`, invoking at `:282`), at WorkspaceKdsSettings.tsx:136, WorkspaceInventorySettings.tsx:97, WorkspaceRestaurantPosSettings.tsx:114 — batch coverage, not this command's. And the fact worth having here: the literal `'set_setting_scoped'` occurs at exactly one production site, its own wrapper `api/settings.ts:247` (plus `dev-mock/handlers/settings.ts:72`), because every caller reaches it through the `setSettingScoped` wrapper — query `grep -rn "set_setting_scoped" ui/src` → 4 hits, 2 of them tests. The one unscoped caller is UpdateBanner.tsx:211 inside `persistUpdaterSetting`, whose comment at `:205-208` says the unscoped command is used **deliberately** because the banner renders before login. So this name cannot be deregistered by editing a ternary — it needs either an unauthenticated-by-design allowance or a dedicated `updater.*` command. It writes `updater.previous_version` / `updater.last_backup_path` (UpdateBanner.tsx:13,16).

**`sync::test_sync_connection` (desktop `lib.rs:1269` · tablet `lib.rs:609`) — UNSC in both shells, twin entirely unused.**
Wrapper `ui/src/api/offline.ts:266`; twin defined at `offline.ts:269` and invoking at `:270`, with **zero production callers**. Query, wider than the claim and run over three twins at once: `git grep -n -E "\b(testSyncConnectionScoped|listWorkspaceScreensScoped|setDefaultCurrencyScoped)\b" HEAD -- ui/src` → 9 rows = 3 api definitions (currency.ts:45, offline.ts:269, workspaces.ts:136), 1 api doc comment (workspaces.ts:206), 5 under `ui/src/__tests__` (CloudSyncSettings.test.tsx:43,583 inject the scoped variant as a component prop — test harness only); the same query with every exclusion built as its own pathspec (`:!ui/src/api`, `:!ui/src/dev-mock`, `:!ui/src/**/__tests__/*`, `:!ui/src/*.test.ts`, `:!ui/src/**/*.test.tsx`) → **0 rows**. Callers: hooks/useSyncConnection.ts:105 (a poll loop that runs on the login screen, before any session token) and features/settings/sections/SyncSection.tsx:146. Same class as set_setting: a pre-auth probe, so the fix is a ruling, not a one-line edit.

**`security::rotate_encryption_key` (desktop `lib.rs:1099`) — NO-UI-CALLER. The highest-impact name on the list is also the cheapest to remove.**
`ui/src/api/security.ts:30-31` `export const rotateEncryptionKey = (): Promise<RotationInfo> => loggedInvoke<RotationInfo>('rotate_encryption_key')` — no args, no session token, and **no scoped wrapper anywhere in `ui/src`**. The only reference to the export is its own contract test (ui/src/__tests__/api-security-contract.test.ts:45,52,59). Wide negative query (deliberately larger than the conclusion): `git grep -n -E "'(rotate_encryption_key)'" HEAD -- ui crates platform modules apps ':!*.rs'` → exactly one hit, the wrapper line; and `git grep -n -E "\brotateEncryptionKey\b" HEAD -- ui/src` → api + that one test. An ungated key-rotation IPC with no caller is delete-the-command, plus deleting security.ts:30-31 and its test rows.

## 3. The eight desktop `license::*` rows — wrapper exists for all eight, what each calls

| name | wrapper | scoped twin in ui/src | live caller | verdict |
|---|---|---|---|---|
| get_license_status | license.ts:34-35 → `'get_license_status'` | none | LicenseSettings.tsx:173; AppShell.tsx:151 | UNSC |
| check_license_status | :39-40 | none | LicenseSettings.tsx:150, :225; TopologyScreen.tsx:481 | UNSC |
| get_machine_id | :44-45 | none | MachineIdStatus.tsx:15; LicenseActivationScreen.tsx:96 | UNSC |
| get_hardware_fingerprint | :53-54 | none | LicenseActivationScreen.tsx:100 | UNSC |
| renew_license | :96-97 | none | none | **NOCALL** |
| pause_subscription | :109-110 | :120-124 | LicenseSettings.tsx:247-249 ternary | UNSC |
| resume_subscription | :128-129 | :138-141 | LicenseSettings.tsx:272 ternary | UNSC |
| test_auth_connection | :166-167 | none | hooks/useAuthConnection.ts:98 | UNSC |

None of the eight can be excluded as pre-auth by the wrapper shape alone: only `get_machine_id`/`get_hardware_fingerprint` are called from the activation screen (genuinely pre-auth), and their twins exist in Rust but not in `ui/src`. `get_license_status` via **AppShell.tsx:151** is an app-shell poll — deregistering it breaks the shell banner in both states, not a settings card. The owner ruling stands, but it is now a per-name ruling over 8 names, 7 of which need a new scoped wrapper function first.

## 4. The three counts that decide the dispatch

- **SAFE-TO-DEREGISTER today: 0 / 34.** No class-A name has every front-end caller already on the twin.
- **CALLER-ON-UNSCOPED: 25 names.** Wrapper/screen edits land in these files: `ui/src/api/{security,license,edc}.ts` (write scoped twins that do not exist), `contexts/BrandContext.tsx`, `contexts/CurrencyContext.tsx`, `contexts/WorkspaceContext.tsx`, `hooks/{useGatewayStatus,useSyncConnection,useKeyAge,useTerminalHardware,useAuthConnection}.ts`, `features/sales/{SalesHistoryScreen,VoidOrdersScreen,PaymentModal,EodReportScreen}.tsx`, `features/settings/{DataManagementScreen,FeatureToggleScreen,EmailReportSettings,AppearanceSettings,LicenseSettings}.tsx`, `features/settings/sections/GeneralSection.tsx`, `features/setup/SetupWizard.tsx`, `frontend/shell/UpdateBanner.tsx`.
- **NO-UI-CALLER: 9 names** — edc_terminal_status, rotate_encryption_key, renew_license (desktop); export_daily_summary, export_sales_by_hour, set_receipt_settings, set_store_settings, set_credit_settings, settle_credit (tablet). Four of the nine have **no unscoped wrapper at all** in `ui/src`, so the command is reachable only from a hand-written `invoke()` (banned by AGENTS.md) or nothing.

## 5. Proposed ratcheted ordering (one family per commit, ceiling steps down as each lands)

Because `ui/src` is one bundle for both shells, the invariant for every commit is: **remove the unscoped arm from the shared UI first, then deregister the name in the shell(s), then lower the ledger ceiling in the same commit.** Deregistering under a live ternary is a pre-login runtime crash, not a no-op.

1. **Zero-risk deletes first (no UI change at all):** desktop `security::rotate_encryption_key`, `license::renew_license`, `edc::edc_terminal_status` — delete command + registration + the orphaned wrapper lines + their contract-test rows. 3 of the 70 desktop debt rows gone, nothing to gate.
2. **Tablet `history::*` (5) — as ordered, with the family split honestly.** 2 are pure deletes: `export_daily_summary`, `export_sales_by_hour` (widgets already on the twin: DailyTotalWidget.tsx:35, SalesByHourWidget.tsx:31; delete sales.ts:704,712 and the mock rows at __tests__/test-utils/mocks/api.ts:64,65). 3 need the ternary deleted first: SalesHistoryScreen.tsx:234, VoidOrdersScreen.tsx:112, PaymentModal.tsx:747-748, EodReportScreen.tsx:402 — desktop proves the end state (it registers no unscoped original at all), so removing the else-arm on tablet costs nothing desktop-side. Do the 2 deletes as commit 2a and the 3 arm removals + deregistrations as 2b.
3. **Tablet settings DTO writers (4 deletes):** set_receipt_settings, set_store_settings, set_credit_settings, settle_credit — no unscoped wrapper exists, so this is registration-only surgery (tablet `lib.rs:576,578,580,582`).
4. **Desktop workspaces + features + email + branding (single-screen ternaries, mechanical):** `list_workspace_screens` first (twin has zero callers, so the arm removal is also the twin's first use), then `pick_logo_file`, `get_report_schedule`, `list_all_features` (`__tests__/FeatureToggleScreen.test.tsx:450` already asserts the scoped-only end state), then `get_brand_settings` — BrandContext.tsx:54 is the app-wide one, do it last of the four and re-run the brand-parity tests.
5. **`data::{get_backup_status,create_backup}` — blocked on a ruling,** because UpdateBanner.tsx:184 calls `createBackup()` unconditionally pre-login (same class as set_setting/test_sync_connection).
6. **Desktop `license::*` (7 after renew_license is deleted in step 1)** — needs 5 new scoped wrappers (`ui/src/api/license.ts`) and edits to AppShell.tsx:151, LicenseSettings.tsx (4 sites), TopologyScreen.tsx:481, MachineIdStatus.tsx:15, LicenseActivationScreen.tsx:96,100, useAuthConnection.ts:98. Largest family; do it after the mechanical ones so the ratchet ceiling is already down.
7. **Desktop `settings::{get_setting,set_setting}`, `sync::test_sync_connection`, currency pair, `set_hardware_settings`** — the pre-auth/ambient cluster. `get_setting` at useGatewayStatus.ts:23 reads `stripe.api_key`, a deny-listed credential, through an ungated IPC read: treat that one as a security fix, not a ratchet row. `set_default_currency` is used **only** by SetupWizard (pre-session) — deregistering it breaks first-run on both shells; it needs a setup-scoped command or an owner exemption, and is the row most likely to be wrong in the other direction.
8. Then re-generate both ledgers and lower `DEBT_CEILING` (desktop 70, tablet 125 — not 126) and reconcile `scripts/ipc-parity-allowlist.json`.

## 6. Not reached (named)

- **No screen-reachability proof.** "Screens" counts files that reference the wrapper outside api/tests/dev-mock; it does not prove the calling branch renders in the shell's nav on that shell. A per-screen lazy-`register.tsx` reachability walk was not done.
- **No run of either harness** (no cargo). Ledger rows and this map are read, not executed; tablet `registration_gate_tests.rs:200` is still truncated per the inventory.
- **`scripts/ipc-parity-allowlist.json` was not read into this map** — a name can be exempted there and still show UNSC.
- **No Rust-side check of whether each twin actually gates** — taken from the inventory's gate classification, which is harness-measured for desktop and hand-proven only for tablet `history`/`settings`.
- **`ui/src/dev-mock/tauri-api.ts` unscoped handlers (50 literal rows)** were treated as test scaffolding, not callers. Whether the dev mock must be updated in the same commit as each deregistration is an owner call.
- Names registered only on tablet/desktop with class C/D/E posture (list_workspace_screens twin posture, workspaces divergence) were not re-adjudicated.
