import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { edcTerminalStatus, edcTerminalStatusScoped, edcSale, edcRefund, edcVoid } from '@/api/edc';

// Contract pins for the EDC card-present surface. The Rust commands
// (apps/desktop-tauri/src/commands/edc.rs) REQUIRE a session_token and
// enforce SALES_PROCESS / SALES_REFUND / SALES_VOID on the money
// commands — these tests pin that the wrappers actually send it, so a
// card tender cannot deserialization-fail at the IPC boundary (the
// pre-fix wrappers sent no token at all, and no test noticed).
describe('edc.ts API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Updated 2026-09-29 (was: "calls the status command with no args"). The
  // wrapper gained an optional `terminalId` in 8d3222d37 ("edc: implement
  // multi-terminal binding routing and UI selection"), and that commit left this
  // pin asserting the pre-multi-terminal shape — `toHaveBeenCalledWith('edc_terminal_status')`
  // with ONE argument, while the wrapper now always passes an args object. The
  // wrapper is right and the pin was stale: edc.ts's own header states the
  // contract ("Omitted or null terminalId falls back to the default configured
  // terminal"), and the Rust command takes `terminal_id: Option<String>`
  // (commands/edc.rs:32), so an explicit undefined and an omitted property are
  // the same request. Both arms are pinned below so neither reading can drift.
  it('edcTerminalStatus defaults to the configured terminal when given no id', async () => {
    mockInvoke.mockResolvedValue({ status: 'ready' });
    await edcTerminalStatus();
    expect(mockInvoke).toHaveBeenCalledWith('edc_terminal_status', {
      terminalId: undefined,
    });
  });

  it('edcTerminalStatus forwards an explicit terminal id', async () => {
    mockInvoke.mockResolvedValue({ status: 'ready' });
    await edcTerminalStatus('term-2');
    expect(mockInvoke).toHaveBeenCalledWith('edc_terminal_status', {
      terminalId: 'term-2',
    });
  });

  it('edcTerminalStatusScoped sends the session token (checkout pre-flight)', async () => {
    mockInvoke.mockResolvedValue({ status: 'ready' });
    await edcTerminalStatusScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('edc_terminal_status_scoped', {
      sessionToken: 'tok',
    });
  });

  it('edcTerminalStatusScoped forwards the session token and an explicit id', async () => {
    mockInvoke.mockResolvedValue({ status: 'ready' });
    await edcTerminalStatusScoped('tok', 'term-2');
    expect(mockInvoke).toHaveBeenCalledWith('edc_terminal_status_scoped', {
      sessionToken: 'tok',
      terminalId: 'term-2',
    });
  });

  it('edcSale sends the session token with the amount and currency', async () => {
    mockInvoke.mockResolvedValue({ success: true, message: 'ok' });
    await edcSale('tok', 1500, 'USD');
    expect(mockInvoke).toHaveBeenCalledWith('edc_sale', {
      sessionToken: 'tok',
      amountMinor: 1500,
      currency: 'USD',
    });
  });

  it('edcRefund sends the session token, transaction id, amount and currency', async () => {
    mockInvoke.mockResolvedValue({ success: true, message: 'ok' });
    await edcRefund('tok', 'txn-1', 500, 'IDR');
    expect(mockInvoke).toHaveBeenCalledWith('edc_refund', {
      sessionToken: 'tok',
      transactionId: 'txn-1',
      amountMinor: 500,
      currency: 'IDR',
    });
  });

  it('edcVoid sends the session token with the transaction id', async () => {
    mockInvoke.mockResolvedValue({ success: true, message: 'ok' });
    await edcVoid('tok', 'txn-1');
    expect(mockInvoke).toHaveBeenCalledWith('edc_void', {
      sessionToken: 'tok',
      transactionId: 'txn-1',
    });
  });
});
