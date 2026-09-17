import { useState, useCallback, useEffect, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  listCustomersScoped,
  searchCustomersScoped,
  getCustomerHistoryScoped,
  createCustomerScoped,
  updateCustomerScoped,
  deleteCustomerScoped,
  type CustomerDto,
  type CustomerHistory,
  type CustomerSaleSummary,
  type UpdateCustomerScopedArgs,
  type CreateCustomerScopedArgs,
} from '@/api/customers';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SettingsPopup, requiredLocalized } from '@/components';
import { useToast } from '@/components/Toast';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { formatMoney } from '@/types/domain';
import { l10nErrorMessage } from '@/utils/app-error';
import './CustomerManagementScreen.css';

// ── Form state ──────────────────────────────────────────────────────

interface FormData {
  name: string;
  email: string;
  phone: string;
  notes: string;
}

const EMPTY_FORM: FormData = {
  name: '',
  email: '',
  phone: '',
  notes: '',
};

/** CUST-09: client-side field validation mirrors the authoritative backend
 * contract (foundation/src/contact.rs + db/customers.rs): name non-empty,
 * email exactly one '@' with a dotted domain, phone ≥1 digit. Notes are
 * length-capped here as a UX guard (backend remains authoritative). */
const NOTES_MAX_LENGTH = 500;

function validateEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return true; // optional field
  const atCount = trimmed.split('@').length - 1;
  if (atCount !== 1) return false;
  const [local, domain] = trimmed.split('@');
  return (
    local !== undefined &&
    domain !== undefined &&
    local.length > 0 &&
    domain.length > 0 &&
    domain.includes('.')
  );
}

function validatePhone(phone: string): boolean {
  const trimmed = phone.trim();
  if (!trimmed) return true; // optional field
  return /\d/.test(trimmed);
}

interface FieldErrors {
  email?: string;
  phone?: string;
  notes?: string;
}

function validateForm(form: FormData, l10n: { getString: (id: string) => string }): FieldErrors {
  const errors: FieldErrors = {};
  if (form.email.trim() && !validateEmail(form.email)) {
    errors.email = l10n.getString('customer-mgmt-error-email-invalid');
  }
  if (form.phone.trim() && !validatePhone(form.phone)) {
    errors.phone = l10n.getString('customer-mgmt-error-phone-invalid');
  }
  if (form.notes.length > NOTES_MAX_LENGTH) {
    errors.notes = l10n.getString('customer-mgmt-error-notes-too-long');
  }
  return errors;
}

// ── Component ───────────────────────────────────────────────────────

/** Customer management screen — list, search, create, edit, and delete customer records. */
export default function CustomerManagementScreen() {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const { addToast } = useToast();
  // Currency/date/number formatting follows the active Fluent locale (matching
  // the DashboardScreen pattern) instead of a hardcoded 'en-US'.
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // CUST-06: server-side search — the renderer only ever holds one bounded
  // page; the total count drives the "showing X of Y" line and pagination.
  const [searchTotal, setSearchTotal] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeqRef = useRef(0);
  // CUST-05: read-only history modal state.
  const [historyTarget, setHistoryTarget] = useState<CustomerDto | null>(null);
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  // CUST-03: track load failures separately from a genuinely empty customer set.
  const [loadError, setLoadError] = useState<string | null>(null);
  // CUST-10: request-sequence guard — a slower response from an earlier
  // session/refresh must never overwrite newer customer data.
  const loadSeqRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  // Keep `load` memoized on [sessionToken] only — locale identity changes
  // must not re-fire the load effect (mirrors ProductManagementScreen).
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;

  // ── Load data ──────────────────────────────────────────────────

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    // CUST-10: only the first load shows the skeleton — refreshes
    // preserve the last known list on screen instead of flashing a skeleton.
    if (!hasLoadedOnceRef.current) {
      setLoading(true);
    }
    setLoadError(null);
    try {
      const data = await listCustomersScoped(sessionToken);
      if (seq !== loadSeqRef.current) return;
      setCustomers(data);
      hasLoadedOnceRef.current = true;
    } catch (err) {
      // CUST-03: a failed load must not be indistinguishable from an empty store.
      if (seq !== loadSeqRef.current) return;
      setLoadError(
        l10nErrorMessage(err, l10nRef.current, 'customer-mgmt-error-load'),
      );
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  // ── Search (CUST-06) ───────────────────────────────────────────

  // Debounced server-side search: queries run in the store DB (LIKE over
  // name/email/phone) with a bounded page size instead of loading the whole
  // collection into the renderer and filtering client-side.
  const runSearch = useCallback(
    async (query: string) => {
      const seq = ++searchSeqRef.current;
      const trimmed = query.trim();
      if (!trimmed) {
        setSearchTotal(null);
        setSearching(false);
        await load();
        return;
      }
      setSearching(true);
      try {
        const page = await searchCustomersScoped(sessionToken, trimmed, 50, 0);
        if (seq !== searchSeqRef.current) return;
        setCustomers(page.items);
        setSearchTotal(page.total);
      } catch {
        if (seq !== searchSeqRef.current) return;
        setLoadError(
          requiredLocalized(l10nRef.current, 'customer-mgmt-error-load'),
        );
        setCustomers([]);
      } finally {
        if (seq === searchSeqRef.current) {
          setSearching(false);
        }
      }
    },
    [sessionToken, load],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void runSearch(searchQuery);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchQuery, runSearch]);

  // ── Modal handlers ──────────────────────────────────────────────

  const openCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setEditingId(null);
    setError(null);
    setShowModal(true);
  }, []);

  const openEdit = useCallback((customer: CustomerDto) => {
    setForm({
      name: customer.name,
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      notes: customer.notes,
    });
    setFieldErrors({});
    setEditingId(customer.id);
    setError(null);
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setFieldErrors({});
    setError(null);
  }, []);

  /** CUST-09: clear a field error as soon as the operator edits the field. */
  const updateField = useCallback((field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === 'name') return; // name has no per-field error
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  // ── History modal (CUST-05) ────────────────────────────────────

  // CUST-11: remember the opener so focus can be restored on close.
  const historyTriggerRef = useRef<HTMLElement | null>(null);
  // CUST-11: the shared focus-trap hook owns initial focus, Tab cycling,
  // Escape-to-close, and body scroll locking — same modal semantics as
  // SettingsPopup (the audit's positive control).
  const historyPanelRef = useRef<HTMLDivElement | null>(null);

  const openHistory = useCallback((customer: CustomerDto) => {
    historyTriggerRef.current = document.activeElement as HTMLElement | null;
    setHistoryTarget(customer);
    setHistory(null);
    setHistoryError(false);
    setHistoryLoading(true);
    void getCustomerHistoryScoped(sessionToken, customer.id)
      .then((h) => {
        setHistory(h);
        setHistoryLoading(false);
      })
      .catch(() => {
        setHistoryError(true);
        setHistoryLoading(false);
      });
  }, [sessionToken]);

  const closeHistory = useCallback(() => {
    setHistoryTarget(null);
    setHistory(null);
    setHistoryError(false);
    // CUST-11: restore keyboard focus to the opener so the next Tab lands
    // on the expected row action, not the top of the document.
    historyTriggerRef.current?.focus();
    historyTriggerRef.current = null;
  }, []);

  // CUST-11: shared modal semantics — auto-focus, Tab trap, Escape-close,
  // body scroll lock — active while the history dialog is open.
  useFocusTrap(historyPanelRef, historyTarget !== null, closeHistory);

  const retryHistory = useCallback(() => {
    if (!historyTarget) return;
    setHistory(null);
    setHistoryError(false);
    setHistoryLoading(true);
    void getCustomerHistoryScoped(sessionToken, historyTarget.id)
      .then((h) => {
        setHistory(h);
        setHistoryLoading(false);
      })
      .catch(() => {
        setHistoryError(true);
        setHistoryLoading(false);
      });
  }, [historyTarget, sessionToken]);

  // ── Save / Update ──────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    // CUST-09: validate every field before any IPC round trip — the modal
    // stays open and the offending field is flagged with aria-invalid.
    const errs = validateForm(form, l10n);
    setFieldErrors(errs);
    if (!form.name.trim()) {
      setError(l10n.getString('customer-mgmt-error-name-required'));
      return;
    }
    if (errs.email || errs.phone || errs.notes) {
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const name = form.name.trim();

      if (editingId) {
        const args: UpdateCustomerScopedArgs = { id: editingId, name };
        if (form.email.trim()) args.email = form.email.trim();
        if (form.phone.trim()) args.phone = form.phone.trim();
        if (form.notes.trim()) args.notes = form.notes.trim();
        await updateCustomerScoped(sessionToken, args);
      } else {
        const args: CreateCustomerScopedArgs = { name };
        if (form.email.trim()) args.email = form.email.trim();
        if (form.phone.trim()) args.phone = form.phone.trim();
        if (form.notes.trim()) args.notes = form.notes.trim();
        await createCustomerScoped(sessionToken, args);
      }
      closeModal();
      await load();
    } catch (err) {
      // CUST-09: keep save failures stable and localized; backend stays authoritative.
      setError(requiredLocalized(l10n, 'customer-mgmt-error-save-failed'));
      void err;
    } finally {
      setSaving(false);
    }
  }, [form, editingId, closeModal, load, sessionToken, l10n]);

  // ── Delete ─────────────────────────────────────────────────────

  // CUST-02: deletion requires an explicit confirmation dialog; the row
  // button only arms `deleteTarget` and the destructive IPC call fires from
  // the dialog's confirm action.
  const requestDelete = useCallback((customer: CustomerDto) => {
    setDeleteTarget(customer);
  }, []);

  const closeDelete = useCallback(() => {
    if (deleting !== null) return;
    setDeleteTarget(null);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(deleteTarget.id);
    try {
      await deleteCustomerScoped(sessionToken, deleteTarget.id);
      setDeleting(null);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      // CUST-04: a failed delete must be visible — keep the row, surface a
      // localized toast, and leave the dialog open so the operator can retry.
      setDeleting(null);
      addToast({
        message: requiredLocalized(l10n, 'customer-mgmt-error-delete'),
        type: 'error',
      });
      void err;
    }
  }, [deleteTarget, load, sessionToken, addToast, l10n]);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="customer-mgmt">
      <div className="customer-mgmt-header">
        <Localized id="customer-mgmt-title">
          <h1 className="customer-mgmt-title">Customers</h1>
        </Localized>
        <Localized id="customer-mgmt-add">
          <Button onClick={openCreate}>Add Customer</Button>
        </Localized>
      </div>

      {/* Search */}
      <div className="customer-mgmt-search-wrap">
        <svg className="customer-mgmt-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <Localized id="customer-mgmt-search" attrs={{ placeholder: true, 'aria-label': true }}>
          <input
            type="search"
            className="customer-mgmt-search"
            id="customer-mgmt-search"
            name="customer-mgmt-search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            placeholder="Search by name, email, or phone…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </Localized>
      </div>

      {/* Content */}
      {loading ? (
        <div className="customer-mgmt-loading-skeleton" aria-hidden="true">
          {/* Header skeleton: title + button */}
          <div className="customer-mgmt-header">
            <Skeleton variant="block" width="10rem" height="1.75rem" />
            <Skeleton variant="block" width="9rem" height="2.25rem" />
          </div>
          {/* Search bar skeleton */}
          <div className="customer-mgmt-skeleton-search">
            <Skeleton variant="circle" width="1rem" height="1rem" />
            <Skeleton variant="text" width="100%" height="1.125rem" />
          </div>
          {/* Table skeleton: header + 4 rows with 5 columns */}
          <div className="customer-mgmt-table-wrap">
            <table className="customer-mgmt-table" aria-hidden="true">
              <thead>
                <tr>
                  {['Name', 'Email', 'Phone', 'Notes', ''].map((_, i) => (
                    <th key={i}><Skeleton variant="text" width={i < 4 ? '4rem' : '3rem'} height="0.75rem" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>{[0, 1, 2, 3].map((r) => (
                  <tr key={r}>
                    <td>
                      <div className="customer-mgmt-cell-name">
                        <Skeleton variant="circle" width="2rem" height="2rem" />
                        <Skeleton variant="text" width="6rem" height="0.875rem" />
                      </div>
                    </td>
                    <td><Skeleton variant="text" width="8rem" height="0.75rem" /></td>
                    <td><Skeleton variant="text" width="6rem" height="0.75rem" /></td>
                    <td><Skeleton variant="text" width="5rem" height="0.75rem" /></td>
                    <td className="customer-mgmt-cell-actions">
                      <Skeleton variant="block" width="3.5rem" height="1.375rem" />
                      <Skeleton variant="block" width="3.5rem" height="1.375rem" />
                    </td>
                  </tr>
                ))}
</tbody>
            </table>
          </div>
        </div>
      ) : loadError && customers.length === 0 ? (
        <Card shadow="sm">
          <div className="customer-mgmt-empty" role="alert">
            <Localized id="customer-mgmt-error-load">
              <p className="customer-mgmt-load-error-title">Failed to load customers</p>
            </Localized>
            {loadError && loadError !== requiredLocalized(l10n, 'customer-mgmt-error-load') && (
              <p className="customer-mgmt-load-error-detail">{loadError}</p>
            )}
            <Localized id="customer-mgmt-error-retry">
              <Button variant="secondary" onClick={() => void load()}>
                Retry
              </Button>
            </Localized>
          </div>
        </Card>
      ) : customers.length === 0 && searchQuery.trim() ? (
        // CUST-06: an active search that returned an empty page renders the
        // no-match state (with Clear search) — never the "no customers yet"
        // onboarding state, which is reserved for a genuinely empty store.
        <Card shadow="sm">
          <div className="customer-mgmt-empty">
            <Localized id="customer-mgmt-search-empty">
              <p>No customers match your search.</p>
            </Localized>
            <Localized id="customer-mgmt-search-clear">
              <Button variant="ghost" onClick={() => setSearchQuery('')}>
                Clear search
              </Button>
            </Localized>
          </div>
        </Card>
      ) : customers.length === 0 && searchTotal === null ? (
        // CUST-06: onboarding empty state is reserved for a genuinely empty
        // store — never shown while a search is active or being cleared.
        <Card shadow="sm">
          <div className="customer-mgmt-empty">
            <div className="customer-mgmt-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="48" height="48">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <Localized id="customer-mgmt-empty">
              <p>No customers yet.</p>
            </Localized>
            <Localized id="customer-mgmt-empty-cta">
              <Button variant="secondary" onClick={openCreate}>
                Add your first customer
              </Button>
            </Localized>
          </div>
        </Card>
      ) : (
        <div className="customer-mgmt-table-wrap">
          {searching && (
            <p className="customer-mgmt-search-status" role="status">
              <Localized id="customer-mgmt-search-loading"><span>Searching…</span></Localized>
            </p>
          )}
          {searchTotal !== null && !searching && (
            <p className="customer-mgmt-search-status" role="status">
              <Localized
                id="customer-mgmt-search-results"
                vars={{ shown: String(customers.length), total: String(searchTotal) }}
              >
                <span>Showing {customers.length} of {searchTotal} customers</span>
              </Localized>
            </p>
          )}
          <table className="customer-mgmt-table" aria-label={l10n.getString('customer-mgmt-table-aria')}>
            <thead>
              <tr>
                <Localized id="customer-mgmt-col-name"><th>Name</th></Localized>
                <Localized id="customer-mgmt-col-email"><th>Email</th></Localized>
                <Localized id="customer-mgmt-col-phone"><th>Phone</th></Localized>
                <Localized id="customer-mgmt-col-notes"><th>Notes</th></Localized>
                <Localized id="customer-mgmt-col-actions" attrs={{ 'aria-label': true }}>
                  <th> </th>
                </Localized>
              </tr>
            </thead>
            <tbody>{customers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <div className="customer-mgmt-cell-name">
                      <div className="customer-mgmt-avatar">
                        {customer.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="customer-mgmt-name-text">{customer.name}</span>
                    </div>
                  </td>
                  <td className="customer-mgmt-cell-email">
                    {customer.email ?? '\u2014'}
                  </td>
                  <td className="customer-mgmt-cell-phone">
                    {customer.phone ?? '\u2014'}
                  </td>
                  <td className="customer-mgmt-cell-notes">
                    {customer.notes || '\u2014'}
                  </td>
                  <td className="customer-mgmt-cell-actions">
                    <Localized id="customer-mgmt-history-aria" attrs={{ 'aria-label': true }} vars={{ name: customer.name }}>
                      <button
                        type="button"
                        className="customer-mgmt-action-btn"
                        onClick={() => openHistory(customer)}
                      >
                        <Localized id="customer-mgmt-history"><span>History</span></Localized>
                      </button>
                    </Localized>
                    <Localized id="customer-mgmt-edit-aria" attrs={{ 'aria-label': true }} vars={{ name: customer.name }}>
                      <button
                        type="button"
                        className="customer-mgmt-action-btn"
                        onClick={() => openEdit(customer)}
                      >
                        <Localized id="customer-mgmt-edit"><span>Edit</span></Localized>
                      </button>
                    </Localized>
                    <Localized id="customer-mgmt-delete-aria" attrs={{ 'aria-label': true }} vars={{ name: customer.name }}>
                      <button
                        type="button"
                        className="customer-mgmt-action-btn customer-mgmt-action-btn--danger"
                        onClick={() => requestDelete(customer)}
                        disabled={deleting !== null}
                      >
                        <Localized id="customer-mgmt-delete"><span>Delete</span></Localized>
                      </button>
                    </Localized>
                  </td>
                </tr>
              ))}
</tbody>
          </table>
              </div>
      )}

      <SettingsPopup
        open={showModal}
        onClose={closeModal}
        title={l10n.getString(editingId ? 'customer-mgmt-modal-edit-title' : 'customer-mgmt-modal-add-title')}
        saving={saving}
        error={error}
        onSave={handleSave}
        saveLabel={l10n.getString(editingId ? 'customer-mgmt-btn-update' : 'customer-mgmt-btn-create')}
        saveDisabled={!form.name.trim()}
        cancelLabel={l10n.getString('customer-mgmt-btn-cancel')}
      >
        <div className="customer-mgmt-field">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="customer-field-name" className="customer-mgmt-label">
            <Localized id="customer-mgmt-field-name">
              <span>Name *</span>
            </Localized>
          </label>
          <Localized id="customer-mgmt-name-placeholder" attrs={{ placeholder: true }}>
            <input
              className="customer-mgmt-input"
              type="text"
              id="customer-field-name"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="e.g. Jane Smith"
              autoComplete="off"
            />
          </Localized>
        </div>

        <div className="customer-mgmt-field">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="customer-field-email" className="customer-mgmt-label">
            <Localized id="customer-mgmt-field-email">
              <span>Email</span>
            </Localized>
          </label>
          <Localized id="customer-mgmt-email-placeholder" attrs={{ placeholder: true }}>
            <input
              className="customer-mgmt-input"
              type="email"
              id="customer-field-email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              placeholder="jane@example.com"
              autoComplete="off"
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? 'customer-field-email-error' : undefined}
            />
          </Localized>
          {fieldErrors.email && (
            <p id="customer-field-email-error" className="customer-mgmt-field-error" role="alert">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div className="customer-mgmt-field">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="customer-field-phone" className="customer-mgmt-label">
            <Localized id="customer-mgmt-field-phone">
              <span>Phone</span>
            </Localized>
          </label>
          <Localized id="customer-mgmt-phone-placeholder" attrs={{ placeholder: true }}>
            <input
              className="customer-mgmt-input"
              type="tel"
              id="customer-field-phone"
              value={form.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              placeholder="+1-555-0100"
              autoComplete="off"
              aria-invalid={fieldErrors.phone ? true : undefined}
              aria-describedby={fieldErrors.phone ? 'customer-field-phone-error' : undefined}
            />
          </Localized>
          {fieldErrors.phone && (
            <p id="customer-field-phone-error" className="customer-mgmt-field-error" role="alert">
              {fieldErrors.phone}
            </p>
          )}
        </div>

        <div className="customer-mgmt-field">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="customer-field-notes" className="customer-mgmt-label">
            <Localized id="customer-mgmt-field-notes">
              <span>Notes</span>
            </Localized>
          </label>
          <Localized id="customer-mgmt-notes-placeholder" attrs={{ placeholder: true }}>
            <textarea
              className="customer-mgmt-input customer-mgmt-textarea"
              id="customer-field-notes"
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Preferences, special notes…"
              rows={3}
              maxLength={NOTES_MAX_LENGTH}
              aria-invalid={fieldErrors.notes ? true : undefined}
              aria-describedby={fieldErrors.notes ? 'customer-field-notes-error' : undefined}
            />
          </Localized>
          {fieldErrors.notes && (
            <p id="customer-field-notes-error" className="customer-mgmt-field-error" role="alert">
              {fieldErrors.notes}
            </p>
          )}
        </div>
      </SettingsPopup>

      <ConfirmDialog
        open={deleteTarget !== null}
        onCancel={closeDelete}
        onConfirm={() => { void confirmDelete(); }}
        title={requiredLocalized(l10n, 'customer-mgmt-delete-confirm-title')}
        message={requiredLocalized(l10n, 'customer-mgmt-delete-confirm-message', {
          name: deleteTarget?.name ?? '',
        })}
        variant="danger"
        loading={deleting !== null}
        confirmLabel={requiredLocalized(l10n, 'customer-mgmt-delete-confirm-btn')}
        cancelLabel={requiredLocalized(l10n, 'customer-mgmt-btn-cancel')}
      />

      {/* CUST-05: read-only customer history — profile, loyalty summary,
          recent sales. Loaded scoped + permission-gated by the backend. */}
      {historyTarget && (
        <div className="customer-mgmt-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) closeHistory(); }}>
          <div
            ref={historyPanelRef}
            className="customer-mgmt-history"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-mgmt-history-title"
          >
            <div className="customer-mgmt-history-header">
              <div>
                <h2 id="customer-mgmt-history-title" className="customer-mgmt-history-title">
                  {requiredLocalized(l10n, 'customer-mgmt-history-title')}
                </h2>
                <p className="customer-mgmt-history-subtitle">{historyTarget.name}</p>
              </div>
              <button
                type="button"
                className="customer-mgmt-action-btn customer-mgmt-history-close"
                onClick={closeHistory}
                aria-label={requiredLocalized(l10n, 'customer-mgmt-history-close')}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <div className="customer-mgmt-history-body">
              {historyLoading && (
                <div className="customer-mgmt-history-state" role="status">
                  <Localized id="customer-mgmt-history-loading"><p>Loading history…</p></Localized>
                </div>
              )}
              {historyError && (
                <div className="customer-mgmt-history-state" role="alert">
                  <Localized id="customer-mgmt-history-error">
                    <p>Failed to load history</p>
                  </Localized>
                  <Button variant="secondary" onClick={() => void retryHistory()}>
                    {requiredLocalized(l10n, 'customer-mgmt-error-retry')}
                  </Button>
                </div>
              )}
              {!historyLoading && !historyError && history && (
                <>
                  <section className="customer-mgmt-history-section">
                    <Localized id="customer-mgmt-history-loyalty-title">
                      <h3 className="customer-mgmt-history-section-title">Loyalty</h3>
                    </Localized>
                    {history.loyalty ? (
                      <dl className="customer-mgmt-history-grid">
                        <div>
                          <dt>{requiredLocalized(l10n, 'customer-mgmt-history-points')}</dt>
                          <dd>{history.loyalty.points.toLocaleString(numLocale)}</dd>
                        </div>
                        <div>
                          <dt>{requiredLocalized(l10n, 'customer-mgmt-history-lifetime')}</dt>
                          <dd>{history.loyalty.lifetime_points.toLocaleString(numLocale)}</dd>
                        </div>
                        <div>
                          <dt>{requiredLocalized(l10n, 'customer-mgmt-history-tier')}</dt>
                          <dd>{history.loyalty.tier_name ?? requiredLocalized(l10n, 'customer-mgmt-history-no-tier')}</dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="customer-mgmt-history-empty-note">
                        {requiredLocalized(l10n, 'customer-mgmt-history-no-tier')}
                      </p>
                    )}
                  </section>

                  <section className="customer-mgmt-history-section">
                    <Localized id="customer-mgmt-history-sales-title">
                      <h3 className="customer-mgmt-history-section-title">Recent sales</h3>
                    </Localized>
                    {history.sales.length === 0 ? (
                      <p className="customer-mgmt-history-empty-note">
                        {requiredLocalized(l10n, 'customer-mgmt-history-no-sales')}
                      </p>
                    ) : (
                      <ul className="customer-mgmt-history-sales">
                        {history.sales.map((sale) => (
                          <li key={sale.id} className="customer-mgmt-history-sale">
                            <div className="customer-mgmt-history-sale-meta">
                              <span className="customer-mgmt-history-sale-date">{formatDate(sale.created_at, numLocale)}</span>
                              <span className="customer-mgmt-history-sale-status">{sale.status}</span>
                            </div>
                            <div className="customer-mgmt-history-sale-amount">
                              {formatSaleTotal(sale, numLocale)}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** CUST-05: format a sale total from minor units + currency code, using the
 *  active Fluent locale so currency formatting matches the UI language. */
function formatSaleTotal(sale: CustomerSaleSummary, locale: string): string {
  try {
    return formatMoney(
      { minor_units: sale.total_minor, currency: sale.currency },
      locale,
    );
  } catch {
    return sale.total_minor.toLocaleString(locale);
  }
}

/** CUST-05: short readable date for the sales list, in the active locale. */
function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
