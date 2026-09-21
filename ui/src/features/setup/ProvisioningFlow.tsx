import { useCallback, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { provisionDevice, type LocationKind, type ProvisioningMode } from '@/api/settings';
import { getDeviceId } from '@/api/system';
import {
  consumeDeviceLinkCode,
  linkDeviceGoogle,
  requestDeviceLinkCode,
  type LinkedAccountDto,
} from '@/api/license';
import { isTabletShell } from '@/utils/shellKind';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import { l10nErrorMessage } from '@/utils/app-error';
import type { Preset } from './SetupWizard';
import './ProvisioningFlow.css';

/**
 * First-run provisioning (ADR #56 §2.3 / User Decision Mode 2: linked + Free subscription).
 *
 * Requirements:
 * 1. Requires connecting to an account (Google on desktop, Email OTP on tablet)
 *    to obtain a tenant_id and link the device.
 * 2. Hard blocks first run if offline with a clear connection message.
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

/** The store types offered, with the preset each maps to. */
const STORE_TYPES: { value: Preset; kind: LocationKind; emoji: string; label: string; blurb: string }[] = [
  {
    value: 'simple-retail',
    kind: 'retail',
    emoji: '🛒',
    label: 'Shop',
    blurb: 'Barcode, cash, receipt, inventory, tax',
  },
  {
    value: 'restaurant',
    kind: 'restaurant',
    emoji: '🍽️',
    label: 'Restaurant or cafe',
    blurb: 'Tables, kitchen display, staff login',
  },
];

/** Whether a preset trades as a restaurant (so the kitchen display is created). */
function kindForPreset(preset: Preset): LocationKind {
  return STORE_TYPES.find((t) => t.value === preset)?.kind ?? 'retail';
}

export default function ProvisioningFlow({ onProvisioned }: ProvisioningFlowProps) {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const [storeType, setStoreType] = useState<Preset | null>(null);
  const [locationName, setLocationName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerUsername, setOwnerUsername] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Account linking state
  const [linkedAccount, setLinkedAccount] = useState<LinkedAccountDto | null>(null);
  const [link, setLink] = useState<LinkState>({ kind: 'idle' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailState, setEmailState] = useState<EmailState>('idle');
  const [codeSent, setCodeSent] = useState(false);

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
      };
      setLinkedAccount(linked);
      setEmailState('verified');
    } catch {
      setEmailState('failed');
      setErrorMsg(l10n.getString('setup-account-failed'));
    }
  };

  const isLinked = linkedAccount !== null;

  const canSubmit =
    isLinked &&
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
      if (!isLinked) {
        setErrorMsg(l10n.getString('setup-provision-account-required'));
        return;
      }
      if (!canSubmit || !storeType) return;

      setBusy(true);
      try {
        const terminalId = await getDeviceId();
        const mode: ProvisioningMode = 'linked';
        const result = await provisionDevice({
          terminal_id: terminalId,
          location_name: locationName.trim(),
          currency: 'IDR',
          timezone: 'Asia/Jakarta',
          owner_username: ownerUsername.trim(),
          owner_display_name: ownerName.trim(),
          owner_pin: pin,
          preset: storeType,
          features: [],
          location_kind: kindForPreset(storeType),
          mode,
          tenant_id: linkedAccount?.tenantId ?? null,
          device_credential_id: linkedAccount?.terminal?.terminalId ?? terminalId,
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
          <Localized id="setup-provision-desc">
            <p>Sign in to link your free kasir.mu account, then you can start selling.</p>
          </Localized>
        </header>

        {errorMsg && (
          <div className="provisioning-error" role="alert">
            {errorMsg}
          </div>
        )}

        {/* Step 1: Link Account (Required: User Decision Mode 2) */}
        <section className="provisioning-account-box" aria-labelledby="provision-account-heading">
          <h2 id="provision-account-heading" className="provisioning-legend" style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-weight-medium)', margin: 0 }}>
            <Localized id="setup-provision-account-section">kasir.mu Account</Localized>
          </h2>
          <p className="provisioning-account-hint">
            <Localized id="setup-provision-account-hint">
              Connect your device to your free account to enable automatic sync and license protection.
            </Localized>
          </p>

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
                  disabled={linkingBusy || emailState === 'verified'}
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
                  disabled={linkingBusy || email.trim() === '' || emailState === 'verified'}
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
                    disabled={linkingBusy}
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
                    disabled={linkingBusy || code.trim() === ''}
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
          ) : (
            <div className="provisioning-account-input-group">
              <Button
                variant="primary"
                type="button"
                onClick={() => void linkWithGoogle()}
                disabled={link.kind === 'linking'}
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

          {!isLinked && (
            <p className="provisioning-status-warn">
              <Localized id="setup-provision-offline-warn">
                Internet connection is required to create or link your account.
              </Localized>
            </p>
          )}
        </section>

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
                <strong>{t.label}</strong>
                <small>{t.blurb}</small>
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
          />
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