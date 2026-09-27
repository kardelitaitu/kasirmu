import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  createBackup,
  createBackupScoped,
  getBackupStatus,
  getBackupStatusScoped,
  exportData,
  importPreview,
  importData,
} from '@/api/data';

describe('data.ts API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Wire-key pinning for the data-management RETURN DTOs ──────────────
  //
  // The Rust DTOs (`BackupStatus`, `BackupResult`, `ExportDataResult`,
  // `ImportPreviewResult`, `ImportDataResult`) derive `Serialize` with NO
  // `rename_all`, so the IPC keys are snake_case. This whole suite used to
  // mock camelCase returns and the dev-mock agreed with them, so the UI read
  // `undefined` for every field on a REAL desktop with nothing able to notice:
  // `useBackupStatus` produced a status whose `lastBackup` was undefined, and
  // `BackupSection` renders that as the load-FAILURE string — a wrong
  // compliance claim on the Data screen. These cases pin the real keys.
  it('get_backup_status returns snake_case keys and the hook maps them', async () => {
    mockInvoke.mockResolvedValue({ last_backup: '2026-07-13 14:30:00', last_backup_size: '12.0 MB' });
    const status = await getBackupStatus();
    // The DTO must keep the wire's spelling — renaming it here is the bug.
    expect(status.last_backup).toBe('2026-07-13 14:30:00');
    expect(status.last_backup_size).toBe('12.0 MB');
    expect(status).not.toHaveProperty('lastBackup');
  });

  it('create_backup returns size_bytes, not sizeBytes', async () => {
    mockInvoke.mockResolvedValue({ path: '/backups/db.db', size_bytes: 1024 });
    const result = await createBackup();
    expect(result.size_bytes).toBe(1024);
    expect(result).not.toHaveProperty('sizeBytes');
  });

  it('import_preview returns snake_case counts', async () => {
    mockInvoke.mockResolvedValue({
      store_name: 'Test Store',
      app_version: '0.0.40',
      created_at: '2026-07-13T00:00:00Z',
      types: ['products'],
      product_count: 120,
      category_count: 12,
      sale_count: 500,
      customer_count: null,
      user_count: null,
      setting_count: null,
    });
    const preview = await importPreview('tok', '/path/to/file.kasirpkg', 'pass');
    expect(preview.store_name).toBe('Test Store');
    expect(preview.product_count).toBe(120);
    expect(preview).not.toHaveProperty('storeName');
    expect(preview).not.toHaveProperty('productCount');
  });

  // The two cases below pin the GATED names. get_backup_status_scoped and
  // create_backup_scoped enforce permissions::DATA_EXPORT in Rust (added at
  // 62e30fd7 for F-017, registered in apps/desktop-tauri/src/lib.rs:844 and :846);
  // the unscoped commands check nothing, so a session without the data-export right
  // can still reach them. These assertions are what keeps the gated path from being
  // abandoned again by the next refactor.
  it('getBackupStatusScoped calls the gated command and passes the token', async () => {
    mockInvoke.mockResolvedValue({ last_backup: null, last_backup_size: null });
    await getBackupStatusScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('get_backup_status_scoped', { sessionToken: 'tok' });
  });

  it('createBackupScoped calls the gated command and passes the token', async () => {
    mockInvoke.mockResolvedValue({ path: '/backups/db.db' });
    const result = await createBackupScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('create_backup_scoped', { sessionToken: 'tok' });
    expect(result.path).toBe('/backups/db.db');
  });

  // And this records the hole rather than endorsing it: the unscoped wrappers are
  // still exported and still reached from the renderer — from
  // features/settings/DataManagementScreen.tsx whenever sessionToken is the empty
  // string, and from app/UpdateBanner.tsx, which has no token at all.
  // Deleting these two cases would hide that, not fix it.
  it('getBackupStatus still calls the UNGATED command (known bypass, see report)', async () => {
    mockInvoke.mockResolvedValue({ last_backup: null });
    await getBackupStatus();
    expect(mockInvoke).toHaveBeenCalledWith('get_backup_status');
  });

  it('createBackup still calls the UNGATED command (known bypass, see report)', async () => {
    mockInvoke.mockResolvedValue({ path: '/backups/db.db' });
    const result = await createBackup();
    expect(mockInvoke).toHaveBeenCalledWith('create_backup');
    expect(result.path).toBe('/backups/db.db');
  });

  it('exportData calls correct command', async () => {
    const args = { types: ['products'], password: 'secret', outputPath: '/tmp/export.csv' };
    mockInvoke.mockResolvedValue({ rows: 10 });
    await exportData('tok', args);
    expect(mockInvoke).toHaveBeenCalledWith('export_data', { sessionToken: 'tok', args });
  });

  it('importPreview calls correct command', async () => {
    mockInvoke.mockResolvedValue({ rows: [], errors: [] });
    await importPreview('tok', '/path/to/file.csv', 'pass');
    expect(mockInvoke).toHaveBeenCalledWith('import_preview', { sessionToken: 'tok', args: { file_path: '/path/to/file.csv', password: 'pass' } });
  });

  it('importData calls correct command', async () => {
    mockInvoke.mockResolvedValue({ imported: 5 });
    await importData('tok', '/path/to/file.csv', 'pass');
    expect(mockInvoke).toHaveBeenCalledWith('import_data', { sessionToken: 'tok', args: { file_path: '/path/to/file.csv', password: 'pass' } });
  });

  it('propagates errors', async () => {
    mockInvoke.mockRejectedValue(new Error('backup failed'));
    await expect(createBackup()).rejects.toThrow('backup failed');
  });
});
