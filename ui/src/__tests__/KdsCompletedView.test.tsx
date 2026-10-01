// ── KdsCompletedView tests ─────────────────────────────────────────
// Verifies the prototype bucket-columns completed view renders.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { KdsCompletedView } from '@/features/kds/KdsCompletedView';
import kdsFtl from '@/locales/kds.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

const mockList = vi.fn();

vi.mock('@/api/kds', () => ({
  listKdsOrdersScoped: (_token: string, _status?: string) => mockList(),
}));

// The view resolves the store's IANA zone before it files a ticket into a
// day bucket (the buckets are the store's calendar days, not the device's).
// The unit cases in KdsCompletedViewBucketForOffset.test.ts pin the mapping
// itself; this mock only keeps the component from reaching for a real invoke.
vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: () => Promise.resolve({ timezone: 'UTC' }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'test-token' }),
}));

function makeOrder(overrides: Partial<{ id: string; display_number: number; table_number: string | null; items_summary: string; received_at: string; served_at: string }> = {}) {
  const now = new Date();
  return {
    id: 'o-1',
    sale_id: 's-1',
    store_id: null,
    status: 'served',
    items_summary: 'Latte x2',
    item_count: 2,
    display_number: 101,
    received_at: new Date(now.getTime() - 10 * 60000).toISOString(),
    started_at: null,
    ready_at: null,
    served_at: now.toISOString(),
    prep_time_seconds: 0,
    kitchen_zone: null,
    notes: '',
    table_number: null,
    priority: false,
    ...overrides,
  };
}

describe('KdsCompletedView', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockList.mockResolvedValue([makeOrder()]);
  });

  it('renders bucket columns and a completed card', async () => {
    const { container } = renderWithFluentSync(<KdsCompletedView />, sharedFtl, kdsFtl);
    await vi.waitFor(() => {
      expect(container.querySelector('.kds-main.completed-view')).not.toBeNull();
      expect(container.querySelector('.kds-completed-col-head')).not.toBeNull();
    });
    // The served order appears in a bucket card with its number.
    await vi.waitFor(() => {
      expect(container.textContent).toContain('101');
      expect(container.textContent).toContain('Latte x2');
    });
  });

  it('calls onReopen when the reopen button is clicked', async () => {
    const onReopen = vi.fn();
    const { container } = renderWithFluentSync(<KdsCompletedView onReopen={onReopen} />, sharedFtl, kdsFtl);
    await vi.waitFor(() => {
      const btn = container.querySelector('.kds-status-btn.reopen') as HTMLButtonElement;
      expect(btn).not.toBeNull();
      btn.click();
      expect(onReopen).toHaveBeenCalledWith('o-1');
    });
  });
});