import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useToast } from '@/components/Toast';
import { requiredLocalized } from '@/components';
import { useSettings } from '@/contexts/SettingsContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTerminalHardware } from '@/hooks/useTerminalHardware';
import { setReceiptSettingsScoped, getSettingScoped, setSettingsScoped } from '@/api/settings';
import SettingsSelect from '../SettingsSelect';
import type { WorkspaceCardProps } from './types';
import { hasChanges } from './helpers';

// ── Component ────────────────────────────────────────────────────────

/**
 * Workspace card for Restaurant/POS settings: kitchen printers, table
 * management toggle, and course firing rules.
 *
 * Consumes `useSettings()` for shared config and
 * `useTerminalHardware(terminalId)` for register-local kitchen printer.
 */
export function WorkspaceRestaurantPosSettings({
  terminalId,
  // `userId` is deliberately not destructured: the only thing that read it was the unscoped
  // `set_hardware_settings` fallback in T11, which is gone with this shell's command. It stays on
  // the props interface so the modal's `cardProps` spread and the card tests keep working -- the
  // same choice `WorkspaceKdsSettings.tsx` and `WorkspaceInventorySettings.tsx` already made.
  variant = 'full-page',
  onSaved,
}: WorkspaceCardProps) {
  const { settings, markSettingsUpdated } = useSettings();
  const { sessionToken } = useWorkspace();
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const hw = useTerminalHardware(terminalId ?? '', settings.store.currency);

  // ── Draft state ──────────────────────────────────────────────

  const [tableManagement, setTableManagement] = useState(false);
  const [courseFiring, setCourseFiring] = useState(false);

  const [saving, setSaving] = useState(false);
  const [dirtyVersion, setDirtyVersion] = useState(0);

  // Originals for dirty tracking — captured after initial load
  const originalsRef = useRef<Record<string, unknown>>({ tableManagement, courseFiring });
  // Keys the user has edited while the courseFiring load is in flight —
  // the load must never silently revert them (draft-overwrite race).
  const touchedRef = useRef<Set<'courseFiring'>>(new Set());
  const [originalsLoaded, setOriginalsLoaded] = useState(false);
  // The session the originals above were seeded for; replaces originalsLoaded as the fetch guard
  // so a store switch re-seeds. originalsLoaded stays for the dirty memo at :52.
  const originalsLoadedForRef = useRef<string | null | undefined>(undefined);

  const dirty = useMemo(() => hasChanges(
    { tableManagement, courseFiring } as Record<string, unknown>,
    originalsRef.current,
  ), [tableManagement, courseFiring, originalsLoaded, dirtyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Initialise ───────────────────────────────────────────────

  useEffect(() => {
    // Only seed initial values once; subsequent re-runs must not
    // overwrite user edits (e.g. when settings.receipt changes).
    // "Once" is scoped to the session: originalsLoaded is a one-way latch (set at :73/:76, never
    // reset), so listing sessionToken in the deps alone would have changed nothing -- the guard
    // short-circuits every later run. Latching on the token makes a store switch re-seed, which
    // is what the touchedRef guard at :71 is already built for.
    if (originalsLoadedForRef.current === sessionToken) return;
    originalsLoadedForRef.current = sessionToken;

    setTableManagement(settings.receipt.showTableNumber);

    // Load courseFiring from the backend settings table.
    let cancelled = false;
    getSettingScoped(sessionToken ?? null, 'restaurant.course_firing').then((raw) => {
      if (cancelled) return;
      const loaded = raw === 'true';
      if (!touchedRef.current.has('courseFiring')) setCourseFiring(loaded);
      originalsRef.current = { tableManagement: settings.receipt.showTableNumber, courseFiring: loaded };
      setOriginalsLoaded(true);
    }).catch(() => {
      originalsRef.current = { tableManagement: settings.receipt.showTableNumber, courseFiring: false };
      setOriginalsLoaded(true);
    });
    return () => { cancelled = true; };
    // sessionToken is read at :68 from useWorkspace() at :32. The save path at :125 already lists
    // it, so the omission here is an inconsistency rather than a design decision.
  }, [settings.receipt, originalsLoaded, sessionToken]);

  // ── Save ─────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const tasks: Promise<unknown>[] = [];

      // Persist table management + course firing to the backend
      tasks.push(
        setReceiptSettingsScoped(sessionToken ?? '', {
          showCurrency: settings.receipt.showCurrency,
          decimalSeparator: settings.receipt.decimalSeparator,
          showTax: settings.receipt.showTax,
          footer: settings.receipt.footer,
          paperWidth: settings.receipt.paperWidth,
          showTableNumber: tableManagement,
          marginTop: settings.receipt.marginTop,
          marginBottom: settings.receipt.marginBottom,
          marginLeft: settings.receipt.marginLeft,
          marginRight: settings.receipt.marginRight,
        }),
      );
      tasks.push(
        setSettingsScoped(sessionToken ?? null, { 'restaurant.course_firing': String(courseFiring) }),
      );

      if (terminalId && hw.profile) {
        tasks.push(hw.save());
      }

      await Promise.all(tasks);

      originalsRef.current = { tableManagement, courseFiring };
      setDirtyVersion((v) => v + 1);

      // Notify other cards that receipt and restaurant settings changed
      markSettingsUpdated(['receipt.showTableNumber', 'restaurant.course_firing']);

      onSaved?.();
    } catch {
      addToast({ message: l10n.getString('settings-save-error'), type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [terminalId, hw, tableManagement, courseFiring, settings.receipt, onSaved, addToast, l10n, markSettingsUpdated, sessionToken]);

  const isCompact = variant === 'inspector-drawer';

  return (
    <ErrorBoundary>
      {/* Table management */}
      <Card
        shadow="sm"
        header={
          <h2 className="settings-section-title">
            <Localized id="workspace-resto-table-heading">Table Management</Localized>
          </h2>
        }
      >
        <div className="settings-form">
          <div className="settings-field settings-field--horizontal">
          <label htmlFor="resto-table-mgmt" className="settings-label">
            <Localized id="workspace-resto-table-enable">Enable Table Layout</Localized>
          </label>
            <span className="settings-toggle">
              <span className="sr-only"><Localized id="toggle">Toggle</Localized></span>
              <span className="settings-toggle-switch">
                <input
                  id="resto-table-mgmt"
                  type="checkbox"
                  role="switch"
                  checked={tableManagement}
                  aria-checked={tableManagement}
                  onChange={(e) => setTableManagement(e.target.checked)}
                />
                <span className="settings-toggle-slider" />
              </span>
            </span>
          </div>
          {!isCompact && tableManagement && (
            <p className="settings-hint">
              <Localized id="workspace-resto-table-hint">
                <span>Tables appear on the POS screen for dine-in orders</span>
              </Localized>
            </p>
          )}
        </div>
      </Card>

      {/* Course firing */}
      <Card
        shadow="sm"
        header={
          <h2 className="settings-section-title">
            <Localized id="workspace-resto-courses-heading">Course Firing</Localized>
          </h2>
        }
      >
        <div className="settings-form">
          <div className="settings-field settings-field--horizontal">
          <label htmlFor="resto-course-firing" className="settings-label">
            <Localized id="workspace-resto-courses-enable">Enable Course Firing</Localized>
          </label>
            <span className="settings-toggle">
              <span className="sr-only"><Localized id="toggle">Toggle</Localized></span>
              <span className="settings-toggle-switch">
                <input
                  id="resto-course-firing"
                  type="checkbox"
                  role="switch"
                  checked={courseFiring}
                  aria-checked={courseFiring}
                  onChange={(e) => {
                    touchedRef.current.add('courseFiring');
                    setCourseFiring(e.target.checked);
                  }}
                />
                <span className="settings-toggle-slider" />
              </span>
            </span>
          </div>
          {!isCompact && courseFiring && (
            <p className="settings-hint">
              <Localized id="workspace-resto-courses-hint">
                <span>Send appetizers, mains, and desserts to the kitchen in sequence</span>
              </Localized>
            </p>
          )}
        </div>
      </Card>

      {/* Kitchen printer — separate from receipt printer */}
      {terminalId && (
        <Card
          shadow="sm"
          header={
            <h2 className="settings-section-title">
              <Localized id="workspace-resto-kitchen-printer-heading">Kitchen Printer</Localized>
            </h2>
          }
        >
          <div className="settings-form">
            <div className="settings-field settings-field--horizontal">
              <label htmlFor="resto-kp-conn" className="settings-label">
                <Localized id="workspace-resto-kp-connection">Connection</Localized>
              </label>
              <SettingsSelect
                id="resto-kp-conn"
                value={hw.profile?.hardware.kitchenPrinter.connection ?? 'disabled'}
                onChange={(v) => hw.updateKitchenPrinter({ connection: v as 'network' | 'usb' | 'serial' | 'auto' | 'disabled' })}
                options={[
                  { value: 'disabled', label: requiredLocalized(l10n, 'workspace-resto-kp-disabled') },
                  { value: 'network', label: 'Network' },
                  { value: 'usb', label: 'USB' },
                  { value: 'serial', label: 'Serial' },
                ]}
              />
            </div>
            {hw.profile?.hardware.kitchenPrinter.connection === 'network' && (
              <div className="settings-field settings-field--horizontal">
                <label htmlFor="resto-kp-ip" className="settings-label">
                  <Localized id="workspace-resto-kp-ip">Kitchen Printer IP</Localized>
                </label>
                <input
                  id="resto-kp-ip"
                  type="text"
                  className="settings-input"
                  value={hw.profile?.hardware.kitchenPrinter.devicePath ?? ''}
                  onChange={(e) => {
                    hw.updateKitchenPrinter({ devicePath: e.target.value });
                  }}
                  placeholder="192.168.1.50"
                />
              </div>
            )}
          </div>
        </Card>
      )}

      {hw.error && (
        <div className="settings-error-banner" role="alert">
          {hw.error}
        </div>
      )}

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
