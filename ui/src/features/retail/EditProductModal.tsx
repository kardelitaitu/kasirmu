import type React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { open } from '@tauri-apps/plugin-dialog';
import { ProductThumb } from '@/components/ProductThumb';
import type { ProductDto, ProductImageDto } from '@/api/products';
import {
  productsSetImageScoped,
  productsClearImageScoped,
  productsListImagesScoped,
} from '@/api/products';
import { DEFAULT_LOW_STOCK_THRESHOLD, DEFAULT_HIGH_STOCK_THRESHOLD } from '@/types/domain';

export interface EditProductModalProps {
  product: ProductDto | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedProduct: ProductDto) => void;
  /** ADR #36 D7: false hides the Cost field + override hint (manager+ only). */
  canEditCost?: boolean;
  /** Scoped session token — enables the product image editor (spec 0046b). */
  sessionToken?: string;
}

/** Max number of images per product (1 primary + 4 alternatives). */
const MAX_IMAGES = 5;

/** Derive a stable hue (0-360) from a string for the fallback tile colour. */
function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export const EditProductModal: React.FC<EditProductModalProps> = ({
  product,
  isOpen,
  onClose,
  onSave,
  canEditCost = true,
  sessionToken,
}) => {
  const { l10n } = useLocalization();
  const [name, setName] = useState('');
  const [priceMinor, setPriceMinor] = useState<number | ''>(0);
  const [stockQty, setStockQty] = useState<number | ''>(0);
  const [lowThreshold, setLowThreshold] = useState<number | ''>(DEFAULT_LOW_STOCK_THRESHOLD);
  const [highThreshold, setHighThreshold] = useState<number | ''>(DEFAULT_HIGH_STOCK_THRESHOLD);
  // ADR #36: cost (edit/override), brand, rack, notes, unit, status.
  const [costMinor, setCostMinor] = useState<number | ''>(0);
  const [brand, setBrand] = useState('');
  const [rackLocation, setRackLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [unit, setUnit] = useState('');
  const [isActive, setIsActive] = useState(true);

  // ── Product images (spec 0046b) ────────────────────────────────────
  const [images, setImages] = useState<ProductImageDto[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const isMenu = product?.product_type === 'restaurant';
  const canEditImages = Boolean(sessionToken && product?.id);

  const loadImages = useCallback(async () => {
    if (!sessionToken || !product?.id) return;
    try {
      const list = await productsListImagesScoped(sessionToken, product.id);
      setImages(list);
      setImageError(null);
    } catch {
      setImageError(requiredLocalized(l10n, 'retail-edit-image-error'));
    }
  }, [sessionToken, product?.id, l10n]);

  // Load existing images when the editor opens.
  useEffect(() => {
    if (isOpen && canEditImages) {
      void loadImages();
    }
  }, [isOpen, canEditImages, loadImages]);

  const handleSetImage = useCallback(async (slot: number) => {
    if (!sessionToken || !product?.id) return;
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['webp', 'png', 'jpg', 'jpeg'] }],
      });
      // `open` returns string | string[] | null; single selection → string.
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      setImageBusy(true);
      setImageError(null);
      await productsSetImageScoped(sessionToken, product.id, slot, path);
      await loadImages();
    } catch {
      setImageError(requiredLocalized(l10n, 'retail-edit-image-error'));
    } finally {
      setImageBusy(false);
    }
  }, [sessionToken, product?.id, loadImages, l10n]);

  const handleClearImage = useCallback(async (slot: number) => {
    if (!sessionToken || !product?.id) return;
    // Menu items must always have exactly 1 image — the backend refuses
    // clearing slot 1; surface the note here as well.
    if (isMenu && slot === 1) {
      setImageError(requiredLocalized(l10n, 'retail-edit-image-menu-note'));
      return;
    }
    try {
      setImageBusy(true);
      setImageError(null);
      await productsClearImageScoped(sessionToken, product.id, slot);
      await loadImages();
    } catch {
      setImageError(requiredLocalized(l10n, 'retail-edit-image-error'));
    } finally {
      setImageBusy(false);
    }
  }, [sessionToken, product?.id, loadImages, l10n, isMenu]);

  useEffect(() => {
    if (isOpen && product) {
      setName(product.name || '');
      setPriceMinor(product.price?.minor_units ?? 0);
      setStockQty(product.stock_qty ?? 0);
      setLowThreshold(product.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD);
      setHighThreshold(product.high_stock_threshold ?? DEFAULT_HIGH_STOCK_THRESHOLD);
      setCostMinor(product.cost_minor ?? 0);
      setBrand(product.brand ?? '');
      setRackLocation(product.rack_location ?? '');
      setNotes(product.notes ?? '');
      setUnit(product.unit ?? '');
      setIsActive(product.is_active !== false);
    }
  }, [isOpen, product]);

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, isOpen, onClose);


  if (!isOpen || !product) {
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const updatedProduct: ProductDto = {
      ...product,
      name: name.trim(),
      price: {
        ...product.price,
        minor_units: Math.max(0, priceMinor === '' ? 0 : priceMinor),
      },
      stock_qty: Math.max(0, stockQty === '' ? 0 : stockQty),
      in_stock: (stockQty === '' ? 0 : Math.max(0, stockQty)) > 0,
      low_stock_threshold: Math.max(0, lowThreshold === '' ? 0 : lowThreshold),
      high_stock_threshold: Math.max(0, highThreshold === '' ? 0 : highThreshold),
      cost_minor: Math.max(0, costMinor === '' ? 0 : costMinor),
      brand: brand.trim() || null,
      rack_location: rackLocation.trim() || null,
      notes: notes.trim() || null,
      unit: unit.trim() || null,
      is_active: isActive,
      default_supplier_id: product.default_supplier_id ?? null,
      popularity_score: product.popularity_score ?? 0,
    };

    onSave(updatedProduct);
    onClose();
  };

  // ADR #36 D5: restocking (stock qty increased) shows the cost-override
  // hint — the Cost field doubles as the override for the newly received
  // stock.
  const originalStock = product.stock_qty ?? 0;
  const restocking = Math.max(0, stockQty === '' ? 0 : stockQty) > originalStock;

  return (
    <>
    <div className="retail-edit-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} role="presentation" tabIndex={-1}>
      <div
        ref={panelRef}
        className="retail-edit-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="retail-edit-modal-title"
      >
        <div className="retail-edit-modal-header">
          <Localized id="retail-edit-product-title">
            <h3 id="retail-edit-modal-title" className="retail-edit-modal-title">
              Edit Product
            </h3>
          </Localized>
          <Localized id="retail-edit-modal-close-aria" attrs={{ 'aria-label': true }}>
            <button
              type="button"
              className="retail-edit-modal-close"
              onClick={onClose}
              aria-label={l10n.getString('close-aria')}
            >
              &times;
            </button>
          </Localized>
        </div>

        <form onSubmit={handleSubmit} className="retail-edit-modal-form">
          <div className="retail-edit-form-group">
            <Localized id="retail-edit-field-sku">
              <label htmlFor="edit-product-sku" className="retail-edit-label">
                SKU / Code
              </label>
            </Localized>
            <input
              id="edit-product-sku"
              type="text"
              className="retail-edit-input retail-edit-input--readonly"
              value={product.sku}
              disabled
              readOnly
            />
          </div>

          <div className="retail-edit-form-group">
            <Localized id="retail-edit-field-name">
              <label htmlFor="edit-product-name" className="retail-edit-label">
                Product Name
              </label>
            </Localized>
            <input
              id="edit-product-name"
              type="text"
              className="retail-edit-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="retail-edit-form-row">
            <div className="retail-edit-form-group">
              <Localized id="retail-edit-field-price">
                <label htmlFor="edit-product-price" className="retail-edit-label">
                  Price (IDR)
                </label>
              </Localized>
              <input
                id="edit-product-price"
                type="number"
                min="0"
                step="1"
                className="retail-edit-input"
                value={priceMinor}
              onChange={(e) => {
                // Whole number only — ignore fractional in-progress input
                // instead of silently truncating it via parseInt.
                const v = e.target.value;
                const n = Number(v);
                if (v === '' || (Number.isInteger(n) && n >= 0)) {
                  setPriceMinor(v === '' ? '' : n);
                }
              }}
                required
              />
            </div>

            <div className="retail-edit-form-group">
              <Localized id="retail-edit-field-stock">
                <label htmlFor="edit-product-stock" className="retail-edit-label">
                  Stock Quantity
                </label>
              </Localized>
              <input
                id="edit-product-stock"
                type="number"
                min="0"
                step="1"
                className="retail-edit-input"
                value={stockQty}
                onChange={(e) => {
                  // Whole number only — ignore fractional in-progress input
                  // instead of silently truncating it via parseInt.
                  const v = e.target.value;
                  const n = Number(v);
                  if (v === '' || (Number.isInteger(n) && n >= 0)) {
                    setStockQty(v === '' ? '' : n);
                  }
                }}
                required
              />
            </div>
          </div>

          <div className="retail-edit-form-row">
            <div className="retail-edit-form-group">
              <Localized id="retail-edit-field-low-stock">
                <label htmlFor="edit-product-low-threshold" className="retail-edit-label">
                  Low Stock Threshold
                </label>
              </Localized>
              <input
                id="edit-product-low-threshold"
                type="number"
                min="0"
                step="1"
                className="retail-edit-input"
                value={lowThreshold}
                onChange={(e) => {
                  // Whole number only — ignore fractional in-progress input
                  // instead of silently truncating it via parseInt.
                  const v = e.target.value;
                  const n = Number(v);
                  if (v === '' || (Number.isInteger(n) && n >= 0)) {
                    setLowThreshold(v === '' ? '' : n);
                  }
                }}
                required
              />
            </div>

            <div className="retail-edit-form-group">
              <Localized id="retail-edit-field-high-stock">
                <label htmlFor="edit-product-high-threshold" className="retail-edit-label">
                  High Stock Threshold
                </label>
              </Localized>
              <input
                id="edit-product-high-threshold"
                type="number"
                min="0"
                step="1"
                className="retail-edit-input"
                value={highThreshold}
                onChange={(e) => {
                  // Whole number only — ignore fractional in-progress input
                  // instead of silently truncating it via parseInt.
                  const v = e.target.value;
                  const n = Number(v);
                  if (v === '' || (Number.isInteger(n) && n >= 0)) {
                    setHighThreshold(v === '' ? '' : n);
                  }
                }}
                required
              />
            </div>
          </div>

          {/* ── ADR #36 attributes ── */}
          <div className="retail-edit-form-row">
            {canEditCost && (
            <div className="retail-edit-form-group">
              <Localized id="retail-edit-field-cost">
                <label htmlFor="edit-product-cost" className="retail-edit-label">
                  Cost (IDR)
                </label>
              </Localized>
              <input
                id="edit-product-cost"
                type="number"
                min="0"
                step="1"
                className="retail-edit-input"
                value={costMinor}
                onChange={(e) => {
                  // Whole number only — ignore fractional in-progress input
                  // instead of silently truncating it via parseInt.
                  const v = e.target.value;
                  const n = Number(v);
                  if (v === '' || (Number.isInteger(n) && n >= 0)) {
                    setCostMinor(v === '' ? '' : n);
                  }
                }}
              />
              {restocking && (
                <div className="retail-edit-cost-override-hint" role="note">
                  {requiredLocalized(l10n, 'retail-edit-cost-override-hint')}
                </div>
              )}
            </div>
            )}

            <div className="retail-edit-form-group">
              <Localized id="retail-edit-field-unit">
                <label htmlFor="edit-product-unit" className="retail-edit-label">
                  Unit
                </label>
              </Localized>
              <input
                id="edit-product-unit"
                type="text"
                className="retail-edit-input"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="pcs / kg / box"
              />
            </div>
          </div>

          <div className="retail-edit-form-row">
            <div className="retail-edit-form-group">
              <Localized id="retail-edit-field-brand">
                <label htmlFor="edit-product-brand" className="retail-edit-label">
                  Brand
                </label>
              </Localized>
              <input
                id="edit-product-brand"
                type="text"
                className="retail-edit-input"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              />
            </div>

            <div className="retail-edit-form-group">
              <Localized id="retail-edit-field-rack">
                <label htmlFor="edit-product-rack" className="retail-edit-label">
                  Rack
                </label>
              </Localized>
              <input
                id="edit-product-rack"
                type="text"
                className="retail-edit-input"
                value={rackLocation}
                onChange={(e) => setRackLocation(e.target.value)}
                placeholder="A-01"
              />
            </div>
          </div>

          <div className="retail-edit-form-group">
            <Localized id="retail-edit-field-notes">
              <label htmlFor="edit-product-notes" className="retail-edit-label">
                Notes
              </label>
            </Localized>
            <textarea
              id="edit-product-notes"
              rows={2}
              className="retail-edit-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* ── Product images (spec 0046b §3.2–3.3) ── */}
          {canEditImages && (
            <fieldset className="retail-edit-images" aria-busy={imageBusy}>
              <legend className="retail-edit-label">
                <Localized id="retail-edit-image-title">
                  <span>Product Images</span>
                </Localized>
              </legend>

              {imageError && (
                <div className="retail-edit-image-error" role="alert">
                  {imageError}
                </div>
              )}

              {/* Primary image (slot 1) */}
              <div className="retail-edit-image-slot">
                <span className="retail-edit-image-slot-label">
                  <Localized id="retail-edit-image-primary">
                    <span>Primary image</span>
                  </Localized>
                </span>
                <ProductThumb
                  hash={images.find((i) => i.slot === 1)?.hash ?? null}
                  name={product.name}
                  size={64}
                  hue={hueFromString(product.name)}
                />
                <div className="retail-edit-image-actions">
                  <button
                    type="button"
                    className="retail-edit-image-btn"
                    onClick={() => void handleSetImage(1)}
                    disabled={imageBusy}
                    aria-label={requiredLocalized(l10n, 'retail-edit-image-set-aria', { name: product.name })}
                  >
                    <Localized id="retail-edit-image-set">
                      <span>Set Image</span>
                    </Localized>
                  </button>
                  {!isMenu && images.some((i) => i.slot === 1) && (
                    <button
                      type="button"
                      className="retail-edit-image-btn retail-edit-image-btn--danger"
                      onClick={() => void handleClearImage(1)}
                      disabled={imageBusy}
                      aria-label={requiredLocalized(l10n, 'retail-edit-image-clear-aria', { name: product.name })}
                    >
                      <Localized id="retail-edit-image-clear">
                        <span>Remove</span>
                      </Localized>
                    </button>
                  )}
                </div>
              </div>

              {/* Alternatives (slots 2..5) — retail products only */}
              {!isMenu && (
                <div className="retail-edit-image-alternatives">
                  <span className="retail-edit-label">
                    <Localized id="retail-edit-image-alternatives">
                      <span>Additional images</span>
                    </Localized>
                  </span>
                  <div className="retail-edit-image-strip">
                    {[2, 3, 4, 5].map((slot) => {
                      const img = images.find((i) => i.slot === slot);
                      return (
                        <div key={slot} className="retail-edit-image-alt-slot">
                          <ProductThumb
                            hash={img?.hash ?? null}
                            name={product.name}
                            size={56}
                            hue={hueFromString(product.name)}
                          />
                          <div className="retail-edit-image-alt-actions">
                            <button
                              type="button"
                              className="retail-edit-image-btn retail-edit-image-btn--small"
                              onClick={() => void handleSetImage(slot)}
                              disabled={imageBusy || (images.length >= MAX_IMAGES && !img)}
                              aria-label={requiredLocalized(l10n, img ? 'retail-edit-image-replace-aria' : 'retail-edit-image-set-alt-aria', { name: product.name, slot: slot })}
                            >
                              {img ? <Localized id="retail-edit-image-replace"><span>Replace</span></Localized> : <Localized id="retail-edit-image-set"><span>Set</span></Localized>}
                            </button>
                            {img && (
                              <button
                                type="button"
                                className="retail-edit-image-btn retail-edit-image-btn--small retail-edit-image-btn--danger"
                                onClick={() => void handleClearImage(slot)}
                                disabled={imageBusy}
                                aria-label={requiredLocalized(l10n, 'retail-edit-image-clear-alt-aria', { name: product.name, slot: slot })}
                              >
                                <Localized id="retail-edit-image-clear">
                                  <span>Remove</span>
                                </Localized>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {isMenu && (
                <div className="retail-edit-image-menu-note" role="note">
                  {requiredLocalized(l10n, 'retail-edit-image-menu-note')}
                </div>
              )}
            </fieldset>
          )}

          <label
            className="retail-edit-checkbox"
            htmlFor="edit-product-active"
            aria-label={requiredLocalized(l10n, 'retail-edit-field-active')}
          >
            <input
              id="edit-product-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <Localized id="retail-edit-field-active">
              <span>Active (sellable)</span>
            </Localized>
          </label>

          <div className="retail-edit-modal-actions">
            <Localized id="retail-edit-cancel">
              <button
                type="button"
                className="retail-edit-modal-btn retail-edit-modal-btn--secondary"
                onClick={onClose}
              >
                Cancel
              </button>
            </Localized>
            <Localized id="retail-edit-save">
              <button
                type="submit"
                className="retail-edit-modal-btn retail-edit-modal-btn--primary"
              >
                Save Changes
              </button>
            </Localized>
          </div>
        </form>
      </div>
    </div>
    </>
  );
};
