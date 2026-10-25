//! A11y test helpers using jest-axe for automated accessibility regression testing.
//!
//! Usage:
//! ```tsx
//! import { checkA11y, renderWithProviders } from '@/__tests__/a11y/axe-helper';
//!
//! it('has no a11y violations', async () => {
//!   const { container } = renderWithProviders(<MyScreen />);
//!   await checkA11y(container);
//! });
//! ```
//!
//! Violations are logged to the console with the axe-core report format.
//! Tests fail on any violation (critical, serious, moderate, or minor)
//! to ensure maximum coverage.
//!
//! PAGE-LEVEL RULES NEED `checkA11yDocument`, NOT `checkA11y`.
//!
//! Three axe rules only evaluate when their target IS the page root, and they
//! are silent — not skipped-with-a-warning, silent — when handed a container
//! element:
//!
//!   * `landmark-one-main`    selector 'html:not(html *)'
//!   * `page-has-heading-one` selector 'html:not(html *)'
//!   * `region`               selector 'body *'
//!
//! `checkA11y(container, {...})` therefore cannot fail on ANY of them, however
//! the rules are configured — the options are honoured, the rule simply never
//! matches the container. Measured 2026-10-26 by converting the only `<main>`
//! in AppLayout to a `<div>`: `checkA11y(container, SHELL_GLOBAL_RULES)` still
//! passed 3/3, and axe reported a `main` count of 0 with zero violations. The
//! same render checked against `document` listed `region` among its PASSES,
//! which is how a reader can tell the rule actually ran.
//!
//! Contrast is NOT one of these: `color-contrast` is element-scoped and works
//! on a container. It is disabled here only because jsdom cannot compute
//! colours; see colorContrastCompliance.test.ts.

import { type ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { toHaveNoViolations } from 'jest-axe';
import axeCore from 'axe-core';

/** Run axe-core directly against an element, mutating no DOM. */
async function runAxe(
  element: Element,
  options: Record<string, unknown>,
): Promise<{ violations: axeCore.Result[]; passes: axeCore.Result[] }> {
  const results = await axeCore.run(element, options);
  return { violations: results.violations, passes: results.passes };
}
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import { BrandProvider } from '@/contexts/BrandContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { ThemeProvider } from '@/app/ThemeProvider';
import { ToastProvider } from '@/components/Toast';

// `renderWithProviders` mounts the REAL BrandProvider and CurrencyProvider, and both
// hit IPC on mount: CurrencyContext.tsx:51/:70/:71 calls getDefaultCurrency (and the
// Scoped variant when a token exists), and BrandContext.tsx:54 calls getBrandSettings.
// Neither module is mocked by the helper, and 6 of the 7 a11y files that use it mock
// neither -- so every one of them ran real IPC through the global Tauri stub, which is
// why `[TAURI MOCK] invoke: get_default_currency undefined` appears throughout the a11y
// output. The calls resolve to undefined, and the providers happen to fall back, so the
// tests pass -- but they pass while depending on a stub's incidental behaviour rather
// than on a stated arrangement.
//
// Mocking here fixes all seven files at once. vi.mock is hoisted within the file it
// appears in, and a helper's hoisted calls register in the same per-test-file mock
// registry before the importing test's own modules resolve, so this does apply to the
// importers -- verified by the log line disappearing across the suite rather than
// assumed.
vi.mock('@/api/currency', () => ({
  // ⚠️ These return a CURRENCY CODE (a string), which is what the real API
  // returns (api/currency.ts:33 -> Promise<string | null>). They used to return
  // a CurrencyDto OBJECT, and nothing noticed while no a11y test rendered the
  // value: CurrencyContext stores it verbatim (CurrencyContext.tsx:52) and every
  // consumer treats it as a code, so the object only surfaced when a screen
  // printed {currency} as a React child (RestaurantMenuEditorScreen) — React
  // then threw "Objects are not valid as a React child". A stub whose shape
  // disagrees with the function it replaces lets a test pass on behaviour
  // production cannot produce; this one now matches.
  getDefaultCurrency: vi.fn(() => Promise.resolve('IDR')),
  getDefaultCurrencyScoped: vi.fn(() => Promise.resolve('IDR')),
  listCurrenciesScoped: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/api/branding', () => ({
  getBrandSettings: vi.fn(() => Promise.resolve({
    primary_colour: '#147EFB', logo_path: null, store_name: 'kasir.mu',
  })),
  getBrandSettingsScoped: vi.fn(() => Promise.resolve({
    primary_colour: '#147EFB', logo_path: null, store_name: 'kasir.mu',
  })),
}));

// Extend vitest's expect with jest-axe matchers.
expect.extend(toHaveNoViolations);

/// Minimal Fluent bundle with common keys used across screens.
const MINIMAL_FTL = `
staff-login-title = kasir.mu
staff-login-subtitle = Staff Login
staff-login-step-username = Enter your username
staff-login-step-pin = Enter your PIN
staff-login-username-placeholder = .placeholder = Username
staff-login-username-aria = .aria-label = Username
staff-login-next = Next
staff-login-back = Back
staff-login-submit = Login
staff-login-pin-section-aria = .aria-label = PIN entry
staff-login-pin-aria = .aria-label = PIN entry
staff-login-keypad-aria = .aria-label = Numeric keypad
staff-login-digit-aria = .aria-label = { $digit }
staff-login-clear-aria = .aria-label = Clear
staff-login-clear = Clear
staff-login-backspace-aria = .aria-label = Backspace
staff-login-error-deactivated = Account is deactivated
staff-login-error-not-found = User not found
staff-login-error-connection = Connection error
workspace-nav-label = Workspace navigation
settings-nav-search = Search settings
settings-nav-no-results = No settings match
settings-nav-category-expanded = { $category } expanded, { $count } items
`;

/// Disabled rules for consistent unit-test a11y testing.
/// Color contrast is graded by colorContrastCompliance.test.ts, which measures the
/// token pairs for all three themes directly (jsdom cannot compute colours).
/// Landmark/heading rules are graded with the global rules re-enabled in
/// ShellLayout.a11y.test.tsx against the real desktop and tablet shells,
/// not in isolated component tests.
const DISABLED_RULES = {
  'color-contrast': { enabled: false },
  'landmark-one-main': { enabled: false },
  'page-has-heading-one': { enabled: false },
  region: { enabled: false },
};

/// Build a Fluent localization instance for a11y testing.
///
/// `extraFtl` is appended to the minimal bundle. Pass a real bundle (e.g.
/// `sales.ftl?raw`) when the component under test supplies accessible names
/// THROUGH Fluent — `<Localized id="…" attrs={{ 'aria-label': true }}>` — because
/// the minimal bundle does not carry those keys, so the attribute is never set
/// and axe reports a missing label that production does not have. A violation
/// found without the real bundle is not evidence about the shipped app.
function buildL10n(extraFtl: string[] = []): ReactLocalization {
  const bundle = new FluentBundle('en-US');
  bundle.addResource(new FluentResource([MINIMAL_FTL, ...extraFtl].join('\n')));
  return new ReactLocalization([bundle]);
}

/// Render a component wrapped in the minimum providers needed for
/// accessibility testing (Fluent i18n, Brand, Toast).
///
/// `extraFtl` — see `buildL10n`. Omit it for components whose names come from
/// literal props; pass the real bundle when they come from Fluent.
export function renderWithProviders(children: ReactElement, ...extraFtl: string[]): RenderResult {
  const l10n = buildL10n(extraFtl);

  return render(
    <BrandProvider>
      <CurrencyProvider>
        <ThemeProvider>
          <LocalizationProvider l10n={l10n}>
            <ToastProvider>
              {children}
            </ToastProvider>
          </LocalizationProvider>
        </ThemeProvider>
      </CurrencyProvider>
    </BrandProvider>,
  );
}

/// Run axe-core on a rendered container and assert no a11y violations.
///
/// Violations are reported via vitest's assertion error with the full
/// axe-core report (rule ID, impact, description, and failing nodes).
///
/// HISTORICAL HAZARD, NOW CLOSED HERE. This helper USED jest-axe's `axe()` wrapper, whose
/// `mount()` REWRITES `document.body.innerHTML` whenever the element it is handed is
/// not inside `document.body` -- and that assignment detaches React's root, so the
/// global `afterEach(cleanup())` in test-setup.ts then finds nothing to unmount and the
/// rendered tree survives into the next test. The exception: the tree's own cases then
/// reported `landmark-no-duplicate-main` against a component that had one <main>
/// (measured 2026-10-26: counts rose 1 -> 2 -> 3 across one file). The two safe shapes,
/// both verified this round: the `container` from a render (70 of 74 call sites) and
/// `document.body` itself (the 4 portal-era call sites, which `body.contains(body)`
/// short-circuits). A DETACHED element -- `document.documentElement` is the one that
/// bit -- takes the rewriting path. `checkA11yDocument` exists for that case and calls
/// axe-core directly for exactly this reason. Both helpers now call axe-core's own
/// `run()`, so NO call site can take the rewriting path; the rule below is kept because
/// jest-axe's matcher is still in use and a future helper could reintroduce it.
export async function checkA11y(
  container: HTMLElement,
  options?: Record<string, unknown>,
): Promise<void> {
  const callerRules = (options?.['rules'] as Record<string, unknown>) || {};
  const mergedOptions = { ...options, rules: { ...DISABLED_RULES, ...callerRules } };
  // axe-core directly, NOT jest-axe's axe() wrapper: mount() rewrites
  // document.body.innerHTML for any target outside the body, which detaches React's
  // root and defeats the global afterEach(cleanup()). Container targets are safe today
  // (see the doc comment above), and this removes the hazard for every future caller
  // rather than relying on each one passing an attached element.
  const results = await runAxe(container, mergedOptions);

  // Log violations for debugging before the assertion fails.
  if (results.violations.length > 0) {
    for (const v of results.violations) {
      console.error(
        `[a11y] ${v.impact}: ${v.id} — ${v.help}\n` +
        `  ${v.helpUrl}\n` +
        `  Nodes: ${v.nodes.map((n) => n.html).join(', ')}`,
      );
    }
  }

  // Use type assertion — vitest's expect.extend() adds the matcher
  // at runtime, but TypeScript can't see it without module augmentation.
  (expect(results) as unknown as { toHaveNoViolations(): void }).toHaveNoViolations();
}

/// Run axe against the WHOLE DOCUMENT and assert no a11y violations.
///
/// Use this for shell/page suites that want the page-level rules —
/// `landmark-one-main`, `page-has-heading-one`, `region` — to mean anything.
/// Those three select `html:not(html *)` / `body *` and never match a container
/// element, so passing one to `checkA11y` disables them silently. See the module
/// header for the measurement that established this.
///
/// `options.rules` still overrides `DISABLED_RULES`, so a shell suite typically
/// passes `{ rules: { 'landmark-one-main': { enabled: true }, ... } }`.
///
/// Caveat: the document target includes whatever the test runner put outside the
/// component under test. In jsdom the root `<html>` has no `lang` attribute, so
/// `html-has-lang` fires on every document-scoped run unless it is muted. Set it
/// once per suite (`document.documentElement.lang = 'en'`) rather than muting the
/// rule, so a real regression in the component is still reported.
export async function checkA11yDocument(
  options?: Record<string, unknown>,
): Promise<void> {
  const callerRules = (options?.['rules'] as Record<string, unknown>) || {};
  const mergedOptions = { ...options, rules: { ...DISABLED_RULES, ...callerRules } };
  // TARGET IS `document.documentElement` (the <html> element), NOT `document.body`. `landmark-one-main` and
  // `page-has-heading-one` carry the selector `html:not(html *)`, so they only
  // evaluate when the CONTEXT is the <html> element itself. `document.body` is a
  // child of it, so those two rules matched nothing and appeared in neither
  // `violations` nor `passes` -- the round-239 fix was partial for exactly this
  // reason (measured 2026-10-26, round 251: `region` passed on body, the two
  // landmark/heading rules did not run at all).
  //
  // WHY axe-core DIRECTLY, NOT the jest-axe `axe()` WRAPPER (round 251): the wrapper's
  // mount() does `document.body.innerHTML = originalHTML` to restore itself whenever the
  // element it is given is not inside document.body -- and `documentElement` never is.
  // That assignment DETACHES React's root node, so the global `afterEach(cleanup())` in
  // test-setup.ts finds nothing to unmount and the rendered tree stays in the DOM. The
  // observable consequence was a rising landmark count across one file's cases
  // (1 -> 2 -> 3 mains, measured) which axe then reported as
  // `landmark-no-duplicate-main` -- a REAL failure, caused by the MEASURING TOOL rather
  // than by the component. axe-core's own `run()` accepts any element and mutates nothing.
  //
  // `document` itself cannot be passed: axe requires an ElementNode.
  const results = await runAxe(document.documentElement, mergedOptions);

  if (results.violations.length > 0) {
    for (const v of results.violations) {
      console.error(
        `[a11y:document] ${v.impact}: ${v.id} — ${v.help}\n` +
        `  ${v.helpUrl}\n` +
        `  Nodes: ${v.nodes.map((n) => n.html).join(', ')}`,
      );
    }
  }

  (expect(results) as unknown as { toHaveNoViolations(): void }).toHaveNoViolations();
}
