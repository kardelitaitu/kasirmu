import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import sharedFtl from '@/locales/shared.ftl?raw';
import staffFtl from '@/locales/staff.ftl?raw';
import StatusBar from '@/components/StatusBar';

// ── Mock Tauri IPC (getVersion + updater check) ───────────────────
vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => Promise.resolve('0.0.34'),
}));

const mockUpdaterCheck = vi.fn();
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: () => mockUpdaterCheck(),
}));

// ── Mock useSyncConnection (default: connected, fast) ─────────────
const mockSync = vi.hoisted(() => ({
  state: 'connected' as 'checking' | 'connected' | 'disconnected',
  latencyMs: 42 as number | null,
}));

vi.mock('@/hooks/useSyncConnection', () => ({
  useSyncConnection: () => ({ state: mockSync.state, latencyMs: mockSync.latencyMs, cause: null, retryNow: () => {} }),
}));

// Service-health contracts (saas-3): the bar gained payment + device pills.
// Their hooks are mocked so these tests drive the version/auth/sync surfaces
// without touching IPC.
vi.mock('@/hooks/usePaymentConnection', () => ({
  usePaymentConnection: () => ({ state: 'connected', latencyMs: null, cause: null, gateways: 1, retryNow: () => {} }),
}));
vi.mock('@/hooks/useDevicesConnection', () => ({
  useDevicesConnection: () => ({ state: 'connected', latencyMs: null, cause: null, devices: 1, retryNow: () => {} }),
}));

// ── Mock useAuthConnection for auth ────────────────────────────────
const mockAuth = vi.hoisted(() => ({
  state: 'connected' as 'checking' | 'connected' | 'disconnected',
  latencyMs: 42 as number | null,
}));

vi.mock('@/hooks/useAuthConnection', () => ({
  useAuthConnection: () => ({ state: mockAuth.state, latencyMs: mockAuth.latencyMs, cause: null, retryNow: () => {} }),
}));

// ── Mock the Toast hook ───────────────────────────────────────────
const mockAddToast = vi.fn();
vi.mock('@/frontend/shared/Toast', async () => {
  const actual: object = await vi.importActual('@/frontend/shared/Toast');
  return {
    ...actual,
    useToast: () => ({ addToast: mockAddToast }),
  };
});

// ── Tests ──────────────────────────────────────────────────────────

function renderBar() {
  return renderWithProvidersSync(<StatusBar />, sharedFtl, staffFtl);
}

describe('StatusBar (activation screen unified status area)', () => {
  beforeEach(() => {
    mockAddToast.mockClear();
    mockUpdaterCheck.mockReset();
    mockUpdaterCheck.mockResolvedValue(null); // no update available
    mockSync.state = 'connected';
    mockSync.latencyMs = 42;
    mockAuth.state = 'connected';
    mockAuth.latencyMs = 42;
  });

  it('renders five icon buttons (auth, sync, payment, devices, version)', () => {
    renderBar();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);
  });

  it('has correct ARIA labels', () => {
    renderBar();
    expect(screen.getByLabelText('Auth')).toBeInTheDocument();
    expect(screen.getByLabelText('Sync')).toBeInTheDocument();
    expect(screen.getByLabelText('Version')).toBeInTheDocument();
  });

  it('shows hover tooltip with latency for auth (green)', () => {
    renderBar();
    expect(screen.getByText('Auth · 42ms')).toBeInTheDocument();
  });

  it('shows hover tooltip with latency for sync (green)', () => {
    renderBar();
    expect(screen.getByText('Sync · 42ms')).toBeInTheDocument();
  });

  it('shows up-to-date tooltip for version (green)', async () => {
    renderBar();
    await waitFor(() => {
      expect(screen.getByText('Version up to date')).toBeInTheDocument();
    });
  });

  it('shows version-update tooltip (yellow) when update is available', async () => {
    mockUpdaterCheck.mockResolvedValue({ version: '0.0.35', downloadAndInstall: vi.fn() });

    renderBar();
    await waitFor(() => {
      expect(screen.getByText('Update available')).toBeInTheDocument();
    });
  });

  it('right-aligns the version tooltip (download icon is rightmost)', async () => {
    // The download/version icon sits at the right edge of the status row, so
    // its tooltip must anchor to the icon's right edge (bubble extends left).
    renderBar();
    await waitFor(() => {
      expect(screen.getByText('Version up to date')).toBeInTheDocument();
    });

    const tooltip = document.querySelector<HTMLElement>('.tooltip-content--align-right');
    expect(tooltip).not.toBeNull();
    // The right-aligned class must not appear on auth/sync tooltips.
    const allAligned = document.querySelectorAll('.tooltip-content--align-right');
    expect(allAligned.length).toBe(1);
  });

  it('clicks auth icon to re-probe now (saas-3 user-triggered retry)', () => {
    renderBar();
    fireEvent.click(screen.getByLabelText('Auth'));
    expect(mockAddToast).toHaveBeenCalledWith({ type: 'info', message: 'Retrying Auth…' });
  });

  it('clicks sync icon to re-probe now (saas-3 user-triggered retry)', () => {
    renderBar();
    fireEvent.click(screen.getByLabelText('Sync'));
    expect(mockAddToast).toHaveBeenCalledWith({ type: 'info', message: 'Retrying Sync…' });
  });

  // ── Color / tone classes ───────────────────────────────────────

  it('applies good tone (green) for latency < 1000 ms', () => {
    renderBar();
    expect(screen.getByLabelText('Auth').className).toContain('statusbar-tone--good');
  });

  it('applies warn tone (yellow) for latency 1000–2999 ms', () => {
    mockAuth.latencyMs = 1500;
    mockSync.latencyMs = 1500;
    renderBar();
    expect(screen.getByLabelText('Auth').className).toContain('statusbar-tone--warn');
  });

  it('applies bad tone (red) for latency >= 3000 ms', () => {
    mockAuth.latencyMs = 3500;
    mockSync.latencyMs = 3500;
    renderBar();
    expect(screen.getByLabelText('Auth').className).toContain('statusbar-tone--bad');
  });

  it('applies checking tone (blinking grey) while checking', () => {
    mockAuth.state = 'checking';
    mockAuth.latencyMs = null;
    mockSync.state = 'checking';
    mockSync.latencyMs = null;
    renderBar();
    expect(screen.getByLabelText('Auth').className).toContain('statusbar-tone--checking');
    expect(screen.getByLabelText('Sync').className).toContain('statusbar-tone--checking');
  });

  it('applies bad tone (red) when offline', () => {
    mockAuth.state = 'disconnected';
    mockAuth.latencyMs = null;
    mockSync.state = 'disconnected';
    mockSync.latencyMs = null;
    renderBar();
    expect(screen.getByLabelText('Auth').className).toContain('statusbar-tone--bad');
    expect(screen.getByLabelText('Sync').className).toContain('statusbar-tone--bad');
  });
});
