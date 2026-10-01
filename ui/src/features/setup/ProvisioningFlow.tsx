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

/**
 * The emailed-code path's state for tablet.
 *
 * `sendFailed` and `verifyFailed` are separate members on purpose. They used to
 * be one `failed`, which is why a rejected code and an unreachable mail server
 * offered the merchant the same sentence. They are different problems with
 * different fixes, and the copy has to name the right one.
 */
type EmailState =
  | 'idle'
  | 'sending'
  | 'sent'
  | 'verifying'
  | 'verified'
  | 'sendFailed'
  | 'verifyFailed';

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

/**
 * The currency and timezone this terminal is provisioned with.
 *
 * These were hardcoded literals inside `provisionDevice({...})` — `'IDR'` and
 * `'Asia/Jakarta'` — so a merchant in any other country had them silently
 * chosen for them with nothing on screen saying so, and no way to see what
 * their register was set to before they opened it. They are NOT editable here
 * (that is a settings concern, not a first-run one), but they must be visible:
 * a value the terminal will use should be disclosed, not merely sent.
 *
 * One constant, read by both the payload and the disclosure below, because a
 * disclosure that quotes a DIFFERENT constant than the submit sends is worse
 * than no disclosure at all.
 */
const PROVISION_CURRENCY = 'IDR';
const PROVISION_TIMEZONE = 'Asia/Jakarta';

/**
 * One unmet requirement of the submit gate, and the control to focus for it.
 *
 * `labelId` is a Fluent id rather than a string: the explainer sits directly
 * above the submit button on the first screen a merchant ever sees, so it has to
 * translate like every other string on this card. `focusId` is the DOM id of the
 * control that must change — the card runs well past the viewport on the terminal
 * this ships to, so naming the problem is not enough unless the merchant is also
 * moved to it.
 */
interface SubmitBlocker {
  /** Stable key, also used as the rendered list item key. */
  id: string;
  labelId: string;
  /** What a missing bundle key would leave on screen — readable copy, never an id. */
  fallback: string;
  focusId: string;
}

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

/**
 * The three steps the progress rail names, in the order the form presents them.
 *
 * `fallback` matches the en bundle word for word: <Localized> swaps in the
 * bundle's string when the id resolves, so this is only what a missing key would
 * leave on screen — readable copy, never a raw id.
 */
const STEPS: { id: string; labelId: string; fallback: string }[] = [
  { id: 'account', labelId: 'setup-provision-step-account', fallback: 'Account' },
  { id: 'store', labelId: 'setup-provision-step-store', fallback: 'Shop' },
  { id: 'owner', labelId: 'setup-provision-step-owner', fallback: 'Owner' },
];

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
  /**
   * A failure from the submit itself, rendered BESIDE the submit button rather
   * than in the banner at the top of the card.
   *
   * Measured on the desktop POS viewport (1366x768, ui/e2e/playwright.config.ts):
   * the card is 1460px, so reaching the button means scrolling ~250px down. A
   * failed submit then rendered its message at the top of the card, at
   * `errTop: -87` — 87px ABOVE the viewport. The merchant clicked "Finish setup",
   * it failed, and the screen showed nothing at all. The message has to appear
   * where the user is looking, which is the button they just pressed.
   */
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  // Tablet pairing state.
  //
  // 'email' is the DEFAULT, not 'pair'. QR pairing asks the merchant to have a
  // phone with the kasir.mu account ALREADY signed in, hold it over the terminal,
  // and scan — a three-part precondition on the very first screen of setup, and
  // the one a merchant setting up a single terminal alone simply cannot meet.
  // The emailed code needs one thing (the account address) and works on any
  // device. Both routes stay one tap apart, so QR is still reachable for the
  // merchant who has a second device on the counter.
  const [tabletTab, setTabletTab] = useState<'pair' | 'email'>('email');
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
          // Mint the replacement IMMEDIATELY rather than waiting for a press.
          //
          // The expiry message used to be the only signal: the QR the merchant
          // had already photographed or scanned was dead, and the merchant was
          // told so 15 minutes after they walked away from the screen — they
          // come back, find "Pairing code expired", and have to find and press
          // "Refresh Code". Nothing at all appeared until the next 3s tick, so
          // the very first reaction (scan the code again, because it used to
          // work) failed for reasons nobody could see.
          //
          // A fresh session replaces the dead one in place: the view re-renders
          // with a new QR and a new code badge, and the merchant's next scan
          // works. If the refresh itself fails, `loadPairingSession` sets
          // `pairingError` and the error branch offers "Refresh Code" by hand —
          // so the automatic path never removes the manual escape.
          void loadPairingSession();
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
  }, [provisionMode, tabletTab, pairingSession, pairingExpired, linkedAccount, addToast, l10n, loadPairingSession]);

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
      // No `setErrorMsg` here: the failure is rendered inline, beside the
      // control that caused it, by the `link.kind === 'failed'` branch below.
      // Setting both drew the same sentence twice on one screen — once in the
      // form-wide banner at the top, once next to the button.
      setLink({ kind: 'failed' });
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
      // No `setErrorMsg`: the message belongs beside the field that produced it,
      // which is where the sendFailed branch below puts it.
      setEmailState('sendFailed');
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
      setEmailState('verifyFailed');
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

  // ── Naming the submit gate ─────────────────────────────────────────
  //
  // A `disabled` button cannot be pressed, so every unmet clause of `canSubmit`
  // above was a dead control with no stated reason: the merchant saw "Finish
  // setup" greyed out and had to guess which of the seven requirements was
  // still owed — and two of them (store type, PIN length) are not even fields
  // they are looking at. The PIN mismatch was already called out inline; nothing
  // else was.
  //
  // These blockers are DERIVED from the same values as `canSubmit` rather than
  // kept in a parallel list, so the explainer cannot drift from the gate the way
  // a second state machine would. Each carries the id of the control to focus,
  // because on a card that measures ~900-1460px against a 768px viewport the
  // missing field is usually off-screen: naming the problem is not enough if
  // the merchant is not looking at the thing that must change.
  const submitBlockers: SubmitBlocker[] = [
    ...(provisionMode === 'linked' && !isLinked
      ? [{ id: 'account', labelId: 'setup-provision-gate-account', fallback: 'Link an account, or pick "Offline only"', focusId: 'provision-account-box' }]
      : []),
    ...(storeType === null
      ? [{ id: 'store-type', labelId: 'setup-provision-gate-store-type', fallback: 'Choose the kind of shop', focusId: STORE_TYPES[0] ? `provision-store-type-${STORE_TYPES[0].value}` : '' }]
      : []),
    ...(locationName.trim() === ''
      ? [{ id: 'location', labelId: 'setup-provision-gate-location', fallback: 'Shop name', focusId: 'provision-location-name' }]
      : []),
    ...(ownerName.trim() === ''
      ? [{ id: 'owner-name', labelId: 'setup-provision-gate-owner-name', fallback: 'Your name', focusId: 'provision-owner-name' }]
      : []),
    ...(ownerUsername.trim() === ''
      ? [{ id: 'username', labelId: 'setup-provision-gate-username', fallback: 'Login name', focusId: 'provision-owner-username' }]
      : []),
    ...(pin.length < 4
      ? [{ id: 'pin', labelId: 'setup-provision-gate-pin', fallback: 'A PIN of at least 4 digits', focusId: 'provision-pin' }]
      : []),
    ...(pin.length >= 4 && pin !== confirmPin
      ? [{ id: 'pin-match', labelId: 'setup-provision-gate-pin-match', fallback: 'Both PINs the same', focusId: 'provision-pin-confirm' }]
      : []),
  ];

  /**
   * Move the merchant to the control that must change.
   *
   * `scrollIntoView` is feature-detected rather than called straight: jsdom does
   * not implement it, and a focus helper that throws where it is not supported
   * would take the test environment (and any embedded webview without it) down
   * with it. `focus()` is what actually matters for a keyboard or screen-reader
   * user — the scroll only decides whether they can see where they landed.
   */
  const focusField = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center' });
    }
    el.focus();
  }, []);

  // ── Progress rail ──────────────────────────────────────────────────
  //
  // The three steps ARE the three groups the form already gates submission on,
  // derived from the same values as `canSubmit` rather than from a second state
  // machine that could disagree with it. Measured on a 1366px tablet: the card
  // is 1423px tall, so the submit button and the last two fields start BELOW the
  // fold. Without a rail the merchant sees a long form with no idea how much is
  // left, and no signal that anything is still required off-screen.
  //
  // Step 1 has no field of its own — it is the mode choice — and on the default
  // 'linked' mode it completes only once an account is actually linked. That is
  // deliberate: the step is "is this terminal attached to an account", which the
  // mode alone does not answer.
  const stepAccountDone = provisionMode === 'local' || isLinked;
  const stepStoreDone = storeType !== null;
  const stepOwnerDone =
    locationName.trim() !== '' &&
    ownerName.trim() !== '' &&
    ownerUsername.trim() !== '' &&
    pin.length >= 4 &&
    pin === confirmPin;
  const stepDone = [stepAccountDone, stepStoreDone, stepOwnerDone];
  const currentStep = stepDone.indexOf(false);

  // ── Progressive disclosure ─────────────────────────────────────────
  //
  // The rail above TELLS the merchant where they are; these flags let the card show
  // only that much. Measured on the desktop POS viewport (1366x768, the terminal this
  // flow actually ships to once a build is packaged — the dev bypass is
  // `import.meta.env.DEV` only): on first paint only the mode box was FULLY visible.
  // The store type, the shop name and the submit button were all below the fold, so a
  // fresh merchant saw a set of choices and no way to tell a form followed them.
  //
  // Sections after the current step are collapsed rather than unmounted: unmounting
  // would drop half-typed values when a merchant moves back to change their answer,
  // and `canSubmit` reads every field regardless of visibility. Collapsing keeps the
  // form's state identical while removing the height.
  //
  // `currentStep === -1` means every step is done — then everything is open, so the
  // merchant can review and press the button.
  //
  // ONLY the owner step (3) collapses. The store-type choice stays visible even while
  // step 1 is open, deliberately: hiding it would mean a merchant cannot see what the
  // form is about to ask them, and the store type is a DECISION rather than detail —
  // measuring the tradeoff, the merchant should be able to see the whole shape of the
  // choice even when they cannot yet act on all of it.
  //
  // `currentStep === -1` means every step is done — then it opens, so the merchant can
  // review their answers and press the button. One-way: once open it stays open, so a
  // correction to an earlier answer never hides the section being corrected.
  const ownerStepOpen = currentStep === -1 || currentStep >= 2;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMsg(null);
      setSubmitError(null);
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
          currency: PROVISION_CURRENCY,
          timezone: PROVISION_TIMEZONE,
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
        // Beside the button, not in the top banner — see `submitError` above.
        setSubmitError(l10nErrorMessage(err, l10n, 'setup-provision-error'));
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
          {/* Progress rail. `aria-current="step"` on the active one is what makes
              it a position rather than a decoration for a screen reader; the
              "Step N of 3" text is the same fact without relying on colour,
              which the three dots alone would. Completed steps carry a check,
              so the state is not conveyed by fill colour only. */}
          <nav className="provisioning-steps" aria-label={l10n.getString('setup-provision-step-progress', { current: '1', total: String(stepDone.length) })}>
            <ol className="provisioning-step-list" data-testid="provisioning-step-rail">
              {STEPS.map((step, i) => {
                const done = stepDone[i];
                const isCurrent = currentStep === i;
                return (
                  <li
                    key={step.id}
                    className={`provisioning-step${done ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
                    aria-current={isCurrent ? 'step' : undefined}
                  >
                    <span className="provisioning-step-marker" aria-hidden="true">
                      {done ? '✓' : i + 1}
                    </span>
                    <Localized id={step.labelId}>
                      <span className="provisioning-step-label">{step.fallback}</span>
                    </Localized>
                  </li>
                );
              })}
            </ol>
            <p className="provisioning-step-progress">
              <Localized
                id="setup-provision-step-progress"
                vars={{ current: String(currentStep === -1 ? stepDone.length : currentStep + 1), total: String(stepDone.length) }}
              >
                {'Step { $current } of { $total }'}
              </Localized>
            </p>
          </nav>
          <Localized id="setup-provision-title">
            <h1>Set up this terminal</h1>
          </Localized>
          {/* No subtitle. It used to restate whichever mode was selected — while
              the card directly below was headed "Link your kasir.mu account",
              and the offline one said "No account needed" above a card reading
              "Keep this terminal completely offline". The card carries the copy
              with more specificity in both modes, so the subtitle was a repeat of
              one idea on a card measuring 1478px against a 1366px viewport. */}
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
          <section className="provisioning-account-box" aria-labelledby="provision-account-heading" id="provision-account-box">
            <h2 id="provision-account-heading" style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-weight-medium)', margin: 0 }}>
              <Localized id="setup-provision-account-section">kasir.mu Account</Localized>
            </h2>
            <p className="provisioning-account-hint">
              <Localized id="setup-provision-account-hint">
                Connect your device to your free account to enable automatic sync and license protection.
              </Localized>
            </p>
            {/* The QR route's precondition, stated before the merchant hits
                it. "Scan this QR code with your phone" reads as universal;
                it is not — it needs a phone already signed in to the account,
                which a merchant setting up one terminal alone does not have.
                QR stays available; this says what it costs before the tap.

                Its OWN paragraph rather than a second sentence in the one above,
                because the message has to be plain FTL text: a value that is
                only a placeable is dropped by the parser, so the id resolves to
                nothing at runtime and the merchant reads the component's English
                fallback on every device. Caught on hardware 2026-10-01 — the key
                was in both bundles and in the built asset, and the only symptom
                was one console warning. */}
            <p className="provisioning-account-hint">
              <Localized id="setup-account-pair-requirement">
                <span>QR pairing needs a second phone signed in to your account.</span>
              </Localized>
            </p>

            {/* Offline, on the linked path. The warning alone was a DEAD END
                in effect: it said the account cannot be created or linked right
                now, and every control that could change that was disabled —
                Google, both tablet routes, the send and verify buttons. What
                offline cannot do is block SETUP (`provision_device` is local
                SQLite; see the module doc above), and the local mode below is a
                one-click route to it. So the warning carries the way out, rather
                than only the reason the way in is shut. */}
            {isOffline && (
              <div className="provisioning-status-warn" role="alert" data-testid="provision-offline-switch">
                <p className="provisioning-status-warn-text">
                  <Localized id="setup-provision-offline-warn">
                    Internet connection is required to create or link your account.
                  </Localized>
                </p>
                {provisionMode === 'linked' && (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setProvisionMode('local')}
                    data-testid="provision-offline-use-local"
                  >
                    <Localized id="setup-provision-offline-switch-local">
                      Set up without an account instead
                    </Localized>
                  </Button>
                )}
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
                  {/* The third tab here was "Setup Wizard", which set
                      #/mobile-setup and handed the merchant to a second wizard
                      (MobileWelcomeFlow -> MobileSetupHub). That one made no
                      backend calls at all: it called onProvisioned the moment a
                      Google account was "selected" or an email "submitted", so
                      on a real tablet the shell marked hasCompletedSetup with no
                      store, no owner and no PIN. It was retired with the rest of
                      features/setup/mobile -- this flow IS the setup wizard, on
                      every surface. */}
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
                    {/* Both fields here are labelled by a real <label>, not by a
                        bare `placeholder`. A placeholder is not an accessible name — a
                        screen reader announced two unlabelled text boxes — and it
                        is a false one besides: the browser clears it the moment the
                        user types, leaving nothing to say what the field was for. */}
                    <div className="provisioning-account-input-row">
                      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- text via Localized span */}
                      <label htmlFor="provision-account-email" className="sr-only">
                        <Localized id="setup-account-email-label">
                          <span>Account email</span>
                        </Localized>
                      </label>
                      <input
                        id="provision-account-email"
                        type="email"
                        placeholder={l10n.getString('setup-account-email')}
                        value={email}
                        disabled={linkingBusy || emailState === 'verified' || isOffline}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (emailState === 'sendFailed' || emailState === 'verifyFailed' || emailState === 'sent') setEmailState('idle');
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

                    {(emailState === 'sent' || ((emailState === 'verifyFailed') && codeSent)) && (
                      <div className="provisioning-account-input-row" style={{ marginTop: 'var(--space-2)' }}>
                        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- text via Localized span */}
                        <label htmlFor="provision-account-code" className="sr-only">
                          <Localized id="setup-account-code-label">
                            <span>Verification code</span>
                          </Localized>
                        </label>
                        <input
                          id="provision-account-code"
                          inputMode="numeric"
                          placeholder={l10n.getString('setup-account-code')}
                          value={code}
                          disabled={linkingBusy || isOffline}
                          onChange={(e) => {
                            setCode(e.target.value);
                            if (emailState === 'verifyFailed') setEmailState('sent');
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
                    {/* The failures render HERE, under the fields they belong to.
                        They used to set the form-wide banner at the top of the
                        card, two sections away from the input that failed, and
                        both cases shared one sentence — so a rejected code and an
                        unreachable mail server read identically. role="alert"
                        because these follow a submit the user is waiting on, not
                        live keystrokes. */}
                    {emailState === 'sendFailed' && (
                      <p className="provisioning-field-error" role="alert">
                        <Localized id="setup-account-send-failed">
                          Could not send the code. Check the address and try again.
                        </Localized>
                      </p>
                    )}
                    {emailState === 'verifyFailed' && (
                      <p className="provisioning-field-error" role="alert">
                        <Localized id="setup-account-verify-failed">
                          That code did not work. Check it and try again, or resend.
                        </Localized>
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
                {/* `link.kind === 'failed'` was written by linkWithGoogle and read
                    nowhere: the union member existed, the catch set it, and the
                    screen drew the same idle control as the first paint. The only
                    signal was the generic banner at the top of the form, so a
                    merchant whose Google window was closed early saw a button that
                    looked untouched and no reason it had not worked. Same escape as
                    the pairing branch above: say what happened, next to the control
                    that did it, and offer the retry. */}
                {link.kind === 'failed' && (
                  <div className="provisioning-error" role="alert">
                    <p style={{ margin: 0 }}>
                      <Localized id="setup-account-failed">
                        Could not link this device. You can try again, or continue without linking.
                      </Localized>
                    </p>
                    <Button variant="secondary" type="button" onClick={() => void linkWithGoogle()}>
                      <Localized id="setup-account-retry">Try again</Localized>
                    </Button>
                  </div>
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
                id={`provision-store-type-${t.value}`}
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

        {ownerStepOpen && (
        <>
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
        </>
        )}

        {/* Above the button, in the same gap the user is already looking at.
            `role="alert"` because this follows a submit they are waiting on. */}
        {submitError && (
          <div className="provisioning-error" role="alert" data-testid="provision-submit-error">
            {submitError}
          </div>
        )}

        {/* The submit gate, named. `role="status"` rather than "alert": this
            REFLECTS the merchant's own progress and updates on every keystroke,
            so it must be announced politely — an interrupting alert on each
            character would talk over what they are typing. It sits beside the
            button it explains, which is the one control on this card they are
            guaranteed to be looking at. */}
        {submitBlockers.length > 0 && (
          <div className="provisioning-submit-blockers" role="status" data-testid="provision-submit-blockers">
            <Localized id="setup-provision-gate-heading">
              <p className="provisioning-submit-blockers-heading">
                Still needed before you can finish setup:
              </p>
            </Localized>
            <ul className="provisioning-submit-blockers-list">
              {submitBlockers.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className="provisioning-submit-blocker-link"
                    onClick={() => focusField(b.focusId)}
                  >
                    <Localized id={b.labelId}>
                      <span>{b.fallback}</span>
                    </Localized>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button size="lg" type="submit" disabled={!canSubmit || busy} data-testid="provision-submit">
          <Localized id="setup-provision-submit">
            <span>Finish setup</span>
          </Localized>
        </Button>

        {/* The locale the terminal is being provisioned WITH, stated before the
            submit rather than discovered afterwards. `provisionDevice` has
            always sent currency and timezone; until now the merchant was told
            neither. Not an input — a disclosure, because a wrong guess found out
            after the first sale is a merchant's problem to undo. */}
        <p className="provisioning-locale-note" data-testid="provisioning-locale-note">
          <Localized id="setup-provision-locale-note" vars={{ currency: PROVISION_CURRENCY, timezone: PROVISION_TIMEZONE }}>
            {'Set up in { $currency } ({ $timezone }). You can change this later in Settings.'}
          </Localized>
        </p>

        {/* Version and IP, matching every other setup and auth surface
            (StaffLoginScreen, LicenseActivationScreen). The footer was already
            invented and agreed on; this flow is the one screen that omitted it,
            so a merchant told their terminal's version on the next screen read a
            different one here. Not localized: it is a version string and a legal
            line, and every sibling surface renders it identically. */}
        <p className="provisioning-footer" data-testid="provisioning-footer">
          v0.0.40 • kasir.mu © 2026 All rights reserved.
        </p>
      </form>
    </div>
  );
}