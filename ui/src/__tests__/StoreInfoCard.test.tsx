// ── StoreInfoCard tests ────────────────────────────────────────────
//
// Covers: read-only store info display (name, address, branch,
// currency, tax ID), variant='inspector-drawer' hides currency + tax,
// empty fields show em-dash placeholder.
//
// ADR #22 Phase 1 testing gate (§9).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode, ReactElement } from 'react';
import { LocalizationProvider } from '@fluent/react';
import { StoreInfoCard } from '@/features/settings/workspace-cards/StoreInfoCard';

const testL10n = {
  bundles: [], areBundlesEmpty: () => true,
  parseMarkup: (str: string) => [{ nodeName: '#text', textContent: str } as unknown as Node],
  getElement: (sourceElement: ReactElement) => sourceElement,
  getString: (id: string) => ({
    // The heading this card renders. The stub used to return the id, so the
    // test asserted that the card displayed 'workspace-store-info-heading'.
    'workspace-store-info-heading': 'Store Info',
  } as Record<string, string>)[id] ?? id,
  reportError: () => {}, getBundle: () => null, getChildren: (str: string) => str,
};

const mocks = vi.hoisted(() => ({
  store: {
    name: 'My Store',
    address: '123 Main St',
    branch: 'Downtown',
    currency: 'USD',
    taxId: 'TAX-001',
  },
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      store: mocks.store,
      receipt: { showCurrency: false, decimalSeparator: 'dot' as const, showTax: true, footer: '',
        paperWidth: 'standard' as const, showTableNumber: false,
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 },
      sync: { serverUrl: null, hasApiKey: false, enabled: false },
      brand: { colour: '#147EFB', storeName: '' },
      preferences: { cardSize: 0, fontSize: 0, fontSmoothing: 'antialiased' },
      currencies: [], appVersion: '',
    },
    loading: false, error: null, hasPartialError: false,
    refetch: vi.fn(), lastChangedKeys: [], markSettingsUpdated: vi.fn(),
  }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <LocalizationProvider l10n={testL10n}>{children}</LocalizationProvider>;
}
function renderCard(overrides: Record<string, unknown> = {}) {
  return render(<Wrapper><StoreInfoCard variant="full-page" {...overrides} /></Wrapper>);
}

beforeEach(() => {
  Object.assign(mocks.store, {
    name: 'My Store', address: '123 Main St', branch: 'Downtown',
    currency: 'USD', taxId: 'TAX-001',
  });
});

describe('StoreInfoCard', () => {
  it('renders Store Info heading', () => {
    renderCard();
    expect(screen.getByText('Store Info')).toBeInTheDocument();
  });

  it('displays store name', () => {
    renderCard();
    expect(screen.getByText('My Store')).toBeInTheDocument();
  });

  it('displays address', () => {
    renderCard();
    expect(screen.getByText('123 Main St')).toBeInTheDocument();
  });

  it('displays branch', () => {
    renderCard();
    expect(screen.getByText('Downtown')).toBeInTheDocument();
  });

  it('displays currency in full-page variant', () => {
    renderCard({ variant: 'full-page' });
    expect(screen.getByText('USD')).toBeInTheDocument();
  });

  it('hides currency in inspector-drawer variant', () => {
    renderCard({ variant: 'inspector-drawer' });
    expect(screen.queryByText('USD')).not.toBeInTheDocument();
  });

  it('displays tax ID in full-page variant', () => {
    renderCard({ variant: 'full-page' });
    expect(screen.getByText('TAX-001')).toBeInTheDocument();
  });

  it('hides tax ID in inspector-drawer variant', () => {
    renderCard({ variant: 'inspector-drawer' });
    expect(screen.queryByText('TAX-001')).not.toBeInTheDocument();
  });

  it('displays em-dash for empty name', () => {
    mocks.store.name = '';
    renderCard();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('displays em-dash for empty address', () => {
    mocks.store.address = '';
    renderCard();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
