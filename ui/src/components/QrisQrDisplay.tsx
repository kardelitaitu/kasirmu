import { useState, useEffect, useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/frontend/shared';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { minorUnitExponent } from '@/types/domain';
import './QrisQrDisplay.css';

interface QrisQrDisplayProps {
  amount: number;
  currency: string;
  reference: string;
  isOpen: boolean;
  onClose: () => void;
  onPaymentConfirmed: () => void;
  // ── QRIS Auto (dynamic Midtrans charge) mode ──────────────────────
  // Every prop below is optional; with none set the component is the
  // historical manual demo display byte-for-byte (its characterization
  // suite pins that). Auto mode replaces the pseudo-QR + fake-timer
  // confirmation with the REAL payload, a REAL settlement poll, and the
  // gateway expiry countdown.
  /** The EMVCo QRIS payload string from the cloud charge. When present,
   *  a real scannable QR is rendered instead of the placeholder grid. */
  qrString?: string;
  /** Auto mode: one settlement probe. Resolves true when the cloud ledger
   *  shows settled. Transient rejections are swallowed (the countdown
   *  bounds the loop) — the webhook may simply not have landed yet. */
  pollSettled?: () => Promise<boolean>;
  /** Auto mode: seconds from open until the gateway expires the QR
   *  (from the charge response's `expiresInSecs` — 300, NOT 15 minutes). */
  expiresInSeconds?: number;
  /** Auto mode: the countdown reached zero while still unpaid. */
  onExpired?: () => void;
  /** Auto mode: cashier chose to mint a fresh charge for the same sale. */
  onReissue?: () => void;
}

function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return hash >>> 0;
}

/** Poll-backoff progression, seconds: 2, 3, 5, 8, then capped at 10. */
const AUTO_POLL_SCHEDULE = [2, 3, 5, 8];
const AUTO_POLL_CAP_SECS = 10;

/**
 * Full-screen QRIS QR code payment modal.
 * Manual mode: deterministic pseudo-QR + demo polling, confirmed by the
 * cashier's out-of-band check. Auto mode (props above): real QR payload,
 * real settlement poll with backoff, and the gateway expiry countdown.
 */
export default function QrisQrDisplay({
  amount,
  currency,
  reference,
  isOpen,
  onClose,
  onPaymentConfirmed,
  qrString,
  pollSettled,
  expiresInSeconds,
  onExpired,
  onReissue,
}: QrisQrDisplayProps) {
  const { l10n } = useLocalization();
  const [status, setStatus] = useState<'waiting' | 'confirmed' | 'expired'>('waiting');
  const [remainingSecs, setRemainingSecs] = useState<number | null>(null);
  const autoMode = pollSettled !== undefined;
  // onExpired identity churns with parent renders; keep the latest in a
  // ref so the countdown effect fires it exactly once at zero.
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  // ── Manual mode: the cashier asserts, nothing confirms on a timer ──
  // The pre-3.2 demo flipped this dialog to "Payment confirmed!" after
  // 8 s of fake polling and the modal built a REAL completed sale behind
  // it — money that never arrived. The assert is now explicit: manual
  // QRIS has no settlement feed (that is the whole difference from Auto),
  // so the only honest surface is the cashier saying they saw it, and
  // `handleQrConfirmed` records that assertion under their session.
  // Closing while open (or before asserting) resets to waiting, so a
  // re-opened dialog can never inherit a stale confirmed state.
  useEffect(() => {
    if (!isOpen) setStatus('waiting');
  }, [isOpen]);

  // ── Real settlement polling (auto mode) ──────────────────────────
  // Changing `reference` (a re-issued order id) restarts the loop fresh.
  useEffect(() => {
    if (!isOpen || !autoMode || status !== 'waiting') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let stepIdx = 0;
    const tick = async () => {
      let settled = false;
      try {
        settled = await pollSettled!();
      } catch {
        // Transient (network, token refresh, webhook lag) — keep polling;
        // the countdown is the honest stop condition, not error counts.
      }
      if (cancelled) return;
      if (settled) {
        setStatus('confirmed');
        return;
      }
      const secs = AUTO_POLL_SCHEDULE[stepIdx] ?? AUTO_POLL_CAP_SECS;
      stepIdx += 1;
      timer = setTimeout(tick, secs * 1000);
    };
    timer = setTimeout(tick, (AUTO_POLL_SCHEDULE[0] ?? AUTO_POLL_CAP_SECS) * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, autoMode, reference, status]);

  // ── Expiry countdown (auto mode) ─────────────────────────────────
  useEffect(() => {
    if (!isOpen || !pollSettled || !expiresInSeconds) {
      setRemainingSecs(null);
      return;
    }
    const deadline = Date.now() + expiresInSeconds * 1000;
    setRemainingSecs(expiresInSeconds);
    const interval = setInterval(() => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemainingSecs(left);
      if (left <= 0) {
        clearInterval(interval);
        setStatus((s) => (s === 'waiting' ? 'expired' : s));
        onExpiredRef.current?.();
      }
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, reference, expiresInSeconds]);

  useEffect(() => {
    if (status !== 'confirmed') return;
    const timer = setTimeout(() => {
      onPaymentConfirmed();
    }, 1200);
    return () => clearTimeout(timer);
  }, [status, onPaymentConfirmed]);

  const qrCells = useMemo(() => {
    const seed = simpleHash(reference || `${Date.now()}`);
    const cells: boolean[][] = [];
    let rng = seed;
    for (let i = 0; i < 21; i++) {
      const row: boolean[] = [];
      for (let j = 0; j < 21; j++) {
        rng = (rng * 1103515245 + 12345) & 0x7fffffff;
        row.push((rng & 0x1) === 1);
      }
      cells.push(row);
    }
    return cells;
  }, [reference]);

  // Layered exit to mirror the entry (added in this PR). Mirrors
  // the PosScreen cousin-modals pattern (commit 1408992): the
  // overlay and container each get their own `--exiting` class so
  // two mirrored keyframes play in parallel.
  const exit = useExitAnimation(isOpen, onClose);

  // A11Y-02: complete dialog semantics — initial focus, Tab containment,
  // Escape, scroll lock, and focus restoration all via the shared trap.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(overlayRef, exit.shouldRender && !exit.exiting, () => exit.requestClose());

  if (!exit.shouldRender) return null;

  return (
    <div
      ref={overlayRef}
      className={`qris-overlay${exit.exiting ? ' qris-overlay--exiting' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={requiredLocalized(l10n, 'payment-qris-dialog-aria')}
    >
      <div
        className={`qris-container${exit.exiting ? ' qris-container--exiting' : ''}`}
      >
        <button
          type="button"
          className="qris-close"
          onClick={() => exit.requestClose()}
          disabled={exit.exiting}
          aria-label={requiredLocalized(l10n, 'payment-qris-close-aria')}
        >
          &times;
        </button>

        <div className="qris-header">
          <Localized id="payment-qris-scan">
            <h2 className="qris-title">Scan with your payment app</h2>
          </Localized>
          <p className="qris-subtitle">QRIS</p>
        </div>

        <div className={`qris-qr-wrapper ${status === 'waiting' ? 'qris-pulse' : ''}`}>
          {qrString ? (
            <div
              className="qris-qr-real"
              role="img"
              aria-label={requiredLocalized(l10n, 'payment-qris-qr-aria')}
            >
              <QRCodeSVG value={qrString} size={224} level="M" marginSize={2} />
            </div>
          ) : (
          <div className="qris-qr-placeholder" aria-label={requiredLocalized(l10n, 'payment-qris-qr-aria')}>
            <div className="qris-qr-grid">
              {qrCells.map((row, i) =>
                row.map((cell, j) => (
                  <div
                    key={`${i}-${j}`}
                    className={`qris-qr-cell ${cell ? 'qris-qr-cell--filled' : ''}`}
                  />
                )),
              )}
            </div>
          </div>
          )}
        </div>

        <div className="qris-details">
          <div className="qris-detail-row">
            <span className="qris-detail-label">{requiredLocalized(l10n, 'payment-qris-amount')}</span>
            <span className="qris-detail-value">
              {(amount / 10 ** minorUnitExponent(currency)).toFixed(minorUnitExponent(currency))} {currency}
            </span>
          </div>
          <div className="qris-detail-row">
            <span className="qris-detail-label">{requiredLocalized(l10n, 'payment-qris-reference')}</span>
            <span className="qris-detail-value qris-detail-value--mono">{reference}</span>
          </div>
          <div className="qris-detail-row">
            <span className="qris-detail-label">{requiredLocalized(l10n, 'payment-qris-merchant')}</span>
            <span className="qris-detail-value">{requiredLocalized(l10n, 'payment-qris-merchant-name')}</span>
          </div>
        </div>

        {remainingSecs !== null && status === 'waiting' && (
          <p className="qris-countdown" role="timer">
            <Localized id="payment-qris-countdown" vars={{ seconds: remainingSecs }}>
              <span>Expires in {remainingSecs}s</span>
            </Localized>
          </p>
        )}

        {status === 'expired' && (
          <div className="qris-expired" role="alert">
            <Localized id="payment-qris-expired-title">
              <span className="qris-expired-title">The QR code expired</span>
            </Localized>
            <div className="qris-expired-actions">
              {onReissue && (
                <button
                  type="button"
                  className="qris-expired-btn"
                  onClick={onReissue}
                  aria-label={requiredLocalized(l10n, 'payment-qris-reissue')}
                >
                  <Localized id="payment-qris-reissue">
                    <span>Generate a new QR</span>
                  </Localized>
                </button>
              )}
              <button
                type="button"
                className="qris-expired-btn qris-expired-btn--cancel"
                onClick={() => exit.requestClose()}
                disabled={exit.exiting}
                aria-label={requiredLocalized(l10n, 'payment-qris-cancel')}
              >
                <Localized id="payment-qris-cancel">
                  <span>Cancel</span>
                </Localized>
              </button>
            </div>
          </div>
        )}

        {status === 'waiting' && (
          <div className="qris-status" role="status" aria-label={requiredLocalized(l10n, 'payment-qris-waiting-aria')}>
            <div className="qris-spinner" aria-hidden="true" />
            <Localized id="payment-qris-waiting">
              <span>Waiting for payment...</span>
            </Localized>
          </div>
        )}

        {/* Manual mode only: with no settlement feed, the cashier is the
            oracle. Auto mode has no button — its poll is the truth. */}
        {status === 'waiting' && !autoMode && (
          <button
            type="button"
            className="qris-manual-confirm-btn"
            onClick={() => setStatus('confirmed')}
            aria-label={requiredLocalized(l10n, 'payment-qris-manual-confirm')}
          >
            <Localized id="payment-qris-manual-confirm">
              <span>I received the payment</span>
            </Localized>
          </button>
        )}

        {status === 'confirmed' && (
          <div className="qris-status qris-status--success" role="status" aria-label={requiredLocalized(l10n, 'payment-qris-confirmed-aria')}>
            <Localized id="payment-qris-confirmed">
              <span>Payment confirmed!</span>
            </Localized>
          </div>
        )}
      </div>
    </div>
  );
}
