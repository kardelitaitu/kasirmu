// ── RestaurantMenuEditorScreen ─────────────────────────────────────────────
//
// The full-page menu editor reached from the restaurant POS sidebar. Two panes:
// a category rail on the left and the selected category's items on the right,
// each with full SaaS create / edit / delete capabilities.
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
// - All created and edited dishes are tagged with productType: 'restaurant' so they
//   immediately appear on the restaurant POS selling grid.

import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { l10nErrorMessage } from '@/utils/app-error';
import { asArray } from '@/utils/ipc-payload';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useOptionalCurrency } from '@/contexts/CurrencyContext';
import { formatMoney } from '@/types/domain';
import {
  listProductsScoped,
  createProductScoped,
  updateProductScoped,
  deleteProductScoped,
  listCategoriesScoped,
  createCategoryScoped,
  updateCategoryScoped,
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
  randomCategoryColour,
} from '@/features/categories/categoryIcons';
import { CategoryIconSvg } from '@/features/categories/CategoryIconSvg';
import {
  parsePriceToMinor,
  formatMinorForInput,
  generateMenuSku,
  filterMenuItems,
  sortMenuItems,
  createDuplicateDraft,
  parseDraftModifierGroups,
  serializeDraftModifierGroups,
  type MenuItemStatusFilter,
  type MenuItemSortOption,
  type DraftModifierGroup,
  type DraftModifierOption,
} from './menuEditorLogic';
import './RestaurantSettingsScreens.css';
import './RestaurantMenuEditorScreen.css';

/**
 * A menu item being authored. Price is held in minor units, as the API wants.
 */
interface MenuDraft {
  sku: string | null;
  name: string;
  categoryName: string;
  priceMinor: number;
  isActive: boolean;
  notes: string;
  modifierGroups: DraftModifierGroup[];
}

/** Form state for category creation or editing modal. */
interface CategoryModalState {
  id?: string;
  name: string;
  icon: string;
  colour: string;
}

/** Decorative pencil glyph. */
function EditGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="15"
      height="15"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** Decorative trash glyph. */
function TrashGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="15"
      height="15"
      aria-hidden="true"
    >
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/** Decorative search glyph. */
function SearchGlyph() {
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
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/** Decorative layers glyph for "All Items" category. */
function LayersGlyph() {
  return (
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
      <path d="m12 2 10 5-10 5L2 7l10-5Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </svg>
  );
}

/** Decorative note glyph for dish description / prep notes. */
function NoteGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="13"
      height="13"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

/** Decorative duplicate / copy glyph. */
function CopyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="15"
      height="15"
      aria-hidden="true"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

const EMPTY_DRAFT: MenuDraft = {
  sku: null,
  name: '',
  categoryName: '',
  priceMinor: 0,
  isActive: true,
  notes: '',
  modifierGroups: [],
};

export interface RestaurantMenuEditorScreenProps {
  onBack?: () => void;
  sessionToken?: string | null;
}

export default function RestaurantMenuEditorScreen({
  onBack,
  sessionToken: propSessionToken,
}: RestaurantMenuEditorScreenProps) {
  const { sessionToken: contextSessionToken } = useWorkspace();
  const sessionToken = propSessionToken || contextSessionToken || '';
  const { l10n } = useLocalization();
  const { addToast } = useToast();

  const [items, setItems] = useState<ProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  // The selected category's NAME. Empty string means "All Items".
  const [selectedCategoryName, setSelectedCategoryName] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<MenuItemStatusFilter>('all');
  const [sortOption, setSortOption] = useState<MenuItemSortOption>('default');
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [draft, setDraft] = useState<MenuDraft | null>(null);
  const [categoryModal, setCategoryModal] = useState<CategoryModalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  const [deleteItemTarget, setDeleteItemTarget] = useState<ProductDto | null>(null);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<CategoryDto | null>(null);

  const iconRadioRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const currencyCtx = useOptionalCurrency();
  const currency = currencyCtx?.currency || 'IDR';

  const loadSeqRef = useRef(0);

  // Load menu products and categories
  const reloadData = useCallback(async () => {
    if (!sessionToken) {
      setLoading(false);
      return;
    }
    const seq = ++loadSeqRef.current;
    try {
      const [prodsRes, catsRes] = await Promise.allSettled([
        listProductsScoped(sessionToken),
        listCategoriesScoped(sessionToken),
      ]);
      if (seq !== loadSeqRef.current) return;

      if (prodsRes.status === 'fulfilled') {
        setItems(asArray<ProductDto>(prodsRes.value));
      } else {
        addToast({
          message: l10nErrorMessage(prodsRes.reason, l10n, 'restaurant-menu-editor-error-load'),
          type: 'error',
        });
      }

      if (catsRes.status === 'fulfilled') {
        const fetchedCats = asArray<CategoryDto>(catsRes.value);
        setCategories(fetchedCats);
      } else {
        addToast({
          message: l10nErrorMessage(catsRes.reason, l10n, 'restaurant-menu-editor-error-load'),
          type: 'error',
        });
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [sessionToken, addToast, l10n]);

  useEffect(() => {
    void reloadData();
  }, [reloadData]);

  // Keep menu editor focused on restaurant products (or items created here)
  const restaurantItems = useMemo(
    () => items.filter((p) => p.product_type === 'restaurant' || !p.product_type || p.product_type === 'standard'),
    [items],
  );

  // Filter items matching active category, status, and query
  const filteredItems = useMemo(
    () =>
      filterMenuItems({
        items: restaurantItems,
        selectedCategoryName,
        searchQuery,
        statusFilter,
      }),
    [restaurantItems, selectedCategoryName, searchQuery, statusFilter],
  );

  // Sort items according to active sort option
  const processedItems = useMemo(
    () => sortMenuItems(filteredItems, sortOption),
    [filteredItems, sortOption],
  );

  /** Resolve category name to id for backend calls. */
  const categoryIdFor = useCallback(
    (name: string): string | null => categories.find((c) => c.name === name)?.id ?? null,
    [categories],
  );

  // ── Item Actions ──────────────────────────────────────────────────

  const beginCreate = useCallback(() => {
    setDraft({
      ...EMPTY_DRAFT,
      categoryName: selectedCategoryName || categories[0]?.name || '',
      notes: '',
      modifierGroups: [],
    });
    setDirty(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }, [selectedCategoryName, categories]);

  const beginEdit = useCallback((p: ProductDto) => {
    const isJsonNotes = Boolean(p.notes?.startsWith('['));
    setDraft({
      sku: p.sku,
      name: p.name,
      categoryName: p.category ?? '',
      priceMinor: p.price.minor_units,
      isActive: p.is_active !== false,
      notes: isJsonNotes ? '' : (p.notes ?? ''),
      modifierGroups: parseDraftModifierGroups(p.notes),
    });
    setDirty(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }, []);

  const handleDuplicateItem = useCallback((p: ProductDto) => {
    const dup = createDuplicateDraft(p);
    setDraft(dup);
    setDirty(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }, []);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    setDirty(false);
  }, []);

  const handleToggleItemAvailability = useCallback(
    async (p: ProductDto) => {
      if (!sessionToken) return;
      const nextActive = p.is_active === false;
      // Optimistic update
      setItems((prev) =>
        prev.map((item) => (item.sku === p.sku ? { ...item, is_active: nextActive } : item)),
      );
      try {
        await updateProductScoped(sessionToken, {
          sku: p.sku,
          name: p.name,
          priceMinor: p.price.minor_units,
          currency,
          categoryId: categoryIdFor(p.category ?? ''),
          productType: 'restaurant',
          taxRateIds: p.tax_rate_ids ?? [],
          isActive: nextActive,
          notes: p.notes ?? null,
        });
        addToast({
          message: l10n.getString('restaurant-menu-editor-save-success'),
          type: 'success',
        });
      } catch (err) {
        // Rollback
        setItems((prev) =>
          prev.map((item) => (item.sku === p.sku ? { ...item, is_active: !nextActive } : item)),
        );
        addToast({
          message: l10nErrorMessage(err, l10n, 'restaurant-menu-editor-error-save'),
          type: 'error',
        });
      }
    },
    [sessionToken, categoryIdFor, addToast, l10n, currency],
  );

  const handleBulkSetAvailability = useCallback(
    async (targetActive: boolean) => {
      if (!sessionToken || bulkUpdating) return;
      const targetItems = filteredItems.filter((p) => (p.is_active !== false) !== targetActive);
      if (targetItems.length === 0) return;

      setBulkUpdating(true);
      const targetSkus = new Set(targetItems.map((p) => p.sku));
      setItems((prev) =>
        prev.map((item) =>
          targetSkus.has(item.sku) ? { ...item, is_active: targetActive } : item,
        ),
      );

      try {
        await Promise.all(
          targetItems.map((p) =>
            updateProductScoped(sessionToken, {
              sku: p.sku,
              name: p.name,
              priceMinor: p.price.minor_units,
              currency,
              categoryId: categoryIdFor(p.category ?? ''),
              productType: 'restaurant',
              taxRateIds: p.tax_rate_ids ?? [],
              isActive: targetActive,
              notes: p.notes ?? null,
            }),
          ),
        );
        addToast({
          message: l10n.getString('restaurant-menu-editor-bulk-updated', {
            count: targetItems.length,
          }),
          type: 'success',
        });
      } catch (err) {
        const freshProds = await listProductsScoped(sessionToken);
        setItems(freshProds);
        addToast({
          message: l10nErrorMessage(err, l10n, 'restaurant-menu-editor-error-save'),
          type: 'error',
        });
      } finally {
        setBulkUpdating(false);
      }
    },
    [sessionToken, bulkUpdating, filteredItems, currency, categoryIdFor, addToast, l10n],
  );

  const handleAddModifierGroup = useCallback(() => {
    setDraft((prev) => {
      if (!prev) return prev;
      const newGroup: DraftModifierGroup = {
        id: `mg-${Date.now().toString(36)}-${prev.modifierGroups.length}`,
        name: '',
        minSelections: 0,
        maxSelections: 1,
        options: [
          {
            id: `opt-${Date.now().toString(36)}-0`,
            name: '',
            priceMinor: 0,
          },
        ],
      };
      return {
        ...prev,
        modifierGroups: [...prev.modifierGroups, newGroup],
      };
    });
    setDirty(true);
  }, []);

  const handleRemoveModifierGroup = useCallback((groupId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        modifierGroups: prev.modifierGroups.filter((g) => g.id !== groupId),
      };
    });
    setDirty(true);
  }, []);

  const handleUpdateModifierGroup = useCallback(
    (groupId: string, patch: Partial<DraftModifierGroup>) => {
      setDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          modifierGroups: prev.modifierGroups.map((g) =>
            g.id === groupId ? { ...g, ...patch } : g,
          ),
        };
      });
      setDirty(true);
    },
    [],
  );

  const handleAddModifierOption = useCallback((groupId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        modifierGroups: prev.modifierGroups.map((g) => {
          if (g.id !== groupId) return g;
          const newOpt: DraftModifierOption = {
            id: `opt-${Date.now().toString(36)}-${g.options.length}`,
            name: '',
            priceMinor: 0,
          };
          return {
            ...g,
            options: [...g.options, newOpt],
          };
        }),
      };
    });
    setDirty(true);
  }, []);

  const handleRemoveModifierOption = useCallback((groupId: string, optionId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        modifierGroups: prev.modifierGroups.map((g) => {
          if (g.id !== groupId) return g;
          return {
            ...g,
            options: g.options.filter((o) => o.id !== optionId),
          };
        }),
      };
    });
    setDirty(true);
  }, []);

  const handleUpdateModifierOption = useCallback(
    (groupId: string, optionId: string, patch: Partial<DraftModifierOption>) => {
      setDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          modifierGroups: prev.modifierGroups.map((g) => {
            if (g.id !== groupId) return g;
            return {
              ...g,
              options: g.options.map((o) => (o.id === optionId ? { ...o, ...patch } : o)),
            };
          }),
        };
      });
      setDirty(true);
    },
    [],
  );

  const handleSaveDraft = useCallback(async () => {
    if (!draft || !sessionToken || !draft.name.trim()) return;
    setSaving(true);
    const serializedModifiers = serializeDraftModifierGroups(draft.modifierGroups);
    const trimmedNotes = draft.notes.trim() || null;
    const finalNotes = serializedModifiers ?? trimmedNotes;
    try {
      if (draft.sku) {
        await updateProductScoped(sessionToken, {
          sku: draft.sku,
          name: draft.name.trim(),
          priceMinor: draft.priceMinor,
          currency,
          categoryId: categoryIdFor(draft.categoryName),
          productType: 'restaurant',
          taxRateIds: [],
          isActive: draft.isActive,
          notes: finalNotes,
        });
        setItems((prev) =>
          prev.map((p) =>
            p.sku === draft.sku
              ? {
                  ...p,
                  name: draft.name.trim(),
                  category: draft.categoryName || null,
                  price: { minor_units: draft.priceMinor, currency },
                  product_type: 'restaurant',
                  is_active: draft.isActive,
                  notes: finalNotes,
                }
              : p,
          ),
        );
      } else {
        const sku = generateMenuSku();
        await createProductScoped(sessionToken, {
          sku,
          name: draft.name.trim(),
          priceMinor: draft.priceMinor,
          currency,
          categoryId: categoryIdFor(draft.categoryName),
          productType: 'restaurant',
          initialStock: 0,
          taxRateIds: [],
          isActive: draft.isActive,
          notes: finalNotes,
        });
        setItems((prev) => [
          ...prev,
          {
            sku,
            name: draft.name.trim(),
            category: draft.categoryName || null,
            price: { minor_units: draft.priceMinor, currency },
            barcode: null,
            in_stock: false,
            stock_qty: 0,
            tax_rate_ids: [],
            created_at: new Date().toISOString(),
            price_updated_at: new Date().toISOString(),
            product_type: 'restaurant',
            is_active: draft.isActive,
            notes: finalNotes,
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
  }, [draft, sessionToken, categoryIdFor, addToast, l10n, currency]);

  const handleDeleteItem = useCallback(
    async (sku: string) => {
      if (!sessionToken) return;
      try {
        await deleteProductScoped(sessionToken, sku);
        setItems((prev) => prev.filter((p) => p.sku !== sku));
        if (draft?.sku === sku) cancelDraft();
        addToast({ message: l10n.getString('restaurant-menu-editor-delete-success'), type: 'success' });
      } catch (err) {
        addToast({
          message: l10nErrorMessage(err, l10n, 'restaurant-menu-editor-error-delete'),
          type: 'error',
        });
      }
    },
    [sessionToken, draft, cancelDraft, addToast, l10n],
  );

  // ── Category Actions ──────────────────────────────────────────────

  const beginCreateCategory = useCallback(() => {
    setCategoryModal({
      name: '',
      icon: randomCategoryIcon(),
      colour: randomCategoryColour(),
    });
  }, []);

  const beginEditCategory = useCallback((c: CategoryDto) => {
    setCategoryModal({
      id: c.id,
      name: c.name,
      icon: c.icon || randomCategoryIcon(),
      colour: c.colour || CATEGORY_COLOURS[0]!,
    });
  }, []);

  const handleSaveCategory = useCallback(async () => {
    if (!categoryModal || !sessionToken) return;
    const trimmedName = categoryModal.name.trim();
    if (!trimmedName) return;

    // Prevent duplicate category names with immediate localized feedback
    const isDuplicate = categories.some(
      (c) => c.name.toLowerCase() === trimmedName.toLowerCase() && c.id !== categoryModal.id,
    );
    if (isDuplicate) {
      addToast({
        message:
          l10n.getString('restaurant-menu-editor-category-name-exists') ||
          'A category with this name already exists.',
        type: 'error',
      });
      return;
    }

    setCategorySaving(true);
    try {
      if (categoryModal.id) {
        // Edit category
        const oldCat = categories.find((c) => c.id === categoryModal.id);
        const oldName = oldCat?.name ?? '';
        await updateCategoryScoped(sessionToken, {
          id: categoryModal.id,
          name: trimmedName,
          colour: categoryModal.colour,
          icon: categoryModal.icon,
        });

        setCategories((prev) =>
          prev.map((c) =>
            c.id === categoryModal.id
              ? { ...c, name: trimmedName, colour: categoryModal.colour, icon: categoryModal.icon }
              : c,
          ),
        );

        // Rehome products if the category name changed
        if (oldName && oldName !== trimmedName) {
          setItems((prev) =>
            prev.map((p) => (p.category === oldName ? { ...p, category: trimmedName } : p)),
          );
          if (selectedCategoryName === oldName) setSelectedCategoryName(trimmedName);
        }

        addToast({
          message: l10n.getString('restaurant-menu-editor-category-saved'),
          type: 'success',
        });
      } else {
        // Create category
        const id = `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        await createCategoryScoped(sessionToken, {
          id,
          name: trimmedName,
          colour: categoryModal.colour,
          icon: categoryModal.icon,
        });
        const cats = await listCategoriesScoped(sessionToken);
        setCategories(asArray<CategoryDto>(cats));
        setSelectedCategoryName(trimmedName);
        addToast({
          message: l10n.getString('restaurant-menu-editor-save-success'),
          type: 'success',
        });
      }
      setCategoryModal(null);
    } catch (err) {
      addToast({
        message: l10nErrorMessage(err, l10n, 'restaurant-menu-editor-error-save'),
        type: 'error',
      });
    } finally {
      setCategorySaving(false);
    }
  }, [categoryModal, categories, selectedCategoryName, sessionToken, addToast, l10n]);

  const handleDeleteCategory = useCallback(
    async (category: CategoryDto) => {
      if (!sessionToken) return;
      try {
        const res = await deleteCategoryScoped(sessionToken, category.id);
        const cats = await listCategoriesScoped(sessionToken);
        const prods = await listProductsScoped(sessionToken);
        setCategories(asArray<CategoryDto>(cats));
        setItems(asArray<ProductDto>(prods));
        if (selectedCategoryName === category.name) setSelectedCategoryName('');
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

  // ── Back Guard ────────────────────────────────────────────────────

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
      if (categoryModal) {
        setCategoryModal(null);
        return;
      }
      if ((e.target as HTMLElement)?.closest('[role="dialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      handleRequestBack();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onBack, categoryModal, handleRequestBack]);

  // Total counts for status pills
  const totalInCategory = useMemo(
    () =>
      restaurantItems.filter(
        (p) => !selectedCategoryName || (p.category ?? '') === selectedCategoryName,
      ).length,
    [restaurantItems, selectedCategoryName],
  );
  const availableInCategory = useMemo(
    () =>
      restaurantItems.filter(
        (p) =>
          (!selectedCategoryName || (p.category ?? '') === selectedCategoryName) &&
          p.is_active !== false,
      ).length,
    [restaurantItems, selectedCategoryName],
  );
  const hiddenInCategory = useMemo(
    () =>
      restaurantItems.filter(
        (p) =>
          (!selectedCategoryName || (p.category ?? '') === selectedCategoryName) &&
          p.is_active === false,
      ).length,
    [restaurantItems, selectedCategoryName],
  );

  return (
    <div className="restaurant-settings-screen">
      {/* ── Page Header ────────────────────────────────────────── */}
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

      {/* ── Main Layout: Category Rail + Items View ─────────────── */}
      <div className="restaurant-settings-main">
        <div className="restaurant-menu-editor-layout">
          {/* ── Rail: Categories ── */}
          <aside className="restaurant-menu-editor-rail" aria-label={l10n.getString('restaurant-menu-editor-categories')}>
            <div className="restaurant-menu-editor-rail-head">
              <Localized id="restaurant-menu-editor-categories">
                <span>Categories</span>
              </Localized>
              <button
                type="button"
                className="restaurant-menu-editor-btn-add-cat"
                onClick={beginCreateCategory}
                aria-label={l10n.getString('restaurant-menu-editor-create-category')}
                data-testid="restaurant-menu-editor-btn-add-cat"
              >
                +
              </button>
            </div>

            <ul className="restaurant-menu-editor-category-list">
              {/* All Items Option */}
              <li>
                <button
                  type="button"
                  className={`restaurant-menu-editor-category${selectedCategoryName === '' ? ' restaurant-menu-editor-category--active' : ''}`}
                  onClick={() => setSelectedCategoryName('')}
                  aria-current={selectedCategoryName === '' ? 'true' : undefined}
                >
                  <span className="restaurant-menu-editor-category-icon-box">
                    <LayersGlyph />
                  </span>
                  <span className="restaurant-menu-editor-category-name">
                    <Localized id="restaurant-menu-editor-all-categories">All Items</Localized>
                  </span>
                  <span className="restaurant-menu-editor-category-count">
                    {restaurantItems.length}
                  </span>
                </button>
              </li>

              {/* Categorised options */}
              {categories.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`restaurant-menu-editor-category${c.name === selectedCategoryName ? ' restaurant-menu-editor-category--active' : ''}`}
                    onClick={() => setSelectedCategoryName(c.name)}
                    aria-current={c.name === selectedCategoryName ? 'true' : undefined}
                  >
                    <span
                      className="restaurant-menu-editor-category-icon-box"
                      style={c.colour ? ({ '--cat-accent': c.colour } as CSSProperties) : undefined}
                    >
                      <CategoryIconSvg icon={c.icon} size={18} />
                    </span>
                    <span className="restaurant-menu-editor-category-name">{c.name}</span>
                    <span className="restaurant-menu-editor-category-count">
                      {restaurantItems.filter((p) => (p.category ?? '') === c.name).length}
                    </span>
                  </button>

                  <div className="restaurant-menu-editor-category-row-actions">
                    <button
                      type="button"
                      className="restaurant-menu-editor-category-action-btn"
                      onClick={() => beginEditCategory(c)}
                      aria-label={l10n.getString('restaurant-menu-editor-edit-category-aria', { name: c.name })}
                      data-testid={`restaurant-menu-editor-cat-edit-${c.id}`}
                    >
                      <EditGlyph />
                    </button>
                    <button
                      type="button"
                      className="restaurant-menu-editor-category-action-btn restaurant-menu-editor-category-action-btn--delete"
                      onClick={() => setDeleteCategoryTarget(c)}
                      aria-label={l10n.getString('restaurant-menu-editor-delete-category-aria', { name: c.name })}
                      data-testid={`restaurant-menu-editor-cat-del-${c.id}`}
                    >
                      <TrashGlyph />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </aside>

          {/* ── Pane: Items View ── */}
          <section className="restaurant-menu-editor-items">
            {/* Toolbar */}
            <div className="restaurant-menu-editor-toolbar">
              <div className="restaurant-menu-editor-toolbar-top">
                <div className="restaurant-menu-editor-toolbar-heading">
                  <h2 className="restaurant-menu-editor-view-title">
                    {selectedCategoryName || l10n.getString('restaurant-menu-editor-all-categories')}
                  </h2>
                  <span className="restaurant-menu-editor-view-badge">
                    {processedItems.length}
                  </span>
                </div>

                <div className="restaurant-menu-editor-toolbar-actions">
                  {filteredItems.length > 0 && (
                    <div className="restaurant-menu-editor-bulk-group">
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm restaurant-menu-editor-btn-bulk"
                        disabled={bulkUpdating}
                        onClick={() => handleBulkSetAvailability(true)}
                        data-testid="restaurant-menu-editor-bulk-avail"
                      >
                        <Localized id="restaurant-menu-editor-bulk-available">Make all available</Localized>
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm restaurant-menu-editor-btn-bulk"
                        disabled={bulkUpdating}
                        onClick={() => handleBulkSetAvailability(false)}
                        data-testid="restaurant-menu-editor-bulk-hide"
                      >
                        <Localized id="restaurant-menu-editor-bulk-hide">86 All (Hide)</Localized>
                      </button>
                    </div>
                  )}

                  {!draft && (
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={beginCreate}
                      data-testid="restaurant-menu-editor-new-item"
                    >
                      + <Localized id="restaurant-menu-editor-new-item">Add item</Localized>
                    </button>
                  )}
                </div>
              </div>

              {/* Search & Status Filters */}
              <div className="restaurant-menu-editor-filter-row">
                <div className="restaurant-menu-editor-search-box">
                  <SearchGlyph />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={l10n.getString('restaurant-menu-editor-search-placeholder')}
                    aria-label={l10n.getString('restaurant-menu-editor-search-placeholder')}
                    className="restaurant-menu-editor-search-input"
                    data-testid="restaurant-menu-editor-search-input"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="restaurant-menu-editor-search-clear"
                      onClick={() => setSearchQuery('')}
                      aria-label={l10n.getString('restaurant-menu-editor-clear-search')}
                    >
                      &times;
                    </button>
                  )}
                </div>

                <div className="restaurant-menu-editor-status-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={statusFilter === 'all'}
                    className={`restaurant-menu-editor-status-tab${statusFilter === 'all' ? ' restaurant-menu-editor-status-tab--active' : ''}`}
                    onClick={() => setStatusFilter('all')}
                  >
                    <Localized id="restaurant-menu-editor-filter-all">All</Localized> ({totalInCategory})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={statusFilter === 'available'}
                    className={`restaurant-menu-editor-status-tab${statusFilter === 'available' ? ' restaurant-menu-editor-status-tab--active' : ''}`}
                    onClick={() => setStatusFilter('available')}
                  >
                    <Localized id="restaurant-menu-editor-filter-available">Available</Localized> ({availableInCategory})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={statusFilter === 'hidden'}
                    className={`restaurant-menu-editor-status-tab${statusFilter === 'hidden' ? ' restaurant-menu-editor-status-tab--active' : ''}`}
                    onClick={() => setStatusFilter('hidden')}
                  >
                    <Localized id="restaurant-menu-editor-filter-hidden">Hidden (86)</Localized> ({hiddenInCategory})
                  </button>
                </div>

                <div className="restaurant-menu-editor-sort-select-wrapper">
                  <label htmlFor="restaurant-menu-editor-sort" className="restaurant-menu-editor-sort-label">
                    <Localized id="restaurant-menu-editor-sort-label">Sort</Localized>
                  </label>
                  <select
                    id="restaurant-menu-editor-sort"
                    className="restaurant-menu-editor-sort-select"
                    value={sortOption}
                    onChange={(e) => setSortOption(e.target.value as MenuItemSortOption)}
                    data-testid="restaurant-menu-editor-sort-select"
                  >
                    <option value="default">{l10n.getString('restaurant-menu-editor-sort-default')}</option>
                    <option value="name-asc">{l10n.getString('restaurant-menu-editor-sort-name-asc')}</option>
                    <option value="name-desc">{l10n.getString('restaurant-menu-editor-sort-name-desc')}</option>
                    <option value="price-asc">{l10n.getString('restaurant-menu-editor-sort-price-asc')}</option>
                    <option value="price-desc">{l10n.getString('restaurant-menu-editor-sort-price-desc')}</option>
                  </select>
                </div>
              </div>
            </div>

            {loading ? (
              <p className="restaurant-menu-editor-empty">
                <Localized id="restaurant-menu-editor-loading">
                  <span>Loading menu…</span>
                </Localized>
              </p>
            ) : (
              <>
                {/* ── Item Draft Form ── */}
                {draft && (
                  <form
                    ref={formRef}
                    className="restaurant-menu-editor-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveDraft();
                    }}
                    data-testid="restaurant-menu-editor-form"
                  >
                    <div className="restaurant-menu-editor-form-header">
                      <h3 className="restaurant-menu-editor-form-title">
                        {draft.sku
                          ? l10n.getString('restaurant-menu-editor-edit-item-aria', { name: draft.name })
                          : l10n.getString('restaurant-menu-editor-new-item')}
                      </h3>
                      {draft.sku && (
                        <span className="restaurant-menu-editor-sku-tag">
                          SKU: {draft.sku}
                        </span>
                      )}
                    </div>

                    <div className="restaurant-menu-editor-form-grid">
                      <label htmlFor="restaurant-menu-editor-name" className="restaurant-menu-editor-field">
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

                      <label htmlFor="restaurant-menu-editor-price" className="restaurant-menu-editor-field">
                        <span>
                          <Localized id="restaurant-menu-editor-field-price">Price</Localized> ({currency})
                        </span>
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
                    </div>

                    <label htmlFor="restaurant-menu-editor-draft-category" className="restaurant-menu-editor-field">
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

                    <label htmlFor="restaurant-menu-editor-notes" className="restaurant-menu-editor-field">
                      <Localized id="restaurant-menu-editor-field-notes">Description / Notes</Localized>
                      <textarea
                        id="restaurant-menu-editor-notes"
                        rows={2}
                        value={draft.notes}
                        placeholder={l10n.getString('restaurant-menu-editor-notes-placeholder')}
                        onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                        data-testid="restaurant-menu-editor-notes"
                      />
                    </label>

                    {/* Modifier Groups & Variations Builder */}
                    <div className="restaurant-menu-editor-modifiers-section">
                      <div className="restaurant-menu-editor-modifiers-head">
                        <h4 className="restaurant-menu-editor-modifiers-title">
                          <Localized id="restaurant-menu-editor-modifiers-title">
                            Modifier Groups & Variations
                          </Localized>
                        </h4>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={handleAddModifierGroup}
                          data-testid="restaurant-menu-editor-add-group-btn"
                        >
                          + <Localized id="restaurant-menu-editor-add-modifier-group">Add Modifier Group</Localized>
                        </button>
                      </div>

                      {draft.modifierGroups.length > 0 && (
                        <div className="restaurant-menu-editor-groups-list">
                          {draft.modifierGroups.map((group, gIdx) => (
                            <div
                              key={group.id}
                              className="restaurant-menu-editor-group-card"
                              data-testid={`modifier-group-${gIdx}`}
                            >
                              <div className="restaurant-menu-editor-group-header">
                                <input
                                  type="text"
                                  className="restaurant-menu-editor-group-name-input"
                                  value={group.name}
                                  placeholder={l10n.getString('restaurant-menu-editor-group-name-placeholder')}
                                  onChange={(e) =>
                                    handleUpdateModifierGroup(group.id, { name: e.target.value })
                                  }
                                  data-testid={`modifier-group-name-${gIdx}`}
                                />
                                <div className="restaurant-menu-editor-group-presets">
                                  <button
                                    type="button"
                                    className={`restaurant-menu-editor-preset-btn${group.minSelections === 0 && group.maxSelections > 1 ? ' restaurant-menu-editor-preset-btn--active' : ''}`}
                                    onClick={() =>
                                      handleUpdateModifierGroup(group.id, {
                                        minSelections: 0,
                                        maxSelections: Math.max(2, group.options.length || 2),
                                      })
                                    }
                                    data-testid={`modifier-preset-opt-multi-${gIdx}`}
                                  >
                                    <Localized id="restaurant-menu-editor-mode-optional-multi">
                                      <span>Optional (Multi)</span>
                                    </Localized>
                                  </button>
                                  <button
                                    type="button"
                                    className={`restaurant-menu-editor-preset-btn${group.minSelections === 0 && group.maxSelections === 1 ? ' restaurant-menu-editor-preset-btn--active' : ''}`}
                                    onClick={() =>
                                      handleUpdateModifierGroup(group.id, {
                                        minSelections: 0,
                                        maxSelections: 1,
                                      })
                                    }
                                    data-testid={`modifier-preset-opt-single-${gIdx}`}
                                  >
                                    <Localized id="restaurant-menu-editor-mode-optional-single">
                                      <span>Optional (1)</span>
                                    </Localized>
                                  </button>
                                  <button
                                    type="button"
                                    className={`restaurant-menu-editor-preset-btn${group.minSelections === 1 && group.maxSelections === 1 ? ' restaurant-menu-editor-preset-btn--active' : ''}`}
                                    onClick={() =>
                                      handleUpdateModifierGroup(group.id, {
                                        minSelections: 1,
                                        maxSelections: 1,
                                      })
                                    }
                                    data-testid={`modifier-preset-req-single-${gIdx}`}
                                  >
                                    <Localized id="restaurant-menu-editor-mode-required-single">
                                      <span>Required (1)</span>
                                    </Localized>
                                  </button>
                                </div>
                                <div className="restaurant-menu-editor-group-bounds">
                                  <label className="restaurant-menu-editor-bound-label">
                                    <Localized id="restaurant-menu-editor-modifier-min">Min choices</Localized>
                                    <input
                                      type="number"
                                      min="0"
                                      max="10"
                                      value={group.minSelections}
                                      onChange={(e) =>
                                        handleUpdateModifierGroup(group.id, {
                                          minSelections: Math.max(0, parseInt(e.target.value, 10) || 0),
                                        })
                                      }
                                      className="restaurant-menu-editor-bound-input"
                                    />
                                  </label>
                                  <label className="restaurant-menu-editor-bound-label">
                                    <Localized id="restaurant-menu-editor-modifier-max">Max choices</Localized>
                                    <input
                                      type="number"
                                      min="1"
                                      max="10"
                                      value={group.maxSelections}
                                      onChange={(e) =>
                                        handleUpdateModifierGroup(group.id, {
                                          maxSelections: Math.max(1, parseInt(e.target.value, 10) || 1),
                                        })
                                      }
                                      className="restaurant-menu-editor-bound-input"
                                    />
                                  </label>
                                </div>
                                <button
                                  type="button"
                                  className="restaurant-menu-editor-btn-icon-danger"
                                  onClick={() => handleRemoveModifierGroup(group.id)}
                                  aria-label="Remove Group"
                                  data-testid={`modifier-group-remove-${gIdx}`}
                                >
                                  <TrashGlyph />
                                </button>
                              </div>

                              <div className="restaurant-menu-editor-group-mode-hint">
                                {group.minSelections === 0 && group.maxSelections > 1 ? (
                                  <span className="restaurant-menu-editor-hint-badge restaurant-menu-editor-hint-badge--optional">
                                    <Localized id="restaurant-menu-editor-hint-optional-multi" vars={{ max: group.maxSelections }}>
                                      <span>{`Optional — customer can select up to ${group.maxSelections} choices (e.g. less sugar, less ice)`}</span>
                                    </Localized>
                                  </span>
                                ) : group.minSelections === 0 && group.maxSelections === 1 ? (
                                  <span className="restaurant-menu-editor-hint-badge restaurant-menu-editor-hint-badge--optional">
                                    <Localized id="restaurant-menu-editor-hint-optional-single">
                                      <span>Optional — customer can select at most 1 choice</span>
                                    </Localized>
                                  </span>
                                ) : group.minSelections >= 1 && group.maxSelections === 1 ? (
                                  <span className="restaurant-menu-editor-hint-badge restaurant-menu-editor-hint-badge--required">
                                    <Localized id="restaurant-menu-editor-hint-required-single">
                                      <span>Required — customer must select 1 choice</span>
                                    </Localized>
                                  </span>
                                ) : (
                                  <span className="restaurant-menu-editor-hint-badge restaurant-menu-editor-hint-badge--required">
                                    <Localized id="restaurant-menu-editor-hint-required-multi" vars={{ min: group.minSelections, max: group.maxSelections }}>
                                      <span>{`Required — customer must select between ${group.minSelections} and ${group.maxSelections} choices`}</span>
                                    </Localized>
                                  </span>
                                )}
                              </div>

                              <div className="restaurant-menu-editor-options-list">
                                {group.options.map((opt, oIdx) => (
                                  <div key={opt.id} className="restaurant-menu-editor-option-row">
                                    <input
                                      type="text"
                                      className="restaurant-menu-editor-option-name-input"
                                      value={opt.name}
                                      placeholder={l10n.getString(
                                        'restaurant-menu-editor-option-name-placeholder',
                                      )}
                                      onChange={(e) =>
                                        handleUpdateModifierOption(group.id, opt.id, {
                                          name: e.target.value,
                                        })
                                      }
                                      data-testid={`modifier-option-name-${gIdx}-${oIdx}`}
                                    />
                                    <div className="restaurant-menu-editor-option-price-box">
                                      <span className="restaurant-menu-editor-option-currency">
                                        + {currency}
                                      </span>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        className="restaurant-menu-editor-option-price-input"
                                        value={formatMinorForInput(opt.priceMinor)}
                                        placeholder="0"
                                        onChange={(e) => {
                                          const minor = parsePriceToMinor(e.target.value, currency);
                                          handleUpdateModifierOption(group.id, opt.id, {
                                            priceMinor: minor ?? 0,
                                          });
                                        }}
                                        data-testid={`modifier-option-price-${gIdx}-${oIdx}`}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      className="restaurant-menu-editor-btn-icon-subtle"
                                      onClick={() => handleRemoveModifierOption(group.id, opt.id)}
                                      aria-label="Remove Option"
                                      data-testid={`modifier-option-remove-${gIdx}-${oIdx}`}
                                    >
                                      <TrashGlyph />
                                    </button>
                                  </div>
                                ))}

                                <button
                                  type="button"
                                  className="restaurant-menu-editor-btn-add-opt"
                                  onClick={() => handleAddModifierOption(group.id)}
                                  data-testid={`modifier-option-add-${gIdx}`}
                                >
                                  + <Localized id="restaurant-menu-editor-add-option">Add Option</Localized>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

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
                      <button
                        type="submit"
                        className="btn btn--primary btn--sm"
                        disabled={saving || !draft.name.trim()}
                        aria-busy={saving || undefined}
                      >
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

                {/* ── Item Cards List ── */}
                {processedItems.length === 0 && !draft ? (
                  <div className="restaurant-menu-editor-empty-state">
                    {searchQuery ? (
                      <>
                        <p className="restaurant-menu-editor-empty">
                          <Localized id="restaurant-menu-editor-no-match">
                            <span>No items match your search.</span>
                          </Localized>
                        </p>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => setSearchQuery('')}
                        >
                          <Localized id="restaurant-menu-editor-clear-search">
                            <span>Clear search</span>
                          </Localized>
                        </button>
                      </>
                    ) : (
                      <p className="restaurant-menu-editor-empty">
                        <Localized id="restaurant-menu-editor-empty">
                          <span>No items in this category yet.</span>
                        </Localized>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="restaurant-menu-editor-item-grid">
                    {processedItems.map((p) => {
                      const isActive = p.is_active !== false;
                      const modGroups = parseDraftModifierGroups(p.notes);
                      return (
                        <div
                          key={p.sku}
                          className={`restaurant-menu-editor-card${isActive ? '' : ' restaurant-menu-editor-card--hidden'}`}
                          data-testid={`menu-item-card-${p.sku}`}
                        >
                          {/* Card Main Body */}
                          <button
                            type="button"
                            className="restaurant-menu-editor-card-body"
                            onClick={() => beginEdit(p)}
                            aria-label={l10n.getString('restaurant-menu-editor-edit-item-aria', { name: p.name })}
                          >
                            <div className="restaurant-menu-editor-card-header">
                              <span className="restaurant-menu-editor-card-name">{p.name}</span>
                              <span className="restaurant-menu-editor-card-price">
                                {formatMoney({ minor_units: p.price.minor_units, currency: p.price.currency })}
                              </span>
                            </div>

                            <div className="restaurant-menu-editor-card-meta">
                              {p.category && (
                                <span className="restaurant-menu-editor-badge-cat">
                                  {p.category}
                                </span>
                              )}
                              {modGroups.length > 0 && (
                                <span className="restaurant-menu-editor-badge-modifiers">
                                  {l10n.getString('restaurant-menu-editor-modifiers-badge', {
                                    count: modGroups.length,
                                  })}
                                </span>
                              )}
                              <span className="restaurant-menu-editor-badge-sku">{p.sku}</span>
                            </div>

                            {p.notes && !p.notes.startsWith('[') && (
                              <div className="restaurant-menu-editor-card-notes">
                                <NoteGlyph />
                                <span>{p.notes}</span>
                              </div>
                            )}
                          </button>

                          {/* Card Action Footer */}
                          <div className="restaurant-menu-editor-card-footer">
                            {/* Quick Availability Toggle */}
                            <button
                              type="button"
                              className="restaurant-menu-editor-toggle-btn"
                              onClick={() => handleToggleItemAvailability(p)}
                              aria-label={l10n.getString('restaurant-menu-editor-toggle-availability-aria', { name: p.name })}
                            >
                              <span
                                className={`restaurant-menu-editor-status-dot${isActive ? ' restaurant-menu-editor-status-dot--active' : ' restaurant-menu-editor-status-dot--hidden'}`}
                              />
                              {isActive ? (
                                <Localized id="restaurant-menu-editor-status-available">Available</Localized>
                              ) : (
                                <Localized id="restaurant-menu-editor-status-hidden">Hidden (86)</Localized>
                              )}
                            </button>

                            <div className="restaurant-menu-editor-card-actions">
                              <button
                                type="button"
                                className="restaurant-menu-editor-card-btn restaurant-menu-editor-card-btn--duplicate"
                                onClick={() => handleDuplicateItem(p)}
                                aria-label={l10n.getString('restaurant-menu-editor-duplicate-item-aria', { name: p.name })}
                                data-testid={`restaurant-menu-editor-dup-${p.sku}`}
                              >
                                <CopyGlyph />
                              </button>
                              <button
                                type="button"
                                className="restaurant-menu-editor-card-btn"
                                onClick={() => beginEdit(p)}
                                aria-label={l10n.getString('restaurant-menu-editor-edit-item-aria', { name: p.name })}
                                data-testid={`restaurant-menu-editor-edit-${p.sku}`}
                              >
                                <EditGlyph />
                              </button>
                              <button
                                type="button"
                                className="restaurant-menu-editor-card-btn restaurant-menu-editor-card-btn--delete"
                                onClick={() => setDeleteItemTarget(p)}
                                aria-label={l10n.getString('restaurant-menu-editor-delete-item-aria', { name: p.name })}
                                data-testid={`restaurant-menu-editor-del-${p.sku}`}
                              >
                                <TrashGlyph />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {/* ── Category Modal (Create / Edit) ────────────────────── */}
      {categoryModal && (
        <div
          className="restaurant-menu-editor-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restaurant-menu-editor-cat-modal-title"
        >
          <div className="restaurant-menu-editor-modal-card">
            <h3 id="restaurant-menu-editor-cat-modal-title" className="restaurant-menu-editor-modal-title">
              {categoryModal.id ? (
                <Localized id="restaurant-menu-editor-edit-category">Edit Category</Localized>
              ) : (
                <Localized id="restaurant-menu-editor-create-category">New Category</Localized>
              )}
            </h3>

            <div className="restaurant-menu-editor-modal-body">
              <label htmlFor="restaurant-menu-editor-cat-name" className="restaurant-menu-editor-field">
                <Localized id="restaurant-menu-editor-field-name">Name</Localized>
                <input
                  id="restaurant-menu-editor-cat-name"
                  type="text"
                  value={categoryModal.name}
                  required
                  placeholder={l10n.getString('restaurant-menu-editor-new-category')}
                  onChange={(e) => setCategoryModal({ ...categoryModal, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveCategory();
                  }}
                  data-testid="restaurant-menu-editor-cat-input-name"
                />
              </label>

              {/* Icon Picker */}
              <div className="restaurant-menu-editor-picker-section">
                <span className="restaurant-menu-editor-picker-label">
                  <Localized id="categories-icon-picker-aria">Pick an icon</Localized>
                </span>
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
                      ref={(el) => {
                        iconRadioRefs.current[opt.id] = el;
                      }}
                      tabIndex={categoryModal.icon === opt.id ? 0 : -1}
                      aria-checked={categoryModal.icon === opt.id}
                      aria-label={l10n.getString(categoryIconLabelId(opt.id))}
                      className={
                        categoryModal.icon === opt.id
                          ? 'restaurant-menu-editor-icon-btn restaurant-menu-editor-icon-btn--selected'
                          : 'restaurant-menu-editor-icon-btn'
                      }
                      style={
                        categoryModal.icon === opt.id ? { borderColor: categoryModal.colour } : undefined
                      }
                      onClick={() => setCategoryModal({ ...categoryModal, icon: opt.id })}
                      onKeyDown={(e) => {
                        const next = nextRadioValue(CATEGORY_ICON_IDS, categoryModal.icon, e.key);
                        if (next === null) return;
                        e.preventDefault();
                        setCategoryModal({ ...categoryModal, icon: next });
                        iconRadioRefs.current[next]?.focus();
                      }}
                      data-testid={`restaurant-menu-editor-icon-${opt.id}`}
                    >
                      <CategoryIconSvg icon={opt.id} size={20} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Colour Palette Swatches */}
              <div className="restaurant-menu-editor-picker-section">
                <span className="restaurant-menu-editor-picker-label">
                  <Localized id="categories-colour-picker-aria">Pick a colour</Localized>
                </span>
                <div className="restaurant-menu-editor-color-picker">
                  {CATEGORY_COLOURS.map((col) => (
                    <button
                      key={col}
                      type="button"
                      className={`restaurant-menu-editor-color-swatch${categoryModal.colour === col ? ' restaurant-menu-editor-color-swatch--selected' : ''}`}
                      style={{ backgroundColor: col }}
                      aria-label={col}
                      onClick={() => setCategoryModal({ ...categoryModal, colour: col })}
                      data-testid={`restaurant-menu-editor-color-${col}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="restaurant-menu-editor-modal-actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={categorySaving || !categoryModal.name.trim()}
                onClick={handleSaveCategory}
                data-testid="restaurant-menu-editor-cat-save"
              >
                <Localized id="save">Save</Localized>
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => setCategoryModal(null)}
              >
                <Localized id="cancel">Cancel</Localized>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unsaved Changes Confirmation Dialog ─────────────── */}
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

      {/* ── Delete Item Confirmation Dialog ───────────────────── */}
      <ConfirmDialog
        open={Boolean(deleteItemTarget)}
        title={l10n.getString('restaurant-menu-editor-delete-item-title') || 'Delete Menu Item'}
        confirmLabel={l10n.getString('delete') || 'Delete'}
        message={
          deleteItemTarget
            ? l10n.getString('restaurant-menu-editor-delete-item-confirm', { name: deleteItemTarget.name }) ||
              `Are you sure you want to delete "${deleteItemTarget.name}"?`
            : ''
        }
        variant="danger"
        onCancel={() => setDeleteItemTarget(null)}
        onConfirm={() => {
          if (deleteItemTarget) {
            const sku = deleteItemTarget.sku;
            setDeleteItemTarget(null);
            void handleDeleteItem(sku);
          }
        }}
      />

      {/* ── Delete Category Confirmation Dialog ───────────────── */}
      <ConfirmDialog
        open={Boolean(deleteCategoryTarget)}
        title={l10n.getString('restaurant-menu-editor-delete-category-title') || 'Delete Category'}
        confirmLabel={l10n.getString('delete') || 'Delete'}
        message={
          deleteCategoryTarget
            ? l10n.getString('restaurant-menu-editor-delete-category-confirm', { name: deleteCategoryTarget.name }) ||
              `Are you sure you want to delete category "${deleteCategoryTarget.name}"?`
            : ''
        }
        variant="danger"
        onCancel={() => setDeleteCategoryTarget(null)}
        onConfirm={() => {
          if (deleteCategoryTarget) {
            const cat = deleteCategoryTarget;
            setDeleteCategoryTarget(null);
            void handleDeleteCategory(cat);
          }
        }}
      />
    </div>
  );
}
