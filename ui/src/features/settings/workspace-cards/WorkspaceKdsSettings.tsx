import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useToast } from '@/components/Toast';
import { requiredLocalized } from '@/components';
import { useSettings } from '@/contexts/SettingsContext';
import { getSettingScoped, setSettingsScoped } from '@/api/settings';
import { clampRedThreshold, clampYellowThreshold } from '@/features/kds/kdsThresholdMinutes';
import SettingsSelect from '../SettingsSelect';
import type { WorkspaceCardProps } from './types';
import { hasChanges } from './helpers';

// ── Local types ──────────────────────────────────────────────────────

type DisplayDensity = number;

interface KdsDraftState {
  soundEnabled: boolean;
  yellowThresholdMin: number;
  redThresholdMin: number;
  autoAcknowledge: boolean;
  density: DisplayDensity;
}

const DEFAULT_KDS: KdsDraftState = {
  soundEnabled: true,
  yellowThresholdMin: 5,
  redThresholdMin: 10,
  autoAcknowledge: false,
  density: 3,
};

// ── Component ────────────────────────────────────────────────────────

/**
 * Workspace card for Kitchen Display System settings: SLA escalation
 * thresholds, sound toggle, auto-accept, and ticket display density.
 *
 * Consumes `useSettings()` for shared KDS configuration.
 */
export function WorkspaceKdsSettings({
  sessionToken,
  // `userId` is intentionally not destructured: it is a required prop that the body never reads,
  // and the dependency array above was its only use. Left on the interface so SettingsPage's call
  // sites are unaffected; removing the prop is a wider, separate cleanup.
  variant = 'full-page',
  onSaved,
}: WorkspaceCardProps) {
  // ── Draft state ──────────────────────────────────────────────

  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const { markSettingsUpdated } = useSettings();

  const [draft, setDraft] = useState<KdsDraftState>(DEFAULT_KDS);
  const [saving, setSaving] = useState(false);
  const [dirtyVersion, setDirtyVersion] = useState(0);

  // Originals for dirty tracking — captured after initial load
  const originalsRef = useRef<KdsDraftState>({ ...draft });
  // Keys the user has edited while the initial load is still in flight —
  // the load must never silently revert these (draft-overwrite race).
  const touchedRef = useRef<Set<keyof KdsDraftState>>(new Set());
  const [originalsLoaded, setOriginalsLoaded] = useState(false);
  // The session originals were seeded for; replaces originalsLoaded as the fetch guard so a
  // store switch re-seeds. originalsLoaded stays for the dirty memo below.
  const originalsLoadedForRef = useRef<string | null | undefined>(undefined);
  const dirty = useMemo(() => hasChanges(
    draft as unknown as Record<string, unknown>,
    originalsRef.current as unknown as Record<string, unknown>,
  ), [draft, originalsLoaded, dirtyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Initialise from backend ─────────────────────────────────

  useEffect(() => {
    // Only seed initial values once per session; subsequent re-runs must not
    // overwrite user edits. "Once" is scoped to the token, not to the mount.
    if (originalsLoadedForRef.current === sessionToken) return;
    originalsLoadedForRef.current = sessionToken;

    // Load all 5 KDS settings from the backend, then set originals
    // to the loaded values so dirty tracking doesn't fire on mount.
    Promise.all([
      getSettingScoped(sessionToken ?? null, 'kds.sound_enabled'),
      getSettingScoped(sessionToken ?? null, 'kds.yellow_threshold_min'),
      getSettingScoped(sessionToken ?? null, 'kds.red_threshold_min'),
      getSettingScoped(sessionToken ?? null, 'kds.auto_acknowledge'),
      getSettingScoped(sessionToken ?? null, 'kds.density'),
    ]).then(([sound, yellow, red, ack, density]) => {
      // RULING 2026-09-15 (lane owner): values persisted BEFORE the ruling can exceed the
      // ceilings the board engine honors — the KDS hamburger slider once offered 30/60
      // minutes while clampSlaThresholds silently capped them at 14/15. Hydrate through
      // the same minute clamps the writers use (red first; yellow follows red-1) so the
      // number this card shows, and re-saves on the next unrelated edit, is the number
      // the board actually acts on.
      const redThresholdMin = clampRedThreshold(parseInt(red ?? '', 10) || DEFAULT_KDS.redThresholdMin);
      const loaded: KdsDraftState = {
        soundEnabled: sound !== 'false',
        yellowThresholdMin: clampYellowThreshold(
          parseInt(yellow ?? '', 10) || DEFAULT_KDS.yellowThresholdMin,
          redThresholdMin,
        ),
        redThresholdMin,
        autoAcknowledge: ack === 'true',
        density: Math.min(5, Math.max(1, parseInt(density ?? '', 10) || DEFAULT_KDS.density)),
      };
      // Seed the loaded values, but never overwrite fields the user has
      // already edited while the load was in flight — otherwise a fast
      // toggle gets silently reverted when the load lands.
      setDraft((prev) => {
        if (touchedRef.current.size === 0) return loaded;
        const merged = { ...loaded };
        for (const key of touchedRef.current) {
          Object.assign(merged, { [key]: prev[key] });
        }
        return merged;
      });
      originalsRef.current = loaded;
    }).catch(() => {
      // Fallback: keep DEFAULT_KDS values
      originalsRef.current = { ...draft };
    }).finally(() => {
      setOriginalsLoaded(true);
    });
    // The suppression on the previous line was hiding this: the effect reads sessionToken five
    // times (:79-:83) and its deps listed only the one-way latch originalsLoaded. eslint could
    // not report it, which is why the sweep's count understated the class -- the real total was
    // 11, not 10. Latching on the token makes a store switch re-seed; originalsLoaded stays for
    // the dirty memo at :67, and the touchedRef guard in the .then() is already built for re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalsLoaded, sessionToken]);

  // ── Update helpers ───────────────────────────────────────────

  const update = useCallback(<K extends keyof KdsDraftState>(key: K, value: KdsDraftState[K]) => {
    touchedRef.current.add(key);
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── Save ─────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await setSettingsScoped(sessionToken ?? null, {
        'kds.sound_enabled': String(draft.soundEnabled),
        'kds.yellow_threshold_min': String(draft.yellowThresholdMin),
        'kds.red_threshold_min': String(draft.redThresholdMin),
        'kds.auto_acknowledge': String(draft.autoAcknowledge),
        // `density` became a number when the comfortable/compact union turned into a
        // 1-5 column stepper (fcfddf79). The read path (L90) and the control
        // (L269/L270) were converted; this write-back was not. setSettingsScoped takes
        // Record<string, string> and the Rust command deserializes
        // HashMap<String, String> (commands/settings.rs:1054), so a bare number here
        // failed serde for the WHOLE batch -- every KDS setting save errored, not just
        // the density one, because all five keys go in a single call.
        'kds.density': String(draft.density),
      });
      originalsRef.current = { ...draft };
      setDirtyVersion((v) => v + 1);

      // Notify other cards that KDS settings changed
      markSettingsUpdated([
        'kds.sound_enabled',
        'kds.yellow_threshold_min',
        'kds.red_threshold_min',
        'kds.auto_acknowledge',
        'kds.density',
      ]);

      onSaved?.();
    } catch {
      addToast({ message: l10n.getString('settings-save-error'), type: 'error' });
    } finally {
      setSaving(false);
    }
  // sessionToken is read at :125 by setSettingsScoped. `userId` was already listed and is a
  // different value, so it never covered the token -- saving after a store switch wrote to the
  // previous store (or failed on the destroyed session) while the UI reported success. `userId` is
  // now gone from this array: nothing in the component read it, and its only "use" was this entry.
  }, [draft, onSaved, addToast, l10n, markSettingsUpdated, sessionToken]);

  const isCompact = variant === 'inspector-drawer';

  return (
    <ErrorBoundary>
      {/* SLA thresholds */}
      <Card
        shadow="sm"
        header={
          <h2 className="settings-section-title">
            <Localized id="workspace-kds-sla-heading">SLA Escalation</Localized>
          </h2>
        }
      >
        <div className="settings-form">
          {/* Sound toggle */}
          <div className="settings-field settings-field--horizontal">
          <label htmlFor="kds-sound" className="settings-label">
            <Localized id="workspace-kds-sound">New Order Sound</Localized>
          </label>
            <span className="settings-toggle">
              <span className="sr-only"><Localized id="toggle">Toggle</Localized></span>
              <span className="settings-toggle-switch">
                <input
                  id="kds-sound"
                  type="checkbox"
                  role="switch"
                  checked={draft.soundEnabled}
                  aria-checked={draft.soundEnabled}
                  onChange={(e) => update('soundEnabled', e.target.checked)}
                />
                <span className="settings-toggle-slider" />
              </span>
            </span>
          </div>

          {/* Yellow threshold */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="kds-yellow" className="settings-label">
              <Localized id="workspace-kds-yellow-threshold">Yellow Alert (min)</Localized>
            </label>
            <input
              id="kds-yellow"
              type="range"
              className="settings-range"
              min={3}
              max={10}
              step={1}
              value={draft.yellowThresholdMin}
              onChange={(e) => update('yellowThresholdMin', Number(e.target.value))}
              aria-label={requiredLocalized(l10n, 'workspace-kds-yellow-threshold-aria')}
            />
            {!isCompact && (
              <span className="settings-range-value">{draft.yellowThresholdMin} min</span>
            )}
          </div>

          {/* Red threshold */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="kds-red" className="settings-label">
              <Localized id="workspace-kds-red-threshold">Red Alert (min)</Localized>
            </label>
            <input
              id="kds-red"
              type="range"
              className="settings-range"
              min={Math.max(draft.yellowThresholdMin + 1, 6)}
              max={15}
              step={1}
              value={draft.redThresholdMin}
              onChange={(e) => update('redThresholdMin', Number(e.target.value))}
              aria-label={requiredLocalized(l10n, 'workspace-kds-red-threshold-aria')}
            />
            {!isCompact && (
              <span className="settings-range-value">{draft.redThresholdMin} min</span>
            )}
          </div>
        </div>
      </Card>

      {/* Ticket display */}
      <Card
        shadow="sm"
        header={
          <h2 className="settings-section-title">
            <Localized id="workspace-kds-display-heading">Ticket Display</Localized>
          </h2>
        }
      >
        <div className="settings-form">
          {/* Auto-accept */}
          <div className="settings-field settings-field--horizontal">
          <label htmlFor="kds-auto-ack" className="settings-label">
            <Localized id="workspace-kds-auto-ack">Auto-Accept</Localized>
          </label>
            <span className="settings-toggle">
              <span className="sr-only"><Localized id="toggle">Toggle</Localized></span>
              <span className="settings-toggle-switch">
                <input
                  id="kds-auto-ack"
                  type="checkbox"
                  role="switch"
                  checked={draft.autoAcknowledge}
                  aria-checked={draft.autoAcknowledge}
                  onChange={(e) => update('autoAcknowledge', e.target.checked)}
                />
                <span className="settings-toggle-slider" />
              </span>
            </span>
          </div>

          {/* Column count */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="kds-density" className="settings-label">
              <Localized id="workspace-kds-density">Column</Localized>
            </label>
            <SettingsSelect
              id="kds-density"
              value={String(draft.density)}
              onChange={(v) => update('density', parseInt(v, 10) || DEFAULT_KDS.density)}
              options={[
                { value: '1', label: '1' },
                { value: '2', label: '2' },
                { value: '3', label: '3' },
                { value: '4', label: '4' },
                { value: '5', label: '5' },
              ]}
            />
          </div>
        </div>
      </Card>

      {/* Save button */}
      {variant !== 'inspector-drawer' && (
        <div className="settings-actions">
          <Button variant="primary" onClick={handleSave} disabled={!dirty || saving}>
            <Localized id="save">Save</Localized>
          </Button>
        </div>
      )}
    </ErrorBoundary>
  );
}
