import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LicenseActivationScreen from '@/features/auth/LicenseActivationScreen';

// ── Mocks ──────────────────────────────────────────────────────────────

const mockActivateLicense = vi.fn();
const mockGetHardwareFingerprint = vi.fn();
const mockGetMachineId = vi.fn();
const mockRequestEmailLoginCode = vi.fn();
const mockVerifyEmailLoginCode = vi.fn();
const mockLoginWithEmailPassword = vi.fn();

vi.mock('@/api/license', () => ({
  activateLicense: (...args: unknown[]) => mockActivateLicense(...args),
  getHardwareFingerprint: () => mockGetHardwareFingerprint(),
  getMachineId: () => mockGetMachineId(),
  // The desktop-link email login trio (ADR #54 §2.6). Without these exports the
  // mocked module has no such name, so a case that reaches the email flow throws
  // "No requestEmailLoginCode export is defined on the @/api/license mock".
  requestEmailLoginCode: (...args: unknown[]) => mockRequestEmailLoginCode(...args),
  verifyEmailLoginCode: (...args: unknown[]) => mockVerifyEmailLoginCode(...args),
  loginWithEmailPassword: (...args: unknown[]) => mockLoginWithEmailPassword(...args),
  // StatusBar's auth-pill poll (co-consumer of this module). The live screen
  // renders StatusBar, so `useAuthConnection` reads this key on mount: a mock
  // without it throws `No "testAuthConnection" export is defined on the
  // "@/api/license" mock`, which unmounts the whole tree and fails the file.
  testAuthConnection: () =>
    Promise.resolve({ ok: true, status: 'Connected', latencyMs: 10 }),
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

vi.mock('@/app/ThemeToggle', () => ({
  default: () => <div data-testid="theme-toggle" />,
}));

const mockAddToast = vi.fn();
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@fluent/react', () => ({
  Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
  useLocalization: () => ({
    l10n: {
      getString: (id: string) => {
        const map: Record<string, string> = {
          'auth-activate-title': 'Setup',
          'auth-activate-subtitle': 'Sign in or link this device to get started',
          'auth-setup-title': 'How would you like to get started?',
          'auth-setup-google': 'Sign in with Google',
          'auth-setup-google-desc': 'Sign in, or create an account automatically if you are new.',
          'auth-setup-pair': 'Pair this device to your organization',
          'auth-setup-pair-desc': 'Scan a code from a phone or another terminal that is already set up.',
          'auth-setup-email': 'Sign in with Email',
          'auth-setup-email-desc': 'Get a one-time code by email, or sign in with your password.',
          'auth-setup-back': 'Back',
          'auth-setup-waiting-browser': 'Waiting for your browser to finish signing in…',
          'auth-setup-google-failed': 'Could not sign in with Google. Please try again.',
          'auth-email-label': 'Email Address',
          'auth-email-placeholder': 'you@example.com',
          // Desktop-link email login (ADR #54 §2.6): address -> code, or
          // address -> password when the account has one.
          'auth-email-step-title': 'Sign in with your email address',
          'auth-email-send-code': 'Send code',
          'auth-email-use-password': 'Use a password instead',
          'auth-email-code-title': 'Enter the code we emailed you',
          'auth-email-code-label': 'Sign-in code',
          'auth-email-code-placeholder': '6-digit code',
          'auth-email-verify': 'Verify code',
          'auth-email-password-title': 'Sign in with your password',
          'auth-email-password-label': 'Password',
          'auth-email-password-submit': 'Sign in',
          'auth-email-back': 'Use a different email address',
          'auth-email-failed': 'Could not sign in. Check the address and your connection, then try again.',
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
          'auth-ip-local': 'Local : {ip}',
          'auth-ip-public': 'Public : {ip}',
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

  // The screen opens on a CHOICE (Google / email / pair), not on the license-key
  // form,
  // so every case written against the old single-view screen must first step
  // through the choice. Centralised here so a future change to the entry
  // screen updates one place instead of ~70 assertions.
  function openLicenseKeyForm() {
    fireEvent.click(screen.getByTestId('setup-license-key'));
  }

  function renderOnForm() {
    render(<LicenseActivationScreen onActivated={onActivated} />);
    openLicenseKeyForm();
  }


  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMachineId.mockResolvedValue('machine-123');
    mockGetHardwareFingerprint.mockResolvedValue('fp-abc');
  });

  it('opens on the setup choice, then reaches the activation form', () => {
    render(<LicenseActivationScreen onActivated={onActivated} />);
    // Entry screen: the two ways in, and the page is titled "Setup".
    expect(screen.getByRole('heading', { name: 'Setup' })).toBeInTheDocument();
    expect(screen.getByTestId('setup-google')).toBeInTheDocument();
    expect(screen.getByTestId('setup-email')).toBeInTheDocument();
    expect(screen.getByTestId('setup-pair')).toBeInTheDocument();

    openLicenseKeyForm();
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone Number')).toBeInTheDocument();
    expect(screen.getByLabelText('License Key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate License' })).toBeInTheDocument();
  });

  it('renders version and IP info', async () => {
    renderOnForm();
    // The IP is set async via getLocalIp mock — use regex for whitespace
    const ipEl = await screen.findByText(/192\.168\.1\.1/, {}, { timeout: 5000 });
    expect(ipEl).toBeInTheDocument();
  });

  it('shows error when submitting empty form', async () => {
    renderOnForm();
    
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
    renderOnForm();
    
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
    renderOnForm();
    
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
    renderOnForm();
    
    await user.type(screen.getByLabelText('Email Address'), 'test@example.com');
    await user.type(screen.getByLabelText('Phone Number'), '12345');
    await user.type(screen.getByLabelText('License Key'), 'TEST-KEY-1234');
    await user.click(screen.getByRole('button', { name: 'Activate License' }));
    
    await screen.findByText('Invalid phone');
  });

  it('activates successfully with valid inputs', async () => {
    mockActivateLicense.mockResolvedValue(true);
    const user = userEvent.setup();
    renderOnForm();
    
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
    renderOnForm();
    
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
    renderOnForm();
    
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
    renderOnForm();
    
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
    renderOnForm();
    
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
    // The banner must be on the first screen the merchant sees, not only on the
    // license-key form behind it.
    expect(screen.getByText('Previous activation failed')).toBeInTheDocument();
  });

  it('clears email when clear button clicked', async () => {
    const user = userEvent.setup();
    renderOnForm();
    
    await user.type(screen.getByLabelText('Email Address'), 'test@example.com');
    const clearBtn = screen.getByLabelText('Clear email');
    await user.click(clearBtn);
    expect(screen.getByLabelText('Email Address')).toHaveValue('');
  });

  it('clears phone when clear button clicked', async () => {
    const user = userEvent.setup();
    renderOnForm();
    
    await user.type(screen.getByLabelText('Phone Number'), '1234567890');
    const clearBtn = screen.getByLabelText('Clear phone');
    await user.click(clearBtn);
    expect(screen.getByLabelText('Phone Number')).toHaveValue('');
  });

  it('clears license key when clear button clicked', async () => {
    const user = userEvent.setup();
    renderOnForm();
    
    await user.type(screen.getByLabelText('License Key'), 'TEST-KEY');
    const clearBtn = screen.getByLabelText('Clear key');
    await user.click(clearBtn);
    expect(screen.getByLabelText('License Key')).toHaveValue('');
  });
});

// ── Desktop-link email login (ADR #54 §2.6) ─────────────────────────────
//
// The third way in, beside Google and pairing: the screen walks address -> code,
// or address -> password when the account has one. All three commands are
// registered on BOTH shells (request_email_login_code / verify_email_login_code /
// login_with_email_password), so these cases pin the contract the Rust side and
// this screen now share.
describe('LicenseActivationScreen — email login', () => {
  const onActivated = vi.fn();

  function renderEmailFlow() {
    render(<LicenseActivationScreen onActivated={onActivated} />);
    fireEvent.click(screen.getByTestId('setup-email'));
  }

  async function sendCode(user: ReturnType<typeof userEvent.setup>, address = 'owner@kasir.mu') {
    await user.type(screen.getByTestId('email-login-address-input'), address);
    await user.click(screen.getByTestId('email-login-send-code'));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMachineId.mockResolvedValue('machine-123');
    mockGetHardwareFingerprint.mockResolvedValue('fp-abc');
    mockRequestEmailLoginCode.mockResolvedValue(undefined);
    mockVerifyEmailLoginCode.mockResolvedValue(undefined);
    mockLoginWithEmailPassword.mockResolvedValue(undefined);
  });

  it('opens from the choice and starts on the address step alone', () => {
    renderEmailFlow();
    expect(screen.getByTestId('license-email-view')).toBeInTheDocument();
    expect(screen.getByTestId('email-login-address-input')).toBeInTheDocument();
    // The other two steps mount only once their step is reached, so the screen
    // never shows a code field before a code has been asked for.
    expect(screen.queryByTestId('email-login-code-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('email-login-password-input')).not.toBeInTheDocument();
  });

  it('sends a one-time code to the TRIMMED address and advances to the code step', async () => {
    const user = userEvent.setup();
    renderEmailFlow();

    await sendCode(user, '  owner@kasir.mu  ');

    await waitFor(() => expect(mockRequestEmailLoginCode).toHaveBeenCalledWith('owner@kasir.mu'));
    expect(screen.getByTestId('email-login-code-input')).toBeInTheDocument();
    expect(screen.queryByTestId('email-login-address-input')).not.toBeInTheDocument();
  });

  it('spends the code and reports the device linked', async () => {
    const user = userEvent.setup();
    renderEmailFlow();
    await sendCode(user);

    await user.type(screen.getByTestId('email-login-code-input'), '123456');
    await user.click(screen.getByTestId('email-login-verify'));

    await waitFor(() => expect(mockVerifyEmailLoginCode).toHaveBeenCalledWith('owner@kasir.mu', '123456'));
    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1));
  });

  it('signs in with the password instead, without ever requesting a code', async () => {
    const user = userEvent.setup();
    renderEmailFlow();

    await user.type(screen.getByTestId('email-login-address-input'), 'owner@kasir.mu');
    await user.click(screen.getByTestId('email-login-use-password'));
    await user.type(screen.getByTestId('email-login-password-input'), 's3cret-pass');
    await user.click(screen.getByTestId('email-login-submit-password'));

    await waitFor(() => expect(mockLoginWithEmailPassword).toHaveBeenCalledWith('owner@kasir.mu', 's3cret-pass'));
    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1));
    expect(mockRequestEmailLoginCode).not.toHaveBeenCalled();
  });

  it('names the failure inline and stays on the address step when the code cannot be sent', async () => {
    const user = userEvent.setup();
    mockRequestEmailLoginCode.mockRejectedValue(new Error('offline'));
    renderEmailFlow();

    await sendCode(user);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not sign in. Check the address and your connection, then try again.',
      ),
    );
    // The step did not advance, so the operator can correct the address and retry.
    expect(screen.getByTestId('email-login-address-input')).toBeInTheDocument();
    expect(onActivated).not.toHaveBeenCalled();
  });

  it('goes back to the address step and drops the code', async () => {
    const user = userEvent.setup();
    renderEmailFlow();
    await sendCode(user);
    await user.type(screen.getByTestId('email-login-code-input'), '999999');

    await user.click(screen.getByTestId('email-login-back'));

    expect(screen.getByTestId('email-login-address-input')).toBeInTheDocument();
    expect(screen.queryByTestId('email-login-code-input')).not.toBeInTheDocument();
  });
});

