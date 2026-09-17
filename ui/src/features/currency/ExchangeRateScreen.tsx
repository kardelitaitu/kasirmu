import { useState, useCallback, useEffect, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  listExchangeRatesScoped,
  createExchangeRateScoped,
  deleteExchangeRateScoped,
  listCurrenciesScoped,
  formatExchangeRate,
  type ExchangeRateDto,
  type CurrencyDto,
  type CreateExchangeRateArgs,
} from '@/api/currency';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { SettingsPopup, requiredLocalized } from '@/components';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { parseMinorUnits } from '@/types/domain';
import './ExchangeRateScreen.css';

function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

interface FormData {
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  source: string;
  effectiveDate: string;
}

const EMPTY_FORM: FormData = {
  fromCurrency: '',
  toCurrency: '',
  rate: '',
  source: '',
  effectiveDate: todayStr(),
};

/** Exchange rate management screen — create and delete currency exchange rates for multi-currency support. */
export default function ExchangeRateScreen() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  // CUR-06: route every read/write through the session-scoped commands when
  // a workspace session is active — the legacy commands hit the global
  // database, which in multi-store deployments leaks configuration across
  // stores. Without a session (single-store legacy/dev) fall back to them.
  const { sessionToken: rawSessionToken } = useWorkspace();
  const sessionToken = rawSessionToken ?? '';
  const [rates, setRates] = useState<ExchangeRateDto[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExchangeRateDto | null>(null);

  // LOAD-07: request-generation guard — a slow response from an earlier
  // load/unmount must never overwrite newer state.
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const [items, currs] = await Promise.all([
        listExchangeRatesScoped(sessionToken),
        listCurrenciesScoped(sessionToken),
      ]);
      if (seq !== loadSeqRef.current) return;
      setRates(items);
      setCurrencies(currs);
    } catch {
      if (seq !== loadSeqRef.current) return;
      setError(l10n.getString('currency-load-error'));
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [l10n, sessionToken]);

  useEffect(() => { load(); }, [load]);

  const openCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setShowModal(true);
  }, []);

  const handleDeleteClick = useCallback((rate: ExchangeRateDto) => {
    setDeleteTarget(rate);
  }, []);

  const closeDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // MONEY-02: exact decimal parse at the 6-decimal rate scale;
      // rejects non-decimal garbage and unsafe magnitudes outright.
      const rateMillionths = parseMinorUnits(form.rate, 6);
      if (rateMillionths === null || rateMillionths <= 0) return;

      const args: CreateExchangeRateArgs = {
        from_currency: form.fromCurrency,
        to_currency: form.toCurrency,
        rate_millionths: rateMillionths,
      };
      if (form.source) args.source = form.source;
      if (form.effectiveDate) args.effective_date = form.effectiveDate;
      await createExchangeRateScoped(sessionToken, args);
      setShowModal(false);
      await load();
    } catch {
      addToast({ message: requiredLocalized(l10n, 'currency-save-error'), type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [form, load, l10n, addToast, sessionToken]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleting(id);
    setDeleteTarget(null);
    try {
      await deleteExchangeRateScoped(sessionToken, id);
      setDeleting(null);
      await load();
    } catch {
      addToast({ message: requiredLocalized(l10n, 'currency-delete-error'), type: 'error' });
      setDeleting(null);
    }
  }, [deleteTarget, load, l10n, addToast, sessionToken]);

  const currencyOptions = currencies.map((c) => (
    <option key={c.code} value={c.code}>
      {c.code} — {c.name}
    </option>
  ));

  // The rate must also survive the millionths conversion — a sub-0.000001
  // rate would otherwise pass these checks and silently do nothing on Save.
  // MONEY-02: exact parse; null means "not a plain decimal literal".
  const rateMillionths = parseMinorUnits(form.rate, 6);
  const formValid =
    !!form.fromCurrency &&
    !!form.toCurrency &&
    form.fromCurrency !== form.toCurrency &&
    form.rate.trim() !== '' &&
    rateMillionths !== null &&
    rateMillionths > 0;

  return (
    <div className="exchange-rate-config">
      <div className="exchange-rate-header">
        <Localized id="currency-title">
          <h1 className="exchange-rate-title">Exchange Rates</h1>
        </Localized>
        <Localized id="currency-btn-add">
          <Button onClick={openCreate}>Add</Button>
        </Localized>
      </div>

      {loading ? (
        <div className="exchange-rate-loading-skeleton" aria-hidden="true">
          <div className="exchange-rate-header">
            <Skeleton variant="block" width="10rem" height="1.75rem" />
            <Skeleton variant="block" width="4rem" height="2.25rem" />
          </div>
          <div className="exchange-rate-table-wrap">
            <table className="exchange-rate-table">
              <thead>
                <tr>
                  {['From', 'To', 'Rate', 'Source', 'Effective Date', ''].map((_, i) => (
                    <th key={i}><Skeleton variant="text" width="4rem" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>{Array.from({ length: 4 }).map((_, r) => (
                  <tr key={r}>
                    <td><Skeleton variant="text" width="3rem" /></td>
                    <td><Skeleton variant="text" width="3rem" /></td>
                    <td><Skeleton variant="text" width="5rem" /></td>
                    <td><Skeleton variant="text" width="4rem" /></td>
                    <td><Skeleton variant="text" width="6rem" /></td>
                    <td><Skeleton variant="block" width="3.5rem" height="1.5rem" /></td>
                  </tr>
                ))}
</tbody>
            </table>
          </div>
        </div>
      ) : error ? (
        <Card shadow="sm">
          <div className="exchange-rate-error">
            <p>{error}</p>
            <Button variant="secondary" onClick={load}>
              <Localized id="error-state-retry"><span>Retry</span></Localized>
            </Button>
          </div>
        </Card>
      ) : rates.length === 0 ? (
        <Card shadow="sm">
          <div className="exchange-rate-empty">
            <Localized id="currency-empty">
              <p>No exchange rates configured</p>
            </Localized>
            <Localized id="currency-btn-add">
              <Button variant="secondary" onClick={openCreate}>Add</Button>
            </Localized>
          </div>
        </Card>
      ) : (
        <div className="exchange-rate-table-wrap">
          <table className="exchange-rate-table" aria-label={l10n.getString('currency-table-label')}>
            <thead>
              <tr>
                <Localized id="currency-col-from"><th>From</th></Localized>
                <Localized id="currency-col-to"><th>To</th></Localized>
                <Localized id="currency-col-rate"><th>Rate</th></Localized>
                <Localized id="currency-col-source"><th>Source</th></Localized>
                <Localized id="currency-col-effective"><th>Effective Date</th></Localized>
                <th aria-label={l10n.getString('currency-table-actions')}> </th>
              </tr>
            </thead>
            <tbody>{rates.map((r) => (
                <tr key={r.id}>
                  <td>{r.from_currency}</td>
                  <td>{r.to_currency}</td>
                  <td>{formatExchangeRate(r)}</td>
                  <td>{r.source === 'manual' ? <Localized id="currency-source-manual"><span>manual</span></Localized> : r.source}</td>
                  <td>{r.effective_date}</td>
                  <td className="exchange-rate-cell-actions">
                    <button
                      type="button"
                      className="exchange-rate-action-btn exchange-rate-action-btn--danger"
                      onClick={() => handleDeleteClick(r)}
                      disabled={deleting === r.id}
                      aria-label={l10n.getString('currency-delete-label', { from: r.from_currency, to: r.to_currency })}
                    >
                      <Localized id="currency-delete">
                        <span>Delete</span>
                      </Localized>
                    </button>
                  </td>
                </tr>
              ))}
</tbody>
          </table>
        </div>
      )}

      <SettingsPopup
        open={showModal}
        onClose={() => setShowModal(false)}
        title={l10n.getString('currency-modal-title')}
        saving={saving}
        onSave={handleSave}
        saveLabel={l10n.getString('currency-btn-save')}
        saveDisabled={!formValid}
        cancelLabel={l10n.getString('currency-btn-cancel')}
      >
        <div className="exchange-rate-field exchange-rate-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="er-field-from" className="exchange-rate-label">
            <Localized id="currency-field-from">
              <span>From Currency</span>
            </Localized>
          </label>
          <select
            className="exchange-rate-input exchange-rate-select"
            id="er-field-from"
            value={form.fromCurrency}
            onChange={(e) => setForm((prev) => ({ ...prev, fromCurrency: e.target.value }))}
          >
            <Localized id="currency-select-placeholder">
              <option value="">Select currency&hellip;</option>
            </Localized>
            {currencyOptions}
          </select>
        </div>

        <div className="exchange-rate-field exchange-rate-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="er-field-to" className="exchange-rate-label">
            <Localized id="currency-field-to">
              <span>To Currency</span>
            </Localized>
          </label>
          <select
            className="exchange-rate-input exchange-rate-select"
            id="er-field-to"
            value={form.toCurrency}
            onChange={(e) => setForm((prev) => ({ ...prev, toCurrency: e.target.value }))}
          >
            <Localized id="currency-select-placeholder">
              <option value="">Select currency&hellip;</option>
            </Localized>
            {currencyOptions}
          </select>
        </div>

        <div className="exchange-rate-field exchange-rate-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="er-field-rate" className="exchange-rate-label">
            <Localized id="currency-field-rate">
              <span>Rate</span>
            </Localized>
          </label>
          <Localized id="currency-rate-placeholder" attrs={{ placeholder: true }}>
            <input
              className="exchange-rate-input"
              type="number"
              id="er-field-rate"
              min="0"
              step="any"
              value={form.rate}
              onChange={(e) => setForm((prev) => ({ ...prev, rate: e.target.value }))}
              placeholder="1.25"
            />
          </Localized>
        </div>

        <div className="exchange-rate-field exchange-rate-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="er-field-source" className="exchange-rate-label">
            <Localized id="currency-field-source">
              <span>Source (optional)</span>
            </Localized>
          </label>
          <Localized id="currency-source-placeholder" attrs={{ placeholder: true }}>
            <input
              className="exchange-rate-input"
              type="text"
              id="er-field-source"
              value={form.source}
              onChange={(e) => setForm((prev) => ({ ...prev, source: e.target.value }))}
              placeholder="e.g. ECB"
            />
          </Localized>
        </div>

        <div className="exchange-rate-field exchange-rate-field--horizontal">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="er-field-date" className="exchange-rate-label">
            <Localized id="currency-field-date">
              <span>Effective Date</span>
            </Localized>
          </label>
          <input
            className="exchange-rate-input"
            type="date"
            id="er-field-date"
            value={form.effectiveDate}
            onChange={(e) => setForm((prev) => ({ ...prev, effectiveDate: e.target.value }))}
          />
        </div>
      </SettingsPopup>

      {/* Delete confirmation (currency-delete-confirm) */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onCancel={closeDelete}
        onConfirm={confirmDelete}
        title={l10n.getString('currency-delete-title')}
        message={l10n.getString('currency-delete-confirm')}
        variant="danger"
        loading={deleting !== null}
        confirmLabel={l10n.getString('currency-delete')}
        cancelLabel={l10n.getString('currency-btn-cancel')}
      />
    </div>
  );
}
