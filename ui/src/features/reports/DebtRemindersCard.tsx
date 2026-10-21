import { useEffect, useState, useCallback } from 'react';
import { Localized } from '@fluent/react';
import { Card } from '@/components/Card';
import { listReceivablesScoped, getArAgingReportScoped, type Receivable } from '@/api/receivables';
import { listPayablesScoped, getApAgingReportScoped, type PayableDto } from '@/api/payables';
import { formatMoney } from '@/types/domain';
import { buildCsv, downloadCsv } from './csv';

interface DebtRemindersCardProps {
  sessionToken: string;
  currency: string;
}

/**
 * Debt & Credit Reminders card for Dashboard — surfaces overdue and due-soon
 * customer kasbon (AR) and vendor bills (AP) with one-click navigation.
 */
export function DebtRemindersCard({ sessionToken, currency }: DebtRemindersCardProps) {
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [payables, setPayables] = useState<PayableDto[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDebts = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    try {
      const [recsResult, paysResult] = await Promise.allSettled([
        listReceivablesScoped(sessionToken),
        listPayablesScoped(sessionToken),
      ]);
      if (recsResult.status === 'fulfilled') {
        setReceivables(recsResult.value ?? []);
      }
      if (paysResult.status === 'fulfilled') {
        setPayables(paysResult.value ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    loadDebts();
  }, [loadDebts]);

  if (loading) {
    return null;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const threeDaysFromNow = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

  const activeRecs = receivables.filter((r) => r.status === 'open' || r.status === 'partial');
  const recOverdue = activeRecs.filter((r) => r.isOverdue);
  const recDueSoon = activeRecs.filter(
    (r) => !r.isOverdue && r.dueDate && r.dueDate >= todayStr && r.dueDate <= threeDaysFromNow,
  );
  const recTotalMinor = activeRecs.reduce((sum, r) => sum + (r.balance?.minor_units ?? 0), 0);

  const activePays = payables.filter((p) => p.status === 'open' || p.status === 'partial');
  const payOverdue = activePays.filter((p) => p.is_overdue);
  const payDueSoon = activePays.filter(
    (p) => !p.is_overdue && p.due_date && p.due_date >= todayStr && p.due_date <= threeDaysFromNow,
  );
  const payTotalMinor = activePays.reduce((sum, p) => sum + (p.balance?.minor_units ?? 0), 0);

  const isAllHealthy =
    recOverdue.length === 0 &&
    recDueSoon.length === 0 &&
    payOverdue.length === 0 &&
    payDueSoon.length === 0;

  const fmt = (minor: number) => formatMoney({ minor_units: minor, currency });

  const handleExportArAging = async () => {
    try {
      const report = await getArAgingReportScoped(sessionToken);
      const headers = [
        'Customer Name',
        'Phone',
        'Current (0-30 days)',
        '31-60 days',
        '61-90 days',
        '> 90 days',
        'Total Outstanding',
        'Open Receivables Count',
      ];
      const rows = report.customers.map((c) => [
        c.customerName,
        c.customerPhone ?? '',
        fmt(c.currentMinor),
        fmt(c.days3160Minor),
        fmt(c.days6190Minor),
        fmt(c.daysOver90Minor),
        fmt(c.totalMinor),
        String(c.openCount),
      ]);
      rows.push([
        'TOTAL',
        '',
        fmt(report.summary.currentMinor),
        fmt(report.summary.days3160Minor),
        fmt(report.summary.days6190Minor),
        fmt(report.summary.daysOver90Minor),
        fmt(report.summary.totalOutstandingMinor),
        String(report.customers.reduce((sum, c) => sum + c.openCount, 0)),
      ]);
      const csv = buildCsv(headers, rows);
      downloadCsv(csv, `ar-aging-report-${report.asOfDate}.csv`);
    } catch (err) {
      console.error('Failed to export AR aging report', err);
    }
  };

  const handleExportApAging = async () => {
    try {
      const report = await getApAgingReportScoped(sessionToken);
      const headers = [
        'Vendor / Supplier Name',
        'Current (0-30 days)',
        '31-60 days',
        '61-90 days',
        '> 90 days',
        'Total Outstanding',
        'Open Bills Count',
      ];
      const rows = report.vendors.map((v) => [
        v.vendorName,
        fmt(v.currentMinor),
        fmt(v.days3160Minor),
        fmt(v.days6190Minor),
        fmt(v.daysOver90Minor),
        fmt(v.totalMinor),
        String(v.openCount),
      ]);
      rows.push([
        'TOTAL',
        fmt(report.summary.currentMinor),
        fmt(report.summary.days3160Minor),
        fmt(report.summary.days6190Minor),
        fmt(report.summary.daysOver90Minor),
        fmt(report.summary.totalOutstandingMinor),
        String(report.vendors.reduce((sum, v) => sum + v.openCount, 0)),
      ]);
      const csv = buildCsv(headers, rows);
      downloadCsv(csv, `ap-aging-report-${report.asOfDate}.csv`);
    } catch (err) {
      console.error('Failed to export AP aging report', err);
    }
  };

  return (
    <Card shadow="sm" className="dashboard-section" data-testid="dashboard-debt-reminders">
      <div className="dashboard-debt-header">
        <Localized id="dashboard-debt-reminders">
          <h2 className="dashboard-section-title">Debt & Credit Reminders</h2>
        </Localized>
        {isAllHealthy && (
          <span className="dashboard-debt-badge dashboard-debt-badge--ok">
            <Localized id="dashboard-debt-ok">All credit & bills are up to date.</Localized>
          </span>
        )}
      </div>

      <div className="dashboard-debt-grid">
        {/* ── Customer Receivables (Piutang) ───────────────── */}
        <div className="dashboard-debt-panel" data-testid="receivables-reminder-panel">
          <div className="dashboard-debt-panel-header">
            <Localized id="dashboard-receivables-title">
              <h3 className="dashboard-debt-panel-title">Customer Receivables (Piutang)</h3>
            </Localized>
          </div>

          <div className="dashboard-debt-panel-outstanding">
            <Localized id="dashboard-outstanding" vars={{ amount: fmt(recTotalMinor) }}>
              <span>Outstanding: {fmt(recTotalMinor)}</span>
            </Localized>
          </div>

          <div className="dashboard-debt-badges">
            {recOverdue.length > 0 && (
              <span className="dashboard-debt-badge dashboard-debt-badge--danger">
                <Localized id="dashboard-overdue-count" vars={{ count: recOverdue.length }}>
                  <span>{recOverdue.length} overdue</span>
                </Localized>
              </span>
            )}
            {recDueSoon.length > 0 && (
              <span className="dashboard-debt-badge dashboard-debt-badge--warning">
                <Localized id="dashboard-due-soon-count" vars={{ count: recDueSoon.length }}>
                  <span>{recDueSoon.length} due soon</span>
                </Localized>
              </span>
            )}
            {recOverdue.length === 0 && recDueSoon.length === 0 && (
              <span className="dashboard-debt-badge dashboard-debt-badge--ok">
                <Localized id="dashboard-debt-panel-ok">Up to date</Localized>
              </span>
            )}
          </div>

          <div className="dashboard-debt-actions">
            <button
              type="button"
              className="dashboard-debt-btn"
              onClick={() => {
                window.location.hash = '#customers';
              }}
            >
              <Localized id="dashboard-view-customers">
                <span>View Customers</span>
              </Localized>
            </button>
            <button
              type="button"
              className="dashboard-debt-btn dashboard-debt-btn--secondary"
              onClick={handleExportArAging}
            >
              <Localized id="dashboard-export-ar-aging">
                <span>Export AR Aging</span>
              </Localized>
            </button>
          </div>
        </div>

        {/* ── Vendor Bills (Hutang) ─────────────────────────── */}
        <div className="dashboard-debt-panel" data-testid="payables-reminder-panel">
          <div className="dashboard-debt-panel-header">
            <Localized id="dashboard-payables-title">
              <h3 className="dashboard-debt-panel-title">Vendor Bills (Hutang)</h3>
            </Localized>
          </div>

          <div className="dashboard-debt-panel-outstanding">
            <Localized id="dashboard-outstanding" vars={{ amount: fmt(payTotalMinor) }}>
              <span>Outstanding: {fmt(payTotalMinor)}</span>
            </Localized>
          </div>

          <div className="dashboard-debt-badges">
            {payOverdue.length > 0 && (
              <span className="dashboard-debt-badge dashboard-debt-badge--danger">
                <Localized id="dashboard-overdue-count" vars={{ count: payOverdue.length }}>
                  <span>{payOverdue.length} overdue</span>
                </Localized>
              </span>
            )}
            {payDueSoon.length > 0 && (
              <span className="dashboard-debt-badge dashboard-debt-badge--warning">
                <Localized id="dashboard-due-soon-count" vars={{ count: payDueSoon.length }}>
                  <span>{payDueSoon.length} due soon</span>
                </Localized>
              </span>
            )}
            {payOverdue.length === 0 && payDueSoon.length === 0 && (
              <span className="dashboard-debt-badge dashboard-debt-badge--ok">
                <Localized id="dashboard-debt-panel-ok">Up to date</Localized>
              </span>
            )}
          </div>

          <div className="dashboard-debt-actions">
            <button
              type="button"
              className="dashboard-debt-btn"
              onClick={() => {
                window.location.hash = '#vendor-bills';
              }}
            >
              <Localized id="dashboard-view-vendor-bills">
                <span>View Vendor Bills</span>
              </Localized>
            </button>
            <button
              type="button"
              className="dashboard-debt-btn dashboard-debt-btn--secondary"
              onClick={handleExportApAging}
            >
              <Localized id="dashboard-export-ap-aging">
                <span>Export AP Aging</span>
              </Localized>
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}
