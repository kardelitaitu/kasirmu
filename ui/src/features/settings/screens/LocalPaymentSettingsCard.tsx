/**
 * LocalPaymentSettingsCard — the local-payment-rails card for the
 * Settings → Business Defaults screen (regional slice 6).
 *
 * Sits beside RegionalSettingsCard and edits the same location layer:
 * which payment rails the site offers, per rail enabled/disabled with
 * provenance from the entity→location chain. Tier separation is a
 * contract, not a UX choice: the card never shows or reads tier state
 * (`supports_qris` is a plan answer from the license layer), and the
 * write path rejects credential-shaped parameters server-side.
 *
 * Fluent-only copy: `settings-localpay-*` keys in settings.ftl +
 * settings.id.ftl.
 */
import { useCallback, useEffect, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { SettingsScopeTag } from '@/features/settings/SettingsScopeTag';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  getLocalPaymentMethodsScoped,
  setLocalPaymentMethodsScoped,
  readStaticQrPayload,
  writeStaticQrPayload,
  type LocalPaymentRailArgs,
  type PaymentRailScope,
} from '@/api/local-payment';
import { getPrimaryLocationScoped } from '@/api/locations';
import { l10nErrorMessage } from '@/utils/app-error';
import './LocalPaymentSettingsCard.css';

/** The provenance row shown per rail. */
function provenanceKey(scope: PaymentRailScope): string {
  return scope === 'location'
    ? 'settings-localpay-scope-location'
    : 'settings-localpay-scope-legal-entity';
}

/** Draft rail row: an existing effective rail or one the operator added. */
interface DraftRail {
  rail_code: string;
  label: string;
  is_enabled: boolean;
  parameters: string;
  /** Where this row came from — rows the operator adds are 'location'. */
  scope: PaymentRailScope;
}

export function LocalPaymentSettingsCard() {
  const { sessionToken } = useWorkspace();
  const { l10n } = useLocalization();

  const [locationId, setLocationId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRail[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const load = useCallback(
    async (token: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const primary = await getPrimaryLocationScoped(token);
        if (!primary) {
          setLocationId(null);
          setDrafts([]);
          setLoading(false);
          return;
        }
        const rows = await getLocalPaymentMethodsScoped(token, primary.id);
        setLocationId(primary.id);
        setDrafts(rows.map((r) => ({ ...r })));
        setSaved(false);
      } catch (err) {
        setLoadError(l10nErrorMessage(err, l10n, 'settings-localpay-error-load'));
      } finally {
        setLoading(false);
      }
    },
    [l10n],
  );

  useEffect(() => {
    if (!sessionToken) return;
    void load(sessionToken);
  }, [sessionToken, load]);

  const handleSave = useCallback(async () => {
    if (!sessionToken || !locationId) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const payload: LocalPaymentRailArgs[] = drafts.map((d) => ({
      rail_code: d.rail_code,
      label: d.label,
      is_enabled: d.is_enabled,
      parameters: d.parameters,
    }));
    try {
      const rows = await setLocalPaymentMethodsScoped(sessionToken, locationId, payload);
      setDrafts(rows.map((r) => ({ ...r })));
      setSaved(true);
    } catch (err) {
      setSaveError(l10nErrorMessage(err, l10n, 'settings-localpay-error-save'));
    } finally {
      setSaving(false);
    }
  }, [sessionToken, locationId, drafts, l10n]);

  const handleAddRail = useCallback(() => {
    const code = newCode.trim();
    const label = newLabel.trim();
    if (!code || !label) return;
    if (drafts.some((d) => d.rail_code.toLowerCase() === code.toLowerCase())) return;
    setDrafts((prev) => [
      ...prev,
      { rail_code: code, label, is_enabled: true, parameters: '{}', scope: 'location' },
    ]);
    setNewCode('');
    setNewLabel('');
    setSaved(false);
  }, [newCode, newLabel, drafts]);

  if (loading) {
    return (
      <Card shadow="sm">
        <p className="localpay-loading">
          <Localized id="settings-section-loading">Loading…</Localized>
        </p>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card shadow="sm">
        <p className="localpay-error" role="alert">
          {loadError}
        </p>
      </Card>
    );
  }

  if (!locationId) {
    return (
      <Card shadow="sm">
        <p className="localpay-empty">
          <Localized id="settings-localpay-no-location">No location to configure yet.</Localized>
        </p>
      </Card>
    );
  }

  return (
    <Card
      shadow="sm"
      header={
        <div className="localpay-header">
          <Localized id="settings-localpay-title">
            <h2 className="settings-section-title">Local payment methods</h2>
          </Localized>
          <SettingsScopeTag scope="location" />
        </div>
      }
    >
      <p className="localpay-intro">
        <Localized id="settings-localpay-subtitle">
          Which payment rails this market and site offer.
        </Localized>
      </p>
      <div className="localpay-rows">
        {drafts.map((draft, index) => (
          <div className="localpay-row" key={`${draft.rail_code}-${index}`}>
            <label className="localpay-toggle">
              <input
                type="checkbox"
                checked={draft.is_enabled}
                onChange={(e) => {
                  const next = [...drafts];
                  next[index] = { ...draft, is_enabled: e.target.checked };
                  setDrafts(next);
                  setSaved(false);
                }}
              />
              <span className="localpay-label">{draft.label}</span>
            </label>
            <span className="localpay-provenance">
              <Localized id={provenanceKey(draft.scope)}>{draft.scope}</Localized>
            </span>
            {draft.rail_code === 'qris' && (
              // agents-5 R2: the manual QRIS dialog shows this real
              // EMVCo string as a scannable QR (the retired demo grid
              // drew fake cells). Market metadata, not a credential —
              // the same public code a counter poster prints.
              <label className="localpay-static-qr">
                <Localized id="settings-localpay-static-qr-label">
                  <span className="localpay-static-qr-label">Static QR payload</span>
                </Localized>
                <textarea
                  className="localpay-static-qr-input"
                  value={readStaticQrPayload(draft.parameters) ?? ''}
                  onChange={(e) => {
                    const next = [...drafts];
                    next[index] = { ...draft, parameters: writeStaticQrPayload(draft.parameters, e.target.value) };
                    setDrafts(next);
                    setSaved(false);
                  }}
                  aria-label={l10n.getString('settings-localpay-static-qr-label')}
                  rows={3}
                  spellCheck={false}
                />
              </label>
            )}
          </div>
        ))}
        {drafts.length === 0 && (
          <p className="localpay-empty-list">
            <Localized id="settings-localpay-empty-list">
              No rails recorded yet — add the ones this site offers.
            </Localized>
          </p>
        )}
      </div>
      <div className="localpay-add">
        <input
          type="text"
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          placeholder={l10n.getString('settings-localpay-code-placeholder') || 'rail code, e.g. qris'}
          aria-label={l10n.getString('settings-localpay-code-label') || 'Rail code'}
          autoComplete="off"
          spellCheck={false}
        />
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder={l10n.getString('settings-localpay-label-placeholder') || 'display label, e.g. QRIS'}
          aria-label={l10n.getString('settings-localpay-label-label') || 'Display label'}
          autoComplete="off"
        />
        <button
          type="button"
          className="localpay-add-button"
          onClick={handleAddRail}
          disabled={!newCode.trim() || !newLabel.trim()}
        >
          <Localized id="settings-localpay-add">Add rail</Localized>
        </button>
      </div>
      <div className="localpay-actions">
        <button
          type="button"
          className="localpay-save"
          onClick={() => { void handleSave(); }}
          disabled={saving}
        >
          {saving ? (
            <Localized id="settings-localpay-saving">Saving…</Localized>
          ) : (
            <Localized id="settings-localpay-save">Save payment methods</Localized>
          )}
        </button>
        {saved && (
          <span className="localpay-status" role="status">
            <Localized id="settings-localpay-saved">Payment methods saved.</Localized>
          </span>
        )}
        {saveError && (
          <span className="localpay-error" role="alert">
            {saveError}
          </span>
        )}
      </div>
    </Card>
  );
}
