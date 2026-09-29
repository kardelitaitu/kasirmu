import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTerminalHardware } from '@/hooks/useTerminalHardware';
import { getPrimaryLocationScoped } from '@/api/locations';
import {
  getLocalPaymentMethodsScoped,
  setLocalPaymentMethodsScoped,
  readStaticQrPayload,
  writeStaticQrPayload,
  type LocalPaymentRail,
  type LocalPaymentRailArgs,
} from '@/api/local-payment';
import {
  listEdcTerminalsScoped,
  edcTerminalStatusScoped,
  type EdcTerminalDto,
} from '@/api/edc';
import SettingsSelect from '@/features/settings/SettingsSelect';
import './RestaurantSettingsScreens.css';

export interface RestaurantPaymentsScreenProps {
  terminalId?: string;
  onSaved?: () => void;
  onBack?: () => void;
}

interface DraftRail {
  rail_code: string;
  label: string;
  is_enabled: boolean;
  parameters: string;
}

export function RestaurantPaymentsScreen({
  terminalId: propTerminalId,
  onSaved,
}: RestaurantPaymentsScreenProps) {
  const { sessionToken, terminalId: contextTerminalId } = useWorkspace();
  const effectiveTerminalId = propTerminalId || contextTerminalId || '';
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const hw = useTerminalHardware(effectiveTerminalId);

  const [locationId, setLocationId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRail[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edcTerminals, setEdcTerminals] = useState<EdcTerminalDto[]>([]);
  const [defaultEdcTerminalId, setDefaultEdcTerminalId] = useState('');
  const [testingEdc, setTestingEdc] = useState(false);

  // New rail draft state
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');

  // Dirty state tracking
  const originalsRef = useRef<{
    drafts: DraftRail[];
    defaultEdcTerminalId: string;
  }>({ drafts: [], defaultEdcTerminalId: '' });
  const [dirtyVersion, setDirtyVersion] = useState(0);
  const hwInitializedRef = useRef(false);

  // Sync initial EDC terminal preference from hardware profile without wiping drafts on profile updates
  useEffect(() => {
    if (hwInitializedRef.current || !hw.profile) return;
    const currentEdc = hw.profile.localPrefs?.defaultEdcTerminalId ?? '';
    setDefaultEdcTerminalId(currentEdc);
    originalsRef.current.defaultEdcTerminalId = currentEdc;
    hwInitializedRef.current = true;
    setDirtyVersion((v) => v + 1);
  }, [hw.profile]);

  // Load location, payment rails, and EDC terminals
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    setLoading(true);

    const loadAll = async () => {
      try {
        const [primary, edcList] = await Promise.all([
          getPrimaryLocationScoped(sessionToken),
          listEdcTerminalsScoped(sessionToken).catch(() => [] as EdcTerminalDto[]),
        ]);

        if (cancelled) return;

        if (edcList) {
          setEdcTerminals(edcList.filter((t) => t.isActive));
        }

        if (primary) {
          setLocationId(primary.id);
          const rawRails = await getLocalPaymentMethodsScoped(sessionToken, primary.id);
          if (cancelled) return;

          // Standard core methods to ensure exist in the list
          const coreDefaults: { rail_code: string; label: string; is_enabled: boolean }[] = [
            { rail_code: 'cash', label: 'Cash', is_enabled: true },
            { rail_code: 'card', label: 'Card / EDC Terminal', is_enabled: true },
            { rail_code: 'qris', label: 'QRIS', is_enabled: true },
            { rail_code: 'open_bill', label: 'Open Bill (Table Tab)', is_enabled: true },
            { rail_code: 'credit', label: 'Customer Credit', is_enabled: true },
          ];

          const existingMap = new Map<string, LocalPaymentRail>(
            (rawRails || []).map((r) => [r.rail_code.toLowerCase(), r]),
          );

          const merged: DraftRail[] = [];
          for (const def of coreDefaults) {
            const match = existingMap.get(def.rail_code);
            if (match) {
              merged.push({
                rail_code: match.rail_code,
                label: match.label || def.label,
                is_enabled: match.is_enabled,
                parameters: match.parameters || '{}',
              });
              existingMap.delete(def.rail_code);
            } else {
              merged.push({
                rail_code: def.rail_code,
                label: def.label,
                is_enabled: def.is_enabled,
                parameters: '{}',
              });
            }
          }

          // Append any remaining custom rails
          for (const rem of existingMap.values()) {
            merged.push({
              rail_code: rem.rail_code,
              label: rem.label,
              is_enabled: rem.is_enabled,
              parameters: rem.parameters || '{}',
            });
          }

          setDrafts(merged);
          originalsRef.current.drafts = merged.map((d) => ({ ...d }));
        }
      } catch {
        addToast({
          message: l10n.getString('settings-localpay-error-load') || 'Failed to load payment methods',
          type: 'error',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, l10n, addToast]);

  const dirty = useMemo(() => {
    void dirtyVersion;
    if (defaultEdcTerminalId !== originalsRef.current.defaultEdcTerminalId) return true;
    if (drafts.length !== (originalsRef.current.drafts?.length ?? 0)) return true;
    for (let i = 0; i < drafts.length; i++) {
      const a = drafts[i];
      const b = originalsRef.current.drafts?.[i];
      if (!a || !b) return true;
      if (
        a.rail_code !== b.rail_code ||
        a.label !== b.label ||
        a.is_enabled !== b.is_enabled ||
        a.parameters !== b.parameters
      ) {
        return true;
      }
    }
    return false;
  }, [drafts, defaultEdcTerminalId, dirtyVersion]);

  const handleToggleRail = (index: number, checked: boolean) => {
    setDrafts((prev) => {
      const copy = [...prev];
      const current = copy[index];
      if (!current) return prev;
      copy[index] = { ...current, is_enabled: checked };
      return copy;
    });
  };

  const handleStaticQrChange = (value: string) => {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.rail_code.toLowerCase() === 'qris') {
          return {
            ...d,
            parameters: writeStaticQrPayload(d.parameters, value),
          };
        }
        return d;
      }),
    );
  };

  const handleAddCustomRail = useCallback(() => {
    const code = newCode.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const label = newLabel.trim();
    if (!code || !label) return;
    if (drafts.some((d) => d.rail_code.toLowerCase() === code)) return;

    setDrafts((prev) => [
      ...prev,
      { rail_code: code, label, is_enabled: true, parameters: '{}' },
    ]);
    setNewCode('');
    setNewLabel('');
  }, [newCode, newLabel, drafts]);

  const handleRemoveRail = (index: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Test EDC Terminal ───────────────────────────────────────
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

  // ── Save Handler ────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!sessionToken || !locationId) return;
    setSaving(true);
    try {
      const tasks: Promise<unknown>[] = [];

      // 1. Save workspace / location payment rails
      const payload: LocalPaymentRailArgs[] = drafts.map((d) => ({
        rail_code: d.rail_code,
        label: d.label,
        is_enabled: d.is_enabled,
        parameters: d.parameters,
      }));
      tasks.push(setLocalPaymentMethodsScoped(sessionToken, locationId, payload));

      // 2. Save hardware EDC default terminal preference
      if (effectiveTerminalId && hw.profile) {
        hw.updateLocalPrefs({ defaultEdcTerminalId: defaultEdcTerminalId || undefined });
        tasks.push(hw.save());
      }

      await Promise.all(tasks);

      originalsRef.current = {
        drafts: drafts.map((d) => ({ ...d })),
        defaultEdcTerminalId,
      };
      setDirtyVersion((v) => v + 1);

      addToast({
        message: l10n.getString('restaurant-save-success'),
        type: 'success',
      });

      onSaved?.();
    } catch {
      addToast({
        message: l10n.getString('settings-save-error'),
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [
    sessionToken,
    locationId,
    drafts,
    effectiveTerminalId,
    hw,
    defaultEdcTerminalId,
    onSaved,
    addToast,
    l10n,
  ]);

  const qrisDraft = drafts.find((d) => d.rail_code.toLowerCase() === 'qris');
  const staticQrValue = qrisDraft ? readStaticQrPayload(qrisDraft.parameters) ?? '' : '';

  return (
    <div className="restaurant-settings-screen">
      <div className="restaurant-settings-header">
        <h1 className="restaurant-settings-title">
          <Localized id="restaurant-payments-title">Payment Settings</Localized>
        </h1>
        <p className="restaurant-settings-subtitle">
          <Localized id="restaurant-payments-subtitle">
            Configure payment methods and local payment rails
          </Localized>
        </p>
      </div>

      {loading ? (
        // Was `localpay-loading`, borrowed from LocalPaymentSettingsCard.css —
        // a sheet this screen does not import, so the name resolved nowhere and
        // the rule was never reachable from here. The screen's own sheet owns
        // the loading line now.
        <p className="restaurant-settings-loading">
          <Localized id="settings-section-loading">Loading…</Localized>
        </p>
      ) : (
        <>
          {/* ── Card 1: Core Payment Options ────────────────────── */}
      <Card
        shadow="sm"
        header={
          <div className="restaurant-settings-card-header">
            <div>
              <h2 className="settings-section-title">
                <Localized id="restaurant-payment-methods-heading">Payment Methods</Localized>
              </h2>
              <p>
                <Localized id="restaurant-payment-methods-sub">
                  Enable or disable accepted payment methods at checkout
                </Localized>
              </p>
            </div>
          </div>
        }
      >
        {/* The rails list uses the classes RestaurantSettingsScreens.css already
            defines — restaurant-rails-list / -rail-row / -rail-info / -rail-label /
            -rail-code. Those rules landed with the screen's stylesheet but the
            markup below never adopted them, so it carried the same design as six
            inline style objects and the sheet graded as dead. Wiring the names up
            is what the sheet was written for; the only inline style kept is the
            label's weight, which is a deliberate emphasis on a shared class. */}
        <div className="settings-form">
          <div className="restaurant-rails-list">
          {drafts.map((rail, index) => {
            const isCore = ['cash', 'card', 'qris', 'open_bill', 'credit'].includes(
              rail.rail_code.toLowerCase(),
            );
            return (
              <div className="restaurant-rail-row" key={rail.rail_code}>
                <div className="restaurant-rail-info">
                  <label
                    htmlFor={`rail-toggle-${rail.rail_code}`}
                    className="restaurant-rail-label"
                  >
                    {rail.label}
                  </label>
                  <span className="restaurant-rail-code">{rail.rail_code}</span>
                </div>
                <div className="restaurant-rail-actions">
                  {!isCore && (
                    <button
                      type="button"
                      className="restaurant-rail-remove"
                      onClick={() => handleRemoveRail(index)}
                      aria-label={`Remove ${rail.label}`}
                    >
                      &times;
                    </button>
                  )}
                  <span className="settings-toggle">
                    <span className="sr-only">Toggle {rail.label}</span>
                    <span className="settings-toggle-switch">
                      <input
                        id={`rail-toggle-${rail.rail_code}`}
                        type="checkbox"
                        role="switch"
                        checked={rail.is_enabled}
                        aria-checked={rail.is_enabled}
                        onChange={(e) => handleToggleRail(index, e.target.checked)}
                      />
                      <span className="settings-toggle-slider" />
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </Card>

      {/* ── Card 2: QRIS Configuration (Static QR) ─────────── */}
      {qrisDraft && qrisDraft.is_enabled && (
        <Card
          shadow="sm"
          header={
            <div className="restaurant-settings-card-header">
              <div>
                <h2 className="settings-section-title">QRIS Configuration</h2>
                <p>Static EMVCo QR code string for customer scans at counter or table</p>
              </div>
            </div>
          }
        >
          <div className="settings-form">
            <div className="settings-field">
              <label htmlFor="resto-static-qris" className="settings-label">
                <Localized id="settings-localpay-static-qr-label">Static QR payload</Localized>
              </label>
              <div className="restaurant-static-qr-box">
                <textarea
                  id="resto-static-qris"
                  className="settings-input"
                  rows={3}
                  placeholder="00020101021126580014ID.LINKAJA.WWW0118936009110022201389..."
                  value={staticQrValue}
                  onChange={(e) => handleStaticQrChange(e.target.value)}
                  spellCheck={false}
                />
                <p className="settings-hint">
                  Paste the merchant QR string (EMVCo format) to enable in-app counter QR presentation.
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── Card 3: Additional Payment Rails ────────────────── */}
      <Card
        shadow="sm"
        header={
          <div className="restaurant-settings-card-header">
            <div>
              <h2 className="settings-section-title">
                <Localized id="restaurant-payment-rails-heading">Local Payment Rails</Localized>
              </h2>
              <p>
                <Localized id="restaurant-payment-rails-sub">
                  Additional digital rails and custom tender options
                </Localized>
              </p>
            </div>
          </div>
        }
      >
        <div className="settings-form">
          <div className="restaurant-rail-add">
            <input
              type="text"
              className="settings-input"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="e.g. gopay, ovo, bca_va"
              aria-label="New rail code"
            />
            <input
              type="text"
              className="settings-input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. GoPay QR, OVO"
              aria-label="New rail display label"
            />
            <Button
              variant="secondary"
              onClick={handleAddCustomRail}
              disabled={!newCode.trim() || !newLabel.trim()}
            >
              <Localized id="settings-localpay-add">Add rail</Localized>
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Card 4: EDC Hardware Preferences ────────────────── */}
      <Card
        shadow="sm"
        header={
          <div className="restaurant-settings-card-header">
            <div>
              <h2 className="settings-section-title">
                <Localized id="restaurant-edc-heading">EDC Terminal (Card Payment)</Localized>
              </h2>
              <p>
                <Localized id="restaurant-edc-sub">
                  Configure register-local card payment terminal
                </Localized>
              </p>
            </div>
          </div>
        }
      >
        <div className="settings-form">
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="resto-default-edc" className="settings-label">
              <Localized id="settings-edc-default-select">Default EDC Terminal</Localized>
            </label>
            <SettingsSelect
              id="resto-default-edc"
              value={defaultEdcTerminalId}
              onChange={(v) => setDefaultEdcTerminalId(v)}
              options={[
                { value: '', label: 'None (Manual Card Entry)' },
                ...edcTerminals.map((t) => ({
                  value: t.id,
                  label: `${t.name} (${t.transport} - ${t.address})`,
                })),
              ]}
            />
          </div>

          {defaultEdcTerminalId && (
            <div className="settings-actions" style={{ justifyContent: 'flex-start', marginTop: '8px' }}>
              <Button
                variant="secondary"
                onClick={handleTestEdc}
                disabled={testingEdc}
              >
                <Localized id="settings-edc-test">Test Connection</Localized>
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* ── Actions ─────────────────────────────────────────── */}
      <div className="restaurant-settings-actions">
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          <Localized id="save">Save</Localized>
        </Button>
      </div>
      </>
      )}
    </div>
  );
}

export default RestaurantPaymentsScreen;
