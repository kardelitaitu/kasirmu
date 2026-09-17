// ── Data Management IPC: backup, export/import .kasirpkg ──────────

import { loggedInvoke } from '@/utils/logged-invoke';
import { open, save } from '@tauri-apps/plugin-dialog';

// ── Types ─────────────────────────────────────────────────────

/** Current backup status information. */
export interface BackupStatus {
  lastBackup: string | null;
  lastBackupSize: string | null;
  // dbPath intentionally removed — M-7: never expose filesystem path in unauth'd DTO.
}

/** Result of a backup operation. */
export interface BackupResult {
  path: string;
  sizeBytes: number;
}

/** Arguments for exporting store data to an .kasirpkg file. */
export interface ExportDataArgs {
  types: string[];
  password: string;
  outputPath: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Result of a data export operation. */
export interface ExportDataResult {
  path: string;
  sizeBytes: number;
  types: string[];
}

/** Preview of an .kasirpkg import file before actually importing. */
export interface ImportPreviewResult {
  storeName: string;
  appVersion: string;
  createdAt: string;
  types: string[];
  productCount: number;
  categoryCount: number;
  saleCount: number | null;
  customerCount: number | null;
  userCount: number | null;
  settingCount: number | null;
}

/** Result of an import operation with per-type counts. */
export interface ImportDataResult {
  productsImported: number;
  categoriesImported: number;
  salesImported: number;
  customersImported: number;
  usersImported: number;
  settingsImported: number;
}

// ── File dialog helpers ───────────────────────────────────────

/** Open a save dialog to choose an export file path. Returns the chosen path or null. */
export const pickExportPath = async (): Promise<string | null> => {
  const path = await save({
    defaultPath: `kasir_export_${new Date().toISOString().slice(0, 10)}.kasirpkg`,
    filters: [{ name: 'kasir.mu Package', extensions: ['kasirpkg', 'ozpkg'] }],
  });
  return path;
};

/** Open a file picker dialog to select an .kasirpkg import file. Returns the chosen path or null. */
export const pickImportFile = async (): Promise<string | null> => {
  const path = await open({
    filters: [{ name: 'kasir.mu Package', extensions: ['kasirpkg', 'ozpkg'] }],
    multiple: false,
  });
  return path;
};

// ── IPC calls ─────────────────────────────────────────────────

/** Get the current backup status. */
export const getBackupStatus = (): Promise<BackupStatus> =>
  loggedInvoke<BackupStatus>('get_backup_status');

/**
 * Session-scoped variant of [`getBackupStatus`].
 *
 * The Rust command `get_backup_status_scoped` was added in 62e30fd7 as an F-017 security-audit
 * item and enforces `permissions::DATA_EXPORT` before delegating to the unscoped handler. It was
 * registered in lib.rs:564 and documented in api-reference.md:96, but nothing in ui/src ever
 * called it -- so the audit item was recorded complete while every UI path still used the
 * unchecked command. Same for `createBackupScoped` below.
 */
export const getBackupStatusScoped = (sessionToken: string): Promise<BackupStatus> =>
  loggedInvoke<BackupStatus>('get_backup_status_scoped', { sessionToken });

/** Create a new database backup. */
export const createBackup = (): Promise<BackupResult> =>
  loggedInvoke<BackupResult>('create_backup');

/**
 * Session-scoped variant of [`createBackup`], enforcing `permissions::DATA_EXPORT`.
 *
 * Without it any session -- including one with no data-export right -- can write a full copy of
 * the database to disk, because the unscoped `create_backup` takes no session token at all.
 */
export const createBackupScoped = (sessionToken: string): Promise<BackupResult> =>
  loggedInvoke<BackupResult>('create_backup_scoped', { sessionToken });

/** Export store data to an encrypted .kasirpkg file. */
export const exportData = (
  sessionToken: string,
  args: ExportDataArgs,
): Promise<ExportDataResult> =>
  loggedInvoke<ExportDataResult>('export_data', {
    sessionToken,
    args,
  });

/** Preview an .kasirpkg import file to see its contents before importing. */
export const importPreview = (
  sessionToken: string,
  filePath: string,
  password: string,
): Promise<ImportPreviewResult> =>
  loggedInvoke<ImportPreviewResult>('import_preview', {
    sessionToken,
    args: { file_path: filePath, password },
  });

/** Import data from an encrypted .kasirpkg file. */
export const importData = (
  sessionToken: string,
  filePath: string,
  password: string,
): Promise<ImportDataResult> =>
  loggedInvoke<ImportDataResult>('import_data', {
    sessionToken,
    args: { file_path: filePath, password },
  });
