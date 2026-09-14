// DEAD (2026-09-15 · HEAD f0ad9b170e): the route is closed and unreachable by construction — there is
// NO `about` key among the 14 in SETTINGS_SCREENS (screens/registry.ts:27-42), so renderSection
// (SettingsPage.tsx:63-66) cannot select it and no nav item or hash deep link can name it. Nothing in
// production imports it; its tests grade UI no user can reach. No successor exists yet.
// Comment only — the code below is deliberately untouched.
import { Localized } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';

export interface AboutSectionProps {
  appVersion: string;
  updateState: 'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error';
  updateVersion: string;
  handleCheckUpdates: () => Promise<void>;
  handleInstallUpdate: () => Promise<void>;
}

export default function AboutSection({
  appVersion,
  updateState,
  updateVersion,
  handleCheckUpdates,
  handleInstallUpdate,
}: AboutSectionProps) {
  return (
    <>
      <Card
        shadow="sm"
        header={<Localized id="settings-system-license-header"><h2 className="settings-section-title">System &amp; License Ownership</h2></Localized>}
      >
        <div className="settings-form">
          <div className="settings-field settings-field--horizontal">
            <span className="settings-label">
              <Localized id="settings-software-edition"><span>Software Edition</span></Localized>
            </span>
            <span className="settings-field-input-wrap">
              <Localized id="settings-app-version" vars={{ version: appVersion }}>
                <span className="settings-license-value">OZ-POS Enterprise v{appVersion}</span>
              </Localized>
            </span>
          </div>

          <div className="settings-field settings-field--horizontal">
            <span className="settings-label">
              <Localized id="settings-license-type"><span>License Type</span></Localized>
            </span>
            <span className="settings-field-input-wrap">
              <Localized id="settings-license-type-value">
                <span className="settings-license-value settings-license-value--warning">Proprietary Commercial License</span>
              </Localized>
            </span>
          </div>

          <div className="settings-field settings-field--horizontal">
            <span className="settings-label">
              <Localized id="settings-copyright-notice"><span>Copyright Notice</span></Localized>
            </span>
            <span className="settings-field-input-wrap">
              <Localized id="settings-copyright-notice-value">
                <span className="settings-license-value">&copy; 2024-2026 OZ-POS Contributors. All Rights Reserved.</span>
              </Localized>
            </span>
          </div>

          <div className="settings-field settings-field--horizontal">
            <span className="settings-label">
              <Localized id="settings-commercial-contact"><span>Commercial Contact</span></Localized>
            </span>
            <span className="settings-field-input-wrap">
              <span className="settings-license-value settings-license-value--mono">adikaradwiatmaja@gmail.com</span>
            </span>
          </div>
        </div>
      </Card>

      <Card
        shadow="sm"
        header={<Localized id="settings-updates-heading"><h2 className="settings-section-title">Updates</h2></Localized>}
      >
        <div className="settings-form">
          <div className="settings-field settings-field--horizontal">
            <span className="settings-label">
              <Localized id="settings-current-version"><span>Current Version</span></Localized>
            </span>
            <span className="settings-field-input-wrap">
              <span className="settings-license-value">{appVersion}</span>
            </span>
          </div>

          <div className="settings-field settings-field--horizontal">
            <span className="settings-label">
              <Localized id="settings-update-status-label"><span>Status</span></Localized>
            </span>
            <span className="settings-field-input-wrap">
              {updateState === 'up-to-date' && (
                <span className="settings-license-value settings-license-value--active">
                  <Localized id="settings-up-to-date"><span>Up to date</span></Localized>
                </span>
              )}
              {updateState === 'available' && (
                <span className="settings-license-value settings-license-value--active">
                  <Localized id="settings-update-available" vars={{ version: updateVersion }}>
                    <span>{updateVersion} available</span>
                  </Localized>
                </span>
              )}
              {updateState === 'error' && (
                <span className="settings-license-value settings-license-value--warning">
                  <Localized id="settings-update-check-error"><span>Check failed</span></Localized>
                </span>
              )}
              {updateState === 'checking' && (
                <span className="settings-license-value">
                  <Localized id="settings-checking-for-updates"><span>Checking…</span></Localized>
                </span>
              )}
              {updateState === 'idle' && (
                <span className="settings-license-value settings-license-value--inactive">
                  <Localized id="settings-update-not-checked"><span>Not checked</span></Localized>
                </span>
              )}
            </span>
          </div>

          <div className="settings-actions">
            {updateState !== 'installing' && (
              <Button
                variant="secondary"
                onClick={handleCheckUpdates}
                loading={updateState === 'checking'}
                disabled={updateState === 'checking'}
              >
                <Localized id={
                  updateState === 'error'
                    ? 'settings-update-retry'
                    : 'settings-check-for-updates'
                }>
                  <span>{updateState === 'error' ? 'Retry' : 'Check for Updates'}</span>
                </Localized>
              </Button>
            )}

            {updateState === 'available' && (
              <Button
                variant="primary"
                onClick={handleInstallUpdate}
              >
                <Localized id="settings-install-update">
                  <span>Install Now</span>
                </Localized>
              </Button>
            )}

            {updateState === 'installing' && (
              <>
                <Button
                  variant="secondary"
                  loading
                  disabled
                >
                  <Localized id="settings-checking-for-updates">
                    <span>Checking…</span>
                  </Localized>
                </Button>
                <Button
                  variant="primary"
                  loading
                  disabled
                >
                  <Localized id="settings-installing-update">
                    <span>Installing…</span>
                  </Localized>
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
