import { Localized } from '@fluent/react';
import styles from './MobileWelcomeFlow.module.css';

export interface MobileWelcomeScreenProps {
  onStartSetup: () => void;
  onSignUp?: (() => void) | undefined;
}

export function MobileWelcomeScreen({ onStartSetup, onSignUp }: MobileWelcomeScreenProps) {
  return (
    <div className={styles['welcomeRoot']} data-testid="mobile-welcome-screen">
      <div className={styles['welcomeBrandSection']}>
        <img
          src="/branding/logo-full-dark.svg"
          alt="kasir.mu"
          className={styles['welcomeLogo']}
          data-testid="mobile-welcome-logo"
        />
      </div>

      <div className={styles['welcomeActionsSection']}>
        <div className={styles['actionButtonWrapper']}>
          <button
            type="button"
            className={styles['primaryCtaBtn']}
            onClick={onStartSetup}
            data-testid="mobile-welcome-start-btn"
          >
            <Localized id="setup-mobile-welcome-cta">
              <span>Setup Wizard →</span>
            </Localized>
          </button>
          <span className={styles['ctaCaption']}>
            <Localized id="setup-mobile-welcome-guide">
              <span>Panduan 2 menit konfigurasi perangkat</span>
            </Localized>
          </span>
        </div>

        <div className={styles['actionButtonWrapper']}>
          <button
            type="button"
            className={styles['secondaryCtaBtn']}
            onClick={onSignUp}
            data-testid="mobile-welcome-signup-btn"
          >
            <Localized id="setup-mobile-welcome-signup">
              <span>Sign up</span>
            </Localized>
          </button>
          <span className={styles['ctaCaption']}>
            <Localized id="setup-mobile-welcome-signup-hint">
              <span>Belum punya lisensi? Buat akun dulu</span>
            </Localized>
          </span>
        </div>
      </div>

      <div>
        <p className={styles['welcomeBlurb']}>
          <Localized id="setup-mobile-welcome-blurb">
            <span>
              Solusi kasir modern serba bisa untuk mencatat penjualan, kelola stok barang,
              cetak struk thermal, dan pantau omset toko secara otomatis.
            </span>
          </Localized>
        </p>

        <div className={styles['telemetryFooter']}>
          v0.0.40 • kasir.mu © 2026 All rights reserved.
        </div>
      </div>
    </div>
  );
}
