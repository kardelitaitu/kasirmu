// ── Sales: POS cart, history, void, discounts, held carts, refunds, dashboard, printing ──

import { loggedInvoke } from '@/utils/logged-invoke';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CartId, LineId, Money } from '@/types/domain';

// ── Cart operations ────────────────────────────────────────────────

/** Arguments for starting a new sale. */
export interface StartSaleArgs {
  currency: string;
}

/** Result of starting a new sale, containing the new cart identifier. */
export interface StartSaleResult {
  cartId: CartId;
  /** ADR-19 §5.1: the deduction location locked at cart-start time. */
  deductionLocationId?: string;
}

/** Arguments for adding a line item to a cart. */
export interface AddLineArgs {
  cartId: CartId;
  sku: string;
  qty: number;
  unitPriceMinor: number;
  /**
   * FRONTEND-03: ISO-4217 code the line is priced in. When present the
   * backend builds the line in this currency and rejects it if it differs
   * from the cart's currency; omitted lines fall back to the cart currency.
   */
  unitPriceCurrency?: string;
  /**
   * Restaurant course assignment (e.g. "appetizer", "main"). Normalized
   * backend-side (legacy "drinks" → "beverage"); omitted leaves the line
   * unassigned. Carried on the checkout push so `sale_lines.course`
   * reaches the KDS fan-out.
   */
  course?: string;
}

/** Result of adding a line item to a cart. */
export interface AddLineResult {
  lineId: LineId;
  lineTotal: Money | null;
}

/** A serial number captured at checkout for a tracked product. */
export interface SerialNumberArg {
  sku: string;
  serial: string;
}

/** A single payment split for multi-method payments. */
export interface PaymentSplitArg {
  method: string;
  amountMinor: number;
  gatewayReference?: string;
  gatewayStatus?: string;
  gatewayResponse?: string;
}

export interface CompleteSaleArgs {
  cartId: CartId;
  paymentMethod: string;
  tenderedMinor: number | null;
  userId?: string;
  /** Optional customer id to link this sale for loyalty tracking. */
  customerId?: string;
  /** Optional customer name (for credit sales). */
  customerName?: string;
  /** Optional payment splits for multi-method payments. */
  paymentSplits?: PaymentSplitArg[];
  /** Optional serial numbers captured at checkout for track_serial products. */
  serialNumbers?: SerialNumberArg[];
  /** CUR-02: original sale currency when multi-currency checkout is used. */
  baseCurrency?: string;
  /** CUR-02: original sale total in baseCurrency minor units. */
  baseTotalMinor?: number;
  /** CUR-02: fixed-point rate (millionths) baseCurrency → sale currency. */
  tenderRateMillionths?: number;
  /** Tip amount in minor units collected at checkout (default 0). */
  tipMinor?: number;
  /** Service-charge amount in minor units collected at checkout (default 0). */
  serviceChargeMinor?: number;
  /**
   * PROMO-3 checkout integration: promotions to engine-apply against the
   * post-tax sale. Each reduces the payable total (stacking); the application
   * rows persist inside the checkout transaction and payment splits are
   * validated against the reduced total. Use `previewPromotedTotalScoped` to
   * compute split amounts before invoking.
   */
  promotionIds?: string[];
}

/** Result of completing a sale. */
export interface CompleteSaleResult {
  saleId: string;
  total: Money | null;
  lineCount: number;
}

/** Arguments for setting a discount on a cart. */
export interface SetCartDiscountArgs {
  cartId: string;
  percent: number;
  label?: string;
  userId: string;
}

/** ADR #7: Start a new sale in the store resolved from a session token. */
export const startSaleScoped = (sessionToken: string, args: StartSaleArgs): Promise<StartSaleResult> =>
  loggedInvoke<StartSaleResult>('start_sale_scoped', { sessionToken, args });

/** ADR-19: Info about the deduction location locked on a cart. */
export interface DeductionLocationInfo {
  locationId: string;
  locationName: string;
  /** ISO-8601 timestamp of the last manager override, or null. */
  overriddenAt?: string;
}

/** ADR-19 §5.1: Get the deduction location info for an active cart. */
export const getCartDeductionLocation = (cartId: string): Promise<DeductionLocationInfo | null> =>
  loggedInvoke<DeductionLocationInfo | null>('get_cart_deduction_location', { cartId });

/**
 * ADR #7: Get the deduction location info for a cart in the store resolved from a session token.
 *
 * Registered by BOTH shells as of this writing -- `desktop-client` has had it since the ADR #7
 * sweep and `mobile-tauri` gained it alongside this wrapper. The ambient `get_cart_deduction_location`
 * above is registered by tablet only, so calling it from the desktop shell throws "command not
 * found"; that asymmetry is what this wrapper exists to route around.
 */
export const getCartDeductionLocationScoped = (
  sessionToken: string,
  cartId: string,
): Promise<DeductionLocationInfo | null> =>
  loggedInvoke<DeductionLocationInfo | null>('get_cart_deduction_location_scoped', { sessionToken, cartId });

/** ADR #7: Add a line to a cart in the store resolved from a session token. */
export const addLineScoped = (sessionToken: string, args: AddLineArgs): Promise<AddLineResult> =>
  loggedInvoke<AddLineResult>('add_line_scoped', { sessionToken, args });

/** Arguments for completing a sale scoped to the session store. `userId` is read from session, not args. ADR #7. */
export interface CompleteSaleScopedArgs {
  cartId: string;
  paymentMethod: string;
  tenderedMinor: number | null;
  customerId?: string;
  paymentSplits?: PaymentSplitArg[];
  customerName?: string;
  serialNumbers?: SerialNumberArg[];
  /** CUR-02: original sale currency when multi-currency checkout is used. */
  baseCurrency?: string;
  /** CUR-02: original sale total in baseCurrency minor units. */
  baseTotalMinor?: number;
  /** CUR-02: fixed-point rate (millionths) baseCurrency → sale currency. */
  tenderRateMillionths?: number;
  /** Tip amount in minor units collected at checkout (default 0). */
  tipMinor?: number;
  /** Service-charge amount in minor units collected at checkout (default 0). */
  serviceChargeMinor?: number;
  /**
   * Identifies one checkout *attempt*, so the backend can make completion
   * idempotent. Minted once when the payment modal mounts and reused by every
   * submission of that attempt — including the shortfall-resolution retry and
   * any re-tap after a response was lost.
   *
   * A replay then returns the receipt that was already created instead of
   * ringing up a second sale.
   *
   * It must NOT be generated per call: a fresh id on every submission dedups
   * nothing, because the two requests that represent the same sale would
   * carry different keys. Equally, it must not outlive the attempt — an id
   * reused across two different sales would make the second one collide with
   * the first and block a legitimate sale.
   */
  attemptId?: string;
  /**
   * PROMO-3 checkout integration: promotions to engine-apply against the
   * post-tax sale (see `CompleteSaleArgs.promotionIds`).
   */
  promotionIds?: string[];
  /**
   * F2-6: the client's claim that the displayed tax was an ESTIMATE —
   * the cart-tax cache was stale/unknown at checkout. Core verifies by
   * computing the tax itself and stamps claim + computed tax into
   * `sales.tax_estimate_note` (D61 ruling 4: flag for recompute, never
   * silent). Absent/false is the zero-change default: no stamp.
   * Mirrors `tax_estimated: Option<bool>` (commands/pos.rs, c2cc3af9e).
   */
  taxEstimated?: boolean;
}

export const completeSaleScoped = (sessionToken: string, args: CompleteSaleScopedArgs): Promise<CompleteSaleResult> =>
  loggedInvoke<CompleteSaleResult>('complete_sale_scoped', { sessionToken, args });

/** PROMO-3: one promotion's discount in the checkout preview. */
export interface PromotionDiscountPreview {
  promotionId: string;
  discountMinor: number;
  description: string;
}

/** Arguments for previewing the promotion-reduced payable of a cart. */
export interface PreviewPromotedTotalArgs {
  cartId: string;
  /** Promotions to preview, in application order (they stack). */
  promotionIds: string[];
}

/** Result of previewing the promotion-reduced payable of a cart. */
export interface PreviewPromotedTotalResult {
  /** Cart total after cart discount + tax, before promotions. */
  baseTotalMinor: number;
  /** Final payable after promotions — what payment splits must cover. */
  totalMinor: number;
  /** Per-promotion discounts in application order. */
  discounts: PromotionDiscountPreview[];
}

/**
 * PROMO-3 checkout integration: preview the promotion-reduced payable for a
 * cart without consuming it. The checkout call re-validates splits against
 * the freshly computed total, so if the cart changed between preview and
 * completion the backend rejects and the caller re-previews.
 */
export const previewPromotedTotalScoped = (
  sessionToken: string,
  args: PreviewPromotedTotalArgs
): Promise<PreviewPromotedTotalResult> =>
  loggedInvoke<PreviewPromotedTotalResult>('preview_promoted_total_scoped', { sessionToken, args });

/** One cart line for the lines-based promotion preview (already in cart currency). */
export interface PreviewLineArg {
  sku: string;
  qty: number;
  unitPriceMinor: number;
  /** ISO-4217 code of the unit price currency. */
  unitPriceCurrency: string;
}

/** Arguments for previewing the promotion-reduced payable from raw lines. */
export interface PreviewPromotedTotalFromLinesArgs {
  /** Cart lines, in cart order (already in cart currency). */
  lines: PreviewLineArg[];
  /** Cart discount percent already applied client-side (0-100). */
  discountPercent: number;
  /** Promotions to preview, in application order (they stack). */
  promotionIds: string[];
}

/**
 * PROMO-3 checkout integration: preview the promotion-reduced payable from
 * raw cart lines — no backend cart needed. The client materializes its cart
 * only at the confirm step, so the payment modal uses this to show the
 * engine-exact promoted total and let split payments be entered against it.
 */
export const previewPromotedTotalFromLinesScoped = (
  sessionToken: string,
  args: PreviewPromotedTotalFromLinesArgs
): Promise<PreviewPromotedTotalResult> =>
  loggedInvoke<PreviewPromotedTotalResult>('preview_promoted_total_from_lines_scoped', { sessionToken, args });

// ── Shortfall Resolution — complete_sale_with_resolved_shortfalls ──

export interface LocationAllocation {
  locationId: string;
  qty: number;
}

export interface ResolvedShortfall {
  sku: string;
  allocations: LocationAllocation[];
}

export interface CartLineData {
  sku: string;
  qty: number;
  unitPriceMinor: number;
  /**
   * FRONTEND-03 follow-up: ISO-4217 code the line is priced in. When
   * present the backend builds the reconstructed line in this currency and
   * rejects it if it differs from the sale currency; omitted lines fall
   * back to the sale currency.
   */
  unitPriceCurrency?: string;
  /**
   * Restaurant course assignment, carried on the shortfall-retry
   * reconstruction so the retried sale keeps the course the first
   * submission pushed. Normalized backend-side like `AddLineArgs.course`.
   */
  course?: string;
}

export interface CompleteSaleWithResolvedShortfallsArgs {
  cartId: string;
  paymentMethod: string;
  tenderedMinor: number | null;
  customerId?: string;
  paymentSplits?: PaymentSplitArg[];
  customerName?: string;
  serialNumbers?: SerialNumberArg[];
  /** Cart line data reconstructed from the in-memory cart (original was deleted). */
  lines: CartLineData[];
  /** Total sale amount in minor units. */
  totalMinor: number;
  /** ISO-4217 currency code. */
  currency: string;
  /** Discount percentage (0-100). */
  discountPercent: number;
  /** Optional discount label. */
  discountLabel?: string;
  /** Cashier-resolved shortfalls: per-SKU allocation to specific locations. */
  resolutions: ResolvedShortfall[];
  /** CUR-02: tip collected at checkout (backend defaults to 0 when absent). */
  tipMinor?: number;
  /** CUR-02: service charge collected at checkout (defaults to 0). */
  serviceChargeMinor?: number;
  /** CUR-02: original sale currency when multi-currency checkout is used. */
  baseCurrency?: string;
  /** CUR-02: original sale total in `baseCurrency` minor units. */
  baseTotalMinor?: number;
  /** CUR-02: fixed-point rate (millionths) `baseCurrency → sale currency`. */
  tenderRateMillionths?: number;
  /**
   * The SAME value the original `complete_sale_scoped` submission carried.
   *
   * This call is a retry of that attempt after the cashier resolved a stock
   * shortfall, so reusing the id is the whole point: if the first submission
   * actually committed and only its response was lost, a fresh id here would
   * let the backend ring up a second sale. See CompleteSaleScopedArgs.attemptId.
   */
  attemptId?: string;
  /**
   * The same promotion list the original `complete_sale_scoped` submission
   * carried, in the same order — the retry must re-apply identical discounts
   * (see CompleteSaleScopedArgs.promotionIds).
   */
  promotionIds?: string[];
}

/** Complete a sale with cashier-resolved shortfalls (split fulfillment).
 *  This is the second command after a PartialStockResult is returned. */
export const completeSaleWithResolvedShortfalls = (
  sessionToken: string,
  args: CompleteSaleWithResolvedShortfallsArgs
): Promise<CompleteSaleResult> =>
  loggedInvoke<CompleteSaleResult>('complete_sale_with_resolved_shortfalls_scoped', { sessionToken, args });

// Export front-end types for the StockShortfallDialog
// PartialStockResult, Shortfall, LocationStock are returned by the backend
// and consumed by the front-end dialog; they are defined in the Rust side
// and serialized via JSON. The front-end types mirror the Rust definitions:
export interface LocationStock {
  locationId: string;
  locationName: string;
  qtyAvailable: number;
}

export interface Shortfall {
  sku: string;
  productName: string;
  requestedQty: number;
  primaryQtyAvailable: number;
  deficit: number;
  primaryLocationId: string;
  alternatives: LocationStock[];
}

export interface PartialStockResult {
  requiresResolution: boolean;
  shortfalls: Shortfall[];
}

/** ADR-20: Pending sale info returned after stock reservation. */
export interface PendingSale {
  saleId: string;
  receiptNumber: string;
  deductTxId: string;
  total: Money | null;
  lineCount: number;
}

/** ADR-20: Finalize a pending sale after successful payment capture.
 *  Transitions status from 'pending' to 'completed'. */
export const finalizeSale = (sessionToken: string, saleId: string): Promise<void> =>
  loggedInvoke<void>('finalize_sale', { sessionToken, saleId });

/** ADR-20: Void a pending sale and restore reserved stock back to
 *  original deduction locations. Called when payment capture fails
 *  or the transaction is abandoned. */
export const voidPendingSale = (sessionToken: string, saleId: string): Promise<void> =>
  loggedInvoke<void>('void_pending_sale', { sessionToken, saleId });

/** ADR-19 §17: Record a manager override of the deduction location on an active cart. */
export const overrideCartDeductionLocation = (sessionToken: string, cartId: string): Promise<void> =>
  loggedInvoke<void>('override_cart_deduction_location_scoped', { sessionToken, cartId });

/** One serial-tracking flag row in a batch response. */
export interface SerialTrackRow {
  sku: string;
  track_serial: boolean;
}

/**
 * ADR #7: Scoped batch serial-tracking — `userId` is read from session.
 *
 * PERF-03: many SKUs in a single IPC round trip, replacing the N+1 per-SKU loop in the retail
 * cart. The unscoped twin of this call was deleted on 2026-09-16 (T25); its contract case came
 * here with it, because this is the only form the cart uses (RetailPosScreen.tsx:191).
 */
export const getProductTrackSerialBatchScoped = (sessionToken: string, skus: string[]): Promise<SerialTrackRow[]> =>
  loggedInvoke<SerialTrackRow[]>('get_product_track_serial_batch_scoped', { sessionToken, skus });

/** ADR #7: Scoped cart discount — `userId` is read from session. */
export interface SetCartDiscountScopedArgs {
  cartId: string;
  percent: number;
  label?: string | null;
}

export const setCartDiscountScoped = (sessionToken: string, args: SetCartDiscountScopedArgs): Promise<void> =>
  loggedInvoke<void>('set_cart_discount_scoped', { sessionToken, args });

/** Arguments for overriding the price of a specific line in a cart. */
export interface OverrideLinePriceArgs {
  cartId: string;
  lineId: string;
  newPriceMinor: number;
  userId: string;
}

/** ADR #7: Scoped line price override — `userId` is read from session. */
export const overrideLinePriceScoped = (sessionToken: string, cartId: string, lineId: string, newPriceMinor: number): Promise<void> =>
  loggedInvoke<void>('override_line_price_scoped', { sessionToken, args: { cartId, lineId, newPriceMinor } });

// ── Sales History ─────────────────────────────────────────────────

/** A summary row for a sale in the sales history list. */
export interface SaleListItem {
  id: string;
  total: Money;
  lineCount: number;
  status: string;
  paymentMethod: string | null;
  userId: string | null;
  createdAt: string;
  /** Phase 4: frozen 22-char receipt hierarchy code (location-terminal-YYMMDD-staff-seq),
   *  or null for sales predating the code / sales with no known terminal. */
  displayCode?: string | null;
}

/** A line item within a sale detail. */
export interface SaleLineDto {
  id: string;
  sku: string;
  name: string;
  qty: number;
  unit_price: Money;
  total_minor: number;
  tax_amount: Money | null;
  tax_rate_id: string | null;
}

/** Full detail of a completed sale, including line items. */
export interface SaleDetail {
  id: string;
  total: Money;
  subtotal: Money;
  taxTotal: Money;
  lineCount: number;
  status: string;
  paymentMethod: string | null;
  tenderedMinor: number | null;
  userId: string | null;
  createdAt: string;
  lines: SaleLineDto[];
  /** F2-7 (forward-wired): the F2 audit stamp when the sale's tax was
   *  computed against a non-fresh estimate. Optional until F2-6 threads
   *  `Store::sale_tax_estimate_note` through the detail command — the same
   *  optional-field rule the caps DTO used (runtime presence pinned by the
   *  badge test, absence renders no badge). */
  taxEstimateNote?: string | null;
  /** Phase 4: frozen 22-char receipt hierarchy code (location-terminal-YYMMDD-staff-seq),
   *  or null for sales predating the code / sales with no known terminal. */
  displayCode?: string | null;
  /** CUR-02: original sale currency when multi-currency checkout was used. */
  baseCurrency?: string | null;
  /** CUR-02: original sale total in baseCurrency minor units. */
  baseTotalMinor?: number | null;
  /** CUR-02: fixed-point rate (millionths) used for the conversion. */
  tenderRateMillionths?: number | null;
}

/**
 * C1.2: response for the sale-list commands — the sales (already capped to
 * the tier's history window) plus the cap flag so the UI can show the
 * upgrade teaser.
 */
export interface SaleListResponse {
  sales: SaleListItem[];
  /** True when the tier's history window (Free = 3 months) was applied. */
  salesHistoryCapped: boolean;
}

/** List all completed sales. */
export const listSales = (): Promise<SaleListResponse> =>
  loggedInvoke<SaleListResponse>('list_sales');

/** ADR #7: List sales scoped to the store resolved from a session token. */
export const listSalesScoped = (sessionToken: string): Promise<SaleListResponse> =>
  loggedInvoke<SaleListResponse>('list_sales_scoped', { sessionToken });

/** Fetch a single sale by its identifier. */
export const getSale = (id: string): Promise<SaleDetail | null> =>
  loggedInvoke<SaleDetail | null>('get_sale', { id });

/** ADR #7: Fetch a sale by ID from the store resolved from a session token. */
export const getSaleScoped = (sessionToken: string, id: string): Promise<SaleDetail | null> =>
  loggedInvoke<SaleDetail | null>('get_sale_scoped', { sessionToken, id });

// ── Void Sale ─────────────────────────────────────────────────────

/** Arguments for voiding a completed sale. */
export interface VoidSaleArgs {
  saleId: string;
  userId: string;
  reason: string;
}

/** Result of voiding a sale. */
export interface VoidSaleResult {
  id: string;
  status: string;
  total: Money;
  line_count: number;
  created_at: string;
}

/** ADR #7: Void a sale in the store resolved from a session token. */
export const voidSaleScoped = (sessionToken: string, saleId: string, reason: string): Promise<VoidSaleResult> =>
  loggedInvoke<VoidSaleResult>('void_sale_scoped', { sessionToken, args: { saleId, reason } });

// ── Hold Order ────────────────────────────────────────────────────

/** Arguments for holding (parking) a cart for later retrieval. */
export interface HoldCartArgs {
  label: string;
  cart_data: string;
  item_count: number;
  total_minor: number;
  currency: string;
  bill_type?: string;
  customer_name?: string;
  /** ADR-19 §6.3: deduction location UUID locked at cart-start time. */
  deduction_location_id?: string;
}

/** A summary row of a held (parked) cart. */
export interface HeldCartRow {
  id: string;
  label: string;
  item_count: number;
  total_minor: number;
  currency: string;
  created_at: string;
  bill_type: string;
  customer_name: string | null;
}

/** Full detail of a held cart including serialised cart data. */
export interface HeldCartFull {
  id: string;
  label: string;
  cart_data: string;
  item_count: number;
  total_minor: number;
  currency: string;
  created_at: string;
  bill_type: string;
  customer_name: string | null;
  /** ADR-19 §6.3: deduction location UUID locked at cart-start time. */
  deduction_location_id: string | null;
}

/** ADR #7: Hold a cart in the store resolved from a session token. */
export const holdCartScoped = (sessionToken: string, args: HoldCartArgs): Promise<{ id: string }> =>
  loggedInvoke<{ id: string }>('hold_cart_scoped', { sessionToken, args });

/** ADR #7: Scoped held carts listing. */
export const listHeldCartsScoped = (sessionToken: string): Promise<HeldCartRow[]> =>
  loggedInvoke<HeldCartRow[]>('list_held_carts_scoped', { sessionToken });

/** ADR #7: Scoped open bills listing. */
export const listOpenBillsScoped = (sessionToken: string): Promise<HeldCartRow[]> =>
  loggedInvoke<HeldCartRow[]>('list_open_bills_scoped', { sessionToken });

/** ADR #7: Scoped held cart retrieval. */
export const getHeldCartScoped = (sessionToken: string, id: string): Promise<HeldCartFull | null> =>
  loggedInvoke<HeldCartFull | null>('get_held_cart_scoped', { sessionToken, id });

/** ADR #7: Scoped held cart deletion. */
export const deleteHeldCartScoped = (sessionToken: string, id: string): Promise<void> =>
  loggedInvoke('delete_held_cart_scoped', { sessionToken, id });

// ── Refunds ───────────────────────────────────────────────────────

/** A single line item being refunded. */
export interface RefundLineArg {
  saleLineId: string;
  sku: string;
  qty: number;
  unitPriceMinor: number;
  currency: string;
  lineTotalMinor: number;
}

/** Arguments for processing a refund against a completed sale. */
export interface ProcessRefundArgs {
  saleId: string;
  reason: string;
  note?: string | null;
  userId: string;
  lines: RefundLineArg[];
}

/** Result of processing a refund. */
export interface ProcessRefundResult {
  refundId: string;
  totalMinor: number;
}

/** A processed refund record with its associated line items. */
export interface RefundDto {
  id: string;
  saleId: string;
  total: Money;
  reason: string;
  note: string;
  processedBy: string;
  createdAt: string;
  lines: RefundLineDto[];
}

/** A line item within a refund record. */
export interface RefundLineDto {
  id: string;
  refundId: string;
  saleLineId: string;
  sku: string;
  qty: number;
  unitPrice: Money;
  lineTotal: Money;
}

/** ADR #7: Scoped receipt barcode lookup using session token. */
export const lookupSaleByReceiptBarcodeScoped = (sessionToken: string, barcode: string): Promise<SaleDetail | null> =>
  loggedInvoke<SaleDetail | null>('lookup_sale_by_receipt_barcode_scoped', { sessionToken, barcode });

/** Arguments for processing a refund scoped to the session store. `userId` is read from session, not args. ADR #7. */
export interface ProcessRefundScopedArgs {
  saleId: string;
  reason: string;
  note?: string | null;
  lines: RefundLineArg[];
}

export const processRefundScoped = (sessionToken: string, args: ProcessRefundScopedArgs): Promise<ProcessRefundResult> =>
  loggedInvoke<ProcessRefundResult>('process_refund_scoped', { sessionToken, args });

/** ADR #7: Scoped refund listing using session token. */
export const listRefundsScoped = (sessionToken: string, saleId: string): Promise<RefundDto[]> =>
  loggedInvoke<RefundDto[]>('list_refunds_scoped', { sessionToken, saleId });

// ── Dashboard & Reports ───────────────────────────────────────────

/** A single row in the daily sales summary export. */
export interface DailySummaryRow {
  sale_id: string;
  total_minor: number;
  currency: string;
  line_count: number;
  status: string;
  created_at: string;
}

/** A row in the sales-by-hour breakdown. */
export interface SalesByHourRow {
  hour: number;
  total_minor: number;
  sale_count: number;
}

/** A payment method breakdown with count and total. */
export interface PaymentBreakdown {
  method: string;
  count: number;
  total: number;
}

/** End-of-day report aggregating sales, voids, discounts, and hourly breakdown. */
export interface EodReport {
  total_sales: number;
  total_revenue: number;
  currency: string;
  payment_breakdown: PaymentBreakdown[];
  void_count: number;
  void_total: number;
  discount_count: number;
  discount_total: number;
  hourly_breakdown: SalesByHourRow[];
}

/** Export the daily sales summary. */
export const exportDailySummary = (): Promise<DailySummaryRow[]> =>
  loggedInvoke<DailySummaryRow[]>('export_daily_summary');

/** ADR #7: Scoped daily summary report for the store resolved from a session token. */
export const exportDailySummaryScoped = (sessionToken: string): Promise<DailySummaryRow[]> =>
  loggedInvoke<DailySummaryRow[]>('export_daily_summary_scoped', { sessionToken });

/** Export the sales-by-hour breakdown. */
export const exportSalesByHour = (): Promise<SalesByHourRow[]> =>
  loggedInvoke<SalesByHourRow[]>('export_sales_by_hour');

/** ADR #7: Scoped sales-by-hour report for the store resolved from a session token. */
export const exportSalesByHourScoped = (sessionToken: string): Promise<SalesByHourRow[]> =>
  loggedInvoke<SalesByHourRow[]>('export_sales_by_hour_scoped', { sessionToken });

/** Export the end-of-day report. */
export const exportEodReport = (): Promise<EodReport> =>
  loggedInvoke<EodReport>('export_eod_report');

/** ADR #7: Scoped EOD report for the store resolved from a session token. */
export const exportEodReportScoped = (sessionToken: string): Promise<EodReport> =>
  loggedInvoke<EodReport>('export_eod_report_scoped', { sessionToken });

// ── Receipt Printing ──────────────────────────────────────────────

/** A line item for receipt printing. */
export interface LineItemDto {
  name: string;
  quantity: number;
  unitPrice: MoneyDto;
  totalPrice: MoneyDto;
  taxAmount?: MoneyDto;
}

/** A payment entry for receipt printing. */
export interface PaymentDto {
  method: string;
  amount: MoneyDto;
  change: MoneyDto | null;
}

/** Monetary value representation for receipt printing. */
export interface MoneyDto {
  minorUnits: number;
  currency: string;
}

/** Arguments for printing a sales receipt. */
export interface PrintSalesReceiptArgs {
  date: string;
  receiptNumber: string;
  items: LineItemDto[];
  subtotal: MoneyDto;
  tax?: MoneyDto;
  total: MoneyDto;
  payments: PaymentDto[];
  tableNumber?: string;
}

/** Result of a receipt print request. */
export interface PrintSalesReceiptResult {
  printed: boolean;
}

/** Print a formatted sales receipt (session-scoped — ADR #7). */
export const printSalesReceipt = (sessionToken: string, args: PrintSalesReceiptArgs): Promise<PrintSalesReceiptResult> =>
  loggedInvoke<PrintSalesReceiptResult>('print_sales_receipt_scoped', { sessionToken, args });

/** Subscribe to receipt-printed events from the backend. Returns an unsubscribe function. */
export const onReceiptPrinted = (handler: (lines: number) => void): Promise<UnlistenFn> =>
  listen<{ lines: number }>('receipt:printed', (e) => handler(e.payload.lines));
