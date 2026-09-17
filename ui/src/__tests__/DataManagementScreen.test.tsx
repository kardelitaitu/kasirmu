import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataManagementScreen from '@/features/settings/DataManagementScreen';

// ── Mocks ────────────────────────────────────────────────────────

const mockGetBackupStatus = vi.fn();
const mockCreateBackup = vi.fn();
const mockExportData = vi.fn();
const mockImportPreview = vi.fn();
const mockImportData = vi.fn();
const mockPickExportPath = vi.fn();
const mockPickImportFile = vi.fn();

vi.mock('@/api/data', () => ({
  getBackupStatus: () => mockGetBackupStatus(),
  createBackup: () => mockCreateBackup(),
  // See DataManagementBackup.test.tsx: the screen calls the scoped twins whenever a session
  // token is present, and a missing mock export fails every test in the file, not just scoped ones.
  getBackupStatusScoped: (token: string) => mockGetBackupStatus(token),
  createBackupScoped: (token: string) => mockCreateBackup(token),
  exportData: (args: unknown) => mockExportData(args),
  importPreview: (filePath: string, password: string) => mockImportPreview(filePath, password),
  importData: (filePath: string, password: string) => mockImportData(filePath, password),
  pickExportPath: () => mockPickExportPath(),
  pickImportFile: () => mockPickImportFile(),
}));

const mockAddToast = vi.fn();

vi.mock('@/frontend/shared/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: {
      getString: (id: string, args?: Record<string, unknown>) => {
        if (args) return `${id} ${JSON.stringify(args)}`;
        return id;
      },
    },
  }),
  Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/Card', () => ({
  Card: ({ children, shadow }: { children: React.ReactNode; shadow?: string }) => (
    <div data-testid="card" data-shadow={shadow}>{children}</div>
  ),
}));

vi.mock('@/components/Button', () => ({
  Button: ({
    children, onClick, variant, disabled, loading,
  }: {
    children: React.ReactNode; onClick?: () => void; variant?: string;
    disabled?: boolean; loading?: boolean;
  }) => (
    <button
      onClick={onClick}
      className={`btn btn--${variant ?? 'primary'}`}
      disabled={disabled || loading}
      data-loading={loading || undefined}
    >
      {children}
    </button>
  ),
}));

vi.mock('@/components/Spinner', () => ({
  Spinner: ({ size }: { size?: string }) => (
    <div data-testid="spinner" data-size={size}>Loading…</div>
  ),
}));

// ── Default API responses ─────────────────────────────────────────

const defaultBackupStatus = { lastBackup: null, lastBackupSize: null };
const defaultBackupResult = { path: '/backups/backup_2026.db', sizeBytes: 12_582_912 };
const defaultExportResult = { path: '/exports/export_2026.kasirpkg', sizeBytes: 524_288, types: ['products', 'categories'] };
const defaultImportPreviewResult = {
  storeName: 'Test Store', appVersion: '0.0.4',
  createdAt: new Date('2026-01-15').toISOString(),
  types: ['products', 'categories', 'sales'],
  productCount: 120, categoryCount: 12, saleCount: 500,
  customerCount: 50, userCount: 5, settingCount: 8,
};
const defaultImportDataResult = {
  productsImported: 120, categoriesImported: 12, salesImported: 500,
  customersImported: 50, usersImported: 5, settingsImported: 8,
};

// ── Helpers ───────────────────────────────────────────────────────

async function clickTab(label: string) {
  const user = userEvent.setup();
  const tabs = screen.getAllByRole('tab');
  const tab = tabs.find((t) => t.textContent?.includes(label));
  if (!tab) throw new Error(`Tab "${label}" not found`);
  await user.click(tab);
}

function expectAriaSelected(element: HTMLElement, value: boolean) {
  expect(element.getAttribute('aria-selected')).toBe(String(value));
}

// ── Tests ─────────────────────────────────────────────────────────

describe('DataManagementScreen', () => {
  beforeEach(() => {
    mockGetBackupStatus.mockResolvedValue(defaultBackupStatus);
    mockCreateBackup.mockResolvedValue(defaultBackupResult);
    mockExportData.mockResolvedValue(defaultExportResult);
    mockImportPreview.mockResolvedValue(defaultImportPreviewResult);
    mockImportData.mockResolvedValue(defaultImportDataResult);
    mockPickExportPath.mockResolvedValue('/exports/test.kasirpkg');
    mockPickImportFile.mockResolvedValue('/imports/test.kasirpkg');
    mockAddToast.mockReturnValue(undefined);
  });

  // ════════════════════════════════════════════════════════════════
  //  Rendering
  // ════════════════════════════════════════════════════════════════

  it('renders the Data Management title', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Data Management')).toBeInTheDocument();
    });
  });

  it('renders three tabs: Export, Import, Backup', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Export')).toBeInTheDocument();
      expect(screen.getByText('Import')).toBeInTheDocument();
      expect(screen.getByText('Backup')).toBeInTheDocument();
    });
  });

  it('sets Export as the default active tab', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => {
      const tabs = screen.getAllByRole('tab');
      const exportTab = tabs.find((t) => t.textContent?.includes('Export'))!;
      expectAriaSelected(exportTab, true);
    });
  });

  // ════════════════════════════════════════════════════════════════
  //  Tab navigation
  // ════════════════════════════════════════════════════════════════

  it('switches to Import tab when clicked', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Export')).toBeInTheDocument());
    await clickTab('Import');
    const tabs = screen.getAllByRole('tab');
    const importTab = tabs.find((t) => t.textContent?.includes('Import'))!;
    expectAriaSelected(importTab, true);
    expect(screen.getByText('Select a backup file')).toBeInTheDocument();
  });

  it('switches to Backup tab when clicked', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Backup')).toBeInTheDocument());
    await clickTab('Backup');
    const tabs = screen.getAllByRole('tab');
    const backupTab = tabs.find((t) => t.textContent?.includes('Backup'))!;
    expectAriaSelected(backupTab, true);
    expect(screen.getByText('Database backup')).toBeInTheDocument();
  });

  it('deselects previous tab when switching', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await clickTab('Backup');
    const tabs = screen.getAllByRole('tab');
    expectAriaSelected(tabs.find((t) => t.textContent?.includes('Export'))!, false);
    expectAriaSelected(tabs.find((t) => t.textContent?.includes('Import'))!, false);
    expectAriaSelected(tabs.find((t) => t.textContent?.includes('Backup'))!, true);
  });

  // ════════════════════════════════════════════════════════════════
  //  Edge cases
  // ════════════════════════════════════════════════════════════════

  it('loads backup status on mount', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => expect(mockGetBackupStatus).toHaveBeenCalled());
  });

  it('export step persists date range values', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByLabelText('From')).toBeInTheDocument());
    const fromInput = screen.getByLabelText('From') as HTMLInputElement;
    const toInput = screen.getByLabelText('To') as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: '2026-01-01' } });
    fireEvent.change(toInput, { target: { value: '2026-06-30' } });
    expect(fromInput.value).toBe('2026-01-01');
    expect(toInput.value).toBe('2026-06-30');
  });

  it('import preview shows file metadata correctly', async () => {
    const user = userEvent.setup();
    mockImportPreview.mockResolvedValue({ ...defaultImportPreviewResult, types: ['products', 'sales'] });
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => expect(screen.getByText('Analyse backup file')).toBeInTheDocument());
    const pwInput = screen.getByLabelText('Decryption password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    await user.click(screen.getByText('Analyse file'));
    await waitFor(() => {
      expect(screen.getByText('Preview import')).toBeInTheDocument();
      expect(screen.getByText('products, sales')).toBeInTheDocument();
    });
  });

  it('import metadata uses unknown error message on non-Error objects', async () => {
    const user = userEvent.setup();
    mockImportPreview.mockRejectedValue('Something went wrong');
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => expect(screen.getByText('Analyse backup file')).toBeInTheDocument());
    const pwInput = screen.getByLabelText('Decryption password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    await user.click(screen.getByText('Analyse file'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('data-mgmt-toast-import-fail')).toBeInTheDocument();
    });
  });
});
