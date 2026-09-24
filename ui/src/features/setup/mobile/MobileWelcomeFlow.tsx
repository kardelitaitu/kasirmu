import { useState, useCallback } from 'react';
import styles from './MobileWelcomeFlow.module.css';
import { MobileWelcomeScreen } from './MobileWelcomeScreen';
import { MobileSetupHub } from './MobileSetupHub';
import { MobileGoogleAuthModal, type GoogleAccount } from './MobileGoogleAuthModal';
import { MobileEmailAuthModal } from './MobileEmailAuthModal';
import { MobileQrPairingModal } from './MobileQrPairingModal';

export type MobileScreenState = 'welcome' | 'hub' | 'google' | 'email' | 'qr';

export interface MobileWelcomeFlowProps {
  initialScreen?: MobileScreenState | undefined;
  onSignUp?: (() => void) | undefined;
  onProvisioned?: (() => void) | undefined;
  pairingUrl?: string | undefined;
  pairingCode?: string | undefined;
  googleAccounts?: readonly GoogleAccount[] | undefined;
}

export function MobileWelcomeFlow({
  initialScreen = 'welcome',
  onSignUp,
  onProvisioned,
  pairingUrl,
  pairingCode,
  googleAccounts,
}: MobileWelcomeFlowProps) {
  const [screen, setScreen] = useState<MobileScreenState>(initialScreen);

  const goTo = useCallback((next: MobileScreenState) => {
    setScreen(next);
  }, []);

  const handleGoogleAccountSelected = useCallback(
    (_email: string) => {
      // Upon account linking completion:
      onProvisioned?.();
    },
    [onProvisioned],
  );

  const handleEmailSubmitted = useCallback(
    (_creds: { email: string; password?: string | undefined }) => {
      // Upon email login completion:
      onProvisioned?.();
    },
    [onProvisioned],
  );

  return (
    <div className={styles['root']} data-testid="mobile-welcome-flow-container">
      <div className={styles['viewportCanvas']}>
        {screen === 'welcome' && (
          <MobileWelcomeScreen
            onStartSetup={() => goTo('hub')}
            {...(onSignUp !== undefined ? { onSignUp } : {})}
          />
        )}

        {screen === 'hub' && (
          <MobileSetupHub
            onBack={() => goTo('welcome')}
            onSelectGoogle={() => goTo('google')}
            onSelectEmail={() => goTo('email')}
            onSelectQr={() => goTo('qr')}
          />
        )}

        {screen === 'google' && (
          <MobileGoogleAuthModal
            onBack={() => goTo('hub')}
            onSelectAccount={handleGoogleAccountSelected}
            {...(googleAccounts !== undefined ? { accounts: googleAccounts } : {})}
          />
        )}

        {screen === 'email' && (
          <MobileEmailAuthModal
            onBack={() => goTo('hub')}
            onSubmit={handleEmailSubmitted}
          />
        )}

        {screen === 'qr' && (
          <MobileQrPairingModal
            onBack={() => goTo('hub')}
            {...(pairingUrl !== undefined ? { pairingUrl } : {})}
            {...(pairingCode !== undefined ? { pairingCode } : {})}
          />
        )}
      </div>
    </div>
  );
}

export default MobileWelcomeFlow;
