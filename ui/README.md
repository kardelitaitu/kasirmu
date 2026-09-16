<!-- Audit stamp: 2026-08-29 · docs-auditor · status: ACCURATE (counts refreshed) · F1: test counts 228 files/3476 tests -> 400 files/~6700 tests · F2: api/ 34 -> 40 .ts files · F3: locales 48 -> 50 .ftl files (en + id variants) · verified accurate: ui/src/locales per-feature bundles; ui/src/frontend/themes/ (reset.css/tokens.css/components.css/responsive.css); Vite ^6.0.0 in ui/package.json; React 18 + @fluent/react + @tauri-apps/api 2 + Vitest + eslint-plugin-jsx-a11y; api/pos.ts sole invoke() (AGENTS.md rule); formatMoney in types/domain.ts; no hardcoded colors rule  RE-AUDITED 2026-09-09 by DSH (docs-auditor): the file-count claim was stale. `npm run test` was described twice as 400 files / ~6700 tests; re-counted as 532 test/spec files under ui/src (dedup glob; vitest at ui/vite.config.ts:107 excludes only e2e/** and sets no narrower include, so the file layout IS the test universe and the comparison is apples-to-apples). The ~6700 tests / ~14s figures were NOT touched - they are a runtime measurement nothing here re-derives, so they are relabelled a dated observation of one run rather than deleted. Added what the page never said: two shells, dev:tablet/build:tablet on 1422 (ui/vite.tablet.config.ts) vs desktop 1420, both confirmed against devUrl in the two tauri.conf.json files. All ten npm scripts the page names exist and do what its one-liners say (build = tsc -b && vite build, check:all = scripts/check-ui.mjs, e2e = scripts/run-e2e.mjs, typecheck = tsc --noEmit). Stamp extended, not stacked. -->

# `ui/` — OZ-POS Frontend

React 18 + TypeScript + Vite 6 + Tauri v2 webview.

## Stack

- **React 18** + react-dom
- **Vite 6** (dev server + bundler)
- **TypeScript 5** (strict: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)
- **@fluent/react** (i18n via `.ftl` files)
- **@tauri-apps/api 2** (IPC bridge)
- **Vitest** + **@testing-library/react** (tests)
- **ESLint** + `eslint-plugin-jsx-a11y` (accessibility enforced)

## Scripts

```bash
npm install            # one-time
npm run dev            # vite dev server on http://localhost:1420
npm run check:all      # chained validation: lint → typecheck → test → i18n → E2E*
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
npm run test           # vitest run (532 test files under ui/src)
npm run build          # tsc -b && vite build
npm run e2e            # Full E2E suite: Docker → Vite → Playwright → cleanup
npm run e2e:headed     # E2E with browser visible
npm run e2e:api        # API integration tests only
npm run e2e:ui         # All UI E2E tests (excl. API)

# * E2E requires Docker; check:all skips it gracefully if Docker is unavailable
#   See e2e/README.md for full E2E documentation
```

## Install script approvals

The UI pins install-script approvals in `package.json` (`allowScripts`) so that `npm ci` does not prompt for every package with a postinstall script. This requires **npm 11+**; upgrade if `npm approve-scripts` is not recognised. When you add or update a dependency that has a postinstall script (for example, a new native-binary package), you must explicitly approve it before `npm ci` will run its install script locally:

```bash
# Approve the package for the currently installed version (recommended)
npm approve-scripts <package>

# Approve without version pinning (allows updates, less secure)
npm approve-scripts --no-allow-scripts-pin <package>
```

Only approve packages you trust and understand. The approval is written to `package.json` (`allowScripts`) and must be committed with the dependency change. The authoritative list is always in [`package.json`](./package.json); the examples below may become stale:

- `esbuild@0.25.12`
- `msw@2.15.0`

CI skips postinstall scripts entirely via `npm ci --ignore-scripts`, so these local approvals only affect development environments.

`npm run dev` is what `cargo tauri dev` (from `apps/desktop-client/`) launches.

> The tablet shell has its own pair: `npm run dev:tablet` serves **1422** and
> `npm run build:tablet` builds it (`ui/vite.tablet.config.ts`); desktop stays on 1420.
> Both match the `devUrl` keys in `apps/desktop-client/tauri.conf.json:8` and
> `apps/tablet-client/tauri.conf.json:8`. This page named only the desktop half until
> 09-09-26, which is how a two-surface repo reads as a one-surface repo to whoever
> follows it.

## Structure

```
ui/src/
├── api/
│   └── (40 per-domain files)  # Typed invoke() wrappers — no invoke() in components
├── components/
│   ├── AppLayout.tsx    # Sidebar navigation, route definitions, feature gates
│   ├── Badge.tsx        # status/role badges
│   ├── Button.tsx
│   ├── Card.tsx
│   ├── RoleBadge.tsx
│   ├── ThemeProvider.tsx
│   ├── ThemeToggle.tsx
│   ├── Toast.tsx        # + ToastProvider + useToast hook
│   ├── UpdateBanner.tsx
│   └── ...              # EmptyState, ErrorState, Skeleton, Spinner
├── contexts/
│   └── AuthContext.tsx   # Staff login session state
├── features/
│   ├── audit/           # AuditLogScreen (paginated, searchable)
│   ├── auth/            # StaffLoginScreen
│   ├── categories/      # CategoryManagementScreen
│   ├── currency/        # ExchangeRateScreen (CRUD)
│   ├── customers/       # CustomerManagementScreen (WIP)
│   ├── design/          # DesignSystem showcase
│   ├── inventory/       # InventoryAdjustmentScreen
│   ├── products/        # ProductLookupScreen, ProductManagementScreen
│   ├── sales/           # PosScreen, SalesHistoryScreen, SalesDashboardScreen,
│   │                    # VoidOrdersScreen, EodReportScreen, PaymentModal
│   ├── settings/        # SettingsPage, FeatureToggleScreen, DataManagementScreen
│   ├── staff/           # StaffManagementScreen
│   ├── setup/           # SetupWizard
│   └── tax/             # TaxConfigurationScreen
├── hooks/
│   └── useFeatures.ts   # Feature flag hook for route gating
├── frontend/
│   └── themes/
│       ├── reset.css
│       ├── tokens.css   # CSS custom properties (colors, spacing, typography)
│       ├── components.css # Shared component styles
│       └── responsive.css
├── locales/
│   ├── shared.ftl       # Shared UI strings
│   ├── sales.ftl        # POS, cart, sales history
│   ├── products.ftl     # Product management
│   ├── settings.ftl     # Settings, setup wizard, sync
│   ├── ...              # Per-feature Fluent bundles (en + id variants; 50 files total)
│   └── index.ts         # Bundle loader
├── types/
│   └── domain.ts        # Money, CartId, Sku, LineId, Product, formatMoney
├── __tests__/           # Per-screen test files (400 files, ~6700 tests)
├── App.tsx              # Root: setup guard → auth guard → AppLayout
└── main.tsx             # Entry: Fluent bundle registration + StrictMode
```

## IPC Rules

- **No `invoke()` in components** — every Tauri command has a typed wrapper in `ui/src/api/` (per-domain files)
- Components call per-domain api functions (e.g. `sales.ts`, `products.ts`); the api layer owns the `invoke()` calls
- All args/results are statically typed via exported interfaces

## i18n

- User-visible strings live in per-feature Fluent bundles under `src/locales/` (e.g. `shared.ftl`, `sales.ftl`, `sales.id.ftl`)
- Bundles are loaded and merged by `src/locales/index.ts`
- Referenced via `<Localized id="...">` from `@fluent/react`
- A Fluent key that resolves in neither the `en .ftl` nor the `id .ftl` bundle IS a build failure: pre-commit step 2 (bundle parity, eight checked surfaces) and CI's `i18n` job (`bash scripts/lint-i18n.sh`, leg 3 → `python3 scripts/verify-bundle-parity.py --full-census`) both fail closed on it.
- Hardcoded English where a localization call belongs is NOT — it is forbidden (`.agents/AGENTS.md` → *Tauri & UI Standards* → **Localization**) but policed by code review only, because every extraction pattern in `verify-bundle-parity.py` is keyed off a localization *call site* and no gate scans visible text. The form that escapes them all today is `addToast({ message: '<English>' })`; re-count it with `grep -rn "addToast({ message: '" ui/src --include=*.tsx --include=*.ts | wc -l` (13 at `2c03ae152`, 2026-09-16 — trust the command, not the number).
- Add a new locale: create the matching `.<code>.ftl` files for each bundle, then register the locale in `src/i18n/` and `src/main.tsx`

## Testing

- **Vitest** + `@testing-library/react`
- Each feature screen has a `__tests__/<Screen>.test.tsx` file
- IPC is mocked via `vi.hoisted()` → `vi.mock('@tauri-apps/api/core')`
- Fluent strings are provided inline via `FluentBundle` + `FluentResource`
- Run: `npm run test` (532 test files under `ui/src`; vitest excludes only `e2e/**`, so
  re-count with `ls ui/src/**/*.test.* ui/src/**/*.spec.*`). The earlier "~6700 tests,
  ~14s" figures are a runtime measurement of one run rather than a file count - kept as a
  dated observation, because nothing in this repo re-derives them and a number nobody can
  reproduce is a claim, not a measurement:

## Conventions

| Rule | Enforcement |
|------|-------------|
| No `any` or `// @ts-ignore` without `// FIXME` | TypeScript strict mode |
| ARIA labels on all interactive elements | ESLint jsx-a11y |
| No hardcoded colors/sizes | CSS custom property tokens only |
| Presentational components, hooks own behavior | Code review |
| Every screen has a test file | `__tests__/` audit |
| Money displayed via `formatMoney()` | Import from `types/domain.ts` |

> last audited 09-09-26 by docs-auditor
