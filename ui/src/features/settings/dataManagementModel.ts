/**
 * dataManagementModel — the pure data behind the Data management screen: the
 * DataType union, the DATA_TYPES checklist table, and the three wizard states
 * with their initial values.
 *
 * Moved verbatim out of DataManagementScreen.tsx by DataManagement lane slice 1
 * (types were :37-43, the table :62-69, the state interfaces :71-98, the initial
 * values :100-123). Nothing here renders, imports React, calls the api layer or
 * reads a Fluent bundle, so the screen's data rules can be tested without
 * mounting it — the shape of kds/kdsSettingsModel.ts.
 *
 * The icon helpers did NOT come along: eyeIcon/eyeOffIcon (:47-60) and
 * ICON_PROPS/tabIcon/folderIcon/checkIcon (:127-146) return JSX, and JSX cannot
 * live in a .ts file. They need a .tsx sibling, which is outside this slice.
 *
 * SUPERSEDED paragraph, kept honest: when this table moved (slice 1) it held 12
 * English literals rendered raw by the screen, and measurement said the parity gate
 * had nothing to see — true, because nothing here named a key. A later pass found
 * WHY that was odd: all 12 keys already exist, reviewed and translated in BOTH
 * bundles (settings.ftl :583-594, settings.id.ftl :487-498 — Produk, Kategori,
 * Penjualan, Pelanggan, Pengguna, Pengaturan plus six Indonesian descriptions), and
 * dynamicFluentFamilies.test.ts already enumerates the family as if the screen
 * resolved it. So the code was ignoring shipped copy. The table now carries
 * labelId/descriptionId and NO display text: the .ftl files are the only source for
 * these strings, there is no labelFallback left to drift out of sync with them, and
 * no English was duplicated or invented — the id side needed no edits at all.
 */
export type DataType =
  | 'products'
  | 'categories'
  | 'sales'
  | 'customers'
  | 'users'
  | 'settings';

export const DATA_TYPES: { key: DataType; labelId: string; descriptionId: string }[] = [
  { key: 'products', labelId: 'data-mgmt-type-products', descriptionId: 'data-mgmt-type-products-desc' },
  { key: 'categories', labelId: 'data-mgmt-type-categories', descriptionId: 'data-mgmt-type-categories-desc' },
  { key: 'sales', labelId: 'data-mgmt-type-sales', descriptionId: 'data-mgmt-type-sales-desc' },
  { key: 'customers', labelId: 'data-mgmt-type-customers', descriptionId: 'data-mgmt-type-customers-desc' },
  { key: 'users', labelId: 'data-mgmt-type-users', descriptionId: 'data-mgmt-type-users-desc' },
  { key: 'settings', labelId: 'data-mgmt-type-settings', descriptionId: 'data-mgmt-type-settings-desc' },
];

export interface ExportState {
  selectedTypes: Set<DataType>;
  dateFrom: string;
  dateTo: string;
  password: string;
  passwordConfirm: string;
  step: 'select' | 'encrypt' | 'exporting' | 'done';
  progress: number;
  outputFile: string | null;
  error: string | null;
}

export interface ImportState {
  selectedFile: string | null;
  metadata: { name: string; version: string; types: string[]; created: string } | null;
  password: string;
  step: 'select' | 'analysing' | 'preview' | 'importing' | 'done';
  analysing: boolean;
  progress: number;
  error: string | null;
  dryRun: { added: number; updated: number; skipped: number } | null;
}

export interface BackupInfo {
  lastBackup: string | null;
  lastBackupSize: string | null | undefined;
  backingUp: boolean;
}

// ── Initial state ──────────────────────────────────────────────────

export const INITIAL_EXPORT: ExportState = {
  selectedTypes: new Set(DATA_TYPES.map((t) => t.key)),
  dateFrom: '',
  dateTo: '',
  password: '',
  passwordConfirm: '',
  step: 'select',
  progress: 0,
  outputFile: null,
  error: null,
};

export const INITIAL_IMPORT: ImportState = {
  selectedFile: null,
  metadata: null,
  password: '',
  step: 'select',
  analysing: false,
  progress: 0,
  error: null,
  dryRun: null,
};
