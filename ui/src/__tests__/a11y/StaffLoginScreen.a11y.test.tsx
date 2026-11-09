//! A11y regression tests for StaffLoginScreen.
//!
//! Ensures no axe-core violations are introduced during refactoring.

import { describe, it, expect, vi } from 'vitest';
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
  // WHY A DOM ASSERTION AND NOT AN AXE RUN: axe's `page-has-heading-one` cannot
  // reach a verdict under jsdom (both a document with an <h1> and one without
  // return `incomplete` / `error-occurred`), measured 2026-10-27. The login
  // screen had no heading of any kind -- the store name renders as an <img alt>
  // on the username step and a badge on the PIN step, so the app's front door
  // had no page name. Confirmed by mutation: reverting to <h2> left all 52 cases
  // in this file and the three SessionLock/StaffLogin behavioural suites green.
  it('names the page with a single level-one heading', () => {
    const { container } = renderWithProviders(<StaffLoginScreen />);
    const h1s = Array.from(container.querySelectorAll('h1'));
    expect(h1s, 'the staff login must carry exactly one level-one heading').toHaveLength(1);
    expect(h1s[0]!.textContent?.trim(), 'an empty h1 satisfies a rule but not a reader').not.toBe('');
  });

  it('has no axe violations on initial render', async () => {
    const { container } = renderWithProviders(<StaffLoginScreen />);
    await checkA11y(container);
  });
});
