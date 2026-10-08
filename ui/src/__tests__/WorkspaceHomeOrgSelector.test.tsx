// ── The pre-session org picker on the LOADED home screen ────────────────────
//
// WHY THIS FILE EXISTS AS ITS OWN SUITE
// `OrgSelector` renders NULL when the device has at most one organization
// (OrgSelector.tsx: `if (orgs.length <= 1) return null;`). The only tablet we
// can measure is a single-org device, so the device probe
// (`scripts/android-homescreen-probe.mjs`) reports that check as SKIP — it
// cannot answer the question. This suite answers it with a multi-org fixture.
//
// THE DEFECT IT PINS (measured 2026-10-08): the selector was mounted only
// inside WorkspaceHome's LOADING SKELETON. A workspace list that resolves in
// milliseconds hid it, so the operator never saw the organization choice
// before minting a session — the SaaS-3 L194 "safer half" was unreachable in
// practice. It is now mounted in the loaded header too.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, configure, cleanup } from '@testing-library/react';
import { renderWithFluent } from '@/__tests__/test-utils/render';
import WorkspaceHome from '@/features/workspaces/WorkspaceHome';
import { setShellKind } from '@/utils/shellKind';

configure({ asyncUtilTimeout: 5000 });

const ORGS = [
  { id: 'tenant-a:legal-entity-1', name: 'Alpha Co', tenant_id: 'tenant-a' },
  { id: 'tenant-a:legal-entity-2', name: 'Bravo Co', tenant_id: 'tenant-a' },
];

vi.mock('@/api/staff', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listOrganizations: vi.fn(async () => ORGS),
  };
});

const mockSetActiveWorkspace = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: {
      user_id: 'user-1',
      display_name: 'Test Owner',
      role_name: 'owner',
      role_id: 'role-owner',
    },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: false,
    isOwner: true,
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    availableWorkspaces: [
      {
        instance_id: 'default-restaurant-pos',
        type_key: 'restaurant-pos',
        store_id: 'default',
        store_name: 'Main Store',
        name: 'Restaurant POS',
        description: 'Cashier terminal',
        icon: 'restaurant',
        layout_mode: 'fullscreen',
        colour: null,
        is_default: false,
      },
    ],
    loading: false,
    error: null,
    retry: vi.fn(),
    setActiveWorkspace: mockSetActiveWorkspace,
    setActiveInstance: vi.fn(),
    activeInstance: null,
    activeWorkspace: null,
    workspaceScreens: [],
    lastWorkspace: null,
    resolvedStoreId: 'default',
    sessionToken: 'mock-session-token',
    terminalId: 'test-terminal',
    switchStore: vi.fn(),
    swapSessionToken: vi.fn(),
    setPendingOrgId: vi.fn(),
  }),
}));

describe('WorkspaceHome — org picker on the loaded screen', () => {
  beforeEach(() => {
    cleanup();
    setShellKind('desktop');
    localStorage.clear();
  });

  it('renders the org picker after the workspace list resolves', async () => {
    await renderWithFluent(<WorkspaceHome />);

    // Not the skeleton: the list has resolved, which is exactly the state
    // that used to hide the selector.
    await waitFor(() => {
      expect(document.querySelector('.workspace-skeleton-grid')).toBeNull();
    });
    expect(screen.getByTestId('workspace-home')).toBeInTheDocument();

    const selector = document.querySelector('.org-selector');
    expect(selector, 'the org picker must be reachable once the list resolves').not.toBeNull();
    await waitFor(() => {
      expect(document.querySelector('.org-selector-current')?.textContent ?? '').not.toBe('');
    });
  });
});
