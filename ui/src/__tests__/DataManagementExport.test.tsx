import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataManagementScreen from '@/features/settings/DataManagementScreen';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import type * as SubscriptionContextModule from '@/contexts/SubscriptionContext';

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
  // See DataManagementBackup.test.tsx for why both twins must be exported: the screen calls
  // them whenever a session token is present, and a missing mock export is a hard error that
  // takes down every test in the file, not just the scoped ones.
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

// §B gate: defaults OPEN for the regular screen tests; the gate test
// overrides per-test. AdminLockedFeature strings resolve through the
// @fluent/react mock below (mockStrings entry).
vi.mock('@/contexts/SubscriptionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof SubscriptionContextModule>();
  return {
    ...actual,
    useAdminGate: vi.fn().mockReturnValue({ locked: false, state: 'active' }),
  };
});
const adminGate = vi.mocked(useAdminGate);

vi.mock('@fluent/react', () => {
  const mockStrings: Record<string, string> = {
    'admin-locked-title': 'Administrative features locked',
    'data-mgmt-export-select-all': 'Select all / none',
    'data-mgmt-type-products': 'Products',
    'data-mgmt-type-categories': 'Categories',
    'data-mgmt-type-sales': 'Sales',
    'data-mgmt-type-customers': 'Customers',
    'data-mgmt-type-users': 'Users',
    'data-mgmt-type-settings': 'Settings',
  };
  return {
    useLocalization: () => ({
      l10n: {
        getString: (id: string, args?: Record<string, unknown>) => {
          if (args) return `${id} ${JSON.stringify(args)}`;
          return mockStrings[id] ?? id;
        },
      },
    }),
    Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
  };
});

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
const defaultExportResult = { path: '/exports/export_2026.kasirpkg', sizeBytes: 524_288, types: ['products', 'categories'] };

beforeEach(() => {
  mockGetBackupStatus.mockResolvedValue(defaultBackupStatus);
  mockCreateBackup.mockResolvedValue({ path: '/backups/backup_2026.db', sizeBytes: 12_582_912 });
  mockExportData.mockResolvedValue(defaultExportResult);
  mockImportPreview.mockResolvedValue({
    storeName: 'Test Store', appVersion: '0.0.4',
    createdAt: new Date('2026-01-15').toISOString(),
    types: ['products', 'categories', 'sales'],
    productCount: 120, categoryCount: 12, saleCount: 500,
    customerCount: 50, userCount: 5, settingCount: 8,
  });
  mockImportData.mockResolvedValue({
    productsImported: 120, categoriesImported: 12, salesImported: 500,
    customersImported: 50, usersImported: 5, settingsImported: 8,
  });
  mockPickExportPath.mockResolvedValue('/exports/test.kasirpkg');
  mockPickImportFile.mockResolvedValue('/imports/test.kasirpkg');
  mockAddToast.mockReturnValue(undefined);
});

// ── Helpers ──────────────────────────────────────────────────────

describe('DataManagementScreen §B administrative gate', () => {
  afterEach(() => {
    adminGate.mockReturnValue({ locked: false, state: 'active' });
  });

  it('locks the screen while the subscription is not active (grace)', () => {
    // §B: Data Management is an administrative SaaS feature — it locks at
    // expiresAt (grace onward) while operational POS runtime continues.
    adminGate.mockReturnValue({ locked: true, state: 'grace' });
    render(<DataManagementScreen />);
    expect(screen.getByText('Administrative features locked')).toBeInTheDocument();
    // The export surface must not render behind the lock.
    expect(screen.queryByText('Select all / none')).not.toBeInTheDocument();
  });
});

describe('DataManagement — Export', () => {
  // ═══════════════════════════════════════════════════════════════
  // Export wizard — type selection
  // ═══════════════════════════════════════════════════════════════

  it('renders export type checkboxes (all 6)', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Products')).toBeInTheDocument();
      expect(screen.getByText('Categories')).toBeInTheDocument();
      expect(screen.getByText('Sales')).toBeInTheDocument();
      expect(screen.getByText('Customers')).toBeInTheDocument();
      expect(screen.getByText('Users')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  it('renders "Select all / none" checkbox', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Select all / none')).toBeInTheDocument();
    });
  });

  it('all types are selected by default', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox');
      const typeCheckboxes = checkboxes.filter((cb) =>
        (cb as HTMLInputElement).id.startsWith('type-'),
      );
      expect(typeCheckboxes).toHaveLength(7);
      typeCheckboxes
        .filter((cb) => cb.id !== 'type-select-all')
        .forEach((cb) => {
          expect((cb as HTMLInputElement).checked).toBe(true);
        });
    });
  });

  it('"Select all / none" checkbox is checked when all types are selected', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => {
      const selectAll = screen.getByLabelText('Select all / none') as HTMLInputElement;
      expect(selectAll.checked).toBe(true);
    });
  });

  it('clicking "Select all / none" deselects all types', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByLabelText('Select all / none')).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText('Select all / none'));
    const checkboxes = screen.getAllByRole('checkbox');
    const typeCheckboxes = checkboxes.filter((cb) =>
      (cb as HTMLInputElement).id.startsWith('type-') && cb.id !== 'type-select-all',
    );
    typeCheckboxes.forEach((cb) => {
      expect((cb as HTMLInputElement).checked).toBe(false);
    });
  });

  it('clicking "Select all / none" twice reselects all types', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByLabelText('Select all / none')).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText('Select all / none'));
    await user.click(screen.getByLabelText('Select all / none'));
    const checkboxes = screen.getAllByRole('checkbox');
    const typeCheckboxes = checkboxes.filter((cb) =>
      (cb as HTMLInputElement).id.startsWith('type-') && cb.id !== 'type-select-all',
    );
    typeCheckboxes.forEach((cb) => {
      expect((cb as HTMLInputElement).checked).toBe(true);
    });
  });

  it('unchecking one type unchecks "Select all / none"', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByLabelText('Products')).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText('Products'));
    const selectAll = screen.getByLabelText('Select all / none') as HTMLInputElement;
    expect(selectAll.checked).toBe(false);
  });

  it('renders date range inputs in export select step', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByLabelText('From')).toBeInTheDocument();
      expect(screen.getByLabelText('To')).toBeInTheDocument();
    });
  });

  it('renders "Next: Encryption" button in export select step', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Next: Encryption')).toBeInTheDocument();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Export wizard — step transitions
  // ═══════════════════════════════════════════════════════════════

  it('moves to encrypt step when "Next: Encryption" is clicked with types selected', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Next: Encryption')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Next: Encryption'));
    await waitFor(() => {
      expect(screen.getByText('Set encryption password')).toBeInTheDocument();
    });
  });

  it('shows error toast when "Next: Encryption" is clicked with no types selected', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByLabelText('Select all / none')).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText('Select all / none'));
    await user.click(screen.getByText('Next: Encryption'));
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'data-mgmt-toast-export-select-type', type: 'error' }),
    );
    expect(screen.getByText('Next: Encryption')).toBeInTheDocument();
  });

  it('returns to select step when "Back" is clicked in encrypt step', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Next: Encryption')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Next: Encryption'));
    await waitFor(() => {
      expect(screen.getByText('Back')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Back'));
    await waitFor(() => {
      expect(screen.getByText('Select data to export')).toBeInTheDocument();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Export wizard — encryption & export
  // ═══════════════════════════════════════════════════════════════

  it('shows password length error for short password', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Next: Encryption')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Next: Encryption'));
    const pwInput = screen.getByLabelText('Password') as HTMLInputElement;
    await user.type(pwInput, '1234567');
    const confirmInput = screen.getByLabelText('Confirm password') as HTMLInputElement;
    await user.type(confirmInput, '1234567');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'data-mgmt-toast-export-password-length', type: 'error' }),
    );
  });

  it('shows password mismatch error', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Next: Encryption')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Next: Encryption'));
    const pwInput = screen.getByLabelText('Password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    const confirmInput = screen.getByLabelText('Confirm password') as HTMLInputElement;
    await user.type(confirmInput, 'different456');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'data-mgmt-toast-export-password-match', type: 'error' }),
    );
  });

  it('starts export and shows spinner on valid password', async () => {
    const user = userEvent.setup();
    mockExportData.mockReturnValue(new Promise(() => {}));
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Next: Encryption')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Next: Encryption'));
    const pwInput = screen.getByLabelText('Password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    const confirmInput = screen.getByLabelText('Confirm password') as HTMLInputElement;
    await user.type(confirmInput, 'password123');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(screen.getByTestId('spinner')).toBeInTheDocument();
    });
  });

  it('shows "Export complete" with output file on export success', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Next: Encryption')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Next: Encryption'));
    const pwInput = screen.getByLabelText('Password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    const confirmInput = screen.getByLabelText('Confirm password') as HTMLInputElement;
    await user.type(confirmInput, 'password123');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(screen.getByText('Export complete')).toBeInTheDocument();
    });
    expect(screen.getByText('/exports/export_2026.kasirpkg')).toBeInTheDocument();
  });

  it('shows export success toast on completion', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Next: Encryption')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Next: Encryption'));
    const pwInput = screen.getByLabelText('Password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    const confirmInput = screen.getByLabelText('Confirm password') as HTMLInputElement;
    await user.type(confirmInput, 'password123');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'data-mgmt-toast-export-success', type: 'success' }),
      );
    });
  });

  it('shows error and returns to encrypt step on export failure', async () => {
    const user = userEvent.setup();
    mockExportData.mockRejectedValue(new Error('Disk full'));
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Next: Encryption')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Next: Encryption'));
    const pwInput = screen.getByLabelText('Password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    const confirmInput = screen.getByLabelText('Confirm password') as HTMLInputElement;
    await user.type(confirmInput, 'password123');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(screen.getByText('Set encryption password')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('data-mgmt-toast-export-fail')).toBeInTheDocument();
    });
  });

  it('returns to encrypt step when file picker is cancelled', async () => {
    const user = userEvent.setup();
    mockPickExportPath.mockResolvedValue(null);
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Next: Encryption')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Next: Encryption'));
    const pwInput = screen.getByLabelText('Password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    const confirmInput = screen.getByLabelText('Confirm password') as HTMLInputElement;
    await user.type(confirmInput, 'password123');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(screen.getByText('Set encryption password')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // ═══════════════════════════════════════════════════════════════
  // Export wizard — reset / new export
  // ═══════════════════════════════════════════════════════════════

  it('resets export state when "New export" is clicked', async () => {
    const user = userEvent.setup();
    render(<DataManagementScreen />);
    await waitFor(() => {
      expect(screen.getByText('Next: Encryption')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Next: Encryption'));
    const pwInput = screen.getByLabelText('Password') as HTMLInputElement;
    await user.type(pwInput, 'password123');
    const confirmInput = screen.getByLabelText('Confirm password') as HTMLInputElement;
    await user.type(confirmInput, 'password123');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(screen.getByText('New export')).toBeInTheDocument();
    });
    await user.click(screen.getByText('New export'));
    await waitFor(() => {
      expect(screen.getByText('Select data to export')).toBeInTheDocument();
    });
    const selectAll = screen.getByLabelText('Select all / none') as HTMLInputElement;
    expect(selectAll.checked).toBe(true);
  });
});
