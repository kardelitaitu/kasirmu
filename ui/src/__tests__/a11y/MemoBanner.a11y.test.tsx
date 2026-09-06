//! A11y regression tests for MemoBanner.
//!
//! Ensures the memo notification's structure (alert role, labelled buttons)
//! introduces no axe-core violations. The shared helper's minimal Fluent bundle
//! lacks the memo keys, so labels fall back to their key names — still
//! non-empty, which is what the a11y assertions care about.

import { describe, it, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import MemoBanner from '@/features/memo/MemoBanner';
import { useMemos } from '@/features/memo/useMemos';
import type { ActiveMemo } from '@/api/memos';

vi.mock('@/features/memo/useMemos', () => ({
  useMemos: vi.fn(),
}));

const memo: ActiveMemo = {
  memo: {
    id: 'm1',
    tenantId: 'default',
    locationId: null,
    authorUserId: 'user-1',
    authorRole: 'role-owner',
    title: 'End-of-day checklist',
    body: 'Close the drawer and count the float.',
    status: 'published',
    duration: '24h',
    revision: 1,
    publishedAt: '2026-09-08T09:00:00.000Z',
    expiresAt: '2026-09-09T09:00:00.000Z',
    createdAt: '2026-09-08T09:00:00.000Z',
  },
  deliveryStatus: 'pending',
};

describe('MemoBanner a11y', () => {
  it('has no axe violations when a memo is shown', async () => {
    vi.mocked(useMemos).mockReturnValue({
      memos: [memo],
      loading: false,
      error: null,
      acknowledge: vi.fn(),
      dismiss: vi.fn(),
      refresh: vi.fn(),
    });
    const { container } = renderWithProviders(<MemoBanner />);
    await checkA11y(container);
  });
});
