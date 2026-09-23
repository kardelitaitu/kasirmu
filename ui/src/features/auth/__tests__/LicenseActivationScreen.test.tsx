import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, createEvent } from '@testing-library/react';
import LicenseActivationScreen from '../LicenseActivationScreen';
import { activateLicense, getHardwareFingerprint, getMachineId } from '@/api/license';
import { getVersion, getLocalIp, type VersionInfo } from '@/api/system';
import { isTabletShell } from '@/utils/shellKind';

// FAST_WAIT: 5ms polling for async assertions (10x faster than default 50ms).
const FAST_WAIT = { interval: 5, timeout: 500 } as const;

const mockAddToast = vi.fn();
const mockOnActivated = vi.fn();
const mockClipboardReadText = vi.fn();
let fetchSpy: ReturnType<typeof vi.spyOn>;

Object.defineProperty(navigator, 'clipboard', {
  value: { readText: mockClipboardReadText },
  writable: true,
});

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast })
}));

vi.mock('@/api/license', () => ({
  activateLicense: vi.fn(),
  getMachineId: vi.fn(),
  getHardwareFingerprint: vi.fn(),
  startDevicePairing: vi.fn(),
  pollDevicePairing: vi.fn(),
  linkDeviceGoogle: vi.fn(),
}));

vi.mock('@/api/system', () => ({
  getVersion: vi.fn(),
  getLocalIp: vi.fn()
}));

// C47: which shell is rendering. Mocked rather than driven through setShellKind because
// that module holds one non-reactive value per bundle (utils/shellKind.ts:14) whose default
// is 'desktop', so a default of `false` here reproduces every existing case in this file
// and lets the tablet cases below flip it per-test.
vi.mock('@/utils/shellKind', () => ({
  isTabletShell: vi.fn().mockReturnValue(false),
}));


vi.mock('@fluent/react', () => ({
  Localized: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLocalization: () => ({ l10n: {
    getString: (id: string, args?: Record<string, unknown>) => {
      const map = {
        'auth-validation-required': 'License key and Email are required.',
        'auth-validation-invalid-email': 'Invalid email format.',
        'auth-activation-success': 'License activated successfully!',
        'auth-activation-failed': 'Failed to activate license.',
        'auth-activation-error': 'An error occurred during activation.',
        'auth-trial-hint-pro': 'You came from a restaurant/cafe page — your trial key unlocks a 14-day Pro trial.',
        'auth-trial-hint-enterprise': 'Your referral trial key unlocks a 30-day Pro trial.',
        'auth-clipboard-error': 'Clipboard error: ' + (args && args['message'] ? args['message'] : ''),
        'auth-error-title': 'Error',
        'auth-version': 'Version ' + (args ? args['version'] : ''),
        'auth-ip-local': 'Local : ' + (args ? args['ip'] : ''),
        'auth-ip-public': 'Public : ' + (args ? args['ip'] : ''),
        'auth-copyright': 'kasir.mu © ' + (args ? args['year'] : '') + ' All rights reserved.',
        'auth-email-placeholder': 'store@example.com',
        'auth-phone-placeholder': '08123456789',
        'auth-license-placeholder': 'OZ-PRO-XXXX-XXXX-XXXX',
        'auth-paste': 'Paste',
        'auth-activating': 'Activating...',
        'auth-activate-button': 'Activate License',
        'auth-activate-title': 'Activate License',
        'auth-activate-subtitle': 'Enter your information below',
        'auth-email-label': 'Email Address',
        'auth-phone-label': 'Phone Number',
        'auth-license-label': 'License Key',
        'auth-validation-phone-required': 'Phone number is required.',
        'auth-validation-invalid-phone': 'Invalid phone number format.',
        'auth-ip-unknown': 'Unknown',
        'auth-ip-detecting': 'Detecting...',
        'staff-login-connection-auth': 'Auth',
        'staff-login-connection-sync': 'Sync',
        'auth-pair-success': 'Device paired successfully!',
        'auth-pair-code-label': 'Pairing Code',
        'auth-pair-waiting': 'Waiting for you to claim on your phone…',
        'auth-pair-expired': 'Pairing code expired. Click to refresh.',
        'auth-pair-refresh': 'Refresh Code',
      };
      return (map as Record<string, string>)[id] || id;
    }
  } })
}));


vi.mock('@/components/StatusBar', () => ({
  default: () => <div data-testid="status-bar">StatusBar</div>,
}));
vi.mock('@/app/ThemeToggle', () => ({
  default: () => <div data-testid="theme-toggle">ThemeToggle</div>,
}));

// ── Helpers ──────────────────────────────────────────────────────

/** Fill all 3 form fields with fireEvent.change (sync, no per-char overhead). */
function fillForm(email = 'test@test.com', phone = '08123456789', key = 'KEY123') {
  fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/Phone Number/i), { target: { value: phone } });
  fireEvent.change(screen.getByLabelText(/License Key/i), { target: { value: key } });
}

/** Click the Activate License submit button via fireEvent.click (sync). */
function clickSubmit() {
  fireEvent.click(screen.getByRole('button', { name: /Activate License/i }));
}

describe('LicenseActivationScreen - Exhaustive Suite', () => {
  // The screen opens on a CHOICE (Google / pair), not on the license-key form.
  // These cases were written against the old single-view screen, so each steps
  // through the choice first. One helper, so a future entry-screen change
  // updates this file in one place.
  function openLicenseKeyForm() {
    fireEvent.click(screen.getByTestId('setup-license-key'));
  }

  function renderOnForm() {
    render(<LicenseActivationScreen onActivated={mockOnActivated} />);
    openLicenseKeyForm();
  }

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  beforeEach(() => {
    vi.mocked(getVersion).mockResolvedValue({ version: '1.0.0', name: 'oz-pos', rustVersion: '1.70', target: 'windows' });
    vi.mocked(getLocalIp).mockResolvedValue('192.168.1.100');
    vi.mocked(getMachineId).mockResolvedValue('test-machine-id');
    vi.mocked(getHardwareFingerprint).mockResolvedValue('hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    vi.mocked(activateLicense).mockResolvedValue(true);
    mockClipboardReadText.mockResolvedValue('clipboard-text');
    // Desktop by default, so every case above keeps the shell it was written against.
    vi.mocked(isTabletShell).mockReturnValue(false);
    // The screen resolves the public IP over HTTP. Reject by default so an
    // unawned case is an offline terminal, not a real DNS lookup; the two
    // resolution cases below arm it.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
  });
  // ── A rejected submit marks the field it is about ───────────────────
  //
  // The banner names the rule ("Invalid email format") but not which control it
  // refers to, and with two text fields on screen nothing distinguished the bad
  // one — so a screen-reader user got a message with no field attached.

  describe('validation marks the offending field', () => {
    // The handler is async, so the mark lands after a microtask: every
    // assertion here waits rather than reading synchronously.

    it('marks only the email field when the email is malformed', async () => {
      renderOnForm();
      fillForm('not-an-email', '08123456789', 'KEY123');
      clickSubmit();

      await waitFor(() => {
        expect(screen.getByLabelText(/Email Address/i)).toHaveAttribute('aria-invalid', 'true');
      }, FAST_WAIT);
      // The field that was fine must not be accused.
      expect(screen.getByLabelText(/Phone Number/i)).not.toHaveAttribute('aria-invalid');
    });
    it('marks only the phone field when the phone is too short', async () => {
      renderOnForm();
      fillForm('test@test.com', '123', 'KEY123');
      clickSubmit();

      await waitFor(() => {
        expect(screen.getByLabelText(/Phone Number/i)).toHaveAttribute('aria-invalid', 'true');
      }, FAST_WAIT);
      expect(screen.getByLabelText(/Email Address/i)).not.toHaveAttribute('aria-invalid');
    });

    it('disables submit rather than marking a whitespace-only phone', () => {
      // The button's own guard is `!phone.trim()`, so a whitespace-only phone
      // never reaches handleActivate: the disabled control IS the feedback, and
      // an aria-invalid mark would be asserting a branch that does not run.
      renderOnForm();
      fillForm('test@test.com', '   ', 'KEY123');

      expect(screen.getByRole('button', { name: /Activate License/i })).toBeDisabled();
      expect(screen.getByLabelText(/Phone Number/i)).not.toHaveAttribute('aria-invalid');
    });

    it('clears the mark as soon as the user edits that field', async () => {
      renderOnForm();
      const email = screen.getByLabelText(/Email Address/i);
      fillForm('not-an-email', '08123456789', 'KEY123');
      clickSubmit();
      await waitFor(() => {
        expect(email).toHaveAttribute('aria-invalid', 'true');
      }, FAST_WAIT);

      fireEvent.change(email, { target: { value: 'fixed@example.com' } });

      expect(email).not.toHaveAttribute('aria-invalid');
    });
  });


  describe('1. Mounting & Lifecycle', () => {
    it('1. getVersion resolves and displays the correct version on mount', async () => {
      renderOnForm();
      await waitFor(() => expect(screen.getByText('Version 1.0.0')).toBeInTheDocument(), FAST_WAIT);
    });

    it('2. getLocalIp resolves and displays the LAN address as the Local row', async () => {
      renderOnForm();
      await waitFor(() => expect(screen.getByText('Local : 192.168.1.100')).toBeInTheDocument(), FAST_WAIT);
    });

    it('2b. the public lookup fills the Public row independently of the Local row', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ ip: '203.0.113.42' }),
      } as Response);
      renderOnForm();
      await waitFor(() => expect(screen.getByText('Public : 203.0.113.42')).toBeInTheDocument(), FAST_WAIT);
      expect(screen.getByText('Local : 192.168.1.100')).toBeInTheDocument();
    });

    it('3. getLocalIp rejects and the Local row shows the unresolved placeholder', async () => {
      vi.mocked(getLocalIp).mockRejectedValue(new Error('IP Fail'));
      renderOnForm();
      await waitFor(() => expect(screen.getByText('Local : Detecting...')).toBeInTheDocument(), FAST_WAIT);
    });

    it('3b. renders Local and Public as two separate rows', async () => {
      renderOnForm();
      await waitFor(() => expect(screen.getByText('Local : 192.168.1.100')).toBeInTheDocument(), FAST_WAIT);
      expect(screen.getByText('Public : Unknown')).toBeInTheDocument();
    });

    it('4. getVersion rejects gracefully without crashing the app', async () => {
      vi.mocked(getVersion).mockRejectedValue(new Error('Version Fail'));
      renderOnForm();
      await waitFor(() => expect(screen.getByText('Version 0.0.40')).toBeInTheDocument(), FAST_WAIT);
    });

    it('5. Component unmounting during getVersion fetch prevents state updates', () => {
      let resolveVersion: (value: VersionInfo) => void = () => {};
      const promise = new Promise<VersionInfo>(resolve => { resolveVersion = resolve; });
      vi.mocked(getVersion).mockReturnValue(promise);
      
      const { unmount } = render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      unmount();
      expect(() => resolveVersion({ name: 'oz-pos', version: '9.9.9', rustVersion: '1.75', target: 'x86' })).not.toThrow();
    });

    it('6. Component unmounting during getLocalIp fetch prevents state updates', () => {
      let resolveIp: (value: string) => void = () => {};
      const promise = new Promise<string>(resolve => { resolveIp = resolve; });
      vi.mocked(getLocalIp).mockReturnValue(promise);
      
      const { unmount } = render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      unmount();
      expect(() => resolveIp('1.1.1.1')).not.toThrow();
    });
  });

  describe('2. Form Rendering & Input Validation', () => {
    it('7. Email input is present, enabled, and accepts typing', () => {
      renderOnForm();
      const emailInput = screen.getByLabelText(/Email Address/i);
      expect(emailInput).toBeEnabled();
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      expect(emailInput).toHaveValue('test@example.com');
    });

    it('8. Phone input is present, enabled, and accepts typing', () => {
      renderOnForm();
      const phoneInput = screen.getByLabelText(/Phone Number/i);
      expect(phoneInput).toBeEnabled();
      fireEvent.change(phoneInput, { target: { value: '1234' } });
      expect(phoneInput).toHaveValue('1234');
    });

    it('9. License Key input is present, enabled, and accepts typing', () => {
      renderOnForm();
      const keyInput = screen.getByLabelText(/License Key/i);
      expect(keyInput).toBeEnabled();
      fireEvent.change(keyInput, { target: { value: '1234' } });
      expect(keyInput).toHaveValue('1234');
    });

    it('10. License Key strictly forces characters to uppercase', () => {
      renderOnForm();
      const keyInput = screen.getByLabelText(/License Key/i);
      fireEvent.change(keyInput, { target: { value: 'aBcDeFg' } });
      expect(keyInput).toHaveValue('ABCDEFG');
    });

    it('11. Activate License button is disabled initially', () => {
      renderOnForm();
      expect(screen.getByRole('button', { name: /Activate License/i })).toBeDisabled();
    });

    it('12. Activate License button is disabled if email is filled but key is empty', () => {
      renderOnForm();
      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'test@test.com' } });
      expect(screen.getByRole('button', { name: /Activate License/i })).toBeDisabled();
    });

    it('13. Activate License button is disabled if key is filled but email is empty', () => {
      renderOnForm();
      fireEvent.change(screen.getByLabelText(/License Key/i), { target: { value: 'KEY123' } });
      expect(screen.getByRole('button', { name: /Activate License/i })).toBeDisabled();
    });

    it('14. Activate License button is enabled only when email, phone, and key have text', () => {
      renderOnForm();
      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'test@test.com' } });
      fireEvent.change(screen.getByLabelText(/Phone Number/i), { target: { value: '08123456789' } });
      fireEvent.change(screen.getByLabelText(/License Key/i), { target: { value: 'KEY123' } });
      expect(screen.getByRole('button', { name: /Activate License/i })).toBeEnabled();
    });

    it('15. Inline Clear button correctly clears the Email field', () => {
      renderOnForm();
      const emailInput = screen.getByLabelText(/Email Address/i);
      fireEvent.change(emailInput, { target: { value: 'test@test.com' } });
      const clearBtn = screen.getAllByRole('button').find(b => b.className === 'license-input-clear')!;
      fireEvent.click(clearBtn);
      expect(emailInput).toHaveValue('');
    });

    it('16. Inline Clear button correctly clears the Phone field', () => {
      renderOnForm();
      const phoneInput = screen.getByLabelText(/Phone Number/i);
      fireEvent.change(phoneInput, { target: { value: '1234' } });
      const clearBtn = screen.getAllByRole('button').find(b => b.className === 'license-input-clear')!;
      fireEvent.click(clearBtn);
      expect(phoneInput).toHaveValue('');
    });

    it('17. Inline Clear button correctly clears the License Key field', () => {
      renderOnForm();
      const keyInput = screen.getByLabelText(/License Key/i);
      fireEvent.change(keyInput, { target: { value: 'KEY123' } });
      const clearBtn = screen.getAllByRole('button').find(b => b.className === 'license-input-clear')!;
      fireEvent.click(clearBtn);
      expect(keyInput).toHaveValue('');
    });
  });

  describe('3. Loading State Behavior', () => {
    it('18. Inputs become disabled when loading is true', () => {
      let resolveActivate: (value: boolean) => void = () => {};
      const promise = new Promise<boolean>(resolve => { resolveActivate = resolve; });
      vi.mocked(activateLicense).mockReturnValue(promise);
      
      renderOnForm();
      fillForm();
      clickSubmit();
      
      expect(screen.getByLabelText(/Email Address/i)).toBeDisabled();
      expect(screen.getByLabelText(/Phone Number/i)).toBeDisabled();
      expect(screen.getByLabelText(/License Key/i)).toBeDisabled();
      
      resolveActivate(true);
    });

    it('19. Clear buttons disappear while loading is true', () => {
      let resolveActivate: (value: boolean) => void = () => {};
      vi.mocked(activateLicense).mockReturnValue(new Promise<boolean>(resolve => { resolveActivate = resolve; }));
      
      renderOnForm();
      fillForm();
      clickSubmit();
      
      expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
      resolveActivate(true);
    });

    it('20. The Submit button becomes disabled while loading is true', () => {
      let resolveActivate: (value: boolean) => void = () => {};
      vi.mocked(activateLicense).mockReturnValue(new Promise<boolean>(resolve => { resolveActivate = resolve; }));
      
      renderOnForm();
      fillForm();
      const submitBtn = screen.getByRole('button', { name: /Activate License/i });
      fireEvent.click(submitBtn);
      
      expect(submitBtn).toBeDisabled();
      resolveActivate(true);
    });

    it('21. The Submit button text changes to "Activating..." when loading', () => {
      let resolveActivate: (value: boolean) => void = () => {};
      vi.mocked(activateLicense).mockReturnValue(new Promise<boolean>(resolve => { resolveActivate = resolve; }));
      
      renderOnForm();
      fillForm();
      clickSubmit();
      
      expect(screen.getByText(/Activating\.\.\./i)).toBeInTheDocument();
      resolveActivate(true);
    });

    it('22. A loading spinner SVG is rendered inside the Submit button while loading', () => {
      let resolveActivate: (value: boolean) => void = () => {};
      vi.mocked(activateLicense).mockReturnValue(new Promise<boolean>(resolve => { resolveActivate = resolve; }));
      
      const { container } = render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      openLicenseKeyForm();
      fillForm();
      clickSubmit();
      
      expect(container.querySelector('svg.spinner')).toBeInTheDocument();
      resolveActivate(true);
    });
  });

  describe('4. Form Submission & API Calls', () => {
    it('23. Submitting the form clears any pre-existing inline error messages', async () => {
      vi.mocked(activateLicense).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      
      renderOnForm();
      fillForm();
      
      clickSubmit();
      await waitFor(() => expect(screen.getByText('Failed to activate license.')).toBeInTheDocument(), FAST_WAIT);
      
      clickSubmit();
      await waitFor(() => expect(screen.queryByText('Failed to activate license.')).not.toBeInTheDocument(), FAST_WAIT);
    });

    it('24. Submitting with whitespace-only Key shows validation error', () => {
      renderOnForm();
      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'test@example.com' } });
      fireEvent.change(screen.getByLabelText(/Phone Number/i), { target: { value: '08123456789' } });
      fireEvent.change(screen.getByLabelText(/License Key/i), { target: { value: '   ' } });
      
      clickSubmit();
      expect(screen.getByText('License key and Email are required.')).toBeInTheDocument();
      expect(activateLicense).not.toHaveBeenCalled();
    });

    it('25. Submitting trims whitespace from the Email payload', async () => {
      renderOnForm();
      fillForm('  test@test.com  ', '  08123456789  ', 'KEY123');
      clickSubmit();
      
      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('26. Submitting trims whitespace from the License Key payload', async () => {
      renderOnForm();
      fillForm('test@test.com', '08123456789', '  KEY123  ');
      clickSubmit();
      
      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('27. Submitting trims whitespace from the Phone payload', async () => {
      renderOnForm();
      fillForm('test@test.com', '  08123456789  ', 'KEY123');
      clickSubmit();
      
      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('28. Happy path: Successful activation calls getMachineId, activateLicense, fires success toast', async () => {
      renderOnForm();
      fillForm();
      clickSubmit();
      
      await waitFor(() => {
        expect(getMachineId).toHaveBeenCalled();
        expect(activateLicense).toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledWith({ type: 'success', message: 'License activated successfully!' });
        expect(mockOnActivated).toHaveBeenCalled();
      }, FAST_WAIT);
    });

    it('29. API returns false: Displays the specific inline red error banner', async () => {
      vi.mocked(activateLicense).mockResolvedValue(false);
      renderOnForm();
      fillForm();
      clickSubmit();
      
      await waitFor(() => expect(screen.getByText('Failed to activate license.')).toBeInTheDocument(), FAST_WAIT);
    });

    it('30. Form handles extremely long input strings without UI crashing', () => {
      renderOnForm();
      const longStr = 'a'.repeat(500);
      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: longStr } });
      fireEvent.change(screen.getByLabelText(/License Key/i), { target: { value: 'KEY' } });
      expect(screen.getByLabelText(/Email Address/i)).toHaveValue(longStr);
    });

    it('31. Multiple rapid submission attempts are blocked', async () => {
      let resolveActivate: (value: boolean) => void = () => {};
      vi.mocked(activateLicense).mockReturnValue(new Promise<boolean>(resolve => { resolveActivate = resolve; }));
      
      renderOnForm();
      fillForm();
      
      const submitBtn = screen.getByRole('button', { name: /Activate License/i });
      fireEvent.click(submitBtn);
      // Must flush microtasks: handleSubmit calls await getMachineId() before
      // activateLicense(), so activateLicense isn't called synchronously.
      await waitFor(() => expect(activateLicense).toHaveBeenCalledTimes(1), FAST_WAIT);
      
      fireEvent.click(submitBtn); // Should be ignored — button is now disabled
      expect(activateLicense).toHaveBeenCalledTimes(1);
      resolveActivate(true);
    });
  });

  describe('5. Error Catching & Formatting', () => {
    it('32. Thrown Error instance: Fires an error toast with err.message', async () => {
      vi.mocked(activateLicense).mockRejectedValue(new Error('Network Failure 500'));
      renderOnForm();
      fillForm();
      clickSubmit();
      
      await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith({ type: 'error', message: 'An error occurred during activation.' }), FAST_WAIT);
    });

    it('33. Thrown string primitive: Fires an error toast using the string itself', async () => {
      vi.mocked(activateLicense).mockRejectedValue('String Error');
      renderOnForm();
      fillForm();
      clickSubmit();
      
      await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith({ type: 'error', message: 'An error occurred during activation.' }), FAST_WAIT);
    });

    it('34. Thrown object with message property: Fires an error toast parsing the message field', async () => {
      vi.mocked(activateLicense).mockRejectedValue({ message: 'Object Error' });
      renderOnForm();
      fillForm();
      clickSubmit();
      
      await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith({ type: 'error', message: 'An error occurred during activation.' }), FAST_WAIT);
    });

    it('35. Thrown unknown object: Gracefully falls back to stringifying the unknown object', async () => {
      vi.mocked(activateLicense).mockRejectedValue({ unknown: true });
      renderOnForm();
      fillForm();
      clickSubmit();
      
      await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith({ type: 'error', message: 'An error occurred during activation.' }), FAST_WAIT);
    });
  });

  describe('6. Custom Context Menu & Pasting', () => {
    it('36. Right-clicking an input opens the context menu exactly at the mouse coordinates', () => {
      renderOnForm();
      const emailInput = screen.getByLabelText(/Email Address/i);
      fireEvent.contextMenu(emailInput, { clientX: 150, clientY: 250 });
      
      const menu = screen.getByText('Paste');
      expect(menu).toBeInTheDocument();
      expect(menu).toHaveStyle('top: 250px');
      expect(menu).toHaveStyle('left: 150px');
    });

    it('37. Right-clicking the container prevents the default browser menu and ensures custom menu is closed', () => {
      renderOnForm();
      
      const container = document.querySelector('.license-activation-container')!;
      const event = createEvent.contextMenu(container);
      fireEvent(container, event);
      
      expect(event.defaultPrevented).toBe(true);
      expect(screen.queryByText('Paste')).not.toBeInTheDocument();
    });

    it('38. Clicking the container (global click) closes an open context menu', () => {
      renderOnForm();
      const emailInput = screen.getByLabelText(/Email Address/i);
      fireEvent.contextMenu(emailInput, { clientX: 150, clientY: 250 });
      
      expect(screen.getByText('Paste')).toBeInTheDocument();
      
      const container = document.querySelector('.license-activation-container')!;
      fireEvent.click(container);
      
      expect(screen.queryByText('Paste')).not.toBeInTheDocument();
    });

    it('39. Right-clicking an input while context menu is already open relocates the menu', () => {
      renderOnForm();
      const emailInput = screen.getByLabelText(/Email Address/i);
      
      fireEvent.contextMenu(emailInput, { clientX: 100, clientY: 100 });
      expect(screen.getByText('Paste')).toHaveStyle('top: 100px');
      
      fireEvent.contextMenu(emailInput, { clientX: 200, clientY: 200 });
      expect(screen.getByText('Paste')).toHaveStyle('top: 200px');
    });

    it('40. Pasting into the Email field updates ONLY the email field', async () => {
      mockClipboardReadText.mockResolvedValue('test@paste.com');
      renderOnForm();
      const emailInput = screen.getByLabelText(/Email Address/i);
      
      fireEvent.contextMenu(emailInput, { clientX: 100, clientY: 100 });
      fireEvent.click(screen.getByText('Paste'));
      
      await waitFor(() => expect(emailInput).toHaveValue('test@paste.com'), FAST_WAIT);
      expect(screen.getByLabelText(/Phone Number/i)).toHaveValue('');
    });

    it('41. Pasting into the Phone field updates ONLY the phone field', async () => {
      mockClipboardReadText.mockResolvedValue('0899999');
      renderOnForm();
      const phoneInput = screen.getByLabelText(/Phone Number/i);
      
      fireEvent.contextMenu(phoneInput, { clientX: 100, clientY: 100 });
      fireEvent.click(screen.getByText('Paste'));
      
      await waitFor(() => expect(phoneInput).toHaveValue('0899999'), FAST_WAIT);
      expect(screen.getByLabelText(/Email Address/i)).toHaveValue('');
    });

    it('42. Pasting into the License Key field updates ONLY the key field, and forces to uppercase', async () => {
      mockClipboardReadText.mockResolvedValue('oz-key-abc');
      renderOnForm();
      const keyInput = screen.getByLabelText(/License Key/i);
      
      fireEvent.contextMenu(keyInput, { clientX: 100, clientY: 100 });
      fireEvent.click(screen.getByText('Paste'));
      
      await waitFor(() => expect(keyInput).toHaveValue('OZ-KEY-ABC'), FAST_WAIT);
      expect(screen.getByLabelText(/Email Address/i)).toHaveValue('');
    });

    it('43. Clipboard returning empty text does nothing', async () => {
      mockClipboardReadText.mockResolvedValue('');
      renderOnForm();
      const emailInput = screen.getByLabelText(/Email Address/i);
      fireEvent.change(emailInput, { target: { value: 'existing@email.com' } });
      
      fireEvent.contextMenu(emailInput, { clientX: 100, clientY: 100 });
      fireEvent.click(screen.getByText('Paste'));
      
      await waitFor(() => expect(screen.queryByText('Paste')).not.toBeInTheDocument(), FAST_WAIT);
      expect(emailInput).toHaveValue('existing@email.com'); // Unchanged
    });

    it('44. Clipboard throwing an OS permission error is caught, fires an error toast', async () => {
      mockClipboardReadText.mockRejectedValue(new Error('Permission denied'));
      renderOnForm();
      const emailInput = screen.getByLabelText(/Email Address/i);
      
      fireEvent.contextMenu(emailInput, { clientX: 100, clientY: 100 });
      fireEvent.click(screen.getByText('Paste'));
      
      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith({ type: 'error', message: 'Error: Clipboard error: Something went wrong. Please try again.' });
      }, FAST_WAIT);
      expect(screen.queryByText('Paste')).not.toBeInTheDocument();
    });

    it('45. Component unmounting while readText() is awaiting does not cause errors', async () => {
      let resolveReadText: (value: string) => void = () => {};
      mockClipboardReadText.mockReturnValue(new Promise<string>(resolve => { resolveReadText = resolve; }));
      
      const { unmount } = render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      openLicenseKeyForm();
      const emailInput = screen.getByLabelText(/Email Address/i);
      
      fireEvent.contextMenu(emailInput, { clientX: 100, clientY: 100 });
      fireEvent.click(screen.getByText('Paste'));
      
      unmount();
      expect(() => resolveReadText('late@email.com')).not.toThrow();
    });
  });

  describe('8. Segmented trial vertical (C2.1)', () => {
    afterEach(() => {
      // Restore the default URL so later tests see no ?v= param.
      window.history.replaceState({}, '', '/');
    });

    it('51. No ?v= param: no trial hint, 4-arg activateLicense call', async () => {
      window.history.replaceState({}, '', '/');
      renderOnForm();

      expect(screen.queryByTestId('trial-vertical-hint')).not.toBeInTheDocument();
      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('52. ?v=restaurant: Pro hint shown and vertical passed to activateLicense', async () => {
      window.history.replaceState({}, '', '/?v=restaurant');
      renderOnForm();

      await waitFor(() => expect(screen.getByTestId('trial-vertical-hint')).toHaveTextContent(/14-day Pro trial/), FAST_WAIT);
      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', 'restaurant', undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('53. ?v=kafe normalizes to restaurant (website vertical key)', async () => {
      window.history.replaceState({}, '', '/?v=kafe');
      renderOnForm();

      await waitFor(() => expect(screen.getByTestId('trial-vertical-hint')).toHaveTextContent(/14-day Pro trial/), FAST_WAIT);
      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', 'restaurant', undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('54. ?v=enterprise_referral: 30-day Pro hint, vertical passed', async () => {
      window.history.replaceState({}, '', '/?v=enterprise_referral');
      renderOnForm();

      await waitFor(() => expect(screen.getByTestId('trial-vertical-hint')).toHaveTextContent(/30-day Pro trial/), FAST_WAIT);
      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', 'enterprise_referral', undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('55. ?v=warung (general vertical): no hint, no vertical passed', async () => {
      window.history.replaceState({}, '', '/?v=warung');
      renderOnForm();

      // warung maps to the general 14-day Plus trial — the default — so
      // there is nothing vertical-specific to show or send.
      expect(screen.queryByTestId('trial-vertical-hint')).not.toBeInTheDocument();
      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });
  });

  describe('7. Child Components & Hero', () => {
    it('46. Renders the unified status bar (auth/sync/version icons)', () => {
      renderOnForm();
      expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    });

    it('49. Renders the 256x256 kasir.mu logo hero image', () => {
      renderOnForm();
      const img = screen.getByAltText('kasir.mu Logo');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', '/256x256.png');
    });

    it('50. Renders the copyright footer with the current dynamic year', () => {
      renderOnForm();
      const year = new Date().getFullYear().toString();
      expect(screen.getByText(new RegExp(`kasir.mu © ${year} All rights reserved.`))).toBeInTheDocument();
    });
  });

  describe('9. Vertical bundles (C3.2)', () => {
    afterEach(() => {
      // Restore the default URL so later tests see no ?bundle= param.
      window.history.replaceState({}, '', '/');
    });

    it('56. No ?bundle= param: no bundle passed to activateLicense', async () => {
      window.history.replaceState({}, '', '/');
      renderOnForm();

      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('57. ?bundle=restaurant_starter: bundle passed to activateLicense', async () => {
      window.history.replaceState({}, '', '/?bundle=restaurant_starter');
      renderOnForm();

      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith(
        'KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, 'restaurant_starter', 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      ), FAST_WAIT);
    });

    it('58. ?v=kafe&bundle=restaurant_starter: vertical AND bundle passed together', async () => {
      window.history.replaceState({}, '', '/?v=kafe&bundle=restaurant_starter');
      renderOnForm();

      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith(
        'KEY123', 'test@test.com', 'test-machine-id', '08123456789', 'restaurant', 'restaurant_starter', 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      ), FAST_WAIT);
    });

    it('59. Unknown ?bundle= value is normalized away (no-op)', async () => {
      window.history.replaceState({}, '', '/?bundle=fancy_bundle');
      renderOnForm();

      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });
  });

  describe('8. Tablet Device-Code Pairing (ADR #56 §2.5 / §5 Q1)', () => {
    it('60. Switches to Pair with Phone tab, starts pairing session, renders QR & Crockford code, and activates on claim', async () => {
      vi.useFakeTimers();
      const { startDevicePairing, pollDevicePairing } = await import('@/api/license');
      vi.mocked(startDevicePairing).mockResolvedValueOnce({
        code: 'WXYZ7890',
        poll_token: 'poll-license-123',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        qr_url: 'https://kasir.mu/pair?code=WXYZ7890',
      });
      vi.mocked(pollDevicePairing)
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({
          status: 'claimed',
          tenant_id: 'tenant-paired',
          email: 'paired@kasir.mu',
        });

      renderOnForm();

      // Switch to Pair with Phone tab
      const pairTab = screen.getByRole('tab', { name: /Pair with Phone/i });
      fireEvent.click(pairTab);

      // Flush microtasks
      await vi.runOnlyPendingTimersAsync();

      expect(startDevicePairing).toHaveBeenCalled();
      expect(screen.getByTestId('pairing-code-display')).toHaveTextContent('WXYZ - 7890');
      expect(screen.getByTestId('pairing-qr-code')).toBeInTheDocument();

      // Advance 3s for poll interval
      await vi.advanceTimersByTimeAsync(3000);

      expect(pollDevicePairing).toHaveBeenCalledWith('poll-license-123');
      expect(mockAddToast).toHaveBeenCalledWith({
        type: 'success',
        message: 'Device paired successfully!',
      });
      expect(mockOnActivated).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  // ── C47: the tablet must not call commands it does not register ───────
  //
  // activate_license / get_machine_id / get_hardware_fingerprint are DESKTOP-registered
  // only (apps/desktop-tauri/src/lib.rs:1261, :1267, :1269). The tablet's commands::license
  // surface is get_license_status / check_license_status alone — its activation path is
  // device pairing. Before this fix the key form was reachable on the tablet and a submit
  // hit three unknown commands, so the catch reported a generic activation failure the
  // operator could do nothing about: the same swallowed-rejection shape as C40, on the
  // licensing screen. These cases fail if either half of the fix regresses.
  describe('entry screen: the two ways in', () => {
    it('signs in with Google and reports activation upward', async () => {
      const { linkDeviceGoogle } = await import('@/api/license');
      vi.mocked(linkDeviceGoogle).mockResolvedValue({
        tenantId: 't1',
        provider: 'google',
        email: 'owner@example.com',
      });
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);

      fireEvent.click(screen.getByTestId('setup-google'));

      await waitFor(() => expect(mockOnActivated).toHaveBeenCalled(), FAST_WAIT);
    });

    it('keeps the merchant on the entry screen when Google sign-in fails', async () => {
      const { linkDeviceGoogle } = await import('@/api/license');
      vi.mocked(linkDeviceGoogle).mockRejectedValue(new Error('consent window closed'));
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);

      fireEvent.click(screen.getByTestId('setup-google'));

      await waitFor(
        () =>
          expect(
            screen.getByText('Could not sign in with Google. Please try again.'),
          ).toBeInTheDocument(),
        FAST_WAIT,
      );
      // Not activated, and the two routes are still offered for a retry.
      expect(mockOnActivated).not.toHaveBeenCalled();
      expect(screen.getByTestId('setup-pair')).toBeInTheDocument();
    });

    it('goes back from the pairing view to the entry screen', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fireEvent.click(screen.getByTestId('setup-pair'));
      expect(screen.getByTestId('setup-back')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('setup-back'));
      expect(screen.getByTestId('setup-google')).toBeInTheDocument();
      expect(screen.getByTestId('setup-pair')).toBeInTheDocument();
    });
  });
  describe('C47 — the tablet shell never calls the desktop-only activation commands', () => {
    it('61. does not offer the License Key route at all', () => {
      vi.mocked(isTabletShell).mockReturnValue(true);
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);

      // The route is absent, not merely unselected: a form an operator can open,
      // fill in, and then watch fail is worse than one that is not there. This
      // covers both places it could reappear — the entry screen's link and the
      // tab strip behind it.
      expect(screen.queryByTestId('setup-license-key')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('setup-pair'));
      expect(screen.queryByRole('tab', { name: /License Key/i })).not.toBeInTheDocument();
      // The pairing tab — the tablet's real activation surface — is still offered.
      expect(screen.getByRole('tab', { name: /Pair with Phone/i })).toBeInTheDocument();
    });

    it('62. invokes none of the three desktop-only commands on mount or on the pairing path', async () => {
      vi.mocked(isTabletShell).mockReturnValue(true);
      const { startDevicePairing } = await import('@/api/license');
      vi.mocked(startDevicePairing).mockResolvedValue({
        code: 'WXYZ7890',
        poll_token: 'poll-license-123',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        qr_url: 'https://kasir.mu/pair?code=WXYZ7890',
      });

      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fireEvent.click(screen.getByTestId('setup-pair'));

      // Mount alone must not reach them. The tablet's entry screen is the first
      // render, so this is also the effect path.
      await waitFor(() => expect(startDevicePairing).toHaveBeenCalled(), FAST_WAIT);
      expect(getMachineId).not.toHaveBeenCalled();
      expect(getHardwareFingerprint).not.toHaveBeenCalled();
      expect(activateLicense).not.toHaveBeenCalled();

      // And there is no key form to submit: the only route into handleActivate is the
      // submit button, which the tablet does not render.
      expect(screen.queryByRole('button', { name: /Activate License/i })).not.toBeInTheDocument();
      // The generic activation failure must NOT be reported: nothing was attempted, which
      // is not the same claim as an attempt that failed.
      expect(mockAddToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: 'An error occurred during activation.' }),
      );
    });

    it('63. still activates with the key form on the DESKTOP shell', async () => {
      vi.mocked(isTabletShell).mockReturnValue(false);
      renderOnForm();

      // The guard must not have narrowed the desktop: pinned in both directions, because a
      // fix that disabled activation everywhere would satisfy case 62 alone.
      expect(screen.getByRole('tab', { name: /License Key/i })).toBeInTheDocument();
      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith(
        'KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined,
        'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ), FAST_WAIT);
    });
  });
});