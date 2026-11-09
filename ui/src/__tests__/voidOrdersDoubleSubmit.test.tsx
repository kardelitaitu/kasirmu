/**
 * @vitest-environment jsdom
 *
 * Confirm Void is single-submit.
 *
 * ⚠️ THIS DOES NOT REPRODUCE A BUG, and says so rather than implying otherwise. The
 * hypothesis was that the button is disabled by form validity only and not by `voiding`,
 * so a second click could void twice. MEASURED: it is NOT the case — the button is
 * `<Button loading={voiding}>`, and the shared `Button.tsx:70-72` computes
 * `isDisabled = disabled || isProcessing || isSuccess`, so `loading` disables it.
 *
 * The cases are kept because that guarantee is real and nothing else pinned it: no
 * existing VoidOrdersScreen test asserts the in-flight state, so a future switch from
 * `loading` to a plain `disabled` that forgot `voiding` would silently reopen the gap.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluent } from '@/__tests__/test-utils/render';
import salesFtl from '@/locales/sales.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@/api/sales', () => ({
  listSales: vi.fn(),
  getSale: vi.fn(),
  listSalesScoped: vi.fn(),
  getSaleScoped: vi.fn(),
  voidSaleScoped: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', display_name: 'Cashier', role_name: 'cashier' },
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'session-1' }),
}));

import VoidOrdersScreen from '@/features/sales/VoidOrdersScreen';
import { listSalesScoped, getSaleScoped, voidSaleScoped } from '@/api/sales';

const mockListScoped = listSalesScoped as ReturnType<typeof vi.fn>;
const mockGetScoped = getSaleScoped as ReturnType<typeof vi.fn>;
const mockVoidSale = voidSaleScoped as ReturnType<typeof vi.fn>;

const sales = [
  {
    id: 'ORD-001', createdAt: '2026-07-05T10:00:00Z', status: 'active',
    total: { minor_units: 35000, currency: 'IDR' }, lineCount: 3,
    paymentMethod: 'CASH', userId: 'user-1',
  },
];

const detail = {
  id: 'ORD-001', createdAt: '2026-07-05T10:00:00Z', status: 'active',
  total: { minor_units: 35000, currency: 'IDR' },
  subtotal: { minor_units: 35000, currency: 'IDR' },
  taxTotal: { minor_units: 0, currency: 'IDR' },
  lineCount: 3, paymentMethod: 'CASH', tenderedMinor: 50000,
  userId: 'user-1', lines: [],
};

describe('VoidOrdersScreen — Confirm Void is single-submit', () => {
  beforeEach(() => {
    mockListScoped.mockReset().mockResolvedValue({ sales, salesHistoryCapped: false });
    mockGetScoped.mockReset().mockResolvedValue(detail);
    mockVoidSale.mockReset();
  });

  /** Open the order detail and select a void reason, leaving Confirm Void enabled. */
  async function openVoidForm(user: ReturnType<typeof userEvent.setup>) {
    await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());
    await user.click(screen.getAllByRole('button', { name: /^view/i })[0]!);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByDisplayValue(/Select a reason/i), 'cancelled-by-customer');
  }

  it('sends ONE void when Confirm Void is clicked again while the request is in flight', async () => {
    let resolveVoid: (v: unknown) => void = () => {};
    mockVoidSale.mockImplementation(() => new Promise((res) => { resolveVoid = res; }));
    const user = userEvent.setup();
    await openVoidForm(user);

    const confirm = screen.getByRole('button', { name: /confirm void/i });
    await user.click(confirm);
    await waitFor(() => expect(mockVoidSale).toHaveBeenCalledTimes(1));

    // The label swaps to "Voiding…" in flight, so re-address the SAME element.
    expect(
      confirm,
      'Confirm Void must be disabled while the void is in flight',
    ).toBeDisabled();
    await user.click(confirm);

    expect(mockVoidSale.mock.calls.length).toBe(1);
    resolveVoid({});
  });

  it('still voids once on a normal single click (control)', async () => {
    mockVoidSale.mockResolvedValue({});
    const user = userEvent.setup();
    await openVoidForm(user);

    await user.click(screen.getByRole('button', { name: /confirm void/i }));
    await waitFor(() => expect(mockVoidSale).toHaveBeenCalledTimes(1));
    expect(mockVoidSale).toHaveBeenCalledWith('session-1', 'ORD-001', 'cancelled-by-customer');
  });
});
