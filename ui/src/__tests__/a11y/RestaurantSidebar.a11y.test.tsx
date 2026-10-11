//! A11y regression tests for RestaurantSidebar.
//!
//! The sidebar is the restaurant POS's terminal-actions surface — shift, tables,
//! history, KDS, menu editor, receipts, payments, settings, lock and exit — and
//! it had no axe coverage while the menu panel (RestaurantMenu.a11y.test.tsx) did.
//! Renders it DIRECTLY with hand-crafted `cartActions`, the same seam
//! RestaurantSidebar.logic.test.tsx uses, so axe sees every row in one pass.

import { describe, it, vi } from 'vitest';
import { createRef } from 'react';
import { renderWithProviders, checkA11y } from './axe-helper';
import { RestaurantSidebar, type RestaurantSidebarActions } from '@/features/restaurant/components/RestaurantSidebar';

vi.mock('@/hooks/useWorkspaceNav', () => ({
  useWorkspaceNav: () => ({ goToWorkspacePicker: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    isManager: true,
    isOwner: false,
    session: { user_id: 'user-1', username: 'owner', role_name: 'owner' },
  }),
}));

vi.mock('@/hooks/useVersionStatus', () => ({
  useVersionStatus: () => ({ currentVersion: '0.0.41' }),
}));

/**
 * Every row RENDERED. `showTables` and `showKitchenDisplay` are true so the
 * gated rows mount; a row that only exists when a feature is on is still a row
 * axe should see.
 */
function actions(): RestaurantSidebarActions {
  return {
    shiftLoading: false,
    hasActiveShift: false,
    onOpenShift: vi.fn(),
    onCloseShift: vi.fn(),
    deductionLocationName: null,
    deductionOverridden: false,
    onOverrideDeduction: vi.fn(),
    showTables: true,
    onOpenTables: vi.fn(),
    onOpenHistory: vi.fn(),
    showKitchenDisplay: true,
    onOpenKitchenDisplay: vi.fn(),
    onOpenMenuEditor: vi.fn(),
    onOpenReceipts: vi.fn(),
    onOpenPayments: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenCashDrawer: vi.fn(),
  };
}

describe('RestaurantSidebar a11y', () => {
  it('has no axe violations with every row mounted', async () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = renderWithProviders(
      <RestaurantSidebar
        open
        onOpenChange={vi.fn()}
        sidebarRef={ref}
        cartActions={actions()}
        isManager
      />,
    );
    await checkA11y(container);
  });
});
