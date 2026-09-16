// ── GeneralSection tests ─────────────────────────────────────────
//
// Covers: store info form rendering (name, address, tax ID, branch),
// field validation (required store name, tax ID pattern), dirty tracking
// via markDirty, currency select, and field error display.
//
// ADR #22 Phase 1 testing gate (§9).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalizationProvider } from '@fluent/react';
import type { ReactNode, ReactElement } from 'react';
import GeneralSection from '@/features/settings/sections/GeneralSection';
import type { StoreSettingsDto } from '@/api/settings';

// ── Fluent test l10n ───────────────────────────────────────────────

const testL10n = {
  bundles: [],
  areBundlesEmpty: () => true,
  parseMarkup: (str: string) => [{ nodeName: '#text', textContent: str } as unknown as Node],
  getElement: (sourceElement: ReactElement) => sourceElement,
  getString: (id: string) => {
    const defaults: Record<string, string> = {
      'settings-section-store': 'Store',
      'settings-section-currency': 'Currency',
      'settings-field-store-name': 'Store Name',
      'settings-field-address': 'Address',
      'settings-field-tax-id': 'Tax ID',
      'settings-field-branch': 'Branch',
      'settings-field-language': 'Language',
      'settings-field-default-currency': 'Default currency',
      'settings-currency-loading': 'Loading currencies…',
      'settings-store-name-placeholder': 'kasir.mu Store',
      'settings-address-placeholder': '123 Main Street',
      'settings-tax-id-placeholder': '12-3456789',
      'settings-branch-placeholder': 'Main Branch',
      'settings-store-name-required': 'Store name is required',
      'settings-tax-id-pattern-error': 'Invalid tax ID format',
      'settings-tax-id-pattern-hint': 'Enter a valid tax ID',
    };
    return defaults[id] ?? id;
  },
  reportError: () => {},
  getBundle: () => null,
  getChildren: (str: string) => str,
};

// ── Context / mocks ────────────────────────────────────────────────

// LocaleContext uses real React.createContext; the wrapper provides the value.

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-123' }),
}));

vi.mock('@/api/settings', () => ({
  setSettingScoped: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/i18n/LanguageSelector', () => ({
  LanguageSelector: (_props: { hideLabel?: boolean }) => (
    <select id="language-select" aria-label="Language">
      <option value="en">English</option>
      <option value="id">Indonesian</option>
    </select>
  ),
}));

vi.mock('../SettingsSelect', () => ({
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
      data-placeholder={placeholder}
    >
      {placeholder && <option value="" disabled>{placeholder}</option>}
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

// Absorb locale side-effect: GeneralSection calls setSettingScoped when locale changes.
// The component uses useContext(LocaleContext) internally.
vi.mock('@/i18n/LocaleContext', () => ({
  __esModule: true,
  LocaleContext: {
    $$typeof: Symbol.for('react.context'),
    Consumer: ({ children }: { children: (v: unknown) => ReactNode }) => children({ locale: 'en' }),
    Provider: ({ children }: { children: ReactNode }) => <>{children}</>,
    _currentValue: { locale: 'en' },
  },
}));

const DEFAULT_STORE: StoreSettingsDto = {
  name: 'Test Store',
  address: '123 Main St',
  taxId: '12-3456789',
  branch: 'Downtown',
  currency: 'IDR',
};

function renderSection(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    store: DEFAULT_STORE,
    setStore: vi.fn(),
    markDirty: vi.fn(),
    cmInput: {} as React.HTMLAttributes<HTMLInputElement>,
    fieldErrors: {} as Record<string, string>,
    validateField: vi.fn(),
    clearFieldError: vi.fn(),
    currencies: [],
    defaultCurrency: 'IDR',
    setDefaultCurrencyState: vi.fn(),
    l10n: testL10n,
  };

  return render(
    <Wrapper>
      <GeneralSection {...defaultProps} {...overrides} />
    </Wrapper>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────

describe('GeneralSection', () => {
  it('renders store info card with all fields', () => {
    renderSection();
    expect(screen.getByDisplayValue('Test Store')).toBeInTheDocument();
    expect(screen.getByDisplayValue('123 Main St')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12-3456789')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Downtown')).toBeInTheDocument();
  });

  it('calls markDirty when store name changes', () => {
    const markDirty = vi.fn();
    const setStore = vi.fn();
    renderSection({ markDirty, setStore });

    fireEvent.change(screen.getByDisplayValue('Test Store'), {
      target: { value: 'Updated Store' },
    });
    expect(setStore).toHaveBeenCalled();
    expect(markDirty).toHaveBeenCalled();
  });

  it('calls markDirty when address changes', () => {
    const markDirty = vi.fn();
    const setStore = vi.fn();
    renderSection({ markDirty, setStore });

    fireEvent.change(screen.getByDisplayValue('123 Main St'), {
      target: { value: '456 Oak Ave' },
    });
    expect(markDirty).toHaveBeenCalled();
  });

  it('calls markDirty when tax ID changes', () => {
    const markDirty = vi.fn();
    const setStore = vi.fn();
    renderSection({ markDirty, setStore });

    fireEvent.change(screen.getByDisplayValue('12-3456789'), {
      target: { value: '98-7654321' },
    });
    expect(markDirty).toHaveBeenCalled();
  });

  it('calls markDirty when branch changes', () => {
    const markDirty = vi.fn();
    const setStore = vi.fn();
    renderSection({ markDirty, setStore });

    fireEvent.change(screen.getByDisplayValue('Downtown'), {
      target: { value: 'Uptown' },
    });
    expect(markDirty).toHaveBeenCalled();
  });

  it('calls clearFieldError when store name changes', () => {
    const clearFieldError = vi.fn();
    renderSection({ clearFieldError, fieldErrors: { 'store-name': 'Required' } });

    fireEvent.change(screen.getByDisplayValue('Test Store'), {
      target: { value: 'New Name' },
    });
    expect(clearFieldError).toHaveBeenCalledWith('store-name');
  });

  it('calls validateField on store name blur', () => {
    const validateField = vi.fn();
    renderSection({ validateField });

    fireEvent.blur(screen.getByDisplayValue('Test Store'));
    expect(validateField).toHaveBeenCalledWith('store-name', 'Test Store');
  });

  it('calls validateField on tax ID blur', () => {
    const validateField = vi.fn();
    renderSection({ validateField });

    fireEvent.blur(screen.getByDisplayValue('12-3456789'));
    expect(validateField).toHaveBeenCalledWith('tax-id', '12-3456789');
  });

  it('displays field error text when present', () => {
    renderSection({ fieldErrors: { 'store-name': 'Store name is required' } });
    expect(screen.getByText('Store name is required')).toBeInTheDocument();
  });

  it('renders currency section', () => {
    renderSection({
      currencies: [
        { code: 'IDR', name: 'Indonesian Rupiah', minor_exponent: 0, symbol: 'Rp' },
        { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
      ],
      defaultCurrency: 'IDR',
    });
    // SettingsSelect renders options with combined label
    expect(screen.getByRole('combobox', { name: 'Default currency' })).toBeInTheDocument();
  });

  it('calls markDirty when currency changes', () => {
    const markDirty = vi.fn();
    const setDefaultCurrencyState = vi.fn();
    const setStore = vi.fn();
    renderSection({
      markDirty,
      setDefaultCurrencyState,
      setStore,
      currencies: [
        { code: 'IDR', name: 'Indonesian Rupiah', minor_exponent: 0, symbol: 'Rp' },
        { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
      ],
      defaultCurrency: 'IDR',
    });

    const select = screen.getByRole('combobox', { name: 'Default currency' });
    fireEvent.change(select, { target: { value: 'USD' } });
    expect(markDirty).toHaveBeenCalled();
    expect(setDefaultCurrencyState).toHaveBeenCalledWith('USD');
  });

  it('renders LanguageSelector', () => {
    renderSection();
    expect(screen.getByLabelText('Language')).toBeInTheDocument();
  });
});
