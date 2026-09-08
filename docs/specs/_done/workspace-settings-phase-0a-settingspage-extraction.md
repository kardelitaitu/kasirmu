# Phase 0a — SettingsPage Section Extraction

- **Status:** IMPLEMENTED (ADR #22 unified workspace settings shipped in 0.0.19; re-audited 2026-08-08 by docs-auditor)
- **Phase:** 0a of 11 (Workspace Settings Architecture — ADR #22)
- **Parent:** `docs/specs/2026-07-23-unified-2tier-workspace-settings-architecture.md`
- **Severity:** PREREQUISITE (blocks Phase 3)
- **Owner:** TBD
- **Est. effort:** 1-2 days

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
| `receipt` | `ReceiptSection` | `sections/ReceiptSection.tsx` |
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
> last audited 08-08-26 by docs-auditor
