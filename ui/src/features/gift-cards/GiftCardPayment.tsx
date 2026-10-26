// ── UNREACHABLE, AND BLOCKED ON THE BACKEND ──────────────────────
// Nothing imports this file. `census-orphan-modules.py` reports it on every run, and it is the
// ONLY complete gift-card tender panel in the tree -- so it is not superseded, it is waiting.
//
// Mounting it is blocked by three things that are not UI glue, each verified at source in
// todo-gift-card-redemption-ordering.md: `payments.method` is a closed CHECK with no gift
// member, the Staff/checkout RBAC preset carries no `giftcards:redeem`, and this component
// needs a `saleId` that `PaymentModal` does not have before `completeSaleScoped`. Two of the
// three are an owner decision.
// ─────────────────────────────────────────────────────────────────

import { useCallback, useRef, useState } from 'react';
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
  /** Synchronous mirror of `loading` — see the re-entry guard in `handleApply`. */
  const loadingRef = useRef(false);
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
      // CURRENCY GUARD. A gift card carries its OWN currency, and the amount applied is
      // min(totalMinor, balance_minor) in MINOR UNITS -- a denomination, not a value. Without
      // this check a 10 KWD card (10000 fils) tendered against an Rp 5.000 sale is debited
      // 5000 fils and settles the sale, overpaying by roughly 1000x and recording a tender the
      // store never received. redeem_gift_card (crates/kasirmu-core/src/db/gift_cards.rs:333)
      // takes no currency argument at all, so nothing downstream can catch it either.
      // Refusing at LOOKUP, not at apply, so the cashier sees why before any money moves.
      if (result.currency !== currency) {
        setError(
          l10n.getString('gift-cards-payment-currency-mismatch', {
            cardCurrency: result.currency,
            saleCurrency: currency,
          }),
        );
        setCardBalance(null);
        return;
      }
      setCardBalance({ minor: result.balance_minor, currency: result.currency, status: result.status });
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'gift-cards-payment-lookup-failed'));
    } finally {
      setLoading(false);
    }
    // sessionToken arrives as a prop (:22) and is read at :65, so it is a closure variable like
    // any other -- being a prop rather than a hook value does not make it stable.
  }, [cardInput, currency, l10n, sessionToken]);

  const handleApply = useCallback(async () => {
    const code = cardInput.trim();
    if (!code || !cardBalance) return;

    const amountToRedeem = Math.min(totalMinor, cardBalance.minor);
    if (amountToRedeem <= 0) {
      onError(l10n.getString('gift-cards-payment-insufficient'));
      return;
    }

    // Re-entry guard. THIS IS THE ONE PLACE IN THE APP WHERE A GIFT CARD'S BALANCE MOVES
    // MONEY, and the replay is NOT refused: redeem_gift_card is idempotent only on
    // (card_id, sale_id) -- fail-closed -- so the SECOND call for the same card and sale is
    // accepted as a no-op by the schema's own accounting, while this component has already
    // told the operator it applied `amountToRedeem` twice through onApplied. The state flag
    // is committed on the next render, after the second tap.
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      await redeemGiftCard(sessionToken, code, amountToRedeem, currency, saleId);
      onApplied(amountToRedeem, code);
      onComplete();
    } catch (err) {
      onError(l10nErrorMessage(err, l10n, 'gift-cards-payment-redemption-failed'));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  // :85 redeems real money through redeemGiftCard(sessionToken, ...). With the token missing,
  // a cashier hot-swap left this presenting the destroyed session, so the tender failed with a
  // redemption error on a card that was fine -- the worst kind of failure at a checkout counter,
  // because it looks like a problem with the customer's gift card.
  }, [cardInput, cardBalance, totalMinor, currency, saleId, onApplied, onComplete, onError, l10n, sessionToken]);

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
