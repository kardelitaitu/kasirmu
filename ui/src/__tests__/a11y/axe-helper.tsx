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

import { type ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { axe, toHaveNoViolations } from 'jest-axe';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import { BrandProvider } from '@/contexts/BrandContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { ThemeProvider } from '@/frontend/shell/ThemeProvider';
import { ToastProvider } from '@/frontend/shared/Toast';

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
  getDefaultCurrency: vi.fn(() => Promise.resolve({ code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', decimal_places: 2 })),
  getDefaultCurrencyScoped: vi.fn(() => Promise.resolve({ code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', decimal_places: 2 })),
  listCurrenciesScoped: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/api/branding', () => ({
  getBrandSettings: vi.fn(() => Promise.resolve({
    primary_colour: '#147EFB', logo_path: null, store_name: 'OZ-POS',
  })),
  getBrandSettingsScoped: vi.fn(() => Promise.resolve({
    primary_colour: '#147EFB', logo_path: null, store_name: 'OZ-POS',
  })),
}));

// Extend vitest's expect with jest-axe matchers.
expect.extend(toHaveNoViolations);

/// Minimal Fluent bundle with common keys used across screens.
const MINIMAL_FTL = `
staff-login-title = OZ-POS
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
/// Color contrast is tested in E2E; landmark/heading rules are tested
/// in AppShell integration tests, not isolated component tests.
const DISABLED_RULES = {
  'color-contrast': { enabled: false },
  'landmark-one-main': { enabled: false },
  'page-has-heading-one': { enabled: false },
  region: { enabled: false },
};

/// Build a minimal Fluent localization instance for a11y testing.
function buildL10n(): ReactLocalization {
  const bundle = new FluentBundle('en-US');
  bundle.addResource(new FluentResource(MINIMAL_FTL));
  return new ReactLocalization([bundle]);
}

/// Render a component wrapped in the minimum providers needed for
/// accessibility testing (Fluent i18n, Brand, Toast).
export function renderWithProviders(children: ReactElement): RenderResult {
  const l10n = buildL10n();

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
export async function checkA11y(
  container: HTMLElement,
  options?: Record<string, unknown>,
): Promise<void> {
  const callerRules = (options?.['rules'] as Record<string, unknown>) || {};
  const mergedOptions = { ...options, rules: { ...DISABLED_RULES, ...callerRules } };
  const results = await axe(container, mergedOptions);

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
