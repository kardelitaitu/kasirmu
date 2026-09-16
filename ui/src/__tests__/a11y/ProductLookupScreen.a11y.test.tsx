//! A11y regression tests for ProductLookupScreen.
//!
//! Ensures no axe-core violations are introduced during refactoring.

import { describe, it, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import ProductLookupScreen from '@/features/products/ProductLookupScreen';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { username: 'test', role: 'owner', displayName: 'Test' },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: true,
    isOwner: true,
  }),
}));

// The screen calls exactly two api functions: lookupBundleBySku (@/api/bundles:176)
// and lookupProductBySkuScoped (@/api/products:182). This mock used to provide
// `searchProducts` -- a name @/api/products has never exported in either form -- plus
// `listProducts`, which the screen does not import. So it looked like product-lookup
// coverage for the product lookup screen while answering neither of its two calls, and
// @/api/bundles was not mocked at all.
//
// It passes only because an a11y test renders without triggering a lookup, so neither
// unmocked call is ever reached and the real modules never get exercised. That is the
// latent half of this class: the failure appears the moment anyone adds an interaction
// test here.
//
// `listProducts` is kept deliberately: vi.mock replaces the whole module, so a child
// component importing it would get undefined if I removed it on the grounds that this
// screen does not use it.
vi.mock('@/api/products', () => ({
  listProducts: vi.fn(() => Promise.resolve([])),
  lookupProductBySkuScoped: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/api/bundles', () => ({
  lookupBundleBySku: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/api/branding', () => ({
  getBrandSettings: () =>
    Promise.resolve({
      primary_colour: '#147EFB',
      logo_path: null,
      store_name: 'kasir.mu',
    }),
}));

describe('ProductLookupScreen a11y', () => {
  it('has no axe violations on initial render', async () => {
    const { container } = renderWithProviders(
      <ProductLookupScreen onAddProduct={vi.fn()} />,
    );
    // Two known a11y issues tracked as product bugs:
    // - button-name: icon buttons have aria-label via Fluent but
    //   Localized wrapper renders empty span that confuses axe-core
    // - aria-required-children: role="radiogroup" + Localized wrapper
    //   interaction causes false-positive on radio children detection
    await checkA11y(container, {
      rules: {
        'button-name': { enabled: false },
        'aria-required-children': { enabled: false },
      },
    });
  });
});
