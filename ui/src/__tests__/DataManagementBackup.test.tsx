import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataManagementScreen from '@/features/settings/DataManagementScreen';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';
// Overridden per-test through vi.mocked, the pattern ui/src/test-setup.ts:136 documents.
import { useWorkspace } from '@/contexts/WorkspaceContext';

// ── Shared mocks ─────────────────────────────────────────────────

const mockGetBackupStatus = vi.fn();
const mockCreateBackup = vi.fn();
// Separate fns rather than delegating to the unscoped pair: with one shared mock, an assertion
// like `expect(mockCreateBackup).toHaveBeenCalled()` passes whichever command the component
// chose, so the security property -- that the permission-checked variant ran -- would be
// unasserted. Distinct mocks let the tests below name the path they require.
const mockGetBackupStatusScoped = vi.fn();
const mockCreateBackupScoped = vi.fn();
const mockExportData = vi.fn();
const mockImportPreview = vi.fn();
const mockImportData = vi.fn();
const mockPickExportPath = vi.fn();
const mockPickImportFile = vi.fn();

vi.mock('@/api/data', () => ({
  getBackupStatus: () => mockGetBackupStatus(),
  createBackup: () => mockCreateBackup(),
  // DataManagementScreen now routes through the scoped twins when a session token is present --
  // they enforce permissions::DATA_EXPORT, which the unscoped commands do not at all. Without
  // these exports the mocked module has no such name and every render throws "No
  // getBackupStatusScoped export is defined on the @/api/data mock", a hard error that fails all
  // 29 tests in this pair rather than only the scoped ones. Same defect as the branding mock
  // (bf257ece), WeightScaleWidget (65971d0f), useBarcodeScanner (0b7f9e18), ScaleIndicator
  // (29bb5586) and useWarehouseScanner. Delegates to the same fns so a test asserting either
  // path sees one value.
  getBackupStatusScoped: (token: string) => mockGetBackupStatusScoped(token),
  createBackupScoped: (token: string) => mockCreateBackupScoped(token),
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

beforeEach(() => {
  mockGetBackupStatus.mockResolvedValue(defaultBackupStatus);
  mockCreateBackup.mockResolvedValue({ path: '/backups/backup_2026.db', sizeBytes: 12_582_912 });
  // Configured in parallel rather than by delegating the scoped mock to the unscoped one: a
  // mirror (`mockImplementation(() => mockGetBackupStatus())`) registers a call on the unscoped
  // spy, which makes `expect(mockGetBackupStatus).not.toHaveBeenCalled()` unprovable and would
  // have quietly defeated the point of asserting which command ran.
  mockGetBackupStatusScoped.mockResolvedValue(defaultBackupStatus);
  mockCreateBackupScoped.mockResolvedValue({ path: '/backups/backup_2026.db', sizeBytes: 12_582_912 });
  mockExportData.mockResolvedValue({ path: '/exports/export_2026.ozpkg', sizeBytes: 524_288, types: [] });
  mockImportPreview.mockResolvedValue({
    storeName: 'Test Store', appVersion: '0.0.4',
    createdAt: new Date('2026-01-15').toISOString(),
    types: [], productCount: 0, categoryCount: 0, saleCount: 0,
    customerCount: 0, userCount: 0, settingCount: 0,
  });
  mockImportData.mockResolvedValue({
    productsImported: 0, categoriesImported: 0, salesImported: 0,
    customersImported: 0, usersImported: 0, settingsImported: 0,
  });
  mockPickExportPath.mockResolvedValue('/exports/test.ozpkg');
  mockPickImportFile.mockResolvedValue('/imports/test.ozpkg');
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

describe('DataManagement — Backup', () => {
  it('shows "Never" when no backup has been created', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Backup')).toBeInTheDocument());
    await clickTab('Backup');
    await waitFor(() => {
      expect(screen.getByText('data-mgmt-backup-never')).toBeInTheDocument();
    });
  });

  it('shows last backup time when a backup exists', async () => {
    mockGetBackupStatus.mockResolvedValue({
      lastBackup: '2026-07-13 14:30:00', lastBackupSize: '12.0 MB',
    });
    mockGetBackupStatusScoped.mockResolvedValue({
      lastBackup: '2026-07-13 14:30:00', lastBackupSize: '12.0 MB',
    });
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Backup')).toBeInTheDocument());
    await clickTab('Backup');
    await waitFor(() => {
      expect(screen.getByText('2026-07-13 14:30:00')).toBeInTheDocument();
    });
  });

  it('shows backup size when available', async () => {
    mockGetBackupStatus.mockResolvedValue({
      lastBackup: '2026-07-13 14:30:00', lastBackupSize: '15.7 MB',
    });
    mockGetBackupStatusScoped.mockResolvedValue({
      lastBackup: '2026-07-13 14:30:00', lastBackupSize: '15.7 MB',
    });
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Backup')).toBeInTheDocument());
    await clickTab('Backup');
    await waitFor(() => expect(screen.getByText('15.7 MB')).toBeInTheDocument());
  });

  it('calls createBackup when "Create backup now" is clicked', async () => {
    const user = userEvent.setup();
    mockCreateBackup.mockReturnValue(new Promise(() => {}));
    mockCreateBackupScoped.mockReturnValue(new Promise(() => {}));
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Backup')).toBeInTheDocument());
    await clickTab('Backup');
    await waitFor(() => expect(screen.getByText('Create backup now')).toBeInTheDocument());
    await user.click(screen.getByText('Create backup now'));
    // Was `expect(mockCreateBackup).toHaveBeenCalled()`. The harness provides a session token
    // (test-setup.ts:161 -> HARNESS_SESSION_TOKEN), so the screen takes the permission-checked
    // path and the unscoped mock is never called -- the old assertion only passed while the
    // scoped mock delegated to it. Asserting the scoped command is the whole point: create_backup
    // writes a full copy of the database and enforces nothing, while create_backup_scoped
    // requires permissions::DATA_EXPORT.
    expect(mockCreateBackupScoped).toHaveBeenCalledWith(HARNESS_SESSION_TOKEN);
    expect(mockCreateBackup).not.toHaveBeenCalled();
  });

  it('reads backup status through the scoped command, passing the session token', async () => {
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Backup')).toBeInTheDocument());
    expect(mockGetBackupStatusScoped).toHaveBeenCalledWith(HARNESS_SESSION_TOKEN);
    expect(mockGetBackupStatus).not.toHaveBeenCalled();
  });

  it('shows "Backing up…" text while backup is in progress', async () => {
    const user = userEvent.setup();
    mockCreateBackup.mockReturnValue(new Promise(() => {}));
    mockCreateBackupScoped.mockReturnValue(new Promise(() => {}));
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Backup')).toBeInTheDocument());
    await clickTab('Backup');
    await waitFor(() => expect(screen.getByText('Create backup now')).toBeInTheDocument());
    await user.click(screen.getByText('Create backup now'));
    await waitFor(() => expect(screen.getByText('Backing up…')).toBeInTheDocument());
  });

  it('updates last backup time on backup success', async () => {
    const user = userEvent.setup();
    mockCreateBackup.mockResolvedValue({ path: '/backups/backup_now.db', sizeBytes: 5_000_000 });
    mockCreateBackupScoped.mockResolvedValue({ path: '/backups/backup_now.db', sizeBytes: 5_000_000 });
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Backup')).toBeInTheDocument());
    await clickTab('Backup');
    await waitFor(() => expect(screen.getByText('Create backup now')).toBeInTheDocument());
    await user.click(screen.getByText('Create backup now'));
    await waitFor(() => {
      expect(screen.getByText('4.8 MB')).toBeInTheDocument();
      expect(screen.queryByText('data-mgmt-backup-never')).not.toBeInTheDocument();
    });
  });

  it('shows success toast on backup success', async () => {
    const user = userEvent.setup();
    mockCreateBackup.mockResolvedValue({ path: '/backups/backup_now.db', sizeBytes: 5_000_000 });
    mockCreateBackupScoped.mockResolvedValue({ path: '/backups/backup_now.db', sizeBytes: 5_000_000 });
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Backup')).toBeInTheDocument());
    await clickTab('Backup');
    await waitFor(() => expect(screen.getByText('Create backup now')).toBeInTheDocument());
    await user.click(screen.getByText('Create backup now'));
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'data-mgmt-toast-backup-success', type: 'success' }),
      );
    });
  });

  it('shows error toast on backup failure', async () => {
    const user = userEvent.setup();
    mockCreateBackup.mockRejectedValue(new Error('Disk full'));
    mockCreateBackupScoped.mockRejectedValue(new Error('Disk full'));
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Backup')).toBeInTheDocument());
    await clickTab('Backup');
    await waitFor(() => expect(screen.getByText('Create backup now')).toBeInTheDocument());
    await user.click(screen.getByText('Create backup now'));
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'data-mgmt-toast-backup-fail', type: 'error' }),
      );
    });
    expect(screen.queryByText('Backing up…')).not.toBeInTheDocument();
  });

  it('handles getBackupStatus failure gracefully', async () => {
    mockGetBackupStatus.mockRejectedValue(new Error('Network error'));
    mockGetBackupStatusScoped.mockRejectedValue(new Error('Network error'));
    render(<DataManagementScreen />);
    await waitFor(() => expect(screen.getByText('Backup')).toBeInTheDocument());
    await clickTab('Backup');
    await waitFor(() => {
      expect(screen.getByText('data-mgmt-backup-never')).toBeInTheDocument();
    });
  });
});

// ── KNOWN-HAZARD PIN ───────────────────────────────────────────────────

/**
 * What the screen does TODAY with no workspace session token: it calls the
 * UNGATED pair, which checks no permission at all, so permissions::DATA_EXPORT is
 * skipped on a path a human clicks. Recorded, not endorsed.
 *
 * The state is reachable in a normal install, not a corner: the token is minted
 * only when an instance is resolvable, so ui/src/contexts/WorkspaceContext.tsx
 * :469-473 returns without ever minting one and :463 returns without a user id,
 * while :215, :274, :319 and :507 null an EXISTING token with this screen still
 * mounted. The page's own requiredRole: 'owner' gate does not cover it either,
 * because AppShell.tsx:368 reads session?.role_name — a different credential.
 *
 * Every other test in this file was blind to it: ui/src/test-setup.ts:161 seeds
 * HARNESS_SESSION_TOKEN for all renders, so all of them take the gated path.
 *
 * IF BACKUP GATING LANDS, INVERT THIS TEST, DO NOT DELETE IT. Once
 * create_backup / get_backup_status enforce the permission in Rust (see event
 * backup_ungated_no_session in crates/oz-bridge/src/data.rs), or the screen stops
 * calling them tokenlessly, flip these expectations to the scoped names or to a
 * refusal. A flipped test keeps recording the decision; a deleted one leaves the
 * fix as unobserved as the hole was.
 */
describe('DataManagement — Backup with NO session token (known hazard, not a goal)', () => {
  it('calls the UNGATED backup pair when no session token exists', async () => {
    const user = userEvent.setup();
    // Nothing else in this file ever reaches the unscoped mocks, so this is the
    // first test whose call counts could be polluted in either direction.
    vi.clearAllMocks();
    mockGetBackupStatus.mockResolvedValue(defaultBackupStatus);
    mockGetBackupStatusScoped.mockResolvedValue(defaultBackupStatus);
    mockCreateBackup.mockResolvedValue({ path: '/backups/backup_2026.db', sizeBytes: 12_582_912 });
    mockCreateBackupScoped.mockResolvedValue({ path: '/backups/backup_2026.db', sizeBytes: 12_582_912 });
    const harnessWorkspace = useWorkspace();
    vi.mocked(useWorkspace).mockReturnValue({ ...harnessWorkspace, sessionToken: null });
    try {
      render(<DataManagementScreen />);
      await waitFor(() => expect(screen.getByText('Backup')).toBeInTheDocument());
      // Mount path: the else branch of the ternary in DataManagementScreen.tsx.
      // Messages name the command, so a red run says which door was used instead
      // of saying "a spy was not called".
      expect(
        mockGetBackupStatus,
        "expected the UNGATED get_backup_status (checks no permission) to be the command called",
      ).toHaveBeenCalled();
      expect(
        mockGetBackupStatusScoped,
        "expected get_backup_status_scoped NOT to run; a call there means DATA_EXPORT was checked",
      ).not.toHaveBeenCalled();

      await clickTab('Backup');
      await waitFor(() => expect(screen.getByText('Create backup now')).toBeInTheDocument());
      await user.click(screen.getByText('Create backup now'));
      await waitFor(() => expect(mockCreateBackup).toHaveBeenCalled());
      expect(
        mockCreateBackup,
        "expected the UNGATED create_backup (writes a full db copy, checks nothing) to be the command called",
      ).toHaveBeenCalled();
      expect(
        mockCreateBackupScoped,
        "expected create_backup_scoped NOT to run; a call there means DATA_EXPORT was checked",
      ).not.toHaveBeenCalled();
    } finally {
      vi.mocked(useWorkspace).mockReturnValue(harnessWorkspace);
    }
  });
});
