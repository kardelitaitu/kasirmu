// ── RevokedScreen tests ─────────────────────────────────────────────
//
// WHY THIS FILE EXISTS. Both shell suites mock this screen out
// (AppShell.test.tsx:23, TabletAppShell.test.tsx:40) so that they can assert the
// SHELL routes to it. Nothing then tested the screen: its export path had zero
// coverage anywhere, and `exportDataWithoutSession` has exactly one caller — this
// component — so an untested screen meant an untested command.
//
// The screen carries a documented promise (ADR #58 §2.6): a revoked merchant can
// still VIEW AND EXPORT their own data even though §2.5 refuses every session.
// That promise is what these tests hold up.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import RevokedScreen from '@/features/auth/RevokedScreen';
import sharedFtl from '@/locales/shared.ftl?raw';

const mockPickExportPath = vi.fn();
const mockExport = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/api/data', () => ({
  pickExportPath: (...args: unknown[]) => mockPickExportPath(...args),
  exportDataWithoutSession: (...args: unknown[]) => mockExport(...args),
}));

vi.mock('@/components/StatusBar', () => ({
  default: () => <div data-testid="status-bar" />,
}));

vi.mock('@/components/Toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/Toast')>();
  return {
    ...actual,
    useToast: () => ({ addToast: (...args: unknown[]) => mockAddToast(...args) }),
  };
});

beforeEach(() => {
  mockPickExportPath.mockReset();
  mockExport.mockReset();
  mockAddToast.mockReset();
});

const renderScreen = () => renderWithProvidersSync(<RevokedScreen />, sharedFtl);

describe('RevokedScreen — the revoked merchant can still get their data out', () => {
  it('renders the suspension notice and an export control', () => {
    renderScreen();

    expect(screen.getByTestId('revoked-screen')).toBeInTheDocument();
    // The screen is headed and the control is named, so a reader can act on it.
    expect(screen.getByRole('heading', { name: /Account suspended/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export all local store data/i })).toBeInTheDocument();

    // The aria-label REPLACES the visible text as the accessible name, so a
    // screen-reader user hears the descriptive sentence rather than the button's
    // four visible words. Asserted because this is a deliberate choice: dropping
    // the attribute would silently downgrade the announcement to "Export my data"
    // with no test noticing.
    const button = screen.getByRole('button', { name: /Export all local store data/i });
    expect(button).toHaveAttribute(
      'aria-label',
      'Export all local store data to an encrypted package',
    );
  });

  it('exports every data type the promise covers, with the picked output path', async () => {
    mockPickExportPath.mockResolvedValue('/tmp/merchant-export.kasirpkg');
    mockExport.mockResolvedValue({ path: '/tmp/merchant-export.kasirpkg', sizeBytes: 1 });
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: /Export all local store data/i }));

    await waitFor(() => {
      expect(mockExport).toHaveBeenCalledTimes(1);
    });
    // The five types are the promise's shape: a merchant locked out of selling
    // must still recover sales, products, customers, inventory and settings.
    expect(mockExport).toHaveBeenCalledWith({
      types: ['sales', 'products', 'customers', 'inventory', 'settings'],
      password: '',
      outputPath: '/tmp/merchant-export.kasirpkg',
    });
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success' }),
      );
    });
  });

  it('does NOT export when the merchant cancels the file picker', async () => {
    // pickExportPath resolves null when the user dismisses the dialog. Exporting
    // anyway would write a package the merchant never chose a home for.
    mockPickExportPath.mockResolvedValue(null);
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: /Export all local store data/i }));

    await waitFor(() => {
      expect(mockPickExportPath).toHaveBeenCalled();
    });
    expect(mockExport).not.toHaveBeenCalled();
    // And the control must come back, not stay stuck in its exporting state.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export all local store data/i })).not.toBeDisabled();
    });
  });

  it('reports a failed export without leaking the backend error text', async () => {
    // ERR-10: raw backend text must never reach a user-facing surface. The toast
    // goes through plainErrorMessage, so the SQL/identifier a Rust error can carry
    // does not appear.
    mockPickExportPath.mockResolvedValue('/tmp/x.kasirpkg');
    mockExport.mockRejectedValue(new Error('SQLITE_ERROR: no such table: secret_table'));
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: /Export all local store data/i }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
    });
    const toast = mockAddToast.mock.calls.find((c) => (c[0] as { type: string }).type === 'error')![0] as { message: string };
    expect(toast.message).not.toContain('secret_table');
    expect(toast.message).not.toContain('SQLITE_ERROR');
  });

  it('disables the control while an export is in flight', async () => {
    // Exporting is slow and writes a file; a second click must not start a second
    // export over the same path.
    let release: (v: unknown) => void = () => {};
    mockPickExportPath.mockResolvedValue('/tmp/slow.kasirpkg');
    mockExport.mockReturnValue(new Promise((r) => { release = r; }));
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: /Export all local store data/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export all local store data/i })).toBeDisabled();
    });
    release({ path: '/tmp/slow.kasirpkg' });
  });
});