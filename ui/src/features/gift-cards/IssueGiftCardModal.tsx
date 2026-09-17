import { useState, useCallback, useEffect, useRef } from 'react';
import { requiredLocalized } from '@/components';
import { animDuration } from '@/utils/animation';
import { Localized, useLocalization } from '@fluent/react';
import { issueGiftCard, type IssueGiftCardInput } from '@/api/giftCards';
import { Button } from '@/components/Button';
import { generateGiftCardNumber } from '@/utils/giftCardBarcode';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { l10nErrorMessage } from '@/utils/app-error';

/** Props for the IssueGiftCardModal component. */
export interface IssueGiftCardModalProps {
  /** Session token for authentication. */
  sessionToken: string;
  /** Callback invoked when the modal is dismissed without issuing. */
  onClose: () => void;
  /** Callback invoked after a gift card has been successfully issued. */
  onIssued: () => void;
}

/** Issue gift card modal dialog — form for creating a new gift card with number, initial amount, PIN, and recipient details. */
export default function IssueGiftCardModal({ sessionToken, onClose, onIssued }: IssueGiftCardModalProps) {
  const { l10n } = useLocalization();
  const ANIM_MS = animDuration(200);
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      setExiting(false);
      exitTimerRef.current = null;
      onClose();
    }, ANIM_MS);
  }, [onClose, ANIM_MS]);

  const [cardNumber, setCardNumber] = useState(generateGiftCardNumber());
  const [amount, setAmount] = useState('');
  const [issuedTo, setIssuedTo] = useState('');
  const [pin, setPin] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  // ── Focus trap (Escape + Tab cycling) ─────────────────────
  useFocusTrap(panelRef, !exiting && !processing, handleClose);

  const handleSubmit = async () => {
    if (!/^\d+$/.test(amount) || parseInt(amount, 10) <= 0) {
      setError(l10n.getString('gift-cards-issue-invalid-amount'));
      return;
    }
    const initialAmountMinor = parseInt(amount, 10);
    if (!cardNumber.trim()) {
      setError(l10n.getString('gift-cards-issue-invalid-number'));
      return;
    }

    setProcessing(true);
    setError('');

    try {
      const input: IssueGiftCardInput = {
        card_number: cardNumber.trim(),
        initial_amount_minor: initialAmountMinor,
        currency: 'IDR',
        issued_to: issuedTo.trim() || null,
        created_by: 'staff',
        pin: pin.trim() || null,
      };
      await issueGiftCard(sessionToken, input);
      onIssued();
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'gift-cards-error-issue'));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div
      className={`gift-cards-modal-overlay${exiting ? ' gift-cards-modal-overlay--exiting' : ''}`}
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className={`gift-cards-modal${exiting ? ' gift-cards-modal--exiting' : ''}`} role="dialog" aria-modal="true" aria-labelledby="gift-cards-modal-title" ref={panelRef}>
        <Localized id="gift-cards-issue-title">
          <h2 id="gift-cards-modal-title" className="gift-cards-modal-title">Issue Gift Card</h2>
        </Localized>

        <div className="gift-cards-modal-form">
          <div className="gift-cards-modal-field">
            <Localized id="gift-cards-issue-number-label">
              <div className="gift-cards-modal-label">Card Number</div>
            </Localized>
            <input
              type="text"
              className="gift-cards-modal-input"
              id="gift-card-number"
              name="gift-card-number"
              value={cardNumber}
              onChange={(e) => { setCardNumber(e.target.value); setError(''); }}
              aria-label={l10n.getString('gift-cards-issue-number-aria')}
            />
          </div>

          <div className="gift-cards-modal-field">
            <Localized id="gift-cards-issue-amount-label">
              <div className="gift-cards-modal-label">Initial Amount (minor units)</div>
            </Localized>
            <input
              type="number"
              className="gift-cards-modal-input"
              id="gift-card-amount"
              name="gift-card-amount"
              placeholder="e.g. 50000"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError(''); }}
              aria-label={l10n.getString('gift-cards-issue-amount-aria')}
            />
          </div>

          <div className="gift-cards-modal-field">
            <Localized id="gift-cards-issue-to-label">
              <div className="gift-cards-modal-label">Issued To (optional)</div>
            </Localized>
            <input
              type="text"
              className="gift-cards-modal-input"
              id="gift-card-issued-to"
              name="gift-card-issued-to"
              placeholder={requiredLocalized(l10n, 'gift-cards-issue-to-placeholder')}
              value={issuedTo}
              onChange={(e) => { setIssuedTo(e.target.value); setError(''); }}
              aria-label={l10n.getString('gift-cards-issue-to-aria')}
            />
          </div>

          <div className="gift-cards-modal-field">
            <Localized id="gift-cards-issue-pin-label">
              <div className="gift-cards-modal-label">PIN (optional)</div>
            </Localized>
            <input
              type="password"
              autoComplete="new-password"
              className="gift-cards-modal-input"
              id="gift-card-pin"
              name="gift-card-pin"
              placeholder={requiredLocalized(l10n, 'gift-cards-issue-pin-placeholder')}
              value={pin}
              onChange={(e) => { setPin(e.target.value); setError(''); }}
              aria-label={l10n.getString('gift-cards-issue-pin-aria')}
            />
          </div>

          {error && <div className="gift-cards-modal-error" role="alert">{error}</div>}

          <div className="gift-cards-modal-actions">
            <Button variant="ghost" onClick={handleClose} disabled={processing}>
              <Localized id="cancel">Cancel</Localized>
            </Button>
            <Button variant="primary" loading={processing} onClick={handleSubmit}>
              <Localized id="gift-cards-issue-confirm">Issue Card</Localized>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
