// ── AppearanceSection tests ────────────────────────────────────────
//
// Covers: display section rendering (card size, font size, font smoothing
// controls), appearance settings rendering via AppearanceSettings,
// markDirty tracking on all state changes.
//
// ADR #22 Phase 1 testing gate (§9).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalizationProvider } from '@fluent/react';
import type { ReactNode } from 'react';
import AppearanceSection from '@/features/settings/sections/AppearanceSection';

// ── Fluent test l10n ───────────────────────────────────────────────

const testL10n = {
  bundles: [],
  areBundlesEmpty: () => true,
  parseMarkup: (str: string) => [{ nodeName: '#text', textContent: str } as unknown as Node],
  getElement: (sourceElement: React.ReactElement) => sourceElement,
  getString: (id: string) => {
    const defaults: Record<string, string> = {
      'settings-section-display': 'Display',
      'settings-field-card-size': 'Menu Card Size',
      'settings-field-font-size': 'Font Size',
      'settings-field-font-smoothing': 'Font Smoothing',
      'settings-font-smoothing-antialiased': 'Antialiased (crisp)',
      'settings-font-smoothing-subpixel': 'Subpixel (smooth)',
      'settings-card-size-decrease-aria': 'Decrease card size',
      'settings-card-size-increase-aria': 'Increase card size',
      'settings-font-size-decrease-aria': 'Decrease font size',
      'settings-font-size-increase-aria': 'Increase font size',
      'decrease-card-size-aria': 'Decrease card size',
      'increase-card-size-aria': 'Increase card size',
      'decrease-font-size-aria': 'Decrease font size',
      'increase-font-size-aria': 'Increase font size',
    };
    return defaults[id] ?? id;
  },
  reportError: () => {},
  getBundle: () => null,
  getChildren: (str: string) => str,
} as unknown as React.ComponentProps<typeof LocalizationProvider>['l10n'];

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/components/Card', () => ({
  Card: ({ children, shadow, header }: {
    children: React.ReactNode; shadow?: string; header?: React.ReactNode;
  }) => (
    <div data-testid="card" data-shadow={shadow}>
      {header}
      {children}
    </div>
  ),
}));

vi.mock('@/features/settings/AppearanceSettings', () => ({
  AppearanceSettings: ({ colour, storeName, onColourChange, onStoreNameChange }: {
    colour: string; storeName: string;
    onColourChange: (c: string) => void;
    onStoreNameChange: (n: string) => void;
  }) => (
    <div data-testid="appearance-settings">
      <span data-testid="appearance-colour">{colour}</span>
      <span data-testid="appearance-store-name">{storeName}</span>
      <button data-testid="colour-change-btn" onClick={() => onColourChange('#ff0000')}>Change Colour</button>
      <button data-testid="name-change-btn" onClick={() => onStoreNameChange('New Name')}>Change Name</button>
    </div>
  ),
}));

vi.mock('@/utils/color', () => ({
  deriveAccentPalette: vi.fn(() => ({
    accent: '#ff0000', accentDim: '#ffcccc', accentFg: '#ffffff',
  })),
  applyAccentPalette: vi.fn(),
  clearAccentPalette: vi.fn(),
  applyThemeContrasts: vi.fn(),
}));

vi.mock('@/features/settings/SettingsSelect', () => ({
  default: ({ id, value, onChange, options, ariaLabel }: {
    id?: string; value: string; onChange: (v: string) => void;
    options: { value: string; label: string }[];
    ariaLabel?: string;
  }) => (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
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
    <LocalizationProvider l10n={testL10n}>
      {children}
    </LocalizationProvider>
  );
}

// ── Test helper ─────────────────────────────────────────────────────

function renderSection(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    displayCardSize: 2,
    setDisplayCardSize: vi.fn(),
    displayFontSize: 2,
    setDisplayFontSize: vi.fn(),
    displayFontSmoothing: 'antialiased',
    setDisplayFontSmoothing: vi.fn(),
    brandColour: '#3b82f6',
    setBrandColour: vi.fn(),
    brandStoreName: 'My Store',
    setBrandStoreName: vi.fn(),
    markDirty: vi.fn(),
    l10n: testL10n,
  };

  return render(
    <Wrapper>
      <AppearanceSection {...defaultProps} {...overrides} />
    </Wrapper>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────

describe('AppearanceSection', () => {
  // ── Display section ──────────────────────────────────────────

  it('renders Display section header', () => {
    renderSection();
    expect(screen.getByText('Display')).toBeInTheDocument();
  });

  it('renders card size controls with current value', () => {
    renderSection({ displayCardSize: 3 });
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('calls markDirty + setDisplayCardSize when decrease is clicked', () => {
    const markDirty = vi.fn();
    const setDisplayCardSize = vi.fn();
    renderSection({ markDirty, setDisplayCardSize, displayCardSize: 2 });

    const decBtn = screen.getByLabelText('Decrease card size');
    fireEvent.click(decBtn);
    expect(setDisplayCardSize).toHaveBeenCalled();
    expect(markDirty).toHaveBeenCalled();
  });

  it('calls markDirty + setDisplayCardSize when increase is clicked', () => {
    const markDirty = vi.fn();
    const setDisplayCardSize = vi.fn();
    renderSection({ markDirty, setDisplayCardSize, displayCardSize: 2 });

    const incBtn = screen.getByLabelText('Increase card size');
    fireEvent.click(incBtn);
    expect(setDisplayCardSize).toHaveBeenCalled();
    expect(markDirty).toHaveBeenCalled();
  });

  it('disables card size decrease button at min value (0)', () => {
    renderSection({ displayCardSize: 0 });
    expect(screen.getByLabelText('Decrease card size')).toBeDisabled();
  });

  it('disables card size increase button at max value (4)', () => {
    renderSection({ displayCardSize: 4 });
    expect(screen.getByLabelText('Increase card size')).toBeDisabled();
  });

  it('renders font size controls with current value', () => {
    renderSection({ displayFontSize: 1 });
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('calls markDirty + setDisplayFontSize when decrease is clicked', () => {
    const markDirty = vi.fn();
    const setDisplayFontSize = vi.fn();
    renderSection({ markDirty, setDisplayFontSize, displayFontSize: 2 });

    const decBtn = screen.getByLabelText('Decrease font size');
    fireEvent.click(decBtn);
    expect(setDisplayFontSize).toHaveBeenCalled();
    expect(markDirty).toHaveBeenCalled();
  });

  it('calls markDirty + setDisplayFontSize when increase is clicked', () => {
    const markDirty = vi.fn();
    const setDisplayFontSize = vi.fn();
    renderSection({ markDirty, setDisplayFontSize, displayFontSize: 2 });

    const incBtn = screen.getByLabelText('Increase font size');
    fireEvent.click(incBtn);
    expect(setDisplayFontSize).toHaveBeenCalled();
    expect(markDirty).toHaveBeenCalled();
  });

  it('renders font smoothing select with options', () => {
    renderSection();
    const select = screen.getByLabelText('Font Smoothing');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('antialiased');
  });

  it('calls markDirty + setDisplayFontSmoothing when font smoothing changes', () => {
    const markDirty = vi.fn();
    const setDisplayFontSmoothing = vi.fn();
    renderSection({ markDirty, setDisplayFontSmoothing });

    fireEvent.change(screen.getByLabelText('Font Smoothing'), {
      target: { value: 'subpixel' },
    });
    expect(setDisplayFontSmoothing).toHaveBeenCalledWith('subpixel');
    expect(markDirty).toHaveBeenCalled();
  });

  // ── Appearance section ──────────────────────────────────────

  it('renders AppearanceSettings with correct props', () => {
    renderSection({ brandColour: '#ff0000', brandStoreName: 'Test Store' });
    expect(screen.getByTestId('appearance-colour')).toHaveTextContent('#ff0000');
    expect(screen.getByTestId('appearance-store-name')).toHaveTextContent('Test Store');
  });

  it('calls markDirty + setBrandColour when colour changes', () => {
    const markDirty = vi.fn();
    const setBrandColour = vi.fn();
    renderSection({ markDirty, setBrandColour, brandColour: '#3b82f6' });

    fireEvent.click(screen.getByText('Change Colour'));
    expect(setBrandColour).toHaveBeenCalledWith('#ff0000');
    expect(markDirty).toHaveBeenCalled();
  });

  it('calls markDirty + setBrandStoreName when store name changes', () => {
    const markDirty = vi.fn();
    const setBrandStoreName = vi.fn();
    renderSection({ markDirty, setBrandStoreName });

    fireEvent.click(screen.getByText('Change Name'));
    expect(setBrandStoreName).toHaveBeenCalledWith('New Name');
    expect(markDirty).toHaveBeenCalled();
  });
});
