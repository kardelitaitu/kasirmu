import { useState, useCallback } from 'react';
import { Localized } from '@fluent/react';
import styles from './MobileWelcomeFlow.module.css';

export interface MobileQrPairingModalProps {
  onBack: () => void;
  pairingUrl?: string | undefined;
  pairingCode?: string | undefined;
}

export function MobileQrPairingModal({
  onBack,
  pairingUrl = 'https://kasir.mu/login?=1234-ABCD',
  pairingCode = '1234-ABCD',
}: MobileQrPairingModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(pairingUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Fallback or ignore
    }
  }, [pairingUrl]);

  return (
    <div className={styles['authModalRoot']} data-testid="mobile-qr-pairing-view">
      <nav className={styles['topNav']}>
        <button
          type="button"
          className={styles['backButton']}
          onClick={onBack}
          data-testid="mobile-qr-back-btn"
        >
          <span aria-hidden="true">←</span>
          <Localized id="setup-mobile-back">
            <span>Kembali</span>
          </Localized>
        </button>
      </nav>

      <div className={styles['qrPairingLayout']}>
        {/* Camera Live Feed / Scanner Placeholder */}
        <section className={styles['qrScannerSection']}>
        <div className={styles['scannerReticleBox']} data-testid="mobile-qr-reticle-box">
          <div className={styles['viewfinderFrame']}>
            <div className={styles['reticleCornerTL']} aria-hidden="true" />
            <div className={styles['reticleCornerTR']} aria-hidden="true" />
            <div className={styles['reticleCornerBL']} aria-hidden="true" />
            <div className={styles['reticleCornerBR']} aria-hidden="true" />
            <span style={{ fontSize: '3rem', opacity: 0.6 }} aria-hidden="true">
              📷
            </span>
          </div>
        </div>

        <p className={styles['scannerHint']}>
          <Localized id="setup-mobile-qr-reticle-hint">
            <span>Pastikan QR code berada di dalam bingkai</span>
          </Localized>
        </p>
      </section>

      {/* Guide Cards */}
      <div className={styles['instructionsGroup']}>
        {/* Instruction 1: QR Code */}
        <section className={styles['instructionCard']} aria-labelledby="qr-instructions-title">
          <h2 id="qr-instructions-title" className={styles['instructionTitle']}>
            <Localized id="setup-mobile-qr-guide-title">
              <span>Petunjuk Penggunaan QR code</span>
            </Localized>
          </h2>

          <div className={styles['stepsList']}>
            <p style={{ margin: 0 }}>
              <Localized id="setup-mobile-qr-step1">
                <span>1. Buka website dashboard.kasir.mu</span>
              </Localized>
            </p>
            <p style={{ margin: 0 }}>
              <Localized id="setup-mobile-qr-step2">
                <span>2. Masuk dengan akun owner</span>
              </Localized>
            </p>
            <p style={{ margin: 0 }}>
              <Localized id="setup-mobile-qr-step3">
                <span>3. Klik tombol &apos;Pasangkan Device Baru&apos; untuk menampilkan QR code pairing</span>
              </Localized>
            </p>
          </div>
        </section>

        {/* Instruction 2: Login Code */}
        <section className={styles['instructionCard']} aria-labelledby="code-instructions-title">
          <h2 id="code-instructions-title" className={styles['instructionTitle']}>
            <Localized id="setup-mobile-code-guide-title">
              <span>Petunjuk Penggunaan login code</span>
            </Localized>
          </h2>

          <div className={styles['stepsList']}>
            <p style={{ margin: 0 }}>
              <Localized id="setup-mobile-code-step1">
                <span>1. Buka website kasir.mu</span>
              </Localized>
            </p>
            <p style={{ margin: 0 }}>
              <Localized id="setup-mobile-code-step2">
                <span>2. Masuk dengan akun owner</span>
              </Localized>
            </p>
            <p style={{ margin: 0 }}>
              <Localized id="setup-mobile-code-step3">
                <span>Klik link ini :</span>
              </Localized>
            </p>
          </div>

          <div className={styles['copyCodeRow']}>
            <span
              className={styles['codeLinkBox']}
              title={pairingUrl}
              data-testid="mobile-qr-link-text"
            >
              {pairingUrl} ({pairingCode})
            </span>
            <button
              type="button"
              className={styles['copyButton']}
              onClick={handleCopy}
              data-testid="mobile-qr-copy-btn"
            >
              <Localized id={copied ? 'setup-mobile-code-copied' : 'setup-mobile-code-copy'}>
                <span>{copied ? 'Tersalin!' : 'Copy'}</span>
              </Localized>
            </button>
          </div>
        </section>
      </div>
      </div>

      <div className={styles['telemetryFooter']}>
        v0.0.40 • kasir.mu © 2026 All rights reserved.
      </div>
    </div>
  );
}
