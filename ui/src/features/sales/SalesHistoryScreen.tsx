import { useState, useCallback, useEffect, useMemo, useRef, useContext } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { LocaleContext } from '@/i18n/LocaleContext';
import { openUpgradePricing as openUpgradePricingPage } from '@/utils/upgrade';
import {
  listSales,
  getSale,
  getSaleScoped,
  listSalesScoped,
  printSalesReceipt,
  listRefundsScoped,
  voidSaleScoped,
  stampFakturPajakScoped,
  createFakturPenggantiScoped,
  type SaleListItem,
  type SaleDetail,
  type RefundDto,
  type LineItemDto,
} from '@/api/sales';
import { listStaffScoped, type StaffMemberDto } from '@/api/staff';
import { getSaleLineMarginsScoped, type SaleLineMarginDto } from '@/api/reports';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { formatMoney } from '@/types/domain';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Skeleton } from '@/components/Skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useSwipe } from '@/hooks/useSwipe';
import { l10nErrorMessage, plainErrorMessage } from '@/utils/app-error';
import { settleRead, type SettledRead } from '@/utils/settle-read';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { EmptyState, ErrorState, requiredLocalized } from '@/components';
import { useToast } from '@/components/Toast';
import Tooltip from '@/app/Tooltip';
import { NoSalesIcon, NotFoundIcon } from '@/components/EmptyStateIllustrations';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import RefundModal from './RefundModal';
import './SalesHistoryScreen.css';

const STATUS_OPTIONS = ['All', 'Completed', 'Pending', 'Voided'] as const;

/**
 * R3: the ceiling on how many sale rows this screen fetches in one call.
 *
 * Deliberately a COUNT ceiling, NOT an `(offset, limit)` page window. Every
 * filter here — search, status, cashier, date range — and the column sort
 * run client-side over the fetched array: `filteredSales` derives from the
 * whole set, and only then does `paginatedSales` slice it. A server-side
 * offset would hand those filters a single page to work on, so searching for
 * a sale would only ever search the page the cashier is currently looking
 * at. The ceiling bounds the IPC payload and the renderer's copy — which is
 * what R3 asks for — without moving the filter/sort boundary.
 *
 * The tier's history window (`sales_history_days`, surfaced as
 * `salesHistoryCapped`) still caps by date underneath this.
 */
const SALES_FETCH_LIMIT = 500;

function statusBadgeVariant(status: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'Completed': return 'success';
    case 'Pending': return 'warning';
    case 'Voided': return 'danger';
    default: return 'info';
  }
}

function statusFluentId(status: string): string {
  switch (status) {
    case 'Completed': return 'sales-history-status-completed';
    case 'Pending': return 'sales-history-status-pending';
    case 'Voided': return 'sales-history-status-voided';
    default: return 'sales-history-status-completed';
  }
}

/** F2-7: whether the F2 audit stamp marks this sale's tax as estimated.
 *  The note is core-authored JSON (F2-5: client claim + core-verified
 *  delta); the badge keys off the `estimated` flag with minimal parsing —
 *  a non-JSON or absent note means NOT estimated, which is the honest
 *  default for legacy rows (NULL) whose tax was computed live. */
function isTaxEstimated(note: string | null | undefined): boolean {
  if (!note) return false;
  try {
    return JSON.parse(note)?.estimated === true;
  } catch {
    return false;
  }
}

// ── Swipeable order row ──────────────────────────────────────────────

interface SwipeableOrderRowProps {
  sale: SaleListItem;
  isManager: boolean;
  onView: (id: string) => void;
  onVoid: (sale: SaleListItem) => void;
  cashierName: string;
}

function SwipeableOrderRow({ sale, isManager, onView, onVoid, cashierName }: SwipeableOrderRowProps) {
  const { l10n } = useLocalization();
  const [revealed, setRevealed] = useState(false);
  const swipe = useSwipe({
    onSwipeLeft: () => { if (isManager) setRevealed(true); },
    onSwipeRight: () => setRevealed(false),
  });

  return (
    <tr
      className="sales-history-row-wrap"
      data-revealed={revealed ? 'true' : undefined}
      {...swipe}
    >
      <td className="sales-history-cell-id">{sale.id.slice(0, 8)}&hellip;</td>
      <td className="sales-history-cell-receipt">
        <div>{sale.displayCode ?? '\u2014'}</div>
        {sale.fakturPajak && (
          // The native `title=` that used to sit on this span was a real a11y
          // defect, not just a lint hit: a browser tooltip is mouse-only, so the
          // NSFP it carried was unreachable by keyboard and invisible to screen
          // readers. The shared Tooltip + an explicit aria-label is what the rest
          // of the app uses for the same job (SettingsNavTree.tsx:625,
          // EmailReportSettings.tsx:451) and what the guard exists to enforce.
          <Tooltip content={`Faktur Pajak: ${sale.fakturPajak}`}>
            <span
              className="sales-history-faktur-badge"
              aria-label={`Faktur Pajak: ${sale.fakturPajak}`}
            >
              <Badge variant="info" size="sm">e-Faktur</Badge>
            </span>
          </Tooltip>
        )}
      </td>
      <td>{new Date(sale.createdAt).toLocaleString()}</td>
      <td className="sales-history-cell-total">{formatMoney(sale.total)}</td>
      <td>{sale.lineCount}</td>
      { }
      <td>
        <Badge variant={statusBadgeVariant(sale.status)}>
          <Localized id={statusFluentId(sale.status)}>
            <span>{sale.status}</span>
          </Localized>
        </Badge>
        {/* F2-7: the audit stamp is a DETAIL-level fact (the note rides the
            sale row, not the list projection), so the badge renders in the
            detail dialog only. */}
      </td>
      <td>{sale.paymentMethod ?? '\u2014'}</td>
      <td className="sales-history-cell-cashier">{cashierName}</td>
      <td className="sales-history-cell-actions">
        <div className="sales-history-cell-actions-inner">
          <Localized id="sales-history-action-view">
            <button
              type="button"
              className="sales-history-action-btn"
              onClick={() => onView(sale.id)}
              aria-label={`${l10n.getString('sales-history-view-aria', { id: sale.id })}`}
            >
              <span>View</span>
            </button>
          </Localized>
          {isManager && revealed && (
            <Localized id="sales-history-action-void">
              <button
                type="button"
                className="sales-history-void-btn"
                onClick={() => {
                  onVoid(sale);
                  setRevealed(false);
                }}
                aria-label={l10n.getString('sales-history-void-aria', { id: sale.id })}
              >
                <span>Void</span>
              </button>
            </Localized>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Sales history screen — filters by status, staff, and date range with swipable rows for manager void actions and detail drill-down. */
/**
 * C1.2: the Free tier's 3-month history window was applied — a blurred
 * teaser row at the bottom of the list with an upgrade CTA.
 */
function SalesHistoryCapTeaser({ onUpgrade }: { onUpgrade: () => void }) {
  const { l10n } = useLocalization();
  return (
    <div className="sales-history-cap-teaser" role="note">
      <div className="sales-history-cap-teaser-backdrop" aria-hidden="true" />
      <div className="sales-history-cap-teaser-content">
        <span>{l10n.getString('sales-history-cap-teaser')}</span>
        <Button variant="primary" size="sm" onClick={onUpgrade}>
          {l10n.getString('sales-history-cap-upgrade-cta')}
        </Button>
      </div>
    </div>
  );
}

export default function SalesHistoryScreen() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  // C1.2 upgrade link needs the active locale for the pricing URL; tests
  // render without LocaleContext, so default to English there.
  const locale = useContext(LocaleContext)?.locale ?? 'en';
  const [sales, setSales] = useState<SaleListItem[]>([]);
  /** C1.2: the backend capped this list to the tier's history window. */
  const [salesHistoryCapped, setSalesHistoryCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMemberDto[]>([]);
  // `[]` answers two questions here: 'this store has no other cashiers' and
  // 'we could not ask'. The second is an EXPECTED outcome, not an exceptional
  // one: list_staff_scoped requires permissions::STAFF_READ
  // (crates/kasirmu-bridge/src/staff.rs:349), so a cashier-role session that may
  // legitimately read sales history is refused this list. A silent `[]` leaves the
  // Cashier filter offering only 'All Cashiers' -- a roster claim -- and degrades
  // every cashier name in the table AND in the CSV export (cashierName falls back
  // to userId.slice(0, 8)) to a truncated id, with nothing on screen to say so.
  const [staffUnknown, setStaffUnknown] = useState(false);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [refundSaleId, setRefundSaleId] = useState<string | null>(null);
  const [refunds, setRefunds] = useState<RefundDto[]>([]);
  // `[]` answers two questions here: 'this sale was never refunded' and 'we
  // could not ask'. Those are not the same claim, and the difference is money:
  // the Refund button is offered off the back of this list, and
  // `create_refund` bounds a refund by the CUMULATIVE total already refunded
  // (crates/kasirmu-core/src/db/refunds.rs:119-143), so a cashier acting on a
  // failed read tries a refund the database will refuse for a reason the screen
  // has hidden. `refundsUnknown` keeps the three states apart.
  const [refundsUnknown, setRefundsUnknown] = useState(false);
  const [_refundsLoading, setRefundsLoading] = useState(false);
  const { session, isManager } = useAuth();
  const { sessionToken } = useWorkspace();
  // ── Per-line cost / margin (HPP) for the open sale detail ──
  const [lineMargins, setLineMargins] = useState<SaleLineMarginDto[]>([]);
  // The same three-way split `refundsUnknown` makes above, and the same reason it
  // matters more here. `[]` answers 'this sale has no line costs' and 'we could
  // not ask', and the Cost / Margin / Margin % columns are gated on the LENGTH
  // of this list, so a failed read removes three columns of a manager's
  // profitability read without a word. Nothing downstream treats a missing
  // margin as zero -- the report layer prefers the per-line snapshot and falls
  // back to the product's CURRENT cost, and then to 0
  // (crates/kasirmu-reporting/src/margin.rs:93, `COALESCE(sl.cost_minor, p.cost_minor, 0)`),
  // so a genuinely-unknown cost is itself a number that reads as a real one.
  const [marginsUnknown, setMarginsUnknown] = useState(false);
  // ── e-Faktur state (DJP Coretax) ───────────────────────────────────
  const [showStampModal, setShowStampModal] = useState(false);
  const [stampNsfp, setStampNsfp] = useState('');
  const [stampKodeTransaksi, setStampKodeTransaksi] = useState('01');
  const [stamping, setStamping] = useState(false);
  const [stampError, setStampError] = useState<string | null>(null);
  const [penggantiLoading, setPenggantiLoading] = useState(false);

  // P2-4: Sale detail cache — avoids re-fetching the same sale on modal re-open.
  // Invalidated when a sale is voided or refunded (status-changing events).
  const detailCacheRef = useRef<Map<string, SaleDetail>>(new Map());

  const invalidateCache = useCallback((saleId: string) => {
    detailCacheRef.current.delete(saleId);
  }, []);

  // ── Filters ────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');

  // ── Sorting ─────────────────────────────────────────────────────
  type SortKey = 'id' | 'createdAt' | 'total' | 'lineCount' | 'status' | 'paymentMethod';
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortAsc((a) => !a);
        return prev;
      }
      setSortAsc(key === 'createdAt' ? false : true);
      return key;
    });
  }, []);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [cashierFilter, setCashierFilter] = useState('');

  // ── Pagination ────────────────────────────────────────────────────
  const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  // Reset to page 1 when filters or page size change.
  useEffect(() => { setPage(1); }, [searchQuery, statusFilter, dateFrom, dateTo, cashierFilter, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // The staff list is settled separately from the sales list on purpose.
      // `Promise.all` would let one refused read discard the other arm, and the
      // outer catch below stands the WHOLE screen down -- reporting a missing
      // roster by hiding sales that loaded perfectly well.
      //
      // ADR #7, matching the listStaffScoped call immediately below -- which already had the
      // conditional. Reading the ambient list here meant the cashier's own sales history could
      // come from a different store than the staff list rendered beside it.
      // R3: bounded. `SALES_FETCH_LIMIT` is a count ceiling rather than a
      // page window — see the constant for why an offset would break the
      // filters above. The unscoped `listSales` fallback declares no bounds
      // of its own (`history.rs:61`), so it is left exactly as it was; it
      // is the no-session path.
      const response = await (sessionToken
        ? listSalesScoped(sessionToken, SALES_FETCH_LIMIT)
        : listSales());
      const staffRead = await (sessionToken
        ? settleRead('staff', listStaffScoped(sessionToken))
        : Promise.resolve({ ok: true, value: [] } as const satisfies SettledRead<StaffMemberDto[]>));
    setSales(response.sales);
    setSalesHistoryCapped(response.salesHistoryCapped);
    setStaff(staffRead.ok ? staffRead.value : []);
    setStaffUnknown(!staffRead.ok);
    } catch {
      // LOAD-02: an initial load failure must not look like an empty
      // database — surface the error and offer Retry instead.
      setLoadError(requiredLocalized(l10n, 'sales-history-error-load'));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, l10n]);

  // P7-3: Pull-to-refresh gesture
  const { containerProps: pullRefreshProps, state: pullState, pullDistance } = usePullToRefresh({
    onRefresh: load,
  });

  useEffect(() => { load(); }, [load]);

  /** C1.2: open the website pricing page so the owner can upgrade the plan. */
  const openUpgradePricing = useCallback(() => {
    openUpgradePricingPage(locale, 'plus');
  }, [locale]);

  // ── Void state ──────────────────────────────────────────────────────
  const [voidTarget, setVoidTarget] = useState<SaleListItem | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const handleOpenVoid = useCallback((sale: SaleListItem) => {
    setVoidTarget(sale);
    setVoidReason('');
    setVoidError(null);
  }, []);

  const handleCloseVoid = useCallback(() => {
    setVoidTarget(null);
    setVoidReason('');
    setVoidError(null);
  }, []);

  const voidExit = useExitAnimation(!!voidTarget, handleCloseVoid);

  const handleConfirmVoid = useCallback(async () => {
    if (!voidTarget) return;
    setVoiding(true);
    setVoidError(null);
    try {
      await voidSaleScoped(sessionToken!, voidTarget.id, voidReason || l10n.getString('sales-history-void-default-reason'));
      invalidateCache(voidTarget.id);
      setVoidTarget(null);
      setVoidReason('');
      load();
    } catch (err) {
      setVoidError(l10nErrorMessage(err, l10n, 'sales-history-void-error'));
    } finally {
      setVoiding(false);
    }
    // sessionToken is read at :266 and was missing. `session` was in the array but is never
    // read in this body -- eslint only reported the missing token until the token was added,
    // because the rule surfaces one problem per hook, so the unnecessary dep was latent behind
    // it. `session` comes from useAuth() at :163 (staff identity) and is a different value from
    // useWorkspace()'s sessionToken at :164; listing one never covered the other. A void is an
    // audit-trail event: a stale token either fails the permission check outright or, if the old
    // session were still live, attributes the void to the previous cashier.
  }, [voidTarget, voidReason, load, l10n, invalidateCache, sessionToken]);

  // ── Client-side filtering + sorting ────────────────────────────
  const filteredSales = useMemo(() => {
    const filtered = sales.filter((s) => {
      // Text search: match against sale ID, displayCode, payment method, or user_id.
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const idMatch = s.id.toLowerCase().includes(q);
        const codeMatch = (s.displayCode ?? '').toLowerCase().includes(q);
        const fpMatch = (s.fakturPajak ?? '').toLowerCase().includes(q);
        const pmMatch = (s.paymentMethod ?? '').toLowerCase().includes(q);
        const uidMatch = (s.userId ?? '').toLowerCase().includes(q);
        if (!idMatch && !codeMatch && !fpMatch && !pmMatch && !uidMatch) return false;
      }

      // Status filter.
      if (statusFilter !== 'All' && s.status !== statusFilter) return false;

      // Cashier filter.
      if (cashierFilter && s.userId !== cashierFilter) return false;

      // Date range filter.
      if (dateFrom || dateTo) {
        const saleDate = new Date(s.createdAt);
        if (dateFrom) {
          const from = new Date(dateFrom);
          if (saleDate < from) return false;
        }
        if (dateTo) {
          const to = new Date(dateTo);
          to.setHours(23, 59, 59, 999);
          if (saleDate > to) return false;
        }
      }

      return true;
    });

    // Sort.
    filtered.sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      switch (sortKey) {
        case 'id':            return a.id.localeCompare(b.id) * dir;
        case 'createdAt':     return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
        case 'total':         return (a.total.minor_units - b.total.minor_units) * dir;
        case 'lineCount':     return (a.lineCount - b.lineCount) * dir;
        case 'status':        return a.status.localeCompare(b.status) * dir;
        case 'paymentMethod': return (a.paymentMethod ?? '').localeCompare(b.paymentMethod ?? '') * dir;
        default:              return 0;
      }
    });

    return filtered;
  }, [sales, searchQuery, statusFilter, cashierFilter, dateFrom, dateTo, sortKey, sortAsc]);

  // ── Pagination slice ────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filteredSales.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedSales = useMemo(() => {
    const from = (safePage - 1) * pageSize;
    return filteredSales.slice(from, from + pageSize);
  }, [filteredSales, safePage, pageSize]);

  // ── Detail modal (P2-4: cached) ────────────────────────────────
  const openDetail = useCallback(async (id: string) => {
    // Check cache first to avoid re-fetching recently viewed sales
    const cached = detailCacheRef.current.get(id);
    if (cached) {
      setDetail(cached);
      setDetailLoading(false);
      // Still fetch refunds (they may have changed)
      const refundData = await settleRead('refunds', listRefundsScoped(sessionToken!, id));
      setRefundsUnknown(!refundData.ok);
      setRefunds(refundData.ok ? refundData.value : []);
      // Margin is a live report (costs can change) — always refresh.
      const marginData = await settleRead(
        'sale_line_margins',
        sessionToken ? getSaleLineMarginsScoped(sessionToken, id) : Promise.resolve([]),
      );
      setMarginsUnknown(!marginData.ok);
      setLineMargins(marginData.ok ? marginData.value : []);
      return;
    }

    setDetailLoading(true);
    setRefunds([]);
    setRefundsUnknown(false);
    setLineMargins([]);
    setMarginsUnknown(false);
    try {
      const [sale, refundData, marginData] = await Promise.all([
        // Three calls, three different scoping treatments in one expression: this one was
        // ambient, the next asserts a token with `!`, the third uses the ADR #7 conditional.
        // Now all three resolve from the session when one exists.
        sessionToken ? getSaleScoped(sessionToken, id) : getSale(id),
        settleRead('refunds', listRefundsScoped(sessionToken!, id)),
        settleRead(
          'sale_line_margins',
          sessionToken
            ? getSaleLineMarginsScoped(sessionToken, id)
            : Promise.resolve([] as SaleLineMarginDto[]),
        ),
      ]);
      // Cache the result for future re-opens (null-safe: getSale can return null)
      if (sale) {
        detailCacheRef.current.set(id, sale);
      }
      setDetail(sale);
      setRefundsUnknown(!refundData.ok);
      setRefunds(refundData.ok ? refundData.value : []);
      setMarginsUnknown(!marginData.ok);
      setLineMargins(marginData.ok ? marginData.value : []);
    } catch {
      // IPC unavailable.
    } finally {
      setDetailLoading(false);
    }
  }, [sessionToken]);

  const closeDetail = useCallback(() => {
    setDetail(null);
    setRefunds([]);
    setLineMargins([]);
  }, []);

  const detailExit = useExitAnimation(!!detail, closeDetail);

  const handleReprint = useCallback(async () => {
    if (!detail) return;
    setPrinting(true);
    try {
      await printSalesReceipt(sessionToken!, {
        date: detail.createdAt,
        // Phase 4: print the frozen hierarchy code, never the sale UUID.
        // `display_code` is NULL for legacy sales, so fall back to the id.
        receiptNumber: detail.displayCode ?? detail.id,
        items: detail.lines.map((l): LineItemDto => {
          const item: LineItemDto = {
            name: l.name,
            quantity: l.qty,
            unitPrice: { minorUnits: l.unit_price.minor_units, currency: l.unit_price.currency },
            totalPrice: { minorUnits: l.total_minor, currency: l.unit_price.currency },
          };
          if (l.tax_amount) {
            item.taxAmount = { minorUnits: l.tax_amount.minor_units, currency: l.tax_amount.currency };
          }
          return item;
        }),
        subtotal: { minorUnits: detail.subtotal.minor_units, currency: detail.total.currency },
        ...(detail.taxTotal.minor_units > 0
          ? { tax: { minorUnits: detail.taxTotal.minor_units, currency: detail.total.currency } }
          : {}),
        total: { minorUnits: detail.total.minor_units, currency: detail.total.currency },
        payments: [
          {
            method: detail.paymentMethod ?? l10n.getString('sales-history-export-payment'),
            amount: { minorUnits: detail.total.minor_units, currency: detail.total.currency },
            change: detail.tenderedMinor !== null
              ? { minorUnits: Math.max(0, detail.tenderedMinor - detail.total.minor_units), currency: detail.total.currency }
              : null,
          },
        ],
        fakturPajak: detail.fakturPajak?.formatted ?? null,
      });
    } catch (printErr) {
      // Was `catch { /* Ignore print errors. */ }` — the quietest failure on this
      // screen: the reprint button stopped doing anything and said nothing. On the
      // Android shell it could never do anything (the tablet registers no driver,
      // so the command always rejects), and a cashier reprinting a receipt needs to
      // know the printer, not the app, is what failed.
      console.error('printSalesReceipt (reprint) failed', printErr);
      addToast({
        message: requiredLocalized(l10n, 'payment-toast-print-failed'),
        type: 'warning',
      });
    } finally {
      setPrinting(false);
    }
    // sessionToken is read at :406. Because the catch above deliberately swallows everything,
    // this is the quietest failure in the set: after a hot-swap the reprint presents a dead
    // token, the call rejects, and the UI shows nothing at all -- no toast, no error, just a
    // button that stops doing anything. Listing the token at least makes the next attempt use
    // a live one.
  }, [detail, l10n, sessionToken, addToast]);

  // ── e-Faktur handlers (DJP Coretax / PER-11/PJ/2025) ──────────────
  const handleOpenStamp = useCallback(() => {
    setStampNsfp('');
    setStampKodeTransaksi('01');
    setStampError(null);
    setShowStampModal(true);
  }, []);

  const handleCloseStamp = useCallback(() => {
    setShowStampModal(false);
    setStampError(null);
  }, []);

  const handleConfirmStamp = useCallback(async () => {
    if (!detail || !sessionToken) return;
    const cleanNsfp = stampNsfp.replace(/\D/g, '');
    if (cleanNsfp.length !== 13) {
      setStampError('NSFP must be exactly 13 digits (PER-11/PJ/2025)');
      return;
    }
    setStamping(true);
    setStampError(null);
    try {
      const updated = await stampFakturPajakScoped(sessionToken, {
        saleId: detail.id,
        nsfp: cleanNsfp,
        kodeTransaksi: stampKodeTransaksi,
      });
      setDetail((prev) => (prev ? { ...prev, fakturPajak: updated } : null));
      invalidateCache(detail.id);
      load();
      setShowStampModal(false);
      addToast({
        message: 'e-Faktur NSFP successfully stamped',
        type: 'success',
      });
    } catch (err) {
      // ERR-10: the raw backend message used to go straight into this state and
      // was then rendered inside the stamp modal, so a failed stamp showed the
      // operator backend text instead of a mapped, localized sentence. The
      // void path twelve lines up (:349) already used l10nErrorMessage; this
      // arm and the pengganti toast below were the two that missed the sweep.
      setStampError(l10nErrorMessage(err, l10n, 'sales-history-stamp-error'));
    } finally {
      setStamping(false);
    }
  }, [detail, sessionToken, stampNsfp, stampKodeTransaksi, invalidateCache, load, addToast, l10n]);

  const handleCreatePengganti = useCallback(async () => {
    if (!detail || !sessionToken || !detail.fakturPajak) return;
    setPenggantiLoading(true);
    try {
      const updated = await createFakturPenggantiScoped(sessionToken, detail.id);
      setDetail((prev) => (prev ? { ...prev, fakturPajak: updated } : null));
      invalidateCache(detail.id);
      load();
      addToast({
        message: `Faktur Pengganti created (${updated.formatted})`,
        type: 'success',
      });
    } catch (err) {
      addToast({
        // ERR-10: this arm used to interpolate the raw thrown message into the
        // toast, putting backend text in front of the operator. plainErrorMessage
        // maps a typed AppError to its user-safe sentence and falls back
        // otherwise — the same normalizer the rest of the swept screens use.
        message: plainErrorMessage(err, l10n.getString('sales-history-pengganti-error')),
        type: 'error',
      });
    } finally {
      setPenggantiLoading(false);
    }
  }, [detail, sessionToken, invalidateCache, load, addToast, l10n]);

  // ── Refund handlers ──────────────────────────────────────────
  const openRefund = useCallback(() => {
    if (!detail) return;
    setRefundSaleId(detail.id);
  }, [detail]);

  const closeRefund = useCallback(() => {
    setRefundSaleId(null);
  }, []);

  const loadRefunds = useCallback(async (saleId: string) => {
    setRefundsLoading(true);
    const data = await settleRead('refunds', listRefundsScoped(sessionToken!, saleId));
    setRefundsUnknown(!data.ok);
    setRefunds(data.ok ? data.value : []);
    setRefundsLoading(false);
    // sessionToken is a free variable from useWorkspace() at :164, read at :451. The sibling
    // effect above already lists [sessionToken, l10n] at :227, so the token was understood to
    // change -- this array just omitted it. With [] the callback kept the mount-time token, and
    // because :467 lists loadRefunds in its own deps, the refund list for an opened sale was
    // fetched against whatever session was active when the screen mounted.
  }, [sessionToken]);

  // The margin read's own retry, deliberately NOT openDetail: the sale itself is
  // cached and unchanged, and re-opening it would also clear the refund state
  // the operator may still be reading next to this alert.
  const loadMargins = useCallback(async (saleId: string) => {
    const data = await settleRead(
      'sale_line_margins',
      sessionToken
        ? getSaleLineMarginsScoped(sessionToken, saleId)
        : Promise.resolve([] as SaleLineMarginDto[]),
    );
    setMarginsUnknown(!data.ok);
    setLineMargins(data.ok ? data.value : []);
  }, [sessionToken]);

  const handleRefunded = useCallback(() => {
    closeRefund();
    if (detail) {
      invalidateCache(detail.id);
      loadRefunds(detail.id);
    }
    load();
  }, [closeRefund, detail, loadRefunds, load, invalidateCache]);

  // ── Cashier display helper ─────────────────────────────────────
  // The em dash is reserved for the one claim we can actually make: the sale
  // records no cashier. When the roster did not load, `staff` is empty, and the
  // `userId.slice(0, 8)` fallback would then print a truncated id for EVERY
  // row -- a different name that looks like a real one, and it reaches the CSV
  // export too. The dash is a visible gap instead.
  const cashierName = useCallback((userId: string | null): string => {
    if (!userId) return '—';
    const s = staff.find((m) => m.id === userId);
    if (s) return s.display_name;
    return staffUnknown ? '—' : userId.slice(0, 8);
  }, [staff, staffUnknown]);

  const [csvExporting, setCsvExporting] = useState(false);

  const handleExportCsv = useCallback(async () => {
    if (csvExporting) return;
    setCsvExporting(true);
    try {
      const headers = [
        l10n.getString('sales-history-export-id'),
        l10n.getString('sales-history-export-date'),
        l10n.getString('sales-history-export-total'),
        l10n.getString('sales-history-export-items'),
        l10n.getString('sales-history-export-status'),
        l10n.getString('sales-history-export-payment'),
        l10n.getString('sales-history-export-cashier'),
        l10n.getString('sales-history-export-sku'),
        l10n.getString('sales-history-export-product'),
        l10n.getString('sales-history-export-qty'),
        l10n.getString('sales-history-export-unit-price'),
        l10n.getString('sales-history-export-unit-cost'),
        l10n.getString('sales-history-export-line-margin'),
        l10n.getString('sales-history-export-margin-pct'),
      ];
      // Export ALL filtered results, not just current page — one CSV row per
      // sale line, with per-line cost (HPP) and margin from the report layer.
      //
      // A sale whose margin read FAILED is exported with its per-line cells
      // blank, the same shape as a sale with no line data -- and the file that
      // leaves the machine then reads as though those costs were zero. So the
      // operator is told, by count, once for the whole file: the summary rows are
      // still worth having and the gap is still visible on the way out.
      const withLines = await Promise.all(
        filteredSales.map(async (s) => {
          const marginData = await settleRead(
            'sale_line_margins',
            sessionToken
              ? getSaleLineMarginsScoped(sessionToken, s.id)
              : Promise.resolve([] as SaleLineMarginDto[]),
          );
          return { sale: s, marginData };
        }),
      );
      const unanswered = withLines.filter((w) => !w.marginData.ok);
      if (unanswered.length > 0) {
        addToast({
          message: requiredLocalized(l10n, 'sales-history-export-margins-unknown', {
            count: String(unanswered.length),
          }),
          type: 'warning',
        });
      }
      // The count names SALES whose margins are missing, not lines: one sale can
      // carry many lines, and the operator needs to know how much of the file to
      // distrust before it leaves the machine.
      const rows: string[][] = [];
      for (const { sale: s, marginData } of withLines) {
        const margins = marginData.ok ? marginData.value : [];
        const context = [
          s.id,
          new Date(s.createdAt).toLocaleString(),
          formatMoney(s.total),
          String(s.lineCount),
          s.status,
          s.paymentMethod ?? '',
          cashierName(s.userId),
        ];
        if (margins.length === 0) {
          // No per-line data: either the sale genuinely has none, or the read did
          // not answer (warned above). Either way the summary row stands alone.
          rows.push([...context, '', '', '', '', '', '', '']);
          continue;
        }
        for (const l of margins) {
          rows.push([
            ...context,
            l.sku,
            l.name,
            String(l.qty),
            formatMoney({ minor_units: l.unit_price_minor, currency: s.total.currency }),
            formatMoney({ minor_units: l.unit_cost_minor, currency: s.total.currency }),
            formatMoney({ minor_units: l.margin_minor, currency: s.total.currency }),
            `${l.margin_percent.toFixed(1)}%`,
          ]);
        }
      }
      const bom = '\uFEFF';
      const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
      const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sales-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
    } finally {
      setCsvExporting(false);
    }
  }, [filteredSales, cashierName, l10n, sessionToken, csvExporting, addToast]);

  // ── Focus trap refs ───────────────────────────────
  const voidPanelRef = useRef<HTMLDivElement>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(voidPanelRef, voidExit.shouldRender && !voidExit.exiting, voidExit.requestClose);
  useFocusTrap(detailPanelRef, detailExit.shouldRender && !detailExit.exiting, detailExit.requestClose);

  return (
    <div className="sales-history" {...pullRefreshProps}>
      {/* P7-3: Pull-to-refresh indicator */}
      {pullState !== 'idle' && (
        <div
          className="sales-history-pull-indicator"
          style={{
            transform: `translateY(${pullDistance}px)`,
            opacity: Math.min(1, pullDistance / 60),
          }}
        >
          {pullState === 'pulling' && (
            <Localized id="sales-history-pull-to-refresh">
              <span>Pull down to refresh</span>
            </Localized>
          )}
          {pullState === 'ready' && (
            <Localized id="sales-history-release-to-refresh">
              <span>Release to refresh</span>
            </Localized>
          )}
          {pullState === 'loading' && <span className="sales-history-refresh-spinner" />}
        </div>
      )}
      <div className="sales-history-header">
        <div className="sales-history-header-left">
          <Localized id="sales-history-title">
            <h1 className="sales-history-title">Sales History</h1>
          </Localized>
          {!loading && (
            <span className="sales-history-count">
              <Localized id="sales-history-count" vars={{ count: filteredSales.length }}>
                <>{filteredSales.length} sale{filteredSales.length !== 1 ? 's' : ''}</>
              </Localized>
            </span>
          )}
          {!loading && filteredSales.length > pageSize && (
            <span className="sales-history-page-info">
              <Localized id="sales-history-page-info" vars={{ current: safePage, total: totalPages }}>
                <span>Page {safePage} of {totalPages}</span>
              </Localized>
            </span>
          )}
        </div>
        <div className="sales-history-header-actions">
          <Localized id="sales-history-export-csv">
            <button type="button" className="sales-history-export-btn" onClick={handleExportCsv} disabled={csvExporting}>
              {csvExporting ? (
                <Localized id="sales-history-exporting"><span>Exporting…</span></Localized>
              ) : (
                <span>Export CSV</span>
              )}
            </button>
          </Localized>
        </div>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────── */}
      <Localized id="sales-history-filter-aria" attrs={{ 'aria-label': true }}>
        <div className="sales-history-filters" role="search" aria-label={l10n.getString('filter-sales-aria')}>
        {/* Search */}
        <div className="sales-history-filter-group">
          <Localized id="sales-history-search-label">
            <label className="sales-history-filter-label" htmlFor="sh-search"><span>Search</span></label>
          </Localized>
          <Localized id="sales-history-search-placeholder" attrs={{ placeholder: true }}>
            <Localized id="sales-history-search-aria" attrs={{ 'aria-label': true }}>
              <input
                id="sh-search"
                type="text"
                className="sales-history-filter-input"
                placeholder="Search sale ID, payment, cashier…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={l10n.getString('search-aria')}
              />
            </Localized>
          </Localized>
        </div>

        {/* Status filter */}
        <div className="sales-history-filter-group">
          <Localized id="sales-history-status-label">
            <span className="sales-history-filter-label"><span>Status</span></span>
          </Localized>
          <Localized id="sales-history-status-filter-aria" attrs={{ 'aria-label': true }}>
            <div className="sales-history-filter-chips" role="radiogroup" aria-label={l10n.getString('filter-status-aria')}>
              {STATUS_OPTIONS.map((opt) => {
                const statusIds: Record<string, string> = {
                  'All': 'sales-history-status-all',
                  'Completed': 'sales-history-status-completed',
                  'Pending': 'sales-history-status-pending',
                  'Voided': 'sales-history-status-voided',
                };
                return (
                  <Localized id={statusIds[opt] ?? opt} key={opt}>
                    <button
                      type="button"
                      role="radio"
                      className={`sales-history-chip ${statusFilter === opt ? 'sales-history-chip--active' : ''}`}
                      onClick={() => setStatusFilter(opt)}
                      aria-checked={statusFilter === opt}
                    >
                      <span>{opt}</span>
                    </button>
                  </Localized>
                );
              })}
            </div>
          </Localized>
        </div>

        {/* Date range */}
        <div className="sales-history-filter-group">
          <Localized id="sales-history-from-label">
            <label className="sales-history-filter-label" htmlFor="sh-date-from"><span>From</span></label>
          </Localized>
          <Localized id="sales-history-date-from-aria" attrs={{ 'aria-label': true }}>
            <input
              id="sh-date-from"
              type="date"
              className="sales-history-filter-date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label={l10n.getString('from-date-aria')}
            />
          </Localized>
        </div>
        <div className="sales-history-filter-group">
          <Localized id="sales-history-to-label">
            <label className="sales-history-filter-label" htmlFor="sh-date-to"><span>To</span></label>
          </Localized>
          <Localized id="sales-history-date-to-aria" attrs={{ 'aria-label': true }}>
            <input
              id="sh-date-to"
              type="date"
              className="sales-history-filter-date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label={l10n.getString('to-date-aria')}
            />
          </Localized>
        </div>

        {/* Cashier filter */}
        <div className="sales-history-filter-group">
          <Localized id="sales-history-cashier-label">
            <label className="sales-history-filter-label" htmlFor="sh-cashier"><span>Cashier</span></label>
          </Localized>
          <Localized id="sales-history-cashier-aria" attrs={{ 'aria-label': true }}>
            <select
              id="sh-cashier"
              className="sales-history-filter-select"
              value={cashierFilter}
              onChange={(e) => setCashierFilter(e.target.value)}
              aria-label={l10n.getString('filter-cashier-aria')}
            >
            <Localized id="sales-history-cashier-all">
              <option value=""><span>All Cashiers</span></option>
            </Localized>
            {/* No `staffUnknown` guard here, and deliberately: the map is already
                empty when the read failed, so a guard would be a dead condition. The
                alert below the filters is the load-bearing part -- an option list of
                only 'All Cashiers' is the claim being made wrong. */}
            {staff.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
          </Localized>
        </div>
      </div>
      </Localized>

      {/* ── The roster read that did not answer ────────────── */}
      {/* The Cashier filter and every cashier name on this screen are built from
           one list. A failed read emptied it silently, so the filter offered only
           'All Cashiers' -- a claim about the store's roster rather than about
           this screen's knowledge -- and the table fell back to truncated ids.
           list_staff_scoped requires STAFF_READ (crates/kasirmu-bridge/src/staff.rs:349),
           so a refused read is an expected outcome for a session that may still
           read sales history; it is not a malfunction to be papered over. */}
      {staffUnknown && (
        <div className="sales-history-staff-unknown" role="alert">
          <Localized id="sales-history-staff-unknown">
            <span>Cashier names could not be loaded</span>
          </Localized>
          <Button variant="secondary" size="sm" onClick={() => { void load(); }}>
            <Localized id="retry"><span>Retry</span></Localized>
          </Button>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────── */}
      {loading ? (
        <div className="sales-history-loading-skeleton" aria-hidden="true">
          <div className="sales-history-header">
            <Skeleton variant="block" width="10rem" height="1.75rem" />
            <Skeleton variant="block" width="7rem" height="2rem" />
          </div>
          <div className="sales-history-filters">
            <div className="sales-history-filter-group">
              <Skeleton width="3rem" height="0.75rem" />
              <Skeleton variant="block" width="12.5rem" height="2.125rem" style={{ borderRadius: 'var(--radius-md)' }} />
            </div>
            <div className="sales-history-filter-group">
              <Skeleton width="3rem" height="0.75rem" />
              <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} variant="block" width="4rem" height="1.75rem" style={{ borderRadius: 'var(--radius-full)' }} />
                ))}
              </div>
            </div>
            {[0, 1, 2].map((g) => (
              <div key={g} className="sales-history-filter-group">
                <Skeleton width="2.5rem" height="0.75rem" />
                <Skeleton variant="block" width="7rem" height="2.125rem" style={{ borderRadius: 'var(--radius-md)' }} />
              </div>
            ))}
          </div>
          <div className="sales-history-table-wrap">
            <table className="sales-history-table" aria-hidden="true">
              <thead>
                <tr>
                  {['Sale ID', 'Receipt', 'Date', 'Total', 'Items', 'Status', 'Payment', 'Cashier', ''].map((_, i) => (
                    <th key={i}><Skeleton width="4rem" height="0.75rem" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>{Array.from({ length: 5 }, (_, r) => (
                  <tr key={r}>
                    <td><Skeleton width="5rem" height="0.875rem" /></td>
                    <td><Skeleton width="6rem" height="0.875rem" /></td>
                    <td><Skeleton width="7rem" height="0.875rem" /></td>
                    <td><Skeleton width="4rem" height="0.875rem" /></td>
                    <td><Skeleton width="2rem" height="0.875rem" /></td>
                    <td><Skeleton variant="block" width="4.5rem" height="1.125rem" style={{ borderRadius: 'var(--radius-full)' }} /></td>
                    <td><Skeleton width="4rem" height="0.875rem" /></td>
                    <td><Skeleton width="5rem" height="0.875rem" /></td>
                    <td className="sales-history-cell-actions">
                      <Skeleton variant="block" width="3rem" height="1.375rem" style={{ borderRadius: 'var(--radius-md)' }} />
                    </td>
                  </tr>
                ))}
</tbody>
            </table>
          </div>
        </div>
      ) : loadError && sales.length === 0 ? (
        <Card shadow="sm">
          <div className="sales-history-empty">
            <ErrorState
              title={loadError}
              headingLevel={2}
              onRetry={() => { load(); }}
              retryLabel={requiredLocalized(l10n, 'retry')}
            />
          </div>
        </Card>
      ) : filteredSales.length === 0 ? (
        <>
          <Card shadow="sm">
            <div className="sales-history-empty">
              {sales.length === 0 ? (
                <EmptyState
                  icon={<NoSalesIcon />}
                  headingLevel={2}
                  title={requiredLocalized(l10n, 'sales-history-empty')}
                />
              ) : (
                <EmptyState
                  icon={<NotFoundIcon />}
                  headingLevel={2}
                  title={requiredLocalized(l10n, 'sales-history-empty-filtered')}
                  action={{
                    label: requiredLocalized(l10n, 'sales-history-clear-filters'),
                    onClick: () => { setSearchQuery(''); setStatusFilter('All'); setDateFrom(''); setDateTo(''); setCashierFilter(''); },
                  }}
                />
              )}
            </div>
          </Card>
          {/* C1.2: history exists but everything fell outside the tier's
              window (Free = 3 months) — surface the upgrade teaser. */}
          {salesHistoryCapped && sales.length > 0 && (
            <SalesHistoryCapTeaser onUpgrade={openUpgradePricing} />
          )}
        </>
      ) : (
        <div className="sales-history-table-wrap">
          <Localized id="sales-history-table-aria" attrs={{ 'aria-label': true }}>
            <table className="sales-history-table" aria-label={l10n.getString('sales-history-aria')}>
            <thead>
              <tr>
                <Localized id="sales-history-col-id">
                  <th className="sales-history-th" aria-sort={sortKey === 'id' ? (sortAsc ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="sales-history-sort-btn" onClick={() => toggleSort('id')}>
                      Sale ID
                      {sortKey === 'id' && <span className="sales-history-sort-arrow" aria-hidden="true">{sortAsc ? ' \u25B2' : ' \u25BC'}</span>}
                    </button>
                  </th>
                </Localized>
                {/* Phase 4: frozen receipt hierarchy code column (no sort —
                    the code is not a useful sort key). */}
                <th><span>Receipt</span></th>
                <Localized id="sales-history-col-date">
                  <th className="sales-history-th" aria-sort={sortKey === 'createdAt' ? (sortAsc ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="sales-history-sort-btn" onClick={() => toggleSort('createdAt')}>
                      Date
                      {sortKey === 'createdAt' && <span className="sales-history-sort-arrow" aria-hidden="true">{sortAsc ? ' \u25B2' : ' \u25BC'}</span>}
                    </button>
                  </th>
                </Localized>
                <Localized id="sales-history-col-total">
                  <th className="sales-history-th" aria-sort={sortKey === 'total' ? (sortAsc ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="sales-history-sort-btn" onClick={() => toggleSort('total')}>
                      Total
                      {sortKey === 'total' && <span className="sales-history-sort-arrow" aria-hidden="true">{sortAsc ? ' \u25B2' : ' \u25BC'}</span>}
                    </button>
                  </th>
                </Localized>
                <Localized id="sales-history-col-items">
                  <th className="sales-history-th" aria-sort={sortKey === 'lineCount' ? (sortAsc ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="sales-history-sort-btn" onClick={() => toggleSort('lineCount')}>
                      Items
                      {sortKey === 'lineCount' && <span className="sales-history-sort-arrow" aria-hidden="true">{sortAsc ? ' \u25B2' : ' \u25BC'}</span>}
                    </button>
                  </th>
                </Localized>
                <Localized id="sales-history-col-status">
                  <th className="sales-history-th" aria-sort={sortKey === 'status' ? (sortAsc ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="sales-history-sort-btn" onClick={() => toggleSort('status')}>
                      Status
                      {sortKey === 'status' && <span className="sales-history-sort-arrow" aria-hidden="true">{sortAsc ? ' \u25B2' : ' \u25BC'}</span>}
                    </button>
                  </th>
                </Localized>
                <Localized id="sales-history-col-payment">
                  <th className="sales-history-th" aria-sort={sortKey === 'paymentMethod' ? (sortAsc ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="sales-history-sort-btn" onClick={() => toggleSort('paymentMethod')}>
                      Payment
                      {sortKey === 'paymentMethod' && <span className="sales-history-sort-arrow" aria-hidden="true">{sortAsc ? ' \u25B2' : ' \u25BC'}</span>}
                    </button>
                  </th>
                </Localized>
                <Localized id="sales-history-col-cashier">
                  <th><span>Cashier</span></th>
                </Localized>
                <Localized id="sales-history-actions-aria" attrs={{ 'aria-label': true }}>
                  <th aria-label={l10n.getString('actions-aria')}> </th>
                </Localized>
              </tr>
            </thead>
            <tbody>{paginatedSales.map((s) => (
                <SwipeableOrderRow
                  key={s.id}
                  sale={s}
                  isManager={isManager}
                  onView={openDetail}
                  onVoid={handleOpenVoid}
                  cashierName={cashierName(s.userId)}
                />
              ))}
</tbody>
            </table>
          </Localized>
          {/* C1.2: the tier's history window truncated this list — blurred
              teaser row below the table with an upgrade CTA. */}
          {salesHistoryCapped && (
            <SalesHistoryCapTeaser onUpgrade={openUpgradePricing} />
          )}
        </div>
      )}

      {/* ── Pagination controls ────────────────────────────── */}
      {!loading && filteredSales.length > pageSize && (
        <Localized id="sales-history-pagination-aria" attrs={{ 'aria-label': true }}>
        <nav className="sales-history-pagination" aria-label={l10n.getString('pagination-aria')}>
          <Localized id="sales-history-prev-aria" attrs={{ 'aria-label': true }}>
          <Localized id="sales-history-prev-page">
            <button
              type="button"
              className="sales-history-page-btn"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label={l10n.getString('previous-page-aria')}
            >
              <span>&larr; Prev</span>
            </button>
          </Localized>
          </Localized>
          <span className="sales-history-page-indicator">
            <Localized id="sales-history-page-info" vars={{ current: safePage, total: totalPages }}>
              <span>Page {safePage} of {totalPages}</span>
            </Localized>
          </span>
          <Localized id="sales-history-next-aria" attrs={{ 'aria-label': true }}>
          <Localized id="sales-history-next-page">
            <button
              type="button"
              className="sales-history-page-btn"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label={l10n.getString('next-page-aria')}
            >
              <span>Next &rarr;</span>
            </button>
          </Localized>
          </Localized>
          <span className="sales-history-page-size-group">
            <Localized id="sales-history-per-page-label">
              <label htmlFor="sh-page-size" className="sales-history-page-size-label"><span>Per page</span></label>
            </Localized>
            <Localized id="sales-history-per-page-aria" attrs={{ 'aria-label': true }}>
            <select
              id="sh-page-size"
              className="sales-history-page-size-select"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              aria-label={l10n.getString('results-per-page-aria')}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            </Localized>
          </span>
        </nav>
        </Localized>
      )}

      {/* ── Refund modal ────────────────────────────────────────── */}
      {detail && refundSaleId === detail.id && (
        <RefundModal
          open
          sale={detail}
          onClose={closeRefund}
          onRefunded={handleRefunded}
        />
      )}

      {/* ── Void Confirmation Modal ──────────────────────────── */}
      {voidExit.shouldRender && voidTarget && (
        <Localized id="sales-history-void-overlay-aria" attrs={{ 'aria-label': true }}>
        <div className={`sales-history-overlay${voidExit.exiting ? ' sales-history-overlay--exiting' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('void-order-aria')}>
          <div ref={voidPanelRef} className={`sales-history-modal sales-history-void-modal${voidExit.exiting ? ' sales-history-modal--exiting' : ''}`}>
            <div className="sales-history-modal-header">
              <Localized id="sales-history-void-title">
                <h2><span>Void Order</span></h2>
              </Localized>
              <Localized id="sales-history-void-close-aria" attrs={{ 'aria-label': true }}>
                <button
                  type="button"
                  className="sales-history-modal-close"
                  onClick={voidExit.requestClose}
                  aria-label={l10n.getString('close-void-aria')}
                >
                  &times;
                </button>
              </Localized>
            </div>
            <div className="sales-history-modal-body">
              <Localized id="sales-history-void-desc" vars={{ id: voidTarget.id.slice(0, 8), amount: formatMoney(voidTarget.total) }}>
                <p className="sales-history-void-desc">
                  <span>This will cancel order <strong>{voidTarget.id.slice(0, 8)}</strong>
                  {' '}for {formatMoney(voidTarget.total)} and restore inventory.
                  This action cannot be undone.</span>
                </p>
              </Localized>

              <div className="sales-history-void-field">
                <Localized id="sales-history-void-reason-label">
                  <label htmlFor="sh-void-reason" className="sales-history-void-label">
                    <span>Reason for void</span>
                  </label>
                </Localized>
                <Localized id="sales-history-void-reason-aria" attrs={{ 'aria-label': true }}>
                <Localized id="sales-history-void-reason-placeholder" attrs={{ placeholder: true }}>
                  <input
                    id="sh-void-reason"
                    type="text"
                    className="sales-history-void-input"
                    placeholder="e.g. Customer cancellation"
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    aria-label={l10n.getString('void-reason-aria')}
                  />
                </Localized>
                </Localized>
              </div>

              {voidError && (
                <div className="sales-history-void-error" role="alert">
                  {voidError}
                </div>
              )}

              <div className="sales-history-modal-actions">
                <Localized id="sales-history-void-cancel">
                  <Button variant="ghost" onClick={voidExit.requestClose} disabled={voiding}>
                    <span>Cancel</span>
                  </Button>
                </Localized>
                <Localized id={voiding ? 'sales-history-void-progress' : 'sales-history-void-confirm'}>
                  <Button
                    variant="danger"
                    onClick={handleConfirmVoid}
                    loading={voiding}
                  >
                    <span>{voiding ? 'Voiding…' : 'Confirm Void'}</span>
                  </Button>
                </Localized>
              </div>
            </div>
          </div>
        </div>
        </Localized>
      )}

      {/* ── Stamp e-Faktur Modal (PER-11/PJ/2025) ──────────────────── */}
      {showStampModal && (
        <div className="sales-history-overlay" role="dialog" aria-modal="true" aria-label="Stamp e-Faktur NSFP">
          <div className="sales-history-modal sales-history-stamp-modal" style={{ maxWidth: '460px' }}>
            <div className="sales-history-modal-header">
              <h2><span>Input e-Faktur NSFP (DJP Coretax)</span></h2>
              <button
                type="button"
                className="sales-history-modal-close"
                onClick={handleCloseStamp}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="sales-history-modal-body">
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted, #64748b)', marginBottom: '1rem' }}>
                Masukkan 13-digit Nomor Seri Faktur Pajak (NSFP) yang diterbitkan oleh DJP Coretax untuk transaksi ini.
              </p>

              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="stamp-kode-transaksi" style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  Kode Transaksi (PER-11/PJ/2025)
                </label>
                <select
                  id="stamp-kode-transaksi"
                  value={stampKodeTransaksi}
                  onChange={(e) => setStampKodeTransaksi(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color, #cbd5e1)' }}
                >
                  <option value="01">01 - Penyerahan BKP/JKP kepada selain Pemungut PPN</option>
                  <option value="02">02 - Penyerahan BKP/JKP kepada Pemungut Bendaharawan Pemerintah</option>
                  <option value="03">03 - Penyerahan BKP/JKP kepada Pemungut selain Bendaharawan</option>
                  <option value="04">04 - Penyerahan BKP/JKP yang PPN-nya Dipungut dengan Besaran Tertentu</option>
                  <option value="05">05 - Penyerahan BKP/JKP Tertentu</option>
                  <option value="06">06 - Penyerahan Lainnya</option>
                  <option value="07">07 - Penyerahan BKP/JKP yang PPN-nya Tidak Dipungut</option>
                  <option value="08">08 - Penyerahan BKP/JKP yang Dibebaskan dari Pengenaan PPN</option>
                  <option value="09">09 - Penyerahan BKP berupa Aktiva (Pasal 16D UU PPN)</option>
                  <option value="10">10 - Penyerahan BKP/JKP dengan PPN Ditanggung Pemerintah (DTP)</option>
                </select>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="stamp-nsfp" style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                  13-Digit NSFP
                </label>
                <input
                  id="stamp-nsfp"
                  type="text"
                  maxLength={13}
                  placeholder="e.g. 2600000000123"
                  value={stampNsfp}
                  onChange={(e) => setStampNsfp(e.target.value.replace(/\D/g, ''))}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color, #cbd5e1)', fontFamily: 'monospace' }}
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', marginTop: '0.25rem' }}>
                  Format Faktur Pajak: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{stampKodeTransaksi}00{stampNsfp.padEnd(13, '·')}</span>
                </div>
              </div>

              {stampError && (
                <div className="sales-history-void-error" role="alert" style={{ marginBottom: '1rem' }}>
                  {stampError}
                </div>
              )}

              <div className="sales-history-modal-actions">
                <Button variant="ghost" onClick={handleCloseStamp} disabled={stamping}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleConfirmStamp}
                  loading={stamping}
                  disabled={stampNsfp.length !== 13}
                >
                  Stamp e-Faktur
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail modal ────────────────────────────────────────── */}
      {detailExit.shouldRender && detail && (
        <Localized id="sales-history-detail-overlay-aria" attrs={{ 'aria-label': true }}>
        <div className={`sales-history-overlay${detailExit.exiting ? ' sales-history-overlay--exiting' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('sale-detail-aria')}>
          <div ref={detailPanelRef} className={`sales-history-modal${detailExit.exiting ? ' sales-history-modal--exiting' : ''}`}>
            <div className="sales-history-modal-header">
              <Localized id="sales-history-detail-title">
                <h2>Sale Detail</h2>
              </Localized>
              <Localized id="sales-history-detail-close-aria" attrs={{ 'aria-label': true }}>
              <Localized id="sales-history-detail-close">
                <button
                  type="button"
                  className="sales-history-modal-close"
                  onClick={detailExit.requestClose}
                  aria-label={l10n.getString('close-aria')}
                >
                  &times;
                </button>
              </Localized>
              </Localized>
            </div>            {detailLoading ? (
              <div className="sales-history-detail-skeleton" aria-hidden="true">
                <div className="sales-history-detail-meta">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i}>
                      <Skeleton width="3rem" height="0.75rem" />
                      <Skeleton width="70%" height="0.875rem" style={{ marginTop: '0.25rem' }} />
                    </div>
                  ))}
                </div>
                <table className="sales-history-lines-table" aria-hidden="true">
                  <thead>
                    <tr>
                      {['SKU', 'Name', 'Qty', 'Unit Price', 'Total'].map((_, i) => (
                        <th key={i}><Skeleton width="3rem" height="0.75rem" /></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{Array.from({ length: 4 }, (_, r) => (
                      <tr key={r}>
                        <td><Skeleton width="4rem" height="0.875rem" /></td>
                        <td><Skeleton width="6rem" height="0.875rem" /></td>
                        <td><Skeleton width="2rem" height="0.875rem" /></td>
                        <td><Skeleton width="3rem" height="0.875rem" /></td>
                        <td><Skeleton width="3rem" height="0.875rem" /></td>
                      </tr>
                    ))}
</tbody>
                </table>
              </div>
            ) : (
              <div className="sales-history-modal-body">
                <div className="sales-history-detail-meta">
                  <div>
                    <Localized id="sales-history-detail-id">
                      <strong><span>ID:</span></strong>
                    </Localized>
                    {' '}{detail.id}
                  </div>
                  {/* Phase 4: show the frozen receipt hierarchy code (the
                      statutory nomor faktur), never the raw sale UUID. */}
                  <div>
                    <strong><span>Receipt:</span></strong>
                    {' '}{detail.displayCode ?? detail.id}
                  </div>
                  <div>
                    <Localized id="sales-history-detail-date">
                      <strong><span>Date:</span></strong>
                    </Localized>
                    {' '}{new Date(detail.createdAt).toLocaleString()}
                  </div>
                  <div>
                    <Localized id="sales-history-detail-status">
                      <strong><span>Status:</span></strong>
                    </Localized>
                    {' '}
                    <Badge variant={statusBadgeVariant(detail.status)}>
                      <Localized id={statusFluentId(detail.status)}>
                        <span>{detail.status}</span>
                      </Localized>
                    </Badge>
                  </div>
                  <div>
                    <Localized id="sales-history-detail-payment">
                      <strong><span>Payment:</span></strong>
                    </Localized>
                    {' '}{detail.paymentMethod ?? '\u2014'}
                  </div>
                  <div>
                    <Localized id="sales-history-detail-cashier">
                      <strong><span>Cashier:</span></strong>
                    </Localized>
                    {' '}{cashierName(detail.userId)}
                  </div>
                  <div>
                    <Localized id="sales-history-detail-subtotal">
                      <strong><span>Subtotal:</span></strong>
                    </Localized>
                    {' '}{formatMoney(detail.subtotal)}
                  </div>
                  {detail.taxTotal.minor_units > 0 && (
                    <div>
                      <Localized id="sales-history-detail-tax">
                        <strong><span>Tax:</span></strong>
                      </Localized>
                      {' '}{formatMoney(detail.taxTotal)}
                      {isTaxEstimated(detail.taxEstimateNote) && (
                        <Badge variant="warning" style={{ marginLeft: 8 }}>
                          <Localized id="sales-history-tax-estimated-badge">
                            <span>Estimated</span>
                          </Localized>
                        </Badge>
                      )}
                    </div>
                  )}
                  <div>
                    <Localized id="sales-history-detail-total">
                      <strong><span>Total:</span></strong>
                    </Localized>
                    {' '}{formatMoney(detail.total)}
                    {/* Same as the Previous Refunds gate below: a failed read clears
                        the list, so `refunds.length > 0` is already false. The flag is
                        not repeated here. */}
                    {refunds.length > 0 && (
                      <Badge variant="warning" style={{ marginLeft: 8 }}>
                        <Localized id="refund-status-refunded">
                          <span>Refunded</span>
                        </Localized>
                      </Badge>
                    )}
                  </div>
                </div>

                {/* ── e-Faktur Section (DJP Coretax / PER-11/PJ/2025) ── */}
                <div
                  className="sales-history-efaktur-section"
                  style={{
                    margin: '1rem 0',
                    padding: '0.75rem 1rem',
                    background: 'var(--bg-subtle, #f8f9fa)',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color, #e2e8f0)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>e-Faktur (DJP Coretax)</div>
                      {detail.fakturPajak ? (
                        <div style={{ fontSize: '0.8125rem', marginTop: '0.25rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{detail.fakturPajak.formatted}</span>
                          <Badge variant="success">
                            {detail.fakturPajak.status === '00' ? 'Normal' : `Pengganti (${detail.fakturPajak.status})`}
                          </Badge>
                          <span style={{ color: 'var(--text-muted, #64748b)' }}>
                            NSFP: {detail.fakturPajak.nsfp} | Kode: {detail.fakturPajak.kodeTransaksi}
                          </span>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted, #64748b)', marginTop: '0.25rem' }}>
                          Belum ada e-Faktur (Unstamped)
                        </div>
                      )}
                    </div>
                    {session && isManager && (
                      <div>
                        {detail.fakturPajak ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleCreatePengganti}
                            loading={penggantiLoading}
                          >
                            Create Faktur Pengganti
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleOpenStamp}
                          >
                            Input e-Faktur NSFP
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <Localized id="sales-history-lines-title">
                  <h3><span>Line Items</span></h3>
                </Localized>
                <Localized id="sales-history-lines-aria" attrs={{ 'aria-label': true }}>
                <table className="sales-history-lines-table" aria-label={l10n.getString('sale-line-items-aria')}>
                  <thead>
                    <tr>
                      <Localized id="sales-history-line-sku"><th><span>SKU</span></th></Localized>
                      <Localized id="sales-history-line-name"><th><span>Name</span></th></Localized>
                      <Localized id="sales-history-line-qty"><th><span>Qty</span></th></Localized>
                      <Localized id="sales-history-line-unit-price"><th><span>Unit Price</span></th></Localized>
                      <Localized id="sales-history-line-total"><th><span>Total</span></th></Localized>
                      {/* No `!marginsUnknown` guard on the two column gates, and
                          deliberately: a failed read already clears `lineMargins`, so
                          `lineMargins.length > 0` is false on its own. Mutations that
                          added the flag to either gate passed every test, so it was a dead
                          condition. The load-bearing gate is the alert below, which is
                          what makes the absence visible. */}
                      {lineMargins.length > 0 && (
                        <>
                          <Localized id="sales-history-line-cost"><th><span>Cost</span></th></Localized>
                          <Localized id="sales-history-line-margin"><th><span>Margin</span></th></Localized>
                          <Localized id="sales-history-line-margin-pct"><th><span>Margin %</span></th></Localized>
                        </>
                      )}
                      {detail.lines.some((l) => l.tax_amount) && (
                        <Localized id="sales-history-line-tax"><th><span>Tax</span></th></Localized>
                      )}
                    </tr>
                  </thead>
                  <tbody>{detail.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.sku}</td>
                        <td>{line.name}</td>
                        <td>{line.qty}</td>
                        <td>{formatMoney(line.unit_price)}</td>
                        <td>{formatMoney({ minor_units: line.total_minor, currency: line.unit_price.currency })}</td>
                        {lineMargins.length > 0 && (
                          (() => {
                            const m = lineMargins.find((lm) => lm.sale_line_id === line.id);
                            if (!m) return <td>{'\u2014'}</td>;
                            return (
                              <>
                                <td className="sales-history-cell-mono">{formatMoney({ minor_units: m.unit_cost_minor, currency: line.unit_price.currency })}</td>
                                <td className={`sales-history-cell-mono${m.margin_minor < 0 ? ' sales-history-cell-negative' : ''}`}>{formatMoney({ minor_units: m.margin_minor, currency: line.unit_price.currency })}</td>
                                <td className={`sales-history-cell-mono${m.margin_percent < 0 ? ' sales-history-cell-negative' : ''}`}>{m.margin_percent.toFixed(1)}%</td>
                              </>
                            );
                          })()
                        )}
                        <td>{line.tax_amount ? formatMoney(line.tax_amount) : '\u2014'}</td>
                      </tr>
                    ))}
</tbody>
                </table>
                </Localized>

                {/* ── Margin read did not answer ──────────────── */}
                {marginsUnknown && (
                  /* The Cost / Margin / Margin % columns are gated on the LENGTH
                     of this read, so a failed read removed three columns of a
                     manager's profitability read and said nothing about it. The
                     columns stay hidden -- a dash in a cost column is not a
                     cheaper line -- and this is the only place the gap is named. */
                  <div className="sales-history-margins-unknown" role="alert">
                    <Localized id="margin-history-unknown">
                      <span>Cost and margin for this sale could not be loaded</span>
                    </Localized>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => detail && loadMargins(detail.id)}
                    >
                      <Localized id="retry"><span>Retry</span></Localized>
                    </Button>
                  </div>
                )}

                {/* ── Refund read did not answer ──────────────── */}
                {refundsUnknown && (
                  /* An unanswered read is not "no refunds". Rendering it as the
                     empty case would erase the evidence AND leave the Refund
                     button below enabled against a sale whose refund total is
                     unknown -- and `create_refund` bounds a refund by that
                     cumulative total, so the attempt ends in a validation error
                     the operator cannot predict from what is on screen. Reload
                     is the only action that can change the answer. */
                  <div className="sales-history-refunds-unknown" role="alert">
                    <Localized id="refund-history-unknown">
                      <span>Refunds for this sale could not be loaded</span>
                    </Localized>
                    <Button variant="secondary" size="sm" onClick={() => detail && loadRefunds(detail.id)}>
                      <Localized id="retry"><span>Retry</span></Localized>
                    </Button>
                  </div>
                )}

                {/* ── Previous Refunds ──────────────────────── */}
                {/* No `!refundsUnknown` guard here, and deliberately: a failed read clears
                    the list, so `refunds.length > 0` is already false. Adding the flag
                    would be a dead condition -- mutations that removed it passed every
                    test. The one gate that IS load-bearing is on the Refund button below,
                    which is what the failed read would otherwise leave armed. */}
                {refunds.length > 0 && (
                  <div className="sales-history-refunds">
                    <Localized id="refund-previous-refunds">
                      <h3><span>Previous Refunds</span></h3>
                    </Localized>
                    {refunds.map((rf) => (
                      <div key={rf.id} className="sales-history-refund-item">
                        <div className="sales-history-refund-meta">
                          <span>{new Date(rf.createdAt).toLocaleString()}</span>
                          <span className="sales-history-refund-total">{formatMoney(rf.total)}</span>
                        </div>
                        <div className="sales-history-refund-reason">{rf.reason}</div>
                        <Localized id="sales-history-refund-lines-aria" attrs={{ 'aria-label': true }}>
                        <table className="sales-history-lines-table" aria-label={l10n.getString('refund-line-items-aria')}>
                          <thead>
                            <tr>
                              <Localized id="refund-line-sku"><th><span>SKU</span></th></Localized>
                              <Localized id="refund-line-qty"><th><span>Qty</span></th></Localized>
                              <Localized id="refund-line-total"><th><span>Total</span></th></Localized>
                            </tr>
                          </thead>
                          <tbody>{rf.lines.map((rfl) => (
                              <tr key={rfl.id}>
                                <td>{rfl.sku}</td>
                                <td>{rfl.qty}</td>
                                <td>{formatMoney(rfl.lineTotal)}</td>
                              </tr>
                            ))}
</tbody>
                        </table>
                        </Localized>
                      </div>
                    ))}
                  </div>
                )
}

                <div className="sales-history-modal-actions">
                  <Localized id="sales-history-detail-close">
                    <Button variant="ghost" onClick={detailExit.requestClose}>Close</Button>
                  </Localized>
                  {/* Gated on the refund read having ANSWERED, not merely on the
                      sale being completed: an unanswered read leaves the refunded
                      total unknown, and offering the action is what turns a display
                      gap into a wrong-reason refund rejection. */}
                  {detail.status === 'Completed' && session && !refundsUnknown && (
                    <Localized id="refund-action-refund">
                      <Button variant="secondary" onClick={openRefund}>Refund</Button>
                    </Localized>
                  )}
                  <Localized id="sales-history-detail-print">
                    <Button variant="secondary" onClick={handleReprint} loading={printing}>
                      Reprint Receipt
                    </Button>
                  </Localized>
                </div>
              </div>
            )}
          </div>
        </div>
        </Localized>
      )}
    </div>
  );
}
