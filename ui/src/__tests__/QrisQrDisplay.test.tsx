// ── QrisQrDisplay exit-animation tests ────────────────────────────
//
// Pins the contract for the entry+exit cohesion added in the
// sibling-surfaces polish. The × button triggers a layered
// (overlay + container) fade via mirror keyframes. The payment-
// confirmed flow intentionally SNAPS (it's a navigate-to-next-state
// transition where the parent unmounts QrisQrDisplay directly —
// adding a fade-out here would visually double-up per the skill's
// rule).
//
// Test consumer pattern: a real React component (HostModal) drives
// the modal's `isOpen` state, with a mutable `hostRef` so the test
// can peek at state synchronously WITHOUT calling React hooks
// outside a render context (which would throw "useState is null").

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { act } from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { withFluent } from '@/locales/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import QrisQrDisplay from '@/components/QrisQrDisplay';

import {
  ExitAnimHost,
  createExitAnimHostRef,
  advanceFadeSync,
  expectExiting,
  expectNotExiting,
} from './test-utils/exitAnimHost';
import type { ExitAnimHostRef } from './test-utils/exitAnimHost';

// ── Mutable host-state ref (extends shared ExitAnimHostRef) ───────

interface HostRef extends ExitAnimHostRef {
  paid: boolean;
  setPaid: (v: boolean) => void;
}

function makeHostRef(): HostRef {
  return { ...createExitAnimHostRef(), paid: false, setPaid: () => {} };
}

function HostModal({
  initialOpen = true,
  hostRef,
  onPaymentConfirmed,
}: {
  initialOpen?: boolean;
  hostRef: HostRef;
  onPaymentConfirmed?: () => void;
}) {
  const [paid, setPaid] = useState(false);
  // Mirror extra state into the ref on every render so tests can read
  // it synchronously after fireEvent advances ticks.
  hostRef.paid = paid;
  hostRef.setPaid = setPaid;
  return (
    <ExitAnimHost hostRef={hostRef} initialOpen={initialOpen}>
      {(open, setOpen) => (
        <>
          <span data-testid="open-state">{String(open)}</span>
          <span data-testid="paid-state">{String(paid)}</span>
          <QrisQrDisplay
            amount={25000}
            currency="IDR"
            reference="REF-1234"
            isOpen={open}
            onClose={() => setOpen(false)}
            onPaymentConfirmed={() => {
              setPaid(true);
              onPaymentConfirmed?.();
            }}
          />
        </>
      )}
    </ExitAnimHost>
  );
}

describe('QrisQrDisplay exit-animation polish', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render when isOpen=false', () => {
    const hostRef = makeHostRef();
    render(withFluent(<HostModal hostRef={hostRef} initialOpen={false} />, salesFtl));
    expect(document.querySelector('.qris-overlay')).toBeNull();
  });

  it('renders overlay + container with NO exit class when open', () => {
    const hostRef = makeHostRef();
    render(withFluent(<HostModal hostRef={hostRef} />, salesFtl));
    const overlay = document.querySelector('.qris-overlay');
    const container = document.querySelector('.qris-container');
    expect(overlay).toBeTruthy();
    expect(container).toBeTruthy();
    expectNotExiting(overlay, 'qris-overlay');
    expectNotExiting(container, 'qris-container');
  });

  it('× button applies BOTH --exiting classes (layered exit) then fades', () => {
    const hostRef = makeHostRef();
    render(withFluent(<HostModal hostRef={hostRef} />, salesFtl));

    fireEvent.click(document.querySelector('.qris-close') as HTMLElement);

    expectExiting(document.querySelector('.qris-overlay'), 'qris-overlay');
    expectExiting(document.querySelector('.qris-container'), 'qris-container');

    advanceFadeSync(199);
    expect(document.querySelector('.qris-overlay')).toBeTruthy();

    advanceFadeSync(1);
    expect(document.querySelector('.qris-overlay')).toBeNull();
    expect(hostRef.open).toBe(false);
    expect(screen.getByTestId('open-state').textContent).toBe('false');
  });

  it('disables the × button during the fade (no double-click race)', () => {
    const hostRef = makeHostRef();
    render(withFluent(<HostModal hostRef={hostRef} />, salesFtl));
    fireEvent.click(document.querySelector('.qris-close') as HTMLElement);

    const btn = document.querySelector<HTMLButtonElement>('.qris-close');
    expect(btn?.disabled).toBe(true);
  });

  it('× click mid-fade is idempotent (no double-timer)', () => {
    const hostRef = makeHostRef();
    render(withFluent(<HostModal hostRef={hostRef} />, salesFtl));
    fireEvent.click(document.querySelector('.qris-close') as HTMLElement);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.qris-close')!);

    advanceFadeSync(200);
    expect(document.querySelector('.qris-overlay')).toBeNull();
  });

  it('payment-confirmed flow is allowed to snap (parent bypass)', () => {
    // The skill's "navigate to next state" pattern: parent flips
    // isOpen=false directly (no requestClose), so the surface just
    // unmounts. No fade expected.
    const hostRef = makeHostRef();
    render(withFluent(<HostModal hostRef={hostRef} />, salesFtl));
    expect(document.querySelector('.qris-overlay')).toBeTruthy();

    act(() => { hostRef.setOpen(false); });
    expect(document.querySelector('.qris-overlay')).toBeNull();
  });
});

describe('QrisQrDisplay — QR rendering & payment flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders 21×21 QR grid (441 cells)', () => {
    const hostRef = makeHostRef();
    render(withFluent(<HostModal hostRef={hostRef} />, salesFtl));
    const cells = document.querySelectorAll('.qris-qr-cell');
    expect(cells.length).toBe(441);
    // Some cells should be filled (deterministic from reference hash)
    const filled = document.querySelectorAll('.qris-qr-cell--filled');
    expect(filled.length).toBeGreaterThan(0);
    expect(filled.length).toBeLessThan(441);
  });

  it('displays amount and reference correctly', () => {
    const hostRef = makeHostRef();
    render(withFluent(<HostModal hostRef={hostRef} />, salesFtl));
    // 25000 IDR minor = Rp 25.000 → exp-0 exponent renders 25000 IDR,
    // never the old hardcoded /100 '250.00 IDR'.
    expect(screen.getByText('25000 IDR')).toBeInTheDocument();
    expect(screen.getByText('REF-1234')).toBeInTheDocument();
    expect(screen.getByText('OZ-POS Store')).toBeInTheDocument();
    expect(screen.getByText('QRIS')).toBeInTheDocument();
    expect(screen.getByText('Scan with your payment app')).toBeInTheDocument();
  });

  it('shows spinner and waiting status initially', () => {
    const hostRef = makeHostRef();
    render(withFluent(<HostModal hostRef={hostRef} />, salesFtl));
    const status = document.querySelector('.qris-status');
    expect(status).toBeTruthy();
    expect(status).toHaveAttribute('role', 'status');
    expect(screen.getByText('Waiting for payment...')).toBeInTheDocument();
    expect(document.querySelector('.qris-spinner')).toBeInTheDocument();
    expect(document.querySelector('.qris-status--success')).toBeNull();
  });

  it('transitions to confirmed status after polling completes', () => {
    const hostRef = makeHostRef();
    render(withFluent(<HostModal hostRef={hostRef} />, salesFtl));

    // Initial: waiting
    expect(screen.getByText('Waiting for payment...')).toBeInTheDocument();

    // Advance by 4 polls (4 × 2000ms = 8000ms) to trigger confirmation
    act(() => {
      vi.advanceTimersByTime(8000);
    });

    // Status should transition to confirmed
    expect(screen.getByText('Payment confirmed!')).toBeInTheDocument();
    expect(document.querySelector('.qris-status--success')).toBeInTheDocument();
    expect(document.querySelector('.qris-spinner')).toBeNull();
  });

  it('calls onPaymentConfirmed after confirmation + delay', () => {
    const onPaymentConfirmed = vi.fn();
    const hostRef = makeHostRef();
    render(
      withFluent(
        <HostModal
          hostRef={hostRef}
          onPaymentConfirmed={onPaymentConfirmed}
        />,
        salesFtl,
      ),
    );

    // Advance polls to trigger confirmation
    act(() => {
      vi.advanceTimersByTime(8000);
    });

    // After confirmation, there's a 1200ms delay before calling onPaymentConfirmed
    expect(onPaymentConfirmed).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(onPaymentConfirmed).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onPaymentConfirmed).toHaveBeenCalledTimes(1);
  });

  it('resets poll state when isOpen changes', () => {
    const hostRef = makeHostRef();
    render(withFluent(<HostModal hostRef={hostRef} />, salesFtl));

    // Advance partially through polls
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    // Close
    act(() => { hostRef.setOpen(false); });
    act(() => { vi.advanceTimersByTime(200); }); // Exit animation clears DOM
    expect(document.querySelector('.qris-overlay')).toBeNull();

    // Reopen via state setter
    act(() => { hostRef.setOpen(true); });
    act(() => { vi.advanceTimersByTime(50); });

    // Should be back to waiting (poll state reset on isOpen change)
    expect(screen.getByText('Waiting for payment...')).toBeInTheDocument();
    expect(document.querySelector('.qris-spinner')).toBeInTheDocument();

    // Advance by 8000ms again to confirm
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByText('Payment confirmed!')).toBeInTheDocument();
  });
});

// ── QRIS Auto mode (agents-3): real QR, real poll, gateway countdown ─
describe('QrisQrDisplay — QRIS Auto mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderAuto(
    overrides: Partial<{
      pollSettled: () => Promise<boolean>;
      expiresInSeconds: number;
      onExpired: () => void;
      onReissue: () => void;
      onClose: () => void;
      onPaymentConfirmed: () => void;
    }> = {},
  ) {
    // exactOptionalPropertyTypes: pass the auto props only when set —
    // `prop: undefined` is not the same as `prop` absent here.
    const autoProps = {
      qrString: '000201020126604508ID.CO.QRIS.WWW',
      ...(overrides.pollSettled !== undefined && { pollSettled: overrides.pollSettled }),
      ...(overrides.expiresInSeconds !== undefined && { expiresInSeconds: overrides.expiresInSeconds }),
      ...(overrides.onExpired !== undefined && { onExpired: overrides.onExpired }),
      ...(overrides.onReissue !== undefined && { onReissue: overrides.onReissue }),
    };
    return render(
      withFluent(
        <QrisQrDisplay
          amount={15000}
          currency="IDR"
          reference="ORDER-1"
          isOpen
          onClose={overrides.onClose ?? (() => {})}
          onPaymentConfirmed={overrides.onPaymentConfirmed ?? (() => {})}
          {...autoProps}
        />,
        salesFtl,
      ),
    );
  }

  it('renders a real scannable QR instead of the 441-cell placeholder', () => {
    renderAuto({ pollSettled: async () => false, expiresInSeconds: 300 });
    // The pseudo-grid is GONE in auto mode — a scanner cannot read it, and
    // rendering it alongside a real code invites scanning the wrong one.
    expect(document.querySelectorAll('.qris-qr-cell').length).toBe(0);
    expect(document.querySelector('.qris-qr-real svg')).toBeTruthy();
  });

  it('manual mode renders no countdown row', () => {
    const hostRef = makeHostRef();
    render(withFluent(<HostModal hostRef={hostRef} />, salesFtl));
    expect(document.querySelector('.qris-countdown')).toBeNull();
  });

  it('polls on the real schedule and confirms only when settled', async () => {
    let settled = false;
    const pollSettled = vi.fn(async () => settled);
    const onPaymentConfirmed = vi.fn();
    renderAuto({
      pollSettled,
      expiresInSeconds: 300,
      onPaymentConfirmed,
    });

    // First probe at t=2s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(pollSettled).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Payment confirmed!')).toBeNull();

    // Payment lands; next scheduled probe (t=2+3=5s) observes it.
    settled = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText('Payment confirmed!')).toBeInTheDocument();

    // Same 1200ms confirmation beat the manual flow has (receipt tail
    // needs the modal focused before the parent starts finalizing).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1199);
    });
    expect(onPaymentConfirmed).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onPaymentConfirmed).toHaveBeenCalledTimes(1);
  });

  it('counts down and expires; the poll loop stops at expiry', async () => {
    let polls = 0;
    const pollSettled = vi.fn(async () => {
      polls += 1;
      return false;
    });
    const onExpired = vi.fn();
    renderAuto({ pollSettled, expiresInSeconds: 5, onExpired });

    expect(document.querySelector('.qris-countdown')).toBeTruthy();
    expect(polls).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(screen.getByText('The QR code expired')).toBeInTheDocument();

    const pollsAtExpiry = polls;
    // An expired QR never settles; polling more just hammers the endpoint.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(polls).toBe(pollsAtExpiry);
  });

  it('expired view offers re-issue and cancel', async () => {
    const onReissue = vi.fn();
    const onClose = vi.fn();
    renderAuto({
      pollSettled: async () => false,
      expiresInSeconds: 5,
      onReissue,
      onClose,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    fireEvent.click(screen.getByText('Generate a new QR'));
    expect(onReissue).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Cancel payment'));
    // Cancel goes through the exit animation, then the parent's onClose
    // (which voids the pending sale) — same layered close as the × button.
    expect(onClose).not.toHaveBeenCalled();
    advanceFadeSync(200);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
