import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataManagementScreen from '@/features/settings/DataManagementScreen';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { isTabletShell } from '@/utils/shellKind';
import { renderWithFluent } from '@/__tests__/test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';

// ── Shared mocks ─────────────────────────────────────────────────

const mockListRestoreCandidates = vi.fn();
const mockGetRestoreStatus = vi.fn();
const mockPrepareRestore = vi.fn();
// The screen mounts the whole tab set, so every other @/api/data name the
// screen's hooks import must exist on the mock or the module throws a hard
// "no such export" error and fails every test in this file.
const mockGetBackupStatus = vi.fn();
const mockGetBackupStatusScoped = vi.fn();
const mockCreateBackup = vi.fn();
const mockCreateBackupScoped = vi.fn();
const mockPickBackupPath = vi.fn();
const mockCreateBackupTo = vi.fn();
const mockExportData = vi.fn();
const mockImportPreview = vi.fn();
const mockImportData = vi.fn();
const mockPickExportPath = vi.fn();
const mockPickImportFile = vi.fn();

vi.mock('@/api/data', () => ({
  listRestoreCandidates: (token: string) => mockListRestoreCandidates(token),
  getRestoreStatus: (token: string) => mockGetRestoreStatus(token),
  prepareRestore: (token: string, args: unknown) => mockPrepareRestore(token, args),
  getBackupStatus: () => mockGetBackupStatus(),
  getBackupStatusScoped: (token: string) => mockGetBackupStatusScoped(token),
  createBackup: () => mockCreateBackup(),
  createBackupScoped: (token: string) => mockCreateBackupScoped(token),
  pickBackupPath: () => mockPickBackupPath(),
  createBackupTo: (token: string, path: string) => mockCreateBackupTo(token, path),
  exportData: (args: unknown) => mockExportData(args),
  importPreview: (p: string, w: string) => mockImportPreview(p, w),
  importData: (p: string, w: string) => mockImportData(p, w),
  pickExportPath: () => mockPickExportPath(),
  pickImportFile: () => mockPickImportFile(),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: vi.fn(),
}));

vi.mock('@/utils/shellKind', () => ({
  isTabletShell: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Fixtures ─────────────────────────────────────────────────────

const CANDIDATE_OK = {
  generation: 0,
  path: '/data/kasir.backup.db',
  size_bytes: 2048,
  modified: '2026-09-29 10:00:00',
  verdict: 'Acceptable',
  restorable: true,
  reason: 'the backup is readable and its schema is compatible',
  candidate_schema: '20260901_x.sql',
  build_schema: '20260915_y.sql',
};

const CANDIDATE_CORRUPT = {
  ...CANDIDATE_OK,
  generation: 1,
  path: '/data/kasir.backup.1.db',
  verdict: 'Corrupt',
  restorable: false,
  reason: 'integrity check failed',
};

const CANDIDATE_NEWER = {
  ...CANDIDATE_OK,
  generation: 2,
  path: '/data/kasir.backup.2.db',
  verdict: 'NewerThanThisBuild',
  restorable: false,
  reason: 'the backup carries a newer schema than this build',
};

/** Render the screen and switch to the restore tab. */
async function openRestoreTab() {
  // The REAL settings bundle, not a mocked @fluent/react: this way the new
  // restore keys are actually parsed, so a typo'd or missing key fails here
  // instead of silently rendering the message id.
  await renderWithFluent(<DataManagementScreen />, settingsFtl as unknown as string);
  await userEvent.click(screen.getByRole('tab', { name: /restore/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useWorkspace).mockReturnValue({
    sessionToken: 'tok-123',
  } as unknown as ReturnType<typeof useWorkspace>);
  vi.mocked(isTabletShell).mockReturnValue(false);
  mockGetBackupStatus.mockResolvedValue({ last_backup: null, last_backup_size: null });
  mockGetBackupStatusScoped.mockResolvedValue({ last_backup: null, last_backup_size: null });
  mockListRestoreCandidates.mockResolvedValue({
    candidates: [CANDIDATE_OK],
    generations_examined: 1,
  });
  mockGetRestoreStatus.mockResolvedValue({
    pending: false,
    candidate_path: null,
    requested_at: null,
    verdict: null,
    error: null,
  });
  mockPrepareRestore.mockResolvedValue({
    candidate_path: CANDIDATE_OK.path,
    request_path: '/data/kasir.restore-request.json',
    requested_at: '2026-09-29T10:00:00Z',
    verdict: 'Acceptable',
    candidate_schema: '20260901_x.sql',
  });
});

// ── Listing ──────────────────────────────────────────────────────

describe('restore tab — listing', () => {
  it('lists a generation with its verdict and reason', async () => {
    await openRestoreTab();

    expect(await screen.findByText(/Generation 0/)).toBeInTheDocument();
    expect(screen.getByText(/Usable/)).toBeInTheDocument();
    // The validator's own sentence, so an operator learns WHY.
    expect(screen.getByText(/readable and its schema is compatible/)).toBeInTheDocument();
  });

  it('lists an unusable generation rather than hiding it, with its button disabled', async () => {
    mockListRestoreCandidates.mockResolvedValue({
      candidates: [CANDIDATE_CORRUPT],
      generations_examined: 1,
    });
    await openRestoreTab();

    // The list exists to show that a backup is unusable — omitting it would
    // hide the one thing it is for.
    expect(await screen.findByText(/integrity check failed/)).toBeInTheDocument();
    expect(screen.getByText(/Refused, corrupt/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore this backup/i })).toBeDisabled();
  });

  it('renders a newer-schema candidate as refused with its own wording', async () => {
    mockListRestoreCandidates.mockResolvedValue({
      candidates: [CANDIDATE_NEWER],
      generations_examined: 1,
    });
    await openRestoreTab();

    expect(await screen.findByText(/Refused, newer schema/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore this backup/i })).toBeDisabled();
  });

  it('reports an empty list as empty, not as an error', async () => {
    mockListRestoreCandidates.mockResolvedValue({ candidates: [], generations_examined: 0 });
    await openRestoreTab();

    expect(await screen.findByText(/No backup generations were found/)).toBeInTheDocument();
  });

  it('renders "Unknown" for a candidate that carries no schema', async () => {
    // A pre-migration snapshot has no schema_migrations table at all, which is
    // exactly WHY it reads OlderButAcceptable. Hiding the row would hide that.
    mockListRestoreCandidates.mockResolvedValue({
      candidates: [{ ...CANDIDATE_OK, candidate_schema: null }],
      generations_examined: 1,
    });
    await openRestoreTab();

    expect(await screen.findByText(/Backup schema/)).toBeInTheDocument();
    expect(screen.getByText(/Unknown/)).toBeInTheDocument();
  });

  it('shows the CLI fallback on the tablet shell instead of a doomed invoke', async () => {
    vi.mocked(isTabletShell).mockReturnValue(true);
    await openRestoreTab();

    // The three commands are desktop-registered only, so firing them on the
    // tablet would raise a misleading error toast on every mount.
    expect(await screen.findByText(/from the command line/i)).toBeInTheDocument();
    expect(mockListRestoreCandidates).not.toHaveBeenCalled();
  });
});

// ── The typed confirmation (the security-critical half) ──────────

describe('restore tab — typed store-name confirmation', () => {
  it('starts the confirmation field empty and never pre-fills it', async () => {
    await openRestoreTab();
    await userEvent.click(await screen.findByRole('button', { name: /restore this backup/i }));

    const input = screen.getByLabelText(/Store name in the backup/i);
    // THE BARRIER: the bridge deliberately does not echo the expected name back
    // (data/restore.rs:209-210). A pre-filled field would make it a copy-paste.
    expect(input).toHaveValue('');
  });

  it('does not leak the store name anywhere on the restore surface', async () => {
    await openRestoreTab();
    await userEvent.click(await screen.findByRole('button', { name: /restore this backup/i }));

    // The API type carries no store name at all; assert the rendered surface
    // likewise shows no value the operator could copy. (React renders an empty
    // `value=""` attribute on a controlled input, so the meaningful assertion is
    // that the field is EMPTY and starts empty -- not that the attribute is
    // absent.)
    const input = screen.getByLabelText(/Store name in the backup/i) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input).toHaveAttribute('value', '');
    expect(input).toHaveAttribute('autocomplete', 'off');
    // The candidate fixture's path/store-derived text must not appear as a value.
    expect(screen.queryByText(/kasir\.backup\.db/)).not.toBeInTheDocument();
  });

  it('disables submit until a name is typed', async () => {
    await openRestoreTab();
    await userEvent.click(await screen.findByRole('button', { name: /restore this backup/i }));

    expect(screen.getByRole('button', { name: /request restore/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Store name in the backup/i), 'Adi Store');
    expect(screen.getByRole('button', { name: /request restore/i })).toBeEnabled();
  });

  it('sends the typed name and the candidate path, trimmed', async () => {
    await openRestoreTab();
    await userEvent.click(await screen.findByRole('button', { name: /restore this backup/i }));
    await userEvent.type(screen.getByLabelText(/Store name in the backup/i), '  Adi Store  ');
    await userEvent.click(screen.getByRole('button', { name: /request restore/i }));

    await waitFor(() => {
      expect(mockPrepareRestore).toHaveBeenCalledWith('tok-123', {
        candidate_path: '/data/kasir.backup.db',
        confirm_store_name: 'Adi Store',
      });
    });
  });

  it('keeps the typed name on screen when the bridge refuses it', async () => {
    mockPrepareRestore.mockRejectedValue(new Error('store name mismatch'));
    await openRestoreTab();
    await userEvent.click(await screen.findByRole('button', { name: /restore this backup/i }));
    await userEvent.type(screen.getByLabelText(/Store name in the backup/i), 'Wrong Store');
    await userEvent.click(screen.getByRole('button', { name: /request restore/i }));

    // The operator must be able to correct a typo without reopening the dialog.
    await waitFor(() => {
      expect(screen.getByLabelText(/Store name in the backup/i)).toHaveValue('Wrong Store');
    });
  });

  it('clears the typed name when the confirmation is reopened', async () => {
    await openRestoreTab();
    await userEvent.click(await screen.findByRole('button', { name: /restore this backup/i }));
    await userEvent.type(screen.getByLabelText(/Store name in the backup/i), 'Something');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Reopening must not resume a stale half-typed confirmation.
    await userEvent.click(screen.getByRole('button', { name: /restore this backup/i }));
    expect(screen.getByLabelText(/Store name in the backup/i)).toHaveValue('');
  });

  it('states plainly that the restore runs on the next start, not now', async () => {
    await openRestoreTab();
    await userEvent.click(await screen.findByRole('button', { name: /restore this backup/i }));

    // D5 safe-mode: no string may promise an immediate restore.
    expect(screen.getByText(/runs the next time kasir\.mu starts/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore now/i })).not.toBeInTheDocument();
  });
});

// ── Pending request ──────────────────────────────────────────────

describe('restore tab — pending request', () => {
  it('shows the pending banner with its timestamp', async () => {
    mockGetRestoreStatus.mockResolvedValue({
      pending: true,
      candidate_path: '/data/kasir.backup.db',
      requested_at: '2026-09-29T09:00:00Z',
      verdict: 'Acceptable',
      error: null,
    });
    await openRestoreTab();

    expect(await screen.findByText(/already pending/i)).toBeInTheDocument();
    expect(screen.getByText('2026-09-29T09:00:00Z')).toBeInTheDocument();
  });

  it('surfaces an unreadable request rather than reporting it as clean', async () => {
    mockGetRestoreStatus.mockResolvedValue({
      pending: true,
      candidate_path: null,
      requested_at: null,
      verdict: null,
      error: 'parsing /data/kasir.restore-request.json: expected value',
    });
    await openRestoreTab();

    // A restore WILL be attempted and may not be understood — that is a warning,
    // not a clean state.
    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/expected value/)).toBeInTheDocument();
  });

  it('does not claim "nothing pending" when the status read fails', async () => {
    mockGetRestoreStatus.mockRejectedValue(new Error('ipc down'));
    await openRestoreTab();

    // undefined = never answered. Only an ANSWERED empty read may render clean.
    await waitFor(() => {
      expect(screen.getByText(/Generation 0/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/already pending/i)).not.toBeInTheDocument();
  });

  it('still lists generations when the status read fails', async () => {
    mockGetRestoreStatus.mockRejectedValue(new Error('ipc down'));
    await openRestoreTab();

    // Independent reads: one failing must not blank the other.
    expect(await screen.findByText(/Generation 0/)).toBeInTheDocument();
  });
});
