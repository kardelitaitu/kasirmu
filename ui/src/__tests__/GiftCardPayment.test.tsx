import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import giftCardsFtl from '@/locales/gift-cards.ftl?raw';

// Mock the API module.
vi.mock('@/api/giftCards', () => ({
  getGiftCardBalance: vi.fn(),
  redeemGiftCard: vi.fn(),
}));

import GiftCardPayment from '@/features/gift-cards/GiftCardPayment';
import { getGiftCardBalance, redeemGiftCard } from '@/api/giftCards';



const defaultProps = {
  sessionToken: 'tok-1',
  totalMinor: 100000,
  currency: 'IDR',
  saleId: 'sale-1',
  onApplied: vi.fn(),
  onError: vi.fn(),
  onCancel: vi.fn(),
  onComplete: vi.fn(),
};

describe('GiftCardPayment', () => {
  it('renders the payment form', () => {
    renderWithFluentSync(<GiftCardPayment {...defaultProps} />, giftCardsFtl);
    expect(screen.getByText('Gift Card')).toBeInTheDocument();
    expect(screen.getByLabelText('Gift card number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('shows total due amount', () => {
    renderWithFluentSync(<GiftCardPayment {...defaultProps} />, giftCardsFtl);
    // 100000 IDR minor = Rp 100.000 — formatMoney (exp 0) renders no decimal tail.
    expect(screen.getByText(/Rp 100\.000/)).toBeInTheDocument();
  });

  it('does not call API when card number is empty', async () => {
    const mockBalance = getGiftCardBalance as ReturnType<typeof vi.fn>;
    renderWithFluentSync(<GiftCardPayment {...defaultProps} />, giftCardsFtl);
    await userEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(mockBalance).not.toHaveBeenCalled();
  });

  it('looks up a gift card balance on check', async () => {
    const mockBalance = getGiftCardBalance as ReturnType<typeof vi.fn>;
    mockBalance.mockResolvedValueOnce({
      balance_minor: 50000,
      currency: 'IDR',
      status: 'active',
    });

    renderWithFluentSync(<GiftCardPayment {...defaultProps} />, giftCardsFtl);
    const input = screen.getByLabelText('Gift card number');
    await userEvent.type(input, 'GC-TEST');

    await userEvent.click(screen.getByRole('button', { name: /check/i }));

    await vi.waitFor(() => {
      expect(mockBalance).toHaveBeenCalledWith('tok-1', 'GC-TEST');
      expect(screen.getByText('Available Balance')).toBeInTheDocument();
      expect(screen.getByText('To Apply')).toBeInTheDocument();
    });
  });

  it('shows error when gift card is not found', async () => {
    const mockBalance = getGiftCardBalance as ReturnType<typeof vi.fn>;
    mockBalance.mockResolvedValueOnce(null);

    renderWithFluentSync(<GiftCardPayment {...defaultProps} />, giftCardsFtl);
    const input = screen.getByLabelText('Gift card number');
    await userEvent.type(input, 'GC-BAD');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));

    await vi.waitFor(() => {
      expect(screen.getByText('Gift card not found')).toBeInTheDocument();
    });
  });

  it('shows error when gift card is not active', async () => {
    const mockBalance = getGiftCardBalance as ReturnType<typeof vi.fn>;
    mockBalance.mockResolvedValueOnce({
      balance_minor: 1000,
      currency: 'IDR',
      status: 'frozen',
    });

    renderWithFluentSync(<GiftCardPayment {...defaultProps} />, giftCardsFtl);
    const input = screen.getByLabelText('Gift card number');
    await userEvent.type(input, 'GC-FROZEN');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));

    await vi.waitFor(() => {
      expect(screen.getByText('Gift card is not active')).toBeInTheDocument();
    });
  });

  it('shows balance and enables apply button after successful lookup', async () => {
    const mockBalance = getGiftCardBalance as ReturnType<typeof vi.fn>;
    mockBalance.mockResolvedValueOnce({
      balance_minor: 50000,
      currency: 'IDR',
      status: 'active',
    });

    renderWithFluentSync(<GiftCardPayment {...defaultProps} />, giftCardsFtl);
    await userEvent.type(screen.getByLabelText('Gift card number'), 'GC-TEST');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /apply gift card/i })).toBeInTheDocument();
    });
  });

  it('applies gift card and calls onApplied and onComplete', async () => {
    const mockBalance = getGiftCardBalance as ReturnType<typeof vi.fn>;
    mockBalance.mockResolvedValueOnce({
      balance_minor: 50000,
      currency: 'IDR',
      status: 'active',
    });

    const mockRedeem = redeemGiftCard as ReturnType<typeof vi.fn>;
    mockRedeem.mockResolvedValueOnce({
      card: { id: 'gc-1', status: 'active' },
      transaction: { id: 'txn-1', txn_type: 'redeem' },
    });

    const onApplied = vi.fn();
    const onComplete = vi.fn();

    renderWithFluentSync(
      <GiftCardPayment
        {...defaultProps}
        totalMinor={30000}
        onApplied={onApplied}
        onComplete={onComplete}
      />,
      giftCardsFtl,
    );

    await userEvent.type(screen.getByLabelText('Gift card number'), 'GC-TEST');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /apply gift card/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /apply gift card/i }));

    await vi.waitFor(() => {
      expect(mockRedeem).toHaveBeenCalledWith('tok-1', 'GC-TEST', 30000, 'sale-1');
      expect(onApplied).toHaveBeenCalledWith(30000, 'GC-TEST');
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  it('redeems ONCE when Apply gift card is double-tapped', async () => {
    // This is the one place in the app where a gift card's balance moves money. The replay
    // is NOT refused by the backend: redeem_gift_card's idempotency is on (card_id, sale_id)
    // and the second call for the SAME pair is accepted -- so the operator can be told the
    // card was applied twice, through two onApplied calls.
    const mockBalance = getGiftCardBalance as ReturnType<typeof vi.fn>;
    mockBalance.mockResolvedValueOnce({
      balance_minor: 50000,
      currency: 'IDR',
      status: 'active',
    });

    const mockRedeem = redeemGiftCard as ReturnType<typeof vi.fn>;
    let release: (() => void) | undefined;
    mockRedeem.mockReturnValue(new Promise((res) => {
      release = () => res({ card: { id: 'gc-1', status: 'active' }, transaction: { id: 'txn-1', txn_type: 'redeem' } });
    }));
    const onApplied = vi.fn();
    const onComplete = vi.fn();

    renderWithFluentSync(
      <GiftCardPayment {...defaultProps} totalMinor={30000} onApplied={onApplied} onComplete={onComplete} />,
      giftCardsFtl,
    );

    await userEvent.type(screen.getByLabelText('Gift card number'), 'GC-TEST');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));
    const applyBtn = await screen.findByRole('button', { name: /apply gift card/i });
    await act(async () => {
      applyBtn.click();
      applyBtn.click();
    });

    release?.();
    await vi.waitFor(() => expect(mockRedeem).toHaveBeenCalledTimes(1));
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel is clicked', async () => {
    const onCancel = vi.fn();
    renderWithFluentSync(<GiftCardPayment {...defaultProps} onCancel={onCancel} />, giftCardsFtl);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables the Check button when input is empty', () => {
    renderWithFluentSync(<GiftCardPayment {...defaultProps} />, giftCardsFtl);
    expect(screen.getByRole('button', { name: /check/i })).toBeDisabled();
  });

  it('calls onError when redemption fails', async () => {
    const mockBalance = getGiftCardBalance as ReturnType<typeof vi.fn>;
    mockBalance.mockResolvedValueOnce({
      balance_minor: 50000,
      currency: 'IDR',
      status: 'active',
    });

    const mockRedeem = redeemGiftCard as ReturnType<typeof vi.fn>;
    mockRedeem.mockRejectedValueOnce(new Error('Redemption failed'));

    const onError = vi.fn();
    renderWithFluentSync(<GiftCardPayment {...defaultProps} onError={onError} />, giftCardsFtl);

    await userEvent.type(screen.getByLabelText('Gift card number'), 'GC-TEST');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /apply gift card/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /apply gift card/i }));

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Redemption failed');
    });
  });
  it('REFUSES a card denominated in another currency (no cross-currency tender)', async () => {
    // The amount applied is min(totalMinor, balance_minor) in MINOR UNITS. A KWD card
    // (3 decimal places) tendered against an IDR sale (0 decimals) is debited 1:1 by
    // those numbers, so 10000 fils would settle an Rp 100.000 sale -- ~1000x overpaid,
    // and the sale records a gift tender the store never received. redeem_gift_card
    // takes no currency argument, so this is the only place the mismatch can be caught.
    const mockBalance = getGiftCardBalance as ReturnType<typeof vi.fn>;
    mockBalance.mockResolvedValueOnce({
      balance_minor: 10000,
      currency: 'KWD',
      status: 'active',
    });

    renderWithFluentSync(<GiftCardPayment {...defaultProps} />, giftCardsFtl);
    await userEvent.type(screen.getByLabelText('Gift card number'), 'GC-KWD-1');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));

    // The mismatch is stated in both currencies, so the cashier can tell the customer why.
    expect(
      await screen.findByText(/This card is in KWD and cannot be applied to a IDR sale/i),
    ).toBeInTheDocument();
    // And the balance is NOT accepted, so no amount can be applied.
    expect(screen.queryByText(/Available balance/i)).not.toBeInTheDocument();
    expect(redeemGiftCard).not.toHaveBeenCalled();
  });
});
