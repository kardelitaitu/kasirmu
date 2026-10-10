/**
 * @file CreditFacilityCard.test.tsx
 * @description First direct suite for the store-credit card on Settings ->
 * Business Defaults (F24). What the card OWNS and nothing else: which branch
 * renders (loading / load-error / editor), that the three stored values are
 * LOADED, that a save writes **all three keys in one call**, and that an
 * unparseable amount is REFUSED rather than silently becoming zero.
 *
 * The "all three" case is the one this finding demands. F24's shape is a
 * three-key family written by a single transactional setter
 * (kasirmu-bridge/src/settings.rs:622-626), so a card that saved two of them
 * would look correct on screen while dropping an operator's ceiling. A test
 * asserting one field would not notice.
 *
 * Localization: assertions below are written against the ENGLISH FTL VALUE from
 * settings.ftl, which is mounted as the real bundle — so a hardcoded string that
 * skipped Fluent would fail the same lookup, and a renamed key would render its
 * JSX fallback instead.
 *
 * What is NOT mocked: `parseMinorUnits` and `minorUnitsToInputString` stay the
 * real implementations. The card's decision is that a typed amount round-trips
 * through integer minor units exactly, and that is only testable against the
 * real BigInt codec.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import { CreditFacilityCard } from '@/features/settings/screens/CreditFacilityCard';
import settingsFtl from '@/locales/settings.ftl?raw';

const mocks = vi.hoisted(() => ({
  getCredit: vi.fn(),
  setCredit: vi.fn(),
  getCurrency: vi.fn(),
}));

vi.mock('@/api/settings', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    getCreditSettingsScoped: (...args: unknown[]) => mocks.getCredit(...args),
    setCreditSettingsScoped: (...args: unknown[]) => mocks.setCredit(...args),
  };
});
vi.mock('@/api/currency', () => ({
  getDefaultCurrencyScoped: (...args: unknown[]) => mocks.getCurrency(...args),
}));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1' }),
}));

/** An IDR store: exp 0, so a typed "500000" is 500000 minor units unchanged. */
const IDR_SETTINGS = { enabled: true, reminderIntervalHours: 24, maxLimitMinor: 500000 };

function render() {
  // `renderWithProvidersSync(ui, ...ftlContents)` takes the bundles as spread
  // POSITIONAL arguments. Passing an options object mounts nothing and every
  // Fluent lookup silently renders its raw key instead — which is exactly how
  // the first run of this suite failed ("settings-credit-error-limit" as the
  // alert text). The bundle has to arrive as an argument.
  return renderWithProvidersSync(<CreditFacilityCard />, settingsFtl);
}

describe('CreditFacilityCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCredit.mockResolvedValue(IDR_SETTINGS);
    mocks.setCredit.mockResolvedValue(undefined);
    mocks.getCurrency.mockResolvedValue('IDR');
  });

  it('loads the stored values into its controls', async () => {
    render();
    // exp 0 for IDR, so the stored 500000 renders as "500000" verbatim.
    await waitFor(() => {
      expect(screen.getByDisplayValue('500000')).toBeDefined();
    });
    expect(screen.getByDisplayValue('24')).toBeDefined();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('saves ALL THREE keys in one call — a partial save would drop the ceiling', async () => {
    render();
    await waitFor(() => expect(mocks.getCredit).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /save credit settings/i }));

    await waitFor(() => expect(mocks.setCredit).toHaveBeenCalledTimes(1));
    expect(mocks.setCredit).toHaveBeenCalledWith('tok-1', {
      enabled: true,
      reminderIntervalHours: 24,
      maxLimitMinor: 500000,
    });
  });

  it('carries an edited toggle and amount through to the payload', async () => {
    render();
    await waitFor(() => expect(mocks.getCredit).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('checkbox'));
    const limit = screen.getByDisplayValue('500000');
    fireEvent.change(limit, { target: { value: '750000' } });
    fireEvent.click(screen.getByRole('button', { name: /save credit settings/i }));

    await waitFor(() => expect(mocks.setCredit).toHaveBeenCalledWith('tok-1', {
      enabled: false,
      reminderIntervalHours: 24,
      maxLimitMinor: 750000,
    }));
  });

  it('REFUSES an unparseable amount instead of writing zero', async () => {
    // `parseMinorUnits` returns null for anything that is not a plain decimal
    // literal. Null must never become 0 — a typo would silently remove the
    // ceiling, which is the failure mode this case exists to prevent.
    render();
    await waitFor(() => expect(mocks.getCredit).toHaveBeenCalled());

    fireEvent.change(screen.getByDisplayValue('500000'), { target: { value: '1e3' } });
    fireEvent.click(screen.getByRole('button', { name: /save credit settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Enter a valid limit amount.');
    });
    expect(mocks.setCredit).not.toHaveBeenCalled();
  });

  it('scales the amount by the currency exponent', async () => {
    // A USD store has exp 2, so the same stored 500000 minor units must RENDER
    // as "5000.00" and must SAVE back as 500000. A card that ignored the
    // exponent would show a value 100x off and store it that way.
    mocks.getCurrency.mockResolvedValue('USD');
    render();
    await waitFor(() => expect(screen.getByDisplayValue('5000.00')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /save credit settings/i }));
    await waitFor(() => expect(mocks.setCredit).toHaveBeenCalledWith('tok-1', {
      enabled: true,
      reminderIntervalHours: 24,
      maxLimitMinor: 500000,
    }));
  });

  it('surfaces a load failure rather than rendering an empty editor', async () => {
    mocks.getCredit.mockRejectedValue(new Error('boom'));
    render();
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Could not load credit settings.');
    });
  });

  it('surfaces a save failure', async () => {
    mocks.setCredit.mockRejectedValue(new Error('boom'));
    render();
    await waitFor(() => expect(mocks.getCredit).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /save credit settings/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Could not save credit settings.');
    });
  });

  it('tells the operator the ceiling is advisory', async () => {
    // The honesty note is a product decision recorded in the card header: it
    // makes the ceiling SETTABLE, not ENFORCED. This pins the sentence so a
    // later edit cannot quietly drop it and let the card imply enforcement.
    render();
    await waitFor(() => {
      expect(
        screen.getByText(/not blocked yet/i),
      ).toBeDefined();
    });
  });
});
