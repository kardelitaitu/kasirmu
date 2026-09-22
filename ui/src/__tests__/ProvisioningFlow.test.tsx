import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProvisioningFlow from '../features/setup/ProvisioningFlow';
import { provisionDevice } from '@/api/settings';
import {
  startDevicePairing,
  pollDevicePairing,
  linkDeviceGoogle,
  requestDeviceLinkCode,
  consumeDeviceLinkCode,
} from '@/api/license';
import { isTabletShell } from '@/utils/shellKind';

const FAST_WAIT = { interval: 5, timeout: 500 } as const;

const mockAddToast = vi.fn();
const mockOnProvisioned = vi.fn();

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/api/settings', () => ({
  provisionDevice: vi.fn(),
}));

vi.mock('@/api/system', () => ({
  getDeviceId: vi.fn().mockResolvedValue('test-terminal-01'),
}));

vi.mock('@/api/license', () => ({
  startDevicePairing: vi.fn(),
  pollDevicePairing: vi.fn(),
  linkDeviceGoogle: vi.fn(),
  requestDeviceLinkCode: vi.fn(),
  consumeDeviceLinkCode: vi.fn(),
}));

vi.mock('@/utils/shellKind', () => ({
  isTabletShell: vi.fn().mockReturnValue(false),
}));

vi.mock('@fluent/react', () => ({
  Localized: ({ children, vars }: { children: React.ReactNode; vars?: Record<string, unknown> }) => {
    if (typeof children === 'string' && vars) {
      let text = children;
      for (const [k, v] of Object.entries(vars)) {
        text = text.replace(`{ $${k} }`, String(v));
      }
      return <>{text}</>;
    }
    return <>{children}</>;
  },
  useLocalization: () => ({
    l10n: {
      getString: (id: string) => {
        const map: Record<string, string> = {
          'setup-provision-title': 'Set up this terminal',
          'setup-provision-desc': 'Sign in to link your free kasir.mu account, then you can start selling.',
          'setup-mode-local-desc': 'No account needed. Set up and start selling 100% offline immediately.',
          'setup-provision-mode-section': 'Setup Mode',
          'setup-mode-local-title': 'Standalone (Offline)',
          'setup-mode-linked-title': 'Link kasir.mu Account (Free)',
          'setup-provision-account-section': 'kasir.mu Account',
          'setup-provision-offline-warn': 'Internet connection is required to create or link your account.',
          'setup-tab-pair': 'QR Pairing',
          'setup-tab-email': 'Email Code',
          'setup-account-email': 'Email address',
          'setup-account-code': 'Verification code',
          'setup-account-failed': 'Failed to connect account.',
          'setup-provision-account-required': 'Please link your kasir.mu account before finishing setup.',
          'setup-provision-success': 'This terminal is ready.',
          'setup-provision-error': 'Could not finish setting up this terminal.',
          'auth-pair-waiting': 'Waiting for you to claim on your phone…',
          'auth-pair-success': 'Device paired successfully!',
          'auth-activating': 'Loading...',
          'auth-pair-expired': 'Pairing code expired.',
          'auth-pair-refresh': 'Refresh Code',
        };
        return map[id] || id;
      },
    },
  }),
}));

describe('ProvisioningFlow (ADR #56 §2.3 / §2.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(provisionDevice).mockResolvedValue({
      terminal_id: 'test-terminal-01',
      location_id: 'loc-1',
      owner_user_id: 'usr-1',
      created: true,
      mode: 'local',
      home_region: 'id-jkt',
    });
    vi.mocked(isTabletShell).mockReturnValue(false);
  });

  const fillBasicForm = () => {
    fireEvent.click(screen.getByTestId('store-type-simple-retail'));
    fireEvent.change(screen.getByLabelText(/Shop name/i), { target: { value: 'Toko Berkah' } });
    fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: 'Budi Santoso' } });
    fireEvent.change(screen.getByLabelText(/Login name/i), { target: { value: 'budi' } });
    fireEvent.change(screen.getByLabelText(/^PIN/i), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText(/Confirm PIN/i), { target: { value: '1234' } });
  };

  it('defaults to Mode 1 (Standalone Local) and allows completion without internet/account', async () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // Mode 1 is pre-selected by default
    const localModeBtn = screen.getByTestId('provision-mode-local');
    expect(localModeBtn.getAttribute('aria-pressed')).toBe('true');

    // Account box should not be rendered in Mode 1
    expect(screen.queryByRole('heading', { name: /kasir\.mu Account/i })).toBeNull();

    fillBasicForm();

    const submitBtn = screen.getByTestId('provision-submit');
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(provisionDevice).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'local',
          tenant_id: null,
          device_credential_id: null,
          location_name: 'Toko Berkah',
          owner_username: 'budi',
          owner_display_name: 'Budi Santoso',
          owner_pin: '1234',
        }),
      );
      expect(mockOnProvisioned).toHaveBeenCalled();
    }, FAST_WAIT);
  });

  it('Mode 2 (Linked) requires linking before submission is allowed', async () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // Switch to Mode 2
    fireEvent.click(screen.getByTestId('provision-mode-linked'));
    expect(screen.getByTestId('provision-mode-linked').getAttribute('aria-pressed')).toBe('true');

    // Account box is visible
    expect(screen.getByRole('heading', { name: /kasir\.mu Account/i })).toBeInTheDocument();

    fillBasicForm();

    // Submit button must be disabled until account is linked
    const submitBtn = screen.getByTestId('provision-submit');
    expect(submitBtn).toBeDisabled();

    // Simulate Google account link on desktop
    vi.mocked(linkDeviceGoogle).mockResolvedValueOnce({
      tenantId: 'tenant-cloud-123',
      provider: 'google',
      email: 'owner@example.com',
      terminal: {
        terminalId: 'term-cloud-1',
        issued: true,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }));

    await waitFor(() => {
      expect(screen.getByText(/Linked to owner@example\.com\./i)).toBeInTheDocument();
      expect(submitBtn).not.toBeDisabled();
    }, FAST_WAIT);

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(provisionDevice).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'linked',
          tenant_id: 'tenant-cloud-123',
          device_credential_id: 'term-cloud-1',
        }),
      );
      expect(mockOnProvisioned).toHaveBeenCalled();
    }, FAST_WAIT);
  });

  it('Tablet shell in Mode 2 renders QR device pairing and polls session', async () => {
    vi.useFakeTimers();
    vi.mocked(isTabletShell).mockReturnValue(true);
    vi.mocked(startDevicePairing).mockResolvedValueOnce({
      code: 'ABCD1234',
      poll_token: 'poll-token-xyz',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      qr_url: 'https://kasir.mu/pair?code=ABCD1234',
    });
    vi.mocked(pollDevicePairing)
      .mockResolvedValueOnce({
        status: 'pending',
      })
      .mockResolvedValueOnce({
        status: 'claimed',
        tenant_id: 'tenant-tablet-456',
        email: 'tablet-merchant@example.com',
        terminal: {
          terminalId: 'term-tab-1',
          issued: true,
        },
      });

    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // Switch to Mode 2
    fireEvent.click(screen.getByTestId('provision-mode-linked'));

    // Tablet subtabs exist
    expect(screen.getByRole('tab', { name: /QR Pairing/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Email Code/i })).toBeInTheDocument();

    // Flush startDevicePairing microtasks
    await vi.runOnlyPendingTimersAsync();

    expect(startDevicePairing).toHaveBeenCalledWith('Tablet POS');
    expect(screen.getByTestId('pairing-code-badge')).toHaveTextContent('ABCD - 1234');
    expect(screen.getByTestId('pairing-qr-wrapper')).toBeInTheDocument();

    // Advance 3s to trigger second poll which claims device
    await vi.advanceTimersByTimeAsync(3000);

    expect(pollDevicePairing).toHaveBeenCalledWith('poll-token-xyz');
    expect(screen.getByText(/Linked to tablet-merchant@example\.com\./i)).toBeInTheDocument();

    vi.useRealTimers();

    fillBasicForm();
    const submitBtn = screen.getByTestId('provision-submit');
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(provisionDevice).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'linked',
          tenant_id: 'tenant-tablet-456',
          device_credential_id: 'term-tab-1',
        }),
      );
    }, FAST_WAIT);
  });

  it('Tablet shell in Mode 2 allows manual email identification leg', async () => {
    vi.mocked(isTabletShell).mockReturnValue(true);
    vi.mocked(startDevicePairing).mockResolvedValueOnce({
      code: 'ABCD1234',
      poll_token: 'poll-token-xyz',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      qr_url: 'https://kasir.mu/pair?code=ABCD1234',
    });
    vi.mocked(requestDeviceLinkCode).mockResolvedValueOnce(undefined as any);
    vi.mocked(consumeDeviceLinkCode).mockResolvedValueOnce({
      tenantId: 'tenant-email-789',
      email: 'owner-tablet@example.com',
      verified: true,
      terminal: {
        terminalId: 'term-email-1',
        issued: true,
      },
    });

    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // Switch to Mode 2
    fireEvent.click(screen.getByTestId('provision-mode-linked'));

    // Switch to Email Code subtab
    const emailTab = screen.getByRole('tab', { name: /Email Code/i });
    fireEvent.click(emailTab);
    expect(emailTab.getAttribute('aria-selected')).toBe('true');

    // Input email and send code
    const emailInput = screen.getByPlaceholderText(/Email address/i);
    fireEvent.change(emailInput, { target: { value: 'owner-tablet@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Email me a code/i }));

    await waitFor(() => {
      expect(requestDeviceLinkCode).toHaveBeenCalledWith('owner-tablet@example.com');
      expect(screen.getByPlaceholderText(/Verification code/i)).toBeInTheDocument();
    }, FAST_WAIT);

    // Input code and verify
    const codeInput = screen.getByPlaceholderText(/Verification code/i);
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }));

    await waitFor(() => {
      expect(consumeDeviceLinkCode).toHaveBeenCalledWith('123456');
      expect(screen.getByText(/Linked to owner-tablet@example\.com\./i)).toBeInTheDocument();
    }, FAST_WAIT);

    fillBasicForm();
    const submitBtn = screen.getByTestId('provision-submit');
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(provisionDevice).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'linked',
          tenant_id: 'tenant-email-789',
          device_credential_id: 'term-email-1',
        }),
      );
    }, FAST_WAIT);
  });
});

