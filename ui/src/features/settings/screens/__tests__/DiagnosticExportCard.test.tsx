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
      expect(screen.getByText(/Disk write failed: permission denied/i)).toBeInTheDocument();
    });
  });
});
