import { useState, useCallback } from 'react';
import { useLocalization, Localized } from '@fluent/react';
import { getGiftCardBalance, redeemGiftCard } from '@/api/giftCards';
import { Button } from '@/components/Button';
import { l10nErrorMessage } from '@/utils/app-error';
import { formatMoney } from '@/types/domain';


export interface GiftCardPaymentProps {
  /** Session token for authentication. */
  sessionToken: string;
  /** Total amount to pay in minor units. */
  totalMinor: number;
  /** Currency code. */
  currency: string;
  /** The current sale id. */
  saleId: string;
  /** Called with the amount that the gift card should cover (minor units). */
  onApplied: (amountMinor: number, cardNumber: string) => void;
  /** Called to show an error / toast message. */
  onError: (message: string) => void;
  /** Called to close / cancel the gift card flow. */
  onCancel: () => void;
  /** Called when redemption is complete. */
  onComplete: () => void;
}

/** Gift card payment flow — look up gift card number, check balance, and apply gift card amount toward the current sale. */
export default function GiftCardPayment({
  sessionToken,
  totalMinor,
  currency,
  saleId,
  onApplied,
  onError,
  onCancel,
  onComplete,
}: GiftCardPaymentProps) {
  const { l10n } = useLocalization();
  const [cardInput, setCardInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [cardBalance, setCardBalance] = useState<{ minor: number; currency: string; status: string } | null>(null);
  const [error, setError] = useState('');

  const handleLookup = useCallback(async () => {
    const code = cardInput.trim();
    if (!code) {
      setError(l10n.getString('gift-cards-payment-enter-number'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await getGiftCardBalance(sessionToken, code);
      if (!result) {
        setError(l10n.getString('gift-cards-payment-not-found'));
        setCardBalance(null);
        return;
      }
      if (result.status !== 'active') {
        setError(l10n.getString('gift-cards-payment-not-active'));
        setCardBalance(null);
        return;
      }
      setCardBalance({ minor: result.balance_minor, currency: result.currency, status: result.status });
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'gift-cards-payment-lookup-failed'));
    } finally {
      setLoading(false);
    }
    // sessionToken arrives as a prop (:11) and is read at :54, so it is a closure variable like
    // any other -- being a prop rather than a hook value does not make it stable.
  }, [cardInput, l10n, sessionToken]);

  const handleApply = useCallback(async () => {
    const code = cardInput.trim();
    if (!code || !cardBalance) return;

    const amountToRedeem = Math.min(totalMinor, cardBalance.minor);
    if (amountToRedeem <= 0) {
      onError(l10n.getString('gift-cards-payment-insufficient'));
      return;
    }

    setLoading(true);
    try {
      await redeemGiftCard(sessionToken, code, amountToRedeem, saleId);
      onApplied(amountToRedeem, code);
      onComplete();
    } catch (err) {
      onError(l10nErrorMessage(err, l10n, 'gift-cards-payment-redemption-failed'));
    } finally {
      setLoading(false);
    }
  // :85 redeems real money through redeemGiftCard(sessionToken, ...). With the token missing,
  // a cashier hot-swap left this presenting the destroyed session, so the tender failed with a
  // redemption error on a card that was fine -- the worst kind of failure at a checkout counter,
  // because it looks like a problem with the customer's gift card.
  }, [cardInput, cardBalance, totalMinor, saleId, onApplied, onComplete, onError, l10n, sessionToken]);

  return (
    <div className="gift-card-payment">
      <div className="gift-card-payment-header">
        <Localized id="gift-cards-payment-title">
          <h3 className="gift-card-payment-title">Gift Card</h3>
        </Localized>
        <Localized id="gift-cards-payment-total-due" vars={{ amount: formatMoney({ minor_units: totalMinor, currency }) }}>
          <p className="gift-card-payment-subtitle">
            Total due: {formatMoney({ minor_units: totalMinor, currency })}
          </p>
        </Localized>
      </div>

      <div className="gift-card-payment-input-row">
        <input
          type="text"
          className="gift-card-payment-input"
          id="gift-card-payment-input"
          name="gift-card-payment-input"
          placeholder={l10n.getString('gift-cards-payment-input-placeholder')}
          value={cardInput}
          onChange={(e) => { setCardInput(e.target.value); setCardBalance(null); setError(''); }}
          disabled={loading}
          aria-label={l10n.getString('gift-cards-payment-input-aria')}
        />
        <Localized id="gift-cards-payment-check-btn">
          <Button variant="primary" onClick={handleLookup} disabled={loading || !cardInput.trim()}>
            Check
          </Button>
        </Localized>
      </div>

      {error && <div className="gift-card-payment-error">{error}</div>}

      {cardBalance && (
        <div className="gift-card-payment-balance">
          <div className="gift-card-payment-balance-row">
            <Localized id="gift-cards-payment-available-balance">
              <span>Available Balance</span>
            </Localized>
            <span className="gift-card-payment-balance-amount">
              {formatMoney({ minor_units: cardBalance.minor, currency: cardBalance.currency })}
            </span>
          </div>
          <div className="gift-card-payment-balance-row">
            <Localized id="gift-cards-payment-to-apply">
              <span>To Apply</span>
            </Localized>
            <span className="gift-card-payment-balance-amount">
              {formatMoney({ minor_units: Math.min(totalMinor, cardBalance.minor), currency })}
            </span>
          </div>
        </div>
      )}

      <div className="gift-card-payment-actions">
        <Localized id="gift-cards-payment-cancel-btn">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
        </Localized>
        {cardBalance && (
          <Button variant="primary" onClick={handleApply} disabled={loading || cardBalance.minor <= 0}>
            {loading ? l10n.getString('gift-cards-payment-processing') : l10n.getString('gift-cards-payment-apply-btn')}
          </Button>
        )}
      </div>
    </div>
  );
}
