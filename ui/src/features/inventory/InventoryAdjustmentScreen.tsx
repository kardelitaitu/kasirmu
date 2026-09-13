import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useToast } from '@/frontend/shared/Toast';
import { requiredLocalized } from '@/frontend/shared';
import {
  listProductsScoped,
  adjustStockScoped,
  type ProductDto,
} from '@/api/products';
import { formatMoney } from '@/types/domain';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { l10nErrorMessage } from '@/utils/app-error';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import './InventoryAdjustmentScreen.css';

// ── Reason options ──────────────────────────────────────────────────

const ADJUSTMENT_REASONS = [
  { value: 'restock', id: 'inv-reason-restock' },
  { value: 'stock-take', id: 'inv-reason-stock-take' },
  { value: 'return', id: 'inv-reason-return' },
  { value: 'damaged', id: 'inv-reason-damaged' },
  { value: 'write-off', id: 'inv-reason-write-off' },
  { value: 'transfer', id: 'inv-reason-transfer' },
  { value: 'other', id: 'inv-reason-other' },
] as const;

// ── Component ───────────────────────────────────────────────────────

/** Inventory adjustment screen — search products, add or remove stock quantities, and record an adjustment reason. */
export default function InventoryAdjustmentScreen() {
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [selectedSku, setSelectedSku] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<'add' | 'remove'>('add');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');

  // Results
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ name: string; delta: string; newQty: number } | null>(null);

  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // ── Load products ──────────────────────────────────────────────

  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listProductsScoped(sessionToken);
      if (mountedRef.current) setProducts(data);
    } catch {
      if (mountedRef.current) {
        // Durable error state (INV-08): the product search area previously
        // looked like a usable empty screen after a silent toast. Now it
        // shows a persistent alert with a retry button.
        setLoadError(requiredLocalized(l10n, 'inv-error-load'));
        addToast({ message: requiredLocalized(l10n, 'inv-error-load'), type: 'error' });
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
    // sessionToken is read at :66 (from useWorkspace() at :52). Because :85 is
    // `useEffect(..., [load])`, load's identity is what triggers a refetch -- with the token
    // missing, switching stores left this screen listing the previous store's products until a
    // manual reload.
  }, [addToast, l10n, sessionToken]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  // ── Filtered products for search ───────────────────────────────

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return products.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.barcode ?? '').includes(q),
    );
  }, [products, searchQuery]);

  // ── Selected product ───────────────────────────────────────────

  const selectedProduct = useMemo(
    () => products.find((p) => p.sku === selectedSku) ?? null,
    [products, selectedSku],
  );

  const handleSelectProduct = useCallback((sku: string) => {
    setSelectedSku(sku);
    setSearchQuery('');
    setError(null);
    setSuccess(null);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedSku('');
    setQuantity('');
    setReason('');
    setCustomReason('');
    setError(null);
    setSuccess(null);
  }, []);

  // ── Submit adjustment ─────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!selectedProduct) return;

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError(l10n.getString('inv-error-qty-positive'));
      return;
    }

    const reasonText = reason === 'other' ? customReason.trim() : reason;
    if (!reasonText) {
      setError(l10n.getString('inv-error-reason-required'));
      return;
    }

    const delta = adjustmentType === 'add' ? qty : -qty;

    // Check for negative stock when removing.
    if (adjustmentType === 'remove' && selectedProduct.stock_qty != null && selectedProduct.stock_qty < qty) {
      setError(l10n.getString('inv-error-stock-insufficient', { qty, stock: selectedProduct.stock_qty }));
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const newQty = await adjustStockScoped(sessionToken, {
        sku: selectedProduct.sku,
        delta,
        reason: reasonText,
      });
      const deltaDisplay = `${delta > 0 ? '+' : ''}${delta}`;
      setSuccess({ name: selectedProduct.name, delta: deltaDisplay, newQty });
      setQuantity('');
      setReason('');
      setCustomReason('');
      // Reload to get fresh stock data.
      await load();
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'inv-error-generic'));
    } finally {
      setSaving(false);
    }
    // sessionToken is read at :152 by adjustStockScoped -- a write that changes stock counts.
    // With the token missing from this array, an adjustment submitted after a cashier hot-swap
    // presented the destroyed session, so the write failed (or, if the old session were still
    // live, adjusted the wrong store's stock) while the form looked like any other retryable
    // error. :163 also awaits load(), which now refreshes for the same session.
  }, [selectedProduct, quantity, adjustmentType, reason, customReason, load, l10n, sessionToken]);

  // ── Stock status helpers ──────────────────────────────────────

  const stockStatus = (product: ProductDto): 'ok' | 'low' | 'out' => {
    if (product.stock_qty == null) return 'ok';
    if (product.stock_qty <= 0) return 'out';
    if (product.stock_qty < 10) return 'low';
    return 'ok';
  };

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="inv-adjust">
      <div className="inv-adjust-header">
        <h1 className="inv-adjust-title">
          <Localized id="inv-title">
            <span>Inventory Adjustment</span>
          </Localized>
        </h1>
      </div>

      {/* Step 1: Product selection */}
      <Card shadow="sm" className="inv-adjust-section">
        <h2 className="inv-adjust-section-title">
          <Localized id="inv-step-select-product">
            <span>1. Select Product</span>
          </Localized>
        </h2>

        {selectedProduct ? (
          <div className="inv-adjust-selected-product">
            <div className="inv-adjust-selected-info">
              <span className="inv-adjust-selected-name">{selectedProduct.name}</span>
              <span className="inv-adjust-selected-sku">{selectedProduct.sku}</span>
              <span className={`inv-adjust-selected-stock inv-adjust-stock--${stockStatus(selectedProduct)}`}>
                {selectedProduct.stock_qty != null ? (
                  <Localized id="inv-stock-count" vars={{ count: selectedProduct.stock_qty }}>
                    <span>{selectedProduct.stock_qty} in stock</span>
                  </Localized>
                ) : (
                  <Localized id="inv-stock-off">
                    <span>Stock tracking off</span>
                  </Localized>
                )}
              </span>
            </div>
            <div className="inv-adjust-selected-price">
              {formatMoney({
                minor_units: selectedProduct.price.minor_units,
                currency: selectedProduct.price.currency,
              })}
            </div>
            <button
              type="button"
              className="inv-adjust-clear-btn"
              onClick={handleClearSelection}
              aria-label={l10n.getString('inv-change-aria')}
            >
              <Localized id="inv-change">
                <span>Change</span>
              </Localized>
            </button>
          </div>
        ) : (
          <div className="inv-adjust-search-area">
            <div className="inv-adjust-search-wrap">
              <svg className="inv-adjust-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <Localized id="inv-search-placeholder" attrs={{ placeholder: true }}>
                <input
                  type="search"
                  className="inv-adjust-search"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-bwignore="true"
                  placeholder="Search by SKU, name, or barcode…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label={l10n.getString('inv-search-aria')}
                />
              </Localized>
            </div>

            {loadError ? (
              <div className="inv-adjust-load-error" role="alert">
                <p className="inv-adjust-load-error-text">{loadError}</p>
                <Button variant="secondary" size="sm" onClick={load}>
                  <Localized id="retry"><span>Retry</span></Localized>
                </Button>
              </div>
            ) : loading ? (
              <div className="inv-adjust-loading-skeleton" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="inv-adjust-product-item">
                    <div className="inv-adjust-product-item-info">
                      <Skeleton variant="text" width={`${5 + (i % 3) * 3}rem`} height="0.875rem" />
                      <Skeleton variant="text" width="4rem" height="0.75rem" />
                    </div>
                    <div className="inv-adjust-product-item-meta">
                      <Skeleton variant="text" width="3rem" height="0.75rem" />
                    </div>
                  </div>
                ))}
              </div>
            ) : searchQuery && filteredProducts.length === 0 ? (
              <p className="inv-adjust-no-results">
                <Localized id="inv-no-results">
                  <span>No products match your search.</span>
                </Localized>
              </p>
            ) : searchQuery ? (
              <div className="inv-adjust-product-list" role="listbox" aria-label={l10n.getString('inv-search-results-aria')}>
                {filteredProducts.slice(0, 10).map((product) => (
                  <button
                    key={product.sku}
                    type="button"
                    className="inv-adjust-product-item"
                    onClick={() => handleSelectProduct(product.sku)}
                    role="option"
                    aria-selected={selectedSku === product.sku}
                  >
                    <div className="inv-adjust-product-item-info">
                      <span className="inv-adjust-product-item-name">{product.name}</span>
                      <span className="inv-adjust-product-item-sku">{product.sku}</span>
                    </div>
                    <div className="inv-adjust-product-item-meta">
                      <span className="inv-adjust-product-item-stock">
                        {product.stock_qty != null ? (
                          <Localized id="inv-stock-count" vars={{ count: product.stock_qty }}>
                            <span>{product.stock_qty} in stock</span>
                          </Localized>
                        ) : (
                          '\u2014'
                        )}
                      </span>
                      {product.barcode && (
                        <span className="inv-adjust-product-item-barcode">{product.barcode}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="inv-adjust-hint">
                <Localized id="inv-hint">
                  <span>Type to search for a product by SKU, name, or barcode.</span>
                </Localized>
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Step 2: Adjustment details (only when product selected) */}
      {selectedProduct && (
        <Card shadow="sm" className="inv-adjust-section">
          <h2 className="inv-adjust-section-title">
            <Localized id="inv-step-adjustment-details">
              <span>2. Adjustment Details</span>
            </Localized>
          </h2>

          {/* Type toggle */}
          <div className="inv-adjust-type-toggle" role="radiogroup" aria-label={l10n.getString('inv-type-aria')}>
            <button
              type="button"
              className={`inv-adjust-type-btn ${adjustmentType === 'add' ? 'inv-adjust-type-btn--active inv-adjust-type-btn--add' : ''}`}
              onClick={() => setAdjustmentType('add')}
              role="radio"
              aria-checked={adjustmentType === 'add'}
              aria-label={l10n.getString('inv-type-add-aria')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <Localized id="inv-type-add-label">
                <span>Stock In (Restock)</span>
              </Localized>
            </button>
            <button
              type="button"
              className={`inv-adjust-type-btn ${adjustmentType === 'remove' ? 'inv-adjust-type-btn--active inv-adjust-type-btn--remove' : ''}`}
              onClick={() => setAdjustmentType('remove')}
              role="radio"
              aria-checked={adjustmentType === 'remove'}
              aria-label={l10n.getString('inv-type-remove-aria')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <Localized id="inv-type-remove-label">
                <span>Stock Out (Remove)</span>
              </Localized>
            </button>
          </div>

          {/* Quantity */}
          <label className="inv-adjust-field" htmlFor="inv-field-qty" aria-label={l10n.getString('inv-qty-field-aria')}>
            <span className="inv-adjust-label">
              <Localized id="inv-qty-label">
                <span>Quantity</span>
              </Localized>
            </span>
            <Localized id="inv-qty-placeholder" attrs={{ placeholder: true }}>
              <input
                className="inv-adjust-input"
                type="number"
                id="inv-field-qty"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 10"
                aria-describedby="inv-qty-hint"
              />
            </Localized>
            <span className="inv-adjust-hint-text" id="inv-qty-hint">
              <Localized id="inv-qty-hint" vars={{ stock: selectedProduct.stock_qty != null ? String(selectedProduct.stock_qty) : 'N/A' }}>
                <span>Current stock: {selectedProduct.stock_qty ?? 'N/A'}</span>
              </Localized>
            </span>
          </label>

          {/* Reason */}
          <label className="inv-adjust-field" htmlFor="inv-field-reason">
            <span className="inv-adjust-label">
              <Localized id="inv-reason-label">
                <span>Reason</span>
              </Localized>
            </span>
            <select
              className="inv-adjust-input inv-adjust-select"
              id="inv-field-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
            >
              <option value="">
                {l10n.getString('inv-reason-select')}
              </option>
              {ADJUSTMENT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {l10n.getString(r.id)}
                </option>
              ))}
            </select>
          </label>

          {reason === 'other' && (
            <label className="inv-adjust-field" htmlFor="inv-field-custom-reason" aria-label={l10n.getString('inv-reason-custom-field-aria')}>
              <span className="inv-adjust-label">
                <Localized id="inv-reason-custom-label">
                  <span>Describe the reason</span>
                </Localized>
              </span>
              <Localized id="inv-reason-custom-placeholder" attrs={{ placeholder: true }}>
                <input
                  className="inv-adjust-input"
                  type="text"
                  id="inv-field-custom-reason"
                  value={customReason}
                  onChange={(e) => {
                    setCustomReason(e.target.value);
                    setError(null);
                  }}
                  placeholder="Enter the reason for this adjustment…"
                />
              </Localized>
            </label>
          )}

          {/* Error / Success */}
          {error && (
            <div className="inv-adjust-error" role="alert">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <Localized id="inv-error" vars={{ message: error }}>
                <span>{error}</span>
              </Localized>
            </div>
          )}

          {success && (
            <div className="inv-adjust-success" role="status">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <Localized id="inv-success-adjusted" vars={{ name: success.name, delta: success.delta, newQty: success.newQty }}>
                <span>Adjusted &quot;{success.name}&quot; by {success.delta}. New stock: {success.newQty}</span>
              </Localized>
            </div>
          )}

          {/* Submit */}
          <div className="inv-adjust-actions">
            <Button variant="ghost" onClick={handleClearSelection}>
              <Localized id="inv-cancel">
                <span>Cancel</span>
              </Localized>
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              loading={saving}
              disabled={!quantity || !Number.isInteger(Number(quantity)) || Number(quantity) <= 0 || !reason || (reason === 'other' && !customReason.trim())}
            >
              {saving ? (
                <Localized id="inv-adjusting">
                  <span>Adjusting…</span>
                </Localized>
              ) : (
                <Localized id={adjustmentType === 'add' ? 'inv-apply-restock' : 'inv-apply-removal'}>
                  <span>Apply {adjustmentType === 'add' ? 'Restock' : 'Removal'}</span>
                </Localized>
              )}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
