// ── Data Management IPC: backup, export/import .kasirpkg ──────────

import { loggedInvoke } from '@/utils/logged-invoke';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  cachePathFor,
  copyCacheToUri,
  copyUriToCache,
  isContentUri,
} from '@/api/file-bridge';

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
//
// Both pickers return a string that the callers pass straight to Rust as a
// path, and a `content://` URI is not one. So each of them bridges what the
// dialog gave it (see `@/api/file-bridge` for the mechanism and for the
// scope asymmetry that makes a cache path need an `fs:scope` entry while a URI
// does not). The bridge changes what the string *is*, never its type — no
// caller in `features/settings/` learns that Android has two kinds of file.
//
// Each stem below is mirrored by an `$APPCACHE/` allow-pattern in
// `apps/mobile-tauri/capabilities/mobile.json`.

/** Leading part of the export's cache filename. Mirrored by `$APPCACHE/export-*`. */
const EXPORT_STEM = 'export-';

/** Leading part of the import's cache filename. Mirrored by `$APPCACHE/import-*`. */
const IMPORT_STEM = 'import-';

/** Extension of a `.kasirpkg` package, on both sides of the bridge. */
const PACKAGE_EXTENSION = '.kasirpkg';

/**
 * Where the user's chosen export destination is, while the export is in flight.
 *
 * The outbound bridge needs two values but `exportData` only receives one:
 * Rust can write to a cache path and cannot write to a URI, so the command is
 * handed the cache path and the URI the user actually picked has to survive
 * until the bytes exist. A single slot, overwritten by the next pick and
 * cleared by the export that consumes it — not a registry, because only one
 * export can be in flight (`useExportWizard` guards with `exportingRef`).
 */
let pendingExport: { cachePath: string; destination: string } | null = null;

/**
 * Open a save dialog to choose an export destination.
 *
 * Returns a path `export_data` can write to — which on Android is a cache path,
 * not the destination the user chose. The real destination is carried by
 * `pendingExport` and applied by `exportData`, so the caller's contract is
 * unchanged: hand back what this returned.
 *
 * Returns `null` when the user dismissed the dialog, on both shells.
 */
export const pickExportPath = async (): Promise<string | null> => {
  const chosen = await save({
    defaultPath: `kasir_export_${new Date().toISOString().slice(0, 10)}.kasirpkg`,
    filters: [{ name: 'kasir.mu Package', extensions: ['kasirpkg', 'ozpkg'] }],
  });
  if (!chosen) return null;

  // Desktop: the chosen value is already a writable path.
  if (!isContentUri(chosen)) {
    pendingExport = null;
    return chosen;
  }

  const cachePath = await cachePathFor(EXPORT_STEM, PACKAGE_EXTENSION);
  pendingExport = { cachePath, destination: chosen };
  return cachePath;
};

/**
 * Open a file picker to select an `.kasirpkg` import file.
 *
 * On Android the picked URI is copied into the app cache and the copy's path is
 * returned, because `import_preview` and `import_data` read the file with
 * `tokio::fs` and a URI is not openable that way.
 *
 * The copy is deliberately **not** deleted afterwards. It is read twice — once
 * to preview, once to import — with a password prompt and a confirm dialog in
 * between, so it has to outlive this call, and there is no point in the flow
 * where every consumer is known to be finished. Android reclaims the app cache
 * on its own; a package left there costs disk the OS was going to take back
 * anyway. (Contrast the image pickers, whose single ingest call is followed by
 * an explicit `release`.) What is shown to the operator as the selected file is
 * this path, which is the same kind of absolute path desktop already showed.
 *
 * Returns `null` when the user dismissed the dialog, on both shells.
 */
export const pickImportFile = async (): Promise<string | null> => {
  const picked = await open({
    filters: [{ name: 'kasir.mu Package', extensions: ['kasirpkg', 'ozpkg'] }],
    multiple: false,
  });
  if (!picked) return null;

  const source = Array.isArray(picked) ? picked[0] : picked;
  if (!source) return null;

  if (!isContentUri(source)) return source;

  const bridged = await copyUriToCache(source, IMPORT_STEM, PACKAGE_EXTENSION);
  return bridged.path;
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

/**
 * Export store data to an encrypted .kasirpkg file.
 *
 * `args.outputPath` must be what `pickExportPath` returned. On Android that is
 * a cache path, so once the command has written it the bytes still have to
 * reach the destination the user actually chose — `copyCacheToUri` moves them
 * and drops the cache copy.
 *
 * `result.path` is reported as the user's destination rather than the cache
 * path, because the cache copy is gone by the time the caller shows it, and
 * "Data exported to:" pointing at a deleted temp file is worse than pointing at
 * the URI the user picked.
 */
export const exportData = async (
  sessionToken: string,
  args: ExportDataArgs,
): Promise<ExportDataResult> => {
  const result = await loggedInvoke<ExportDataResult>('export_data', {
    sessionToken,
    args,
  });

  const pending = pendingExport;
  if (!pending || pending.cachePath !== args.outputPath) return result;

  pendingExport = null;
  await copyCacheToUri(pending.cachePath, pending.destination);
  return { ...result, path: pending.destination };
};

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
