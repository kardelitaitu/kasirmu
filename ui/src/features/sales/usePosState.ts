import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { CartLine, CourseId, LineId, ModifierSelection, Money, Product } from '@/types/domain';
import { triggerInteraction } from '@/utils/interaction';

let nextLineId = 0;
const genLineId = (): LineId =>
  `line-${Date.now()}-${nextLineId++}` as LineId;

/**
 * Default service charge percentage applied when the toggle is on.
 * Configurable per-store via Settings; this is the local fallback.
 */
const SERVICE_CHARGE_DEFAULT_PERCENT = 10;

/**
 * POS state hook — manages cart lines, add/remove/qty, discount, tip,
 * service charge, and total.
 *
 * Discount is applied locally (preview) and synced to the backend cart
 * via IPC so it's included in the completed sale. Tip and service charge
 * are local previews for now — the cashier sees the running total adjust
 * in real time. Finalising them on the backend will mirror the discount
 * pattern in a follow-up.
 *
 * @example
 * ```tsx
 * const { lines, total, subtotal, discountPercent, tipPercent,
 *         serviceChargeEnabled, addProduct, setDiscount, setTipPercent,
 *         setServiceCharge, resetCart } = usePosState();
 * ```
 */
export function usePosState() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountLabel, setDiscountLabel] = useState('');
  const [tipPercent, setTipPercentState] = useState(0);
  const [serviceChargeEnabled, setServiceChargeEnabled] = useState(false);
  const [serviceChargePercent, setServiceChargePercentState] = useState<number>(
    SERVICE_CHARGE_DEFAULT_PERCENT,
  );
  // The cart's currency: the currency of the first line added. Read inside
  // the addProduct guard so a mixed-currency product is rejected against
  // the current cart state (refs avoid stale closures over `lines`).
  const cartCurrencyRef = useRef<string | null>(null);

  // Keep the currency ref in sync with the cart (first line's currency).
  // `lines[0]` is the currency anchor; an empty cart resets the anchor so a
  // new cart can start in any currency after a reset/clear.
  useEffect(() => {
    cartCurrencyRef.current = lines.length > 0 ? lines[0]!.unit_price.currency : null;
  }, [lines]);

  /**
   * Add a product to the cart, or increment qty if already present.
   * Category is captured on the cart line so that course chips render
   * without re-querying the product catalogue for every line.
   *
   * **Currency guard:** the POS supports single-currency carts only.
   * If the cart already has lines and the product's currency differs
   * from the first line's currency, the product is NOT added and the
   * function returns `false`. The backend `Cart::add_line` enforces the
   * same rule, so this guard keeps the front-end preview consistent
   * with the IPC boundary.
   *
   * @param product The product to add.
   * @param qty Quantity to add (defaults to 1). Used for bundle expansion.
   * @param meta Optional line attributes to apply to the created/merged
   *   line — used by the retail undo path to restore a removed line's
   *   course assignment and modifiers faithfully instead of re-adding a
   *   bare product.
   * @returns `true` if the product was added, `false` if rejected
   *   (currency mismatch).
   */
  const addProduct = useCallback((product: Product, qty: number = 1, meta?: { courseId?: CourseId; modifiers?: ModifierSelection[] }): boolean => {
    // MONEY-AUDIT-F1: reject mixed-currency carts at the source. The backend
    // `Cart::add_line` enforces single-currency carts, so the front-end
    // preview must not silently sum amounts in different currencies.
    // The cart's currency is the currency of its first line; a product whose
    // currency differs is refused (returns false) instead of being summed
    // under the wrong currency.
    const cartCurrency = cartCurrencyRef.current;
    if (cartCurrency !== null && product.price.currency !== cartCurrency) {
      return false;
    }
    // Anchor the cart currency on the first line synchronously so that
    // back-to-back adds in one event loop (e.g. bundle expansion) are
    // guarded against mixing, not just adds across separate renders.
    if (cartCurrency === null) {
      cartCurrencyRef.current = product.price.currency;
    }
    triggerInteraction('add-to-cart');
    setLines((prev) => {
      const existing = prev.find((l) => l.sku === product.sku);
      const metaSpread =
        meta?.courseId !== undefined || (meta?.modifiers && meta.modifiers.length > 0)
          ? {
              ...(meta?.courseId !== undefined ? { courseId: meta.courseId, coursingStatus: 'hold' as const } : {}),
              ...(meta?.modifiers && meta.modifiers.length > 0 ? { modifiers: meta.modifiers } : {}),
            }
          : {};
      if (existing) {
        return prev.map((l) =>
          l.id === existing.id ? { ...l, qty: l.qty + qty, ...metaSpread } : l,
        );
      }
      return [
        ...prev,
        {
          id: genLineId(),
          sku: product.sku,
          name: product.name,
          category: product.category,
          qty,
          unit_price: product.price,
          ...metaSpread,
        },
      ];
    });
    return true;
  }, []);

  /** Remove a line from the cart by ID. */
  const removeLine = useCallback((lineId: LineId) => {
    setLines((prev) => prev.filter((l) => l.id !== lineId));
  }, []);

  /** Update the quantity of a line. Non-positive quantities are rejected (use removeLine instead). */
  const updateQty = useCallback((lineId: LineId, qty: number) => {
    if (qty <= 0) return;
    setLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, qty } : l)),
    );
  }, []);

  /**
   * Override the unit price of a line (manager price override).
   *
   * The new price must be in the cart's currency — a cross-currency override
   * would silently mix amounts in the preview. Rejects (returns `false`)
   * and leaves the line unchanged when the currency differs.
   */
  const updateLinePrice = useCallback((lineId: LineId, newPrice: Money): boolean => {
    if (cartCurrencyRef.current !== null && newPrice.currency !== cartCurrencyRef.current) {
      return false;
    }
    setLines((prev) =>
      prev.map((line) =>
        line.id === lineId ? { ...line, unit_price: newPrice } : line,
      ),
    );
    return true;
  }, [setLines]);

  /**
   * Assign a course to a line item, or clear it. Only applicable in
   * restaurant mode. If the line already has the same course, this is a no-op.
   *
   * Clearing is expressed as an empty `courseId` (the course chip's "None"
   * option) and must drop `coursingStatus` as well: a status left at 'hold'
   * on a line with no course keeps the "Fire All" button alive and inflates
   * its count, and a later re-assignment to a real course would then read as
   * already-synced.
   */
  const assignCourse = useCallback((lineId: LineId, courseId: CourseId) => {
    const clearing = courseId === '';
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId || line.courseId === courseId) return line;
        const { courseId: _droppedCourse, coursingStatus: _droppedStatus, ...rest } = line;
        return clearing
          ? rest
          : { ...rest, courseId, coursingStatus: 'hold' as const };
      }),
    );
  }, []);

  /**
   * Fire all lines that are currently on hold for a given course.
   * Updates their coursing_status to 'fired'.
   */
  const fireCourse = useCallback((courseId: CourseId) => {
    setLines((prev) =>
      prev.map((line) =>
        line.courseId === courseId && line.coursingStatus === 'hold'
          ? { ...line, coursingStatus: 'fired' as const }
          : line,
      ),
    );
  }, []);

  /**
   * Fire ALL courses at once (batch-fire everything on hold).
   */
  const fireAllCourses = useCallback(() => {
    setLines((prev) =>
      prev.map((line) =>
        line.coursingStatus === 'hold'
          ? { ...line, coursingStatus: 'fired' as const }
          : line,
      ),
    );
  }, []);

  /**
   * Computed subtotal (sum of all line qty × unit_price).
   *
   * Currency is taken from the first line. The POS does not support
   * mixed-currency carts — all lines in a single transaction must
   * share the same currency. If a mixed-currency scenario occurs
   * (e.g. bug or direct state mutation), the first line's currency
   * is used and subsequent lines' amounts are summed regardless.
   */
  const subtotal: Money | null = useMemo(() => {
    if (lines.length === 0) return null;
    const currency = lines[0]!.unit_price.currency;
    const sum = lines.reduce((acc, l) => {
      return acc + l.unit_price.minor_units * l.qty;
    }, 0);
    return { minor_units: sum, currency };
  }, [lines]);

  /** Subtotal after discount — base for service charge and tip math. */
  const discounted: Money | null = useMemo(() => {
    if (!subtotal) return null;
    if (discountPercent <= 0) return subtotal;
    const multiplier = 100 - discountPercent;
    return {
      minor_units: Math.floor((subtotal.minor_units * multiplier) / 100),
      currency: subtotal.currency,
    };
  }, [subtotal, discountPercent]);

  /** Computed grand total after discount + service charge + tip. */
  const total: Money | null = useMemo(() => {
    if (!discounted) return null;
    let sum = discounted.minor_units;
    if (serviceChargeEnabled && serviceChargePercent > 0) {
      sum += Math.floor((discounted.minor_units * serviceChargePercent) / 100);
    }
    if (tipPercent > 0) {
      sum += Math.floor((discounted.minor_units * tipPercent) / 100);
    }
    return { minor_units: sum, currency: discounted.currency };
  }, [discounted, serviceChargeEnabled, serviceChargePercent, tipPercent]);

  /** Discount amount in minor units. */
  const discountAmount: Money | null = useMemo(() => {
    if (!subtotal || discountPercent <= 0) return null;
    return {
      minor_units: Math.floor((subtotal.minor_units * discountPercent) / 100),
      currency: subtotal.currency,
    };
  }, [subtotal, discountPercent]);

  /** Service charge amount in minor units (null when disabled). */
  const serviceChargeAmount: Money | null = useMemo(() => {
    if (!discounted || !serviceChargeEnabled || serviceChargePercent <= 0) {
      return null;
    }
    return {
      minor_units: Math.floor((discounted.minor_units * serviceChargePercent) / 100),
      currency: discounted.currency,
    };
  }, [discounted, serviceChargeEnabled, serviceChargePercent]);

  /** Tip amount in minor units (zero tip → null to suppress preview row). */
  const tipAmount: Money | null = useMemo(() => {
    if (!discounted || tipPercent <= 0) return null;
    return {
      minor_units: Math.floor((discounted.minor_units * tipPercent) / 100),
      currency: discounted.currency,
    };
  }, [discounted, tipPercent]);

  /**
   * Set a cart-level percentage discount.
   * Pass `percent = 0` to clear. `label` is optional.
   * This is a local preview; the backend applies it on complete.
   */
  const setDiscount = useCallback(
    (percent: number, label: string) => {
      const clamped = Math.max(0, Math.min(100, Math.round(percent)));
      setDiscountPercent(clamped);
      setDiscountLabel(clamped > 0 ? label : '');
    },
    [],
  );

  /**
   * Set the tip percentage (0..100). The tip preview row re-renders as
   * the cashier taps different segments.
   */
  const setTipPercent = useCallback((percent: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    setTipPercentState(clamped);
  }, []);

  /**
   * Toggle the service charge on/off. Optional percent override (the
   * toggle UI keeps the existing percent by default).
   */
  const setServiceCharge = useCallback(
    (enabled: boolean, percent?: number) => {
      setServiceChargeEnabled(enabled);
      if (typeof percent === 'number') {
        setServiceChargePercentState(
          Math.max(0, Math.min(100, Math.round(percent))),
        );
      }
    },
    [],
  );

  /** Clear all lines and reset discount, tip, service charge. */
  const resetCart = useCallback(() => {
    setLines([]);
    cartCurrencyRef.current = null; // new cart may start in any currency
    setDiscountPercent(0);
    setDiscountLabel('');
    setTipPercentState(0);
    setServiceChargeEnabled(false);
    setServiceChargePercentState(SERVICE_CHARGE_DEFAULT_PERCENT);
  }, []);

  return {
    lines,
    subtotal,
    total,
    discountPercent,
    discountLabel,
    discountAmount,
    tipPercent,
    tipAmount,
    serviceChargeEnabled,
    serviceChargePercent,
    serviceChargeAmount,
    addProduct,
    removeLine,
    updateQty,
    updateLinePrice,
    assignCourse,
    fireCourse,
    fireAllCourses,
    setDiscount,
    setTipPercent,
    setServiceCharge,
    resetCart,
    /** Exposed for restoring held carts. Prefer addProduct/removeLine for normal use. */
    setLines,
  };
}
