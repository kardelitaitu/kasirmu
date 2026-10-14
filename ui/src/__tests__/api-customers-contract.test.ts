/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── IPC contract tests for customers.ts ───────────────────────────
//
// Customer reads are already session-scoped. These tests protect the
// mutation boundary so a future refactor cannot reintroduce the global
// user_id-based commands into the multi-store UI path.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  createCustomerScoped,
  updateCustomerScoped,
  deleteCustomerScoped,
} from '@/api/customers';

describe('customers.ts scoped mutation IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('createCustomerScoped invokes create_customer_scoped without a caller-supplied user id', async () => {
    mockInvoke.mockResolvedValue({ id: 'cust-1' });
    await createCustomerScoped('session-1', {
      name: 'Alice',
      email: 'alice@example.com',
      phone: '+1-555-0101',
      notes: 'Regular',
    });
    expect(mockInvoke).toHaveBeenCalledWith('create_customer_scoped', {
      sessionToken: 'session-1',
      args: {
        name: 'Alice',
        email: 'alice@example.com',
        phone: '+1-555-0101',
        notes: 'Regular',
      },
    });
  });

  it('updateCustomerScoped invokes update_customer_scoped with sessionToken + args', async () => {
    mockInvoke.mockResolvedValue({ id: 'cust-1' });
    await updateCustomerScoped('session-1', {
      id: 'cust-1',
      name: 'Alice Updated',
      notes: 'VIP',
    });
    expect(mockInvoke).toHaveBeenCalledWith('update_customer_scoped', {
      sessionToken: 'session-1',
      args: {
        id: 'cust-1',
        name: 'Alice Updated',
        notes: 'VIP',
      },
    });
  });

  it('deleteCustomerScoped invokes delete_customer_scoped with sessionToken + id', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await deleteCustomerScoped('session-1', 'cust-1');
    expect(mockInvoke).toHaveBeenCalledWith('delete_customer_scoped', {
      sessionToken: 'session-1',
      id: 'cust-1',
    });
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('permission denied'));
    await expect(deleteCustomerScoped('session-1', 'cust-1')).rejects.toThrow('permission denied');
  });
});
