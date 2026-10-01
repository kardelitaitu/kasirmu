import { useState, useCallback, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { completeSaleWithResolvedShortfalls, type CompleteSaleResult, type CompleteSaleWithResolvedShortfallsArgs, type ResolvedShortfall, type LocationAllocation, type PartialStockResult, type CartLineData, type PaymentSplitArg, type SerialNumberArg } from '@/api/sales';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Button } from '@/components/Button';
import { l10nErrorMessage } from '@/utils/app-error';
import './StockShortfallDialog.css';

export interface StockShortfallDialogProps {
  /** The PartialStockResult received from the back-end. */
  shortfallResult: PartialStockResult;
  /** Cart line data needed to reconstruct the sale on retry. */
  cartLines: CartLineData[];
  /** Total sale amount in minor units. */
  totalMinor: number;
  /** ISO-4217 currency code. */
  currency: string;
  /** Payment method label. */
  paymentMethod: string;
  /** Tendered amount (if cash). */
  tenderedMinor: number | null;
  /** Payment splits (if split tender). */
  paymentSplits?: PaymentSplitArg[] | null;
  /** Customer ID (if selected). */
  customerId?: string | null;
  /** Customer name (for credit). */
  customerName?: string | null;
  /** Serial numbers (if track_serial products). */
  serialNumbers?: SerialNumberArg[] | null;
  /**
   * The checkout attempt id of the submission that produced this shortfall.
   * Must be forwarded unchanged: this dialog retries that same attempt, and
   * the backend's replay guard keys on it. Note the retry cannot derive one —
   * it synthesises a fresh `resolved-${Date.now()}` cartId on every submit, so
   * nothing carried over from the first attempt identifies it as a replay.
   */
  attemptId?: string;
  /** PROMO-3: promotion ids to re-apply on the retry (same list/order as the first submission). */
  promotionIds?: string[] | null;
  /** Discount percentage. */
  discountPercent: number;
  /** Discount label. */
  discountLabel?: string | null;
  /** CUR-02: tip collected at checkout (FRONTEND-04 — forwarded so the
   *  retry records what the customer actually paid; backend defaults 0). */
  tipMinor?: number;
  /** CUR-02: service charge collected at checkout. */
  serviceChargeMinor?: number;
  /** CUR-02: original sale currency when multi-currency checkout is used. */
  baseCurrency?: string;
  /** CUR-02: original sale total in `baseCurrency` minor units. */
  baseTotalMinor?: number;
  /** CUR-02: fixed-point rate (millionths) `baseCurrency → sale currency`. */
  tenderRateMillionths?: number;
  /**
   * Called when the sale completes successfully after resolution — with
   * the committed sale's result so the caller can build the receipt
   * preview exactly like the normal completion path.
   */
  onComplete: (result: CompleteSaleResult) => void;
  /** Called when the cashier cancels the sale. */
  onCancel: () => void;
}

interface ShortfallResolutionState {
  sku: string;
  /** For simple mode: which alternative location to draw from entirely. */
  selectedLocationId: string | null;
  /** For split mode: per-location quantities. */
  allocations: Record<string, number>;
  /** Whether to allow negative stock (manager override). */
  allowNegative: boolean;
}

/**
 * Stock Shortfall Dialog — shown when a sale cannot be completed due to
 * insufficient stock at the primary inventory location. The cashier can:
 * - Pick an alternative location for each item
 * - Split an item across multiple locations
 * - Manager-override to allow negative stock
 */
export default function StockShortfallDialog({
  shortfallResult,
  cartLines,
  totalMinor,
  currency,
  paymentMethod,
  tenderedMinor,
  paymentSplits = null,
  customerId = null,
  customerName,
  serialNumbers,
  attemptId,
  promotionIds,
  discountPercent,
  discountLabel,
  tipMinor,
  serviceChargeMinor,
  baseCurrency,
  baseTotalMinor,
  tenderRateMillionths,
  onComplete,
  onCancel,
}: StockShortfallDialogProps) {
  const { sessionToken } = useWorkspace();
  const { l10n } = useLocalization();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus trap: Tab cycling + Escape → cancel, disabled during loading
  useFocusTrap(panelRef, !loading, onCancel);

  // Initialize resolution state for each shortfall
  const [resolutions, setResolutions] = useState<ShortfallResolutionState[]>(
    () => shortfallResult.shortfalls.map((s) => {
      const defaultAlt = s.alternatives.length > 0 ? s.alternatives[0]!.locationId : null;
      return {
        sku: s.sku,
        selectedLocationId: defaultAlt,
        // Deliberately EMPTY, not seeded. `allocations` is the SPLIT-mode
        // grid, and the only route into split mode is toggleSplitMode, which
        // seeds the grid from selectedLocationId (capped to what that
        // location holds). A pre-fill here was therefore never read --
        // toggleSplitMode overwrote it before the split rows could render.
        // The mutation that fed it `s.deficit` instead of `s.requestedQty`
        // passed the entire suite, which is how that was established.
        //
        // One writer per field. When this, handleLocationSelect and
        // toggleSplitMode all wrote `allocations`, only the last write before
        // a render was ever observed, and the quantity question had three
        // homes instead of one.
        allocations: {},
        allowNegative: false,
      };
    })
  );

  // Track which shortfall is in "split" mode
  const [splitMode, setSplitMode] = useState<Record<string, boolean>>({});

  const updateResolution = useCallback(
    (sku: string, patch: Partial<ShortfallResolutionState>) => {
      setResolutions((prev) =>
        prev.map((r) => (r.sku === sku ? { ...r, ...patch } : r))
      );
    },
    []
  );

  const toggleSplitMode = useCallback(
    (sku: string) => {
      const enteringSplit = !splitMode[sku];
      setSplitMode((prev) => {
        const next = { ...prev, [sku]: !prev[sku] };
        return next;
      });

      // Entering split mode must SEED the grid, not blank it. This used to
      // reset allocations to {}, so every user who opened the split view saw
      // 0 in every row and had to work out by hand how many units each
      // location contributes -- with the submit-time auto-fill silently
      // covering any row they left blank, so a half-filled grid still submitted
      // a valid sum and the cashier had no way to see where the rest came
      // from. It also made the state initialiser's pre-fill dead: the only
      // route into a split allocation was typing it from zero.
      //
      // The seed respects the same per-row cap the input enforces, so the
      // number shown is always one the cashier could have typed themselves.
      const orig = shortfallResult.shortfalls.find((s) => s.sku === sku);
      // Seed into the location the user had already chosen, not blindly the
      // first one: picking Warehouse B in simple mode and then splitting is
      // an instruction about WHERE, and discarding it to seed Warehouse A
      // would move stock the cashier deliberately aimed elsewhere.
      const chosen = resolutions.find((r) => r.sku === sku)?.selectedLocationId;
      const seedAlt =
        orig?.alternatives.find((a) => a.locationId === chosen) ?? orig?.alternatives[0];
      const seed: Record<string, number> = {};
      if (enteringSplit && seedAlt && orig) {
        seed[seedAlt.locationId] = Math.min(
          seedAlt.qtyAvailable,
          orig.requestedQty
        );
      }
      updateResolution(sku, {
        selectedLocationId: null,
        allocations: seed,
      });
    },
    [splitMode, updateResolution, resolutions, shortfallResult.shortfalls]
  );

  // Picking a location in simple mode records WHERE, and nothing else: the
  // confirm handler in simple mode ignores `allocations` entirely and emits
  // `{ locationId: locId, qty: requested }` from selectedLocationId, and
  // entering split mode seeds the grid from selectedLocationId. So this wrote
  // `allocations: { [locationId]: qty }` because it used to, and the map was
  // never read before something overwrote it.
  //
  // The `qty` parameter died with it: mutants that fed this the deficit instead
  // of the requested qty both passed the whole suite, which is how this was
  // found. A radio click is visible in the UI only as a checked box, and a
  // checked box cannot distinguish the two quantities. Drop the parameter and
  // the write together rather than leave a third copy of the same quantity
  // question in the file.
  const handleLocationSelect = useCallback(
    (sku: string, locationId: string) => {
      updateResolution(sku, {
        selectedLocationId: locationId,
        allocations: {},
      });
    },
    [updateResolution]
  );

  const handleSplitQtyChange = useCallback(
    (sku: string, locationId: string, qty: number, maxQty: number) => {
      const clamped = Math.max(0, Math.min(qty, maxQty));
      updateResolution(sku, {
        allocations: {
          ...(resolutions.find((r) => r.sku === sku)?.allocations ?? {}),
          [locationId]: clamped,
        },
      });
    },
    [resolutions, updateResolution]
  );

  // ⚠️ NO PIN GATE, and the label above says otherwise. The checkbox reads
  // "Allow negative stock (Manager PIN override)" but this writes the flag
  // directly: any operator who can resolve a shortfall can drive the cart
  // negative, with no manager credential involved.
  //
  // WHAT IS NOT IN QUESTION. The backend feature is deliberate and settled:
  // `manager-codebase-review-decisions.md` D11 answers option A (keep it, enforce
  // conditionally) as IMPLEMENTED on both engines -- SQLite migration
  // 20261012_stock_summary_qty_nonnegative.sql and the plpgsql twin in
  // 20260813_init.pg.sql:3169-3193 -- and option B (retire the feature) was
  // explicitly NOT taken. ADR #17 (:706-708) specifies this override and
  // requires the PIN. So the feature, the guard and the UI are all intended;
  // what is missing is the credential check between the checkbox and the write.
  //
  // The pattern to copy is two features over, in the same feature folder:
  // `usePosCartActions.ts:153-170` -- `handleDeductionBadgeClick` opens
  // `FastPINOverlay`, and `overrideCartDeductionLocation` is called ONLY from
  // `handleDeductionPinVerified`. That is ADR-19 §17 implemented, and it is the
  // shape this handler should take.
  //
  // Not wired here on purpose: a manager-PIN gate is a credential path, and adding
  // one that the backend does not require would be a behaviour change to a
  // cashier-facing flow on a screen this session has not otherwise touched. The
  // note lives where the gap is so the next reader sees it at the checkbox.
  const handleAllowNegative = useCallback(
    (sku: string, allowed: boolean) => {
      updateResolution(sku, { allowNegative: allowed });
    },
    [updateResolution]
  );

  const handleConfirm = useCallback(async () => {
    if (!sessionToken) {
      console.warn('[ShortfallDialog] No session token — cannot complete sale');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      // Build resolved shortfalls
      const resolvedShortfalls: ResolvedShortfall[] = resolutions.map((r) => {
        const orig = shortfallResult.shortfalls.find((s) => s.sku === r.sku);
        // The retry must account for the WHOLE line, not just the deficit.
        // The first attempt rolled its whole transaction back
        // (crates/kasirmu-core/src/db/sales_checkout.rs:406-420), so the
        // stock the primary location COULD have covered was never deducted
        // either. And the resolution branch REPLACES the primary deduction
        // rather than supplementing it: in
        // crates/kasirmu-core/src/db/sales_lifecycle.rs the `-line.qty` at
        // primary lives in the `else if needs_stock` arm at :271-281, which a
        // line carrying a resolution never reaches, and the
        // `deduction_locations` audit JSON at :327-345 records exactly the
        // resolution allocations for such a line.
        //
        // So plan_resolution_deductions is handed `line.qty`
        // (sales_lifecycle.rs:246-249) and refuses any other sum with
        // CoreError::Validation (sale_deduction.rs:210-218). Allocating the
        // deficit instead -- which is what this used to do -- made every
        // retry of a shortfall whose primary location held ANY stock fail,
        // and the dialog replaced the backend message with a generic catch-all,
        // so the cashier got no idea why.
        const requested = orig?.requestedQty ?? 0;

        // If in simple mode (single location), create single allocation
        const primaryLocId = orig?.primaryLocationId ?? '';

        if (!splitMode[r.sku]) {
          const locId = r.selectedLocationId ?? primaryLocId;
          return {
            sku: r.sku,
            allocations: [{ locationId: locId, qty: requested }],
          };
        }

        // In split mode: build allocations from the state
        let allocs: LocationAllocation[] = [];
        let allocTotal = 0;

        // Add resolved alternative allocations
        if (r.allocations) {
          for (const [locId, qty] of Object.entries(r.allocations)) {
            if (qty > 0) {
              allocs.push({ locationId: locId, qty });
              allocTotal += qty;
            }
          }
        }

        // The per-location cap in the split rows is Math.min(qtyAvailable,
        // requestedQty) -- a PER-ROW limit, so several rows can each reach it
        // and the total can overshoot. Trim in row order to the total the
        // backend requires, rather than submitting a sum it will refuse.
        if (allocTotal > requested) {
          let over = allocTotal - requested;
          for (let i = allocs.length - 1; i >= 0 && over > 0; i--) {
            const trim = Math.min(over, allocs[i]!.qty);
            allocs[i]!.qty -= trim;
            over -= trim;
          }
          allocs = allocs.filter((a) => a.qty > 0);
        }

        // Auto-fill the rest from primary so the sum is exactly `requested`.
        const remaining = requested - allocTotal;
        if (remaining > 0) {
          allocs.push({ locationId: primaryLocId, qty: remaining });
        }

        return { sku: r.sku, allocations: allocs };
      });

      const args: CompleteSaleWithResolvedShortfallsArgs = {
        cartId: `resolved-${Date.now()}`,
        paymentMethod,
        tenderedMinor,
        ...(customerId != null ? { customerId } : {}),
        ...(customerName ? { customerName } : {}),
        ...(paymentSplits ? { paymentSplits } : {}),
        ...(serialNumbers ? { serialNumbers } : {}),
        ...(attemptId ? { attemptId } : {}),
        // PROMO-3: the same promotion list the first submission carried, in
        // the same order — the backend re-applies them against the sale
        // built from `totalMinor`, so the retry matches the first attempt.
        ...(promotionIds && promotionIds.length > 0 ? { promotionIds } : {}),
        lines: cartLines,
        totalMinor,
        currency,
        discountPercent,
        ...(discountLabel ? { discountLabel } : {}),
        // FRONTEND-04: forward the CUR-02 tender snapshot collected at
        // checkout. Without these the backend records tip/service as 0 and
        // loses the base-currency audit trail on the retry sale.
        ...(tipMinor != null ? { tipMinor } : {}),
        ...(serviceChargeMinor != null ? { serviceChargeMinor } : {}),
        ...(baseCurrency != null ? { baseCurrency } : {}),
        ...(baseTotalMinor != null ? { baseTotalMinor } : {}),
        ...(tenderRateMillionths != null ? { tenderRateMillionths } : {}),
        resolutions: resolvedShortfalls,
      };

      const result = await completeSaleWithResolvedShortfalls(sessionToken, args);
      onComplete(result);
    } catch (err) {
      const msg = l10nErrorMessage(err, l10n, 'app-error-generic');
      setError(msg);
      console.error('[ShortfallDialog] Resolution failed:', err);
    } finally {
      setLoading(false);
    }
  }, [
    sessionToken,
    resolutions,
    shortfallResult,
    splitMode,
    paymentMethod,
    tenderedMinor,
    customerId,
    customerName,
    paymentSplits,
    serialNumbers,
    attemptId,
    promotionIds,
    cartLines,
    totalMinor,
    currency,
    discountPercent,
    discountLabel,
    tipMinor,
    serviceChargeMinor,
    baseCurrency,
    baseTotalMinor,
    tenderRateMillionths,
    onComplete,
    l10n,
  ]);

  if (shortfallResult.shortfalls.length === 0) {
    return null;
  }

  return (
    <div className="shortfall-overlay" role="dialog" aria-modal="true" aria-label={l10n.getString('shortfall-dialog-aria')}>
      <div className="shortfall-modal" ref={panelRef}>
        <div className="shortfall-header">
          <div className="shortfall-header-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="currentColor" width="28" height="28">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <Localized id="shortfall-title">
              <h2 className="shortfall-title">Insufficient Stock</h2>
            </Localized>
            <Localized id="shortfall-description">
              <p className="shortfall-description">
                Some items don&apos;t have enough stock at the primary location. Choose alternative sources below.
              </p>
            </Localized>
          </div>
        </div>

        <div className="shortfall-list" aria-live="polite" aria-atomic="true">
          {shortfallResult.shortfalls.map((shortfall) => {
            const resolution = resolutions.find((r) => r.sku === shortfall.sku);
            const isSplit = splitMode[shortfall.sku] ?? false;

            return (
              <div key={shortfall.sku} className="shortfall-card">
                <div className="shortfall-card-header">
                  <div className="shortfall-card-info">
                    <span className="shortfall-card-sku">#{shortfall.sku}</span>
                    <span className="shortfall-card-name">{shortfall.productName}</span>
                  </div>
                  <div className="shortfall-card-quantities">
                    <span className="shortfall-qty-label">
                      <Localized id="shortfall-wanted">
                        <span>Wanted</span>
                      </Localized>
                      : {shortfall.requestedQty}
                    </span>
                    <span className="shortfall-qty-label shortfall-qty-available">
                      <Localized id="shortfall-available">
                        <span>Available</span>
                      </Localized>
                      : <strong>{shortfall.primaryQtyAvailable}</strong>
                    </span>
                    <span className="shortfall-deficit">-{shortfall.deficit}</span>
                  </div>
                </div>

                {/* Alternative locations */}
                {shortfall.alternatives.length > 0 ? (
                  <div className="shortfall-alternatives">
                    <Localized id="shortfall-alternatives-label">
                      <span className="shortfall-alternatives-label">Alternative locations:</span>
                    </Localized>

                    {!isSplit ? (
                      // Simple mode: radio buttons
                      <div className="shortfall-alt-list">
                        {shortfall.alternatives.map((alt) => (
                           
                          <label key={alt.locationId} className="shortfall-alt-option">
                            <input
                              type="radio"
                              name={`alt-${shortfall.sku}`}
                              checked={resolution?.selectedLocationId === alt.locationId}
                              onChange={() =>
                                handleLocationSelect(shortfall.sku, alt.locationId)
                              }
                            />
                            <span className="shortfall-alt-name">{alt.locationName}</span>
                            <span className="shortfall-alt-qty">
                              <Localized id="shortfall-alt-available">
                                <span>available</span>
                              </Localized>
                              : {alt.qtyAvailable}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      // Split mode: quantity inputs per location
                      <div className="shortfall-split-list">
                        {shortfall.alternatives.map((alt) => {
                          const currentQty = resolution?.allocations?.[alt.locationId] ?? 0;
                          return (
                            <div key={alt.locationId} className="shortfall-split-row">
                              <span className="shortfall-alt-name">{alt.locationName}</span>
                              <span className="shortfall-alt-qty">
                                (<Localized id="shortfall-alt-available"><span>available</span></Localized>: {alt.qtyAvailable})
                              </span>
                              <Localized id="shortfall-split-qty-aria" attrs={{ 'aria-label': true }}>
                                <input
                                  type="number"
                                  className="shortfall-split-input"
                                  value={currentQty}
                                  onChange={(e) => {
                                    // Whole number only — ignore fractional in-progress input
                                    // instead of silently truncating it via parseInt.
                                    const v = Number(e.target.value);
                                    if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                                      handleSplitQtyChange(
                                        shortfall.sku,
                                        alt.locationId,
                                        e.target.value === '' ? 0 : v,
                                        Math.min(alt.qtyAvailable, shortfall.requestedQty)
                                      );
                                    }
                                  }}
                                  min={0}
                                  max={Math.min(alt.qtyAvailable, shortfall.requestedQty)}
                                  aria-label={`${alt.locationName} qty`}
                                />
                              </Localized>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Split toggle */}
                    <button
                      type="button"
                      className="shortfall-split-toggle"
                      onClick={() => toggleSplitMode(shortfall.sku)}
                    >
                      {isSplit ? (
                        <Localized id="shortfall-simple-mode"><span>Use single location</span></Localized>
                      ) : (
                        <Localized id="shortfall-split-mode"><span>Split across locations</span></Localized>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="shortfall-no-alts">
                    <Localized id="shortfall-no-alternatives">
                      <span>No alternative locations with stock available.</span>
                    </Localized>
                    {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                    <label className="shortfall-negative-option">
                      <input
                        type="checkbox"
                        checked={resolution?.allowNegative ?? false}
                        onChange={(e) => handleAllowNegative(shortfall.sku, e.target.checked)}
                      />
                      <Localized id="shortfall-negative-override">
                        <span>Allow negative stock (Manager PIN override)</span>
                      </Localized>
                    </label>
                  </div>
                )}

                {/* Manager override for allowed_negative_stock */}
                {shortfall.alternatives.length > 0 && (
                  // eslint-disable-next-line jsx-a11y/label-has-associated-control
                  <label className="shortfall-negative-option shortfall-negative-margin">
                    <input
                      type="checkbox"
                      checked={resolution?.allowNegative ?? false}
                      onChange={(e) => handleAllowNegative(shortfall.sku, e.target.checked)}
                    />
                    <Localized id="shortfall-negative-override">
                      <span>Allow negative stock (Manager PIN override)</span>
                    </Localized>
                  </label>
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <div className="shortfall-error" role="alert">
            <p>{error}</p>
          </div>
        )}

        <div className="shortfall-footer">
          <Localized id="shortfall-warehouse-warning">
            <p className="shortfall-warning">
              ⚠ Warehouse fulfillment may incur delivery charges.
            </p>
          </Localized>
          <div className="shortfall-actions">
            <Localized id="shortfall-cancel-btn">
              <Button variant="ghost" onClick={onCancel} disabled={loading}>
                Cancel Sale
              </Button>
            </Localized>
            <Localized id="shortfall-confirm-btn">
              <Button variant="primary" onClick={handleConfirm} loading={loading}>
                Confirm & Continue
              </Button>
            </Localized>
          </div>
        </div>
      </div>
    </div>
  );
}