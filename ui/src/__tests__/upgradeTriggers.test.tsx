// ── C2.2 upgrade-trigger tests ───────────────────────────────────────
//
// Covers the shared TierLockedFeature component and the pricing deep-link
// helper used by every in-app upgrade gate (analytics, loyalty, QRIS,
// store, terminal, staff). The per-screen locked/banner states are tested
// in each screen's own test file (…C2.2… suites).

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { withFluent } from '@/i18n/test-utils';
import TierLockedFeature from '@/components/TierLockedFeature';
import { upgradePricingUrl, openUpgradePricing, type UpgradeTarget } from '@/utils/upgrade';

const FTL = [
  'locked-title = Revenue Analytics',
  'locked-msg = Upgrade to unlock your reports.',
  'locked-cta = Upgrade now',
].join('\n');

describe('TierLockedFeature (C2.2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the locked title, message, and upgrade CTA', () => {
    render(
      withFluent(
        <TierLockedFeature
          titleKey="locked-title"
          messageKey="locked-msg"
          ctaKey="locked-cta"
          target="premium"
        />,
        FTL,
      ),
    );
    expect(screen.getByText('Revenue Analytics')).toBeInTheDocument();
    expect(screen.getByText('Upgrade to unlock your reports.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade now' })).toBeInTheDocument();
  });

  it('blurs the preview children so the feature stays visible but locked', () => {
    const { container } = render(
      withFluent(
        <TierLockedFeature
          titleKey="locked-title"
          messageKey="locked-msg"
          ctaKey="locked-cta"
          target="pro"
        >
          <div data-testid="sample-chart" />
        </TierLockedFeature>,
        FTL,
      ),
    );
    const preview = container.querySelector('.tier-locked-preview');
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('sample-chart')).toBeInTheDocument();
  });

  it('deep-links the CTA to the matching pricing anchor', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      withFluent(
        <TierLockedFeature
          titleKey="locked-title"
          messageKey="locked-msg"
          ctaKey="locked-cta"
          target="premium"
        />,
        FTL,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade now' }));
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('/pricing/#premium'),
      '_blank',
      'noopener,noreferrer',
    );
  });
});

describe('upgradePricingUrl (C2.2)', () => {
  it('builds locale + anchor deep-links for every upgrade target', () => {
    const targets: UpgradeTarget[] = ['plus', 'pro', 'premium'];
    for (const target of targets) {
      expect(upgradePricingUrl('id', target)).toBe(
        `https://ozpos.my.id/id/pricing/#${target}`,
      );
      expect(upgradePricingUrl('en', target)).toBe(
        `https://ozpos.my.id/en/pricing/#${target}`,
      );
    }
  });

  it('openUpgradePricing opens the pricing URL in a new tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    openUpgradePricing('id', 'plus');
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('/id/pricing/#plus'),
      '_blank',
      'noopener,noreferrer',
    );
  });
});
