import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { edcTerminalStatus, edcTerminalStatusScoped, edcSale, edcRefund, edcVoid } from '@/api/edc';

// Contract pins for the EDC card-present surface. The Rust commands
// (apps/desktop-client/src/commands/edc.rs) REQUIRE a session_token and
// enforce SALES_PROCESS / SALES_REFUND / SALES_VOID on the money
// commands — these tests pin that the wrappers actually send it, so a
// card tender cannot deserialization-fail at the IPC boundary (the
// pre-fix wrappers sent no token at all, and no test noticed).
describe('edc.ts API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('edcTerminalStatus calls the status command with no args', async () => {
    mockInvoke.mockResolvedValue({ status: 'ready' });
    await edcTerminalStatus();
    expect(mockInvoke).toHaveBeenCalledWith('edc_terminal_status');
  });

  it('edcTerminalStatusScoped sends the session token (checkout pre-flight)', async () => {
    mockInvoke.mockResolvedValue({ status: 'ready' });
    await edcTerminalStatusScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('edc_terminal_status_scoped', {
      sessionToken: 'tok',
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
