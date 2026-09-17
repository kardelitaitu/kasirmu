import { useState, useCallback, useEffect, useMemo } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  listSuppliers,
  createSupplier,
  updateSupplier,
  type SupplierDto,
  type UpdateSupplierArgs,
  type CreateSupplierArgs,
} from '@/api/purchasing';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { SettingsPopup, requiredLocalized, EmptyState } from '@/components';
import { NoSuppliersIcon, NotFoundIcon } from '@/components/EmptyStateIllustrations';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { l10nErrorMessage } from '@/utils/app-error';
import './SuppliersScreen.css';

interface FormData {
  code: string;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  tax_id: string;
  payment_terms: string;
  notes: string;
}

const EMPTY_FORM: FormData = {
  code: '',
  name: '',
  contact_person: '',
  phone: '',
  email: '',
  address: '',
  tax_id: '',
  payment_terms: '',
  notes: '',
};

/** Supplier management screen — list, search, create, and edit supplier profiles with contact and payment term details. */
export default function SuppliersScreen() {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listSuppliers(sessionToken);
      setSuppliers(data);
    } catch {
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return suppliers;
    const q = searchQuery.trim().toLowerCase();
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.contact_person.toLowerCase().includes(q),
    );
  }, [suppliers, searchQuery]);

  const openCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError(null);
    setShowModal(true);
  }, []);

  const openEdit = useCallback((s: SupplierDto) => {
    setForm({
      code: s.code,
      name: s.name,
      contact_person: s.contact_person,
      phone: s.phone,
      email: s.email,
      address: s.address,
      tax_id: s.tax_id,
      payment_terms: s.payment_terms,
      notes: s.notes,
    });
    setEditingId(s.id);
    setError(null);
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      setError(l10n.getString('supplier-name-required'));
      return;
    }
    if (!form.code.trim()) {
      setError(l10n.getString('supplier-code-required'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const args: UpdateSupplierArgs = {
          id: editingId,
          code: form.code.trim(),
          name: form.name.trim(),
        };
        if (form.contact_person.trim()) args.contact_person = form.contact_person.trim();
        if (form.phone.trim()) args.phone = form.phone.trim();
        if (form.email.trim()) args.email = form.email.trim();
        if (form.address.trim()) args.address = form.address.trim();
        if (form.tax_id.trim()) args.tax_id = form.tax_id.trim();
        if (form.payment_terms.trim()) args.payment_terms = form.payment_terms.trim();
        if (form.notes.trim()) args.notes = form.notes.trim();
        await updateSupplier(sessionToken, args);
      } else {
        const args: CreateSupplierArgs = {
          code: form.code.trim(),
          name: form.name.trim(),
        };
        if (form.contact_person.trim()) args.contact_person = form.contact_person.trim();
        if (form.phone.trim()) args.phone = form.phone.trim();
        if (form.email.trim()) args.email = form.email.trim();
        if (form.address.trim()) args.address = form.address.trim();
        if (form.tax_id.trim()) args.tax_id = form.tax_id.trim();
        if (form.payment_terms.trim()) args.payment_terms = form.payment_terms.trim();
        if (form.notes.trim()) args.notes = form.notes.trim();
        await createSupplier(sessionToken, args);
      }
      closeModal();
      await load();
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'supplier-save-failed'));
    } finally {
      setSaving(false);
    }
  }, [form, editingId, closeModal, load, l10n, sessionToken]);

  return (
    <div className="suppliers-screen">
      <div className="suppliers-header">
        <Localized id="suppliers-title">
          <h1 className="suppliers-title">Suppliers</h1>
        </Localized>
        <Localized id="suppliers-add">
          <Button onClick={openCreate}>Add Supplier</Button>
        </Localized>
      </div>

      <div className="suppliers-search-wrap">
        <svg className="suppliers-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <Localized id="suppliers-search" attrs={{ placeholder: true, 'aria-label': true }}>
          <input
            type="search"
            className="suppliers-search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            placeholder="Search by name, code, or contact…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={l10n.getString('search-aria')}
          />
        </Localized>
      </div>

      {loading ? (
        <div className="suppliers-loading-skeleton" aria-hidden="true">
          {/* Header skeleton: title + button */}
          <div className="suppliers-header">
            <Skeleton variant="block" width="10rem" height="1.75rem" />
            <Skeleton variant="block" width="9rem" height="2.25rem" />
          </div>
          {/* Search bar skeleton */}
          <div className="suppliers-skeleton-search">
            <Skeleton variant="circle" width="1rem" height="1rem" />
            <Skeleton variant="text" width="100%" height="1.125rem" />
          </div>
          {/* Table skeleton: header + 4 rows with 7 columns */}
          <div className="suppliers-table-wrap">
            <table className="suppliers-table" aria-hidden="true">
              <thead>
                <tr>
                  {['Code', 'Name', 'Contact', 'Phone', 'Email', 'Status', ''].map((_, i) => (
                    <th key={i}><Skeleton variant="text" width={i < 6 ? '4rem' : '3rem'} height="0.75rem" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>{[0, 1, 2, 3].map((r) => (
                  <tr key={r}>
                    <td><Skeleton variant="text" width="5rem" height="0.875rem" /></td>
                    <td><Skeleton variant="text" width="7rem" height="0.875rem" /></td>
                    <td><Skeleton variant="text" width="5rem" height="0.75rem" /></td>
                    <td><Skeleton variant="text" width="5rem" height="0.75rem" /></td>
                    <td><Skeleton variant="text" width="7rem" height="0.75rem" /></td>
                    <td><Skeleton variant="block" width="4rem" height="1.125rem" style={{ borderRadius: 'var(--radius-full)' }} /></td>
                    <td className="suppliers-cell-actions">
                      <Skeleton variant="block" width="3.5rem" height="1.375rem" />
                    </td>
                  </tr>
                ))}
</tbody>
            </table>
          </div>
        </div>
      ) : suppliers.length === 0 ? (
        <Card shadow="sm">
          <EmptyState
            region="table"
            icon={<NoSuppliersIcon />}
            title={requiredLocalized(l10n, 'suppliers-no-data')}
            action={{
              label: requiredLocalized(l10n, 'suppliers-add-first'),
              onClick: openCreate,
            }}
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card shadow="sm">
          <EmptyState
            region="table"
            icon={<NotFoundIcon />}
            title={requiredLocalized(l10n, 'suppliers-no-results')}
            action={{
              label: requiredLocalized(l10n, 'suppliers-clear-search'),
              onClick: () => setSearchQuery(''),
            }}
          />
        </Card>
      ) : (
        <div className="suppliers-table-wrap">
          <table className="suppliers-table" aria-label={requiredLocalized(l10n, 'suppliers-table-aria')}>
            <thead>
              <tr>
                <Localized id="suppliers-col-code"><th>Code</th></Localized>
                <Localized id="suppliers-col-name"><th>Name</th></Localized>
                <Localized id="suppliers-col-contact"><th>Contact</th></Localized>
                <Localized id="suppliers-col-phone"><th>Phone</th></Localized>
                <Localized id="suppliers-col-email"><th>Email</th></Localized>
                <Localized id="suppliers-col-status"><th>Status</th></Localized>
                <Localized id="suppliers-col-actions" attrs={{ 'aria-label': true }}>
                  <th aria-label={l10n.getString('actions-aria')}> </th>
                </Localized>
              </tr>
            </thead>
            <tbody>{filtered.map((s) => (
                <tr key={s.id}>
                  <td className="suppliers-cell-code">{s.code}</td>
                  <td className="suppliers-cell-name">{s.name}</td>
                  <td className="suppliers-cell-contact">{s.contact_person || '\u2014'}</td>
                  <td className="suppliers-cell-phone">{s.phone || '\u2014'}</td>
                  <td className="suppliers-cell-email">{s.email || '\u2014'}</td>
                  <td>
                    <span className={`suppliers-badge suppliers-badge--${s.status}`}>{s.status}</span>
                  </td>
                  <td className="suppliers-cell-actions">
                    <Localized id="suppliers-edit">
                      <button type="button" className="suppliers-action-btn" onClick={() => openEdit(s)}>
                        Edit
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
        title={l10n.getString(editingId ? 'suppliers-edit-title' : 'suppliers-add-title')}
        saving={saving}
        error={error}
        onSave={handleSave}
        saveLabel={l10n.getString(editingId ? 'suppliers-btn-update' : 'suppliers-btn-create')}
        saveDisabled={!form.name.trim() || !form.code.trim()}
        cancelLabel={l10n.getString('suppliers-btn-cancel')}
      >
        <label className="suppliers-field" htmlFor="supplier-field-code" aria-label={requiredLocalized(l10n, 'suppliers-field-code')}>
          <Localized id="suppliers-field-code"><span className="suppliers-label">Code *</span></Localized>
          <input
            className="suppliers-input"
            type="text"
            id="supplier-field-code"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            autoComplete="off"
          />
        </label>
        <label className="suppliers-field" htmlFor="supplier-field-name" aria-label={requiredLocalized(l10n, 'suppliers-field-name')}>
          <Localized id="suppliers-field-name"><span className="suppliers-label">Name *</span></Localized>
          <input
            className="suppliers-input"
            type="text"
            id="supplier-field-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoComplete="off"
          />
        </label>
        <div className="suppliers-row">
          <label className="suppliers-field" htmlFor="supplier-field-contact" aria-label={requiredLocalized(l10n, 'suppliers-field-contact')}>
            <Localized id="suppliers-field-contact"><span className="suppliers-label">Contact Person</span></Localized>
            <input
              className="suppliers-input"
              type="text"
              id="supplier-field-contact"
              value={form.contact_person}
              onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className="suppliers-field" htmlFor="supplier-field-phone" aria-label={requiredLocalized(l10n, 'suppliers-field-phone')}>
            <Localized id="suppliers-field-phone"><span className="suppliers-label">Phone</span></Localized>
            <input
              className="suppliers-input"
              type="tel"
              id="supplier-field-phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              autoComplete="off"
            />
          </label>
        </div>
        <label className="suppliers-field" htmlFor="supplier-field-email" aria-label={requiredLocalized(l10n, 'suppliers-field-email')}>
          <Localized id="suppliers-field-email"><span className="suppliers-label">Email</span></Localized>
          <input
            className="suppliers-input"
            type="email"
            id="supplier-field-email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            autoComplete="off"
          />
        </label>
        <label className="suppliers-field" htmlFor="supplier-field-address" aria-label={requiredLocalized(l10n, 'suppliers-field-address')}>
          <Localized id="suppliers-field-address"><span className="suppliers-label">Address</span></Localized>
          <input
            className="suppliers-input"
            type="text"
            id="supplier-field-address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            autoComplete="off"
          />
        </label>
        <div className="suppliers-row">
          <label className="suppliers-field" htmlFor="supplier-field-tax-id" aria-label={requiredLocalized(l10n, 'suppliers-field-tax-id')}>
            <Localized id="suppliers-field-tax-id"><span className="suppliers-label">Tax ID</span></Localized>
            <input
              className="suppliers-input"
              type="text"
              id="supplier-field-tax-id"
              value={form.tax_id}
              onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className="suppliers-field" htmlFor="supplier-field-payment-terms" aria-label={requiredLocalized(l10n, 'suppliers-field-payment-terms')}>
            <Localized id="suppliers-field-payment-terms"><span className="suppliers-label">Payment Terms</span></Localized>
            <input
              className="suppliers-input"
              type="text"
              id="supplier-field-payment-terms"
              value={form.payment_terms}
              onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
              autoComplete="off"
            />
          </label>
        </div>
        <label className="suppliers-field" htmlFor="supplier-field-notes" aria-label={requiredLocalized(l10n, 'suppliers-field-notes')}>
          <Localized id="suppliers-field-notes"><span className="suppliers-label">Notes</span></Localized>
          <textarea
            className="suppliers-input suppliers-textarea"
            id="supplier-field-notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
          />
        </label>
      </SettingsPopup>
    </div>
  );
}
