//! A11y regression tests for KdsRoutingRulesEditor.
//!
//! The routing-rules editor is where a kitchen decides which station receives
//! which order — a table of matcher selects and key inputs with add/remove/reorder
//! buttons. It had no axe coverage, and a static scan flagged its per-row inputs
//! as having no id/label association; this file asks axe whether that is real.
//!
//! Uses the same IPC seam as KdsRoutingRulesEditor.test.tsx (the single
//! logged-invoke boundary) so the editor loads a real row.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, checkA11y } from './axe-helper';
import { KdsRoutingRulesSection } from '@/features/kds/components/KdsRoutingRulesEditor';

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-routing' }),
}));

const RULE = {
  id: 'rule-1',
  restaurant_pos_id: 'resto-1',
  priority: 1,
  matcher: 'category' as const,
  matcher_value: 'Drinks',
  target_station: 'bar',
  is_active: true,
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'get_kds_routing_rules_scoped') return Promise.resolve([RULE]);
    return Promise.resolve([]);
  });
});

describe('KdsRoutingRulesEditor a11y', () => {
  it('has no axe violations with a routing rule loaded', async () => {
    const { container } = renderWithProviders(<KdsRoutingRulesSection />);

    // The editor lives behind a collapsed disclosure — expand it or the axe
    // pass would clear an empty section.
    const toggle = container.querySelector('[data-testid="kds-routing-toggle"]') as HTMLButtonElement;
    expect(toggle, 'the routing toggle did not mount').toBeTruthy();
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(container.querySelector('.kds-routing-select')).toBeTruthy();
    });
    await checkA11y(container);

    // Vacuity guard: the row's controls are the surface this case is about.
    expect(container.querySelectorAll('.kds-routing-input').length).toBeGreaterThan(0);
  });
});
