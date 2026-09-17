import { useState, useCallback, useEffect } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  listBundles,
  createBundle,
  updateBundle,
  deleteBundle,
  type BundleWithItems,
  type CreateBundleArgs,
} from '@/api/bundles';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { SettingsPopup } from '@/components';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { formatMoney } from '@/types/domain';
import './BundleManagementScreen.css';

interface BundleItemForm {
  sku: string;
  qty: string;
  unitPriceMinor: string;
}

interface FormData {
  bundle_sku: string;
  name: string;
  description: string;
  bundle_price_minor: string;
  items: BundleItemForm[];
}

const EMPTY_FORM: FormData = {
  bundle_sku: '',
  name: '',
  description: '',
  bundle_price_minor: '',
  items: [{ sku: '', qty: '1', unitPriceMinor: '' }],
};

const EMPTY_ITEM: BundleItemForm = { sku: '', qty: '1', unitPriceMinor: '' };

/** Bundle management screen — create and manage product bundles with multiple items, custom pricing, and SKU assignment. */
export default function BundleManagementScreen() {
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [bundles, setBundles] = useState<BundleWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { l10n } = useLocalization();

  const closeModal = useCallback(() => setShowModal(false), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listBundles(sessionToken);
      setBundles(result);
    } catch {
      // IPC unavailable.
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  const openCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowModal(true);
  }, []);

  const openEdit = useCallback((b: BundleWithItems) => {
    setForm({
      bundle_sku: b.bundle.bundle_sku,
      name: b.bundle.name,
      description: b.bundle.description,
      bundle_price_minor: b.bundle.bundle_price_minor != null ? String(b.bundle.bundle_price_minor) : '',
      items: b.items.map((i) => ({
        sku: i.sku,
        qty: String(i.qty),
        unitPriceMinor: i.unit_price_minor != null ? String(i.unit_price_minor) : '',
      })),
    });
    setEditingId(b.bundle.id);
    setShowModal(true);
  }, []);

  const addItemRow = useCallback(() => {
    setForm((prev) => ({ ...prev, items: [...prev.items, { ...EMPTY_ITEM }] }));
  }, []);

  const removeItemRow = useCallback((idx: number) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx),
    }));
  }, []);

  const updateItem = useCallback((idx: number, field: keyof BundleItemForm, value: string) => {
    setForm((prev) => {
      const items = [...prev.items];
      items[idx] = { ...items[idx], [field]: value } as BundleItemForm;
      return { ...prev, items };
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // BUND-05: prices are integer minor units — `parseInt('4.50')` would
      // silently truncate to 4, so reject any non-integer input instead.
      const priceMinor = form.bundle_price_minor
        ? Number(form.bundle_price_minor)
        : null;
      if (priceMinor !== null && (!Number.isInteger(priceMinor) || priceMinor < 0)) {
        setSaving(false);
        setSaveError(l10n.getString('bundles-error-invalid-price'));
        return;
      }

      const items = form.items
        .filter((i) => i.sku.trim().length > 0)
        .map((i) => {
          const qty = Number(i.qty);
          const unitPrice = i.unitPriceMinor ? Number(i.unitPriceMinor) : null;
          if (!Number.isInteger(qty) || qty < 1 ||
              (unitPrice !== null && (!Number.isInteger(unitPrice) || unitPrice < 0))) {
            throw new BundleValidationError();
          }
          return {
            sku: i.sku.trim(),
            qty,
            unit_price_minor: unitPrice,
          };
        });

      if (editingId) {
        const existing = bundles.find((b) => b.bundle.id === editingId);
        if (!existing) return;
        await updateBundle(sessionToken, {
          bundle: {
            ...existing.bundle,
            bundle_sku: form.bundle_sku,
            name: form.name,
            description: form.description,
            bundle_price_minor: priceMinor,
          },
          items: items.map((i, idx) => ({
            id: existing.items[idx]?.id ?? crypto.randomUUID(),
            bundle_id: editingId,
            sku: i.sku,
            qty: i.qty,
            unit_price_minor: i.unit_price_minor,
          })),
        });
      } else {
        await createBundle(sessionToken, {
          bundle_sku: form.bundle_sku,
          name: form.name,
          description: form.description || undefined,
          bundle_price_minor: priceMinor,
          items,
        } as CreateBundleArgs);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      if (err instanceof BundleValidationError) {
        setSaveError(l10n.getString('bundles-error-invalid-item'));
      } else {
        setSaveError(l10n.getString('bundles-error-save'));
      }
    } finally {
      setSaving(false);
    }
  }, [form, editingId, bundles, load, l10n, sessionToken]);

  const confirmDelete = useCallback(async (id: string) => {
    setDeleting(id);
    setDeleteError(null);
    try {
      await deleteBundle(sessionToken, id);
      setDeleting(null);
      await load();
    } catch {
      setDeleting(null);
      setDeleteError(l10n.getString('bundles-error-delete'));
    }
  }, [load, l10n, sessionToken]);

  const toggleActive = useCallback(async (b: BundleWithItems) => {
    await updateBundle(sessionToken, {
      bundle: { ...b.bundle, active: !b.bundle.active },
      items: b.items,
    });
    await load();
  }, [load, sessionToken]);

  return (
    <div className="bundle-mgmt">
      <div className="bundle-mgmt-header">
        <Localized id="bundles-title">
          <h1 className="bundle-mgmt-title">Product Bundles</h1>
        </Localized>
        <Localized id="bundles-add">
          <Button onClick={openCreate}>Add Bundle</Button>
        </Localized>
      </div>

      {deleteError && (
        <div className="bundle-mgmt-error" role="alert">
          {deleteError}
        </div>
      )}

      {loading ? (
        <div className="bundle-mgmt-loading-skeleton" aria-hidden="true">
          <div className="bundle-mgmt-header">
            <Skeleton variant="block" width="10rem" height="1.75rem" />
            <Skeleton variant="block" width="7rem" height="2.25rem" />
          </div>
          <div className="bundle-mgmt-table-wrap">
            <table className="bundle-mgmt-table">
              <thead>
                <tr>
                  {['Name', 'SKU', 'Price', 'Items', 'Active', ''].map((_, i) => (
                    <th key={i}><Skeleton variant="text" width="4rem" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>{Array.from({ length: 4 }).map((_, r) => (
                  <tr key={r}>
                    <td><Skeleton variant="text" width="7rem" /></td>
                    <td><Skeleton variant="text" width="5rem" /></td>
                    <td><Skeleton variant="text" width="4rem" /></td>
                    <td style={{ textAlign: 'center' }}><Skeleton variant="text" width="1.5rem" /></td>
                    <td><Skeleton variant="block" width="4rem" height="1.25rem" style={{ borderRadius: 'var(--radius-full)' }} /></td>
                    <td><Skeleton variant="block" width="5rem" height="1.5rem" /></td>
                  </tr>
                ))}
</tbody>
            </table>
          </div>
        </div>
      ) : bundles.length === 0 ? (
        <Card shadow="sm">
          <div className="bundle-mgmt-empty">
            <Localized id="bundles-no-bundles">
              <p>No bundles yet.</p>
            </Localized>
            <Localized id="bundles-add">
              <Button variant="secondary" onClick={openCreate}>Add your first bundle</Button>
            </Localized>
          </div>
        </Card>
      ) : (
        <div className="bundle-mgmt-table-wrap">
          <table className="bundle-mgmt-table" aria-label={l10n.getString('bundles-table-aria')}>
            <thead>
              <tr>
                <Localized id="bundles-name"><th>Name</th></Localized>
                <Localized id="bundles-sku"><th>SKU</th></Localized>
                <Localized id="bundles-price"><th>Price</th></Localized>
                <Localized id="bundles-items"><th>Items</th></Localized>
                <Localized id="bundles-active"><th>Active</th></Localized>
                <Localized id="bundles-actions-aria" attrs={{ 'aria-label': true }}>
                  <th aria-label={l10n.getString('actions-aria')}> </th>
                </Localized>
              </tr>
            </thead>
            <tbody>{bundles.map((b) => (
                <tr key={b.bundle.id}>
                  <td>{b.bundle.name}</td>
                  <td className="bundle-mgmt-cell-sku">{b.bundle.bundle_sku}</td>
                  <td className="bundle-mgmt-cell-price">
                    {b.bundle.bundle_price_minor != null
                      ? formatMoney({ minor_units: b.bundle.bundle_price_minor, currency: b.bundle.currency })
                      : '\u2014'}
                  </td>
                  <td>{b.items.length}</td>
                  <td>
                    <Localized id="bundles-toggle-aria" attrs={{ 'aria-label': true }} vars={{ state: b.bundle.active ? 'active' : 'inactive' }}>
                      <button
                        type="button"
                        className={`bundle-mgmt-toggle ${b.bundle.active ? 'bundle-mgmt-toggle--on' : 'bundle-mgmt-toggle--off'}`}
                        onClick={() => toggleActive(b)}

                      >
                        <Localized id={b.bundle.active ? 'bundles-toggle-active' : 'bundles-toggle-inactive'}>
                          <span>{b.bundle.active ? 'Active' : 'Inactive'}</span>
                        </Localized>
                      </button>
                    </Localized>
                  </td>
                  <td className="bundle-mgmt-cell-actions">
                    <Localized id="bundles-edit-aria" attrs={{ 'aria-label': true }} vars={{ name: b.bundle.name }}>
                      <button
                        type="button"
                        className="bundle-mgmt-action-btn"
                        onClick={() => openEdit(b)}

                      >
                        <Localized id="bundles-edit">
                          <span>Edit</span>
                        </Localized>
                      </button>
                    </Localized>
                    <Localized id="bundles-delete-aria" attrs={{ 'aria-label': true }} vars={{ name: b.bundle.name }}>
                      <button
                        type="button"
                        className="bundle-mgmt-action-btn bundle-mgmt-action-btn--danger"
                        onClick={() => confirmDelete(b.bundle.id)}
                        disabled={deleting === b.bundle.id}

                      >
                        <Localized id="bundles-delete">
                          <span>Delete</span>
                        </Localized>
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
        title={l10n.getString(editingId ? 'bundles-edit' : 'bundles-add')}
        saving={saving}
        onSave={handleSave}
        saveLabel={l10n.getString(editingId ? 'bundles-save' : 'bundles-create')}
        saveDisabled={!form.bundle_sku.trim() || !form.name.trim() || form.items.every((i) => !i.sku.trim())}
        cancelLabel={l10n.getString('bundles-cancel')}
        size="lg"
      >
        {saveError && (
          <div className="bundle-mgmt-modal-error" role="alert">
            {saveError}
          </div>
        )}
        <label className="bundle-mgmt-field" htmlFor="bundle-field-sku">
          {l10n.getString('bundles-sku')}
          <Localized id="bundles-sku-placeholder" attrs={{ placeholder: true }}>
            <input
              className="bundle-mgmt-input"
              type="text"
              id="bundle-field-sku"
              value={form.bundle_sku}
              onChange={(e) => setForm((prev) => ({ ...prev, bundle_sku: e.target.value }))}
              disabled={!!editingId}
              placeholder="e.g. GIFT-BOX"
            />
          </Localized>
        </label>

        <label className="bundle-mgmt-field" htmlFor="bundle-field-name">
          {l10n.getString('bundles-name')}
          <Localized id="bundles-name-placeholder" attrs={{ placeholder: true }}>
            <input
              className="bundle-mgmt-input"
              type="text"
              id="bundle-field-name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Gift Box"
            />
          </Localized>
        </label>

        <label className="bundle-mgmt-field" htmlFor="bundle-field-description">
          {l10n.getString('bundles-description')}
          <Localized id="bundles-description-placeholder" attrs={{ placeholder: true }}>
            <input
              className="bundle-mgmt-input"
              type="text"
              id="bundle-field-description"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Optional description"
            />
          </Localized>
        </label>

        <label className="bundle-mgmt-field" htmlFor="bundle-field-price">
          {l10n.getString('bundles-price')}
          <Localized id="bundles-price-placeholder" attrs={{ placeholder: true }}>
            <input
              className="bundle-mgmt-input"
              type="number"
              id="bundle-field-price"
              min="0"
              value={form.bundle_price_minor}
              onChange={(e) => setForm((prev) => ({ ...prev, bundle_price_minor: e.target.value }))}
              placeholder="Leave empty to use sum of items"
            />
          </Localized>
        </label>

        <fieldset className="bundle-mgmt-field">
          <Localized id="bundles-items">
            <legend className="bundle-mgmt-label">Items</legend>
          </Localized>              <div className="bundle-mgmt-items-list">
                  {form.items.map((item, idx) => (
                    <div key={idx} className="bundle-mgmt-item-row">
                <Localized id="bundles-item-sku-field" attrs={{ placeholder: true, 'aria-label': true }} vars={{ number: idx + 1 }}>
                  <input
                    className="bundle-mgmt-input bundle-mgmt-item-sku"
                    type="text"
                    value={item.sku}
                    onChange={(e) => updateItem(idx, 'sku', e.target.value)}
                    placeholder="SKU"

                  />
                </Localized>
                <Localized id="bundles-item-qty-field" attrs={{ placeholder: true, 'aria-label': true }} vars={{ number: idx + 1 }}>
                  <input
                    className="bundle-mgmt-input bundle-mgmt-item-qty"
                    type="number"
                    min="1"
                    value={item.qty}
                    onChange={(e) => updateItem(idx, 'qty', e.target.value)}
                    placeholder="Qty"

                  />
                </Localized>
                <Localized id="bundles-item-price-field" attrs={{ placeholder: true, 'aria-label': true }} vars={{ number: idx + 1 }}>
                  <input
                    className="bundle-mgmt-input bundle-mgmt-item-price"
                    type="number"
                    min="0"
                    value={item.unitPriceMinor}
                    onChange={(e) => updateItem(idx, 'unitPriceMinor', e.target.value)}
                    placeholder="Price override"

                  />
                </Localized>
                {form.items.length > 1 && (
                  <Localized id="bundles-item-remove-aria" attrs={{ 'aria-label': true }} vars={{ number: idx + 1 }}>
                    <button
                      type="button"
                      className="bundle-mgmt-item-remove"
                      onClick={() => removeItemRow(idx)}

                    >
                      &times;
                    </button>
                  </Localized>
                )}
              </div>
            ))}
          </div>
          <Localized id="bundles-add-item">
            <Button variant="ghost" size="sm" onClick={addItemRow}>+ Add Item</Button>
          </Localized>
        </fieldset>
      </SettingsPopup>
    </div>
  );
}

/** Thrown by handleSave when a bundle item has a fractional qty/price. */
class BundleValidationError extends Error {}
