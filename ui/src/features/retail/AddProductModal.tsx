import type React from 'react';
import { requiredLocalized } from '@/components';
import { useState, useEffect, useRef } from 'react';
import { useLocalization, Localized } from '@fluent/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { ProductDto, CategoryDto } from '@/api/products';
import { DEFAULT_LOW_STOCK_THRESHOLD, DEFAULT_HIGH_STOCK_THRESHOLD } from '@/types/domain';

export interface AddProductModalProps {
  categories: CategoryDto[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (newProduct: ProductDto) => void;
  /** ADR #36 D7: false hides the Cost field (products:edit_cost is manager+ only). */
  canEditCost?: boolean;
}

export const AddProductModal: React.FC<AddProductModalProps> = ({
  categories,
  isOpen,
  onClose,
  onSave,
  canEditCost = true,
}) => {
  const { l10n } = useLocalization();
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [priceMinor, setPriceMinor] = useState<number | ''>(0);
  const [stockQty, setStockQty] = useState<number | ''>(10);
  const [lowThreshold, setLowThreshold] = useState<number | ''>(DEFAULT_LOW_STOCK_THRESHOLD);
  const [highThreshold, setHighThreshold] = useState<number | ''>(DEFAULT_HIGH_STOCK_THRESHOLD);
  // ADR #36: cost, brand, rack, notes, unit (all optional at create time).
  const [costMinor, setCostMinor] = useState<number | ''>(0);
  const [brand, setBrand] = useState('');
  const [rackLocation, setRackLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [unit, setUnit] = useState('');
  const [isActive, setIsActive] = useState(true);

  const hasInitialized = useRef(false);

  useEffect(() => {
    if (isOpen && !hasInitialized.current) {
      const generatedSku = `PROD-${Math.floor(1000 + Math.random() * 9000)}`;
      setSku(generatedSku);
      setName('');
      setCategory(categories[0]?.name || '');
      setPriceMinor(0);
      setStockQty(10);
      setLowThreshold(DEFAULT_LOW_STOCK_THRESHOLD);
      setHighThreshold(DEFAULT_HIGH_STOCK_THRESHOLD);
      setCostMinor(0);
      setBrand('');
      setRackLocation('');
      setNotes('');
      setUnit('');
      setIsActive(true);
      hasInitialized.current = true;
    }
    if (!isOpen) hasInitialized.current = false;
  }, [isOpen, categories]);

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, isOpen, onClose);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) nameInputRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !sku.trim()) return;

    const newProduct: ProductDto = {
      sku: sku.trim().toUpperCase(),
      name: name.trim(),
      category: category || categories[0]?.name || 'General',
      price: {
        minor_units: Math.max(0, priceMinor === '' ? 0 : priceMinor),
        currency: 'IDR',
      },
      barcode: null,
      in_stock: (stockQty === '' ? 0 : Math.max(0, stockQty)) > 0,
      stock_qty: Math.max(0, stockQty === '' ? 0 : stockQty),
      tax_rate_ids: [],
      created_at: new Date().toISOString(),
      price_updated_at: new Date().toISOString(),
      product_type: 'retail',
      low_stock_threshold: Math.max(0, lowThreshold === '' ? 0 : lowThreshold),
      high_stock_threshold: Math.max(0, highThreshold === '' ? 0 : highThreshold),
      cost_minor: canEditCost ? Math.max(0, costMinor === '' ? 0 : costMinor) : 0,
      brand: brand.trim() || null,
      rack_location: rackLocation.trim() || null,
      notes: notes.trim() || null,
      unit: unit.trim() || null,
      is_active: isActive,
      default_supplier_id: null,
      popularity_score: 0,
    };

    onSave(newProduct);
    onClose();
  };

  return (
    <>
    <div className="retail-edit-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} role="presentation" tabIndex={-1}>
      <div
        ref={panelRef}
        className="retail-edit-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="retail-add-product-title"
      >
        <div className="retail-edit-modal-header">
          <Localized id="retail-add-product-title">
            <h3 id="retail-add-product-title" className="retail-edit-modal-title">
              Add New Product
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
          <div className="retail-edit-form-row">
            <div className="retail-edit-form-group">
              <Localized id="retail-edit-field-sku">
                <label htmlFor="add-product-sku" className="retail-edit-label">
                  SKU / Code
                </label>
              </Localized>
              <input
                id="add-product-sku"
                type="text"
                className="retail-edit-input"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                required
              />
            </div>

            <div className="retail-edit-form-group">
              <Localized id="retail-add-product-category-label">
                <label htmlFor="add-product-category" className="retail-edit-label">
                  Category
                </label>
              </Localized>
              <select
                id="add-product-category"
                className="retail-edit-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.name}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="retail-edit-form-group">
            <Localized id="retail-edit-field-name">
              <label htmlFor="add-product-name" className="retail-edit-label">
                Product Name
              </label>
            </Localized>
            <input
              id="add-product-name"
              type="text"
              className="retail-edit-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={requiredLocalized(l10n, 'retail-add-product-name-placeholder')}
              ref={nameInputRef}
              required
            />
          </div>

          <div className="retail-edit-form-row">
            <div className="retail-edit-form-group">
              <Localized id="retail-edit-field-price">
                <label htmlFor="add-product-price" className="retail-edit-label">
                  Price (IDR)
                </label>
              </Localized>
              <input
                id="add-product-price"
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
                <label htmlFor="add-product-stock" className="retail-edit-label">
                  Stock Quantity
                </label>
              </Localized>
              <input
                id="add-product-stock"
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
                <label htmlFor="add-product-low" className="retail-edit-label">
                  Low Stock Threshold
                </label>
              </Localized>
              <input
                id="add-product-low"
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
                <label htmlFor="add-product-high" className="retail-edit-label">
                  High Stock Threshold
                </label>
              </Localized>
              <input
                id="add-product-high"
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
                <label htmlFor="add-product-cost" className="retail-edit-label">
                  Cost (IDR)
                </label>
              </Localized>
              <input
                id="add-product-cost"
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
            </div>
            )}

            <div className="retail-edit-form-group">
              <Localized id="retail-edit-field-unit">
                <label htmlFor="add-product-unit" className="retail-edit-label">
                  Unit
                </label>
              </Localized>
              <input
                id="add-product-unit"
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
                <label htmlFor="add-product-brand" className="retail-edit-label">
                  Brand
                </label>
              </Localized>
              <input
                id="add-product-brand"
                type="text"
                className="retail-edit-input"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              />
            </div>

            <div className="retail-edit-form-group">
              <Localized id="retail-edit-field-rack">
                <label htmlFor="add-product-rack" className="retail-edit-label">
                  Rack
                </label>
              </Localized>
              <input
                id="add-product-rack"
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
              <label htmlFor="add-product-notes" className="retail-edit-label">
                Notes
              </label>
            </Localized>
            <textarea
              id="add-product-notes"
              rows={2}
              className="retail-edit-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <label
            className="retail-edit-checkbox"
            htmlFor="add-product-active"
            aria-label={requiredLocalized(l10n, 'retail-edit-field-active')}
          >
            <input
              id="add-product-active"
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
                Create Product
              </button>
            </Localized>
          </div>
        </form>
      </div>
    </div>
    </>
  );
};
