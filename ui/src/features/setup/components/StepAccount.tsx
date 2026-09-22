import { useState } from 'react';
import { Button } from '@/components/Button';
import { Localized } from '@/components/Localized';
import { requiredLocalized } from '@/components';
import { useLocalization } from '@fluent/react';
import {
  consumeDeviceLinkCode,
  linkDeviceGoogle,
  requestDeviceLinkCode,
  type LinkedAccountDto,
} from '@/api/license';
import { isTabletShell } from '@/utils/shellKind';

/** The Google control's state — one value, so no two can disagree. */
type LinkState =
  | { kind: 'idle' }
  | { kind: 'linking' }
  | { kind: 'linked'; account: LinkedAccountDto }
  | { kind: 'failed' };

/** The emailed-code path's state, which has two more steps than the browser one. */
type EmailState = 'idle' | 'sending' | 'sent' | 'verifying' | 'verified' | 'failed';

/**
 * Wizard step: link this device to an account (ADR #54 §2.5-§2.7).
 *
 * Optional by design — the app runs on its licence key alone, so this step never blocks
 * Continue. The two shells get different controls because the decision says so: the desktop
 * opens the system browser (`link_device_google`), while the tablet cannot — Google closes both
 * browser routes on Android — and proves the account with a code emailed to the address it
 * already owns. A prop could re-enable the Google control on tablet, which is exactly what
 * §2.7 excludes, so the split reads the shell flag instead.
 */
export default function StepAccount() {
  const { l10n } = useLocalization();
  const [link, setLink] = useState<LinkState>({ kind: 'idle' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailState, setEmailState] = useState<EmailState>('idle');
  const [linkedEmail, setLinkedEmail] = useState('');
  // A code that was requested but not yet spent: a FAILED VERIFICATION must keep the code field
  // on screen, or "try again" costs the merchant another email and another rate-limit slot.
  const [codeSent, setCodeSent] = useState(false);
  const busy = link.kind === 'linking' || emailState === 'sending' || emailState === 'verifying';

  const linkWithGoogle = async () => {
    setLink({ kind: 'linking' });
    try {
      const account = await linkDeviceGoogle();
      setLink({ kind: 'linked', account });
    } catch {
      // The reason is already logged by `loggedInvoke`; ERR-10 keeps raw IPC error text
      // out of the UI, and a merchant cannot act on a Rust string anyway.
      setLink({ kind: 'failed' });
    }
  };

  const sendCode = async () => {
    setEmailState('sending');
    try {
      await requestDeviceLinkCode(email);
      setCodeSent(true);
      setEmailState('sent');
    } catch {
      setEmailState('failed');
    }
  };

  const verifyCode = async () => {
    setEmailState('verifying');
    try {
      const account = await consumeDeviceLinkCode(code);
      setLinkedEmail(account.email);
      setEmailState('verified');
    } catch {
      setEmailState('failed');
    }
  };

  return (
    <>
      <h2 className="setup-step-title">{requiredLocalized(l10n, 'setup-account-title')}</h2>
      <p className="setup-step-desc">{requiredLocalized(l10n, 'setup-account-desc')}</p>

      {isTabletShell() ? (
        <>
          <p className="setup-step-note">
            <Localized id="setup-account-tablet">
              Use the code sent to your account email to link this device.
            </Localized>
          </p>

          <label className="setup-account-field" htmlFor="setup-account-email">
            <Localized id="setup-account-email">Account email</Localized>
          </label>
          <input
            id="setup-account-email"
            className="setup-account-input"
            type="email"
            autoComplete="email"
            value={email}
            disabled={busy || emailState === 'verified'}
            onChange={(ev) => {
              setEmail(ev.target.value);
              if (emailState === 'failed' || emailState === 'sent') setEmailState('idle');
            }}
          />
          <Button
            variant="primary"
            onClick={() => void sendCode()}
            disabled={busy || email.trim() === '' || emailState === 'verified'}
          >
            <Localized id="setup-account-send">Email me a code</Localized>
          </Button>

          {(emailState === 'sent' || (emailState === 'failed' && codeSent)) && (
            <>
              <p className="setup-step-note" role="status">
                <Localized id="setup-account-sent">Code sent. It expires in 15 minutes.</Localized>
              </p>
              <label className="setup-account-field" htmlFor="setup-account-code">
                <Localized id="setup-account-code">6-digit code</Localized>
              </label>
              <input
                id="setup-account-code"
                className="setup-account-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                disabled={busy}
                onChange={(ev) => {
                  setCode(ev.target.value);
                  if (emailState === 'failed') setEmailState('sent');
                }}
              />
              <Button
                variant="primary"
                onClick={() => void verifyCode()}
                disabled={busy || code.trim() === ''}
              >
                <Localized id="setup-account-verify">Verify</Localized>
              </Button>
            </>
          )}

          {/* The tablet opens no browser: this state is an email being sent, and saying
              "waiting for your browser" here named a step the user does not have. */}
          {emailState === 'sending' && (
            <p className="setup-step-note" role="status">
              <Localized id="setup-account-sending">Sending the code…</Localized>
            </p>
          )}
          {/* Verifying disables the field and the button, so without this the user gets no
              signal at all between the click and the result. */}
          {emailState === 'verifying' && (
            <p className="setup-step-note" role="status">
              <Localized id="setup-account-verifying">Checking the code…</Localized>
            </p>
          )}
          {emailState === 'verified' && (
            <p className="setup-step-note" role="status">
              <Localized id="setup-account-linked" vars={{ email: linkedEmail }}>
                {'Linked to { $email }.'}
              </Localized>
            </p>
          )}
          {emailState === 'failed' && (
            <p className="setup-step-error" role="alert">
              <Localized id="setup-account-failed">
                Could not link this device. You can try again, or continue without linking.
              </Localized>
            </p>
          )}
        </>
      ) : (
        <>
          <Button
            variant="primary"
            onClick={() => void linkWithGoogle()}
            disabled={link.kind === 'linking'}
          >
            <Localized id="setup-account-google">Continue with Google</Localized>
          </Button>

          {link.kind === 'linking' && (
            <p className="setup-step-note" role="status">
              <Localized id="setup-account-waiting">Waiting for your browser…</Localized>
            </p>
          )}
          {link.kind === 'linked' && (
            <p className="setup-step-note" role="status">
              <Localized id="setup-account-linked" vars={{ email: link.account.email }}>
                {'Linked to { $email }.'}
              </Localized>
            </p>
          )}
          {link.kind === 'failed' && (
            <p className="setup-step-error" role="alert">
              <Localized id="setup-account-failed">
                Could not link this device. You can try again, or continue without linking.
              </Localized>
            </p>
          )}
        </>
      )}

      <p className="setup-step-note">
        <Localized id="setup-account-optional">
          You can skip this. Your licence key still runs the POS.
        </Localized>
      </p>
    </>
  );
}
