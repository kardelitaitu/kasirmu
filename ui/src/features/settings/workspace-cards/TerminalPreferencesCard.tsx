import { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useTerminalHardware } from '@/hooks/useTerminalHardware';
import { useToast } from '@/components/Toast';
import { requiredLocalized } from '@/components';
import { WorkspaceContext } from '@/contexts/WorkspaceContext';
import { listEdcTerminalsScoped, type EdcTerminalDto, edcTerminalStatusScoped } from '@/api/edc';
import type { WorkspaceCardProps } from './types';
import { hasChanges } from './helpers';

// ── Component ────────────────────────────────────────────────────────

/**
 * Terminal-local preferences card: sound volume, dark mode toggle,
 * scale auto-zero behaviour, and default EDC terminal binding.
 *
 * Consumes `useTerminalHardware(terminalId)` for register-local
 * preferences stored in `terminal_profile.json`.
 */
export function TerminalPreferencesCard({
  terminalId,
  // `userId` is deliberately not destructured: the only thing that read it was the unscoped
  // `set_hardware_settings` fallback in T11, which is gone with this shell's command. It stays on
  // the props interface so the modal's `cardProps` spread and the card tests keep working -- the
  // same choice `WorkspaceKdsSettings.tsx` and `WorkspaceInventorySettings.tsx` already made.
  variant = 'full-page',
  onSaved,
}: WorkspaceCardProps) {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const hw = useTerminalHardware(terminalId ?? '');
  const workspace = useContext(WorkspaceContext);
  const sessionToken = workspace?.sessionToken;

  // ── Draft state derived from hardware profile ────────────────

  const [soundVolume, setSoundVolume] = useState(80);
  const [darkMode, setDarkMode] = useState(false);
  const [scaleAutoZero, setScaleAutoZero] = useState(true);
  const [defaultEdcTerminalId, setDefaultEdcTerminalId] = useState('');
  const [edcTerminals, setEdcTerminals] = useState<EdcTerminalDto[]>([]);
  const [testingEdc, setTestingEdc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dirtyVersion, setDirtyVersion] = useState(0);

  const originalsRef = useRef<Record<string, unknown>>({
    soundVolume, darkMode, scaleAutoZero, defaultEdcTerminalId,
  });

  const dirty = useMemo(() => hasChanges(
    { soundVolume, darkMode, scaleAutoZero, defaultEdcTerminalId } as Record<string, unknown>,
    originalsRef.current,
  ), [soundVolume, darkMode, scaleAutoZero, defaultEdcTerminalId, loaded, dirtyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load available active EDC terminals for dropdown ───────

  useEffect(() => {
    if (!sessionToken) return;
    let active = true;
    listEdcTerminalsScoped(sessionToken)
      .then((terminals) => {
        if (active) {
          setEdcTerminals(terminals.filter((t) => t.isActive));
        }
      })
      .catch(() => {
        // non-fatal in settings card
      });
    return () => {
      active = false;
    };
  }, [sessionToken]);

  // ── Sync state with hardware profile on initial load only ───

  useEffect(() => {
    if (loaded || !hw.profile) return;
    const lp = hw.profile.localPrefs;
    const edcId = lp.defaultEdcTerminalId ?? '';
    setSoundVolume(lp.soundVolume);
    setDarkMode(lp.darkMode);
    setScaleAutoZero(lp.scaleAutoZero);
    setDefaultEdcTerminalId(edcId);
    originalsRef.current = {
      soundVolume: lp.soundVolume,
      darkMode: lp.darkMode,
      scaleAutoZero: lp.scaleAutoZero,
      defaultEdcTerminalId: edcId,
    };
    setLoaded(true);
  }, [hw.profile, loaded]);

  // Update helpers call both local state and hw.updateLocalPrefs.

  const updateSoundVolume = useCallback((v: number) => {
    setSoundVolume(v);
    hw.updateLocalPrefs({ soundVolume: v });
  }, [hw]);

  const updateDarkMode = useCallback((v: boolean) => {
    setDarkMode(v);
    hw.updateLocalPrefs({ darkMode: v });
  }, [hw]);

  const updateScaleAutoZero = useCallback((v: boolean) => {
    setScaleAutoZero(v);
    hw.updateLocalPrefs({ scaleAutoZero: v });
  }, [hw]);

  const updateDefaultEdcTerminalId = useCallback((v: string) => {
    setDefaultEdcTerminalId(v);
    hw.updateLocalPrefs({ defaultEdcTerminalId: v || undefined });
  }, [hw]);

  const handleTestEdc = useCallback(async () => {
    if (!sessionToken) return;
    setTestingEdc(true);
    try {
      const res = await edcTerminalStatusScoped(sessionToken, defaultEdcTerminalId || null);
      addToast({
        message: `${l10n.getString('settings-edc-test')}: ${res.status.toUpperCase()}`,
        type: res.status === 'ready' ? 'success' : 'error',
      });
    } catch {
      addToast({
        message: `${l10n.getString('settings-edc-test')}: ERROR`,
        type: 'error',
      });
    } finally {
      setTestingEdc(false);
    }
  }, [sessionToken, defaultEdcTerminalId, l10n, addToast]);

  // ── Save ─────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (terminalId && hw.profile) {
        await hw.save();
      }
      originalsRef.current = { soundVolume, darkMode, scaleAutoZero, defaultEdcTerminalId };
      setDirtyVersion((v) => v + 1);
      onSaved?.();
    } catch {
      addToast({ message: l10n.getString('settings-save-error'), type: 'error' });
    } finally {
      setSaving(false);
    }
  // The only deps that change are draft values. addToast/l10n are stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, hw, soundVolume, darkMode, scaleAutoZero, defaultEdcTerminalId, onSaved]);

  const isCompact = variant === 'inspector-drawer';

  return (
    <ErrorBoundary>
      <Card
        shadow="sm"
        header={
          <h2 className="settings-section-title">
            <Localized id="workspace-terminal-prefs-heading">Terminal Preferences</Localized>
          </h2>
        }
      >
        <div className="settings-form">
          {/* Sound volume */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="term-sound" className="settings-label">
              <Localized id="workspace-terminal-sound">Sound Volume</Localized>
            </label>
            <input
              id="term-sound"
              type="range"
              className="settings-range"
              min={0}
              max={100}
              step={5}
              value={soundVolume}
              onChange={(e) => updateSoundVolume(Number(e.target.value))}
              aria-label={requiredLocalized(l10n, 'terminal-sound-volume-aria')}
            />
            {!isCompact && (
              <span className="settings-range-value">{soundVolume}%</span>
            )}
          </div>

          {/* Dark mode */}
          <div className="settings-field settings-field--horizontal">
          <label htmlFor="term-dark-mode" className="settings-label">
            <Localized id="workspace-terminal-dark-mode">Dark Mode</Localized>
          </label>
            <span className="settings-toggle">
              <span className="sr-only"><Localized id="toggle">Toggle</Localized></span>
              <span className="settings-toggle-switch">
                <input
                  id="term-dark-mode"
                  type="checkbox"
                  role="switch"
                  checked={darkMode}
                  aria-checked={darkMode}
                  onChange={(e) => updateDarkMode(e.target.checked)}
                />
                <span className="settings-toggle-slider" />
              </span>
            </span>
          </div>

          {/* Scale auto-zero */}
          <div className="settings-field settings-field--horizontal">
          <label htmlFor="term-scale-zero" className="settings-label">
            <Localized id="workspace-terminal-scale-zero">Auto-Zero Scale on Boot</Localized>
          </label>
            <span className="settings-toggle">
              <span className="sr-only"><Localized id="toggle">Toggle</Localized></span>
              <span className="settings-toggle-switch">
                <input
                  id="term-scale-zero"
                  type="checkbox"
                  role="switch"
                  checked={scaleAutoZero}
                  aria-checked={scaleAutoZero}
                  onChange={(e) => updateScaleAutoZero(e.target.checked)}
                />
                <span className="settings-toggle-slider" />
              </span>
            </span>
          </div>

          {/* Default EDC Terminal */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="term-edc-default" className="settings-label">
              <Localized id="settings-edc-default-select">Register Default EDC Terminal</Localized>
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1, minWidth: 0 }}>
              <select
                id="term-edc-default"
                className="settings-select"
                value={defaultEdcTerminalId}
                onChange={(e) => updateDefaultEdcTerminalId(e.target.value)}
                aria-label={l10n.getString('settings-edc-default-select')}
                style={{ flex: 1, minWidth: 0 }}
              >
                <option value="">{l10n.getString('settings-edc-default-auto')}</option>
                {edcTerminals.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.transport} - {t.address})
                  </option>
                ))}
              </select>
              {sessionToken && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleTestEdc}
                  disabled={testingEdc}
                  type="button"
                >
                  {testingEdc ? l10n.getString('settings-edc-testing') : l10n.getString('settings-edc-test')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* F4: `hw.profile` is a DEFAULT when the read failed, so the baseline this
          card compares against is not the terminal's real config. */}
      {hw.loadFailed && (
        <div className="settings-error-banner" role="alert" data-testid="terminal-prefs-load-error">
          <Localized id="settings-load-failed">
            <span>Failed to load settings</span>
          </Localized>
        </div>
      )}

      {hw.error && (
        <div className="settings-error-banner" role="alert">
          {hw.error}
        </div>
      )}

      {/* Save button */}
      {variant !== 'inspector-drawer' && (
        <div className="settings-actions">
          <Button variant="primary" onClick={handleSave} disabled={!dirty || saving || hw.loadFailed}>
            <Localized id="save">Save</Localized>
          </Button>
        </div>
      )}
    </ErrorBoundary>
  );
}
