import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { requiredLocalized, LoadingStatus } from '@/frontend/shared';
import { useLocalization } from '@fluent/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { listProductsScoped, type ProductDto } from '@/api/products';
import { type CreateKdsLineItemInput, type KdsModifier } from '@/api/kds';
import './KdsProductPickerModal.css';

/** Result emitted when the user confirms a selection. */
export interface ProductPickerResult {
  /** The KDS order ID to add items to. */
  orderId: string;
  /** Picked items with sku, display_name, qty, course, modifiers. */
  items: CreateKdsLineItemInput[];
}

/** Props for the KdsProductPickerModal. */
export interface KdsProductPickerModalProps {
  /** KDS order ID to add items to. */
  orderId: string;
  /** Session token for scoped API calls. */
  sessionToken: string;
  /** Whether the modal is open. */
  isOpen: boolean;
  /** Called when the user confirms the selection. */
  onConfirm: (result: ProductPickerResult) => void;
  /** Called when the modal is dismissed without saving. */
  onClose: () => void;
  /**
   * True while the parent is saving the confirmed items — disables the
   * Confirm button so a double-tap can't re-merge (belt alongside the
   * parent's re-entry guard, and gives the kitchen visual feedback).
   */
  pending?: boolean;
}

/** Selected product entry in the picker. */
interface PickedEntry {
  sku: string;
  display_name: string;
  qty: number;
  course: string | null;
}

/** Course display labels — Fluent ids, localized at render (kds-course-*). */
const COURSE_OPTIONS: { value: string | null; labelId: string }[] = [
  { value: null, labelId: 'kds-course-none' },
  { value: 'appetizer', labelId: 'kds-course-appetizer' },
  { value: 'main', labelId: 'kds-course-main' },
  { value: 'side', labelId: 'kds-course-side' },
  { value: 'dessert', labelId: 'kds-course-dessert' },
  { value: 'beverage', labelId: 'kds-course-beverage' },
];

/**
 * Resolve a product category string to a KDS course ID.
 * Exported for testing — the inline logic in `addProduct` used to be a
 * closure-only block, so no unit test could exercise the category mapping
 * without rendering the full modal and adding products.
 */
export function resolveCourseFromCategory(category: string | null | undefined): string | null {
  const c = (category ?? '').toLowerCase();
  if (c.includes('appetizer') || c.includes('starter')) return 'appetizer';
  if (c.includes('main') || c.includes('entree')) return 'main';
  if (c.includes('side')) return 'side';
  if (c.includes('dessert')) return 'dessert';
  if (c.includes('drink') || c.includes('beverage')) return 'beverage';
  return null;
}

/**
 * KdsProductPickerModal — searchable product selector for adding items
 * to a KDS order mid-preparation (TODO 3f).
 *
 * Fetches all products from the store, filters by restaurant/both type,
 * and lets the user pick items with quantities and course assignments.
 * Returns CreateKdsLineItemInput[] on confirm.
 */
export const KdsProductPickerModal = memo(function KdsProductPickerModal({
  orderId,
  sessionToken,
  isOpen,
  onConfirm,
  onClose,
  pending = false,
}: KdsProductPickerModalProps) {
  const { l10n } = useLocalization();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, isOpen, onClose);

  const [products, setProducts] = useState<ProductDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<PickedEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // LOAD-08: isolated loader so a Retry action can re-run it, and the
  // failure message is localized — never a raw String(e). Declared before
  // the open effect that calls it (no TDZ on first render).
  const loadProducts = useCallback(() => {
    setLoading(true);
    setError(null);
    listProductsScoped(sessionToken)
      .then((all) => {
        // Only show restaurant/both type products.
        const restaurant = all.filter(
          (p) => p.product_type === 'restaurant' || p.product_type === 'both',
        );
        setProducts(restaurant);
        setLoading(false);
      })
      .catch(() => {
        setError(requiredLocalized(l10n, 'kds-picker-error'));
        setLoading(false);
      });
  }, [sessionToken, l10n]);

  // Fetch products when modal opens (and on manual Retry).
  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setPicked([]);
    loadProducts();
    // Focus search input on open.
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [isOpen, sessionToken, loadProducts]);

  const filtered = products.filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()),
  );

  const addProduct = useCallback((product: ProductDto) => {
    setPicked((prev) => {
      const existing = prev.find((e) => e.sku === product.sku);
      if (existing) {
        return prev.map((e) =>
          e.sku === product.sku ? { ...e, qty: e.qty + 1 } : e,
        );
      }
      // Resolve course from product category.
      const course = resolveCourseFromCategory(product.category);

      return [
        ...prev,
        { sku: product.sku, display_name: product.name, qty: 1, course },
      ];
    });
  }, []);

  const removeProduct = useCallback((sku: string) => {
    setPicked((prev) => prev.filter((e) => e.sku !== sku));
  }, []);

  const updateQty = useCallback((sku: string, qty: number) => {
    if (qty < 1) return;
    setPicked((prev) =>
      prev.map((e) => (e.sku === sku ? { ...e, qty } : e)),
    );
  }, []);

  const updateCourse = useCallback((sku: string, course: string | null) => {
    setPicked((prev) =>
      prev.map((e) => (e.sku === sku ? { ...e, course } : e)),
    );
  }, []);

  const handleConfirm = useCallback(() => {
    if (pending || picked.length === 0) return;
    const items: CreateKdsLineItemInput[] = picked.map((p) => ({
      sku: p.sku,
      display_name: p.display_name,
      qty: p.qty,
      course: p.course,
      modifiers: [] as KdsModifier[],
    }));
    onConfirm({ orderId, items });
  }, [picked, orderId, onConfirm, pending]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // NOTE: Escape is handled by useFocusTrap above (onEscape = onClose) —
  // do NOT add a second Escape handler here; it would fire onClose twice
  // per keypress (regression pinned by KdsProductPickerModal.test.tsx).

  if (!isOpen) return null;

  return (
    // Backdrop click is a convenience — keyboard users close via the Close
    // button and Escape (handled by the focus trap), so the click needs no
    // keyboard twin here.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <div
      className="kds-picker-overlay"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={requiredLocalized(l10n, 'kds-picker-title')}
    >
      <div className="kds-picker-modal" ref={panelRef}>
        {/* ── Header ────────────────────────────────────────────── */}
        <div className="kds-picker-header">
          <h2 className="kds-picker-title">
            {requiredLocalized(l10n, 'kds-picker-title')}
          </h2>
          <button
            className="kds-picker-close"
            onClick={onClose}
            aria-label={requiredLocalized(l10n, 'kds-picker-close-aria')}
          >
            &times;
          </button>
        </div>

        {/* ── Search ────────────────────────────────────────────── */}
        <div className="kds-picker-search-wrap">
          <input
            ref={searchRef}
            className="kds-picker-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={requiredLocalized(l10n, 'kds-picker-search-placeholder')}
            aria-label={requiredLocalized(l10n, 'kds-picker-search-aria')}
          />
        </div>

        {/* ── Error (LOAD-08: localized + Retry) ─────────────────── */}
        {error && (
          <div className="kds-picker-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="kds-picker-retry"
              onClick={() => loadProducts()}
            >
              {requiredLocalized(l10n, 'retry')}
            </button>
          </div>
        )}

        <div className="kds-picker-body">
          {/* ── Product list (left) ─────────────────────────────── */}
          <div className="kds-picker-products">
            {loading ? (
              <LoadingStatus
                className="kds-picker-loading"
                label={requiredLocalized(l10n, 'kds-picker-loading')}
              />
            ) : filtered.length === 0 ? (
              <div className="kds-picker-empty" role="status">
                <p>{requiredLocalized(l10n, 'kds-picker-no-products')}</p>
                {search.trim() && (
                  /* EMPTY-05: an active search that returns nothing needs a
                     clear/reset action, not a dead end. */
                  <button
                    type="button"
                    className="kds-picker-clear-search"
                    onClick={() => setSearch('')}
                  >
                    {requiredLocalized(l10n, 'kds-picker-clear-search')}
                  </button>
                )}
              </div>
            ) : (
              filtered.map((product) => {
                const isPicked = picked.some((e) => e.sku === product.sku);
                return (
                  <button
                    key={product.sku}
                    className={`kds-picker-product${isPicked ? ' kds-picker-product--picked' : ''}`}
                    onClick={() => addProduct(product)}
                    aria-label={`${product.name}${isPicked ? ` (${requiredLocalized(l10n, 'kds-picker-added-label')})` : ''}`}
                  >
                    <span className="kds-picker-product-name">{product.name}</span>
                    <span className="kds-picker-product-course">
                      {product.category ?? ''}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* ── Picked items (right) ────────────────────────────── */}
          <div className="kds-picker-picked">
            <h3 className="kds-picker-picked-title">
              {requiredLocalized(l10n, 'kds-picker-selected')}{' '}
              <span className="kds-picker-picked-count">{picked.length}</span>
            </h3>
            {picked.length === 0 ? (
              <p className="kds-picker-picked-empty">
                {requiredLocalized(l10n, 'kds-picker-picked-empty')}
              </p>
            ) : (
              <ul className="kds-picker-picked-list">
                {picked.map((entry) => (
                  <li key={entry.sku} className="kds-picker-picked-item">
                    <span className="kds-picker-picked-name">{entry.display_name}</span>
                    <div className="kds-picker-picked-controls">
                      {/* Course dropdown */}
                      <select
                        className="kds-picker-picked-course"
                        value={entry.course ?? ''}
                        onChange={(e) =>
                          updateCourse(entry.sku, e.target.value || null)
                        }
                        aria-label={requiredLocalized(l10n, 'kds-picker-course-aria')}
                      >
                        {COURSE_OPTIONS.map((opt) => (
                          <option key={String(opt.value)} value={opt.value ?? ''}>
                            {requiredLocalized(l10n, opt.labelId)}
                          </option>
                        ))}
                      </select>
                      {/* Quantity stepper */}
                      <div className="kds-picker-picked-qty">
                        <button
                          className="kds-picker-qty-btn"
                          onClick={() => updateQty(entry.sku, entry.qty - 1)}
                          disabled={entry.qty <= 1}
                          aria-label={requiredLocalized(l10n, 'kds-picker-qty-decrease')}
                        >
                          &minus;
                        </button>
                        <span className="kds-picker-qty-value" aria-live="polite">
                          {entry.qty}
                        </span>
                        <button
                          className="kds-picker-qty-btn"
                          onClick={() => updateQty(entry.sku, entry.qty + 1)}
                          aria-label={requiredLocalized(l10n, 'kds-picker-qty-increase')}
                        >
                          +
                        </button>
                      </div>
                      {/* Remove */}
                      <button
                        className="kds-picker-picked-remove"
                        onClick={() => removeProduct(entry.sku)}
                        aria-label={requiredLocalized(l10n, 'kds-picker-remove-aria', { name: entry.display_name })}
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── Footer ────────────────────────────────────────────── */}
        <div className="kds-picker-footer">
          <button
            className="kds-picker-cancel"
            onClick={onClose}
          >
            {requiredLocalized(l10n, 'kds-picker-cancel')}
          </button>
          <button
            className="kds-picker-confirm"
            onClick={handleConfirm}
            disabled={picked.length === 0 || pending}
          >
            {requiredLocalized(l10n, 'kds-picker-add-btn', { count: picked.length })}
          </button>
        </div>
      </div>
    </div>
  );
});
