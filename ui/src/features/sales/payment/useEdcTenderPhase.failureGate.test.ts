// ── A failed card terminal must not leave Complete armed ─────────────────
//
// THE DEFECT (measured live, rounds 36-37)
//
// Pressing "Pay on card terminal" and having it FAIL only raised a toast and
// returned to the tender screen with `method` still 'card'. Complete stayed
// enabled (the settle predicate treats every non-cash method as automatically
// sufficient — useTenderMath.ts:158), so pressing it settled the sale and printed
// a receipt recording `CARD Rp 45.000` — a card sale with no money taken:
//
//   "Card payment failed" toast
//   method still 'card'
//   [data-testid="settle-button"] aria-disabled === null   <- still armed
//   -> receipt: "CARD Rp 45.000"
//
// THE FIX IS NARROW ON PURPOSE. Disabling Complete for `card` outright would
// break the MANUAL card tender — a payment taken on another machine — which is an
// intended path ("a list without the edc rail hides the terminal button but keeps
// manual card"). So the gate keys on the EVIDENCE of a failed attempt: once the
// terminal has refused or failed in this session, Complete is withheld until the
// cashier retries it or leaves the method.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEdcTenderPhase } from './useEdcTenderPhase';
import * as edcApi from '@/api/edc';
import type { requiredLocalized } from '@/components';

vi.mock('@/api/edc', () => ({
  listEdcTerminalsScoped: vi.fn(),
  edcTerminalStatusScoped: vi.fn(),
  edcSale: vi.fn(),
}));

const terminals = [
  { id: 't1', name: 'Lane 1', connectionType: 'wired', transport: 'serial', address: 'COM1', vendor: null, model: null, isActive: true, createdAt: 'x', updatedAt: 'x' },
];

function makeProps() {
  const l10n = { getString: (k: string, a?: unknown) => `${k}:${JSON.stringify(a ?? {})}` };
  return {
    sessionToken: 'tok',
    effectiveTotalInCartCurrency: 50000,
    cartCurrency: 'IDR',
    buildGatewaySale: vi.fn(),
    settleGatewaySale: vi.fn(),
    l10nRef: { current: l10n as unknown as Parameters<typeof requiredLocalized>[0] },
    addToast: vi.fn(),
    setProcessing: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(edcApi.listEdcTerminalsScoped).mockResolvedValue(terminals as never);
  vi.mocked(edcApi.edcTerminalStatusScoped).mockResolvedValue({ status: 'ready' });
  vi.mocked(edcApi.edcSale).mockResolvedValue({
    success: true, transactionId: 'tx', authCode: 'A', cardScheme: 'Visa', cardLast4: '1111', message: 'APPROVED',
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useEdcTenderPhase — terminal failure gate', () => {
  it('starts unset, so an ordinary card sale is not blocked', async () => {
    const { result } = renderHook(() => useEdcTenderPhase(makeProps()));
    await waitFor(() => expect(result.current.terminals).toHaveLength(1));
    expect(result.current.terminalFailed).toBe(false);
  });

  it('records a failure when the terminal pre-flight rejects', async () => {
    vi.mocked(edcApi.edcTerminalStatusScoped).mockRejectedValue(new Error("EDC card terminal 'x' not found"));
    const { result } = renderHook(() => useEdcTenderPhase(makeProps()));
    await waitFor(() => expect(result.current.terminals).toHaveLength(1));

    await act(async () => {
      await result.current.handleTerminalPay();
    });

    expect(
      result.current.terminalFailed,
      'a failed attempt must be recorded — otherwise Complete stays armed and ' +
        'the sale settles as CARD with nothing charged',
    ).toBe(true);
  });

  it('records a failure when the terminal is not ready', async () => {
    vi.mocked(edcApi.edcTerminalStatusScoped).mockResolvedValue({ status: 'offline' });
    const { result } = renderHook(() => useEdcTenderPhase(makeProps()));
    await waitFor(() => expect(result.current.terminals).toHaveLength(1));

    await act(async () => {
      await result.current.handleTerminalPay();
    });

    expect(result.current.terminalFailed).toBe(true);
  });

  it('records a failure when the card is declined', async () => {
    vi.mocked(edcApi.edcSale).mockResolvedValue({
      success: false, transactionId: null, authCode: null, cardScheme: null, cardLast4: null, message: 'DECLINED',
    });
    const { result } = renderHook(() => useEdcTenderPhase(makeProps()));
    await waitFor(() => expect(result.current.terminals).toHaveLength(1));

    await act(async () => {
      await result.current.handleTerminalPay();
    });

    expect(result.current.terminalFailed).toBe(true);
  });

  it('clears the failure when a retry succeeds', async () => {
    vi.mocked(edcApi.edcTerminalStatusScoped).mockRejectedValueOnce(new Error('boom'));
    const props = makeProps();
    const { result } = renderHook(() => useEdcTenderPhase(props));
    await waitFor(() => expect(result.current.terminals).toHaveLength(1));

    await act(async () => {
      await result.current.handleTerminalPay();
    });
    expect(result.current.terminalFailed).toBe(true);

    // The cashier retries and the terminal approves.
    await act(async () => {
      await result.current.handleTerminalPay();
    });
    expect(
      result.current.terminalFailed,
      'a successful retry must clear the gate',
    ).toBe(false);
  });

  it('can be cleared explicitly, for switching away from the card tender', async () => {
    vi.mocked(edcApi.edcTerminalStatusScoped).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useEdcTenderPhase(makeProps()));
    await waitFor(() => expect(result.current.terminals).toHaveLength(1));

    await act(async () => {
      await result.current.handleTerminalPay();
    });
    expect(result.current.terminalFailed).toBe(true);

    act(() => {
      result.current.clearTerminalFailed();
    });
    expect(result.current.terminalFailed).toBe(false);
  });
});
