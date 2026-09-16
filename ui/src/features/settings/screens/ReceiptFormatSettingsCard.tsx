/**
 * ReceiptFormatSettingsCard — the receipt-format card for the
 * Settings → Business Defaults screen (receipt-format axis, the LAST
 * missing saas-2 L167 axis).
 *
 * Edits BOTH halves: the presentational LAYOUT at the workspace layer
 * (paper width, margins, print copies, footer note) and the statutory
 * CONTENT at the legal-entity layer (required elements, footer text,
 * tax/currency lines, decimal separator — W2-C, through
 * set_receipt_content_scoped). Tier separation is a contract: the card
 * reads no tier state.
 *
 * Fluent-only copy: `settings-rcptfmt-*` keys in settings.ftl +
 * settings.id.ftl.
 */
import { useCallback, useEffect, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { SettingsScopeTag } from '@/features/settings/SettingsScopeTag';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  getReceiptFormatScoped,
  setReceiptContentScoped,
  setReceiptLayoutScoped,
  type ReceiptContentArgs,
  type ReceiptLayoutArgs,
} from '@/api/receipt-format';
import { getPrimaryLocationScoped } from '@/api/locations';
import { l10nErrorMessage } from '@/utils/app-error';
import './ReceiptFormatSettingsCard.css';

/** Draft layout row — `null` = fall through to the next layer. */
interface DraftLayout {
  paperWidthMm: number | null;
  marginTopMm: number | null;
  marginBottomMm: number | null;
  marginLeftMm: number | null;
  marginRightMm: number | null;
  showLogo: boolean | null;
  printCopies: number | null;
  showTableNumber: boolean | null;
  footerNote: string | null;
}

/** The closed element enum (mirrors core `RECEIPT_ELEMENT_CODES` — the
 *  same codes the `settings-rcptfmt-element-*` Fluent keys localize). */
const RECEIPT_ELEMENT_CODES = [
  'store_name',
  'store_address',
  'tax_id',
  'date',
  'receipt_number',
  'items',
  'subtotal',
  'tax',
  'total',
  'payments',
] as const;

/** Content provenance → Fluent key. */
function contentSourceKey(source: string): string {
  switch (source) {
    case 'entity':
      return 'settings-rcptfmt-source-legal-entity';
    case 'legacy':
      return 'settings-rcptfmt-source-legacy';
    default:
      return 'settings-rcptfmt-source-unset';
  }
}

/** Layout provenance → Fluent key. */
function layoutSourceKey(source: string): string {
  switch (source) {
    case 'terminal':
      return 'settings-rcptfmt-source-terminal';
    case 'workspace':
      return 'settings-rcptfmt-source-workspace';
    case 'legacy':
      return 'settings-rcptfmt-source-legacy';
    default:
      return 'settings-rcptfmt-source-unset';
  }
}

export function ReceiptFormatSettingsCard() {
  const { sessionToken } = useWorkspace();
  const { l10n } = useLocalization();

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [requiredFields, setRequiredFields] = useState<string[]>([]);
  const [contentSource, setContentSource] = useState<string>('unset');
  const [layoutSource, setLayoutSource] = useState<string>('unset');
  const [draft, setDraft] = useState<DraftLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Statutory-content draft (W2-C) — the entity-layer half. The content
  // write owns requiredFields; the display list above is its mirror.
  const [contentDraft, setContentDraft] = useState<ReceiptContentArgs | null>(null);
  const [contentSaving, setContentSaving] = useState(false);
  const [contentSaved, setContentSaved] = useState(false);
  const [contentSaveError, setContentSaveError] = useState<string | null>(null);

  const load = useCallback(
    async (token: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const primary = await getPrimaryLocationScoped(token);
        if (!primary) {
          setWorkspaceId(null);
          setDraft(null);
          setLoading(false);
          return;
        }
        const eff = await getReceiptFormatScoped(token, null, primary.id);
        setWorkspaceId(primary.id);
        setRequiredFields(eff.content?.requiredFields ?? []);
        setContentSource(eff.contentSource);
        setLayoutSource(eff.layoutSource);
        setDraft({ ...eff.layout });
        setSaved(false);
        setContentDraft(
          eff.content
            ? {
                requiredFields: eff.content.requiredFields,
                footerText: eff.content.footerText,
                showTax: eff.content.showTax,
                showCurrency: eff.content.showCurrency,
                decimalSeparator: eff.content.decimalSeparator,
              }
            : { requiredFields: [], footerText: '', showTax: true, showCurrency: false, decimalSeparator: 'dot' },
        );
        setContentSaved(false);
        setContentSaveError(null);
      } catch (err) {
        setLoadError(l10nErrorMessage(err, l10n, 'settings-rcptfmt-error-load'));
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

  const update = useCallback((patch: Partial<DraftLayout>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!sessionToken || !workspaceId || !draft) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const payload: ReceiptLayoutArgs = {
      paperWidthMm: draft.paperWidthMm,
      marginTopMm: draft.marginTopMm,
      marginBottomMm: draft.marginBottomMm,
      marginLeftMm: draft.marginLeftMm,
      marginRightMm: draft.marginRightMm,
      showLogo: draft.showLogo,
      printCopies: draft.printCopies,
      showTableNumber: draft.showTableNumber,
      footerNote: draft.footerNote,
    };
    try {
      const eff = await setReceiptLayoutScoped(sessionToken, workspaceId, payload);
      setRequiredFields(eff.content?.requiredFields ?? requiredFields);
      setContentSource(eff.contentSource);
      setLayoutSource(eff.layoutSource);
      setDraft({ ...eff.layout });
      setSaved(true);
    } catch (err) {
      setSaveError(l10nErrorMessage(err, l10n, 'settings-rcptfmt-error-save'));
    } finally {
      setSaving(false);
    }
  }, [sessionToken, workspaceId, draft, l10n, requiredFields]);

  const updateContent = useCallback((patch: Partial<ReceiptContentArgs>) => {
    setContentDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setContentSaved(false);
  }, []);

  const toggleRequiredField = useCallback((code: string) => {
    setContentDraft((prev) => {
      if (!prev) return prev;
      const has = prev.requiredFields.includes(code);
      return {
        ...prev,
        requiredFields: has
          ? prev.requiredFields.filter((c) => c !== code)
          : [...prev.requiredFields, code],
      };
    });
    setContentSaved(false);
  }, []);

  const handleContentSave = useCallback(async () => {
    if (!sessionToken || !contentDraft) return;
    setContentSaving(true);
    setContentSaveError(null);
    setContentSaved(false);
    try {
      const eff = await setReceiptContentScoped(sessionToken, contentDraft);
      setRequiredFields(eff.content?.requiredFields ?? contentDraft.requiredFields);
      setContentSource(eff.contentSource);
      setLayoutSource(eff.layoutSource);
      setDraft((prev) => (prev ? { ...prev, ...eff.layout } : prev));
      setContentSaved(true);
    } catch (err) {
      setContentSaveError(l10nErrorMessage(err, l10n, 'settings-rcptfmt-content-error-save'));
    } finally {
      setContentSaving(false);
    }
  }, [sessionToken, contentDraft, l10n]);

  if (loading) {
    return (
      <Card shadow="sm">
        <p className="rcptfmt-loading">
          <Localized id="settings-section-loading">Loading…</Localized>
        </p>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card shadow="sm">
        <p className="rcptfmt-error" role="alert">
          {loadError}
        </p>
      </Card>
    );
  }

  if (!workspaceId || !draft) {
    return (
      <Card shadow="sm">
        <p className="rcptfmt-empty">
          <Localized id="settings-rcptfmt-no-location">No location to configure yet.</Localized>
        </p>
      </Card>
    );
  }

  return (
    <Card
      shadow="sm"
      header={
        <div className="rcptfmt-header">
          <Localized id="settings-rcptfmt-title">
            <h2 className="settings-section-title">Receipt format</h2>
          </Localized>
          <SettingsScopeTag scope="location" />
        </div>
      }
    >
      <p className="rcptfmt-intro">
        <Localized id="settings-rcptfmt-subtitle">
          How receipts print at this location.
        </Localized>
      </p>
      <div className="rcptfmt-content">
        <span className="rcptfmt-content-label">
          <Localized id="settings-rcptfmt-content-label">Statutory content</Localized>
        </span>
        <span className="rcptfmt-content-source">
          <Localized id={contentSourceKey(contentSource)}>{contentSource}</Localized>
        </span>
        {contentSource === 'unset' && (
          <span className="rcptfmt-content-none">
            <Localized id="settings-rcptfmt-content-none">
              No market content configured.
            </Localized>
          </span>
        )}
        {contentDraft && (
          <div>
            <span>
              <Localized id="settings-rcptfmt-required-fields">Market-mandated elements</Localized>
            </span>
            <div>
              {RECEIPT_ELEMENT_CODES.map((code) => (
                <span key={code}>
                  <input
                    type="checkbox"
                    id={`rcptfmt-req-${code}`}
                    checked={contentDraft.requiredFields.includes(code)}
                    onChange={() => toggleRequiredField(code)}
                  />
                  <label htmlFor={`rcptfmt-req-${code}`}>
                    <Localized id={`settings-rcptfmt-element-${code}`}>{code}</Localized>
                  </label>
                </span>
              ))}
            </div>
            <div className="rcptfmt-row">
              <span id="rcptfmt-footer-text-label">
                <Localized id="settings-rcptfmt-footer-text">Footer text</Localized>
              </span>
              <input
                type="text"
                aria-labelledby="rcptfmt-footer-text-label"
                value={contentDraft.footerText}
                onChange={(e) => updateContent({ footerText: e.target.value })}
              />
            </div>
            <div className="rcptfmt-check">
              <input
                type="checkbox"
                id="rcptfmt-show-tax"
                checked={contentDraft.showTax}
                onChange={(e) => updateContent({ showTax: e.target.checked })}
              />
              <label htmlFor="rcptfmt-show-tax">
                <Localized id="settings-rcptfmt-show-tax">Print tax line</Localized>
              </label>
            </div>
            <div className="rcptfmt-check">
              <input
                type="checkbox"
                id="rcptfmt-show-currency"
                checked={contentDraft.showCurrency}
                onChange={(e) => updateContent({ showCurrency: e.target.checked })}
              />
              <label htmlFor="rcptfmt-show-currency">
                <Localized id="settings-rcptfmt-show-currency">Currency symbol prefix</Localized>
              </label>
            </div>
            <div className="rcptfmt-row">
              <span id="rcptfmt-decimal-label">
                <Localized id="settings-rcptfmt-decimal-separator">Decimal separator</Localized>
              </span>
              <select
                aria-labelledby="rcptfmt-decimal-label"
                value={contentDraft.decimalSeparator}
                onChange={(e) => updateContent({ decimalSeparator: e.target.value })}
              >
                <option value="dot">
                  <Localized id="settings-rcptfmt-sep-dot">Dot (1,234.56)</Localized>
                </option>
                <option value="comma">
                  <Localized id="settings-rcptfmt-sep-comma">Comma (1.234,56)</Localized>
                </option>
                <option value="none">
                  <Localized id="settings-rcptfmt-sep-none">None</Localized>
                </option>
              </select>
            </div>
            <p>
              <Localized id="settings-rcptfmt-content-note">
                Written at the market-mandated (legal entity) layer — applies to every location of this entity.
              </Localized>
            </p>
            <div className="rcptfmt-actions">
              <button
                type="button"
                className="rcptfmt-save"
                onClick={() => { void handleContentSave(); }}
                disabled={contentSaving}
              >
                {contentSaving ? (
                  <Localized id="settings-rcptfmt-content-saving">Saving…</Localized>
                ) : (
                  <Localized id="settings-rcptfmt-content-save">Save statutory content</Localized>
                )}
              </button>
              {contentSaved && (
                <span className="rcptfmt-status" role="status">
                  <Localized id="settings-rcptfmt-content-saved">Statutory content saved.</Localized>
                </span>
              )}
              {contentSaveError && (
                <span className="rcptfmt-error" role="alert">
                  {contentSaveError}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      <div>
        <Localized id={layoutSourceKey(layoutSource)}>{layoutSource}</Localized>
      </div>
      <div className="rcptfmt-rows">
        <div className="rcptfmt-row">
          <span id="rcptfmt-paper-width-label">
            <Localized id="settings-rcptfmt-paper-width">Paper width (mm, 20–120)</Localized>
          </span>
          <input
            type="number"
            min={20}
            max={120}
            aria-labelledby="rcptfmt-paper-width-label"
            value={draft.paperWidthMm ?? ''}
            onChange={(e) =>
              update({ paperWidthMm: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </div>
        <div className="rcptfmt-row">
          <span id="rcptfmt-margin-top-label">
            <Localized id="settings-rcptfmt-margin-top">Top margin (mm)</Localized>
          </span>
          <input
            type="number"
            min={0}
            aria-labelledby="rcptfmt-margin-top-label"
            value={draft.marginTopMm ?? ''}
            onChange={(e) =>
              update({ marginTopMm: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </div>
        <div className="rcptfmt-row">
          <span id="rcptfmt-margin-bottom-label">
            <Localized id="settings-rcptfmt-margin-bottom">Bottom margin (mm)</Localized>
          </span>
          <input
            type="number"
            min={0}
            aria-labelledby="rcptfmt-margin-bottom-label"
            value={draft.marginBottomMm ?? ''}
            onChange={(e) =>
              update({ marginBottomMm: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </div>
        <div className="rcptfmt-check">
          <input
            type="checkbox"
            id="rcptfmt-show-table"
            checked={draft.showTableNumber === true}
            onChange={(e) => update({ showTableNumber: e.target.checked })}
          />
          <label htmlFor="rcptfmt-show-table">
            <Localized id="settings-rcptfmt-show-table">Show table number</Localized>
          </label>
        </div>
        <div className="rcptfmt-check">
          <input
            type="checkbox"
            id="rcptfmt-show-logo"
            checked={draft.showLogo === true}
            onChange={(e) => update({ showLogo: e.target.checked })}
          />
          <label htmlFor="rcptfmt-show-logo">
            <Localized id="settings-rcptfmt-show-logo">Print store logo</Localized>
          </label>
        </div>
      </div>
      <div className="rcptfmt-actions">
        <button
          type="button"
          className="rcptfmt-save"
          onClick={() => { void handleSave(); }}
          disabled={saving}
        >
          {saving ? (
            <Localized id="settings-rcptfmt-saving">Saving…</Localized>
          ) : (
            <Localized id="settings-rcptfmt-save">Save receipt format</Localized>
          )}
        </button>
        {saved && (
          <span className="rcptfmt-status" role="status">
            <Localized id="settings-rcptfmt-saved">Receipt format saved.</Localized>
          </span>
        )}
        {saveError && (
          <span className="rcptfmt-error" role="alert">
            {saveError}
          </span>
        )}
      </div>
    </Card>
  );
}
