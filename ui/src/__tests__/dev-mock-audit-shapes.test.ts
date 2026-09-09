// ── Dev-mock audit shapes (AUD-04 / AUD-09) ─────────────────────
//
// These handlers used to answer `''`, `null` and a fixed pair. verify-ipc-parity's
// dev_mock list cannot catch that class of lie at all: it asks whether a command
// HAS a handler, not whether the handler returns the shape the Rust command
// serializes. So the mock could pass the gate while a screen read a field that
// arrives undefined — which is worse than an absent handler, because an absent
// handler is what the gate warns about.
//
// Pinned against the real surface rather than against itself:
//   - apps/desktop-client/src/commands/audit.rs — AuditExportDto (:404) and its
//     header string (:453), MarkAuditReviewedArgs (camelCase via rename_all),
//     ReviewCheckpointDto / AuditReviewStatusDto (both snake_case, no rename_all);
//   - ui/src/api/audit.ts — the TS mirrors the screens actually consume.
//
// jsdom has no window.__TAURI_INTERNALS__, so invoke() routes to the mock — the
// same path a browser preview takes, including its `{ args }` unwrapping.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';
import type {
  AuditExportDto,
  AuditLogPageDto,
  AuditReviewStatusDto,
  ReviewCheckpointDto,
} from '@/api/audit';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const BOM = '\uFEFF';

describe('dev-mock audit handler shapes', () => {
  it('exports the AuditExportDto shape, not a bare string', async () => {
    const dto = await invoke<AuditExportDto>('export_audit_log_scoped', {
      sessionToken: 'mock-token',
      args: {},
    });
    // Exact key set: an extra or missing field is the failure mode here, so a
    // superset check would let a renamed field through.
    expect(Object.keys(dto).sort()).toEqual([
      'csv',
      'generated_at',
      'requested_by',
      'row_count',
    ]);
    expect(typeof dto.csv).toBe('string');
    expect(typeof dto.row_count).toBe('number');
    expect(typeof dto.requested_by).toBe('string');
    expect(Number.isNaN(Date.parse(dto.generated_at))).toBe(false);
  });

  it('writes the BOM and header column order the Rust command writes', async () => {
    const dto = await invoke<AuditExportDto>('export_audit_log_scoped', {
      sessionToken: 'mock-token',
      args: {},
    });
    expect(dto.csv.startsWith(BOM)).toBe(true);
    const [header] = dto.csv.slice(BOM.length).split('\n');
    // Order is part of the contract: a spreadsheet consumer maps by position.
    expect(header).toBe(
      'id,created_at,user_id,action,target_type,target_id,outcome,details',
    );
    const dataLines = dto.csv.slice(BOM.length).split('\n').filter((l) => l.length > 0);
    expect(dataLines.length - 1).toBe(dto.row_count);
  });

  it('honors the outcome and query filters through the invoke envelope', async () => {
    // The regression this file exists for. invoke() passes the handler
    // `args?.['args'] ?? args`, i.e. the UNWRAPPED payload; a handler that reads
    // `args.args` sees nothing and silently returns every row. Against an
    // unfiltered expectation that looks like a passing mock.
    const failures = await invoke<AuditExportDto>('export_audit_log_scoped', {
      sessionToken: 'mock-token',
      args: { outcome: 'failure' },
    });
    expect(failures.row_count).toBe(0);
    expect(failures.csv.endsWith('\n')).toBe(true);

    const searched = await invoke<AuditExportDto>('export_audit_log_scoped', {
      sessionToken: 'mock-token',
      args: { query: 'shift' },
    });
    expect(searched.row_count).toBe(1);
    expect(searched.csv).toContain('shift.opened');
    expect(searched.csv).not.toContain('sale.completed');
  });

  it('marks a review and returns the full ReviewCheckpointDto', async () => {
    const before = await invoke<AuditReviewStatusDto>('get_audit_review_status_scoped', {
      sessionToken: 'mock-token',
    });
    expect(before.checkpoint).toBeNull();
    expect(before.unreviewed_count).toBeGreaterThan(0);

    const cp = await invoke<ReviewCheckpointDto>('mark_audit_reviewed_scoped', {
      sessionToken: 'mock-token',
      args: {
        reviewedThroughCreatedAt: '2026-09-09T10:00:00.000Z',
        reviewedThroughId: 'audit-1',
      },
    });
    expect(Object.keys(cp).sort()).toEqual([
      'id',
      'reviewed_at',
      'reviewed_through_created_at',
      'reviewed_through_id',
      'reviewer_user_id',
      'store_id',
    ]);
    // The camelCase IN / snake_case OUT asymmetry is the real command's, so the
    // mock reproduces it rather than tidying it away.
    expect(cp.reviewed_through_created_at).toBe('2026-09-09T10:00:00.000Z');
    expect(cp.reviewed_through_id).toBe('audit-1');

    const after = await invoke<AuditReviewStatusDto>('get_audit_review_status_scoped', {
      sessionToken: 'mock-token',
    });
    expect(after.checkpoint?.id).toBe(cp.id);
    expect(after.unreviewed_count).toBe(0);
  });

  it('keeps the paged list and the export reading one seed', async () => {
    // Same obligation the real store carries: a count and a list that disagree is
    // how a preview shows an export of rows the screen never listed.
    const page = await invoke<AuditLogPageDto>('list_audit_log_scoped', {
      sessionToken: 'mock-token',
      args: {},
    });
    const dto = await invoke<AuditExportDto>('export_audit_log_scoped', {
      sessionToken: 'mock-token',
      args: {},
    });
    expect(Object.keys(page).sort()).toEqual(['has_more', 'items', 'total']);
    expect(dto.row_count).toBe(page.items.length);
    expect(page.total).toBe(page.items.length);
    for (const item of page.items) {
      expect(dto.csv).toContain(String(item.id));
    }
  });
});
