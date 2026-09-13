// ── IPC contract tests for the KDS routing-rule wrappers in kds.ts ──────
//
// Pins the two routing-rule wrappers onto the command names registered in
// apps/desktop-client/src/lib.rs and onto the argument shape those Rust
// signatures take (session_token, rules). The restaurant scope comes from the
// session, never from the payload, so the last case asserts the payload carries
// nothing that could let one restaurant rewrite another restaurant's routing.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  getKdsRoutingRulesScoped,
  saveKdsRoutingRulesScoped,
  type KdsRoutingRule,
  type KdsRoutingRuleInput,
} from '@/api/kds';

const savedRule: KdsRoutingRule = {
  id: '0198c6b2-0000-7000-8000-000000000001',
  restaurant_pos_id: 'resto-1',
  priority: 1,
  matcher: 'sku',
  matcher_value: 'BURGER',
  target_station: 'grill',
  is_active: true,
  created_at: '2026-09-13T05:00:00Z',
  updated_at: '2026-09-13T05:00:00Z',
};

describe('kds.ts routing-rule IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('getKdsRoutingRulesScoped -> get_kds_routing_rules_scoped with sessionToken only', async () => {
    mockInvoke.mockResolvedValue([savedRule]);
    const rules = await getKdsRoutingRulesScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('get_kds_routing_rules_scoped', { sessionToken: 'tok' });
    expect(rules).toEqual([savedRule]);
  });

  it('saveKdsRoutingRulesScoped -> save_kds_routing_rules_scoped with sessionToken + rules', async () => {
    mockInvoke.mockResolvedValue([savedRule]);
    const input: KdsRoutingRuleInput = {
      priority: 1,
      matcher: 'sku',
      matcher_value: 'BURGER',
      target_station: 'grill',
    };
    const saved = await saveKdsRoutingRulesScoped('tok', [input]);
    expect(mockInvoke).toHaveBeenCalledWith('save_kds_routing_rules_scoped', {
      sessionToken: 'tok',
      rules: [input],
    });
    expect(saved).toEqual([savedRule]);
  });

  // Whole-set replace: an empty list is an answer, not a no-op, so the wrapper
  // has to forward it instead of short-circuiting the call.
  it('forwards an empty rule set, which clears the session scope', async () => {
    mockInvoke.mockResolvedValue([]);
    await saveKdsRoutingRulesScoped('tok', []);
    expect(mockInvoke).toHaveBeenCalledWith('save_kds_routing_rules_scoped', {
      sessionToken: 'tok',
      rules: [],
    });
  });

  it('carries neither the restaurant scope nor a server-assigned id', async () => {
    mockInvoke.mockResolvedValue([]);
    await saveKdsRoutingRulesScoped('tok', [
      { priority: 2, matcher: 'category', matcher_value: 'cat-9', target_station: 'fry', is_active: false },
    ]);
    const call = mockInvoke.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(Object.keys(call[1]).sort()).toEqual(['rules', 'sessionToken']);
    const rules = call[1]['rules'] as unknown as Record<string, unknown>[];
    expect(Object.keys((rules[0] ?? {}) as Record<string, unknown>).sort()).toEqual([
      'is_active',
      'matcher',
      'matcher_value',
      'priority',
      'target_station',
    ]);
  });
});
