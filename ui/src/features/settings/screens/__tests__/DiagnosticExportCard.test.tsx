import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DiagnosticExportCard } from '../DiagnosticExportCard';

const mockExportDiagnostics = vi.fn();
const mockPickDiagnosticExportPath = vi.fn();

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: 'tok_diag_test',
  }),
}));

vi.mock('@/api/system', () => ({
  exportDiagnostics: (...args: unknown[]) => mockExportDiagnostics(...args),
  pickDiagnosticExportPath: () => mockPickDiagnosticExportPath(),
}));

vi.mock('@/api/file-bridge', () => ({
  isContentUri: () => false,
  copyCacheToUri: vi.fn(),
}));

vi.mock('@fluent/react', () => ({
  Localized: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLocalization: () => ({
    l10n: {
      getString: (id: string) => id,
    },
  }),
}));

describe('DiagnosticExportCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders export title and button', () => {
    render(<DiagnosticExportCard />);
    expect(screen.getByTestId('diagnostic-export-card')).toBeInTheDocument();
    expect(screen.getByTestId('diagnostic-export-btn')).toBeInTheDocument();
  });

  it('triggers export and renders success feedback on valid path', async () => {
    mockPickDiagnosticExportPath.mockResolvedValue('/exports/diag_test.zip');
    mockExportDiagnostics.mockResolvedValue({
      path: '/exports/diag_test.zip',
      sizeBytes: 2 * 1024 * 1024,
      filesIncluded: ['system_info.json', 'logs/kasirmu.log'],
    });

    render(<DiagnosticExportCard />);
    const btn = screen.getByTestId('diagnostic-export-btn');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockPickDiagnosticExportPath).toHaveBeenCalledTimes(1);
      expect(mockExportDiagnostics).toHaveBeenCalledWith('tok_diag_test', '/exports/diag_test.zip');
    });

    await waitFor(() => {
      expect(screen.getByText(/Diagnostic archive exported successfully/i)).toBeInTheDocument();
      expect(screen.getByText(/\/exports\/diag_test\.zip/i)).toBeInTheDocument();
    });
  });

  it('does nothing when user cancels file picker', async () => {
    mockPickDiagnosticExportPath.mockResolvedValue(null);

    render(<DiagnosticExportCard />);
    const btn = screen.getByTestId('diagnostic-export-btn');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockPickDiagnosticExportPath).toHaveBeenCalledTimes(1);
      expect(mockExportDiagnostics).not.toHaveBeenCalled();
    });
  });

  it('displays error feedback when export fails', async () => {
    mockPickDiagnosticExportPath.mockResolvedValue('/exports/fail.zip');
    mockExportDiagnostics.mockRejectedValue(new Error('Disk write failed: permission denied'));

    render(<DiagnosticExportCard />);
    const btn = screen.getByTestId('diagnostic-export-btn');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/Diagnostic export failed/i)).toBeInTheDocument();
      // UPDATED 2026-10-07 with the ERR-05 fix in the component. This assertion used
      // to require the RAW backend string — "Disk write failed: permission denied" —
      // to be rendered, which was the leak: the test was pinning the defect. The
      // text now comes from l10nErrorMessage, and no detail line is shown at all.
      //
      // The mock above returns the KEY as its own value (getString: (id) => id), so
      // the assertion reads that key. That is the mock's contract, not a bug: it is
      // how this suite stays independent of the .ftl bundle, which is where the real
      // copy lives and which FTL-parity gates check separately.
      //
      // The other two assertions in this file read ENGLISH prose ("Diagnostic export
      // failed.") and still pass, which looks contradictory until you see why: those
      // strings are the <Localized> FALLBACK CHILDREN, and the mock replaces
      // <Localized> with a passthrough, so the fallback is what renders. So this file
      // verifies the fallbacks and the mapper's key — never the bundle. That is the
      // intended division of labour, and it is worth knowing before reading a green
      // run here as "the copy is correct in every locale".
      //
      // A NOTE ON SEARCHING FOR KEYS, learned the hard way on 2026-10-07: this key
      // lives in shared.ftl with its six siblings, NOT in settings.ftl where the
      // sibling FEATURE's keys live. A grep limited to settings.ftl reports all seven
      // as missing and reads exactly like a real i18n defect. Search shared-ui/locales
      // as a whole, or the finding is an artifact of the search.
      expect(screen.getByText(/settings-diagnostics-export-failed/)).toBeInTheDocument();
      expect(screen.queryByText(/Disk write failed/i)).not.toBeInTheDocument();
    });
  });
});
