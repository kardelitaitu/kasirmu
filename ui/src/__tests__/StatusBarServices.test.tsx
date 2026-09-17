/**
 * @file StatusBarServices.test.tsx
 * @description The service-health contracts (todo-global-saas-3.md) require
 * user-visible status for all four services — license server, sync, payment,
 * device connectivity — plus a user-triggered retry. StatusBarDegraded covers
 * the auth/sync tones; this file covers the two previously missing pills and
 * the retry action that replaced the tooltip-repeating toast.
 *
 * Covers:
 *   - five pills render (four contract services + version, which stays)
 *   - payment/device pills reuse the shared tone mapping (good/bad/checking)
 *   - the probe reading (gateway/device count) is the tooltip, not a synthetic 0ms
 *   - clicking a service pill re-probes now and announces the retry
 *   - a checking pill repeats its tooltip instead of queueing a duplicate probe
 *   - the version pill keeps the informational toast
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import StatusBar from '@/components/StatusBar';
import sharedFtl from '@/locales/shared.ftl?raw';
import staffFtl from '@/locales/staff.ftl?raw';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  sync: vi.fn(),
  payment: vi.fn(),
  devices: vi.fn(),
  version: vi.fn(),
  retryNow: vi.fn(),
}));

vi.mock('@/hooks/useAuthConnection', () => ({ useAuthConnection: () => mocks.auth() }));
vi.mock('@/hooks/useSyncConnection', () => ({ useSyncConnection: () => mocks.sync() }));
vi.mock('@/hooks/usePaymentConnection', () => ({ usePaymentConnection: () => mocks.payment() }));
vi.mock('@/hooks/useDevicesConnection', () => ({ useDevicesConnection: () => mocks.devices() }));
vi.mock('@/hooks/useVersionStatus', () => ({ useVersionStatus: () => mocks.version() }));

// Render the tooltip content alongside the trigger so the message is
// assertable; the real Tooltip only shows it on hover.
vi.mock('@/frontend/shell/Tooltip', () => ({
  default: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
    <>
      {children}
      <span data-testid="tooltip">{content}</span>
    </>
  ),
}));

const mockAddToast = vi.fn();
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

const HEALTHY = () => ({ state: 'connected', latencyMs: 12, cause: null, retryNow: mocks.retryNow });

function renderBar() {
  mocks.version.mockReturnValue({ state: 'latest', label: 'Up to date' });
  return renderWithFluentSync(<StatusBar />, sharedFtl, staffFtl);
}

beforeEach(() => {
  mocks.auth.mockReturnValue(HEALTHY());
  mocks.sync.mockReturnValue(HEALTHY());
  mocks.payment.mockReturnValue({ state: 'connected', latencyMs: null, cause: null, gateways: 1, retryNow: mocks.retryNow });
  mocks.devices.mockReturnValue({ state: 'connected', latencyMs: null, cause: null, devices: 2, retryNow: mocks.retryNow });
  mocks.retryNow.mockClear();
  mockAddToast.mockClear();
});

describe('service-health pills (payment + device connectivity)', () => {
  it('renders a pill for all four contract services plus version', () => {
    renderBar();
    expect(screen.getByLabelText('Auth')).toBeInTheDocument();
    expect(screen.getByLabelText('Sync')).toBeInTheDocument();
    expect(screen.getByLabelText('Payment')).toBeInTheDocument();
    expect(screen.getByLabelText('Devices')).toBeInTheDocument();
    // The version pill is not one of the four named services but stays.
    expect(screen.getByLabelText('Version')).toBeInTheDocument();
  });

  it('paints the payment pill from the same tone mapping', () => {
    renderBar();
    expect(screen.getByLabelText('Payment').className).toContain('statusbar-tone--good');
  });

  it('paints payment bad when no gateway is configured', () => {
    mocks.payment.mockReturnValue({ state: 'disconnected', latencyMs: null, cause: null, gateways: 0, retryNow: mocks.retryNow });
    renderBar();
    expect(screen.getByLabelText('Payment').className).toContain('statusbar-tone--bad');
  });

  it('paints payment checking while the first probe is in flight', () => {
    mocks.payment.mockReturnValue({ state: 'checking', latencyMs: null, cause: null, gateways: 0, retryNow: mocks.retryNow });
    renderBar();
    expect(screen.getByLabelText('Payment').className).toContain('statusbar-tone--checking');
  });

  it('paints devices bad when the bus answers empty', () => {
    mocks.devices.mockReturnValue({ state: 'disconnected', latencyMs: null, cause: null, devices: 0, retryNow: mocks.retryNow });
    renderBar();
    expect(screen.getByLabelText('Devices').className).toContain('statusbar-tone--bad');
  });

  it('shows the device count as the tooltip, not a synthetic latency', () => {
    renderBar();
    expect(screen.getAllByText(/Devices · 2/).length).toBeGreaterThan(0);
  });

  it('shows the gateway count as the payment tooltip', () => {
    renderBar();
    expect(screen.getAllByText(/Payment · 1/).length).toBeGreaterThan(0);
  });
});

describe('user-triggered retry (click = re-probe now)', () => {
  it('clicking a service pill re-probes immediately and says so', () => {
    renderBar();
    fireEvent.click(screen.getByLabelText('Auth'));
    expect(mocks.retryNow).toHaveBeenCalledTimes(1);
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Retrying') }),
    );
  });

  it('a pill still checking repeats its tooltip instead of double-probing', () => {
    mocks.auth.mockReturnValue({ state: 'checking', latencyMs: null, cause: null, retryNow: mocks.retryNow });
    renderBar();
    fireEvent.click(screen.getByLabelText('Auth'));
    expect(mocks.retryNow).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledTimes(1);
  });

  it('the version pill keeps the informational toast (it is not a service)', () => {
    renderBar();
    fireEvent.click(screen.getByLabelText('Version'));
    expect(mocks.retryNow).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledTimes(1);
  });

  it('clicking the sync pill re-probes immediately (wiring pinned)', () => {
    renderBar();
    fireEvent.click(screen.getByLabelText('Sync'));
    expect(mocks.retryNow).toHaveBeenCalledTimes(1);
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Retrying') }),
    );
  });
});
