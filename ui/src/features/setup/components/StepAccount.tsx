import { useState } from 'react';
import { Button } from '@/components/Button';
import { Localized } from '@/components/Localized';
import { requiredLocalized } from '@/components';
import { useLocalization } from '@fluent/react';
import { linkDeviceGoogle, type LinkedAccountDto } from '@/api/license';

/** What the step is doing right now — one value, so no two can disagree. */
type LinkState =
  | { kind: 'idle' }
  | { kind: 'linking' }
  | { kind: 'linked'; account: LinkedAccountDto }
  | { kind: 'failed' };

/**
 * Wizard step: link this POS to an account with Google (ADR #54 §2.5).
 *
 * Optional by design — the app runs on its licence key alone, so this step never blocks
 * Continue. The long wait is the user finishing a browser consent screen, which is why the
 * button reports what it is waiting for rather than appearing hung.
 */
export default function StepAccount() {
  const { l10n } = useLocalization();
  const [state, setState] = useState<LinkState>({ kind: 'idle' });

  const link = async () => {
    setState({ kind: 'linking' });
    try {
      const account = await linkDeviceGoogle();
      setState({ kind: 'linked', account });
    } catch {
      // The reason is already logged by `loggedInvoke`; ERR-10 keeps raw IPC error text
      // out of the UI, and a merchant cannot act on a Rust string anyway.
      setState({ kind: 'failed' });
    }
  };

  return (
    <div className="setup-step-panel">
      <h2 className="setup-step-title">{requiredLocalized(l10n, 'setup-account-title')}</h2>
      <p className="setup-step-desc">{requiredLocalized(l10n, 'setup-account-desc')}</p>

      <Button
        variant="primary"
        onClick={() => void link()}
        disabled={state.kind === 'linking'}
      >
        <Localized id="setup-account-google">Continue with Google</Localized>
      </Button>

      {state.kind === 'linking' && (
        <p className="setup-step-note" role="status">
          <Localized id="setup-account-waiting">Waiting for your browser…</Localized>
        </p>
      )}
      {state.kind === 'linked' && (
        <p className="setup-step-note" role="status">
          <Localized id="setup-account-linked" vars={{ email: state.account.email }}>
            {'Linked to { $email }.'}
          </Localized>
        </p>
      )}
      {state.kind === 'failed' && (
        <p className="setup-step-error" role="alert">
          <Localized id="setup-account-failed">
            Could not link this device. You can try again, or skip and link it later.
          </Localized>
        </p>
      )}

      <p className="setup-step-note">
        <Localized id="setup-account-optional">
          You can skip this. Your licence key still runs the POS.
        </Localized>
      </p>
    </div>
  );
}
