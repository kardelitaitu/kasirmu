import { useState, useCallback } from 'react';
import { Localized } from '@fluent/react';
import styles from './MobileWelcomeFlow.module.css';

export interface MobileEmailAuthModalProps {
  onBack: () => void;
  onSubmit: (credentials: { email: string; password?: string | undefined }) => void;
  onForgotPassword?: (() => void) | undefined;
  isLoading?: boolean | undefined;
  error?: string | null | undefined;
}

export function MobileEmailAuthModal({
  onBack,
  onSubmit,
  onForgotPassword,
  isLoading = false,
  error,
}: MobileEmailAuthModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim() || isLoading) return;
      onSubmit({ email: email.trim(), password });
    },
    [email, password, isLoading, onSubmit],
  );

  return (
    <div className={styles['authModalRoot']} data-testid="mobile-email-auth-view">
      <nav className={styles['topNav']}>
        <button
          type="button"
          className={styles['backButton']}
          onClick={onBack}
          data-testid="mobile-email-back-btn"
        >
          <span aria-hidden="true">←</span>
          <Localized id="setup-mobile-back">
            <span>Kembali</span>
          </Localized>
        </button>
      </nav>

      <section className={styles['authModalCard']} aria-labelledby="email-auth-heading">
        {error && (
          <div className={styles['errorMessage']} role="alert" data-testid="mobile-email-error">
            <span aria-hidden="true">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <div className={styles['modalTitleSection']}>
          <h2 id="email-auth-heading" className={styles['modalTitle']}>
            <Localized id="setup-mobile-auth-email-title">
              <span>Masuk dengan Email & Password</span>
            </Localized>
          </h2>
          <p className={styles['modalSubtitle']}>
            <Localized id="setup-mobile-email-intro">
              <span>
                Masukkan kredensial akun untuk menghubungkan data katalog & stok toko:
              </span>
            </Localized>
          </p>
        </div>

        <form className={styles['emailForm']} onSubmit={handleSubmit}>
          {/* Email input */}
          <div className={styles['formField']}>
            <label htmlFor="mobile-auth-email" className={styles['formLabel']}>
              Email
            </label>
            <input
              id="mobile-auth-email"
              type="email"
              className={styles['textInput']}
              placeholder="nama@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              disabled={isLoading}
              data-testid="mobile-email-input"
            />
          </div>

          {/* Password input */}
          <div className={styles['formField']}>
            <div className={styles['formLabelRow']}>
              <label htmlFor="mobile-auth-password" className={styles['formLabel']}>
                Password
              </label>
              {onForgotPassword && (
                <button
                  type="button"
                  className={styles['forgotPasswordLink']}
                  onClick={onForgotPassword}
                  disabled={isLoading}
                  data-testid="mobile-forgot-password-link"
                >
                  <Localized id="setup-mobile-email-forgot">
                    <span>Lupa kata sandi?</span>
                  </Localized>
                </button>
              )}
            </div>
            <input
              id="mobile-auth-password"
              type="password"
              className={styles['textInput']}
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={isLoading}
              data-testid="mobile-password-input"
            />
          </div>

          <button
            type="submit"
            className={styles['primaryCtaBtn']}
            style={{ marginTop: 'var(--space-2)' }}
            disabled={!email.trim() || isLoading}
            data-testid="mobile-email-submit-btn"
          >
            {isLoading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span className={styles['spinner']} aria-hidden="true" />
                <span>Memproses...</span>
              </span>
            ) : (
              <Localized id="setup-mobile-email-submit">
                <span>Masuk →</span>
              </Localized>
            )}
          </button>
        </form>

        <div className={styles['trustSeal']}>
          <Localized id="setup-mobile-email-security">
            <span>
              🔒 Koneksi terenkripsi end-to-end SSL 256-bit & tersimpan lokal di perangkat
            </span>
          </Localized>
        </div>
      </section>

      <div className={styles['telemetryFooter']}>
        v0.0.40 • kasir.mu © 2026 All rights reserved.
      </div>
    </div>
  );
}
