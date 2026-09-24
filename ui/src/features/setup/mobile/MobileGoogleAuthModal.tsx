import { Localized } from '@fluent/react';
import styles from './MobileWelcomeFlow.module.css';

export interface GoogleAccount {
  name: string;
  email: string;
  avatarColor?: string | undefined;
  avatarLetter?: string | undefined;
  testId?: string | undefined;
}

const DEFAULT_ACCOUNTS: readonly GoogleAccount[] = [
  {
    name: 'Joko Susilo',
    email: 'jokosusilo@gmail.com',
    avatarColor: '#3b82f6',
    avatarLetter: 'A',
    testId: 'google-account-joko',
  },
  {
    name: 'Valentino',
    email: 'valentino1234@gmail.com',
    avatarColor: '#10b981',
    avatarLetter: 'K',
    testId: 'google-account-valentino',
  },
];

export interface MobileGoogleAuthModalProps {
  onBack: () => void;
  onSelectAccount: (email: string) => void;
  accounts?: readonly GoogleAccount[] | undefined;
}

export function MobileGoogleAuthModal({
  onBack,
  onSelectAccount,
  accounts = DEFAULT_ACCOUNTS,
}: MobileGoogleAuthModalProps) {
  return (
    <div className={styles['authModalRoot']} data-testid="mobile-google-auth-view">
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
          {accounts.map((acc, index) => {
            const letter = acc.avatarLetter ?? acc.name.charAt(0).toUpperCase();
            const color = acc.avatarColor ?? '#3b82f6';
            const testId = acc.testId ?? `google-account-${index}`;
            return (
              <button
                key={acc.email}
                type="button"
                className={styles['accountCardBtn']}
                onClick={() => onSelectAccount(acc.email)}
                data-testid={testId}
              >
                <div
                  className={styles['accountAvatar']}
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                >
                  {letter}
                </div>
                <div className={styles['accountInfo']}>
                  <strong className={styles['accountName']}>{acc.name}</strong>
                  <span className={styles['accountEmail']}>{acc.email}</span>
                </div>
              </button>
            );
          })}
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
