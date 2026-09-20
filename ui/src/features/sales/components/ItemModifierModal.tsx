import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { formatMoney } from '@/types/domain';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { requiredLocalized } from '@/components';
import { animDuration } from '@/utils/animation';
import './ItemModifierModal.css';

// ── Types ─────────────────────────────────────────────────────────────

/** A modifier group (e.g. "Side Dish", "Doneness"). */
export interface ModifierGroup {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  modifiers: ModifierOption[];
}

/** A single modifier option within a group (e.g. "Fries", "Salad"). */
export interface ModifierOption {
  id: string;
  name: string;
  priceMinor: number;
  sortOrder: number;
  isDefault: boolean;
}

/** A selected modifier with its computed price impact. */
export interface ModifierSelection {
  groupId: string;
  groupName: string;
  modifierId: string;
  modifierName: string;
  priceMinor: number;
}

/** Props for the ItemModifierModal component. */
export interface ItemModifierModalProps {
  open: boolean;
  /** Display name of the product. */
  productName: string;
  /** Base unit price of the product (minor units). */
  basePriceMinor: number;
  /** Currency code (e.g. "USD", "IDR"). */
  currency: string;
  /** Available modifier groups with their options. */
  groups: ModifierGroup[];
  /** Called when the user confirms their selections. */
  onConfirm: (selections: ModifierSelection[], totalPriceMinor: number) => void;
  /** Called when the modal is dismissed without confirming. */
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Compute the total surcharge from a set of modifier selections. */
function computeSurcharge(selections: ModifierSelection[]): number {
  return selections.reduce((sum, s) => sum + s.priceMinor, 0);
}

/** Check whether a group's selection count is within valid bounds. */
function isGroupValid(
  group: ModifierGroup,
  selections: ModifierSelection[],
): boolean {
  const count = selections.filter((s) => s.groupId === group.id).length;
  return count >= group.minSelections && count <= group.maxSelections;
}

/**
 * ItemModifierModal — modal for customising a menu item with modifiers.
 *
 * Enforces per-group min/max selection limits. Shows a live price
 * summary including the base price plus all modifier surcharges.
 */
export default function ItemModifierModal({
  open,
  productName,
  basePriceMinor,
  currency,
  groups,
  onConfirm,
  onClose,
}: ItemModifierModalProps) {
  const { l10n } = useLocalization();

  // ── State: selected modifiers by group ──────────────────────────
  // Key: groupId, Value: set of modifierIds selected in that group.
  const [selected, setSelected] = useState<Record<string, Set<string>>>(() => {
    const initial: Record<string, Set<string>> = {};
    for (const group of groups) {
      const defaults = group.modifiers
        .filter((m) => m.isDefault)
        .map((m) => m.id);
      initial[group.id] = new Set(defaults);
    }
    return initial;
  });

  // ── Derived: full selection list with computed prices ──────────
  const selections = useMemo<ModifierSelection[]>(() => {
    const result: ModifierSelection[] = [];
    for (const group of groups) {
      const selectedIds = selected[group.id] ?? new Set<string>();
      for (const modifier of group.modifiers) {
        if (selectedIds.has(modifier.id)) {
          result.push({
            groupId: group.id,
            groupName: group.name,
            modifierId: modifier.id,
            modifierName: modifier.name,
            priceMinor: modifier.priceMinor,
          });
        }
      }
    }
    return result;
  }, [groups, selected]);

  const totalSurcharge = useMemo(() => computeSurcharge(selections), [selections]);
  const totalPriceMinor = basePriceMinor + totalSurcharge;

  // ── Validation ──────────────────────────────────────────────────
  const allGroupsValid = useMemo(
    () => groups.every((g) => isGroupValid(g, selections)),
    [groups, selections],
  );

  // ── Handlers ────────────────────────────────────────────────────
  const toggleModifier = useCallback(
    (groupId: string, modifierId: string) => {
      setSelected((prev) => {
        const group = groups.find((g) => g.id === groupId);
        if (!group) return prev;

        const current = new Set(prev[groupId] ?? []);
        const wasSelected = current.has(modifierId);

        if (wasSelected) {
          // Allow deselecting only if above minSelections.
          if (current.size <= group.minSelections) return prev;
          current.delete(modifierId);
          return { ...prev, [groupId]: current };
        }

        // ── Single-select (maxSelections === 1): replace ──────────
        // Instead of blocking when at max, clear the current
        // selection and pick the new one. This gives radio-button
        // behaviour: clicking a different option swaps the choice.
        if (group.maxSelections === 1) {
          return { ...prev, [groupId]: new Set([modifierId]) };
        }

        // ── Multi-select: prevent exceeding maxSelections ─────────
        if (current.size >= group.maxSelections) return prev;
        current.add(modifierId);
        return { ...prev, [groupId]: current };
      });
    },
    [groups],
  );

  const handleConfirm = useCallback(() => {
    if (!allGroupsValid) return;
    onConfirm(selections, totalPriceMinor);
  }, [allGroupsValid, selections, totalPriceMinor, onConfirm]);

  // ── Reset on open ───────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      const initial: Record<string, Set<string>> = {};
      for (const group of groups) {
        const defaults = group.modifiers
          .filter((m) => m.isDefault)
          .map((m) => m.id);
        initial[group.id] = new Set(defaults);
      }
      setSelected(initial);
    }
  }, [open, groups]);

  // ── Exit animation (dismiss fade) ─────────────────────────────
  // Mirrors the useExitAnimation shape (WorkspaceSettingsModal /
  // RefundModal) with one deviation required by this modal's test
  // contract: ItemModifierModal.test.tsx asserts onClose fires
  // SYNCHRONOUSLY on Cancel / backdrop / X, while the shared hook
  // defers onClose until after the fade. requestClose() therefore
  // notifies the parent immediately and reproduces the hook's
  // "stay mounted until the fade finishes" half locally via the
  // exiting flag + the render gate below. Reopening during the
  // fade cancels the exit (same semantics as the shared hook).
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reopen during the fade (or a fresh open): cancel any in-flight
  // exit so the modal stays mounted without its --exiting class.
  useEffect(() => {
    if (!open) return;
    if (exitTimerRef.current !== null) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    setExiting(false);
  }, [open]);

  // Unmount cleanup — never setState against an unmounted component.
  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, []);

  const requestClose = useCallback(() => {
    if (exiting) return; // already closing
    setExiting(true);
    // Notify the parent synchronously (see deviation note above);
    // the gate below holds the surface mounted for the fade, and
    // animDuration(300) returns 0 under prefers-reduced-motion so
    // reduced-motion users snap away instantly.
    onClose();
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      setExiting(false);
    }, animDuration(300));
  }, [exiting, onClose]);

  // ── Focus trap (Escape + Tab cycling; suspended while exiting) ─
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open && !exiting, () => requestClose());

  // Render gate: stay mounted while the exit fade plays
  // (shouldRender semantics from the shared hook).
  if (!open && !exiting) return null;

  return (
    <div
      className={`modifier-overlay${exiting ? ' modifier-overlay--exiting' : ''}`}
      role="presentation"
      aria-hidden={!open}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        className={`modifier-modal${exiting ? ' modifier-modal--exiting' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={requiredLocalized(l10n, 'modifier-dialog-aria', { productName })}
        ref={panelRef}
      >
        {/* ── Header ─────────────────────────────────────── */}
        <div className="modifier-header">
          <h2 className="modifier-title">{productName}</h2>
          <button
            type="button"
            className="modifier-close-btn"
            onClick={requestClose}
            aria-label={requiredLocalized(l10n, 'close')}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Body: modifier groups ──────────────────────── */}
        <div className="modifier-body">
          {groups.length === 0 ? (
            <p className="modifier-empty">
              <Localized id="modifier-no-options">
                <span>No customisation options available</span>
              </Localized>
            </p>
          ) : (
            groups.map((group) => {
              const selectedIds = selected[group.id] ?? new Set<string>();
              const selectionCount = selectedIds.size;
              const isValid = isGroupValid(group, selections);
              const isMaxMet = selectionCount >= group.maxSelections;

              return (
                <fieldset key={group.id} className="modifier-group">
                  <legend className="modifier-group-header">
                    <span className="modifier-group-name">{group.name}</span>
                    <span
                      className={`modifier-group-count ${
                        isValid ? 'modifier-group-count--valid' : 'modifier-group-count--invalid'
                      }`}
                    >
                      {group.minSelections === group.maxSelections
                        ? `${group.minSelections} required`
                        : `${selectionCount}/${group.maxSelections}`}
                    </span>
                  </legend>
                  <div
                    className="modifier-options"
                    role="group"
                    aria-label={group.name}
                  >
                    {group.modifiers
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((modifier) => {
                        const isSelected = selectedIds.has(modifier.id);
                        // Single-select: all options are clickable (replaces current selection).
                        // Multi-select: respect max boundaries — disable when at max.
                        const canSelect = group.maxSelections === 1 || !isMaxMet || isSelected;
                        return (
                          <button
                            key={modifier.id}
                            type="button"
                            role="option"
                            data-testid={`modifier-${modifier.id}`}
                            aria-selected={isSelected}
                            className={`modifier-option ${
                              isSelected ? 'modifier-option--selected' : ''
                            } ${!canSelect && !isSelected ? 'modifier-option--disabled' : ''}`}
                            onClick={() => toggleModifier(group.id, modifier.id)}
                            disabled={!isSelected && !canSelect}
                          >
                            <span className="modifier-option-check">
                              {isSelected ? '✓' : ''}
                            </span>
                            <span className="modifier-option-name">
                              {modifier.name}
                            </span>
                            {modifier.priceMinor > 0 && (
                              <span className="modifier-option-price">
                                +{formatMoney({
                                  minor_units: modifier.priceMinor,
                                  currency,
                                })}
                              </span>
                            )}
                            {modifier.priceMinor === 0 && isSelected && (
                              <span className="modifier-option-price modifier-option-price--free">
                                <Localized id="modifier-free">
                                  <span>Free</span>
                                </Localized>
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                </fieldset>
              );
            })
          )}
        </div>

        {/* ── Footer: price summary + confirm ───────────── */}
        <div className="modifier-footer">
          <div className="modifier-price-summary">
            <div className="modifier-price-row">
              <span className="modifier-price-label">
                <Localized id="modifier-base-price">
                  <span>Base price</span>
                </Localized>
              </span>
              <span className="modifier-price-value">
                {formatMoney({ minor_units: basePriceMinor, currency })}
              </span>
            </div>
            {totalSurcharge > 0 && (
              <div className="modifier-price-row">
                <span className="modifier-price-label">
                  <Localized id="modifier-addons">
                    <span>Add-ons</span>
                  </Localized>
                </span>
                <span className="modifier-price-value modifier-price-value--surcharge">
                  +{formatMoney({ minor_units: totalSurcharge, currency })}
                </span>
              </div>
            )}
            <div className="modifier-price-row modifier-price-total">
              <span className="modifier-price-label modifier-price-total-label">
                <Localized id="modifier-total">
                  <span>Total</span>
                </Localized>
              </span>
              <span className="modifier-price-value modifier-price-total-value">
                {formatMoney({ minor_units: totalPriceMinor, currency })}
              </span>
            </div>
          </div>
          <div className="modifier-actions">
            { }
            <button
              type="button"
              className="modifier-cancel-btn"
              onClick={requestClose}
            >
              <Localized id="cancel">
                <span>Cancel</span>
              </Localized>
            </button>
            { }
            <button
              type="button"
              className="modifier-confirm-btn"
              onClick={handleConfirm}
              disabled={!allGroupsValid}
            >
              <Localized id="modifier-add-to-cart">
                <span>Add to Order</span>
              </Localized>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
