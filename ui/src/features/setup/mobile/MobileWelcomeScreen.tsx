import { Localized } from '@fluent/react';
import styles from './MobileWelcomeFlow.module.css';

export interface MobileWelcomeScreenProps {
  onStartSetup: () => void;
  onSignUp?: (() => void) | undefined;
  /**
   * Offered when this wizard was reached from another surface — the tablet's
   * "Set up with a phone instead" button lands here by setting
   * `#/mobile-setup`. Going back is clearing that hash: both shells reset
   * their route when it clears, which re-renders the provisioning form this
   * wizard was opened over. Without it the hop is one-way and a merchant who
   * opened the phone wizard by accident has no way back to the tablet.
   */
  onBackToDevice?: (() => void) | undefined;
}

export function MobileWelcomeScreen({
  onStartSetup,
  onSignUp,
  onBackToDevice,
}: MobileWelcomeScreenProps) {
  return (
    <div className={styles['welcomeRoot']} data-testid="mobile-welcome-screen">
      {onBackToDevice && (
        <nav className={styles['topNav']}>
          <button
            type="button"
            className={styles['backButton']}
            onClick={onBackToDevice}
            data-testid="mobile-welcome-back-to-device-btn"
          >
            <span aria-hidden="true">←</span>
            <Localized id="setup-mobile-back-to-device">
              <span>Set up on this device instead</span>
            </Localized>
          </button>
        </nav>
      )}
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
            disabled={!onSignUp}
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
