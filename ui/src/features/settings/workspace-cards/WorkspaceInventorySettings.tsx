import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useToast } from '@/frontend/shared/Toast';
import { useSettings } from '@/contexts/SettingsContext';
import { getSettingScoped, setSettingsScoped } from '@/api/settings';
import type { WorkspaceCardProps } from './types';
import { hasChanges } from './helpers';

// ── Component ────────────────────────────────────────────────────────

/**
 * Workspace card for Inventory settings: low stock threshold and
 * deduction location priority rules.
 *
 * Consumes `useSettings()` for store-level inventory configuration.
 */
export function WorkspaceInventorySettings({
  sessionToken,
  // `userId` is deliberately not destructured. It stays on the props interface so the call sites in
  // SettingsPage keep typechecking, but the component body never read it -- the only thing keeping
  // it "used" was the useCallback dependency array further down, which eslint had already flagged
  // as an unnecessary dependency. See docs/plans/0.0.36-backlog.md item 69.
  locationId,
  variant = 'full-page',
  onSaved,
}: WorkspaceCardProps) {
  // ── Draft state ──────────────────────────────────────────────

  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const { markSettingsUpdated } = useSettings();

  const [lowStockThreshold, setLowStockThreshold] = useState(10);
  const [deductionPreferWarehouse, setDeductionPreferWarehouse] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dirtyVersion, setDirtyVersion] = useState(0);
  // The session the originals below were fetched for. Replaces `loaded` as the fetch guard so a
  // store switch re-reads; `loaded` stays for the dirty-tracking memo.
  const loadedForRef = useRef<string | undefined>(undefined);

  const originalsRef = useRef<Record<string, unknown>>({
    lowStockThreshold, deductionPreferWarehouse,
  });
  // Keys the user has edited while the initial load is in flight — the
  // load must never silently revert them (draft-overwrite race).
  const touchedRef = useRef<Set<'lowStockThreshold' | 'deductionPreferWarehouse'>>(new Set());

  const dirty = useMemo(() => hasChanges(
    { lowStockThreshold, deductionPreferWarehouse } as Record<string, unknown>,
    originalsRef.current,
  ), [lowStockThreshold, deductionPreferWarehouse, loaded, dirtyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load from backend ───────────────────────────────────────

  useEffect(() => {
    // `loaded` is a one-way latch (set true at :74, never reset), so adding sessionToken to the
    // deps below would NOT have re-fetched -- the guard at :54 short-circuits every later run.
    // Latching on the token instead: the body already refuses to overwrite fields the operator
    // has touched (:61, :64), which is the signature of a function written to be re-entered.
    if (loadedForRef.current === sessionToken) return;
    loadedForRef.current = sessionToken;

    Promise.all([
      getSettingScoped(sessionToken ?? null, 'inventory.low_stock_threshold'),
      getSettingScoped(sessionToken ?? null, 'inventory.deduction_prefer_warehouse'),
    ]).then(([thresholdRaw, preferWhRaw]) => {
      const t = parseInt(thresholdRaw ?? '', 10);
      if (!touchedRef.current.has('lowStockThreshold') && !isNaN(t) && t >= 0) {
        setLowStockThreshold(t);
      }
      if (!touchedRef.current.has('deductionPreferWarehouse')) {
        setDeductionPreferWarehouse(preferWhRaw === 'true');
      }
      originalsRef.current = {
        lowStockThreshold: !isNaN(t) && t >= 0 ? t : 10,
        deductionPreferWarehouse: preferWhRaw === 'true',
      };
    }).catch(() => {
      originalsRef.current = { lowStockThreshold: 10, deductionPreferWarehouse: false };
    }).finally(() => {
      setLoaded(true);
    });
    // sessionToken is a prop (:21) read at :57 and :58. Without it here, a card mounted before a
    // store switch kept showing the previous store's thresholds. `loaded` still drives the
    // dirty-tracking memo at :49, so it is kept rather than replaced.
  }, [loaded, sessionToken]);

  // ── Save ─────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await setSettingsScoped(sessionToken ?? null, {
        'inventory.low_stock_threshold': String(lowStockThreshold),
        'inventory.deduction_prefer_warehouse': String(deductionPreferWarehouse),
      });
      originalsRef.current = { lowStockThreshold, deductionPreferWarehouse };
      setDirtyVersion((v) => v + 1);

      // Notify other cards that inventory settings changed
      markSettingsUpdated(['inventory.low_stock_threshold', 'inventory.deduction_prefer_warehouse']);

      onSaved?.();
    } catch {
      addToast({ message: l10n.getString('settings-save-error'), type: 'error' });
    } finally {
      setSaving(false);
    }
    // sessionToken is read at :83 by setSettingsScoped. `userId` was listed and is a different
    // value, so it never covered the token: saving after a store switch wrote the previous
    // store's thresholds (or failed on the destroyed session) while the toast said it saved.
    // `userId` is now gone from this array -- nothing in the component read it, and this entry was
    // its only use, which is why removing it surfaced the dead prop below.
  }, [lowStockThreshold, deductionPreferWarehouse, onSaved, addToast, l10n, markSettingsUpdated, sessionToken]);

  const isCompact = variant === 'inspector-drawer';

  return (
    <ErrorBoundary>
      {/* Low stock threshold */}
      <Card
        shadow="sm"
        header={
          <h2 className="settings-section-title">
            <Localized id="workspace-inv-threshold-heading">Stock Thresholds</Localized>
          </h2>
        }
      >
        <div className="settings-form">
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="inv-low-stock" className="settings-label">
              <Localized id="workspace-inv-low-stock">Low Stock Alert At</Localized>
            </label>
            <input
              id="inv-low-stock"
              type="number"
              className="settings-input"
              min={0}
              max={999}
              value={lowStockThreshold}
              onChange={(e) => {
                touchedRef.current.add('lowStockThreshold');
                // Threshold is a whole number — ignore fractional in-progress
                // input instead of silently truncating it via parseInt.
                const v = Number(e.target.value);
                if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                  setLowStockThreshold(e.target.value === '' ? 0 : v);
                }
              }}
            />
            {!isCompact && (
              <span className="settings-range-value">
                <Localized id="workspace-inv-units" vars={{ count: lowStockThreshold }}>
                  items
                </Localized>
              </span>
            )}
          </div>
          {!isCompact && (
            <p className="settings-hint">
              <Localized id="workspace-inv-threshold-hint">
                <span>Alert when stock falls below this quantity</span>
              </Localized>
            </p>
          )}
        </div>
      </Card>

      {/* Deduction rules */}
      {locationId && (
        <Card
          shadow="sm"
          header={
            <h2 className="settings-section-title">
              <Localized id="workspace-inv-deduction-heading">Deduction Rules</Localized>
            </h2>
          }
        >
          <div className="settings-form">
            <div className="settings-field settings-field--horizontal">
          <label htmlFor="inv-deduction-wh" className="settings-label">
            <Localized id="workspace-inv-deduction-warehouse">Prefer Warehouse First</Localized>
          </label>
              <span className="settings-toggle">
                <span className="sr-only"><Localized id="toggle">Toggle</Localized></span>
                <span className="settings-toggle-switch">
                  <input
                    id="inv-deduction-wh"
                    type="checkbox"
                    role="switch"
                    checked={deductionPreferWarehouse}
                    aria-checked={deductionPreferWarehouse}
                    onChange={(e) => {
                      touchedRef.current.add('deductionPreferWarehouse');
                      setDeductionPreferWarehouse(e.target.checked);
                    }}
                  />
                  <span className="settings-toggle-slider" />
                </span>
              </span>
            </div>
            {!isCompact && (
              <p className="settings-hint">
                <Localized id="workspace-inv-deduction-hint">
                  <span>When enabled, stock is deducted from warehouse before store shelves</span>
                </Localized>
              </p>
            )}
          </div>
        </Card>
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
