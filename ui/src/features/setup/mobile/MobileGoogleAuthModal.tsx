import { Localized } from '@fluent/react';
import styles from './MobileWelcomeFlow.module.css';

export interface MobileGoogleAuthModalProps {
  onBack: () => void;
  onSelectAccount: (email: string) => void;
}

export function MobileGoogleAuthModal({ onBack, onSelectAccount }: MobileGoogleAuthModalProps) {
  return (
    <div className={styles['hubContainer']} data-testid="mobile-google-auth-view">
      <nav className={styles['topNav']}>
        <button
          type="button"
          className={styles['backButton']}
          onClick={onBack}
          data-testid="mobile-google-back-btn"
        >
          <span aria-hidden="true">←</span>
          <Localized id="setup-mobile-back">
            <span>Kembali</span>
          </Localized>
        </button>
      </nav>

      <section className={styles['authModalCard']} aria-labelledby="google-auth-title">
        <div className={styles['googlePillBadge']} aria-hidden="true">
          Google
        </div>

        <div className={styles['modalTitleSection']}>
          <h2 id="google-auth-title" className={styles['modalTitle']}>
            <Localized id="setup-mobile-google-title">
              <span>Pilih akun untuk melanjutkan</span>
            </Localized>
          </h2>
          <p className={styles['modalSubtitle']}>
            <Localized id="setup-mobile-google-subtitle">
              <span>ke aplikasi Kasir.mu Sync & Cloud Backup</span>
            </Localized>
          </p>
        </div>

        <div className={styles['accountsList']} role="list">
          {/* Account 1 */}
          <button
            type="button"
            className={styles['accountCardBtn']}
            onClick={() => onSelectAccount('jokosusilo@gmail.com')}
            data-testid="google-account-joko"
          >
            <div
              className={styles['accountAvatar']}
              style={{ backgroundColor: '#3b82f6' }}
              aria-hidden="true"
            >
              A
            </div>
            <div className={styles['accountInfo']}>
              <strong className={styles['accountName']}>Joko Susilo</strong>
              <span className={styles['accountEmail']}>jokosusilo@gmail.com</span>
            </div>
          </button>

          {/* Account 2 */}
          <button
            type="button"
            className={styles['accountCardBtn']}
            onClick={() => onSelectAccount('valentino1234@gmail.com')}
            data-testid="google-account-valentino"
          >
            <div
              className={styles['accountAvatar']}
              style={{ backgroundColor: '#10b981' }}
              aria-hidden="true"
            >
              K
            </div>
            <div className={styles['accountInfo']}>
              <strong className={styles['accountName']}>Valentino</strong>
              <span className={styles['accountEmail']}>valentino1234@gmail.com</span>
            </div>
          </button>
        </div>

        <p className={styles['privacyFootnote']}>
          <Localized id="setup-mobile-google-privacy">
            <span>
              Kasir.mu hanya meminta izin sinkronisasi profil Google. Data penjualan dan
              transaksi Anda tetap tersimpan privat di perangkat lokal.
            </span>
          </Localized>
        </p>
      </section>

      <div className={styles['telemetryFooter']}>
        v0.0.40 • kasir.mu © 2026 All rights reserved.
      </div>
    </div>
  );
}
