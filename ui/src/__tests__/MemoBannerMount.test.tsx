//! Integration test: MemoBanner is mounted in the app shell and renders the
//! active memo returned by the read path. Proves the AppLayout/TabletAppLayout
//! mount wires the display surface end-to-end (layout → useMemos → api), not
//! just that the component works in isolation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, render, waitFor } from '@testing-library/react';
import { withFluent } from '@/locales/test-utils';
import TabletAppLayout from '@/frontend/shell/tablet/TabletAppLayout';
import sharedFtl from '@/locales/shared.ftl?raw';
import type { ActiveMemo } from '@/api/memos';

const mockList = vi.fn();
vi.mock('@/api/memos', () => ({
  listActiveMemosScoped: (token: string) => mockList(token),
  acknowledgeMemoScoped: vi.fn(() => Promise.resolve()),
}));

const mockGetNavItems = vi.fn();
vi.mock('@/platform/ui/menu-registry', () => ({
  getNavItems: () => mockGetNavItems(),
}));

const memo: ActiveMemo = {
  memo: {
    id: 'm1',
    tenantId: 'default',
    locationId: 'loc-1',
    authorUserId: 'user-1',
    authorRole: 'role-manager',
    title: 'Restock aisle 3',
    body: 'Refill the front shelf before doors open.',
    status: 'published',
    duration: '12h',
    revision: 1,
    publishedAt: '2026-09-08T10:00:00.000Z',
    expiresAt: '2026-09-08T22:00:00.000Z',
    createdAt: '2026-09-08T10:00:00.000Z',
  },
  deliveryStatus: 'pending',
};

beforeEach(() => {
  mockList.mockReset();
  mockGetNavItems.mockReset();
  mockGetNavItems.mockReturnValue([]);
});

function renderLayout() {
  return render(
    withFluent(
      <TabletAppLayout route="sales" onNavigate={vi.fn()} enabledFeatures={new Set()} userRole="role-staff" permissions={[]} workspaceScreens={[]}>
        <div data-testid="content">Main Content</div>
      </TabletAppLayout>,
      sharedFtl,
    ),
  );
}

describe('MemoBanner mounted in the shell', () => {
  it('renders the active memo returned by the read path', async () => {
    mockList.mockResolvedValue([memo]);
    renderLayout();
    await waitFor(() => expect(screen.getByText('Restock aisle 3')).toBeInTheDocument());
    // The real shared.ftl bundle supplies the Location badge + button labels.
    expect(screen.getByText('Location notice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acknowledge this memo' })).toBeInTheDocument();
  });

  it('renders nothing when the terminal has no active memos', async () => {
    mockList.mockResolvedValue([]);
    renderLayout();
    await waitFor(() => expect(screen.getByTestId('content')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
