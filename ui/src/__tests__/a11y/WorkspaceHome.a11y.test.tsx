//! A11y regression tests for WorkspaceHome.
//!
//! Ensures no axe-core violations are introduced during refactoring.

import { describe, it, vi, expect } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import WorkspaceHome from '@/features/workspaces/WorkspaceHome';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { username: 'test', role_name: 'Owner', displayName: 'Test' },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: true,
    isOwner: true,
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    availableWorkspaces: [
      { type_key: 'store-pos', instance_id: 'ws-1', store_id: 'default', store_name: 'Main', name: 'POS', description: 'Point of Sale', icon: 'store', layout_mode: 'fullscreen', colour: null, is_default: true },
      { type_key: 'warehouse', instance_id: 'ws-2', store_id: 'default', store_name: 'Main', name: 'Warehouse', description: 'Product and stock management', icon: 'package', layout_mode: 'sidebar', colour: null, is_default: false },
      { type_key: 'admin', instance_id: 'ws-3', store_id: 'default', store_name: 'Main', name: 'Admin', description: 'Settings', icon: 'admin', layout_mode: 'sidebar', colour: null, is_default: false },
    ],
    loading: false,
    error: null,
    retry: vi.fn(),
    setActiveWorkspace: vi.fn(),
    lastWorkspace: null,
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

describe('WorkspaceHome a11y', () => {
  // WHY THIS CASE IS A STRUCTURAL ASSERTION AND NOT AN AXE RUN.
  //
  // axe-core's `page-has-heading-one` cannot reach a verdict under jsdom: run
  // against a document that HAS an <h1> and one that has none, it returns the
  // rule in `incomplete` for BOTH ("Axe encountered an error; test the page for
  // this type of problem manually"). Measured 2026-10-26. So a case asserting the
  // rule reported nothing would pass over any page, and a case asserting
  // `incomplete` is empty would fail over every page -- neither is a gate.
  //
  // What IS checkable is the structure the rule asks for, and that is what this
  // pins: exactly one level-one heading, and it is not empty. The screen had
  // ZERO (7 <h2>, 0 <h1>) while all 123 a11y cases were green, because
  // jest-axe's toHaveNoViolations() reads `violations` only and the rule never
  // lands there. `checkA11y` cannot see it either -- it passes a container, and
  // the rule selects `html:not(html *)`.
  it('renders exactly one non-empty level-one heading', () => {
    const { container } = renderWithProviders(<WorkspaceHome />);
    const h1s = Array.from(container.querySelectorAll('h1'));
    expect(h1s, 'the page must carry one level-one heading').toHaveLength(1);
    expect(h1s[0]!.textContent?.trim(), 'an empty h1 satisfies axe but not a reader').not.toBe('');
  });

  it('has no axe violations on initial render', async () => {
    const { container } = renderWithProviders(<WorkspaceHome />);
    // Disable nested-interactive: the pin button inside the workspace
    // card button is an intentional UX pattern (nested click target).
    await checkA11y(container, {
      rules: { 'nested-interactive': { enabled: false } },
    });
  });
});
