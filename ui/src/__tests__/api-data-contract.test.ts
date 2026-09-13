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

  // The two cases below pin the GATED names. get_backup_status_scoped and
  // create_backup_scoped enforce permissions::DATA_EXPORT in Rust (added at
  // 62e30fd7 for F-017, registered in apps/desktop-client/src/lib.rs:844 and :846);
  // the unscoped commands check nothing, so a session without the data-export right
  // can still reach them. These assertions are what keeps the gated path from being
  // abandoned again by the next refactor.
  it('getBackupStatusScoped calls the gated command and passes the token', async () => {
    mockInvoke.mockResolvedValue({ lastBackup: null });
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
  // string, and from frontend/shell/UpdateBanner.tsx, which has no token at all.
  // Deleting these two cases would hide that, not fix it.
  it('getBackupStatus still calls the UNGATED command (known bypass, see report)', async () => {
    mockInvoke.mockResolvedValue({ lastBackup: null });
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
