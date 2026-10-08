// ── RestaurantMenuEditorScreen ─────────────────────────────────────────────
//
// The full-page menu editor reached from the restaurant POS sidebar. Two panes:
// a category rail on the left and the selected category's items on the right,
// each with create / edit / delete.
//
// Why this exists: the POS surfaces the menu for SELLING (RestaurantMenu), and
// the only place an item could previously be authored was the retail Products
// workspace -- which is a different mental model (SKUs, stock levels, cost
// price) from what a restaurant manager is doing when they say "our menu".
//
// Header: mirrors RestaurantReceiptsScreen's header exactly (same
// .restaurant-settings-* classes, same back button, title icon, dirty badge and
// Save Changes action) so the two sidebar destinations read as one family.
//
// Invariants:
// - The dirty badge reflects a real draft diff; Save is disabled when clean.
// - Back is guarded: unsaved edits open the confirmation dialog, never a silent drop.
// - Items are addressed by SKU and categories by id; neither is ever rendered as
//   a raw identifier to the operator.
// - All money is integer minor units end to end (ADR: Money, never float). The
//   price field converts to/from major units at the boundary only.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { l10nErrorMessage } from '@/utils/app-error';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { useToast } from '@/components/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  listProductsScoped,
  createProductScoped,
  updateProductScoped,
  deleteProductScoped,
  listCategoriesScoped,
  createCategoryScoped,
  deleteCategoryScoped,
  type ProductDto,
  type CategoryDto,
} from '@/api/products';
import {
  CATEGORY_ICON_OPTIONS,
  CATEGORY_ICON_IDS,
  CATEGORY_COLOURS,
  categoryIconLabelId,
  nextRadioValue,
  randomCategoryIcon,
} from '@/features/categories/categoryIcons';
import { CategoryIconSvg } from '@/features/categories/CategoryIconSvg';
import { parsePriceToMinor, formatMinorForInput, generateMenuSku } from './menuEditorLogic';
import './RestaurantSettingsScreens.css';
import './RestaurantMenuEditorScreen.css';

/**
 * A menu item being authored. Price is held in minor units, as the API wants.
 *
 * `categoryName` rather than an id, because that is the shape the wire uses:
 * `ProductDto.category` is the category's NAME (a plain string), while
 * `list_products_scoped` and its write twins take an id. The editor therefore
 * works in names — the same currency as the product rows it displays — and
 * resolves the id only at the call site, exactly as RetailPosScreen does
 * (`categories.find((c) => c.name === ...)`).
 */
interface MenuDraft {
  sku: string | null;
  name: string;
  categoryName: string;
  priceMinor: number;
  isActive: boolean;
}

/** Decorative pencil glyph; the button carries the accessible name. */
function EditGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/**
 * The colour a category created here is given.
 *
 * This screen deliberately offers no colour picker — the request was for icons —
 * but the API requires a colour, so the category takes the palette's first entry.
 * It is restylable in Category Management, which owns the colour UI.
 */
const DEFAULT_CATEGORY_COLOUR = CATEGORY_COLOURS[0]!;

const EMPTY_DRAFT: MenuDraft = {
  sku: null,
  name: '',
  categoryName: '',
  priceMinor: 0,
  isActive: true,
};

export interface RestaurantMenuEditorScreenProps {
  onBack?: () => void;
}

export default function RestaurantMenuEditorScreen({ onBack }: RestaurantMenuEditorScreenProps) {
  const { sessionToken } = useWorkspace();
  const { l10n } = useLocalization();
  const { addToast } = useToast();

  const [items, setItems] = useState<ProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  // The selected category's NAME. ProductDto.category carries a name (not an id),
  // so a filter can only match on a name.
  const [selectedCategoryName, setSelectedCategoryName] = useState<string>('');
  const [draft, setDraft] = useState<MenuDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  // The icon a NEW category will carry. The API also requires a colour, and this
  // screen offers no picker for it (the ask here was icons): the category takes
  // DEFAULT_CATEGORY_COLOUR, which the Category Management screen can restyle.
  const [newCategoryIcon, setNewCategoryIcon] = useState<string>(() => randomCategoryIcon());
  const iconRadioRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Guards the load effect against a resolve arriving after unmount, and against
  // React 18's double-invoke in development remounting the fetch.
  const loadedRef = useRef(false);

  const currency = 'IDR';

  useEffect(() => {
    if (loadedRef.current || !sessionToken) return;
    loadedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const [prods, cats] = await Promise.all([
          listProductsScoped(sessionToken),
          listCategoriesScoped(sessionToken),
        ]);
        if (cancelled) return;
        setItems(prods);
        setCategories(cats);
        setSelectedCategoryName(cats[0]?.name ?? '');
      } catch (err) {
        if (!cancelled) {
          addToast({
            message: l10nErrorMessage(err, l10n, 'restaurant-menu-editor-error-load'),
            type: 'error',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, addToast, l10n]);

  const visibleItems = useMemo(
    () => items.filter((p) => (p.category ?? '') === selectedCategoryName),
    [items, selectedCategoryName],
  );

  /**
   * Resolve a category NAME to its id, for the write calls.
   *
   * `ProductDto.category` is a name; `create_product_scoped` and
   * `update_product_scoped` take an id. Names are what the product rows carry
   * and what the draft holds, so the translation happens here, once, at the
   * boundary — the same move RetailPosScreen makes inline. An unknown name
   * yields null, which the API reads as "no category" rather than as a
   * dangling reference.
   */
  const categoryIdFor = useCallback(
    (name: string): string | null => categories.find((c) => c.name === name)?.id ?? null,
    [categories],
  );

  const beginCreate = useCallback(() => {
    setDraft({ ...EMPTY_DRAFT, categoryName: selectedCategoryName });
    setDirty(true);
  }, [selectedCategoryName]);

  const beginEdit = useCallback((p: ProductDto) => {
    setDraft({
      sku: p.sku,
      name: p.name,
      categoryName: p.category ?? '',
      priceMinor: p.price.minor_units,
      isActive: p.is_active !== false,
    });
    setDirty(true);
  }, []);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    setDirty(false);
  }, []);

  // Back is guarded, matching RestaurantReceiptsScreen: an unsaved draft is never
  // dropped silently.
  const handleRequestBack = useCallback(() => {
    if (dirty) {
      setShowUnsavedDialog(true);
    } else {
      onBack?.();
    }
  }, [dirty, onBack]);

  useEffect(() => {
    if (!onBack) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as HTMLElement)?.closest('[role="dialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      handleRequestBack();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onBack, handleRequestBack]);

  const handleSaveDraft = useCallback(async () => {
    if (!draft || !sessionToken) return;
    setSaving(true);
    try {
      if (draft.sku) {
        await updateProductScoped(sessionToken, {
          sku: draft.sku,
          name: draft.name,
          priceMinor: draft.priceMinor,
          currency,
          categoryId: categoryIdFor(draft.categoryName),
          taxRateIds: [],
          isActive: draft.isActive,
        });
        setItems((prev) =>
          prev.map((p) =>
            p.sku === draft.sku
              ? {
                  ...p,
                  name: draft.name,
                  category: draft.categoryName || null,
                  price: { minor_units: draft.priceMinor, currency },
                  is_active: draft.isActive,
                }
              : p,
          ),
        );
      } else {
        // The backend does not mint a SKU, and foundation::validate_sku rejects a
        // blank one — so the editor supplies it. See generateMenuSku for why the
        // format is alphanumeric-only (hyphens are rejected too).
        const sku = generateMenuSku();
        await createProductScoped(sessionToken, {
          sku,
          name: draft.name,
          priceMinor: draft.priceMinor,
          currency,
          categoryId: categoryIdFor(draft.categoryName),
          initialStock: 0,
          taxRateIds: [],
          isActive: draft.isActive,
        });
        // Append the created row rather than refetching the catalog: the row is
        // fully known here, and a refetch would discard a draft the operator had
        // open on another category.
        setItems((prev) => [
          ...prev,
          {
            sku,
            name: draft.name,
            category: draft.categoryName || null,
            price: { minor_units: draft.priceMinor, currency },
            barcode: null,
            in_stock: false,
            stock_qty: 0,
            tax_rate_ids: [],
            created_at: new Date().toISOString(),
            price_updated_at: new Date().toISOString(),
            product_type: 'standard',
            is_active: draft.isActive,
          },
        ]);
      }
      setDraft(null);
      setDirty(false);
      addToast({ message: l10n.getString('restaurant-menu-editor-save-success'), type: 'success' });
    } catch (err) {
      addToast({
        message: l10nErrorMessage(err, l10n, 'restaurant-menu-editor-error-save'),
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [draft, sessionToken, categoryIdFor, addToast, l10n]);

  const handleDeleteItem = useCallback(
    async (sku: string) => {
      if (!sessionToken) return;
      try {
        await deleteProductScoped(sessionToken, sku);
        setItems((prev) => prev.filter((p) => p.sku !== sku));
        addToast({ message: l10n.getString('restaurant-menu-editor-delete-success'), type: 'success' });
      } catch (err) {
        addToast({
          message: l10nErrorMessage(err, l10n, 'restaurant-menu-editor-error-delete'),
          type: 'error',
        });
      }
    },
    [sessionToken, addToast, l10n],
  );

  const handleAddCategory = useCallback(async () => {
    const name = newCategoryName.trim();
    if (!name || !sessionToken) return;
    try {
      // The API requires a caller-supplied id (CategoryDto.id is a stable key the
      // products reference); the backend does not mint one for categories.
      const res = await createCategoryScoped(sessionToken, {
        id: `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        colour: DEFAULT_CATEGORY_COLOUR,
        icon: newCategoryIcon,
      });
      const cats = await listCategoriesScoped(sessionToken);
      setCategories(cats);
      setNewCategoryName('');
      // Re-roll the icon for the next one, so a second add does not silently
      // inherit the first category's glyph.
      setNewCategoryIcon(randomCategoryIcon());
      // Select the category just created, by the name we sent: the rail filters
      // on names, and re-reading the list would not tell us which row is new.
      if (res?.id) setSelectedCategoryName(name);
    } catch (err) {
      addToast({
        message: l10nErrorMessage(err, l10n, 'restaurant-menu-editor-error-save'),
        type: 'error',
      });
    }
  }, [newCategoryName, newCategoryIcon, sessionToken, addToast, l10n]);

  const handleDeleteCategory = useCallback(
    async (category: CategoryDto) => {
      if (!sessionToken) return;
      try {
        const res = await deleteCategoryScoped(sessionToken, category.id);
        const cats = await listCategoriesScoped(sessionToken);
        const prods = await listProductsScoped(sessionToken);
        setCategories(cats);
        setItems(prods);
        // Deleting the category being viewed must move the selection, or the
        // right-hand pane would filter on a name that no longer exists and show
        // an empty list with no explanation.
        if (selectedCategoryName === category.name) setSelectedCategoryName(cats[0]?.name ?? '');
        // The backend reports how many products were rehomed rather than deleted;
        // surfacing it is the difference between "it worked" and "it moved my items".
        if (res?.affected_products) {
          addToast({
            message: l10n.getString('restaurant-menu-editor-category-deleted-moved', {
              count: res.affected_products,
            }),
            type: 'success',
          });
        } else {
          addToast({ message: l10n.getString('restaurant-menu-editor-delete-success'), type: 'success' });
        }
      } catch (err) {
        addToast({
          message: l10nErrorMessage(err, l10n, 'restaurant-menu-editor-error-delete'),
          type: 'error',
        });
      }
    },
    [sessionToken, selectedCategoryName, addToast, l10n],
  );

  return (
    <div className="restaurant-settings-screen">
      <div className="restaurant-settings-header" data-testid="restaurant-menu-editor-header">
        <div className="restaurant-settings-header-lead">
          {onBack && (
            <button
              type="button"
              className="restaurant-settings-back-btn"
              onClick={handleRequestBack}
              aria-label={l10n.getString('back') || 'Back'}
              data-testid="restaurant-menu-editor-back-btn"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="18"
                height="18"
                aria-hidden="true"
              >
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )}
          <div className="restaurant-settings-header-title-group">
            <span
              className="restaurant-settings-header-icon"
              data-testid="restaurant-menu-editor-icon"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="20"
                height="20"
                aria-hidden="true"
              >
                <path d="M4 3h11l5 5v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
                <path d="M14 3v6h6" />
                <path d="M8 13h8M8 17h5" />
              </svg>
            </span>
            <Localized id="restaurant-menu-editor-title">
              <h1 className="restaurant-settings-title" data-testid="restaurant-menu-editor-title">
                Menu Editor
              </h1>
            </Localized>
          </div>
        </div>

        <div className="restaurant-settings-header-actions">
          <span
            className="restaurant-settings-header-dirty"
            style={{ color: dirty ? 'var(--color-warning)' : 'var(--color-fg-muted)' }}
          >
            {dirty ? (
              <Localized id="restaurant-unsaved-changes">Unsaved changes</Localized>
            ) : (
              <Localized id="restaurant-all-saved">All changes saved</Localized>
            )}
          </span>
          <button
            type="button"
            className="btn btn--primary btn--md"
            disabled={!draft || saving}
            aria-busy={saving || undefined}
            onClick={handleSaveDraft}
            data-testid="restaurant-menu-editor-save-btn"
          >
            <Localized id="save">Save Changes</Localized>
          </button>
        </div>
      </div>

      <div className="restaurant-settings-main">
        <div className="restaurant-menu-editor-layout">
          <aside className="restaurant-menu-editor-rail" aria-label={l10n.getString('restaurant-menu-editor-categories')}>
            <div className="restaurant-menu-editor-rail-head">
              <Localized id="restaurant-menu-editor-categories">
                <span>Categories</span>
              </Localized>
            </div>
            <ul className="restaurant-menu-editor-category-list">
              {categories.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`restaurant-menu-editor-category${c.name === selectedCategoryName ? ' restaurant-menu-editor-category--active' : ''}`}
                    onClick={() => setSelectedCategoryName(c.name)}
                    aria-current={c.name === selectedCategoryName ? 'true' : undefined}
                  >
                    <span className="restaurant-menu-editor-category-name">{c.name}</span>
                    <span className="restaurant-menu-editor-category-count">
                      {items.filter((p) => (p.category ?? '') === c.name).length}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="restaurant-menu-editor-category-delete"
                    onClick={() => handleDeleteCategory(c)}
                    aria-label={l10n.getString('restaurant-menu-editor-delete-category-aria', { name: c.name })}
                  >
                    {'\u00d7'}
                  </button>
                </li>
              ))}
            </ul>
            {/* Icon picker for the category about to be created. Same
                radiogroup contract as CategoryManagementScreen: arrows move
                focus AND selection, Tab leaves the group, and each button is
                named by its own Fluent label because it renders an icon only. */}
            <div
              className="restaurant-menu-editor-icon-picker"
              role="radiogroup"
              aria-label={l10n.getString('categories-icon-picker-aria')}
            >
              {CATEGORY_ICON_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  ref={(el) => { iconRadioRefs.current[opt.id] = el; }}
                  tabIndex={newCategoryIcon === opt.id ? 0 : -1}
                  aria-checked={newCategoryIcon === opt.id}
                  aria-label={l10n.getString(categoryIconLabelId(opt.id))}
                  className={
                    newCategoryIcon === opt.id
                      ? 'restaurant-menu-editor-icon-btn restaurant-menu-editor-icon-btn--selected'
                      : 'restaurant-menu-editor-icon-btn'
                  }
                  style={newCategoryIcon === opt.id ? { borderColor: DEFAULT_CATEGORY_COLOUR } : undefined}
                  onClick={() => setNewCategoryIcon(opt.id)}
                  onKeyDown={(e) => {
                    const next = nextRadioValue(CATEGORY_ICON_IDS, newCategoryIcon, e.key);
                    if (next === null) return;
                    e.preventDefault();
                    setNewCategoryIcon(next);
                    iconRadioRefs.current[next]?.focus();
                  }}
                  data-testid={`restaurant-menu-editor-icon-${opt.id}`}
                >
                  <CategoryIconSvg icon={opt.id} size={20} />
                </button>
              ))}
            </div>
            <div className="restaurant-menu-editor-add-category">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddCategory();
                }}
                placeholder={l10n.getString('restaurant-menu-editor-new-category')}
                aria-label={l10n.getString('restaurant-menu-editor-new-category')}
                data-testid="restaurant-menu-editor-new-category"
              />
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={!newCategoryName.trim()}
                onClick={handleAddCategory}
              >
                <Localized id="restaurant-menu-editor-add-category">
                  <span>Add</span>
                </Localized>
              </button>
            </div>
          </aside>

          <section className="restaurant-menu-editor-items">
            {loading ? (
              <p className="restaurant-menu-editor-empty">
                <Localized id="restaurant-menu-editor-loading">
                  <span>Loading menu…</span>
                </Localized>
              </p>
            ) : (
              <>
                {!draft && (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm restaurant-menu-editor-new-item"
                    onClick={beginCreate}
                    disabled={!selectedCategoryName}
                    data-testid="restaurant-menu-editor-new-item"
                  >
                    <Localized id="restaurant-menu-editor-new-item">
                      <span>Add item</span>
                    </Localized>
                  </button>
                )}

                {draft && (
                  <form
                    className="restaurant-menu-editor-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveDraft();
                    }}
                  >
                    <label htmlFor="restaurant-menu-editor-name">
                      <Localized id="restaurant-menu-editor-field-name">Name</Localized>
                      <input
                        id="restaurant-menu-editor-name"
                        type="text"
                        value={draft.name}
                        required
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        data-testid="restaurant-menu-editor-name"
                      />
                    </label>
                    <label htmlFor="restaurant-menu-editor-price">
                      <Localized id="restaurant-menu-editor-field-price">Price</Localized>
                      <input
                        id="restaurant-menu-editor-price"
                        type="text"
                        inputMode="decimal"
                        value={formatMinorForInput(draft.priceMinor)}
                        onChange={(e) => {
                          const minor = parsePriceToMinor(e.target.value, currency);
                          setDraft({ ...draft, priceMinor: minor ?? 0 });
                        }}
                        data-testid="restaurant-menu-editor-price"
                      />
                    </label>
                    <label htmlFor="restaurant-menu-editor-draft-category">
                      <Localized id="restaurant-menu-editor-field-category">Category</Localized>
                      <select
                        id="restaurant-menu-editor-draft-category"
                        value={draft.categoryName}
                        onChange={(e) => setDraft({ ...draft, categoryName: e.target.value })}
                        data-testid="restaurant-menu-editor-draft-category"
                      >
                        <option value="">{l10n.getString('restaurant-menu-editor-uncategorised')}</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="restaurant-menu-editor-checkbox">
                      <input
                        type="checkbox"
                        checked={draft.isActive}
                        onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                        data-testid="restaurant-menu-editor-active"
                      />
                      <Localized id="restaurant-menu-editor-field-active">Available to sell</Localized>
                    </label>
                    <div className="restaurant-menu-editor-form-actions">
                      <button type="submit" className="btn btn--primary btn--sm" disabled={saving}>
                        <Localized id="save">
                          <span>Save</span>
                        </Localized>
                      </button>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={cancelDraft}>
                        <Localized id="cancel">
                          <span>Cancel</span>
                        </Localized>
                      </button>
                    </div>
                  </form>
                )}

                {visibleItems.length === 0 && !draft ? (
                  <p className="restaurant-menu-editor-empty">
                    <Localized id="restaurant-menu-editor-empty">
                      <span>No items in this category yet.</span>
                    </Localized>
                  </p>
                ) : (
                  <ul className="restaurant-menu-editor-item-list">
                    {visibleItems.map((p) => (
                      <li key={p.sku} className="restaurant-menu-editor-item">
                        <button
                          type="button"
                          className="restaurant-menu-editor-item-main"
                          onClick={() => beginEdit(p)}
                        >
                          <span className="restaurant-menu-editor-item-name">{p.name}</span>
                          <span className="restaurant-menu-editor-item-price">
                            {formatMinorForInput(p.price.minor_units)}
                          </span>
                          {p.is_active === false && (
                            <span className="restaurant-menu-editor-item-hidden">
                              <Localized id="restaurant-menu-editor-hidden">
                                <span>Hidden</span>
                              </Localized>
                            </span>
                          )}
                        </button>
                        {/* An explicit Edit control beside the row: clicking the
                            name also opens the editor, but a manager should not
                            have to discover that. */}
                        <button
                          type="button"
                          className="restaurant-menu-editor-item-edit"
                          onClick={() => beginEdit(p)}
                          aria-label={l10n.getString('restaurant-menu-editor-edit-item-aria', { name: p.name })}
                          data-testid={`restaurant-menu-editor-edit-${p.sku}`}
                        >
                          <EditGlyph />
                        </button>
                        <button
                          type="button"
                          className="restaurant-menu-editor-item-delete"
                          onClick={() => handleDeleteItem(p.sku)}
                          aria-label={l10n.getString('restaurant-menu-editor-delete-item-aria', { name: p.name })}
                        >
                          {'\u00d7'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onCancel={() => setShowUnsavedDialog(false)}
        onDiscard={() => {
          setShowUnsavedDialog(false);
          setDraft(null);
          setDirty(false);
          onBack?.();
        }}
        onSave={async () => {
          await handleSaveDraft();
          setShowUnsavedDialog(false);
          onBack?.();
        }}
        saving={saving}
      />
    </div>
  );
}
