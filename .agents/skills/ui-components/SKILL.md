---
name: ui-components
description: React + TypeScript UI conventions for the kasir.mu front-end — @fluent/react for all user-visible strings, ARIA labels, eslint-plugin-jsx-a11y, strict TypeScript, and dev/design-language.html as the visual reference. Use when adding or reviewing React components, hooks, or screens.
---

<!-- Audit stamp: 2026-09-03 · DSH · status: ACCURATE (rev 2) · fixes over rev 1: F1 locale paths (per-feature bundles, en|id), F2 token path (ui/src/frontend/themes/tokens.css), F3 state libs (no TanStack/Zustand — removed), F4 ci.yml act-gate reference removed (file does not exist; renderInAct guidance kept on its own merits) · added: design-language reference section, real token families, motion & feedback rules, real test render helpers, data-testid convention · verified this pass: per-feature .ftl/.id.ftl bundles + shared.ftl/bundles.ftl + locales/index.ts, LocaleCode 'en'|'id' in ui/src/i18n/index.ts, dark-default tokens.css (:root dark / [data-theme="light"]), --color-*/--space-*/--radius-*/--shadow-*/--duration-*/--ease-*/--z-*/--font-* token families, api/tauri.ts sole @tauri-apps re-export + utils/logged-invoke.ts, ~40 per-domain ui/src/api/ modules (pos.ts is one of many), formatMoney in types/domain.ts (id-ID default), flat ui/src/__tests__/ with renderWithFluentSync/renderWithFluent/renderWithProviders(Sync)/rerenderWithProviders + renderInAct + withFluent, React 18.3.1, @fluent/react, strict tsconfig, no external state library in package.json, all FTL ids used in examples exist in sales.ftl -->

# React UI & Front-end Conventions

The kasir.mu front-end is a Tauri v2 webview running React 18 + TypeScript. The UI must be **accessible** (a cashier with a screen reader is a real user), **internationalized** (we ship in many locales), and **strictly typed** (a missing `prop` should be a compile error, not a runtime crash). Visually, it must follow one design language — see the next section.

---

## When to use

- Adding or modifying a React component, screen, or modal.
- Writing a hook that calls into `ui/src/api/`.
- Adding user-visible strings (a label, a button, an error message).
- Reviewing a UI change for accessibility, i18n, typing, or visual-design issues.
- Choosing component patterns (controlled vs uncontrolled, where state lives, etc.).

---

## Design language reference

**`dev/design-language.html` is the visual source of truth.** Before building or restyling any screen — colors, buttons, typography, spacing, icons, layout, components, forms, motion — consult it. Resolve it dynamically from the repo root (`git rev-parse --show-toplevel` + `dev/design-language.html`) and open it in a browser; never hardcode an absolute checkout path (the repo is a multi-root worktree layout).

It is a self-contained, tabbed reference with a worked example and a "Fallback & Accessibility" rules list per tab:

| Tab | Core rules to carry into code |
|---|---|
| **Color Palette** | 8 brand colors (iOS-derived palette). Three layers: brand → semantic role → neutral scaffolding. Semantic roles and their only allowed meanings: **Primary** = interact · **Success** = confirm (always paired with a checkmark icon) · **Danger** = destroy · **Warning** = near a limit · **Info** = notify · **Alert** = act now · **Accent** = decorate (never actions/status). Dark theme pushes semantic colors brighter for AA contrast. Never color alone (icon/shape/text too); `--text-muted` is decorative-only (below AA on white). |
| **Buttons** | Sizes: Large 48px (screen CTA, min touch target) · Medium 42px (default) · Small 34px (dense rows/dialogs, never the key action). Emphasis ladder: primary → secondary → ghost → danger/success (meaning, not volume) → chip (selectable option, not action). Exactly **one primary per view**. Icon-only buttons always carry an accessible name. Busy buttons are disabled so they cannot double-fire. Menu slider (sliding pill indicator) is for 2–3 mutually exclusive short-label options only. |
| **Typography** | Inter (variable, 400–800) for UI; JetBrains Mono for code/receipts/aligned data. Strict scale ladder — 32 / 24 / 20 / 16 / 14 / 12 / 11 px — climb one rung at a time. Weight follows role: 800 Display, 700 headings/buttons, 600 subheads, 400 body. Cap body line length at 65–75 chars. Buttons/pills truncate (`nowrap` + ellipsis), never wrap. |
| **Spacing & Layout** | 4px base grid: 4 icon↔text · 8 default control gap · 12 between groups · 16 card padding · 20–24 section separation · 32+ page rhythm. Spacing comes from `gap`/`padding`, **never margins** on shared components. ≥8px between touch targets. Radius: 4px micro · 8px inputs/buttons · 10px panels/rows · 12px cards/modals · pill for toggles/chips/badges. Elevation: 3 levels max — `--shadow-sm` resting cards, `--shadow-md` floating (modals/dropdowns/tooltips), `--shadow-lg` full overlays (rare). Dark mode elevates with lighter surface tone + hairline border, not shadow. |
| **Icons** | Stroke-based SVGs on a 24×24 viewBox (higher grids up to 256 for precision line art). Sizes 14 / 16 (default) / 18 / 24 px. Stroke 2 default; 2.5 at 14px (or it smudges); 1.5 only at 24px+. Color via `currentColor` only — an icon never picks its own color. Leading icon = the verb; trailing icon = disclosure/navigation; never two icons unless one is a badge. Scale uniformly; one style per glyph. |
| **Elements** | Flex-first. The container decides direction, `gap`, and wrapping; children decide their own size. `min-width: 0` on content children that can hold long text. Wrap before clip. Equal columns → `flex: 1`, not `%` + gap (the `%`-plus-gap trap overflows). `border-box` is assumed. |
| **Components** | Cards: `--radius-lg` + `--shadow-sm` + 1.25rem padding; ghost card only inside an already-elevated surface. Stat cards: 8–10% bg + 20% border in the semantic color; one number, one label. Modals for irreversible decisions; `role="dialog"` + `aria-modal`, focus trap, Escape closes, focus returns to trigger; body states the consequence, not "Are you sure?". Tooltips never hold critical info and the trigger must be focusable. Alerts are persistent until dismissed (10% bg + 20–25% border + icon + label; one per view). Badges: status pill / count badge (cap `99+`, never a bare number to a screen reader) / 8px dot. |
| **Forms** | Toggle: track 2.5rem × 1.375rem, knob 1.125rem, `role="switch"`, bounce ease. Text input: 36px height, 8px radius. Focus ring: `outline: 2px solid <primary>; outline-offset: -2px; border-color: <primary>` (inset ring hugging the radius). Validation: 2px semantic border + matching caption below; focus animates back to primary. Checkbox/radio: native `accent-color` in primary, outer ring suppressed. Select: `appearance: none` + custom SVG chevron. Range: 6px pill track. Textarea: `resize: vertical`. |
| **Motion & Feedback** | Every action has **Before · Feedback · After** — the after-state must differ from the before, provable from pixels alone. Press feedback ≤120ms, before the work finishes. Motion tokens: instant 0ms · fast 120ms (press/hover/error shake) · base 200ms (toggles, state transitions) · slow 350ms (entrances, removals). Never animate instant flips (theme, filters, selected tabs). Animate **only `transform` and `opacity`**. Success = green **+ checkmark**; error = shake + red border + caption (never one alone). `prefers-reduced-motion` collapses durations to 0 but the after-state stays. Old POS hardware is the performance floor. |
| **Audit** | Every interactive element carries a `data-testid` — `feature-element[-action]`, kebab-case, feature scope first, describes meaning (never position like `button-3`), stable across locales, unique per screen. Tests select by testid, never by CSS class, DOM position, or visible text. |

**Token-name caveat:** the design-language page uses shorthand demo tokens in its own stylesheet (`--bg`, `--text`, `--primary`, `--r-sm`). Those names are for reading the doc. The production source of truth for token *names* is `ui/src/frontend/themes/tokens.css` — copy the **rules** from the design language and the **names** from `tokens.css`.

---

## Golden rules

| # | Rule | Why |
|---|------|-----|
| 1 | **All user-visible strings use `@fluent/react`.** | No hardcoded English. Period. |
| 2 | **Every interactive element has an accessible name** (label, `aria-label`, or visible text). | Screen readers and keyboard nav depend on it. |
| 3 | **Strict TypeScript is on.** No `any`, no `// @ts-ignore` without a `// FIXME: ...` comment. | We catch mistakes at compile time, not in production. |
| 4 | **Components are presentational; hooks own behavior.** | Easy to test, easy to reuse. |
| 5 | **No `invoke()` in components.** Components and hooks import per-domain wrappers from `ui/src/api/` — never `@tauri-apps/api/*` directly. | `ui/src/api/tauri.ts` is the single sanctioned re-export surface; API modules route calls through `loggedInvoke` (`ui/src/utils/logged-invoke.ts`) for timing/telemetry. Mockable, testable, discoverable. |
| 6 | **Every visual decision comes from the design language (`dev/design-language.html`) expressed through `tokens.css` tokens.** | Consistency at a glance; one rebrand touches one `:root` block. |

---

## I18n with `@fluent/react`

Every user-visible string lives in a per-feature Fluent bundle under `ui/src/locales/`: `<feature>.ftl` is English, `<feature>.id.ftl` is Indonesian (currently the only additional locale — the `LocaleCode` union is `'en' | 'id'`). `shared.ftl` and `bundles.ftl` hold cross-feature strings. The component uses `<Localized>` or `useLocalization()` — never a string literal.

```tsx
import { Localized } from '@fluent/react';

export function PayButton({ onPay, disabled }: { onPay: () => void; disabled: boolean }) {
  return (
    <button onClick={onPay} disabled={disabled}>
      <Localized id="sale-pay-button">
        <span>Pay</span>
      </Localized>
    </button>
  );
}
```

```fluent
# ui/src/locales/sales.ftl
sale-pay-button = Pay
```

Element attributes (placeholder, `aria-label`, title) localize through Fluent attributes:

```fluent
payment-tendered-input =
    .placeholder = 0.00
    .aria-label = Amount tendered
```

**Rules:**
- IDs are `feature-element[-qualifier]`. Real examples: `sale-pay-button`, `pos-cart-deduction-badge-aria`, `price-override-error-zero`.
- The fallback text inside `<Localized>` is **only** used by English developers in dev. The runtime always reads from the active locale.
- Never `concat` translated strings. Use Fluent's `{ $count ->` plural variants and `{ $name }` substitutions (see `pos-bundle-expanded` in `sales.ftl` for the pattern).
- For one-off strings in non-component code (e.g., a notification), call `useLocalization()` and use `l10n.getString('...')`.
- Adding a new locale: create a matching `.<code>.ftl` for **every** bundle, add it to the imports/`LocaleCode`/`RESOURCES` in `ui/src/i18n/index.ts`, and wire the selector in `ui/src/i18n/LocaleContext.tsx`. The i18n lint gate validates `.id.ftl` vs `.ftl` parity — keep both files key-complete.

---

## Accessibility (ARIA + a11y)

kasir.mu passes `eslint-plugin-jsx-a11y` in CI. The plugin catches the most common mistakes; the rest is up to you.

### Forms & inputs

- Every `<input>` has a `<label htmlFor={...}>` or an `aria-label` (Fluent `.aria-label` attribute).
- Required fields have `aria-required="true"`.
- Errors are linked via `aria-describedby` and announced via `aria-invalid` + `role="alert"`.

```tsx
const inputId = 'po-new-price';
const errorId = 'po-new-price-error';

<label htmlFor={inputId}>
  <Localized id="price-override-new-label"><span>New price (in minor units)</span></Localized>
</label>
<input
  id={inputId}
  type="text"
  inputMode="numeric"
  aria-required="true"
  aria-invalid={hasError ? 'true' : 'false'}
  aria-describedby={hasError ? errorId : undefined}
  value={price}
  onChange={(e) => setPrice(e.target.value)}
/>
{hasError && (
  <p id={errorId} role="alert">
    <Localized id="price-override-error-zero"><span>Price must be greater than 0</span></Localized>
  </p>
)}
```

### Buttons & actions

- `<button>` for actions, `<a>` for navigation. Never `<div onClick>`.
- `aria-label` for icon-only buttons (every one, no exceptions — the design language calls this "icon-only is never unnamed").
- `aria-busy="true"` while a long-running command is in flight; disable the button so it cannot double-fire.

### Live regions

- Use `role="status"` (polite) for non-critical updates (cart total changed).
- Use `role="alert"` (assertive) for errors that need immediate attention.

### Keyboard support

- Every interactive control is reachable via Tab.
- Modals: `role="dialog"` + `aria-modal="true"`, focus moves inside, Tab is trapped, Escape closes, focus returns to the trigger.
- Custom shortcuts respect platform conventions (Esc cancels, Enter confirms) and are documented in the help screen.

### Focus rings

Text inputs/textarea/select use the design-language focus pattern — an inset ring that hugs the border radius: `outline: 2px solid var(--color-border-focus); outline-offset: -2px; border-color: var(--color-border-focus)`. Checkbox/radio/range suppress the outer ring and rely on native `accent-color`.

---

## Strict TypeScript

`ui/tsconfig.json` enables the strictest checks. Don't disable them.

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

**Rules:**
- Never `any`. If you don't know the type, use `unknown` and narrow with a type guard.
- `// @ts-ignore` is forbidden. `// @ts-expect-error` requires a `// FIXME:` comment explaining when it can be removed.
- Discriminated unions over booleans: `{ kind: 'success', value: T } | { kind: 'error', error: AppError }`, not `{ ok: true, value: T } | { ok: false }`.
- Domain types are newtypes: `type CartId = string & { readonly __brand: 'CartId' }`. Don't pass a `Sku` where a `CartId` is expected.

---

## Component patterns

### Presentational components

```tsx
import { Localized } from '@fluent/react';
import { formatMoney } from '@/types/domain';

interface CartLineProps {
  sku: Sku;
  name: string;
  qty: number;
  unitPrice: Money;
  onRemove: (sku: Sku) => void;
}

export function CartLine({ sku, name, qty, unitPrice, onRemove }: CartLineProps) {
  return (
    <li>
      <span>{name}</span>
      <span>{qty} × {formatMoney(unitPrice)}</span>
      <button onClick={() => onRemove(sku)} aria-label={`remove ${name}`}>
        <Localized id="cart-line-remove"><span>Remove</span></Localized>
      </button>
    </li>
  );
}
```

- Take data and callbacks as props. Never read from context or call `ui/src/api/` here.
- Default to functional components. No class components.
- `formatMoney` lives in `ui/src/types/domain.ts` and formats from `Money.minor_units` (i64) — never float math. Note its default locale is `id-ID`, so USD 3.50 renders as `$ 3,50` in tests.

### Hooks (behavior + state)

```tsx
export function useCart(cartId: CartId) {
  const [state, setState] = useState<UseCartState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    getCart(cartId) // from the domain module in ui/src/api/ — illustrative name
      .then((cart) => { if (!cancelled) setState({ status: 'success', cart }); })
      .catch((e: AppError) => { if (!cancelled) setState({ status: 'error', error: e }); });
    return () => { cancelled = true; };
  }, [cartId]);
  return state;
}
```

- State is a discriminated union: `'loading' | 'success' | 'error'`. No `isLoading: boolean` + `data: T | null` combos.
- Cancel in-flight requests on unmount or dependency change.

### State library

There is **no external state library** (no TanStack Query, Zustand, Jotai, or Redux in `ui/package.json`) — don't add one without a deliberate decision:

- Local UI state: `useState`, `useReducer`.
- Cross-component state: React Context scoped to a feature. App-wide shared state already exists as providers in `ui/src/contexts/` — reuse them before inventing new ones (`SettingsContext`, `CurrencyContext`, `WorkspaceContext`, `BrandContext`, `ZoomContext`, …).

---

## Styling

All design tokens live in `ui/src/frontend/themes/tokens.css` — the single source of truth for every visual property. **Dark is the default**: `:root` holds the dark theme and `[data-theme="light"]` overrides it. Components reference semantic tokens via `var(--token)` **only** — never a raw hex, never the design-language demo token names.

| Family | Tokens | Notes |
|---|---|---|
| Surfaces | `--color-bg`, `--color-bg-surface`, `--color-bg-input`, `--color-bg-hover`, `--color-bg-overlay` | page → card → input ladder |
| Text | `--color-fg`, `--color-fg-secondary`, `--color-fg-muted`, `--color-text-on-color` | muted is decorative-only (below AA on white) |
| Borders | `--color-border`, `--color-border-hover`, `--color-border-focus` | hairlines stay in px |
| Brand / status | `--color-primary`, `--color-accent*`, `--color-success`, `--color-warning`, `--color-danger` (+ `-bg`/`-subtle`/`-fg` variants) | semantic roles only; never the raw palette |
| Spacing | `--space-0` … `--space-24` (rem-based, 4px grid) | `--space-2` = 0.5rem = 8px, `--space-4` = 1rem = 16px, `--space-5` = 1.25rem |
| Radius | `--radius-sm` … `--radius-3xl`, `--radius-full` | pick by element class (see design language) |
| Elevation | `--shadow-xs` … `--shadow-2xl` (+ glow variants) | 3 usable levels: sm / md / lg |
| Motion | `--duration-0` … `--duration-4000`, `--ease-out`, `--ease-in`, `--ease-in-out`, `--ease-bounce`, `--ease-linear` | reduced-motion collapse is already built into `tokens.css` |
| Z-index | `--z-base`, `--z-dropdown`, `--z-sticky`, `--z-overlay`, `--z-modal`, `--z-toast`, `--z-tooltip` | never invent a raw z-index |
| Fonts | `--font-sans` (Inter), `--font-mono` (JetBrains Mono) | weight steps `--font-weight-normal` … `--font-weight-bold` |

- **CSS Modules** for component-scoped styles (`CartScreen.module.css`).
- **No inline `style={{ ... }}`** beyond dynamic values (e.g., a chart's bar height).
- **No hardcoded colors and no `!important`.** If a token is missing, add it to `tokens.css` — don't invent a value in the component.

```tsx
import styles from './CartScreen.module.css';

export function CartScreen() {
  return <div className={styles.root}>...</div>;
}
```

```css
/* CartScreen.module.css */
.root {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--space-4);
  background: var(--color-bg);
  color: var(--color-fg);
}
```

---

## Motion & feedback

Follow the design language's **Before · Feedback · After** contract: the control shows what it does, gives immediate press feedback, and settles in a visibly different after-state.

| Concept (design language) | Duration | Use | App token |
|---|---|---|---|
| Instant | 0ms | state flips: theme, filters, selected tabs | `--duration-0` |
| Fast | 120ms | press/hover feedback, error shake | `--duration-100` / `--duration-150` |
| Base | 200ms | toggles, state transitions | `--duration-200` |
| Slow | 350ms | entrances, removals | `--duration-300` / `--duration-400` |

**Rules:**
- Press feedback lands ≤120ms — never wait for the async work. While work runs, disable the button and show in-button progress (`aria-busy`).
- The after-state must differ from the before: button → disabled + checkmark, tab → selected, toggle → slid. Confirmation beats polish.
- Success is a checkmark, not just green; error is motion + colour + text (shake + red border + caption), never one alone.
- Animate only `transform` and `opacity` — never `width`, `height`, `top`, or `margin`.
- Easings: `--ease-out` for entrances, `--ease-bounce` for playful knobs (toggles), `--ease-in` for exits.
- `prefers-reduced-motion` is already honored globally in `tokens.css` (durations collapse to `--duration-0`) — the after-state must still confirm.

---

## Testing

Component tests live in `ui/src/__tests__/` as **flat** `<Component>.test.tsx` files (417+ files, e.g. `CartScreen.test.tsx`, `PaymentModal.test.tsx`). Shared render helpers are in `ui/src/__tests__/test-utils/render.tsx`:

| Helper | When |
|---|---|
| `renderWithFluentSync(ui, ...ftl)` | Presentational components, no async mount effect. Plain sync `render()` wrapped in Fluent. |
| `renderWithFluent(ui, ...ftl)` | Components whose `useEffect` fires async work on mount — wraps `renderInAct` + Fluent. |
| `renderWithProvidersSync(ui, ...ftl)` / `renderWithProviders(ui, ...ftl)` | Same, plus Brand/Theme/Toast/Zoom providers. |
| `rerenderWithProviders(result, ui, ...ftl)` | Re-render while keeping the provider stack intact. |
| `renderInAct` / `renderHookInAct` (`ui/src/test-utils/renderInAct.ts`) | Direct async-act boundary; also for isolated hook tests. |
| `withFluent(ui, ...ftl)` (`@/locales/test-utils`) | Wrap an element in Fluent providers only. |

FTL bundles are imported raw and passed in: `import salesFtl from '@/locales/sales.ftl?raw';`

```tsx
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import salesFtl from '@/locales/sales.ftl?raw';
import CartScreen from '@/features/sales/CartScreen';

describe('CartScreen', () => {
  it('renders the empty state', () => {
    renderWithFluentSync(<CartScreen />, salesFtl);
    expect(screen.getByRole('heading', { name: /cart/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/empty/i);
  });
});
```

**Rules:**
- Tests assert user-visible behavior, not implementation. Query by `getByRole`, `getByLabelText`, `getByText`, or `getByTestId` — never by CSS class or DOM position.
- Components under test must be wrapped in a Fluent provider — use the shared helpers; don't hand-roll `<LocalizationProvider>` inline.
- Mock the `ui/src/api/` domain module at the boundary (`vi.mock('@/api/sales', ...)`), not `invoke()`.
- Any test rendering a component whose mount effect resolves a promise must use an async-act helper (`renderWithFluent` / `renderInAct`) so no `act(...)` warning is emitted — keep the suite warning-free.
- For tests that deliberately use `vi.advanceTimersByTime`, wrap the *resolve* step in `await act(async () => { ... })` so the microtask that runs the hook's `finally` block stays inside the act() boundary.

### `data-testid` convention

Interactive elements carry a `data-testid` following the design language's Audit tab: `feature-element[-action]`, kebab-case, feature scope first, semantic (never positional like `button-3`), stable across locales, unique per screen. Playwright and Testing Library select by testid — visible text gets translated, classes get refactored; the testid is the stable handle. The id lives on the real control (e.g., the `<input role="switch">`, not its decorative labels).

---

## Folder structure

```
ui/
└── src/
    ├── api/                      # per-domain IPC wrappers (sales.ts, inventory.ts, settings.ts, pos.ts, …)
    │   ├── tauri.ts              # ONLY file allowed to import @tauri-apps/api/*
    │   └── <domain>.ts           # components/hooks import from here; routes through loggedInvoke
    ├── features/
    │   └── <feature>/
    │       ├── <Feature>Screen.tsx
    │       ├── use<Feature>.ts
    │       ├── <Feature>Line.tsx  # presentational
    │       └── <Feature>.module.css
    ├── components/               # cross-feature presentational
    ├── contexts/                 # app-wide providers (SettingsContext, CurrencyContext, WorkspaceContext, …)
    ├── hooks/                    # cross-feature hooks
    ├── i18n/                     # LocaleContext, locale registration (index.ts)
    ├── locales/                  # per-feature bundles: sales.ftl, sales.id.ftl, shared.ftl, bundles.ftl, …
    ├── types/
    │   └── domain.ts             # CartId, Sku, Money, AppError, formatMoney
    ├── frontend/
    │   └── themes/               # tokens.css (source of truth), components.css, reset.css, responsive.css
    ├── utils/
    │   └── logged-invoke.ts      # invoke wrapper with timing/telemetry
    └── __tests__/                # flat <Component>.test.tsx + test-utils/
```

---

## Common pitfalls

1. **Hardcoded English in JSX** like `<button>Save</button>`. Always wrap in `<Localized>`.
2. **`<div onClick={...}>`** instead of `<button>`. Breaks keyboard nav and screen readers.
3. **`useEffect` with missing dependencies** — `eslint-plugin-react-hooks` will flag it. Add the dep or refactor.
4. **Passing `setState` directly as a prop** instead of an explicit handler. Couples parent and child too tightly.
5. **Floating-point math in `formatMoney`** — `0.1 + 0.2 !== 0.3`. Always format from `Money.minor_units`.
6. **Reading a context inside a render** without a memoized selector. Causes re-renders of every consumer.
7. **Forgetting `aria-busy` during async commands.** The button looks clickable while the request is in flight; the user clicks again.
8. **Styling with `px` everywhere** — the app must scale for tablets, large touch screens, and high-DPI. Use the rem-based `--space-*` tokens; px only for hairline borders.
9. **Rendering a component whose `useEffect` fires async IPC with a plain sync `render()`.** Use `renderWithFluent` / `renderInAct` so the mount update is inside act() — see the Testing section.
10. **Hardcoding a hex, or copying the design-language demo token names** (`--bg`, `--text`, `--r-sm`) into component CSS. Reference the real semantic tokens from `ui/src/frontend/themes/tokens.css`, or dark mode and rebrands break.

---

> last audited 03-09-26 by DSH
