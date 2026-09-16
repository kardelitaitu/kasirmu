/**
 * CardTenderPanel — the card tender block of PaymentModal (slice W4-d).
 *
 * Markup only, in the shape ./CashTenderPanel and ./QrisTenderPanel set: the one
 * button that sends the total to the connected terminal, plus its description
 * line. No state, no effect and no memo moved in, and none created here — the
 * EDC state machine (`edc` phase), `handleTerminalPay` and the overlay that
 * phase renders all stay in the shell, because the overlay sits outside the
 * method sections and the handler is one of the money paths the atoms invariant
 * locks in place.
 *
 * The rail gate is passed IN (`terminalOffered`) rather than read from
 * `useLocalPaymentRails()` again here, exactly as QrisTenderPanel takes
 * `qrisAllowed` instead of calling the hook a second time: the shell keeps a
 * single rail read for the whole modal. False means the site's rail list
 * withholds the card terminal — the manual-card radio still works, only this
 * hardware path disappears — so the panel renders nothing, which is what
 * `edcOffered && (...)` rendered before.
 *
 * `disabled` is the same three-operand expression it always was, now over three
 * booleans: `processing` (a tender is mid-flight), `terminalPending`
 * (`edc !== null` — the pre-flight / card-present / declined overlay owns the
 * modal) and `autoQrPending` (`autoQr !== null`, the same guard QRIS reads,
 * because a QR charge and a terminal capture must not run at once). The panel
 * derives none of them, and it computes no money: the capture amount stays the
 * shell's `effectiveTotalInCartCurrency`, read by `handleTerminalPay`.
 *
 * Strings: `l10n` comes from the Fluent context, so the ids move with the
 * markup — payment-edc-description / -edc-pay are still referenced from the
 * features tree, which is what pre-commit's bundle-parity walk and the FTL
 * orphan gate read. No new key was added. Both Localized render paths are kept:
 * the element form for the description and the button label, and the
 * `aria-label` duplicate of the button label verbatim — the EDC tests select
 * this button by accessible name (`/pay on card terminal/i`). The class names
 * are unchanged and are still styled by ../PaymentModal.css, which the page
 * imports once for the whole modal — the same arrangement both siblings rely on.
 */
import { Localized, useLocalization } from '@fluent/react';

export interface CardTenderPanelProps {
  /** False when the site's rail list withholds the card terminal (agents-5 R1). */
  terminalOffered: boolean;
  /** A tender is mid-flight (the shell's `processing` atom). */
  processing: boolean;
  /** An EDC exchange is on screen; it owns the modal, so this goes dark. */
  terminalPending: boolean;
  /** A QRIS Auto charge is on screen; it owns the modal, so this goes dark too. */
  autoQrPending: boolean;
  /** Start the card-present capture (the shell's `handleTerminalPay`). */
  onTerminalPay: () => void;
}

/** The card method panel: the pay-on-terminal button, gated on the EDC rail. */
export default function CardTenderPanel({
  terminalOffered,
  processing,
  terminalPending,
  autoQrPending,
  onTerminalPay,
}: CardTenderPanelProps) {
  const { l10n } = useLocalization();


  if (!terminalOffered) return null;

  return (
    <div className="payment-edc-section">
      <Localized id="payment-edc-description">
        <p className="payment-edc-description">
          Charge the total on the connected card terminal — tap, insert or swipe.
        </p>
      </Localized>
      <button
        type="button"
        className="payment-edc-btn"
        aria-label={l10n.getString('payment-edc-pay')}
        onClick={onTerminalPay}
        disabled={processing || terminalPending || autoQrPending}
      >
        <Localized id="payment-edc-pay">
          <span>Pay on card terminal</span>
        </Localized>
      </button>
    </div>
  );
}
