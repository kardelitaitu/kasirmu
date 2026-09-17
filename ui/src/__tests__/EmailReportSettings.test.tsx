import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/i18n/test-utils';
import EmailReportSettings from '@/features/settings/EmailReportSettings';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';
import salesFtl from '@/locales/sales.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import salesIdFtl from '@/locales/sales.id.ftl?raw';
import settingsIdFtl from '@/locales/settings.id.ftl?raw';
import sharedIdFtl from '@/locales/shared.id.ftl?raw';

// ── Mocks ────────────────────────────────────────────────────────

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();
const mockGetReportSchedule = vi.fn();
const mockSaveReportSchedule = vi.fn();
const mockGetReportScheduleScoped = vi.fn();
const mockSendTestReport = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/api/settings', () => ({
  getSettingScoped: (...args: unknown[]) => mockGetSetting(...args),
  setSettingScoped: (...args: unknown[]) => mockSetSetting(...args),
}));

vi.mock('@/api/email', () => ({
  getReportSchedule: () => mockGetReportSchedule(),
  // Separate spy, not a delegate: a mirror registers a call on the unscoped spy, which makes
  // `expect(unscoped).not.toHaveBeenCalled()` unprovable. See DataManagementBackup.test.tsx.
  getReportScheduleScoped: (token: string) => mockGetReportScheduleScoped(token),
  saveReportSchedule: (...args: unknown[]) => mockSaveReportSchedule(...args),
  sendTestReport: () => mockSendTestReport(),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'test-user' },
    loading: false,
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: 'mock-session-token',
    terminalId: 'test-terminal',
  }),
}));

vi.mock('@/app/Tooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components', () => ({
  ...vi.importActual('@/components'),
  requiredLocalized: (l10n: { getString: (id: string) => string }, id: string) =>
    l10n.getString(id),
}));

vi.mock('@/components/Card', () => ({
  Card: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) => (
    <div className="card">
      {header && <div className="card-header">{header}</div>}
      <div className="card-body">{children}</div>
    </div>
  ),
}));

vi.mock('@/components/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}));

// ── Test utilities ────────────────────────────────────────────────

async function renderWithFluent(ui: React.ReactElement) {
  return renderInAct(withFluent(ui, sharedFtl, salesFtl, settingsFtl));
}

async function renderWithFluentId(ui: React.ReactElement) {
  return renderInAct(
    withFluentLocale('id', ui, sharedIdFtl, salesIdFtl, settingsIdFtl),
  );
}

// ── Default mocks ────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSetting.mockResolvedValue(null);
  mockGetReportSchedule.mockResolvedValue(null);
  // Configured in parallel rather than by delegating, for the reason above.
  mockGetReportScheduleScoped.mockResolvedValue(null);
});

// ── Tests ────────────────────────────────────────────────────────

describe('EmailReportSettings — EN', () => {
  describe('Loading state', () => {
    it('shows loading indicator while settings load', async () => {
      mockGetSetting.mockReturnValue(new Promise(() => {})); // Never resolves
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.getByText(/loading email settings/i)).toBeInTheDocument();
    });
  });

  describe('Schedule loading', () => {
    it('reads the schedule through the scoped command, passing the session token', async () => {
      // get_report_schedule_scoped (email.rs:148) enforces permissions::REPORTS_SCHEDULE; the
      // unscoped command checks nothing. The write half of this pair already requires a token --
      // saveReportSchedule(sessionToken, config) at api/email.ts:29 -- so the read was the odd one
      // out, and the component already holds sessionToken (:45) and uses it for getSettingScoped
      // (:70).
      await renderWithFluent(<EmailReportSettings />);
      await waitFor(() => {
        expect(mockGetReportScheduleScoped).toHaveBeenCalledWith(HARNESS_SESSION_TOKEN);
      });
      expect(mockGetReportSchedule).not.toHaveBeenCalled();
    });
  });

  describe('SMTP form rendering', () => {
    it('renders the email settings card', async () => {
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.getByText(/email reports/i)).toBeInTheDocument();
    });

    it('renders SMTP host input', async () => {
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.getByPlaceholderText('smtp.example.com')).toBeInTheDocument();
    });

    it('renders SMTP port input', async () => {
      await renderWithFluent(<EmailReportSettings />);
      const portInput = screen.getByDisplayValue('587');
      expect(portInput).toBeInTheDocument();
    });

  it('renders username input', async () => {
    await renderWithFluent(<EmailReportSettings />);
    const inputs = screen.getAllByRole('textbox');
    // Username field should exist (value is empty string initially)
    const usernameInput = inputs.find((i) => i.id === 'settings-email-username');
    expect(usernameInput).toBeInTheDocument();
  });

    it('renders password input', async () => {
      await renderWithFluent(<EmailReportSettings />);
      const passwordInput = screen.getByPlaceholderText(/password/i);
      expect(passwordInput).toBeInTheDocument();
      expect(passwordInput).toHaveAttribute('type', 'password');
    });

    it('renders from address input', async () => {
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.getByPlaceholderText('reports@mystore.com')).toBeInTheDocument();
    });

  it('renders TLS toggle', async () => {
    await renderWithFluent(<EmailReportSettings />);
    const toggles = screen.getAllByRole('switch');
    expect(toggles.length).toBeGreaterThanOrEqual(1);
    // First switch is TLS (checked by default)
    expect(toggles[0]).toBeChecked();
  });

    it('renders Save button', async () => {
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.getByText(/save smtp settings/i)).toBeInTheDocument();
    });

    it('renders Send Test button', async () => {
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.getByText(/send test report/i)).toBeInTheDocument();
    });
  });

  describe('Loading existing config', () => {
    it('loads SMTP config from settings API', async () => {
      mockGetSetting.mockResolvedValue(
        JSON.stringify({
          host: 'mail.example.com',
          port: 465,
          username: 'user',
          password: 'pass',
          from: 'test@example.com',
          use_tls: false,
        }),
      );
      await renderWithFluent(<EmailReportSettings />);
      expect(mockGetSetting).toHaveBeenCalledWith('mock-session-token', 'smtp_config');
      expect(screen.getByDisplayValue('mail.example.com')).toBeInTheDocument();
      expect(screen.getByDisplayValue('465')).toBeInTheDocument();
      expect(screen.getByDisplayValue('user')).toBeInTheDocument();
      expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
    });

    it('uses defaults when no config exists', async () => {
      mockGetSetting.mockResolvedValue(null);
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.getByDisplayValue('587')).toBeInTheDocument();
    });
  });

  describe('Form input changes', () => {
    it('updates host when typed', async () => {
      await renderWithFluent(<EmailReportSettings />);
      const hostInput = screen.getByPlaceholderText('smtp.example.com');
      fireEvent.change(hostInput, { target: { value: 'smtp.gmail.com' } });
      expect(hostInput).toHaveValue('smtp.gmail.com');
    });

    it('updates port when changed', async () => {
      await renderWithFluent(<EmailReportSettings />);
      const portInput = screen.getByDisplayValue('587');
      fireEvent.change(portInput, { target: { value: '465' } });
      expect(portInput).toHaveValue(465);
    });

    it('updates from address', async () => {
      await renderWithFluent(<EmailReportSettings />);
      const fromInput = screen.getByPlaceholderText('reports@mystore.com');
      fireEvent.change(fromInput, { target: { value: 'noreply@mystore.com' } });
      expect(fromInput).toHaveValue('noreply@mystore.com');
    });

  it('toggles TLS off', async () => {
    await renderWithFluent(<EmailReportSettings />);
    const toggle = screen.getAllByRole('switch')[0]!;
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
  });
  });

  describe('Password visibility toggle', () => {
    it('toggles password visibility on click', async () => {
      await renderWithFluent(<EmailReportSettings />);
      const passwordInput = screen.getByPlaceholderText(/password/i);
      expect(passwordInput).toHaveAttribute('type', 'password');

      // Find the eye toggle button (the one without role="switch")
      const toggleBtn = screen.getByPlaceholderText(/password/i)
        .closest('.settings-input-wrap')
        ?.querySelector('button');
      if (toggleBtn) {
        fireEvent.click(toggleBtn);
        expect(passwordInput).toHaveAttribute('type', 'text');
      }
    });
  });

  describe('SMTP validation', () => {
    it('shows error when host is empty', async () => {
      await renderWithFluent(<EmailReportSettings />);
      fireEvent.click(screen.getByText(/save smtp settings/i));
      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        );
      });
    });

    it('shows error when from is empty', async () => {
      await renderWithFluent(<EmailReportSettings />);
      fireEvent.change(screen.getByPlaceholderText('smtp.example.com'), {
        target: { value: 'smtp.example.com' },
      });
      fireEvent.click(screen.getByText(/save smtp settings/i));
      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        );
      });
    });

    it('shows error when from has no @', async () => {
      await renderWithFluent(<EmailReportSettings />);
      fireEvent.change(screen.getByPlaceholderText('smtp.example.com'), {
        target: { value: 'smtp.example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('reports@mystore.com'), {
        target: { value: 'invalid-email' },
      });
      fireEvent.click(screen.getByText(/save smtp settings/i));
      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        );
      });
    });
  });

  describe('Save config', () => {
    it('saves valid SMTP config', async () => {
      mockSetSetting.mockResolvedValue(undefined);
      await renderWithFluent(<EmailReportSettings />);

      fireEvent.change(screen.getByPlaceholderText('smtp.example.com'), {
        target: { value: 'smtp.example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('reports@mystore.com'), {
        target: { value: 'reports@example.com' },
      });
      fireEvent.click(screen.getByText(/save smtp settings/i));

      await waitFor(() => {
        expect(mockSetSetting).toHaveBeenCalledWith(
          'mock-session-token',
          'smtp_config',
          expect.stringContaining('smtp.example.com'),
        );
        expect(mockAddToast).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'success' }),
        );
      });
    });

    // Regression guard for the smtp_config data-loss bug: the card cannot read
    // the stored password back (smtp_config is on the backend credential deny
    // list), so it used to post the whole blob with password:null on every save
    // and silently destroyed the secret. An untouched field must now be OMITTED
    // so the server-side keep-on-blank merge can carry it forward.
    it('omits the password key when the field was never touched', async () => {
      mockSetSetting.mockResolvedValue(undefined);
      await renderWithFluent(<EmailReportSettings />);

      fireEvent.change(screen.getByPlaceholderText('smtp.example.com'), {
        target: { value: 'smtp.example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('reports@mystore.com'), {
        target: { value: 'reports@example.com' },
      });
      fireEvent.click(screen.getByText(/save smtp settings/i));

      await waitFor(() => expect(mockSetSetting).toHaveBeenCalled());
      const written = mockSetSetting.mock.calls[0]?.[2];
      const payload = JSON.parse(typeof written === 'string' ? written : '{}') as {
        host?: string;
        password?: string;
      };
      expect(Object.prototype.hasOwnProperty.call(payload, 'password')).toBe(false);
      expect(payload.host).toBe('smtp.example.com');
    });

    it('writes a typed password and then reports it masked, not blank', async () => {
      mockSetSetting.mockResolvedValue(undefined);
      await renderWithFluent(<EmailReportSettings />);

      fireEvent.change(screen.getByPlaceholderText('smtp.example.com'), {
        target: { value: 'smtp.example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('reports@mystore.com'), {
        target: { value: 'reports@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText(/enter password/i), {
        target: { value: 's3cret' },
      });
      fireEvent.click(screen.getByText(/save smtp settings/i));

      await waitFor(() => expect(mockSetSetting).toHaveBeenCalled());
      const written = mockSetSetting.mock.calls[0]?.[2];
      const payload = JSON.parse(typeof written === 'string' ? written : '{}') as {
        password?: string;
      };
      expect(payload.password).toBe('s3cret');
      // Keep-on-blank must not become keep-forever, and once a secret is on
      // file the field says so instead of pretending to be empty.
      await waitFor(() => {
        expect(screen.getByPlaceholderText('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022')).toBeInTheDocument();
      });
      expect(screen.getByPlaceholderText('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022')).toHaveValue('');
    });
  });

  describe('Stored password is masked, never echoed', () => {
    it('does not load a stored password into the editable field', async () => {
      mockGetSetting.mockResolvedValue(
        JSON.stringify({
          host: 'mail.example.com',
          port: 465,
          username: 'user',
          password: 'stored-secret',
          from: 'test@example.com',
          use_tls: false,
        }),
      );
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.queryByDisplayValue('stored-secret')).toBeNull();
      expect(screen.getByPlaceholderText('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022')).toBeInTheDocument();
      // The rest of the config still loads.
      expect(screen.getByDisplayValue('mail.example.com')).toBeInTheDocument();
    });
  });

  describe('Send test report', () => {
    it('disables Send Test button when host is empty', async () => {
      await renderWithFluent(<EmailReportSettings />);
      const sendBtn = screen.getByText(/send test report/i).closest('button');
      expect(sendBtn).toBeDisabled();
    });

    it('enables Send Test button when host is filled', async () => {
      await renderWithFluent(<EmailReportSettings />);
      fireEvent.change(screen.getByPlaceholderText('smtp.example.com'), {
        target: { value: 'smtp.example.com' },
      });
      const sendBtn = screen.getByText(/send test report/i).closest('button');
      expect(sendBtn).not.toBeDisabled();
    });
  });

  describe('Report schedule', () => {
    it('renders the schedule card', async () => {
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.getByText(/report schedule/i)).toBeInTheDocument();
    });

  it('renders enabled toggle', async () => {
    await renderWithFluent(<EmailReportSettings />);
    const toggles = screen.getAllByRole('switch');
    expect(toggles.length).toBeGreaterThanOrEqual(2);
  });

    it('renders cadence select', async () => {
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.getByDisplayValue(/daily/i)).toBeInTheDocument();
    });

    it('renders time input', async () => {
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.getByDisplayValue('08:00')).toBeInTheDocument();
    });

    it('renders timezone input', async () => {
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.getByDisplayValue('UTC')).toBeInTheDocument();
    });

    it('renders lookback days input', async () => {
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.getByDisplayValue('1')).toBeInTheDocument();
    });

    it('renders report type checkboxes', async () => {
      await renderWithFluent(<EmailReportSettings />);
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThanOrEqual(7);
    });

    it('renders Add Recipient button', async () => {
      await renderWithFluent(<EmailReportSettings />);
      expect(screen.getByText(/\+ add recipient/i)).toBeInTheDocument();
    });

    it('adds a recipient input when Add Recipient clicked', async () => {
      await renderWithFluent(<EmailReportSettings />);
      fireEvent.click(screen.getByText(/\+ add recipient/i));
      const emailInputs = screen.getAllByRole('textbox', { name: /recipient/i });
      expect(emailInputs.length).toBe(1);
    });
  });
});

describe('EmailReportSettings — ID', () => {
  it('renders in Indonesian locale', async () => {
    await renderWithFluentId(<EmailReportSettings />);
    expect(screen.getByPlaceholderText('smtp.example.com')).toBeInTheDocument();
  });

  it('renders schedule card in Indonesian', async () => {
    await renderWithFluentId(<EmailReportSettings />);
    expect(screen.getByDisplayValue('08:00')).toBeInTheDocument();
  });
});
