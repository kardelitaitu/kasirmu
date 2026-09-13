// ── RegionalSettingsCard tests ─────────────────────────────────────
//
// Covers: the slice-3 Business Defaults card — effective values with
// provenance rendering, single-entity usability (primary location, no
// picker), the save flow through set_regional_config_scoped with the
// read-after-write response, and typed error display.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocalizationProvider } from '@fluent/react';
import type { ReactNode, ReactElement } from 'react';
import { RegionalSettingsCard } from '@/features/settings/screens/RegionalSettingsCard';
import type { RegionalConfig } from '@/api/regional';
import type * as RegionalApi from '@/api/regional';

// ── Fluent test l10n ───────────────────────────────────────────────

const REGIONAL_KEYS: Record<string, string> = {
  'settings-regional-title': 'Regional',
  'settings-regional-subtitle': 'Market facts this location answers.',
  'settings-regional-locale': 'Locale (BCP-47)',
  'settings-regional-locale-placeholder': 'e.g. id-ID — blank inherits',
  'settings-regional-currency': 'Currency (ISO-4217)',
  'settings-regional-currency-placeholder': 'e.g. IDR — blank inherits',
  'settings-regional-currency-inherit': 'Inherit (scope above)',
  'settings-regional-timezone': 'Timezone',
  'settings-regional-timezone-inherit': 'Inherit (scope above)',
  'settings-regional-timezone-utc': 'UTC (legacy sentinel)',
  'settings-regional-country': 'Market anchor (ISO-3166)',
  'settings-regional-country-placeholder': 'e.g. ID — blank leaves the entity unchanged',
  'settings-regional-country-hint': "Resolved through the location's legal entity.",
  'settings-regional-save': 'Save regional defaults',
  'settings-regional-saving': 'Saving…',
  'settings-regional-saved': 'Regional defaults saved.',
  'settings-regional-error-save': 'Could not save the regional defaults.',
  'settings-regional-error-load': 'Could not load the regional defaults.',
  'settings-regional-no-location': 'No location to configure yet.',
  'settings-regional-scope-location': 'Set at this location',
  'settings-regional-scope-legal-entity': 'Inherited from the legal entity',
  'settings-regional-scope-organization': 'Organization default',
  'settings-regional-scope-built-in': 'Built-in default',
  'settings-section-loading': 'Loading…',
};

const testL10n = {
  bundles: [],
  areBundlesEmpty: () => true,
  parseMarkup: (str: string) => [{ nodeName: '#text', textContent: str } as unknown as Node],
  getElement: (sourceElement: ReactElement) => sourceElement,
  getString: (id: string) => REGIONAL_KEYS[id] ?? id,
  reportError: () => {},
  getBundle: () => null,
  getChildren: (str: string) => str,
};

// ── Fixtures ───────────────────────────────────────────────────────

const baseConfig: RegionalConfig = {
  location_id: 'loc-1',
  legal_entity_id: 'ent-1',
  country_code: null,
  locale: { value: 'en-US', scope: 'built_in' },
  timezone: { value: 'Asia/Makassar', scope: 'legal_entity' },
  currency: { value: 'USD', scope: 'location' },
};

const mockGetPrimaryLocationScoped = vi.fn();
const mockGetRegionalConfigScoped = vi.fn();
const mockSetRegionalConfigScoped = vi.fn();
const mockListCurrenciesScoped = vi.fn();

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-123' }),
}));

vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mockGetPrimaryLocationScoped(...args),
}));

vi.mock('@/api/regional', async (importOriginal) => {
  const actual = await importOriginal<typeof RegionalApi>();
  return {
    ...actual,
    getRegionalConfigScoped: (...args: unknown[]) => mockGetRegionalConfigScoped(...args),
    setRegionalConfigScoped: (...args: unknown[]) => mockSetRegionalConfigScoped(...args),
  };
});

vi.mock('@/api/currency', () => ({
  listCurrenciesScoped: (...args: unknown[]) => mockListCurrenciesScoped(...args),
}));

vi.mock('@/features/settings/SettingsSelect', () => ({
  default: ({ id, value, onChange, options, disabled, ariaLabel, placeholder }: {
    id?: string; value: string; onChange: (v: string) => void;
    options: { value: string; label: string }[];
    disabled?: boolean; ariaLabel?: string; placeholder?: string;
  }) => (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={id}
      data-placeholder={placeholder}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  ),
}));

// ── Wrapper ─────────────────────────────────────────────────────────

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <LocalizationProvider l10n={testL10n as unknown as React.ComponentProps<typeof LocalizationProvider>['l10n']}>
      {children}
    </LocalizationProvider>
  );
}

function renderCard() {
  return render(
    <Wrapper>
      <RegionalSettingsCard />
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPrimaryLocationScoped.mockResolvedValue({ id: 'loc-1', name: 'Main', is_primary: true });
  mockGetRegionalConfigScoped.mockResolvedValue(baseConfig);
  mockListCurrenciesScoped.mockResolvedValue([
    { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
    { code: 'IDR', name: 'Rupiah', minor_exponent: 2, symbol: 'Rp' },
  ]);
});

describe('RegionalSettingsCard', () => {
  it('renders the effective values with provenance from the read', async () => {
    renderCard();
    await waitFor(() => expect(screen.getByTestId('regional-timezone-select')).toBeTruthy());

    // The effective currency (location layer) is preselected; the timezone
    // inherited from the entity shows as the inherit option (blank draft).
    expect((screen.getByTestId('regional-currency-select') as HTMLSelectElement).value).toBe('USD');
    expect((screen.getByTestId('regional-timezone-select') as HTMLSelectElement).value).toBe('');
    // Provenance copy resolves from the scope names.
    expect(screen.getByText('Inherited from the legal entity')).toBeTruthy();
    expect(screen.getByText('Built-in default')).toBeTruthy();
  });

  it('is single-entity usable: no location picker, primary location only', async () => {
    renderCard();
    await waitFor(() => expect(screen.getByTestId('regional-timezone-select')).toBeTruthy());
    // Exactly two selects (timezone + currency): no location or entity picker.
    expect(screen.getAllByRole('combobox').length).toBe(2);
    expect(mockGetRegionalConfigScoped).toHaveBeenCalledWith('tok-123', 'loc-1');
  });

  it('saves the edited draft and applies the read-after-write response', async () => {
    const updated: RegionalConfig = {
      ...baseConfig,
      locale: { value: 'id-ID', scope: 'location' },
      currency: { value: 'IDR', scope: 'location' },
      country_code: 'ID',
    };
    mockSetRegionalConfigScoped.mockResolvedValue(updated);
    renderCard();

    fireEvent.change(await screen.findByLabelText('Locale (BCP-47)'), { target: { value: 'id-ID' } });
    fireEvent.change(screen.getByTestId('regional-currency-select'), { target: { value: 'IDR' } });
    fireEvent.change(screen.getByLabelText('Market anchor (ISO-3166)'), { target: { value: 'ID' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save regional defaults' }));

    await waitFor(() => expect(mockSetRegionalConfigScoped).toHaveBeenCalledTimes(1));
    expect(mockSetRegionalConfigScoped).toHaveBeenCalledWith('tok-123', 'loc-1', {
      locale: 'id-ID',
      timezone: '',
      currency: 'IDR',
      country_code: 'ID',
    });
    // The response replaces the state: provenance + saved status update.
    // Locale AND currency both answer at location provenance now.
    await waitFor(() => expect(screen.getByText('Regional defaults saved.')).toBeTruthy());
    expect(screen.getAllByText('Set at this location').length).toBe(2);
  });

  it('renders the typed error copy when the save is rejected', async () => {
    // An untyped rejection falls through parseAppError to the card's own
    // localized fallback copy.
    mockSetRegionalConfigScoped.mockRejectedValue('storage failure');
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: 'Save regional defaults' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Could not save the regional defaults.')).toBeTruthy();
  });
});