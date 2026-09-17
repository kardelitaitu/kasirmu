// ── ARCHIVED ─────────────────────────────────────────────────────
// This screen has been replaced by WarehouseScreen (features/warehouse/)
// which provides location-scoped stock management via the topology
// editor's warehouse workspace binding. ProductManagementScreen was
// the old global inventory page — kept for reference only.
// The 'inventory' route is no longer registered.
// ─────────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  listProductsScoped,
  createProductScoped,
  updateProductScoped,
  deleteProductScoped,
  listCategoriesScoped,
  type ProductDto,
  type CategoryDto,
} from '@/api/products';
import { listTaxRatesScoped, type TaxRateDto } from '@/api/tax';
import { listCurrenciesScoped, type CurrencyDto } from '@/api/currency';
import { formatMoney, type Product, type Sku } from '@/types/domain';
import { l10nErrorMessage } from '@/utils/app-error';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import VariantManagementScreen from './VariantManagementScreen';
import { StockAlertPanel } from '@/features/inventory/StockAlertPanel';
import { getActiveStockAlerts } from '@/api/inventory';
import LocationPicker from '@/features/inventory/LocationPicker';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { EmptyState, requiredLocalized } from '@/components';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NoProductsIcon } from '@/components/EmptyStateIllustrations';
import './ProductManagementScreen.css';

interface FormData {
  sku: string;
  name: string;
  priceMinor: string;
  currency: string;
  categoryId: string;
  barcode: string;
  initialStock: string;
  productType: string;
  taxRateIds: string[];
}

function emptyForm(workspaceType: string): FormData {
  return {
    sku: '',
    name: '',
    priceMinor: '',
    currency: 'USD',
    categoryId: '',
    barcode: '',
    initialStock: '0',
    productType: workspaceType === 'restaurant-pos' ? 'restaurant' : 'retail',
    taxRateIds: [],
  };
}

function dtoToProduct(dto: ProductDto): Product {
  return {
    sku: dto.sku as Sku,
    name: dto.name,
    category: dto.category ?? 'Uncategorised',
    price: { minor_units: dto.price.minor_units, currency: dto.price.currency },
    barcode: dto.barcode,
    inStock: dto.in_stock,
    stockQty: dto.stock_qty,
    priceUpdatedAt: dto.price_updated_at,
    productType: dto.product_type as Product['productType'],
  };
}

/** Product management screen — full CRUD for products, including SKU, pricing, barcode, tax rates, and variant management. */
export default function ProductManagementScreen() {
  const { sessionToken: rawToken, activeWorkspace } = useWorkspace();
  const sessionToken = rawToken || '';
  const [products, setProducts] = useState<Product[]>([]);
  const [productDtos, setProductDtos] = useState<ProductDto[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRateDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);

  const modalExit = useExitAnimation(showModal, () => setShowModal(false));
  const [form, setForm] = useState<FormData>(() => emptyForm(activeWorkspace ?? ''));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteConfirmSku, setDeleteConfirmSku] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [variantProductSku, setVariantProductSku] = useState<string | null>(null);
  const [variantProductName, setVariantProductName] = useState<string>('');

  const [showAlertPanel, setShowAlertPanel] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState('default');
  const [selectedLocationName, setSelectedLocationName] = useState('Location');
  const [alertCount, setAlertCount] = useState(0);
  const [alertError, setAlertError] = useState(false);

  const handleLocationChange = useCallback((locationId: string, locationName: string) => {
    setSelectedLocationId(locationId);
    setSelectedLocationName(locationName);
  }, []);

  // ── Poll active stock alerts for the bell badge count ──────
  // PROD-10: a failed poll is now visible (alertError) instead of being
  // silently ignored, and the drawer offers an explicit retry. The seq guard
  // (same pattern as `load`) ensures a slow poll for an old location/session
  // can never overwrite a newer one.
  const pollSeqRef = useRef(0);
  const fetchAlerts = useCallback(async () => {
    const token = sessionToken ?? '';
    if (!token) return;
    const seq = ++pollSeqRef.current;
    try {
      const alerts = await getActiveStockAlerts(token, selectedLocationId);
      if (seq !== pollSeqRef.current) return;
      setAlertCount(alerts.length);
      setAlertError(false);
    } catch {
      if (seq !== pollSeqRef.current) return;
      setAlertError(true);
    }
  }, [sessionToken, selectedLocationId]);

  useEffect(() => {
    void fetchAlerts();
    const interval = setInterval(() => { void fetchAlerts(); }, 30_000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const { l10n } = useLocalization();
  // PROD-04: keep l10n in a ref so `load` is not recreated (and the product
  // list re-fetched) on every locale change — same convention as useProducts.
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  const productModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(productModalRef, showModal && modalExit.shouldRender && !modalExit.exiting, modalExit.requestClose);
  // PROD-08: the stock-alert drawer is a focus-trapped dialog — Escape and
  // the close button both dismiss it, and focus returns to the bell toggle.
  // The trap is gated on `!showModal` so the drawer and the product modal are
  // mutually exclusive (two simultaneous traps would fight over Tab and
  // body-scroll lock).
  const alertDrawerRef = useRef<HTMLDivElement>(null);
  const alertToggleRef = useRef<HTMLButtonElement>(null);
  const closeAlertDrawer = useCallback(() => {
    setShowAlertPanel(false);
    alertToggleRef.current?.focus();
  }, []);
  useFocusTrap(alertDrawerRef, showAlertPanel && !showModal, closeAlertDrawer);

  // PROD-11: request-sequence guard so a slower earlier load can never
  // overwrite a newer result (session switch or mutation refresh).
  const loadSeqRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  // A workspace/session switch is a fresh catalog — reset the skeleton gate
  // so the new store's first load shows loading instead of the old store's
  // rows while it resolves.
  useEffect(() => {
    hasLoadedOnceRef.current = false;
  }, [sessionToken]);
  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    // Only the first load shows the skeleton — refreshes preserve the last
    // known catalog on screen (PROD-04) instead of flashing a skeleton over
    // rows the operator may be looking at.
    if (!hasLoadedOnceRef.current) {
      setLoading(true);
    }
    setLoadError(null);
    try {
      // TAX-01: tax rates and categories are read from the session store,
      // not the global DB — per-product tax assignment must resolve the same
      // store the products came from.
      const [dtos, rates, cats, currencyList] = await Promise.all([listProductsScoped(sessionToken), listTaxRatesScoped(sessionToken), listCategoriesScoped(sessionToken), listCurrenciesScoped(sessionToken)]);
      if (seq !== loadSeqRef.current) return;
      setProductDtos(dtos);
      setProducts(dtos.map(dtoToProduct));
      setTaxRates(rates);
      setCategories(cats);
      setCurrencies(currencyList);
      hasLoadedOnceRef.current = true;
    } catch (err) {
      // PROD-04: distinguish a failed load from a genuinely empty catalog.
      if (seq !== loadSeqRef.current) return;
      setLoadError(l10nErrorMessage(err, l10nRef.current, 'product-mgmt-error-load'));
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  const openCreate = useCallback(() => {
    setForm(emptyForm(activeWorkspace ?? ''));
    setEditingSku(null);
    setSaveError(null);
    setShowAlertPanel(false);
    setShowModal(true);
  }, [activeWorkspace]);

  const openEdit = useCallback((p: Product) => {
    const dto = productDtos.find((d) => d.sku === p.sku);
    setForm({
      sku: p.sku,
      name: p.name,
      priceMinor: String(p.price.minor_units),
      currency: p.price.currency,
      categoryId: p.category === 'Uncategorised' ? '' : p.category,
      barcode: p.barcode ?? '',
      initialStock: '0',
      productType: p.productType,
      taxRateIds: dto?.tax_rate_ids ?? [],
    });
    setEditingSku(p.sku);
    setSaveError(null);
    setShowAlertPanel(false);
    setShowModal(true);
  }, [productDtos]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // PROD-05: reject anything that is not a complete non-negative integer.
      // `parseInt('4.50')` silently truncates to 4 — that must not reach the
      // backend as a 100×-smaller price.
      const priceRaw = form.priceMinor.trim();
      const priceMinor = Number(priceRaw);
      const priceIsValid =
        priceRaw !== '' &&
        /^\d+$/.test(priceRaw) &&
        Number.isSafeInteger(priceMinor) &&
        priceMinor >= 0;
      if (!priceIsValid) {
        setSaveError(requiredLocalized(l10nRef.current, 'product-mgmt-error-invalid-price'));
        return;
      }

      // PROD-06: initial stock must be a complete non-negative integer too.
      // HTML `min` is not a submit-time guarantee; blank/`1abc`/`-1` are all
      // rejected rather than silently transformed, and safe-integer bounds
      // keep huge digit strings from overflowing the backend i64.
      const initialStockRaw = form.initialStock.trim();
      const initialStock = Number(initialStockRaw);
      const initialStockValid =
        initialStockRaw !== '' &&
        /^\d+$/.test(initialStockRaw) &&
        Number.isSafeInteger(initialStock);
      if (!editingSku && !initialStockValid) {
        setSaveError(requiredLocalized(l10nRef.current, 'product-mgmt-error-invalid-stock'));
        return;
      }

      if (editingSku) {
        await updateProductScoped(sessionToken, {
          sku: editingSku,
          name: form.name,
          priceMinor,
          currency: form.currency,
          categoryId: form.categoryId || undefined,
          barcode: form.barcode || undefined,
          productType: form.productType,
          taxRateIds: form.taxRateIds,
        });
      } else {
        await createProductScoped(sessionToken, {
          sku: form.sku,
          name: form.name,
          priceMinor,
          currency: form.currency,
          categoryId: form.categoryId || undefined,
          barcode: form.barcode || undefined,
          initialStock,
          productType: form.productType,
          taxRateIds: form.taxRateIds,
        });
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setSaveError(
        l10nErrorMessage(err, l10n, 'product-mgmt-error-save')
      );
    } finally {
      setSaving(false);
    }
  }, [form, editingSku, load, sessionToken, l10n]);

  // PROD-02: deletion goes through a confirmation dialog first.
  const requestDelete = useCallback((sku: string) => {
    setDeleteError(null);
    setDeleteConfirmSku(sku);
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteConfirmSku(null);
    setDeleteError(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirmSku) return;
    setDeleting(deleteConfirmSku);
    setDeleteError(null);
    try {
      await deleteProductScoped(sessionToken, deleteConfirmSku);
      setDeleteConfirmSku(null);
      await load();
    } catch (err) {
      // PROD-03: surface the failure instead of swallowing it.
      setDeleteConfirmSku(null);
      setDeleteError(l10nErrorMessage(err, l10nRef.current, 'product-mgmt-error-delete'));
    } finally {
      setDeleting(null);
    }
  }, [deleteConfirmSku, load, sessionToken]);

  return (
    <div className="product-mgmt">
      <div className="product-mgmt-header">
        <Localized id="product-mgmt-title">
          <h1 className="product-mgmt-title">Products</h1>
        </Localized>
        <div className="product-mgmt-header-actions">
          <LocationPicker
            value={selectedLocationId}
            onChange={handleLocationChange}
            label={selectedLocationName}
          />
          <button
            ref={alertToggleRef}
            type="button"
            className="product-mgmt-alert-toggle"
            onClick={() => setShowAlertPanel((prev) => !prev)}
            aria-label={showAlertPanel ? requiredLocalized(l10n, 'product-mgmt-stock-alert-close') : (alertCount > 0 ? requiredLocalized(l10n, 'product-mgmt-alert-count', { count: String(alertCount) }) : requiredLocalized(l10n, 'product-mgmt-stock-alert-open'))}
            aria-expanded={showAlertPanel}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {alertCount > 0 && (
              <span className="product-mgmt-alert-badge" aria-hidden="true">
                {alertCount}
              </span>
            )}
          </button>
          <Localized id="product-mgmt-add">
            <Button onClick={openCreate}>Add Product</Button>
          </Localized>
        </div>
      </div>

      {loading ? (
        <div className="product-mgmt-loading-skeleton" aria-hidden="true">
          <div className="product-mgmt-header">
            <Skeleton variant="block" width="8rem" height="1.75rem" />
            <Skeleton variant="block" width="8rem" height="2.25rem" />
          </div>
          <div className="product-mgmt-table-wrap">
            <table className="product-mgmt-table" aria-hidden="true">
              <thead>
                <tr>
                  {['SKU', 'Name', 'Category', 'Price', 'Barcode', 'Type', 'Stock', ''].map((_, i) => (
                    <th key={i}><Skeleton variant="text" width={i < 7 ? '4rem' : '3rem'} height="0.75rem" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>{[0, 1, 2, 3].map((r) => (
                  <tr key={r}>
                    <td><Skeleton variant="text" width="5rem" height="0.75rem" /></td>
                    <td><Skeleton variant="text" width="8rem" height="0.875rem" /></td>
                    <td><Skeleton variant="text" width="6rem" height="0.875rem" /></td>
                    <td><Skeleton variant="text" width="4rem" height="0.875rem" style={{ textAlign: 'right' }} /></td>
                    <td><Skeleton variant="text" width="6rem" height="0.75rem" /></td>
                    <td><Skeleton variant="block" width="4rem" height="1.125rem" style={{ borderRadius: 'var(--radius-full)' }} /></td>
                    <td><Skeleton variant="text" width="3rem" height="0.875rem" /></td>
                    <td className="product-mgmt-cell-actions">
                      <Skeleton variant="block" width="3.5rem" height="1.375rem" />
                      <Skeleton variant="block" width="3.5rem" height="1.375rem" />
                      <Skeleton variant="block" width="3.5rem" height="1.375rem" />
                    </td>
                  </tr>
                ))}
</tbody>
            </table>
          </div>
        </div>
      ) : loadError && products.length === 0 ? (
        <Card shadow="sm">
          <div className="product-mgmt-empty" role="alert">
            <EmptyState
              icon={<NoProductsIcon />}
              title={requiredLocalized(l10n, 'product-mgmt-error-load')}
              action={{ label: requiredLocalized(l10n, 'product-mgmt-error-retry'), onClick: () => { void load(); } }}
            />
            {loadError && loadError !== requiredLocalized(l10n, 'product-mgmt-error-load') && (
              <p className="product-mgmt-load-error-detail">{loadError}</p>
            )}
          </div>
        </Card>
      ) : products.length === 0 ? (
        <Card shadow="sm">
          <div className="product-mgmt-empty">
            <EmptyState
              icon={<NoProductsIcon />}
              title={requiredLocalized(l10n, 'product-mgmt-empty')}
              action={{ label: requiredLocalized(l10n, 'product-mgmt-empty-cta'), onClick: openCreate }}
            />
          </div>
        </Card>
      ) : (
        <div className="product-mgmt-table-wrap">
          <table className="product-mgmt-table" aria-label={l10n.getString('product-mgmt-table-aria')}>
            <thead>
              <tr>
                <Localized id="product-mgmt-col-sku"><th>SKU</th></Localized>
                <Localized id="product-mgmt-col-name"><th>Name</th></Localized>
                <Localized id="product-mgmt-col-category"><th>Category</th></Localized>
                <Localized id="product-mgmt-col-price"><th>Price</th></Localized>
                <Localized id="product-mgmt-col-barcode"><th>Barcode</th></Localized>
                <Localized id="product-mgmt-col-type"><th>Type</th></Localized>
                <Localized id="product-mgmt-col-stock"><th>Stock</th></Localized>
                <Localized id="product-mgmt-actions-aria" attrs={{ 'aria-label': true }}>
                  <th aria-label={l10n.getString('actions-aria')}> </th>
                </Localized>
              </tr>
            </thead>
            <tbody>{products.map((p) => (
                <tr key={p.sku}>
                  <td className="product-mgmt-cell-sku">{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.category}</td>
                  <td className="product-mgmt-cell-price">{formatMoney(p.price)}</td>
                  <td className="product-mgmt-cell-barcode">{p.barcode ?? '\u2014'}</td>
                  <td>
                    <span className={`product-mgmt-type-badge product-mgmt-type--${p.productType}`}>
                      {p.productType}
                    </span>
                  </td>
                  <td>
                    {p.stockQty != null && p.stockQty < 10 ? (
                      <span className="product-mgmt-stock-low">
                        {p.stockQty}
                      </span>
                    ) : p.stockQty != null ? (
                      <span>{p.stockQty}</span>
                    ) : p.inStock ? (
                      <Localized id="product-mgmt-stock-in">
                        <span className="product-mgmt-stock-ok">In stock</span>
                      </Localized>
                    ) : (
                      <Localized id="product-mgmt-stock-out">
                        <span className="product-mgmt-stock-low">Out of stock</span>
                      </Localized>
                    )}
                  </td>
                  <td className="product-mgmt-cell-actions">
                    <button
                      type="button"
                      className="product-mgmt-action-btn"
                      onClick={() => {
                        setVariantProductSku(p.sku);
                        setVariantProductName(p.name);
                      }}
                      aria-label={requiredLocalized(l10n, 'product-mgmt-variants-aria', { name: p.name })}
                    >
                      <Localized id="product-mgmt-variants">
                        <span>Variants</span>
                      </Localized>
                    </button>
                    <button
                      type="button"
                      className="product-mgmt-action-btn"
                      onClick={() => openEdit(p)}
                      aria-label={requiredLocalized(l10n, 'product-mgmt-edit-aria', { name: p.name })}
                    >
                      <Localized id="product-mgmt-edit">
                        <span>Edit</span>
                      </Localized>
                    </button>
                    <button
                      type="button"
                      className="product-mgmt-action-btn product-mgmt-action-btn--danger"
                      onClick={() => requestDelete(p.sku)}
                      disabled={deleting === p.sku}
                      aria-label={requiredLocalized(l10n, 'product-mgmt-delete-aria', { name: p.name })}
                    >
                      <Localized id="product-mgmt-delete">
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

      {deleteError && (
        <div className="product-mgmt-delete-error" role="alert">
          {deleteError}
        </div>
      )}

      {modalExit.shouldRender && showModal && (
        <div className={`product-mgmt-overlay${modalExit.exiting ? ' product-mgmt-overlay--exiting' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('product-mgmt-modal-aria', { mode: editingSku ? 'edit' : 'add' })}>
          <div ref={productModalRef} className={`product-mgmt-modal${modalExit.exiting ? ' product-mgmt-modal--exiting' : ''}`}>
            <div className="product-mgmt-modal-header">
              <Localized id={editingSku ? 'product-mgmt-modal-edit-title' : 'product-mgmt-modal-add-title'}>
                <h2>{editingSku ? 'Edit Product' : 'Add Product'}</h2>
              </Localized>
              <Localized id="product-mgmt-modal-close-aria" attrs={{ 'aria-label': true }}>
                <button
                  type="button"
                  className="product-mgmt-modal-close"
                  onClick={modalExit.requestClose}
                  aria-label={l10n.getString('close-aria')}
                >
                  &times;
                </button>
              </Localized>
            </div>

            <div className="product-mgmt-modal-body">
              <label className="product-mgmt-field" htmlFor="product-field-sku">
                {l10n.getString('product-mgmt-field-sku-required')}
                <Localized id="product-mgmt-sku-placeholder" attrs={{ placeholder: true }}>
                  <input
                    className="product-mgmt-input"
                    type="text"
                    id="product-field-sku"
                    value={form.sku}
                    onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))}
                    disabled={!!editingSku}
                    placeholder="e.g. LATTE"
                  />
                </Localized>
              </label>

              <label className="product-mgmt-field" htmlFor="product-field-name">
                {l10n.getString('product-mgmt-field-name-required')}
                <Localized id="product-mgmt-name-placeholder" attrs={{ placeholder: true }}>
                  <input
                    className="product-mgmt-input"
                    type="text"
                    id="product-field-name"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Caffè Latte"
                  />
                </Localized>
              </label>

              <div className="product-mgmt-row">
                <label className="product-mgmt-field" htmlFor="product-field-price">
                  {l10n.getString('product-mgmt-field-price')}
                  <Localized id="product-mgmt-price-placeholder" attrs={{ placeholder: true }}>
                    <input
                      className="product-mgmt-input"
                      type="number"
                      id="product-field-price"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={form.priceMinor}
                      onChange={(e) => setForm((prev) => ({ ...prev, priceMinor: e.target.value }))}
                      placeholder="450"
                    />
                  </Localized>
                </label>

                <label className="product-mgmt-field" htmlFor="product-field-currency">
                  <Localized id="product-mgmt-field-currency">
                    <span className="product-mgmt-label">Currency</span>
                  </Localized>
                  <select
                    className="product-mgmt-input product-mgmt-select"
                    id="product-field-currency"
                    value={form.currency}
                    onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
                  >
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code}>{c.code} — {c.symbol}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="product-mgmt-field" htmlFor="product-field-category">
                <Localized id="product-mgmt-field-category">
                  <span className="product-mgmt-label">Category</span>
                </Localized>
                <select
                  className="product-mgmt-input product-mgmt-select"
                  id="product-field-category"
                  value={form.categoryId}
                  onChange={(e) => setForm((prev) => ({ ...prev, categoryId: e.target.value }))}
                >
                  <Localized id="product-mgmt-no-category">
                    <option value="">— No category —</option>
                  </Localized>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </label>

              <label className="product-mgmt-field" htmlFor="product-field-barcode">
                {l10n.getString('product-mgmt-field-barcode')}
                <Localized id="product-mgmt-barcode-placeholder" attrs={{ placeholder: true }}>
                  <input
                    className="product-mgmt-input"
                    type="text"
                    id="product-field-barcode"
                    value={form.barcode}
                    onChange={(e) => setForm((prev) => ({ ...prev, barcode: e.target.value }))}
                    placeholder="4901234567890"
                  />
                </Localized>
              </label>

              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="product-mgmt-field" htmlFor="product-field-type">
                <Localized id="product-mgmt-field-type">
                  <span className="product-mgmt-label">Product Type</span>
                </Localized>
                <select
                  className="product-mgmt-input product-mgmt-select"
                  id="product-field-type"
                  value={form.productType}
                  onChange={(e) => setForm((prev) => ({ ...prev, productType: e.target.value }))}
                >
                  <option value="retail">{requiredLocalized(l10n, 'product-type-retail')}</option>
                  <option value="restaurant">{requiredLocalized(l10n, 'product-type-restaurant')}</option>
                  <option value="service">{requiredLocalized(l10n, 'product-type-service')}</option>
                </select>
              </label>

              {taxRates.length > 0 && (
                <fieldset className="product-mgmt-field">
                  <Localized id="product-mgmt-field-tax-rates">
                    <legend className="product-mgmt-label">Tax Rates</legend>
                  </Localized>
                  <div className="product-mgmt-tax-rate-list">
                    {taxRates.map((tr) => (
                      <label
                        key={tr.id}
                        className="product-mgmt-tax-rate-option"
                      >
                        <input
                          type="checkbox"
                          checked={form.taxRateIds.includes(tr.id)}
                          onChange={(e) => {
                            setForm({
                              ...form,
                              taxRateIds: e.target.checked
                                ? [...form.taxRateIds, tr.id]
                                : form.taxRateIds.filter((id) => id !== tr.id),
                            });
                          }}
                        />
                        {tr.name} ({tr.display_rate})
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {!editingSku && (
                <label className="product-mgmt-field" htmlFor="product-field-stock">
                  {l10n.getString('product-mgmt-field-stock')}
                  <Localized id="product-mgmt-stock-placeholder" attrs={{ placeholder: true }}>
                    <input
                      className="product-mgmt-input"
                      type="number"
                      id="product-field-stock"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={form.initialStock}
                      onChange={(e) => setForm((prev) => ({ ...prev, initialStock: e.target.value }))}
                      placeholder="0"
                    />
                  </Localized>
                </label>
              )}
            </div>

            <div className="product-mgmt-modal-actions">
              {saveError && (
                <div className="product-mgmt-modal-error" role="alert">
                  {saveError}
                </div>
              )}
              <Localized id="product-mgmt-btn-cancel">
                <Button variant="ghost" onClick={modalExit.requestClose} disabled={saving}>Cancel</Button>
              </Localized>
              <Button
                variant="primary"
                loading={saving}
                disabled={!form.sku.trim() || !form.name.trim()}
                onClick={handleSave}
              >
                <Localized id={editingSku ? 'product-mgmt-btn-update' : 'product-mgmt-btn-create'}>
                  <span>{editingSku ? 'Update' : 'Create'}</span>
                </Localized>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Stock Alert Panel (right-side drawer) ──────────── */}
      {showAlertPanel && (
        <div
          ref={alertDrawerRef}
          className="product-mgmt-alert-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={requiredLocalized(l10n, 'product-mgmt-alerts-title')}
        >
          <div className="product-mgmt-alert-drawer-header">
            <Localized id="product-mgmt-alerts-title">
              <span className="product-mgmt-alert-drawer-title">Stock Alerts</span>
            </Localized>
            <button
              type="button"
              className="product-mgmt-alert-drawer-close"
              onClick={closeAlertDrawer}
              aria-label={requiredLocalized(l10n, 'product-mgmt-alert-close')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              <Localized id="product-mgmt-alert-close">
                <span>Close</span>
              </Localized>
            </button>
          </div>
          {alertError && (
            <div className="product-mgmt-alert-error" role="alert">
              <span>{requiredLocalized(l10n, 'product-mgmt-alert-error')}</span>
              <button
                type="button"
                className="product-mgmt-alert-error-retry"
                onClick={() => { void fetchAlerts(); }}
              >
                {requiredLocalized(l10n, 'product-mgmt-alert-error-retry')}
              </button>
            </div>
          )}
          <StockAlertPanel
            locationId={selectedLocationId}
            pollIntervalMs={30_000}
            maxAlerts={50}
          />
        </div>
      )}

      {variantProductSku && (
        <VariantManagementScreen
          productSku={variantProductSku}
          productName={variantProductName}
          onClose={() => setVariantProductSku(null)}
        />
      )}

      <ConfirmDialog
        open={deleteConfirmSku !== null}
        onCancel={cancelDelete}
        onConfirm={() => { void confirmDelete(); }}
        title={requiredLocalized(l10n, 'product-mgmt-delete-confirm-title')}
        message={requiredLocalized(l10n, 'product-mgmt-delete-confirm-message', {
          name: products.find((p) => p.sku === deleteConfirmSku)?.name ?? '',
          sku: deleteConfirmSku ?? '',
        })}
        variant="danger"
        // Loading is scoped to the SKU being deleted so a second delete
        // remains confirmable while an earlier one is still in flight.
        loading={deleting !== null && deleting === deleteConfirmSku}
        confirmLabel={requiredLocalized(l10n, 'product-mgmt-delete-confirm-btn')}
      />
    </div>
  );
}
