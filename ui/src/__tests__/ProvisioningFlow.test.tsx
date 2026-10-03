import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

const mockRefreshSubscription = vi.fn();
vi.mock('@/contexts/SubscriptionContext', () => ({
  useSubscription: () => ({
    caps: null,
    state: 'loading',
    loading: false,
    refresh: mockRefreshSubscription,
  }),
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
          // Matches the real en bundle: this key now renders only on the mode CARD
          // (the header subtitle that used to duplicate it was removed).
          'setup-mode-local-desc': 'Keep this terminal completely offline. No account, no cloud sync — a free starter workspace is created on the device.',
          'setup-mode-linked-desc': 'Sign up or sign in to attach this terminal to your account, for multi-device sync, cloud backup, and your plan.',
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
          'setup-provision-gate-heading': 'Still needed before you can finish setup:',
          'setup-provision-gate-account': 'Link an account, or pick "Offline only"',
          'setup-provision-gate-store-type': 'Choose the kind of shop',
          'setup-provision-gate-location': 'Shop name',
          'setup-provision-gate-owner-name': 'Your name',
          'setup-provision-gate-username': 'Login name',
          'setup-provision-gate-pin': 'A PIN of at least 4 digits',
          'setup-provision-gate-pin-match': 'Both PINs the same',
          'setup-provision-locale-note': 'Set up in { $currency } ({ $timezone }). You can change this later in Settings.',
          'setup-provision-offline-switch-local': 'Set up without an account instead',
          'setup-account-pair-requirement': ' QR pairing needs a second phone signed in to your account.',
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
  /**
   * Fake timers restored after EVERY test, not just the ones that install them.
   *
   * Two tests drive the 3s pairing poll with fake timers and call
   * `vi.useRealTimers()` at the end of their body — but a test that FAILS
   * before reaching that line leaves the clock frozen for the next one, whose
   * `waitFor` then hangs to its 10s timeout and reports a timeout rather than
   * the real failure. This is what makes a cascade of three failures out of one
   * actual defect.
   */
  afterEach(() => {
    vi.useRealTimers();
  });

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

    // `clearAllMocks` above clears RECORDED CALLS, not implementations — and a
    // `mockResolvedValueOnce` left unconsumed by one test is still queued for
    // the next one. Two pairing tests were reading each other's session codes
    // because of it, and one timed out waiting for a button that another
    // test's queue had already answered. Every pairing/link mock is reset to a
    // neutral default here, so a test starts from a known queue.
    vi.mocked(startDevicePairing).mockReset();
    vi.mocked(startDevicePairing).mockResolvedValue({
      code: 'ABCD1234',
      poll_token: 'poll-token-xyz',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      qr_url: 'https://kasir.mu/pair?code=ABCD1234',
    });
    // Pending forever by default: a test that cares about a claim sets it.
    vi.mocked(pollDevicePairing).mockReset();
    vi.mocked(pollDevicePairing).mockResolvedValue({ status: 'pending' });
    vi.mocked(requestDeviceLinkCode).mockReset();
    vi.mocked(consumeDeviceLinkCode).mockReset();
    vi.mocked(linkDeviceGoogle).mockReset();
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

  /**
   * Advance to the following step. Disabled while the open step is unfinished,
   * so a test that clicks it is also asserting that step was answerable.
   */
  const nextStep = () => {
    fireEvent.click(screen.getByTestId('provision-step-next'));
  };
  /** Return to the previous step. Every typed value survives — see the test that pins it. */
  const backStep = () => {
    fireEvent.click(screen.getByTestId('provision-step-back'));
  };

  /**
   * Walk from step 2 to the owner step and fill it in.
   *
   * The wizard shows ONE step at a time, so filling the form is now also
   * advancing through it: each step's Next enables only once that step is
   * complete. Callers are expected to have answered step 1 already — offline
   * mode, or a linked account — because that is what enables the first Next.
   */
  const fillBasicForm = () => {
    nextStep();
    fireEvent.click(screen.getByTestId('store-type-simple-retail'));
    nextStep();
    fireEvent.change(screen.getByLabelText(/Shop name/i), { target: { value: 'Toko Berkah' } });
    fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: 'Budi Santoso' } });
    fireEvent.change(screen.getByLabelText(/Login name/i), { target: { value: 'budi' } });
    fireEvent.change(screen.getByLabelText(/^PIN/i), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText(/Confirm PIN/i), { target: { value: '1234' } });
  };

  /**
   * The progress RAIL's listitems, and only those.
   *
   * `getAllByRole('listitem')` is screen-wide, and the submit-gate explainer
   * introduced a second list (one item per unmet requirement). A test asserting
   * "the rail has three steps" must not count those — the rail's list is
   * identified by the one class name only it wears.
   */
  function railSteps(): HTMLElement[] {
    return Array.from(document.querySelectorAll('.provisioning-step'));
  }

  /** The progress-rail <li> whose visible label is `name` (it carries aria-current). */
  function stepLi(name: string): HTMLElement {
    const li = railSteps().find((n) => n.textContent?.trim().endsWith(name));
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

    // The QR view is not the default tab any more (fix 4 — the email leg is),
    // and this failure renders in that view. Ask for it by name.
    fireEvent.click(await screen.findByRole('tab', { name: /QR Pairing/i }));

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
    //
    // Scoped to the RAIL's own list: the submit-gate explainer is a second list
    // on this screen (one <li> per unmet requirement), and a screen-wide
    // count would now measure the explainer as well. The rail is what this
    // test is about.
    const steps = railSteps();
    expect(steps).toHaveLength(3);
    // The <li> is what carries aria-current; its label is a child span.
    expect(stepLi('Account')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();

    // Choosing the offline mode completes step 1 with nothing to link — and
    // Next is what advances now, not the completion itself.
    fireEvent.click(screen.getByTestId('provision-mode-local'));
    nextStep();
    expect(screen.getByText(/Step 2 of 3/i)).toBeInTheDocument();
    expect(stepLi('Account')).not.toHaveAttribute('aria-current');

    // Picking a store type completes step 2; advancing reaches the owner step.
    fireEvent.click(screen.getByTestId('store-type-simple-retail'));
    nextStep();
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

    // Step 1 done, but the owner step is untouched — one check only. The submit
    // does not exist yet: it is the primary action of the LAST step, and on
    // step 2 that action is Next.
    expect(screen.getAllByText('✓')).toHaveLength(1);
    expect(screen.queryByTestId('provision-submit')).not.toBeInTheDocument();

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

  it('does not restate the mode choice in a header subtitle', async () => {
    // The header used to repeat whichever mode was selected, directly above the
    // card that already said it with more specificity — a fourth repetition of one
    // idea on a card far taller than the viewport. Measured: removing it saves the
    // header 18px of a 1478px card. Small, but the copy was pure duplication, and
    // this pins that it does not return.
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    const header = document.querySelector('.provisioning-header');
    expect(header).not.toBeNull();
    // The h1 is the only text in the header; the mode copy lives on the cards.
    // (The progress rail also renders inside the header, so assert on the h1 and
    // on the absence of a subtitle paragraph, not on the header's whole text.)
    expect(header!.querySelectorAll('h1')).toHaveLength(1);
    expect(header!.querySelector('h1')!.textContent).toBe('Set up this terminal');
    // No subtitle paragraph as a SIBLING of the h1 (the progress rail's own
    // counter is also a <p>, but it lives inside <nav>, not directly here).
    const h1 = header!.querySelector('h1')!;
    expect(h1.nextElementSibling).toBeNull();
  });

  // ── A failed submit must be visible where the user is ──────────────
  //
  // Measured on the desktop POS viewport (1366x768): the card is 1460px, so the
  // submit button is ~250px below the top. The failure used to render in the
  // banner at the TOP of the card, which sat at errTop -87 — 87px above the
  // viewport. The merchant pressed "Finish setup", it failed, and the screen
  // showed nothing. This pins the message beside the button instead.

  it('shows a failed submit next to the submit button, not in the top banner', async () => {
    vi.mocked(provisionDevice).mockRejectedValueOnce(new Error('backend exploded'));

    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    fireEvent.click(screen.getByTestId('provision-mode-local'));
    fillBasicForm();

    const submit = screen.getByTestId('provision-submit');
    fireEvent.click(submit);

    const inline = await screen.findByTestId('provision-submit-error');
    expect(inline.textContent).toMatch(/Could not finish setting up this terminal/i);
    expect(inline.getAttribute('role')).toBe('alert');

    // It must sit immediately before the row holding the button (same gap, same
    // scroll position), not in the form-wide banner at the top of the card.
    expect(screen.getByTestId('provisioning-nav').previousElementSibling).toBe(inline);
    expect(inline.className).not.toContain('provisioning-card-top');
  });

  it('keeps the account-required guard in the top banner, where the user is', async () => {
    // That guard fires when the merchant has NOT yet linked — at which point they
    // are still at the top of the card choosing a mode, so the banner IS the
    // right place. The two paths must not be collapsed into one.
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // The default (linked) mode, no account linked. `handleSubmit` is what
    // raises the guard, and on a disabled submit the browser will not fire it —
    // so the guard is reached only when `canSubmit` passes for some other
    // reason. Its real job is the defensive branch, and what the merchant meets
    // is the account box still asking plus a Next that will not advance.
    //
    // The store type belongs to step 2, so it is NOT offered here: a merchant
    // who has not linked cannot reach it.
    expect(screen.getByRole('heading', { name: /kasir\.mu Account/i })).toBeInTheDocument();
    expect(screen.queryByTestId('store-type-simple-retail')).not.toBeInTheDocument();
    expect(screen.getByTestId('provision-step-next')).toBeDisabled();

    // No submit-scoped error is shown before anything is submitted.
    expect(screen.queryByTestId('provision-submit-error')).not.toBeInTheDocument();
  });

  it('does not open the owner fields on the linked path until the account is linked', async () => {
    // The consequence of progressive disclosure for the DEFAULT path: a merchant who
    // has not yet linked cannot reach the owner fields at all, because step 1 is not
    // done. Correct, and worth pinning — the alternative is offering fields whose
    // values the submit will refuse.
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    expect(screen.getByTestId('provision-mode-linked').getAttribute('aria-pressed')).toBe('true');
    // Step 1 is still owed, so Next will not advance — and the store type (step
    // 2) and the owner fields (step 3) are simply not offered yet. The owner
    // fields cannot be reached at all on this path until an account is linked.
    expect(screen.getByTestId('provision-step-next')).toBeDisabled();
    expect(screen.queryByTestId('store-type-simple-retail')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Shop name/i)).not.toBeInTheDocument();
  });

  // ── One step at a time ────────────────────────────────────────────
  //
  // Measured on the flows this ships to: the card was 1460px against the desktop
  // POS viewport (768px), with the store type, the shop name and the submit all
  // below the fold on first paint. The wizard now shows ONE step, so nothing the
  // merchant must act on is off-screen, and the rail at the top is navigation
  // rather than a meter they cannot use.
  //
  // The panels are conditionally rendered, not merely hidden: a withheld field
  // must be absent from the DOM, or a screen reader offers a control the merchant
  // is not allowed to reach. Values survive the trip back because they live in
  // the component's state, not in the inputs — pinned by the test above.

  it('withholds the owner fields until the earlier steps are answered', async () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // First paint: only the mode choice is offered. The store type is step 2
    // and the owner fields step 3, so neither is reachable yet.
    expect(screen.getByTestId('provision-mode-linked')).toBeInTheDocument();
    expect(screen.queryByTestId('store-type-simple-retail')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Shop name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Confirm PIN/i)).not.toBeInTheDocument();

    // Answering step 1 (offline mode) and advancing offers the store type —
    // still not the owner fields, which are a step further on.
    fireEvent.click(screen.getByTestId('provision-mode-local'));
    nextStep();
    expect(screen.getByTestId('store-type-simple-retail')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Shop name/i)).not.toBeInTheDocument();

    // Choosing a store type completes step 2; advancing reveals the owner fields.
    fireEvent.click(screen.getByTestId('store-type-simple-retail'));
    nextStep();
    expect(screen.getByLabelText(/Shop name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm PIN/i)).toBeInTheDocument();
  });

  it('keeps the owner values when a merchant goes back to correct an earlier step', async () => {
    // THE property a stepper has to hold: going back to change an answer must not
    // cost the merchant what they already typed. The values live in the
    // component's state, not in the DOM, so unmounting the panel on the way back
    // and remounting it on the way forward leaves them intact.
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    fireEvent.click(screen.getByTestId('provision-mode-local'));
    nextStep();
    fireEvent.click(screen.getByTestId('store-type-simple-retail'));
    nextStep();
    fireEvent.change(screen.getByLabelText(/Shop name/i), { target: { value: 'Toko Berkah' } });

    // Back to step 2, change the store type, then forward again.
    backStep();
    fireEvent.click(screen.getByTestId('store-type-restaurant'));
    nextStep();
    expect(screen.getByLabelText(/Shop name/i)).toHaveValue('Toko Berkah');
  });

  // ── The stepper's own contract ────────────────────────────────────
  //
  // The wizard used to be one long page whose rail was only a completion meter.
  // It looked like steps and had no way to move between them, which is why the
  // absent Back read as a defect rather than a design. These pin the three
  // properties that make it a stepper now: Next is gated, Back exists and costs
  // nothing, and the rail cannot be used to skip a gate.

  it('refuses to advance while the open step is unfinished', () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // Step 1 is owed on the default linked path, so Next is dead — and dead for
    // a reason the merchant can see: nothing is linked yet.
    expect(screen.getByTestId('provision-step-next')).toBeDisabled();
    // Back is disabled on the first step: there is nothing behind it.
    expect(screen.getByTestId('provision-step-back')).toBeDisabled();

    // Answering the step is what enables it.
    fireEvent.click(screen.getByTestId('provision-mode-local'));
    expect(screen.getByTestId('provision-step-next')).not.toBeDisabled();
  });

  it('offers the submit only on the last step, and Back on every step after the first', () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    selectOfflineMode();

    // Steps 1 and 2: the primary action is Next, and "Finish setup" is not on
    // screen yet — a button that cannot be pressed is a promise the step cannot
    // keep, and the merchant cannot even see the fields it depends on.
    expect(screen.queryByTestId('provision-submit')).not.toBeInTheDocument();
    nextStep();
    fireEvent.click(screen.getByTestId('store-type-simple-retail'));
    expect(screen.queryByTestId('provision-submit')).not.toBeInTheDocument();
    expect(screen.getByTestId('provision-step-back')).not.toBeDisabled();

    // Step 3: Next is gone and the submit has taken its place.
    nextStep();
    expect(screen.queryByTestId('provision-step-next')).not.toBeInTheDocument();
    expect(screen.getByTestId('provision-submit')).toBeInTheDocument();
  });

  it('lets the rail jump back to a completed step, but not skip past an unfinished one', () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    selectOfflineMode();
    nextStep();

    // Step 3 is not reachable by clicking its dot while step 2 is unanswered —
    // the rail must not become a way around the Next gate.
    expect(screen.getByTestId('provision-step-jump-owner')).toBeDisabled();
    // Step 1 IS complete, so its dot reopens it.
    fireEvent.click(screen.getByTestId('provision-step-jump-account'));
    expect(screen.getByTestId('provision-mode-local')).toBeInTheDocument();
    expect(screen.queryByTestId('store-type-simple-retail')).not.toBeInTheDocument();
  });

  it('opens the owner fields once every step is complete, so the form can be reviewed', async () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    fireEvent.click(screen.getByTestId('provision-mode-local'));
    fillBasicForm();
    // All three steps done -> everything open, submit reachable.
    expect(screen.getByTestId('provision-submit')).not.toBeDisabled();
    expect(screen.getByLabelText(/Shop name/i)).toBeInTheDocument();
  });

  it('defaults to the linked mode and requires an account before submitting', async () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    const linkedModeBtn = screen.getByTestId('provision-mode-linked');
    expect(linkedModeBtn.getAttribute('aria-pressed')).toBe('true');

    // The account box is rendered by default, and submit stays disabled until the
    // account is actually linked. The owner fields are withheld on this path —
    // step 1 is "is this terminal attached to an account", and the mode choice
    // alone does not answer it — so the assertion is the submit state, which is
    // what the merchant meets, rather than a fill that cannot happen yet.
    expect(screen.getByRole('heading', { name: /kasir\.mu Account/i })).toBeInTheDocument();
    // The merchant cannot leave step 1 while the account is owed, which is the
    // modern shape of "requires an account before submitting": the submit lives
    // on the last step, and this is the gate that keeps them off it.
    expect(screen.getByTestId('provision-step-next')).toBeDisabled();
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
    nextStep();
    fireEvent.click(screen.getByTestId('store-type-restaurant'));
    nextStep();
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

    // Submit stays disabled until the account is linked. The owner fields are NOT yet
    // reachable: step 1 is "is this terminal attached to an account", and on the linked
    // path the mode choice alone does not answer it (progressive disclosure).
    // The submit lives on the last step, so what the merchant meets here is a
    // Next that refuses to advance while the account is owed.
    expect(screen.getByTestId('provision-step-next')).toBeDisabled();
    expect(screen.queryByLabelText(/Shop name/i)).not.toBeInTheDocument();

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

    // Linking completes step 1, which reveals the owner fields and enables submit.
    await waitFor(() => {
      expect(screen.getByText(/Linked to owner@example\.com\./i)).toBeInTheDocument();
    }, FAST_WAIT);
    fillBasicForm();
    const submitBtn = screen.getByTestId('provision-submit');
    await waitFor(() => {
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

    // The EMAIL tab is the default now (fix 4): a merchant alone with one
    // terminal cannot scan a QR with a second signed-in phone. This test is
    // about the QR leg specifically, so it asks for it by name.
    expect(screen.getByRole('tab', { name: /Email Code/i }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /QR Pairing/i }));

    // Flush startDevicePairing microtasks
    await vi.runOnlyPendingTimersAsync();

    expect(startDevicePairing).toHaveBeenCalledWith('Tablet POS');
    expect(screen.getByTestId('pairing-code-badge')).toHaveTextContent('ABCD - 1234');
    expect(screen.getByTestId('pairing-qr-wrapper')).toBeInTheDocument();

    // Advance 3s to trigger second poll which claims device
    await vi.advanceTimersByTimeAsync(3000);

    expect(pollDevicePairing).toHaveBeenCalledWith('poll-token-xyz');
    expect(screen.getByText(/Linked to tablet-merchant@example\.com\./i)).toBeInTheDocument();

    // (Real timers are restored for every test by the afterEach hook, so a
    // failure above cannot freeze the clock for the rest of the suite.)
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

    // The Email Code subtab is ALREADY the selected one (fix 4). This test used
    // to click it, which passed on the old default too — so the assertion that
    // it is selected is now the load-bearing part, not a side effect of a tap.
    const emailTab = screen.getByRole('tab', { name: /Email Code/i });
    expect(emailTab.getAttribute('aria-selected')).toBe('true');
    // And the QR route is still exactly one tap away: the default changed, it
    // was not removed.
    expect(screen.getByRole('tab', { name: /QR Pairing/i })).toBeInTheDocument();

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

  // ── Fix 1: the submit gate explains itself, and takes you to the field ──
  //
  // A `disabled` button cannot be pressed, so it cannot explain itself either.
  // Every unmet clause of `canSubmit` was a dead control with no stated reason,
  // and two of them (store type, PIN length) are not fields the merchant is
  // looking at. Worse, the card runs well past the viewport on the terminal this
  // ships to, so naming the problem is not enough — focus has to move too.
  //
  // Every test here has a negative control: removing either half (the list, or
  // the focus move) makes it fail.

  it('names every unmet requirement of the submit gate beside the button', () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // The gate list lives on the LAST step, beside the button it explains, so
    // the test walks there first. That is also why it names the OWNER fields:
    // the account and store-type requirements are enforced by the Next gate, and
    // a merchant cannot reach this step with either outstanding. The list and the
    // step gate are not two systems — they are one predicate, split by step.
    selectOfflineMode();
    nextStep();
    fireEvent.click(screen.getByTestId('store-type-simple-retail'));
    nextStep();

    // The list sits ABOVE the button — the control that cannot be pressed.
    const blockers = screen.getByTestId('provision-submit-blockers');
    const submit = screen.getByTestId('provision-submit');
    expect(submit).toBeDisabled();
    expect(blockers.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Announced politely, not as an interrupting alert: this list updates on
    // every keystroke, and an alert per character would talk over typing.
    expect(blockers.getAttribute('role')).toBe('status');

    // Every owner field still owed is named, including the one requirement that
    // is not a field (the PIN length).
    expect(within(blockers).getByText(/Shop name/i)).toBeInTheDocument();
    expect(within(blockers).getByText(/A PIN of at least 4 digits/i)).toBeInTheDocument();
  });

  it('each gate item moves focus to the control that must change', () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    selectOfflineMode();
    // Answering steps 1 and 2 and advancing opens the owner fields, so the
    // remaining blockers are fields that exist and can take focus.
    nextStep();
    fireEvent.click(screen.getByTestId('store-type-simple-retail'));
    nextStep();
    const blockers = screen.getByTestId('provision-submit-blockers');
    expect(within(blockers).queryByText(/Choose the kind of shop/i)).not.toBeInTheDocument();

    // The PIN item focuses the PIN field itself, not the confirm field: the
    // length is what is missing.
    fireEvent.click(within(blockers).getByText(/A PIN of at least 4 digits/i));
    expect(document.activeElement).toBe(screen.getByLabelText(/^PIN/i));

    // And it moves, rather than staying put on a repeat press — otherwise the
    // control looks broken to a keyboard user.
    fireEvent.click(within(blockers).getByText(/Shop name/i));
    expect(document.activeElement).toBe(screen.getByLabelText(/Shop name/i));
  });

  it('drops a requirement from the gate as soon as it is satisfied', () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    selectOfflineMode();
    nextStep();
    fireEvent.click(screen.getByTestId('store-type-simple-retail'));
    nextStep();

    const blockers = () => screen.getByTestId('provision-submit-blockers');
    // Four owner fields are still empty, plus the PIN agreement.
    expect(within(blockers()).getByText(/Shop name/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Shop name/i), { target: { value: 'Toko Berkah' } });
    expect(within(blockers()).queryByText(/Shop name/i)).not.toBeInTheDocument();

    // When nothing is left, the explainer leaves with the disabled button —
    // it must not linger as a stale list under an enabled submit.
    fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: 'Budi Santoso' } });
    fireEvent.change(screen.getByLabelText(/Login name/i), { target: { value: 'budi' } });
    fireEvent.change(screen.getByLabelText(/^PIN/i), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText(/Confirm PIN/i), { target: { value: '1234' } });
    expect(screen.queryByTestId('provision-submit-blockers')).not.toBeInTheDocument();
    expect(screen.getByTestId('provision-submit')).not.toBeDisabled();
  });

  it('the gate list cannot disagree with the gate: they agree at every step', () => {
    // The load-bearing property. If the list and `canSubmit` ever come from
    // different values, the merchant is told the form is complete while the
    // button refuses (or worse, the reverse). Walking the form proves they are
    // the same predicate by construction.
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    // The gate and its list both live on the last step, so walk there: steps 1
    // and 2 are answered on the way, which is exactly what makes the remaining
    // list the owner fields.
    selectOfflineMode();
    nextStep();
    fireEvent.click(screen.getByTestId('store-type-simple-retail'));
    nextStep();

    const submit = screen.getByTestId('provision-submit');
    const outstanding = () =>
      screen.queryAllByRole('listitem').filter((li) => li.closest('.provisioning-submit-blockers')).length;

    expect(submit).toBeDisabled();
    const start = outstanding();
    expect(start).toBeGreaterThan(0);

    // One requirement satisfied: the list shrinks by exactly one and the button
    // still refuses, so the two are demonstrably the same predicate.
    fireEvent.change(screen.getByLabelText(/Shop name/i), { target: { value: 'Toko Berkah' } });
    expect(outstanding()).toBe(start - 1);
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: 'Budi Santoso' } });
    fireEvent.change(screen.getByLabelText(/Login name/i), { target: { value: 'budi' } });
    fireEvent.change(screen.getByLabelText(/^PIN/i), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText(/Confirm PIN/i), { target: { value: '1234' } });
    expect(outstanding()).toBe(0);
    expect(submit).not.toBeDisabled();
  });

  // ── Fix 2: offline is a warning WITH a way out, not a dead end ──────────
  //
  // `provision_device` is local SQLite — what offline blocks is the LINK, not
  // the setup. The warning said only why linking was impossible while every
  // control that could change that was disabled, which left the one mode that
  // still works a tap away with no explanation of its own.

  it('offers a one-click switch to the offline mode while disconnected', () => {
    setOnline(false);
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // The reason is still stated…
    expect(screen.getByTestId('provision-offline-switch')).toHaveTextContent(
      /Internet connection is required/i,
    );
    // …AND the way out is on the same box.
    const escape = screen.getByTestId('provision-offline-use-local');
    fireEvent.click(escape);

    // Which completes step 1, so Next advances and the merchant is no longer
    // stranded at a decision they cannot act on.
    expect(screen.getByTestId('provision-mode-local').getAttribute('aria-pressed')).toBe('true');
    nextStep();
    fireEvent.click(screen.getByTestId('store-type-simple-retail'));
    nextStep();
    expect(screen.getByLabelText(/Shop name/i)).toBeInTheDocument();
  });

  it('hides the offline escape once it has been taken', () => {
    setOnline(false);
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    fireEvent.click(screen.getByTestId('provision-offline-use-local'));

    // Pointing the merchant at the local mode while they are already in it is
    // noise: the switch is a route out of the linked path only.
    expect(screen.queryByTestId('provision-offline-use-local')).not.toBeInTheDocument();
    // Stronger than that: on the local path there is no account box at all, so
    // the warning it lived in goes with it — nothing is still claiming a
    // connection is required for a mode that requires no connection.
    expect(screen.queryByTestId('provision-offline-switch')).not.toBeInTheDocument();
    expect(screen.queryByText(/Internet connection is required/i)).not.toBeInTheDocument();
  });

  // ── Fix 3: an expired pairing code replaces itself ─────────────────────
  //
  // The expiry used to be reported only AFTER the merchant came back to the
  // screen with a QR that no longer worked, and the only remedy was pressing
  // "Refresh Code". Nothing appeared at the moment the code died, so the first
  // reaction — scan it again, because it used to work — failed invisibly.

  it('mints a fresh pairing code the moment the old one expires', async () => {
    vi.useFakeTimers();
    vi.mocked(isTabletShell).mockReturnValue(true);
    // The FIRST session is already expired when it arrives; the second is live.
    // Both `expires_at` values are built from the FAKE clock, so the fake
    // timers must be installed BEFORE the mock is set up — otherwise "one
    // second ago" is measured against the real clock and the session is live.
    vi.mocked(startDevicePairing)
      .mockResolvedValueOnce({
        code: 'OLD12345',
        poll_token: 'tok-old',
        expires_at: new Date(Date.now() - 1000).toISOString(),
        qr_url: 'https://kasir.mu/pair?code=OLD12345',
      })
      .mockResolvedValueOnce({
        code: 'NEW12345',
        poll_token: 'tok-new',
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        qr_url: 'https://kasir.mu/pair?code=NEW12345',
      });

    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    // `getByRole`, not `findByRole`: fake timers are installed, and testing-library's
    // `findBy` waits on those same fake timers, so it hangs until the 10s
    // timeout instead of resolving.
    fireEvent.click(screen.getByRole('tab', { name: /QR Pairing/i }));
    // Exactly zero milliseconds: the first session's promise has to settle and
    // paint, and the 3s poll must NOT have run yet. (runOnlyPendingTimersAsync
    // would fire the interval here, so by the time we looked the replacement
    // would already be on screen — which is the behaviour, but it left this
    // test asserting a frame the merchant never sees.)
    await vi.advanceTimersByTimeAsync(0);

    // The dead code is on screen first.
    expect(screen.getByTestId('pairing-code-badge')).toHaveTextContent('OLD1 - 2345');

    // One poll tick later — 3s, which is what the merchant would have had to
    // wait before even learning the code was dead.
    await vi.advanceTimersByTimeAsync(3000);

    expect(startDevicePairing).toHaveBeenCalledTimes(2);
    // The replacement is on screen WITHOUT a press, and it is the one the
    // merchant would scan.
    expect(screen.getByTestId('pairing-code-badge')).toHaveTextContent('NEW1 - 2345');
    // No "expired" notice competing with a perfectly good new code.
    expect(screen.queryByText(/Pairing code expired/i)).not.toBeInTheDocument();
  });

  it('keeps the manual refresh available when the automatic one fails', async () => {
    // The auto-refresh must not REPLACE the hand escape: it calls the same
    // `loadPairingSession`, and if THAT fails the merchant is offline or the
    // server is down — the case a button is for. If the failure had silently
    // dropped the retry, this test would see a dead tab again.
    vi.useFakeTimers();
    vi.mocked(isTabletShell).mockReturnValue(true);
    vi.mocked(startDevicePairing)
      .mockResolvedValueOnce({
        code: 'OLD12345',
        poll_token: 'tok-old',
        expires_at: new Date(Date.now() - 1000).toISOString(),
        qr_url: 'https://kasir.mu/pair?code=OLD12345',
      })
      .mockRejectedValue(new Error('network down'));

    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    // Same reason as the test above: `findByRole` waits on the fake clock.
    fireEvent.click(screen.getByRole('tab', { name: /QR Pairing/i }));
    // 0ms first: the dead session must be ON SCREEN before the poll can notice
    // it is dead. 3s after that is the tick that mints the replacement.
    await vi.advanceTimersByTimeAsync(0);
    // 1st call: the first (already dead) session. This tick's 2nd call is the
    // automatic refresh, and it is the one that fails.
    await vi.advanceTimersByTimeAsync(3000);
    expect(startDevicePairing).toHaveBeenCalledTimes(2);

    // getByRole, not findByRole: the fake clock is still installed, and
    // findBy waits on it, so the wait could only end in the 10s timeout.
    const retry = screen.getByRole('button', { name: /Refresh Code/i });
    // 3rd call: the merchant pressing it by hand.
    fireEvent.click(retry);
    expect(startDevicePairing).toHaveBeenCalledTimes(3);
  });

  // ── Fix 4: the tablet opens on the route a solo merchant can actually use ──

  it('opens the tablet on the email route, and says what QR needs', () => {
    vi.mocked(isTabletShell).mockReturnValue(true);
    vi.mocked(startDevicePairing).mockResolvedValue({
      code: 'ABCD1234',
      poll_token: 'tok',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      qr_url: 'https://kasir.mu/pair?code=ABCD1234',
    });
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // The DEFAULT is the email leg. QR asks for a second phone already signed
    // in to the account — three-part precondition on the first screen of setup,
    // which a merchant with one terminal alone cannot meet.
    expect(screen.getByRole('tab', { name: /Email Code/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /QR Pairing/i })).toHaveAttribute('aria-selected', 'false');
    // The cost is disclosed rather than discovered at the tab.
    expect(screen.getByText(/QR pairing needs a second phone signed in/i)).toBeInTheDocument();

    // And no pairing session is minted for a route the merchant did not open:
    // starting one is a network call, and the automatic-start effect is gated
    // on the QR tab for exactly that reason.
    expect(startDevicePairing).not.toHaveBeenCalled();
  });

  // ── Fix 5: the currency and timezone this terminal is set up with ────────

  it('discloses the currency and timezone the submit sends', async () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    // Both have always been sent in the payload; before this the merchant was
    // told neither, and discovered them after opening the register.
    expect(screen.getByTestId('provisioning-locale-note')).toHaveTextContent('Set up in IDR (Asia/Jakarta)');

    // The disclosure quotes the SAME constants the submit sends — a disclosure
    // naming different ones would be worse than none. Asserted against the
    // actual payload, not against the note.
    selectOfflineMode();
    fillBasicForm();
    fireEvent.click(screen.getByTestId('provision-submit'));
    // The submit awaits the device id and the preset lookup before provisioning,
    // so the payload is asserted once it exists rather than synchronously.
    await waitFor(() => {
      expect(provisionDevice).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'IDR', timezone: 'Asia/Jakarta' }),
      );
    }, FAST_WAIT);
  });

  it('carries the version and IP footer every other setup surface shows', () => {
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);
    // The footer was already invented and agreed on (MobileSetupHub, the three
    // auth modals, StaffLoginScreen, LicenseActivationScreen); this flow was
    // the one screen that omitted it, so a merchant told their version on the
    // next screen read a different one here.
    expect(screen.getByTestId('provisioning-footer')).toHaveTextContent(
      'v0.0.41 • kasir.mu © 2026 All rights reserved.',
    );
  });

  it('refreshes subscription capabilities when provisioning finishes successfully', async () => {
    mockRefreshSubscription.mockClear();
    mockOnProvisioned.mockClear();
    render(<ProvisioningFlow onProvisioned={mockOnProvisioned} />);

    selectOfflineMode();
    fillBasicForm();
    fireEvent.click(screen.getByTestId('provision-submit'));

    await waitFor(() => {
      expect(provisionDevice).toHaveBeenCalled();
      expect(mockRefreshSubscription).toHaveBeenCalled();
      expect(mockOnProvisioned).toHaveBeenCalled();
    }, FAST_WAIT);
  });
});

