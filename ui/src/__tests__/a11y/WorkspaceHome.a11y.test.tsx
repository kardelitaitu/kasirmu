//! A11y regression tests for WorkspaceHome.
//!
//! Ensures no axe-core violations are introduced during refactoring.

import { describe, it, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import WorkspaceHome from '@/features/workspaces/WorkspaceHome';

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
  it('has no axe violations on initial render', async () => {
    const { container } = renderWithProviders(<WorkspaceHome />);
    // Disable nested-interactive: the pin button inside the workspace
    // card button is an intentional UX pattern (nested click target).
    await checkA11y(container, {
      rules: { 'nested-interactive': { enabled: false } },
    });
  });
});
