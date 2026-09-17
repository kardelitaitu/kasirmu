import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataManagementScreen from '@/features/settings/DataManagementScreen';

// ── Shared mocks ─────────────────────────────────────────────────

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
  // DataManagementScreen routes through these whenever a session token is present (the harness
  // supplies one), and a missing mock export is a hard error that fails every test in the file
  // rather than only the scoped ones. See DataManagementBackup.test.tsx for the full rationale.
  getBackupStatusScoped: (token: string) => mockGetBackupStatus(token),
  createBackupScoped: (token: string) => mockCreateBackup(token),
  exportData: (args: unknown) => mockExportData(args),
  importPreview: (filePath: string, password: string) => mockImportPreview(filePath, password),
  importData: (filePath: string, password: string) => mockImportData(filePath, password),
  pickExportPath: () => mockPickExportPath(),
  pickImportFile: () => mockPickImportFile(),
}));

const mockAddToast = vi.fn();

vi.mock('@/components/Toast', () => ({
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
  Button: ({ children, onClick, variant, disabled, loading }: {
    children: React.ReactNode; onClick?: () => void; variant?: string;
    disabled?: boolean; loading?: boolean;
  }) => (
    <button onClick={onClick} className={`btn btn--${variant ?? 'primary'}`}
      disabled={disabled || loading} data-loading={loading || undefined}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/Spinner', () => ({
  Spinner: ({ size }: { size?: string }) => (
    <div data-testid="spinner" data-size={size}>Loading…</div>
  ),
}));

// ── Default API responses ────────────────────────────────────────

const defaultBackupStatus = { lastBackup: null, lastBackupSize: null };
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

beforeEach(() => {
  mockGetBackupStatus.mockResolvedValue(defaultBackupStatus);
  mockCreateBackup.mockResolvedValue({ path: '/backups/backup_2026.db', sizeBytes: 12_582_912 });
  mockExportData.mockResolvedValue({ path: '/exports/export_2026.kasirpkg', sizeBytes: 524_288, types: [] });
  mockImportPreview.mockResolvedValue(defaultImportPreviewResult);
  mockImportData.mockResolvedValue(defaultImportDataResult);
  mockPickExportPath.mockResolvedValue('/exports/test.kasirpkg');
  mockPickImportFile.mockResolvedValue('/imports/test.kasirpkg');
  mockAddToast.mockReturnValue(undefined);
});

// ── Helpers ──────────────────────────────────────────────────────

async function clickTab(label: string) {
  const user = userEvent.setup();
  const tabs = screen.getAllByRole('tab');
  const tab = tabs.find((t) => t.textContent?.includes(label));
  if (!tab) throw new Error(`Tab "${label}" not found`);
  await user.click(tab);
}

async function confirmImportDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Confirm'));
}

describe('DataManagement — Import', () => {
  // ═══════════════════════════════════════════════════════════════
  // Import wizard — file selection
  // ═══════════════════════════════════════════════════════════════

  it('renders "Browse files…" button in import tab', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    expect(screen.getByText('Browse files…')).toBeInTheDocument();
  });

  it('calls pickImportFile when "Browse files…" is clicked', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    expect(mockPickImportFile).toHaveBeenCalled();
  });

  it('moves to analysing step when a file is selected', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => {
      expect(screen.getByText('Analyse backup file')).toBeInTheDocument();
      expect(screen.getByText('/imports/test.kasirpkg')).toBeInTheDocument();
    });
  });

  it('does nothing when file picker returns null', async () => {
    const user = userEvent.setup();
    mockPickImportFile.mockResolvedValue(null);
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    expect(screen.getByText('Select a backup file')).toBeInTheDocument();
  });

  it('shows error toast when file picker throws', async () => {
    const user = userEvent.setup();
    mockPickImportFile.mockRejectedValue(new Error('Permission denied'));
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'data-mgmt-toast-file-picker-fail', type: 'error' }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Import wizard — analysis
  // ═══════════════════════════════════════════════════════════════

  it('disables "Analyse file" button when password is empty', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => {
      const analyseBtn = screen.getByText('Analyse file').closest('button')!;
      expect(analyseBtn).toBeDisabled();
    });
  });

  it('enables "Analyse file" button when password is entered', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => {
      expect(screen.getByText('Analyse backup file')).toBeInTheDocument();
    });
    const pwInput = screen.getByLabelText('Decryption password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    const analyseBtn = screen.getByText('Analyse file').closest('button')!;
    expect(analyseBtn).not.toBeDisabled();
  });

  it('cancel returns to file selection from analyse step', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => {
      expect(screen.getByText('Analyse backup file')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Cancel'));
    expect(screen.getByText('Select a backup file')).toBeInTheDocument();
  });

  it('shows preview with metadata on successful analysis', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => {
      expect(screen.getByText('Analyse backup file')).toBeInTheDocument();
    });
    const pwInput = screen.getByLabelText('Decryption password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    await user.click(screen.getByText('Analyse file'));
    await waitFor(() => {
      expect(screen.getByText('Preview import')).toBeInTheDocument();
      expect(screen.getByText('Test Store')).toBeInTheDocument();
      expect(screen.getByText('0.0.4')).toBeInTheDocument();
    });
  });

  it('shows error on analysis failure', async () => {
    const user = userEvent.setup();
    mockImportPreview.mockRejectedValue(new Error('Wrong password'));
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => {
      expect(screen.getByText('Analyse backup file')).toBeInTheDocument();
    });
    const pwInput = screen.getByLabelText('Decryption password') as HTMLInputElement;
    await user.type(pwInput, 'wrongpwd');
    await user.click(screen.getByText('Analyse file'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('data-mgmt-toast-import-fail')).toBeInTheDocument();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Import wizard — import execution
  // ═══════════════════════════════════════════════════════════════

  it('renders "Start import" button in preview step', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => expect(screen.getByText('Analyse backup file')).toBeInTheDocument());
    const pwInput = screen.getByLabelText('Decryption password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    await user.click(screen.getByText('Analyse file'));
    await waitFor(() => expect(screen.getByText('Start import')).toBeInTheDocument());
  });

  it('shows importing state and spinner after clicking "Start import"', async () => {
    const user = userEvent.setup();
    mockImportData.mockReturnValue(new Promise(() => {}));
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => expect(screen.getByText('Analyse backup file')).toBeInTheDocument());
    const pwInput = screen.getByLabelText('Decryption password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    await user.click(screen.getByText('Analyse file'));
    await waitFor(() => expect(screen.getByText('Start import')).toBeInTheDocument());
    await user.click(screen.getByText('Start import'));
    await confirmImportDialog(user);
    await waitFor(() => expect(screen.getByTestId('spinner')).toBeInTheDocument());
  });

  it('shows "Import complete" on import success', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => expect(screen.getByText('Analyse backup file')).toBeInTheDocument());
    const pwInput = screen.getByLabelText('Decryption password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    await user.click(screen.getByText('Analyse file'));
    await waitFor(() => expect(screen.getByText('Start import')).toBeInTheDocument());
    await user.click(screen.getByText('Start import'));
    await confirmImportDialog(user);
    await waitFor(() => expect(screen.getByText('Import complete')).toBeInTheDocument());
  });

  it('shows success toast on import completion', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => expect(screen.getByText('Analyse backup file')).toBeInTheDocument());
    const pwInput = screen.getByLabelText('Decryption password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    await user.click(screen.getByText('Analyse file'));
    await waitFor(() => expect(screen.getByText('Start import')).toBeInTheDocument());
    await user.click(screen.getByText('Start import'));
    await confirmImportDialog(user);
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'data-mgmt-toast-import-success', type: 'success' }),
      );
    });
  });

  it('shows error toast on import failure', async () => {
    const user = userEvent.setup();
    mockImportData.mockRejectedValue(new Error('Disk full'));
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => expect(screen.getByText('Analyse backup file')).toBeInTheDocument());
    const pwInput = screen.getByLabelText('Decryption password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    await user.click(screen.getByText('Analyse file'));
    await waitFor(() => expect(screen.getByText('Start import')).toBeInTheDocument());
    await user.click(screen.getByText('Start import'));
    await confirmImportDialog(user);
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'data-mgmt-toast-import-fail', type: 'error' }),
      );
    });
    expect(screen.getByText('Preview import')).toBeInTheDocument();
  });

  it('resets import state when "New import" is clicked after completion', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Import')).toBeInTheDocument());
    await clickTab('Import');
    await user.click(screen.getByText('Browse files…'));
    await waitFor(() => expect(screen.getByText('Analyse backup file')).toBeInTheDocument());
    const pwInput = screen.getByLabelText('Decryption password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    await user.click(screen.getByText('Analyse file'));
    await waitFor(() => expect(screen.getByText('Start import')).toBeInTheDocument());
    await user.click(screen.getByText('Start import'));
    await confirmImportDialog(user);
    await waitFor(() => expect(screen.getByText('New import')).toBeInTheDocument());
    await user.click(screen.getByText('New import'));
    await waitFor(() => expect(screen.getByText('Select a backup file')).toBeInTheDocument());
  });
});
