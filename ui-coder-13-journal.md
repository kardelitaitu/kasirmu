# ui-coder-13 journal — api-module IPC contract tests

Mission: close the api-module test gap for the 14 untested modules in
`ui/src/api/` (fence: 11 new test files in `ui/src/__tests__/`).

## Delivered (8 new files, 56 tests, all green)

| File | Module | Exported IPC fns covered |
|---|---|---|
| api-email-contract.test.ts | email.ts (45L) | sendTestReport, getReportSchedule, getReportScheduleScoped, saveReportSchedule |
| api-features-contract.test.ts | features.ts (46L) | listAllFeatures, listAllFeaturesScoped, setFeature, setFeaturesBulk |
| api-gateway-contract.test.ts | gateway.ts (25L) | getGatewayStatus |
| api-legalEntities-contract.test.ts | legalEntities.ts (54L) | list/get/create/update *LegalEntityScoped |
| api-localApi-contract.test.ts | localApi.ts (63L) | status, setEnabled, setPort, setStore, rotateSecret, mintToken (6/6) |
| api-security-contract.test.ts | security.ts (31L) | getKeyRotationInfo, rotateEncryptionKey |
| api-system-contract.test.ts | system.ts (35L) | ping, getVersion, getVersionScoped, getLocalIp, getDeviceId |
| api-browser-contract.test.ts | browser.ts (31L) | openProductImagesScoped (success + window.open fallback) |

Idiom copied from api-shifts-contract.test.ts / api-license-contract.test.ts:
`vi.hoisted` mockInvoke + `vi.mock('@/utils/logged-invoke')` normalizing to
`(cmd, args) => mockInvoke(cmd, args)`, so a no-arg command is asserted as
`(cmd, undefined)`. NOTE the pre-existing aggregate test forwards args
verbatim (`(...args) => mockInvoke(...args)`) and therefore asserts
`(cmd)` with ONE argument — both encodings are correct for their own mock;
do not copy one file's assertion into the other.

## Skipped — no loggedInvoke IPC surface (per mission escape hatch)

- **addons.ts (85L)** — pure data module, zero `loggedInvoke`. Already covered
  by `ui/src/__tests__/addons.test.ts`, which states the same thing in its
  header comment. Contract test would assert nothing about IPC.
- **pos.ts (15L)** — comment-only file. It has **no exports at all** (the split
  notice pointing at sales/products/tax/settings/staff/customers/currency/
  hardware/terminals/offline/audit/system). Nothing importable to test.
- **cache.ts (22L)** — single export `getAppCacheDir` resolves a **dynamic**
  `import('@tauri-apps/api/path')` and returns `null` on failure; it never
  touches loggedInvoke. Its happy path is not file-scopely mockable in this
  harness: `src/test-setup.ts` documents that per-file `vi.mock()` cannot
  intercept these dynamic imports (that is why `@tauri-apps/api/event` is
  mocked globally there). A test here could only pin the `null` fallback,
  which the real module produces for the wrong reason (missing internals,
  not missing webview) — recorded as a follow-up rather than written.
- **branding.ts / subscription.ts / tauri.ts** — excluded by mission.

## Correction to the mission premise (important for the orchestrator DAG)

The scout report said 14 modules have zero tests. That is **false for 7 of the
11 in my fence**: `ui/src/__tests__/api-small-modules-contract.test.ts`
already asserts command names for system (5/5), security (2/2), gateway,
browser (success path), features (3/4 — no `listAllFeaturesScoped`), email
(3/4 — no `getReportScheduleScoped`) and subscription/branding; and
`ui/src/__tests__/api-legal-entities-contract.test.ts` already covers all 4
legalEntities exports.

What was genuinely missing, and what the new files add:
- command-name/arg-shape coverage for the two ADR #7 scoped reads
  `getReportScheduleScoped` and `listAllFeaturesScoped` (only ever mocked at
  the module boundary by EmailReportSettings.test.tsx / FeatureToggleScreen.test.tsx,
  so the wire contract was never asserted);
- **all of localApi.ts** — 0 % contract coverage before this commit;
  LocalApiSection.test.tsx mocks the whole module, so none of the six command
  names, the `expiryHours` conditional-omit behaviour, or the `''` = primary
  store convention were pinned;
- resolved-value passthrough for every export, and error propagation for
  email/features/gateway/security/system/localApi/legalEntities (the
  aggregate file tests error propagation for subscription only).

No existing file was modified, so the aggregate coverage now partially
duplicates the per-module files. That duplication is harmless (nothing was
weakened or skipped) and the repo idiom is one contract file per api module;
`api-small-modules-contract.test.ts` can be retired once its branding/
subscription blocks are moved out, but that edit is outside my fence.

## Verification

- `npx vitest run <8 new files>` → 8 files / 56 tests passed, 0 act warnings,
  no console noise (browser.ts test spies console.warn and window.open).
- `npm run typecheck` (from ui/) → clean.
- `npx eslint <8 new files>` → 0 errors, 0 warnings.
- No export of any api module had to be changed to make it testable, so
  there is no "needs an export fix" item to report.

## Commit

`f5ddf61237bff6bfcd84d2ac22caf1f2b38a4a47` — `test(ui): add ipc contract tests
for untested api modules` — 8 files, 749 insertions; staged and committed with an
explicit pathspec, and `git merge-base --is-ancestor <sha> HEAD` = OK. All 10
pre-commit gates passed (i18n lint, bundle parity — informational, my paths sit
outside its 6 watched dirs — FTL dedupe, UI typecheck ~21 s).

## Out-of-fence breakage observed (NOT caused by this commit)

`ui/src/__tests__/api-small-modules-contract.test.ts` is RED in the working tree:
its 6 branding.ts tests fail (`Number of calls: 0`) because the parallel branding
workstream has an uncommitted edit to `ui/src/test-setup.ts` adding a global
`vi.mock('@/api/branding', ...)`, which shadows that file's per-file
`loggedInvoke` mock. Reproduced by running the aggregate file alone with none of
my 8 files in the run, so it is independent of this commit — in the combined run
my 8 plus the other 12 neighbor files were green. branding.ts is excluded from my
mission, so the fix belongs to whoever owns the global mock: drop the branding
block from the aggregate file, or `vi.unmock('@/api/branding')` there first.

## Follow-ups worth a ticket

- cache.ts `getAppCacheDir` still has zero coverage; a file-scoped test cannot
  assert its happy path until the dynamic-import/global-mock question above is
  settled.
- Once every api module has a per-module contract file,
  `api-small-modules-contract.test.ts` and `api-legal-entities-contract.test.ts`
  are redundant; retiring them is outside this fence.
