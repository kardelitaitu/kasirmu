import { useState, useCallback, useEffect, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  listProductVariants,
  createProductVariant,
  updateProductVariant,
  deleteProductVariant,
  type ProductVariantDto,
} from '@/api/products';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { SettingsPopup, requiredLocalized, EmptyState } from '@/components';
import { NoVariantsIcon } from '@/components/EmptyStateIllustrations';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { minorUnitExponent } from '@/types/domain';

interface Props {
  productSku: string;
  productName: string;
  onClose: () => void;
}

interface VariantForm {
  name: string;
  sku: string;
  priceMinor: string;
  currency: string;
  barcode: string;
  sortOrder: string;
  isActive: boolean;
}

const EMPTY_FORM: VariantForm = {
  name: '',
  sku: '',
  priceMinor: '',
  currency: '',
  barcode: '',
  sortOrder: '0',
  isActive: true,
};

/** Variant management screen — manage product variants (size, colour, etc.) with separate SKU, pricing, and barcode. */
export default function VariantManagementScreen({ productSku, productName, onClose }: Props) {
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [variants, setVariants] = useState<ProductVariantDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [form, setForm] = useState<VariantForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingSku, setDeletingSku] = useState<string | null>(null);
  const [confirmDeleteSku, setConfirmDeleteSku] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { l10n } = useLocalization();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true, onClose);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const dtos = await listProductVariants(sessionToken, productSku);
      setVariants(dtos);
    } catch {
      setLoadError('variant-mgmt-error-load');
    } finally {
      setLoading(false);
    }
  }, [productSku, sessionToken]);

  useEffect(() => { load(); }, [load]);

  const openCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditingSku(null);
    setShowModal(true);
  }, []);

  const openEdit = useCallback((v: ProductVariantDto) => {
    setForm({
      name: v.name,
      sku: v.sku,
      priceMinor: v.price != null ? String(v.price.minor_units) : '',
      currency: v.price != null ? v.price.currency : '',
      barcode: v.barcode ?? '',
      sortOrder: String(v.sort_order),
      isActive: v.is_active,
    });
    setEditingSku(v.sku);
    setShowModal(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const hasPrice = form.priceMinor.trim() !== '' && form.currency.trim() !== '';
      // VARIANT-03: prices are integer minor units — `parseInt('4.50')`
      // would silently truncate to 4, so reject fractional input instead.
      const priceMinor = hasPrice ? Number(form.priceMinor) : null;
      if (priceMinor !== null && (!Number.isInteger(priceMinor) || priceMinor < 0)) {
        setSaving(false);
        setSaveError(l10n.getString('variant-mgmt-error-invalid-price'));
        return;
      }

      // Variant-mgmt-error-save key is surfaced here (was an empty catch).
      const sortOrderNum = Number(form.sortOrder);
      if (!Number.isInteger(sortOrderNum) || sortOrderNum < 0) {
        setSaving(false);
        setSaveError(l10n.getString('variant-mgmt-error-invalid-sort'));
        return;
      }

      if (editingSku) {
        await updateProductVariant(sessionToken, {
          sku: editingSku,
          name: form.name,
          priceMinor: hasPrice ? priceMinor : null,
          currency: hasPrice ? form.currency : null,
          barcode: form.barcode || null,
          sortOrder: sortOrderNum,
          isActive: form.isActive,
        });
      } else {
        await createProductVariant(sessionToken, {
          parentSku: productSku,
          name: form.name,
          sku: form.sku,
          priceMinor: hasPrice ? priceMinor : null,
          currency: hasPrice ? form.currency : null,
          barcode: form.barcode || null,
          sortOrder: sortOrderNum,
        });
      }
      setShowModal(false);
      await load();
    } catch {
      setSaveError(l10n.getString('variant-mgmt-error-save'));
    } finally {
      setSaving(false);
    }
  }, [form, editingSku, productSku, load, l10n, sessionToken]);

  const handleDelete = useCallback(async () => {
    if (!confirmDeleteSku) return;
    setDeletingSku(confirmDeleteSku);
    setDeleteError(null);
    try {
      await deleteProductVariant(sessionToken, confirmDeleteSku);
      setConfirmDeleteSku(null);
      await load();
    } catch {
      // Variant-mgmt-error-delete key is surfaced here (was an empty catch).
      setDeleteError(l10n.getString('variant-mgmt-error-delete'));
    } finally {
      setDeletingSku(null);
    }
  }, [confirmDeleteSku, load, l10n, sessionToken]);

  return (
    <div className="product-mgmt-overlay" role="dialog" aria-modal="true" aria-label={l10n.getString('variant-mgmt-overlay-aria', { name: productName })}>
      <div ref={panelRef} className="product-mgmt-modal" style={{ width: '640px' }}>
        <div className="product-mgmt-modal-header">
          <Localized id="variant-mgmt-title" vars={{ product: productName }}>
            <h2>Variants — {productName}</h2>
          </Localized>
          <Localized id="variant-mgmt-close-aria" attrs={{ 'aria-label': true }}>
            <button
              type="button"
              className="product-mgmt-modal-close"
              onClick={onClose}
              aria-label={l10n.getString('close-aria')}
            >
              &times;
            </button>
          </Localized>
        </div>

        <div className="product-mgmt-modal-body">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-3)' }}>
            <Localized id="variant-mgmt-add">
              <Button onClick={openCreate}>Add Variant</Button>
            </Localized>
          </div>

          {loadError ? (
            <div className="product-mgmt-empty">
              <Localized id={loadError}>
                <p>Failed to load variants</p>
              </Localized>
              <Button variant="secondary" onClick={load}>{requiredLocalized(l10n, 'variant-mgmt-error-retry')}</Button>
            </div>
          ) : loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }} aria-hidden="true">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-3)' }}>
                <Skeleton variant="block" width="7rem" height="2.25rem" />
              </div>
              <div className="product-mgmt-table-wrap">
                <table className="product-mgmt-table" aria-hidden="true">
                  <thead>
                    <tr>
                      {['Name', 'SKU', 'Price', 'Barcode', 'Status', ''].map((_, i) => (
                        <th key={i}><Skeleton variant="text" width={i < 5 ? '4rem' : '3rem'} height="0.75rem" /></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{[0, 1, 2, 3].map((r) => (
                      <tr key={r}>
                        <td><Skeleton variant="text" width="6rem" height="0.875rem" /></td>
                        <td><Skeleton variant="text" width="6rem" height="0.75rem" /></td>
                        <td><Skeleton variant="text" width="4rem" height="0.875rem" /></td>
                        <td><Skeleton variant="text" width="5rem" height="0.75rem" /></td>
                        <td><Skeleton variant="text" width="3rem" height="0.875rem" /></td>
                        <td className="product-mgmt-cell-actions">
                          <Skeleton variant="block" width="3rem" height="1.375rem" />
                          <Skeleton variant="block" width="3rem" height="1.375rem" />
                        </td>
                      </tr>
                    ))}
</tbody>
                </table>
              </div>
            </div>
          ) : variants.length === 0 ? (
            <EmptyState
              region="modal"
              icon={<NoVariantsIcon />}
              title={requiredLocalized(l10n, 'variant-mgmt-empty')}
              action={{
                label: requiredLocalized(l10n, 'variant-mgmt-empty-cta'),
                onClick: openCreate,
              }}
            />
          ) : (
            <div className="product-mgmt-table-wrap">
              <table className="product-mgmt-table" aria-label={l10n.getString('variant-mgmt-table-aria')}>
                <thead>
                  <tr>
                    <Localized id="variant-mgmt-col-name"><th>Name</th></Localized>
                    <Localized id="variant-mgmt-col-sku"><th>SKU</th></Localized>
                    <Localized id="variant-mgmt-col-price"><th>Price</th></Localized>
                    <Localized id="variant-mgmt-col-barcode"><th>Barcode</th></Localized>
                    <Localized id="variant-mgmt-col-status"><th>Status</th></Localized>
                    <Localized id="variant-mgmt-actions-aria" attrs={{ 'aria-label': true }}>
                      <th aria-label={l10n.getString('actions-aria')}> </th>
                    </Localized>
                  </tr>
                </thead>
                <tbody>{variants.map((v) => (
                    <tr key={v.sku}>
                      <td>{v.name}</td>
                      <td className="product-mgmt-cell-sku">{v.sku}</td>
                      <td className="product-mgmt-cell-price">
                        {v.price != null ? (
                          <span>{formatVariantPrice(v.price.minor_units, v.price.currency)}</span>
                        ) : (
                          <Localized id="variant-mgmt-price-parent">
                            <span style={{ fontStyle: 'italic', color: 'var(--color-fg-tertiary)' }}>Uses parent price</span>
                          </Localized>
                        )}
                      </td>
                      <td className="product-mgmt-cell-barcode">{v.barcode ?? '\u2014'}</td>
                      <td>
                        {v.is_active ? (
                          <span style={{ color: 'var(--color-success, #16a34a)', fontWeight: 500 }}>
                            <Localized id="variant-mgmt-status-active"><span>Active</span></Localized>
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-fg-tertiary)' }}>
                            <Localized id="variant-mgmt-status-inactive"><span>Inactive</span></Localized>
                          </span>
                        )}
                      </td>
                      <td className="product-mgmt-cell-actions">
                        <Localized id="variant-mgmt-edit-aria" attrs={{ 'aria-label': true }} vars={{ name: v.name }}>
                          <button
                            type="button"
                            className="product-mgmt-action-btn"
                            onClick={() => openEdit(v)}

                          >
                            <Localized id="variant-mgmt-edit">
                              <span>Edit</span>
                            </Localized>
                          </button>
                        </Localized>
                        <Localized id="variant-mgmt-delete-aria" attrs={{ 'aria-label': true }} vars={{ name: v.name }}>
                          <button
                            type="button"
                            className="product-mgmt-action-btn product-mgmt-action-btn--danger"
                            onClick={() => setConfirmDeleteSku(v.sku)}
                            disabled={deletingSku === v.sku}

                          >
                            <Localized id="variant-mgmt-delete">
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
        </div>

        <SettingsPopup
          open={showModal}
          onClose={() => setShowModal(false)}
          title={l10n.getString(editingSku ? 'variant-mgmt-modal-edit-title' : 'variant-mgmt-modal-add-title')}
          saving={saving}
          onSave={handleSave}
          saveLabel={l10n.getString(editingSku ? 'variant-mgmt-btn-update' : 'variant-mgmt-btn-create')}
          saveDisabled={!form.name.trim() || !form.sku.trim()}
          cancelLabel={l10n.getString('variant-mgmt-btn-cancel')}
        >
          {saveError && (
            <div className="product-mgmt-modal-error" role="alert">
              {saveError}
            </div>
          )}
          <label className="product-mgmt-field" htmlFor="variant-field-name">
            {l10n.getString('variant-mgmt-field-name-required')}
            <Localized id="variant-mgmt-name-placeholder" attrs={{ placeholder: true }}>
              <input
                className="product-mgmt-input"
                type="text"
                id="variant-field-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Large"
              />
            </Localized>
          </label>

          <label className="product-mgmt-field" htmlFor="variant-field-sku">
            {l10n.getString('variant-mgmt-field-sku-required')}
            <Localized id="variant-mgmt-sku-placeholder" attrs={{ placeholder: true }}>
              <input
                className="product-mgmt-input"
                type="text"
                id="variant-field-sku"
                value={form.sku}
                onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))}
                disabled={!!editingSku}
                placeholder="e.g. TEA-LARGE"
              />
            </Localized>
          </label>

          <div className="product-mgmt-row">
            <label className="product-mgmt-field" htmlFor="variant-field-price">
              {l10n.getString('variant-mgmt-field-price')}
              <Localized id="variant-mgmt-price-placeholder" attrs={{ placeholder: true }}>
                <input
                  className="product-mgmt-input"
                  type="number"
                  id="variant-field-price"
                  min="0"
                  value={form.priceMinor}
                  onChange={(e) => setForm((prev) => ({ ...prev, priceMinor: e.target.value }))}
                  placeholder="450"
                />
              </Localized>
            </label>

            <label className="product-mgmt-field" htmlFor="variant-field-currency">
              {l10n.getString('variant-mgmt-field-currency')}
              <Localized id="variant-mgmt-currency-placeholder" attrs={{ placeholder: true }}>
                <input
                  className="product-mgmt-input"
                  type="text"
                  id="variant-field-currency"
                  value={form.currency}
                  onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
                  placeholder="USD"
                  maxLength={3}
                />
              </Localized>
            </label>
          </div>

          <label className="product-mgmt-field" htmlFor="variant-field-barcode">
            {l10n.getString('variant-mgmt-field-barcode')}
            <Localized id="variant-mgmt-barcode-placeholder" attrs={{ placeholder: true }}>
              <input
                className="product-mgmt-input"
                type="text"
                id="variant-field-barcode"
                value={form.barcode}
                onChange={(e) => setForm((prev) => ({ ...prev, barcode: e.target.value }))}
                placeholder="4901234567890"
              />
            </Localized>
          </label>

          <div className="product-mgmt-row">
            <label className="product-mgmt-field" htmlFor="variant-field-sort">
              {l10n.getString('variant-mgmt-field-sort-order')}
              <Localized id="variant-mgmt-sort-placeholder" attrs={{ placeholder: true }}>
                <input
                  className="product-mgmt-input"
                  type="number"
                  id="variant-field-sort"
                  min="0"
                  value={form.sortOrder}
                  onChange={(e) => setForm((prev) => ({ ...prev, sortOrder: e.target.value }))}
                  placeholder="0"
                />
              </Localized>
            </label>

            <label className="product-mgmt-field" htmlFor="variant-field-active" style={{ justifyContent: 'flex-end', paddingBottom: 'var(--space-1)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <input
                  type="checkbox"
                  id="variant-field-active"
                  checked={form.isActive}
                  onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                />
                {l10n.getString('variant-mgmt-field-active')}
              </span>
            </label>
          </div>
        </SettingsPopup>

        {deleteError && (
          <div className="product-mgmt-delete-error" role="alert">
            {deleteError}
          </div>
        )}

        <SettingsPopup
          open={!!confirmDeleteSku}
          onClose={() => setConfirmDeleteSku(null)}
          title={l10n.getString('variant-mgmt-delete-confirm-title')}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDeleteSku(null)} disabled={!!deletingSku}>
                <Localized id="variant-mgmt-delete-confirm-cancel">
                  <span>Cancel</span>
                </Localized>
              </Button>
              <Button variant="danger" loading={!!deletingSku} onClick={handleDelete}>
                <Localized id="variant-mgmt-delete-confirm-confirm">
                  <span>Delete</span>
                </Localized>
              </Button>
            </>
          }
        >
          {(() => {
            const v = variants.find((x) => x.sku === confirmDeleteSku);
            return v ? (
              <Localized id="variant-mgmt-delete-confirm-body" vars={{ name: v.name, sku: v.sku }}>
                <p>Are you sure you want to delete variant &quot;{v.name}&quot; ({v.sku})? This action cannot be undone.</p>
              </Localized>
            ) : null;
          })()}
        </SettingsPopup>
      </div>
    </div>
  );
}

function formatVariantPrice(minorUnits: number, currency: string): string {
  // Shared exponent helper (types/domain.ts): treats IDR as exp 0 like
  // formatMoney — the inline map here previously omitted IDR and displayed
  // IDR variant prices 100x too small (6,250,000 minor → Rp 62,500).
  const exp = minorUnitExponent(currency);
  const major = minorUnits / 10 ** exp;
  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  return fmt.format(major);
}
