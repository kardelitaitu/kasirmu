/**
 * Tests for `TierLockedFeature` — the shared C2.2 locked screen for
 * tier-gated features.
 *
 * Contract: blurred preview stays visible (aria-hidden, non-interactive),
 * localized title/message/CTA render, and the upgrade button deep-links to
 * the correct pricing anchor for the current locale.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { Localized } from '@fluent/react';
import TierLockedFeature from '@/components/TierLockedFeature';
import { LocaleContext } from '@/i18n/LocaleContext';

/* ── Fluent mock ─────────────────────────────────────────────────── */

vi.mock('@fluent/react', async () => {
  const actual = await vi.importActual('@fluent/react');
  return {
    ...actual,
    Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
    useLocalization: () => ({
      l10n: {
        getString: (key: string) => `[${key}]`,
      },
    }),
  };
});

vi.mock('@/utils/upgrade', () => ({
  openUpgradePricing: vi.fn(),
}));

import { openUpgradePricing } from '@/utils/upgrade';

const mockOpenUpgrade = vi.mocked(openUpgradePricing);

const renderWithLocale = (locale: string, props: { target: 'plus' | 'pro' | 'premium' }) =>
  render(
    <LocaleContext.Provider
      value={{
        locale: locale as 'en' | 'id',
        setLocale: () => {},
        availableLocales: ['en', 'id'],
        getLocaleLabel: () => '',
        orgDefaultLocale: null,
        setOrgDefaultLocale: () => {},
      }}
    >
      <TierLockedFeature
        titleKey="locked-title"
        messageKey="locked-message"
        ctaKey="locked-cta"
        {...props}
      />
    </LocaleContext.Provider>,
  );

describe('TierLockedFeature', () => {
  beforeEach(() => {
    mockOpenUpgrade.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the localized title, message, and CTA', () => {
    renderWithLocale('en', { target: 'pro' });
    expect(screen.getByText('[locked-title]')).toBeTruthy();
    expect(screen.getByText('[locked-message]')).toBeTruthy();
    expect(screen.getByText('[locked-cta]')).toBeTruthy();
  });

  it('opens the pricing page for the target on CTA click', () => {
    renderWithLocale('en', { target: 'premium' });
    fireEvent.click(screen.getByText('[locked-cta]'));
    expect(mockOpenUpgrade).toHaveBeenCalledWith('en', 'premium');
  });

  it('uses the context locale for the pricing link', () => {
    renderWithLocale('id', { target: 'plus' });
    fireEvent.click(screen.getByText('[locked-cta]'));
    expect(mockOpenUpgrade).toHaveBeenCalledWith('id', 'plus');
  });

  it('uses the context default locale (id) when LocaleContext is absent', () => {
    // The LocaleContext default value carries `locale: 'id'` (the app's
    // fallback, matching resolveInitialLocale), so the `?? 'en'` branch in
    // the component never fires — pin the actual default-currency behavior.
    render(
      <TierLockedFeature
        titleKey="t"
        messageKey="m"
        ctaKey="c"
        target="pro"
      />,
    );
    fireEvent.click(screen.getByText('[c]'));
    expect(mockOpenUpgrade).toHaveBeenCalledWith('id', 'pro');
  });

  it('renders the children preview as aria-hidden', () => {
    const { container } = render(
      <TierLockedFeature titleKey="t" messageKey="m" ctaKey="c" target="pro">
        <div data-testid="preview-chart" />
      </TierLockedFeature>,
    );
    const preview = container.querySelector('.tier-locked-preview')!;
    expect(preview.getAttribute('aria-hidden')).toBe('true');
    expect(preview.querySelector('[data-testid="preview-chart"]')).toBeTruthy();
  });

  it('does not render a preview wrapper when children are absent', () => {
    const { container } = render(
      <TierLockedFeature titleKey="t" messageKey="m" ctaKey="c" target="pro" />,
    );
    expect(container.querySelector('.tier-locked-preview')).toBeNull();
  });

  it('exposes the title as the section aria-label', () => {
    const { container } = renderWithLocale('en', { target: 'pro' });
    const section = container.querySelector('.tier-locked')!;
    expect(section.getAttribute('aria-label')).toBe('[locked-title]');
  });
});

// Keep the Localized import referenced for the mock's type usage.
void Localized;
