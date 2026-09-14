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
 * Measured before moving: DATA_TYPES label/description are English literals
 * rendered straight into the DOM (DataManagementScreen.tsx:582 / :585), NOT
 * Fluent ids — neither string occurs in any .ftl bundle. So the table carries no
 * bundle surface and the parity gate has nothing to see here. Those 12
 * hardcoded strings are a pre-existing localisation gap in an otherwise
 * localised screen; recorded, not fixed, since copy is not extraction work.
 */
export type DataType =
  | 'products'
  | 'categories'
  | 'sales'
  | 'customers'
  | 'users'
  | 'settings';

export const DATA_TYPES: { key: DataType; label: string; description: string }[] = [
  { key: 'products', label: 'Products', description: 'SKU, name, price, barcode, stock' },
  { key: 'categories', label: 'Categories', description: 'Category id, name, colour' },
  { key: 'sales', label: 'Sales', description: 'Sale header, line items, payments' },
  { key: 'customers', label: 'Customers', description: 'Name, email, phone, loyalty points' },
  { key: 'users', label: 'Users', description: 'Usernames, display names, roles (no passwords)' },
  { key: 'settings', label: 'Settings', description: 'Store config, receipts, feature flags' },
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
