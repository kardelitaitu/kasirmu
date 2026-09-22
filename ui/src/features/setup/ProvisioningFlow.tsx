import { useCallback, useState, useEffect } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { getPresetFeatures, provisionDevice, type LocationKind, type Preset, type ProvisioningMode } from '@/api/settings';
import { getDeviceId } from '@/api/system';
import {
  consumeDeviceLinkCode,
  linkDeviceGoogle,
  requestDeviceLinkCode,
  startDevicePairing,
  pollDevicePairing,
  type LinkedAccountDto,
  type PairingSessionStart,
} from '@/api/license';
import { isTabletShell } from '@/utils/shellKind';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import { l10nErrorMessage } from '@/utils/app-error';
import { QRCodeSVG } from 'qrcode.react';

import './ProvisioningFlow.css';

/** Formats an 8-character Crockford code with a middle separator for legibility. */
function formatCrockford(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (clean.length === 8) {
    return `${clean.slice(0, 4)} - ${clean.slice(4)}`;
  }
  return code;
}

/**
 * First-run provisioning (ADR #56 §2.3 / User Decision Mode 2: linked + Free subscription).
 *
 * Requirements:
 * 1. Requires connecting to an account (Google on desktop, Email OTP on tablet)
 *    to obtain a tenant_id and link the device. The account is what the free
 *    plan attaches to, so `mode` starts at 'linked' — see `provisionMode`.
 * 2. Blocks ACCOUNT LINKING while offline, with a clear connection message.
 *    Corrected 2026-09-23: this used to claim it "hard blocks first run if
 *    offline", which overstated it. `provision_device` takes a DB lock and
 *    writes local SQLite rows — no network call exists in its body — so a
 *    provision itself cannot fail for want of a connection, and the offline-only
 *    mode must stay open to a merchant with no signal. What offline actually
 *    blocks is the LINK (the Google control and both tablet routes), and that is
 *    what `isOffline` gates. The submit button is deliberately NOT gated on it.
 * 3. Sends mode: 'linked' with tenant_id to provisionDevice.
 */
export interface ProvisioningFlowProps {
  /** Called once the terminal is provisioned, so the shell can route on. */
  onProvisioned: () => void;
}

/** The Google control's state. */
type LinkState =
  | { kind: 'idle' }
  | { kind: 'linking' }
  | { kind: 'linked'; account: LinkedAccountDto }
  | { kind: 'failed' };

/** The emailed-code path's state for tablet. */
type EmailState = 'idle' | 'sending' | 'sent' | 'verifying' | 'verified' | 'failed';

/**
 * The store types offered, with the preset each maps to.
 *
 * \`labelId\`/\`blurbId\` are Fluent ids, not strings: the labels are user-visible
 * copy on the very first screen a merchant sees, so they must translate. They
 * used to be TSX literals rendered raw, which no FTL key could ever reach — an
 * Indonesian merchant read English here while every sibling string on the same
 * screen was localized. Each is now rendered through <Localized>, matching the
 * fallback text to the en bundle exactly.
 */
const STORE_TYPES: { value: Preset; kind: LocationKind; emoji: string; labelId: string; blurbId: string }[] = [
  {
    value: 'simple-retail',
    kind: 'retail',
    emoji: '🛒',
    labelId: 'setup-store-type-simple-retail',
    blurbId: 'setup-store-type-simple-retail-blurb',
  },
  {
    value: 'restaurant',
    kind: 'restaurant',
    emoji: '🍽️',
    labelId: 'setup-store-type-restaurant',
    blurbId: 'setup-store-type-restaurant-blurb',
  },
];

/** Whether a preset trades as a restaurant (so the kitchen display is created). */
function kindForPreset(preset: Preset): LocationKind {
  return STORE_TYPES.find((t) => t.value === preset)?.kind ?? 'retail';
}
/**
 * Fallback text for each store type, matching the en bundle word for word.
 *
 * <Localized> replaces its children with the bundle's string when the id
 * resolves, so these are what a missing key would leave on screen — readable
 * copy rather than the raw id. They are the same words the literal version
 * rendered before these labels became translatable.
 */
const STORE_TYPE_FALLBACK: Record<string, { label: string; blurb: string }> = {
  'simple-retail': {
    label: 'Shop',
    blurb: 'Barcode, cash, receipt, inventory, tax',
  },
  restaurant: {
    label: 'Restaurant or cafe',
    blurb: 'Tables, kitchen display, staff login',
  },
};

export default function ProvisioningFlow({ onProvisioned }: ProvisioningFlowProps) {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  // 'linked' is the DEFAULT, not merely an offered choice: the free plan attaches
  // to a kasir.mu account (Google or an emailed code), so a fresh terminal signs
  // up before it opens a register. The 'local' mode stays reachable — a merchant
  // with no connection needs a way to provision at all — but it is now the
  // deliberate exception rather than the path of least resistance.
  const [provisionMode, setProvisionMode] = useState<ProvisioningMode>('linked');
  const [isOffline, setIsOffline] = useState(() => (typeof navigator !== 'undefined' ? !navigator.onLine : false));
  const [storeType, setStoreType] = useState<Preset | null>(null);
  const [locationName, setLocationName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerUsername, setOwnerUsername] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Account linking state
  const [linkedAccount, setLinkedAccount] = useState<LinkedAccountDto | null>(null);
  const [link, setLink] = useState<LinkState>({ kind: 'idle' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailState, setEmailState] = useState<EmailState>('idle');
  const [codeSent, setCodeSent] = useState(false);

  // Tablet pairing state
  const [tabletTab, setTabletTab] = useState<'pair' | 'email'>('pair');
  const [pairingSession, setPairingSession] = useState<PairingSessionStart | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingExpired, setPairingExpired] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);

  const loadPairingSession = useCallback(async () => {
    setPairingLoading(true);
    setPairingExpired(false);
    setPairingError(null);
    try {
      const session = await startDevicePairing(isTabletShell() ? 'Tablet POS' : 'Desktop POS');
      setPairingSession(session);
    } catch (err: unknown) {
      setPairingError(l10nErrorMessage(err, l10n, 'setup-account-failed'));
    } finally {
      setPairingLoading(false);
    }
  }, [l10n]);

  useEffect(() => {
    if (provisionMode === 'linked' && tabletTab === 'pair' && !pairingSession && !pairingLoading && !pairingError && !linkedAccount) {
      void loadPairingSession();
    }
  }, [provisionMode, tabletTab, pairingSession, pairingLoading, pairingError, linkedAccount, loadPairingSession]);

  useEffect(() => {
    if (provisionMode !== 'linked' || tabletTab !== 'pair' || !pairingSession || pairingExpired || linkedAccount) return;

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
          const terminalDto = resp.terminal
            ? {
                ...(resp.terminal.terminalId !== undefined ? { terminalId: resp.terminal.terminalId } : {}),
                ...(resp.terminal.issued !== undefined ? { issued: resp.terminal.issued } : {}),
                ...(resp.terminal.reason !== undefined ? { reason: resp.terminal.reason } : {}),
              }
            : undefined;

          const linked: LinkedAccountDto = {
            tenantId: resp.tenant_id ?? '',
            provider: 'pairing',
            email: resp.email ?? 'Device Paired',
            ...(terminalDto ? { terminal: terminalDto } : {}),
          };
          setLinkedAccount(linked);
          addToast({ type: 'success', message: l10n.getString('auth-pair-success') });
        }
      } catch (err: unknown) {
        console.warn('Pairing poll error', err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [provisionMode, tabletTab, pairingSession, pairingExpired, linkedAccount, addToast, l10n]);

  const linkingBusy =
    link.kind === 'linking' || emailState === 'sending' || emailState === 'verifying';

  const linkWithGoogle = async () => {
    setLink({ kind: 'linking' });
    setErrorMsg(null);
    try {
      const account = await linkDeviceGoogle();
      setLink({ kind: 'linked', account });
      setLinkedAccount(account);
    } catch {
      setLink({ kind: 'failed' });
      setErrorMsg(l10n.getString('setup-account-failed'));
    }
  };

  const sendCode = async () => {
    setEmailState('sending');
    setErrorMsg(null);
    try {
      await requestDeviceLinkCode(email);
      setCodeSent(true);
      setEmailState('sent');
    } catch {
      setEmailState('failed');
      setErrorMsg(l10n.getString('setup-account-failed'));
    }
  };

  const verifyCode = async () => {
    setEmailState('verifying');
    setErrorMsg(null);
    try {
      const account = await consumeDeviceLinkCode(code);
      const linked: LinkedAccountDto = {
        tenantId: account.tenantId,
        provider: 'email',
        email: account.email,
        ...(account.terminal ? { terminal: account.terminal } : {}),
      };
      setLinkedAccount(linked);
      setEmailState('verified');
    } catch {
      setEmailState('failed');
      setErrorMsg(l10n.getString('setup-account-failed'));
    }
  };

  const isLinked = linkedAccount !== null;

  // ── Inline PIN validation ──────────────────────────────────────────
  //
  // `canSubmit` disables the button on a short or mismatched PIN, which leaves
  // the merchant with a dead control and no reason for it. These two messages
  // name the problem instead. Each is gated on the user having typed enough to
  // HAVE the problem — a "PINs do not match" on first paint, before the confirm
  // field is touched, reads as an accusation rather than help.
  const pinTooShort = pin.length > 0 && pin.length < 4;
  const pinMismatch = confirmPin.length > 0 && pin !== confirmPin;
  const pinError = pinMismatch
    ? l10n.getString('setup-provision-pin-mismatch')
    : pinTooShort
      ? l10n.getString('setup-provision-pin-too-short')
      : null;

  const canSubmit =
    (provisionMode === 'local' || isLinked) &&
    storeType !== null &&
    locationName.trim() !== '' &&
    ownerName.trim() !== '' &&
    ownerUsername.trim() !== '' &&
    pin.length >= 4 &&
    pin === confirmPin;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMsg(null);
      if (provisionMode === 'linked' && !isLinked) {
        setErrorMsg(l10n.getString('setup-provision-account-required'));
        return;
      }
      if (!canSubmit || !storeType) return;

      setBusy(true);
      try {
        const terminalId = await getDeviceId();
        // The store type IS the answer to "which features does this terminal
        // start with" (ADR #56 §2.3: the preset is *evaluated, not
        // interrogated*). Resolve it here — this flow is the one that asks the
        // question, which is where `ProvisionDeviceArgs::preset`'s doc places the
        // derivation. The list comes from core rather than a local copy, so the
        // two cannot drift.
        //
        // An unknown preset resolves to `[]` rather than failing the submit: a
        // build that does not know a store type must not strand the merchant at
        // the first-run screen, which is the same degradation
        // `write_provisioning_settings` applies to an unknown feature key.
        const features = await getPresetFeatures(storeType)
          .then((r) => r.features)
          .catch(() => []);
        const result = await provisionDevice({
          terminal_id: terminalId,
          location_name: locationName.trim(),
          currency: 'IDR',
          timezone: 'Asia/Jakarta',
          owner_username: ownerUsername.trim(),
          owner_display_name: ownerName.trim(),
          owner_pin: pin,
          preset: storeType,
          features,
          location_kind: kindForPreset(storeType),
          mode: provisionMode,
          tenant_id: provisionMode === 'linked' ? (linkedAccount?.tenantId ?? null) : null,
          device_credential_id: provisionMode === 'linked' ? (linkedAccount?.terminal?.terminalId ?? terminalId) : null,
        });
        addToast({
          type: 'success',
          message: l10n.getString('setup-provision-success'),
        });
        void result;
        onProvisioned();
      } catch (err: unknown) {
        setErrorMsg(l10nErrorMessage(err, l10n, 'setup-provision-error'));
      } finally {
        setBusy(false);
      }
    },
    [
      addToast,
      canSubmit,
      isLinked,
      l10n,
      linkedAccount,
      locationName,
      onProvisioned,
      ownerName,
      ownerUsername,
      pin,
      provisionMode,
      storeType,
    ],
  );

  return (
    <div className="provisioning-container" data-testid="provisioning-flow">
      <form className="provisioning-card" onSubmit={handleSubmit}>
        <header className="provisioning-header">
          <Localized id="setup-provision-title">
            <h1>Set up this terminal</h1>
          </Localized>
          {provisionMode === 'local' ? (
            <Localized id="setup-mode-local-desc">
              <p>No account needed. Set up and start selling 100% offline immediately.</p>
            </Localized>
          ) : (
            <Localized id="setup-provision-desc">
              <p>Sign in to link your free kasir.mu account, then you can start selling.</p>
            </Localized>
          )}
        </header>

        {errorMsg && (
          <div className="provisioning-error" role="alert">
            {errorMsg}
          </div>
        )}

        {/* Step 1: Mode Selection (ADR #56 §2.3) */}
        <section className="provisioning-mode-box" aria-labelledby="provision-mode-heading">
          <h2 id="provision-mode-heading" style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-weight-medium)', margin: 0 }}>
            <Localized id="setup-provision-mode-section">Setup Mode</Localized>
          </h2>
          <div className="provisioning-mode-options">
            {/* The linked card is FIRST because it is the default: the free plan
                attaches to an account, and the recommended path should not sit
                second behind the exception. */}
            <button
              type="button"
              className={`provisioning-mode-card ${provisionMode === 'linked' ? 'is-selected' : ''}`}
              onClick={() => setProvisionMode('linked')}
              aria-pressed={provisionMode === 'linked'}
              data-testid="provision-mode-linked"
            >
              <div className="provisioning-mode-card-header">
                <span className="provisioning-mode-icon" aria-hidden="true">☁️</span>
                <strong><Localized id="setup-mode-linked-title">Link your kasir.mu account</Localized></strong>
              </div>
              <p><Localized id="setup-mode-linked-desc">Sign up or sign in to attach this terminal to your account, for multi-device sync, cloud backup, and your plan.</Localized></p>
            </button>

            <button
              type="button"
              className={`provisioning-mode-card ${provisionMode === 'local' ? 'is-selected' : ''}`}
              onClick={() => setProvisionMode('local')}
              aria-pressed={provisionMode === 'local'}
              data-testid="provision-mode-local"
            >
              <div className="provisioning-mode-card-header">
                <span className="provisioning-mode-icon" aria-hidden="true">⚡</span>
                <strong><Localized id="setup-mode-local-title">Offline only</Localized></strong>
              </div>
              <p><Localized id="setup-mode-local-desc">Keep this terminal completely offline. No account, no cloud sync — a free starter workspace is created on the device.</Localized></p>
            </button>
          </div>
        </section>

        {/* Step 2: Account Linking (Shown only for Mode 2: Linked) */}
        {provisionMode === 'linked' && (
          <section className="provisioning-account-box" aria-labelledby="provision-account-heading">
            <h2 id="provision-account-heading" style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-weight-medium)', margin: 0 }}>
              <Localized id="setup-provision-account-section">kasir.mu Account</Localized>
            </h2>
            <p className="provisioning-account-hint">
              <Localized id="setup-provision-account-hint">
                Connect your device to your free account to enable automatic sync and license protection.
              </Localized>
            </p>

            {isOffline && (
              <div className="provisioning-status-warn" role="alert">
                <Localized id="setup-provision-offline-warn">
                  Internet connection is required to create or link your account.
                </Localized>
              </div>
            )}

            {isLinked ? (
              <div className="provisioning-account-linked" role="status">
                <span aria-hidden="true">✓</span>
                <span>
                  <Localized id="setup-account-linked" vars={{ email: linkedAccount?.email ?? '' }}>
                    {'Linked to { $email }.'}
                  </Localized>
                </span>
              </div>
            ) : isTabletShell() ? (
              <div className="provisioning-tablet-link-container">
                <div className="provisioning-subtabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tabletTab === 'pair'}
                    className={`provisioning-subtab ${tabletTab === 'pair' ? 'active' : ''}`}
                    onClick={() => {
                      setTabletTab('pair');
                      if (!pairingSession) void loadPairingSession();
                    }}
                  >
                    <Localized id="setup-tab-pair">QR Pairing</Localized>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tabletTab === 'email'}
                    className={`provisioning-subtab ${tabletTab === 'email' ? 'active' : ''}`}
                    onClick={() => setTabletTab('email')}
                  >
                    <Localized id="setup-tab-email">Email Code</Localized>
                  </button>
                </div>

                {tabletTab === 'pair' ? (
                  <div className="provisioning-pairing-view">
                    {pairingError && (
                      <div className="provisioning-error" role="alert">
                        <p style={{ margin: 0 }}>{pairingError}</p>
                        {/* Without this the tab DEAD-ENDS: the auto-start effect
                            above is gated on `!pairingError`, so a single transient
                            failure never retries, and the only way back was
                            re-clicking the QR Pairing tab that already looks
                            selected. The expired branch already offers Refresh;
                            a failure deserves the same escape. */}
                        <Button variant="secondary" type="button" onClick={() => void loadPairingSession()}>
                          <Localized id="auth-pair-refresh">Refresh Code</Localized>
                        </Button>
                      </div>
                    )}
                    {pairingLoading ? (
                      <div className="provisioning-note" role="status">
                        <Localized id="auth-activating">Loading...</Localized>
                      </div>
                    ) : pairingExpired ? (
                      <div className="provisioning-note" role="alert">
                        <p><Localized id="auth-pair-expired">Pairing code expired.</Localized></p>
                        <Button variant="secondary" type="button" onClick={() => void loadPairingSession()}>
                          <Localized id="auth-pair-refresh">Refresh Code</Localized>
                        </Button>
                      </div>
                    ) : pairingSession ? (
                      <div className="provisioning-pairing-box">
                        <p className="provisioning-note">
                          <Localized id="auth-pair-scan-qr" vars={{ url: pairingSession.qr_url }}>
                            <span>Scan this QR code with your phone or visit {pairingSession.qr_url}</span>
                          </Localized>
                        </p>
                        <div className="provisioning-qr-wrapper" data-testid="pairing-qr-wrapper">
                          <QRCodeSVG
                            value={pairingSession.qr_url}
                            size={160}
                            level="M"
                            bgColor="#ffffff"
                            fgColor="#111827"
                          />
                        </div>
                        <div className="provisioning-code-badge" data-testid="pairing-code-badge">
                          {formatCrockford(pairingSession.code)}
                        </div>
                        <p className="provisioning-pulse-status" role="status">
                          <span className="provisioning-pulse-dot" aria-hidden="true" />
                          <Localized id="auth-pair-waiting">Waiting for you to claim on your phone…</Localized>
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="provisioning-account-input-group">
                    <p className="provisioning-note">
                      <Localized id="setup-account-tablet">
                        Use the code sent to your account email to link this device.
                      </Localized>
                    </p>
                    <div className="provisioning-account-input-row">
                      <input
                        type="email"
                        placeholder={l10n.getString('setup-account-email')}
                        value={email}
                        disabled={linkingBusy || emailState === 'verified' || isOffline}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (emailState === 'failed' || emailState === 'sent') setEmailState('idle');
                        }}
                        autoComplete="email"
                      />
                      <Button
                        variant="primary"
                        type="button"
                        onClick={() => void sendCode()}
                        disabled={linkingBusy || email.trim() === '' || emailState === 'verified' || isOffline}
                      >
                        <Localized id="setup-account-send">Email me a code</Localized>
                      </Button>
                    </div>

                    {(emailState === 'sent' || (emailState === 'failed' && codeSent)) && (
                      <div className="provisioning-account-input-row" style={{ marginTop: 'var(--space-2)' }}>
                        <input
                          inputMode="numeric"
                          placeholder={l10n.getString('setup-account-code')}
                          value={code}
                          disabled={linkingBusy || isOffline}
                          onChange={(e) => {
                            setCode(e.target.value);
                            if (emailState === 'failed') setEmailState('sent');
                          }}
                          autoComplete="one-time-code"
                        />
                        <Button
                          variant="primary"
                          type="button"
                          onClick={() => void verifyCode()}
                          disabled={linkingBusy || code.trim() === '' || isOffline}
                        >
                          <Localized id="setup-account-verify">Verify</Localized>
                        </Button>
                      </div>
                    )}

                    {emailState === 'sending' && (
                      <p className="provisioning-note" role="status">
                        <Localized id="setup-account-sending">Sending the code…</Localized>
                      </p>
                    )}
                    {emailState === 'verifying' && (
                      <p className="provisioning-note" role="status">
                        <Localized id="setup-account-verifying">Checking the code…</Localized>
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="provisioning-account-input-group">
                <Button
                  variant="primary"
                  type="button"
                  onClick={() => void linkWithGoogle()}
                  disabled={link.kind === 'linking' || isOffline}
                >
                  <Localized id="setup-account-google">Continue with Google</Localized>
                </Button>
                {link.kind === 'linking' && (
                  <p className="provisioning-note" role="status">
                    <Localized id="setup-account-waiting">Waiting for your browser…</Localized>
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        <fieldset className="provisioning-fieldset">
          <legend>
            <Localized id="setup-provision-store-type">
              <span>What kind of shop is this?</span>
            </Localized>
          </legend>
          <div className="provisioning-store-types">
            {STORE_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`provisioning-store-type${storeType === t.value ? ' is-selected' : ''}`}
                aria-pressed={storeType === t.value}
                data-testid={"store-type-" + t.value}
                onClick={() => setStoreType(t.value)}
              >
                <span aria-hidden="true">{t.emoji}</span>
                <Localized id={t.labelId}>
                  <strong>{STORE_TYPE_FALLBACK[t.value]!.label}</strong>
                </Localized>
                <Localized id={t.blurbId}>
                  <small>{STORE_TYPE_FALLBACK[t.value]!.blurb}</small>
                </Localized>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="provisioning-field">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- text via Localized span */}
          <label htmlFor="provision-location-name">
            <Localized id="setup-provision-location-label">
              <span>Shop name</span>
            </Localized>
          </label>
          <input
            id="provision-location-name"
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            autoComplete="organization"
          />
        </div>

        <div className="provisioning-field">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- text via Localized span */}
          <label htmlFor="provision-owner-name">
            <Localized id="setup-provision-owner-name-label">
              <span>Your name</span>
            </Localized>
          </label>
          <input
            id="provision-owner-name"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            autoComplete="name"
          />
        </div>

        <div className="provisioning-field">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- text via Localized span */}
          <label htmlFor="provision-owner-username">
            <Localized id="setup-provision-owner-username-label">
              <span>Login name</span>
            </Localized>
          </label>
          <input
            id="provision-owner-username"
            value={ownerUsername}
            onChange={(e) => setOwnerUsername(e.target.value)}
            autoComplete="username"
          />
        </div>

        <div className="provisioning-field">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- text via Localized span */}
          <label htmlFor="provision-pin">
            <Localized id="setup-provision-pin-label">
              <span>PIN (at least 4 digits)</span>
            </Localized>
          </label>
          <input
            id="provision-pin"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            autoComplete="new-password"
          />
        </div>

        <div className="provisioning-field">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- text via Localized span */}
          <label htmlFor="provision-pin-confirm">
            <Localized id="setup-provision-pin-confirm-label">
              <span>Confirm PIN</span>
            </Localized>
          </label>
          <input
            id="provision-pin-confirm"
            type="password"
            inputMode="numeric"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            autoComplete="new-password"
            aria-invalid={pinError ? true : undefined}
            aria-describedby={pinError ? 'provision-pin-error' : undefined}
          />
          {pinError && (
            /* role="status" rather than "alert": the message follows the user's
               own keystrokes, so it is announced politely rather than
               interrupting what they are still typing. */
            <p className="provisioning-field-error" id="provision-pin-error" role="status">
              {pinError}
            </p>
          )}
        </div>

        <Button size="lg" type="submit" disabled={!canSubmit || busy} data-testid="provision-submit">
          <Localized id="setup-provision-submit">
            <span>Finish setup</span>
          </Localized>
        </Button>
      </form>
    </div>
  );
}