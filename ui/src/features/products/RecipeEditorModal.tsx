// ── RecipeEditorModal ─────────────────────────────────────────────
//
// Modal dialog for authoring and editing a restaurant dish's Bill of Materials (BOM)
// recipe. Binds raw ingredients (retail products or materials) to the parent dish,
// establishing the exact quantities deducted at checkout by the deduction engine.
//
// Key invariants:
// - Parent dish cannot be selected as its own ingredient (self-reference guard).
// - No duplicate ingredient lines allowed.
// - Integer positive quantities enforced (quantity_required >= 1).
// - Displays live estimated dish cost (HPP) derived from ingredients' cost_minor.
// - All mutations scoped to active session token.
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { SettingsPopup } from '@/components/SettingsPopup';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { formatMoney } from '@/types/domain';
import {
  getRecipeScoped,
  setRecipeScoped,
  deleteRecipeScoped,
  listProductsScoped,
  type ProductDto,
  type RecipeIngredientInputDto,
} from '@/api/products';
import { l10nErrorMessage } from '@/utils/app-error';
import { asArray } from '@/utils/ipc-payload';
import { invalidateCatalog } from '@/utils/catalog-cache';
import './RecipeEditorModal.css';

export interface RecipeRow {
  id: string;
  ingredientSku: string;
  quantity: number;
  unit: string;
}

const COMMON_UNITS = ['pcs', 'g', 'ml', 'kg', 'l', 'cup', 'tbsp', 'tsp'];

export interface RecipeEditorModalProps {
  open: boolean;
  onClose: () => void;
  productId?: string | undefined;
  productSku: string;
  productName: string;
  sessionToken: string;
  currency?: string;
  onSaved?: () => void;
}

function TrashIcon() {
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

export function RecipeEditorModal({
  open,
  onClose,
  productId,
  productSku,
  productName,
  sessionToken,
  currency = 'IDR',
  onSaved,
}: RecipeEditorModalProps) {
  const { l10n } = useLocalization();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [catalog, setCatalog] = useState<ProductDto[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  // Effective parent product ID (UUID or fallback to SKU)
  const resolvedParentId = useMemo(() => {
    if (productId) return productId;
    const match = catalog.find((p) => p.sku === productSku);
    return match?.id || productSku;
  }, [productId, catalog, productSku]);

  // Load recipe & product catalog when modal opens
  useEffect(() => {
    if (!open || !sessionToken || !productSku) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function loadData() {
      try {
        let parentId = productId;
        let productsList = catalogRef.current;

        // If catalog is not loaded yet, fetch it first
        if (productsList.length === 0) {
          try {
            const fetchedProds = await listProductsScoped(sessionToken);
            if (cancelled) return;
            productsList = asArray<ProductDto>(fetchedProds);
            setCatalog(productsList);
          } catch (catalogErr) {
            if (cancelled) return;
            setError(l10nErrorMessage(catalogErr, l10n, 'restaurant-menu-editor-error-load'));
          }
        }

        // If productId wasn't provided, find it from the loaded catalog
        if (!parentId) {
          const match = productsList.find((p) => p.sku === productSku);
          parentId = match?.id || productSku;
        }

        const recipeRes = await getRecipeScoped(sessionToken, parentId);
        if (cancelled) return;
        const items = asArray(recipeRes);
        if (items.length > 0) {
          setRows(
            items.map((it, idx) => ({
              id: it.id || `row-${idx}-${it.ingredientSku}`,
              ingredientSku: it.ingredientSku,
              quantity: it.quantityRequired,
              unit: it.unit || 'pcs',
            })),
          );
        } else {
          setRows([]);
        }
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [open, sessionToken, productId, productSku, l10n]);

  // Map of products for fast lookup (excluding parent dish)
  const availableIngredients = useMemo(
    () => catalog.filter((p) => p.sku !== productSku),
    [catalog, productSku],
  );

  const catalogMap = useMemo(() => {
    const map = new Map<string, ProductDto>();
    for (const p of catalog) {
      map.set(p.sku, p);
    }
    return map;
  }, [catalog]);

  // Derived estimated cost (HPP)
  const totalCostMinor = useMemo(() => {
    return rows.reduce((sum, r) => {
      if (!r.ingredientSku) return sum;
      const item = catalogMap.get(r.ingredientSku);
      const cost = item?.cost_minor ?? 0;
      return sum + cost * (r.quantity || 0);
    }, 0);
  }, [rows, catalogMap]);

  const handleAddRow = useCallback(() => {
    setError(null);
    setRows((prev) => [
      ...prev,
      {
        id: `row-${Date.now().toString(36)}-${prev.length}`,
        ingredientSku: '',
        quantity: 1,
        unit: 'pcs',
      },
    ]);
  }, []);

  const handleRemoveRow = useCallback((id: string) => {
    setError(null);
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleUpdateRow = useCallback((id: string, patch: Partial<RecipeRow>) => {
    setError(null);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const handleSave = useCallback(async () => {
    if (!sessionToken || !resolvedParentId) return;

    // If no rows, clear recipe
    if (rows.length === 0) {
      try {
        setSaving(true);
        await deleteRecipeScoped(sessionToken, resolvedParentId);
        invalidateCatalog(sessionToken);
        addToast({
          message: l10n.getString('recipe-editor-delete-success'),
          type: 'success',
        });
        onSaved?.();
        onClose();
      } catch (err) {
        setError(l10nErrorMessage(err, l10n, 'restaurant-menu-editor-error-save'));
      } finally {
        setSaving(false);
      }
      return;
    }

    // Validation 1: no empty ingredient SKUs
    const hasEmptySku = rows.some((r) => !r.ingredientSku.trim());
    if (hasEmptySku) {
      setError(l10n.getString('recipe-editor-validation-empty-sku'));
      return;
    }

    // Validation 2: no duplicate ingredients
    const seenSkus = new Set<string>();
    for (const r of rows) {
      const sku = r.ingredientSku.trim();
      if (seenSkus.has(sku)) {
        const dupName = catalogMap.get(sku)?.name || sku;
        setError(l10n.getString('recipe-editor-validation-duplicate', { name: dupName }));
        return;
      }
      seenSkus.add(sku);
    }

    // Validation 3: quantities must be > 0
    const hasInvalidQty = rows.some((r) => !r.quantity || r.quantity <= 0);
    if (hasInvalidQty) {
      setError(l10n.getString('recipe-editor-validation-invalid-qty'));
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const ingredients: RecipeIngredientInputDto[] = rows.map((r) => {
        const ingProd = catalogMap.get(r.ingredientSku.trim());
        return {
          ingredientProductId: ingProd?.id || r.ingredientSku.trim(),
          quantityRequired: Math.max(1, Math.round(r.quantity)),
          unit: r.unit.trim() || 'pcs',
        };
      });

      await setRecipeScoped(sessionToken, {
        parentProductId: resolvedParentId,
        ingredients,
      });

      invalidateCatalog(sessionToken);
      addToast({
        message: l10n.getString('recipe-editor-save-success'),
        type: 'success',
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'restaurant-menu-editor-error-save'));
    } finally {
      setSaving(false);
    }
  }, [sessionToken, resolvedParentId, rows, catalogMap, addToast, l10n, onSaved, onClose]);

  const handleConfirmClear = useCallback(async () => {
    if (!sessionToken || !resolvedParentId) return;
    try {
      setClearing(true);
      await deleteRecipeScoped(sessionToken, resolvedParentId);
      invalidateCatalog(sessionToken);
      setRows([]);
      setShowClearConfirm(false);
      addToast({
        message: l10n.getString('recipe-editor-delete-success'),
        type: 'success',
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'restaurant-menu-editor-error-delete'));
    } finally {
      setClearing(false);
    }
  }, [sessionToken, resolvedParentId, addToast, l10n, onSaved, onClose]);

  return (
    <>
      <SettingsPopup
        open={open}
        onClose={onClose}
        title={l10n.getString('recipe-editor-title')}
        size="lg"
        className="recipe-editor-modal"
        error={error}
        saving={saving}
        onSave={handleSave}
        saveLabel={l10n.getString('save')}
        cancelLabel={l10n.getString('cancel')}
      >
        <div className="recipe-editor-content">
          {/* Dish Header Info */}
          <div className="recipe-editor-dish-card">
            <div className="recipe-editor-dish-meta">
              <span className="recipe-editor-dish-label">
                <Localized id="recipe-editor-dish-label">Dish</Localized>
              </span>
              <h3 className="recipe-editor-dish-name">{productName}</h3>
            </div>
            <div className="recipe-editor-dish-sku-badge">
              <span>SKU: {productSku}</span>
            </div>
          </div>

          {loading ? (
            <div className="recipe-editor-loading" data-testid="recipe-editor-loading">
              <Localized id="recipe-editor-loading">Loading recipe…</Localized>
            </div>
          ) : (
            <div className="recipe-editor-body">
              {rows.length === 0 ? (
                <div className="recipe-editor-empty">
                  <p>
                    <Localized id="recipe-editor-empty-ingredients">
                      No ingredients added yet. Add raw materials or retail products needed to prepare this dish.
                    </Localized>
                  </p>
                </div>
              ) : (
                <div className="recipe-editor-table-wrapper">
                  <table className="recipe-editor-table">
                    <thead>
                      <tr>
                        <th className="recipe-editor-th-ingredient">
                          <Localized id="recipe-editor-col-ingredient">Ingredient</Localized>
                        </th>
                        <th className="recipe-editor-th-qty">
                          <Localized id="recipe-editor-col-qty">Quantity</Localized>
                        </th>
                        <th className="recipe-editor-th-unit">
                          <Localized id="recipe-editor-col-unit">Unit</Localized>
                        </th>
                        <th className="recipe-editor-th-cost">
                          <Localized id="recipe-editor-col-cost">Est. Cost</Localized>
                        </th>
                        <th className="recipe-editor-th-action" aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => {
                        const ing = catalogMap.get(row.ingredientSku);
                        const rowCostMinor = (ing?.cost_minor ?? 0) * (row.quantity || 0);

                        return (
                          <tr key={row.id} data-testid={`recipe-row-${idx}`}>
                            <td className="recipe-editor-td-ingredient">
                              <select
                                className="recipe-editor-select"
                                value={row.ingredientSku}
                                onChange={(e) =>
                                  handleUpdateRow(row.id, { ingredientSku: e.target.value })
                                }
                                data-testid={`recipe-ingredient-select-${idx}`}
                              >
                                <option value="">
                                  {l10n.getString('recipe-editor-select-placeholder')}
                                </option>
                                {availableIngredients.map((p) => (
                                  <option key={p.sku} value={p.sku}>
                                    {p.name} ({p.sku})
                                    {p.cost_minor
                                      ? ` — ${formatMoney({ minor_units: p.cost_minor, currency })}`
                                      : ''}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="recipe-editor-td-qty">
                              <input
                                type="number"
                                min="1"
                                step="1"
                                className="recipe-editor-input-qty"
                                value={row.quantity || ''}
                                onChange={(e) => {
                                  const parsed = parseInt(e.target.value, 10);
                                  handleUpdateRow(row.id, {
                                    quantity: isNaN(parsed) ? 0 : parsed,
                                  });
                                }}
                                data-testid={`recipe-qty-input-${idx}`}
                              />
                            </td>

                            <td className="recipe-editor-td-unit">
                              <input
                                list={`units-list-${row.id}`}
                                type="text"
                                className="recipe-editor-input-unit"
                                value={row.unit}
                                onChange={(e) => handleUpdateRow(row.id, { unit: e.target.value })}
                                data-testid={`recipe-unit-input-${idx}`}
                              />
                              <datalist id={`units-list-${row.id}`}>
                                {COMMON_UNITS.map((u) => (
                                  <option key={u} value={u} />
                                ))}
                              </datalist>
                            </td>

                            <td className="recipe-editor-td-cost">
                              <span className="recipe-editor-cost-val">
                                {formatMoney({ minor_units: rowCostMinor, currency })}
                              </span>
                            </td>

                            <td className="recipe-editor-td-action">
                              <button
                                type="button"
                                className="recipe-editor-btn-remove"
                                onClick={() => handleRemoveRow(row.id)}
                                aria-label="Remove ingredient"
                                data-testid={`recipe-remove-btn-${idx}`}
                              >
                                <TrashIcon />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Action Toolbar & Summary */}
              <div className="recipe-editor-footer-toolbar">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={handleAddRow}
                  data-testid="recipe-add-ingredient-btn"
                >
                  + <Localized id="recipe-editor-add-ingredient">Add Ingredient</Localized>
                </button>

                <div className="recipe-editor-summary-pane">
                  {rows.length > 0 && (
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => setShowClearConfirm(true)}
                      data-testid="recipe-clear-btn"
                    >
                      <Localized id="recipe-editor-delete-btn">Clear Recipe</Localized>
                    </button>
                  )}

                  <div className="recipe-editor-total-box" data-testid="recipe-total-cost-box">
                    <span className="recipe-editor-total-label">
                      <Localized id="recipe-editor-total-cost">Total Estimated Cost (HPP)</Localized>:
                    </span>
                    <strong className="recipe-editor-total-amount">
                      {formatMoney({ minor_units: totalCostMinor, currency })}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </SettingsPopup>

      <ConfirmDialog
        open={showClearConfirm}
        title={l10n.getString('recipe-editor-delete-btn')}
        message={l10n.getString('recipe-editor-delete-confirm', { name: productName })}
        confirmLabel={l10n.getString('recipe-editor-delete-btn')}
        cancelLabel={l10n.getString('cancel')}
        onConfirm={handleConfirmClear}
        onCancel={() => setShowClearConfirm(false)}
        variant="danger"
        loading={clearing}
      />
    </>
  );
}
