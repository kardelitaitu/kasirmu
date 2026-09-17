import { useCallback, useEffect, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/components/Toast';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import {
  getLocalApiStatusScoped,
  setLocalApiEnabledScoped,
  setLocalApiPortScoped,
  setLocalApiStoreScoped,
  rotateLocalApiSecretScoped,
  mintLocalApiTokenScoped,
  type LocalApiStatusDto,
  type LocalApiTokenDto,
} from '@/api/localApi';
import { listLocationsScoped, type LocationProfile } from '@/api/locations';

/** Copy text to the clipboard, reporting success for the toast. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Settings → Local API: toggle the embedded loopback REST server,
 * change its port, and mint long-lived tokens for local scripts.
 * Self-contained: fetches its own status (the server state lives in
 * the Rust process, not in the shared dirty-save form state).
 */
export default function LocalApiSection() {
  const { l10n } = useLocalization();
  const { sessionToken } = useWorkspace();
  const { addToast } = useToast();

  const [status, setStatus] = useState<LocalApiStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [portDraft, setPortDraft] = useState('');
  const [token, setToken] = useState<LocalApiTokenDto | null>(null);
  const [tokenLabel, setTokenLabel] = useState('');
  const [minting, setMinting] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  // Store selector: only meaningful on multi-store installs, so the
  // list is fetched lazily and the row renders when >1 store exists.
  const [stores, setStores] = useState<LocationProfile[]>([]);

  const refresh = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const s = await getLocalApiStatusScoped(sessionToken);
      setStatus(s);
      setPortDraft(String(s.port));
    } catch {
      // Status is advisory; a failed fetch leaves the last snapshot.
    }
  }, [sessionToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Store profiles for the selector (advisory — a failed fetch just
  // hides the row, the server keeps serving the resolved store).
  useEffect(() => {
    if (!sessionToken || !status?.enabled) return;
    let cancelled = false;
    listLocationsScoped(sessionToken)
      .then((s) => {
        if (!cancelled) setStores(s);
      })
      .catch(() => {
        /* selector stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionToken, status?.enabled]);

  // While the setting says on but no server is listening (boot
  // auto-start still in flight, or a bind failure), poll so the panel
  // converges without a manual reopen (review LOW-5).
  useEffect(() => {
    if (!status || status.running || !status.enabled) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [status, refresh]);

  const onToggle = async (checked: boolean) => {
    if (!sessionToken) return;
    setBusy(true);
    try {
      const s = await setLocalApiEnabledScoped(sessionToken, checked);
      setStatus(s);
      // A stopped server must not leave a stale token on screen — the
      // next enable may run on a different port, and disable-then-
      // rotate would otherwise show a token the server no longer accepts.
      if (!checked) setToken(null);
      if (checked && !s.running) {
        addToast({ message: l10n.getString('settings-local-api-start-failed'), type: 'error' });
      }
    } catch {
      addToast({ message: l10n.getString('settings-local-api-toggle-failed'), type: 'error' });
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const onApplyPort = async () => {
    if (!sessionToken) return;
    const port = Number(portDraft.trim());
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      addToast({ message: l10n.getString('settings-local-api-port-invalid'), type: 'error' });
      return;
    }
    setBusy(true);
    try {
      setStatus(await setLocalApiPortScoped(sessionToken, port));
      addToast({ message: l10n.getString('settings-local-api-port-applied'), type: 'success' });
    } catch {
      addToast({ message: l10n.getString('settings-local-api-port-failed'), type: 'error' });
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const onApplyStore = async (storeId: string) => {
    if (!sessionToken) return;
    setBusy(true);
    try {
      setStatus(await setLocalApiStoreScoped(sessionToken, storeId));
      addToast({ message: l10n.getString('settings-local-api-store-changed'), type: 'success' });
    } catch {
      addToast({ message: l10n.getString('settings-local-api-store-failed'), type: 'error' });
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const onRotate = async () => {
    if (!sessionToken) return;
    setRotating(true);
    try {
      setStatus(await rotateLocalApiSecretScoped(sessionToken));
      // Every old token is dead the moment the key changes.
      setToken(null);
      setConfirmRotate(false);
      addToast({ message: l10n.getString('settings-local-api-rotate-done'), type: 'success' });
    } catch {
      addToast({ message: l10n.getString('settings-local-api-rotate-failed'), type: 'error' });
      void refresh();
    } finally {
      setRotating(false);
    }
  };

  const onMint = async () => {
    if (!sessionToken) return;
    setMinting(true);
    try {
      setToken(await mintLocalApiTokenScoped(sessionToken, tokenLabel || 'local-script'));
    } catch {
      addToast({ message: l10n.getString('settings-local-api-mint-failed'), type: 'error' });
    } finally {
      setMinting(false);
    }
  };

  const onCopy = async (text: string, okKey: string) => {
    const ok = await copyToClipboard(text);
    addToast({
      message: l10n.getString(ok ? okKey : 'settings-local-api-copy-failed'),
      type: ok ? 'success' : 'error',
    });
  };

  const portDirty = status !== null && portDraft !== String(status.port);
  // Local const so TypeScript keeps the narrowing inside JSX callbacks.
  const baseUrl = status?.running ? status.baseUrl : null;

  return (
    <Card
      shadow="sm"
      header={
        <Localized id="settings-section-local-api">
          <h2 className="settings-section-title">Local API</h2>
        </Localized>
      }
    >
      <div className="settings-form">
        <p className="settings-hint">
          <Localized id="settings-local-api-intro">
            <span>
              Run your own scripts against this register over HTTP. The server listens only on
              this machine (127.0.0.1) and is off by default.
            </span>
          </Localized>
        </p>

        <div className="settings-field settings-field--horizontal">
          <span className="settings-label">
            <Localized id="settings-local-api-enabled">
              <span>Enable Local API</span>
            </Localized>
          </span>
          <span className="settings-field-input-wrap">
            <label className="settings-toggle" htmlFor="local-api-enabled" aria-label={requiredLocalized(l10n, 'toggle')}>
              <span className="sr-only">
                <Localized id="toggle">Toggle</Localized>
              </span>
              <span className="settings-toggle-switch">
                <input
                  id="local-api-enabled"
                  type="checkbox"
                  role="switch"
                  checked={status?.enabled ?? false}
                  aria-checked={status?.enabled ?? false}
                  disabled={busy}
                  onChange={(e) => void onToggle(e.target.checked)}
                />
                <span className="settings-toggle-slider" />
              </span>
            </label>
          </span>
        </div>

        <div className="settings-field settings-field--horizontal">
          <label htmlFor="local-api-port" className="settings-label">
            {l10n.getString('settings-local-api-port')}
          </label>
          <span className="settings-field-input-wrap">
            <div className="settings-input-wrap" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="settings-input"
                type="number"
                id="local-api-port"
                min={1024}
                max={65535}
                inputMode="numeric"
                value={portDraft}
                disabled={busy}
                onChange={(e) => setPortDraft(e.target.value)}
              />
              {portDirty && (
                <Button variant="ghost" onClick={() => void onApplyPort()} disabled={busy}>
                  <Localized id="settings-local-api-port-apply">
                    <span>Apply</span>
                  </Localized>
                </Button>
              )}
            </div>
          </span>
        </div>

        {status?.enabled && stores.length > 1 && (
          <div className="settings-field settings-field--horizontal" data-testid="local-api-store-row">
            <label htmlFor="local-api-store" className="settings-label">
              {l10n.getString('settings-local-api-store')}
            </label>
            <span className="settings-field-input-wrap">
              <select
                id="local-api-store"
                className="settings-input"
                value={status.storeId}
                disabled={busy}
                onChange={(e) => void onApplyStore(e.target.value)}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.is_primary ? ` (${requiredLocalized(l10n, 'settings-local-api-store-primary')})` : ''}
                  </option>
                ))}
              </select>
              <p className="settings-hint">
                <Localized id="settings-local-api-store-hint">
                  <span>
                    Scripts see exactly one store&apos;s data. Switching restarts the server
                    against the selected store&apos;s database.
                  </span>
                </Localized>
              </p>
            </span>
          </div>
        )}

        {status?.enabled && (
          <div className="settings-field settings-field--horizontal" data-testid="local-api-rotate-row">
            <span className="settings-label">
              <Localized id="settings-local-api-rotate">
                <span>Rotate secret</span>
              </Localized>
            </span>
            <span className="settings-field-input-wrap">
              {confirmRotate ? (
                <>
                  <p className="settings-hint" data-testid="local-api-rotate-warning">
                    <Localized id="settings-local-api-rotate-warning">
                      <span>
                        Rotating invalidates every minted token immediately and changes the
                        operator key. Scripts will need freshly minted tokens.
                      </span>
                    </Localized>
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="ghost" loading={rotating} onClick={() => void onRotate()}>
                      <Localized id="settings-local-api-rotate-confirm">
                        <span>Confirm rotate</span>
                      </Localized>
                    </Button>
                    <Button variant="ghost" disabled={rotating} onClick={() => setConfirmRotate(false)}>
                      <Localized id="settings-local-api-rotate-cancel">
                        <span>Cancel</span>
                      </Localized>
                    </Button>
                  </div>
                </>
              ) : (
                <Button variant="ghost" disabled={busy || rotating} onClick={() => setConfirmRotate(true)}>
                  <Localized id="settings-local-api-rotate">
                    <span>Rotate secret</span>
                  </Localized>
                </Button>
              )}
            </span>
          </div>
        )}

        {baseUrl && (
          <>
            <div className="settings-sync-status" data-testid="local-api-status-row">
              <span className="settings-sync-dot settings-sync-dot--ok" aria-hidden="true" />
              <span className="settings-sync-status-text">{baseUrl}</span>
              <Button variant="ghost" onClick={() => void onCopy(baseUrl, 'settings-local-api-url-copied')}>
                <Localized id="settings-local-api-copy-url">
                  <span>Copy URL</span>
                </Localized>
              </Button>
            </div>

            <div className="settings-field settings-field--horizontal">
              <label htmlFor="local-api-token-label" className="settings-label">
                {l10n.getString('settings-local-api-token-label')}
              </label>
              <span className="settings-field-input-wrap">
                <div className="settings-input-wrap" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Localized id="settings-local-api-token-label-placeholder" attrs={{ placeholder: true }}>
                    <input
                      className="settings-input"
                      type="text"
                      id="local-api-token-label"
                      placeholder="my-integration"
                      value={tokenLabel}
                      onChange={(e) => setTokenLabel(e.target.value)}
                    />
                  </Localized>
                  <Button variant="ghost" loading={minting} onClick={() => void onMint()}>
                    <Localized id="settings-local-api-generate">
                      <span>Generate Token</span>
                    </Localized>
                  </Button>
                </div>
                <p className="settings-hint">
                  <Localized id="settings-local-api-token-hint">
                    <span>
                      The token grants read access to all local data for 30 days. Master-data
                      writes additionally require the operator key — see docs/guides/EXTENDING.md.
                    </span>
                  </Localized>
                </p>
              </span>
            </div>

            {token && (
              <div className="settings-field settings-field--horizontal" data-testid="local-api-token-row">
                <span className="settings-label">
                  <Localized id="settings-local-api-token">
                    <span>API token</span>
                  </Localized>
                </span>
                <span className="settings-field-input-wrap">
                  <div className="settings-input-wrap" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="settings-input"
                      type="text"
                      readOnly
                      value={token.token}
                      aria-label={l10n.getString('settings-local-api-token')}
                      onFocus={(e) => e.target.select()}
                    />
                    <Button variant="ghost" onClick={() => void onCopy(token.token, 'settings-local-api-token-copied')}>
                      <Localized id="settings-local-api-copy-token">
                        <span>Copy</span>
                      </Localized>
                    </Button>
                  </div>
                  <p className="settings-hint">
                    <Localized id="settings-local-api-token-expires" vars={{ expires: token.expires_at }}>
                      <span>Expires {token.expires_at}</span>
                    </Localized>
                  </p>
                </span>
              </div>
            )}
          </>
        )}

        {!status?.running && (
          <p className="settings-hint" data-testid="local-api-stopped-hint">
            <Localized id="settings-local-api-stopped">
              <span>
                The local API is stopped. Enable it to start a server on this machine; scripts
                then use the base URL shown here.
              </span>
            </Localized>
          </p>
        )}
      </div>
    </Card>
  );
}
