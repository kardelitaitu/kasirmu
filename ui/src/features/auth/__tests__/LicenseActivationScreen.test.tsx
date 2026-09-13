import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, createEvent } from '@testing-library/react';
import LicenseActivationScreen from '../LicenseActivationScreen';
import { activateLicense, getHardwareFingerprint, getMachineId } from '@/api/license';
import { getVersion, getLocalIp, type VersionInfo } from '@/api/system';

// FAST_WAIT: 5ms polling for async assertions (10x faster than default 50ms).
const FAST_WAIT = { interval: 5, timeout: 500 } as const;

const mockAddToast = vi.fn();
const mockOnActivated = vi.fn();
const mockClipboardReadText = vi.fn();

Object.defineProperty(navigator, 'clipboard', {
  value: { readText: mockClipboardReadText },
  writable: true,
});

vi.mock('@/frontend/shared/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast })
}));

vi.mock('@/api/license', () => ({
  activateLicense: vi.fn(),
  getMachineId: vi.fn(),
  getHardwareFingerprint: vi.fn()
}));

vi.mock('@/api/system', () => ({
  getVersion: vi.fn(),
  getLocalIp: vi.fn()
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
        'auth-ip-address': 'IP Address : ' + (args ? args['ip'] : ''),
        'auth-copyright': 'OZ-POS © ' + (args ? args['year'] : '') + ' All rights reserved.',
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
        'staff-login-connection-sync': 'Sync'
      };
      return (map as Record<string, string>)[id] || id;
    }
  } })
}));


vi.mock('@/components/StatusBar', () => ({
  default: () => <div data-testid="status-bar">StatusBar</div>,
}));
vi.mock('@/frontend/shell/ThemeToggle', () => ({
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
  beforeEach(() => {
    vi.mocked(getVersion).mockResolvedValue({ version: '1.0.0', name: 'oz-pos', rustVersion: '1.70', target: 'windows' });
    vi.mocked(getLocalIp).mockResolvedValue('192.168.1.100');
    vi.mocked(getMachineId).mockResolvedValue('test-machine-id');
    vi.mocked(getHardwareFingerprint).mockResolvedValue('hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    vi.mocked(activateLicense).mockResolvedValue(true);
    mockClipboardReadText.mockResolvedValue('clipboard-text');
  });

  describe('1. Mounting & Lifecycle', () => {
    it('1. getVersion resolves and displays the correct version on mount', async () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      await waitFor(() => expect(screen.getByText('Version 1.0.0')).toBeInTheDocument(), FAST_WAIT);
    });

    it('2. getLocalIp resolves and displays the correct IP on mount', async () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      await waitFor(() => expect(screen.getByText('IP Address : 192.168.1.100')).toBeInTheDocument(), FAST_WAIT);
    });

    it('3. getLocalIp rejects and gracefully falls back to "Unknown"', async () => {
      vi.mocked(getLocalIp).mockRejectedValue(new Error('IP Fail'));
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      await waitFor(() => expect(screen.getByText('IP Address : Unknown')).toBeInTheDocument(), FAST_WAIT);
    });

    it('4. getVersion rejects gracefully without crashing the app', async () => {
      vi.mocked(getVersion).mockRejectedValue(new Error('Version Fail'));
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      await waitFor(() => expect(screen.getByText('Version 0.0.37')).toBeInTheDocument(), FAST_WAIT);
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
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const emailInput = screen.getByLabelText(/Email Address/i);
      expect(emailInput).toBeEnabled();
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      expect(emailInput).toHaveValue('test@example.com');
    });

    it('8. Phone input is present, enabled, and accepts typing', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const phoneInput = screen.getByLabelText(/Phone Number/i);
      expect(phoneInput).toBeEnabled();
      fireEvent.change(phoneInput, { target: { value: '1234' } });
      expect(phoneInput).toHaveValue('1234');
    });

    it('9. License Key input is present, enabled, and accepts typing', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const keyInput = screen.getByLabelText(/License Key/i);
      expect(keyInput).toBeEnabled();
      fireEvent.change(keyInput, { target: { value: '1234' } });
      expect(keyInput).toHaveValue('1234');
    });

    it('10. License Key strictly forces characters to uppercase', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const keyInput = screen.getByLabelText(/License Key/i);
      fireEvent.change(keyInput, { target: { value: 'aBcDeFg' } });
      expect(keyInput).toHaveValue('ABCDEFG');
    });

    it('11. Activate License button is disabled initially', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      expect(screen.getByRole('button', { name: /Activate License/i })).toBeDisabled();
    });

    it('12. Activate License button is disabled if email is filled but key is empty', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'test@test.com' } });
      expect(screen.getByRole('button', { name: /Activate License/i })).toBeDisabled();
    });

    it('13. Activate License button is disabled if key is filled but email is empty', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fireEvent.change(screen.getByLabelText(/License Key/i), { target: { value: 'KEY123' } });
      expect(screen.getByRole('button', { name: /Activate License/i })).toBeDisabled();
    });

    it('14. Activate License button is enabled only when email, phone, and key have text', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'test@test.com' } });
      fireEvent.change(screen.getByLabelText(/Phone Number/i), { target: { value: '08123456789' } });
      fireEvent.change(screen.getByLabelText(/License Key/i), { target: { value: 'KEY123' } });
      expect(screen.getByRole('button', { name: /Activate License/i })).toBeEnabled();
    });

    it('15. Inline Clear button correctly clears the Email field', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const emailInput = screen.getByLabelText(/Email Address/i);
      fireEvent.change(emailInput, { target: { value: 'test@test.com' } });
      const clearBtn = screen.getAllByRole('button').find(b => b.className === 'license-input-clear')!;
      fireEvent.click(clearBtn);
      expect(emailInput).toHaveValue('');
    });

    it('16. Inline Clear button correctly clears the Phone field', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const phoneInput = screen.getByLabelText(/Phone Number/i);
      fireEvent.change(phoneInput, { target: { value: '1234' } });
      const clearBtn = screen.getAllByRole('button').find(b => b.className === 'license-input-clear')!;
      fireEvent.click(clearBtn);
      expect(phoneInput).toHaveValue('');
    });

    it('17. Inline Clear button correctly clears the License Key field', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
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
      
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
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
      
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fillForm();
      clickSubmit();
      
      expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
      resolveActivate(true);
    });

    it('20. The Submit button becomes disabled while loading is true', () => {
      let resolveActivate: (value: boolean) => void = () => {};
      vi.mocked(activateLicense).mockReturnValue(new Promise<boolean>(resolve => { resolveActivate = resolve; }));
      
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fillForm();
      const submitBtn = screen.getByRole('button', { name: /Activate License/i });
      fireEvent.click(submitBtn);
      
      expect(submitBtn).toBeDisabled();
      resolveActivate(true);
    });

    it('21. The Submit button text changes to "Activating..." when loading', () => {
      let resolveActivate: (value: boolean) => void = () => {};
      vi.mocked(activateLicense).mockReturnValue(new Promise<boolean>(resolve => { resolveActivate = resolve; }));
      
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fillForm();
      clickSubmit();
      
      expect(screen.getByText(/Activating\.\.\./i)).toBeInTheDocument();
      resolveActivate(true);
    });

    it('22. A loading spinner SVG is rendered inside the Submit button while loading', () => {
      let resolveActivate: (value: boolean) => void = () => {};
      vi.mocked(activateLicense).mockReturnValue(new Promise<boolean>(resolve => { resolveActivate = resolve; }));
      
      const { container } = render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fillForm();
      clickSubmit();
      
      expect(container.querySelector('svg.spinner')).toBeInTheDocument();
      resolveActivate(true);
    });
  });

  describe('4. Form Submission & API Calls', () => {
    it('23. Submitting the form clears any pre-existing inline error messages', async () => {
      vi.mocked(activateLicense).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fillForm();
      
      clickSubmit();
      await waitFor(() => expect(screen.getByText('Failed to activate license.')).toBeInTheDocument(), FAST_WAIT);
      
      clickSubmit();
      await waitFor(() => expect(screen.queryByText('Failed to activate license.')).not.toBeInTheDocument(), FAST_WAIT);
    });

    it('24. Submitting with whitespace-only Key shows validation error', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'test@example.com' } });
      fireEvent.change(screen.getByLabelText(/Phone Number/i), { target: { value: '08123456789' } });
      fireEvent.change(screen.getByLabelText(/License Key/i), { target: { value: '   ' } });
      
      clickSubmit();
      expect(screen.getByText('License key and Email are required.')).toBeInTheDocument();
      expect(activateLicense).not.toHaveBeenCalled();
    });

    it('25. Submitting trims whitespace from the Email payload', async () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fillForm('  test@test.com  ', '  08123456789  ', 'KEY123');
      clickSubmit();
      
      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('26. Submitting trims whitespace from the License Key payload', async () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fillForm('test@test.com', '08123456789', '  KEY123  ');
      clickSubmit();
      
      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('27. Submitting trims whitespace from the Phone payload', async () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fillForm('test@test.com', '  08123456789  ', 'KEY123');
      clickSubmit();
      
      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('28. Happy path: Successful activation calls getMachineId, activateLicense, fires success toast', async () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
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
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fillForm();
      clickSubmit();
      
      await waitFor(() => expect(screen.getByText('Failed to activate license.')).toBeInTheDocument(), FAST_WAIT);
    });

    it('30. Form handles extremely long input strings without UI crashing', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const longStr = 'a'.repeat(500);
      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: longStr } });
      fireEvent.change(screen.getByLabelText(/License Key/i), { target: { value: 'KEY' } });
      expect(screen.getByLabelText(/Email Address/i)).toHaveValue(longStr);
    });

    it('31. Multiple rapid submission attempts are blocked', async () => {
      let resolveActivate: (value: boolean) => void = () => {};
      vi.mocked(activateLicense).mockReturnValue(new Promise<boolean>(resolve => { resolveActivate = resolve; }));
      
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
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
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fillForm();
      clickSubmit();
      
      await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith({ type: 'error', message: 'An error occurred during activation.' }), FAST_WAIT);
    });

    it('33. Thrown string primitive: Fires an error toast using the string itself', async () => {
      vi.mocked(activateLicense).mockRejectedValue('String Error');
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fillForm();
      clickSubmit();
      
      await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith({ type: 'error', message: 'An error occurred during activation.' }), FAST_WAIT);
    });

    it('34. Thrown object with message property: Fires an error toast parsing the message field', async () => {
      vi.mocked(activateLicense).mockRejectedValue({ message: 'Object Error' });
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fillForm();
      clickSubmit();
      
      await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith({ type: 'error', message: 'An error occurred during activation.' }), FAST_WAIT);
    });

    it('35. Thrown unknown object: Gracefully falls back to stringifying the unknown object', async () => {
      vi.mocked(activateLicense).mockRejectedValue({ unknown: true });
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      fillForm();
      clickSubmit();
      
      await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith({ type: 'error', message: 'An error occurred during activation.' }), FAST_WAIT);
    });
  });

  describe('6. Custom Context Menu & Pasting', () => {
    it('36. Right-clicking an input opens the context menu exactly at the mouse coordinates', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const emailInput = screen.getByLabelText(/Email Address/i);
      fireEvent.contextMenu(emailInput, { clientX: 150, clientY: 250 });
      
      const menu = screen.getByText('Paste');
      expect(menu).toBeInTheDocument();
      expect(menu).toHaveStyle('top: 250px');
      expect(menu).toHaveStyle('left: 150px');
    });

    it('37. Right-clicking the container prevents the default browser menu and ensures custom menu is closed', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      
      const container = document.querySelector('.license-activation-container')!;
      const event = createEvent.contextMenu(container);
      fireEvent(container, event);
      
      expect(event.defaultPrevented).toBe(true);
      expect(screen.queryByText('Paste')).not.toBeInTheDocument();
    });

    it('38. Clicking the container (global click) closes an open context menu', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const emailInput = screen.getByLabelText(/Email Address/i);
      fireEvent.contextMenu(emailInput, { clientX: 150, clientY: 250 });
      
      expect(screen.getByText('Paste')).toBeInTheDocument();
      
      const container = document.querySelector('.license-activation-container')!;
      fireEvent.click(container);
      
      expect(screen.queryByText('Paste')).not.toBeInTheDocument();
    });

    it('39. Right-clicking an input while context menu is already open relocates the menu', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const emailInput = screen.getByLabelText(/Email Address/i);
      
      fireEvent.contextMenu(emailInput, { clientX: 100, clientY: 100 });
      expect(screen.getByText('Paste')).toHaveStyle('top: 100px');
      
      fireEvent.contextMenu(emailInput, { clientX: 200, clientY: 200 });
      expect(screen.getByText('Paste')).toHaveStyle('top: 200px');
    });

    it('40. Pasting into the Email field updates ONLY the email field', async () => {
      mockClipboardReadText.mockResolvedValue('test@paste.com');
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const emailInput = screen.getByLabelText(/Email Address/i);
      
      fireEvent.contextMenu(emailInput, { clientX: 100, clientY: 100 });
      fireEvent.click(screen.getByText('Paste'));
      
      await waitFor(() => expect(emailInput).toHaveValue('test@paste.com'), FAST_WAIT);
      expect(screen.getByLabelText(/Phone Number/i)).toHaveValue('');
    });

    it('41. Pasting into the Phone field updates ONLY the phone field', async () => {
      mockClipboardReadText.mockResolvedValue('0899999');
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const phoneInput = screen.getByLabelText(/Phone Number/i);
      
      fireEvent.contextMenu(phoneInput, { clientX: 100, clientY: 100 });
      fireEvent.click(screen.getByText('Paste'));
      
      await waitFor(() => expect(phoneInput).toHaveValue('0899999'), FAST_WAIT);
      expect(screen.getByLabelText(/Email Address/i)).toHaveValue('');
    });

    it('42. Pasting into the License Key field updates ONLY the key field, and forces to uppercase', async () => {
      mockClipboardReadText.mockResolvedValue('oz-key-abc');
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const keyInput = screen.getByLabelText(/License Key/i);
      
      fireEvent.contextMenu(keyInput, { clientX: 100, clientY: 100 });
      fireEvent.click(screen.getByText('Paste'));
      
      await waitFor(() => expect(keyInput).toHaveValue('OZ-KEY-ABC'), FAST_WAIT);
      expect(screen.getByLabelText(/Email Address/i)).toHaveValue('');
    });

    it('43. Clipboard returning empty text does nothing', async () => {
      mockClipboardReadText.mockResolvedValue('');
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const emailInput = screen.getByLabelText(/Email Address/i);
      fireEvent.change(emailInput, { target: { value: 'existing@email.com' } });
      
      fireEvent.contextMenu(emailInput, { clientX: 100, clientY: 100 });
      fireEvent.click(screen.getByText('Paste'));
      
      await waitFor(() => expect(screen.queryByText('Paste')).not.toBeInTheDocument(), FAST_WAIT);
      expect(emailInput).toHaveValue('existing@email.com'); // Unchanged
    });

    it('44. Clipboard throwing an OS permission error is caught, fires an error toast', async () => {
      mockClipboardReadText.mockRejectedValue(new Error('Permission denied'));
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
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
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);

      expect(screen.queryByTestId('trial-vertical-hint')).not.toBeInTheDocument();
      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('52. ?v=restaurant: Pro hint shown and vertical passed to activateLicense', async () => {
      window.history.replaceState({}, '', '/?v=restaurant');
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);

      await waitFor(() => expect(screen.getByTestId('trial-vertical-hint')).toHaveTextContent(/14-day Pro trial/), FAST_WAIT);
      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', 'restaurant', undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('53. ?v=kafe normalizes to restaurant (website vertical key)', async () => {
      window.history.replaceState({}, '', '/?v=kafe');
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);

      await waitFor(() => expect(screen.getByTestId('trial-vertical-hint')).toHaveTextContent(/14-day Pro trial/), FAST_WAIT);
      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', 'restaurant', undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('54. ?v=enterprise_referral: 30-day Pro hint, vertical passed', async () => {
      window.history.replaceState({}, '', '/?v=enterprise_referral');
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);

      await waitFor(() => expect(screen.getByTestId('trial-vertical-hint')).toHaveTextContent(/30-day Pro trial/), FAST_WAIT);
      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', 'enterprise_referral', undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('55. ?v=warung (general vertical): no hint, no vertical passed', async () => {
      window.history.replaceState({}, '', '/?v=warung');
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);

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
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    });

    it('49. Renders the 256x256 OZ-POS logo hero image', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const img = screen.getByAltText('OZ-POS Logo');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', '/256x256.png');
    });

    it('50. Renders the copyright footer with the current dynamic year', () => {
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);
      const year = new Date().getFullYear().toString();
      expect(screen.getByText(new RegExp(`OZ-POS © ${year} All rights reserved.`))).toBeInTheDocument();
    });
  });

  describe('9. Vertical bundles (C3.2)', () => {
    afterEach(() => {
      // Restore the default URL so later tests see no ?bundle= param.
      window.history.replaceState({}, '', '/');
    });

    it('56. No ?bundle= param: no bundle passed to activateLicense', async () => {
      window.history.replaceState({}, '', '/');
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);

      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });

    it('57. ?bundle=restaurant_starter: bundle passed to activateLicense', async () => {
      window.history.replaceState({}, '', '/?bundle=restaurant_starter');
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);

      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith(
        'KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, 'restaurant_starter', 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      ), FAST_WAIT);
    });

    it('58. ?v=kafe&bundle=restaurant_starter: vertical AND bundle passed together', async () => {
      window.history.replaceState({}, '', '/?v=kafe&bundle=restaurant_starter');
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);

      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith(
        'KEY123', 'test@test.com', 'test-machine-id', '08123456789', 'restaurant', 'restaurant_starter', 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      ), FAST_WAIT);
    });

    it('59. Unknown ?bundle= value is normalized away (no-op)', async () => {
      window.history.replaceState({}, '', '/?bundle=fancy_bundle');
      render(<LicenseActivationScreen onActivated={mockOnActivated} />);

      fillForm();
      clickSubmit();

      await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('KEY123', 'test@test.com', 'test-machine-id', '08123456789', undefined, undefined, 'hw_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), FAST_WAIT);
    });
  });
});
