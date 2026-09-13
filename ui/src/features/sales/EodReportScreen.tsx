import { useState, useCallback, useEffect, useRef } from 'react';
import {
  exportEodReport,
  exportEodReportScoped,
  type EodReport,
} from '@/api/sales';
import { listShiftsScoped, type ShiftDto } from '@/api/shifts';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { formatMoney } from '@/types/domain';
import { buildCsv, downloadCsv } from '../reports/csv';
import { Card } from '@/components/Card';
import { Skeleton } from '@/components/Skeleton';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import { printReceiptScoped } from '@/api/hardware';
import { l10nErrorMessage } from '@/utils/app-error';
import './EodReportScreen.css';

/**
 * The two Fluent keys that label a non-zero cash difference, ONE definition
 * each. They were spelled inline at both render sites below (was :154 and :187
 * at tip b2247947e) — 2 keys x 2 sites = 4 copies, while each key is declared
 * once per bundle (locales/sales.ftl:479, sales.id.ftl:464). A rename that
 * landed on three of four copies would render a raw id, and Fluent's getString
 * returns null on a miss, which React renders as NOTHING: the tag would simply
 * vanish from a cash-reconciliation figure.
 *
 * Kept as plain string literals, deliberately NOT built from a template: the
 * pre-commit Fluent gates pattern-match on source text —
 * scripts/verify-bundle-parity.py --include-getstring (code -> bundle) and
 * scripts/verify-ftl-orphans.py (bundle -> code, "a reference you delete must
 * not strand a key"). Composing these names at runtime would make
 * eod-tag-over / eod-tag-short orphans on paper and invite a real key deletion.
 * Pinned by __tests__/salesLiteralSingleSource.test.ts.
 *
 * INVERT, DO NOT DELETE: if a third site ever needs one of these tags, point it
 * at this object. If a key genuinely must be spelled twice, say WHY here and
 * turn that test into a known_hazard_ pin recording the duplication as
 * accepted; deleting the red case hides the duplication that caused it.
 */
export const EOD_TAG_KEYS = {
  over: 'eod-tag-over',
  short: 'eod-tag-short',
} as const;

// ── Shift Summary Sub-component ──────────────────────────────────

interface ShiftSummaryProps {
  shifts: ShiftDto[];
  currency: string;
}

function ShiftSummarySection({ shifts, currency }: ShiftSummaryProps) {
  const { l10n } = useLocalization();
  // Times follow the active Fluent locale (not the browser default).
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const today = new Date().toISOString().slice(0, 10);
  const todayClosed = shifts.filter(
    (s) => s.status === 'closed' && s.closedAt && s.closedAt.startsWith(today),
  );
  const activeShift = shifts.find((s) => s.status === 'open');

  if (todayClosed.length === 0 && !activeShift) {
    return null;
  }

  const fmt = (minor: number) => formatMoney({ minor_units: minor, currency });
  const totalOpening = todayClosed.reduce((acc, s) => acc + s.openingBalanceMinor, 0);
  const totalClosing = todayClosed.reduce((acc, s) => acc + (s.closingBalanceMinor ?? 0), 0);
  const totalExpected = todayClosed.reduce((acc, s) => acc + (s.expectedCashMinor ?? 0), 0);
  const totalCashDiff = todayClosed.reduce((acc, s) => acc + (s.cashDifferenceMinor ?? 0), 0);

  return (
    <Card shadow="sm" className="eod-report-section-card">
      {/* ── Section header ──────────────────────── */}
      <div className="eod-report-shift-header">
        <Localized id="eod-cashier-shifts">
          <h2 className="eod-report-section-title" style={{ margin: 0 }}>Cashier Shifts</h2>
        </Localized>
        {activeShift && (
          <span className="eod-report-shift-active-badge">
            <span className="eod-report-shift-active-dot" />
            <Localized id="eod-shift-active">Shift in progress</Localized>
          </span>
        )}
      </div>

      {/* ── Active shift card ────────────────────── */}
      {activeShift && (
        <div className="eod-report-active-shift">
          <div className="eod-report-active-shift-row">
            <Localized id="eod-shift-active-since">
              <span className="eod-report-active-shift-label">Active shift since</span>
            </Localized>
            <span className="eod-report-active-shift-value">
              {new Date(activeShift.openedAt).toLocaleTimeString(numLocale, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="eod-report-active-shift-row">
            <Localized id="eod-opening-balance">
              <span className="eod-report-active-shift-label">Opening balance</span>
            </Localized>
            <span className="eod-report-active-shift-value">
              {fmt(activeShift.openingBalanceMinor)}
            </span>
          </div>
          <div className="eod-report-active-shift-row">
            <Localized id="eod-sales-this-shift">
              <span className="eod-report-active-shift-label">Sales this shift</span>
            </Localized>
            <span className="eod-report-active-shift-value">
              {fmt(activeShift.totalSalesMinor)}
            </span>
          </div>
        </div>
      )}

      {/* ── Closed shifts list ──────────────────── */}
      {todayClosed.length > 0 && (
        <>
          <div className="eod-report-shift-list-header">
            <Localized id="eod-closed-shifts">
              <span>Closed Shifts Today</span>
            </Localized>
            <span className="eod-report-shift-count">{todayClosed.length}</span>
          </div>

          <div className="eod-report-shift-table">
            <div className="eod-report-shift-table-header">
              <Localized id="eod-col-opened"><span>Opened</span></Localized>
              <Localized id="eod-col-closed"><span>Closed</span></Localized>
              <Localized id="eod-col-opening"><span>Opening</span></Localized>
              <Localized id="eod-col-counted"><span>Counted</span></Localized>
              <Localized id="eod-col-expected"><span>Expected</span></Localized>
              <Localized id="eod-col-diff"><span>Diff</span></Localized>
            </div>
            {todayClosed.map((s) => {
              const diff = s.cashDifferenceMinor;
              const diffClass =
                diff !== null && diff < 0
                  ? 'eod-report-shift-diff--negative'
                  : diff !== null && diff > 0
                    ? 'eod-report-shift-diff--positive'
                    : '';
              return (
                <div key={s.id} className="eod-report-shift-row">
                  <span className="eod-report-shift-cell">
                    {new Date(s.openedAt).toLocaleTimeString(numLocale, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="eod-report-shift-cell">
                    {s.closedAt
                      ? new Date(s.closedAt).toLocaleTimeString(numLocale, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </span>
                  <span className="eod-report-shift-cell eod-report-shift-cell--mono">
                    {fmt(s.openingBalanceMinor)}
                  </span>
                  <span className="eod-report-shift-cell eod-report-shift-cell--mono">
                    {s.closingBalanceMinor !== null
                      ? fmt(s.closingBalanceMinor)
                      : '—'}
                  </span>
                  <span className="eod-report-shift-cell eod-report-shift-cell--mono">
                    {s.expectedCashMinor !== null
                      ? fmt(s.expectedCashMinor)
                      : '—'}
                  </span>
                  <span className={`eod-report-shift-cell eod-report-shift-cell--mono ${diffClass}`}>
                    {diff !== null ? fmt(diff) : '—'}
                    {diff !== null && diff !== 0 && (
                      <span className="eod-report-shift-tag">
                        {diff > 0 ? l10n.getString(EOD_TAG_KEYS.over) : l10n.getString(EOD_TAG_KEYS.short)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}

            {/* ── Totals row ──────────────────────── */}
            <div className="eod-report-shift-row eod-report-shift-row--total">
              <span className="eod-report-shift-cell" />
              <Localized id="eod-total">
                <span className="eod-report-shift-cell">Total</span>
              </Localized>
              <span className="eod-report-shift-cell eod-report-shift-cell--mono">
                {fmt(totalOpening)}
              </span>
              <span className="eod-report-shift-cell eod-report-shift-cell--mono">
                {fmt(totalClosing)}
              </span>
              <span className="eod-report-shift-cell eod-report-shift-cell--mono">
                {fmt(totalExpected)}
              </span>
              <span className={`eod-report-shift-cell eod-report-shift-cell--mono ${
                totalCashDiff < 0
                  ? 'eod-report-shift-diff--negative'
                  : totalCashDiff > 0
                    ? 'eod-report-shift-diff--positive'
                    : ''
              }`}>
                {fmt(totalCashDiff)}
                {totalCashDiff !== 0 && (
                  <span className="eod-report-shift-tag">
                    {totalCashDiff > 0
                      ? l10n.getString(EOD_TAG_KEYS.over)
                      : l10n.getString(EOD_TAG_KEYS.short)}
                  </span>
                )}
              </span>
            </div>
          </div>
        </>
      )}

      {/* ── Combined cash summary ───────────────── */}
      {todayClosed.length > 1 && (
        <div className="eod-report-shift-cash-summary">
          <Localized id="eod-cash-reconciliation">
            <span className="eod-report-shift-cash-summary-label">Cash Reconciliation</span>
          </Localized>
          <div className="eod-report-shift-cash-grid">
            <div className="eod-report-shift-cash-item">
              <Localized id="eod-cash-total-opening">
                <span className="eod-report-shift-cash-label">Total opening</span>
              </Localized>
              <span className="eod-report-shift-cash-value">{fmt(totalOpening)}</span>
            </div>
            <div className="eod-report-shift-cash-item">
              <Localized id="eod-cash-total-counted">
                <span className="eod-report-shift-cash-label">Total counted</span>
              </Localized>
              <span className="eod-report-shift-cash-value">{fmt(totalClosing)}</span>
            </div>
            <div className="eod-report-shift-cash-item">
              <Localized id="eod-cash-total-expected">
                <span className="eod-report-shift-cash-label">Total expected</span>
              </Localized>
              <span className="eod-report-shift-cash-value">{fmt(totalExpected)}</span>
            </div>
            <div className="eod-report-shift-cash-item">
              <Localized id="eod-cash-net-diff">
                <span className="eod-report-shift-cash-label">Net difference</span>
              </Localized>
              <span
                className={`eod-report-shift-cash-value ${
                  totalCashDiff < 0
                    ? 'eod-report-shift-diff--negative'
                    : totalCashDiff > 0
                      ? 'eod-report-shift-diff--positive'
                      : ''
                }`}
              >
                {fmt(totalCashDiff)}
              </span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/** End-of-day report screen — payment summary, cashier shift reconciliation, totals by method, and printable receipt. */
export default function EodReportScreen() {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [report, setReport] = useState<EodReport | null>(null);
  const [shifts, setShifts] = useState<ShiftDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [printing, setPrinting] = useState(false);
  const [csvExporting, setCsvExporting] = useState(false);
  const reportRef = useRef(report);
  const shiftsRef = useRef(shifts);

  // Keep refs in sync for the print callback to access latest values.
  reportRef.current = report;
  shiftsRef.current = shifts;

  const handlePrint = useCallback(async () => {
    const r = reportRef.current;
    if (!r) return;
    setPrinting(true);
    try {
      const cur = r.currency ?? 'USD';
      const line = (text = '') => `${text}\n`;
      const sep = line('─'.repeat(38));
      const money = (minor: number) => formatMoney({ minor_units: minor, currency: cur });

      // Build a hard-wrapped receipt body (~38 chars wide for 58mm paper).
      let body = '';

      // Header.
      body += line('    END-OF-DAY REPORT');
      body += line(`    ${lastRefresh.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`);
      body += sep;

      // Revenue KPIs.
      body += line(`Total Revenue        ${money(r.total_revenue).padStart(14)}`);
      body += line(`Completed Sales      ${String(r.total_sales).padStart(14)}`);
      if (r.total_sales > 0) {
        body += line(`Average Sale         ${money(Math.round(r.total_revenue / r.total_sales)).padStart(14)}`);
      }
      body += line(`Voids                ${String(r.void_count).padStart(8)}  ${money(r.void_total).padStart(10)}`);
      body += line(`Discounts Applied    ${String(r.discount_count).padStart(14)}`);
      body += sep;

      // Payment breakdown.
      body += line('  PAYMENT BREAKDOWN');
      body += line('');
      for (const pmt of r.payment_breakdown) {
        const pct = r.total_revenue > 0 ? Math.round((pmt.total / r.total_revenue) * 100) : 0;
        const label = pmt.method.charAt(0).toUpperCase() + pmt.method.slice(1);
        body += line(`${label.padEnd(12)} ${String(pmt.count).padStart(3)} tx  ${money(pmt.total).padStart(12)}  ${String(pct).padStart(2)}%`);
      }
      body += sep;

      // Shift summary.
      const activeShift = shiftsRef.current.find((s) => s.status === 'open');
      if (activeShift) {
        body += line('  ACTIVE SHIFT IN PROGRESS');
        body += line(`  Since: ${new Date(activeShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        body += line(`  Opening: ${money(activeShift.openingBalanceMinor)}`);
        body += line(`  Sales: ${money(activeShift.totalSalesMinor)}`);
        body += sep;
      }

      const todayClosed = shiftsRef.current.filter(
        (s) => s.status === 'closed' && s.closedAt && s.closedAt.startsWith(new Date().toISOString().slice(0, 10)),
      );
      if (todayClosed.length > 0) {
        body += line('  CLOSED SHIFTS');
        for (const s of todayClosed) {
          const diff = s.cashDifferenceMinor;
          const diffStr = diff !== null ? `${diff > 0 ? '+' : ''}${money(diff)}` : '—';
          body += line(`  ${new Date(s.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}  ${money(s.openingBalanceMinor).padStart(10)}  ${diffStr.padStart(12)}`);
        }
        body += sep;
      }

      // Hourly breakdown (condensed).
      if (r.hourly_breakdown.length > 0) {
        body += line('  HOURLY BREAKDOWN');
        body += line('');
        const peak = Math.max(...r.hourly_breakdown.map((h) => h.total_minor), 1);
        for (let hour = 0; hour < 24; hour++) {
          const h = r.hourly_breakdown.find((r) => r.hour === hour);
          if (h) {
            const barLen = Math.round((h.total_minor / peak) * 12);
            const bar = '█'.repeat(Math.max(barLen, 1));
            body += line(`${String(hour).padStart(2)}:00 ${bar.padEnd(14)} ${money(h.total_minor).padStart(10)}`);
          }
        }
        body += sep;
      }

      // Footer.
      body += line('           *** END ***');
      body += line('');

      await printReceiptScoped(sessionToken, { body });
    } catch {
      // Printing error — silently handled.
    } finally {
      setPrinting(false);
    }
    // sessionToken is read at :343 and derived from useWorkspace() at :247. Because the catch
    // above deliberately swallows everything, this is another silent failure: after a hot-swap
    // the end-of-day report print presents a destroyed session, rejects, and the button simply
    // does nothing -- on the one screen an operator expects to produce a signed record. deps
    // listed only lastRefresh, which the refresh button changes and a session switch does not.
  }, [lastRefresh, sessionToken]);

  const exportCsv = useCallback(() => {
    const r = reportRef.current;
    if (!r) return;
    setCsvExporting(true);
    try {
      const cur = r.currency ?? 'USD';
      const money = (minor: number) => formatMoney({ minor_units: minor, currency: cur });

      const headers = [
        'Metric', 'Value',
      ];
      const rows: string[][] = [
        ['Date', lastRefresh.toISOString().slice(0, 10)],
        ['Total Revenue', money(r.total_revenue)],
        ['Completed Sales', String(r.total_sales)],
        ['Voided Sales', String(r.void_count)],
        ['Voided Value', money(r.void_total)],
        ['Discounts Applied', String(r.discount_count)],
      ];

      // Payment breakdown
      for (const pmt of r.payment_breakdown) {
        rows.push([`Payment - ${pmt.method}`, money(pmt.total)]);
      }

      // Hourly breakdown
      for (const h of r.hourly_breakdown) {
        rows.push([`Hour ${String(h.hour).padStart(2, '0')}:00`, money(h.total_minor)]);
      }

      const csv = buildCsv(headers, rows);
      downloadCsv(csv, `end-of-day-${lastRefresh.toISOString().slice(0, 10)}.csv`);
    } finally {
      setCsvExporting(false);
    }
  }, [lastRefresh]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, shiftData] = await Promise.all([
        // ADR #7, matching the listShiftsScoped call beside it. desktop-client registers no
        // export_eod_report command, so the ambient call rejected and the screen fell into its
        // error state on every desktop visit.
        sessionToken ? exportEodReportScoped(sessionToken) : exportEodReport(),
        listShiftsScoped(sessionToken),
      ]);
      setReport(data);
      setShifts(shiftData);
      setLastRefresh(new Date());
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'eod-error-fallback'));
    } finally {
      setLoading(false);
    }
  }, [l10n, sessionToken]);

  useEffect(() => { load(); }, [load]);

  const currency = report?.currency ?? 'USD';
  const money = (minor: number) => formatMoney({ minor_units: minor, currency });

  // Find the peak hour for the hourly bar chart.
  const peakHourSales = report
    ? Math.max(...report.hourly_breakdown.map((h) => h.total_minor), 1)
    : 1;

  return (
    <div className="eod-report">
      <div className="eod-report-header">
        <Localized id="eod-title">
          <h1 className="eod-report-title">End-of-Day Report</h1>
        </Localized>
        <div className="eod-report-header-right">
          <span className="eod-report-date">
            {lastRefresh.toLocaleDateString('en-US', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            })}
          </span>
          <button
            type="button"
            className="eod-report-refresh-btn"
            onClick={load}
            disabled={loading}
            aria-label={l10n.getString('eod-refresh-aria')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            <Localized id="eod-refresh">Refresh</Localized>
          </button>
          <button
            type="button"
            className="eod-report-refresh-btn eod-report-print-btn"
            onClick={handlePrint}
            disabled={printing || !report}
            aria-label={l10n.getString('eod-print-aria')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            {printing ? <Localized id="eod-printing">Printing…</Localized> : <Localized id="eod-print">Print</Localized>}
          </button>
          <button
            type="button"
            className="eod-report-refresh-btn"
            onClick={exportCsv}
            disabled={csvExporting || !report}
            aria-label={l10n.getString('export-csv-aria')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <Localized id="inv-report-export-csv">Export CSV</Localized>
          </button>
        </div>
      </div>

      {/* ── Shift Summary Section ────────────────── */}
      {!loading && !error && report && (
        <ShiftSummarySection shifts={shifts} currency={currency} />
      )}

      {loading && !report ? (
        <div className="eod-report-loading-skeleton" aria-hidden="true">
          {/* KPI row: 4 cards */}
          <div className="eod-report-kpi-row">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} shadow="sm" className="eod-report-kpi-card">
                <div className="eod-report-kpi">
                  <Skeleton width="5rem" height="0.75rem" />
                  <Skeleton width="7rem" height="1.75rem" style={{ marginTop: 'var(--space-1)' }} />
                  <Skeleton width="4rem" height="0.75rem" style={{ marginTop: 'var(--space-1)' }} />
                </div>
              </Card>
            ))}
          </div>
          {/* Two-column layout */}
          <div className="eod-report-columns">
            {/* Left: Payment Breakdown */}
            <Card shadow="sm" className="eod-report-section-card">
              <Skeleton width="8rem" height="1.25rem" />
              <div className="eod-report-payment-list" style={{ marginTop: 'var(--space-3)' }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="eod-report-payment-row">
                    <div className="eod-report-payment-info">
                      <Skeleton width="5rem" height="0.875rem" />
                      <Skeleton width="4rem" height="0.75rem" />
                    </div>
                    <div className="eod-report-payment-bar-wrap">
                      <Skeleton width="100%" height="0.5rem" style={{ borderRadius: 'var(--radius-full)' }} />
                    </div>
                    <div className="eod-report-payment-amount">
                      <Skeleton width="4rem" height="0.875rem" />
                      <Skeleton width="2rem" height="0.75rem" />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            {/* Right: Hourly Sales */}
            <Card shadow="sm" className="eod-report-section-card">
              <Skeleton width="7rem" height="1.25rem" />
              <div className="eod-report-hourly-chart" style={{ marginTop: 'var(--space-3)' }}>
                {['60%', '40%', '80%', '30%', '70%', '50%', '90%', '45%'].map((w, i) => (
                  <div key={i} className="eod-report-hour-bar-row">
                    <Skeleton width="1.75rem" height="0.75rem" />
                    <div className="eod-report-hour-bar-track">
                      <Skeleton width={w} height="0.875rem" style={{ borderRadius: 'var(--radius-sm)' }} />
                    </div>
                    <Skeleton width="3rem" height="0.75rem" />
                  </div>
                ))}
              </div>
            </Card>
          </div>
          {/* Summary grid: 6 items */}
          <Card shadow="sm" className="eod-report-section-card">
            <Skeleton width="7rem" height="1.25rem" />
            <div className="eod-report-summary-grid" style={{ marginTop: 'var(--space-3)' }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="eod-report-summary-item">
                  <Skeleton width="4rem" height="0.75rem" />
                  <Skeleton width="3rem" height="1rem" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : error ? (
        <Card shadow="sm">
          <div className="eod-report-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p><Localized id="eod-error" vars={{ error }} /></p>
            <button type="button" className="eod-report-retry-btn" onClick={load}>
              <Localized id="eod-retry">Retry</Localized>
            </button>
          </div>
        </Card>
      ) : !report ? (
        <Card shadow="sm">
          <div className="eod-report-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="32" height="32" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            <Localized id="eod-empty-title">
              <p>No sales data available for today.</p>
            </Localized>
            <Localized id="eod-empty-sub">
              <p className="eod-report-empty-sub">Sales will appear here once transactions are completed.</p>
            </Localized>
          </div>
        </Card>
      ) : (
        <>
          {/* ── KPI Cards ─────────────────────────────── */}
          <div className="eod-report-kpi-row">
            <Card shadow="sm" className="eod-report-kpi-card">
              <div className="eod-report-kpi">
                <Localized id="eod-kpi-revenue">
                  <span className="eod-report-kpi-label">Total Revenue</span>
                </Localized>
                <span className="eod-report-kpi-value eod-report-kpi-value--primary">
                  {money(report.total_revenue)}
                </span>
                <Localized id="eod-kpi-revenue-sub" vars={{ count: report.total_sales }}>
                  <span className="eod-report-kpi-sub">{report.total_sales} completed sales</span>
                </Localized>
              </div>
            </Card>
            <Card shadow="sm" className="eod-report-kpi-card">
              <div className="eod-report-kpi">
                <Localized id="eod-kpi-average">
                  <span className="eod-report-kpi-label">Average Sale</span>
                </Localized>
                <span className="eod-report-kpi-value">
                  {report.total_sales > 0
                    ? money(Math.round(report.total_revenue / report.total_sales))
                    : money(0)}
                </span>
                <Localized id="eod-kpi-average-sub">
                  <span className="eod-report-kpi-sub">per transaction</span>
                </Localized>
              </div>
            </Card>
            <Card shadow="sm" className="eod-report-kpi-card">
              <div className="eod-report-kpi">
                <Localized id="eod-kpi-voids">
                  <span className="eod-report-kpi-label">Voids</span>
                </Localized>
                <span className="eod-report-kpi-value eod-report-kpi-value--danger">
                  {report.void_count}
                </span>
                <Localized id="eod-kpi-voids-sub" vars={{ amount: money(report.void_total) }}>
                  <span className="eod-report-kpi-sub">{money(report.void_total)} voided</span>
                </Localized>
              </div>
            </Card>
            <Card shadow="sm" className="eod-report-kpi-card">
              <div className="eod-report-kpi">
                <Localized id="eod-kpi-discounts">
                  <span className="eod-report-kpi-label">Discounts Applied</span>
                </Localized>
                <span className="eod-report-kpi-value eod-report-kpi-value--warning">
                  {report.discount_count}
                </span>
                <span className="eod-report-kpi-sub">
                  {report.discount_count > 0
                    ? <Localized id="eod-kpi-discounts-sub" vars={{ count: report.discount_count }}>
                        <span>{report.discount_count} sales with discount</span>
                      </Localized>
                    : <Localized id="eod-kpi-discounts-none">
                        <span>No discounts applied</span>
                      </Localized>}
                </span>
              </div>
            </Card>
          </div>

          {/* ── Two-column layout ─────────────────────── */}
          <div className="eod-report-columns">
            {/* Left: Payment Breakdown */}
            <Card shadow="sm" className="eod-report-section-card">
              <Localized id="eod-payment-breakdown">
                <h2 className="eod-report-section-title">Payment Breakdown</h2>
              </Localized>
              {report.payment_breakdown.length === 0 ? (
                <Localized id="eod-payment-empty">
                  <p className="eod-report-no-data">No payment data</p>
                </Localized>
              ) : (
                <div className="eod-report-payment-list">
                  {report.payment_breakdown.map((pmt) => {
                    const pct = report.total_revenue > 0
                      ? Math.round((pmt.total / report.total_revenue) * 100)
                      : 0;
                    return (
                      <div key={pmt.method} className="eod-report-payment-row">
                        <div className="eod-report-payment-info">
                          <span className="eod-report-payment-method">
                            {pmt.method.charAt(0).toUpperCase() + pmt.method.slice(1)}
                          </span>
                          <Localized id="eod-payment-count" vars={{ count: pmt.count }}>
                            <span className="eod-report-payment-count">{pmt.count} transactions</span>
                          </Localized>
                        </div>
                        <div className="eod-report-payment-bar-wrap">
                          <div
                            className="eod-report-payment-bar"
                            style={{ width: `${pct}%` }}
                            role="progressbar"
                            aria-valuenow={pct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={l10n.getString('eod-payment-bar-aria', { method: pmt.method, pct })}
                          />
                        </div>
                        <div className="eod-report-payment-amount">
                          <span className="eod-report-payment-total">{money(pmt.total)}</span>
                          <span className="eod-report-payment-pct">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Right: Hourly Sales (bar chart) */}
            <Card shadow="sm" className="eod-report-section-card">
              <Localized id="eod-hourly-title">
                <h2 className="eod-report-section-title">Sales by Hour</h2>
              </Localized>
              {report.hourly_breakdown.length === 0 ? (
                <Localized id="eod-hourly-empty">
                  <p className="eod-report-no-data">No hourly data</p>
                </Localized>
              ) : (
                <div className="eod-report-hourly-chart" aria-label={l10n.getString('eod-hourly-chart-aria')}>
                  {Array.from({ length: 24 }, (_, hour) => {
                    const h = report.hourly_breakdown.find((r) => r.hour === hour);
                    const barPct = h ? Math.round((h.total_minor / peakHourSales) * 100) : 0;
                    return (
                      <div key={hour} className="eod-report-hour-bar-row" aria-label={
                        h
                          ? l10n.getString('eod-hour-bar-aria-sales', {
                              hour: String(hour).padStart(2, '0'),
                              count: h.sale_count,
                              amount: money(h.total_minor),
                            })
                          : l10n.getString('eod-hour-bar-aria-none', { hour: String(hour).padStart(2, '0') })
                      }>
                        <span className="eod-report-hour-label">{String(hour).padStart(2, '0')}</span>
                        <div className="eod-report-hour-bar-track">
                          <div
                            className={`eod-report-hour-bar ${barPct > 0 ? 'eod-report-hour-bar--active' : ''}`}
                            style={{ width: `${Math.max(barPct, h ? 4 : 0)}%` }}
                          />
                        </div>
                        <span className="eod-report-hour-value">
                          {h ? money(h.total_minor) : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* ── Summary table ─────────────────────────── */}
          {report.total_sales > 0 && (
            <Card shadow="sm" className="eod-report-section-card">
              <Localized id="eod-summary-title">
                <h2 className="eod-report-section-title">Today&apos;s Summary</h2>
              </Localized>
              <div className="eod-report-summary-grid">
                <div className="eod-report-summary-item">
                  <Localized id="eod-summary-completed">
                    <span className="eod-report-summary-label">Completed Sales</span>
                  </Localized>
                  <span className="eod-report-summary-value">{report.total_sales}</span>
                </div>
                <div className="eod-report-summary-item">
                  <Localized id="eod-summary-revenue">
                    <span className="eod-report-summary-label">Total Revenue</span>
                  </Localized>
                  <span className="eod-report-summary-value">{money(report.total_revenue)}</span>
                </div>
                <div className="eod-report-summary-item">
                  <Localized id="eod-summary-voided-sales">
                    <span className="eod-report-summary-label">Voided Sales</span>
                  </Localized>
                  <span className="eod-report-summary-value eod-report-summary-value--danger">{report.void_count}</span>
                </div>
                <div className="eod-report-summary-item">
                  <Localized id="eod-summary-voided-value">
                    <span className="eod-report-summary-label">Voided Value</span>
                  </Localized>
                  <span className="eod-report-summary-value eod-report-summary-value--danger">{money(report.void_total)}</span>
                </div>
                <div className="eod-report-summary-item">
                  <Localized id="eod-summary-discounts">
                    <span className="eod-report-summary-label">Sales with Discounts</span>
                  </Localized>
                  <span className="eod-report-summary-value">{report.discount_count}</span>
                </div>
                <div className="eod-report-summary-item">
                  <Localized id="eod-summary-payment-methods">
                    <span className="eod-report-summary-label">Payment Methods Used</span>
                  </Localized>
                  <span className="eod-report-summary-value">{report.payment_breakdown.length}</span>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
