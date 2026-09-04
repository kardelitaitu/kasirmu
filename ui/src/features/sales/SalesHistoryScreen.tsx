import { useState, useCallback, useEffect, useMemo, useRef, useContext } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { LocaleContext } from '@/i18n/LocaleContext';
import { openUpgradePricing as openUpgradePricingPage } from '@/utils/upgrade';
import {
  listSales,
  getSale,
  printSalesReceipt,
  listRefundsScoped,
  voidSaleScoped,
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
import { l10nErrorMessage } from '@/utils/app-error';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { EmptyState, ErrorState, requiredLocalized } from '@/frontend/shared';
import { NoSalesIcon, NotFoundIcon } from '@/components/EmptyStateIllustrations';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import RefundModal from './RefundModal';
import './SalesHistoryScreen.css';

const STATUS_OPTIONS = ['All', 'Completed', 'Pending', 'Voided'] as const;

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
  // C1.2 upgrade link needs the active locale for the pricing URL; tests
  // render without LocaleContext, so default to English there.
  const locale = useContext(LocaleContext)?.locale ?? 'en';
  const [sales, setSales] = useState<SaleListItem[]>([]);
  /** C1.2: the backend capped this list to the tier's history window. */
  const [salesHistoryCapped, setSalesHistoryCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMemberDto[]>([]);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [refundSaleId, setRefundSaleId] = useState<string | null>(null);
  const [refunds, setRefunds] = useState<RefundDto[]>([]);
  const [_refundsLoading, setRefundsLoading] = useState(false);
  const { session, isManager } = useAuth();
  const { sessionToken } = useWorkspace();
  // ── Per-line cost / margin (HPP) for the open sale detail ──
  const [lineMargins, setLineMargins] = useState<SaleLineMarginDto[]>([]);

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
      const [response, staffList] = await Promise.all([
        listSales(),
        sessionToken
          ? listStaffScoped(sessionToken).catch(() => [] as StaffMemberDto[])
          : Promise.resolve([] as StaffMemberDto[]),
      ]);
      setSales(response.sales);
      setSalesHistoryCapped(response.salesHistoryCapped);
      setStaff(staffList);
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
      // Text search: match against sale ID, payment method, or user_id.
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const idMatch = s.id.toLowerCase().includes(q);
        const pmMatch = (s.paymentMethod ?? '').toLowerCase().includes(q);
        const uidMatch = (s.userId ?? '').toLowerCase().includes(q);
        if (!idMatch && !pmMatch && !uidMatch) return false;
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
      try {
        const refundData = await listRefundsScoped(sessionToken!, id).catch(() => [] as RefundDto[]);
        setRefunds(refundData);
      } catch {
        setRefunds([]);
      }
      // Margin is a live report (costs can change) — always refresh.
      try {
        const margins = sessionToken
          ? await getSaleLineMarginsScoped(sessionToken, id)
          : [];
        setLineMargins(margins);
      } catch {
        setLineMargins([]);
      }
      return;
    }

    setDetailLoading(true);
    setRefunds([]);
    setLineMargins([]);
    try {
      const [sale, refundData, margins] = await Promise.all([
        getSale(id),
        listRefundsScoped(sessionToken!, id).catch(() => [] as RefundDto[]),
        sessionToken
          ? getSaleLineMarginsScoped(sessionToken, id).catch(() => [] as SaleLineMarginDto[])
          : Promise.resolve([] as SaleLineMarginDto[]),
      ]);
      // Cache the result for future re-opens (null-safe: getSale can return null)
      if (sale) {
        detailCacheRef.current.set(id, sale);
      }
      setDetail(sale);
      setRefunds(refundData);
      setLineMargins(margins);
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
        receiptNumber: detail.id,
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
      });
    } catch {
      // Ignore print errors.
    } finally {
      setPrinting(false);
    }
    // sessionToken is read at :406. Because the catch above deliberately swallows everything,
    // this is the quietest failure in the set: after a hot-swap the reprint presents a dead
    // token, the call rejects, and the UI shows nothing at all -- no toast, no error, just a
    // button that stops doing anything. Listing the token at least makes the next attempt use
    // a live one.
  }, [detail, l10n, sessionToken]);

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
    try {
      const data = await listRefundsScoped(sessionToken!, saleId);
      setRefunds(data);
    } catch {
      setRefunds([]);
    } finally {
      setRefundsLoading(false);
    }
    // sessionToken is a free variable from useWorkspace() at :164, read at :451. The sibling
    // effect above already lists [sessionToken, l10n] at :227, so the token was understood to
    // change -- this array just omitted it. With [] the callback kept the mount-time token, and
    // because :467 lists loadRefunds in its own deps, the refund list for an opened sale was
    // fetched against whatever session was active when the screen mounted.
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
  const cashierName = useCallback((userId: string | null): string => {
    if (!userId) return '—';
    const s = staff.find((m) => m.id === userId);
    return s ? s.display_name : userId.slice(0, 8);
  }, [staff]);

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
      const withLines = await Promise.all(
        filteredSales.map(async (s) => {
          const margins = sessionToken
            ? await getSaleLineMarginsScoped(sessionToken, s.id).catch(() => [] as SaleLineMarginDto[])
            : [];
          return { sale: s, margins };
        }),
      );
      const rows: string[][] = [];
      for (const { sale: s, margins } of withLines) {
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
          // Margins unavailable (e.g. IPC down) — emit the summary row alone.
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
  }, [filteredSales, cashierName, l10n, sessionToken, csvExporting]);

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
            {staff.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
          </Localized>
        </div>
      </div>
      </Localized>

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
                  {['Sale ID', 'Date', 'Total', 'Items', 'Status', 'Payment', 'Cashier', ''].map((_, i) => (
                    <th key={i}><Skeleton width="4rem" height="0.75rem" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>{Array.from({ length: 5 }, (_, r) => (
                  <tr key={r}>
                    <td><Skeleton width="5rem" height="0.875rem" /></td>
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
                    </div>
                  )}
                  <div>
                    <Localized id="sales-history-detail-total">
                      <strong><span>Total:</span></strong>
                    </Localized>
                    {' '}{formatMoney(detail.total)}
                    {refunds.length > 0 && (
                      <Badge variant="warning" style={{ marginLeft: 8 }}>
                        <Localized id="refund-title">
                          <span>Refunded</span>
                        </Localized>
                      </Badge>
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

                {/* ── Previous Refunds ──────────────────────── */}
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
                  {detail.status === 'Completed' && session && (
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
