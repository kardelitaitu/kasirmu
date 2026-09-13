import { useState, useEffect, useRef } from 'react';
import { useToast } from '@/frontend/shared/Toast';
import { requiredLocalized } from '@/frontend/shared';
import { activateLicense, getHardwareFingerprint, getMachineId } from '@/api/license';
import { detectTrialVertical } from '@/utils/trial-vertical';
import { detectBundleId } from '@/utils/bundle';
import { getVersion, getLocalIp } from '@/api/system';
import StatusBar from '@/components/StatusBar';
import { Localized, useLocalization } from '@fluent/react';
import ThemeToggle from '@/frontend/shell/ThemeToggle';
import { l10nErrorMessage } from '@/utils/app-error';
import { plainErrorMessage } from '@/utils/app-error';
import './LicenseActivationScreen.css';

/** Props for the LicenseActivationScreen component. */
export interface LicenseActivationScreenProps {
  /** Optional pre-existing error message to display on mount. */
  initialError?: string | null;
  /** Callback invoked after successful license activation. */
  onActivated: () => void;
}

/** License activation screen — form for entering a license key and email to activate the POS software. */
export default function LicenseActivationScreen({ initialError, onActivated }: LicenseActivationScreenProps) {
  const { l10n } = useLocalization();
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialError ?? null);
  const [appVersion, setAppVersion] = useState<string>('0.0.37');
  const [ipAddress, setIpAddress] = useState<string>(requiredLocalized(l10n, 'auth-ip-detecting'));
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; field: 'email' | 'phone' | 'licenseKey' } | null>(null);
  // Segmented-trial vertical (C2.1): detected once from the landing-page
  // URL param (?v=restaurant etc.) and passed to the server on activation.
  // The server only reads it for trial keys, so a stale/spoofed value can
  // never affect paid activations.
  const [trialVertical] = useState<string>(() => detectTrialVertical());
  // Vertical bundle (C3.2): detected once from ?bundle=restaurant_starter
  // and passed to the server on activation. Honored for trial keys only,
  // so a spoofed value can never widen a paid license.
  const [bundleId] = useState<string>(() => detectBundleId());
  const { addToast } = useToast();
  // Stable ref so the mount effect runs exactly once without depending on
  // l10n (which can cause the effect to re-fetch version/IP unnecessarily).
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;

  useEffect(() => {
    let mounted = true;
    getVersion().then(v => {
      if (mounted) setAppVersion(v.version);
    }).catch((err) => {
      console.warn('getVersion failed, using hardcoded fallback', err);
    });
    
    getLocalIp().then(ip => {
      if (mounted) setIpAddress(ip);
    }).catch(() => {
      if (mounted) setIpAddress(requiredLocalized(l10nRef.current, 'auth-ip-unknown'));
    });

    return () => { mounted = false; };
  }, []);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!key.trim() || !email.trim()) {
      setErrorMsg(l10n.getString('auth-validation-required'));
      return;
    }

    // Basic regex validation for email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setErrorMsg(l10n.getString('auth-validation-invalid-email'));
      return;
    }

    // Phone is required for tenant identity matching during re-activation.
    // Accept international format (+country) or plain digits (min 7).
    const phoneTrimmed = phone.trim();
    if (!phoneTrimmed) {
      setErrorMsg(l10n.getString('auth-validation-phone-required'));
      return;
    }
    const phoneDigits = phoneTrimmed.replace(/[^+\d]/g, '');
    if (phoneDigits.length < 7) {
      setErrorMsg(l10n.getString('auth-validation-invalid-phone'));
      return;
    }

    setLoading(true);
    try {
      const machineId = await getMachineId();
      // Device-level fingerprint (SPEC-2026-TRIAL-LOCK): the server's
      // one-trial-per-device lock keys on it, falling back to machine_id
      // when omitted. Always sent — it never gates paid keys.
      const hardwareFingerprint = await getHardwareFingerprint();

      // Pass the segmented-trial vertical only when detected, so generic
      // activations stay 4-arg (and the server ignores it for paid keys
      // regardless).
      const success = trialVertical || bundleId
        ? await activateLicense(
            key.trim(),
            email.trim(),
            machineId,
            phone.trim(),
            trialVertical || undefined,
            bundleId || undefined,
            hardwareFingerprint
          )
        : await activateLicense(key.trim(), email.trim(), machineId, phone.trim(), undefined, undefined, hardwareFingerprint);

      if (success) {
        addToast({ type: 'success', message: l10n.getString('auth-activation-success') });
        onActivated();
      } else {
        setErrorMsg(l10n.getString('auth-activation-failed'));
      }
    } catch (err: unknown) {
      const message = l10nErrorMessage(err, l10n, 'auth-activation-error');
      
      addToast({ 
        type: 'error', 
        message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, field: 'email' | 'phone' | 'licenseKey') => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, field });
  };

  const handleGlobalContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu(null);
  };

  const handlePaste = async () => {
    if (!contextMenu) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        if (contextMenu.field === 'email') setEmail(text);
        if (contextMenu.field === 'phone') setPhone(text);
        if (contextMenu.field === 'licenseKey') setKey(text.toUpperCase());
      }
    } catch (err: unknown) {
      console.error('Failed to read clipboard', err);
      const errMsg = plainErrorMessage(err);
      addToast({ 
        message: `${l10n.getString('auth-error-title')}: ${l10n.getString('auth-clipboard-error', { message: errMsg })}`, 
        type: 'error' 
      });
    }
    setContextMenu(null);
  };

  return (
    /* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */
    <div 
      className="license-activation-container" 
      onContextMenu={handleGlobalContextMenu}
      onClick={() => setContextMenu(null)}
    >
      <div style={{ position: 'fixed', top: '1.5rem', right: '1.5rem', zIndex: 1000 }}>
        <ThemeToggle />
      </div>
      <div className="license-activation-layout">
        <div className="license-activation-hero">
          <img src="/256x256.png" alt="OZ-POS Logo" className="license-activation-logo" />
        </div>
        
        <div className="license-activation-card">
          <div className="license-activation-header">
            <Localized id="auth-activate-title">
              <h1>Activate License</h1>
            </Localized>
            <Localized id="auth-activate-subtitle">
              <p>Enter your information below</p>
            </Localized>
            {/* Segmented-trial hint (C2.1): shown only when the user arrived
                from a vertical landing page. General signups ('' ) get the
                default 14-day Plus trial with no special hint. */}
            {trialVertical && (
              <p
                className="license-trial-hint"
                role="status"
                data-testid="trial-vertical-hint"
              >
                {trialVertical === 'restaurant'
                  ? l10n.getString('auth-trial-hint-pro')
                  : l10n.getString('auth-trial-hint-enterprise')}
              </p>
            )}
          </div>

          {errorMsg && (
            <div className="license-error-banner" role="alert">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleActivate} autoComplete="off">
            <div className="license-form-group">
              <Localized id="auth-email-label">
                <label htmlFor="email">Email Address</label>
              </Localized>
              <div className="license-input-wrapper">
                <input
                  id="email"
                  name="email-off"
                  type="email"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-1p-ignore="true"
                  className="license-input"
                  placeholder={l10n.getString('auth-email-placeholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onContextMenu={(e) => handleContextMenu(e, 'email')}
                  disabled={loading}
                />
                {email && !loading && (
                  <button type="button" className="license-input-clear" onClick={() => setEmail('')} aria-label={l10n.getString('auth-clear-email')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <div className="license-form-group">
              <Localized id="auth-phone-label">
                <label htmlFor="phone">Phone Number</label>
              </Localized>
              <div className="license-input-wrapper">
                <input
                  id="phone"
                  name="phone-off"
                  type="tel"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-1p-ignore="true"
                  className="license-input"
                  placeholder={l10n.getString('auth-phone-placeholder')}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onContextMenu={(e) => handleContextMenu(e, 'phone')}
                  disabled={loading}
                />
                {phone && !loading && (
                  <button type="button" className="license-input-clear" onClick={() => setPhone('')} aria-label={l10n.getString('auth-clear-phone')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <div className="license-form-group">
              <Localized id="auth-license-label">
                <label htmlFor="licenseKey">License Key</label>
              </Localized>
              <div className="license-input-wrapper">
                <input
                  id="licenseKey"
                  name="key-off"
                  type="text"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-1p-ignore="true"
                  className="license-input"
                  placeholder={l10n.getString('auth-license-placeholder')}
                  value={key}
                  onChange={(e) => setKey(e.target.value.toUpperCase())}
                  onContextMenu={(e) => handleContextMenu(e, 'licenseKey')}
                  disabled={loading}
                />
                {key && !loading && (
                  <button type="button" className="license-input-clear" onClick={() => setKey('')} aria-label={l10n.getString('auth-clear-key')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <button 
              type="submit" 
              className="license-submit-btn" 
              disabled={loading || !key || !email || !phone.trim()}
            >
              {loading ? (
                <>
                  <svg className="spinner" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  <Localized id="auth-activating">Activating...</Localized>
                </>
              ) : (
                <Localized id="auth-activate-button">Activate License</Localized>
              )}
            </button>
          </form>
        </div>
      </div>

      <div className="license-server-status-container">
        <StatusBar />
      </div>

      <div className="activation-device-info">
        <Localized id="auth-version" vars={{ version: appVersion }}>
          <span>Version {appVersion}</span>
        </Localized>
        <Localized id="auth-ip-address" vars={{ ip: ipAddress }}>
          <span>IP Address : {ipAddress}</span>
        </Localized>
        <Localized id="auth-copyright" vars={{ year: new Date().getFullYear().toString() }}>
          <span>OZ-POS © {new Date().getFullYear()} All rights reserved.</span>
        </Localized>
      </div>

      {contextMenu && (
        <button
          type="button"
          className="custom-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => {
            e.stopPropagation();
            handlePaste();
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
          </svg>
          <Localized id="auth-paste">Paste</Localized>
        </button>
      )}
    </div>
  );
}
