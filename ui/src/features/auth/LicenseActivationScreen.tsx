import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/components/Toast';
import { requiredLocalized } from '@/components';
import {
  activateLicense,
  getHardwareFingerprint,
  getMachineId,
  linkDeviceGoogle,
  loginWithEmailPassword,
  requestEmailLoginCode,
  verifyEmailLoginCode,
  startDevicePairing,
  pollDevicePairing,
  type PairingSessionStart,
} from '@/api/license';
import { detectTrialVertical } from '@/utils/trial-vertical';
import { detectBundleId } from '@/utils/bundle';
import { getVersion } from '@/api/system';
import { useDeviceIp } from '@/hooks/useDeviceIp';
import StatusBar from '@/components/StatusBar';
import { Localized, useLocalization } from '@fluent/react';
import ThemeToggle from '@/app/ThemeToggle';
import { l10nErrorMessage } from '@/utils/app-error';
import { plainErrorMessage } from '@/utils/app-error';
import { isTabletShell } from '@/utils/shellKind';
import { QRCodeSVG } from 'qrcode.react';
import './LicenseActivationScreen.css';

/** Formats an 8-character Crockford code with a middle separator for legibility. */
function formatCrockford(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (clean.length === 8) {
    return `${clean.slice(0, 4)} - ${clean.slice(4)}`;
  }
  return code;
}

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
  // 'choose' is the entry screen: the two ways in (Google, pair). 'key' and
  // 'pair' are the detailed forms behind it. The tablet has no license-key
  // route — activate_license/get_machine_id/get_hardware_fingerprint are
  // desktop-only — so it never leaves 'pair', and its entry screen offers the
  // two routes it actually has (Google + pair).
  const [authMode, setAuthMode] = useState<'choose' | 'key' | 'pair' | 'email'>('choose');
  // The email step's sub-view: enter the address, or enter the code that
  // arrived (email-code), or the password (email-password).
  const [emailStep, setEmailStep] = useState<'address' | 'code' | 'password'>('address');
  const [emailAddress, setEmailAddress] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  /** Per-flow failure, rendered beside the control that caused it. */
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pairingSession, setPairingSession] = useState<PairingSessionStart | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingExpired, setPairingExpired] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialError ?? null);
  // The banner names the rule ("Enter a valid email") but not the control it
  // refers to, so with two fields on screen the user has to guess which one to
  // fix. Recording the offending field lets that input carry its own
  // aria-invalid and error border.
  const [badField, setBadField] = useState<'email' | 'phone' | null>(null);
  // Google sign-in state. Mirrors ProvisioningFlow's LinkState so the two
  // screens that both call link_device_google report it the same way.
  const [link, setLink] = useState<'idle' | 'linking' | 'failed'>('idle');

  /** Drop the mark as soon as the user edits the field it names. */
  const clearBadField = (field: 'email' | 'phone') =>
    setBadField((prev) => (prev === field ? null : prev));
  const [appVersion, setAppVersion] = useState<string>('0.0.40');
  // LAN + public addresses, each resolved independently (see useDeviceIp).
  // The offline/unresolved placeholder is derivable, so it is not state.
  const { local: localIp, public: publicIp } = useDeviceIp();
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

    return () => { mounted = false; };
  }, []);

  /**
   * Sign in with Google — or create the account, since the licence server
   * treats a first-time Google identity as a signup. On success the device is
   * linked, so we report activation upward exactly as a license key would.
   */
  const signInWithGoogle = useCallback(async () => {
    setLink('linking');
    setErrorMsg(null);
    try {
      await linkDeviceGoogle();
      setLink('idle');
      onActivated();
    } catch (err) {
      setLink('failed');
      console.warn('link_device_google failed', err);
    }
  }, [onActivated]);

  /**
   * Send a sign-in code to the address, then ask for it.
   *
   * Register-or-login: this creates the account when the address has none, so
   * there is no separate signup step to fall into.
   */
  const sendEmailCode = useCallback(async () => {
    setEmailBusy(true);
    setEmailError(null);
    try {
      await requestEmailLoginCode(emailAddress.trim());
      setEmailStep('code');
      setEmailCode('');
    } catch (err) {
      setEmailError(l10nErrorMessage(err, l10n, 'auth-email-failed'));
    } finally {
      setEmailBusy(false);
    }
  }, [emailAddress, l10n]);

  /** Spend the code; a proved address links the device and finishes the step. */
  const submitEmailCode = useCallback(async () => {
    setEmailBusy(true);
    setEmailError(null);
    try {
      await verifyEmailLoginCode(emailAddress.trim(), emailCode.trim());
      onActivated();
    } catch (err) {
      setEmailError(l10nErrorMessage(err, l10n, 'auth-email-failed'));
    } finally {
      setEmailBusy(false);
    }
  }, [emailAddress, emailCode, l10n, onActivated]);

  const submitEmailPassword = useCallback(async () => {
    setEmailBusy(true);
    setEmailError(null);
    try {
      await loginWithEmailPassword(emailAddress.trim(), emailPassword);
      onActivated();
    } catch (err) {
      setEmailError(l10nErrorMessage(err, l10n, 'auth-email-failed'));
    } finally {
      setEmailBusy(false);
    }
  }, [emailAddress, emailPassword, l10n, onActivated]);

  /** Return to the address step, clearing whatever the last attempt left. */
  const backToEmailAddress = useCallback(() => {
    setEmailStep('address');
    setEmailCode('');
    setEmailPassword('');
    setEmailError(null);
  }, []);
  const loadPairingSession = useCallback(async () => {
    setPairingLoading(true);
    setPairingExpired(false);
    setPairingError(null);
    try {
      const session = await startDevicePairing(isTabletShell() ? 'Tablet POS' : 'Desktop POS');
      setPairingSession(session);
    } catch (err: unknown) {
      setPairingError(l10nErrorMessage(err, l10n, 'auth-activation-error'));
    } finally {
      setPairingLoading(false);
    }
  }, [l10n]);

  useEffect(() => {
    if (authMode === 'pair' && !pairingSession && !pairingLoading && !pairingError) {
      void loadPairingSession();
    }
  }, [authMode, pairingSession, pairingLoading, pairingError, loadPairingSession]);

  useEffect(() => {
    if (authMode !== 'pair' || !pairingSession || pairingExpired) return;

    const interval = setInterval(async () => {
      if (pairingSession.expires_at) {
        const expires = new Date(pairingSession.expires_at).getTime();
        if (Date.now() >= expires) {
          setPairingExpired(true);
          return;
        }
      }

      try {
        const resp = await pollDevicePairing(pairingSession.poll_token);
        if (resp.status === 'claimed') {
          addToast({ type: 'success', message: l10n.getString('auth-pair-success') });
          onActivated();
        }
      } catch (err: unknown) {
        console.warn('Pairing poll error', err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [authMode, pairingSession, pairingExpired, addToast, l10n, onActivated]);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBadField(null);
    if (!key.trim() || !email.trim()) {
      setErrorMsg(l10n.getString('auth-validation-required'));
      return;
    }

    // Basic regex validation for email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setBadField('email');
      setErrorMsg(l10n.getString('auth-validation-invalid-email'));
      return;
    }

    // Phone is required for tenant identity matching during re-activation.
    // Accept international format (+country) or plain digits (min 7).
    const phoneTrimmed = phone.trim();
    if (!phoneTrimmed) {
      setBadField('phone');
      setErrorMsg(l10n.getString('auth-validation-phone-required'));
      return;
    }
    const phoneDigits = phoneTrimmed.replace(/[^+\d]/g, '');
    if (phoneDigits.length < 7) {
      setBadField('phone');
      setErrorMsg(l10n.getString('auth-validation-invalid-phone'));
      return;
    }

    setLoading(true);
    try {
      // C47: shell-guarded, and the guard is load-bearing rather than decorative.
      //
      // The tablet shell registers NONE of the three commands this path needs:
      // activate_license, get_machine_id and get_hardware_fingerprint are desktop-only
      // (apps/desktop-tauri/src/lib.rs:1261, :1267, :1269 — the tablet's commands::license
      // surface is get_license_status / check_license_status alone, and its activation
      // path is device pairing). Unguarded, a tablet submit is rejected as an unknown
      // command and the catch below reports a generic activation failure the operator
      // cannot act on: the C40 shape, on the licensing screen.
      //
      // `success` is deliberately three-state. `null` means NOT ATTEMPTED on this shell,
      // which is not the same claim as `false` (attempted and refused) — the same
      // distinction BackupSection draws between a failed read and an answered-empty one.
      // A tablet therefore reports nothing rather than inventing a failure.
      //
      // The three calls sit inside this `if` block on purpose: that brace is the guard
      // scripts/verify-ipc-parity.py's shell-blind leg reads, so an edit that lifts them
      // back out is caught by the gate rather than by a licensing outage.
      let success: boolean | null = null;
      if (!isTabletShell()) {
        const machineId = await getMachineId();
        // Device-level fingerprint (SPEC-2026-TRIAL-LOCK): the server's
        // one-trial-per-device lock keys on it, falling back to machine_id
        // when omitted. Always sent — it never gates paid keys.
        const hardwareFingerprint = await getHardwareFingerprint();

        // Pass the segmented-trial vertical only when detected, so generic
        // activations stay 4-arg (and the server ignores it for paid keys
        // regardless).
        success = trialVertical || bundleId
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
      }

      if (success === true) {
        addToast({ type: 'success', message: l10n.getString('auth-activation-success') });
        onActivated();
      } else if (success === false) {
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
          <img src="/256x256.png" alt="kasir.mu Logo" className="license-activation-logo" />
        </div>
        
        <div className="license-activation-card">
          <div className="license-activation-header">
            <Localized id="auth-activate-title">
              <h1>Setup</h1>
            </Localized>
            <Localized id="auth-activate-subtitle">
              <p>Sign in or link this device to get started</p>
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

          {/* A failure reported at boot (bad license, refused activation) belongs on the
              FIRST screen the merchant sees. It used to render only inside the license-key
              form, so on the entry screen it vanished — the merchant was told nothing. */}
          {authMode === 'choose' && errorMsg && (
            <div className="license-error-banner" role="alert">
              {errorMsg}
            </div>
          )}

          {authMode === 'choose' ? (
            <div className="license-setup-choices" data-testid="license-setup-choices">
              <div className="license-setup-choices-header">
                <Localized id="auth-setup-title">
                  <p>How would you like to get started?</p>
                </Localized>
              </div>

              <button
                type="button"
                className="license-setup-choice"
                data-testid="setup-google"
                onClick={() => void signInWithGoogle()}
                disabled={link === 'linking'}
              >
                <span className="license-setup-choice-title">
                  <Localized id="auth-setup-google">Sign in with Google</Localized>
                </span>
                <span className="license-setup-choice-desc">
                  <Localized id="auth-setup-google-desc">
                    Sign in, or create an account automatically if you are new.
                  </Localized>
                </span>
              </button>

              {link === 'linking' && (
                <p className="license-pairing-status" role="status">
                  <span className="license-pulse-dot" aria-hidden="true" />
                  <Localized id="auth-setup-waiting-browser">
                    <span>Waiting for your browser to finish signing in…</span>
                  </Localized>
                </p>
              )}

              {/* Same escape as the provisioning flow offers: say what
                  happened next to the control that did it, with a retry. */}
              {link === 'failed' && (
                <div className="license-error-banner" role="alert">
                  <Localized id="auth-setup-google-failed">
                    <span>Could not sign in with Google. Please try again.</span>
                  </Localized>
                </div>
              )}

              <button
                type="button"
                className="license-setup-choice"
                data-testid="setup-pair"
                onClick={() => {
                  setAuthMode('pair');
                  if (!pairingSession) void loadPairingSession();
                }}
              >
                <span className="license-setup-choice-title">
                  <Localized id="auth-setup-pair">Pair this device to your organization</Localized>
                </span>
                <span className="license-setup-choice-desc">
                  <Localized id="auth-setup-pair-desc">
                    Scan a code from a phone or another terminal that is already set up.
                  </Localized>
                </span>
              </button>

              {/* Email sign-in: the third way in, beside Google and pairing.
                  Same shape as the pair choice — set the mode, and the flow's
                  own view below takes over from the entry screen. */}
              <button
                type="button"
                className="license-setup-choice"
                data-testid="setup-email"
                onClick={() => setAuthMode('email')}
              >
                <span className="license-setup-choice-title">
                  <Localized id="auth-setup-email">Sign in with Email</Localized>
                </span>
                <span className="license-setup-choice-desc">
                  <Localized id="auth-setup-email-desc">
                    Get a one-time code by email, or sign in with your password.
                  </Localized>
                </span>
              </button>

              {/* The license-key form is desktop-only, so this is the one
                  route to it from the entry screen. */}
              {!isTabletShell() && (
                <button
                  type="button"
                  className="license-setup-link"
                  data-testid="setup-license-key"
                  onClick={() => setAuthMode('key')}
                >
                  <Localized id="auth-tab-license-key">License Key</Localized>
                </button>
              )}
            </div>
          ) : (
          <>
          <div className="license-mode-tabs" role="tablist" aria-label={l10n.getString('auth-activate-title')}>
            <button
              type="button"
              className="license-mode-tab"
              data-testid="setup-back"
              onClick={() => {
                setAuthMode('choose');
                setErrorMsg(null);
                setPairingError(null);
              }}
            >
              {/* Not role="tab": it leaves the tablist rather than selecting a panel. */}
              <Localized id="auth-setup-back">Back</Localized>
            </button>
            {/* C47: the License Key tab is NOT offered on the tablet. Its form cannot
                submit there — activate_license / get_machine_id / get_hardware_fingerprint
                are desktop-only (see the guard in handleActivate), so the tab would be a
                dead end an operator could fill in and then watch fail. The tablet's own
                activation surface is the pairing tab beside it, which is the mode the
                initial state already selects on that shell. Hiding the affordance is the
                honest half of the fix; the guard below is the enforced half, and the two
                are kept together because a tab is easy to re-add and the guard is what
                the parity gate reads. */}
            {!isTabletShell() && (
              <button
                type="button"
                role="tab"
                aria-selected={authMode === 'key'}
                className={`license-mode-tab ${authMode === 'key' ? 'active' : ''}`}
                onClick={() => setAuthMode('key')}
              >
                <Localized id="auth-tab-license-key">License Key</Localized>
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={authMode === 'pair'}
              className={`license-mode-tab ${authMode === 'pair' ? 'active' : ''}`}
              onClick={() => {
                setAuthMode('pair');
                if (!pairingSession) void loadPairingSession();
              }}
            >
              <Localized id="auth-tab-pair-device">Pair with Phone</Localized>
            </button>
          </div>

          {authMode === 'email' ? (
            /* The email flow: one view, three steps, switched by emailStep.
               Every step keeps the same failure surface (emailError) so a
               rejected code and a rejected password report in one place. */
            <div className="license-email-view" data-testid="license-email-view">
              {emailError && (
                <div className="license-error-banner" role="alert">
                  {emailError}
                </div>
              )}

              {emailStep === 'address' ? (
                <>
                  <p className="license-email-step-title">
                    <Localized id="auth-email-step-title">Sign in with your email address</Localized>
                  </p>

                  <div className="license-form-group">
                    <Localized id="auth-email-label">
                      <label htmlFor="emailLoginAddress">Email Address</label>
                    </Localized>
                    <input
                      id="emailLoginAddress"
                      name="email-login-address"
                      type="email"
                      autoComplete="email"
                      spellCheck={false}
                      className="license-input"
                      data-testid="email-login-address-input"
                      placeholder={l10n.getString('auth-email-placeholder')}
                      value={emailAddress}
                      onChange={(e) => setEmailAddress(e.target.value)}
                      disabled={emailBusy}
                    />
                  </div>

                  <button
                    type="button"
                    className="license-submit-btn"
                    data-testid="email-login-send-code"
                    onClick={() => void sendEmailCode()}
                    disabled={emailBusy || !emailAddress.trim()}
                  >
                    {emailBusy ? (
                      <>
                        <svg className="spinner" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none">
                          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                          <path d="M12 2a10 10 0 0 1 10 10" />
                        </svg>
                        <Localized id="auth-email-send-code">Send code</Localized>
                      </>
                    ) : (
                      <Localized id="auth-email-send-code">Send code</Localized>
                    )}
                  </button>

                  <button
                    type="button"
                    className="license-setup-link"
                    data-testid="email-login-use-password"
                    onClick={() => {
                      setEmailError(null);
                      setEmailStep('password');
                    }}
                  >
                    <Localized id="auth-email-use-password">Use a password instead</Localized>
                  </button>
                </>
              ) : emailStep === 'code' ? (
                <>
                  <p className="license-email-step-title">
                    <Localized id="auth-email-code-title">Enter the code we emailed you</Localized>
                  </p>

                  <div className="license-form-group">
                    <Localized id="auth-email-code-label">
                      <label htmlFor="emailLoginCode">Sign-in code</label>
                    </Localized>
                    <input
                      id="emailLoginCode"
                      name="email-login-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      spellCheck={false}
                      className="license-input"
                      data-testid="email-login-code-input"
                      placeholder={l10n.getString('auth-email-code-placeholder')}
                      value={emailCode}
                      onChange={(e) => setEmailCode(e.target.value)}
                      disabled={emailBusy}
                    />
                  </div>

                  <button
                    type="button"
                    className="license-submit-btn"
                    data-testid="email-login-verify"
                    onClick={() => void submitEmailCode()}
                    disabled={emailBusy || !emailCode.trim()}
                  >
                    {emailBusy ? (
                      <>
                        <svg className="spinner" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none">
                          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                          <path d="M12 2a10 10 0 0 1 10 10" />
                        </svg>
                        <Localized id="auth-email-verify">Verify code</Localized>
                      </>
                    ) : (
                      <Localized id="auth-email-verify">Verify code</Localized>
                    )}
                  </button>

                  <button
                    type="button"
                    className="license-setup-link"
                    data-testid="email-login-back"
                    onClick={backToEmailAddress}
                  >
                    <Localized id="auth-email-back">Use a different email address</Localized>
                  </button>
                </>
              ) : (
                <>
                  <p className="license-email-step-title">
                    <Localized id="auth-email-password-title">Sign in with your password</Localized>
                  </p>

                  <div className="license-form-group">
                    <Localized id="auth-email-password-label">
                      <label htmlFor="emailLoginPassword">Password</label>
                    </Localized>
                    <input
                      id="emailLoginPassword"
                      name="email-login-password"
                      type="password"
                      autoComplete="current-password"
                      className="license-input"
                      data-testid="email-login-password-input"
                      value={emailPassword}
                      onChange={(e) => setEmailPassword(e.target.value)}
                      disabled={emailBusy}
                    />
                  </div>

                  <button
                    type="button"
                    className="license-submit-btn"
                    data-testid="email-login-submit-password"
                    onClick={() => void submitEmailPassword()}
                    disabled={emailBusy || !emailAddress.trim() || !emailPassword}
                  >
                    {emailBusy ? (
                      <>
                        <svg className="spinner" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none">
                          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                          <path d="M12 2a10 10 0 0 1 10 10" />
                        </svg>
                        <Localized id="auth-email-password-submit">Sign in</Localized>
                      </>
                    ) : (
                      <Localized id="auth-email-password-submit">Sign in</Localized>
                    )}
                  </button>
                </>
              )}
            </div>
          ) : authMode === 'pair' ? (
            <div className="license-pairing-view" data-testid="license-pairing-view">
              {pairingError && (
                <div className="license-error-banner" role="alert">
                  {pairingError}
                </div>
              )}

              {pairingLoading ? (
                <div className="license-pairing-loading" role="status">
                  <svg className="spinner" viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" strokeWidth="2" fill="none">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  <p>{l10n.getString('auth-activating')}</p>
                </div>
              ) : pairingExpired ? (
                <div className="license-pairing-expired" role="alert">
                  <p>{l10n.getString('auth-pair-expired')}</p>
                  <button type="button" className="license-submit-btn" onClick={() => void loadPairingSession()}>
                    {l10n.getString('auth-pair-refresh')}
                  </button>
                </div>
              ) : pairingSession ? (
                <div className="license-pairing-content">
                  <p className="license-pairing-instructions">
                    <Localized id="auth-pair-scan-qr" vars={{ url: pairingSession.qr_url }}>
                      <span>Scan this QR code with your phone or visit {pairingSession.qr_url}</span>
                    </Localized>
                  </p>

                  <div className="license-pairing-qr-wrapper" data-testid="pairing-qr-code">
                    <QRCodeSVG
                      value={pairingSession.qr_url}
                      size={180}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#111827"
                    />
                  </div>

                  <div className="license-pairing-code-section">
                    <span className="license-pairing-code-label">{l10n.getString('auth-pair-code-label')}</span>
                    <div className="license-pairing-code-display" data-testid="pairing-code-display">
                      {formatCrockford(pairingSession.code)}
                    </div>
                  </div>

                  <div className="license-pairing-status" role="status">
                    <span className="license-pulse-dot" aria-hidden="true" />
                    <span>{l10n.getString('auth-pair-waiting')}</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              {errorMsg && (
                <div className="license-error-banner" role="alert">
                  {errorMsg}
                </div>
              )}

              {/* noValidate: the app validates email and phone itself and shows LOCALIZED
    copy (auth-validation-invalid-email / -invalid-phone). Left to the browser,
    native constraint validation refuses to fire submit for type="email", so
    handleActivate never runs - the app's own branch was unreachable and the
    user got an untranslated browser bubble instead of the product's message. */}
<form onSubmit={handleActivate} autoComplete="off" noValidate>
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
                      aria-invalid={badField === 'email' || undefined}
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        clearBadField('email');
                      }}
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
                      aria-invalid={badField === 'phone' || undefined}
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        clearBadField('phone');
                      }}
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
            </>
          )}
          </>
          )}
        </div>
      </div>

      <div className="license-server-status-container">
        <StatusBar />
      </div>

      <div className="activation-device-info">
        <Localized id="auth-version" vars={{ version: appVersion }}>
          <span>Version {appVersion}</span>
        </Localized>
        <Localized id="auth-ip-local" vars={{ ip: localIp ?? requiredLocalized(l10n, 'auth-ip-detecting') }}>
          <span>Local : {localIp ?? requiredLocalized(l10n, 'auth-ip-detecting')}</span>
        </Localized>
        <Localized id="auth-ip-public" vars={{ ip: publicIp ?? requiredLocalized(l10n, 'auth-ip-unknown') }}>
          <span>Public : {publicIp ?? requiredLocalized(l10n, 'auth-ip-unknown')}</span>
        </Localized>
        <Localized id="auth-copyright" vars={{ year: new Date().getFullYear().toString() }}>
          <span>kasir.mu © {new Date().getFullYear()} All rights reserved.</span>
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
