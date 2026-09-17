//! A11y regression tests for SalesHistoryScreen.
//!
//! Ensures no axe-core violations are introduced during refactoring.

import { describe, it, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import SalesHistoryScreen from '@/features/sales/SalesHistoryScreen';

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

vi.mock('@/api/sales', () => ({
  listSales: vi.fn(() => Promise.resolve({ sales: [], salesHistoryCapped: false })),
  voidSale: vi.fn(),
}));

// The screen resolves staff from the workspace session token; the global
// WorkspaceContext stub provides a truthy token, so the staff API must be
// mocked too or the real IPC call resolves null and crashes staff.map.
vi.mock('@/api/staff', () => ({
  listStaffScoped: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/api/branding', () => ({
  getBrandSettings: () =>
    Promise.resolve({
      primary_colour: '#147EFB',
      logo_path: null,
      store_name: 'kasir.mu',
    }),
}));

describe('SalesHistoryScreen a11y', () => {
  it('has no axe violations on initial render', async () => {
    const { container } = renderWithProviders(<SalesHistoryScreen />);
    // heading-order fixed — EmptyState now supports configurable headingLevel
    await checkA11y(container);
  });
});
