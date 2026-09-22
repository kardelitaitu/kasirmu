import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { bootstrapOwner } from '@/api/staff';
import { useAuth } from '@/contexts/AuthContext';
import { Localized, useLocalization } from '@fluent/react';
import { l10nErrorMessage } from '@/utils/app-error';
import './CreatePinScreen.css';

/** Props for the CreatePinScreen component. */
export interface CreatePinScreenProps {
  /** Callback invoked after the first owner is created and auto-logged in. */
  onCreated: () => void;
}

/** Create owner PIN screen — bootstraps the first owner account on a fresh installation. */
export default function CreatePinScreen({ onCreated }: CreatePinScreenProps) {
  const { l10n } = useLocalization();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  // The message alone could not mark WHICH input failed, so a rejected submit
  // left every field looking identical — and "All fields are required" named
  // none of them. Tracking the offending field(s) beside the copy lets each
  // bad input carry its own aria-invalid, so the error lands on the control
  // the user has to fix rather than only on a banner above the form.
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [badFields, setBadFields] = useState<ReadonlySet<string>>(() => new Set());
  const { addToast } = useToast();
  const { swapSession } = useAuth();

  /**
   * Drop a field's invalid mark as soon as the user edits it.
   *
   * Without this the mark outlives the failure: a user who fixes the PIN would
   * still be told it is wrong, because nothing re-ran validation.
   */
  const clearBadField = (field: string) =>
    setBadFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBadFields(new Set());

    if (!displayName.trim() || !username.trim() || !pin.trim()) {
      // Name the empty ones, so "All fields are required" is actionable: the
      // blanket copy is kept (it is the translated message) but every offending
      // input carries the mark.
      const empty = new Set<string>();
      if (!displayName.trim()) empty.add('displayName');
      if (!username.trim()) empty.add('username');
      if (!pin.trim()) empty.add('pin');
      setBadFields(empty);
      setErrorMsg(l10n.getString('auth-create-pin-error-fields'));
      return;
    }
    // Strip non-digits from PIN fields — paste may inject letters.
    const digitsOnly = (s: string) => s.replace(/\D/g, '').slice(0, 8);
    const cleanPin = digitsOnly(pin);
    const cleanConfirm = digitsOnly(confirmPin);
    if (cleanPin !== pin || cleanConfirm !== confirmPin) {
      setPin(cleanPin);
      setConfirmPin(cleanConfirm);
      return; // re-render with cleaned values; user sees digits-only
    }
    if (cleanPin.length < 4) {
      setBadFields(new Set(['pin']));
      setErrorMsg(l10n.getString('auth-create-pin-error-pin-length'));
      return;
    }
    if (pin !== confirmPin) {
      // Both fields, because either could be the typo. Marking only the confirm
      // field would assert a fact the screen does not have.
      setBadFields(new Set(['pin', 'confirmPin']));
      setErrorMsg(l10n.getString('auth-create-pin-error-pin-mismatch'));
      return;
    }

    setLoading(true);
    try {
      const result = await bootstrapOwner({
        username: username.trim(),
        pin,
        display_name: displayName.trim(),
      });
      swapSession(result.session, result.picker_ticket);
      addToast({ type: 'success', message: l10n.getString('auth-create-pin-success') });
      onCreated();
      } catch (err: unknown) {
        // The "already exists" redirect needs the raw backend text; everything
        // displayed goes through the localized user-safe mapper.
        const rawMessage =
          typeof err === 'string'
            ? err
            : err instanceof Error
              ? err.message
              : err && typeof err === 'object' && 'message' in err
                ? String((err as Record<string, unknown>)['message'])
                : '';
        // Users already exist — someone else set up already, go to login.
        if (rawMessage.toLowerCase().includes('already exist')) {
          onCreated();
          return;
        }
        setErrorMsg(l10nErrorMessage(err, l10n, 'auth-create-pin-error-generic'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="create-pin-container">
      <div className="create-pin-card">
        <div className="create-pin-header">
          <Localized id="auth-create-pin-title">
            <h1>Create Owner PIN</h1>
          </Localized>
          <Localized id="auth-create-pin-desc">
            <p>Set up the first owner account to manage your POS</p>
          </Localized>
        </div>

        {errorMsg && (
          <div className="create-pin-error-banner" role="alert">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="create-pin-form-group">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- text via Localized span */}
            <label htmlFor="displayName">
              <Localized id="auth-create-pin-display-name-label">
                <span>Display Name</span>
              </Localized>
            </label>
            <Localized id="auth-create-pin-display-name-placeholder" attrs={{ placeholder: true }}>
              <input
                id="displayName"
                type="text"
                className="create-pin-input"
                aria-invalid={badFields.has('displayName') || undefined}

                placeholder="Store Owner"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  clearBadField('displayName');
                }}
                disabled={loading}
              />
            </Localized>
          </div>

          <div className="create-pin-form-group">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- text via Localized span */}
            <label htmlFor="username">
              <Localized id="auth-create-pin-username-label">
                <span>Username</span>
              </Localized>
            </label>
            <Localized id="auth-create-pin-username-placeholder" attrs={{ placeholder: true }}>
              <input
                id="username"
                type="text"
                className="create-pin-input"
                aria-invalid={badFields.has('username') || undefined}

                placeholder="owner"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value.toLowerCase());
                  clearBadField('username');
                }}
                disabled={loading}
                autoComplete="username"
              />
            </Localized>
          </div>

          <div className="create-pin-form-group">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- text via Localized span */}
            <label htmlFor="pin">
              <Localized id="auth-create-pin-pin-label">
                <span>PIN</span>
              </Localized>
            </label>
            <Localized id="auth-create-pin-pin-placeholder" attrs={{ placeholder: true }}>
              <input
                id="pin"
                type="password"
                className="create-pin-input"
                aria-invalid={badFields.has('pin') || undefined}

                placeholder="At least 4 digits"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  clearBadField('pin');
                }}
                disabled={loading}
                autoComplete="new-password"
                inputMode="numeric"
                maxLength={8}
              />
            </Localized>
          </div>

          <div className="create-pin-form-group">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- text via Localized span */}
            <label htmlFor="confirmPin">
              <Localized id="auth-create-pin-confirm-label">
                <span>Confirm PIN</span>
              </Localized>
            </label>
            <Localized id="auth-create-pin-confirm-placeholder" attrs={{ placeholder: true }}>
              <input
                id="confirmPin"
                type="password"
                className="create-pin-input"
                aria-invalid={badFields.has('confirmPin') || undefined}

                placeholder="Re-enter PIN"
                value={confirmPin}
                onChange={(e) => {
                  setConfirmPin(e.target.value);
                  clearBadField('confirmPin');
                }}
                disabled={loading}
                autoComplete="new-password"
                inputMode="numeric"
                maxLength={8}
              />
            </Localized>
          </div>

          <button
            type="submit"
            className="create-pin-submit-btn"
            disabled={loading || !displayName || !username || !pin || !confirmPin}
          >
            {loading ? (
              <>
                <svg className="spinner" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                {l10n.getString('auth-create-pin-creating')}
              </>
            ) : (
              l10n.getString('auth-create-pin-create')
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
