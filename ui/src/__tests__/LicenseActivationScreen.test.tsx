import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LicenseActivationScreen from '@/features/auth/LicenseActivationScreen';

// ── Mocks ──────────────────────────────────────────────────────────────

const mockActivateLicense = vi.fn();
const mockGetHardwareFingerprint = vi.fn();
const mockGetMachineId = vi.fn();

vi.mock('@/api/license', () => ({
  activateLicense: (...args: unknown[]) => mockActivateLicense(...args),
  getHardwareFingerprint: () => mockGetHardwareFingerprint(),
  getMachineId: () => mockGetMachineId(),
}));

vi.mock('@/api/system', () => ({
  getVersion: () => Promise.resolve({ version: '0.0.28', name: 'oz-pos', rustVersion: '1.77', target: 'x86_64' }),
  getLocalIp: () => Promise.resolve('192.168.1.1'),
}));

vi.mock('@/utils/trial-vertical', () => ({
  detectTrialVertical: () => '',
}));

vi.mock('@/utils/bundle', () => ({
  detectBundleId: () => '',
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: () => Promise.resolve(''),
}));

vi.mock('@/components/ConnectionStatus', () => ({
  default: ({ label }: { label: string }) => <div data-testid="connection-status">{label}</div>,
}));

vi.mock('@/frontend/shell/ThemeToggle', () => ({
  default: () => <div data-testid="theme-toggle" />,
}));

const mockAddToast = vi.fn();
vi.mock('@/frontend/shared/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@fluent/react', () => ({
  Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
  useLocalization: () => ({
    l10n: {
      getString: (id: string) => {
        const map: Record<string, string> = {
          'auth-activate-title': 'Activate License',
          'auth-activate-subtitle': 'Enter your information below',
          'auth-email-label': 'Email Address',
          'auth-email-placeholder': 'you@example.com',
          'auth-phone-label': 'Phone Number',
          'auth-phone-placeholder': '+62 812 3456 7890',
          'auth-license-label': 'License Key',
          'auth-license-placeholder': 'XXXX-XXXX-XXXX',
          'auth-activate-button': 'Activate License',
          'auth-activating': 'Activating...',
          'auth-validation-required': 'All fields are required',
          'auth-validation-invalid-email': 'Invalid email',
          'auth-validation-phone-required': 'Phone is required',
          'auth-validation-invalid-phone': 'Invalid phone',
          'auth-activation-success': 'License activated!',
          'auth-activation-failed': 'Activation failed',
          'auth-activation-error': 'Activation error',
          'auth-error-title': 'Error',
          'auth-clear-email': 'Clear email',
          'auth-clear-phone': 'Clear phone',
          'auth-clear-key': 'Clear key',
          'auth-ip-detecting': 'Detecting...',
          'auth-ip-unknown': 'Unknown',
          'auth-paste': 'Paste',
          'auth-version': 'Version {version}',
          'auth-ip-address': 'IP Address : {ip}',
          'auth-copyright': 'kasir.mu © {year} All rights reserved.',
          'staff-login-connection-auth': 'Auth Server',
          'staff-login-connection-sync': 'Sync Server',
        };
        return map[id] || id;
      },
    },
  }),
}));

// ── Tests ──────────────────────────────────────────────────────────────

describe('LicenseActivationScreen', () => {
  const onActivated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMachineId.mockResolvedValue('machine-123');
    mockGetHardwareFingerprint.mockResolvedValue('fp-abc');
  });

  it('renders the activation form', () => {
    render(<LicenseActivationScreen onActivated={onActivated} />);
    expect(screen.getByRole('heading', { name: 'Activate License' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone Number')).toBeInTheDocument();
    expect(screen.getByLabelText('License Key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate License' })).toBeInTheDocument();
  });

  it('renders version and IP info', async () => {
    render(<LicenseActivationScreen onActivated={onActivated} />);
    // The IP is set async via getLocalIp mock — use regex for whitespace
    const ipEl = await screen.findByText(/192\.168\.1\.1/, {}, { timeout: 5000 });
    expect(ipEl).toBeInTheDocument();
  });

  it('shows error when submitting empty form', async () => {
    render(<LicenseActivationScreen onActivated={onActivated} />);
    
    // Button is disabled when fields are empty — use fireEvent.submit on the form
    const form = document.querySelector('form')!;
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(screen.getByText('All fields are required')).toBeInTheDocument();
    expect(mockActivateLicense).not.toHaveBeenCalled();
  });

  it('shows error for invalid email', async () => {
    const user = userEvent.setup();
    render(<LicenseActivationScreen onActivated={onActivated} />);
    
    await user.type(screen.getByLabelText('Email Address'), 'not-an-email');
    await user.type(screen.getByLabelText('Phone Number'), '1234567890');
    await user.type(screen.getByLabelText('License Key'), 'TEST-KEY-1234');
    
    const form = document.querySelector('form')!;
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(screen.getByText('Invalid email')).toBeInTheDocument();
  });

  it('shows error for missing phone', async () => {
    const user = userEvent.setup();
    render(<LicenseActivationScreen onActivated={onActivated} />);
    
    await user.type(screen.getByLabelText('Email Address'), 'test@example.com');
    await user.type(screen.getByLabelText('License Key'), 'TEST-KEY-1234');
    
    const form = document.querySelector('form')!;
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(screen.getByText('Phone is required')).toBeInTheDocument();
  });

  it('shows error for short phone number', async () => {
    const user = userEvent.setup();
    render(<LicenseActivationScreen onActivated={onActivated} />);
    
    await user.type(screen.getByLabelText('Email Address'), 'test@example.com');
    await user.type(screen.getByLabelText('Phone Number'), '12345');
    await user.type(screen.getByLabelText('License Key'), 'TEST-KEY-1234');
    await user.click(screen.getByRole('button', { name: 'Activate License' }));
    
    await screen.findByText('Invalid phone');
  });

  it('activates successfully with valid inputs', async () => {
    mockActivateLicense.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<LicenseActivationScreen onActivated={onActivated} />);
    
    await user.type(screen.getByLabelText('Email Address'), 'test@example.com');
    await user.type(screen.getByLabelText('Phone Number'), '+6281234567890');
    await user.type(screen.getByLabelText('License Key'), 'TEST-KEY-1234');
    await user.click(screen.getByRole('button', { name: 'Activate License' }));
    
    await waitFor(() => {
      expect(mockActivateLicense).toHaveBeenCalled();
      expect(onActivated).toHaveBeenCalled();
    });
  });

  it('shows error when activation returns false', async () => {
    mockActivateLicense.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<LicenseActivationScreen onActivated={onActivated} />);
    
    await user.type(screen.getByLabelText('Email Address'), 'test@example.com');
    await user.type(screen.getByLabelText('Phone Number'), '+6281234567890');
    await user.type(screen.getByLabelText('License Key'), 'TEST-KEY-1234');
    await user.click(screen.getByRole('button', { name: 'Activate License' }));
    
    await waitFor(() => {
      expect(screen.getByText('Activation failed')).toBeInTheDocument();
    });
  });

  it('shows error toast when activation throws', async () => {
    mockActivateLicense.mockRejectedValue(new Error('Server error'));
    const user = userEvent.setup();
    render(<LicenseActivationScreen onActivated={onActivated} />);
    
    await user.type(screen.getByLabelText('Email Address'), 'test@example.com');
    await user.type(screen.getByLabelText('Phone Number'), '+6281234567890');
    await user.type(screen.getByLabelText('License Key'), 'TEST-KEY-1234');
    await user.click(screen.getByRole('button', { name: 'Activate License' }));
    
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
    });
  });

  it('disables submit button while loading', async () => {
    mockActivateLicense.mockReturnValue(new Promise(() => {})); // never resolves
    const user = userEvent.setup();
    render(<LicenseActivationScreen onActivated={onActivated} />);
    
    await user.type(screen.getByLabelText('Email Address'), 'test@example.com');
    await user.type(screen.getByLabelText('Phone Number'), '+6281234567890');
    await user.type(screen.getByLabelText('License Key'), 'TEST-KEY-1234');
    await user.click(screen.getByRole('button', { name: 'Activate License' }));
    
    await waitFor(() => {
      expect(screen.getByText('Activating...')).toBeInTheDocument();
    });
  });

  it('uppercases license key input', async () => {
    const user = userEvent.setup();
    render(<LicenseActivationScreen onActivated={onActivated} />);
    
    await user.type(screen.getByLabelText('License Key'), 'test-key');
    expect(screen.getByLabelText('License Key')).toHaveValue('TEST-KEY');
  });

  it('shows initialError when provided', () => {
    render(
      <LicenseActivationScreen
        onActivated={onActivated}
        initialError="Previous activation failed"
      />,
    );
    expect(screen.getByText('Previous activation failed')).toBeInTheDocument();
  });

  it('clears email when clear button clicked', async () => {
    const user = userEvent.setup();
    render(<LicenseActivationScreen onActivated={onActivated} />);
    
    await user.type(screen.getByLabelText('Email Address'), 'test@example.com');
    const clearBtn = screen.getByLabelText('Clear email');
    await user.click(clearBtn);
    expect(screen.getByLabelText('Email Address')).toHaveValue('');
  });

  it('clears phone when clear button clicked', async () => {
    const user = userEvent.setup();
    render(<LicenseActivationScreen onActivated={onActivated} />);
    
    await user.type(screen.getByLabelText('Phone Number'), '1234567890');
    const clearBtn = screen.getByLabelText('Clear phone');
    await user.click(clearBtn);
    expect(screen.getByLabelText('Phone Number')).toHaveValue('');
  });

  it('clears license key when clear button clicked', async () => {
    const user = userEvent.setup();
    render(<LicenseActivationScreen onActivated={onActivated} />);
    
    await user.type(screen.getByLabelText('License Key'), 'TEST-KEY');
    const clearBtn = screen.getByLabelText('Clear key');
    await user.click(clearBtn);
    expect(screen.getByLabelText('License Key')).toHaveValue('');
  });
});
