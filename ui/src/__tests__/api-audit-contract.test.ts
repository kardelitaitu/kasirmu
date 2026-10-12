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
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  listAuditLogScoped,
  markAuditReviewedScoped,
  exportAuditLogScoped,
  getAuditReviewStatusScoped,
} from '@/api/audit';

describe('audit.ts API contract', () => {
  const TOKEN = 'tok_audit';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listAuditLogScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ entries: [], total: 0 });
    await listAuditLogScoped(TOKEN, { limit: 50 });
    expect(mockInvoke).toHaveBeenCalledWith('list_audit_log_scoped', {
      sessionToken: TOKEN,
      args: { limit: 50 },
    });
  });

  it('markAuditReviewedScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ reviewedAt: '2026-01-01' });
    await markAuditReviewedScoped(TOKEN, {
      reviewedThroughCreatedAt: '2026-01-01T00:00:00Z',
      reviewedThroughId: 'entry-1',
    });
    expect(mockInvoke).toHaveBeenCalledWith('mark_audit_reviewed_scoped', {
      sessionToken: TOKEN,
      args: {
        reviewedThroughCreatedAt: '2026-01-01T00:00:00Z',
        reviewedThroughId: 'entry-1',
      },
    });
  });

  it('exportAuditLogScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ csv: 'col1,col2', row_count: 10 });
    const result = await exportAuditLogScoped(TOKEN, { outcome: 'success' });
    expect(mockInvoke).toHaveBeenCalledWith('export_audit_log_scoped', {
      sessionToken: TOKEN,
      args: { outcome: 'success' },
    });
    expect(result.row_count).toBe(10);
  });

  it('getAuditReviewStatusScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ total: 100, reviewed: 50 });
    await getAuditReviewStatusScoped(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_audit_review_status_scoped', {
      sessionToken: TOKEN,
    });
  });
});
