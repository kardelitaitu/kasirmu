import { Localized } from '@fluent/react';
import styles from './MobileWelcomeFlow.module.css';

export interface MobileSetupHubProps {
  onBack: () => void;
  onSelectGoogle: () => void;
  onSelectEmail: () => void;
  onSelectQr: () => void;
}

export function MobileSetupHub({
  onBack,
  onSelectGoogle,
  onSelectEmail,
  onSelectQr,
}: MobileSetupHubProps) {
  return (
    <div className={styles['hubContainer']} data-testid="mobile-setup-hub">
      <nav className={styles['topNav']}>
        <button
          type="button"
          className={styles['backButton']}
          onClick={onBack}
          data-testid="mobile-hub-back-btn"
        >
          <span aria-hidden="true">←</span>
          <Localized id="setup-mobile-back">
            <span>Kembali</span>
          </Localized>
        </button>
      </nav>

      {/* Hero Setup Card */}
      <section className={styles['heroCard']} aria-labelledby="hub-hero-title">
        <h1 id="hub-hero-title" className={styles['heroTitle']}>
          <Localized id="setup-mobile-hub-title">
            <span>Setup Device Baru</span>
          </Localized>
        </h1>
        <p className={styles['heroSubtitle']}>
          <Localized id="setup-mobile-hub-subtitle">
            <span>
              Sistem kasir & Inventory modern, cepat & offline-first untuk toko retail, cafe & restoran.
            </span>
          </Localized>
        </p>

        <ul className={styles['featureList']}>
          <li className={styles['featureItem']}>
            <span className={styles['featureBullet']} aria-hidden="true" />
            <Localized id="setup-mobile-feature-offline">
              <span>Bekerja 100% Offline Tanpa Koneksi Internet</span>
            </Localized>
          </li>
          <li className={styles['featureItem']}>
            <span className={styles['featureBullet']} aria-hidden="true" />
            <Localized id="setup-mobile-feature-printer">
              <span>Cetak Struk Thermal Bluetooth</span>
            </Localized>
          </li>
          <li className={styles['featureItem']}>
            <span className={styles['featureBullet']} aria-hidden="true" />
            <Localized id="setup-mobile-feature-multidevice">
              <span>Multi-Device & Sinkronisasi Lokal via WiFi / LAN</span>
            </Localized>
          </li>
          <li className={styles['featureItem']}>
            <span className={styles['featureBullet']} aria-hidden="true" />
            <Localized id="setup-mobile-feature-reports">
              <span>Laporan Stok, Kas & Omset Otomatis Real-time</span>
            </Localized>
          </li>
        </ul>
      </section>

      {/* Auth Linking Selector */}
      <p className={styles['hubSectionPrompt']}>
        <Localized id="setup-mobile-hub-connect-hint">
          <span>Hubungkan toko untuk sinkronisasi katalog, staf & laporan transaksi</span>
        </Localized>
      </p>

      <div className={styles['authOptionsList']}>
        {/* Option 1: Google */}
        <button
          type="button"
          className={styles['authCard']}
          onClick={onSelectGoogle}
          data-testid="mobile-hub-google-btn"
        >
          <strong className={styles['authCardTitle']}>
            <Localized id="setup-mobile-auth-google-title">
              <span>Masuk dengan Akun Google</span>
            </Localized>
          </strong>
          <span className={styles['authCardDesc']}>
            <Localized id="setup-mobile-auth-google-desc">
              <span>Aman, cepat, dan otomatis backup cloud ke Google Drive</span>
            </Localized>
          </span>
        </button>

        {/* Option 2: Email & Password */}
        <button
          type="button"
          className={styles['authCard']}
          onClick={onSelectEmail}
          data-testid="mobile-hub-email-btn"
        >
          <strong className={styles['authCardTitle']}>
            <Localized id="setup-mobile-auth-email-title">
              <span>Masuk dengan Email & Password</span>
            </Localized>
          </strong>
          <span className={styles['authCardDesc']}>
            <Localized id="setup-mobile-auth-email-desc">
              <span>Gunakan akun Owner, Store Manager, atau Kasir yang terdaftar</span>
            </Localized>
          </span>
        </button>

        {/* Option 3: QR Code / Login Code (Primary Highlight in Blue) */}
        <button
          type="button"
          className={`${styles['authCard']} ${styles['authCardPrimary']}`}
          onClick={onSelectQr}
          data-testid="mobile-hub-qr-btn"
        >
          <strong className={styles['authCardTitle']}>
            <Localized id="setup-mobile-auth-qr-title">
              <span>Hubungkan via QR Code / Login Code</span>
            </Localized>
          </strong>
          <span className={styles['authCardDesc']}>
            <Localized id="setup-mobile-auth-qr-desc">
              <span>Scan QR dengan akun owner/admin</span>
            </Localized>
          </span>
        </button>
      </div>

      <p className={styles['hubFooterNote']}>
        <Localized id="setup-mobile-hub-footer">
          <span>Belum punya akun Kasirmu? Hubungi sales@kasirmu.com atau daftar di kasirmu.id</span>
        </Localized>
      </p>

      <div className={styles['telemetryFooter']}>
        v0.0.40 • kasir.mu © 2026 All rights reserved.
      </div>
    </div>
  );
}
