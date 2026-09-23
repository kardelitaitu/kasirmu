import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProvisioningFlow from '../features/setup/ProvisioningFlow';
import { getPresetFeatures, provisionDevice } from '@/api/settings';
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
  getPresetFeatures: vi.fn(),
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
          'setup-provision-step-account': 'Account',
          'setup-provision-step-store': 'Shop',
          'setup-provision-step-owner': 'Owner',
          'setup-mode-local-title': 'Standalone (Offline)',
          'setup-mode-linked-title': 'Link kasir.mu Account (Free)',
          'setup-provision-account-section': 'kasir.mu Account',
          'setup-provision-offline-warn': 'Internet connection is required to create or link your account.',
          'setup-tab-pair': 'QR Pairing',
          'setup-tab-email': 'Email Code',
          'setup-account-email': 'Email address',
          'setup-account-code': 'Verification code',
          // Visible labels for the same two fields. Deliberately DIFFERENT text
          // from the placeholder keys above, so a query by accessible name
          // cannot accidentally pass by matching the placeholder.
          'setup-account-email-label': 'Account email',
          'setup-account-code-label': 'Verification code',
          'setup-account-failed': 'Failed to connect account.',
          'setup-account-retry': 'Try again',
          'setup-account-send-failed': 'Could not send the code. Check the address and try again.',
          'setup-account-verify-failed': 'That code did not work. Check it and try again, or resend.',
          'setup-provision-account-required': 'Please link your kasir.mu account before finishing setup.',
          'setup-provision-success': 'This terminal is ready.',
          'setup-provision-pin-too-short': 'Use at least 4 digits.',
          'setup-provision-pin-mismatch': 'These PINs do not match yet.',
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
    // Default: the preset lookup answers. Individual tests override it.
    vi.mocked(getPresetFeatures).mockResolvedValue({ features: [] });
  });

  /**
   * Opt into the offline-only setup mode.
   *
   * The flow now defaults to the linked mode (the free plan attaches to an
   * account), so every test that is about something OTHER than account linking
   * has to leave that mode explicitly — otherwise it measures the gate instead
   * of the thing it names.
   */
  const selectOfflineMode = () => {
    fireEvent.click(screen.getByTestId('provision-mode-local'));
  };
  /**
   * Drive the connection state the component reads.
   *
   * Both halves matter and they are different mechanisms: `navigator.onLine` is
   * the value read at mount (the useState initializer), while the online/offline
   * EVENTS are what keep it current afterwards. Setting one without the other
   * would test a component nobody ships.
   */
  const setOnline = (online: boolean) => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    });
    // Inside act(): the dispatch calls setIsOffline, and React will not have
    // applied that re-render by the time the assertion runs otherwise.
    act(() => {
      window.dispatchEvent(new Event(online ? 'online' : 'offline'));
    });
  };

  const fillBasicForm = () => {
    fireEvent.click(screen.getByTestId('store-type-simple-retail'));
    fireEvent.change(screen.getByLabelText(/Shop name/i), { target: { value: 'Toko Berkah' } });
    fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: 'Budi Santoso' } });
    fireEvent.change(screen.getByLabelText(/Login name/i), { target: { value: 'budi' } });
    fireEvent.change(screen.getByLabelText(/^PIN/i), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText(/Confirm PIN/i), { target: { value: '1234' } });
  };

  /** The progress-rail <li> whose visible label is `name` (it carries aria-current). */
  function stepLi(name: string): HTMLElement {
    const li = screen
      .getAllByRole('listitem')
      .find((n) => n.textContent?.trim().endsWith(name));
    if (!li) throw new Error(`no progress step labelled "${name}"`);
    return li;
  }

  // The account is the DEFAULT path, because the free plan attaches to one.
  // "Offline only" stays reachable — a merchant with no connection still has to
  // be able to set the terminal up — but it is now the deliberate exception, so
  // it is selected explicitly here rather than assumed.
  // ── A failed pairing attempt must not dead-end the tab ─────────────
  //
  // The auto-start effect is gated on `!pairingError`, so once a start fails it
  // never retries. Before this fix the only way back was re-clicking the QR
  // Pairing tab that already looked selected - an invisible affordance on a
  // control that appears active.

  it('offers a retry when starting the pairing session fails', async () => {
    vi.mocked(isTabletShell).mockReturnValue(true);
    vi.mocked(startDevicePairing)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        code: 'ABCD1234',
        poll_token: 'tok',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        qr_url: 'https://kasir.mu/pair?code=ABCD1234',
      });

    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // The failure surfaces, and a control to retry is offered beside it.
    const retry = await screen.findByRole('button', { name: /Refresh Code/i });
    fireEvent.click(retry);

    await waitFor(() => {
      expect(startDevicePairing).toHaveBeenCalledTimes(2);
    });
    // The retry actually recovers rather than failing the same way.
    expect(await screen.findByTestId('pairing-code-badge')).toBeInTheDocument();
  });
  // ── A failed Google link must not dead-end the control ─────────────
  //
  // `link.kind === 'failed'` was set by the catch and read by nothing, so the
  // only signal was the form-wide banner and the button looked untouched — the
  // merchant could not tell the attempt from the first paint. Mirrors the
  // pairing-retry test above, which fixed the same shape one branch over.

  it('offers a retry when linking with Google fails', async () => {
    vi.mocked(linkDeviceGoogle)
      .mockRejectedValueOnce(new Error('browser closed'))
      .mockResolvedValueOnce({
        tenantId: 'tenant-retry-1',
        provider: 'google',
        email: 'retry@example.com',
      });

    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }));

    // The failure is named next to the control that caused it...
    const retry = await screen.findByRole('button', { name: /Try again/i });
    expect(screen.getByText(/Could not link this device/i)).toBeInTheDocument();

    // ...and the retry recovers rather than failing the same way.
    fireEvent.click(retry);
    await waitFor(() => {
      expect(linkDeviceGoogle).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/Linked to retry@example\.com\./i)).toBeInTheDocument();
    }, FAST_WAIT);
  });

  // ── The two email-leg failures are different problems ──────────────
  //
  // Both used to set one state ('failed') and one sentence via the form-wide
  // banner at the top of the card. A rejected code and a mail server that never
  // answered are not the same problem and do not have the same fix, and the
  // message belonged under the field, not two sections above it.

  it('names a failed send and offers no code field to fill in', async () => {
    vi.mocked(isTabletShell).mockReturnValue(true);
    vi.mocked(startDevicePairing).mockResolvedValueOnce({
      code: 'ABCD1234',
      poll_token: 'poll-token-xyz',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      qr_url: 'https://kasir.mu/pair?code=ABCD1234',
    });
    vi.mocked(requestDeviceLinkCode).mockRejectedValueOnce(new Error('smtp down'));

    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    fireEvent.click(screen.getByTestId('provision-mode-linked'));
    fireEvent.click(screen.getByRole('tab', { name: /Email Code/i }));
    fireEvent.change(screen.getByLabelText(/^Account email$/i), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email me a code/i }));

    // The send-specific sentence, not the link-failure one.
    expect(
      await screen.findByText(/Could not send the code/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Failed to connect account/i)).not.toBeInTheDocument();
    // No code was ever sent, so there is nothing to type into.
    expect(screen.queryByLabelText(/Verification code/i)).not.toBeInTheDocument();
  });

  it('names a rejected code, and keeps the code field so it can be retyped', async () => {
    vi.mocked(isTabletShell).mockReturnValue(true);
    vi.mocked(startDevicePairing).mockResolvedValueOnce({
      code: 'ABCD1234',
      poll_token: 'poll-token-xyz',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      qr_url: 'https://kasir.mu/pair?code=ABCD1234',
    });
    vi.mocked(requestDeviceLinkCode).mockResolvedValueOnce(undefined);
    vi.mocked(consumeDeviceLinkCode).mockRejectedValueOnce(new Error('bad code'));

    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    fireEvent.click(screen.getByTestId('provision-mode-linked'));
    fireEvent.click(screen.getByRole('tab', { name: /Email Code/i }));
    fireEvent.change(screen.getByLabelText(/^Account email$/i), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email me a code/i }));

    const codeInput = await screen.findByLabelText(/Verification code/i);
    fireEvent.change(codeInput, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }));

    // The verify-specific sentence, and the field stays so the code can be fixed.
    expect(await screen.findByText(/That code did not work/i)).toBeInTheDocument();
    expect(screen.queryByText(/Could not send the code/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Verification code/i)).toBeInTheDocument();
  });

  // ── The progress rail ──────────────────────────────────────────────
  //
  // Measured on a 1366px tablet: the card is 1423px tall, so the submit button
  // and the last two fields start below the fold. The rail is what tells the
  // merchant how much form is left. Its steps are derived from the SAME values
  // `canSubmit` gates on, so the rail cannot claim "done" while the button is
  // still disabled — the two would drift apart otherwise.

  it('marks step 1 current on first paint and finishes as the form fills', async () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // Offering three steps, none complete, positioned at the first.
    // The three labels are the accessible names of their <li>, and aria-current
    // sits on the <li> — not on the inner label span `getByText` returns.
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    // The <li> is what carries aria-current; its label is a child span.
    expect(stepLi('Account')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();

    // Choosing the offline mode completes step 1 with nothing to link.
    fireEvent.click(screen.getByTestId('provision-mode-local'));
    expect(screen.getByText(/Step 2 of 3/i)).toBeInTheDocument();
    expect(stepLi('Account')).not.toHaveAttribute('aria-current');

    // Picking a store type advances to the owner step.
    fireEvent.click(screen.getByTestId('store-type-simple-retail'));
    expect(screen.getByText(/Step 3 of 3/i)).toBeInTheDocument();
    expect(stepLi('Owner')).toHaveAttribute('aria-current', 'step');
  });

  it('links the rail and the submit button: the last step completes exactly when submit enables', async () => {
    // The load-bearing property. If these ever disagree, the merchant is told the
    // form is finished while the button refuses, which is the dead-control defect
    // the PIN messages fixed — reintroduced by the rail.
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    fireEvent.click(screen.getByTestId('provision-mode-local'));
    fillBasicForm();

    expect(screen.getByTestId('provision-submit')).not.toBeDisabled();
    // All three markers show a check, and no step claims to be current.
    expect(screen.getAllByText('✓')).toHaveLength(3);
    expect(screen.queryByText(/Step \d of 3/i)?.textContent).toContain('3');
  });

  it('never marks a step done while submit is still disabled', async () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    fireEvent.click(screen.getByTestId('provision-mode-local'));

    // Step 1 done, but the owner step is untouched — one check only.
    expect(screen.getAllByText('✓')).toHaveLength(1);
    expect(screen.getByTestId('provision-submit')).toBeDisabled();

    // Now fill EVERYTHING except the PIN agreement. The owner step must stay
    // incomplete, because `canSubmit` still refuses. This is the half that
    // actually pins the linkage: an earlier version of this test filled only
    // step 1, so dropping the PIN check from the rail left it green.
    fillBasicForm();
    fireEvent.change(screen.getByLabelText(/Confirm PIN/i), { target: { value: '9999' } });
    expect(screen.getByTestId('provision-submit')).toBeDisabled();
    expect(screen.getAllByText('✓')).toHaveLength(2);
    expect(stepLi('Owner')).toHaveAttribute('aria-current', 'step');

    // Agreeing completes it, and the two advance together.
    fireEvent.change(screen.getByLabelText(/Confirm PIN/i), { target: { value: '1234' } });
    expect(screen.getByTestId('provision-submit')).not.toBeDisabled();
    expect(screen.getAllByText('✓')).toHaveLength(3);
  });

  it('defaults to the linked mode and requires an account before submitting', async () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    const linkedModeBtn = screen.getByTestId('provision-mode-linked');
    expect(linkedModeBtn.getAttribute('aria-pressed')).toBe('true');

    // The account box is rendered by default, and submit stays disabled
    // until the account is actually linked.
    expect(screen.getByRole('heading', { name: /kasir\.mu Account/i })).toBeInTheDocument();

    fillBasicForm();
    expect(screen.getByTestId('provision-submit')).toBeDisabled();
  });

  it('Mode 1 (Offline only) allows completion without internet/account', async () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // Opt into the offline path explicitly.
    fireEvent.click(screen.getByTestId('provision-mode-local'));
    expect(screen.getByTestId('provision-mode-local').getAttribute('aria-pressed')).toBe('true');

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

  // ── The store type must reach the terminal as FEATURES ────────────
  //
  // Before this, the flow sent `features: []` unconditionally, so a terminal
  // provisioned as a Restaurant opened with no features at all - no kitchen
  // display, no tables, no cash. The store type was collected and then dropped.

  it('sends the chosen store type AS the feature set, not an empty list', async () => {
    vi.mocked(getPresetFeatures).mockResolvedValueOnce({
      features: ['restaurant', 'kitchen-display', 'table-management', 'cash-payment'],
    });

    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    selectOfflineMode();
    fireEvent.click(screen.getByTestId('store-type-restaurant'));
    fireEvent.change(screen.getByLabelText(/Shop name/i), { target: { value: 'Warung Makan' } });
    fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: 'Budi Santoso' } });
    fireEvent.change(screen.getByLabelText(/Login name/i), { target: { value: 'budi' } });
    fireEvent.change(screen.getByLabelText(/^PIN/i), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText(/Confirm PIN/i), { target: { value: '1234' } });
    fireEvent.click(screen.getByTestId('provision-submit'));

    await waitFor(() => {
      // The lookup is asked for the store type the merchant picked...
      expect(getPresetFeatures).toHaveBeenCalledWith('restaurant');
      // ...and its answer is what provisioning receives.
      expect(provisionDevice).toHaveBeenCalledWith(
        expect.objectContaining({
          preset: 'restaurant',
          features: ['restaurant', 'kitchen-display', 'table-management', 'cash-payment'],
          location_kind: 'restaurant',
        }),
      );
    }, FAST_WAIT);
  });

  it('a shop does not receive the restaurant feature set', async () => {
    vi.mocked(getPresetFeatures).mockResolvedValueOnce({
      features: ['simple-retail', 'cash-payment', 'barcode-scanning'],
    });

    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    selectOfflineMode();
    fillBasicForm();
    fireEvent.click(screen.getByTestId('provision-submit'));

    await waitFor(() => {
      expect(getPresetFeatures).toHaveBeenCalledWith('simple-retail');
      const sent = vi.mocked(provisionDevice).mock.calls[0]![0];
      expect(sent.features).not.toContain('kitchen-display');
      expect(sent.location_kind).toBe('retail');
    }, FAST_WAIT);
  });

  it('still provisions when the preset lookup fails, rather than stranding the merchant', async () => {
    // An unknown store type must degrade to an empty set, the same way
    // `write_provisioning_settings` skips an unknown feature key. Failing the
    // submit here would leave the merchant stuck at the first-run screen.
    vi.mocked(getPresetFeatures).mockRejectedValueOnce(new Error('unknown store preset'));

    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    selectOfflineMode();
    fillBasicForm();
    fireEvent.click(screen.getByTestId('provision-submit'));

    await waitFor(() => {
      expect(provisionDevice).toHaveBeenCalledWith(
        expect.objectContaining({ features: [] }),
      );
      expect(mockOnProvisioned).toHaveBeenCalled();
    }, FAST_WAIT);
  });

  // ── Inline PIN feedback ────────────────────────────────────────────
  //
  // `canSubmit` disables the submit button on a short or mismatched PIN. Before
  // these messages the merchant got a dead button and no reason for it: the
  // requirements were only discoverable by guessing.

  // ── The offline hard-block ─────────────────────────────────────────
  //
  // The flow's most important safety behaviour had NO coverage: no suite in the
  // repository mocked `navigator.onLine`, so nothing measured what a disconnected
  // merchant faces. Two distinct promises are asserted here — the account controls
  // must refuse while offline, and the offline-only path must keep working.

  it('refuses account linking while offline and explains why', async () => {
    setOnline(false);
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // The warning names the reason rather than leaving a dead control.
    expect(
      screen.getByText('Internet connection is required to create or link your account.'),
    ).toBeInTheDocument();

    // Every route into an account is refused: the Google control and, on tablet,
    // both the pairing and email paths.
    expect(screen.getByRole('button', { name: /Continue with Google/i })).toBeDisabled();
  });

  it('still lets a disconnected merchant provision offline', async () => {
    // The hard-block is on the ACCOUNT, not on setup. A merchant with no
    // connection must still be able to open a register — that is the whole point
    // of the offline-only mode, and blocking it would strand them at first run.
    setOnline(false);
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    selectOfflineMode();
    fillBasicForm();

    const submit = screen.getByTestId('provision-submit');
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(provisionDevice).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'local' }),
      );
      expect(mockOnProvisioned).toHaveBeenCalled();
    }, FAST_WAIT);
  });

  it('clears the offline warning when the connection returns', async () => {
    // The listener pair is the reason the warning is not frozen at mount: a
    // merchant who reconnects mid-setup must be able to link without a reload.
    setOnline(false);
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    const warn = 'Internet connection is required to create or link your account.';
    expect(screen.getByText(warn)).toBeInTheDocument();

    setOnline(true);
    expect(screen.queryByText(warn)).toBeNull();
    expect(screen.getByRole('button', { name: /Continue with Google/i })).not.toBeDisabled();
  });
  it('names a PIN mismatch instead of leaving the submit button silently dead', async () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    selectOfflineMode();
    fillBasicForm();
    fireEvent.change(screen.getByLabelText(/Confirm PIN/i), { target: { value: '9999' } });

    expect(await screen.findByText('These PINs do not match yet.')).toBeInTheDocument();
    // Marked for assistive tech as well as shown visually.
    const confirm = screen.getByLabelText(/Confirm PIN/i);
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(confirm).toHaveAttribute('aria-describedby', 'provision-pin-error');
    expect(screen.getByTestId('provision-submit')).toBeDisabled();
  });

  it('names a too-short PIN', async () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    selectOfflineMode();
    fillBasicForm();
    // Clear the confirmation as well. With only the PIN shortened, the two fields
    // genuinely DO differ and the mismatch message is the correct one to show —
    // so this case has to isolate length to be measuring what it names.
    fireEvent.change(screen.getByLabelText(/Confirm PIN/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/^PIN/i), { target: { value: '12' } });

    expect(await screen.findByText('Use at least 4 digits.')).toBeInTheDocument();
  });

  it('shows no PIN complaint before the user has typed anything', async () => {
    // A mismatch notice on first paint would be an accusation rather than help:
    // there is nothing to mismatch yet.
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    selectOfflineMode();

    expect(screen.queryByText('These PINs do not match yet.')).toBeNull();
    expect(screen.queryByText('Use at least 4 digits.')).toBeNull();
  });

  it('clears the complaint once the PINs agree again', async () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    selectOfflineMode();
    fillBasicForm();
    const confirm = screen.getByLabelText(/Confirm PIN/i);
    fireEvent.change(confirm, { target: { value: '9999' } });
    expect(await screen.findByText('These PINs do not match yet.')).toBeInTheDocument();

    fireEvent.change(confirm, { target: { value: '1234' } });
    expect(screen.queryByText('These PINs do not match yet.')).toBeNull();
    expect(confirm).not.toHaveAttribute('aria-invalid');
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
    vi.mocked(requestDeviceLinkCode).mockResolvedValueOnce(undefined);
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

    // Input email and send code. Queried by its accessible NAME, not its
    // placeholder: the field used to have only a placeholder, which is not a
    // label — the two fields below were unreachable by name for a screen
    // reader, and getByPlaceholderText was the only way to find them.
    const emailInput = screen.getByLabelText(/^Account email$/i);
    fireEvent.change(emailInput, { target: { value: 'owner-tablet@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Email me a code/i }));

    await waitFor(() => {
      expect(requestDeviceLinkCode).toHaveBeenCalledWith('owner-tablet@example.com');
      expect(screen.getByLabelText(/Verification code/i)).toBeInTheDocument();
    }, FAST_WAIT);

    // Input code and verify
    const codeInput = screen.getByLabelText(/Verification code/i);
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

