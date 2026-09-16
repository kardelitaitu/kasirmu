/**
 * Shared types for the sales payment surface (features/sales/payment).
 *
 * CONTRACT - FROZEN SHAPE. PaymentModalProps is the 18-prop boundary both callers
 * compile against (features/sales/PosScreen.tsx and
 * features/retail/RetailPosScreen.tsx). It moved here verbatim in slice S1 of the
 * PaymentModal extraction campaign: same names, same optionality, same member
 * types, same order. Do not edit it in passing.
 *
 * The rule the remaining slices build on: subcomponents receive NARROWED props
 * downward - each extracted subcomponent gets its own smaller interface added HERE,
 * describing only what it actually reads. The top-level 18-prop shape does NOT
 * widen; a new prop belongs on the narrowed type, and reaches PaymentModalProps
 * only when an external caller genuinely must pass it.
 */
import type { CustomerDto } from '@/api/customers';
import type { CartLine, Money } from '@/types/domain';

export interface PaymentModalProps {
  open: boolean;
  lineItems: CartLine[];
  total: Money;
  discountPercent?: number;
  discountLabel?: string;
  userId: string;
  /** ADR #7 session token for scoped commands (deduction-aware cart lifecycle). */
  sessionToken?: string;
  tableNumber?: string;
  selectedCustomer?: CustomerDto | null;
  onCustomerChange?: (customer: CustomerDto | null) => void;
  onComplete: () => void;
  onClose: () => void;
  /** Serial numbers captured per SKU for track_serial products. */
  serialNumbers?: Record<string, string>;
  /** Custom quick tender preset amounts (in minor units). Defaults to standard Rp denominations. */
  tenderPresets?: number[];
  /** Tip amount in minor units collected at checkout (default 0). Persisted on the sale. */
  tipMinor?: number;
  /** Service-charge amount in minor units collected at checkout (default 0). Persisted on the sale. */
  serviceChargeMinor?: number;
  /**
   * PROMO-3: promotion ids selected in the picker. The backend engine
   * applies them against the post-tax sale at checkout; this modal previews
   * the reduced total so the displayed amount and the payment splits cover
   * exactly what the checkout call will validate against.
   */
  promotionIds?: string[];
  /**
   * F2-6: the caller's claim that the displayed tax was an ESTIMATE —
   * the cart-tax cache was stale/unknown at checkout (D64 b). Threaded
   * into the complete_sale_scoped payload; core verifies by computing
   * the tax itself and stamps the claim + computed tax onto the sale.
   * Absent/false is the zero-change default: no stamp requested.
   */
  taxEstimated?: boolean;
}
