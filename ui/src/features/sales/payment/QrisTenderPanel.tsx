/**
 * QrisTenderPanel — the QRIS tender block of PaymentModal (slice W4-a).
 *
 * Markup only. Everything that MAKES the QRIS tender work already left the
 * shell: `./useGatewayQr` owns the manual (cashier-asserted) dialog state and
 * both its ends, `./useAutoQr` owns the dynamic Midtrans charge, and the shared
 * gateway front/tail halves those two call stay in PaymentModal because three
 * tenders share them. What lived here was the two buttons plus the Free->Plus
 * notice, and nothing else — no state, no effect, no memo.
 *
 * The gate is passed IN rather than read from `useSubscription()` here so the
 * shell keeps a single caps read for the whole modal; `qrisAllowed` is the
 * shell's own `caps && !caps.supportsQris` expression, unchanged, so "caps not
 * loaded yet" still falls through to the generation UI exactly as before.
 *
 * Strings: `l10n` comes from the Fluent context, so the ids move with the
 * markup — payment-qris-description / -pay / -dynamic-pay / -upgrade-required /
 * -upgrade-cta are still referenced from the features tree, which is what
 * pre-commit's bundle-parity walk and the FTL orphan gate read. The `aria-label`
 * duplicates of the two button labels are kept verbatim: the QRIS tests select
 * these buttons by accessible name.
 */
import { Localized, useLocalization } from '@fluent/react';
import { openUpgradePricing } from '@/utils/upgrade';
import { Button } from '@/components/Button';

export interface QrisTenderPanelProps {
  /** False only when the tier explicitly withholds QRIS (C2.2). */
  qrisAllowed: boolean;
  /** Resolved locale, for the upgrade-pricing hand-off. */
  locale: string;
  /** A tender is mid-flight (the shell's `processing` atom). */
  processing: boolean;
  /** A QRIS Auto charge is on screen; it owns the modal, so these go dark. */
  autoQrPending: boolean;
  /** Open the manual QRIS dialog (`useGatewayQr.handleQrPay`). */
  onQrPay: () => void;
  /** Mint a dynamic QRIS charge (`useAutoQr.handleDynamicQrPay`). */
  onDynamicQrPay: () => void;
}

/** The QRIS method panel: the Plus+ upgrade gate, or its two tender buttons. */
export default function QrisTenderPanel({
  qrisAllowed,
  locale,
  processing,
  autoQrPending,
  onQrPay,
  onDynamicQrPay,
}: QrisTenderPanelProps) {
  const { l10n } = useLocalization();

  if (!qrisAllowed) {
    // C2.2: QRIS setup gate (Free→Plus trigger) — show the
    // upgrade prompt instead of the QR generation UI.
    return (
      <div className="payment-qris-upgrade" role="note">
        <p>{l10n.getString('payment-qris-upgrade-required')}</p>
        <Button
          variant="primary"
          size="sm"
          onClick={() => openUpgradePricing(locale, 'plus')}
        >
          {l10n.getString('payment-qris-upgrade-cta')}
        </Button>
      </div>
    );
  }

  return (
    <div className="payment-qris-section">
      <Localized id="payment-qris-description">
        <p className="payment-qris-description">
          Generate a QRIS QR code for the customer to scan with their payment app.
        </p>
      </Localized>
      <button
        type="button"
        className="payment-qris-btn"
        aria-label={l10n.getString('payment-qris-pay')}
        onClick={onQrPay}
        disabled={processing || autoQrPending}
      >
        <Localized id="payment-qris-pay">
          <span>Pay with QR</span>
        </Localized>
      </button>
      <button
        type="button"
        className="payment-qris-btn payment-qris-btn--dynamic"
        aria-label={l10n.getString('payment-qris-dynamic-pay')}
        onClick={onDynamicQrPay}
        disabled={processing || autoQrPending}
      >
        <Localized id="payment-qris-dynamic-pay">
          <span>Pay with dynamic QR</span>
        </Localized>
      </button>
    </div>
  );
}
