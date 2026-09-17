//! A11y regression tests for StaffLoginScreen.
//!
//! Ensures no axe-core violations are introduced during refactoring.

import { describe, it, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import StaffLoginScreen from '@/features/auth/StaffLoginScreen';

vi.mock('@/api/staff', () => ({
  // STAFF-06: uniform pre-auth response.
  checkUsername: vi.fn(() => Promise.resolve({ proceed: true })),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: null,
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: false,
    isOwner: false,
  }),
}));

vi.mock('@/api/branding', () => ({
  getBrandSettings: () =>
    Promise.resolve({
      primary_colour: '#147EFB',
      logo_path: null,
      store_name: 'kasir.mu',
    }),
}));

describe('StaffLoginScreen a11y', () => {
  it('has no axe violations on initial render', async () => {
    const { container } = renderWithProviders(<StaffLoginScreen />);
    await checkA11y(container);
  });
});
