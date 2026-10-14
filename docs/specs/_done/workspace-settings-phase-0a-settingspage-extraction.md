<!-- Audit stamp: 2026-10-11 · docs-auditor · status: REPAIRED (1 major, 1 minor) · TWO CLAIMS ASSERTED TRUE BY THE 2026-09-29 STAMP HAVE SINCE GONE FALSE. (1) MAJOR: `sections/ReceiptSection.tsx` no longer exists — it was REMOVED AS DEAD CODE, and the removal is recorded in the tree (`ui/src/__tests__/SettingsToggleButtons.test.tsx:312-313`), with the live receipt surface now `ui/src/features/restaurant/screens/RestaurantReceiptsScreen.tsx` + `ui/src/features/settings/screens/ReceiptFormatSettingsCard.tsx`. The prior stamp listed it among five present sections and was right at the time. Four of the five still exist (GeneralSection, AppearanceSection, SyncSection, AboutSection), and the directory has since GAINED DiagnosticsSection.tsx and LocalApiSection.tsx. (2) MINOR: the headline criterion '`SettingsPage.tsx` < 500 lines' is no longer met — measured 533 at HEAD, against 456 when the 2026-09-29 stamp read it; the growth is later settings-shell work, not a re-monolith, and the `renderSection` delegator this phase introduced is still there. A dated correction block was added under the title; the Baseline and the spec body are left as the plan-as-approved. VERIFIED AT HEAD: all five named extraction targets that still exist, `SettingsPage.tsx` line count (533), and the four surviving section components. NOT re-measured: the typecheck/lint/vitest/Playwright criteria (a test run, not a doc read) — and the acceptance boxes are deliberately still unticked, as every pass has recorded. · Superseded 2026-09-29 body preserved below as plain quoted text (delimiters stripped so it cannot nest):

Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · Clean pass — this is the best-evidenced file in the 0-series. The phase claims IMPLEMENTED and every acceptance criterion with a checkable artifact holds. All five extracted section components exist under `ui/src/features/settings/sections/`: `GeneralSection.tsx`, `AppearanceSection.tsx`, `ReceiptSection.tsx`, `SyncSection.tsx` and `AboutSection.tsx`, exactly the five the spec says needed extraction (the other 13 already rendered as imported components). The headline criterion — "`SettingsPage.tsx` is reduced to < 500 lines" — is met with room to spare: `ui/src/features/settings/SettingsPage.tsx` is now **456 lines**, down from the "~2,000+ lines with a 18-case renderSection() switch" the Baseline describes. That single number is the strongest evidence in this file and it was worth measuring rather than assuming. · The Residual section is honest about its own cost: it admits the `SectionProps` interface is "intentionally broad" and names Phase 0b as the cleanup. That is the right way to close a refactor whose real debt was deferred. · NOT repaired, deliberately: the acceptance criteria are all `- [ ]` unchecked while Status says IMPLEMENTED. That is a real inconsistency, but the checkboxes belong to the plan-as-approved and ticking them would assert a verification I did not perform — I confirmed the artifacts exist, not that the "all existing E2E tests pass unchanged" and "zero behavioral changes" criteria were run. Recording the gap rather than closing it. · The Parent reference `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md` resolves. -->
# Phase 0a — SettingsPage Section Extraction

- **Status:** IMPLEMENTED (ADR #22 unified workspace settings shipped in 0.0.19; re-audited 2026-08-08 by docs-auditor)
- **Phase:** 0a of 11 (Workspace Settings Architecture — ADR #22)
- **Parent:** `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md`
- **Severity:** PREREQUISITE (blocks Phase 3)
- **Owner:** TBD
- **Est. effort:** 1-2 days

## ⚠️ Audit correction (2026-10-11)

Two claims in this spec have since gone false, and both were asserted as true by the
2026-09-29 stamp this file carried. They are recorded here rather than silently edited,
because the spec is the plan-as-approved:

1. **`sections/ReceiptSection.tsx` no longer exists.** The 2026-09-29 stamp listed five
   extracted sections and named that file among them; it was subsequently **removed as dead
   code**. The live receipt surfaces are now `ui/src/features/restaurant/screens/RestaurantReceiptsScreen.tsx`
   and `ui/src/features/settings/screens/ReceiptFormatSettingsCard.tsx`. The removal is
   recorded in the tree itself: `ui/src/__tests__/SettingsToggleButtons.test.tsx:312-313`
   ("The receipt toggle owner, sections/ReceiptSection.tsx, was removed as dead code: the live
   receipt surface is RestaurantReceiptsScreen / ReceiptFormatSettingsCard"). Four of the five
   named sections still exist: `GeneralSection.tsx`, `AppearanceSection.tsx`, `SyncSection.tsx`,
   `AboutSection.tsx`.
2. **`SettingsPage.tsx` is no longer under 500 lines.** The acceptance criterion
   "reduced to < 500 lines" is now **533** (measured 2026-10-11; it was 456 at the 2026-09-29
   audit). The growth is from later feature work on the settings shell — it is not a
   re-monolith, and the file still carries the `renderSection` delegator the phase introduced —
   but the numeric criterion this phase set for itself is not currently met.

Also worth knowing, since the Baseline describes a fixed set: the sections directory has gained
`DiagnosticsSection.tsx` and `LocalApiSection.tsx`, which this phase predates.

## Summary

Extract each section case from `SettingsPage.tsx`'s monolithic `renderSection()` switch statement into individual screen components. `SettingsPage.tsx` is currently 2,000+ lines with all 18 nav sections rendered inline. Adding workspace card sections in Phase 3 would make the file unmaintainable. This is a pure refactor — no behavioral changes, no UI differences.

## Baseline (pre-fix)

- `ui/src/features/settings/SettingsPage.tsx`: ~2,000+ lines, monolithic component with 15+ `useState` calls, 18-case `renderSection()` switch statement
- Import list at top of file: 20+ static imports including `StaffManagementScreen`, `TerminalManagementScreen`, `TopologyScreen`, `FeatureToggleScreen`, etc.
- Already-established pattern: `FeatureToggleScreen`, `StaffManagementScreen`, `TerminalManagementScreen`, `AuditLogScreen`, etc. are rendered as separate imported components

## Acceptance criteria

- [ ] Each `case` in the `renderSection()` switch is extracted into its own component under `ui/src/features/settings/sections/`
- [ ] `SettingsPage.tsx` is reduced to < 500 lines (sidebar layout + navigation state + save logic + section routing)
- [ ] Components use explicit props (no implicit closure over parent state)
- [ ] All existing SettingsPage unit tests pass unchanged
- [ ] All existing E2E settings tests pass unchanged
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Zero behavioral changes — the Settings page looks and functions identically

## Extracted Components

| Section Key | Component Name | File |
| :--- | :--- | :--- |
| `general` | `GeneralSection` | `sections/GeneralSection.tsx` |
| `appearance` | `AppearanceSection` | `sections/AppearanceSection.tsx` |
| `receipt` | ~~`ReceiptSection`~~ | **removed as dead code** — the file was deleted; the live receipt surface is `RestaurantReceiptsScreen` / `ReceiptFormatSettingsCard` |
| `sync` | `SyncSection` | `sections/SyncSection.tsx` |
| `about` | `AboutSection` | `sections/AboutSection.tsx` |
| `features` | (already `FeatureToggleScreen`) | no change |
| `data` | (already `DataManagementScreen`) | no change |
| `staff` | (already `StaffManagementScreen`) | no change |
| `terminals` | (already `TerminalManagementScreen`) | no change |
| `stores` | (already `MultiStoreDashboardScreen`) | no change |
| `topology` | (already `TopologyScreen`) | no change |
| `audit` | (already `AuditLogScreen`) | no change |
| `offline` | (already `OfflineQueueScreen`) | no change |
| `shifts` | (already `ShiftManagementScreen`) | no change |
| `tax` | (already `TaxConfigurationScreen`) | no change |
| `license` | (already `LicenseSettings`) | no change |
| `exchange` | (already `ExchangeRateScreen`) | no change |
| `promotions` | (already `PromotionManagementScreen`) | no change |
| `email` | (already `EmailReportSettings`) | no change |

**Only 5 sections need extraction** (`general`, `appearance`, `receipt`, `sync`, `about`) — the other 13 already render as imported components.

## Component Props Interface

Each extracted section component receives the shared settings state and callbacks it needs via props:

```tsx
interface SectionProps {
  // Shared state
  store: StoreSettingsDto;
  receipt: ReceiptSettingsDto;
  sync: SyncSettingsDto;
  displayCardSize: number;
  displayFontSize: number;
  displayFontSmoothing: string;
  brandColour: string;
  brandStoreName: string;
  defaultCurrency: string;
  currencies: CurrencyDto[];
  appVersion: string;
  userId: string;
  fieldErrors: Record<string, string>;
  isDirty: boolean;

  // Shared callbacks
  markDirty: () => void;
  setStore: (s: StoreSettingsDto) => void;
  setReceipt: (r: ReceiptSettingsDto) => void;
  setSync: (s: SyncSettingsDto) => void;
  setDisplayCardSize: (n: number) => void;
  setDisplayFontSize: (n: number) => void;
  setDisplayFontSmoothing: (v: string) => void;
  setBrandColour: (c: string) => void;
  setBrandStoreName: (n: string) => void;
  setDefaultCurrencyState: (v: string) => void;
  validateField: (field: string, value: string) => void;
  clearFieldError: (field: string) => void;

  // Section-specific state/callbacks (only passed to sections that need them)
  syncServerUrl?: string;
  setSyncServerUrl?: (v: string) => void;
  syncApiKey?: string;
  setSyncApiKey?: (v: string) => void;
  // ... etc. per-section
}
```

## Plan

1. Create directory: `ui/src/features/settings/sections/`
2. Extract `GeneralSection.tsx` — store name, address, tax ID, language, currency selectors
3. Extract `AppearanceSection.tsx` — display settings + `AppearanceSettings` embedded
4. Extract `ReceiptSection.tsx` — receipt toggles, decimal separator, paper width, footer, table number
5. Extract `SyncSection.tsx` — sync server URL, API key, toggles, status, test/sync/pull buttons
6. Extract `AboutSection.tsx` — software edition, license, version, updates
7. Refactor `SettingsPage.tsx` `renderSection()` to delegate to section components
8. Remove unused imports and state that are now section-local

## Verification

| Check | Expected |
|-------|----------|
| `cd ui && npm run typecheck` | exit 0 |
| `cd ui && npm run lint` | exit 0 |
| `cd ui && npx vitest run src/__tests__/SettingsPage.test.tsx` | all passing |
| `cd ui && npx playwright test --config e2e/playwright.config.ts --project=desktop e2e/settings.spec.ts` | no new failures |
| Manual: open `#/settings`, navigate all sections | identical to pre-refactor |

## Residual / follow-ups

- The `SectionProps` interface is intentionally broad for this refactor. In a future phase, each section should own its IPC calls via `useSettings()` from `SettingsContext` (Phase 0b) instead of receiving 20+ props from the parent.
- `React.lazy()` code splitting is deferred to Phase 3 when workspace cards are added.

## References

- `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md` §Pillar A, §Phase 0a
- `ui/src/features/settings/SettingsPage.tsx`

> (status corrected to IMPLEMENTED).
>
> last audited 11-10-26 by docs-auditor
