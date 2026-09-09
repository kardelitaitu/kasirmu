/**
 * StatutoryNumberingCard — the (legal entity × document kind) number-series
 * card for Settings → Business Defaults (W2-B, regional numbering axis).
 *
 * Reads and writes ONE `DocumentNumberSequence` per pair through
 * `get/upsert_document_number_sequence_scoped`. Two contracts the copy says
 * out loud, because both are silent-money bugs if an operator has to guess:
 *
 * 1. Reconfiguring prefix / padding / reset period NEVER resets the counter —
 *    a statutory series must not gap. So `current_value` is shown as read-only
 *    context and is not an input at all.
 * 2. A `null` read means "this pair is not configured yet", not an error. The
 *    first save creates the row; the defaults offered are the inert ones
 *    (no prefix, no padding, never resets) so opening the card and saving
 *    cannot change how numbers already issued read.
 *
 * `documentKind` is a CLOSED select here on purpose. The schema stores it as
 * free `TEXT` and only the `(legal_entity_id, document_kind)` pair is UNIQUE,
 * so a typo would not be rejected — it would silently open a PARALLEL series
 * whose counter starts at zero, which is exactly the outcome statutory
 * numbering exists to prevent. The select guards it until core owns an enum.
 *
 * Fluent-only copy: `settings-fiscalnum-*` keys in settings.ftl + settings.id.ftl.
 */
import { useCallback, useEffect, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { SettingsScopeTag } from '@/features/settings/SettingsScopeTag';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  getDocumentNumberSequenceScoped,
  upsertDocumentNumberSequenceScoped,
  type DocumentNumberSequence,
} from '@/api/fiscal';
import { listLegalEntitiesScoped, type LegalEntity } from '@/api/legalEntities';
import { l10nErrorMessage } from '@/utils/app-error';
import './StatutoryNumberingCard.css';

/** The series kinds this card can number. Adding one is a deliberate act:
 *  each code is a separate statutory series per legal entity. */
const DOCUMENT_KINDS = ['receipt', 'invoice'] as const;
/** Mirrors core `ResetPeriod` (fiscal.rs) — keyword strings on the wire. */
const RESET_PERIODS = ['never', 'daily', 'monthly', 'yearly'] as const;

/** Literal keys (not composed) so the bundle-parity gate can see each one. */
const KIND_LABEL: Record<string, string> = {
  receipt: 'settings-fiscalnum-kind-receipt',
  invoice: 'settings-fiscalnum-kind-invoice',
};
const PERIOD_LABEL: Record<string, string> = {
  never: 'settings-fiscalnum-period-never',
  daily: 'settings-fiscalnum-period-daily',
  monthly: 'settings-fiscalnum-period-monthly',
  yearly: 'settings-fiscalnum-period-yearly',
};

/** The editable half of a series. `currentValue` is absent by design — see
 *  the module doc: the counter is not an input, ever. */
interface Draft {
  prefix: string;
  resetPeriod: string;
  padding: number;
}

/** What a brand-new series starts as: nothing added, nothing padded, no
 *  reset. Saving this over an unconfigured pair changes no existing number. */
const INERT_DRAFT: Draft = { prefix: '', resetPeriod: 'never', padding: 0 };

export function StatutoryNumberingCard() {
  const { sessionToken } = useWorkspace();
  const { l10n } = useLocalization();

  const [entities, setEntities] = useState<LegalEntity[]>([]);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [documentKind, setDocumentKind] = useState<string>(DOCUMENT_KINDS[0]);
  const [sequence, setSequence] = useState<DocumentNumberSequence | null>(null);
  const [draft, setDraft] = useState<Draft>(INERT_DRAFT);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Entity list once per session. The FIRST entity is the default subject —
  // statutory numbering is per legal entity, and an org with one entity (the
  // seeded case) should never have to choose.
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listLegalEntitiesScoped(sessionToken);
        if (cancelled) return;
        setEntities(rows);
        setEntityId(rows[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) {
          setLoading(false);
          setLoadError(l10nErrorMessage(err, l10n, 'settings-fiscalnum-error-load'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, l10n]);

  const readPair = useCallback(
    async (token: string, entity: string, kind: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const seq = await getDocumentNumberSequenceScoped(token, entity, kind);
        // Seed the draft from the row when it exists, so the operator edits
        // the series they are looking at rather than a blank form that would
        // overwrite it.
        setSequence(seq);
        setDraft(
          seq
            ? { prefix: seq.prefix, resetPeriod: seq.resetPeriod, padding: seq.padding }
            : { ...INERT_DRAFT },
        );
        setSaved(false);
      } catch (err) {
        setLoadError(l10nErrorMessage(err, l10n, 'settings-fiscalnum-error-load'));
      } finally {
        setLoading(false);
      }
    },
    [l10n],
  );

  // (entity, kind) is the key — switching either half re-reads THAT pair, so
  // the counter on screen always belongs to the series being edited.
  useEffect(() => {
    if (!sessionToken || !entityId) return;
    void readPair(sessionToken, entityId, documentKind);
  }, [sessionToken, entityId, documentKind, readPair]);

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!sessionToken || !entityId) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await upsertDocumentNumberSequenceScoped(sessionToken, {
        legalEntityId: entityId,
        documentKind,
        prefix: draft.prefix,
        resetPeriod: draft.resetPeriod,
        padding: draft.padding,
      });
      // The write returns nothing, so the series is RE-READ rather than
      // assumed: the whole point of the call is that the counter it shows kept
      // running, and a locally patched value would prove nothing.
      const after = await getDocumentNumberSequenceScoped(sessionToken, entityId, documentKind);
      setSequence(after);
      setSaved(true);
    } catch (err) {
      setSaveError(l10nErrorMessage(err, l10n, 'settings-fiscalnum-error-save'));
    } finally {
      setSaving(false);
    }
  }, [sessionToken, entityId, documentKind, draft]);

  if (loading) {
    return (
      <Card shadow="sm">
        <p className="fiscalnum-loading">
          <Localized id="settings-section-loading">Loading…</Localized>
        </p>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card shadow="sm">
        <p className="fiscalnum-error" role="alert">
          {loadError}
        </p>
      </Card>
    );
  }

  if (!entityId) {
    return (
      <Card shadow="sm">
        <p className="fiscalnum-empty">
          <Localized id="settings-fiscalnum-no-entity">
            No legal entity to number documents for yet.
          </Localized>
        </p>
      </Card>
    );
  }

  return (
    <Card
      shadow="sm"
      header={
        <div className="fiscalnum-header">
          <Localized id="settings-fiscalnum-title">
            <h2 className="settings-section-title">Statutory numbering</h2>
          </Localized>
          <SettingsScopeTag scope="legal-entity" />
        </div>
      }
    >
      <p className="fiscalnum-intro">
        <Localized id="settings-fiscalnum-subtitle">
          The number series each legal entity issues its statutory documents from.
        </Localized>
      </p>

      <div className="fiscalnum-pair">
        <label htmlFor="fiscalnum-entity">
          <Localized id="settings-fiscalnum-label-entity">Legal entity</Localized>
        </label>
        <select
          id="fiscalnum-entity"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
        >
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>

        <label htmlFor="fiscalnum-kind">
          <Localized id="settings-fiscalnum-label-kind">Document kind</Localized>
        </label>
        <select
          id="fiscalnum-kind"
          value={documentKind}
          onChange={(e) => setDocumentKind(e.target.value)}
        >
          {DOCUMENT_KINDS.map((code) => (
            <option key={code} value={code}>
              <Localized id={KIND_LABEL[code] ?? code}>{code}</Localized>
            </option>
          ))}
        </select>
      </div>

      {sequence === null ? (
        <p className="fiscalnum-unset">
          <Localized id="settings-fiscalnum-unset">
            This pair has no series yet — saving creates one from zero.
          </Localized>
        </p>
      ) : (
        <p className="fiscalnum-current">
          <Localized
            id="settings-fiscalnum-current-value"
            vars={{ value: sequence.currentValue }}
          >
            <span>Last number issued: {sequence.currentValue}</span>
          </Localized>
          <span className="fiscalnum-current-note">
            <Localized id="settings-fiscalnum-current-value-note">
              Changing prefix, padding or period never resets this counter.
            </Localized>
          </span>
        </p>
      )}

      <div className="fiscalnum-fields">
        <div className="fiscalnum-field">
          <label htmlFor="fiscalnum-prefix">
            <Localized id="settings-fiscalnum-label-prefix">Prefix</Localized>
          </label>
          <input
            id="fiscalnum-prefix"
            type="text"
            value={draft.prefix}
            onChange={(e) => update({ prefix: e.target.value })}
          />
        </div>

        <div className="fiscalnum-field">
          <label htmlFor="fiscalnum-padding">
            <Localized id="settings-fiscalnum-label-padding">Zero padding</Localized>
          </label>
          <input
            id="fiscalnum-padding"
            type="number"
            min={0}
            step={1}
            value={draft.padding}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              update({ padding: Number.isNaN(parsed) || parsed < 0 ? 0 : parsed });
            }}
          />
        </div>

        <div className="fiscalnum-field">
          <label htmlFor="fiscalnum-period">
            <Localized id="settings-fiscalnum-label-period">Resets</Localized>
          </label>
          <select
            id="fiscalnum-period"
            value={draft.resetPeriod}
            onChange={(e) => update({ resetPeriod: e.target.value })}
          >
            {RESET_PERIODS.map((code) => (
              <option key={code} value={code}>
                <Localized id={PERIOD_LABEL[code] ?? code}>{code}</Localized>
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="fiscalnum-actions">
        <button type="button" onClick={() => void handleSave()} disabled={saving}>
          <Localized id="settings-fiscalnum-save">Save series</Localized>
        </button>
        {saved && (
          <span className="fiscalnum-saved" role="status">
            <Localized id="settings-fiscalnum-saved">Series saved</Localized>
          </span>
        )}
        {saveError && (
          <span className="fiscalnum-error" role="alert">
            {saveError}
          </span>
        )}
      </div>
    </Card>
  );
}
