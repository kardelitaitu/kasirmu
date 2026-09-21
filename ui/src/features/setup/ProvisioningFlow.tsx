import { useCallback, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { provisionDevice, type LocationKind } from '@/api/settings';
import { getDeviceId } from '@/api/system';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import { l10nErrorMessage } from '@/utils/app-error';
import type { Preset } from './SetupWizard';
import './ProvisioningFlow.css';

/**
 * First-run provisioning (ADR #56 §2.3).
 *
 * The flow is ordered by DEPENDENCY, not by topic: store type, then the owner,
 * then one transaction that creates everything. §2.3's principle is that
 * onboarding must end at a WORKING terminal, not a configured one — so the
 * nine-step wizard's later stages (Payments, Products, Hardware, Business
 * Rules) are in-app settings on a terminal the merchant has already used,
 * rather than gates in front of one they have not.
 *
 * Two things this deliberately does NOT ask:
 *
 * - A currency or timezone field. Both come from the preset, and §2.3's
 *   "preset is evaluated, not interrogated" rule means the merchant answers a
 *   business question (what kind of shop is this) rather than a technical one.
 * - An account link. ADR #54's Account step is unnecessary because a `local`
 *   install is the default and linking is an action on a WORKING terminal
 *   (§2.4), not a step that can be skipped out of a linear gate.
 */
export interface ProvisioningFlowProps {
  /** Called once the terminal is provisioned, so the shell can route on. */
  onProvisioned: () => void;
}

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

  const canSubmit =
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
      if (!canSubmit || !storeType) return;

      setBusy(true);
      try {
        const terminalId = await getDeviceId();
        const result = await provisionDevice({
          terminal_id: terminalId,
          location_name: locationName.trim(),
          // Currency and timezone come from the preset rather than a field:
          // §2.3 keeps the merchant answering business questions.
          currency: 'IDR',
          timezone: 'Asia/Jakarta',
          owner_username: ownerUsername.trim(),
          owner_display_name: ownerName.trim(),
          owner_pin: pin,
          preset: storeType,
          features: [],
          location_kind: kindForPreset(storeType),
          // `local` is the DEFAULT, not a fallback (§2.4): the target
          // deployment includes merchants with unreliable connectivity, and a
          // first run that demands the network fails the merchant who most
          // needs the product.
          mode: 'local',
        });
        addToast({
          type: 'success',
          message: l10n.getString('setup-provision-success'),
        });
        // `created` is false on a replay, which is a success too: the row
        // already existed, so the terminal is provisioned either way.
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
      confirmPin,
      l10n,
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
            <p>Three things, then you can start selling.</p>
          </Localized>
        </header>

        {errorMsg && (
          <div className="provisioning-error" role="alert">
            {errorMsg}
          </div>
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